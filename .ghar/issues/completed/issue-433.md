# Investigation: P0: Agents API endpoint blocks for 18s causing 15s LCP

**Issue**: #433 (https://github.com/tbrandenburg/made/issues/433)
**Type**: BUG
**Investigated**: 2026-06-02T00:00:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                                                |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Severity   | CRITICAL | Core Web Vital failure (15s LCP), waterfall-blocked agent selector on 4 pages, no workaround, directly impacts UX        |
| Complexity | MEDIUM   | 4 source files + 2 test files; caching layer adds moderate risk; timeout fix is a 1-line change per file                |
| Confidence | HIGH     | Root cause chain fully verified in codebase; all files, lines, and code paths confirmed via direct source inspection     |

---

## Problem Statement

The `/api/repositories/{name}/agents` and `/api/agents` endpoints block for ~18 seconds because they execute a synchronous `subprocess.run()` with no timeout. This blocks the FastAPI worker thread, causing a 15-second Largest Contentful Paint (LCP) — a Core Web Vital failure. The issue affects every page that mounts `AgentSelector` with a `repositoryName` prop (RepositoryPage, KnowledgeArtefactPage, TaskPage, ConstitutionPage).

---

## Analysis

### Root Cause / Change Rationale

The call chain has three compounding problems:
1. **No timeout** on `subprocess.run()` — can hang indefinitely or be slow (~18s)
2. **No caching** — every component mount triggers a fresh subprocess invocation
3. **Synchronous route handler** — blocks the entire FastAPI worker thread

### Evidence Chain

WHY: 15s LCP on pages with agent selector
↓ BECAUSE: `/api/repositories/{name}/agents` takes ~18s to respond
Evidence: `packages/pybackend/app.py:266-278` — sync `def` route handler calls `list_agents(name)`

↓ BECAUSE: `list_agents()` calls `agent_cli.list_agents()` which runs `subprocess.run()` synchronously
Evidence: `packages/pybackend/agent_service.py:484-486` — calls `agent_cli.list_agents(cwd=list_cwd)`

↓ BECAUSE: `subprocess.run()` in `OpenCodeDatabaseAgentCLI.list_agents()` has **no timeout parameter**
Evidence: `packages/pybackend/opencode_database_agent_cli.py:463-468`:
```python
result = subprocess.run(
    ["opencode", "agent", "list"],
    capture_output=True,
    text=True,
    cwd=cwd,
)
```

↓ BECAUSE: No caching layer exists — every `AgentSelector` mount triggers a new subprocess
Evidence: `packages/pybackend/agent_service.py:464-486` — fresh CLI instance every call, zero cache decorators anywhere in the backend.

↓ ROOT CAUSE (primary): Missing `timeout` parameter on `subprocess.run()` in both CLI implementations
Evidence: `packages/pybackend/opencode_database_agent_cli.py:463-468` and `packages/pybackend/agent_cli.py:752-757` — identical pattern, both missing `timeout=30`.

↓ ROOT CAUSE (secondary): No caching of agent list results — every request spawns a fresh subprocess
Evidence: `packages/pybackend/agent_service.py:464-486` — no cache decorator, no in-memory cache, no TTL check.

### Affected Files

| File                                                                  | Lines   | Action | Description                                              |
| --------------------------------------------------------------------- | ------- | ------ | -------------------------------------------------------- |
| `packages/pybackend/opencode_database_agent_cli.py`                   | 463-468 | UPDATE | Add `timeout=30` to `subprocess.run()`                   |
| `packages/pybackend/agent_cli.py`                                     | 752-757 | UPDATE | Add `timeout=30` to `subprocess.run()` (legacy CLI)      |
| `packages/pybackend/agent_service.py`                                 | 464-496 | UPDATE | Add in-memory caching with 60s TTL for `list_agents()`   |
| `packages/pybackend/app.py`                                           | 254-278 | UPDATE | Convert route handlers to `async def`                    |
| `packages/pybackend/tests/unit/test_opencode_database_agent_cli.py`   | 448-500 | UPDATE | Update mock assertions, add timeout expiry test           |
| `packages/pybackend/tests/unit/test_unit.py`                          | 170-235 | UPDATE | Add caching behavior tests for `list_agents()`            |

### Integration Points

