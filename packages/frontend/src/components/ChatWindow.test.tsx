import { act, fireEvent, render, screen } from "@testing-library/react";
import React, { type ComponentType, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWindow, type ChatWindowHandle } from "./ChatWindow";
import { ChatMessage } from "../types/chat";

const scrollToIndexMock = vi.hoisted(() => vi.fn());
// Captures the `followOutput` callback reference for direct invocation in tests
const followOutputCapture = vi.hoisted(
  (): { current: ((atBottom: boolean) => "smooth" | false) | undefined } => ({
    current: undefined,
  }),
);
// Captures the `components` prop reference to assert referential stability
const componentsCapture = vi.hoisted(
  (): { current: { Item?: unknown; Footer?: unknown } | undefined } => ({
    current: undefined,
  }),
);

interface MockVirtuosoHandle {
  scrollToIndex: (location: {
    index: number;
    align: "end";
    behavior: "smooth" | "auto";
  }) => void;
}

interface MockVirtuosoProps {
  data: ChatMessage[];
  itemContent: (index: number, message: ChatMessage) => ReactNode;
  components?: {
    Item?: ComponentType<React.HTMLAttributes<HTMLDivElement>>;
    Footer?: ComponentType<{ context?: Record<string, unknown> }>;
  };
  computeItemKey?: (index: number, message: ChatMessage) => string;
  followOutput?: (atBottom: boolean) => "smooth" | false;
  context?: Record<string, unknown>;
}

vi.mock("react-virtuoso", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");

  return {
    Virtuoso: ReactModule.forwardRef<MockVirtuosoHandle, MockVirtuosoProps>(
      function MockVirtuoso(
        {
          data,
          itemContent,
          components,
          computeItemKey,
          followOutput,
          context,
        },
        ref,
      ) {
        ReactModule.useImperativeHandle(ref, () => ({
          scrollToIndex: scrollToIndexMock,
        }));
        const Item = components?.Item;
        const Footer = components?.Footer;

        followOutputCapture.current = followOutput;
        componentsCapture.current = components;

        return (
          <div>
            {data.map((message, index) => {
              const key = computeItemKey
                ? computeItemKey(index, message)
                : message.id;
              const content = itemContent(index, message);
              return Item ? <Item key={key}>{content}</Item> : content;
            })}
            {Footer ? <Footer context={context} /> : null}
          </div>
        );
      },
    ),
  };
});

let _messageCounter = 0;
const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `message-${++_messageCounter}`,
  role: "user",
  text: "Hello",
  timestamp: "2026-04-07T00:00:00.000Z",
  ...overrides,
});

