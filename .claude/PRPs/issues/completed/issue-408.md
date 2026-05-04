# Investigation: Images don't render in chat messages

**Issue**: #408 (https://github.com/tbrandenburg/made/issues/408)
**Type**: BUG
**Investigated**: 2026-05-04T06:00:00Z

### Assessment

| Metric     | Value  | Reasoning                                                                                      |
| ---------- | ------ | ---------------------------------------------------------------------------------------------- |
| Severity   | HIGH   | Images in chat are completely non-functional with no workaround; chat is a core feature        |
| Complexity | MEDIUM | 3 files to update (markdown.ts, 3 page components), pipeline reorder needed                   |
| Confidence | HIGH   | Root cause is clearly identified at markdown.ts:130,150 with concrete code evidence            |

---

## Problem Statement

Images referenced in chat messages are silently dropped and never rendered due to three compounding bugs in `packages/frontend/src/utils/markdown.ts`. First, the `ALLOWED_URI_REGEXP` in DOMPurify only allows `https?/mailto/tel` schemes so relative paths are stripped. Second, `sanitizeHtml()` is called inside the `marked` postprocess hook before `renderMarkdown` can resolve relative URLs to absolute API URLs. Third, the three page components (TaskPage, KnowledgeArtefactPage, ConstitutionPage) pass `markdownOptions` to `<ChatWindow>` without a `repositoryName`, triggering an early return that skips image URL resolution entirely.

---

## Analysis

### Root Cause

Three compounding issues:

1. **DOMPurify URI allowlist** (`markdown.ts:130`): `ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/i` — relative paths like `/api/repositories/...` don't match, so DOMPurify blanks the `src` attribute.

2. **Pipeline order** (`markdown.ts:134-138`): `marked.use()` postprocess hook calls `sanitizeHtml()` first (inside `marked.parse()`), stripping relative `src` values. The `resolveRepositoryAssetUrl` replacement in `renderMarkdown` runs **after** on already-sanitized HTML, always seeing `src=""`.

3. **Missing `repositoryName`** (`markdown.ts:150-152`): All three chat-hosting pages omit `repositoryName` from `markdownOptions`, so the early return fires and URL resolution is skipped entirely.

### Evidence Chain

WHY: Images in chat have blank `src` attributes  
↓ BECAUSE: `renderMarkdown` skips URL resolution due to missing `repositoryName`  
Evidence: `markdown.ts:150-152`
```typescript
if (!options?.repositoryName || !options.currentFilePath) {
  return rendered;
}
```

↓ BECAUSE: All three pages only pass `currentFilePath`, not `repositoryName`  
Evidence: `TaskPage.tsx:592-594`
```tsx
markdownOptions={{
  currentFilePath: name || undefined,
}}
```
(same pattern at `KnowledgeArtefactPage.tsx:648-650` and `ConstitutionPage.tsx:633-635`)

↓ EVEN IF `repositoryName` were passed: Sanitization runs before URL resolution  
Evidence: `markdown.ts:134-138`
```typescript
marked.use({
  hooks: {
    postprocess(html) {
      return addExternalLinkAttributes(sanitizeHtml(html));  // strips relative src
    },
  },
});
```
Then `renderMarkdown` does the regex replace on already-sanitized HTML at `markdown.ts:154-165`.

↓ ROOT CAUSE: URI allowlist also blocks relative paths even if order were fixed  
Evidence: `markdown.ts:130`
```typescript
ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/i,
```

### Affected Files

| File                                                          | Lines   | Action | Description                                          |
| ------------------------------------------------------------- | ------- | ------ | ---------------------------------------------------- |
| `packages/frontend/src/utils/markdown.ts`                    | 130-165 | UPDATE | Fix URI regex, move sanitization after URL resolution |
| `packages/frontend/src/pages/TaskPage.tsx`                   | 592-594 | UPDATE | Add `repositoryName` to `markdownOptions`            |
| `packages/frontend/src/pages/KnowledgeArtefactPage.tsx`      | 648-650 | UPDATE | Add `repositoryName` to `markdownOptions`            |
| `packages/frontend/src/pages/ConstitutionPage.tsx`           | 633-635 | UPDATE | Add `repositoryName` to `markdownOptions`            |
| `packages/frontend/src/utils/markdown.test.ts`               | -       | UPDATE | Add tests for chat image rendering                   |

### Integration Points

