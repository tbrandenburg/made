# Investigation: ChatWindow: replace scrollToIndex+rAF initial scroll with Virtuoso initialTopMostItemIndex

**Issue**: #484 (https://github.com/tbrandenburg/made/issues/484)
**Type**: ENHANCEMENT
**Investigated**: 2026-06-24T00:00:00Z

### Assessment

| Metric     | Value                           | Reasoning                                                                                                                          |
| ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Priority   | LOW                             | Enhancement improves reliability of an already-working scroll restoration; labeled priority/low and severity/low by the project    |
| Complexity | LOW                             | Isolated change to 1 component file + 1 test file; no new dependencies, no architectural changes, well-understood Virtuoso API     |
| Confidence | HIGH                            | Clear root cause (fragile effect-based scroll), well-documented Virtuoso API, parent components verified to clear chat before session switches (ensures remount) |

## Problem Statement

When Virtuoso mounts with existing data (session restoration), `ChatWindow.tsx` uses a `useEffect` + `requestAnimationFrame` + ref guard (`initialScrollDoneRef`) to scroll to the last message. This is fragile: Virtuoso may not have measured all item heights when the effect fires, and a single rAF retry is unreliable for large message lists. Virtuoso's built-in `initialTopMostItemIndex` prop solves this correctly by telling Virtuoso where to start rendering before the first paint, eliminating the post-mount jump entirely.

## Analysis

### Change Rationale

Virtuoso provides `initialTopMostItemIndex` specifically for initial-scroll-on-mount scenarios. Since `<Virtuoso>` is conditionally rendered only when `chat.length > 0` (ChatWindow.tsx:205: `{chat.length > 0 && <Virtuoso .../>}`), it naturally unmounts when chat empties and remounts when data arrives. Every parent component (`RepositoryPage.tsx`, `TaskPage.tsx`, `KnowledgeArtefactPage.tsx`, `ConstitutionPage.tsx`) clears chat to `[]` before loading new session data (verified — all 4 pages call `setChat([])` before `setSessionId(id)` or before the fetch), ensuring the remount cycle works correctly for session switches. The existing `followOutput` prop (line 267) handles streaming scrolls after mount. The imperative `scrollToBottom()` handle (lines 185-192) is unaffected.

### Evidence Chain

SYMPTOM: `scrollToIndex`+`requestAnimationFrame` pattern is fragile for large message lists on session restoration
↓
BECAUSE: Virtuoso may not have measured all item heights when the `useEffect` fires
Evidence: `ChatWindow.tsx:163-183` — effect calls `scrollToIndex` then retries once in rAF

↓
BECAUSE: The effect has no awareness of Virtuoso's internal measurement completion; the single rAF retry is not guaranteed to fire after all measurements
Evidence: `ChatWindow.tsx:174-181` — `requestAnimationFrame` with no loop or measurement check

↓
BECAUSE: The `initialTopMostItemIndex` prop exists specifically to handle this declaratively but is not used
Evidence: `ChatWindow.tsx:205-270` — `<Virtuoso>` component lacks `initialTopMostItemIndex` prop

↓
ROOT CAUSE: The scroll-on-mount pattern uses a fragile imperative effect-based approach (`scrollToIndex` + rAF + ref guard) instead of Virtuoso's declarative `initialTopMostItemIndex` prop
Evidence: `ChatWindow.tsx:142` (`initialScrollDoneRef`), `ChatWindow.tsx:155-157` (`sessionId` reset effect), `ChatWindow.tsx:163-183` (scroll effect)

### Affected Files

| File                                        | Lines        | Action  | Description                                            |
| ------------------------------------------- | ------------ | ------- | ------------------------------------------------------ |
| `packages/frontend/src/components/ChatWindow.tsx` | 142, 155-183 | UPDATE  | Remove `initialScrollDoneRef`, sessionId effect, scroll effect; add `initialTopMostItemIndex` |
| `packages/frontend/src/components/ChatWindow.test.tsx` | 7-50, 240-411 | UPDATE | Update mock, rewrite 3 initial-scroll tests |

### Integration Points

