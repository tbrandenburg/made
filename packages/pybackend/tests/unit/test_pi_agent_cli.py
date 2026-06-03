from __future__ import annotations

import json
from pathlib import Path

from pi_agent_cli import PiAgentCLI


def test_export_session_keeps_thinking_and_tool_calls(monkeypatch, tmp_path: Path) -> None:
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
                            "content": [
                                {
                                    "type": "thinking",
                                    "thinking": "Let me inspect this",
                                },
                                {
                                    "type": "toolCall",
                                    "id": "call-1",
                                    "name": "bash",
                                    "arguments": {"command": "echo hi"},
                                },
                                {"type": "text", "text": "Hello!"},
                            ],
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
    assert [message.role for message in result.messages] == [
        "user",
        "assistant",
        "assistant",
        "assistant",
    ]
    assert [message.content_type for message in result.messages] == [
        "text",
        "reasoning",
        "tool_use",
        "text",
    ]
    assert result.messages[0].content == "Hello"
    assert result.messages[1].content == "Let me inspect this"
    assert "Tool: bash" in result.messages[2].content
    assert 'command: echo hi' in result.messages[2].content
    assert result.messages[3].content == "Hello!"
