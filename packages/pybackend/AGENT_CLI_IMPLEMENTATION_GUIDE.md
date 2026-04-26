# Agent CLI Implementation Guide

This guide explains how to implement a new `AgentCLI` for any AI coding agent. After reading this, you should be able to integrate any CLI-based agent with zero guesswork.

---

## Quick-Start Checklist

- [ ] Identify executable name (`claude`, `codex`, `kiro-cli`, …)
- [ ] Determine where sessions are stored (SQLite or files)
- [ ] Find the session file/row format (JSONL, JSON, events)
- [ ] Determine how to resume a session (`--resume`, `-s`, subcommand)
- [ ] Determine how the prompt is delivered (stdin, `--prompt`, positional arg)
- [ ] Determine the run output format (NDJSON stream, single JSON blob, plain text)
- [ ] Check whether an agent-list command exists
- [ ] Register the new class in `agent_service.py`

---

## Architecture Overview

```
agent_service.py           ← dispatcher: selects the right AgentCLI from settings
    │
    └── AgentCLI (ABC)     ← abstract contract (agent_cli.py)
            │
            ├── run_agent()        → RunResult
            ├── export_session()   → ExportResult
            ├── list_sessions()    → SessionListResult
            └── list_agents()      → AgentListResult
```

Every concrete class lives in its own file (`<name>_agent_cli.py`) and inherits from `AgentCLI`.  
All return types are defined in `agent_results.py`.

---

## Step 1 — Declare the Class

```python
# myagent_agent_cli.py
from pathlib import Path
from agent_cli import AgentCLI
from agent_results import (
    RunResult, ExportResult, SessionListResult, AgentListResult,
    ResponsePart, HistoryMessage, SessionInfo, AgentInfo,
)

class MyAgentCLI(AgentCLI):
    """AgentCLI implementation for MyAgent."""

    @classmethod
    def main_executable_name(cls) -> str:
        return "myagent"          # binary that must be on PATH

    @property
    def cli_name(self) -> str:
        return "MyAgent"          # human-readable name for error messages
```

---

## Step 2 — Implement `run_agent`

### Pattern A — stdin prompt (OpenCode, Codex, Kiro)

Used when the agent reads the user message from standard input.

```python
def run_agent(self, message, session_id, agent, model, cwd, cancel_event, on_process):
    cmd = ["myagent", "--output-format", "json"]
    if session_id:
        cmd += ["--resume", session_id]
    if model:
        cmd += ["--model", model]

    process = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=str(cwd),
    )
    if on_process:
        on_process(process)

    input_data = message.encode()
    while True:
        try:
            stdout, stderr = process.communicate(input=input_data, timeout=0.1)
            break
        except subprocess.TimeoutExpired:
            input_data = None          # only send once
            if cancel_event and cancel_event.is_set():
                process.terminate()
                return RunResult(success=False, session_id=session_id,
                                 response_parts=[], error_message="Cancelled")

    if process.returncode != 0:
        return RunResult(success=False, session_id=session_id,
                         response_parts=[], error_message=stderr.decode())

    new_session_id = self._extract_session_id(stdout.decode())
    return RunResult(success=True, session_id=new_session_id or session_id,
                     response_parts=[], error_message=None)
```

> **Why empty `response_parts`?**  
> Most agents write the full conversation to disk only after the run completes. The caller (agent_service) fetches the content via `export_session` immediately after `run_agent`. Only OB1 parses the response inline because its session files are not reliably flushed in time.

### Pattern B — positional / flag argument (Claude, Copilot, OB1)

Used when the agent does not accept stdin.

```python
cmd = ["myagent", "--print", "--output-format", "json", message]
# or: cmd = ["myagent", "-p", message]
```

Use `shlex.quote(message)` only when building a shell string; for `subprocess.Popen` with a list, no quoting is needed.

### Pattern C — inline response parsing (OB1)

Use only when the agent does not write a session file before exiting.

