# Investigation: P0: Chat performance degrades severely as history grows

**Issue**: #432 (https://github.com/tbrandenburg/made/issues/432)
**Type**: BUG
**Investigated**: 2026-06-01T09:27:29Z

### Assessment

| Metric     | Value    | Reasoning |
| ---------- | -------- | --------- |
| Severity   | CRITICAL | The issue is labeled `severity/critical` and current code confirms each chat update can synchronously re-render, parse Markdown, sanitize HTML, write full history to localStorage, and force scroll layout across growing message history, which can make the main chat UI unusable with no in-app workaround. |
| Complexity | HIGH     | The fix spans at least `ChatWindow`, `usePersistentChat`, chat page call sites, package dependencies, and tests, with integration risk around dynamic-height message virtualization and scroll-follow behavior. |
| Confidence | HIGH     | The issue report's bottleneck chain is directly evidenced by current file:line references, and git blame shows the problematic render, persistence, and scroll paths are active code rather than stale assumptions. |

---

## Problem Statement

The repository chat page becomes progressively slower as conversation history grows because the frontend does heavy synchronous work proportional to total message count on every chat update. `ChatWindow` renders every message and calls Markdown parsing/sanitization inside render, `usePersistentChat` serializes and writes the full chat array on every state change, and `RepositoryPage` forces scroll layout after every chat update while polling can repeat the flow every 5 seconds.

---

## Analysis

### Root Cause / Change Rationale

WHY 1: Why does the chat UI slow down as history grows?
BECAUSE: `ChatWindow` maps over the full `chat` array on every render and creates a complete message element tree for every historical message.
Evidence: `packages/frontend/src/components/ChatWindow.tsx:80-108`

```tsx
<div className="chat-window" ref={chatWindowRef}>
  {chat.map((message) => {
    const strippedMessage = stripFrontmatter(message.text || "");
    return (
      <div
        key={message.id}
        className={`chat-message ${message.role} ${message.messageType || ""}`}
      >
```

WHY 2: Why is each message render expensive?
BECAUSE: every mapped message strips frontmatter, formats timestamps, creates a copy callback and icon, and synchronously calls `renderMarkdown(strippedMessage, markdownOptions)` during render.
Evidence: `packages/frontend/src/components/ChatWindow.tsx:88-103`

```tsx
<div className="chat-meta">{formatTimestamp(message)}</div>
<button
  type="button"
  className="copy-button chat-copy-button"
  aria-label="Copy message"
  title="Copy message"
  onClick={() => copyText(strippedMessage)}
>
  <CopyIcon />
</button>
<div
  className="markdown"
  dangerouslySetInnerHTML={{
    __html: strippedMessage.trim()
      ? renderMarkdown(strippedMessage, markdownOptions)
      : "<em>Empty message</em>",
  }}
/>
```

WHY 3: Why is `renderMarkdown` CPU-bound?
BECAUSE: it performs synchronous `marked.parse`, optional regex-based image URL rewriting, DOMPurify sanitization, and link attribute rewriting.
Evidence: `packages/frontend/src/utils/markdown.ts:142-166`

```ts
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
```

WHY 4: Why does every update also block persistence?
BECAUSE: `usePersistentChat` writes `JSON.stringify(chat)` to localStorage synchronously in a `[chat, storageKey]` effect.
Evidence: `packages/frontend/src/hooks/usePersistentChat.ts:37-44`

```ts
useEffect(() => {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(chat));
  } catch (error) {
    console.warn("Failed to persist chat history to localStorage", error);
  }
}, [chat, storageKey]);
```

WHY 5: Why is the performance cost repeated during agent responses?
BECAUSE: `RepositoryPage` calls `syncChatHistory` repeatedly while chat is loading, merges incoming history into chat state, and separately forces `scrollTop = scrollHeight` after every chat state update.
Evidence: `packages/frontend/src/pages/RepositoryPage.tsx:577-585` and `packages/frontend/src/pages/RepositoryPage.tsx:1198-1208`

```tsx
const scrollToBottom = () => {
  if (chatWindowRef.current) {
    chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
  }
};

useEffect(() => {
  scrollToBottom();
}, [chat]);
```

