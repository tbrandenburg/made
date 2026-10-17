"""Behavioral tests for the OpenCode v2 adapter and v2 SQLite layout."""

import json
import os
import sqlite3
import tempfile
import threading
import unittest
import sys
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
                                "state": {"input": {"filePath": "README.md"}},
                            },
                        ],
                    }
                ),
            ),
        )
        connection.commit()
        connection.close()
        self.cli = OpenCodeV2AgentCLI()

    def test_listing_remains_sqlite_scoped_root_and_nonempty(self):
        with patch.dict("os.environ", {"OPENCODE_DB": str(self.database)}):
            sessions = self.cli.list_sessions(self.root / "repo")
            other = self.cli.list_sessions(self.root / "other")
        self.assertTrue(sessions.success)
        self.assertEqual([item.session_id for item in sessions.sessions], ["ses_a"])
        self.assertEqual(other.sessions, [])

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

    def test_v2_tool_events_accept_legacy_call_id_aliases(self):
        output = json.dumps(
            {
                "type": "tool_use",
                "part": {
                    "type": "tool",
                    "tool": "bash",
                    "partId": "prt_legacy_shape",
                    "callID": "call_legacy_shape",
                    "state": {"input": {"command": "pwd"}},
                },
            }
        )

        _, parts = self.cli._parse_v2_events(output)

        self.assertEqual(parts[0].text, "Tool: bash\n  command: pwd")
        self.assertEqual(parts[0].part_id, "prt_legacy_shape")
        self.assertEqual(parts[0].call_id, "call_legacy_shape")

    def test_tool_format_matches_v1_arguments_and_handles_missing_input(self):
        part = {
            "name": "execute",
            "state": {"input": {"code": "x" * 100, "limit": 3}},
        }
        text = self.cli._format_tool(part)
        self.assertEqual(text, "Tool: execute\n  code: " + "x" * 90 + "...\n  limit: 3")
        self.assertEqual(self.cli._format_tool({"name": "read"}), "Tool: read")
        self.assertEqual(
            self.cli._format_tool({"name": "read", "state": {"input": None}}),
            "Tool: read",
        )

    def test_unknown_database_schema_fails_explicitly(self):
        unknown = self.root / "unknown.db"
        sqlite3.connect(unknown).close()
        with patch.dict("os.environ", {"OPENCODE_DB": str(unknown)}):
            result = self.cli.list_sessions(self.root)
        self.assertFalse(result.success)
        self.assertIn("Unsupported OpenCode database schema", result.error_message)

    def test_child_observes_resolved_cwd_pwd_prompt_flags_and_inherited_environment(
        self,
    ):
        repo = self.root / "repository with spaces"
        repo.mkdir()
        executable = self.root / "opencode"
        executable.write_text(
            f"#!{sys.executable}\n"
            "import json, os, sys\n"
            "observation = {'cwd': os.getcwd(), 'pwd': os.environ.get('PWD'), "
            "'prompt': sys.stdin.read(), 'argv': sys.argv[1:], "
            "'database': os.environ.get('OPENCODE_DB'), "
            "'provider': os.environ.get('MADE_TEST_PROVIDER')}\n"
            "print(json.dumps({'type': 'text', 'sessionID': 'ses_observed', "
            "'part': {'text': json.dumps(observation)}}))\n",
            encoding="utf-8",
        )
        executable.chmod(0o755)
        for parent_pwd in (str(self.root / "backend"), None):
            with (
                self.subTest(parent_pwd=parent_pwd),
                patch.dict(
                    os.environ,
                    {
                        "PATH": f"{self.root}{os.pathsep}{os.environ['PATH']}",
                        "OPENCODE_DB": str(self.database),
                        "MADE_TEST_PROVIDER": "synthetic-provider-value",
                    },
                ),
            ):
                if parent_pwd is None:
                    os.environ.pop("PWD", None)
                else:
                    os.environ["PWD"] = parent_pwd
                parent = dict(os.environ)
                processes = []
                result = self.cli.run_agent(
                    "prompt with spaces\nand a second line",
                    "ses_existing",
                    "plan",
                    "provider/model with spaces",
                    repo / ".." / repo.name,
                    on_process=processes.append,
                )
                self.assertTrue(result.success, result.error_message)
                observed = json.loads(result.response_parts[0].text)
                self.assertEqual(observed["cwd"], str(repo))
                self.assertEqual(observed["pwd"], str(repo))
                self.assertEqual(
                    observed["prompt"], "prompt with spaces\nand a second line"
                )
                self.assertEqual(
                    observed["argv"],
                    [
                        "run",
                        "--format",
                        "json",
                        "--session",
                        "ses_existing",
                        "--agent",
                        "plan",
                        "--model",
                        "provider/model with spaces",
                    ],
                )
                self.assertEqual(observed["database"], str(self.database))
                self.assertEqual(observed["provider"], "synthetic-provider-value")
                self.assertTrue(
                    dict(os.environ) == parent, "Parent environment mutated"
                )
                self.assertEqual(len(processes), 1)
                self.assertEqual(processes[0].poll(), 0)

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
