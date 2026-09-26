"""Opt-in real OpenCode v2 persistence and resume acceptance test."""

import os
from pathlib import Path
import subprocess
import threading

import pytest

from opencode_v2_agent_cli import OpenCodeV2AgentCLI


pytestmark = pytest.mark.skipif(
    os.environ.get("MADE_OPENCODE_V2_ACCEPTANCE") != "1",
    reason="requires the isolated OpenCode v2 acceptance container",
)


def test_real_v2_run_resume_and_scoped_sqlite_history() -> None:
    database = Path(os.environ["OPENCODE_DB"])
    assert database.is_absolute() and database.is_relative_to(Path("/opencode-data"))
    version = subprocess.run(
        ["opencode", "--version"], capture_output=True, text=True, check=True
    ).stdout
    assert "2.0.18" in version

    workspace = Path("/workspace/opencode-v2-acceptance")
    workspace.mkdir(parents=True, exist_ok=True)
    if not (workspace / ".git").exists():
        subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)
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

    history = cli.export_session(initial.session_id, workspace)
    assert history.success
    assert [
        message.content for message in history.messages if message.role == "user"
    ] == [
        "Remember this marker exactly: MADE_V2_ACCEPTANCE_COBALT_731. Reply only: stored.",
        "Repeat the marker from my previous message and nothing else.",
    ]
    assert all(message.role in {"user", "assistant"} for message in history.messages)