```tsx
useEffect(() => {
  if (!chatLoading || !name || !sessionId) return;

  const controller = new AbortController();
  let timeoutId: number | undefined;

  const tick = async () => {
    await syncChatHistory(controller.signal);
    if (!controller.signal.aborted) {
      timeoutId = window.setTimeout(tick, 5000);
    }
  };
```

ROOT CAUSE: The chat UI has no windowing boundary, no memoized message rendering boundary, synchronous Markdown work in the render path, synchronous full-history localStorage writes on every state change, and unconditional scroll layout work on every chat update.
Evidence: `ChatWindow.tsx:80-108`, `markdown.ts:142-166`, `usePersistentChat.ts:37-44`, and `RepositoryPage.tsx:577-585`.

### Evidence Chain

WHY: large chat history causes slow UI.
BECAUSE: `ChatWindow` renders every message every time.
Evidence: `packages/frontend/src/components/ChatWindow.tsx:81` - `{chat.map((message) => {`

BECAUSE: per-message rendering calls Markdown conversion synchronously.
Evidence: `packages/frontend/src/components/ChatWindow.tsx:101-102` - `? renderMarkdown(strippedMessage, markdownOptions)`

BECAUSE: Markdown conversion synchronously parses and sanitizes HTML.
Evidence: `packages/frontend/src/utils/markdown.ts:146-166` - `marked.parse(... async: false ...)` followed by `sanitizeHtml` and `addExternalLinkAttributes`.

BECAUSE: each chat update serializes and writes the entire chat array.
Evidence: `packages/frontend/src/hooks/usePersistentChat.ts:40` - `localStorage.setItem(storageKey, JSON.stringify(chat));`

BECAUSE: repository chat polling can trigger this chain every 5 seconds while loading.
Evidence: `packages/frontend/src/pages/RepositoryPage.tsx:1204-1207` - `await syncChatHistory(...)` followed by `window.setTimeout(tick, 5000)`.

ROOT CAUSE: Missing performance boundaries around chat history rendering and persistence.
Evidence: no virtualization dependency exists in `packages/frontend/package.json:14-26`, and no `React.memo` boundary exists in `ChatWindow.tsx:69-144`.

### Affected Files

| File | Lines | Action | Description |
| ---- | ----- | ------ | ----------- |
| `packages/frontend/package.json` | 14-26 | UPDATE | Add a direct virtualization dependency, preferably `react-virtuoso`, and update `package-lock.json` with `npm install --workspace packages/frontend react-virtuoso`. |
| `package-lock.json` | dependency graph | UPDATE | Lock the new direct dependency. |
| `packages/frontend/src/components/ChatWindow.tsx` | 1-144 | UPDATE | Add virtualized message list, extract memoized message component, memoize stripped text/timestamp/HTML, preserve empty/loading/session controls. |
| `packages/frontend/src/hooks/usePersistentChat.ts` | 1-47 | UPDATE | Debounce full-history localStorage writes and flush pending writes on cleanup/storage-key changes. |
| `packages/frontend/src/pages/RepositoryPage.tsx` | 577-585, 1909-1924 | UPDATE | Replace unconditional scroll effect with guarded/requestAnimationFrame scrolling and pass memoized `markdownOptions` to `ChatWindow`. |
| `packages/frontend/src/pages/TaskPage.tsx` | 108-116, 581-596 | UPDATE | Apply the same guarded scrolling and memoized `markdownOptions` pattern for the shared chat component. |
| `packages/frontend/src/pages/KnowledgeArtefactPage.tsx` | 124-132, 637-652 | UPDATE | Apply the same guarded scrolling and memoized `markdownOptions` pattern. |
| `packages/frontend/src/pages/ConstitutionPage.tsx` | 126-134, 622-636 | UPDATE | Apply the same guarded scrolling and memoized `markdownOptions` pattern. |
| `packages/frontend/src/components/ChatWindow.test.tsx` | NEW | CREATE | Add coverage for empty/loading states, message rendering, memoized rendered HTML behavior, copy button, and session controls. |
| `packages/frontend/src/hooks/usePersistentChat.test.tsx` | 1-54 | UPDATE | Update quota-error test for debounce timing and add a test proving rapid updates produce a single persisted write. |

### Integration Points

