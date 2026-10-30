"""History export errors must not expose arbitrary adapter output."""

import logging

from fastapi.testclient import TestClient
import pytest

import agent_service
from agent_results import ExportResult
from app import app


ERROR_MARKER = (
    "synthetic-private-exporter-marker https://user:pass@example.invalid private-body"
)


class FailedExportAdapter:
    def export_session(self, session_id, working_dir):
        return ExportResult(False, session_id, [], error_message=ERROR_MARKER)


def test_service_logs_and_raises_only_safe_classification(monkeypatch, caplog):
    monkeypatch.setattr(
        agent_service, "get_agent_cli", lambda working_dir: FailedExportAdapter()
    )

    with caplog.at_level(logging.ERROR, logger=agent_service.logger.name):
        with pytest.raises(
            RuntimeError, match="Failed to export session history"
        ) as error:
            agent_service.export_chat_history("ses_failure")

    assert ERROR_MARKER not in caplog.text
    assert ERROR_MARKER not in str(error.value)
    assert error.value.__cause__ is None


@pytest.mark.parametrize(
    "route",
    [
        "/api/repositories/repository/agent/history",
        "/api/knowledge/notes.md/agent/history",
        "/api/constitutions/policy.md/agent/history",
        "/api/tasks/daily.md/agent/history",
    ],
)
def test_history_routes_do_not_log_or_return_adapter_error(monkeypatch, caplog, route):
    monkeypatch.setattr(
        agent_service, "get_agent_cli", lambda working_dir: FailedExportAdapter()
    )

    with caplog.at_level(logging.ERROR):
        response = TestClient(app).get(route, params={"session_id": "ses_failure"})

    assert response.status_code == 500
    assert ERROR_MARKER not in response.text
    assert ERROR_MARKER not in caplog.text
    assert "Failed to export session history" in response.text
