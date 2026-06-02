# Investigation: [Perf-4] P1: /api/git blocks for 2.9s — cache git status response with short TTL

**Issue**: #443 (https://github.com/tbrandenburg/made/issues/443)
**Type**: BUG (performance)
**Investigated**: 2026-06-02T00:00:00Z

### Assessment

| Metric     | Value | Reasoning |
| ---------- | ----- | --------- |
| Severity   | HIGH  | Every repository page load incurs ~2.9s server-side blocking with 2.0s TTFB; no workaround exists and this impacts all users on every page load |
| Complexity | LOW   | Single-file change in `repository_service.py` adding an in-memory TTL cache; no new dependencies, no architectural changes |
| Confidence | HIGH  | Root cause is clearly understood (11 sequential synchronous I/O calls with zero caching), and the code path is fully traced with exact line numbers |

## Problem Statement

`GET /api/repositories/{name}/git` takes **2.9 seconds** with a TTFB of 2.0s, all of which is pure server-side blocking time. The endpoint executes 11 sequential synchronous I/O calls (7 git subprocesses + 3 GitHub API HTTP requests + 1 remote URL lookup) with **no caching whatsoever**. Every request — including repeated page loads within seconds — re-executes all 11 calls from scratch. The data (git status, branch info, diff stats) changes infrequently between user actions, making it an ideal caching target.

## Analysis

### Root Cause / Change Rationale

The `get_repository_git_status` function in `repository_service.py:559-674` makes 11 sequential blocking I/O calls for every single request. The data returned (branch name, ahead/behind counts, diff stats, last commit, worktree count, GitHub issue/PR/branch counts) is typically stable for 30+ seconds between user actions. Adding a short-TTL (30s) in-memory cache eliminates redundant recomputation, reducing response time from ~2.9s to <1ms on cache hit.

### Evidence Chain

WHY: `/api/repositories/{name}/git` responds in 2.9s with 2.0s TTFB
↓ BECAUSE: Every request executes 11 sequential synchronous I/O calls with zero caching
Evidence: `repository_service.py:559-674` — `get_repository_git_status` function

↓ BECAUSE: 7 git subprocess calls (`_run_git`) each fork a process and hit disk I/O (100-500ms each)
Evidence: `repository_service.py:364-369` — `_run_git` uses synchronous `subprocess.check_output`

↓ BECAUSE: 3 GitHub API HTTP calls (`_github_get_json`) each make synchronous `urllib.request.urlopen` calls (network latency ~200-800ms each)
Evidence: `repository_service.py:389-403` — `_github_get_json` with 5s timeout

↓ BECAUSE: No caching layer exists anywhere in the codebase — no `functools.lru_cache`, no in-memory cache, no Redis, no cache headers
Evidence: `repository_service.py:559-674` — zero caching utilities in entire `packages/pybackend/`

↓ ROOT CAUSE: The function recomputes everything on every invocation instead of caching results with a short TTL
Evidence: `repository_service.py:559-674` — no cache check before executing the 11-call chain

### Affected Files

| File | Lines | Action | Description |
| --- | --- | --- | --- |
| `packages/pybackend/repository_service.py` | 1-16 | UPDATE | Add `time` import |
| `packages/pybackend/repository_service.py` | 559-674 | UPDATE | Wrap `get_repository_git_status` with TTL cache logic |
| `packages/pybackend/repository_service.py` | ~537,514,549 | UPDATE | Add `invalidate_git_status_cache` calls after write ops |
| `packages/pybackend/tests/unit/test_repository_service.py` | NEW | UPDATE | Add cache hit/miss/expiry tests |

### Integration Points

- `app.py:766-775` — `repository_git_status` route handler calls `get_repository_git_status(name)`
- `packages/frontend/src/pages/RepositoryPage.tsx:861-877` — `loadGitStatus()` calls `api.getRepositoryGitStatus(name)`
- `packages/frontend/src/pages/RepositoryPage.tsx:930-932` — Called on component mount
- `packages/frontend/src/pages/RepositoryPage.tsx:1104,1124,1496` — Called after pull, worktree creation, file save
- `packages/frontend/src/hooks/useApi.ts:543-544` — `getRepositoryGitStatus` API client method

### Git History

- **Introduced**: Long-standing — `get_repository_git_status` has existed in this form since initial implementation
- **Implication**: Original design didn't account for caching; the growing number of git/API calls (up to 11) has gradually increased latency

## Implementation Plan

### Step 1: Add `time` import to repository_service.py

**File**: `packages/pybackend/repository_service.py`
**Lines**: 1-16
**Action**: UPDATE

**Current code:**

```python
import os
import subprocess
import logging
import shutil
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Union
from urllib.parse import quote_plus
```

**Required change:**

```python
import os
import subprocess
import logging
import shutil
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Union
from urllib.parse import quote_plus
```

**Why**: `time.monotonic()` is needed for TTL expiry checks (immune to system clock changes).

### Step 2: Add cache constants, cache dict, and invalidation helper before `get_repository_git_status`

**File**: `packages/pybackend/repository_service.py`
**Lines**: ~557 (before `get_repository_git_status`)
**Action**: INSERT

**Code to insert:**

