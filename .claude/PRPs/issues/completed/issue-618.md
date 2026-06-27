# Investigation: Investigate pre-existing RepositoryPage vitest failures

**Issue**: #618 (https://github.com/tbrandenburg/made/issues/618)
**Type**: BUG
**Investigated**: 2026-06-27T07:09:16Z

### Assessment

| Metric     | Value                         | Reasoning                                                                |
| ---------- | ----------------------------- | ------------------------------------------------------------------------ |
| Severity   | MEDIUM | This breaks the frontend test suite, but the product runtime path is still working and the failure is isolated to a test harness/regression in `RepositoryPage.test.tsx`. |
| Complexity | MEDIUM | The fix spans the `RepositoryPage` test mock plus the stale async assertions it supports, with integration touchpoints in `ChatWindow` behavior and Vitest/RTL async rendering. |
| Confidence | HIGH | The failure is reproducible, the failing lines are known, and the root cause is visible in the mocked `react-virtuoso` contract versus the real `ChatWindow` context contract. |

## Problem Statement

`npm --workspace packages/frontend run test` fails in `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx` with 14 failing cases. The failures cluster around session footer assertions such as `Clear session`, `Session ID: ...`, and `Agent is thinking...`, which indicates the test harness is no longer rendering the same UI contract as `ChatWindow` expects.

## Analysis

### Root Cause / Change Rationale

The `RepositoryPage.test.tsx` file mocks `react-virtuoso`, but the mock drops the `context` prop that `ChatWindow` passes into `Virtuoso`. The real `ChatWindow` footer reads `ctx.sessionId`, `ctx.onClearSession`, `ctx.onSaveSession`, `ctx.sessionLoading`, `ctx.refreshing`, and `ctx.agentProcessing` from that context, so a mock that renders `<Footer />` without props cannot expose the session controls or footer state the tests assert against.

The visible failures are therefore not a product bug in `RepositoryPage` itself; they are a contract mismatch in the test harness plus a set of assertions that assume footer-rendered state will exist even when the mock omits it.

### Evidence Chain

WHY: The page tests cannot find the session controls and session footer text.
↓ BECAUSE: The mocked `react-virtuoso` footer is rendered without the `context` prop that `ChatWindow` relies on.
Evidence: `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx:46-60` - `Footer ? ReactModule.createElement(Footer) : null,`

↓ BECAUSE: `ChatWindow` reads all session/footer state from Virtuoso context.
Evidence: `packages/frontend/src/components/ChatWindow.tsx:199-246` - `Footer: ({ context: ctx }) => (...)` and the `Session ID` / `Clear session` buttons use `ctx.sessionId`, `ctx.onClearSession`, and `ctx.onSaveSession`.

↓ ROOT CAUSE: The repository-page test mock does not model the real `Virtuoso` API contract, so the footer cannot render the controls and state that the tests are selecting.
Evidence: `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx:34-60` versus `packages/frontend/src/components/ChatWindow.test.tsx:41-76` - the component test mock already forwards `context={context}` to `Footer`, but the repository-page mock does not.

### Affected Files

| File            | Lines | Action | Description    |
| --------------- | ----- | ------ | -------------- |
| `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx` | 34-60 | UPDATE | Forward `context` into the mocked `Virtuoso` footer and expand the mock prop type to match `ChatWindow`'s usage. |
| `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx` | 450-2705 | UPDATE | Keep the existing assertions, but adjust any stale async expectations only if they still fail after the mock contract is fixed. |
| `packages/frontend/src/components/ChatWindow.tsx` | 186-276 | NO CHANGE | This file already provides the correct context contract; it is the source of truth for the mock shape. |

### Integration Points

- `packages/frontend/src/components/ChatWindow.tsx:199` - Footer expects `{ context?: ChatWindowContext }` prop
- `packages/frontend/src/components/ChatWindow.tsx:268` - Real Virtuoso receives `context={...}` and forwards it
- `packages/frontend/src/components/ChatWindow.tsx:221,243,307,323` - All "Clear session" / "Session ID" render paths

### Git History

- **Introduced**: Unknown - the mock was likely written when no test needed Footer context after sending. The AC495, AC496, AC497 test suites were added in recent commits (e.g., `2c0ac71` "Refactor: simplify RepositoryPage lifecycle state machine") but the mock predates these.
- **Last modified**: `5c1fc52` (Fix: clear stale localStorage chat on page refresh) - no changes to the mock itself.
- **Implication**: This is a gap between the test infrastructure (MockVirtuoso) and the new tests that require Footer context. Not a regression in production code.

