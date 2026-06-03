from __future__ import annotations

import json
from pathlib import Path

from pi_agent_cli import PiAgentCLI


def test_export_session_skips_tool_result_messages(monkeypatch, tmp_path: Path) -> None:
    session_dir = tmp_path / "sessions"
    session_dir.mkdir()
    monkeypatch.setenv("PI_SESSIONS_PATH", str(session_dir))

    session_file = session_dir / "2026-06-03T18-38-57-752Z_019e8ec8-14d6-73c8-9438-4f824f5ea337.jsonl"
    session_file.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "type": "session",
                        "version": 3,
                        "id": "019e8ec8-14d6-73c8-9438-4f824f5ea337",
                        "timestamp": "2026-06-03T18:38:57.752Z",
                        "cwd": "/tmp/project",
                    }
                ),
                json.dumps(
                    {
                        "type": "message",
                        "id": "user-1",
                        "parentId": None,
                        "timestamp": "2026-06-03T18:39:00.000Z",
                        "message": {
                            "role": "user",
                            "content": [{"type": "text", "text": "Hello"}],
                        },
                    }
                ),
                json.dumps(
                    {
                        "type": "message",
                        "id": "assistant-1",
                        "parentId": "user-1",
                        "timestamp": "2026-06-03T18:39:01.000Z",
                        "message": {
                            "role": "assistant",
                            "content": [{"type": "text", "text": "Hello!"}],
                        },
                    }
                ),
                json.dumps(
                    {
                        "type": "message",
                        "id": "tool-1",
                        "parentId": "assistant-1",
                        "timestamp": "2026-06-03T18:39:02.000Z",
                        "message": {
                            "role": "toolResult",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "./README.md\n./SETUP.md\n",
                                }
                            ],
                        },
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    result = PiAgentCLI().export_session(
        "019e8ec8-14d6-73c8-9438-4f824f5ea337", None
    )

    assert result.success is True
    assert [message.role for message in result.messages] == ["user", "assistant"]
    assert [message.content for message in result.messages] == ["Hello", "Hello!"]