```python
    # parse last JSON line from stdout
    lines = [l for l in stdout.decode().splitlines() if l.strip()]
    data = json.loads(lines[-1])
    new_session_id = data.get("session_id")
    text = data.get("content", "")
    parts = [ResponsePart(text=text, timestamp=None, part_type="final")]
    return RunResult(success=True, session_id=new_session_id, response_parts=parts, ...)
```

---

## Step 3 — Implement `list_sessions`

There are two main approaches.

### Approach A — SQLite (OpenCode, Kiro)

Use this when the agent stores conversation metadata in a database.

```python
def list_sessions(self, cwd):
    db_path = self._find_database()
    if not db_path:
        return SessionListResult(success=False, sessions=[],
                                 error_message="Database not found")
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT id, title, time_updated FROM session"
            " WHERE directory = ? ORDER BY time_updated DESC LIMIT 50",
            (str(cwd.resolve()),)
        ).fetchall()
        conn.close()
        sessions = [SessionInfo(session_id=r[0], title=r[1] or r[0][:8],
                                updated=self._fmt_ts(r[2]))
                    for r in rows]
        return SessionListResult(success=True, sessions=sessions)
    except Exception as e:
        return SessionListResult(success=False, sessions=[], error_message=str(e))
```

Key points:
- Always filter by `cwd` so users only see sessions for the current project.
- Limit results (50 is a reasonable default).
- Handle timestamp scaling — agents store nanoseconds, milliseconds, or seconds inconsistently (see `opencode_database_agent_cli.py:94–114` for the heuristic).

**Timestamp scaling heuristic:**
```python
def _normalize_timestamp_to_ms(self, value: int) -> int:
    magnitude = len(str(abs(value)))
    if magnitude >= 18:   return value // 1_000_000   # nanoseconds
    if magnitude >= 15:   return value // 1_000        # microseconds
    if magnitude >= 12:   return value                 # milliseconds
    return value * 1_000                               # seconds
```

### Approach B — Filesystem glob (Claude, Codex, Copilot, OB1)

Use this when the agent writes one file per session to a well-known directory.

```python
def list_sessions(self, cwd):
    base = Path.home() / ".myagent" / "sessions"
    sessions = []
    for path in sorted(base.glob("**/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        session_id = path.stem          # or parse from first line
        title = self._read_title(path)  # first user message
        updated = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        sessions.append(SessionInfo(session_id=session_id, title=title, updated=updated))
    return SessionListResult(success=True, sessions=sessions[:50])
```

**Directory filtering for file-based sessions:**

Agents encode the working directory differently:

| Agent | Encoding | Example |
|-------|----------|---------|
| Claude | path-slug as directory name | `~/.claude/projects/-home-tom-myproject/` |
| Codex | `session_meta` event in JSONL | first line: `{"type":"session_meta","payload":{"cwd":"/home/tom/myproject"}}` |
| Copilot | `session.start` event | `{"type":"session.start","data":{"context":{"cwd":"/home/tom/myproject"}}}` |
| OB1 | project directory in path | `~/.ob1/tmp/myproject/chats/session-*.json` |

For Claude-style path slugs:
```python
def _cwd_to_slug(self, cwd: Path) -> str:
    return str(cwd.resolve()).replace("/", "-").replace("\\", "-")
```

For event-based CWD (Codex/Copilot):
```python
def _session_matches_cwd(self, path: Path, cwd: Path) -> bool:
    with path.open() as f:
        first = json.loads(f.readline())
    return first.get("payload", {}).get("cwd") == str(cwd.resolve())
```

---

## Step 4 — Implement `export_session`

The goal is to return a flat list of `HistoryMessage` objects ordered by time.

### Approach A — SQLite (OpenCode, Kiro)

