# Strict Workflow → Bash Harness Generator (Deterministic Version)

This prompt generates **deterministic, production‑safe Bash harness
scripts** from a workflow YAML.

The goal is to eliminate common LLM mistakes such as:

- unsafe quoting
- use of `eval`
- fragile pipelines
- broken dry‑run behavior
- command string execution
- inconsistent step structure

The generated script must be **safe, reproducible, and
ShellCheck‑clean**.

---

# Hard Requirements (MUST FOLLOW)

The generated Bash script **must satisfy all rules below**.

If any rule cannot be satisfied, the generator must **fail instead of
guessing**.

---

# Script Output Location

The script MUST be written exactly to:

    {{WORKFLOW_SCRIPT_PATH}}

No alternative path may be used.

---

# Supported CLI

Only generate commands for this CLI:

    {{CURRENT_AGENT_CLI}}

Do not generate commands for any other CLI.

---

# Bash Environment Requirements

The script MUST start with:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

The script must be compatible with **Bash ≥ 4.0**.

---

# Argument Handling

The script supports **exactly one optional argument**:

    --dry-run

Rules:

• No arguments → execute workflow normally
• `--dry-run` → simulate execution without running commands

Invalid arguments MUST:

1.  print a usage message using `printf` to stderr
2.  exit with status **2**

Example valid invocations:

    script.sh
    script.sh --dry-run

Example invalid:

    script.sh --foo
    script.sh test

---

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

1.  `/var/log/made-[workflow-name]-[timestamp]-[PID].log`
2.  `/tmp/made-harness-logs/made-[workflow-name]-[timestamp]-[PID].log`

Required filename format:

`made-[workflow-name]-[timestamp]-[PID].log`

Where:

• `workflow-name` is slug-safe (lowercase letters, digits, `-`)
• `timestamp` uses UTC `YYYYMMDDTHHMMSSZ`
• `PID` is shell `$$`

If `/var/log` cannot be written, automatically fallback.

Logging failures **must never terminate the workflow**.

**Implementation**: The script must attempt `/var/log` first and fallback to `/tmp/made-harness-logs` if permission denied.

---

### run_step()

Responsible for dry‑run and failure handling at the step-function level.

Parameters:

1.  step function name

Behavior:

Normal mode:

    call the step function and return its exit code unchanged

Dry‑run mode:

    log which step would run and return success

Failure mode:

    if a step fails, call `catch <step_name> <exit_code>` and return the same
    non-zero exit code

### run_agent()

Required for `type: agent` steps so prompt handling and CLI invocation stay
consistent.

Behavior:

• accept prompt and optional agent as input parameters
• construct CLI command array internally based on `{{CURRENT_AGENT_CLI}}`
• include agent parameter in CLI command when provided and supported
• send prompt via `printf '%s'` (never `echo`)  
• keep dry-run behavior consistent with `run_step()`
• return the underlying command exit code unchanged

### catch()

Optional centralized failure hook for step-level recovery/logging.

Behavior:

• accept step identifier and exit code
• log the failure to stderr (and log file via `log()`)
• must not hide failures unless workflow YAML explicitly models recovery

---

# Command Construction Rules

The generator MUST follow these rules.

### Absolutely Forbidden

The script MUST NOT contain:

    eval
    sh -c
    command strings executed via variables

**Limited Exceptions:**

• `bash -c 'literal_string'` may be used if quoting or shell parsing needs to be explicit, but direct execution is preferred for bash functions.

• `bash -lc` should be avoided - use `bash -c` instead if needed.

### Required Pattern

**For agent CLI commands**, use arrays with template variables:

```bash
# CLI command should be generated from {{CURRENT_AGENT_CLI}} template variable
cmd=({{GENERATED_CLI_COMMAND}})
"${cmd[@]}"
```

This prevents quoting bugs and injection risks for dynamically constructed commands.

**For bash commands**, use direct execution within step functions.

**Note**: The specific CLI command array must be generated based on the configured `{{CURRENT_AGENT_CLI}}` using the CLI Invocation Reference section.

---

# Step Naming Convention

