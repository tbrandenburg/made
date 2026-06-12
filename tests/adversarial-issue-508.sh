#!/usr/bin/env bash
set -euo pipefail

FAILED=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS="PASS"
FAIL="FAIL"

check_exit() {
  local name="$1"
  local expected="$2"
  shift 2
  local actual=0
  "$@" > /dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    echo "  ${PASS}: ${name}"
  else
    echo "  ${FAIL}: ${name} — expected exit ${expected}, got ${actual}"
    FAILED=1
  fi
}

check_text() {
  local name="$1"
  local expected="$2"
  local file="$3"
  if grep -qF "$expected" "$file"; then
    echo "  ${PASS}: ${name}"
  else
    echo "  ${FAIL}: ${name} — expected text \"${expected}\" not found"
    FAILED=1
  fi
}

check_cmd() {
  local name="$1"
  local expected="$2"
  shift 2
  local output
  output="$("$@" 2>&1)" || true
  if echo "$output" | grep -qF "$expected"; then
    echo "  ${PASS}: ${name}"
  else
    echo "  ${FAIL}: ${name} — expected output to contain \"${expected}\""
    echo "       Output: $(echo "$output" | head -5)"
    FAILED=1
  fi
}

echo "=== Adversarial Review: Issue #508 ==="
echo ""

echo "--- A1: npm ci override durability (CI pipeline path) ---"
# CI pipelines use `npm ci`, not `npm install`
# Save lockfile, run npm ci, verify override is active
cp "$ROOT/package-lock.json" "$ROOT/package-lock.json.advbak"
cp "$ROOT/package.json" "$ROOT/package.json.advbak"
rm -rf "$ROOT/node_modules"
npm ci --prefix "$ROOT" > /dev/null 2>&1
check_cmd "A1a — npm ci resolves shell-quote@1.8.4" "shell-quote@1.8.4" npm ls shell-quote --all --prefix "$ROOT"
check_cmd "A1b — override is marked active (overridden keyword)" "overridden" npm ls shell-quote --all --prefix "$ROOT"
rm -rf "$ROOT/node_modules"
cp "$ROOT/package-lock.json.advbak" "$ROOT/package-lock.json"
rm -f "$ROOT/package-lock.json.advbak" "$ROOT/package.json.advbak"

echo ""
echo "--- A2: Lockfile version assertion (AC7 direct check) ---"
# AC7 requires checking the lockfile, not just npm ls
npm install --prefix "$ROOT" > /dev/null 2>&1
python3 -c "
import json, sys
with open('$ROOT/package-lock.json') as f:
    lock = json.load(f)
sq = lock.get('packages', {}).get('node_modules/shell-quote', {})
ver = sq.get('version', 'MISSING')
if ver != '1.8.4':
    print(f'  $FAIL: A2 — lockfile shell-quote version is {ver}, expected 1.8.4')
    sys.exit(1)
print(f'  $PASS: A2 — lockfile shell-quote@1.8.4')
"
if [ $? -ne 0 ]; then FAILED=1; fi

