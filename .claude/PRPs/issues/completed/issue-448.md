# Investigation: [Perf-7] P0: KnowledgeArtefactPage.tsx takes 81s to transform in Vite dev

**Issue**: #448 (https://github.com/tbrandenburg/made/issues/448)
**Type**: BUG
**Investigated**: 2026-06-01T18:00:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                     |
| ---------- | -------- | --------------------------------------------------------------------------------------------- |
| Severity   | CRITICAL | 81s TTFB makes the app unusable on cold start; no workaround without code changes             |
| Complexity | LOW      | Only App.tsx needs editing — add React.lazy for 4 detail pages + Suspense wrapper            |
| Confidence | HIGH     | Root cause directly observable in App.tsx:6-16; all 11 pages are statically imported eagerly |

---

## Problem Statement

`KnowledgeArtefactPage.tsx` shows an 81,433ms TTFB in Vite dev. The root cause is not the file itself (769 lines) but `App.tsx` statically importing all 11 page components at module load time. Vite transforms the entire combined dependency graph (~65 files, ~14,600 lines) on the first request. The 4 heavy detail pages (RepositoryPage 2909 LOC, KnowledgeArtefactPage 769, ConstitutionPage 750, TaskPage 689) drive the cost. Converting these 4 to `React.lazy` defers their transform until the user navigates to those routes.

---

## Analysis

### Root Cause / Change Rationale

Eager static imports in `App.tsx:6-16` force Vite to resolve and transform every page's entire dependency sub-tree before any route can render. Code-splitting with `React.lazy` defers this work until the route is actually visited.

### Evidence Chain

WHY: `KnowledgeArtefactPage.tsx` takes 81s TTFB in Vite dev  
↓ BECAUSE: Vite transforms the whole dependency tree on first request; 25 import statements pull in large components  
Evidence: `packages/frontend/src/pages/KnowledgeArtefactPage.tsx:1-53` — 25 imports (CommandsTab, HarnessesTab, ChatWindow, MentionPathTextarea, useApi …)

↓ BECAUSE: App.tsx statically imports ALL 11 page components at top-level  
Evidence: `packages/frontend/src/App.tsx:6-16` — every page is a static top-level import

↓ ROOT CAUSE: No route-level code splitting (`React.lazy`) in App.tsx — all page modules and transitive deps loaded on initial boot  
Evidence: `packages/frontend/src/App.tsx:54-65` — routes use `<element={<Page />}>` with no lazy/Suspense

### Affected Files

| File                                                      | Lines | Action | Description                                       |
| --------------------------------------------------------- | ----- | ------ | ------------------------------------------------- |
| `packages/frontend/src/App.tsx`                           | 6-16, 54-65 | UPDATE | Convert 4 heavy pages to React.lazy; add Suspense |

### Integration Points

- `packages/frontend/src/App.tsx:54-65` — Route definitions
- All target pages use **named exports** — React.lazy needs `.then(m => ({ default: m.Export }))` wrapper

### Git History

- No regression — this is the original app structure; no `React.lazy` has ever been used in App.tsx

---

## Implementation Plan

### Step 1: Convert heavy detail pages to React.lazy in App.tsx

**File**: `packages/frontend/src/App.tsx`  
**Lines**: 1-17  
**Action**: UPDATE

**Current code:**
```typescript
import React, { useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./pages/HomePage";
import { DashboardPage } from "./pages/DashboardPage";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { RepositoryPage } from "./pages/RepositoryPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { KnowledgeArtefactPage } from "./pages/KnowledgeArtefactPage";
import { ConstitutionsPage } from "./pages/ConstitutionsPage";
import { ConstitutionPage } from "./pages/ConstitutionPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { TaskPage } from "./pages/TaskPage";
import "./styles/layout.css";
import { recordNavigationVisit } from "./utils/navigationHistory";
```

