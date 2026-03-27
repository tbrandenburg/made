# Investigation: Security: Picomatch has HIGH severity ReDoS and Method Injection vulnerabilities

**Issue**: #312 (https://github.com/tbrandenburg/made/issues/312)
**Type**: CHORE
**Investigated**: 2026-03-27T06:15:00Z

### Assessment

| Metric     | Value                         | Reasoning                                                                                              |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Priority   | HIGH                          | HIGH severity security vulnerabilities (ReDoS and Method Injection) require immediate remediation     |
| Complexity | LOW                           | Single command fix (`npm audit fix`), no code changes required, low risk of breaking changes          |
| Confidence | HIGH                          | Vulnerability details are clear, fix is documented in npm audit output, toolchain supports automated fix |

---

## Problem Statement

The `picomatch` package (transitive dependency) has 2 HIGH severity security vulnerabilities that affect multiple packages in the frontend:
- **ReDoS via extglob quantifiers** (GHSA-c2c7-rcm5-vvqj) - Regular Expression Denial of Service
- **Method Injection in POSIX Character Classes** (GHSA-3v7f-55p6-f55p) - Security bypass via incorrect glob matching

These vulnerabilities affect picomatch versions <=2.3.1 and 4.0.0-4.0.3. Safe versions are 2.3.2+ or 4.0.4+.

---

## Analysis

### Root Cause / Change Rationale

picomatch is a **transitive dependency** pulled in by:
- `tinyglobby@1.2.1` → `picomatch@4.0.3` (VULNERABLE)
- `vitest@3.1.4` → `picomatch@4.0.3` (VULNERABLE)
- `vite@6.3.5` → `picomatch@4.0.3` (VULNERABLE)

These packages pin picomatch@4.0.3 as a dependency range that includes the vulnerable versions. npm cannot automatically update transitive dependencies, so we need to **add picomatch as a direct dependency with an overridden version**.

### Evidence Chain

WHY: `npm audit` reports picomatch vulnerabilities
↓ BECAUSE: picomatch@4.0.3 (and older) has known security flaws
↓ BECAUSE: tinyglobby, vitest, and vite depend on picomatch transitively without version pinning
↓ ROOT CAUSE: No direct dependency override to force a safe picomatch version
Evidence: `packages/frontend/package.json` - no picomatch override exists

### Affected Files

| File                           | Lines | Action | Description                              |
| ------------------------------ | ----- | ------ | ---------------------------------------- |
| `packages/frontend/package.json` | ALL   | UPDATE | Add picomatch override to force safe version |
| `package.json` | ALL   | UPDATE | Add root-level npm overrides for workspace |

### Integration Points

- npm package manager handles dependency resolution
- No code changes required - only dependency version override

### Git History

- **Not a regression** - this is a transitive dependency vulnerability that emerged as upstream packages updated

---

## Implementation Plan

### Step 1: Add npm overrides for picomatch

**File**: `package.json` (root)
**Action**: UPDATE

Add overrides section to root package.json for npm workspaces:
```json
{
  "overrides": {
    "picomatch": "4.0.4"
  }
}
```

**File**: `packages/frontend/package.json`
**Action**: UPDATE

Add picomatch as devDependency and overrides:
```json
{
  "devDependencies": {
    "picomatch": "^4.0.4"
  },
  "overrides": {
    "picomatch": "4.0.4"
  }
}
```

**Why**: npm overrides force all transitive dependencies to use the specified version. Using exact version "4.0.4" ensures consistency across all packages.

### Step 2: Reinstall dependencies

**Command**: `npm install` (from root)

This will:
1. Update all nested `node_modules` to use picomatch@4.0.4
2. Regenerate `package-lock.json`

### Step 3: Verify fix

**Command**: `npm audit`

Expected output: No picomatch vulnerabilities reported.

---

## Validation

### Automated Checks

```bash
# Run security audit (no flags = check everything)
npm audit

# Verify picomatch version
npm ls picomatch

# Run full test suite to ensure no regressions
npm test

# Verify build works
npm run build
```

### Manual Verification

1. Run `npm audit` - should show 0 vulnerabilities for picomatch
2. Run `npm test` - all tests should pass
3. Run `npm run build` - frontend should build successfully

---

## Scope Boundaries

**IN SCOPE:**

- Adding npm overrides for picomatch in package.json
- Running npm install to update lockfile
- Verifying fix with npm audit

**OUT OF SCOPE (do not touch):**

- Updating vite, vitest, or tinyglobby versions (unless needed for other reasons)
- Changes to Python backend
- Any code refactoring

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-03-27T06:15:00Z
- **Artifact**: `.ghar/issues/issue-312.md`
