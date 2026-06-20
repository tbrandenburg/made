#!/usr/bin/env bash
set -euo pipefail

FAILED=0
ROOT="$(cd "$(dirname "$0")" && pwd)"

check_exit() {
  local name="$1"
  local expected="$2"
  shift 2
  local actual=0
  "$@" > /dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo "  PASS: ${name} (exit ${actual})"
  else
    echo "  FAIL: ${name} — expected exit ${expected}, got ${actual}"
    FAILED=1
  fi
}

check_cmd() {
  local name="$1"
  local expected_text="$2"
  shift 2
  local output
  output="$("$@" 2>&1)" || true
  if echo "$output" | grep -qF "$expected_text"; then
    echo "  PASS: ${name}"
  else
    echo "  FAIL: ${name} — expected output to contain \"${expected_text}\""
    echo "       Output: $(echo "$output" | head -3)"
    FAILED=1
  fi
}

echo "=== Issue #515 Verification Tests ==="
echo ""

echo "--- AC4: npm install succeeds (stale-state guard) ---"
# MUST run FIRST to prevent stale-node_modules false positives in AC1-AC3
# Spec requires: AC4 must precede AC1/AC2/AC3
check_exit "AC4" 0 npm install --prefix "$ROOT"

echo ""
echo "--- AC1: form-data@4.0.6 resolved ---"
# MUST FAIL before fix: current version is 4.0.5
check_cmd "AC1" "form-data@4.0.6" npm ls form-data --all --prefix "$ROOT"

echo ""
echo "--- AC2: vite@8.0.16 resolved ---"
# MUST FAIL before fix: current version is 8.0.11
check_cmd "AC2" "vite@8.0.16" npm ls vite --prefix "$ROOT"

echo ""
echo "--- AC3: zero high-severity vulns ---"
# MUST FAIL before fix: 2 high vulns present (form-data, vite)
check_exit "AC3" 0 npm audit --audit-level=high --prefix "$ROOT"

echo ""
echo "--- AC7: npm ci succeeds (CI-path durability) ---"
# CI uses npm ci, not npm install. Validates lockfile consistency
# that npm install silently tolerates but npm ci rejects.
check_exit "AC7" 0 npm ci --prefix "$ROOT"

echo ""
echo "--- AC5: make qa-quick passes (regression guard) ---"
# Regression guard: must pass both before and after
check_exit "AC5" 0 make -C "$ROOT" qa-quick

echo ""
echo "--- AC6: scope constraint (only root package.json/package-lock.json changed) ---"
BASELINE=".opencode/package-lock.json packages/frontend/src/components/ChatWindow.test.tsx packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx"
MODIFIED="$(git diff --name-only HEAD 2>/dev/null || true)"
UNEXPECTED=""
for f in $MODIFIED; do
  case "$f" in
    verify-issue-515.sh) continue ;;
    package.json) continue ;;
    package-lock.json) continue ;;
  esac
  # Skip pre-existing baseline modifications
  skip=0
  for b in $BASELINE; do
    if [ "$f" = "$b" ]; then skip=1; break; fi
  done
  [ "$skip" -eq 1 ] && continue
  UNEXPECTED="$UNEXPECTED $f"
done
if [ -z "$UNEXPECTED" ]; then
  echo "  PASS: AC6 — no unexpected files changed"
else
  echo "  FAIL: AC6 — unexpected files:$UNEXPECTED"
  FAILED=1
fi

echo ""
echo "=== Summary ==="
echo "  Adversarial reordering: AC4 (npm install) runs FIRST to guard stale node_modules"
echo "  Adversarial addition:   AC7 (npm ci) validates CI-path lockfile durability"
echo "  Pre-fix expected failures: AC1, AC2, AC3"
echo "  Pre-fix expected passes:   AC4, AC5, AC7"
if [ "$FAILED" -eq 0 ]; then
  echo "  All tests pass (implementation likely already applied)"
else
  echo "  Some tests failed — implementation not yet applied (expected)"
fi
exit "$FAILED"
