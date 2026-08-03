import subprocess
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from workflow_harness_service import (
    WorkflowParseError,
    WorkflowVerificationError,
    generate_workflow_harnesses,
    parse_workflow_payload,
    render_harness,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


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


@patch("workflow_harness_service.subprocess.run")
def test_generate_workflow_harnesses_verifies_bash_and_dry_run(mock_run: Mock, tmp_path: Path):
    mock_run.side_effect = [
        Mock(returncode=0, stdout="", stderr=""),
        Mock(returncode=0, stdout="", stderr=""),
    ]

    generate_workflow_harnesses(sample_payload(), tmp_path)

    written_script = tmp_path / ".harness/release-flow.sh"
    assert mock_run.call_count == 2
    assert mock_run.call_args_list[0].args[0] == ["bash", "-n", str(written_script)]
    assert mock_run.call_args_list[1].args[0] == [str(written_script), "--dry-run"]


@patch("workflow_harness_service.subprocess.run")
def test_generate_workflow_harnesses_raises_on_dry_run_failure(mock_run: Mock, tmp_path: Path):
    mock_run.side_effect = [
        Mock(returncode=0, stdout="", stderr=""),
        Mock(returncode=1, stdout="", stderr="boom"),
    ]

    with pytest.raises(WorkflowVerificationError, match="script dry run failed"):
        generate_workflow_harnesses(sample_payload(), tmp_path)


def test_parse_workflow_payload_rejects_source_file():
    """Regression test for #541: sourceFile in payload must raise WorkflowParseError."""
    payload = sample_payload()
    payload["workflows"][0]["sourceFile"] = "workflows.yml"

    with pytest.raises(WorkflowParseError, match="sourceFile"):
        parse_workflow_payload(payload)


# ---------------------------------------------------------------------------
# Issue #727 Phase 0: safety-net tests (golden snapshot, live execution,
# adversarial parse errors) written against the engine BEFORE the flowsh-cli
# swap. These document pre-swap behavior and continue to enforce made's own
# contracts (function signatures, exception types, shellScriptPath guard)
# after the swap.
# ---------------------------------------------------------------------------


def test_render_harness_matches_pre_swap_golden_snapshot():
    """Documents exact pre-swap output. Not expected to survive the flowsh-cli swap."""
    workflow = parse_workflow_payload(sample_payload()).workflows[0]

    harness = render_harness(workflow)

    golden = (FIXTURES_DIR / "pre_swap_golden_harness.sh").read_text(encoding="utf-8")
    assert harness == golden


def test_generate_workflow_harnesses_runs_bash_dry_run_for_real(tmp_path: Path):
    """Live (non-mocked) subprocess execution of bash -n and --dry-run."""
    written = generate_workflow_harnesses(sample_payload(), tmp_path)

    script_path = tmp_path / written[0]

    syntax_check = subprocess.run(
        ["bash", "-n", str(script_path)], capture_output=True, text=True
    )
    assert syntax_check.returncode == 0, syntax_check.stderr

    dry_run = subprocess.run(
        [str(script_path), "--dry-run"], capture_output=True, text=True
    )
    assert dry_run.returncode == 0, dry_run.stderr


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda p: p["workflows"][0].__setitem__("steps", []), id="empty-steps"),
        pytest.param(
            lambda p: p["workflows"][0].__setitem__("id", "not-a-valid-id"), id="bad-id"
        ),
        pytest.param(
            lambda p: p["workflows"][0]["steps"][0].__setitem__(
                "values", {"git_sha": "git rev-parse HEAD"}
            ),
            id="lowercase-var-name",
        ),
        pytest.param(
            lambda p: p["workflows"][0].__setitem__(
                "shellScriptPath", ".harness/release-flow.txt"
            ),
            id="shell-script-path-wrong-extension",
        ),
        pytest.param(
            lambda p: p["workflows"][0].__setitem__(
                "shellScriptPath", ".harness/../escape.sh"
            ),
            id="shell-script-path-traversal",
        ),
    ],
)
def test_parse_workflow_payload_rejects_invalid_payloads(mutate):
    payload = sample_payload()
    mutate(payload)

    with pytest.raises(WorkflowParseError):
        parse_workflow_payload(payload)


def test_parse_workflow_payload_rejects_duplicate_workflow_ids_adversarial():
    """Explicit duplicate-id adversarial case kept alongside the others for grouping."""
    payload = sample_payload()
    duplicate = payload["workflows"][0].copy()
    duplicate["shellScriptPath"] = ".harness/other.sh"
    payload["workflows"].append(duplicate)

    with pytest.raises(WorkflowParseError, match="duplicate workflow ids"):
        parse_workflow_payload(payload)
