# Investigation: Security: 39 critical/high vulnerabilities found in Python dependencies

**Issue**: #401
**Type**: CHORE
**Investigated**: 2026-05-04T08:00:00Z

## Problem Statement

pip-audit detected 39 known vulnerabilities across 15 Python packages in the backend.

## Analysis

### Verified Constraints (pyproject.toml)

All directly-declared dependencies already have minimum version constraints matching or exceeding fix versions:

| Package | Constraint | Fix Version | Status |
|---------|-----------|-------------|--------|
| certifi | >=2024.7.4 | 2024.7.4 | ✅ |
| cryptography | >=46.0.7 | 46.0.6+ | ✅ |
| idna | >=3.7 | 3.7 | ✅ |
| jinja2 | >=3.1.6 | 3.1.6+ | ✅ |
| pyasn1 | >=0.6.3 | 0.6.3 | ✅ |
| pygments | >=2.20.0 | 2.20.0 | ✅ |
| pyjwt | >=2.12.0 | 2.12.0 | ✅ |
| pyopenssl | >=26.0.0 | 26.0.0 | ✅ |
| requests | >=2.33.0 | 2.33.0+ | ✅ |
| urllib3 | >=2.6.3 | 2.6.3+ | ✅ |

## Changes Made

| File | Change |
|------|--------|
| packages/pybackend/pyproject.toml:20 | Tightened requests>=2.33.0 (was >=2.32.4) |
| packages/pybackend/uv.lock | Updated to reflect new constraint |

## Validation

- [x] pip-audit: No known vulnerabilities found
- [x] make qa-quick: Format + lint + unit tests pass
- [x] All other dependency constraints verified as correct

## Status

FIXED - PR #412
