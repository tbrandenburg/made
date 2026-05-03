"""
Unit tests for the MADE Python Backend API endpoints.
Tests cover all main API endpoints with proper mocking of services.
"""

from fastapi.testclient import TestClient
from unittest.mock import patch

from agent_service import ChannelBusyError

from app import app

client = TestClient(app)


class TestHealthEndpoint:
    """Test the health check endpoint."""

    @patch("app.get_workspace_home")
    @patch("app.get_made_directory")
    def test_health_check_success(self, mock_made_dir, mock_workspace_home):
        """Test successful health check."""
        mock_workspace_home.return_value = "/test/workspace"
        mock_made_dir.return_value = "/test/made"

        response = client.get("/api/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
        assert data["workspace"] == "/test/workspace"
        assert data["made"] == "/test/made"


class TestDashboardEndpoint:
    """Test the dashboard endpoint."""

    @patch("app.get_dashboard_summary")
    def test_dashboard_success(self, mock_dashboard):
        """Test successful dashboard retrieval."""
        mock_data = {"repositories": 5, "knowledge": 3, "constitutions": 2}
        mock_dashboard.return_value = mock_data

        response = client.get("/api/dashboard")

        assert response.status_code == 200
        assert response.json() == mock_data

    @patch("app.get_dashboard_summary")
    def test_dashboard_error(self, mock_dashboard):
        """Test dashboard error handling."""
        mock_dashboard.side_effect = Exception("Dashboard error")

        response = client.get("/api/dashboard")

        assert response.status_code == 500
        assert "Dashboard error" in response.json()["detail"]


class TestAgentsEndpoint:
    """Test the agents endpoint."""

    @patch("app.list_agents")
    def test_list_agents_success(self, mock_list):
        mock_list.return_value = [
            {"name": "build", "type": "primary", "details": ["allow: read"]},
            {"name": "plan", "type": "primary", "details": []},
        ]

        response = client.get("/api/agents")

        assert response.status_code == 200
        assert response.json() == {"agents": mock_list.return_value}

    @patch("app.list_agents")
    def test_list_agents_error(self, mock_list):
        mock_list.side_effect = Exception("Agent error")

        response = client.get("/api/agents")

        assert response.status_code == 500
        assert "Agent error" in response.json()["detail"]


class TestRepositoryAgentsEndpoint:
    """Test repository-scoped agents endpoint."""

    @patch("app.list_agents")
    def test_list_repository_agents_success(self, mock_list):
        mock_list.return_value = [
            {"name": "repo-agent", "type": "primary", "details": []}
        ]

        response = client.get("/api/repositories/sample/agents")

        assert response.status_code == 200
        assert response.json() == {"agents": mock_list.return_value}
        mock_list.assert_called_once_with("sample")

    @patch("app.list_agents")
    def test_list_repository_agents_not_found(self, mock_list):
        mock_list.side_effect = FileNotFoundError("Repository 'missing' not found")

        response = client.get("/api/repositories/missing/agents")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"]

    @patch("app.list_agents")
    def test_list_repository_agents_error(self, mock_list):
        mock_list.side_effect = Exception("Agent error")

        response = client.get("/api/repositories/sample/agents")

        assert response.status_code == 500
        assert "Agent error" in response.json()["detail"]


class TestAgentProcessesEndpoint:
    @patch("app.list_running_agent_processes")
    def test_list_agent_processes_success(self, mock_list):
        mock_list.return_value = [
            {
                "pid": 123,
                "ppid": 1,
                "executable": "codex",
                "command": "codex exec --json",
            }
        ]

        response = client.get("/api/agent-processes")

        assert response.status_code == 200
        assert response.json() == {"processes": mock_list.return_value}

    @patch("app.terminate_agent_process")
    def test_terminate_agent_process_success(self, mock_terminate):
        mock_terminate.return_value = True

        response = client.post("/api/agent-processes/123/terminate")

        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_terminate.assert_called_once_with(123)

    @patch("app.terminate_agent_process")
    def test_terminate_agent_process_not_found(self, mock_terminate):
        mock_terminate.return_value = False

        response = client.post("/api/agent-processes/999/terminate")

        assert response.status_code == 404


class TestChatHistoryEndpoint:
    @patch("app.export_chat_history")
    def test_repository_history_success(self, mock_export):
        mock_export.return_value = {"sessionId": "ses_1", "messages": []}

        response = client.get(
            "/api/repositories/sample/agent/history",
            params={"session_id": "ses_1", "start": 123},
        )

        assert response.status_code == 200
        mock_export.assert_called_once_with("ses_1", 123, "sample")

    @patch("app.export_chat_history")
    def test_repository_history_bad_request(self, mock_export):
        mock_export.side_effect = ValueError("bad")

        response = client.get(
            "/api/repositories/sample/agent/history",
            params={"session_id": "", "start": None},
        )

        assert response.status_code == 400

    @patch("app.export_chat_history")
    def test_repository_history_not_found(self, mock_export):
        mock_export.side_effect = FileNotFoundError("missing")

        response = client.get(
            "/api/repositories/sample/agent/history",
            params={"session_id": "ses_1"},
        )

        assert response.status_code == 404

    @patch("app.export_chat_history")
    def test_repository_history_server_error(self, mock_export):
        mock_export.side_effect = RuntimeError("boom")

        response = client.get(
            "/api/repositories/sample/agent/history",
            params={"session_id": "ses_1"},
        )

        assert response.status_code == 500


class TestRepositoryAgentSessions:
    @patch("app.list_chat_sessions")
    def test_repository_sessions_success(self, mock_list):
        mock_list.return_value = [{"id": "ses_1", "title": "Hello", "updated": "Today"}]

        response = client.get(
            "/api/repositories/sample/agent/sessions",
            params={"limit": 5},
        )

        assert response.status_code == 200
        mock_list.assert_called_once_with("sample", 5)
        assert response.json()["sessions"][0]["id"] == "ses_1"

    @patch("app.list_chat_sessions")
    def test_repository_sessions_error(self, mock_list):
        mock_list.side_effect = RuntimeError("bad")

        response = client.get("/api/repositories/sample/agent/sessions")

        assert response.status_code == 500


class TestKnowledgeAgentHistory:
    @patch("app.export_chat_history")
    def test_knowledge_history_success(self, mock_export):
        mock_export.return_value = {"sessionId": "ses_1", "messages": []}

        response = client.get(
            "/api/knowledge/sample/agent/history",
            params={"session_id": "ses_1", "start": 123},
        )

        assert response.status_code == 200
        mock_export.assert_called_once_with("ses_1", 123, "knowledge:sample")

    @patch("app.export_chat_history")
    def test_knowledge_history_bad_request(self, mock_export):
        mock_export.side_effect = ValueError("bad")

        response = client.get(
            "/api/knowledge/sample/agent/history",
            params={"session_id": "", "start": None},
        )

        assert response.status_code == 400

    @patch("app.export_chat_history")
    def test_knowledge_history_server_error(self, mock_export):
        mock_export.side_effect = RuntimeError("boom")

        response = client.get(
            "/api/knowledge/sample/agent/history",
            params={"session_id": "ses_1"},
        )

        assert response.status_code == 500


class TestKnowledgeAgentSessions:
    @patch("app.list_chat_sessions")
    def test_knowledge_sessions_success(self, mock_list):
        mock_list.return_value = [{"id": "ses_1"}]

        response = client.get(
            "/api/knowledge/sample/agent/sessions",
            params={"limit": 5},
        )

        assert response.status_code == 200
        mock_list.assert_called_once_with("knowledge:sample", 5)

    @patch("app.list_chat_sessions")
    def test_knowledge_sessions_error(self, mock_list):
        mock_list.side_effect = RuntimeError("boom")

        response = client.get("/api/knowledge/sample/agent/sessions")

        assert response.status_code == 500


class TestKnowledgeAgentCancel:
    @patch("app.cancel_agent_message")
    def test_knowledge_agent_cancel_success(self, mock_cancel):
        mock_cancel.return_value = True

        response = client.post("/api/knowledge/sample/agent/cancel")

        assert response.status_code == 200
        assert response.json() == {"success": True}
        mock_cancel.assert_called_once_with("knowledge:sample")

    @patch("app.cancel_agent_message")
    def test_knowledge_agent_cancel_not_found(self, mock_cancel):
        mock_cancel.return_value = False

        response = client.post("/api/knowledge/sample/agent/cancel")

        assert response.status_code == 404
        assert "No active agent process" in response.json()["detail"]


class TestConstitutionAgentHistory:
    @patch("app.export_chat_history")
    def test_constitution_history_success(self, mock_export):
        mock_export.return_value = {"sessionId": "ses_1", "messages": []}

        response = client.get(
            "/api/constitutions/sample/agent/history",
            params={"session_id": "ses_1", "start": 123},
        )

        assert response.status_code == 200
        mock_export.assert_called_once_with("ses_1", 123, "constitution:sample")

    @patch("app.export_chat_history")
    def test_constitution_history_bad_request(self, mock_export):
        mock_export.side_effect = ValueError("bad")

        response = client.get(
            "/api/constitutions/sample/agent/history",
            params={"session_id": "", "start": None},
        )

        assert response.status_code == 400

    @patch("app.export_chat_history")
    def test_constitution_history_server_error(self, mock_export):
        mock_export.side_effect = RuntimeError("boom")

        response = client.get(
            "/api/constitutions/sample/agent/history",
            params={"session_id": "ses_1"},
        )

        assert response.status_code == 500


class TestConstitutionAgentCancel:
    @patch("app.cancel_agent_message")
    def test_constitution_agent_cancel_success(self, mock_cancel):
        mock_cancel.return_value = True

        response = client.post("/api/constitutions/sample/agent/cancel")

        assert response.status_code == 200
        assert response.json() == {"success": True}
        mock_cancel.assert_called_once_with("constitution:sample")

    @patch("app.cancel_agent_message")
    def test_constitution_agent_cancel_not_found(self, mock_cancel):
        mock_cancel.return_value = False

        response = client.post("/api/constitutions/sample/agent/cancel")

        assert response.status_code == 404
        assert "No active agent process" in response.json()["detail"]


class TestConstitutionAgentSessions:
    @patch("app.list_chat_sessions")
    def test_constitution_sessions_success(self, mock_list):
        mock_list.return_value = [{"id": "ses_1"}]

        response = client.get(
            "/api/constitutions/sample/agent/sessions",
            params={"limit": 5},
        )

        assert response.status_code == 200
        mock_list.assert_called_once_with("constitution:sample", 5)

    @patch("app.list_chat_sessions")
    def test_constitution_sessions_error(self, mock_list):
        mock_list.side_effect = RuntimeError("boom")

        response = client.get("/api/constitutions/sample/agent/sessions")

        assert response.status_code == 500


class TestRepositoryEndpoints:
    """Test repository-related endpoints."""

    @patch("app.list_repositories")
    def test_list_repositories_success(self, mock_list):
        """Test successful repository listing."""
        mock_repos = ["repo1", "repo2", "repo3"]
        mock_list.return_value = mock_repos

        response = client.get("/api/repositories")

        assert response.status_code == 200
        data = response.json()
        assert data["repositories"] == mock_repos

    @patch("app.list_repositories")
    def test_list_repositories_error(self, mock_list):
        """Test repository listing error."""
        mock_list.side_effect = Exception("List error")

        response = client.get("/api/repositories")

        assert response.status_code == 500

    @patch("app.create_repository")
    def test_create_repository_success(self, mock_create):
        """Test successful repository creation."""
        mock_create.return_value = {"name": "test-repo", "created": True}

        response = client.post("/api/repositories", json={"name": "test-repo"})

        assert response.status_code == 201
        mock_create.assert_called_once_with("test-repo")

    @patch("app.delete_repository")
    def test_delete_repository_success(self, mock_delete):
        mock_delete.return_value = {"deleted": "test-repo"}

        response = client.delete("/api/repositories/test-repo")

        assert response.status_code == 200
        assert response.json() == {"deleted": "test-repo"}
        mock_delete.assert_called_once_with("test-repo")

    def test_create_repository_no_name(self):
        """Test repository creation without name."""
        response = client.post("/api/repositories", json={})

        assert response.status_code == 400
        assert "Repository name is required" in response.json()["detail"]

    @patch("app.create_repository")
    def test_create_repository_invalid_name(self, mock_create):
        """Test repository creation with invalid name."""
        mock_create.side_effect = ValueError("Invalid repository name")

        response = client.post("/api/repositories", json={"name": "invalid name"})

        assert response.status_code == 400
        assert "Invalid repository name" in response.json()["detail"]

    @patch("app.clone_repository")
    def test_clone_repository_success(self, mock_clone):
        """Test successful repository cloning."""
        mock_clone.return_value = {"name": "cloned-repo"}

        response = client.post(
            "/api/repositories/clone",
            json={
                "url": "https://example.com/cloned.git",
                "name": "custom",
                "branch": "release",
            },
        )

        assert response.status_code == 201
        mock_clone.assert_called_once_with(
            "https://example.com/cloned.git", "custom", "release"
        )

    def test_clone_repository_missing_url(self):
        """Test cloning without providing URL."""
        response = client.post("/api/repositories/clone", json={})

        assert response.status_code == 400
        assert "Repository URL is required" in response.json()["detail"]

    @patch("app.clone_repository")
    def test_clone_repository_failure(self, mock_clone):
        """Test cloning failure handling."""
        mock_clone.side_effect = ValueError("Failed to clone repository")

        response = client.post(
            "/api/repositories/clone",
            json={"url": "https://example.com/sample.git"},
        )

        assert response.status_code == 400
        assert "Failed to clone repository" in response.json()["detail"]

    @patch("app.list_repository_templates")
    def test_list_repository_templates_success(self, mock_list_templates):
        mock_list_templates.return_value = ["starter", "python"]

        response = client.get("/api/repositories/templates")

        assert response.status_code == 200
        assert response.json() == {"templates": ["starter", "python"]}

    @patch("app.apply_repository_template")
    def test_apply_repository_template_success(self, mock_apply_template):
        mock_apply_template.return_value = {"repository": "sample", "template": "starter"}

        response = client.post(
            "/api/repositories/sample/templates/apply",
            json={"template": "starter"},
        )

        assert response.status_code == 200
        assert response.json() == {"repository": "sample", "template": "starter"}
        mock_apply_template.assert_called_once_with("sample", "starter")

    @patch("app.send_agent_message")
    def test_repository_agent_busy(self, mock_send):
        mock_send.side_effect = ChannelBusyError("busy")

        response = client.post(
            "/api/repositories/sample/agent", json={"message": "hello"}
        )

        assert response.status_code == 409
        assert "busy" in response.json()["detail"]

    @patch("app.get_channel_status")
    def test_repository_agent_status(self, mock_status):
        payload = {"processing": True, "startedAt": "2024-01-01T00:00:00Z"}
        mock_status.return_value = payload

        response = client.get("/api/repositories/sample/agent/status")

        assert response.status_code == 200
        assert response.json() == payload

    @patch("app.cancel_agent_message")
    def test_repository_agent_cancel_success(self, mock_cancel):
        mock_cancel.return_value = True

        response = client.post("/api/repositories/sample/agent/cancel")

        assert response.status_code == 200
        assert response.json() == {"success": True}
        mock_cancel.assert_called_once_with("sample")

    @patch("app.cancel_agent_message")
    def test_repository_agent_cancel_not_found(self, mock_cancel):
        mock_cancel.return_value = False

        response = client.post("/api/repositories/sample/agent/cancel")

        assert response.status_code == 404
        assert "No active agent process" in response.json()["detail"]

    @patch("app.get_repository_info")
    def test_get_repository_info_success(self, mock_get_info):
        """Test successful repository info retrieval."""
        mock_info = {"name": "test-repo", "files": 5}
        mock_get_info.return_value = mock_info

        response = client.get("/api/repositories/test-repo")

        assert response.status_code == 200
        assert response.json() == mock_info

    @patch("app.get_repository_info")
    def test_get_repository_info_not_found(self, mock_get_info):
        """Test repository info for non-existent repo."""
        mock_get_info.side_effect = FileNotFoundError("Repository not found")

        response = client.get("/api/repositories/nonexistent")

        assert response.status_code == 404

    @patch("app.list_repository_files")
    def test_list_repository_files_success(self, mock_list_files):
        """Test successful repository files listing."""
        mock_files = {
            "name": "test-repo",
            "path": ".",
            "type": "folder",
            "children": [
                {"name": "file1.py", "path": "file1.py", "type": "file", "size": 123},
            ],
        }
        mock_list_files.return_value = mock_files

        response = client.get("/api/repositories/test-repo/files")

        assert response.status_code == 200
        assert response.json() == mock_files
        mock_list_files.assert_called_once_with("test-repo", ".")

    @patch("app.read_repository_file")
    def test_read_repository_file_success(self, mock_read):
        """Test successful repository file reading."""
        mock_content = "File content here"
        mock_read.return_value = mock_content

        response = client.get("/api/repositories/test-repo/file?path=test.py")

        assert response.status_code == 200
        data = response.json()
        assert data["content"] == mock_content

    def test_repository_web_serves_index_html(self, tmp_path):
        repo_path = tmp_path / "test-repo"
        repo_path.mkdir()
        (repo_path / "index.html").write_text("<h1>Hello</h1>", encoding="utf-8")

        with patch("app._repository_path", return_value=repo_path):
            response = client.get("/api/repositories/test-repo/web")

        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "<h1>Hello</h1>" in response.text

    def test_repository_web_missing_file_returns_not_found(self, tmp_path):
        repo_path = tmp_path / "test-repo"
        repo_path.mkdir()

        with patch("app._repository_path", return_value=repo_path):
            response = client.get("/api/repositories/test-repo/web/missing.html")

        assert response.status_code == 404
        assert response.json()["detail"] == "Web file not found"

    def test_repository_web_lists_directory_when_index_missing(self, tmp_path):
        repo_path = tmp_path / "test-repo"
        docs_path = repo_path / "docs"
        docs_path.mkdir(parents=True)
        (docs_path / "guide.html").write_text("guide", encoding="utf-8")
        (docs_path / "assets").mkdir()

        with patch("app._repository_path", return_value=repo_path):
            response = client.get("/api/repositories/test-repo/web/docs")

        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "Index of /api/repositories/test-repo/web/docs" in response.text
        assert 'href="/api/repositories/test-repo/web/docs/guide.html"' in response.text
        assert 'href="/api/repositories/test-repo/web/docs/assets"' in response.text

    def test_read_repository_file_no_path(self):
        """Test reading repository file without path."""
        response = client.get("/api/repositories/test-repo/file")

        assert response.status_code == 422  # FastAPI validation error

    def test_download_repository_folder_archive_success(self, tmp_path):
        repo_path = tmp_path / "test-repo"
        docs_path = repo_path / "docs"
        docs_path.mkdir(parents=True)
        (docs_path / "guide.md").write_text("hello", encoding="utf-8")

        with patch("app.get_workspace_home", return_value=tmp_path):
            response = client.get("/api/repositories/test-repo/folder/archive?path=docs")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"

    @patch("app.write_repository_file")
    def test_write_repository_file_success(self, mock_write):
        """Test successful repository file writing."""
        payload = {"path": "test.py", "content": "print('hello')"}

        response = client.put("/api/repositories/test-repo/file", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        mock_write.assert_called_once_with("test-repo", "test.py", "print('hello')")

    def test_write_repository_file_no_path(self):
        """Test writing repository file without path."""
        response = client.put(
            "/api/repositories/test-repo/file", json={"content": "test"}
        )

        assert response.status_code == 400
        assert "File path is required" in response.json()["detail"]

    @patch("app.create_repository_file")
    def test_create_repository_file_success(self, mock_create):
        """Test successful repository file creation."""
        payload = {"path": "new.py", "content": "# New file"}

        response = client.post("/api/repositories/test-repo/file", json=payload)

        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True

    @patch("app.write_repository_file_bytes")
    def test_upload_repository_file_success(self, mock_upload):
        """Test successful repository file upload."""
        files = {"file": ("logo.png", b"binary", "image/png")}
        data = {"path": "assets/logo.png"}

        response = client.post(
            "/api/repositories/test-repo/file/upload",
            data=data,
            files=files,
        )

        assert response.status_code == 201
        payload = response.json()
        assert payload["success"] is True
        mock_upload.assert_called_once_with(
            "test-repo",
            "assets/logo.png",
            b"binary",
        )

    @patch("app.write_repository_file_bytes")
    def test_upload_repository_file_missing_path(self, mock_upload):
        """Test uploading repository file without a path."""
        files = {"file": ("logo.png", b"binary", "image/png")}

        response = client.post(
            "/api/repositories/test-repo/file/upload",
            data={"path": ""},
            files=files,
        )

        assert response.status_code == 400
        assert "File path is required" in response.json()["detail"]
        mock_upload.assert_not_called()

    @patch("app.rename_repository_file")
    def test_rename_repository_file_success(self, mock_rename):
        """Test successful repository file renaming."""
        payload = {"from": "old.py", "to": "new.py"}

        response = client.post("/api/repositories/test-repo/file/rename", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        mock_rename.assert_called_once_with("test-repo", "old.py", "new.py")

    def test_rename_repository_file_missing_params(self):
        """Test renaming repository file with missing parameters."""
        response = client.post(
            "/api/repositories/test-repo/file/rename", json={"from": "old.py"}
        )

        assert response.status_code == 400
        assert "Both from and to paths are required" in response.json()["detail"]

    @patch("app.delete_repository_file")
    def test_delete_repository_file_success(self, mock_delete):
        """Test successful repository file deletion."""
        payload = {"path": "delete.py"}

        response = client.request(
            "DELETE", "/api/repositories/test-repo/file", json=payload
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch("app.send_agent_message")
    def test_repository_agent_success(self, mock_agent):
        """Test successful repository agent interaction."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message"}

        response = client.post("/api/repositories/test-repo/agent", json=payload)

        assert response.status_code == 200
        mock_agent.assert_called_once_with(
            "test-repo",
            "Test message",
            None,
            None,
            None,
        )

    @patch("app.send_agent_message")
    def test_repository_agent_with_session_id(self, mock_agent):
        """Test repository agent forwards provided session ID."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message", "sessionId": "ses_456"}

        response = client.post("/api/repositories/test-repo/agent", json=payload)

        assert response.status_code == 200
        mock_agent.assert_called_once_with(
            "test-repo",
            "Test message",
            "ses_456",
            None,
            None,
        )

    @patch("app.get_repository_git_status")
    def test_repository_git_status_success(self, mock_status):
        mock_status.return_value = {"branch": "main"}

        response = client.get("/api/repositories/test-repo/git")

        assert response.status_code == 200
        assert response.json() == {"branch": "main"}
        mock_status.assert_called_once_with("test-repo")

    @patch("app.pull_repository")
    def test_repository_git_pull_success(self, mock_pull):
        mock_pull.return_value = {"output": "ok"}

        response = client.post("/api/repositories/test-repo/git/pull")

        assert response.status_code == 200
        assert response.json() == {"output": "ok"}
        mock_pull.assert_called_once_with("test-repo")

    @patch("app.create_repository_worktree")
    def test_repository_git_worktree_success(self, mock_worktree):
        mock_worktree.return_value = {"path": "/tmp/wt", "branch": "feature/test"}

        response = client.post(
            "/api/repositories/test-repo/git/worktree",
            json={"directoryName": "repo-feature", "branchName": "feature/test"},
        )

        assert response.status_code == 200
        assert response.json()["branch"] == "feature/test"
        mock_worktree.assert_called_once_with(
            "test-repo",
            "repo-feature",
            "feature/test",
        )

    def test_repository_git_worktree_missing_params(self):
        response = client.post(
            "/api/repositories/test-repo/git/worktree",
            json={"directoryName": "repo-feature"},
        )

        assert response.status_code == 400
        assert "directoryName and branchName are required" in response.json()["detail"]


    @patch("app.remove_repository_worktree")
    def test_repository_git_worktree_delete_success(self, mock_remove):
        mock_remove.return_value = {"removed": "repo-feature"}

        response = client.delete("/api/repositories/repo-feature/git/worktree")

        assert response.status_code == 200
        assert response.json() == {"removed": "repo-feature"}
        mock_remove.assert_called_once_with("repo-feature")

    @patch("app.remove_repository_worktree")
    def test_repository_git_worktree_delete_value_error(self, mock_remove):
        mock_remove.side_effect = ValueError("Repository is not a worktree")

        response = client.delete("/api/repositories/repo/git/worktree")

        assert response.status_code == 400
        assert response.json()["detail"] == "Repository is not a worktree"


class TestKnowledgeEndpoints:
    """Test knowledge-related endpoints."""

    @patch("app.list_knowledge_artefacts")
    def test_list_knowledge_success(self, mock_list):
        """Test successful knowledge listing."""
        mock_artefacts = ["guide1.md", "guide2.md"]
        mock_list.return_value = mock_artefacts

        response = client.get("/api/knowledge")

        assert response.status_code == 200
        data = response.json()
        assert data["artefacts"] == mock_artefacts

    @patch("app.read_knowledge_artefact")
    def test_read_knowledge_success(self, mock_read):
        """Test successful knowledge reading."""
        mock_data = {"frontmatter": {"title": "Guide"}, "content": "Content here"}
        mock_read.return_value = mock_data

        response = client.get("/api/knowledge/test-guide")

        assert response.status_code == 200
        assert response.json() == mock_data

    @patch("app.read_knowledge_artefact")
    def test_read_knowledge_not_found(self, mock_read):
        """Test reading non-existent knowledge."""
        mock_read.side_effect = FileNotFoundError("Knowledge not found")

        response = client.get("/api/knowledge/nonexistent")

        assert response.status_code == 404

    @patch("app.write_knowledge_artefact")
    def test_write_knowledge_success(self, mock_write):
        """Test successful knowledge writing."""
        payload = {"frontmatter": {"title": "Test"}, "content": "Test content"}

        response = client.put("/api/knowledge/test-guide", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch("app.write_knowledge_artefact")
    def test_write_knowledge_nested_path_success(self, mock_write):
        payload = {"frontmatter": {"title": "Test"}, "content": "Test content"}

        response = client.put("/api/knowledge/folder1/folder2/test-guide.md", json=payload)

        assert response.status_code == 200
        mock_write.assert_called_once_with(
            "folder1/folder2/test-guide.md",
            {"title": "Test"},
            "Test content",
        )

    @patch("app.delete_knowledge_artefact")
    def test_delete_knowledge_success(self, mock_delete):
        response = client.delete("/api/knowledge/test-guide.md")

        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_delete.assert_called_once_with("test-guide.md")

    @patch("app.delete_knowledge_artefact")
    def test_delete_knowledge_not_found(self, mock_delete):
        mock_delete.side_effect = FileNotFoundError("Knowledge not found")

        response = client.delete("/api/knowledge/test-guide.md")

        assert response.status_code == 404

    @patch("app.send_agent_message")
    def test_knowledge_agent_success(self, mock_agent):
        """Test successful knowledge agent interaction."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message"}

        response = client.post("/api/knowledge/test-guide/agent", json=payload)

        assert response.status_code == 200
        mock_agent.assert_called_once_with(
            "knowledge:test-guide",
            "Test message",
            None,
            None,
            None,
        )

    @patch("app.send_agent_message")
    def test_knowledge_agent_with_session_id(self, mock_agent):
        """Test knowledge agent forwards provided session ID."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message", "sessionId": "ses_k"}

        response = client.post("/api/knowledge/test-guide/agent", json=payload)

        assert response.status_code == 200
        mock_agent.assert_called_once_with(
            "knowledge:test-guide",
            "Test message",
            "ses_k",
            None,
            None,
        )


class TestConstitutionEndpoints:
    """Test constitution-related endpoints."""

    @patch("app.list_constitutions")
    def test_list_constitutions_success(self, mock_list):
        """Test successful constitution listing."""
        mock_constitutions = ["const1.md", "const2.md"]
        mock_list.return_value = mock_constitutions

        response = client.get("/api/constitutions")

        assert response.status_code == 200
        data = response.json()
        assert data["constitutions"] == mock_constitutions

    @patch("app.read_constitution")
    def test_read_constitution_success(self, mock_read):
        """Test successful constitution reading."""
        mock_data = {"frontmatter": {"title": "Rules"}, "content": "Rules here"}
        mock_read.return_value = mock_data

        response = client.get("/api/constitutions/test-const")

        assert response.status_code == 200
        assert response.json() == mock_data

    @patch("app.write_constitution")
    def test_write_constitution_success(self, mock_write):
        """Test successful constitution writing."""
        payload = {"frontmatter": {"title": "Rules"}, "content": "New rules"}

        response = client.put("/api/constitutions/test-const", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch("app.write_constitution")
    def test_write_constitution_nested_path_success(self, mock_write):
        payload = {"frontmatter": {"title": "Rules"}, "content": "New rules"}

        response = client.put(
            "/api/constitutions/folder1/folder2/test-const.md", json=payload
        )

        assert response.status_code == 200
        mock_write.assert_called_once_with(
            "folder1/folder2/test-const.md",
            {"title": "Rules"},
            "New rules",
        )

    @patch("app.delete_constitution")
    def test_delete_constitution_success(self, mock_delete):
        response = client.delete("/api/constitutions/test-const.md")

        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_delete.assert_called_once_with("test-const.md")

    @patch("app.delete_constitution")
    def test_delete_constitution_not_found(self, mock_delete):
        mock_delete.side_effect = FileNotFoundError("Constitution not found")

        response = client.delete("/api/constitutions/test-const.md")

        assert response.status_code == 404

    @patch("app.send_agent_message")
    def test_constitution_agent_success(self, mock_agent):
        """Test successful constitution agent interaction."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message"}

        response = client.post("/api/constitutions/test-const/agent", json=payload)

        assert response.status_code == 200
        mock_agent.assert_called_once_with(
            "constitution:test-const",
            "Test message",
            None,
            None,
            None,
        )

    @patch("app.send_agent_message")
    def test_constitution_agent_with_session_id(self, mock_agent):
        """Test constitution agent forwards provided session ID."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message", "sessionId": "ses_c"}

        response = client.post("/api/constitutions/test-const/agent", json=payload)

        assert response.status_code == 200
        mock_agent.assert_called_once_with(
            "constitution:test-const",
            "Test message",
            "ses_c",
            None,
            None,
        )


class TestExternalMatterEndpoints:
    """Test external matter read/write endpoints."""

    @patch("app.read_external_matter")
    def test_read_external_matter_success(self, mock_read):
        mock_read.return_value = {
            "path": "/home/user/.config/opencode/AGENTS.md",
            "content": "body",
            "frontmatter": {"type": "global"},
        }

        response = client.post(
            "/api/external-matter/read",
            json={"path": "~/.config/opencode/AGENTS.md"},
        )

        assert response.status_code == 200
        assert response.json()["content"] == "body"
        mock_read.assert_called_once_with("~/.config/opencode/AGENTS.md")

    def test_read_external_matter_requires_path(self):
        response = client.post("/api/external-matter/read", json={})
        assert response.status_code == 400
        assert "Path is required" in response.json()["detail"]

    @patch("app.write_external_matter")
    def test_write_external_matter_success(self, mock_write):
        mock_write.return_value = {
            "success": True,
            "path": "/home/user/.config/opencode/AGENTS.md",
        }
        payload = {
            "path": "/home/user/.config/opencode/AGENTS.md",
            "content": "hello",
            "frontmatter": {"type": "project"},
        }
        response = client.put("/api/external-matter/write", json=payload)

        assert response.status_code == 200
        assert response.json()["success"] is True
        mock_write.assert_called_once_with(
            "/home/user/.config/opencode/AGENTS.md",
            {"type": "project"},
            "hello",
        )


class TestTaskEndpoints:
    """Test task-related endpoints."""

    @patch("app.list_tasks")
    def test_list_tasks_success(self, mock_list):
        mock_tasks = ["task1.md", "task2.md"]
        mock_list.return_value = mock_tasks

        response = client.get("/api/tasks")

        assert response.status_code == 200
        data = response.json()
        assert data["tasks"] == mock_tasks

    @patch("app.read_task")
    def test_read_task_success(self, mock_read):
        mock_data = {"frontmatter": {"type": "task"}, "content": "- [ ] Item"}
        mock_read.return_value = mock_data

        response = client.get("/api/tasks/test-task")

        assert response.status_code == 200
        assert response.json() == mock_data

    @patch("app.refresh_cron_clock")
    @patch("app.write_task")
    def test_write_task_success(self, mock_write, mock_refresh_cron_clock):
        payload = {"frontmatter": {"type": "task"}, "content": "- [x] Done"}

        response = client.put("/api/tasks/test-task", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        mock_refresh_cron_clock.assert_called_once_with()

    @patch("app.refresh_cron_clock")
    @patch("app.write_task")
    def test_write_task_nested_path_success(self, mock_write, mock_refresh_cron_clock):
        payload = {"frontmatter": {"type": "task"}, "content": "- [x] Done"}

        response = client.put("/api/tasks/folder1/folder2/test-task.md", json=payload)

        assert response.status_code == 200
        mock_write.assert_called_once_with(
            "folder1/folder2/test-task.md",
            {"type": "task"},
            "- [x] Done",
        )
        mock_refresh_cron_clock.assert_called_once_with()

    @patch("app.refresh_cron_clock")
    @patch("app.delete_task")
    def test_delete_task_success(self, mock_delete, mock_refresh_cron_clock):
        response = client.delete("/api/tasks/test-task")

        assert response.status_code == 200
        assert response.json() == {"success": True}
        mock_delete.assert_called_once_with("test-task")
        mock_refresh_cron_clock.assert_called_once_with()

    @patch("app.send_agent_message")
    def test_task_agent_success(self, mock_agent):
        mock_agent.return_value = {"response": "Agent response"}

        response = client.post(
            "/api/tasks/test-task/agent", json={"message": "Plan next step"}
        )

        assert response.status_code == 200
        mock_agent.assert_called_once_with(
            "task:test-task",
            "Plan next step",
            None,
            None,
            None,
        )

    @patch("app.get_channel_status")
    def test_task_agent_status(self, mock_status):
        mock_status.return_value = {"processing": False}

        response = client.get("/api/tasks/test-task/agent/status")

        assert response.status_code == 200
        assert response.json() == {"processing": False}

    @patch("app.cancel_agent_message")
    def test_task_agent_cancel_success(self, mock_cancel):
        mock_cancel.return_value = True

        response = client.post("/api/tasks/test-task/agent/cancel")

        assert response.status_code == 200
        assert response.json() == {"success": True}

    @patch("app.cancel_agent_message")
    def test_task_agent_cancel_not_found(self, mock_cancel):
        mock_cancel.return_value = False

        response = client.post("/api/tasks/test-task/agent/cancel")

        assert response.status_code == 404

    @patch("app.export_chat_history")
    def test_task_agent_history_success(self, mock_export):
        mock_export.return_value = {"sessionId": "ses_t", "messages": []}

        response = client.get(
            "/api/tasks/test-task/agent/history",
            params={"session_id": "ses_t", "start": 50},
        )

        assert response.status_code == 200
        mock_export.assert_called_once_with("ses_t", 50, "task:test-task")

    @patch("app.list_chat_sessions")
    def test_task_agent_sessions_success(self, mock_sessions):
        sessions = [
            {"id": "ses_t", "title": "Task Session", "updated": "2024-01-01T00:00:00Z"}
        ]
        mock_sessions.return_value = sessions

        response = client.get(
            "/api/tasks/test-task/agent/sessions", params={"limit": 5}
        )

        assert response.status_code == 200
        assert response.json() == {"sessions": sessions}


class TestSettingsEndpoints:
    """Test settings-related endpoints."""

    @patch("app.read_settings")
    def test_read_settings_success(self, mock_read):
        """Test successful settings reading."""
        mock_settings = {"theme": "dark", "language": "en"}
        mock_read.return_value = mock_settings

        response = client.get("/api/settings")

        assert response.status_code == 200
        assert response.json() == mock_settings

    @patch("app.write_settings")
    def test_write_settings_success(self, mock_write):
        """Test successful settings writing."""
        mock_write.return_value = {"success": True}
        payload = {"theme": "light", "language": "en"}

        response = client.put("/api/settings", json=payload)

        assert response.status_code == 200
        mock_write.assert_called_once_with(payload)


class TestBootstrapEndpoint:
    """Test bootstrap endpoint."""

    @patch("app.ensure_made_structure")
    def test_bootstrap_success(self, mock_ensure):
        """Test successful bootstrap."""
        response = client.post("/api/bootstrap")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        mock_ensure.assert_called_once()

    @patch("app.ensure_made_structure")
    def test_bootstrap_error(self, mock_ensure):
        """Test bootstrap error handling."""
        mock_ensure.side_effect = Exception("Bootstrap error")

        response = client.post("/api/bootstrap")

        assert response.status_code == 500
        assert "Bootstrap error" in response.json()["detail"]


class TestAgentMessageValidation:
    """Test agent message validation across endpoints."""

    def test_repository_agent_no_message(self):
        """Test repository agent without message."""
        response = client.post("/api/repositories/test-repo/agent", json={})

        assert response.status_code == 400
        assert "Message is required" in response.json()["detail"]

    def test_knowledge_agent_no_message(self):
        """Test knowledge agent without message."""
        response = client.post("/api/knowledge/test-guide/agent", json={})

        assert response.status_code == 400
        assert "Message is required" in response.json()["detail"]

    def test_constitution_agent_no_message(self):
        """Test constitution agent without message."""
        response = client.post("/api/constitutions/test-const/agent", json={})

        assert response.status_code == 400
        assert "Message is required" in response.json()["detail"]

    def test_task_agent_no_message(self):
        """Test task agent without message."""
        response = client.post("/api/tasks/test-task/agent", json={})

        assert response.status_code == 400
        assert "Message is required" in response.json()["detail"]


class TestWorkflowEndpoints:
    @patch("app.read_workflows")
    def test_global_workflows_success(self, mock_read):
        mock_read.return_value = {"workflows": []}

        response = client.get("/api/workflows")

        assert response.status_code == 200
        assert response.json() == {"workflows": []}

    @patch("app.refresh_cron_clock")
    @patch("app.write_workflows")
    def test_save_global_workflows_success(self, mock_write, mock_refresh):
        mock_write.return_value = {"workflows": [{"id": "wf_1", "name": "x", "schedule": None, "steps": []}]}
        mock_refresh.return_value = {"running": True}

        response = client.put("/api/workflows", json={"workflows": []})

        assert response.status_code == 200
        mock_write.assert_called_once_with({"workflows": []}, None)
        mock_refresh.assert_called_once_with()

    @patch("app.get_cron_job_diagnostics")
    @patch("app.get_cron_job_last_runs")
    @patch("app.list_workspace_workflows")
    def test_workspace_workflows_success(self, mock_list, mock_last_runs, mock_diagnostics):
        mock_last_runs.return_value = {"sample:wf_1": "2026-01-02T03:04:05+00:00"}
        mock_diagnostics.return_value = {"sample:wf_1": {"lastExitCode": 0, "running": False}}
        mock_list.return_value = {"workflows": [{"repository": "sample", "id": "wf_1", "name": "Release", "enabled": True, "schedule": None}]}

        response = client.get("/api/workspace/workflows")

        assert response.status_code == 200
        assert response.json()["workflows"][0]["repository"] == "sample"
        mock_last_runs.assert_called_once_with()
        mock_diagnostics.assert_called_once_with()
        mock_list.assert_called_once_with(
            {"sample:wf_1": "2026-01-02T03:04:05+00:00"},
            {"sample:wf_1": {"lastExitCode": 0, "running": False}},
        )

    @patch("app.list_workflow_logs")
    def test_workflow_logs_success(self, mock_list_logs):
        mock_list_logs.return_value = [
            {
                "name": "made-nightly-20260325T120000Z-123.log",
                "location": "tmp",
                "path": "/tmp/made-harness-logs/made-nightly-20260325T120000Z-123.log",
                "sizeBytes": 42,
                "modifiedAt": "2026-03-25T12:00:00+00:00",
            }
        ]

        response = client.get("/api/workflow-logs")

        assert response.status_code == 200
        assert response.json()["logs"][0]["name"].startswith("made-")
        mock_list_logs.assert_called_once_with()

    @patch("app.read_workflow_log_tail")
    def test_workflow_log_tail_success(self, mock_read_log_tail):
        mock_read_log_tail.return_value = {
            "name": "made-nightly-20260325T120000Z-123.log",
            "location": "tmp",
            "path": "/tmp/made-harness-logs/made-nightly-20260325T120000Z-123.log",
            "tail": "line-1\nline-2",
        }

        response = client.get(
            "/api/workflow-logs/tmp/made-nightly-20260325T120000Z-123.log"
        )

        assert response.status_code == 200
        assert response.json()["tail"] == "line-1\nline-2"
        mock_read_log_tail.assert_called_once_with(
            "tmp", "made-nightly-20260325T120000Z-123.log", max_lines=20
        )

    @patch("app.read_workflows")
    @patch("app._repository_path")
    def test_repository_workflows_success(self, mock_repo_path, mock_read):
        mock_repo_path.return_value = "/workspace/repo"
        mock_read.return_value = {"workflows": []}

        response = client.get("/api/repositories/sample/workflows")

        assert response.status_code == 200
        mock_read.assert_called_once_with("sample")

    @patch("app.refresh_cron_clock")
    @patch("app.write_workflows")
    @patch("app._repository_path")
    def test_save_repository_workflows_success(
        self, mock_repo_path, mock_write, mock_refresh
    ):
        mock_repo_path.return_value = "/workspace/repo"
        mock_write.return_value = {"workflows": []}
        mock_refresh.return_value = {"running": True}

        response = client.put("/api/repositories/sample/workflows", json={"workflows": []})

        assert response.status_code == 200
        mock_write.assert_called_once_with({"workflows": []}, "sample")
        mock_refresh.assert_called_once_with()

    @patch("app.refresh_cron_clock")
    def test_update_cron_jobs_success(self, mock_refresh):
        mock_refresh.return_value = {"running": True, "configuredJobs": 2}

        response = client.post("/api/cron/update")

        assert response.status_code == 200
        assert response.json()["running"] is True
        mock_refresh.assert_called_once_with()

    @patch("app.refresh_cron_clock")
    def test_update_cron_jobs_error(self, mock_refresh):
        mock_refresh.side_effect = Exception("Cron refresh failed")

        response = client.post("/api/cron/update")

        assert response.status_code == 500
        assert "Cron refresh failed" in response.json()["detail"]


class TestVersionEndpoint:
    """Test the /api/version endpoint."""

    def test_version_returns_version_string(self):
        """Version endpoint returns a version field."""
        response = client.get("/api/version")

        assert response.status_code == 200
        data = response.json()
        assert "version" in data
        assert isinstance(data["version"], str)
        assert len(data["version"]) > 0

    def test_version_includes_metadata_fields(self):
        """Version endpoint returns all required metadata fields."""
        response = client.get("/api/version")

        data = response.json()
        assert "commit_sha" in data
        assert "build_date" in data
        assert "environment" in data
