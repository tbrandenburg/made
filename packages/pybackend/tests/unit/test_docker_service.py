import json
import subprocess
from unittest.mock import MagicMock, patch

import pytest

from docker_service import list_running_containers


class TestListRunningContainers:
    @patch("docker_service.subprocess.run")
    def test_returns_full_id_and_short_id(self, mock_run):
        full_id = "a" * 64
        raw = {
            "ID": full_id,
            "Image": "nginx:latest",
            "Command": "nginx",
            "CreatedAt": "2026-06-25T12:00:00Z",
            "Status": "Up 3 minutes",
            "Ports": "",
            "Names": "my-nginx",
        }
        mock_run.return_value = MagicMock(
            stdout=json.dumps(raw) + "\n",
            returncode=0,
        )

        containers = list_running_containers()

        assert len(containers) == 1
        assert containers[0]["id"] == full_id          # 64-char full ID
        assert containers[0]["shortId"] == full_id[:12]  # 12-char prefix
        assert containers[0]["id"] != containers[0]["shortId"]

    @patch("docker_service.subprocess.run")
    def test_passes_no_trunc_flag(self, mock_run):
        """Verify --no-trunc is in the docker ps command."""
        mock_run.return_value = MagicMock(stdout="", returncode=0)

        list_running_containers()

        call_args = mock_run.call_args[0][0]
        assert "--no-trunc" in call_args

    @patch("docker_service.subprocess.run")
    def test_returns_empty_on_subprocess_error(self, mock_run):
        mock_run.side_effect = subprocess.SubprocessError("docker not found")

        result = list_running_containers()

        assert result == []

    @patch("docker_service.subprocess.run")
    def test_returns_empty_on_file_not_found(self, mock_run):
        mock_run.side_effect = FileNotFoundError("docker not installed")

        result = list_running_containers()

        assert result == []

    @patch("docker_service.subprocess.run")
    def test_skips_invalid_json_lines(self, mock_run):
        mock_run.return_value = MagicMock(
            stdout="not-json\n",
            returncode=0,
        )

        result = list_running_containers()

        assert result == []

    @patch("docker_service.subprocess.run")
    def test_returns_all_fields(self, mock_run):
        full_id = "b" * 64
        raw = {
            "ID": full_id,
            "Image": "redis:7",
            "Command": "redis-server",
            "CreatedAt": "2026-06-25T10:00:00Z",
            "Status": "Up 1 hour",
            "Ports": "6379/tcp",
            "Names": "my-redis",
        }
        mock_run.return_value = MagicMock(
            stdout=json.dumps(raw) + "\n",
            returncode=0,
        )

        containers = list_running_containers()

        c = containers[0]
        assert c["image"] == "redis:7"
        assert c["command"] == "redis-server"
        assert c["createdAt"] == "2026-06-25T10:00:00Z"
        assert c["status"] == "Up 1 hour"
        assert c["ports"] == "6379/tcp"
        assert c["names"] == "my-redis"
