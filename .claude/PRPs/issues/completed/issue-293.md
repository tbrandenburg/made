# Investigation: Git Process Failures - Multiple workflows failing with exit code 128

**Issue**: #293 (https://github.com/tbrandenburg/made/issues/293)
**Type**: BUG
**Investigated**: 2026-03-14T12:00:00Z

### Assessment

| Metric     | Value                         | Reasoning                                                                |
| ---------- | ----------------------------- | ------------------------------------------------------------------------ |
| Severity   | MEDIUM                         | Workflows fail with exit code 128 but tests still pass; the failure is in post-checkout cleanup, not core functionality |
| Complexity | LOW                            | Single file change needed to remove stale submodule reference; isolated to repository configuration |
| Confidence | HIGH                           | Root cause clearly identified in git logs: "fatal: No url found for submodule path 'examples/kiro-cli' in .gitmodules" |

---

## Problem Statement

GitHub Actions workflows are failing with exit code 128 during post-checkout cleanup steps. The error occurs because there's a stale submodule reference (`examples/kiro-cli`) in the git tree without a corresponding `.gitmodules` file. This causes the `git submodule foreach` command in GitHub Actions' post-checkout hook to fail.

---

## Analysis

### Root Cause Analysis (5 Whys)

**WHY**: Git operations fail with exit code 128 in GitHub Actions
↓ BECAUSE: The post-checkout step runs `git submodule foreach --recursive` which fails
↓ BECAUSE: There's no `.gitmodules` file but git references a submodule at `examples/kiro-cli`
↓ BECAUSE: The repository tree contains a submodule entry (`160000` mode) pointing to commit `0d70cfa2f561e386bc66ed57be0f499b293cc63d` but the `.gitmodules` configuration was removed

**ROOT CAUSE**: Stale submodule reference exists in git tree without .gitmodules file

### Evidence Chain

```bash
# Evidence 1: Git ls-tree shows submodule entry
$ git ls-tree HEAD examples/kiro-cli
160000 commit 0d70cfa2f561e386bc66ed57be0f499b293cc63d	examples/kiro-cli

# Evidence 2: Git submodule status fails
$ git submodule status
fatal: no submodule mapping found in .gitmodules for path 'examples/kiro-cli'

# Evidence 3: GitHub Actions log shows exact error
2026-03-14T19:40:18.1613518Z fatal: No url found for submodule path 'examples/kiro-cli' in .gitmodules
2026-03-14T19:40:18.1660175Z ##[warning]The process '/usr/bin/git' failed with exit code 128
```

### Affected Files

| File            | Lines | Action | Description    |
| --------------- | ----- | ------ | -------------- |
| N/A (submodule) | N/A   | DELETE | Remove submodule reference via git rm --cached |

### Integration Points

- GitHub Actions `actions/checkout@v4` - triggers post-checkout cleanup which runs submodule commands
- No source code files are affected

### Git History

- **Introduced**: Unknown - the submodule reference was present in commit `766dbd96da1ebe7cdb949be78836af784c946bf8` (current main)
- **Implication**: Long-standing issue that manifests in CI due to post-checkout hook

---

## Implementation Plan

### Step 1: Remove stale submodule reference

**Command**: 
```bash
git rm --cached examples/kiro-cli
rm -rf .git/modules/examples/kiro-cli 2>/dev/null || true
```

**Why**: The submodule entry in the git index points to a non-existent commit and has no .gitmodules configuration. Removing it will fix the CI failure.

**Note**: The `examples/kiro-cli` directory is empty anyway (contains only `.` and `..`).

---

### Step 2: Commit the change

```bash
git commit -m "fix: remove stale submodule reference for examples/kiro-cli

The submodule was never properly configured with a .gitmodules file,
causing 'git submodule foreach' to fail in CI with:
'fatal: No url found for submodule path examples/kiro-cli in .gitmodules'

This removes the broken submodule reference from the repository index."
```

---

## Patterns to Follow

**Not applicable** - This is a repository configuration issue, not a code pattern.

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation      |
| -------------- | --------------- |
| Submodule was intentionally added for a reason | The directory is empty and the submodule reference is broken; no functional code depends on it |
| Remote repository might become available later | If needed, the submodule can be re-added properly with a working .gitmodules |

---

## Validation

### Automated Checks

```bash
# Verify no more submodule issues
git submodule status

# Verify the directory is no longer tracked as submodule
git ls-tree HEAD examples/kiro-cli  # Should return error or file content, not submodule mode 160000

# Run a test checkout to ensure post-checkout hook works
git checkout HEAD -- .
```

### Manual Verification

1. Push the fix to a branch and verify GitHub Actions workflow passes without the exit code 128 error

---

## Scope Boundaries

**IN SCOPE:**
- Remove the broken submodule reference from git index

**OUT OF SCOPE (do not touch):**
- Any source code changes
- Docker or CI configuration files
- The empty `examples/kiro-cli` directory (can be removed separately if desired)

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-03-14T12:00:00Z
- **Artifact**: `.ghar/issues/issue-293.md`

---

## Implementation Completed

- **Branch**: `fix/issue-293-stale-submodule`
- **PR**: #318 (https://github.com/tbrandenburg/made/pull/318)
- **Committed**: `7acd9fa` - fix: remove stale submodule reference for examples/kiro-cli
