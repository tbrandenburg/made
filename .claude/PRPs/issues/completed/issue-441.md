# Investigation: [Perf-2] P0: SessionPickerModal.tsx takes 21s to serve in dev

**Issue**: #441 (https://github.com/tbrandenburg/made/issues/441)
**Type**: BUG
**Investigated**: 2026-06-01T16:00:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                                                       |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Severity   | CRITICAL | 21s TTFB completely blocks session picker UI; no workaround for users trying to switch sessions                                  |
| Complexity | LOW      | Mechanical change: add default export to 1 component, replace static imports with React.lazy in 4 page files, wrap with Suspense |
| Confidence | HIGH     | Root cause confirmed via codebase exploration: zero React.lazy usage anywhere, 4 eager static imports of SessionPickerModal      |

---

## Problem Statement

`SessionPickerModal.tsx` takes ~21 seconds to serve in Vite dev mode because it is statically imported by 4 page components (`RepositoryPage`, `KnowledgeArtefactPage`, `ConstitutionPage`, `TaskPage`), all of which are eagerly imported by `App.tsx`. With no code-splitting boundaries anywhere in the frontend, Vite's on-demand TSX transform must process the full dependency graph of this module on every cold start, resulting in TTFB=20837ms over the ngrok tunnel. The fix is straightforward: lazy-load the modal with `React.lazy` + `Suspense`.

---

## Analysis

### Root Cause (5 Whys)

WHY: App hangs for ~22 seconds after navigation
↓ BECAUSE: `GET /src/components/SessionPickerModal.tsx` returns TTFB=20837ms
Evidence: HAR trace from issue body — `21823ms total, TTFB=20837ms, blocked=983ms`

↓ BECAUSE: Vite lazily transforms TSX on first request; expensive over ngrok tunnel
Evidence: `packages/frontend/vite.config.ts` — no `optimizeDeps`, no warmup config; server proxied through ngrok

↓ BECAUSE: `SessionPickerModal` is on the critical load path — it's statically imported by 4 pages
Evidence:
- `packages/frontend/src/pages/RepositoryPage.tsx:18` — `import { SessionPickerModal } from "../components/SessionPickerModal";`
- `packages/frontend/src/pages/TaskPage.tsx:30` — same
- `packages/frontend/src/pages/KnowledgeArtefactPage.tsx:30` — same
- `packages/frontend/src/pages/ConstitutionPage.tsx:30` — same

↓ BECAUSE: All 4 pages are statically imported by App.tsx — no lazy boundary
Evidence: `packages/frontend/src/App.tsx:6-16` — all page imports are synchronous

↓ ROOT CAUSE: No `React.lazy()` or dynamic `import()` exists anywhere in production code
Evidence: grep for `React.lazy` in `packages/frontend/src` = zero results; only `import(` uses are in test files via `vi.importActual`

### Affected Files

| File                                                          | Lines    | Action | Description                                           |
| ------------------------------------------------------------- | -------- | ------ | ----------------------------------------------------- |
| `packages/frontend/src/components/SessionPickerModal.tsx`     | 96 (end) | UPDATE | Add `export default SessionPickerModal`               |
| `packages/frontend/src/pages/RepositoryPage.tsx`              | 1-7, 18  | UPDATE | Add `Suspense` to React imports, lazy-load modal      |
| `packages/frontend/src/pages/TaskPage.tsx`                    | 1-7, 30  | UPDATE | Same                                                  |
| `packages/frontend/src/pages/KnowledgeArtefactPage.tsx`       | 1-7, 30  | UPDATE | Same                                                  |
| `packages/frontend/src/pages/ConstitutionPage.tsx`            | 1-7, 30  | UPDATE | Same                                                  |

### Integration Points

- `packages/frontend/src/App.tsx:6-16` — statically imports all 4 pages (not changing this)
- `packages/frontend/src/components/Modal.tsx` — parent wrapper used by SessionPickerModal (unaffected)
- `ClearSessionModal` is imported alongside in all 4 pages — not affected, not slow
- No barrel exports (`index.ts`) — all imports are direct file paths

### Git History

- **Introduced**: PR #440 merge — SessionPickerModal and pages created together
- **Implication**: Not a regression; lazy loading was simply never added at creation time

---

## Implementation Plan

### Step 1: Add default export to SessionPickerModal

**File**: `packages/frontend/src/components/SessionPickerModal.tsx`
**Lines**: After line 96 (end of file)
**Action**: UPDATE

**Current code (line 18, named export):**
```typescript
export const SessionPickerModal: React.FC<SessionPickerModalProps> = ({
```

**Add at end of file (after closing `};`):**
```typescript
export default SessionPickerModal;
```

**Why**: `React.lazy(() => import(...))` requires a default export. Adding it alongside the named export preserves backward compatibility.

---

### Step 2: Lazy-load in RepositoryPage.tsx

**File**: `packages/frontend/src/pages/RepositoryPage.tsx`
**Action**: UPDATE

**Current React import (lines 1-7):**
```typescript
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
```

**Replace with (add `Suspense`):**
```typescript
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
```

**Current import (line 18):**
```typescript
import { SessionPickerModal } from "../components/SessionPickerModal";
```

**Replace with:**
```typescript
const SessionPickerModal = React.lazy(
  () => import("../components/SessionPickerModal")
);
```

