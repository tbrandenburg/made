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
    render(<ChatWindow chat={[]} loading={false} emptyMessage="No messages" />);
    expect(screen.getByText("No messages")).toBeInTheDocument();
  });

  it("shows loading indicator", () => {
    render(<ChatWindow chat={[]} loading emptyMessage="No messages" />);
    expect(screen.getByText("Agent is thinking...")).toBeInTheDocument();
  });

  it("renders loading indicator in the virtualized footer for non-empty chat", () => {
    render(
      <ChatWindow chat={[makeMessage()]} loading emptyMessage="No messages" />,
    );

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

  it("scrolls to the last message through the imperative handle", () => {
    const chatWindowRef = React.createRef<ChatWindowHandle>();

    render(
      <ChatWindow
        chatWindowRef={chatWindowRef}
        chat={[makeMessage()]}
        loading={false}
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
        loading={false}
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
        loading={false}
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
        loading={false}
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
        loading={false}
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
        loading={false}
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
        loading={false}
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
});
