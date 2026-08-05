"""Single source of truth for the AI models offered in agent chat UIs.

Both the server-rendered "lite" chat UI (``lite_router.py``) and the
``/api/models`` endpoint consumed by the React frontend
(``RepositoryPage.tsx``) read from :data:`MODEL_OPTIONS` so the model list
only needs to be maintained in one place.

Each entry is ``(value, label, group)`` where ``group`` is ``None`` for
ungrouped models and a group name (e.g. ``"kiro"``, ``"opencode"``) for
models that should be visually grouped under a section header in the UI.
"""

from __future__ import annotations

ModelOption = tuple[str, str, str | None]

MODEL_OPTIONS: list[ModelOption] = [
    ("default", "default", None),
    ("claude-haiku-4.5", "claude-haiku-4.5", "kiro"),
    ("claude-opus-4.5", "claude-opus-4.5", "kiro"),
    ("claude-sonnet-4", "claude-sonnet-4", "kiro"),
    ("claude-sonnet-4.5", "claude-sonnet-4.5", "kiro"),
    ("opencode/big-pickle", "opencode/big-pickle", "opencode"),
    ("opencode/glm-4.7-free", "opencode/glm-4.7-free", "opencode"),
    ("opencode/gpt-5-nano", "opencode/gpt-5-nano", "opencode"),
    ("opencode/grok-code", "opencode/grok-code", "opencode"),
    ("github-copilot/claude-haiku-4.5", "github-copilot/claude-haiku-4.5", None),
    ("github-copilot/claude-opus-4.5", "github-copilot/claude-opus-4.5", None),
    ("github-copilot/claude-opus-4.6", "github-copilot/claude-opus-4.6", None),
    (
        "github-copilot/claude-opus-4.6-fast",
        "github-copilot/claude-opus-4.6-fast",
        None,
    ),
    ("github-copilot/claude-opus-4.7", "github-copilot/claude-opus-4.7", None),
    (
        "github-copilot/claude-opus-4.7-fast",
        "github-copilot/claude-opus-4.7-fast",
        None,
    ),
    ("github-copilot/claude-opus-4.8", "github-copilot/claude-opus-4.8", None),
    (
        "github-copilot/claude-opus-4.8-fast",
        "github-copilot/claude-opus-4.8-fast",
        None,
    ),
    ("github-copilot/claude-opus-5", "github-copilot/claude-opus-5", None),
    ("github-copilot/claude-sonnet-4.5", "github-copilot/claude-sonnet-4.5", None),
    ("github-copilot/claude-sonnet-4.6", "github-copilot/claude-sonnet-4.6", None),
    ("github-copilot/claude-sonnet-5", "github-copilot/claude-sonnet-5", None),
    ("github-copilot/gemini-2.5-pro", "github-copilot/gemini-2.5-pro", None),
    ("github-copilot/gemini-3.5-flash", "github-copilot/gemini-3.5-flash", None),
    ("github-copilot/gpt-5-mini", "github-copilot/gpt-5-mini", None),
    ("github-copilot/gpt-5.3-codex", "github-copilot/gpt-5.3-codex", None),
    ("github-copilot/gpt-5.4", "github-copilot/gpt-5.4", None),
    ("github-copilot/gpt-5.4-mini", "github-copilot/gpt-5.4-mini", None),
    ("github-copilot/gpt-5.5", "github-copilot/gpt-5.5", None),
    ("github-copilot/gpt-5.6-luna", "github-copilot/gpt-5.6-luna", None),
    ("github-copilot/gpt-5.6-sol", "github-copilot/gpt-5.6-sol", None),
    ("github-copilot/gpt-5.6-terra", "github-copilot/gpt-5.6-terra", None),
    ("github-copilot/kimi-k2.7-code", "github-copilot/kimi-k2.7-code", None),
    (
        "github-copilot/mai-code-1-flash-picker",
        "github-copilot/mai-code-1-flash-picker",
        None,
    ),
    ("openai/gpt-5.3-codex-spark", "openai/gpt-5.3-codex-spark", None),
    ("openai/gpt-5.4", "openai/gpt-5.4", None),
    ("openai/gpt-5.4-fast", "openai/gpt-5.4-fast", None),
    ("openai/gpt-5.4-mini", "openai/gpt-5.4-mini", None),
    ("openai/gpt-5.4-mini-fast", "openai/gpt-5.4-mini-fast", None),
    ("openai/gpt-5.5", "openai/gpt-5.5", None),
    ("openai/gpt-5.5-fast", "openai/gpt-5.5-fast", None),
    ("openai/gpt-5.6-luna", "openai/gpt-5.6-luna", None),
    ("openai/gpt-5.6-luna-fast", "openai/gpt-5.6-luna-fast", None),
    ("openai/gpt-5.6-sol", "openai/gpt-5.6-sol", None),
    ("openai/gpt-5.6-sol-fast", "openai/gpt-5.6-sol-fast", None),
    ("openai/gpt-5.6-terra", "openai/gpt-5.6-terra", None),
    ("openai/gpt-5.6-terra-fast", "openai/gpt-5.6-terra-fast", None),
]


def model_options_as_dicts() -> list[dict[str, str | None]]:
    """Return :data:`MODEL_OPTIONS` as JSON-friendly dicts for the API."""
    return [
        {"value": value, "label": label, "group": group}
        for value, label, group in MODEL_OPTIONS
    ]