```python
def export_session(self, session_id, cwd):
    conn = sqlite3.connect(self._find_database())
    rows = conn.execute(
        "SELECT m.id, m.role, m.data, p.data"
        " FROM message m LEFT JOIN part p ON m.id = p.message_id"
        " WHERE m.session_id = ? ORDER BY m.rowid, p.rowid",
        (session_id,)
    ).fetchall()
    conn.close()
    messages = []
    for msg_id, role, msg_data_raw, part_data_raw in rows:
        msg_data = json.loads(msg_data_raw) if msg_data_raw else {}
        part_data = json.loads(part_data_raw) if part_data_raw else {}
        part_type = part_data.get("type", "text")
        if part_type in ("step-start", "step-finish"):
            continue
        content = part_data.get("value", "") or msg_data.get("content", "")
        messages.append(HistoryMessage(
            message_id=msg_id, role=role, content_type=part_type,
            content=content, timestamp=None,
        ))
    return ExportResult(success=True, session_id=session_id, messages=messages)
```

### Approach B — JSONL per message (Claude)

Each line is a complete conversation turn:

```python
def export_session(self, session_id, cwd):
    path = self._find_session_file(session_id)
    messages = []
    with path.open() as f:
        for line in f:
            entry = json.loads(line)
            role = entry.get("type")   # "user" | "assistant"
            content = entry.get("message", {}).get("content", "")
            if isinstance(content, str):
                messages.append(HistoryMessage(..., content_type="text", content=content, ...))
            elif isinstance(content, list):
                for block in content:
                    ctype = "tool_use" if block.get("type") == "tool_use" else "text"
                    text = block.get("text") or json.dumps(block.get("input", {}))
                    messages.append(HistoryMessage(..., content_type=ctype, content=text, ...))
    return ExportResult(success=True, session_id=session_id, messages=messages)
```

### Approach C — JSONL event stream (Codex, Copilot)

Events are ordered and each has a typed payload:

```python
EVENT_TO_ROLE = {
    "user.message": "user",
    "assistant.message": "assistant",
    "tool.execution_start": "assistant",
}

def export_session(self, session_id, cwd):
    path = self._find_session_file(session_id)
    messages = []
    with path.open() as f:
        for line in f:
            ev = json.loads(line)
            ev_type = ev.get("type", "")
            role = EVENT_TO_ROLE.get(ev_type)
            if not role:
                continue
            content = ev.get("data", {}).get("content", "")
            ctype = "tool" if "tool" in ev_type else "text"
            messages.append(HistoryMessage(role=role, content_type=ctype, content=content, ...))
    return ExportResult(success=True, session_id=session_id, messages=messages)
```

### Approach D — Structured JSON (Kiro, OB1)

The entire conversation is stored as a single JSON document:

```python
# Kiro: {"history": [{"user": {...}, "assistant": {...}}]}
# OB1:  {"exchanges": [{"user": {"content":...}, "assistant": {"content":...}}]}

def export_session(self, session_id, cwd):
    data = json.loads(self._load_session_raw(session_id))
    messages = []
    for exchange in data.get("exchanges", []):
        user_content = exchange["user"]["content"]
        asst_content = exchange["assistant"]["content"]
        messages.append(HistoryMessage(role="user",      content_type="text", content=user_content, ...))
        messages.append(HistoryMessage(role="assistant", content_type="text", content=asst_content, ...))
    return ExportResult(success=True, session_id=session_id, messages=messages)
```

---

## Step 5 — Implement `list_agents`

### Approach A — CLI subprocess (OpenCode, Kiro, Claude)

Run `myagent agent list` and parse the output.

**Table format** (OpenCode):
```
ses_abc123   My session title   2024-01-15 10:30
```
```python
AGENT_ROW = re.compile(r"^(\S+)\s{2,}(.*?)\s{2,}(.+)$")
result = subprocess.run(["myagent", "agent", "list"], capture_output=True, text=True)
for line in result.stdout.splitlines():
    m = AGENT_ROW.match(line.strip())
    if m:
        agents.append(AgentInfo(name=m.group(1), agent_type=m.group(2), details=[m.group(3)]))
```

