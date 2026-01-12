from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
import subprocess


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
