# Feature: Chat Window Virtuoso Scroll Ownership

## Summary

Move chat scrolling ownership into `ChatWindow` so `react-virtuoso` is the single system responsible for bottom alignment, auto-follow, and explicit "Scroll to last message" behavior. The implementation removes page-level `scrollTop = scrollHeight` writes from four detail pages, uses a `VirtuosoHandle` ref inside `ChatWindow`, exposes a minimal imperative `scrollToBottom` API for existing panel buttons, keeps the loading/session footer inside Virtuoso's measured content, and uses instant auto-follow for streaming updates while preserving smooth scrolling for user-triggered actions.

## User Story

As a user reading or sending agent chat messages
I want chat scrolling to stay stable during streaming, Markdown rendering, and loading footer updates
So that I can follow new output without flicker and scroll up without being forced back to the bottom.

## Problem Statement

The chat UI has two competing scroll systems. `ChatWindow` renders messages with `react-virtuoso`, but `RepositoryPage`, `TaskPage`, `KnowledgeArtefactPage`, and `ConstitutionPage` manually write `chatWindow.scrollTop = chatWindow.scrollHeight` on every latest-message key change. Those writes can race Virtuoso measurement, `followOutput="smooth"`, dynamic Markdown height, and the "Agent is thinking..." footer, causing partial scroll, jumpiness, or flicker.

## Solution Statement

Make `ChatWindow` the scroll boundary and expose only a small `ChatWindowHandle` with `scrollToBottom()`. Internally, `ChatWindow` will use `useRef<VirtuosoHandle>(null)`, `atBottomStateChange`, and `followOutput={(isAtBottom) => isAtBottom ? "auto" : false}`. Page buttons will call `chatWindowRef.current?.scrollToBottom()` and pages will no longer run effects based on `latestChatScrollKey` or mutate DOM scroll positions.

## Metadata

| Field | Value |
| --- | --- |
| Type | BUG_FIX / REFACTOR |
| Complexity | MEDIUM |
| Systems Affected | Frontend chat UI, React pages, ChatWindow tests |
| Dependencies | `react@^18.3.1`, `react-dom@^18.3.1`, `react-virtuoso@^4.18.7`, `vitest@^4.0.18`, `@testing-library/react@^16.3.1` |
| Estimated Tasks | 7 |
| Research Timestamp | 2026-06-01T14:43:03+02:00 |

---

## UX Design

### Before State

```text
╔═══════════════════════════════════════════════════════════════════════════════╗
║                              BEFORE STATE                                    ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐            ║
║   │ Detail Page │ ──────► │ DOM scroll  │ ──────► │ Race with   │            ║
║   │ Agent Panel │         │ top write   │         │ Virtuoso    │            ║
║   └─────────────┘         └─────────────┘         └─────────────┘            ║
║          │                         │                         ▲               ║
║          ▼                         ▼                         │               ║
║   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐            ║
║   │ ChatWindow  │ ──────► │ Virtuoso    │ ──────► │ Measured    │            ║
║   │ list/footer │         │ followOutput│         │ row heights │            ║
║   └─────────────┘         └─────────────┘         └─────────────┘            ║
║                                                                               ║
║   USER_FLOW: User sends message, page appends/polls chat, page forces scroll. ║
║   PAIN_POINT: Manual DOM scroll and Virtuoso measurement can disagree.         ║
║   DATA_FLOW: chat state -> ChatWindow -> Virtuoso, plus page -> DOM scroll.    ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### After State

```text
╔═══════════════════════════════════════════════════════════════════════════════╗
║                               AFTER STATE                                    ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐            ║
║   │ Detail Page │ ──────► │ ChatWindow  │ ──────► │ Virtuoso    │            ║
║   │ Agent Panel │         │ handle only │         │ API/ref     │            ║
║   └─────────────┘         └─────────────┘         └─────────────┘            ║
║                                      │                         │              ║
║                                      ▼                         ▼              ║
║                              ┌─────────────┐         ┌─────────────┐          ║
║                              │ at-bottom   │  ────► │ Stable auto │          ║
║                              │ state       │         │ follow      │          ║
║                              └─────────────┘         └─────────────┘          ║
║                                                                               ║
║   USER_FLOW: User sends message; ChatWindow follows only when at bottom.       ║
║   VALUE_ADD: No flicker; user can scroll up without being pulled down.         ║
║   DATA_FLOW: chat state -> ChatWindow -> Virtuoso measured scroll only.        ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