- `marked.use()` postprocess hook at `markdown.ts:134` runs on ALL markdown output — changes affect entire app
- `renderMarkdown()` called from: `ChatWindow.tsx:102`, `TaskPage.tsx:512`, `KnowledgeArtefactPage.tsx:575`, `ConstitutionPage.tsx:557`
- `resolveRepositoryAssetUrl()` at `markdown.ts:28-71` — works correctly, just called too late

---

## Implementation Plan

### Step 1: Move sanitization out of `marked` postprocess hook

**File**: `packages/frontend/src/utils/markdown.ts`  
**Lines**: 134-138  
**Action**: UPDATE

**Current code:**
```typescript
marked.use({
  hooks: {
    postprocess(html) {
      return addExternalLinkAttributes(sanitizeHtml(html));
    },
  },
});
```

**Required change:**
```typescript
marked.use({
  hooks: {
    postprocess(html) {
      return html;  // sanitization moved to renderMarkdown after URL resolution
    },
  },
});
```

**Why**: The postprocess hook runs during `marked.parse()`. By deferring sanitization to `renderMarkdown`, we can resolve relative URLs to absolute API URLs first, then sanitize.

---

### Step 2: Update `ALLOWED_URI_REGEXP` to allow origin-relative API paths

**File**: `packages/frontend/src/utils/markdown.ts`  
**Lines**: 130  
**Action**: UPDATE

**Current code:**
```typescript
ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/i,
```

**Required change:**
```typescript
ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel:|\/)/i,
```

**Why**: After URL resolution, `resolveRepositoryAssetUrl` produces paths like `/api/repositories/.../web/...` (origin-relative, starting with `/`). These must pass the DOMPurify URI check. Note: when `window.location.origin` is available, the function produces fully absolute `https://...` URLs. The `\/` pattern is a safety net for SSR/test environments.

---

### Step 3: Reorder pipeline in `renderMarkdown` — resolve URLs before sanitizing

**File**: `packages/frontend/src/utils/markdown.ts`  
**Lines**: 142-165  
**Action**: UPDATE

**Current code:**
```typescript
export const renderMarkdown = (
  content: string,
  options?: MarkdownRenderOptions,
) => {
  const rendered = marked.parse(content, {
    async: false,
  }) as string;

  if (!options?.repositoryName || !options.currentFilePath) {
    return rendered;
  }

  return rendered.replace(
    /<img\b([^>]*?)\bsrc="([^"]*)"([^>]*)>/gi,
    (_, before: string, src: string, after: string) => {
      const nextSrc = resolveRepositoryAssetUrl(
        src,
        options.repositoryName,
        options.currentFilePath,
      );

      return `<img${before}src="${nextSrc}"${after}>`;
    },
  );
};
```

**Required change:**
```typescript
export const renderMarkdown = (
  content: string,
  options?: MarkdownRenderOptions,
) => {
  const rendered = marked.parse(content, {
    async: false,
  }) as string;

  // Resolve repository asset URLs BEFORE sanitization
  const withResolvedUrls = options?.repositoryName
    ? rendered.replace(
        /<img\b([^>]*?)\bsrc="([^"]*)"([^>]*)>/gi,
        (_, before: string, src: string, after: string) => {
          const nextSrc = resolveRepositoryAssetUrl(
            src,
            options.repositoryName,
            options.currentFilePath,
          );
          return `<img${before}src="${nextSrc}"${after}>`;
        },
      )
    : rendered;

  // Sanitize AFTER URL resolution so resolved https:// URLs pass URI check
  return addExternalLinkAttributes(sanitizeHtml(withResolvedUrls));
};
```

**Why**: URL resolution must happen before DOMPurify sees the HTML. The early return is removed — sanitization now always runs. `repositoryName` alone is enough to enable URL resolution; `currentFilePath` is still used by `resolveRepositoryAssetUrl` internally (handles missing gracefully).

---

### Step 4: Pass `repositoryName` from TaskPage chat

**File**: `packages/frontend/src/pages/TaskPage.tsx`  
**Lines**: 592-594  
**Action**: UPDATE

**Current code:**
```tsx
markdownOptions={{
  currentFilePath: name || undefined,
}}
```

**Required change:**
```tsx
markdownOptions={{
  repositoryName: name || undefined,
  currentFilePath: name || undefined,
}}
```