- `ChatWindow.tsx:205` — Conditional `<Virtuoso>` mount/unmount based on `chat.length > 0`
- `ChatWindow.tsx:267` — `followOutput` prop handles streaming scrolls after mount (unchanged)
- `ChatWindow.tsx:185-192` — Imperative `scrollToBottom()` handle (unchanged)
- Parent pages (`RepositoryPage.tsx`, `TaskPage.tsx`, etc.) — all clear `chat` to `[]` before session switches, ensuring Virtuoso remounts

### Git History

- **Introduced**: `b03cbe80` - 2026-06-03 - "fix: restore scroll position on initial load and session switch (#460) (#464)"
- **Last modified**: `b03cbe80` - 2026-06-03
- **Implication**: Not a regression — this was the original fix for the scroll restoration feature, introduced as an improvement over a previous DOM-scroll approach. Now being further improved by using the proper Virtuoso API.

## Implementation Plan

### Step 1: Remove scroll-effect machinery from ChatWindow.tsx

**File**: `packages/frontend/src/components/ChatWindow.tsx`
**Lines**: 142, 155-183
**Action**: UPDATE — delete `initialScrollDoneRef`, the `sessionId` reset effect, and the scroll effect

**Current code (lines 141-183):**

```typescript
const virtuosoRef = React.useRef<VirtuosoHandle>(null);
const initialScrollDoneRef = React.useRef(false);
const [scrollParent, setScrollParent] =
  React.useState<HTMLDivElement | null>(null);
const setChatWindowElement = React.useCallback(
  (element: HTMLDivElement | null) => {
    setScrollParent(element);
  },
  [],
);

// When the user switches to a different session, the next non-empty load
// should restore to bottom again. Must run before the initial-scroll effect
// so the flag is cleared before that effect evaluates it in the same cycle.
React.useEffect(() => {
  initialScrollDoneRef.current = false;
}, [sessionId]);

// Scroll to bottom on initial load: fires once when both the scroll container
// and the first batch of messages are ready. Uses "auto" (instant) so the user
// never sees a scroll animation on restore. A single rAF retry handles the case
// where item heights are still being measured by Virtuoso on first layout.
React.useEffect(() => {
  if (initialScrollDoneRef.current) return;
  if (!scrollParent || !chat.length || !virtuosoRef.current) return;

  initialScrollDoneRef.current = true;
  virtuosoRef.current.scrollToIndex({
    index: chat.length - 1,
    align: "end",
    behavior: "auto",
  });

  // One retry after the browser has settled the first layout pass.
  const raf = requestAnimationFrame(() => {
    virtuosoRef.current?.scrollToIndex({
      index: chat.length - 1,
      align: "end",
      behavior: "auto",
    });
  });
  return () => cancelAnimationFrame(raf);
}, [scrollParent, chat.length]);
```

**Required change:** Delete `initialScrollDoneRef` (line 142), the `sessionId` reset effect (lines 155-157), and the scroll effect (lines 163-183). Keep `virtuosoRef`, `scrollParent`, `setChatWindowElement`.

**New code (lines 141-150):**

```typescript
const virtuosoRef = React.useRef<VirtuosoHandle>(null);
const [scrollParent, setScrollParent] =
  React.useState<HTMLDivElement | null>(null);
const setChatWindowElement = React.useCallback(
  (element: HTMLDivElement | null) => {
    setScrollParent(element);
  },
  [],
);
```

**Why**: `initialTopMostItemIndex` replaces the imperative scroll-to-last behavior declaratively. The `sessionId` reset effect is no longer needed because Virtuoso unmounts when `chat.length` goes to 0 and remounts with new data — `initialTopMostItemIndex` fires on every fresh mount.

### Step 2: Add `initialTopMostItemIndex` prop to `<Virtuoso>`

**File**: `packages/frontend/src/components/ChatWindow.tsx`
**Lines**: 205-270
**Action**: UPDATE — add `initialTopMostItemIndex` prop

**Current code:**

