import { act, fireEvent, render, screen } from "@testing-library/react";
import React, { type ComponentType, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWindow, type ChatWindowHandle } from "./ChatWindow";
import { ChatMessage } from "../types/chat";

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

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "message-1",
  role: "user",
  text: "Hello",
  timestamp: "2026-04-07T00:00:00.000Z",
  ...overrides,
});

describe("ChatWindow", () => {
  beforeEach(() => {
    scrollToIndexMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows empty message when chat is empty", () => {
    render(
      <ChatWindow
        chat={[]}
        agentProcessing={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("No messages")).toBeInTheDocument();
  });

  it("shows loading indicator", () => {
    render(<ChatWindow chat={[]} agentProcessing emptyMessage="No messages" />);
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("renders loading indicator in the virtualized footer for non-empty chat", () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("renders chat messages through the virtualized list", () => {
    render(
      <ChatWindow
        chat={[makeMessage({ text: "**Hello**" })]}
        agentProcessing={false}
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
        agentProcessing={false}
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
        agentProcessing={false}
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
        agentProcessing={false}
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
        agentProcessing={false}
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
        agentProcessing={false}
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
        agentProcessing={false}
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
        agentProcessing={false}
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

  it("scrolls to the bottom on initial load when chat becomes non-empty", async () => {
    const chatWindowRef = React.createRef<ChatWindowHandle>();
    scrollToIndexMock.mockClear();

    render(
      <ChatWindow
        chatWindowRef={chatWindowRef}
        chat={[makeMessage(), makeMessage(), makeMessage()]}
        agentProcessing={false}
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

  it("toggles loading indicator when agentProcessing changes at runtime (empty chat)", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[]}
        agentProcessing={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("No messages")).toBeInTheDocument();

    rerender(
      <ChatWindow chat={[]} agentProcessing emptyMessage="No messages" />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
    expect(screen.queryByText("No messages")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[]}
        agentProcessing={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
    expect(screen.getByText("No messages")).toBeInTheDocument();
  });

  it("toggles loading indicator in Virtuoso footer when agentProcessing changes (non-empty chat)", () => {
    const { rerender } = render(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing={false}
        emptyMessage="No messages"
      />,
    );

    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
  });

  it("shows loading indicator across empty-to-non-empty transition while agentProcessing remains true", () => {
    const { rerender } = render(
      <ChatWindow chat={[]} agentProcessing emptyMessage="No messages" />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing
        emptyMessage="No messages"
      />,
    );

    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

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

  it(`shows "Refreshing..." in Footer when refreshing=true, chat non-empty`, () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing={false}
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
        agentProcessing
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

  it(`shows "Agent is thinking..." in Footer when agentProcessing=true, refreshing=false, chat non-empty`, () => {
    render(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing
        refreshing={false}
        emptyMessage="No messages"
      />,
    );
    expect(
      screen.getByText("Agent is thinking..."),
      "FAIL (ADV-6): Agent indicator not visible in Footer when agentProcessing=true, refreshing=false",
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
        agentProcessing
        refreshing
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing
        refreshing={false}
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
    expect(screen.queryByText("Refreshing...")).not.toBeInTheDocument();

    rerender(
      <ChatWindow
        chat={[makeMessage()]}
        agentProcessing
        refreshing
        emptyMessage="No messages"
      />,
    );
    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
    expect(screen.queryByText("Agent is thinking...")).not.toBeInTheDocument();
  });

  it(`shows "Refreshing..." when refreshing=true, agentProcessing=false, chat=[]`, () => {
    render(
      <ChatWindow
        chat={[]}
        agentProcessing={false}
        emptyMessage="No messages"
        refreshing={true}
      />,
    );
    expect(
      screen.getByText("Refreshing..."),
      "FAIL (AC2): Refreshing indicator not visible when refreshing=true with empty chat",
    ).toBeInTheDocument();
  });

  it(`shows "Agent is thinking..." when agentProcessing=true, refreshing=false, chat=[]`, () => {
    render(
      <ChatWindow
        chat={[]}
        agentProcessing
        emptyMessage="No messages"
        refreshing={false}
      />,
    );
    expect(
      screen.getByText("Agent is thinking..."),
      "FAIL (AC3): Agent indicator not visible when agentProcessing=true, refreshing=false",
    ).toBeInTheDocument();
  });

  it(`shows "Refreshing..." when both flags true (refreshing takes priority), chat=[]`, () => {
    render(
      <ChatWindow
        chat={[]}
        agentProcessing
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
        agentProcessing={false}
        emptyMessage="No messages"
        refreshing={false}
      />,
    );
    expect(
      screen.getByText("No messages"),
      "FAIL (AC2 reg): emptyMessage not visible when both refreshing and agentProcessing are false",
    ).toBeInTheDocument();
  });
});