**Section-header format** (Claude):
```
Built-in agents:
  claude       General purpose assistant
Project agents:
  reviewer     /path/to/AGENTS.md
```
```python
current_type = "Unknown"
for line in result.stdout.splitlines():
    if line.endswith(":"):
        current_type = line.rstrip(":")
    elif line.strip():
        name, _, desc = line.strip().partition(" ")
        agents.append(AgentInfo(name=name, agent_type=current_type, details=[desc.strip()]))
```

**Bullet format** (Kiro):
```
* myagent (Built-in)
  custom-agent /path/to/agent.md
```
```python
for line in result.stdout.splitlines():
    line = line.strip()
    if line.startswith("* "):
        name = line[2:].split("(")[0].strip()
        atype = line.split("(")[1].rstrip(")") if "(" in line else "Unknown"
        agents.append(AgentInfo(name=name, agent_type=atype, details=[]))
    elif " " in line:
        name, _, path = line.partition(" ")
        agents.append(AgentInfo(name=name, agent_type="Custom", details=[path]))
```

### Approach B — Hardcoded (Codex, Copilot, OB1)

Use when the agent has no listing command:

```python
def list_agents(self, cwd):
    return AgentListResult(success=True, agents=[
        AgentInfo(name="myagent", agent_type="Built-in", details=["Default model"])
    ])
```

---

## Step 6 — Register and Test

### Register in `agent_service.py`

```python
# agent_service.py
from myagent_agent_cli import MyAgentCLI

REGISTERED_AGENT_CLI_CLASSES = (
    ...,
    MyAgentCLI,
)

def get_agent_cli(context_path=None):
    ...
    elif agent_cli_setting == "myagent":
        return MyAgentCLI()
```

### Smoke-test checklist

```bash
# 1. Is the executable found?
which myagent

# 2. Does list_agents work?
python -c "from myagent_agent_cli import MyAgentCLI; print(MyAgentCLI().list_agents(None))"

# 3. Does a session list work against a real cwd?
python -c "
from pathlib import Path
from myagent_agent_cli import MyAgentCLI
r = MyAgentCLI().list_sessions(Path('.'))
print(r.success, len(r.sessions), r.error_message)
"

# 4. Does run + export round-trip work?
python -c "
from pathlib import Path
from myagent_agent_cli import MyAgentCLI
import threading
cli = MyAgentCLI()
run = cli.run_agent('hello', None, None, None, Path('.'), threading.Event(), None)
print('run:', run.success, run.session_id)
exp = cli.export_session(run.session_id, Path('.'))
print('export:', exp.success, len(exp.messages))
"
```

---

## Decision Reference

Use these tables to quickly decide which approach fits a new agent.

### Session storage

| Signal | Use |
|--------|-----|
| Agent has a `~/.local/share/<name>/*.db` or similar | SQLite approach |
| Agent writes one file per session to `~/.agent/sessions/` | Filesystem glob |
| Agent writes dated directories `YYYY/MM/DD/` | Filesystem walk (Codex pattern) |
| Agent writes structured project dirs `~/.agent/projects/<slug>/` | Path-slug approach (Claude pattern) |

### Prompt delivery

| Signal | Use |
|--------|-----|
| `myagent --help` shows `--stdin` or prompt is omitted | stdin (Pattern A) |
| `myagent --help` shows `--prompt TEXT` or `-p TEXT` | flag argument (Pattern B) |
| `myagent --help` shows positional `<message>` | positional argument (Pattern B) |

### Session resumption

| Flag style | Example agents |
|------------|---------------|
| `-s <id>` | opencode |
| `--resume <id>` | claude, copilot, kiro, ob1 |
| `resume <id>` (subcommand) | codex (`codex exec resume <id>`) |

### Run output format

| Format | Example agents | Parsing approach |
|--------|---------------|-----------------|
| Newline-delimited JSON (NDJSON) | opencode, codex | parse each line, find session_id field |
| Single JSON object on stdout | claude, ob1 | `json.loads(stdout)` |
| Plain text / ANSI | copilot, kiro | strip ANSI, use as-is; session id from separate source |