```typescript
<Virtuoso
  ref={virtuosoRef}
  customScrollParent={scrollParent ?? undefined}
  data={chat}
  itemContent={itemContent}
  components={{
    Item: SpacedItem,
    Footer: () => (
      <>
        {refreshing && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Refreshing...</span>
          </div>
        )}
        {!refreshing && sessionLoading && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Loading session...</span>
          </div>
        )}
        {!refreshing && !sessionLoading && agentProcessing && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Agent is thinking...</span>
          </div>
        )}
        {sessionId && (
          <div className="chat-session-id" aria-label="Session ID">
            <span>Session ID: {sessionId}</span>
            <button
              type="button"
              className="icon-button-small"
              aria-label={
                isSessionSaved ? "Session saved" : "Save session"
              }
              title={
                isSessionSaved
                  ? "Session already saved"
                  : "Save session"
              }
              onClick={onSaveSession}
              disabled={!onSaveSession || isSessionSaved}
            >
              <SaveIcon />
            </button>
            <button
              type="button"
              className="icon-button-small"
              aria-label="Clear session"
              title="Clear session"
              onClick={onClearSession}
              disabled={!onClearSession}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </>
    ),
  }}
  followOutput={(atBottom) => (atBottom ? "auto" : false)}
  increaseViewportBy={{ top: 300, bottom: 300 }}
  style={{ height: "auto" }}
/>
```

**Required change:** Add `initialTopMostItemIndex` after the `ref` prop:

```typescript
<Virtuoso
  ref={virtuosoRef}
  initialTopMostItemIndex={
    chat.length > 0
      ? { index: chat.length - 1, align: "end", behavior: "auto" }
      : 0
  }
  customScrollParent={scrollParent ?? undefined}
  data={chat}
  itemContent={itemContent}
  components={{
    Item: SpacedItem,
    Footer: () => (
      <>
        {refreshing && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Refreshing...</span>
          </div>
        )}
        {!refreshing && sessionLoading && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Loading session...</span>
          </div>
        )}
        {!refreshing && !sessionLoading && agentProcessing && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Agent is thinking...</span>
          </div>
        )}
        {sessionId && (
          <div className="chat-session-id" aria-label="Session ID">
            <span>Session ID: {sessionId}</span>
            <button
              type="button"
              className="icon-button-small"
              aria-label={
                isSessionSaved ? "Session saved" : "Save session"
              }
              title={
                isSessionSaved
                  ? "Session already saved"
                  : "Save session"
              }
              onClick={onSaveSession}
              disabled={!onSaveSession || isSessionSaved}
            >
              <SaveIcon />
            </button>
            <button
              type="button"
              className="icon-button-small"
              aria-label="Clear session"
              title="Clear session"
              onClick={onClearSession}
              disabled={!onClearSession}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </>
    ),
  }}
  followOutput={(atBottom) => (atBottom ? "auto" : false)}
  increaseViewportBy={{ top: 300, bottom: 300 }}
  style={{ height: "auto" }}
/>
```

**Why**: `initialTopMostItemIndex` with the object form `{ index, align: "end", behavior: "auto" }` matches the previous `scrollToIndex` arguments exactly, but is handled by Virtuoso internally before the first paint. When `chat.length === 0`, Virtuoso is not rendered (conditional at line 205), so the fallback `0` is never used but satisfies TypeScript.

### Step 3: Update Virtuoso mock to track `initialTopMostItemIndex`

**File**: `packages/frontend/src/components/ChatWindow.test.tsx`
**Lines**: 7-50
**Action**: UPDATE — add `initialTopMostItemIndexMock` and extend mock props

**Current code:**

```typescript
const scrollToIndexMock = vi.hoisted(() => vi.fn());

interface MockVirtuosoHandle {
  scrollToIndex: (location: {
    index: number;
    align: "end";
    behavior: "smooth";
  }) => void;
}

interface MockVirtuosoProps {
  data: ChatMessage[];
  itemContent: (index: number, message: ChatMessage) => ReactNode;
  components?: {
    Item?: ComponentType<React.HTMLAttributes<HTMLDivElement>>;
    Footer?: ComponentType;
  };
}

vi.mock("react-virtuoso", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");

  return {
    Virtuoso: ReactModule.forwardRef<MockVirtuosoHandle, MockVirtuosoProps>(
      function MockVirtuoso({ data, itemContent, components }, ref) {
        ReactModule.useImperativeHandle(ref, () => ({
          scrollToIndex: scrollToIndexMock,
        }));
        const Item = components?.Item;
        const Footer = components?.Footer;

        return (
          <div>
            {data.map((message, index) => {
              const content = itemContent(index, message);
              return Item ? <Item key={message.id}>{content}</Item> : content;
            })}
            {Footer ? <Footer /> : null}
          </div>
        );
      },
    ),
  };
});
```