describe("ChatWindow", () => {
  beforeEach(() => {
    scrollToIndexMock.mockClear();
    followOutputCapture.current = undefined;
    componentsCapture.current = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows empty message when chat is empty", () => {
    render(
      <ChatWindow
        chat={[]}
        running={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("No messages")).toBeInTheDocument();
  });

  it("shows loading indicator", () => {
    render(<ChatWindow chat={[]} running emptyMessage="No messages" />);
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("renders loading indicator in the virtualized footer for non-empty chat", () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        running
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("renders chat messages through the virtualized list", () => {
    render(
      <ChatWindow
        chat={[makeMessage({ text: "**Hello**" })]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("scrolls to the last message through the imperative handle", () => {
    const chatWindowRef = React.createRef<ChatWindowHandle>();

    render(
      <ChatWindow
        chatWindowRef={chatWindowRef}
        chat={[makeMessage()]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    scrollToIndexMock.mockClear();

    act(() => {
      chatWindowRef.current?.scrollToBottom();
    });

    expect(scrollToIndexMock).toHaveBeenCalledWith({
      index: 0,
      align: "end",
      behavior: "smooth",
    });
  });

  it("does not scroll when the chat is empty", () => {
    const chatWindowRef = React.createRef<ChatWindowHandle>();

    render(
      <ChatWindow
        chatWindowRef={chatWindowRef}
        chat={[]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    act(() => {
      chatWindowRef.current?.scrollToBottom();
    });

    expect(scrollToIndexMock).not.toHaveBeenCalled();
  });

  it("does not use direct DOM scroll on initial load (Virtuoso followOutput handles it)", () => {
    const scrollTopSetter = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollTop", {
      set: scrollTopSetter,
      get: () => 0,
      configurable: true,
    });

    render(
      <ChatWindow
        chat={[makeMessage()]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    // Virtuoso's followOutput drives initial scroll; no direct DOM scrollTop write expected.
    expect(scrollTopSetter).not.toHaveBeenCalled();
  });

  it("strips frontmatter before rendering message body", () => {
    render(
      <ChatWindow
        chat={[makeMessage({ text: "---\ntitle: Test\n---\nVisible" })]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("title: Test")).not.toBeInTheDocument();
  });

  it("renders empty message placeholder", () => {
    render(
      <ChatWindow
        chat={[makeMessage({ text: "" })]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Empty message")).toBeInTheDocument();
  });

  it("copies stripped message text", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ChatWindow
        chat={[makeMessage({ text: "---\ntitle: Test\n---\nVisible" })]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(writeText).toHaveBeenCalledWith("Visible");
  });

  it("renders session controls", () => {
    const onClearSession = vi.fn();
    const onSaveSession = vi.fn();

    render(
      <ChatWindow
        chat={[]}
        running={false}
        emptyMessage="No messages"
        sessionId="session-1"
        onClearSession={onClearSession}
        onSaveSession={onSaveSession}
        isSessionSaved={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save session" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear session" }));

    expect(screen.getByLabelText("Session ID")).toHaveTextContent(
      "Session ID: session-1",
    );
    expect(onSaveSession).toHaveBeenCalledTimes(1);
    expect(onClearSession).toHaveBeenCalledTimes(1);
  });

  it("scrolls to bottom on initial mount when no loading is active and chat is non-empty", () => {
    render(
      <ChatWindow
        chat={[makeMessage(), makeMessage(), makeMessage()]}
        running={false}
        sessionLoading={false}
        refreshing={false}
        emptyMessage="empty"
      />,
    );

    expect(scrollToIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: 2, align: "end", behavior: "auto" }),
    );
  });

  it("does not scroll to bottom during streaming growth (followOutput handles it)", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[makeMessage()]}
        running
        sessionLoading={false}
        refreshing={false}
        emptyMessage="empty"
      />,
    );

    scrollToIndexMock.mockClear();

    // Simulate streaming: chat grows while loading flags remain unchanged
    rerender(
      <ChatWindow
        chat={[makeMessage(), makeMessage()]}
        running
        sessionLoading={false}
        refreshing={false}
        emptyMessage="empty"
      />,
    );

    // chat.length is not in the effect dependency array — no scroll triggered
    expect(scrollToIndexMock).not.toHaveBeenCalled();
  });

  it("toggles loading indicator when running changes at runtime (empty chat)", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("No messages")).toBeInTheDocument();

    rerender(
      <ChatWindow chat={[]} running emptyMessage="No messages" />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
    expect(screen.queryByText("No messages")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("No messages")).toBeInTheDocument();
  });

  it("toggles loading indicator in Virtuoso footer when running changes (non-empty chat)", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[makeMessage()]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        running
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        running={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
  });

  it("shows loading indicator across empty-to-non-empty transition while running remains true", () => {
    const { rerender } = render(
      <ChatWindow chat={[]} running emptyMessage="No messages" />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        running
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("scrolls to bottom when sessionLoading transitions from true to false", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[]}
        sessionLoading
        running={false}
        emptyMessage="empty"
      />,
    );

    expect(scrollToIndexMock).not.toHaveBeenCalled();

    rerender(
      <ChatWindow
        chat={[makeMessage(), makeMessage()]}
        sessionLoading={false}
        running={false}
        emptyMessage="empty"
      />,
    );

    expect(scrollToIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, align: "end", behavior: "auto" }),
    );
  });

  it("scrolls to bottom when refreshing transitions from true to false", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[makeMessage()]}
        refreshing
        running={false}
        emptyMessage="empty"
      />,
    );

    scrollToIndexMock.mockClear();

    rerender(
      <ChatWindow
        chat={[makeMessage(), makeMessage()]}
        refreshing={false}
        running={false}
        emptyMessage="empty"
      />,
    );

    expect(scrollToIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, align: "end", behavior: "auto" }),
    );
  });

  it("does not scroll when sessionLoading completes but chat is empty", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[]}
        sessionLoading
        running={false}
        emptyMessage="empty"
      />,
    );

    scrollToIndexMock.mockClear();

    rerender(
      <ChatWindow
        chat={[]}
        sessionLoading={false}
        running={false}
        emptyMessage="empty"
      />,
    );

    expect(scrollToIndexMock).not.toHaveBeenCalled();
  });

  it(`shows "Refreshing..." in Footer when refreshing=true, chat non-empty`, () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        running={false}
        emptyMessage="No messages"
        refreshing
      />,
    );
    expect(
      screen.getByText("Refreshing..."),
      "FAIL (ADV-6): Refreshing indicator not visible in Footer for non-empty chat",
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Agent is thinking..."),
      "FAIL (ADV-6): Agent indicator incorrectly visible when only refreshing is true",
    ).not.toBeInTheDocument();
  });

  it(`shows "Refreshing..." in Footer when both flags true (refreshing takes priority), chat non-empty`, () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        running
        emptyMessage="No messages"
        refreshing
      />,
    );
    expect(
      screen.getByText("Refreshing..."),
      "FAIL (ADV-6): Refreshing should take priority in Footer when both flags are true",
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Agent is thinking..."),
      "FAIL (ADV-6): Agent indicator should not show when refreshing takes priority in Footer",
    ).not.toBeInTheDocument();
  });

  it(`shows "Agent is thinking..." in Footer when running=true, refreshing=false, chat non-empty`, () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        running
        refreshing={false}
        emptyMessage="No messages"
      />,
    );
    expect(
      screen.getByText("Agent is thinking..."),
      "FAIL (ADV-6): Agent indicator not visible in Footer when running=true, refreshing=false",
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Refreshing..."),
      "FAIL (ADV-6): Refreshing indicator incorrectly visible when refreshing=false",
    ).not.toBeInTheDocument();
  });

  it(`toggles between Refreshing and Agent indicator when refreshing changes at runtime (non-empty chat)`, () => {
    const { rerender } = render(
      <ChatWindow
        chat={[makeMessage()]}
        running
        refreshing
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        running
        refreshing={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
    expect(screen.queryByText("Refreshing...")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        running
        refreshing
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
  });

  it(`shows "Refreshing..." when refreshing=true, running=false, chat=[]`, () => {
    render(
      <ChatWindow
        chat={[]}
        running={false}
        emptyMessage="No messages"
        refreshing={true}
      />,
    );
    expect(
      screen.getByText("Refreshing..."),
      "FAIL (AC2): Refreshing indicator not visible when refreshing=true with empty chat",
    ).toBeInTheDocument();
  });

  it(`shows "Agent is thinking..." when running=true, refreshing=false, chat=[]`, () => {
    render(
      <ChatWindow
        chat={[]}
        running
        emptyMessage="No messages"
        refreshing={false}
      />,
    );
    expect(
      screen.getByText("Agent is thinking..."),
      "FAIL (AC3): Agent indicator not visible when running=true, refreshing=false",
    ).toBeInTheDocument();
  });

  it(`shows "Refreshing..." when both flags true (refreshing takes priority), chat=[]`, () => {
    render(
      <ChatWindow
        chat={[]}
        running
        emptyMessage="No messages"
        refreshing={true}
      />,
    );
    expect(
      screen.getByText("Refreshing..."),
      "FAIL (AC3): Refreshing should take priority when both flags are true",
    ).toBeInTheDocument();
  });

  it(`shows emptyMessage when both flags false, chat=[]`, () => {
    render(
      <ChatWindow
        chat={[]}
        running={false}
        emptyMessage="No messages"
        refreshing={false}
      />,
    );
    expect(
      screen.getByText("No messages"),
      "FAIL (AC2 reg): emptyMessage not visible when both refreshing and running are false",
    ).toBeInTheDocument();
  });

  it("followOutput returns false when user is scrolled up (no auto-scroll on streaming arrival)", () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        running
        emptyMessage="No messages"
      />,
    );

    const cb = followOutputCapture.current;
    expect(
      cb,
      "followOutput callback must be captured by the mock",
    ).toBeDefined();
    // User scrolled up → Virtuoso must NOT auto-scroll
    expect(cb!(false)).toBe(false);
    // User is at bottom → Virtuoso smoothly scrolls
    expect(cb!(true)).toBe("smooth");
  });

  it("passes a referentially stable components prop to Virtuoso across loading-spinner re-renders", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[makeMessage()]}
        running={false}
        sessionLoading
        emptyMessage="No messages"
      />,
    );

    const firstRef = componentsCapture.current;
    expect(
      firstRef,
      "components must be captured on first render",
    ).toBeDefined();

    // Toggle sessionLoading — a prop change that updates the Footer's displayed content
    // but must NOT create a new components object reference.
    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        running={false}
        sessionLoading={false}
        emptyMessage="No messages"
      />,
    );

    expect(
      componentsCapture.current,
      "components object reference must be stable across loading-state re-renders",
    ).toBe(firstRef);
  });

  it("does not render Virtuoso before scroll parent is available (no customScrollParent race)", () => {
    // The mock Virtuoso renders synchronously. If Virtuoso were rendered before
    // the scrollParent is set, the mock would still render, but in the real
    // component the customScrollParent would be undefined on first mount.
    // This test verifies that with a non-empty chat, messages are visible
    // (i.e. the scrollParent gate does not permanently suppress rendering).
    render(
      <ChatWindow
        chat={[makeMessage({ text: "RaceCheck" })]}
        running={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("RaceCheck")).toBeInTheDocument();
  });

  it("renders Virtuoso content correctly after scrollParent is set (height fix does not break list)", () => {
    render(
      <ChatWindow
        chat={[
          makeMessage({ id: "m1", text: "First" }),
          makeMessage({ id: "m2", text: "Second" }),
        ]}
        running={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });
});
