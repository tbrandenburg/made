from pathlib import Path

import pytest

from workflow_harness_service import (
    WorkflowParseError,
    generate_workflow_harnesses,
    parse_workflow_payload,
    render_harness,
)


def sample_payload() -> dict:
    return {
        "workflows": [
            {
                "id": "wf_release_flow",
                "name": "Release Flow",
                "enabled": True,
                "schedule": None,
                "shellScriptPath": ".harness/release-flow.sh",
                "steps": [
                    {
                        "type": "vars",
                        "name": "Resolve SHA",
                        "values": {"GIT_SHA": "git rev-parse HEAD"},
                    },
                    {
                        "type": "bash",
                        "name": "Echo SHA",
                        "run": "echo \"$GIT_SHA\"\n",
                    },
                    {
                        "type": "agent",
                        "name": "Summarize",
                        "agent": "reviewer",
                        "prompt": "Summarize release notes\nwith bullets",
                    },
                ],
            }
        ]
    }


def test_render_harness_includes_logging_dry_run_and_agent_helpers():
    workflow = parse_workflow_payload(sample_payload()).workflows[0]

    harness = render_harness(workflow)

    assert "set -euo pipefail" in harness
    assert "DRY_RUN=false" in harness
    assert 'if [[ $# -eq 1 && "$1" == "--dry-run" ]]; then' in harness
    assert 'LOG_DIR="${FLOWSH_LOG_DIR:-.flowsh/logs}"' in harness
    assert "run_step() {" in harness
    assert "run_stateful_step() {" in harness
    assert "run_agent() {" in harness
    assert 'cmd+=(--agent "$agent")' in harness
    assert "Step 1 (vars): Resolve SHA" in harness
    assert "Step 2 (bash): Echo SHA" in harness
    assert "Step 3 (agent): Summarize" in harness
    assert "run_stateful_step step_resolve_sha" in harness
    assert "run_step step_echo_sha" in harness
    assert "run_step step_summarize" in harness
    assert "prompt=$(cat <<'PROMPT_EOF'" in harness


def test_generate_workflow_harnesses_writes_executable_file(tmp_path: Path):
    payload = sample_payload()

    written = generate_workflow_harnesses(payload, tmp_path)

    assert written == [".harness/release-flow.sh"]
    output_path = tmp_path / ".harness/release-flow.sh"
    assert output_path.exists()
    assert output_path.read_text(encoding="utf-8").startswith("#!/usr/bin/env bash\n")
    assert output_path.stat().st_mode & 0o111


def test_parse_workflow_payload_rejects_duplicate_workflow_ids():
    payload = sample_payload()
    duplicate = payload["workflows"][0].copy()
    duplicate["shellScriptPath"] = ".harness/other.sh"
    payload["workflows"].append(duplicate)

    with pytest.raises(WorkflowParseError, match="duplicate workflow ids"):
        parse_workflow_payload(payload)
