"""
Unit tests for the MADE Python Backend API endpoints.
Tests cover all main API endpoints with proper mocking of services.
"""

import json
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, Mock

from agent_service import ChannelBusyError

from app import app

client = TestClient(app)


class TestHealthEndpoint:
    """Test the health check endpoint."""

    @patch('app.get_workspace_home')
    @patch('app.get_made_directory')
    def test_health_check_success(self, mock_made_dir, mock_workspace_home):
        """Test successful health check."""
        mock_workspace_home.return_value = "/test/workspace"
        mock_made_dir.return_value = "/test/made"
        
        response = client.get("/api/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["workspace"] == "/test/workspace"
        assert data["made"] == "/test/made"


class TestDashboardEndpoint:
    """Test the dashboard endpoint."""

    @patch('app.get_dashboard_summary')
    def test_dashboard_success(self, mock_dashboard):
        """Test successful dashboard retrieval."""
        mock_data = {"repositories": 5, "knowledge": 3, "constitutions": 2}
        mock_dashboard.return_value = mock_data
        
        response = client.get("/api/dashboard")
        
        assert response.status_code == 200
        assert response.json() == mock_data

    @patch('app.get_dashboard_summary')
    def test_dashboard_error(self, mock_dashboard):
        """Test dashboard error handling."""
        mock_dashboard.side_effect = Exception("Dashboard error")
        
        response = client.get("/api/dashboard")
        
        assert response.status_code == 500
        assert "Dashboard error" in response.json()["detail"]


class TestRepositoryEndpoints:
    """Test repository-related endpoints."""

    @patch('app.list_repositories')
    def test_list_repositories_success(self, mock_list):
        """Test successful repository listing."""
        mock_repos = ["repo1", "repo2", "repo3"]
        mock_list.return_value = mock_repos
        
        response = client.get("/api/repositories")
        
        assert response.status_code == 200
        data = response.json()
        assert data["repositories"] == mock_repos

    @patch('app.list_repositories')
    def test_list_repositories_error(self, mock_list):
        """Test repository listing error."""
        mock_list.side_effect = Exception("List error")
        
        response = client.get("/api/repositories")
        
        assert response.status_code == 500

    @patch('app.create_repository')
    def test_create_repository_success(self, mock_create):
        """Test successful repository creation."""
        mock_create.return_value = {"name": "test-repo", "created": True}
        
        response = client.post("/api/repositories", json={"name": "test-repo"})
        
        assert response.status_code == 201
        mock_create.assert_called_once_with("test-repo")

    def test_create_repository_no_name(self):
        """Test repository creation without name."""
        response = client.post("/api/repositories", json={})
        
        assert response.status_code == 400
        assert "Repository name is required" in response.json()["detail"]

    @patch('app.create_repository')
    def test_create_repository_invalid_name(self, mock_create):
        """Test repository creation with invalid name."""
        mock_create.side_effect = ValueError("Invalid repository name")

        response = client.post("/api/repositories", json={"name": "invalid name"})

        assert response.status_code == 400
        assert "Invalid repository name" in response.json()["detail"]

    @patch('app.clone_repository')
    def test_clone_repository_success(self, mock_clone):
        """Test successful repository cloning."""
        mock_clone.return_value = {"name": "cloned-repo"}

        response = client.post(
            "/api/repositories/clone",
            json={"url": "https://example.com/cloned.git", "name": "custom"},
        )

        assert response.status_code == 201
        mock_clone.assert_called_once_with("https://example.com/cloned.git", "custom")

    def test_clone_repository_missing_url(self):
        """Test cloning without providing URL."""
        response = client.post("/api/repositories/clone", json={})

        assert response.status_code == 400
        assert "Repository URL is required" in response.json()["detail"]

    @patch('app.clone_repository')
    def test_clone_repository_failure(self, mock_clone):
        """Test cloning failure handling."""
        mock_clone.side_effect = ValueError("Failed to clone repository")

        response = client.post(
            "/api/repositories/clone",
            json={"url": "https://example.com/sample.git"},
        )

        assert response.status_code == 400
        assert "Failed to clone repository" in response.json()["detail"]

    @patch('app.send_agent_message')
    def test_repository_agent_busy(self, mock_send):
        mock_send.side_effect = ChannelBusyError("busy")

        response = client.post(
            "/api/repositories/sample/agent", json={"message": "hello"}
        )

        assert response.status_code == 409
        assert "busy" in response.json()["detail"]

    @patch('app.get_channel_status')
    def test_repository_agent_status(self, mock_status):
        payload = {"processing": True, "startedAt": "2024-01-01T00:00:00Z"}
        mock_status.return_value = payload

        response = client.get("/api/repositories/sample/agent/status")

        assert response.status_code == 200
        assert response.json() == payload

    @patch('app.get_repository_info')
    def test_get_repository_info_success(self, mock_get_info):
        """Test successful repository info retrieval."""
        mock_info = {"name": "test-repo", "files": 5}
        mock_get_info.return_value = mock_info
        
        response = client.get("/api/repositories/test-repo")
        
        assert response.status_code == 200
        assert response.json() == mock_info

    @patch('app.get_repository_info')
    def test_get_repository_info_not_found(self, mock_get_info):
        """Test repository info for non-existent repo."""
        mock_get_info.side_effect = FileNotFoundError("Repository not found")
        
        response = client.get("/api/repositories/nonexistent")
        
        assert response.status_code == 404

    @patch('app.list_repository_files')
    def test_list_repository_files_success(self, mock_list_files):
        """Test successful repository files listing."""
        mock_files = ["file1.py", "file2.md", "dir/file3.txt"]
        mock_list_files.return_value = mock_files
        
        response = client.get("/api/repositories/test-repo/files")
        
        assert response.status_code == 200
        assert response.json() == mock_files

    @patch('app.read_repository_file')
    def test_read_repository_file_success(self, mock_read):
        """Test successful repository file reading."""
        mock_content = "File content here"
        mock_read.return_value = mock_content
        
        response = client.get("/api/repositories/test-repo/file?path=test.py")
        
        assert response.status_code == 200
        data = response.json()
        assert data["content"] == mock_content

    def test_read_repository_file_no_path(self):
        """Test reading repository file without path."""
        response = client.get("/api/repositories/test-repo/file")
        
        assert response.status_code == 422  # FastAPI validation error

    @patch('app.write_repository_file')
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
        response = client.put("/api/repositories/test-repo/file", json={"content": "test"})
        
        assert response.status_code == 400
        assert "File path is required" in response.json()["detail"]

    @patch('app.create_repository_file')
    def test_create_repository_file_success(self, mock_create):
        """Test successful repository file creation."""
        payload = {"path": "new.py", "content": "# New file"}
        
        response = client.post("/api/repositories/test-repo/file", json=payload)
        
        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True

    @patch('app.rename_repository_file')
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
        response = client.post("/api/repositories/test-repo/file/rename", json={"from": "old.py"})
        
        assert response.status_code == 400
        assert "Both from and to paths are required" in response.json()["detail"]

    @patch('app.delete_repository_file')
    def test_delete_repository_file_success(self, mock_delete):
        """Test successful repository file deletion."""
        payload = {"path": "delete.py"}
        
        response = client.request("DELETE", "/api/repositories/test-repo/file", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch('app.send_agent_message')
    def test_repository_agent_success(self, mock_agent):
        """Test successful repository agent interaction."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message"}
        
        response = client.post("/api/repositories/test-repo/agent", json=payload)
        
        assert response.status_code == 200
        mock_agent.assert_called_once_with("test-repo", "Test message")


class TestKnowledgeEndpoints:
    """Test knowledge-related endpoints."""

    @patch('app.list_knowledge_artefacts')
    def test_list_knowledge_success(self, mock_list):
        """Test successful knowledge listing."""
        mock_artefacts = ["guide1.md", "guide2.md"]
        mock_list.return_value = mock_artefacts
        
        response = client.get("/api/knowledge")
        
        assert response.status_code == 200
        data = response.json()
        assert data["artefacts"] == mock_artefacts

    @patch('app.read_knowledge_artefact')
    def test_read_knowledge_success(self, mock_read):
        """Test successful knowledge reading."""
        mock_data = {"frontmatter": {"title": "Guide"}, "content": "Content here"}
        mock_read.return_value = mock_data
        
        response = client.get("/api/knowledge/test-guide")
        
        assert response.status_code == 200
        assert response.json() == mock_data

    @patch('app.read_knowledge_artefact')
    def test_read_knowledge_not_found(self, mock_read):
        """Test reading non-existent knowledge."""
        mock_read.side_effect = FileNotFoundError("Knowledge not found")
        
        response = client.get("/api/knowledge/nonexistent")
        
        assert response.status_code == 404

    @patch('app.write_knowledge_artefact')
    def test_write_knowledge_success(self, mock_write):
        """Test successful knowledge writing."""
        payload = {"frontmatter": {"title": "Test"}, "content": "Test content"}
        
        response = client.put("/api/knowledge/test-guide", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch('app.send_agent_message')
    def test_knowledge_agent_success(self, mock_agent):
        """Test successful knowledge agent interaction."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message"}
        
        response = client.post("/api/knowledge/test-guide/agent", json=payload)
        
        assert response.status_code == 200
        mock_agent.assert_called_once_with("knowledge:test-guide", "Test message")


class TestConstitutionEndpoints:
    """Test constitution-related endpoints."""

    @patch('app.list_constitutions')
    def test_list_constitutions_success(self, mock_list):
        """Test successful constitution listing."""
        mock_constitutions = ["const1.md", "const2.md"]
        mock_list.return_value = mock_constitutions
        
        response = client.get("/api/constitutions")
        
        assert response.status_code == 200
        data = response.json()
        assert data["constitutions"] == mock_constitutions

    @patch('app.read_constitution')
    def test_read_constitution_success(self, mock_read):
        """Test successful constitution reading."""
        mock_data = {"frontmatter": {"title": "Rules"}, "content": "Rules here"}
        mock_read.return_value = mock_data
        
        response = client.get("/api/constitutions/test-const")
        
        assert response.status_code == 200
        assert response.json() == mock_data

    @patch('app.write_constitution')
    def test_write_constitution_success(self, mock_write):
        """Test successful constitution writing."""
        payload = {"frontmatter": {"title": "Rules"}, "content": "New rules"}
        
        response = client.put("/api/constitutions/test-const", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

    @patch('app.send_agent_message')
    def test_constitution_agent_success(self, mock_agent):
        """Test successful constitution agent interaction."""
        mock_agent.return_value = {"response": "Agent response"}
        payload = {"message": "Test message"}
        
        response = client.post("/api/constitutions/test-const/agent", json=payload)
        
        assert response.status_code == 200
        mock_agent.assert_called_once_with("constitution:test-const", "Test message")


class TestSettingsEndpoints:
    """Test settings-related endpoints."""

    @patch('app.read_settings')
    def test_read_settings_success(self, mock_read):
        """Test successful settings reading."""
        mock_settings = {"theme": "dark", "language": "en"}
        mock_read.return_value = mock_settings
        
        response = client.get("/api/settings")
        
        assert response.status_code == 200
        assert response.json() == mock_settings

    @patch('app.write_settings')
    def test_write_settings_success(self, mock_write):
        """Test successful settings writing."""
        mock_write.return_value = {"success": True}
        payload = {"theme": "light", "language": "en"}
        
        response = client.put("/api/settings", json=payload)
        
        assert response.status_code == 200
        mock_write.assert_called_once_with(payload)


class TestBootstrapEndpoint:
    """Test bootstrap endpoint."""

    @patch('app.ensure_made_structure')
    def test_bootstrap_success(self, mock_ensure):
        """Test successful bootstrap."""
        response = client.post("/api/bootstrap")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        mock_ensure.assert_called_once()

    @patch('app.ensure_made_structure')
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