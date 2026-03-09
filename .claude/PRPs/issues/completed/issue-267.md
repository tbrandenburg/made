# Investigation: 🔒 Security: Critical npm vulnerabilities detected in dependencies

**Issue**: #267 (https://github.com/tbrandenburg/made/issues/267)
**Type**: BUG
**Investigated**: 2026-03-09T15:00:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                                              |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Severity   | HIGH     | 4 high-severity vulnerabilities with DoS, file write, and prototype pollution risks affecting development toolchain   |
| Complexity | MEDIUM   | Affects 3 files (2 package.json, 1 Makefile), involves dependency updates but minimal code changes                    |
| Confidence | HIGH     | Clear evidence from npm audit, well-documented CVEs, and straightforward npm-based fixes available for 8/9 issues    |

---

## Problem Statement

The project has 9 npm security vulnerabilities (4 high, 5 moderate) in transitive dependencies that affect the development toolchain, including potential DoS attacks, arbitrary file writes, and prototype pollution vulnerabilities that could compromise development environment security.

---

## Analysis

### Root Cause / Change Rationale

The vulnerabilities exist because the project uses outdated versions of transitive dependencies through its development toolchain. All vulnerable packages are indirect dependencies, not directly specified in package.json files.

### Evidence Chain

**WHY**: Security vulnerabilities detected in npm dependencies
↓ **BECAUSE**: Transitive dependencies are using vulnerable versions
**Evidence**: `npm audit` output shows 9 vulnerabilities across axios, immutable, minimatch, rollup, ajv, and esbuild

↓ **BECAUSE**: No automated dependency updates or security monitoring in CI/CD
**Evidence**: `.github/workflows/tests.yml:1-100` - No security audit step; `Makefile:124-130` - Manual audit only checks critical level

↓ **BECAUSE**: Makefile security audit uses wrong severity level filtering
**Evidence**: `Makefile:127,129` - Uses `--audit-level critical` but current vulnerabilities are high/moderate

↓ **ROOT CAUSE**: Development dependencies haven't been updated and security process is insufficient
**Evidence**: Current vulnerable versions detected by audit vs. available fixed versions

### Affected Files

| File                          | Lines   | Action | Description                                     |
| ----------------------------- | ------- | ------ | ----------------------------------------------- |
| `package.json`                | 19-23   | UPDATE | Update root dev dependencies via npm audit fix  |
| `packages/frontend/package.json` | 25-45 | UPDATE | Update frontend dev dependencies via npm audit fix |
| `Makefile`                    | 127,129 | UPDATE | Fix audit level from critical to moderate       |
| `.github/workflows/tests.yml` | 35      | UPDATE | Add security audit step to CI pipeline         |

### Integration Points

- `wait-on@^7.2.0` (line 22) brings in vulnerable `axios@1.13.2`
- `vite@^5.2.10` (line 43) brings in vulnerable `rollup@4.53.3` and `esbuild@0.21.5`
- `sass@^1.77.5` (line 40) brings in vulnerable `immutable@5.1.4`
- `eslint@^9.5.0` and related packages bring in vulnerable `ajv@6.12.6` and `minimatch@3.1.2`

### Git History

- **Last Makefile change**: 87a4582 - 2024 - "fix: Added udot tatget"
- **security-audit target**: Present but incomplete (only checks critical level)
- **Implication**: Security audit was added but misconfigured to miss current vulnerabilities

---

## Implementation Plan

### Step 1: Fix Makefile security audit configuration

**File**: `Makefile`
**Lines**: 127, 129
**Action**: UPDATE

**Current code:**
```makefile
# Line 127
	npm audit --audit-level critical
# Line 129  
	cd packages/frontend && npm audit --audit-level critical
```

**Required change:**
```makefile
# Line 127
	npm audit --audit-level moderate
# Line 129
	cd packages/frontend && npm audit --audit-level moderate
```

