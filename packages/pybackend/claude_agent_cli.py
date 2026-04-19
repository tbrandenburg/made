#!/usr/bin/env python3
"""
Claude Code AgentCLI Implementation - Draft

Maps the existing AgentCLI interface to Claude Code's `claude` CLI.

Key CLI facts (from `claude --help`):
  -p / --print              Non-interactive: print response and exit
  --output-format <fmt>     text (default) | json | stream-json
  --resume <session-id>     Resume a session by UUID
  --model <model>           Model alias (sonnet, opus, haiku) or full name
  --allowedTools <tools>    Comma/space-separated tool list
  --permission-mode <mode>  auto | bypassPermissions | acceptEdits | default | plan
  --system-prompt <prompt>  Custom system prompt
  --append-system-prompt    Append to default system prompt
  --no-session-persistence  Don't save session to disk (ephemeral)

Session flow:
  - First call:  `claude -p "prompt" --output-format json`
                 → JSON response contains `session_id` UUID
  - Resume call: `claude -p "prompt" --output-format json --resume <session-id>`
                 → Continues conversation

Session storage:
  - Claude stores sessions in ~/.claude/projects/<hash>/
  - Each session is a JSONL file: <session-id>.jsonl
  - No built-in `export` or `session list` commands, so we parse files directly
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from threading import Event
from typing import Callable, Any
import re
import glob as glob_module

from agent_cli import AgentCLI
from agent_results import (
    RunResult,
    ExportResult,
    SessionListResult,
    AgentListResult,
    ResponsePart,
    HistoryMessage,
    SessionInfo,
    AgentInfo,
)

logger = logging.getLogger(__name__)

# ~/.claude/projects/<cwd-hash>/<session-id>.jsonl
CLAUDE_SESSIONS_BASE = Path.home() / ".claude" / "projects"


class ClaudeCodeAgentCLI(AgentCLI):
    """
    AgentCLI implementation wrapping the `claude` CLI (Claude Code).

    Invocation model:
        claude -p <prompt> --output-format json [--resume <session-id>] [--model <model>]

    The CLI emits a single JSON object on stdout when --output-format=json:
        {
          "type": "result",
          "subtype": "success",
          "session_id": "<uuid>",
          "result": "<assistant text>",
          "cost_usd": 0.001,
          "duration_ms": 1234,
          "num_turns": 1
        }

    For streaming (--output-format=stream-json) each line is a JSON event:
        {"type": "assistant", "message": {...}, "session_id": "..."}
        {"type": "result", "subtype": "success", "session_id": "...", "result": "..."}
    """

    @classmethod
    def main_executable_name(cls) -> str:
        return "claude"

    @property
    def cli_name(self) -> str:
        return "claude"

    def build_prompt_command(self, prompt: str) -> list[str]:
        # Prompt is passed as a positional argument (not via stdin).
        # bypassPermissions ensures this works unattended (no interactive prompts).
        return [
            self.main_executable_name(),
            "--print",
            "--output-format", "json",
            "--permission-mode", "bypassPermissions",
            prompt,
        ]

    def prompt_via_stdin(self) -> bool:
        # Claude Code accepts prompt as a positional arg; stdin also works for pipes
        # but we use the positional arg form for clarity.
        return False

    # ------------------------------------------------------------------ #
    #  run_agent                                                           #
    # ------------------------------------------------------------------ #

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
        """Run `claude -p` and return a structured RunResult."""

        cmd = self._build_run_command(message, session_id, agent, model, cwd)

        logger.info(
            "Claude Code CLI starting (session: %s, model: %s)",
            session_id or "<new>",
            model or "<default>",
        )

        try:
            if cancel_event and cancel_event.is_set():
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message="Agent request cancelled.",
                )

            process = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            if on_process:
                on_process(process)

            # Poll with cancellation support
            if cancel_event is not None:
                input_data: str | None = None
                while True:
                    try:
                        stdout, stderr = process.communicate(
                            input=input_data, timeout=0.1
                        )
                        break
                    except subprocess.TimeoutExpired:
                        input_data = None
                        if cancel_event.is_set():
                            process.terminate()
                            try:
                                stdout, stderr = process.communicate(timeout=5)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                stdout, stderr = process.communicate()
                            return RunResult(
                                success=False,
                                session_id=session_id,
                                response_parts=[],
                                error_message="Agent request cancelled.",
                            )
            else:
                stdout, stderr = process.communicate()

            if process.returncode != 0:
                error_msg = (stderr or "").strip() or "Command failed with no output"
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message=error_msg,
                )

            return self._parse_claude_json_output(stdout, session_id)

        except FileNotFoundError:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=self.missing_command_error(),
            )
        except Exception as e:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=f"Error: {str(e)}",
            )

    def _build_run_command(
        self,
        message: str,
        session_id: str | None,
        agent: str | None,
        model: str | None,
        cwd: Path | None = None,
    ) -> list[str]:
        """Assemble the claude CLI invocation.

        Permissions strategy:
          - bypassPermissions so file tools (Read/Write/Edit/Glob/Grep) run
            unattended within the cwd.
          - Bash is further restricted to paths under cwd via allowedTools so
            arbitrary shell commands outside the working tree are blocked.
        """
        cmd = [
            self.main_executable_name(),
            "--print",
            "--output-format", "json",
            "--permission-mode", "bypassPermissions",
        ]

        # Scope Bash to cwd; all other built-in file tools work freely within
        # the subprocess cwd already.
        if cwd:
            cmd.extend([
                "--allowedTools",
                f"Read,Write,Edit,Glob,Grep,Bash(* {cwd}/*)",
            ])

        if session_id:
            cmd.extend(["--resume", session_id])

        if model:
            cmd.extend(["--model", model])

        if agent:
            # Claude Code supports custom agents via --agent <name>
            cmd.extend(["--agent", agent])

        # Prompt is the final positional argument
        cmd.append(message)

        return cmd

    def _parse_claude_json_output(
        self, stdout: str, session_id: str | None
    ) -> RunResult:
        """
        Parse `claude --output-format json` output.

        The JSON output schema:
          {
            "type": "result",
            "subtype": "success" | "error_max_turns" | ...,
            "session_id": "<uuid>",
            "result": "<final assistant text>",
            "cost_usd": 0.001,
            "duration_ms": 1234,
            "num_turns": 1,
            "is_error": false
          }
        """
        raw = stdout.strip()
        if not raw:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message="No output from Claude Code",
            )

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            # Fallback: treat stdout as plain text (e.g. --output-format text)
            return RunResult(
                success=True,
                session_id=session_id,
                response_parts=[
                    ResponsePart(
                        text=raw,
                        timestamp=None,
                        part_type="final",
                    )
                ],
            )

        is_error = data.get("is_error", False)
        extracted_session_id = data.get("session_id") or session_id

        if is_error or data.get("subtype", "") != "success":
            return RunResult(
                success=False,
                session_id=extracted_session_id,
                response_parts=[],
                error_message=data.get("result") or "Claude Code returned an error",
            )

        result_text = data.get("result", "")
        return RunResult(
            success=True,
            session_id=extracted_session_id,
            response_parts=[
                ResponsePart(
                    text=result_text,
                    timestamp=None,  # top-level JSON result has no per-part timestamp
                    part_type="final",
                )
            ],
        )

    # ------------------------------------------------------------------ #
    #  export_session                                                      #
    # ------------------------------------------------------------------ #

    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        """
        Export session history by reading Claude's JSONL session file directly.

        Claude stores sessions under:
            ~/.claude/projects/<url-encoded-cwd>/<session-id>.jsonl

        Each line in the JSONL is a message object:
            {"uuid": "...", "type": "user"|"assistant", "message": {...}, "timestamp": "..."}
        """
        session_file = self._find_session_file(session_id, cwd)

        if session_file is None:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Session file not found for ID: {session_id}",
            )

        try:
            messages = self._parse_session_jsonl(session_file)
            return ExportResult(success=True, session_id=session_id, messages=messages)
        except Exception as e:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Error reading session: {str(e)}",
            )

    def _find_session_file(
        self, session_id: str, cwd: Path | None
    ) -> Path | None:
        """Locate the JSONL file for a session ID."""
        # Search all project dirs under ~/.claude/projects/
        if not CLAUDE_SESSIONS_BASE.exists():
            return None

        # Fast path: if cwd is known, check that project dir first
        if cwd:
            encoded = _encode_cwd(cwd)
            candidate = CLAUDE_SESSIONS_BASE / encoded / f"{session_id}.jsonl"
            if candidate.exists():
                return candidate

        # Fallback: glob across all project dirs
        pattern = str(CLAUDE_SESSIONS_BASE / "**" / f"{session_id}.jsonl")
        matches = glob_module.glob(pattern, recursive=True)
        return Path(matches[0]) if matches else None

    def _parse_session_jsonl(self, session_file: Path) -> list[HistoryMessage]:
        """Parse a Claude JSONL session file into HistoryMessage objects."""
        messages: list[HistoryMessage] = []

        with open(session_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                entry_type = entry.get("type")  # "user" | "assistant" | "summary"
                if entry_type not in ("user", "assistant"):
                    continue

                role = entry_type  # maps directly
                msg = entry.get("message", {})

                # Timestamp: ISO string → milliseconds
                timestamp_ms = _iso_to_ms(entry.get("timestamp"))

                # Extract content blocks
                content = msg.get("content", "")
                if isinstance(content, str):
                    messages.append(
                        HistoryMessage(
                            message_id=entry.get("uuid"),
                            role=role,
                            content_type="text",
                            content=content,
                            timestamp=timestamp_ms,
                        )
                    )
                elif isinstance(content, list):
                    for block in content:
                        block_type = block.get("type", "text")
                        if block_type == "text":
                            messages.append(
                                HistoryMessage(
                                    message_id=entry.get("uuid"),
                                    role=role,
                                    content_type="text",
                                    content=block.get("text", ""),
                                    timestamp=timestamp_ms,
                                )
                            )
                        elif block_type == "tool_use":
                            tool_name = block.get("name", "")
                            tool_input = json.dumps(block.get("input", {}))
                            messages.append(
                                HistoryMessage(
                                    message_id=entry.get("uuid"),
                                    role=role,
                                    content_type="tool_use",
                                    content=f"{tool_name}: {tool_input}",
                                    timestamp=timestamp_ms,
                                    call_id=block.get("id"),
                                )
                            )
                        elif block_type == "tool_result":
                            result_content = block.get("content", "")
                            if isinstance(result_content, list):
                                result_content = " ".join(
                                    c.get("text", "") for c in result_content
                                    if c.get("type") == "text"
                                )
                            messages.append(
                                HistoryMessage(
                                    message_id=entry.get("uuid"),
                                    role=role,
                                    content_type="tool",
                                    content=str(result_content),
                                    timestamp=timestamp_ms,
                                    call_id=block.get("tool_use_id"),
                                )
                            )

        return messages

    # ------------------------------------------------------------------ #
    #  list_sessions                                                       #
    # ------------------------------------------------------------------ #

    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """
        List Claude Code sessions by scanning JSONL files in ~/.claude/projects/.

        Claude Code has no built-in `session list` command, so we parse the
        filesystem directly.
        """
        if not CLAUDE_SESSIONS_BASE.exists():
            return SessionListResult(
                success=False,
                sessions=[],
                error_message=f"Claude projects directory not found: {CLAUDE_SESSIONS_BASE}",
            )

        sessions: list[SessionInfo] = []

        # If cwd is given, prefer that project dir but fall back to a full scan
        # if _encode_cwd doesn't produce an exact match (the encoding is a
        # best-effort heuristic).
        project_dirs: list[Path]
        if cwd:
            encoded = _encode_cwd(cwd)
            project_dir = CLAUDE_SESSIONS_BASE / encoded
            if project_dir.exists():
                project_dirs = [project_dir]
            else:
                # Glob for any project dir whose name ends with the leaf dirname
                leaf = cwd.name
                candidates = [
                    p for p in CLAUDE_SESSIONS_BASE.iterdir()
                    if p.is_dir() and p.name.endswith(f"-{leaf}")
                ]
                project_dirs = candidates or [
                    p for p in CLAUDE_SESSIONS_BASE.iterdir() if p.is_dir()
                ]
        else:
            project_dirs = [
                p for p in CLAUDE_SESSIONS_BASE.iterdir() if p.is_dir()
            ]

        for project_dir in project_dirs:
            for session_file in sorted(
                project_dir.glob("*.jsonl"), key=lambda f: f.stat().st_mtime, reverse=True
            ):
                session_id = session_file.stem
                title, updated = _extract_session_summary(session_file)
                sessions.append(
                    SessionInfo(
                        session_id=session_id,
                        title=title,
                        updated=updated,
                    )
                )

        return SessionListResult(success=True, sessions=sessions)

    # ------------------------------------------------------------------ #
    #  list_agents                                                         #
    # ------------------------------------------------------------------ #

    def list_agents(self, cwd: Path | None = None) -> AgentListResult:
        """
        List agents via `claude agents`.

        Output format:
            4 active agents

            Built-in agents:
              Explore · haiku
              general-purpose · inherit
              Plan · inherit
              statusline-setup · sonnet

            Project agents:       ← optional section
              my-agent · sonnet
        """
        try:
            result = subprocess.run(
                [self.main_executable_name(), "agents"],
                capture_output=True,
                text=True,
                cwd=str(cwd) if cwd else None,
            )

            if result.returncode != 0:
                error_msg = (result.stderr or "").strip() or "Failed to list agents"
                return AgentListResult(success=False, agents=[], error_message=error_msg)

            agents = _parse_agents_output(result.stdout or "")
            return AgentListResult(success=True, agents=agents)

        except FileNotFoundError:
            return AgentListResult(
                success=False, agents=[], error_message=self.missing_command_error()
            )
        except Exception as e:
            return AgentListResult(
                success=False, agents=[], error_message=f"Error: {str(e)}"
            )


# ------------------------------------------------------------------ #
#  Helpers                                                             #
# ------------------------------------------------------------------ #

def _encode_cwd(cwd: Path) -> str:
    """
    Reproduce Claude Code's project directory name heuristic.

    Claude stores projects under ~/.claude/projects/ using a slug derived
    from the working directory path.  The exact algorithm isn't documented,
    so we glob for the best match.

    Simple approach: replace path separators with dashes and strip leading dash.
    This may not always match exactly; callers should fall back to a full glob
    if the candidate doesn't exist.
    """
    # Convert absolute path to a filesystem-safe slug
    # e.g. /home/tom/work/myproject → -home-tom-work-myproject
    slug = str(cwd).replace("/", "-").replace("\\", "-")
    return slug


def _iso_to_ms(value: Any) -> int | None:
    """Convert ISO-8601 string or numeric timestamp to milliseconds."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except ValueError:
            pass
    return None


