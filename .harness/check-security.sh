#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="check-security.sh"

DRY_RUN=false

# Argument handling
if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [--dry-run]\n' "$0" >&2
  exit 2
elif [[ $# -eq 1 ]]; then
  if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
  else
    printf 'Usage: %s [--dry-run]\n' "$0" >&2
    exit 2
  fi
fi

# Logging setup
LOG_DIR="/var/log"
if [[ ! -w "$LOG_DIR" ]]; then
  LOG_DIR="/tmp/made-harness-logs"
fi
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG_FILE="$LOG_DIR/${SCRIPT_NAME%.sh}.log"

log() {
  local level="$1"; shift
  local timestamp message
  timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  message="$timestamp [$level] $*"
  printf '%s\n' "$message" >&2
  if [[ -w "$LOG_DIR" ]]; then
    printf '%s\n' "$message" >> "$LOG_FILE" 2>/dev/null || true
  fi
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

# Dependency checks
need_cmd "opencode"

log INFO "Starting workflow: Check Security"

# Step 1: Check for critical npm security vulnerabilities via makefile

STEP1_DESCRIPTION="Check for critical npm security vulnerabilities via makefile.\n\nIf there are some, check if there are open Github issues regarding that.\n\nIf there are critical vulnerabilities and no open issues for that, create one and send me a Telegram message regarding that.\n\nIf there are open issues regarding that remind me to close them."
STEP1_PROMPT="Check for critical npm security vulnerabilities via makefile.

If there are some, check if there are open Github issues regarding that.

If there are critical vulnerabilities and no open issues for that, create one and send me a Telegram message regarding that.

If there are open issues regarding that remind me to close them."

cmd=(opencode run --format json --agent build)

printf '%s' "$STEP1_PROMPT" | run_step "$STEP1_DESCRIPTION" "${cmd[@]}"

log INFO "Workflow finished: Check Security"