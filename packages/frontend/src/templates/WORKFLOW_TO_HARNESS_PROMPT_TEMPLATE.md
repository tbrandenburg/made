# Workflow to Harness Script Generator

Create a single bash script for this workflow.

## Output requirements

1. Save the bash script in `.harness/{{WORKFLOW_FILE_NAME}}`.
2. Do not add any script parameters. The script must run without positional arguments.
3. Ignore workflow schedule metadata and execute only the listed steps sequentially.
4. Keep script sections readable and clearly mapped to the original workflow steps.
5. Verify the script with bash tools, but never execute the script for real.

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

- Run static checks only, for example:
  - `bash -n .harness/{{WORKFLOW_FILE_NAME}}`
  - `shellcheck .harness/{{WORKFLOW_FILE_NAME}}` (if available)
- Never execute `.harness/{{WORKFLOW_FILE_NAME}}`.