```python
_git_status_cache: dict[str, tuple[float, dict]] = {}
GIT_STATUS_CACHE_TTL = 30  # seconds


def invalidate_git_status_cache(repo_name: str) -> None:
    _git_status_cache.pop(repo_name, None)
```

**Why**: Module-level cache dict keyed by repo name, with 30s TTL. Helper function for cache invalidation after write operations.

### Step 3: Wrap `get_repository_git_status` with cache logic

**File**: `packages/pybackend/repository_service.py`
**Lines**: 559-674
**Action**: UPDATE

**Add at the top of the function (before first I/O call):**

```python
def get_repository_git_status(
    repo_name: str,
) -> Dict[str, Union[str, int, dict, list, None]]:
    now = time.monotonic()
    if repo_name in _git_status_cache:
        ts, result = _git_status_cache[repo_name]
        if now - ts < GIT_STATUS_CACHE_TTL:
            return result

    # ... all existing logic unchanged ...

    result: Dict[str, Union[str, int, dict, list, None]] = {
        "branch": branch,
        "aheadBehind": ahead_behind,
        # ... rest unchanged ...
    }
    _git_status_cache[repo_name] = (now, result)
    return result
```

**Why**: Early cache check before any I/O saves all 11 calls on cache hit. Result is stored on the way out. Cache miss is transparent — all existing logic runs unchanged.

### Step 4: Add cache invalidation after write operations

**File**: `packages/pybackend/repository_service.py`
**Action**: UPDATE — add `invalidate_git_status_cache(repo_name)` call at the end of:

- `pull_repository` (~line 537)
- `create_repository_worktree` (~line 514)
- `remove_repository_worktree` (~line 549)

**Why**: Write operations make cached data stale. Invalidating the specific repo entry ensures the next read fetches fresh data immediately.

### Step 5: Add Tests

**File**: `packages/pybackend/tests/unit/test_repository_service.py`
**Action**: UPDATE (add test cases)

**Test cases to add:**

```python
def test_get_repository_git_status_cache_hit(monkeypatch, tmp_path):
    import repository_service as svc

    svc._git_status_cache.clear()

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: None)

    call_count = 0
    original_get_branch = svc.get_branch_name

    def counting_get_branch(repo_path):
        nonlocal call_count
        call_count += 1
        return original_get_branch(repo_path)

    monkeypatch.setattr("repository_service.get_branch_name", counting_get_branch)

    result1 = svc.get_repository_git_status("repo")
    assert call_count == 1

    result2 = svc.get_repository_git_status("repo")
    assert call_count == 1  # no extra calls — cache hit
    assert result2 is result1  # same object returned


def test_invalidate_git_status_cache(monkeypatch, tmp_path):
    import repository_service as svc

    svc._git_status_cache.clear()
    svc._git_status_cache["repo"] = (svc.time.monotonic(), {"branch": "main"})

    svc.invalidate_git_status_cache("repo")
    assert "repo" not in svc._git_status_cache
```

## Patterns to Follow

**From codebase — mirror these exactly:**

```python
# SOURCE: repository_service.py:364-369
# Existing sync git subprocess pattern
def _run_git(repo_path: Path, args: list[str]) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo_path), *args],
        stderr=subprocess.DEVNULL,
        text=True,
    ).strip()
```

```python
# SOURCE: app.py:767-774
# Exception handling pattern in routes
def repository_git_status(name: str):
    try:
        return get_repository_git_status(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
```

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
| -------------- | ---------- |
| Cache persists stale data after file system changes outside app (e.g., user runs `git commit` in terminal) | 30s TTL limits stale data window to 30s max; acceptable for a development UI |
| Cache memory leak if many repos are accessed | One entry per repo; negligible memory footprint |
| Race condition: concurrent requests for same repo could both compute | Acceptable — both compute the same result; last write wins, no data corruption |
| Tests leak state across runs due to module-level dict | Each test clears `_git_status_cache` before running via direct import |

## Validation

### Automated Checks

```bash
cd packages/pybackend && uv run python -m pytest tests/unit/test_repository_service.py -v -k "git_status"
cd packages/pybackend && uv run python -m pytest tests/unit/
```

### Manual Verification

1. Start backend: `cd packages/pybackend && uv run uvicorn app:app --host 0.0.0.0 --port 3000`
2. Hit endpoint twice in quick succession:
   ```bash
   time curl -s http://localhost:3000/api/repositories/some-repo/git
   time curl -s http://localhost:3000/api/repositories/some-repo/git
   ```
   First call ~2.9s (cold cache), second call <50ms (cache hit).
3. Wait 31s and repeat — should take ~2.9s again (cache expired).

## Scope Boundaries

**IN SCOPE:**
- Adding in-memory TTL cache to `get_repository_git_status` in `repository_service.py`
- Adding cache invalidation in `pull_repository`, `create_repository_worktree`, `remove_repository_worktree`
- Adding tests for cache hit/miss/invalidation behavior

**OUT OF SCOPE (do not touch):**
- Making git subprocess calls async
- Adding a distributed cache (Redis, etc.)
- Adding HTTP cache headers
- Refactoring `_run_git` to support timeouts
- Converting the endpoint to `async def`
- Caching other endpoints

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-06-02T00:00:00Z
- **Artifact**: `.ghar/issues/issue-443.md`