**Required change:**
```typescript
import React, { Suspense, useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import "./styles/layout.css";
import { recordNavigationVisit } from "./utils/navigationHistory";

// Eagerly-loaded pages (listing/first-view pages — small dependency trees)
import { HomePage } from "./pages/HomePage";
import { DashboardPage } from "./pages/DashboardPage";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ConstitutionsPage } from "./pages/ConstitutionsPage";
import { TasksPage } from "./pages/TasksPage";
import { SettingsPage } from "./pages/SettingsPage";

// Lazy-loaded detail pages (large dependency trees — deferred until route visited)
const RepositoryPage = React.lazy(() =>
  import("./pages/RepositoryPage").then((m) => ({ default: m.RepositoryPage }))
);
const KnowledgeArtefactPage = React.lazy(() =>
  import("./pages/KnowledgeArtefactPage").then((m) => ({
    default: m.KnowledgeArtefactPage,
  }))
);
const ConstitutionPage = React.lazy(() =>
  import("./pages/ConstitutionPage").then((m) => ({
    default: m.ConstitutionPage,
  }))
);
const TaskPage = React.lazy(() =>
  import("./pages/TaskPage").then((m) => ({ default: m.TaskPage }))
);
```

**Why**: Defers transform of the 4 largest pages (2909+769+750+689 LOC) until navigated to; keeps listing pages eagerly loaded for instant initial render.

---

### Step 2: Wrap Routes in Suspense

**File**: `packages/frontend/src/App.tsx`  
**Lines**: ~53-66  
**Action**: UPDATE

**Current code:**
```typescript
      <main className="app-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          ...
        </Routes>
      </main>
```

**Required change:**
```typescript
      <main className="app-content">
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/repositories" element={<RepositoriesPage />} />
            <Route path="/repositories/:name/*" element={<RepositoryPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/knowledge/:name" element={<KnowledgeArtefactPage />} />
            <Route path="/constitutions" element={<ConstitutionsPage />} />
            <Route path="/constitutions/:name" element={<ConstitutionPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:name" element={<TaskPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
```

**Why**: `Suspense` is required by React when using `React.lazy`; shows fallback while module chunks are being fetched/transformed.

---

## Patterns to Follow

From `packages/frontend/src/pages/KnowledgeArtefactPage.tsx:31-33` — the app already uses this pattern internally:
```typescript
const SessionPickerModal = React.lazy(
  () => import("../components/SessionPickerModal"),
);
```

Named-export wrapper pattern (standard React docs):
```typescript
React.lazy(() => import("./Module").then(m => ({ default: m.NamedExport })))
```

---

## Edge Cases & Risks

| Risk / Edge Case                        | Mitigation                                                         |
| --------------------------------------- | ------------------------------------------------------------------ |
| Named exports require `.then()` wrapper | Pattern confirmed; used for all 4 lazy imports                    |
| Tests importing App may need MemoryRouter + Suspense wrapper | Check existing tests; add Suspense in test wrappers if needed |
| Flash of "Loading…" text on nav         | Acceptable UX; replace with spinner later if desired              |
| Build chunks may need manual naming     | Vite auto-names chunks; no manual config needed                   |

---

## Validation

```bash
cd packages/frontend
npx tsc --noEmit          # type-check
npm test                  # existing test suite
npm run build             # confirm production build emits separate chunks
```

### Manual Verification

1. Start dev: `npm run dev:frontend` — initial load should be <5s
2. Check browser DevTools Network tab for new chunk requests on navigation to `/knowledge/:name`
3. Navigate to each lazy route and confirm content renders with brief loading state

---

## Scope Boundaries

**IN SCOPE:**
- Convert 4 detail page imports in App.tsx to `React.lazy`
- Add `Suspense` wrapper around `<Routes>`

**OUT OF SCOPE (do not touch):**
- Do NOT split `RepositoryPage.tsx` (2909 lines) into sub-components
- Do NOT split `useApi.ts` into domain modules
- Do NOT add Vite `manualChunks` / `optimizeDeps` config
- Do NOT change named exports on existing page files

---

## Metadata

- **Investigated by**: Claude (OpenCode)
- **Timestamp**: 2026-06-01T18:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-448.md`