## Implementation Plan

### Step 1: Update Virtuoso Mock to forward `context` prop

**File**: `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx`
**Lines**: 39-61
**Action**: UPDATE

**Current code (lines 39-61):**

```tsx
Virtuoso: ReactModule.forwardRef<
  { scrollToIndex: (opts: unknown) => void },
  {
    data: unknown[];
    itemContent: (index: number, item: unknown) => ReactNode;
    components?: { Footer?: ReactModule.ComponentType };
  }
>(function MockVirtuoso({ data, itemContent, components }, ref) {
  ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
  const Footer = components?.Footer;
  return ReactModule.createElement(
    "div",
    { "data-testid": "virtuoso" },
    ...data.map((item, index) =>
      ReactModule.createElement(
        ReactModule.Fragment,
        { key: index },
        itemContent(index, item),
      ),
    ),
    Footer ? ReactModule.createElement(Footer) : null,
  );
}),
```

**Required change (lines 39-61):**

```tsx
Virtuoso: ReactModule.forwardRef<
  { scrollToIndex: (opts: unknown) => void },
  {
    data: unknown[];
    itemContent: (index: number, item: unknown) => ReactNode;
    components?: { Footer?: ReactModule.ComponentType };
    context?: unknown;
  }
>(function MockVirtuoso({ data, itemContent, components, context }, ref) {
  ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
  const Footer = components?.Footer;
  return ReactModule.createElement(
    "div",
    { "data-testid": "virtuoso" },
    ...data.map((item, index) =>
      ReactModule.createElement(
        ReactModule.Fragment,
        { key: index },
        itemContent(index, item),
      ),
    ),
    Footer ? ReactModule.createElement(Footer, { context }) : null,
  );
}),
```

**Why**: Adding `context` to the destructured props and passing `{ context }` as the second argument to `createElement(Footer, { context })` mirrors real Virtuoso behavior where the `context` prop is forwarded to child components.

---

### Step 2: Verify Tests Pass

**File**: `packages/frontend/src/pages/__tests__/RepositoryPage.test.tsx`
**Action**: RUN tests

```bash
npm --workspace packages/frontend run test
```

All 14 previously failing tests should now pass. Tests that already passed should remain green.

### Step 3: Add/Update Tests

No new tests needed. Existing tests cover the behavior correctly once the mock is fixed.

---

## Patterns to Follow

**From codebase - mirror these exactly:**

The mock update follows the same React pattern used throughout the codebase for forwarding props to child components. No new patterns introduced.

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
| -------------- | ---------- |
| `context` could be `undefined` (no context passed) | Footer's guards already use optional chaining (`ctx?.sessionId`), so `undefined` context is handled gracefully |
| Other Virtuoso features (Item, List, etc.) might also need context | Only Footer is used in this codebase; others are not mocked. If added later, they'd need the same treatment |
| React.createElement with second arg `null` when context undefined | Footer receives `{ context: undefined }` → `ctx` is `undefined` → same behavior as before the fix for tests that don't pass context |

---

## Validation

### Automated Checks

```bash
cd packages/frontend && npm test
```

Expected result: `Test Files 1 passed ... Tests X passed (281)`

### Manual Verification

1. Run `npm --workspace packages/frontend run test` and confirm all tests pass
2. Run only the previously-failing suite: `npm --workspace packages/frontend run test -- --testNamePattern="AC496|AC495|AC497|I3"` and confirm all pass

---

## Scope Boundaries

**IN SCOPE:**

- Fix Virtuoso mock to accept + forward `context` prop (one-line type addition, one-line prop pass)

**OUT OF SCOPE (do not touch):**

- The AC496-ADV2 test failure ("Failed to reach agent" not found). This may be a separate timing/state issue unrelated to the Virtuoso mock. If it persists after the mock fix, create a follow-up issue.
- No production code changes (RepositoryPage.tsx, ChatWindow.tsx, etc. are correct)
- No new tests or test rewrites
- No changes to any other test describe block or helper function

---

## Metadata

- **Investigated by**: GHAR
- **Timestamp**: 2026-06-27T07:05:00Z
- **Artifact**: `.ghar/issues/issue-618.md`