**Why**: `name` is the task name (= repository name in this context). Passing it enables image URL resolution for chat messages.

---

### Step 5: Pass `repositoryName` from KnowledgeArtefactPage chat

**File**: `packages/frontend/src/pages/KnowledgeArtefactPage.tsx`  
**Lines**: 648-650  
**Action**: UPDATE

**Current code:**
```tsx
markdownOptions={{
  currentFilePath: name || undefined,
}}
```

**Required change:**
```tsx
markdownOptions={{
  repositoryName: name || undefined,
  currentFilePath: name || undefined,
}}
```

---

### Step 6: Pass `repositoryName` from ConstitutionPage chat

**File**: `packages/frontend/src/pages/ConstitutionPage.tsx`  
**Lines**: 633-635  
**Action**: UPDATE

**Current code:**
```tsx
markdownOptions={{
  currentFilePath: name || undefined,
}}
```

**Required change:**
```tsx
markdownOptions={{
  repositoryName: name || undefined,
  currentFilePath: name || undefined,
}}
```

---

### Step 7: Add/Update Tests

**File**: `packages/frontend/src/utils/markdown.test.ts`  
**Action**: UPDATE

**Test cases to add:**
```typescript
describe("renderMarkdown image rendering in chat context", () => {
  it("resolves relative image src before sanitization when repositoryName given", () => {
    const html = renderMarkdown("![Diagram](./assets/flow.png)", {
      repositoryName: "my-repo",
      currentFilePath: "docs/README.md",
    });
    expect(html).toContain("<img");
    expect(html).not.toContain('src=""');
    expect(html).toContain("/api/repositories/my-repo/web/docs/assets/flow.png");
  });

  it("sanitizes output even without repositoryName", () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });

  it("does not resolve images when repositoryName is absent", () => {
    const html = renderMarkdown("![Pic](./image.png)");
    // src is stripped by DOMPurify (relative path, no resolution)
    expect(html).not.toContain('src="./image.png"');
  });
});
```

---

## Patterns to Follow

```typescript
// SOURCE: packages/frontend/src/utils/markdown.ts:28-71
// resolveRepositoryAssetUrl handles undefined repositoryName/currentFilePath gracefully
const resolveRepositoryAssetUrl = (
  source: string,
  repositoryName?: string,
  currentFilePath?: string,
): string => {
  if (!repositoryName || !currentFilePath || !isRelativePath(source))
    return source;
  // ...
};
```

---

## Edge Cases & Risks

| Risk/Edge Case                                         | Mitigation                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `ALLOWED_URI_REGEXP` change allows unexpected schemes  | `\/` only allows origin-relative; `javascript:` and `data:` still blocked     |
| Removing early return changes sanitization for no-repo callers | Sanitization was already happening in postprocess hook — behavior preserved  |
| `currentFilePath` undefined when `repositoryName` set | `resolveRepositoryAssetUrl` returns source unchanged when `currentFilePath` missing |
| postprocess hook now a no-op                          | `addExternalLinkAttributes` and `sanitizeHtml` both still called in `renderMarkdown` |

---

## Validation

### Automated Checks

```bash
cd packages/frontend && npm run type-check
cd packages/frontend && npm test -- --run markdown
cd packages/frontend && npm run lint
# Or from root:
make qa-quick
```

### Manual Verification

1. Place an image inside a repository (e.g. `docs/image.png`)
2. Open the task/knowledge/constitution page for that repository
3. In chat, send `![test](./image.png)` — image should render inline
4. Send `![xss](javascript:alert(1))` — must NOT execute script
5. Open a repository markdown file with an image — still renders correctly (regression check)

---

## Scope Boundaries

**IN SCOPE:**
- Fix `ALLOWED_URI_REGEXP` to allow origin-relative `/api/...` paths
- Move sanitization to after URL resolution in `renderMarkdown`
- Pass `repositoryName` to `<ChatWindow>` in TaskPage, KnowledgeArtefactPage, ConstitutionPage
- Update tests to cover fixed behavior

**OUT OF SCOPE (do not touch):**
- `resolveRepositoryAssetUrl` logic (works correctly)
- DOMPurify allowed tags/attributes list
- Serving images from `/tmp/` or arbitrary local paths (requires new backend endpoint)
- Any refactor of non-chat markdown rendering paths

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-05-04T06:00:00Z
- **Artifact**: `.claude/PRPs/issues/issue-408.md`
