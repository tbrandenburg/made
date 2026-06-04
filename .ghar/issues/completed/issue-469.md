# Investigation: File browser crashes on symlink loop in repository tree

**Issue**: #469 (https://github.com/tbrandenburg/made/issues/469)
**Type**: BUG
**Investigated**: 2026-06-04T17:00:00Z

### Assessment

| Metric     | Value | Reasoning |
| ---------- | ----- | --------- |
| Severity   | HIGH  | File browser crashes entirely when encountering a cyclic symlink; no workaround other than avoiding the path; a core feature (repository file browsing) is broken for any repo containing a looped symlink |
| Complexity | LOW   | Fix is isolated to 1–2 lines in one file (`repository_service.py:282-284`) plus a test; no architectural changes or integration ripple |
| Confidence | HIGH  | Stack trace pinpoints exact crash site (`child.stat()` at line 282), reproduction steps are clear, and the `except` clause gap is obvious: `FileNotFoundError` is caught but the broader `OSError` (containing `ELOOP`) is not |

---

## Problem Statement

When the repository file browser traverses a directory tree that contains a cyclic or self-referential symlink, `child.stat()` follows the symlink chain and raises `OSError: [Errno 40] Too many levels of symbolic links`. The `except` block on line 283 only catches `FileNotFoundError`, so the `OSError` propagates unhandled, resulting in an HTTP 500 response and a broken UI.

---

## Analysis

### Root Cause / Change Rationale

The `_repository_child_node()` function tries `child.stat()` to get file metadata. `stat()` follows symlinks by default. When a symlink creates a cycle (e.g., `a/mirror -> ../mirror`), `stat()` traverses until it hits the kernel's `SYMLOOP_MAX` (40 on Linux), then raises `OSError` with `errno 40` (ELOOP). The existing fallback to `child.lstat()` only triggers for `FileNotFoundError`, not the broader `OSError` family.

### Evidence Chain

WHY: HTTP 500 when browsing a repo directory containing a cyclic symlink
↓ BECAUSE: `_repository_child_node()` raises unhandled `OSError` at `child.stat()`
Evidence: `repository_service.py:282` - `stats = child.stat()`

↓ BECAUSE: `child.stat()` follows symlinks into a cycle and hits the kernel's symlink limit
Evidence: `repository_service.py:282` - `child.stat()` (default `follow_symlinks=True`)

↓ BECAUSE: The `except` clause on line 283 only catches `FileNotFoundError`, not `OSError`
Evidence: `repository_service.py:283` - `except FileNotFoundError:`

↓ ROOT CAUSE: The exception handler is too narrow — `child.stat()` can raise `OSError` with `ELOOP` (in addition to `FileNotFoundError`), and the code does not handle it
Evidence: `repository_service.py:281-284`
```python
try:
    stats = child.stat()
except FileNotFoundError:
    stats = child.lstat()
```

### Affected Files

| File | Lines | Action | Description |
| ---- | ----- | ------ | ----------- |
| `packages/pybackend/repository_service.py` | 281-284 | UPDATE | Broaden `except FileNotFoundError` to also catch `OSError` |
| `packages/pybackend/tests/unit/test_repository_service.py` | NEW (after line 190) | CREATE | Add regression test for a symlink loop |

### Integration Points

- `packages/pybackend/app.py:394-400` — `repository_files` endpoint calls `list_repository_files()`
- The endpoint only catches `FileNotFoundError` — an unhandled `OSError` from the service layer becomes HTTP 500
- `packages/pybackend/app.py:247-251` — Other endpoints follow pattern `except Exception as exc` -> HTTP 500 (e.g., dashboard endpoint)

### Git History

- **Introduced/Last modified**: `9e35fb5` (2026-06-04) — "Fix: enable concurrent agent sessions per repository (#360) (#468)"
- **Implication**: This is not a recent regression; the bug has likely existed since the `_repository_child_node()` function was first written. The crash was only triggered when a user browsed a repository containing a cyclic symlink.

---

## Implementation Plan

### Step 1: Broaden exception handler in `_repository_child_node()`

**File**: `packages/pybackend/repository_service.py`
**Lines**: 281-284
**Action**: UPDATE

**Current code:**

```python
    try:
        stats = child.stat()
    except FileNotFoundError:
        stats = child.lstat()
```