- `packages/pybackend/agent_service.py:43-74` — `get_agent_cli()` creates CLI instances; called fresh on every `list_agents()` invocation
- `packages/pybackend/settings_service.py:33-39` — `read_settings()` does filesystem I/O every call
- `packages/frontend/src/components/AgentSelector.tsx:25-47` — `useEffect` fetches agents on mount; blocks UI with loading spinner for 18s
- `packages/frontend/src/hooks/useApi.ts:677-679` — `getRepositoryAgents()` and `getAgents()` API hooks
- 4 pages mount `AgentSelector` with `repositoryName`: RepositoryPage.tsx, KnowledgeArtefactPage.tsx, TaskPage.tsx, ConstitutionPage.tsx

### Git History

- **Introduced**: Initial monorepo setup commit
- **Implication**: Longstanding design issue; not a regression

---

## Implementation Plan

### Step 1: Add timeout to `OpenCodeDatabaseAgentCLI.list_agents()`

**File**: `packages/pybackend/opencode_database_agent_cli.py`
**Lines**: 463-468
**Action**: UPDATE

**Current code:**

```python
result = subprocess.run(
    ["opencode", "agent", "list"],
    capture_output=True,
    text=True,
    cwd=cwd,
)
```

**Required change:**

```python
result = subprocess.run(
    ["opencode", "agent", "list"],
    capture_output=True,
    text=True,
    cwd=cwd,
    timeout=30,
)
```

**Why**: Prevents indefinite blocking. `subprocess.TimeoutExpired` will be caught by the existing `except Exception` handler.

---

### Step 2: Add timeout to legacy `OpenCodeAgentCLI.list_agents()`

**File**: `packages/pybackend/agent_cli.py`
**Lines**: 752-757
**Action**: UPDATE

**Current code:**

```python
result = subprocess.run(
    ["opencode", "agent", "list"],
    capture_output=True,
    text=True,
    cwd=cwd,
)
```

**Required change:**

```python
result = subprocess.run(
    ["opencode", "agent", "list"],
    capture_output=True,
    text=True,
    cwd=cwd,
    timeout=30,
)
```

**Why**: Consistency with the primary fix; mirrors `Popen.communicate(timeout=...)` already used at `agent_cli.py:573,581`.

---

### Step 3: Add caching layer to `agent_service.list_agents()`

**File**: `packages/pybackend/agent_service.py`
**Lines**: 464-496
**Action**: UPDATE

Add at module level (after imports):

```python
import time

_AGENTS_CACHE: dict[str, dict] = {}
_CACHE_TTL_SECONDS = 60
```

Wrap the existing `list_agents` body with a cache check:

```python
def list_agents(repository_name: str | None = None) -> list[dict[str, object]]:
    """List available agents with in-memory caching (60s TTL)."""
    cache_key = repository_name or "__workspace__"
    now = time.monotonic()

    if cache_key in _AGENTS_CACHE:
        entry = _AGENTS_CACHE[cache_key]
        if now - entry["timestamp"] < _CACHE_TTL_SECONDS:
            return entry["data"]

    result = _list_agents_uncached(repository_name)
    _AGENTS_CACHE[cache_key] = {"data": result, "timestamp": now}
    return result


def _list_agents_uncached(repository_name: str | None = None) -> list[dict[str, object]]:
    # ... existing body of list_agents() verbatim ...
```

**Why**: Highest-impact fix. Eliminates subprocess on every page navigation; cache keyed per repo so different repos get independent entries.

---

### Step 4: Convert route handlers to `async def`

**File**: `packages/pybackend/app.py`
**Lines**: 254-278
**Action**: UPDATE

Change `def list_available_agents():` → `async def list_available_agents():`
Change `def list_repository_agents(name: str):` → `async def list_repository_agents(name: str):`

**Why**: Ensures the FastAPI worker thread is not blocked during cold-cache subprocess calls. Low-priority relative to Step 3 since caching provides the bulk of the improvement.

---

### Step 5: Update tests for `OpenCodeDatabaseAgentCLI.list_agents()`

**File**: `packages/pybackend/tests/unit/test_opencode_database_agent_cli.py`
**Lines**: ~463-468
**Action**: UPDATE

Update existing `assert_called_once_with` to include `timeout=30`:

```python
mock_subprocess_run.assert_called_once_with(
    ["opencode", "agent", "list"],
    capture_output=True,
    text=True,
    cwd=None,
    timeout=30,  # ADD THIS
)
```