### Agent listing

| Situation | Use |
|-----------|-----|
| `myagent agent list` / `myagent agents` works | CLI subprocess + regex |
| No listing command | Hardcoded single-item list |

---

## Environment Variable Convention

Every CLI should support an override path so tests and CI can point to fixtures:

```python
def _find_database(self) -> Path | None:
    override = os.environ.get("MYAGENT_DATABASE_PATH")
    if override:
        return Path(override)
    candidates = [
        Path.home() / ".local" / "share" / "myagent" / "data.sqlite3",
        Path.home() / ".config" / "myagent" / "db.sqlite3",
    ]
    return next((p for p in candidates if p.exists()), None)
```

---

## Error Handling

All four methods must return a typed result object even on failure — never raise.

```python
try:
    ...
    return RunResult(success=True, ...)
except FileNotFoundError:
    return RunResult(success=False, session_id=None, response_parts=[],
                     error_message=f"{self.cli_name} executable not found")
except Exception as e:
    return RunResult(success=False, session_id=None, response_parts=[],
                     error_message=f"{self.cli_name} error: {e}")
```

---

## Full Skeleton

```python
"""AgentCLI implementation for MyAgent."""
import json
import os
import subprocess
import threading
from datetime import datetime
from pathlib import Path

from agent_cli import AgentCLI
from agent_results import (
    AgentInfo, AgentListResult, ExportResult, HistoryMessage,
    ResponsePart, RunResult, SessionInfo, SessionListResult,
)


class MyAgentCLI(AgentCLI):

    @classmethod
    def main_executable_name(cls) -> str:
        return "myagent"

    @property
    def cli_name(self) -> str:
        return "MyAgent"

    def build_prompt_command(self, prompt: str) -> list[str]:
        return ["myagent", "--output-format", "json"]

    def prompt_via_stdin(self) -> bool:
        return True   # set False if prompt is a positional arg

    # ------------------------------------------------------------------
    def run_agent(
        self, message, session_id, agent, model, cwd, cancel_event, on_process
    ) -> RunResult:
        cmd = self.build_prompt_command(message)
        if session_id:
            cmd += ["--resume", session_id]
        if model:
            cmd += ["--model", model]
        if agent:
            cmd += ["--agent", agent]

        try:
            process = subprocess.Popen(
                cmd, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                cwd=str(cwd),
            )
        except FileNotFoundError:
            return RunResult(success=False, session_id=session_id,
                             response_parts=[], error_message=f"{self.cli_name} not found")
        if on_process:
            on_process(process)

        input_data: bytes | None = message.encode() if self.prompt_via_stdin() else None
        while True:
            try:
                stdout, stderr = process.communicate(input=input_data, timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                input_data = None
                if cancel_event and cancel_event.is_set():
                    process.terminate()
                    return RunResult(success=False, session_id=session_id,
                                     response_parts=[], error_message="Cancelled")

        if process.returncode != 0:
            return RunResult(success=False, session_id=session_id,
                             response_parts=[], error_message=stderr.decode())

        new_session_id = self._extract_session_id(stdout.decode())
        return RunResult(success=True, session_id=new_session_id or session_id,
                         response_parts=[], error_message=None)

    def _extract_session_id(self, output: str) -> str | None:
        for line in output.splitlines():
            try:
                data = json.loads(line)
                sid = data.get("sessionID") or data.get("session_id") or data.get("id")
                if sid:
                    return sid
            except json.JSONDecodeError:
                pass
        return None

    # ------------------------------------------------------------------
    def export_session(self, session_id, cwd) -> ExportResult:
        path = self._find_session_file(session_id)
        if not path:
            return ExportResult(success=False, session_id=session_id,
                                messages=[], error_message="Session file not found")
        try:
            messages = self._parse_session_file(path)
            return ExportResult(success=True, session_id=session_id, messages=messages)
        except Exception as e:
            return ExportResult(success=False, session_id=session_id,
                                messages=[], error_message=str(e))

    def _find_session_file(self, session_id: str) -> Path | None:
        base = Path.home() / ".myagent" / "sessions"
        for p in base.glob(f"**/*{session_id}*"):
            return p
        return None

    def _parse_session_file(self, path: Path) -> list[HistoryMessage]:
        messages: list[HistoryMessage] = []
        with path.open() as f:
            for line in f:
                entry = json.loads(line)
                role = entry.get("role", "assistant")
                content = entry.get("content", "")
                if not content:
                    continue
                messages.append(HistoryMessage(
                    message_id=entry.get("id"),
                    role=role,
                    content_type="text",
                    content=content,
                    timestamp=None,
                ))
        return messages

    # ------------------------------------------------------------------
    def list_sessions(self, cwd) -> SessionListResult:
        base = Path.home() / ".myagent" / "sessions"
        if not base.exists():
            return SessionListResult(success=True, sessions=[])
        try:
            sessions: list[SessionInfo] = []
            for path in sorted(base.glob("**/*.jsonl"),
                               key=lambda p: p.stat().st_mtime, reverse=True)[:50]:
                session_id = path.stem
                title = self._read_title(path) or session_id[:8]
                updated = datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
                sessions.append(SessionInfo(session_id=session_id, title=title, updated=updated))
            return SessionListResult(success=True, sessions=sessions)
        except Exception as e:
            return SessionListResult(success=False, sessions=[], error_message=str(e))

    def _read_title(self, path: Path) -> str:
        try:
            with path.open() as f:
                first = json.loads(f.readline())
            return (first.get("content") or "")[:60]
        except Exception:
            return ""

    # ------------------------------------------------------------------
    def list_agents(self, cwd) -> AgentListResult:
        try:
            result = subprocess.run(
                ["myagent", "agent", "list"],
                capture_output=True, text=True, timeout=10,
            )
            agents = self._parse_agent_list(result.stdout)
            return AgentListResult(success=True, agents=agents)
        except FileNotFoundError:
            return AgentListResult(success=False, agents=[],
                                   error_message=f"{self.cli_name} not found")
        except Exception as e:
            return AgentListResult(success=False, agents=[], error_message=str(e))

    def _parse_agent_list(self, output: str) -> list[AgentInfo]:
        agents: list[AgentInfo] = []
        for line in output.splitlines():
            line = line.strip()
            if not line or line.endswith(":"):
                continue
            name, _, rest = line.partition(" ")
            agents.append(AgentInfo(name=name, agent_type="Built-in", details=[rest.strip()]))
        return agents or [AgentInfo(name="myagent", agent_type="Built-in", details=[])]
```

---

## Reference: Existing Implementations

| File | Agent | Session storage | Prompt delivery | Agent listing |
|------|-------|----------------|-----------------|---------------|
| `opencode_database_agent_cli.py` | OpenCode | SQLite `~/.local/share/opencode/opencode.db` | stdin | CLI subprocess |
| `claude_agent_cli.py` | Claude Code | JSONL `~/.claude/projects/<slug>/<id>.jsonl` | positional arg | `claude agents` |
| `codex_agent_cli.py` | Codex | JSONL `~/.codex/sessions/YYYY/MM/DD/rollout-<id>.jsonl` | stdin | hardcoded |
| `copilot_agent_cli.py` | GitHub Copilot | Events JSONL `~/.copilot/session-state/<id>/events.jsonl` | `-p` flag | hardcoded |
| `kiro_agent_cli.py` | Kiro | SQLite `~/.local/share/kiro-cli/data.sqlite3` | stdin | `kiro-cli agent list` |
| `ob1_agent_cli.py` | OB1 | JSON `~/.ob1/tmp/<project>/chats/session-*.json` | `--prompt` flag | hardcoded |
