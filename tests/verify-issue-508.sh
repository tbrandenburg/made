#!/usr/bin/env bash
set -euo pipefail

FAILED=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS_MARK="✅"
FAIL_MARK="❌"

check() {
  local name="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  ${PASS_MARK} PASS: ${name}"
  else
    echo "  ${FAIL_MARK} FAIL: ${name}"
    FAILED=1
  fi
}

check_text() {
  local name="$1"
  local expected="$2"
  local file="$3"
  if grep -qF "$expected" "$file"; then
    echo "  ${PASS_MARK} PASS: ${name}"
  else
    echo "  ${FAIL_MARK} FAIL: ${name} — expected text \"${expected}\" not found in ${file}"
    FAILED=1
  fi
}

check_not_text() {
  local name="$1"
  local unexpected="$2"
  local file="$3"
  if ! grep -qF "$unexpected" "$file"; then
    echo "  ${PASS_MARK} PASS: ${name}"
  else
    echo "  ${FAIL_MARK} FAIL: ${name} — unexpected text \"${unexpected}\" found in ${file}"
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
    echo "  ${PASS_MARK} PASS: ${name}"
  else
    echo "  ${FAIL_MARK} FAIL: ${name} — expected output to contain \"${expected_text}\""
    echo "       Output was: $(echo "$output" | head -3)"
    FAILED=1
  fi
}

check_exit() {
  local name="$1"
  local expected_exit="$2"
  shift 2
  local actual_exit=0
  "$@" > /dev/null 2>&1 || actual_exit=$?
  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "  ${PASS_MARK} PASS: ${name} (exit ${actual_exit})"
  else
    echo "  ${FAIL_MARK} FAIL: ${name} — expected exit ${expected_exit}, got ${actual_exit}"
    FAILED=1
  fi
}

echo "=== Issue #508 Verification Tests ==="
echo ""

echo "--- AC1: Override entry present ---"
check_text "AC1" '"shell-quote": "1.8.4"' "$ROOT/package.json"

echo ""
echo "--- AC6: Existing overrides preserved (4 individual assertions) ---"
check_text "AC6a — axios override unchanged" '"axios": ">=1.15.2"' "$ROOT/package.json"
check_text "AC6b — picomatch override unchanged" '"picomatch": "4.0.4"' "$ROOT/package.json"
check_text "AC6c — lodash override unchanged" '"lodash": "4.18.1"' "$ROOT/package.json"
check_text "AC6d — follow-redirects override unchanged" '"follow-redirects": ">=1.16.0"' "$ROOT/package.json"

echo ""
echo "--- AC9: npm version precondition ---"
check_exit "AC9" 0 sh -c 'npm --version | awk -F. "{ if (\$1 >= 8 && (\$1 > 8 || \$2 >= 11)) exit 0; exit 1 }"'

echo ""
echo "--- AC2: npm install succeeds ---"
check_exit "AC2" 0 npm install --prefix "$ROOT"

echo ""
echo "--- AC3/AC7: Clean-regeneration durability ---"
# Save current lockfile
cp "$ROOT/package-lock.json" "$ROOT/package-lock.json.bak" 2>/dev/null || true
rm -rf "$ROOT/node_modules" "$ROOT/package-lock.json"
npm install --prefix "$ROOT" > /dev/null 2>&1
check_cmd "AC3 — shell-quote@1.8.4 after clean reinstall" "shell-quote@1.8.4" npm ls shell-quote --all --prefix "$ROOT"
# Restore lockfile and node_modules
rm -rf "$ROOT/node_modules"
cp "$ROOT/package-lock.json.bak" "$ROOT/package-lock.json" 2>/dev/null || true
rm -f "$ROOT/package-lock.json.bak"
npm install --prefix "$ROOT" > /dev/null 2>&1

echo ""
echo "--- AC4: Security audit passes (output-decoupled) ---"
# Run make security-audit and check exit code BEFORE the || true guard
AUDIT_OUTPUT=$(make -C "$ROOT" security-audit 2>&1); AUDIT_EXIT=$?
echo "  security-audit exit code: $AUDIT_EXIT"
check_exit "AC4 — make security-audit exits 0" 0 test "$AUDIT_EXIT" -eq 0
check_text "AC4a — audit output contains 'Running security audits'" "Running security audits" <(echo "$AUDIT_OUTPUT")
check_text "AC4b — audit output contains 'Checking root'" "Checking root" <(echo "$AUDIT_OUTPUT")
check_not_text "AC4c — no 'critical' for shell-quote" "critical" <(echo "$AUDIT_OUTPUT")

echo ""
echo "--- AC8: Scope constraint ---"
MODIFIED_FILES="$(git diff --name-only HEAD 2>/dev/null || true)"
check_not_text "AC8 — only root package files modified" "packages/" <(echo "$MODIFIED_FILES")

echo ""
echo "--- AC5: Dev server smoke test ---"
# Reinstall node_modules (may have been removed by AC3 clean-regeneration test)
npm install --prefix "$ROOT" > /dev/null 2>&1
OUTPUT_FILE=$(mktemp)
npm run dev:frontend --prefix "$ROOT" > "$OUTPUT_FILE" 2>&1 &
DEV_PID=$!
sleep 15
check_exit "AC5a — dev server still running after 15s" 0 kill -0 $DEV_PID 2>/dev/null
check_not_text "AC5b — no ERR! in output" "ERR!" "$OUTPUT_FILE"
check_not_text "AC5c — no FATAL in output" "FATAL" "$OUTPUT_FILE"
if grep -qF "ready in" "$OUTPUT_FILE" || grep -qF "Local:" "$OUTPUT_FILE"; then
  echo "  ${PASS_MARK} PASS: AC5d — startup confirmation found"
else
  echo "  ${FAIL_MARK} FAIL: AC5d — neither 'ready in' nor 'Local:' found in output"
  FAILED=1
fi
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
rm -f "$OUTPUT_FILE"

echo ""
echo "=== Summary ==="
if [ "$FAILED" -eq 0 ]; then
  echo "  ${PASS_MARK} All tests passed!"
else
  echo "  ${FAIL_MARK} Some tests failed (expected before implementation)"
fi
exit "$FAILED"