- `packages/frontend/src/pages/RepositoryPage.tsx:412` creates repository chat state through `usePersistentChat(chatStorageKey)`.
- `packages/frontend/src/pages/RepositoryPage.tsx:1176-1179` maps and merges backend history into `chat` state.
- `packages/frontend/src/pages/RepositoryPage.tsx:1198-1219` polls `syncChatHistory` while an agent response is loading.
- `packages/frontend/src/pages/RepositoryPage.tsx:1909-1924` passes `chat`, `chatWindowRef`, loading state, session controls, and inline `markdownOptions` into `ChatWindow`.
- `packages/frontend/src/pages/TaskPage.tsx:581-596`, `KnowledgeArtefactPage.tsx:637-652`, and `ConstitutionPage.tsx:622-636` use the same `ChatWindow` component and must keep compatible props.
- `packages/frontend/src/utils/markdown.ts:142-166` is shared by chat and non-chat Markdown previews, so avoid changing sanitization semantics.
- `packages/frontend/src/utils/chat.ts:87-163` maps and merges chat history; this issue does not require changing its deduplication semantics.

### Git History

- **Introduced**: `3229c0fa` - 2026-01-05 - base `ChatWindow` render shell around `chat.map` was present by this commit according to `git blame -L 69,108`.
- **Expanded**: `33d02691` - 2026-01-16 - frontmatter stripping and full message render body were added around `ChatWindow.tsx:81-108`.
- **Markdown context added**: `17e22581` - 2026-05-03 - `renderMarkdown(strippedMessage, markdownOptions)` at `ChatWindow.tsx:102` added repository-aware Markdown work to each message render.
- **Persistence introduced**: `abcd4cf8` - 2025-12-19 - `usePersistentChat` added synchronous persistence effect dependency on `[chat, storageKey]`.
- **Persistence error handling changed**: `3ad836f7` - 2026-04-07 - wrapped `localStorage.setItem(storageKey, JSON.stringify(chat))` in try/catch but retained synchronous full-history writes.
- **Scroll behavior introduced**: `f53cea3d` - 2025-11-26 - `RepositoryPage` unconditional `scrollToBottom` on `[chat]` was introduced.
- **Polling introduced**: `a8d934ce` - 2026-01-06 - repository chat polling loop calls `syncChatHistory` every 5 seconds while loading.
- **Implication**: This is a long-standing architectural performance issue that became worse as Markdown rendering, persistence, and polling features accumulated.

---

## Implementation Plan

### Step 1: Add a direct virtualization dependency

**File**: `packages/frontend/package.json`
**Lines**: 14-26
**Action**: UPDATE

**Current code:**

```json
"dependencies": {
  "@headlessui/react": "^1.7.17",
  "@heroicons/react": "^2.1.5",
  "@types/dompurify": "^3.0.5",
  "@xterm/addon-fit": "^0.11.0",
  "@xterm/xterm": "^6.0.0",
  "clsx": "^2.1.1",
  "dompurify": "^3.4.2",
  "marked": "^12.0.2",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^6.23.1"
}
```

**Required change:**

Run:

```bash
npm install --workspace packages/frontend react-virtuoso
```

Expected package intent:

```json
"react-router-dom": "^6.23.1",
"react-virtuoso": "^4.x"
```

**Why**: `react-virtuoso` handles dynamic-height virtualized lists with less custom measurement code than `@tanstack/react-virtual`, which is important for Markdown messages with variable height.

---

### Step 2: Extract and memoize per-message rendering

**File**: `packages/frontend/src/components/ChatWindow.tsx`
**Lines**: 19-108
**Action**: UPDATE

**Current code:**

```tsx
const formatTimestamp = (message: ChatMessage) => {
  const prefix =
    message.role === "agent"
      ? message.messageType === "thinking"
        ? "🧠 "
        : message.messageType === "tool"
          ? "🛠️ "
          : message.messageType === "final"
            ? "🤖 "
            : ""
      : "";

  return `${prefix}${new Date(message.timestamp).toLocaleString()}`;
};
```

```tsx
{chat.map((message) => {
  const strippedMessage = stripFrontmatter(message.text || "");
  return (
    <div
      key={message.id}
      className={`chat-message ${message.role} ${message.messageType || ""}`}
    >
      <div className="chat-meta">{formatTimestamp(message)}</div>
```

