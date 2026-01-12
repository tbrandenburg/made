from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from typing import Any


class AgentCLI(ABC):
    @property
    @abstractmethod
    def cli_name(self) -> str:
        raise NotImplementedError

    def missing_command_error(self) -> str:
        return (
            f"Error: '{self.cli_name}' command not found. "
            "Please ensure it is installed and in PATH."
        )

    @abstractmethod
    def build_run_command(self, session_id: str | None, agent: str | None) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    def start_run(self, command: list[str], cwd: Path) -> subprocess.Popen:
        raise NotImplementedError

    @abstractmethod
    def export_session(
        self, session_id: str, cwd: Path | None, stdout
    ) -> subprocess.CompletedProcess:
        raise NotImplementedError

    @abstractmethod
    def list_sessions(self, cwd: Path | None) -> subprocess.CompletedProcess:
        raise NotImplementedError

    @abstractmethod
    def list_agents(self) -> subprocess.CompletedProcess:
        raise NotImplementedError


class OpenCodeAgentCLI(AgentCLI):
    @property
    def cli_name(self) -> str:
        return "opencode"

    def build_run_command(self, session_id: str | None, agent: str | None) -> list[str]:
        command = ["opencode", "run"]
        if session_id:
            command.extend(["-s", session_id])
        if agent:
            command.extend(["--agent", agent])
        command.extend(["--format", "json"])
        return command

    def start_run(self, command: list[str], cwd: Path) -> subprocess.Popen:
        return subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
        )

    def export_session(
        self, session_id: str, cwd: Path | None, stdout
    ) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["opencode", "export", session_id],
            stdout=stdout,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
        )

    def list_sessions(self, cwd: Path | None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["opencode", "session", "list"],
            capture_output=True,
            text=True,
            cwd=cwd,
        )

    def list_agents(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["opencode", "agent", "list"],
            capture_output=True,
            text=True,
        )


class KiroAgentCLI(AgentCLI):
    @property
    def cli_name(self) -> str:
        return "kiro-cli"

    def build_run_command(self, session_id: str | None, agent: str | None) -> list[str]:
        command = ["kiro-cli", "chat", "--no-interactive", "--trust-all-tools"]
        if session_id:
            command.append("--resume")
        if agent:
            command.extend(["--agent", agent])
        return command

    def start_run(self, command: list[str], cwd: Path) -> subprocess.Popen:
        return subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
        )

    def export_session(
        self, session_id: str, cwd: Path | None, stdout
    ) -> subprocess.CompletedProcess:
        db_path = self._find_database_path()
        if db_path is None:
            return subprocess.CompletedProcess(
                args=["kiro-cli", "chat", "--resume"],
                returncode=1,
                stdout="",
                stderr="Kiro CLI database not found for export.",
            )

        export_payload = self._export_conversation(db_path, session_id, cwd)
        if export_payload is None:
            return subprocess.CompletedProcess(
                args=["kiro-cli", "chat", "--resume"],
                returncode=1,
                stdout="",
                stderr="Unable to locate Kiro conversation export data.",
            )

        json.dump(export_payload, stdout)
        stdout.write("\n")
        return subprocess.CompletedProcess(
            args=["kiro-cli", "chat", "--resume"],
            returncode=0,
            stdout="",
            stderr="",
        )

    def list_sessions(self, cwd: Path | None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["kiro-cli", "chat", "--list-sessions"],
            capture_output=True,
            text=True,
            cwd=cwd,
        )

    def list_agents(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["kiro-cli", "agent", "list"],
            capture_output=True,
            text=True,
        )

    def _find_database_path(self) -> Path | None:
        configured = os.environ.get("KIRO_DATABASE_PATH")
        if configured:
            path = Path(configured).expanduser()
            if path.exists():
                return path

        candidates = [
            Path.home() / ".local" / "share" / "kiro-cli" / "data.sqlite3",
            Path.home() / ".local" / "share" / "kiro" / "data.sqlite3",
            Path.home() / ".config" / "kiro" / "data.sqlite3",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return None

    def _export_conversation(
        self, db_path: Path, session_id: str, cwd: Path | None
    ) -> dict[str, Any] | None:
        connection = sqlite3.connect(db_path)
        try:
            cursor = connection.cursor()
            key = str((cwd or Path.cwd()).resolve())
            cursor.execute(
                "SELECT value FROM conversations_v2 WHERE key = ? AND conversation_id = ?",
                (key, session_id),
            )
            row = cursor.fetchone()
            if not row:
                return None
            value = json.loads(row[0])
        finally:
            connection.close()

        history = value.get("history") or []
        messages: list[dict[str, Any]] = []

        for index, exchange in enumerate(history):
            user_message = exchange.get("user") or {}
            assistant_message = exchange.get("assistant") or {}
            messages.extend(self._convert_user_message(user_message, session_id, index))
            messages.extend(
                self._convert_assistant_message(assistant_message, session_id, index)
            )

        return {"messages": messages}

    def _convert_user_message(
        self, user_message: dict[str, Any], session_id: str, index: int
    ) -> list[dict[str, Any]]:
        content = user_message.get("content") or {}
        prompt = ""
        if isinstance(content, dict):
            prompt_block = content.get("Prompt")
            if isinstance(prompt_block, dict):
                prompt = str(prompt_block.get("prompt") or "")
        timestamp_ms = self._parse_iso_timestamp_ms(user_message.get("timestamp"))
        message_id = f"{session_id}-user-{index}"
        return [
            {
                "info": {
                    "id": message_id,
                    "role": "user",
                    "time": {"created": timestamp_ms} if timestamp_ms else {},
                },
                "parts": [
                    {
                        "type": "text",
                        "text": prompt,
                        "timestamp": timestamp_ms,
                    }
                ],
            }
        ]

    def _convert_assistant_message(
        self, assistant_message: dict[str, Any], session_id: str, index: int
    ) -> list[dict[str, Any]]:
        response = assistant_message.get("Response")
        tool_use = assistant_message.get("ToolUse")
        parts: list[dict[str, Any]] = []

        if isinstance(response, dict):
            text = str(response.get("content") or "")
            parts.append({"type": "text", "text": text})

        if isinstance(tool_use, dict):
            tool_uses = tool_use.get("tool_uses") or []
            for tool_entry in tool_uses:
                if not isinstance(tool_entry, dict):
                    continue
                tool_name = tool_entry.get("name") or tool_entry.get("tool")
                if tool_name:
                    parts.append({"type": "tool_use", "tool": str(tool_name)})

        if not parts:
            return []

        message_id = f"{session_id}-assistant-{index}"
        return [
            {
                "info": {"id": message_id, "role": "assistant", "time": {}},
                "parts": parts,
            }
        ]

    def _parse_iso_timestamp_ms(self, timestamp: object) -> int | None:
        if not isinstance(timestamp, str):
            return None
        normalized = timestamp.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
            return int(parsed.timestamp() * 1000)
        except ValueError:
            return None


def get_agent_cli() -> AgentCLI:
    cli_choice = os.environ.get("MADE_AGENT_CLI", "opencode").strip().lower()
    if cli_choice == "kiro":
        return KiroAgentCLI()
    return OpenCodeAgentCLI()