**Required change:**

```typescript
const scrollToIndexMock = vi.hoisted(() => vi.fn());
const initialTopMostItemIndexMock = vi.hoisted(() => vi.fn());

interface MockVirtuosoHandle {
  scrollToIndex: (location: {
    index: number;
    align: "end";
    behavior: "smooth";
  }) => void;
}

interface MockVirtuosoProps {
  data: ChatMessage[];
  itemContent: (index: number, message: ChatMessage) => ReactNode;
  components?: {
    Item?: ComponentType<React.HTMLAttributes<HTMLDivElement>>;
    Footer?: ComponentType;
  };
  initialTopMostItemIndex?: number | { index: number; align?: string; behavior?: string };
}

vi.mock("react-virtuoso", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");

  return {
    Virtuoso: ReactModule.forwardRef<MockVirtuosoHandle, MockVirtuosoProps>(
      function MockVirtuoso({ data, itemContent, components, initialTopMostItemIndex }, ref) {
        ReactModule.useImperativeHandle(ref, () => ({
          scrollToIndex: scrollToIndexMock,
        }));
        const Item = components?.Item;
        const Footer = components?.Footer;

        // Track the initialTopMostItemIndex prop for test assertions
        initialTopMostItemIndexMock(initialTopMostItemIndex);

        return (
          <div>
            {data.map((message, index) => {
              const content = itemContent(index, message);
              return Item ? <Item key={message.id}>{content}</Item> : content;
            })}
            {Footer ? <Footer /> : null}
          </div>
        );
      },
    ),
  };
});
```

**Why**: The mock needs to accept and track `initialTopMostItemIndex` so tests can assert the correct value is passed. The `initialTopMostItemIndexMock` is a `vi.hoisted` spy that captures the prop on every render.

Also add `initialTopMostItemIndexMock.mockClear()` to the `beforeEach` block:

**Current (line 61-63):**
```typescript
beforeEach(() => {
  scrollToIndexMock.mockClear();
});
```

**Required:**
```typescript
beforeEach(() => {
  scrollToIndexMock.mockClear();
  initialTopMostItemIndexMock.mockClear();
});
```

### Step 4: Update "scrolls to the bottom on initial load" test

**File**: `packages/frontend/src/components/ChatWindow.test.tsx`
**Lines**: 240-262
**Action**: UPDATE

**Current test:**

```typescript
it("scrolls to the bottom on initial load when chat becomes non-empty", async () => {
  const chatWindowRef = React.createRef<ChatWindowHandle>();
  scrollToIndexMock.mockClear();

  render(
    <ChatWindow
      chatWindowRef={chatWindowRef}
      chat={[makeMessage(), makeMessage(), makeMessage()]}
      loading={false}
      emptyMessage="empty"
    />,
  );

  // Wait for the rAF retry to flush
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  // Should have been called (at least once) with the last index
  expect(scrollToIndexMock).toHaveBeenCalledWith(
    expect.objectContaining({ index: 2, align: "end", behavior: "auto" }),
  );
});
```

**Required change:** Replace with test that verifies `initialTopMostItemIndex` prop value:

```typescript
it("sets initialTopMostItemIndex to the last index when chat is non-empty on mount", () => {
  render(
    <ChatWindow
      chat={[makeMessage(), makeMessage(), makeMessage()]}
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );

  expect(initialTopMostItemIndexMock).toHaveBeenCalledWith(
    expect.objectContaining({ index: 2, align: "end", behavior: "auto" }),
  );
});
```

**Why**: With `initialTopMostItemIndex`, there's no async effect or rAF to wait for — the prop is passed synchronously on the first render. The test no longer needs `await act` or `chatWindowRef`. The assertion changes from "scrollToIndex was called" to "initialTopMostItemIndex prop value is correct".

### Step 5: Update "does not repeat initial-scroll when chat grows" test

**File**: `packages/frontend/src/components/ChatWindow.test.tsx`
**Lines**: 264-295
**Action**: UPDATE

**Current test:**