**Required change:**

Add a `ChatMessageItem` component in the same file. Keep helper functions in this file to avoid adding unnecessary modules.

```tsx
interface ChatMessageItemProps {
  message: ChatMessage;
  markdownOptions?: MarkdownRenderOptions;
}

const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(
  ({ message, markdownOptions }) => {
    const strippedMessage = React.useMemo(
      () => stripFrontmatter(message.text || ""),
      [message.text],
    );
    const timestamp = React.useMemo(() => formatTimestamp(message), [message]);
    const html = React.useMemo(() => {
      if (!strippedMessage.trim()) return "<em>Empty message</em>";
      return renderMarkdown(strippedMessage, markdownOptions);
    }, [strippedMessage, markdownOptions]);

    return (
      <div className={`chat-message ${message.role} ${message.messageType || ""}`}>
        <div className="chat-meta">{timestamp}</div>
        <button
          type="button"
          className="copy-button chat-copy-button"
          aria-label="Copy message"
          title="Copy message"
          onClick={() => copyText(strippedMessage)}
        >
          <CopyIcon />
        </button>
        <div
          className="markdown"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  },
);
```

Use primitive dependencies for timestamp if linting or React behavior requires it:

```tsx
const timestamp = React.useMemo(
  () => formatTimestamp(message),
  [message.role, message.messageType, message.timestamp],
);
```

**Why**: The memo boundary prevents unchanged messages from re-rendering, and `useMemo` prevents repeated Markdown parsing/sanitization unless message text or Markdown options actually change.

---

### Step 3: Virtualize `ChatWindow` message rows

**File**: `packages/frontend/src/components/ChatWindow.tsx`
**Lines**: 69-144
**Action**: UPDATE

**Current code:**

```tsx
export const ChatWindow: React.FC<ChatWindowProps> = ({
  chat,
  chatWindowRef,
  loading,
  emptyMessage,
  sessionId,
  onClearSession,
  onSaveSession,
  isSessionSaved,
  markdownOptions,
}) => (
  <div className="chat-window" ref={chatWindowRef}>
    {chat.map((message) => {
```

**Required change:**

Import `Virtuoso` and render chat data through it. Keep loading, empty state, and session controls outside the virtualized item renderer.

```tsx
import { Virtuoso } from "react-virtuoso";
```

```tsx
export const ChatWindow: React.FC<ChatWindowProps> = React.memo(({
  chat,
  chatWindowRef,
  loading,
  emptyMessage,
  sessionId,
  onClearSession,
  onSaveSession,
  isSessionSaved,
  markdownOptions,
}) => {
  const itemContent = React.useCallback(
    (_index: number, message: ChatMessage) => (
      <ChatMessageItem message={message} markdownOptions={markdownOptions} />
    ),
    [markdownOptions],
  );

  return (
    <div className="chat-window" ref={chatWindowRef}>
      {chat.length > 0 && (
        <Virtuoso
          data={chat}
          itemContent={itemContent}
          followOutput="smooth"
          increaseViewportBy={{ top: 300, bottom: 300 }}
          style={{ height: "100%" }}
        />
      )}
      {loading && (
        <div className="loading-indicator">
          <div className="loading-spinner"></div>
          <span>Agent is thinking...</span>
        </div>
      )}
      {chat.length === 0 && !loading && (
        <div className="empty">{emptyMessage}</div>
      )}
      {sessionId && (
        <div className="chat-session-id" aria-label="Session ID">
          {/* keep existing session controls unchanged */}
        </div>
      )}
    </div>
  );
});
```

Preserve the existing session controls from `ChatWindow.tsx:118-141` exactly except for indentation.

**Why**: Virtualization limits DOM nodes and Markdown work to visible rows plus overscan instead of the full chat history.

---

### Step 4: Debounce chat persistence

**File**: `packages/frontend/src/hooks/usePersistentChat.ts`
**Lines**: 1-47
**Action**: UPDATE

**Current code:**

```ts
import { useEffect, useState } from "react";
```

