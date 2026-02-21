"""Unit tests for agent CLI setting configuration."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agent_service import get_agent_cli
from agent_cli import OpenCodeAgentCLI
from opencode_database_agent_cli import OpenCodeDatabaseAgentCLI
from copilot_agent_cli import CopilotAgentCLI
from kiro_agent_cli import KiroAgentCLI
from codex_agent_cli import CodexAgentCLI


class TestAgentCliSetting(unittest.TestCase):
    """Test agent CLI setting configuration and selection."""

    def test_agent_cli_setting_kiro_selection(self):
        """Test that 'kiro' setting returns KiroAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "settings.json"
            settings_file.write_text(json.dumps({"agentCli": "kiro"}))

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, KiroAgentCLI)

    def test_agent_cli_setting_opencode_selection(self):
        """Test that 'opencode' setting returns OpenCodeDatabaseAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "settings.json"
            settings_file.write_text(json.dumps({"agentCli": "opencode"}))

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, OpenCodeDatabaseAgentCLI)

    def test_agent_cli_setting_copilot_selection(self):
        """Test that 'copilot' setting returns CopilotAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "settings.json"
            settings_file.write_text(json.dumps({"agentCli": "copilot"}))

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, CopilotAgentCLI)

    def test_agent_cli_setting_opencode_legacy_selection(self):
        """Test that 'opencode-legacy' setting returns OpenCodeAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "settings.json"
            settings_file.write_text(json.dumps({"agentCli": "opencode-legacy"}))

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, OpenCodeAgentCLI)

    def test_agent_cli_setting_codex_selection(self):
        """Test that 'codex' setting returns CodexAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "settings.json"
            settings_file.write_text(json.dumps({"agentCli": "codex"}))

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, CodexAgentCLI)
                self.assertEqual(cli.cli_name, "codex")

    def test_agent_cli_setting_invalid_value_defaults_to_opencode(self):
        """Test that invalid agentCli values default to OpenCodeDatabaseAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "settings.json"
            settings_file.write_text(
                json.dumps({"agentCli": "kiro-cli"})
            )  # Invalid value

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, OpenCodeDatabaseAgentCLI)

    def test_agent_cli_setting_missing_defaults_to_opencode(self):
        """Test that missing agentCli setting defaults to OpenCodeDatabaseAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "settings.json"
            settings_file.write_text(json.dumps({}))  # No agentCli setting

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, OpenCodeDatabaseAgentCLI)

    def test_agent_cli_setting_file_error_defaults_to_opencode(self):
        """Test that settings file errors default to OpenCodeDatabaseAgentCLI."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_file = Path(temp_dir) / "nonexistent.json"

            with patch(
                "settings_service.get_settings_path", return_value=settings_file
            ):
                cli = get_agent_cli()
                self.assertIsInstance(cli, OpenCodeDatabaseAgentCLI)


if __name__ == "__main__":
    unittest.main()
