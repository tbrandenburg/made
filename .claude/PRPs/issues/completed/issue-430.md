# Investigation: 🚨 Security: fastapi 0.136.3 has Critical vulnerability (MAL-2026-4750)

**Issue**: #430 (https://github.com/tbrandenburg/made/issues/430)
**Type**: BUG
**Investigated**: 2026-05-27T00:00:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                    |
| ---------- | -------- | -------------------------------------------------------------------------------------------- |
| Severity   | CRITICAL | Supply-chain compromise via malicious code (CWE-506) — undocumented dependency `fastar>=0.9.0` is silently pulled, enabling arbitrary code execution at install time on developer and CI machines. |
| Complexity | LOW      | Single-file change: updating the version pin in `packages/pybackend/pyproject.toml:8` only. No logic changes, no new files, no integration risk. |
| Confidence | HIGH     | Root cause is a clearly documented CVE (MAL-2026-4750) with a known safe version range; current lockfile (`uv.lock`) confirms `fastapi 0.135.2` is safe, and the fix is a direct dependency version pin. |

---

## Problem Statement

The `fastapi` dependency in `packages/pybackend/pyproject.toml` is specified as `fastapi>=0.115.0`, which permits installation of version **0.136.3** (published 2026-05-23). Version 0.136.3 contains embedded malicious code (MAL-2026-4750) that silently adds an undocumented dependency `fastar>=0.9.0` to the `[standard]` extras group, creating a supply-chain / dependency-confusion attack vector. While the current `uv.lock` pins `fastapi 0.135.2` (safe), a `uv sync --upgrade` or lock-file regeneration would pull the malicious version.

---

## Analysis

### Root Cause / Change Rationale

The dependency specifier `fastapi>=0.115.0` in `pyproject.toml` is too permissive — it allows version 0.136.3 which contains malicious code. The fix is to constrain the version range to exclude the compromised version.

### Evidence Chain

WHY: Running `pip install "fastapi[standard]"` or `uv sync` could install malicious code
↓ BECAUSE: `pyproject.toml:8` specifies `fastapi>=0.115.0`, which includes version 0.136.3
Evidence: `packages/pybackend/pyproject.toml:8` - `"fastapi>=0.115.0"`

↓ BECAUSE: fastapi 0.136.3 (published 2026-05-23) contains CWE-506 embedded malicious code
Evidence: https://api.osv.dev/v1/vulns/MAL-2026-4750

↓ ROOT CAUSE: The version specifier does not exclude the malicious version
Evidence: `packages/pybackend/pyproject.toml:8` - `"fastapi>=0.115.0"`

### Affected Files

| File                              | Lines | Action | Description                                   |
| --------------------------------- | ----- | ------ | --------------------------------------------- |
| `packages/pybackend/pyproject.toml` | 8     | UPDATE | Pin fastapi to exclude malicious version      |

### Integration Points

- `packages/pybackend/uv.lock` currently locks `fastapi 0.135.2` (safe — not affected)
- `uv sync --upgrade` or lock-file regeneration would use the unrestricted specifier and could pull 0.136.3
- No other files in the repo reference fastapi directly

### Git History

- **Introduced**: Original dependency setup (initial commit) — the `>=0.115.0` constraint was set as a minimum-version specifier without an upper bound
- **Last modified**: Not modified since initial setup
- **Implication**: Long-standing permissive range that only became dangerous when the malicious 0.136.3 was published

---

## Implementation Plan

### Step 1: Update the fastapi version constraint

**File**: `packages/pybackend/pyproject.toml`
**Lines**: 8
**Action**: UPDATE

**Current code:**
```toml
  "fastapi>=0.115.0",
```

**Required change:**
```toml
  "fastapi>=0.136.1,<0.136.3",
```

**Why**: Excludes the malicious fastapi 0.136.3 while moving to the latest safe release line (0.136.x). Versions 0.136.1 and 0.136.2 are known safe versions that include the latest features and security patches.

### Step 2: Update the lockfile

**Run**:
```bash
cd packages/pybackend && uv sync
```

**Why**: Updates the lockfile (`uv.lock`) to reflect the new version constraint and locks the safe fastapi version.

### Step N: Verification

```bash
# Check that fastapi resolves to a safe version
grep -A5 'name = "fastapi"' packages/pybackend/uv.lock

# Ensure fastar is NOT a dependency
grep -c "fastar" packages/pybackend/uv.lock  # should output 0

# Run existing tests to confirm no regression
cd packages/pybackend && uv run python -m pytest
```

---

## Patterns to Follow

No new patterns needed — this is a standard dependency version pin, consistent with how all other dependencies are managed in `pyproject.toml`.

---

## Edge Cases & Risks

| Risk/Edge Case                              | Mitigation                             |
| ------------------------------------------- | -------------------------------------- |
| `>=0.136.1` forces upgrade from 0.135.2     | Acceptable — 0.136.x is a minor bump with backward-compatible changes; run tests to verify |
| A future safe 0.136.4+ would be excluded    | `0.136.3` is the only compromised version in the 0.136.x line; if future 0.136.4 is released and needed, the constraint can be relaxed to `>=0.136.1,!=0.136.3` |
| If project has explicit reason to stay on 0.115.x | Not applicable — current lock is 0.135.2 which already exceeds 0.115.0 |

---

## Validation

### Automated Checks

```bash
cd packages/pybackend && uv run python -m pytest
cd packages/pybackend && uv run ruff check .
```

### Manual Verification

1. Confirm `pip list | grep fastar` returns nothing
2. Confirm `uv tree` shows no fastar dependency

---

## Scope Boundaries

**IN SCOPE:**

- Fastapi version constraint in `packages/pybackend/pyproject.toml`
- Lockfile update to reflect safe fastapi version

**OUT OF SCOPE (do not touch):**

- Any other dependencies
- Application code changes
- CI/CD pipeline or Dockerfile changes
- Frontend or other packages

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-05-27T00:00:00Z
- **Artifact**: `.ghar/issues/issue-430.md`
