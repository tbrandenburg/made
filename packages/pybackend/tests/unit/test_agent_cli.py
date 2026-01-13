from agent_cli import _parse_opencode_output


def test_parse_opencode_output_single_text_is_final():
    """Ensure a single text response is treated as the final message."""
    stdout = "\n".join(
        [
            '{"type":"text","timestamp":1766956199331,"sessionID":"ses_final","part":{"type":"text","text":"Final answer"}}',
        ]
    )

    session_id, parsed = _parse_opencode_output(stdout)

    assert session_id == "ses_final"
    assert [part.to_dict() for part in parsed] == [
        {"text": "Final answer", "timestamp": "2025-12-28T21:09:59.331Z", "type": "final"}
    ]
