"""Regression tests for the rendered MADE Lite transcript."""

import re
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader, select_autoescape


def render_repo(messages: list[dict[str, str]]) -> str:
    directory = Path(__file__).resolve().parents[2] / "templates"
    environment = Environment(
        loader=FileSystemLoader(directory), autoescape=select_autoescape()
    )
    return environment.get_template("lite_repo.html").render(
        name="example",
        sessions=[],
        current_session_id="",
        agents=[],
        model_options=[],
        messages=messages,
    )


def test_transcript_renders_each_role_and_type_once_in_reverse_order() -> None:
    rendered = render_repo(
        [
            {"role": "user", "type": "text", "content": "user-marker"},
            {"role": "assistant", "type": "text", "content": "agent-marker"},
            {"role": "assistant", "type": "tool", "content": "tool-marker"},
            {"role": "assistant", "type": "tool_use", "content": "use-marker"},
            {"role": "assistant", "type": "reasoning", "content": "reason-marker"},
        ]
    )
    blocks = re.findall(
        r'<div class="(msg-user|msg-agent|msg-tool)">\s*'
        r'<div class="msg-label">([^<]+)</div>\s*'
        r'<pre(?: class="msg-tool")?>(.*?)</pre>',
        rendered,
        re.DOTALL,
    )

    assert blocks == [
        ("msg-tool", "reasoning", "reason-marker"),
        ("msg-tool", "tool_use", "use-marker"),
        ("msg-tool", "tool", "tool-marker"),
        ("msg-agent", "Agent", "agent-marker"),
        ("msg-user", "You", "user-marker"),
    ]
    for marker in (
        "user-marker",
        "agent-marker",
        "tool-marker",
        "use-marker",
        "reason-marker",
    ):
        assert rendered.count(marker) == 1
    assert rendered.count('<div class="chat">') == 1
    assert "No messages yet." not in rendered


def test_empty_transcript_renders_one_empty_state() -> None:
    rendered = render_repo([])

    assert rendered.count("No messages yet.") == 1
    assert rendered.count('<div class="chat">') == 1
    assert "<pre" not in rendered


@pytest.mark.parametrize(
    "messages",
    [[], [{"role": "user", "type": "text", "content": "boundary-marker"}]],
    ids=["empty", "populated"],
)
def test_transcript_stays_inside_one_document(messages: list[dict[str, str]]) -> None:
    rendered = render_repo(messages)

    assert rendered.startswith("<!DOCTYPE html>")
    assert rendered.count("<html>") == rendered.count("</html>") == 1
    assert rendered.count("<body>") == rendered.count("</body>") == 1
    assert rendered.index("<body>") < rendered.index('<div class="chat">')
    assert rendered.split("</body>", 1)[1].strip() == "</html>"
    assert rendered.split("</html>", 1)[1].strip() == ""


def test_message_markup_is_escaped_once_without_breaking_document() -> None:
    rendered = render_repo(
        [
            {
                "role": "user",
                "type": "text",
                "content": '</pre></body></html><script>alert("marker")</script>&',
            }
        ]
    )

    escaped = (
        "&lt;/pre&gt;&lt;/body&gt;&lt;/html&gt;&lt;script&gt;"
        "alert(&#34;marker&#34;)&lt;/script&gt;&amp;"
    )
    assert rendered.count(escaped) == 1
    assert "<script>" not in rendered
    assert "&amp;lt;" not in rendered
    assert rendered.count("</body>") == rendered.count("</html>") == 1
