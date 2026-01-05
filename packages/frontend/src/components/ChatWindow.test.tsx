import { render, screen, fireEvent } from "@testing-library/react";
import { ChatWindow } from "./ChatWindow";

const baseChat = [
  {
    id: "1",
    role: "agent" as const,
    text: "First message",
    timestamp: new Date("2024-01-01T12:00:00Z").toISOString(),
  },
  {
    id: "2",
    role: "user" as const,
    text: "Second message",
    timestamp: new Date("2024-01-01T12:05:00Z").toISOString(),
  },
];

describe("ChatWindow", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    // @ts-expect-error clipboard is writable in tests
    navigator.clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    // @ts-expect-error clipboard restored for other tests
    navigator.clipboard = originalClipboard;
  });

  it("renders copy buttons and copies individual messages", async () => {
    render(
      <ChatWindow
        chat={baseChat}
        loading={false}
        emptyMessage="empty"
        sessionId="abc"
      />,
    );

    const copyButtons = screen.getAllByRole("button", { name: "Copy message" });
    expect(copyButtons).toHaveLength(2);

    fireEvent.click(copyButtons[0]);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "First message",
    );
  });
});
