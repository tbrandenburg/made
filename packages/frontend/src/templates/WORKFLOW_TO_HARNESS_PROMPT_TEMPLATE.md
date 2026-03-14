# Strict Workflow → Bash Harness Generator (Deterministic Version)

This prompt generates **deterministic, production‑safe Bash harness
scripts** from a workflow YAML.

The goal is to eliminate common LLM mistakes such as:

-   unsafe quoting
-   use of `eval`
-   fragile pipelines
-   missing dependency checks
-   broken dry‑run behavior
-   command string execution
-   inconsistent step structure

The generated script must be **safe, reproducible, and
ShellCheck‑clean**.

------------------------------------------------------------------------

# Hard Requirements (MUST FOLLOW)

The generated Bash script **must satisfy all rules below**.

If any rule cannot be satisfied, the generator must **fail instead of
guessing**.

------------------------------------------------------------------------

# Script Output Location

The script MUST be written exactly to:

    {{WORKFLOW_SCRIPT_PATH}}

No alternative path may be used.

------------------------------------------------------------------------

# Supported CLI

Only generate commands for this CLI:

    {{CURRENT_AGENT_CLI}}

Do not generate commands for any other CLI.

------------------------------------------------------------------------

# Bash Environment Requirements

The script MUST start with:

``` bash
#!/usr/bin/env bash
set -euo pipefail
```

The script must be compatible with **Bash ≥ 4.0**.

------------------------------------------------------------------------

# Argument Handling

The script supports **exactly one optional argument**:

    --dry-run

Rules:

• No arguments → execute workflow normally
• `--dry-run` → simulate execution without running commands

Invalid arguments MUST:

1.  print a usage message
2.  exit with status **2**

Example valid invocations:

    script.sh
    script.sh --dry-run

Example invalid:

    script.sh --foo
    script.sh test

------------------------------------------------------------------------

# Required Helper Functions

The script MUST implement the following helpers:

### log()

Logging requirements:

• ISO‑8601 UTC timestamps
• levels: INFO, ERROR
• always log to stderr
• append to log file if writable

Example format:

    2026-01-01T12:00:00Z [INFO] message

Log destination preference:

1.  `/var/log/<workflow>.log`
2.  `/tmp/made-harness-logs/<workflow>.log`

If `/var/log` cannot be written, automatically fallback.

Logging failures **must never terminate the workflow**.

------------------------------------------------------------------------

### need_cmd()

Verify CLI dependency:

``` bash
command -v <cli> >/dev/null 2>&1
```

If missing → log error and exit.

------------------------------------------------------------------------

### run_step()

Responsible for dry‑run logic.

Parameters:

1.  description
2.  command array

Behavior:

Normal mode:

    "${cmd[@]}"

Dry‑run mode:

    printf '%q ' "${cmd[@]}"

Must not execute the command.

### run_agent()

Required for `type: agent` steps so prompt handling and CLI invocation stay
consistent.

Behavior:

• accept description, prompt, and command array inputs
• send prompt via `printf '%s'` (never `echo`)
• reuse `run_step()` for dry-run behavior and command execution
• return the underlying command exit code unchanged

### catch()

Optional centralized failure hook for step-level recovery/logging.

Behavior:

• accept step identifier and exit code
• log the failure to stderr (and log file via `log()`)
• must not hide failures unless workflow YAML explicitly models recovery

------------------------------------------------------------------------

# Command Construction Rules

The generator MUST follow these rules.

### Absolutely Forbidden

The script MUST NOT contain:

    eval
    sh -c
    command strings executed via variables

Exception:

• `bash -lc` is allowed **only** for workflow steps with `type: bash`, and
  only when executing the exact `run` value from the workflow YAML.

### Required Pattern

Commands must be stored as arrays:

``` bash
cmd=(opencode run --format json --agent build)
"${cmd[@]}"
```

This prevents quoting bugs and injection risks.

------------------------------------------------------------------------

# Step Type Mapping (MUST be exact)

Each workflow step type maps to a different execution path:

### `type: bash`

Treat `run` as a shell command to execute directly in Bash,
**not as an agent prompt**.

Required structure for bash steps:

``` bash
STEP1_DESCRIPTION='git switch main && git pull --rebase --autostash'
STEP1_RUN='git switch main && git pull --rebase --autostash'
cmd=(bash -lc "$STEP1_RUN")
run_step "$STEP1_DESCRIPTION" "${cmd[@]}"
```

