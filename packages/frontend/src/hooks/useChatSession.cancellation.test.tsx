import { act, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentReply } from "./useApi";
import {
  cleanupSessionTests,
  deferred,
  renderSnapshotSession,
  snapshotApi,
} from "./useChatSession.testSupport";

afterEach(cleanupSessionTests);

it("settles a sessionless cancellation, ignores the late reply, and permits another send", async () => {
  vi.useFakeTimers();
  const send = deferred<AgentReply>();
  const api = snapshotApi();
  api.sendMessage.mockReturnValueOnce(send.promise);
  const { result } = renderSnapshotSession(api, null);
  let sending!: Promise<void>;
  act(() => {
    sending = result.current.handleSendMessage("cancel me");
  });
  expect(result.current.agentState).toEqual({ status: "processing" });
  await act(async () => result.current.handleCancel());
  expect(api.cancelAgent).toHaveBeenCalledWith("repo", undefined);
  expect(result.current.agentState).toEqual({ status: "idle" });
  expect(result.current.isCancelingAgent).toBe(false);
  await act(async () => {
    send.resolve({
      sessionId: "cancelled-session",
      messageId: "late",
      sent: "now",
      response: "",
      processing: true,
    });
    await sending;
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(result.current.sessionId).toBeNull();
  expect(result.current.agentState).toEqual({ status: "idle" });
  expect(api.getStatus).not.toHaveBeenCalled();
  await act(async () => result.current.handleSendMessage("try again"));
  expect(api.sendMessage).toHaveBeenNthCalledWith(
    2,
    "repo",
    "try again",
    undefined,
    undefined,
    undefined,
  );
  expect(result.current.sessionId).toBe("A");
});

it("preserves the cancellation error for a sessionless send when cancellation fails", async () => {
  const send = deferred<AgentReply>();
  const api = snapshotApi();
  api.sendMessage.mockReturnValue(send.promise);
  api.cancelAgent.mockRejectedValue(new Error("cancel unavailable"));
  const { result } = renderSnapshotSession(api, null);
  let sending!: Promise<void>;
  act(() => {
    sending = result.current.handleSendMessage("pending");
  });
  await act(async () => result.current.handleCancel());
  expect(result.current.agentState).toEqual({
    status: "error",
    message: "Unable to cancel the agent request.",
  });
  expect(result.current.sessionId).toBeNull();
  await act(async () => {
    send.resolve({
      sessionId: "late",
      messageId: "receipt",
      sent: "now",
      response: "",
    });
    await sending;
  });
  expect(result.current.agentState.status).toBe("error");
  expect(api.getStatus).not.toHaveBeenCalled();
});

it("ignores an old cancellation failure after clearing and starting a new send", async () => {
  vi.useFakeTimers();
  const first = deferred<AgentReply>();
  const second = deferred<AgentReply>();
  const cancel = deferred<unknown>();
  const api = snapshotApi();
  api.sendMessage
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  api.cancelAgent.mockReturnValue(cancel.promise);
  const { result } = renderSnapshotSession(api, null);
  let firstSend!: Promise<void>;
  let secondSend!: Promise<void>;
  let cancelling!: Promise<void>;
  act(() => {
    firstSend = result.current.handleSendMessage("first");
  });
  act(() => {
    cancelling = result.current.handleCancel();
  });
  act(() => result.current.handleClearSessionAndHistory());
  act(() => {
    secondSend = result.current.handleSendMessage("second");
  });
  const optimistic = result.current.chat[0];
  await act(async () => {
    cancel.reject(new Error("old cancellation failed"));
    await cancelling;
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(result.current.agentState).toEqual({ status: "processing" });
  expect(result.current.sessionId).toBeNull();
  expect(result.current.chat).toEqual([optimistic]);
  expect(optimistic.text).toBe("second");
  expect(result.current.isCancelingAgent).toBe(false);
  await act(async () => {
    first.resolve({
      sessionId: "old-session",
      messageId: "old",
      sent: "now",
      response: "",
      processing: true,
    });
    await firstSend;
  });
  expect(result.current.sessionId).toBeNull();
  expect(result.current.agentState).toEqual({ status: "processing" });
  await act(async () => {
    second.resolve({
      sessionId: "A",
      messageId: "new",
      sent: "now",
      response: "",
    });
    await secondSend;
  });
  expect(result.current.sessionId).toBe("A");
  expect(api.sendMessage).toHaveBeenNthCalledWith(
    2,
    "repo",
    "second",
    undefined,
    undefined,
    undefined,
  );
});

it("uses the current session status if its own new-session transition commits during cancellation", async () => {
  const send = deferred<AgentReply>();
  const cancel = deferred<unknown>();
  const api = snapshotApi();
  api.sendMessage.mockReturnValueOnce(send.promise);
  api.cancelAgent.mockReturnValue(cancel.promise);
  const { result } = renderSnapshotSession(api, null);
  let sending!: Promise<void>;
  let cancelling!: Promise<void>;
  await act(async () => {
    sending = result.current.handleSendMessage("create session");
    send.resolve({
      sessionId: "A",
      messageId: "receipt",
      sent: "now",
      response: "",
    });
    await sending;
    cancelling = result.current.handleCancel();
  });
  expect(api.cancelAgent).toHaveBeenCalledWith("repo", undefined);
  expect(result.current.sessionId).toBe("A");
  api.getStatus.mockResolvedValue({ running: true });
  await act(async () => {
    cancel.resolve(undefined);
    await cancelling;
  });
  await waitFor(() =>
    expect(result.current.agentState).toEqual({ status: "processing" }),
  );
  expect(api.getStatus).toHaveBeenCalledWith("repo", "A");
  expect(result.current.isCancelingAgent).toBe(false);
});

it("clear-session-only retains the displayed transcript but ends tracking and ignores a delayed send", async () => {
  const send = deferred<AgentReply>();
  const api = snapshotApi();
  api.sendMessage.mockReturnValue(send.promise);
  const { result } = renderSnapshotSession(api);
  await waitFor(() => expect(result.current.chat).toHaveLength(3));
  let sending!: Promise<void>;
  act(() => {
    sending = result.current.handleSendMessage("pending");
  });
  const before = result.current.chat;
  act(() => result.current.handleClearSessionOnly());
  expect(result.current.chat).toEqual(before);
  expect(result.current.sessionId).toBeNull();
  await act(async () => {
    send.resolve({
      sessionId: "A",
      messageId: "receipt",
      sent: "now",
      response: "",
    });
    await sending;
  });
  expect(result.current.sessionId).toBeNull();
  act(() => result.current.navigate("A"));
  await waitFor(() => expect(result.current.sessionLoading).toBe(false));
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "repeat",
    "repeat",
    "original",
  ]);
});

it.each(["failure", "cancel", "clear", "switch", "prop", "channel"])(
  "ends pending tracking on %s without accepting the delayed send",
  async (action) => {
    const send = deferred<AgentReply>();
    const api = snapshotApi();
    api.sendMessage.mockReturnValue(send.promise);
    const { result, rerender } = renderSnapshotSession(api);
    await waitFor(() => expect(result.current.chat).toHaveLength(3));
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.handleSendMessage("pending");
    });
    const optimistic = result.current.chat.at(-1);
    if (action === "failure") {
      await act(async () => {
        send.reject(new Error("send failed"));
        await sending;
      });
      expect(result.current.chat.at(-1)).toEqual(optimistic);
    }
    if (action === "cancel") {
      await act(async () => result.current.handleCancel());
      expect(result.current.chat.at(-1)).toEqual(optimistic);
    }
    if (action === "clear")
      act(() => result.current.handleClearSessionAndHistory());
    if (action === "switch")
      act(() =>
        result.current.handleSessionSelect({
          id: "B",
          title: "B",
          updated: "now",
        }),
      );
    if (action === "prop") act(() => result.current.navigate("B"));
    if (action === "channel") rerender({ name: "other" });
    if (action !== "failure")
      await act(async () => {
        send.resolve({
          sessionId: "A",
          messageId: "receipt",
          sent: "now",
          response: "",
        });
        await sending;
      });
    if (action !== "clear")
      await act(async () => result.current.reloadCurrentSession());
    expect(
      result.current.chat.some((entry) => entry.id === optimistic?.id),
    ).toBe(false);
    expect(result.current.sessionId).toBe(
      action === "clear"
        ? null
        : ["switch", "prop"].includes(action)
          ? "B"
          : "A",
    );
  },
);
