import { act, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AgentReply, ChatHistoryMessage } from "./useApi";
import {
  cleanupSessionTests,
  deferred,
  renderSnapshotSession,
  snapshot,
  snapshotApi,
} from "./useChatSession.testSupport";

afterEach(cleanupSessionTests);

const persisted = (messageId: string, content: string): ChatHistoryMessage => ({
  messageId,
  role: "user",
  type: "text",
  content,
});

it("preserves optimistic display identity/time before and after send completion, then admits raw policy text once", async () => {
  const send = deferred<AgentReply>();
  const api = snapshotApi();
  api.sendMessage.mockReturnValue(send.promise);
  const { result } = renderSnapshotSession(api, "A", true);
  await waitFor(() => expect(result.current.chat).toHaveLength(3));
  let sending!: Promise<void>;
  act(() => {
    sending = result.current.handleSendMessage("repeat");
  });
  const optimistic = result.current.chat.at(-1);
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.at(-1)).toEqual(optimistic);
  expect(api.sendMessage).toHaveBeenCalledWith(
    "repo",
    "repeat\npolicy",
    "A",
    undefined,
    undefined,
  );
  await act(async () => {
    send.resolve({
      sessionId: "A",
      messageId: "receipt",
      sent: "now",
      response: "",
    });
    await sending;
  });
  expect(result.current.chat.at(-1)).toEqual(optimistic);
  expect(result.current.chat).toHaveLength(4);
  api.getHistory.mockResolvedValue({
    ...snapshot(),
    messages: [...snapshot().messages, persisted("new-user", "repeat\npolicy")],
  });
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.map((entry) => entry.id)).toEqual([
    "u1-0",
    "u2-0",
    "a-0",
    "new-user-0",
  ]);
  expect(result.current.chat.some((entry) => entry.id === optimistic?.id)).toBe(
    false,
  );
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat).toHaveLength(4);
  expect(
    result.current.chat.filter((entry) => entry.messageKey === "new-user"),
  ).toHaveLength(1);
});

it("retains the first send through its own new-session initial load and eventually admits the submitted prompt once", async () => {
  const api = snapshotApi();
  api.getHistory.mockResolvedValue({ ...snapshot(), messages: [] });
  const { result } = renderSnapshotSession(api, null, true);
  await act(async () => result.current.handleSendMessage("first prompt"));
  await waitFor(() => expect(result.current.sessionLoading).toBe(false));
  expect(result.current.sessionId).toBe("A");
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "first prompt",
  ]);
  const optimistic = result.current.chat[0];
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat[0]).toEqual(optimistic);
  api.getHistory.mockResolvedValue({
    ...snapshot(),
    messages: [persisted("first-user", "first prompt\npolicy")],
  });
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.map((entry) => entry.id)).toEqual([
    "first-user-0",
  ]);
  expect(result.current.chat[0].text).toBe("first prompt\npolicy");
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.map((entry) => entry.id)).toEqual([
    "first-user-0",
  ]);
  expect(result.current.chat.some((entry) => entry.id === optimistic.id)).toBe(
    false,
  );
});

it("admits repeated identical sends separately against each persisted baseline", async () => {
  const api = snapshotApi();
  api.getHistory.mockResolvedValue({ ...snapshot(), messages: [] });
  const { result } = renderSnapshotSession(api, null);
  await act(async () => result.current.handleSendMessage("repeat"));
  await waitFor(() => expect(result.current.sessionLoading).toBe(false));
  const firstLocal = result.current.chat[0];
  api.getHistory.mockResolvedValue({
    ...snapshot(),
    messages: [persisted("first-user", "repeat")],
  });
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.map((entry) => entry.id)).toEqual([
    "first-user-0",
  ]);
  expect(result.current.chat.some((entry) => entry.id === firstLocal.id)).toBe(
    false,
  );
  await act(async () => result.current.handleSendMessage("repeat"));
  const secondLocal = result.current.chat.at(-1);
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "repeat",
    "repeat",
  ]);
  expect(secondLocal?.id).not.toBe("first-user-0");
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.at(-1)).toEqual(secondLocal);
  api.getHistory.mockResolvedValue({
    ...snapshot(),
    messages: [
      persisted("first-user", "repeat"),
      persisted("second-user", "repeat"),
    ],
  });
  await act(async () => result.current.reloadCurrentSession());
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.map((entry) => entry.id)).toEqual([
    "first-user-0",
    "second-user-0",
  ]);
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "repeat",
    "repeat",
  ]);
});

it("keeps an optimistic entry when two new same-text persisted occurrences are ambiguous", async () => {
  const api = snapshotApi();
  const { result } = renderSnapshotSession(api);
  await waitFor(() => expect(result.current.chat).toHaveLength(3));
  await act(async () => result.current.handleSendMessage("repeat"));
  const optimistic = result.current.chat.at(-1);
  api.getHistory.mockResolvedValue({
    ...snapshot(),
    messages: [
      ...snapshot().messages,
      persisted("new-one", "repeat"),
      persisted("new-two", "repeat"),
    ],
  });
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.map((entry) => entry.id)).toEqual([
    "u1-0",
    "u2-0",
    "a-0",
    "new-one-0",
    "new-two-0",
    optimistic?.id,
  ]);
  expect(result.current.chat.at(-1)).toEqual(optimistic);
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat).toHaveLength(6);
  expect(result.current.chat.at(-1)).toEqual(optimistic);
});
