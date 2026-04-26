"""pi AgentCLI implementation (pi.dev)."""

from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime
from pathlib import Path
from threading import Event
from typing import Callable

from agent_cli import AgentCLI
from agent_results import (
    AgentInfo,
    AgentListResult,
    ExportResult,
    HistoryMessage,
    ResponsePart,
    RunResult,
    SessionInfo,
    SessionListResult,
)

logger = logging.getLogger(__name__)

_SESSIONS_BASE = Path.home() / ".pi" / "agent" / "sessions"


def _cwd_to_slug(cwd: Path) -> str:
    """Convert /home/tom/myproject -> --home-tom-myproject-- (pi's encoding)."""
    parts = str(cwd.resolve()).split("/")  # ['', 'home', 'tom', 'myproject']
    return "-" + "-".join(parts) + "--"


def _sessions_dir(cwd: Path) -> Path:
    override = os.environ.get("PI_SESSIONS_PATH")
    if override:
        return Path(override)
    return _SESSIONS_BASE / _cwd_to_slug(cwd)


def _extract_session_id(output: str) -> str | None:
    for line in output.splitlines():
        try:
            data = json.loads(line)
            if data.get("type") == "session":
                return data.get("id")
        except json.JSONDecodeError:
            pass
    return None


def _extract_response_parts(output: str) -> list[ResponsePart]:
    for line in reversed(output.splitlines()):
        try:
            data = json.loads(line)
            if data.get("type") == "turn_end":
                text = ""
                for part in data.get("message", {}).get("content", []):
                    if part.get("type") == "text":
                        text += part["text"]
                if text:
                    return [ResponsePart(text=text, part_type="final")]
        except json.JSONDecodeError:
            pass
    return []


class PiAgentCLI(AgentCLI):
    """AgentCLI implementation for pi (pi.dev)."""

    @classmethod
    def main_executable_name(cls) -> str:
        return "pi"

    @property
    def cli_name(self) -> str:
        return "pi"

    def build_prompt_command(self, prompt: str) -> list[str]:
        return ["pi", "--print", "--mode", "json"]

    def prompt_via_stdin(self) -> bool:
        return False  # prompt is a positional arg

    # ------------------------------------------------------------------
    def run_agent(
        self,
        message: str,
        session_id: str | None,
        agent: str | None,
        model: str | None,
        cwd: Path,
        cancel_event: Event | None = None,
        on_process: Callable[[subprocess.Popen[str]], None] | None = None,
    ) -> RunResult:
        cmd = ["pi", "--print", "--mode", "json"]
        if session_id:
            cmd += ["--session", session_id]
        if model:
            cmd += ["--model", model]
        cmd.append(message)

        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(cwd),
            )
        except FileNotFoundError:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=self.missing_command_error(),
            )

        if on_process:
            on_process(process)

        if cancel_event and cancel_event.is_set():
            process.terminate()
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message="Agent request cancelled.",
            )

        input_data: bytes | None = None
        while True:
            try:
                stdout_bytes, stderr_bytes = process.communicate(
                    input=input_data, timeout=0.5
                )
                break
            except subprocess.TimeoutExpired:
                input_data = None
                if cancel_event and cancel_event.is_set():
                    process.terminate()
                    try:
                        stdout_bytes, stderr_bytes = process.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        stdout_bytes, stderr_bytes = process.communicate()
                    return RunResult(
                        success=False,
                        session_id=session_id,
                        response_parts=[],
                        error_message="Agent request cancelled.",
                    )

        if process.returncode != 0:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=(stderr_bytes.decode() or "pi exited with error").strip(),
            )

        decoded = stdout_bytes.decode()
        new_session_id = _extract_session_id(decoded)
        parts = _extract_response_parts(decoded)
        return RunResult(
            success=True,
            session_id=new_session_id or session_id,
            response_parts=parts,
        )

    # ------------------------------------------------------------------
    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        effective_cwd = cwd or Path.cwd()
        session_dir = _sessions_dir(effective_cwd)

        if not session_dir.exists():
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Session directory not found: {session_dir}",
            )

        matches = list(session_dir.glob(f"*{session_id}*"))
        if not matches:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Session file not found for id: {session_id}",
            )

        path = matches[0]
        messages: list[HistoryMessage] = []
        try:
            with path.open() as f:
                for line in f:
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if ev.get("type") != "message":
                        continue
                    msg = ev.get("message", {})
                    role = msg.get("role", "assistant")
                    ts = self._to_milliseconds(msg.get("timestamp"))
                    for part in msg.get("content", []):
                        if part.get("type") == "text" and part.get("text"):
                            messages.append(
                                HistoryMessage(
                                    message_id=ev.get("id"),
                                    role=role,
                                    content_type="text",
                                    content=part["text"],
                                    timestamp=ts,
                                )
                            )
        except Exception as e:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=str(e),
            )

        return ExportResult(success=True, session_id=session_id, messages=messages)

    # ------------------------------------------------------------------
    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        effective_cwd = cwd or Path.cwd()
        session_dir = _sessions_dir(effective_cwd)

        if not session_dir.exists():
            return SessionListResult(success=True, sessions=[])

        try:
            sessions: list[SessionInfo] = []
            for path in sorted(
                session_dir.glob("*.jsonl"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )[:50]:
                # filename: 2026-04-26T09-48-04-248Z_<uuid>.jsonl
                stem = path.stem
                session_id = stem.split("_", 1)[1] if "_" in stem else stem
                title = session_id[:8]
                try:
                    with path.open() as f:
                        for line in f:
                            ev = json.loads(line)
                            if (
                                ev.get("type") == "message"
                                and ev.get("message", {}).get("role") == "user"
                            ):
                                for part in ev["message"].get("content", []):
                                    if part.get("type") == "text":
                                        title = part["text"][:60]
                                break
                except Exception:
                    pass
                updated = datetime.fromtimestamp(path.stat().st_mtime).strftime(
                    "%Y-%m-%d %H:%M"
                )
                sessions.append(
                    SessionInfo(session_id=session_id, title=title, updated=updated)
                )
            return SessionListResult(success=True, sessions=sessions)
        except Exception as e:
            return SessionListResult(success=False, sessions=[], error_message=str(e))

    # ------------------------------------------------------------------
    def list_agents(self, cwd: Path | None = None) -> AgentListResult:
        # pi has no agent listing command
        return AgentListResult(
            success=True,
            agents=[AgentInfo(name="pi", agent_type="Built-in", details=["pi.dev coding assistant"])],
        )
