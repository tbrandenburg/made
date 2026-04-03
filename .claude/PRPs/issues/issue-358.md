# Investigation: Bug: Chat client re-sends user messages after receiving a valid response (retry loop)

**Issue**: #358 (https://github.com/tbrandenburg/made/issues/358)
**Type**: BUG
**Investigated**: 2026-04-03T10:22:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                                                                   |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity   | HIGH     | Duplicate agent runs waste API tokens ($), confuse users with duplicate responses, and create inconsistent session state                   |
| Complexity | MEDIUM   | Frontend fix is simple but requires understanding HTTP method semantics; affects 4 agent endpoints; needs comprehensive test coverage      |
| Confidence | HIGH     | Root cause precisely identified with git blame to commit d1d85ec5, complete kill chain documented, evidence from real session database    |

---

## Problem Statement

The made chat frontend blindly retries POST requests on network errors with identical request bodies, causing duplicate message processing. When the backend blocks HTTP threads for 2-5 minutes during agent execution, browsers timeout before responses arrive. The frontend retry mechanism then re-submits the same message after the first request completes, triggering duplicate agent runs.

---

## Analysis

### Root Cause / Change Rationale

The core issue is an architectural mismatch between a **synchronously blocking backend** and a **blind frontend retry mechanism** that doesn't respect HTTP method idempotency semantics.

### Evidence Chain

**WHY 1**: Why are duplicate messages appearing in agent sessions?
↓ **BECAUSE**: The frontend retry mechanism in `useApi.ts:57-62` re-submits POST requests with identical bodies
Evidence: `packages/frontend/src/hooks/useApi.ts:57-62` - `if (attempt < maxRetries && isNetworkError) { continue; }`

**WHY 2**: Why does the retry succeed instead of getting blocked by channel protection?
↓ **BECAUSE**: The backend clears channel processing in the `finally` block after the first request completes
Evidence: `packages/pybackend/agent_service.py:585-586` - `finally: _clear_channel_processing(channel)`

**WHY 3**: Why does the frontend think the request failed and needs retry?
↓ **BECAUSE**: Browser/proxy timeout fires before the synchronously blocking backend returns (2-5 minute agent runs)
Evidence: `packages/pybackend/agent_service.py:518-526` - `result = agent_cli.run_agent()` blocks the HTTP thread

**WHY 4**: Why does the retry logic apply to non-idempotent POST operations?
↓ **BECAUSE**: The retry condition only checks for network errors, not HTTP method semantics
Evidence: `packages/frontend/src/hooks/useApi.ts:51-55` - No method type checking in `isNetworkError` condition

**ROOT CAUSE**: Missing idempotency check in retry logic allows POST/PUT/PATCH/DELETE methods to be retried with identical bodies
Evidence: `packages/frontend/src/hooks/useApi.ts:57` - `if (attempt < maxRetries && isNetworkError)` lacks method validation

### Affected Files

| File                                                | Lines  | Action | Description                                            |
| --------------------------------------------------- | ------ | ------ | ------------------------------------------------------ |
| `packages/frontend/src/hooks/useApi.ts`             | 57-62  | UPDATE | Add idempotency check to retry logic                   |
| `packages/frontend/src/hooks/useApi.ts`             | 124-129| UPDATE | Fix duplicate retry logic in `requestForm` function   |
| `packages/frontend/src/hooks/useApi.test.ts`        | NEW    | CREATE | Add comprehensive retry behavior tests                 |

### Integration Points

- `packages/frontend/src/pages/RepositoryPage.tsx:1127` - Repository agent calls use `sendAgentMessage()`
- `packages/frontend/src/pages/KnowledgeArtefactPage.tsx:258` - Knowledge agent calls use `sendKnowledgeAgent()`
- `packages/frontend/src/pages/ConstitutionPage.tsx:260` - Constitution agent calls use `sendConstitutionAgent()`
- `packages/frontend/src/pages/TaskPage.tsx:203` - Task agent calls use `sendTaskAgent()`
- All 4 agent endpoints route through the same retry-enabled `request()` function

### Git History

- **Introduced**: commit d1d85ec5 - 2025-12-20 - Tom Brandenburg - "Add retry mechanism"
- **Last modified**: commit 7ff66b2 - 2026-04-01 - "Add delete confirmations for repositories and tasks"
- **Implication**: The retry logic predates the awareness of the long-running agent execution behavior, creating this race condition

---

## Implementation Plan

### Step 1: Add Idempotency Check to Primary Retry Logic

**File**: `packages/frontend/src/hooks/useApi.ts`
**Lines**: 57-62
**Action**: UPDATE

