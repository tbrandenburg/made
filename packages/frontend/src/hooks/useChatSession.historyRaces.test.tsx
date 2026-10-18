import { act, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentReply, ChatHistoryResponse } from "./useApi";
import {
  cleanupSessionTests,
  deferred,
  renderSnapshotSession,
  snapshot,
  snapshotApi,
} from "./useChatSession.testSupport";

afterEach(cleanupSessionTests);

it.each(["success", "failure"])(
  "ignores reversed initial %s after a same-session manual refresh and releases loading",
  async (outcome) => {
    const initial = deferred<ChatHistoryResponse>();
    const api = snapshotApi(vi.fn().mockReturnValue(initial.promise));
    const { result } = renderSnapshotSession(api);
    expect(result.current.sessionLoading).toBe(true);
    api.getHistory.mockResolvedValue(snapshot("newer"));
    await act(async () => result.current.reloadCurrentSession());
    expect(result.current.sessionLoading).toBe(false);
    expect(result.current.chat.at(-1)?.text).toBe("newer");
    await act(async () => {
      if (outcome === "success") initial.resolve(snapshot("stale"));
      else initial.reject(new Error("stale failure"));
    });
    expect(result.current.chat.at(-1)?.text).toBe("newer");
    expect(result.current.sessionError).toBeNull();
  },
);

it("keeps newer initial loading and status isolated across a channel change with the same session ID", async () => {
  const old = deferred<ChatHistoryResponse>();
  const next = deferred<ChatHistoryResponse>();
  const api = snapshotApi(vi.fn().mockReturnValue(old.promise));
  const { result, rerender } = renderSnapshotSession(api);
  const oldSignal = api.getHistory.mock.calls.at(-1)?.[3] as AbortSignal;
  api.getHistory.mockReturnValue(next.promise);
  rerender({ name: "other" });
  await act(async () => old.resolve(snapshot("old channel")));
  expect(oldSignal.aborted).toBe(true);
  expect(result.current.sessionLoading).toBe(true);
  await act(async () => next.resolve(snapshot("new channel")));
  expect(result.current.chat.at(-1)?.text).toBe("new channel");
  expect(result.current.sessionLoading).toBe(false);
});

it("hands loading ownership to a pending manual refresh without letting the stale initial request clear it", async () => {
  const initial = deferred<ChatHistoryResponse>();
  const manual = deferred<ChatHistoryResponse>();
  const api = snapshotApi(vi.fn().mockReturnValue(initial.promise));
  const { result } = renderSnapshotSession(api);
  api.getHistory.mockReturnValue(manual.promise);
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = result.current.reloadCurrentSession();
  });
  expect(result.current.sessionLoading).toBe(false);
  expect(result.current.isRefreshing).toBe(true);
  await act(async () => initial.resolve(snapshot("stale")));
  expect(result.current.isRefreshing).toBe(true);
  expect(result.current.chat).toEqual([]);
  await act(async () => {
    manual.resolve(snapshot("current"));
    await refreshing;
  });
  expect(result.current.isRefreshing).toBe(false);
  expect(result.current.chat.at(-1)?.text).toBe("current");
});

it.each(["manual", "poll"])(
  "ignores an older same-session %s completion after the other request path wins",
  async (older) => {
    const api = snapshotApi();
    const send = deferred<AgentReply>();
    api.sendMessage.mockReturnValue(send.promise);
    const { result } = renderSnapshotSession(api);
    await waitFor(() => expect(result.current.chat).toHaveLength(3));
    const stale = deferred<ChatHistoryResponse>();
    api.getHistory
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue(snapshot("newest"));
    let refresh!: Promise<void>;
    if (older === "manual") {
      act(() => {
        refresh = result.current.reloadCurrentSession();
      });
      act(() => {
        void result.current.handleSendMessage("pending");
      });
    } else {
      act(() => {
        void result.current.handleSendMessage("pending");
      });
      await act(async () => {
        refresh = result.current.reloadCurrentSession();
        await refresh;
      });
    }
    await waitFor(() =>
      expect(
        result.current.chat.find((entry) => entry.id === "a-0")?.text,
      ).toBe("newest"),
    );
    await act(async () => {
      stale.resolve(snapshot("oldest"));
      await refresh;
    });
    expect(result.current.chat.find((entry) => entry.id === "a-0")?.text).toBe(
      "newest",
    );
    expect(result.current.chat.at(-1)?.text).toBe("pending");
    expect(result.current.sessionError).toBeNull();
  },
);

it("releases initial loading when polling supersedes it while preserving an unanchored optimistic send", async () => {
  const initial = deferred<ChatHistoryResponse>();
  const api = snapshotApi(vi.fn().mockReturnValue(initial.promise));
  api.sendMessage.mockReturnValue(new Promise(() => {}));
  const { result } = renderSnapshotSession(api);
  api.getHistory.mockResolvedValue(snapshot());
  act(() => {
    void result.current.handleSendMessage("repeat");
  });
  await waitFor(() => expect(result.current.chat).toHaveLength(4));
  expect(result.current.sessionLoading).toBe(false);
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "repeat",
    "repeat",
    "original",
    "repeat",
  ]);
  const local = result.current.chat.at(-1);
  await act(async () => initial.resolve(snapshot("old")));
  expect(result.current.chat.at(-1)).toEqual(local);
  expect(result.current.chat.find((entry) => entry.id === "a-0")?.text).toBe(
    "original",
  );
});

it("ignores a delayed status response from the previous channel even with the same session ID", async () => {
  const status = deferred<{ running: boolean }>();
  const api = snapshotApi();
  api.getStatus.mockReturnValue(status.promise);
  const { result, rerender } = renderSnapshotSession(api);
  await waitFor(() => expect(api.getStatus).toHaveBeenCalled());
  api.getStatus.mockResolvedValue({ running: false });
  rerender({ name: "other" });
  await waitFor(() => expect(api.getStatus).toHaveBeenCalledWith("other", "A"));
  await act(async () => status.resolve({ running: true }));
  expect(result.current.agentState).toEqual({ status: "idle" });
  expect(result.current.chat).toHaveLength(3);
});