```ts
useEffect(() => {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(chat));
  } catch (error) {
    console.warn("Failed to persist chat history to localStorage", error);
  }
}, [chat, storageKey]);
```

**Required change:**

Use refs and a single flush helper. Keep the existing `console.warn` behavior.

```ts
import { useEffect, useRef, useState } from "react";
```

```ts
const persistChat = (storageKey: string, chat: ChatMessage[]) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(chat));
  } catch (error) {
    console.warn("Failed to persist chat history to localStorage", error);
  }
};
```

Inside the hook:

```ts
const persistTimeoutRef = useRef<number | undefined>();
const latestChatRef = useRef(chat);

useEffect(() => {
  latestChatRef.current = chat;
}, [chat]);

useEffect(() => {
  if (!storageKey) return;

  if (persistTimeoutRef.current !== undefined) {
    window.clearTimeout(persistTimeoutRef.current);
  }

  persistTimeoutRef.current = window.setTimeout(() => {
    persistChat(storageKey, latestChatRef.current);
    persistTimeoutRef.current = undefined;
  }, 300);

  return () => {
    if (persistTimeoutRef.current === undefined) return;
    window.clearTimeout(persistTimeoutRef.current);
    persistChat(storageKey, latestChatRef.current);
    persistTimeoutRef.current = undefined;
  };
}, [chat, storageKey]);
```

**Why**: Rapid message updates are coalesced into one localStorage write while cleanup flushes pending data to reduce loss risk on unmount or storage-key changes.

---

### Step 5: Memoize `markdownOptions` at every `ChatWindow` call site

**Files**: `RepositoryPage.tsx`, `TaskPage.tsx`, `KnowledgeArtefactPage.tsx`, `ConstitutionPage.tsx`
**Action**: UPDATE

**Current repository call site:**

```tsx
<ChatWindow
  chat={chat}
  chatWindowRef={chatWindowRef}
  loading={chatLoading}
  emptyMessage="No conversation yet."
  sessionId={sessionId}
  onClearSession={() => setClearSessionModalOpen(true)}
  onSaveSession={handleSaveSession}
  isSessionSaved={Boolean(
    sessionId && savedSessionIds.includes(sessionId),
  )}
  markdownOptions={{
    repositoryName: name || undefined,
    currentFilePath: selectedFile || "README.md",
  }}
/>
```

**Required change:**

Add a memoized object near other derived values in each page.

```tsx
const chatMarkdownOptions = useMemo(
  () => ({
    repositoryName: name || undefined,
    currentFilePath: selectedFile || "README.md",
  }),
  [name, selectedFile],
);
```

Use it at the call site:

```tsx
markdownOptions={chatMarkdownOptions}
```

For `TaskPage`, `KnowledgeArtefactPage`, and `ConstitutionPage`, use the current inline values as the memo body:

```tsx
const chatMarkdownOptions = useMemo(
  () => ({
    repositoryName: name || undefined,
    currentFilePath: name || undefined,
  }),
  [name],
);
```

**Why**: Inline object props would change identity on every parent render and defeat `React.memo` and `useMemo` in `ChatMessageItem`.

---

### Step 6: Guard scroll-to-bottom behavior

**Files**: `RepositoryPage.tsx`, `TaskPage.tsx`, `KnowledgeArtefactPage.tsx`, `ConstitutionPage.tsx`
**Action**: UPDATE

**Current code:**

```tsx
const scrollToBottom = () => {
  if (chatWindowRef.current) {
    chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
  }
};

useEffect(() => {
  scrollToBottom();
}, [chat]);
```

**Required change:**

At minimum, change the dependency to `chat.length` and schedule scroll after layout with `requestAnimationFrame`.

```tsx
const scrollToBottom = useCallback(() => {
  const chatWindow = chatWindowRef.current;
  if (!chatWindow) return;

  window.requestAnimationFrame(() => {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  });
}, []);

useEffect(() => {
  scrollToBottom();
}, [chat.length, scrollToBottom]);
```

Optional if implementation time allows: track whether the user is already near the bottom and only auto-scroll in that case. Do not make this optional if manual testing shows scrolling jumps while reading older messages.

**Why**: Full `chat` object changes include history replacements and streaming-style updates; depending on `chat.length` avoids forced scrolling for same-length message text updates.

