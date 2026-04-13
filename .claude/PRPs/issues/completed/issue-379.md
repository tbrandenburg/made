# Implementation: Critical npm Security Vulnerabilities in axios

**Issue**: #[379](https://github.com/tbrandenburg/made/issues/379)
**Type**: BUG (Security)
**Status**: COMPLETED
**Implemented**: 2026-04-13

---

## Problem Statement

The project has two critical security vulnerabilities in the axios package (versions <= 1.14.0):
1. **GHSA-3p68-rc4w-qgx5**: NO_PROXY Hostname Normalization Bypass leading to SSRF
2. **GHSA-fvcv-3m26-pcqx**: Unrestricted Cloud Metadata Exfiltration via Header Injection Chain (CVSS 10.0)

---

## Root Cause

The root `package.json` did not specify axios as a direct dependency. A transitive dependency required axios <= 1.14.0, which allowed a vulnerable version to be installed.

---

## Solution

Added axios version override to `package.json` to force installation of axios >= 1.15.0.

### Files Modified

| File | Line | Change |
|------|------|--------|
| `package.json` | 25 | Added `"axios": ">=1.15.0"` to overrides |

### Changes Made

```diff
"overrides": {
+ "axios": ">=1.15.0",
  "picomatch": "4.0.4",
  "lodash": "4.18.1"
}
```

---

## Validation

Commands to verify the fix:

```bash
# Check for vulnerabilities
npm audit --audit-level=high

# Verify axios version
npm ls axios
```

### Expected Results

- `npm audit` should report 0 vulnerabilities
- `axios` version should be >= 1.15.0

---

## Testing Checklist

- [x] `npm audit` passes with 0 vulnerabilities
- [x] `npm install` completes successfully
- [x] Application builds without errors

---

## Notes

- This is a simple dependency override - no code changes required
- The fix was auto-applied during investigation
- No PR needed as the fix is already in main

---

## Implementation Metadata

- **Fix Applied**: During investigation
- **Committed**: Yes (already in main)
- **PR Required**: No
