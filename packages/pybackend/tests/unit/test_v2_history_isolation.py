"""Exercise scoped history through the real v2 adapter, service, and HTTP routes."""

import json
import sqlite3

from fastapi.testclient import TestClient
import pytest

import agent_service
from app import app


# Relevant v2 DDL from OpenCode's real schema, including required/default columns.
SCHEMA = """
CREATE TABLE project (
    id TEXT PRIMARY KEY, worktree TEXT NOT NULL, vcs TEXT, name TEXT,
    icon_url TEXT, icon_color TEXT, time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL, time_initialized INTEGER, sandboxes TEXT NOT NULL
);
CREATE TABLE session_v2 (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT, parent_id TEXT,
    fork_session_id TEXT, fork_boundary TEXT, slug TEXT NOT NULL,
    directory TEXT NOT NULL, path TEXT, title TEXT, version TEXT NOT NULL,
    share_url TEXT, summary_additions INTEGER, summary_deletions INTEGER,
    summary_files INTEGER, summary_diffs TEXT, metadata TEXT,
    cost REAL DEFAULT 0 NOT NULL, tokens_input INTEGER DEFAULT 0 NOT NULL,
    tokens_output INTEGER DEFAULT 0 NOT NULL, tokens_reasoning INTEGER DEFAULT 0 NOT NULL,
    tokens_cache_read INTEGER DEFAULT 0 NOT NULL, tokens_cache_write INTEGER DEFAULT 0 NOT NULL,
    revert TEXT, permission TEXT, agent TEXT, model TEXT,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
    time_compacting INTEGER, time_archived INTEGER, time_suspended INTEGER,
    resume_attempts INTEGER DEFAULT 0 NOT NULL, time_idle INTEGER, time_viewed INTEGER,
    idle_outcome TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE TABLE session_message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
);
CREATE INDEX session_message_session_seq_idx ON session_message(session_id, seq);
"""


@pytest.fixture
def history_store(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    repository = workspace / "repository"
    repository.mkdir(parents=True)
    made = tmp_path / "home" / ".made"
    for name in ("knowledge", "constitutions", "tasks"):
        (made / name).mkdir(parents=True)
    foreign = tmp_path / "private foreign directory"
    database = tmp_path / "opencode.db"
    with sqlite3.connect(database) as connection:
        connection.executescript(SCHEMA)
        connection.execute(
            "INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (?, ?, 1, 1, '[]')",
            ("project", str(workspace)),
        )
        for session, directory in (
            ("ses_local", repository),
            ("ses_foreign", foreign),
            ("ses_empty", repository),
        ):
            connection.execute(
                "INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, 'project', ?, ?, ?, '2.0.28', 1, 2)",
                (session, session, str(directory), session),
            )
        for session in ("ses_local", "ses_foreign"):
            # Insert out of order so the real query must order by seq, not insertion.
            for seq, role, data in (
                (
                    2,
                    "assistant",
                    {"content": [{"type": "text", "text": f"{session} answer"}]},
                ),
                (1, "user", {"text": f"{session} question", "time": {"created": 1}}),
            ):
                connection.execute(
                    "INSERT INTO session_message VALUES (?, ?, ?, ?, 1, 2, ?)",
                    (f"{session}_{seq}", session, role, seq, json.dumps(data)),
                )
    monkeypatch.setenv("OPENCODE_DB", str(database))
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(workspace))
    monkeypatch.setenv("MADE_HOME", str(made.parent))
    (made / "settings.json").write_text(
        json.dumps({"agentCli": "opencode-v2"}), encoding="utf-8"
    )
    return repository, foreign


def test_export_chat_history_v2_mismatch_is_typed_and_local_empty_is_preserved(
    history_store,
):
    repository, foreign = history_store
    cli = agent_service.get_agent_cli(repository)
    assert [
        session.session_id for session in cli.list_sessions(repository).sessions
    ] == ["ses_local"]
    mismatch = cli.export_session("ses_foreign", repository)
    assert not mismatch.success and mismatch.messages == []
    assert getattr(mismatch, "error_code", None) == "session_directory_mismatch"
    with pytest.raises(agent_service.SessionDirectoryMismatchError) as failure:
        agent_service.export_chat_history("ses_foreign", channel="repository")
    assert str(foreign) not in str(failure.value)
    assert "Start a new session" in str(failure.value)
    history = agent_service.export_chat_history("ses_local", channel="repository")
    assert [message["content"] for message in history["messages"]] == [
        "ses_local question",
        "ses_local answer",
    ]
    assert agent_service.export_chat_history("ses_empty")["messages"] == []
    assert agent_service.export_chat_history("ses_absent")["messages"] == []


@pytest.mark.parametrize(
    "route",
    [
        "repositories/repository",
        "knowledge/notes/item.md",
        "constitutions/policy.md",
        "tasks/daily.md",
    ],
)
def test_history_routes_return_safe_409_for_v2_directory_mismatch(history_store, route):
    _, foreign = history_store
    response = TestClient(app).get(
        f"/api/{route}/agent/history", params={"session_id": "ses_foreign"}
    )
    assert response.status_code == 409
    assert response.json() == {
        "detail": {
            "code": "session_directory_mismatch",
            "message": "This session belongs to a different directory and cannot be loaded here. Start a new session, or ask an operator to verify its intended location before recovery.",
        }
    }
    assert str(foreign) not in response.text
    assert "ses_foreign question" not in response.text
    assert "ses_foreign answer" not in response.text