```typescript
it("does not repeat initial-scroll when chat grows after first load", async () => {
  const chatWindowRef = React.createRef<ChatWindowHandle>();
  const { rerender } = render(
    <ChatWindow
      chatWindowRef={chatWindowRef}
      chat={[makeMessage()]}
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );

  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  scrollToIndexMock.mockClear();

  // Simulate a streaming message being appended
  rerender(
    <ChatWindow
      chatWindowRef={chatWindowRef}
      chat={[makeMessage(), makeMessage()]}
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );

  // The initial-scroll effect must NOT fire again (it's guarded by the ref).
  // followOutput handles streaming updates.
  expect(scrollToIndexMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ behavior: "auto" }),
  );
});
```

**Required change:** Replace with test that verifies prop updates passively (Virtuoso ignores prop changes after mount, but the test confirms the prop is correctly passed):

```typescript
it("passes updated initialTopMostItemIndex on rerender (Virtuoso ignores after mount, followOutput handles growth)", () => {
  const { rerender } = render(
    <ChatWindow
      chat={[makeMessage()]}
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );

  expect(initialTopMostItemIndexMock).toHaveBeenCalledWith(
    expect.objectContaining({ index: 0, align: "end", behavior: "auto" }),
  );

  initialTopMostItemIndexMock.mockClear();

  // Simulate streaming growth — followOutput (unchanged) handles this,
  // but the prop is still correctly updated.
  rerender(
    <ChatWindow
      chat={[makeMessage(), makeMessage()]}
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );

  expect(initialTopMostItemIndexMock).toHaveBeenCalledWith(
    expect.objectContaining({ index: 1, align: "end", behavior: "auto" }),
  );
});
```

**Why**: `initialTopMostItemIndex` is a prop — it gets passed on every render, but Virtuoso only uses it on mount. The test verifies the correct value is always passed. The `chat.length` growth is handled by `followOutput` (unchanged).

### Step 6: Update "resets initial scroll when sessionId changes" test

**File**: `packages/frontend/src/components/ChatWindow.test.tsx`
**Lines**: 378-411
**Action**: UPDATE

**Current test:**

```typescript
it("resets initial scroll when sessionId changes", async () => {
  const chatWindowRef = React.createRef<ChatWindowHandle>();
  const { rerender } = render(
    <ChatWindow
      chatWindowRef={chatWindowRef}
      chat={[makeMessage()]}
      sessionId="session-1"
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  scrollToIndexMock.mockClear();

  // Switch session with new history
  rerender(
    <ChatWindow
      chatWindowRef={chatWindowRef}
      chat={[makeMessage(), makeMessage()]}
      sessionId="session-2"
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  expect(scrollToIndexMock).toHaveBeenCalledWith(
    expect.objectContaining({ index: 1, align: "end", behavior: "auto" }),
  );
});
```

**Required change:** Replace with test that verifies the prop reflects the new session's last index:

```typescript
it("passes updated initialTopMostItemIndex on sessionId change (Virtuoso remount on chat change)", () => {
  const { rerender } = render(
    <ChatWindow
      chat={[makeMessage()]}
      sessionId="session-1"
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );

  expect(initialTopMostItemIndexMock).toHaveBeenCalledWith(
    expect.objectContaining({ index: 0, align: "end", behavior: "auto" }),
  );

  initialTopMostItemIndexMock.mockClear();

  // Simulate session switch: parent clears chat (sets to []) then loads new history.
  // In real flow, Virtuoso would unmount during chat=[] and remount with new data.
  // The test verifies the prop is correctly computed on the new render.
  rerender(
    <ChatWindow
      chat={[makeMessage(), makeMessage()]}
      sessionId="session-2"
      agentProcessing={false}
      emptyMessage="empty"
    />,
  );

  expect(initialTopMostItemIndexMock).toHaveBeenCalledWith(
    expect.objectContaining({ index: 1, align: "end", behavior: "auto" }),
  );
});
```

**Why**: The `sessionId` reset effect is no longer needed because Virtuoso will remount when `chat.length` goes from 0→non-0 on session switch. Parent components all call `setChat([])` before loading new session data, ensuring Virtuoso unmounts, then remounts with `initialTopMostItemIndex` applied.

## Patterns to Follow

**From codebase — mirror these exactly:**

```typescript
// SOURCE: ChatWindow.tsx:205-270
// Pattern for Virtuoso component with existing props
<Virtuoso
  ref={virtuosoRef}
  customScrollParent={scrollParent ?? undefined}
  data={chat}
  itemContent={itemContent}
  components={{ ... }}
  followOutput={(atBottom) => (atBottom ? "auto" : false)}
  increaseViewportBy={{ top: 300, bottom: 300 }}
  style={{ height: "auto" }}
/>
```

