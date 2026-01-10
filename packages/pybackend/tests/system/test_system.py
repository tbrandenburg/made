"""
System tests for the MADE Python Backend.
These tests verify the application starts correctly and core integrations work.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import app

client = TestClient(app)


class TestSystemHealth:
    """System-level health checks."""

    def test_app_starts_successfully(self):
        """Test that the FastAPI app can be instantiated and started."""
        assert app is not None
        assert app.title == "MADE Python Backend"

    def test_cors_middleware_configured(self):
        """Test that CORS middleware is properly configured."""
        # Check that the app has CORS configured by testing a typical scenario
        response = client.get("/api/health")
        # CORS should allow the request to proceed
        assert response.status_code == 200

    @patch('app.get_workspace_home')
    @patch('app.get_made_directory')
    def test_health_endpoint_integration(self, mock_made_dir, mock_workspace_home):
        """Test health endpoint works end-to-end."""
        mock_workspace_home.return_value = "/test/workspace"
        mock_made_dir.return_value = "/test/made"
        
        response = client.get("/api/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "workspace" in data
        assert "made" in data


class TestAPIErrorHandling:
    """Test system-wide error handling patterns."""

    def test_404_for_nonexistent_endpoints(self):
        """Test that non-existent endpoints return 404."""
        response = client.get("/api/nonexistent")
        assert response.status_code == 404

    def test_405_for_wrong_method(self):
        """Test that wrong HTTP methods return 405."""
        response = client.post("/api/health")
        assert response.status_code == 405

    def test_422_for_invalid_json(self):
        """Test that invalid JSON in request body returns 422."""
        response = client.post("/api/repositories", data="invalid json")
        assert response.status_code == 422


class TestAPIDocumentation:
    """Test that API documentation is available."""

    def test_openapi_schema_available(self):
        """Test that OpenAPI schema is available."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "openapi" in schema
        assert "info" in schema
        assert schema["info"]["title"] == "MADE Python Backend"

    def test_docs_available(self):
        """Test that API docs are available."""
        response = client.get("/docs")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]


class TestServiceIntegration:
    """Test integration between different services."""

    @patch('app.list_repositories')
    @patch('app.list_knowledge_artefacts')
    @patch('app.list_constitutions')
    @patch('app.get_dashboard_summary')
    def test_multiple_endpoints_integration(self, mock_dashboard, mock_constitutions, 
                                          mock_knowledge, mock_repositories):
        """Test that multiple endpoints can be called in sequence."""
        # Mock all services
        mock_repositories.return_value = ["repo1", "repo2"]
        mock_knowledge.return_value = ["guide1.md"]
        mock_constitutions.return_value = ["rules.md"]
        mock_dashboard.return_value = {"status": "ok"}
        
        # Test multiple endpoint calls
        responses = [
            client.get("/api/repositories"),
            client.get("/api/knowledge"), 
            client.get("/api/constitutions"),
            client.get("/api/dashboard")
        ]
        
        for response in responses:
            assert response.status_code == 200

        # Verify all services were called
        mock_repositories.assert_called_once()
        mock_knowledge.assert_called_once()
        mock_constitutions.assert_called_once()
        mock_dashboard.assert_called_once()

    @patch('app.clone_repository')
    def test_clone_repository_endpoint(self, mock_clone_repository):
        """Test the clone repository endpoint wiring."""
        mock_clone_repository.return_value = {"name": "cloned"}

        response = client.post(
            "/api/repositories/clone",
            json={"url": "https://example.com/repo.git", "name": "custom"},
        )

        assert response.status_code == 201
        assert response.json()["name"] == "cloned"
        mock_clone_repository.assert_called_once_with(
            "https://example.com/repo.git", "custom", None
        )


@patch('app.list_commands')
def test_repository_commands_endpoint(mock_list_commands):
    """Verify repository commands endpoint delegates to service and returns payload."""
    mock_list_commands.return_value = [
        {
            "id": "test:cmd",
            "name": "cmd",
            "description": "Test command",
            "content": "echo hi",
            "metadata": {"argument-hint": "[name]"},
        }
    ]

    response = client.get("/api/repositories/sample/commands")

    assert response.status_code == 200
    body = response.json()
    assert "commands" in body
    assert body["commands"][0]["description"] == "Test command"
    mock_list_commands.assert_called_once_with("sample")


class TestTerminalWebSocket:
    def test_terminal_rejects_missing_repository(self):
        """Connections should be refused for unknown repositories."""
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect(
                "/api/repositories/missing/terminal"
            ) as websocket:
                websocket.receive_text()

        assert excinfo.value.code == 1008

    def test_terminal_executes_commands_in_repository(self, tmp_path, monkeypatch):
        """Terminal websocket should stream shell output from the repository path."""
        repo = tmp_path / "demo"
        repo.mkdir()
        monkeypatch.setenv("MADE_WORKSPACE_HOME", str(tmp_path))

        messages: list[str] = []
        with TestClient(app) as local_client:
            with local_client.websocket_connect(
                "/api/repositories/demo/terminal"
            ) as websocket:
                messages.append(websocket.receive_text())
                websocket.send_text("pwd\n")
                websocket.send_text("echo terminal-ready\n")
                websocket.send_text("exit\n")
                with pytest.raises(WebSocketDisconnect):
                    while True:
                        messages.append(websocket.receive_text())

        output = "\n".join(messages)
        assert str(repo) in output
        assert "terminal-ready" in output
