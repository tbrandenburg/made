import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ChatMessage } from "../types/chat";
import { useSessionLoader } from "./useSessionLoader";

afterEach(cleanup);

it.each(["replacement", "empty"])(
  "replaces prior-session V1 chat on initial load: %s",
  async (kind) => {
    const getHistory = vi.fn().mockResolvedValue({
      sessionId: "B",
      messages:
        kind === "empty"
          ? []
          : [
              {
                messageId: "b",
                role: "assistant",
                type: "text",
                content: "B only",
              },
            ],
    });
    const { result } = renderHook(() => {
      const [chat, setChat] = useState<ChatMessage[]>([
        { id: "a", role: "user", text: "A prior transcript", timestamp: "old" },
      ]);
      const loader = useSessionLoader({
        name: "repo",
        sessionId: "B",
        getHistory,
        setChat,
      });
      return { ...loader, chat };
    });
    await waitFor(() => expect(result.current.sessionLoading).toBe(false));
    expect(result.current.chat.map((message) => message.text)).toEqual(
      kind === "empty" ? [] : ["B only"],
    );
    expect(result.current.chat.some((message) => message.id === "a")).toBe(
      false,
    );
    expect(result.current.sessionError).toBeNull();
  },
);

it("aborts the old initial request and does not clear the next session's loading", async () => {
  let resolve!: (value: { sessionId: string; messages: [] }) => void;
  const getHistory = vi.fn().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { result, rerender } = renderHook(
    ({ sessionId }) => {
      const [chat, setChat] = useState<ChatMessage[]>([]);
      return {
        ...useSessionLoader({ name: "repo", sessionId, getHistory, setChat }),
        chat,
      };
    },
    { initialProps: { sessionId: "A" } },
  );
  const oldResolve = resolve;
  const signal = getHistory.mock.calls[0][2] as AbortSignal;
  rerender({ sessionId: "B" });
  await act(async () => oldResolve({ sessionId: "A", messages: [] }));
  expect(signal.aborted).toBe(true);
  expect(result.current.sessionLoading).toBe(true);
  await act(async () => resolve({ sessionId: "B", messages: [] }));
  expect(result.current.sessionLoading).toBe(false);
  expect(result.current.chat).toEqual([]);
});
