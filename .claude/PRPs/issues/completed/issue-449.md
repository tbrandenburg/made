# Investigation: [Perf-8] P0: @vite/client takes 30s TTFB — Vite dev server overloaded on cold start

**Issue**: #449 (https://github.com/tbrandenburg/made/issues/449)
**Type**: BUG
**Investigated**: 2026-06-01T17:00:00Z

### Assessment

| Metric     | Value    | Reasoning                                                                                                   |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| Severity   | HIGH     | The primary fix (React.lazy for detail pages) was already merged in #448; remaining risk is npm dep pre-bundling latency |
| Complexity | LOW      | Single file change — 3 lines added to `vite.config.ts`; no component logic touched                         |
| Confidence | HIGH     | Root cause confirmed by codebase review; partial fix already committed; remaining gap is clearly identified  |

---

## Problem Statement

`@vite/client` had a 30,937ms TTFB on cold start because Vite's single-threaded transform pipeline was blocked by the 81s transform of `KnowledgeArtefactPage.tsx` (#448). The primary fix — converting the four heavy detail pages to `React.lazy()` in `App.tsx` — has already been merged (commit `53f1339`). The **remaining gap** is that `vite.config.ts` still has no `optimizeDeps` configuration, which means heavy npm deps (`marked`, `dompurify`, `react-virtuoso`) are lazily pre-bundled by esbuild on the very first request to a detail page, adding another avoidable latency spike.

---

## Analysis

### Root Cause / Change Rationale

**Primary cause (already fixed in #448):** All 11 page components were eagerly imported in `App.tsx`, forcing Vite to transform all of them synchronously on cold start. Commit `53f1339` replaced the four heavy detail pages with `React.lazy()`.

**Remaining gap:** No `optimizeDeps.include` in `vite.config.ts`. Vite discovers and esbuild-pre-bundles `marked`, `dompurify`, and `react-virtuoso` lazily — on the first route visit that imports them — rather than during startup. This means the first visit to `/knowledge/:name` (which loads `KnowledgeArtefactPage` → `ChatWindow`/`markdown.ts`) still incurs an esbuild pre-bundle round-trip.

### Evidence Chain

WHY: `@vite/client` had 30s TTFB  
↓ BECAUSE: Vite's event loop was blocked by 81s transform of `KnowledgeArtefactPage.tsx`  
Evidence: HAR trace, issue body — TTFB=30528ms  

↓ BECAUSE: All 11 pages were eagerly imported in App.tsx  
Evidence: `packages/frontend/src/App.tsx` — commit `53f1339` shows the before state; now fixed  

↓ PARTIALLY FIXED: commit `53f1339` added `React.lazy()` for `RepositoryPage`, `KnowledgeArtefactPage`, `ConstitutionPage`, `TaskPage`  

↓ REMAINING GAP: `marked`, `dompurify`, `react-virtuoso` have no `optimizeDeps.include`  
Evidence: `packages/frontend/vite.config.ts` — `optimizeDeps` key is absent entirely  

↓ ROOT CAUSE (remaining): First visit to any lazy detail page still triggers esbuild pre-bundling of these 3 deps  
Evidence: `packages/frontend/src/utils/markdown.ts` imports `marked` + `dompurify`; `packages/frontend/src/components/ChatWindow.tsx:1` imports `react-virtuoso`

### Affected Files

| File                               | Lines | Action | Description                                     |
| ---------------------------------- | ----- | ------ | ----------------------------------------------- |
| `packages/frontend/vite.config.ts` | 5     | UPDATE | Add `optimizeDeps.include` for 3 heavy npm deps |

### Integration Points

- `packages/frontend/src/utils/markdown.ts` — imports `marked` + `DOMPurify`; called from `KnowledgeArtefactPage`, `ConstitutionPage`, `TaskPage`
- `packages/frontend/src/components/ChatWindow.tsx` — imports `react-virtuoso`; used by `KnowledgeArtefactPage`, `ConstitutionPage`, `RepositoryPage`, `TaskPage` (all lazy-loaded)
- `vite.config.ts` change has zero runtime effect on component logic

### Git History

- **React.lazy fix landed**: `53f1339` — "Fix: defer heavy detail pages with React.lazy to cut cold-start TTFB (#448)"
- **vite.config.ts last touched**: `dd09d6e` — "Enable websocket proxy for API dev server" — no `optimizeDeps` ever added
- **Implication**: The main regression is fixed; this is the final cleanup step

---

## Implementation Plan

### Step 1: Add optimizeDeps to vite.config.ts

**File**: `packages/frontend/vite.config.ts`
**Lines**: 5 (after `plugins: [react()]`)
**Action**: UPDATE

**Current code:**
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
```

**Required change:**
```typescript
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["marked", "dompurify", "react-virtuoso"],
  },
  server: {
```

**Why**: Vite will esbuild-pre-bundle these three deps during startup (or `vite --force`) rather than lazily on first request. This eliminates a latency spike on the first navigation to any detail page.

---

## Patterns to Follow

No existing `optimizeDeps` pattern in the codebase — this is a first addition. Mirror the [Vite docs](https://vitejs.dev/config/dep-optimization-options.html#optimizedeps-include) standard pattern.

---

## Edge Cases & Risks

| Risk/Edge Case                                       | Mitigation                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `dompurify` is browser-only; esbuild may warn        | Vite handles this gracefully; `dompurify` has a CJS/ESM build that works      |
| Future heavy deps added and not listed               | Add a comment in `vite.config.ts` to keep this list updated                  |
| `vite --force` required on first run to take effect  | Document in README or AGENTS.md; normal startup will also trigger pre-bundle  |

---

## Validation

### Automated Checks

```bash
npm run type-check
npm run build:frontend
npm run lint
```

### Manual Verification

1. Start clean: `rm -rf packages/frontend/node_modules/.vite && make run`
2. Open Chrome DevTools → Network → Disable cache
3. Navigate to app URL; verify `@vite/client` TTFB < 500ms
4. Navigate to `/knowledge/:name`; verify page loads without extra pre-bundle delay
5. Check Vite startup logs — should show `Pre-bundling dependencies: marked, dompurify, react-virtuoso`

---

## Scope Boundaries

**IN SCOPE:**
- Add `optimizeDeps.include` for `marked`, `dompurify`, `react-virtuoso` in `vite.config.ts`

**OUT OF SCOPE (do not touch):**
- `App.tsx` — lazy loading already complete in `53f1339`
- Any component refactoring
- Production build config (`build.rollupOptions`)
- Backend, Docker, CI configuration

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-06-01T17:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-449.md`
