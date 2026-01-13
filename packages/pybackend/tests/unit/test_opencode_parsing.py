"""Unit tests for OpenCodeAgentCLI parsing functions."""

import unittest

from agent_cli import OpenCodeAgentCLI


class TestOpenCodeAgentCLIParsing(unittest.TestCase):
    """Test OpenCode CLI parsing functions."""

    def setUp(self):
        self.cli = OpenCodeAgentCLI()

    def test_extract_part_content_text(self):
        """Test _extract_part_content for text parts."""
        part = {"text": "Hello world"}
        result = self.cli._extract_part_content(part, "text")
        assert result == "Hello world"

    def test_extract_part_content_tool(self):
        """Test _extract_part_content for tool parts."""
        part = {"tool": "bash"}
        result = self.cli._extract_part_content(part, "tool")
        assert result == "bash"

        part = {"name": "search"}
        result = self.cli._extract_part_content(part, "tool_use")
        assert result == "search"

    def test_parse_opencode_output_simple(self):
        """Test _parse_opencode_output with simple text."""
        stdout = '{"type":"text","timestamp":1000,"sessionID":"ses_123","part":{"type":"text","text":"Hello"}}'
        session_id, parts = self.cli._parse_opencode_output(stdout)
        
        assert session_id == "ses_123"
        assert len(parts) == 1
        assert parts[0].text == "Hello"
        assert parts[0].part_type == "final"  # Single text is final
        assert parts[0].timestamp == 1000

    def test_parse_opencode_output_multiple_texts(self):
        """Test _parse_opencode_output with multiple text parts."""
        stdout = '\n'.join([
            '{"type":"text","timestamp":1000,"sessionID":"ses_123","part":{"text":"First"}}',
            '{"type":"text","timestamp":2000,"sessionID":"ses_123","part":{"text":"Second"}}',
        ])
        session_id, parts = self.cli._parse_opencode_output(stdout)
        
        assert session_id == "ses_123"
        assert len(parts) == 2
        assert parts[0].text == "First"
        assert parts[0].part_type == "thinking"  # First text is thinking
        assert parts[1].text == "Second"
        assert parts[1].part_type == "final"     # Last text is final

    def test_parse_opencode_output_with_tool(self):
        """Test _parse_opencode_output with tool usage."""
        stdout = '\n'.join([
            '{"type":"text","timestamp":1000,"sessionID":"ses_123","part":{"text":"Before"}}',
            '{"type":"tool_use","timestamp":1500,"sessionID":"ses_123","part":{"tool":"bash"}}',
            '{"type":"text","timestamp":2000,"sessionID":"ses_123","part":{"text":"After"}}',
        ])
        session_id, parts = self.cli._parse_opencode_output(stdout)
        
        assert len(parts) == 3
        assert parts[0].part_type == "thinking"
        assert parts[1].part_type == "tool"
        assert parts[1].text == "bash"
        assert parts[2].part_type == "final"

    def test_parse_session_table(self):
        """Test _parse_session_table parsing."""
        output = """Session ID                      Title                           Updated
───────────────────────────────────────────────────────────────────────────
ses_123abc                      Test session                    2025-01-01 10:00
ses_456def                      Another session                 2025-01-02 11:00"""
        
        sessions = self.cli._parse_session_table(output, 10)
        
        assert len(sessions) == 2
        assert sessions[0].session_id == "ses_123abc"
        assert sessions[0].title == "Test session"
        assert sessions[0].updated == "2025-01-01 10:00"

    def test_parse_agent_list(self):
        """Test _parse_agent_list parsing."""
        output = """build (primary)
  allow: read
  deny: write

plan (secondary)
  allow: think"""
        
        agents = self.cli._parse_agent_list(output)
        
        assert len(agents) == 2
        assert agents[0].name == "build"
        assert agents[0].agent_type == "primary"
        assert "allow: read" in agents[0].details
        assert agents[1].name == "plan"
        assert agents[1].agent_type == "secondary"

    def test_parse_export_messages(self):
        """Test _parse_export_messages parsing."""
        messages = [
            {
                "info": {"role": "user", "id": "msg_1"},
                "parts": [{"type": "text", "text": "Hello", "id": "part_1"}]
            },
            {
                "info": {"role": "assistant", "id": "msg_2"},
                "parts": [{"type": "text", "text": "Hi there", "id": "part_2"}]
            }
        ]
        
        history = self.cli._parse_export_messages(messages, None)
        
        assert len(history) == 2
        assert history[0].role == "user"
        assert history[0].content == "Hello"
        assert history[1].role == "assistant"
        assert history[1].content == "Hi there"

    def test_to_milliseconds(self):
        """Test _to_milliseconds conversion."""
        assert self.cli._to_milliseconds(1000) == 1000
        assert self.cli._to_milliseconds("1500") == 1500
        assert self.cli._to_milliseconds(1000.5) == 1000
        assert self.cli._to_milliseconds(None) is None
        assert self.cli._to_milliseconds("invalid") is None

    def test_resolve_message_timestamp(self):
        """Test _resolve_message_timestamp extraction."""
        message_info = {
            "time": {"created": 1000, "updated": 2000}
        }
        result = self.cli._resolve_message_timestamp(message_info)
        assert result == 1000  # Should pick 'created' first

    def test_resolve_part_timestamp(self):
        """Test _resolve_part_timestamp extraction."""
        part = {
            "time": {"end": 1500, "start": 1000},
            "timestamp": 2000
        }
        result = self.cli._resolve_part_timestamp(part, None)
        assert result == 1500  # Should pick 'end' from time first

        # Test fallback
        part_no_time = {"timestamp": 2000}
        result = self.cli._resolve_part_timestamp(part_no_time, None)
        assert result == 2000

        # Test fallback to provided fallback
        part_empty = {}
        result = self.cli._resolve_part_timestamp(part_empty, 3000)
        assert result == 3000


if __name__ == "__main__":
    unittest.main()