---

### Step 7: Add tests for `ChatWindow`

**File**: `packages/frontend/src/components/ChatWindow.test.tsx`
**Action**: CREATE

**Test cases to add:**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatWindow } from "./ChatWindow";
import { ChatMessage } from "../types/chat";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent }: {
    data: ChatMessage[];
    itemContent: (index: number, message: ChatMessage) => React.ReactNode;
  }) => <div>{data.map((message, index) => itemContent(index, message))}</div>,
}));

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "message-1",
  role: "user",
  text: "Hello",
  timestamp: "2026-04-07T00:00:00.000Z",
  ...overrides,
});

describe("ChatWindow", () => {
  it("shows empty message when chat is empty", () => {
    render(<ChatWindow chat={[]} loading={false} emptyMessage="No messages" />);
    expect(screen.getByText("No messages")).toBeInTheDocument();
  });

  it("shows loading indicator", () => {
    render(<ChatWindow chat={[]} loading emptyMessage="No messages" />);
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("renders chat messages through the virtualized list", () => {
    render(
      <ChatWindow
        chat={[makeMessage({ text: "**Hello**" })]}
        loading={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("strips frontmatter before rendering message body", () => {
    render(
      <ChatWindow
        chat={[makeMessage({ text: "---\ntitle: Test\n---\nVisible" })]}
        loading={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("title: Test")).not.toBeInTheDocument();
  });
});
```

If TypeScript complains about `React.ReactNode` in the mock, import React as a type or avoid the explicit mock prop type.

**Why**: Tests should prove the virtualized wrapper still exposes existing user-visible chat behavior.

---

### Step 8: Update `usePersistentChat` tests for debounce

**File**: `packages/frontend/src/hooks/usePersistentChat.test.tsx`
**Lines**: 31-54
**Action**: UPDATE

**Current code:**

```tsx
describe("usePersistentChat", () => {
  it("does not crash when localStorage writes throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
```

**Required change:**

Convert persistence assertions to fake timers because writes are debounced.

```tsx
it("does not crash when debounced localStorage writes throw", () => {
  vi.useFakeTimers();
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const setItemSpy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota exceeded");
    });

  expect(() =>
    render(<TestComponent storageKey="repository-chat-ios" nextMessage="Hi" />),
  ).not.toThrow();

  vi.advanceTimersByTime(300);

  expect(warnSpy).toHaveBeenCalledWith(
    "Failed to persist chat history to localStorage",
    expect.any(Error),
  );

  setItemSpy.mockRestore();
  warnSpy.mockRestore();
  vi.useRealTimers();
});
```

Add a second test:

```tsx
it("coalesces rapid chat updates into one persisted write", () => {
  vi.useFakeTimers();
  const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
  const { rerender } = render(
    <TestComponent storageKey="repository-chat-ios" nextMessage="One" />,
  );

  rerender(<TestComponent storageKey="repository-chat-ios" nextMessage="Two" />);
  rerender(<TestComponent storageKey="repository-chat-ios" nextMessage="Three" />);

  expect(setItemSpy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(setItemSpy).toHaveBeenCalledTimes(1);

  setItemSpy.mockRestore();
  vi.useRealTimers();
});
```

If initial mount persistence creates an extra write, adjust the hook to skip persisting the just-parsed initial state using a `hasHydratedRef` guard, then assert one write after the explicit state updates.

**Why**: The test suite must reflect the new asynchronous persistence contract and prevent regression to per-update synchronous writes.

---

## Patterns to Follow

**From codebase - localStorage warning pattern:**

```ts
// SOURCE: packages/frontend/src/hooks/usePersistentChat.ts:37-44
useEffect(() => {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(chat));
  } catch (error) {
    console.warn("Failed to persist chat history to localStorage", error);
  }
}, [chat, storageKey]);
```

**From codebase - timeout cleanup pattern:**

```tsx
// SOURCE: packages/frontend/src/pages/RepositoryPage.tsx:1198-1218
useEffect(() => {
  if (!chatLoading || !name || !sessionId) return;

  const controller = new AbortController();
  let timeoutId: number | undefined;

  const tick = async () => {
    await syncChatHistory(controller.signal);
    if (!controller.signal.aborted) {
      timeoutId = window.setTimeout(tick, 5000);
    }
  };
```

**From codebase - Markdown test style:**

```ts
// SOURCE: packages/frontend/src/utils/markdown.test.ts:5-7
describe("renderMarkdown", () => {
  it("adds attributes so markdown links open in a new tab", () => {
    const html = renderMarkdown("[OpenAI](https://openai.com)");
```

**From codebase - hook test style:**

```tsx
// SOURCE: packages/frontend/src/hooks/usePersistentChat.test.tsx:31-49
describe("usePersistentChat", () => {
  it("does not crash when localStorage writes throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
```

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
| -------------- | ---------- |
| `react-virtuoso` requires a bounded height to render correctly. | Keep the existing `.chat-window` container and set `style={{ height: "100%" }}` on `Virtuoso`; manually verify the chat pane still has height on repository, task, knowledge, and constitution pages. |
| Inline `markdownOptions` objects defeat memoization. | Add `chatMarkdownOptions = useMemo(...)` at every `ChatWindow` call site before relying on `React.memo`. |
| Virtualizing dynamic Markdown can affect scroll-follow behavior. | Use `react-virtuoso` `followOutput="smooth"`, keep loading indicator outside the virtual list, and manually test receiving new agent messages while at bottom and while scrolled up. |
| Debounced persistence can lose the last pending write on unmount. | Flush the pending write in the cleanup function before clearing the timeout. |
| Existing chat sessions in localStorage have no new fields. | Do not add required fields to `ChatMessage`; this plan intentionally avoids schema migration. |
| Changing scroll dependency from `chat` to `chat.length` may stop auto-scroll for same-message streaming updates. | If streaming text updates require following, add an `isNearBottomRef` or rely on Virtuoso `followOutput`; verify manually during agent responses. |
| `renderMarkdown` is used outside chat. | Do not change `renderMarkdown` behavior or sanitizer settings in this fix. |

---

## Validation

### Automated Checks

```bash
npm --workspace packages/frontend run test -- src/components/ChatWindow.test.tsx src/hooks/usePersistentChat.test.tsx src/utils/markdown.test.ts src/utils/chat.test.ts
npm run build:frontend
npm run lint
make qa-quick
```

### Manual Verification

1. Start the app with `make run` only if no existing development servers need to be interrupted; do not stop existing servers on ports `3000` or `5173`.
2. Open a repository chat and load or create a conversation with at least 150 messages.
3. Verify the chat pane scrolls smoothly and the DOM contains only visible virtualized message rows plus overscan, not every historical message.
4. Send a message and verify the newest messages follow the bottom while the user is already near the bottom.
5. Scroll up in a long conversation, allow another polling update, and verify the view does not jump unexpectedly.
6. Refresh the page and verify chat history persists from localStorage.
7. Verify Markdown links, images, code blocks, empty messages, copy buttons, saved-session button, and clear-session button still work.
8. Repeat a quick smoke check on Task, Knowledge Artefact, and Constitution chat pages because they share `ChatWindow` and `usePersistentChat`.

---

## Scope Boundaries

**IN SCOPE:**

- Direct frontend virtualization dependency.
- Virtualized chat message rendering in `ChatWindow`.
- Memoized message item rendering and Markdown HTML computation.
- Memoized `markdownOptions` at every `ChatWindow` call site.
- Debounced and cleanup-flushed localStorage persistence in `usePersistentChat`.
- Less aggressive scroll-to-bottom effects on shared chat pages.
- Unit tests for `ChatWindow` and debounced persistence.
- Existing Markdown sanitizer behavior must remain unchanged.

**OUT OF SCOPE (do not touch):**

- Backend chat history APIs.
- Chat deduplication semantics in `mapHistoryToMessages` or `mergeChatMessages` unless tests reveal a direct regression from this fix.
- Persisted chat schema migrations or adding required fields to `ChatMessage`.
- Web Worker Markdown parsing.
- Server-side pagination or incremental history database changes.
- Broad UI restyling of chat messages.
- Stopping or restarting existing development servers on ports `3000` or `5173`.

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-06-01T09:27:29Z
- **Artifact**: `.claude/PRPs/issues/issue-432.md`
