"""Regression tests for the rendered MADE Lite transcript."""

import re
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader, select_autoescape


def render_repo(
    messages: list[dict[str, str]],
    *,
    current_session_id: str = "ses_selected",
    history_error: bool = False,
    history_retry_url: str = "/lite/repo/example?session_id=ses_selected",
) -> str:
    directory = Path(__file__).resolve().parents[2] / "templates"
    environment = Environment(
        loader=FileSystemLoader(directory), autoescape=select_autoescape()
    )
    return environment.get_template("lite_repo.html").render(
        name="example",
        sessions=[],
        current_session_id=current_session_id,
        history_error=history_error,
        history_retry_url=history_retry_url,
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
    assert 'role="alert"' not in rendered
    assert "Retry history" not in rendered
    assert "Select a session and click Load" not in rendered


def test_empty_transcript_renders_one_empty_state() -> None:
    rendered = render_repo([])

    assert rendered.count("No messages yet.") == 1
    assert rendered.count('<div class="chat">') == 1
    assert "<pre" not in rendered
    assert "Select a session and click Load" not in rendered
    assert 'role="alert"' not in rendered
    assert "Retry history" not in rendered


def test_unselected_session_shows_guidance_and_explicit_load_form() -> None:
    rendered = render_repo([], current_session_id="")

    assert (
        rendered.count(
            "Select a session and click Load to view its history, "
            "or send a message to start a new session."
        )
        == 1
    )
    assert "No messages yet." not in rendered
    assert 'role="alert"' not in rendered
    assert "Retry history" not in rendered
    assert '<form method="GET" action="/lite/repo/example"' in rendered
    assert '<button type="submit">Load</button>' in rendered
    assert " selected" not in rendered
    assert "onchange" not in rendered
    assert "<script" not in rendered


@pytest.mark.parametrize("current_session_id", ["", "ses_selected"])
@pytest.mark.parametrize(
    "messages",
    [[], [{"role": "user", "type": "text", "content": "stale-message"}]],
    ids=["empty", "populated"],
)
def test_history_error_takes_precedence_over_other_states(
    current_session_id: str, messages: list[dict[str, str]]
) -> None:
    rendered = render_repo(
        messages, current_session_id=current_session_id, history_error=True
    )

    assert (
        rendered.count(
            '<p role="alert">Unable to load session history. Please retry.</p>'
        )
        == 1
    )
    assert (
        '<a href="/lite/repo/example?session_id=ses_selected">Retry history</a>'
        in rendered
    )
    assert "No messages yet." not in rendered
    assert "Select a session and click Load" not in rendered
    assert "stale-message" not in rendered
    assert "<pre" not in rendered


def test_retry_href_is_escaped_without_changing_percent_encoding() -> None:
    rendered = render_repo(
        [],
        history_error=True,
        history_retry_url='/lite/repo/example?session_id=ses_%2B%26&marker="<tag>"',
    )

    assert (
        '<a href="/lite/repo/example?session_id=ses_%2B%26'
        '&amp;marker=&#34;&lt;tag&gt;&#34;">Retry history</a>' in rendered
    )
    assert "<tag>" not in rendered
    assert "&amp;amp;" not in rendered


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
