import stat
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_repository_agent_attachment_preserves_unique_files(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    (workspace / "sample").mkdir(parents=True)
    storage = tmp_path / "uploads"
    storage.mkdir()
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(workspace))
    monkeypatch.setenv("MADE_HOME", str(tmp_path))
    monkeypatch.setattr("app._CHAT_ATTACHMENT_ROOT", str(storage))

    def dispatch(name, message, session_id, agent, model, *, reservation):
        assert (name, session_id, agent, model) == (
            "sample",
            "session-a",
            "reviewer",
            "model-a",
        )
        reservation.process_started = True
        return {"prompt": message, "sessionId": session_id}

    paths = []
    with patch("app.send_agent_message", side_effect=dispatch) as send:
        for value in (b"first", b"second"):
            response = client.post(
                "/api/repositories/sample/agent/attachment",
                headers={"X-MADE-Attachment": "1"},
                files={"file": ("../requirements.md", value)},
                data={
                    "message": "Read the file",
                    "sessionId": "session-a",
                    "agent": "reviewer",
                    "model": "model-a",
                },
            )
            assert response.status_code == 200
            prompt = response.json()["prompt"]
            assert "Read this file before answering" in prompt
            path = Path(prompt.split("`")[1])
            assert path.is_absolute() and path.parent.parent == storage
            assert path.name == "requirements.md" and path.read_bytes() == value
            assert stat.S_IMODE(path.stat().st_mode) == 0o600
            paths.append(path)
        assert send.call_count == 2
    assert paths[0] != paths[1]
    assert paths[0].read_bytes() == b"first"


@pytest.mark.parametrize(
    ("filename", "contents", "status_code"),
    [
        ("setup.exe", b"MZ", 415),
        ("RUN.BAT", b"echo", 415),
        ("large.txt", b"x" * (10 * 1024 * 1024 + 1), 413),
    ],
)
def test_repository_agent_attachment_rejects_before_dispatch(
    filename, contents, status_code, tmp_path, monkeypatch
):
    (tmp_path / "sample").mkdir()
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(tmp_path))
    monkeypatch.setattr("app._CHAT_ATTACHMENT_ROOT", str(tmp_path))
    with patch("app.send_agent_message") as send:
        response = client.post(
            "/api/repositories/sample/agent/attachment",
            headers={"X-MADE-Attachment": "1"},
            data={"message": "Read the file"},
            files={"file": (filename, contents)},
        )
        assert response.status_code == status_code
        assert response.json()["detail"]
        send.assert_not_called()
    assert not list(tmp_path.glob("made-chat-*"))


@pytest.mark.parametrize(
    ("filename", "contents"),
    [("data.zip", b"PK\x00\xff"), ("pic.png", b"\x89PNG\xff"), ("noext", b"x"), ("big.log", b"x" * (10 * 1024 * 1024))],
)
def test_repository_agent_attachment_accepts_broad_file_types(
    filename, contents, tmp_path, monkeypatch
):
    (tmp_path / "sample").mkdir()
    storage = tmp_path / "uploads"
    storage.mkdir()
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(tmp_path))
    monkeypatch.setattr("app._CHAT_ATTACHMENT_ROOT", str(storage))

    def dispatch(name, message, session_id, agent, model, *, reservation):
        reservation.process_started = True
        return {"prompt": message}

    with patch("app.send_agent_message", side_effect=dispatch):
        response = client.post(
            "/api/repositories/sample/agent/attachment",
            headers={"X-MADE-Attachment": "1"},
            data={"message": "Read the file"},
            files={"file": (filename, contents)},
        )
    assert response.status_code == 200
    path = Path(response.json()["prompt"].split("`")[1])
    assert path.name == filename and path.read_bytes() == contents