**Current code:**

```typescript
// Lines 57-62
if (attempt < maxRetries && isNetworkError) {
  console.log(
    `API attempt ${attempt} failed due to network error, retrying in ${retryDelay}ms...`,
  );
  await new Promise((resolve) => setTimeout(resolve, retryDelay));
  continue;
}
```

**Required change:**

```typescript
// Lines 57-65 (extended)
const isIdempotent = !options.method || 
  ["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase());
  
if (attempt < maxRetries && isNetworkError && isIdempotent) {
  console.log(
    `API attempt ${attempt} failed due to network error, retrying in ${retryDelay}ms...`,
  );
  await new Promise((resolve) => setTimeout(resolve, retryDelay));
  continue;
}
```

**Why**: Only truly idempotent HTTP methods should be retried with identical requests. POST/PUT/PATCH/DELETE can cause side effects and should not be blindly retried.

---

### Step 2: Fix Duplicate Retry Logic in Form Requests

**File**: `packages/frontend/src/hooks/useApi.ts`
**Lines**: 124-129
**Action**: UPDATE

**Current code:**

```typescript
// Lines 124-129 (in requestForm function)
if (attempt < maxRetries && isNetworkError) {
  console.log(
    `Form API attempt ${attempt} failed due to network error, retrying in ${retryDelay}ms...`,
  );
  await new Promise((resolve) => setTimeout(resolve, retryDelay));
  continue;
}
```

**Required change:**

```typescript
// Lines 124-132 (extended)
const isIdempotent = !options.method || 
  ["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase());
  
if (attempt < maxRetries && isNetworkError && isIdempotent) {
  console.log(
    `Form API attempt ${attempt} failed due to network error, retrying in ${retryDelay}ms...`,
  );
  await new Promise((resolve) => setTimeout(resolve, retryDelay));
  continue;
}
```

**Why**: The `requestForm` function has identical problematic retry logic that also needs the idempotency fix.

---

### Step 3: Create Comprehensive Test Coverage

**File**: `packages/frontend/src/hooks/useApi.test.ts`
**Action**: CREATE

**Test cases to add:**

```typescript
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { api } from "./useApi";

describe("useApi retry behavior", () => {
  const originalFetch = window.fetch;
  const consoleSpy = vi.spyOn(console, "log");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    window.fetch = originalFetch;
    consoleSpy.mockRestore();
  });

  describe("idempotent methods (GET, HEAD, OPTIONS)", () => {
    it("should retry GET requests on network error", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ repositories: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const result = await api.listRepositories();

      expect(window.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
      expect(result).toEqual({ repositories: [] });
    });

    it("should retry HEAD requests on network error", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Network error"))
        .mockResolvedValueOnce(new Response("", { status: 200 }));

      // Simulate HEAD request via direct request call
      const result = await api.request("/api/health", { method: "HEAD" });

      expect(window.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
    });
  });

  describe("non-idempotent methods (POST, PUT, PATCH, DELETE)", () => {
    it("should NOT retry POST requests on network error", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendAgentMessage("test-repo", "hello world"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
    });

    it("should NOT retry PUT requests on network error", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.request("/api/test", { method: "PUT", body: "data" }),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
    });

    it("should NOT retry PATCH requests on network error", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.request("/api/test", { method: "PATCH", body: "data" }),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should NOT retry DELETE requests on network error", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.deleteRepository("test-repo"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should handle undefined method (defaults to GET)", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const result = await api.request("/api/test"); // No method = GET

      expect(window.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
    });

    it("should handle lowercase method names", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const result = await api.request("/api/test", { method: "get" });

      expect(window.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
    });

    it("should still retry on HTTP 5xx errors for all methods", async () => {
      window.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
        .mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const result = await api.sendAgentMessage("test-repo", "hello");

      expect(window.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("status 500"),
      );
    });
  });

  describe("integration with agent endpoints", () => {
    it("should not retry sendAgentMessage on network timeout", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendAgentMessage("test-repo", "test message", "session-id", "claude", "default"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendKnowledgeAgent on network timeout", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendKnowledgeAgent("test message", "artefact-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendConstitutionAgent on network timeout", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendConstitutionAgent("test message", "constitution-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendTaskAgent on network timeout", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendTaskAgent("test message", "task-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
```

---

## Patterns to Follow

**From codebase - HTTP status retry pattern (useApi.ts:34-40):**