Generated step functions must follow this naming pattern:

• Use YAML step names when available: `name: build-project` → `step_build_project()`
• For unnamed steps, use sequential numbering: `step1()`, `step2()`, etc.
• Replace hyphens and spaces with underscores
• Ensure valid Bash function names (alphanumeric + underscore only)

---

# Step Type Mapping (MUST be exact)

Each workflow step type maps to a different execution path:

### `type: bash`

Treat `run` as a shell command to execute directly in Bash,
**not as an agent prompt**.

```bash
step1() {
  git switch main && git pull --rebase --autostash
}
run_step step1
```

**Note**: Direct execution in bash functions handles all shell features (pipes, redirects, conditionals, etc.) safely and cleanly.

**CRITICAL**: Execute bash commands directly in functions. Avoid string variables and unnecessary wrappers.

Do NOT call `{{CURRENT_AGENT_CLI}}` for bash steps.

### `type: agent`

Treat `prompt` as the message to the configured agent CLI.

Required structure for agent steps:

```bash
# CLI command must be generated based on {{CURRENT_AGENT_CLI}}
step2() {
  local prompt='Follow issue instructions'
  local agent='build'  # Optional: specify agent if different from default
  run_agent "$prompt" "$agent"
}
run_step step2
```

**Note**: The `run_agent` function must handle CLI command construction internally based on the configured `{{CURRENT_AGENT_CLI}}` and include the agent parameter when provided.

The `run_agent` function MUST be implemented to handle CLI command construction.

**Critical**: The CLI command array construction inside `run_agent` must use the CLI Invocation Reference for the configured `{{CURRENT_AGENT_CLI}}` and properly handle the agent parameter when supported.

---

# Prompt / Message Handling

Some agent CLIs accept messages through **stdin**.

The script MUST send prompts safely.

This section applies to `type: agent` steps only.

Forbidden:

    echo "$PROMPT"

Required:

    printf '%s' "$PROMPT"

Example (using configured CLI from {{CURRENT_AGENT_CLI}}):

```bash
# This example shows opencode, but actual CLI must be from template variable
printf '%s' "$PROMPT" | {{GENERATED_CLI_COMMAND}}
```

Prompts may contain:

• quotes
• unicode
• newlines

The script must handle them correctly.

---

# Workflow Execution Rules

The workflow YAML describes sequential steps.

Rules:

1.  Ignore schedules and metadata.
2.  Execute steps strictly in YAML order.
3.  Each step must be clearly mapped in the script.
4.  Use step wrappers as functions (for example `step1()`, `step2()`)

Preserved behavior means:

• same execution order as YAML
• same dry-run semantics
• same prompt delivery semantics for agent steps
• same non-zero exit status behavior (unless an explicit recovery step exists)

**Step Function Pattern:**

```bash
step1() {
  # Bash step: direct execution
  git switch main && git pull --rebase --autostash
}

step2() {
  # Agent step: local variables + run_agent call
  local prompt='Follow issue instructions'
  local agent='build'
  run_agent "$prompt" "$agent"
}

# Execute steps in YAML order
run_step step1
run_step step2
```

**Critical**: Each step function focuses on its specific task. The `run_step` wrapper handles dry-run logic and error management consistently.

---

# CLI Invocation Reference

Generate commands only for the configured CLI specified by `{{CURRENT_AGENT_CLI}}`.

The examples below show different CLI formats. The generator MUST use the appropriate CLI based on the template variable, NOT hardcode "opencode".

**Agent Parameter Mapping**: When the `run_agent` function receives an agent parameter, it must be mapped to the correct CLI option format:

- opencode/opencode-legacy: `--agent <agent_name>`
- kiro: `--agent <agent_name>`
- copilot: Not supported (ignore agent parameter)
- codex: Not supported (ignore agent parameter)

---

## opencode / opencode-legacy

Base command:

    opencode run --format json

Options:

    -s <session_id>
    --agent <agent_name>
    --model <model_name>

Message input: **stdin**

---

## kiro

Base command:

    kiro-cli chat --no-interactive --trust-all-tools

