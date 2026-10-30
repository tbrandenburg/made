"""Create a disposable legacy OpenCode transcript for the Lite browser test."""

import json
from pathlib import Path
import sqlite3
import sys


repository = Path(sys.argv[1]).resolve()
database = Path(sys.argv[2])
session_id = "ses_browser_fixture_only"
repository.joinpath(".made", "settings.json").write_text(
    json.dumps({"agentCli": "opencode"}), encoding="utf-8"
)

with sqlite3.connect(database) as connection:
    connection.executescript(
        """
        CREATE TABLE session (
            id TEXT PRIMARY KEY,
            title TEXT,
            directory TEXT,
            time_updated REAL
        );
        CREATE TABLE message (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            time_created REAL,
            time_updated REAL,
            data TEXT
        );
        CREATE TABLE part (
            id TEXT PRIMARY KEY,
            message_id TEXT,
            time_created REAL,
            time_updated REAL,
            data TEXT
        );
        """
    )
    connection.execute(
        "INSERT INTO session VALUES (?, ?, ?, ?)",
        (session_id, "Existing Lite browser fixture", str(repository), 1761000000000),
    )
    messages = (
        ("msg_lite_fixture_user", "user", "Existing fixture prompt"),
        ("msg_lite_fixture_assistant", "assistant", "LITE_EXISTING_TRANSCRIPT_MARKER"),
    )
    for sequence, (message_id, role, text) in enumerate(messages, start=1):
        timestamp = 1761000000000 + sequence
        connection.execute(
            "INSERT INTO message VALUES (?, ?, ?, ?, ?)",
            (message_id, session_id, timestamp, timestamp, json.dumps({"role": role})),
        )
        connection.execute(
            "INSERT INTO part VALUES (?, ?, ?, ?, ?)",
            (
                f"prt_lite_fixture_{sequence}",
                message_id,
                timestamp,
                timestamp,
                json.dumps({"type": "text", "text": text}),
            ),
        )
