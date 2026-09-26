"""Behavioral tests for the OpenCode v2 adapter and v2 SQLite layout."""

import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from opencode_v2_agent_cli import OpenCodeV2AgentCLI


class TestOpenCodeV2AgentCLI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "opencode.db"
        connection = sqlite3.connect(self.database)
        connection.executescript("""
            CREATE TABLE session_v2 (
                id TEXT PRIMARY KEY, project_id TEXT, directory TEXT, parent_id TEXT,
                title TEXT, time_updated INTEGER
            );
            CREATE TABLE session_message (
                id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
                time_created INTEGER, data TEXT
            );
            CREATE INDEX session_message_session_seq_idx ON session_message(session_id, seq);
        """)
        directory = str((self.root / "repo").resolve())
        other = str((self.root / "other").resolve())
        connection.execute(
            "INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?)",
            ("ses_a", "proj", directory, None, "A", 2000),
        )
        connection.execute(
            "INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?)",
            ("ses_b", "proj", other, None, "B", 3000),
        )
        connection.execute(
            "INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?)",
            ("ses_empty", "proj", directory, None, "Empty", 4000),
        )
        connection.execute(
            "INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?)",
            ("ses_child", "proj", directory, "ses_a", "Child", 5000),
        )
        connection.execute(
            "INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)",
            (
                "msg_user",
                "ses_a",
                "user",
                1,
                1000,
                json.dumps({"time": {"created": 1000}, "text": "question"}),
            ),
        )
        connection.execute(
            "INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)",
            (
                "msg_child_user",
                "ses_child",
                "user",
                1,
                1000,
                json.dumps({"time": {"created": 1000}, "text": "child question"}),
            ),
        )
        connection.execute(
            "INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)",
            (
                "msg_assistant",
                "ses_a",
                "assistant",
                2,
                2000,
                json.dumps(
                    {
                        "content": [
                            {"type": "text", "text": "answer", "partID": "prt_text"},
                            {
                                "type": "reasoning",
                                "text": "thinking",
                                "time": {"created": 1500, "completed": 1600},
                            },
                            {
                                "type": "tool",
                                "id": "call_tool",
                                "partID": "prt_tool",
                                "tool": "read",
                            },
                        ],
                    }
                ),
            ),
        )
        connection.commit()
        connection.close()
        self.cli = OpenCodeV2AgentCLI()

    def test_history_is_index_ordered_scoped_and_maps_v2_part_ids(self):
        with patch.dict("os.environ", {"OPENCODE_DB": str(self.database)}):
            sessions = self.cli.list_sessions(self.root / "repo")
            history = self.cli.export_session("ses_a", self.root / "repo")
            wrong_scope = self.cli.export_session("ses_b", self.root / "repo")
        self.assertEqual([item.session_id for item in sessions.sessions], ["ses_a"])
        self.assertEqual(
            [message.content for message in history.messages],
            ["question", "answer", "thinking", "read"],
        )
        self.assertEqual(history.messages[1].part_id, "prt_text")
        self.assertEqual(history.messages[2].timestamp, 1500)
        self.assertEqual(history.messages[3].call_id, "call_tool")
        self.assertFalse(wrong_scope.success)

    def test_agent_listing_discovers_jsonc_and_nested_markdown_and_hides_disabled(self):
        config_home = self.root / "config"
        global_config = config_home / "opencode" / "opencode.jsonc"
        global_config.parent.mkdir(parents=True)
        global_config.write_text(
            '{"agents": {"build": {"description": "Global build"}, "global-agent": {"mode": "subagent", "description": "Global"}}}',
            encoding="utf-8",
        )
        repo = self.root / "repo"
        (repo / ".git").mkdir(parents=True)
        project_config = repo / ".opencode" / "opencode.jsonc"
        project_config.parent.mkdir()
        project_config.write_text(
            '{\n // project override\n "agents": {"build": {"description": "Project build"}, "hidden-agent": {"hidden": true}}\n}',
            encoding="utf-8",
        )
        nested_agent = repo / ".opencode" / "agents" / "team" / "reviewer.md"
        nested_agent.parent.mkdir(parents=True)
        nested_agent.write_text(
            "---\ndescription: Reviews changes\nmode: subagent\n---\nReview changes.\n",
            encoding="utf-8",
        )

        with patch.dict("os.environ", {"XDG_CONFIG_HOME": str(config_home)}):
            result = self.cli.list_agents(repo)

        agents = {agent.name: agent for agent in result.agents}
        self.assertIn("global-agent", agents)
        self.assertEqual(agents["build"].details, ["Project build"])
        self.assertEqual(agents["team/reviewer"].agent_type, "subagent")
        self.assertNotIn("hidden-agent", agents)

    def test_v2_run_events_use_partid_and_require_real_session_id(self):
        output = "\n".join(
            [
                json.dumps(
                    {
                        "type": "text",
                        "sessionID": "ses_real",
                        "part": {"type": "text", "text": "done", "partID": "prt_real"},
                    }
                ),
                json.dumps(
                    {
                        "type": "tool_use",
                        "part": {
                            "type": "tool",
                            "id": "call_real",
                            "partID": "prt_call",
                            "tool": "read",
                        },
                    }
                ),
                json.dumps(
                    {
                        "type": "reasoning",
                        "part": {
                            "type": "reasoning",
                            "text": "considering",
                            "time": {"created": 1234},
                        },
                    }
                ),
            ]
        )
        session_id, parts = self.cli._parse_v2_events(output)
        missing_id, _ = self.cli._parse_v2_events(
            json.dumps({"type": "text", "part": {"text": "orphan"}})
        )
        self.assertEqual(session_id, "ses_real")
        self.assertEqual(parts[0].part_id, "prt_real")
        self.assertEqual(parts[1].call_id, "call_real")
        self.assertEqual(parts[2].timestamp, 1234)
        self.assertIsNone(missing_id)

    def test_unknown_database_schema_fails_explicitly(self):
        unknown = self.root / "unknown.db"
        sqlite3.connect(unknown).close()
        with patch.dict("os.environ", {"OPENCODE_DB": str(unknown)}):
            result = self.cli.list_sessions(self.root)
        self.assertFalse(result.success)
        self.assertIn("Unsupported OpenCode database schema", result.error_message)

    def test_cancelled_run_terminates_child_and_never_succeeds(self):
        executable = self.root / "opencode"
        executable.write_text(
            "#!/usr/bin/env python3\nimport sys, time\nsys.stdin.read()\ntime.sleep(30)\n",
            encoding="utf-8",
        )
        executable.chmod(0o755)
        cancel_event = threading.Event()
        processes = []

        def cancel_after_start(process):
            processes.append(process)
            cancel_event.set()

        with patch.dict(
            os.environ,
            {"PATH": f"{self.root}{os.pathsep}{os.environ['PATH']}"},
        ):
            result = self.cli.run_agent(
                "cancel this run",
                None,
                None,
                None,
                self.root,
                cancel_event,
                cancel_after_start,
            )

        self.assertFalse(result.success)
        self.assertEqual(result.error_message, "Agent request cancelled.")
        self.assertIsNotNone(processes[0].poll())


if __name__ == "__main__":
    unittest.main()
