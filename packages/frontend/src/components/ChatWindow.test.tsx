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