```typescript
// SOURCE: ChatWindow.test.tsx:26-50
// Pattern for Virtuoso mock with forwarded ref
vi.mock("react-virtuoso", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    Virtuoso: ReactModule.forwardRef<MockVirtuosoHandle, MockVirtuosoProps>(
      function MockVirtuoso({ data, itemContent, components }, ref) {
        ReactModule.useImperativeHandle(ref, () => ({
          scrollToIndex: scrollToIndexMock,
        }));
        // Render logic...
      },
    ),
  };
});
```

```typescript
// SOURCE: ChatWindow.test.tsx:240-262
// Pattern for initial-scroll test (current — to be replaced)
it("scrolls to the bottom on initial load when chat becomes non-empty", async () => {
  // Uses await act + setTimeout for rAF flush
});
```

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
|----------------|------------|
| `chat.length` is 1 (single message mount) | `index: 0` is correct — passes `{ index: 0, align: "end", behavior: "auto" }` |
| Chat appended during streaming after mount | `followOutput` prop (unchanged, line 267) already handles this |
| `initialTopMostItemIndex` type signature | react-virtuoso ^4.18.7 accepts `number \| IndexLocationWithAlign`; the object form `{ index, align, behavior }` is fully compatible |
| Session switch where parent doesn't clear chat first | Verified: all 4 parent pages (RepositoryPage, TaskPage, KnowledgeArtefactPage, ConstitutionPage) call `setChat([])` before loading new session data |
| `handleClearSessionOnly` (clear session but keep chat) | Chat remains visible; no new mount of Virtuoso, so `initialTopMostItemIndex` doesn't fire — correct behavior since session ID is just being nulled |
| Reload failure restoring previous chat | `reloadCurrentSession` calls `setChat(chatBeforeRefresh)` on error; this does NOT remount Virtuoso (chat goes [] → [] after error? No — chat goes [] → fetch → on error, setChat(chatBeforeRefresh) so Virtuoso remounts). Actually chat goes from [old messages] → [] → [old messages restored]. Virtuoso will remount during the [] window. On remount with restored chat, `initialTopMostItemIndex` fires with the restored chat's last index. This is correct behavior. |

## Validation

### Automated Checks

```bash
# Type-check
cd packages/frontend && npx tsc --noEmit

# Run specific test file
cd packages/frontend && npx vitest run src/components/ChatWindow.test.tsx

# Full lint
make lint
```

### Manual Verification

1. Start the app and restore a session with many messages — verify the list initially shows the last message without a visible scroll jump
2. Switch sessions — verify the new session loads scrolled to bottom
3. Stream new messages — verify `followOutput` keeps the view at the bottom
4. Click application "scroll to bottom" button — verify imperative `scrollToBottom()` still works
5. Clear session only (keep chat visible) — verify no visual regression

## Scope Boundaries

**IN SCOPE:**

- Remove `initialScrollDoneRef`, `sessionId` reset useEffect, and scroll useEffect from `ChatWindow.tsx`
- Add `initialTopMostItemIndex` prop to `<Virtuoso>` in `ChatWindow.tsx`
- Add `initialTopMostItemIndexMock` to the Virtuoso mock in `ChatWindow.test.tsx`
- Rewrite 3 test cases that assert on `scrollToIndexMock` to assert on `initialTopMostItemIndexMock`
- Add `initialTopMostItemIndexMock.mockClear()` to `beforeEach`

**OUT OF SCOPE (do not touch):**

- The imperative `scrollToBottom()` handle (lines 185-192) — still needed for parent-triggered scrolling
- The `followOutput` prop (line 267) — already handles streaming scrolls correctly
- Parent components (`RepositoryPage.tsx`, `TaskPage.tsx`, etc.) — their `scrollToBottom()` callbacks and session-switching logic are unaffected
- The `scrollParent` state and `setChatWindowElement` callback ref — still needed for `customScrollParent`
- The `SpacedItem` component and other rendering utilities
- Any other files in the codebase

## Metadata

- **Investigated by**: issue-resolution-workflow
- **Timestamp**: 2026-06-24T00:00:00Z
- **Artifact**: `.agents/issues/issue-484.md`