Do NOT call `{{CURRENT_AGENT_CLI}}` for bash steps.

### `type: agent`

Treat `prompt` as the message to the configured agent CLI.

Required structure for agent steps:

``` bash
STEP2_DESCRIPTION='Follow issue instructions'
STEP2_PROMPT='Follow issue instructions'
cmd=(opencode run --format json --agent build)
RUN_STEP_PROMPT="$STEP2_PROMPT"
run_step "$STEP2_DESCRIPTION" "${cmd[@]}"
```

------------------------------------------------------------------------

# Prompt / Message Handling

Some agent CLIs accept messages through **stdin**.

The script MUST send prompts safely.

This section applies to `type: agent` steps only.

Forbidden:

    echo "$PROMPT"

Required:

    printf '%s' "$PROMPT"

Example:

``` bash
printf '%s' "$PROMPT" | opencode run --format json
```

Prompts may contain:

• quotes
• unicode
• newlines

The script must handle them correctly.

------------------------------------------------------------------------

# Workflow Execution Rules

The workflow YAML describes sequential steps.

Rules:

1.  Ignore schedules and metadata.
2.  Execute steps strictly in YAML order.
3.  Each step must be clearly mapped in the script.
4.  Step wrappers as functions (for example `step1()`, `step2()`) are allowed
    if behavior is preserved.

Preserved behavior means:

• same execution order as YAML
• same dry-run semantics
• same prompt delivery semantics for agent steps
• same non-zero exit status behavior (unless an explicit recovery step exists)

Required structure:

    # Step 1: <name>

    STEP1_DESCRIPTION="..."
    STEP1_PROMPT="..."

    cmd=( ... )

    run_step "$STEP1_DESCRIPTION" "${cmd[@]}"

Each step must follow the same structure.

------------------------------------------------------------------------

# CLI Invocation Reference

Generate commands only for the configured CLI.

------------------------------------------------------------------------

## opencode / opencode-legacy

Base command:

    opencode run --format json

Options:

    -s <session_id>
    --agent <agent_name>
    --model <model_name>

Message input: **stdin**

------------------------------------------------------------------------

## kiro

Base command:

    kiro-cli chat --no-interactive --trust-all-tools

Options:

    --resume
    --agent <agent_name>
    --model <model_name>

Message input: **stdin**

------------------------------------------------------------------------

## copilot

Base command:

    copilot -p "<message>" --allow-all-tools --silent

Options:

    --resume <session_id>

Message input: **-p flag**

------------------------------------------------------------------------

## codex

Base command:

    codex exec --json

Resume:

    codex exec resume <session_id> --json

Message input: **stdin**

------------------------------------------------------------------------

# Workflow YAML Input

``` yaml
{{WORKFLOW_YAML}}
```

Steps must be translated into Bash step sections.

------------------------------------------------------------------------

# Bash Template (Base)

The generator must start from this template and extend it safely.

``` bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="{{WORKFLOW_FILE_NAME}}"

DRY_RUN=false

LOG_DIR="/tmp/made-harness-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${SCRIPT_NAME%.sh}.log"

log() {
  local level="$1"; shift
  printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" >&2
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log ERROR "Missing dependency: $1"
    exit 1
  }
}

run_step() {
  local desc="$1"; shift
  local cmd=("$@")

  if [[ "$DRY_RUN" == true ]]; then
    log INFO "[DRY-RUN] $desc"
    printf '%q ' "${cmd[@]}"
    printf '\n'
  else
    log INFO "$desc"
    "${cmd[@]}"
  fi
}

log INFO "Starting workflow: {{WORKFLOW_NAME}}"

# Steps inserted here

log INFO "Workflow finished: {{WORKFLOW_NAME}}"
```

The template may be extended but must **not violate any safety rule**.

------------------------------------------------------------------------

# Verification Requirements

The generated script must pass:

    bash -n {{WORKFLOW_SCRIPT_PATH}}

If available:

    shellcheck {{WORKFLOW_SCRIPT_PATH}}

Then test dry‑run mode:

    {{WORKFLOW_SCRIPT_PATH}} --dry-run

The generator must **never run the workflow in real execution mode
during verification**.

------------------------------------------------------------------------

# Determinism Requirement

The generated script must:

• always follow the same structure
• never reorder steps
• never infer missing fields
• never invent new workflow fields

If the workflow YAML is incomplete, the generator must **fail rather
than guess**.