### Interaction Changes

| Location | Before | After | User Impact |
| --- | --- | --- | --- |
| `ChatWindow.tsx` | Uses Virtuoso but exposes outer DOM scroll container | Owns Virtuoso ref, at-bottom state, auto-follow, and footer measurement | Stable bottom alignment during dynamic content |
| `RepositoryPage.tsx` | Forces scroll on latest message id/text length | Calls `ChatWindowHandle.scrollToBottom()` only for the button | Streaming output does not flicker or pull user down when scrolled up |
| `TaskPage.tsx` | Same manual DOM scroll pattern | Same handle-only pattern | Consistent agent panel behavior |
| `KnowledgeArtefactPage.tsx` | Same manual DOM scroll pattern | Same handle-only pattern | Consistent agent panel behavior |
| `ConstitutionPage.tsx` | Same manual DOM scroll pattern | Same handle-only pattern | Consistent agent panel behavior |

---

## Mandatory Reading

Implementation agent MUST read these files before starting any task.

| Priority | File | Lines | Why Read This |
| --- | --- | --- | --- |
| P0 | `packages/frontend/src/components/ChatWindow.tsx` | 8-202 | Current props, Virtuoso usage, footer rendering, memoization, and DOM ref pattern to replace |
| P0 | `packages/frontend/src/pages/RepositoryPage.tsx` | 550-590, 1874-1933 | Largest integration point; duplicate scroll effect and panel button pattern |
| P0 | `packages/frontend/src/pages/TaskPage.tsx` | 105-128, 530-605 | Same page-level scroll ownership pattern in a smaller page |
| P1 | `packages/frontend/src/pages/KnowledgeArtefactPage.tsx` | 116-144, 606-651 | Same duplicate scroll ownership pattern |
| P1 | `packages/frontend/src/pages/ConstitutionPage.tsx` | 118-146, 591-636 | Same duplicate scroll ownership pattern |
| P1 | `packages/frontend/src/components/ChatWindow.test.tsx` | 7-114 | Existing Virtuoso mock and assertion style |
| P1 | `packages/frontend/src/types/chat.ts` | 1-12 | `ChatMessage` shape used by ChatWindow and page state |
| P2 | `packages/frontend/src/utils/chat.ts` | 115-163 | Dynamic message merge behavior that grows existing row height |
| P2 | `packages/frontend/src/styles/index.css` | 136-195, 390-464, 570-620, 631-667 | Existing chat/scroll button/loading/responsive styling to preserve |

**Current External Documentation (Verified Live):**

