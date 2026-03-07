#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="news.sh"

# Argument handling - exactly one optional argument: --dry-run
DRY_RUN=false

case "${1:-}" in
  "")
    # No arguments - execute normally
    ;;
  "--dry-run")
    DRY_RUN=true
    ;;
  *)
    printf 'Usage: %s [--dry-run]\n' "$0" >&2
    printf '  --dry-run    Simulate execution without running commands\n' >&2
    exit 2
    ;;
esac

# Log file setup with fallback
LOG_DIR="/tmp/made-harness-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${SCRIPT_NAME%.sh}.log"

if [[ -w /var/log ]]; then
  LOG_FILE="/var/log/${SCRIPT_NAME%.sh}.log"
fi

# Required helper functions

log() {
  local level="$1"; shift
  {
    printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" >&2
    printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" >> "$LOG_FILE"
  } 2>/dev/null || {
    # If logging fails, continue workflow execution
    printf '%s [%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" >&2 2>/dev/null || true
  }
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

# Verify CLI dependency
need_cmd "opencode"

log INFO "Starting workflow: News"

# Step 1: Agent step with 'build' agent
STEP1_DESCRIPTION="Agent step (build): Philosophical news representation via Telegram"
STEP1_PROMPT="Schicke mir eine Telegram Nachricht mit einer philoshophischen Darstellung der tagesaktuellen Nachrichten."

cmd=(opencode run --format json --agent build)

if [[ "$DRY_RUN" == true ]]; then
  run_step "$STEP1_DESCRIPTION" "${cmd[@]}"
else
  log INFO "$STEP1_DESCRIPTION"
  printf '%s' "$STEP1_PROMPT" | "${cmd[@]}"
fi

log INFO "Workflow finished: News"