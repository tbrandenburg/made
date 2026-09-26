"""OpenCode v2 CLI adapter with read-only access to its indexed SQLite history."""

from __future__ import annotations

from datetime import datetime
from contextlib import closing
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from threading import Event
from typing import Callable

import frontmatter

from agent_cli import AgentCLI
from agent_results import (
    AgentInfo,
    AgentListResult,
    ExportResult,
    HistoryMessage,
    RunResult,
    ResponsePart,
    SessionInfo,
    SessionListResult,
)


def _strip_json_comments(text: str) -> str:
    result: list[str] = []
    in_string = False
    escaped = False
    index = 0
    while index < len(text):
        char = text[index]
        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            result.append(char)
            index += 1
            continue
        if char == "/" and index + 1 < len(text) and text[index + 1] == "/":
            index += 2
            while index < len(text) and text[index] not in "\r\n":
                index += 1
            continue
        if char == "/" and index + 1 < len(text) and text[index + 1] == "*":
            end = text.find("*/", index + 2)
            if end == -1:
                raise ValueError("Unterminated JSONC comment")
            index = end + 2
            continue
        result.append(char)
        index += 1
    return "".join(result)


class OpenCodeV2AgentCLI(AgentCLI):
    """Adapter for v2 CLI execution and v2 session database history."""

    @classmethod
    def main_executable_name(cls) -> str:
        return "opencode"

    @property
    def cli_name(self) -> str:
        return "opencode-v2"

    def build_prompt_command(self, prompt: str) -> list[str]:
        _ = prompt
        return ["opencode", "run", "--format", "json"]

    def prompt_via_stdin(self) -> bool:
        return True

    def _database_path(self) -> Path:
        override = os.environ.get("OPENCODE_DB")
        if override == ":memory:":
            raise ValueError("OpenCode v2 in-memory database is not readable")
        if override:
            path = Path(override).expanduser()
            if path.is_absolute():
                return path
        result = subprocess.run(
            ["opencode", "debug", "paths", "db"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode:
            raise RuntimeError(
                (result.stderr or "Could not resolve OpenCode database path").strip()
            )
        path = Path(result.stdout.strip()).expanduser()
        if not path.is_absolute():
            raise ValueError("OpenCode returned a non-absolute database path")
        return path

    def _connect(self) -> sqlite3.Connection:
        path = self._database_path()
        if not path.is_file():
            raise FileNotFoundError(f"OpenCode v2 database not found: {path}")
        connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=2)
        connection.execute("PRAGMA busy_timeout = 2000")
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        required = {"session_v2", "session_message"}
        if not required.issubset(tables):
            connection.close()
            raise RuntimeError(
                "Unsupported OpenCode database schema: expected session_v2 and session_message"
            )
        session_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(session_v2)")
        }
        message_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(session_message)")
        }
        if not {
            "id",
            "title",
            "directory",
            "project_id",
            "parent_id",
            "time_updated",
        }.issubset(session_columns) or not {
            "id",
            "session_id",
            "type",
            "seq",
            "time_created",
            "data",
        }.issubset(message_columns):
            connection.close()
            raise RuntimeError(
                "Unsupported OpenCode database schema: required v2 columns are missing"
            )
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _timestamp(value: object) -> int | None:
        if isinstance(value, dict):
            value = value.get("created")
        try:
            number = float(value)  # v2 epoch timestamps are milliseconds
            return int(number)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _format_timestamp(value: object) -> str:
        try:
            return datetime.fromtimestamp(float(value) / 1000).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        except (TypeError, ValueError, OverflowError, OSError):
            return "Unknown"

    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        try:
            directory = str(cwd.resolve()) if cwd else None
            with closing(self._connect()) as connection:
                query = "SELECT s.id, s.title, s.time_updated FROM session_v2 s WHERE s.parent_id IS NULL AND EXISTS (SELECT 1 FROM session_message m WHERE m.session_id=s.id AND m.type='user')"
                parameters: tuple[object, ...] = ()
                if directory is not None:
                    query += " AND s.directory = ?"
                    parameters = (directory,)
                query += " ORDER BY s.time_updated DESC LIMIT 50"
                sessions = [
                    SessionInfo(
                        row["id"],
                        row["title"] or f"Session {row['id'][:8]}",
                        self._format_timestamp(row["time_updated"]),
                    )
                    for row in connection.execute(query, parameters)
                ]
            return SessionListResult(success=True, sessions=sessions)
        except Exception as error:
            return SessionListResult(
                success=False, sessions=[], error_message=f"Error: {error}"
            )

    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        try:
            with closing(self._connect()) as connection:
                query = "SELECT id, directory FROM session_v2 WHERE id = ? AND parent_id IS NULL"
                session = connection.execute(query, (session_id,)).fetchone()
                if session is None or (
                    cwd and session["directory"] != str(cwd.resolve())
                ):
                    return ExportResult(
                        False,
                        session_id,
                        [],
                        f"Session {session_id} not found in requested directory",
                    )
                rows = connection.execute(
                    "SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq ASC",
                    (session_id,),
                ).fetchall()
            messages: list[HistoryMessage] = []
            for row in rows:
                try:
                    data = json.loads(row["data"])
                except (TypeError, json.JSONDecodeError):
                    continue
                role = row["type"]
                if role not in {"user", "assistant"}:
                    continue
                content = data.get("content")
                if role == "user":
                    user_text = str(data.get("text") or "")
                    if user_text:
                        messages.append(
                            HistoryMessage(
                                row["id"],
                                role,
                                "text",
                                user_text,
                                self._timestamp(
                                    (data.get("time") or {}).get(
                                        "created", row["time_created"]
                                    )
                                ),
                            )
                        )
                    continue
                if not isinstance(content, list):
                    continue
                for index, part in enumerate(content):
                    if not isinstance(part, dict):
                        continue
                    kind = part.get("type")
                    if kind in {"text", "reasoning"}:
                        text = str(part.get("text") or "")
                        content_type = "text" if kind == "text" else "reasoning"
                    elif kind == "tool":
                        text = str(part.get("tool") or part.get("name") or "Tool")
                        content_type = "tool_use"
                    else:
                        continue
                    if text:
                        messages.append(
                            HistoryMessage(
                                f"{row['id']}:{index}",
                                role,
                                content_type,
                                text,
                                self._timestamp(
                                    part.get("time")
                                    or (data.get("time") or {}).get(
                                        "created", row["time_created"]
                                    )
                                ),
                                str(part.get("partID")) if part.get("partID") else None,
                                str(part.get("id"))
                                if kind == "tool" and part.get("id")
                                else None,
                            )
                        )
            return ExportResult(True, session_id, messages)
        except Exception as error:
            return ExportResult(False, session_id, [], f"Error: {error}")

    def list_agents(self, cwd: Path | None = None) -> AgentListResult:
        definitions = {
            name: {"mode": mode}
            for name, mode in (
                ("build", "primary"),
                ("plan", "primary"),
                ("general", "subagent"),
                ("explore", "subagent"),
            )
        }
        for path in self._agent_config_paths(cwd):
            try:
                config = self._load_jsonc(path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            agents = config.get("agents")
            if isinstance(agents, dict):
                definitions.update(
                    (name, value)
                    for name, value in agents.items()
                    if isinstance(name, str) and isinstance(value, dict)
                )

        for name, path in self._agent_markdown_paths(cwd):
            try:
                definition = frontmatter.load(path).metadata
            except (OSError, ValueError):
                continue
            definitions[name] = definition

        return AgentListResult(
            True,
            [
                AgentInfo(
                    name,
                    str(definition.get("mode") or "primary"),
                    [str(definition["description"])]
                    if definition.get("description")
                    else [],
                )
                for name, definition in definitions.items()
                if not definition.get("hidden") and not definition.get("disabled")
            ],
        )

    @staticmethod
    def _load_jsonc(path: Path) -> dict[str, object]:
        text = path.read_text(encoding="utf-8")
        text = re.sub(r",\s*([}\]])", r"\1", _strip_json_comments(text))
        value = json.loads(text)
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _agent_config_paths(cwd: Path | None) -> list[Path]:
        paths: list[Path] = []
        config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        for name in ("opencode.json", "opencode.jsonc"):
            paths.append(config_home / "opencode" / name)

        if cwd is None:
            return paths
        project_root = OpenCodeV2AgentCLI._project_root(cwd)
        for directory in (project_root, project_root / ".opencode"):
            for name in ("opencode.json", "opencode.jsonc"):
                paths.append(directory / name)
        return paths

    @staticmethod
    def _project_root(cwd: Path) -> Path:
        current = cwd.resolve()
        for directory in (current, *current.parents):
            if (directory / ".git").exists():
                return directory
        return current

    @staticmethod
    def _agent_markdown_paths(cwd: Path | None) -> list[tuple[str, Path]]:
        config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        roots = [config_home / "opencode" / "agents"]
        if cwd is not None:
            current = cwd.resolve()
            project_root = OpenCodeV2AgentCLI._project_root(current)
            ancestors = []
            for directory in (current, *current.parents):
                ancestors.append(directory)
                if directory == project_root:
                    break
            project_roots: list[Path] = []
            for directory in ancestors:
                project_roots.append(directory / ".opencode" / "agents")
                if directory == project_root:
                    break
            roots.extend(reversed(project_roots))
        files: list[tuple[str, Path]] = []
        for root in roots:
            if not root.is_dir():
                continue
            files.extend(
                (path.relative_to(root).with_suffix("").as_posix(), path)
                for path in root.rglob("*.md")
            )
        return files

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
        command = ["opencode", "run", "--format", "json"]
        if session_id:
            command.extend(["--session", session_id])
        if agent:
            command.extend(["--agent", agent])
        if model:
            command.extend(["--model", model])
        if cancel_event and cancel_event.is_set():
            return RunResult(False, session_id, [], "Agent request cancelled.")
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=cwd,
            )
            if on_process:
                on_process(process)
            input_data: str | None = message
            while True:
                try:
                    stdout, stderr = process.communicate(
                        input=input_data, timeout=0.1 if cancel_event else None
                    )
                    break
                except subprocess.TimeoutExpired:
                    input_data = None
                    if cancel_event and cancel_event.is_set():
                        process.terminate()
                        try:
                            stdout, stderr = process.communicate(timeout=1)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            stdout, stderr = process.communicate()
                        return RunResult(
                            False, session_id, [], "Agent request cancelled."
                        )
            if process.returncode:
                return RunResult(
                    False,
                    session_id,
                    [],
                    (stderr or "Command failed with no output").strip(),
                )
            extracted_id, parts = self._parse_v2_events(stdout or "")
            if not extracted_id:
                return RunResult(
                    False, session_id, [], "OpenCode v2 returned no session ID."
                )
            if not parts:
                return RunResult(
                    False, extracted_id, [], "OpenCode v2 returned no response parts."
                )
            return RunResult(True, extracted_id, parts)
        except FileNotFoundError:
            return RunResult(False, session_id, [], self.missing_command_error())
        except Exception as error:
            return RunResult(False, session_id, [], f"Error: {error}")

    def _parse_v2_events(self, stdout: str) -> tuple[str | None, list[ResponsePart]]:
        session_id = None
        events: list[tuple[str, str, object, str | None, str | None]] = []
        for line in stdout.splitlines():
            try:
                payload = json.loads(line)
            except (json.JSONDecodeError, TypeError):
                continue
            if payload.get("sessionID"):
                session_id = str(payload["sessionID"])
            part = payload.get("part") or {}
            kind = payload.get("type") or part.get("type")
            part_id = part.get("partID")
            call_id = part.get("id") if kind in {"tool", "tool_use"} else None
            text = str(part.get("text") or "")
            if kind in {"text", "reasoning"} and text:
                events.append(
                    (
                        kind,
                        text,
                        payload.get("timestamp") or part.get("time"),
                        str(part_id) if part_id else None,
                        str(call_id) if call_id else None,
                    )
                )
            elif kind in {"tool", "tool_use"}:
                name = str(
                    part.get("tool") or part.get("name") or part.get("id") or "Tool"
                )
                events.append(
                    (
                        "tool",
                        name,
                        payload.get("timestamp") or part.get("time"),
                        str(part_id) if part_id else None,
                        str(call_id) if call_id else None,
                    )
                )
        text_indexes = [i for i, event in enumerate(events) if event[0] == "text"]
        parts: list[ResponsePart] = []
        for i, (kind, text, timestamp, part_id, call_id) in enumerate(events):
            part_type = (
                "tool"
                if kind == "tool"
                else "final"
                if kind == "text" and i == text_indexes[-1]
                else "thinking"
            )
            parts.append(
                self._response_part(text, timestamp, part_type, part_id, call_id)
            )
        return session_id, parts

    @staticmethod
    def _response_part(
        text: str,
        timestamp: object,
        part_type: str,
        part_id: str | None,
        call_id: str | None,
    ) -> ResponsePart:
        milliseconds = OpenCodeV2AgentCLI._timestamp(timestamp)
        return ResponsePart(text, milliseconds, part_type, part_id, call_id)
