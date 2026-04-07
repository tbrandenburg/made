import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { usePersistentChat } from "./usePersistentChat";

const TestComponent = ({
  storageKey,
  nextMessage,
}: {
  storageKey: string;
  nextMessage?: string;
}) => {
  const [chat, setChat] = usePersistentChat(storageKey);

  useEffect(() => {
    if (nextMessage) {
      setChat([
        {
          id: "message-1",
          text: nextMessage,
          role: "user",
          timestamp: "2026-04-07T00:00:00.000Z",
        },
      ]);
    }
  }, [nextMessage, setChat]);

  return <div data-testid="chat-count">{chat.length}</div>;
};

describe("usePersistentChat", () => {
  it("does not crash when localStorage writes throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    expect(() =>
      render(
        <TestComponent storageKey="repository-chat-ios" nextMessage="Hi" />,
      ),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to persist chat history to localStorage",
      expect.any(Error),
    );

    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
