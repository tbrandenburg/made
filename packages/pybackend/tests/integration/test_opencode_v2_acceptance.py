"""Opt-in real OpenCode v2 persistence and resume acceptance test."""

import os
from pathlib import Path
import subprocess
import threading
import sqlite3

import pytest

from opencode_v2_agent_cli import OpenCodeV2AgentCLI


pytestmark = pytest.mark.skipif(
    os.environ.get("MADE_OPENCODE_V2_ACCEPTANCE") != "1",
    reason="requires the isolated OpenCode v2 acceptance container",
)


def test_real_v2_run_resume_and_scoped_sqlite_history(monkeypatch) -> None:
    database = Path(os.environ["OPENCODE_DB"])
    assert database.is_absolute() and database.is_relative_to(Path("/opencode-data"))
    version = subprocess.run(
        ["opencode", "--version"],
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    ).stdout.strip()
    expected_version = os.environ.get(
        "MADE_OPENCODE_V2_EXPECTED_VERSION", "opencode v2.0.18"
    )
    assert version == expected_version

    workspace = Path("/workspace/opencode-v2-acceptance")
    workspace.mkdir(parents=True, exist_ok=True)
    if not (workspace / ".git").exists():
        subprocess.run(["git", "init", "-q"], cwd=workspace, check=True, timeout=15)
    inherited_pwd = str(Path.cwd().resolve())
    assert inherited_pwd != str(workspace)
    monkeypatch.setenv("PWD", inherited_pwd)
    parent = dict(os.environ)
    cli = OpenCodeV2AgentCLI()
    initial = cli.run_agent(
        "Remember this marker exactly: MADE_V2_ACCEPTANCE_COBALT_731. Reply only: stored.",
        None,
        None,
        "opencode/big-pickle",
        workspace,
        threading.Event(),
    )
    assert initial.success
    assert initial.session_id
    assert "stored" in initial.combined_response.casefold()
    assert not [
        key
        for key in set(os.environ) | set(parent)
        if os.environ.get(key) != parent.get(key)
    ]
    with sqlite3.connect(
        f"{database.as_uri()}?mode=ro", uri=True, timeout=2
    ) as connection:
        location = connection.execute(
            "SELECT directory FROM session_v2 WHERE id = ?", (initial.session_id,)
        ).fetchone()
    assert location == (str(workspace),)
    sessions = cli.list_sessions(workspace)
    assert sessions.success
    assert initial.session_id in [session.session_id for session in sessions.sessions]

    resumed = cli.run_agent(
        "Repeat the marker from my previous message and nothing else.",
        initial.session_id,
        None,
        "opencode/big-pickle",
        workspace,
        threading.Event(),
    )
    assert resumed.success
    assert resumed.session_id == initial.session_id
    assert "MADE_V2_ACCEPTANCE_COBALT_731" in resumed.combined_response
    assert not [
        key
        for key in set(os.environ) | set(parent)
        if os.environ.get(key) != parent.get(key)
    ]

    history = cli.export_session(initial.session_id, workspace)
    assert history.success
    assert [
        message.content for message in history.messages if message.role == "user"
    ] == [
        "Remember this marker exactly: MADE_V2_ACCEPTANCE_COBALT_731. Reply only: stored.",
        "Repeat the marker from my previous message and nothing else.",
    ]
    assert all(message.role in {"user", "assistant"} for message in history.messages)
    replies = [
        message.content
        for message in history.messages
        if message.role == "assistant" and message.content_type == "text"
    ]
    assert any("stored" in reply.casefold() for reply in replies)
    assert any("MADE_V2_ACCEPTANCE_COBALT_731" in reply for reply in replies)
    other = workspace.parent / "other-v2-acceptance-repository"
    assert initial.session_id not in [
        session.session_id for session in cli.list_sessions(other).sessions
    ]
    inaccessible = cli.export_session(initial.session_id, other)
    assert not inaccessible.success and inaccessible.messages == []
    assert inaccessible.error_code == "session_directory_mismatch"
