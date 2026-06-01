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
  it("does not crash when debounced localStorage writes throw", () => {
    vi.useFakeTimers();
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

    vi.advanceTimersByTime(300);

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to persist chat history to localStorage",
      expect.any(Error),
    );

    setItemSpy.mockRestore();
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("coalesces rapid chat updates into one persisted write", () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { rerender } = render(
      <TestComponent storageKey="repository-chat-ios" nextMessage="One" />,
    );

    rerender(
      <TestComponent storageKey="repository-chat-ios" nextMessage="Two" />,
    );
    rerender(
      <TestComponent storageKey="repository-chat-ios" nextMessage="Three" />,
    );

    expect(setItemSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    setItemSpy.mockRestore();
    vi.useRealTimers();
  });
});