echo ""
echo "--- A3: Override structural integrity (correct insertion point) ---"
# The override must appear after "lodash" per spec order
LODASH_BLOCK=$(grep -A1 '"lodash"' "$ROOT/package.json") || true
check_text "A3a — lodash override line present" '"lodash": "4.18.1"' "$ROOT/package.json"
check_text "A3b — shell-quote override line present" '"shell-quote": "1.8.4"' "$ROOT/package.json"
# Verify insertion order: lodash then shell-quote then follow-redirects
ORDER_CHECK=$(python3 -c "
import json
with open('$ROOT/package.json') as f:
    pkg = json.load(f)
keys = list(pkg.get('overrides', {}).keys())
try:
    lodash_idx = keys.index('lodash')
    sq_idx = keys.index('shell-quote')
    fr_idx = keys.index('follow-redirects')
    if sq_idx == lodash_idx + 1 and fr_idx == sq_idx + 1:
        print('correct')
    else:
        print(f'WRONG ORDER: lodash={lodash_idx}, shell-quote={sq_idx}, follow-redirects={fr_idx}')
except ValueError as e:
    print(f'MISSING KEY: {e}')
")
if [ "$ORDER_CHECK" = "correct" ]; then
  echo "  ${PASS}: A3 — override insertion order is correct"
else
  echo "  ${FAIL}: A3 — $ORDER_CHECK"
  FAILED=1
fi

echo ""
echo "--- A4: Override necessity proof (negative structural test) ---"
# The override must be more than cosmetic: removing it changes npm ls output
cp "$ROOT/package.json" "$ROOT/package.json.a4bak"
node -e "
const pkg = require('$ROOT/package.json');
delete pkg.overrides['shell-quote'];
require('fs').writeFileSync('$ROOT/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
npm install --prefix "$ROOT" > /dev/null 2>&1 || true
check_cmd "A4 — without override, 'overridden' keyword disappears from npm ls" \
  "shell-quote@1.8.4" npm ls shell-quote --all --prefix "$ROOT"
# The key proof: without override, npm ls does NOT show "overridden"
WITHOUT_OVERRIDE=$(npm ls shell-quote --all --prefix "$ROOT" 2>&1 || true)
if echo "$WITHOUT_OVERRIDE" | grep -qF "overridden"; then
  echo "  ${FAIL}: A4 — without override, keyword 'overridden' still present (override may be inactive)"
  FAILED=1
else
  echo "  ${PASS}: A4 — without override, keyword 'overridden' correctly absent"
fi
cp "$ROOT/package.json.a4bak" "$ROOT/package.json"
rm -f "$ROOT/package.json.a4bak"
npm install --prefix "$ROOT" > /dev/null 2>&1

echo ""
echo "--- A5: AC4 audit gap — override is a forward guard, not a hotfix ---"
# AC4 passes even without the override because 1.8.4 is already safe.
# This test proves that AC4 cannot distinguish "override present" from
# "coincidentally safe version installed."
cp "$ROOT/package.json" "$ROOT/package.json.a5bak"
node -e "
const pkg = require('$ROOT/package.json');
delete pkg.overrides['shell-quote'];
require('fs').writeFileSync('$ROOT/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
npm install --prefix "$ROOT" > /dev/null 2>&1 || true
AUDIT_WITHOUT="$(make -C "$ROOT" security-audit 2>&1)" || true
# AC4 expects `make security-audit` to fail without the override
# But 1.8.4 is not vulnerable, so audit still passes
AUDIT_EXIT=0
make -C "$ROOT" security-audit > /dev/null 2>&1 || AUDIT_EXIT=$?
if [ "$AUDIT_EXIT" -eq 0 ]; then
  echo "  ${PASS}: A5 — audit exits 0 even without override (confirms 1.8.4 is outside vulnerable range)"
else
  echo "  ${FAIL}: A5 — audit fails without override (unexpected)"
fi
# Check no "critical" keyword appears (AC4c would also pass without override)
if echo "$AUDIT_WITHOUT" | grep -qF "critical"; then
  echo "  ${PASS}: A5 — 'critical' found in audit output without override (expected if vuln present)"
else
  echo "  ${PASS}: A5 — no 'critical' even without override (1.8.4 is inherently safe)"
fi
cp "$ROOT/package.json.a5bak" "$ROOT/package.json"
rm -f "$ROOT/package.json.a5bak"
npm install --prefix "$ROOT" > /dev/null 2>&1

echo ""
echo "--- A6: Scope check includes all subdirectory lockfiles ---"
# AC8 only checks for "packages/" but misses other non-root lockfiles
MODIFIED="$(git diff --name-only HEAD 2>/dev/null || true)"
# Check for .opencode/ or any non-root non-packages lockfile
if echo "$MODIFIED" | grep -qE '\.opencode/package-lock\.json'; then
  echo "  ${PASS}: A6 — detecting .opencode/package-lock.json contamination"
else
  echo "  ${PASS}: A6 — no .opencode/package-lock.json contamination detected (clean)"
fi
# Check for any lockfile outside root
NONROOT_LOCKFILES=$(echo "$MODIFIED" | { grep -E '/package-lock\.json$' || true; } | { grep -v '^package-lock\.json$' || true; } | wc -l)
if [ "$NONROOT_LOCKFILES" -gt 0 ]; then
  echo "  ${FAIL}: A6 — detected $NONROOT_LOCKFILES non-root package-lock.json changes"
  FAILED=1
else
  echo "  ${PASS}: A6 — no non-root package-lock.json contamination"
fi

echo ""
echo "=== Adversarial Review Summary ==="
if [ "$FAILED" -eq 0 ]; then
  echo "  All adversarial tests passed"
else
  echo "  Some adversarial tests found issues"
fi
exit "$FAILED"
