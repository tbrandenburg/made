# Investigation: Security: Critical axios SSRF vulnerability (GHSA-3p68-rc4w-qgx5)

**Issue**: #373 (https://github.com/tbrandenburg/made/issues/373)
**Type**: CHORE
**Investigated**: 2026-04-10T04:15:00Z

### Assessment

| Metric     | Value   | Reasoning                                                                                              |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------ |
| Priority   | HIGH    | Critical severity SSRF vulnerability with CVSS score 9.3, must be addressed immediately              |
| Complexity | LOW     | Single dependency override fix, no code changes needed, follows established pattern in codebase        |
| Confidence | HIGH    | Clear root cause (transitive dependency), clear fix (npm override), reproducible via npm audit        |

---

## Problem Statement

Critical SSRF vulnerability in axios < 1.15.0 allows attackers to bypass NO_PROXY rules via hostname normalization, potentially exposing internal network services and credentials. The current codebase has axios@1.13.6 installed as a transitive dependency of `wait-on@9.0.4`.

---

## Analysis

### Root Cause / Change Rationale

axios is a transitive dependency (not directly declared) brought in by `wait-on@9.0.4` (a development tool). The installed version 1.13.6 is below the patched version 1.15.0. Since `wait-on` has not released an update with the fixed axios version, we must use npm overrides to force a safe axios version.

### Evidence Chain

WHY: `npm audit` reports critical vulnerability
↓ BECAUSE: `axios@1.13.6` is installed in node_modules
↓ BECAUSE: `wait-on@9.0.4` depends on `axios@^1.13.5` (transitive)
↓ ROOT CAUSE: No axios version override exists in `package.json`
Evidence: `package.json:24-27` - `"overrides"` section exists but lacks axios

### Affected Files

| File            | Lines | Action | Description                    |
| --------------- | ----- | ------ | ------------------------------ |
| `package.json`  | 24-27 | UPDATE | Add axios override to >=1.15.0 |

### Integration Points

- `wait-on@9.0.4` is used by `npm run dev` scripts (development dependency only)
- `axios` is NOT imported anywhere in application code
- CI runs `make security-audit` which includes `npm audit` (line 38 in `.github/workflows/tests.yml`)

### Git History

- **Pattern established**: Previous security vulnerabilities (picomatch, flatted, lodash) were fixed using `overrides` in `package.json`
- **Precedent**: Similar transitive dependency fixes used overrides approach

---

## Implementation Plan

### Step 1: Add axios override to package.json

**File**: `package.json`
**Lines**: 24-27
**Action**: UPDATE

**Current code:**

```json
"overrides": {
  "picomatch": "4.0.4",
  "lodash": "4.18.1"
}
```

**Required change:**

```json
"overrides": {
  "axios": ">=1.15.0",
  "picomatch": "4.0.4",
  "lodash": "4.18.1"
}
```

**Why**: Forces all instances of axios (including transitive) to use patched version >=1.15.0

---

### Step 2: Regenerate package-lock.json

**Command**: `npm install`
**Effect**: Updates lockfile to resolve axios to 1.15.0+

---

## Patterns to Follow

**From codebase - existing overrides pattern:**

```json
// package.json:24-27 - Established pattern for transitive dependency fixes
"overrides": {
  "picomatch": "4.0.4",
  "lodash": "4.18.1"
}
```

---

## Edge Cases & Risks

| Risk/Edge Case       | Mitigation                                      |
| -------------------- | ----------------------------------------------- |
| wait-on update later | Override persists and is harmless when fixed   |
| Breaking change      | axios 1.15.0 is stable, no breaking changes    |
| CI cache             | May need cache clear on CI after lockfile update |

---

## Validation

### Automated Checks

```bash
# Verify vulnerability is resolved
npm audit

# Verify correct axios version is installed
npm ls axios

# Run full security audit (matches CI)
make security-audit
```

### Manual Verification

1. Run `npm audit` - should show "0 vulnerabilities"
2. Run `npm ls axios` - should show axios >=1.15.0
3. Verify `npm run dev` still works

---

## Scope Boundaries

**IN SCOPE:**

- Adding axios override to root `package.json`
- Regenerating `package-lock.json`

**OUT OF SCOPE (do not touch):**

- Updating wait-on version (no newer version available with fixed axios)
- Any application code changes (axios not used in app code)

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-04-10T04:15:00Z
- **Artifact**: `.ghar/issues/issue-373.md`
