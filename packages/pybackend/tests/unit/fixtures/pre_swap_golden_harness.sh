#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME='release-flow.sh'
WORKFLOW_NAME="${SCRIPT_NAME%.sh}"
WORKFLOW_SLUG=$(printf '%s' "$WORKFLOW_NAME" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
LOG_TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
LOG_BASENAME="flowsh-${WORKFLOW_SLUG}-${LOG_TIMESTAMP}-$$.log"

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------
DRY_RUN=false
if [[ $# -eq 1 && "$1" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ $# -gt 0 ]]; then
  printf "Usage: %s [--dry-run]\n" "$0" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Log file setup - local by default, override with FLOWSH_LOG_DIR
# ---------------------------------------------------------------------------
LOG_DIR="${FLOWSH_LOG_DIR:-.flowsh/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/${LOG_BASENAME}"

# ---------------------------------------------------------------------------
# log() — ISO-8601 UTC timestamps, INFO/ERROR, stderr + log file
# ---------------------------------------------------------------------------
log() {
  local level="$1"; shift
  local message
  message="$(date -u +'%Y-%m-%dT%H:%M:%SZ') [${level}] $*"
  printf '%s\n' "$message" >&2
  printf '%s\n' "$message" >> "$LOG_FILE" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# catch() — centralized step failure hook
# ---------------------------------------------------------------------------
catch() {
  local step_name="$1"
  local exit_code="$2"
  log ERROR "Step failed: ${step_name} (exit=${exit_code})"
}

# ---------------------------------------------------------------------------
# run_step() — dry-run and failure handling; streams output via tee
# ---------------------------------------------------------------------------
run_step() {
  local step_name="$1"

  if [[ "$DRY_RUN" == true ]]; then
    log INFO "[DRY-RUN] would run: ${step_name}"
    return 0
  fi

  log INFO "Running step: ${step_name}"

  set +e
  if ( : >> "$LOG_FILE" ) 2>/dev/null; then
    "$step_name" 2>&1 | tee -a "$LOG_FILE"
    local status=${PIPESTATUS[0]}
  else
    "$step_name"
    local status=$?
  fi
  set -e

  if [[ $status -ne 0 ]]; then
    catch "$step_name" "$status"
  fi
  return "$status"
}

# ---------------------------------------------------------------------------
# run_stateful_step() — dry-run and failure handling without subshells
# ---------------------------------------------------------------------------
run_stateful_step() {
  local step_name="$1"

  if [[ "$DRY_RUN" == true ]]; then
    log INFO "[DRY-RUN] would run: ${step_name}"
    return 0
  fi

  log INFO "Running step: ${step_name}"

  set +e
  "$step_name"
  local status=$?
  set -e

  if [[ $status -ne 0 ]]; then
    catch "$step_name" "$status"
  fi
  return "$status"
}

# ---------------------------------------------------------------------------
# run_agent() — prompt handling and OpenCode CLI invocation
# ---------------------------------------------------------------------------
run_agent() {
  local prompt="$1"
  local agent="${2:-}"

  local cmd=(opencode run --format json)
  if [[ -n "$agent" ]]; then
    cmd+=(--agent "$agent")
  fi

  if [[ "$DRY_RUN" == true ]]; then
    log INFO "[DRY-RUN] would run: $(printf '%q ' "${cmd[@]}") (with prompt)"
    return 0
  fi

  printf '%s' "$prompt" | "${cmd[@]}"
}

# ---------------------------------------------------------------------------
# Starting workflow: Release Flow
# ---------------------------------------------------------------------------
log INFO 'Starting workflow: Release Flow'

# ---------------------------------------------------------------------------
# Step 1 (vars): Resolve SHA
# ---------------------------------------------------------------------------
step_resolve_sha() {
  GIT_SHA=$(git rev-parse HEAD)
}
run_stateful_step step_resolve_sha

# ---------------------------------------------------------------------------
# Step 2 (bash): Echo SHA
# ---------------------------------------------------------------------------
step_echo_sha() {
  echo "$GIT_SHA"
}
run_step step_echo_sha

# ---------------------------------------------------------------------------
# Step 3 (agent): Summarize
# ---------------------------------------------------------------------------
step_summarize() {
  local prompt
  prompt=$(cat <<'PROMPT_EOF'
Summarize release notes
with bullets
PROMPT_EOF
  )
  local agent='reviewer'
  run_agent "$prompt" "$agent"
}
run_step step_summarize

# ---------------------------------------------------------------------------
# Workflow finished: Release Flow
# ---------------------------------------------------------------------------
log INFO 'Workflow finished: Release Flow'