**Why**: Current configuration only shows critical vulnerabilities but we have high/moderate ones that need addressing

---

### Step 2: Run npm audit fix for standard updates

**File**: Root and frontend dependencies
**Action**: COMMAND EXECUTION

**Commands to run:**
```bash
# Fix non-breaking dependency updates (8/9 vulnerabilities)
npm audit fix

# Verify fixes applied
make security-audit
```

**Why**: Most vulnerabilities have non-breaking fixes available that will resolve axios, immutable, minimatch, rollup, and ajv issues

---

### Step 3: Evaluate esbuild/vite breaking change

**File**: `packages/frontend/package.json` 
**Lines**: 43
**Action**: EVALUATE (not immediate update)

**Current vulnerable dependency:**
- `vite@^5.2.10` → Contains `esbuild@0.21.5` (vulnerable)

**Potential fix:**
```bash
# Would require force update (breaking change)
npm audit fix --force
# This upgrades vite@5.2.10 → vite@7.3.1
```

**Why**: This is a major version upgrade that needs testing; defer to separate task after standard fixes

---

### Step 4: Add security audit to CI pipeline

**File**: `.github/workflows/tests.yml`
**Lines**: After line 35
**Action**: UPDATE

**Add new step after QA step:**
```yaml
      - name: Run security audit
        run: make security-audit
```

**Why**: Automated security scanning will prevent regression and catch new vulnerabilities early

---

### Step 5: Verify all fixes applied

**Action**: VALIDATION

**Commands to verify:**
```bash
# Should show 1 vulnerability (esbuild) or 0 if force-updated
npm audit --audit-level moderate

# Ensure CI includes security check
grep -A5 -B5 "security-audit" .github/workflows/tests.yml
```

---

## Patterns to Follow

**From codebase - mirror these exactly:**

```yaml
# SOURCE: .github/workflows/tests.yml:34-35
# Pattern for adding Makefile command steps to CI
      - name: Run QA (lint + format + unit tests)
        run: make qa-quick
```

```makefile
# SOURCE: Makefile:119-121 
# Pattern for test commands with coverage
test-coverage:
	cd $(PYBACKEND_DIR) && uv sync && uv run pytest -c pytest.cov.ini --cov-branch --cov-fail-under=70
	@echo "📊 Coverage report generated in packages/pybackend/htmlcov/"
```

---

## Edge Cases & Risks

| Risk/Edge Case                    | Mitigation                                                                 |
| --------------------------------- | -------------------------------------------------------------------------- |
| Force update breaks Vite build    | Evaluate separately; test in branch before applying force fixes           |
| New vulnerabilities introduced    | CI pipeline will catch them; regular audit schedule established           |
| npm audit fix changes lockfiles  | Commit updated package-lock.json files; document version changes          |
| Breaking changes in dependencies  | Test thoroughly; rollback plan via git if needed                         |

---

## Validation

### Automated Checks

```bash
# Verify dependency updates don't break build
npm run build
npm run test

# Confirm security issues resolved  
make security-audit

# Ensure CI pipeline includes security
grep "security-audit" .github/workflows/tests.yml
```

### Manual Verification

1. Run `make security-audit` and verify only esbuild vulnerability remains (or 0 if force-updated)
2. Verify development server still starts: `npm run dev`
3. Verify build process works: `npm run build`
4. Verify CI pipeline runs security audit on next PR

---

## Scope Boundaries

**IN SCOPE:**
- Fix Makefile audit configuration
- Apply standard `npm audit fix` updates
- Add security audit to CI pipeline
- Update package-lock.json files as needed

**OUT OF SCOPE (do not touch):**
- Vite v7 major upgrade (requires separate evaluation)
- Adding Dependabot or automated dependency updates (future enhancement)
- Creating SECURITY.md policy document (future enhancement)
- Pinning specific dependency versions (current strategy uses ranges)

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-03-09T15:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-267.md`