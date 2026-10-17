"""Opt-in real service/CLI acceptance. A skip is not acceptance evidence."""

import importlib
import os
from pathlib import Path
import sys

import pytest

from opencode_v2_agent_cli import OpenCodeV2AgentCLI

pytestmark = pytest.mark.skipif(
    os.environ.get("MADE_OPENCODE_V2_ACCEPTANCE") != "1",
    reason="requires the isolated acceptance runner; see docs/DOCKER.md",
)


def test_real_v2_cli_and_complete_http_history() -> None:
    sys.path.insert(0, "/acceptance-tools")
    scenario = importlib.import_module("scenario")
    manifest = scenario.prepare()
    adapter = OpenCodeV2AgentCLI()
    history = adapter.export_session(manifest["session"], Path("/workspace/repoA"))
    assert history.success and history.history_mode == "snapshot"
    assert any(manifest["first"] in message.content for message in history.messages)
    tools = [
        message for message in history.messages if message.content_type == "tool_use"
    ]
    assert tools and tools[0].call_id
    assert manifest["tool"] in "\n".join(message.content for message in tools)
    assert len({message.message_id for message in history.messages}) == len(
        history.messages
    )
    paginated = adapter.export_session(manifest["fixture"], Path("/workspace/repoA"))
    assert paginated.success and paginated.history_mode == "snapshot"
    assert [message.content for message in paginated.messages] == [
        "MADE779_PAGE_FIRST",
        "MADE779_PAGE_LAST",
    ]
    foreign = adapter.export_session(manifest["session"], Path("/workspace/repoB"))
    assert not foreign.success and foreign.messages == []
    assert foreign.error_code == "session_directory_mismatch"
