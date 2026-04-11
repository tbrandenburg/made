# Investigation: Security: Critical axios vulnerability - SSRF and Cloud Metadata Exfiltration

**Issue**: #376 (https://github.com/tbrandenburg/made/issues/376)
**Type**: CHORE
**Investigated**: 2026-04-11T04:30:00Z

### Assessment

| Metric     | Value   | Reasoning                                                                                              |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------ |
| Priority   | HIGH    | Critical security vulnerabilities (CVSS 9.3 and 10.0) affecting SSRF and cloud metadata exfiltration   |
| Complexity | LOW     | Single-file change: already addressed via npm overrides in package.json                               |
| Confidence | HIGH    | The fix is already in place - npm audit shows 0 vulnerabilities after install                         |

---

## Problem Statement

The GitHub issue reports critical security vulnerabilities in the axios npm package (versions <=1.14.0). Two vulnerabilities are documented:
1. **GHSA-3p68-rc4w-qgx5** (CVE-2025-62718): NO_PROXY Hostname Normalization Bypass leading to SSRF (Critical, CVSS 9.3)
2. **GHSA-fvcv-3m26-pcqx** (CVE-2026-40175): Unrestricted Cloud Metadata Exfiltration via Header Injection Chain (Critical, CVSS 10.0)

Both vulnerabilities are patched in axios version 1.15.0.

---

## Analysis

### Change Rationale

The reported vulnerabilities are in the axios library used as a transitive dependency. The fix requires upgrading axios to >= 1.15.0.

### Evidence Chain

The issue was reported because:
- axios versions <= 1.14.0 have known critical vulnerabilities
- The project uses axios indirectly via the `wait-on` package (a devDependency)

↓ HOWEVER, the fix is already implemented:
- Root `package.json:25` contains an npm override forcing `axios >= 1.15.0`

↓ VERIFICATION:
- `npm ls axios` shows `axios@1.15.0 overridden` (via wait-on dependency)
- `npm install` reports `found 0 vulnerabilities`
- The override was added in commit `608528c` as part of PR #375

↓ CONCLUSION: **This issue is already resolved.**

### Affected Files

| File        | Lines | Action | Description                            |
| ----------- | ----- | ------ | -------------------------------------- |
| `package.json` | 25   | ALREADY FIXED | Contains axios override `>=1.15.0` |

### Integration Points

- `wait-on@9.0.4` is the dependency that pulls in axios
- The npm override at the root level ensures all transitive axios instances use the patched version

---

## Implementation Plan

### Step 1: Verify Fix is Working (No Changes Required)

The fix is already in place. No code changes are needed.

**File**: `package.json`
**Lines**: 24-28

**Current code:**

```json
"overrides": {
  "axios": ">=1.15.0",
  "picomatch": "4.0.4",
  "lodash": "4.18.1"
}
```

**Status**: ✅ This override forces axios to 1.15.0+, which includes security patches for both GHSA-3p68-rc4w-qgx5 and GHSA-fvcv-3m26-pcqx.

---

## Validation

### Automated Checks

```bash
# Verify axios version is patched
npm ls axios

# Verify no security vulnerabilities
npm audit

# Expected output: found 0 vulnerabilities
```

### Manual Verification

1. Run `npm install` to ensure dependencies are up-to-date
2. Run `npm audit` to confirm 0 vulnerabilities
3. Verify `npm ls axios` shows version >= 1.15.0

---

## Recommendation

**CLOSE THIS ISSUE** - The fix is already implemented via npm overrides in `package.json`. The override `"axios": ">=1.15.0"` ensures all transitive instances of axios use the patched version (1.15.0), which addresses both:
- GHSA-3p68-rc4w-qgx5 (NO_PROXY SSRF bypass)
- GHSA-fvcv-3m26-pcqx (Cloud metadata exfiltration)

Run `npm audit` to confirm: it will show "found 0 vulnerabilities".

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-04-11T04:30:00Z
- **Artifact**: `.ghar/issues/issue-376.md`
- **Status**: VERIFIED - Fix already in place