**Required change:**

```python
    try:
        stats = child.stat()
    except (FileNotFoundError, OSError):
        stats = child.lstat()
```

**Why**: `OSError` includes `ELOOP` (Too many levels of symbolic links). Falling back to `lstat()` when `stat()` fails for any OS-level reason (missing target, broken symlink, symlink loop) is safe and correct — `lstat()` never follows symlinks.

---

### Step 2: Add regression test for symlink loop

**File**: `packages/pybackend/tests/unit/test_repository_service.py`
**Action**: CREATE (insert after existing symlink test at line 190)

**Test cases to add:**

```python
def test_list_repository_files_handles_symlink_loop(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "repo"
    repo_path.mkdir(parents=True)

    # Create a self-referential symlink: repo/self -> repo
    (repo_path / "self").symlink_to(repo_path, target_is_directory=True)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    root = list_repository_files("repo")
    child_names = {c["name"] for c in root["children"]}
    assert "self" in child_names
    self_node = next(c for c in root["children"] if c["name"] == "self")
    assert self_node["type"] == "folder"
    assert self_node.get("isSymlink") is True


def test_list_repository_files_handles_broken_symlink(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "repo"
    repo_path.mkdir(parents=True)

    # Create a broken symlink to a non-existent file
    (repo_path / "broken.txt").symlink_to(tmp_path / "nonexistent")

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    root = list_repository_files("repo")
    child_names = {c["name"] for c in root["children"]}
    assert "broken.txt" in child_names
    broken_node = next(c for c in root["children"] if c["name"] == "broken.txt")
    assert broken_node["type"] == "file"
    assert broken_node.get("isSymlink") is True
```

**Why**: The existing test only covers a valid symlinked directory that resolves without cycles. These new tests cover:
1. A self-referential symlink loop (`repo/self -> repo`) — the exact scenario from the bug report
2. A broken symlink (target does not exist) — a related edge case that exercises the same `except` path

---

## Patterns to Follow

**From codebase — mirror these exactly:**

```python
# SOURCE: repository_service.py:208-212
# Pattern for catching OSError defensively
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            os.rmdir(repo_path)
        except OSError:
            pass
        raise ValueError("Failed to initialize git repository")
```

```python
# SOURCE: app.py:242-251
# Pattern for broad exception handling in endpoints
    except Exception as exc:  # pragma: no cover - passthrough errors
        logger.exception("Failed to fetch dashboard summary")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )
```

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
| -------------- | ---------- |
| `lstat()` itself raises unexpected error | Unlikely — `lstat()` never follows symlinks and only accesses the node's own metadata; if it fails, the error should propagate (same as before) |
| Performance impact using `lstat()` on broken symlinks | Negligible — `lstat()` is a single syscall, no different from `stat()` |
| `child.is_dir()` on line 271 could also be affected for deeply nested non-cyclic symlink chains | `is_dir()` already handles ELOOP internally by returning `False`; the directory branch correctly sets `isSymlink` and returns without calling `stat()` |
| Symlink loop inside a traversed directory (not a direct child) | Not possible — `build_directory_node` only calls `_repository_child_node` for direct children and does not recurse; the tree is flat at one level |

---

## Validation

### Automated Checks

```bash
cd packages/pybackend && uv run python -m pytest tests/unit/test_repository_service.py -x -v -k "symlink"
```

### Manual Verification

1. Run the existing test suite for repository_service to confirm no regression
2. Create a temp repo with a cyclic symlink (`ln -s . mirror`) and browse it via the `/api/repositories/{name}/files` endpoint — should return 200 with `isSymlink: true` instead of crashing

---

## Scope Boundaries

**IN SCOPE:**

- Fix the `except` clause in `_repository_child_node()` to catch `OSError` in addition to `FileNotFoundError`
- Add tests for symlink loop and broken symlink scenarios

**OUT OF SCOPE (do not touch):**

- Adding recursion-based directory traversal (the current flat-one-level model is intentional)
- Updating `app.py` to catch `Exception` in `repository_files` endpoint (not needed once the service layer is fixed; could be a separate improvement)
- Detecting or resolving symlink loops in the wider codebase (only `repository_service.py` is affected)

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-06-04T17:00:00Z
- **Artifact**: `.ghar/issues/issue-469.md`