def _extract_session_summary(session_file: Path) -> tuple[str, str]:
    """
    Read the first user message from a JSONL file to use as the session title.
    Returns (title, updated_str).
    """
    title = f"Session {session_file.stem[:8]}"
    updated = "Unknown"

    try:
        mtime = session_file.stat().st_mtime
        from datetime import datetime
        updated = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")

        with open(session_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if entry.get("type") == "user":
                    msg = entry.get("message", {})
                    content = msg.get("content", "")
                    if isinstance(content, str) and content:
                        title = content[:80]
                        break
                    elif isinstance(content, list):
                        for block in content:
                            if block.get("type") == "text":
                                text = block.get("text", "")
                                if text:
                                    title = text[:80]
                                    break
                    if title != f"Session {session_file.stem[:8]}":
                        break
    except Exception:
        pass

    return title, updated


def _parse_agents_output(output: str) -> list[AgentInfo]:
    """
    Parse `claude agents` text output into AgentInfo objects.

    Format:
        N active agents

        Built-in agents:        ← section header (agent_type)
          name · model
          ...

        Project agents:
          name · model
    """
    agents: list[AgentInfo] = []
    current_section = "built-in"

    section_pattern = re.compile(r"^(\S.*) agents?:$", re.IGNORECASE)
    agent_row_pattern = re.compile(r"^\s{2,}(\S.*?)\s+·\s+(\S+)\s*$")

    for line in output.splitlines():
        section_match = section_pattern.match(line)
        if section_match:
            current_section = section_match.group(1).lower().rstrip()
            continue

        row_match = agent_row_pattern.match(line)
        if row_match:
            name, model = row_match.group(1).strip(), row_match.group(2).strip()
            agents.append(AgentInfo(name=name, agent_type=current_section, details=[f"model: {model}"]))

    return agents


def _discover_agents_from_claude_md(cwd: Path) -> list[AgentInfo]:
    """
    Scan CLAUDE.md in cwd for custom agent definitions.
    Returns any AgentInfo objects found.
    This is best-effort; CLAUDE.md format is freeform.
    """
    claude_md = cwd / "CLAUDE.md"
    if not claude_md.exists():
        return []

    agents: list[AgentInfo] = []
    try:
        content = claude_md.read_text(encoding="utf-8")
        # Look for headings that suggest agent definitions, e.g. "## Agent: reviewer"
        agent_pattern = re.compile(r"##\s+Agent:\s*(\S+)", re.IGNORECASE)
        for match in agent_pattern.finditer(content):
            agents.append(
                AgentInfo(
                    name=match.group(1),
                    agent_type="custom",
                    details=["Defined in CLAUDE.md"],
                )
            )
    except Exception:
        pass

    return agents


# ------------------------------------------------------------------ #
#  Smoke test                                                          #
# ------------------------------------------------------------------ #

def _smoke_test() -> None:
    """Quick interface smoke test (does NOT call the real Claude API)."""
    import sys

    cli = ClaudeCodeAgentCLI()
    cwd = Path.cwd()

    print(f"CLI name:  {cli.cli_name}")
    print(f"Exec name: {cli.main_executable_name()}")
    print(f"Cmd:       {cli.build_prompt_command('hello world')}")
    print(f"Via stdin: {cli.prompt_via_stdin()}")

    print("\n--- list_agents ---")
    agents_result = cli.list_agents(cwd)
    print(f"success={agents_result.success}, agents={[a.name for a in agents_result.agents]}")

    print("\n--- list_sessions ---")
    sessions_result = cli.list_sessions(cwd)
    print(f"success={sessions_result.success}, count={len(sessions_result.sessions)}")
    for s in sessions_result.sessions[:3]:
        print(f"  {s.session_id[:8]}... | {s.title[:40]} | {s.updated}")

    if "--run" in sys.argv:
        print("\n--- run_agent (live) ---")
        run_result = cli.run_agent("Say hello in one word.", None, None, None, cwd)
        print(f"success={run_result.success}")
        print(f"session_id={run_result.session_id}")
        print(f"response={run_result.combined_response}")


if __name__ == "__main__":
    _smoke_test()