```typescript
// SOURCE: packages/frontend/src/hooks/useApi.ts:34-40
// Pattern for conditional retry based on response characteristics
if (response.status >= 500 && attempt < maxRetries) {
  console.log(
    `API attempt ${attempt} failed with status ${response.status}, retrying in ${retryDelay}ms...`,
  );
  await new Promise((resolve) => setTimeout(resolve, retryDelay));
  continue;
}
```

**From codebase - Method checking pattern (REST conventions):**

```typescript
// HTTP methods that are safe to retry (idempotent)
const IDEMPOTENT_METHODS = ["GET", "HEAD", "OPTIONS", "TRACE"];
// HTTP methods that should NOT be retried (non-idempotent)
const NON_IDEMPOTENT_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
```

---

## Edge Cases & Risks

| Risk/Edge Case                     | Mitigation                                                       |
| ---------------------------------- | ---------------------------------------------------------------- |
| Mixed case method names            | Use `options.method.toUpperCase()` for case-insensitive check   |
| Undefined method (fetch defaults) | Check `!options.method` to allow default GET behavior           |
| Custom HTTP methods               | Conservative approach: only whitelist known idempotent methods  |
| Breaking existing retry behavior   | Comprehensive test coverage ensures GET/HEAD still retry        |
| Backend still blocking            | Frontend fix prevents duplicates; backend optimization separate |

---

## Validation

### Automated Checks

```bash
# Frontend type checking
cd packages/frontend && npm run typecheck

# Run new retry behavior tests
npm test -- --run src/hooks/useApi.test.ts

# Frontend linting
npm run lint

# Full test suite
npm test

# Backend tests (ensure no regression)
cd packages/pybackend && python -m pytest tests/unit/test_api.py::test_repository_agent_busy -v
```

### Manual Verification

1. **Start application**: `make run`
2. **Send agent message**: Use any agent interface to send a message
3. **Simulate network timeout**: 
   - Open DevTools → Network tab
   - Send message, then quickly set "Offline" mode
   - Wait for timeout, then set "Online" mode
4. **Verify single message**: Check session database or frontend state - should show only ONE message, not duplicates
5. **Test GET requests still retry**: 
   - Set "Offline" mode
   - Navigate between pages (triggers GET requests)
   - Set "Online" mode  
   - Verify requests succeed after retry

### Database Verification (Session #358 Pattern)

```sql
-- Verify no duplicate messages in new sessions
SELECT 
  m.id, 
  json_extract(m.data, '$.role'),
  datetime(m.time_created/1000, 'unixepoch', 'localtime'),
  substr(json_extract(p.data, '$.text'), 1, 80)
FROM message m 
JOIN part p ON p.message_id = m.id
WHERE m.session_id = '{new_test_session_id}'
  AND json_extract(p.data, '$.type') = 'text'
ORDER BY p.time_created;
```

---

## Scope Boundaries

**IN SCOPE:**

- `packages/frontend/src/hooks/useApi.ts` - Primary and form retry logic fixes
- `packages/frontend/src/hooks/useApi.test.ts` - Comprehensive test coverage
- HTTP method idempotency semantics enforcement

**OUT OF SCOPE (do not touch):**

- Backend `agent_service.py` - Synchronous blocking is a separate architectural concern  
- Frontend components (`RepositoryPage.tsx`, etc.) - Error handling UX is already adequate
- Adding request deduplication headers/keys - Would require backend changes
- WebSocket/SSE migration - Major architectural change for future consideration
- Changing retry delay/count configuration - Current values (3 retries, 1s delay) are reasonable

---

## Alternative Solutions Considered

### Option A: Request Deduplication (Backend)
- **Pros**: Bulletproof protection against any duplicate scenarios
- **Cons**: Requires backend changes, request ID generation, storage overhead
- **Verdict**: Overkill for this specific frontend retry issue

### Option B: Disable All Retries
- **Pros**: Simplest fix, eliminates all retry-related issues  
- **Cons**: Breaks legitimate GET request retry behavior for flaky networks
- **Verdict**: Too aggressive, removes valuable retry functionality

### Option C: Async Agent Processing
- **Pros**: Eliminates root cause of long-running synchronous requests
- **Cons**: Major architectural change, requires WebSocket/polling, significant scope
- **Verdict**: Future enhancement, not needed to fix immediate bug

### Option D: Idempotency Check (CHOSEN)
- **Pros**: Surgical fix, preserves GET retry behavior, follows HTTP semantics
- **Cons**: Requires understanding of HTTP method types
- **Verdict**: ✅ **Best balance of safety and functionality**

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-04-03T10:22:00Z
- **Artifact**: `.claude/PRPs/issues/issue-358.md`