Add new test:

```python
@patch("opencode_database_agent_cli.subprocess.run")
def test_list_agents_timeout_expired(self, mock_subprocess_run):
    """Test agent listing handles subprocess timeout gracefully."""
    mock_subprocess_run.side_effect = subprocess.TimeoutExpired(
        cmd=["opencode", "agent", "list"], timeout=30
    )

    result = self.cli.list_agents()

    self.assertFalse(result.success)
    self.assertEqual(len(result.agents), 0)
```

---

### Step 6: Add caching tests to `test_unit.py`

**File**: `packages/pybackend/tests/unit/test_unit.py`
**Lines**: ~170-235
**Action**: UPDATE

```python
@patch("agent_service._list_agents_uncached")
def test_list_agents_caches_result(self, mock_uncached):
    """Second call returns cached result without calling subprocess again."""
    import agent_service
    agent_service._AGENTS_CACHE.clear()

    mock_uncached.return_value = [{"name": "test"}]

    result1 = agent_service.list_agents("my-repo")
    result2 = agent_service.list_agents("my-repo")

    mock_uncached.assert_called_once()
    assert result1 == result2


@patch("agent_service._list_agents_uncached")
def test_list_agents_separate_cache_per_repo(self, mock_uncached):
    """Different repo names use separate cache keys."""
    import agent_service
    agent_service._AGENTS_CACHE.clear()

    mock_uncached.return_value = []

    agent_service.list_agents("repo-a")
    agent_service.list_agents("repo-b")

    assert mock_uncached.call_count == 2
```

---

## Patterns to Follow

**Timeout pattern (mirror from integration tests):**

```python
# SOURCE: packages/pybackend/tests/integration/test_opencode_integration.py:19-22
result = subprocess.run(
    ["opencode", "agent", "list"],
    capture_output=True,
    text=True,
    timeout=10,
)
```

**Existing process termination timeout (mirror from agent_service):**

```python
# SOURCE: packages/pybackend/agent_service.py:221-225
process.terminate()
try:
    process.wait(timeout=1)
except subprocess.TimeoutExpired:
    process.kill()
```

---

## Edge Cases & Risks

| Risk/Edge Case                             | Mitigation                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Cache serves stale data                    | 60s TTL is short enough for a dev session; agents rarely change mid-session                  |
| `subprocess.TimeoutExpired` not handled    | Existing `except Exception` catch-all handles it; returns `AgentListResult(success=False)`   |
| Tests share global `_AGENTS_CACHE`         | Clear `agent_service._AGENTS_CACHE` in test setup or use `autouse` fixture                   |
| Multiple repos with independent caches     | Cache keyed by `repository_name`, not shared across repos                                    |
| Legacy `OpenCodeAgentCLI` also affected    | Same timeout fix applied in Step 2                                                           |

---

## Validation

### Automated Checks

```bash
uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_opencode_database_agent_cli.py -v -k "list_agents"
uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit/test_unit.py -v -k "list_agents"
make qa-quick
```

### Manual Verification

1. Start backend: `cd packages/pybackend && uv run uvicorn app:app --host 0.0.0.0 --port 3000`
2. First request: `curl -w "\nTime: %{time_total}s\n" http://localhost:3000/api/agents`
3. Second request (should be instant — cache hit): repeat same curl
4. Navigate between pages in frontend with `AgentSelector` — confirm no 15s stalls
5. Confirm graceful error when timeout fires: set `timeout=0.001` temporarily and verify error response (not crash)

---

## Scope Boundaries

**IN SCOPE:**

- Add `timeout=30` to `subprocess.run()` in both CLI implementations
- Add in-memory caching with 60s TTL to `agent_service.list_agents()`
- Convert route handlers to `async def`
- Update existing tests and add new tests for timeout + caching behavior

**OUT OF SCOPE (do not touch):**

- Rewriting to `asyncio.create_subprocess_exec()` — higher complexity, minimal benefit once caching is in place
- Redis or external caching — overkill for single-server setup
- Refactoring `get_agent_cli()` or `read_settings()` — fast enough (few ms)
- Frontend-side React Query caching — defer to future enhancement
- Other `subprocess.run()` calls in the codebase — only `list_agents` methods cause the ~18s latency

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-06-02T00:00:00Z
- **Artifact**: `.ghar/issues/issue-433.md`
- **Labels applied**: `complexity/medium`