Options:

    --resume
    --agent <agent_name>
    --model <model_name>

Message input: **stdin**

---

## copilot

Base command:

    copilot -p "<message>" --allow-all-tools --silent

Options:

    --resume <session_id>

Message input: **-p flag**

---

## codex

Base command:

    codex exec --json

Resume:

    codex exec resume <session_id> --json

Message input: **stdin**

---

# Workflow YAML Input

```yaml
{ { WORKFLOW_YAML } }
```

Steps must be translated into Bash step sections.

---

# Bash Template (Base)

The generator must start from this template and extend it safely.

{{GENERATED_CLI_COMMAND}} must be constructed based on `{{CURRENT_AGENT_CLI}}`
and hints in "CLI Invocation Reference" chapter.

Adapt {{AGENT_PARAMETER_FORMAT}} when provided and supported by CLI.

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="{{WORKFLOW_FILE_NAME}}"
WORKFLOW_NAME="${SCRIPT_NAME%.sh}"
WORKFLOW_SLUG=$(printf '%s' "$WORKFLOW_NAME" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
LOG_TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
LOG_BASENAME="made-${WORKFLOW_SLUG}-${LOG_TIMESTAMP}-$$.log"

# Argument handling
DRY_RUN=false
if [[ $# -eq 1 && "$1" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ $# -gt 0 ]]; then
  printf "Usage: %s [--dry-run]\n" "$0" >&2
  exit 2
fi

# Try /var/log first, fallback to /tmp/made-harness-logs
if [[ -w "/var/log" ]]; then
  LOG_FILE="/var/log/${LOG_BASENAME}"
else
  LOG_DIR="/tmp/made-harness-logs"
  mkdir -p "$LOG_DIR"
  LOG_FILE="$LOG_DIR/${LOG_BASENAME}"
fi

log() {
  local level="$1"; shift
  local message
  message=$(printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*")
  printf '%s\n' "$message" >&2
  # Append to log file if writable, ignore errors
  printf '%s\n' "$message" >> "$LOG_FILE" 2>/dev/null || true
}

catch() {
  local step_name="$1"
  local exit_code="$2"
  log ERROR "Step failed: ${step_name} (exit=${exit_code})"
}

run_step() {
  local step_name="$1"

  if [[ "$DRY_RUN" == true ]]; then
    log INFO "[DRY-RUN] ${step_name}"
    return 0
  fi

  # Temporarily disable exit on error to handle failures gracefully
  set +e
  "$step_name"
  local status=$?
  set -e  # Re-enable exit on error

  if [[ $status -ne 0 ]]; then
    catch "$step_name" "$status"
  fi
  return "$status"
}

run_agent() {
  local prompt="$1"
  local agent="${2:-}"  # Optional agent parameter with default empty

  local cmd=({{GENERATED_CLI_COMMAND}})
  if [[ -n "$agent" ]]; then
    # Add agent parameter based on CLI type (e.g., --agent "$agent")
    cmd+=({{AGENT_PARAMETER_FORMAT}})
  fi

  if [[ "$DRY_RUN" == true ]]; then
    printf 'dry-run: %s\\n' "$(printf '%q ' "${cmd[@]}")"
    return 0
  fi

  printf '%s' "$prompt" | "${cmd[@]}"
}

log INFO "Starting workflow: {{WORKFLOW_NAME}}"

# Steps functions and step execution order inserted here

log INFO "Workflow finished: {{WORKFLOW_NAME}}"
```

The template may be extended but must **not violate any safety rule**.

---

# Verification Requirements

The generated script must pass:

    bash -n {{WORKFLOW_SCRIPT_PATH}}

If available:

    shellcheck {{WORKFLOW_SCRIPT_PATH}}

Then test dry‑run mode:

    {{WORKFLOW_SCRIPT_PATH}} --dry-run

The generator must **never run the workflow in real execution mode
during verification**.

---

# Determinism Requirement

The generated script must:

• always follow the same structure
• never reorder steps
• never infer missing fields
• never invent new workflow fields

If the workflow YAML is incomplete, the generator must **fail rather
than guess**.