**Current usage (line 2599):**
```typescript
<SessionPickerModal
  open={sessionModalOpen}
  ...
/>
```

**Wrap with Suspense:**
```typescript
<Suspense fallback={null}>
  <SessionPickerModal
    open={sessionModalOpen}
    ...
  />
</Suspense>
```

---

### Step 3: Lazy-load in TaskPage.tsx

**File**: `packages/frontend/src/pages/TaskPage.tsx`
**Action**: UPDATE

Identical changes as Step 2:
1. Add `Suspense` to React destructured imports (lines 1-7)
2. Replace `import { SessionPickerModal }` at line 30 with `React.lazy()`
3. Wrap `<SessionPickerModal>` at line 671 with `<Suspense fallback={null}>`

---

### Step 4: Lazy-load in KnowledgeArtefactPage.tsx

**File**: `packages/frontend/src/pages/KnowledgeArtefactPage.tsx`
**Action**: UPDATE

Identical changes as Step 2:
1. Add `Suspense` to React destructured imports (lines 1-7)
2. Replace `import { SessionPickerModal }` at line 30 with `React.lazy()`
3. Wrap `<SessionPickerModal>` at line 751 with `<Suspense fallback={null}>`

---

### Step 5: Lazy-load in ConstitutionPage.tsx

**File**: `packages/frontend/src/pages/ConstitutionPage.tsx`
**Action**: UPDATE

Identical changes as Step 2:
1. Add `Suspense` to React destructured imports (lines 1-7)
2. Replace `import { SessionPickerModal }` at line 30 with `React.lazy()`
3. Wrap `<SessionPickerModal>` at line 732 with `<Suspense fallback={null}>`

---

### Step 6: Tests

**File**: `packages/frontend/src/components/SessionPickerModal.test.tsx`
**Action**: CREATE (if no existing test file)

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionPickerModal } from "./SessionPickerModal";
import { ChatSession } from "../hooks/useApi";

const mockSessions: ChatSession[] = [
  { id: "s1", title: "Session 1", updated: "2024-01-01" },
  { id: "s2", title: "Session 2", updated: "2024-01-02" },
];

const defaultProps = {
  loading: false,
  error: null,
  sessions: mockSessions,
  savedSessionIds: [],
  onClose: () => {},
  onSelect: () => {},
  onRemoveSavedSession: () => {},
};

describe("SessionPickerModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SessionPickerModal open={false} {...defaultProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders session list when open", () => {
    render(<SessionPickerModal open={true} {...defaultProps} />);
    expect(screen.getByText("Session 1")).toBeDefined();
    expect(screen.getByText("Session 2")).toBeDefined();
  });

  it("shows loading state", () => {
    render(<SessionPickerModal open={true} {...defaultProps} loading={true} sessions={[]} />);
    // Adjust text to match actual loading indicator in the component
  });

  it("shows error state", () => {
    render(<SessionPickerModal open={true} {...defaultProps} error="Failed to load" sessions={[]} />);
    expect(screen.getByText("Failed to load")).toBeDefined();
  });
});
```

---

## Patterns to Follow

No `React.lazy` patterns exist in the codebase — this introduces the first lazy boundary. Standard React pattern:

```typescript
// Add default export to module:
export default MyComponent; // alongside named export

// Lazy import (must resolve to module with default export):
const MyComponent = React.lazy(() => import("./MyComponent"));

// Wrap in Suspense at usage site:
<Suspense fallback={null}>
  {condition && <MyComponent ... />}
</Suspense>
```

---

## Edge Cases & Risks

| Risk/Edge Case                              | Mitigation                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Chunk still fetched on first open in dev    | Expected behavior; Vite caches after first transform — subsequent opens are fast     |
| Suspense not imported → runtime error       | Add `Suspense` to the destructured React import in each page file                   |
| Named export users break                    | Keep named export + add default export; both coexist                                 |
| `ClearSessionModal` also imported in pages  | ClearSessionModal is NOT slow — leave as static import                               |
| TypeScript error on React.lazy call         | `React.lazy` infers type from the dynamic import; no explicit type annotation needed |

---

## Validation

```bash
# TypeScript check
cd packages/frontend && npx tsc --noEmit

# Run all frontend tests
cd packages/frontend && npx vitest run

# Lint
cd packages/frontend && npx eslint src/

# Or via project make commands:
make qa-quick
```

### Manual Verification

1. `make run` — start dev server
2. Open browser devtools → Network tab
3. Navigate to a page using SessionPickerModal (e.g., `/repositories/:name`)
4. Confirm `SessionPickerModal` chunk is NOT loaded on initial page load
5. Click "Open Session Picker" — confirm chunk loads only now
6. Verify modal renders correctly and can select/close sessions
7. Repeat for all 4 pages

---

## Scope Boundaries

**IN SCOPE:**
- Add `export default` to `SessionPickerModal.tsx`
- Replace static imports with `React.lazy()` in 4 page files
- Wrap `<SessionPickerModal>` usages in `<Suspense fallback={null}>`

**OUT OF SCOPE (do not touch):**
- Lazy-loading page components in `App.tsx`
- Lazy-loading `ClearSessionModal`
- `vite.config.ts` `optimizeDeps` changes
- Reducing import surface of `SessionPickerModal` (secondary optimization)
- Any other components or routes

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-06-01T16:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-441.md`
