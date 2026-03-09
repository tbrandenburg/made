# Investigation: Fix remaining esbuild vulnerability (requires breaking vite upgrade)

**Issue**: #275 (https://github.com/tbrandenburg/made/issues/275)
**Type**: CHORE
**Investigated**: 2026-03-09T12:00:00Z

### Assessment

| Metric     | Value                         | Reasoning                                                                |
| ---------- | ----------------------------- | ------------------------------------------------------------------------ |
| Priority   | MEDIUM                        | Security issue but affects dev environment only; non-blocking in CI    |
| Complexity | LOW                           | Single file update (package.json), no integration changes required      |
| Confidence | HIGH                          | Standard npm dependency upgrade with clear compatibility matrix           |

---

## Problem Statement

There is 1 remaining moderate security vulnerability in the esbuild dependency that requires `npm audit fix --force` to fix. This will upgrade vite from v5.x to v6.x/v7.x, which is a breaking change that was intentionally deferred from PR #274 to avoid forcing breaking changes in the security fix.

---

## Analysis

### Root Cause / Change Rationale

**WHY**: Why does the esbuild vulnerability remain unfixed?
→ Because the fix requires upgrading vite to v6.x/v7.x, which is a breaking change
→ Evidence: `packages/frontend/package.json:43` - `"vite": "^5.2.10"`

**WHY**: Why is vite upgrade a breaking change?
→ Because vite 6.x/7.x have breaking changes from v5.x
→ The esbuild vulnerability (GHSA-67mh-4wv8-2f99) affects esbuild versions bundled with vite
→ Only fixed in vite 6.0+ which ships esbuild 0.24+

**ROOT CAUSE**: The pinned vite version ^5.2.10 bundles esbuild 0.22.x which has the vulnerability
→ Fix requires: Upgrade to vite ^6.0.0 or ^7.0.0 which bundles esbuild 0.24+

### Evidence Chain

**VULNERABILITY**: esbuild ≤0.24.2 - Enables any website to send requests to development server
↓ BECAUSE: vite 5.x bundles esbuild 0.22.x
↓ EVIDENCE: `packages/frontend/package.json:43` - `"vite": "^5.2.10"`
↓ ROOT CAUSE: Upgrade vite to 6.x/7.x to get esbuild 0.24+
↓ FIX: Update package.json to use `"vite": "^7.0.0"` (latest stable)

### Current Package Versions

| Package                | Current   | Required  |
| --------------------- | --------- | --------- |
| vite                  | ^5.2.10   | ^7.0.0    |
| @vitejs/plugin-react  | ^4.2.1    | ^5.1.4    |
| sass                  | ^1.77.5   | ^1.70.0+  |

**Note**: Current sass ^1.77.5 is already compatible with vite 7.x (requires sass ^1.70.0).

### Affected Files

| File                          | Lines | Action | Description                    |
| ----------------------------- | ----- | ------ | ------------------------------ |
| `packages/frontend/package.json` | 26-44 | UPDATE | Update vite and plugin versions |

### Compatibility Matrix

| @vitejs/plugin-react | vite supported    |
| ------------------- | ------------------ |
| ^4.2.1 (current)   | ^4.2.0, ^5.0.0     |
| ^5.1.4 (target)    | ^4.2.0, ^5.0.0, ^6.0.0, ^7.0.0 |

---

## Implementation Plan

### Step 1: Update package.json

**File**: `packages/frontend/package.json`
**Lines**: 26-44
**Action**: UPDATE

**Current code:**

```json
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.1",
    "@types/node": "^20.11.30",
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "@typescript-eslint/eslint-plugin": "^8.5.0",
    "@typescript-eslint/parser": "^8.5.0",
    "@vitejs/plugin-react": "^4.2.1",
    "eslint": "^9.5.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-react": "^7.34.1",
    "globals": "^15.6.0",
    "jsdom": "^27.4.0",
    "prettier": "^3.3.2",
    "sass": "^1.77.5",
    "typescript": "^5.4.5",
    "typescript-eslint": "^8.5.0",
    "vite": "^5.2.10",
    "vitest": "^1.6.0"
  }
```

**Required change:**

```json
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.1",
    "@types/node": "^20.11.30",
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "@typescript-eslint/eslint-plugin": "^8.5.0",
    "@typescript-eslint/parser": "^8.5.0",
    "@vitejs/plugin-react": "^5.1.4",
    "eslint": "^9.5.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-react": "^7.34.1",
    "globals": "^15.6.0",
    "jsdom": "^27.4.0",
    "prettier": "^3.3.2",
    "sass": "^1.77.5",
    "typescript": "^5.4.5",
    "typescript-eslint": "^8.5.0",
    "vite": "^7.0.0",
    "vitest": "^1.6.0"
  }
```

**Why**: @vitejs/plugin-react ^5.1.4 supports vite ^7.0.0, which bundles esbuild 0.24+ (vulnerability fixed).

---

### Step 2: Reinstall dependencies

**Command**: 
```bash
cd packages/frontend && rm -rf node_modules package-lock.json && npm install
```

**Why**: Force npm to resolve new versions and update lockfile.

---

### Step 3: Verify frontend builds

**Commands to run**:
```bash
npm run build     # Production build
npm run dev       # Dev server (quick smoke test)
npm run test      # Run tests
```

**Expected**: All commands succeed without errors.

---

### Step 4: Verify security audit passes

**Command**:
```bash
make security-audit
```

**Expected**: 0 vulnerabilities reported.

---

## Patterns to Follow

This is a standard npm dependency upgrade following semver. No special patterns needed.

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation      |
| -------------- | --------------- |
| Build fails after upgrade | Check vite.config.ts for deprecated options; vite 7 is largely backward compatible |
| Tests fail | Update any test assertions that depend on specific vite behavior |
| Dev server doesn't start | Check port 5173 is not in use; verify vite.config.ts syntax |

---

## Validation

### Automated Checks

```bash
cd packages/frontend
npm install
npm run build        # Production build
npm run test        # Unit tests
make security-audit  # Verify 0 vulnerabilities
```

### Manual Verification

1. Run `npm run dev` - verify dev server starts on port 5173
2. Run `npm run build` - verify production build succeeds
3. Run `make security-audit` - verify 0 vulnerabilities

---

## Scope Boundaries

**IN SCOPE:**
- Update vite to ^7.0.0 in package.json
- Update @vitejs/plugin-react to ^5.1.4 in package.json
- Reinstall node_modules
- Verify build and tests pass

**OUT OF SCOPE (do not touch):**
- Any changes to vite.config.ts (should be backward compatible)
- Other dependency updates
- CI workflow changes (security audit step was already noted as follow-up)

---

## Follow-up Actions (Post-Fix)

As mentioned in the issue, after fixing the vulnerability:

1. Remove `continue-on-error: true` from security audit CI step (if present)
2. Make security audit blocking again in `.github/workflows/tests.yml`
3. Verify `make security-audit` shows 0 vulnerabilities

**Note**: The current tests.yml does not have a security audit step - this may need to be added if desired.

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-03-09T12:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-275.md`