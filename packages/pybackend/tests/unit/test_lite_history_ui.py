"""Route-to-template regression coverage for history failure and retry recovery."""

import re
from pathlib import Path
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

import lite_router


@pytest.mark.parametrize(
    "messages",
    [[], [{"role": "assistant", "type": "text", "content": "Recovered answer"}]],
    ids=["empty", "populated"],
)
def test_rendered_retry_recovers_same_session_without_exposing_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    messages: list[dict[str, str]],
) -> None:
    (tmp_path / "repository").mkdir()
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(tmp_path))
    # Fault injection is the subject: exercise the real route and template boundary.
    exporter = Mock(
        side_effect=[
            RuntimeError("private transport detail token=secret"),
            {"messages": messages},
        ]
    )
    monkeypatch.setattr(lite_router, "export_chat_history", exporter)
    monkeypatch.setattr(lite_router, "list_agents", lambda name: [])
    monkeypatch.setattr(
        lite_router,
        "list_chat_sessions",
        lambda name: [{"id": "ses_+&=?#/%", "title": "Selected session"}],
    )
    app = FastAPI()
    app.include_router(lite_router.router)
    with TestClient(app) as client:
        unselected = client.get("/lite/repo/repository")

        assert (
            "Select a session and click Load to view its history, "
            "or send a message to start a new session." in unselected.text
        )
        assert '<option value="ses_+&amp;=?#/%">' in unselected.text
        assert " selected>" not in unselected.text
        assert "No messages yet." not in unselected.text
        assert 'role="alert"' not in unselected.text
        exporter.assert_not_called()

        failed = client.get(
            "/lite/repo/repository?session_id=ses_%2B%26%3D%3F%23%2F%25"
        )

        assert failed.status_code == 200
        assert (
            '<p role="alert">Unable to load session history. Please retry.</p>'
            in failed.text
        )
        assert "No messages yet." not in failed.text
        assert "Select a session and click Load" not in failed.text
        assert "private transport detail" not in failed.text
        assert "token=secret" not in failed.text
        assert '<option value="ses_+&amp;=?#/%" selected>' in failed.text
        links = re.findall(r'<a href="([^"]+)">Retry history</a>', failed.text)
        assert links == ["/lite/repo/repository?session_id=ses_%2B%26%3D%3F%23%2F%25"]

        recovered = client.get(links[0])

    assert recovered.status_code == 200
    assert 'role="alert"' not in recovered.text
    assert "Retry history" not in recovered.text
    assert "Select a session and click Load" not in recovered.text
    assert '<option value="ses_+&amp;=?#/%" selected>' in recovered.text
    assert recovered.text.count("No messages yet.") == (0 if messages else 1)
    assert recovered.text.count("Recovered answer") == (1 if messages else 0)
    assert exporter.call_count == 2
    assert exporter.call_args_list[0].args == ("ses_+&=?#/%",)
    assert exporter.call_args_list[1].args == ("ses_+&=?#/%",)
    assert exporter.call_args_list[0].kwargs == {"channel": "repository"}
    assert exporter.call_args_list[1].kwargs == {"channel": "repository"}
