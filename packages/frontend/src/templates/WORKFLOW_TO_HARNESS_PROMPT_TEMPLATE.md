# Workflow to Harness Script Generator

Create a single bash script for this workflow.

## Output requirements

1. Save the bash script in `{{WORKFLOW_SCRIPT_PATH}}`.
2. Support exactly one optional flag: `--dry-run`.
3. Without any parameter, the script should execute the workflow normally.
4. With `--dry-run`, print/log what would run without executing workflow actions.
5. Ignore workflow schedule metadata and execute only the listed steps sequentially.
6. Keep script sections readable and clearly mapped to the original workflow steps.
7. Verify the script with bash tools, and test only in dry-run mode.

## Current configured agent CLI

`{{CURRENT_AGENT_CLI}}`

## Supported agent CLI invocation reference (from made code)

- `opencode` and `opencode-legacy`
  - Base invocation: `opencode run --format json`
  - Optional session: `-s <session_id>`
  - Optional agent: `--agent <agent_name>`
  - Optional model: `--model <model_name>`
  - Message is sent through stdin.
- `kiro`
  - Base invocation: `kiro-cli chat --no-interactive --trust-all-tools`
  - Optional resume: `--resume`
  - Optional agent: `--agent <agent_name>`
  - Optional model: `--model <model_name>`
  - Message is sent through stdin.
- `copilot`
  - Base invocation: `copilot -p "<message>" --allow-all-tools --silent`
  - Optional resume: `--resume <session_id>`
- `codex`
  - Base invocation: `codex exec --json`
  - Optional resume: `codex exec resume <session_id> --json`
  - Message is sent through stdin.

Generate command calls only for the currently configured agent CLI (`{{CURRENT_AGENT_CLI}}`).

## Workflow script path

Use this exact script path when generating the harness script:

`{{WORKFLOW_SCRIPT_PATH}}`

## Workflow YAML

```yaml
{{WORKFLOW_YAML}}
```

## Bash file template (use and adapt)

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="{{WORKFLOW_FILE_NAME}}"
LOG_DIR="/tmp/made-harness-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${SCRIPT_NAME%.sh}.log"

if [[ -w /var/log ]]; then
  LOG_FILE="/var/log/${SCRIPT_NAME%.sh}.log"
fi

log() {
  local level="$1"
  shift
  printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" | tee -a "$LOG_FILE"
}

log "INFO" "Starting workflow: {{WORKFLOW_NAME}}"

# Step 1: ...
# Step 2: ...
# Keep one clear section per workflow step.

log "INFO" "Workflow finished: {{WORKFLOW_NAME}}"
```

## Verification requirements

- Run static checks:
  - `bash -n {{WORKFLOW_SCRIPT_PATH}}`
  - `shellcheck {{WORKFLOW_SCRIPT_PATH}}` (if available)
- Test dry-run behavior:
  - `{{WORKFLOW_SCRIPT_PATH}} --dry-run`
- Do not run full execution mode during verification.
