# Investigation: [Perf-3] P1: /api/agents called twice on session picker open — deduplicate or cache frontend request

**Issue**: #442 (https://github.com/tbrandenburg/made/issues/442)
**Type**: BUG
**Investigated**: 2026-06-01T16:00:00Z

### Assessment

| Metric     | Value  | Reasoning |
| ---------- | ------ | --------- |
| Severity   | HIGH   | Users experience ~10s wait instead of ~5s due to two sequential slow fetches with no easy workaround |
| Complexity | LOW    | Change is isolated to `useApi.ts` (add a 10-line dedup map); all consumers automatically benefit |
| Confidence | HIGH   | Root cause confirmed in code: StrictMode in `main.tsx:8` + no AbortController + no dedup in `request()` |

---

## Problem Statement

The `/api/repositories/{name}/agents` endpoint is called twice sequentially when the session picker opens. Each call takes ~5s (per #433), so users wait ~10s. React 18 StrictMode double-mounts components in development, firing `AgentSelector`'s `useEffect` twice. The `request()` function has no in-flight deduplication, so both HTTP requests go to the server.

---

## Analysis

### Root Cause / 5 Whys

WHY: Two identical `GET /api/repositories/made/agents` requests appear on session picker load
↓ BECAUSE: `React.StrictMode` intentionally mounts → unmounts → remounts the component tree in development
Evidence: `packages/frontend/src/main.tsx:8` – `<React.StrictMode>` wraps the entire app

↓ BECAUSE: `AgentSelector.tsx`'s `useEffect` fires on each mount, calling `api.getRepositoryAgents()`
Evidence: `packages/frontend/src/components/AgentSelector.tsx:25-51` – cleanup only sets `active = false`, does NOT cancel the fetch

↓ BECAUSE: `request()` has no deduplication — identical concurrent GET requests each create a new `fetch()` call
Evidence: `packages/frontend/src/hooks/useApi.ts:4-74` – retry logic only, no dedup

↓ ROOT CAUSE: Missing in-flight GET request deduplication in `packages/frontend/src/hooks/useApi.ts`

### Affected Files

| File | Lines | Action | Description |
| ---- | ----- | ------ | ----------- |
| `packages/frontend/src/hooks/useApi.ts` | 1-4 | UPDATE | Add `inflightRequests` map and dedup wrapper before `request()` |
| `packages/frontend/src/hooks/useApi.test.ts` | end of file | UPDATE | Add describe block for GET deduplication |

### Integration Points

- `packages/frontend/src/components/AgentSelector.tsx:31-32` – primary caller affected (calls `getRepositoryAgents` or `getAgents`)
- `packages/frontend/src/pages/RepositoryPage.tsx:2016` – also passes `listAgents={() => api.getRepositoryAgents(...)}` to `WorkflowBuilderPanel`
- `packages/frontend/src/pages/TaskPage.tsx:644` – calls `api.getAgents()`
- `packages/frontend/src/pages/KnowledgeArtefactPage.tsx:700` – calls `api.getAgents()`
- `packages/frontend/src/pages/ConstitutionPage.tsx:685` – calls `api.getAgents()`

All consumers automatically benefit from deduplication at the `request()` layer with no call-site changes.

### Git History

- `main.tsx` has used `<React.StrictMode>` since project inception — not a regression, StrictMode is intentional
- The double-fetch is a long-standing issue exacerbated by the slow `/agents` endpoint (#433)

---

## Implementation Plan

### Step 1: Add GET request deduplication to `useApi.ts`

**File**: `packages/frontend/src/hooks/useApi.ts`
**Lines**: 1-4 (insert before the `request` function definition)
**Action**: UPDATE

**Current code (lines 1-4):**

```typescript
const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) || "/api";

async function request<T>(
```

**Required change:**

```typescript
const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) || "/api";

const inflightRequests = new Map<string, Promise<unknown>>();

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();

  if (method === "GET") {
    const key = `GET:${endpoint}`;
    const inflight = inflightRequests.get(key) as Promise<T> | undefined;
    if (inflight) return inflight;
    const promise = executeRequest<T>(endpoint, options);
    inflightRequests.set(key, promise as Promise<unknown>);
    promise.finally(() => inflightRequests.delete(key));
    return promise;
  }

  return executeRequest<T>(endpoint, options);
}

async function executeRequest<T>(
```

**Additionally**: Rename the existing `async function request<T>(` to `async function executeRequest<T>(` — it is a pure rename of the function body, no logic changes inside.

**Why**: Deduplicating at the infrastructure level fixes all consumers at once. The `inflightRequests` map is bounded — entries are deleted via `.finally()` as soon as each request completes.

---

### Step 2: Add tests for GET deduplication

**File**: `packages/frontend/src/hooks/useApi.test.ts`
**Action**: UPDATE — append a new `describe` block at the end of the file

**Test cases to add** (following existing `vi.fn()` on `window.fetch` pattern):

```typescript
describe("GET request deduplication", () => {
  const originalFetch = window.fetch;

  afterAll(() => {
    window.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should issue only one fetch for concurrent identical GET requests", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ agents: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const [result1, result2] = await Promise.all([
      api.getAgents(),
      api.getAgents(),
    ]);

    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(result1).toEqual({ agents: [] });
    expect(result2).toEqual({ agents: [] });
  });

  it("should allow a fresh request after the previous one completes", async () => {
    let callCount = 0;
    window.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ agents: [{ name: `agent-${callCount}` }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    await api.getAgents();
    const result = await api.getAgents();

    expect(window.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ agents: [{ name: "agent-2" }] });
  });
});
```

---

## Patterns to Follow

**From codebase — mirror these exactly:**

```typescript
// SOURCE: packages/frontend/src/hooks/useApi.test.ts:1-15
// Pattern: describe/it blocks, vi.fn() on window.fetch, Response mock
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { api } from "./useApi";

describe("useApi retry behavior", () => {
  const originalFetch = window.fetch;
  const consoleSpy = vi.spyOn(console, "log");

  beforeEach(() => { vi.clearAllMocks(); });
  afterAll(() => {
    window.fetch = originalFetch;
    consoleSpy.mockRestore();
  });
  // ...
});
```

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
| -------------- | ---------- |
| Memory leak in `inflightRequests` map | `.finally()` deletes entries after resolve or reject — map stays empty between requests |
| One consumer aborts, other consumer affected | No `AbortController` used here; both share the same promise result — acceptable tradeoff |
| Same endpoint, different query params | Cache key is `GET:{endpoint}` — callers already include params in the endpoint string (e.g. `/repositories/made/agents`) so different repos get different keys |
| Production vs development behavior | StrictMode double-mount only happens in development; dedup is still a correct optimization in production for concurrent callers |

---

## Validation

### Automated Checks

```bash
# Type-check
cd packages/frontend && npx tsc --noEmit

# Run tests (dedup tests + existing retry tests)
cd packages/frontend && npx vitest run src/hooks/useApi.test.ts

# Lint
cd packages/frontend && npx eslint src/hooks/useApi.ts

# Full QA gate
make qa-quick
```

### Manual Verification

1. Start dev server (`make run`)
2. Open browser DevTools → Network tab, filter by `/agents`
3. Open a repository page (e.g., `made`)
4. Verify **only ONE** request to `/api/repositories/made/agents` appears
5. Open session picker — verify no second request fires
6. Navigate away and back — verify a new single request fires (not blocked by stale dedup)

---

## Scope Boundaries

**IN SCOPE:**

- Add `inflightRequests` dedup map to `packages/frontend/src/hooks/useApi.ts`
- Rename `request` body to `executeRequest` (internal refactor only)
- Add GET deduplication tests to `packages/frontend/src/hooks/useApi.test.ts`

**OUT OF SCOPE (do not touch):**

- `React.StrictMode` removal from `main.tsx` — valuable dev tool, must stay
- Adding `AbortController` to `AgentSelector.tsx` — unnecessary after dedup fix
- Adding React Query / SWR / Zustand — over-engineering for a 10-line fix
- Backend caching — tracked separately in #433
- `requestForm()` function — only handles POST-like form uploads, no dedup needed

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-06-01T16:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-442.md`