| Source | Section | Why Needed | Last Verified |
| --- | --- | --- | --- |
| [React Virtuoso Context7 `/petyosi/react-virtuoso`](https://github.com/petyosi/react-virtuoso) | `VirtuosoHandle.scrollToIndex` | Confirms ref-based programmatic scrolling with `{ index, align, behavior }` and `index: "LAST"` support | 2026-06-01T14:43:03+02:00 |
| [Virtuoso Docs Context7 `/websites/virtuoso_dev`](https://virtuoso.dev/react-virtuoso/virtuoso/scroll-to-index) | `scrollToIndex` | Confirms `auto` vs `smooth` behavior options and warns smooth scrolling can be expensive for long jumps | 2026-06-01T14:43:03+02:00 |
| [Virtuoso API Context7 `/websites/virtuoso_dev`](https://virtuoso.dev/react-virtuoso/api-reference/grouped-virtuoso/#followoutput) | `followOutput` | Confirms callback form returns `"auto"`, `"smooth"`, or `false`; default follows only when already at bottom | 2026-06-01T14:43:03+02:00 |
| [Virtuoso Message List Context7 `/websites/virtuoso_dev`](https://virtuoso.dev/message-list/examples/messaging) | Chat auto-scroll modifiers | Confirms current chat guidance: auto-scroll only when at bottom or while scroll in progress; avoid forcing scroll for users reading older messages | 2026-06-01T14:43:03+02:00 |

---

## Patterns to Mirror

**COMPONENT_PROPS_AND_MEMOIZATION:**

```tsx
// SOURCE: packages/frontend/src/components/ChatWindow.tsx:8-18,110-121
interface ChatWindowProps {
  chat: ChatMessage[];
  chatWindowRef?: React.RefObject<HTMLDivElement>;
  loading: boolean;
  emptyMessage: string;
  sessionId?: string | null;
  onClearSession?: () => void;
  onSaveSession?: () => void;
  isSessionSaved?: boolean;
  markdownOptions?: MarkdownRenderOptions;
}

export const ChatWindow: React.FC<ChatWindowProps> = React.memo(
  function ChatWindow({
```

**VIRTUOSO_CURRENT_USAGE:**

```tsx
// SOURCE: packages/frontend/src/components/ChatWindow.tsx:181-192
<div className="chat-window" ref={setChatWindowElement}>
  {chat.length > 0 && (
    <Virtuoso
      customScrollParent={scrollParent ?? undefined}
      data={chat}
      itemContent={itemContent}
      components={components}
      followOutput="smooth"
      increaseViewportBy={{ top: 300, bottom: 300 }}
      style={{ height: "100%" }}
    />
  )}
```

**FOOTER_PATTERN:**

```tsx
// SOURCE: packages/frontend/src/components/ChatWindow.tsx:141-179
const footerContent = (
  <>
    {loading && (
      <div className="loading-indicator">
        <div className="loading-spinner"></div>
        <span>Agent is thinking...</span>
      </div>
    )}
    {sessionId && (
      <div className="chat-session-id" aria-label="Session ID">
        <span>Session ID: {sessionId}</span>
```

**PAGE_SCROLL_PATTERN_TO_REMOVE:**

```tsx
// SOURCE: packages/frontend/src/pages/TaskPage.tsx:115-128
const scrollToBottom = useCallback(() => {
  const chatWindow = chatWindowRef.current;
  if (!chatWindow) return;

  window.requestAnimationFrame(() => {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  });
}, []);
const latestChatMessage = chat[chat.length - 1];
const latestChatScrollKey = `${chat.length}:${latestChatMessage?.id ?? ""}:${latestChatMessage?.text?.length ?? 0}`;

useEffect(() => {
  scrollToBottom();
}, [latestChatScrollKey, scrollToBottom]);
```

**PANEL_ACTION_BUTTON_PATTERN:**

```tsx
// SOURCE: packages/frontend/src/pages/TaskPage.tsx:538-548
<div className="panel-action-buttons">
  <button
    type="button"
    className="copy-button"
    onClick={scrollToBottom}
    aria-label="Scroll to last message"
    title="Scroll to last message"
    disabled={!chat.length}
  >
    <ArrowDownIcon />
  </button>
```

**TEST_STRUCTURE:**

```tsx
// SOURCE: packages/frontend/src/components/ChatWindow.test.tsx:1-15,25-33
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatWindow } from "./ChatWindow";
import { ChatMessage } from "../types/chat";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: ChatMessage[];
    itemContent: (index: number, message: ChatMessage) => ReactNode;
  }) => <div>{data.map((message, index) => itemContent(index, message))}</div>,
}));

describe("ChatWindow", () => {
  it("shows empty message when chat is empty", () => {
    render(<ChatWindow chat={[]} loading={false} emptyMessage="No messages" />);
```

**DYNAMIC_ROW_HEIGHT_SOURCE:**

```ts
// SOURCE: packages/frontend/src/utils/chat.ts:115-163
export const mergeChatMessages = (
  existing: ChatMessage[],
  incoming: ChatMessage[],
) => {
  const next = [...existing];
  const existingIndexByKey = new Map<string, number>();

  existing.forEach((message, index) => {
    const key = buildMessageDedupKey(message);
    if (!key) return;
    existingIndexByKey.set(key, index);
  });
```

---

## Current Best Practices Validation

**Security (Context7 MCP and npm audit Verified):**

- [x] No new dependency needed; continue using installed `react-virtuoso@4.18.7`.
- [x] `npm audit --workspace packages/frontend --audit-level moderate` returned `found 0 vulnerabilities`.
- [x] Existing Markdown sanitization path is unchanged; plan does not alter `renderMarkdown` or `dangerouslySetInnerHTML` behavior.
- [x] No authentication, authorization, or data persistence surfaces are changed.

**Performance (Web/Context7 Intelligence Verified):**

- [x] Use Virtuoso's measured API instead of direct DOM scroll writes.
- [x] Use `followOutput` callback with `"auto"` for frequent streaming/polling updates.
- [x] Reserve `behavior: "smooth"` for explicit user button action.
- [x] Avoid smooth repeated auto-scroll on dynamic rows because Virtuoso docs caution smooth long/continuous scroll can be expensive.

**Community Intelligence:**

- [x] Virtuoso current docs support `followOutput` callback returning `"auto"`, `"smooth"`, or `false`.
- [x] Virtuoso current docs support imperative `scrollToIndex` through a component ref.
- [x] Virtuoso current message-list examples model chat auto-scroll as conditional on `atBottom` or active scrolling, not unconditional DOM writes.
- [x] No deprecated Virtuoso pattern is introduced.

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `packages/frontend/src/components/ChatWindow.tsx` | UPDATE | Add `VirtuosoHandle` ref, internal at-bottom tracking, and imperative `scrollToBottom`; remove raw DOM scroll ownership from public props |
| `packages/frontend/src/components/ChatWindow.test.tsx` | UPDATE | Extend Virtuoso mock and add coverage for footer rendering and imperative scroll behavior |
| `packages/frontend/src/pages/RepositoryPage.tsx` | UPDATE | Replace DOM ref/effect/manual writes with `ChatWindowHandle` button call |
| `packages/frontend/src/pages/TaskPage.tsx` | UPDATE | Same scroll ownership migration |
| `packages/frontend/src/pages/KnowledgeArtefactPage.tsx` | UPDATE | Same scroll ownership migration |
| `packages/frontend/src/pages/ConstitutionPage.tsx` | UPDATE | Same scroll ownership migration |

No CSS file is expected to change. Preserve `.copy-button`, `.panel-action-buttons`, `.chat-window`, `.loading-indicator`, and responsive styles unless implementation exposes a real styling regression.

---

## NOT Building (Scope Limits)

- Do not introduce `@virtuoso.dev/message-list`; it is a separate message-list package and examples may require additional package/license flow. Existing `react-virtuoso` is sufficient.
- Do not rewrite chat persistence, history polling, or message merging.
- Do not change Markdown rendering or sanitization.
- Do not add new visual designs or CSS unless tests/manual validation expose a required adjustment.
- Do not start/stop standard dev servers on ports `3000` or `5173`; project instructions forbid interrupting them for this task.

---

## Architecture Invariants

- `ChatWindow` is the only component allowed to manipulate chat scroll position.
- Page components may request an explicit user scroll action through a typed imperative handle, but must not access `.chat-window` DOM scroll fields.
- Auto-follow must be conditional on Virtuoso bottom state; users who scrolled up must not be forced to bottom by incoming messages.
- The loading indicator and session controls must remain in Virtuoso measured footer content whenever `chat.length > 0`.
- Streaming/polling updates use non-animated follow behavior; user button action uses smooth behavior.

---

## Step-by-Step Tasks

Execute in order. Each task is atomic and independently verifiable.

### Task 1: UPDATE `packages/frontend/src/components/ChatWindow.tsx` Types and Refs

- **ACTION**: Replace `chatWindowRef?: React.RefObject<HTMLDivElement>` with a typed imperative handle prop/ref API.
- **IMPLEMENT**: Export `interface ChatWindowHandle { scrollToBottom: () => void; }` from `ChatWindow.tsx` and type `chatWindowRef?: React.RefObject<ChatWindowHandle>` or use `React.forwardRef` if chosen. Prefer the smallest change: keep the prop name only if it minimizes page edits, but change its type and meaning from DOM node to handle.
- **MIRROR**: `ChatWindow.tsx:8-18` for prop interface style and `ChatWindow.tsx:110-121` for memoized component structure.
- **IMPORTS**: Change `import { Virtuoso } from "react-virtuoso";` to include `type VirtuosoHandle`.
- **GOTCHA**: Do not expose `HTMLDivElement` or `scrollTop`; that keeps the old race possible.
- **CURRENT**: Context7 confirms `VirtuosoHandle` refs support `scrollToIndex({ index, align, behavior })`.
- **VALIDATE**: `npm --workspace packages/frontend run build`
- **TEST_PYRAMID**: Type-only shape change; behavior tests added in Task 3.

### Task 2: UPDATE `ChatWindow` Scroll Behavior Internally

- **ACTION**: Add an internal `virtuosoRef` and at-bottom state.
- **IMPLEMENT**: Use `const virtuosoRef = React.useRef<VirtuosoHandle>(null);`, `const [isAtBottom, setIsAtBottom] = React.useState(true);`, `atBottomStateChange={setIsAtBottom}`, and `followOutput={(atBottom) => (atBottom ? "auto" : false)}`.
- **IMPLEMENT**: Implement `scrollToBottom` with `virtuosoRef.current?.scrollToIndex({ index: chat.length - 1, align: "end", behavior: "smooth" })`, guarded by `if (!chat.length) return;`.
- **IMPLEMENT**: Expose that method through the chosen handle with `React.useImperativeHandle`.
- **MIRROR**: Existing `itemContent` `useCallback` pattern at `ChatWindow.tsx:135-140`.
- **GOTCHA**: The `followOutput` callback parameter already represents whether Virtuoso is at bottom; do not close over stale page state for auto-follow decisions.
- **GOTCHA**: Keep `customScrollParent={scrollParent ?? undefined}` and `style={{ height: "100%" }}` unless manual browser validation proves they are part of the defect.
- **CURRENT**: Context7 `followOutput` API returns `"auto"`, `"smooth"`, or `false`; default follows only when already at bottom.
- **VALIDATE**: `npm --workspace packages/frontend run build && npm --workspace packages/frontend run test -- ChatWindow.test.tsx`
- **TEST_PYRAMID**: Add unit tests for imperative scroll and footer behavior in Task 3.

### Task 3: UPDATE `packages/frontend/src/components/ChatWindow.test.tsx`

- **ACTION**: Extend the Virtuoso mock to support the new API surface.
- **IMPLEMENT**: Mock `Virtuoso` with `React.forwardRef` or equivalent and `useImperativeHandle` so tests can assert `scrollToIndex` receives `{ index: 0, align: "end", behavior: "smooth" }` for one message.
- **IMPLEMENT**: Render `components.Footer` in the mock so non-empty chat plus `loading` still shows `Agent is thinking...`.
- **MIRROR**: Existing RTL/Vitest style at `ChatWindow.test.tsx:1-15` and assertion style at `ChatWindow.test.tsx:25-114`.
- **GOTCHA**: Keep mock types specific; avoid `any`. Use `unknown` or concrete prop types if needed.
- **VALIDATE**: `npm --workspace packages/frontend run test -- ChatWindow.test.tsx`
- **TEST_PYRAMID**: Unit coverage for `ChatWindow` imperative scroll, footer inclusion, empty/loading regression, existing copy/session controls.

### Task 4: UPDATE `packages/frontend/src/pages/RepositoryPage.tsx`

- **ACTION**: Remove direct DOM scroll ownership.
- **IMPLEMENT**: Change `useRef<HTMLDivElement>(null)` to `useRef<ChatWindowHandle>(null)`; remove `latestChatMessage`, `latestChatScrollKey`, and `useEffect(() => scrollToBottom(), ...)`; update `scrollToBottom` to call `chatWindowRef.current?.scrollToBottom()`.
- **MIRROR**: Existing panel action button at `RepositoryPage.tsx:1874-1883`; keep the button and disabled state unchanged.
- **IMPORTS**: Import `ChatWindowHandle` from `../components/ChatWindow` if not already using a combined import.
- **GOTCHA**: Repository page has the most dynamic polling merge behavior (`RepositoryPage.tsx:1167-1231`); do not remove chat history sync logic.
- **VALIDATE**: `npm --workspace packages/frontend run build && npm --workspace packages/frontend run test`
- **TEST_PYRAMID**: No new page test required unless an existing Repository detail test exists; ChatWindow unit tests cover scroll API.

### Task 5: UPDATE `TaskPage`, `KnowledgeArtefactPage`, and `ConstitutionPage`

- **ACTION**: Apply the same scroll ownership migration to the other three detail pages.
- **IMPLEMENT**: Replace `HTMLDivElement` refs with `ChatWindowHandle`; remove `latestChatScrollKey` effects; update button callback to call the handle.
- **MIRROR**: `TaskPage.tsx:105-128`, `KnowledgeArtefactPage.tsx:116-144`, and `ConstitutionPage.tsx:118-146` for identical code removal.
- **GOTCHA**: After removing `useEffect` usage only for scrolling, verify each file still needs `useEffect` for other logic before changing imports.
- **VALIDATE**: `npm --workspace packages/frontend run build && npm --workspace packages/frontend run test`
- **TEST_PYRAMID**: Existing frontend unit suite should catch import/type regressions.

### Task 6: RUN Focused and Full Frontend Validation

- **ACTION**: Validate the frontend implementation without interrupting running dev servers.
- **VALIDATE**: `npm --workspace packages/frontend run test -- ChatWindow.test.tsx`
- **VALIDATE**: `npm --workspace packages/frontend run test`
- **VALIDATE**: `npm run lint`
- **VALIDATE**: `npm run build`
- **GOTCHA**: Do not run `make run`, `make stop`, or `make restart` because the project forbids interrupting standard ports `3000` and `5173` for this task.
- **TEST_PYRAMID**: Unit tests plus static build validation; manual browser validation in Task 7 covers user-facing behavior.

### Task 7: MANUAL Browser Validation

- **ACTION**: Verify the actual scroll behavior in the running app if a dev server is already available, or ask before starting/stopping standard-port services.
- **FUNCTIONAL**: Open Repository, Task, Knowledge Artefact, and Constitution agent panels.
- **FUNCTIONAL**: Send a prompt, observe loading footer and incoming/updated agent messages.
- **FUNCTIONAL**: While output grows, scroll upward and verify the viewport does not jump to bottom.
- **FUNCTIONAL**: Scroll to bottom, allow output to continue, verify auto-follow remains stable and non-flickery.
- **FUNCTIONAL**: Click "Scroll to last message" and verify smooth scroll reaches the footer/bottom.
- **VALIDATE**: Browser console has no new errors.
- **TEST_PYRAMID**: User-facing system validation for the critical chat scroll journey.

---

## Testing Strategy

### Unit Tests to Write or Update

| Test File | Test Cases | Validates |
| --- | --- | --- |
| `packages/frontend/src/components/ChatWindow.test.tsx` | Non-empty chat with `loading` renders footer | Loading footer remains in measured Virtuoso content |
| `packages/frontend/src/components/ChatWindow.test.tsx` | Imperative `scrollToBottom` calls Virtuoso `scrollToIndex` | Page button can request user scroll without DOM mutation |
| `packages/frontend/src/components/ChatWindow.test.tsx` | Empty chat loading and empty states remain unchanged | No regression for no-message panels |
| `packages/frontend/src/components/ChatWindow.test.tsx` | Existing frontmatter/copy/session tests still pass | Existing chat utilities unaffected |

### Edge Cases Checklist

- [ ] `chat.length === 0` and `loading === true` shows loading indicator outside Virtuoso as current behavior does.
- [ ] `chat.length === 0` and `sessionId` still shows session controls.
- [ ] Explicit scroll button with no chat remains disabled in pages.
- [ ] Explicit scroll with one message scrolls to index `0` aligned `end`.
- [ ] Streaming update that grows the latest message uses `followOutput="auto"` only when Virtuoso reports at bottom.
- [ ] User scrolled up does not get forced to bottom by polling/streaming updates.
- [ ] Loading footer height changes are included in bottom alignment.

---

## Validation Commands

Run from repository root `/home/tom/workspace/ai/made/workspace/made`.

### Level 1: STATIC_ANALYSIS

```bash
npm run lint
```

**EXPECT**: Exit 0, no lint errors.

### Level 2: BUILD_AND_FUNCTIONAL

```bash
npm run build
```

**EXPECT**: TypeScript and Vite build succeed.

### Level 3: UNIT_TESTS

```bash
npm --workspace packages/frontend run test -- ChatWindow.test.tsx
```

**EXPECT**: Focused ChatWindow tests pass.

### Level 4: FULL_SUITE

```bash
npm --workspace packages/frontend run test
```

**EXPECT**: Frontend unit test suite passes.

### Level 5: BROWSER_VALIDATION

Use Browser MCP against an already-running frontend if available. Do not stop or restart services on ports `3000` or `5173`.

- [ ] UI renders correctly on desktop.
- [ ] UI renders correctly on mobile viewport.
- [ ] Scroll up during agent output does not jump to bottom.
- [ ] Scroll button smoothly reaches the last message/loading footer.
- [ ] Console has no new errors.

### Level 6: CURRENT_STANDARDS_VALIDATION

```bash
npm view react-virtuoso version
npm audit --workspace packages/frontend --audit-level moderate
```

**EXPECT**: `react-virtuoso` remains `4.18.7` or compatible latest stable; audit reports zero moderate-or-higher vulnerabilities.

### Level 7: MANUAL_VALIDATION

- Repository agent chat: send a message and observe streaming/polling updates.
- Task agent chat: send a message and confirm stable bottom behavior.
- Knowledge artefact agent chat: send a message and confirm stable bottom behavior.
- Constitution agent chat: send a message and confirm stable bottom behavior.

---

## Acceptance Criteria

- [ ] Page components no longer write `scrollTop` or read `scrollHeight` for chat scrolling.
- [ ] `ChatWindow` owns the Virtuoso ref and exposes only a typed `scrollToBottom` handle for user actions.
- [ ] `followOutput` uses `"auto"` only when Virtuoso reports the list is at bottom; otherwise returns `false`.
- [ ] The "Agent is thinking..." footer remains rendered through Virtuoso footer for non-empty chat.
- [ ] "Scroll to last message" buttons still work on all four detail pages.
- [ ] Users who scroll up are not pulled down by streaming/polling updates.
- [ ] Level 1-4 validation commands pass with exit 0.
- [ ] Browser validation confirms no flicker/jump regression in the four chat panels.
- [ ] No new dependency or vulnerable package is introduced.

---

## Completion Checklist

- [ ] Task 1 completed and build passes.
- [ ] Task 2 completed and focused tests pass.
- [ ] Task 3 completed and ChatWindow tests pass.
- [ ] Task 4 completed and frontend build passes.
- [ ] Task 5 completed and frontend tests pass.
- [ ] Task 6 static, build, and full tests pass.
- [ ] Task 7 browser validation passes.
- [ ] `grep` confirms no chat page uses `scrollTop`, `scrollHeight`, or `latestChatScrollKey`.

---

## Real-time Intelligence Summary

**Context7 MCP Queries Made**: 3
**Web Intelligence Sources**: 2 direct web fetch attempts plus Virtuoso docs surfaced through Context7
**Last Verification**: 2026-06-01T14:43:03+02:00
**Security Advisories Checked**: 1 npm audit command for frontend workspace
**Deprecated Patterns Avoided**: direct DOM `scrollTop = scrollHeight` against a virtualized list; smooth auto-scroll on frequent streaming updates; adding a new message-list package when installed Virtuoso list APIs are sufficient

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Virtuoso mock in tests hides real ref behavior | MEDIUM | MEDIUM | Use Browser MCP manual validation after unit tests |
| `customScrollParent` with outer `.chat-window` still contributes to measurement issues | LOW | MEDIUM | Preserve initially for minimal change; revisit only if browser validation still flickers |
| Empty chat loading footer remains outside Virtuoso | LOW | LOW | No messages exist to measure; preserve existing behavior and test it |
| Page imports become stale after removing scroll effects | MEDIUM | LOW | Build with `tsc` via `npm run build` after edits |
| Smooth scroll to last item may be imperfect while new output streams | LOW | LOW | Smooth is only for explicit user action; auto-follow remains `auto` |

---

## Notes

The implementation should be intentionally small. Do not generalize a shared hook across pages unless duplicate handle code grows beyond the simple `useRef<ChatWindowHandle>(null)` plus callback pattern. The bug exists because ownership is split; the fix is to remove ownership from pages, not add more timing controls around page-level DOM writes.

### Current Intelligence Considerations

- Installed and latest registry version for `react-virtuoso` is `4.18.7` as verified by `npm view react-virtuoso version`.
- `package-lock.json:5494-5502` confirms `react-virtuoso@4.18.7` is installed with React peer support including React 18.
- `npm audit --workspace packages/frontend --audit-level moderate` returned `found 0 vulnerabilities`.
- Context7 Virtuoso docs confirm current APIs needed for this plan: `VirtuosoHandle.scrollToIndex`, callback `followOutput`, and chat-style conditional auto-scroll guidance.
