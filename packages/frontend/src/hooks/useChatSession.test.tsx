import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import type { ChatMessage } from "../types/chat";
import { useState } from "react";
import type { ChatHistoryResponse } from "./useApi";
import { HttpError } from "./useApi";
import {
  deferred,
  historyFor,
  SessionWindow,
} from "./useChatSession.testSupport";

function renderSession(getHistory: ReturnType<typeof vi.fn>) {
  const api = {
    getHistory,
    sendMessage: vi.fn().mockResolvedValue({ sessionId: "B" }),
    getStatus: vi.fn().mockResolvedValue({ running: false }),
    cancelAgent: vi.fn(),
    getSessions: vi.fn(),
    getChildSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  };
  const hook = renderHook(() => {
    const [sessionId, setSessionId] = useState<string | null>("A");
    const [chat, setChat] = useState<ChatMessage[]>([]);
    const session = useChatSession({
      name: "repo",
      sessionId,
      setSessionId,
      chat,
      setChat,
      setPrompt: vi.fn(),
      setSelectedAgent: vi.fn(),
      normalizedSelectedAgent: "default",
      defaultAgentValue: "default",
      api,
    });
    return { ...session, chat, sessionId };
  });
  return { ...hook, api };
}

const makeChat = (): ChatMessage[] => [];

describe("useChatSession", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps root sessions available when child session lookup fails", async () => {
    const rootSession = {
      id: "ses_root",
      title: "Root session",
      updated: "2026-10-31",
    };
    const getHistory = vi.fn().mockResolvedValue(historyFor("A"));
    const { result, api } = renderSession(getHistory);
    api.getSessions.mockResolvedValue({ sessions: [rootSession] });
    api.getChildSessions.mockRejectedValue(new Error("child lookup failed"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => result.current.openSessionModal());

    expect(result.current.sessionOptions).toEqual([rootSession]);
    expect(result.current.sessionListError).toBeNull();
    expect(result.current.sessionModalOpen).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      "Failed to load child sessions; showing root sessions only.",
    );
  });

  it("keeps repeated 409 history failures visible through refresh and idle status probes", async () => {
    vi.useFakeTimers();
    const message =
      "This session belongs to a different directory. Start a new session.";
    const pending = deferred<ChatHistoryResponse>();
    const getHistory = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(message, 409))
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new HttpError(message, 409))
      .mockResolvedValue({ sessionId: "A", messages: [] });
    const getStatus = vi.fn().mockResolvedValue({ running: false });
    render(
      <SessionWindow
        api={{
          getHistory,
          getStatus,
          sendMessage: vi.fn(),
          cancelAgent: vi.fn(),
          getSessions: vi.fn(),
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    fireEvent.click(screen.getByText("Refresh"));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    await act(async () => {
      pending.reject(new HttpError(message, 409));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("No conversation yet.")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getStatus).toHaveBeenCalledWith("repo", "A");
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    fireEvent.click(screen.getByText("Refresh"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("No conversation yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Refresh"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No conversation yet.")).toBeInTheDocument();
  });

  it("retains incremental history failure and transcript after a successful idle probe", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const message =
      "Unable to load session history. Check your connection and retry refresh.";
    const getHistory = vi
      .fn()
      .mockResolvedValueOnce(historyFor("A"))
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const getStatus = vi.fn().mockResolvedValue({ running: false });
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ sessionId: "A", processing: false });
    render(
      <SessionWindow
        api={{
          getHistory,
          getStatus,
          sendMessage,
          cancelAgent: vi.fn(),
          getSessions: vi.fn(),
        }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Transcript")).toHaveTextContent(
        "A question | A answer",
      ),
    );
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Transcript")).toHaveTextContent(
      "A question | A answer | follow up",
    );
    expect(screen.queryByText("No conversation yet.")).not.toBeInTheDocument();
    getHistory.mockResolvedValue({ sessionId: "A", messages: [] });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Transcript")).toHaveTextContent(
      "A question | A answer | follow up",
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      new Error(
        "This session belongs to a different directory. Start a new session.",
      ),
      "This session belongs to a different directory. Start a new session.",
    ],
    [
      new TypeError("Failed to fetch"),
      "Unable to load session history. Check your connection and retry refresh.",
    ],
  ])(
    "retains same-session transcript throughout a failed refresh (%s) and shows an actionable error",
    async (failure, message) => {
      const pending = deferred<ChatHistoryResponse>();
      const getHistory = vi
        .fn()
        .mockResolvedValueOnce(historyFor("A"))
        .mockReturnValueOnce(pending.promise);
      const { result } = renderSession(getHistory);
      await waitFor(() => expect(result.current.chat).toHaveLength(2));
      const before = result.current.chat;
      let refresh!: Promise<void>;
      act(() => {
        refresh = result.current.reloadCurrentSession();
      });
      expect(result.current.chat).toEqual(before);
      expect(result.current.isRefreshing).toBe(true);
      await act(async () => {
        pending.reject(failure);
        await refresh;
      });
      expect(result.current.chat).toEqual(before);
      expect(result.current.sessionError).toBe(message);
      expect(result.current.isRefreshing).toBe(false);
    },
  );

  it.each(["success", "failure"])(
    "ignores delayed refresh %s A after switching to B and resumes B without duplicates",
    async (outcome) => {
      const pending = deferred<ChatHistoryResponse>();
      const getHistory = vi
        .fn()
        .mockResolvedValueOnce(historyFor("A"))
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(historyFor("B"));
      const { result, api } = renderSession(getHistory);
      await waitFor(() => expect(result.current.chat).toHaveLength(2));
      let refresh!: Promise<void>;
      act(() => {
        refresh = result.current.reloadCurrentSession();
      });
      act(() => {
        result.current.handleSessionSelect({
          id: "B",
          title: "B",
          updated: "now",
        });
      });
      await waitFor(() =>
        expect(result.current.chat.map((message) => message.text)).toEqual([
          "B question",
          "B answer",
        ]),
      );
      await act(async () => {
        if (outcome === "failure")
          pending.reject(new Error("Delayed A failure"));
        else pending.resolve(historyFor("A"));
        await refresh;
      });
      expect(result.current.sessionId).toBe("B");
      expect(result.current.chat.map((message) => message.text)).toEqual([
        "B question",
        "B answer",
      ]);
      expect(result.current.agentState).toEqual({ status: "idle" });
      expect(result.current.sessionError).toBeNull();
      await act(async () => {
        await result.current.reloadCurrentSession();
      });
      expect(result.current.chat).toHaveLength(2);
      await act(async () => {
        await result.current.handleSendMessage("follow up");
      });
      expect(api.sendMessage).toHaveBeenCalledWith(
        "repo",
        "follow up",
        "B",
        undefined,
        undefined,
      );
      expect(result.current.sessionId).toBe("B");
    },
  );

  it("clears A's transcript when selecting an inaccessible session and shows the failure", async () => {
    const pending = deferred<ChatHistoryResponse>();
    const getHistory = vi
      .fn()
      .mockResolvedValueOnce(historyFor("A"))
      .mockReturnValueOnce(pending.promise);
    const { result } = renderSession(getHistory);
    await waitFor(() => expect(result.current.chat).toHaveLength(2));
    act(() => {
      result.current.handleSessionSelect({
        id: "foreign",
        title: "foreign",
        updated: "now",
      });
    });
    expect(result.current.chat).toEqual([]);
    await act(async () => {
      pending.reject(
        new Error(
          "This session belongs to a different directory. Start a new session.",
        ),
      );
    });
    await waitFor(() =>
      expect(result.current.sessionError).toContain("Start a new session"),
    );
    expect(result.current.sessionId).toBe("foreign");
    expect(result.current.chat).toEqual([]);
    expect(result.current.sessionLoading).toBe(false);
  });

  it("clears a previous history error when switching sessions before the new load succeeds", async () => {
    const pending = deferred<ChatHistoryResponse>();
    const getHistory = vi
      .fn()
      .mockRejectedValueOnce(new Error("A history failure"))
      .mockReturnValueOnce(pending.promise);
    const { result } = renderSession(getHistory);
    await waitFor(() =>
      expect(result.current.sessionError).toBe("A history failure"),
    );
    act(() =>
      result.current.handleSessionSelect({
        id: "B",
        title: "B",
        updated: "now",
      }),
    );
    expect(result.current.sessionError).toBeNull();
    expect(result.current.chat).toEqual([]);
    expect(result.current.sessionId).toBe("B");
    await act(async () => {
      pending.resolve(historyFor("B"));
    });
    expect(result.current.sessionError).toBeNull();
    expect(result.current.chat.map((message) => message.text)).toEqual([
      "B question",
      "B answer",
    ]);
  });

  it("ignores a rejected initial load after its session selection was superseded", async () => {
    const pending = deferred<ChatHistoryResponse>();
    const getHistory = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(historyFor("B"));
    const { result } = renderSession(getHistory);
    act(() => {
      result.current.handleSessionSelect({
        id: "B",
        title: "B",
        updated: "now",
      });
    });
    await waitFor(() => expect(result.current.chat).toHaveLength(2));
    await act(async () => {
      pending.reject(new Error("Stale initial load failure"));
    });
    expect(result.current.sessionError).toBeNull();
    expect(result.current.chat.map((message) => message.text)).toEqual([
      "B question",
      "B answer",
    ]);
    expect(result.current.sessionId).toBe("B");
  });

  it.each(["success", "failure"])(
    "ignores delayed incremental history %s A after selecting session B",
    async (outcome) => {
      const pending = deferred<ChatHistoryResponse>();
      const getHistory = vi
        .fn()
        .mockImplementation((_name: string, id: string) =>
          id === "B" ? Promise.resolve(historyFor("B")) : pending.promise,
        )
        .mockResolvedValueOnce(historyFor("A"));
      const { result, api } = renderSession(getHistory);
      api.sendMessage.mockResolvedValue({ sessionId: "A" });
      await waitFor(() => expect(result.current.chat).toHaveLength(2));
      let send!: Promise<void>;
      act(() => {
        send = result.current.handleSendMessage("follow up A");
      });
      await waitFor(() =>
        expect(getHistory.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      act(() => {
        result.current.handleSessionSelect({
          id: "B",
          title: "B",
          updated: "now",
        });
      });
      await waitFor(() =>
        expect(result.current.chat.map((message) => message.text)).toEqual([
          "B question",
          "B answer",
        ]),
      );
      await act(async () => {
        if (outcome === "failure")
          pending.reject(new Error("Stale incremental failure"));
        else pending.resolve(historyFor("A"));
        await send;
      });
      expect(result.current.sessionId).toBe("B");
      expect(result.current.chat.map((message) => message.text)).toEqual([
        "B question",
        "B answer",
      ]);
      expect(result.current.sessionError).toBeNull();
    },
  );

  it("initializes idle", () => {
    const api = {
      sendMessage: vi.fn(),
      getStatus: vi.fn(),
      cancelAgent: vi.fn(),
      getHistory: vi.fn(),
      getSessions: vi.fn(),
    };

    const { result } = renderHook(() =>
      useChatSession({
        name: "repo",
        sessionId: null,
        setSessionId: vi.fn(),
        chat: makeChat(),
        setChat: vi.fn(),
        setPrompt: vi.fn(),
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        api,
      }),
    );

    expect(result.current.agentState).toEqual({ status: "idle" });
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.sessionModalOpen).toBe(false);
  });

  it("sends a message and marks processing", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      messageId: "m1",
      sent: "2026-06-28T00:00:00.000Z",
      response: "ok",
      sessionId: "session-2",
    });
    const getStatus = vi.fn().mockResolvedValue({ running: false });
    const api = {
      sendMessage,
      getStatus,
      cancelAgent: vi.fn(),
      getHistory: vi
        .fn()
        .mockResolvedValue({ sessionId: "session-2", messages: [] }),
      getSessions: vi.fn(),
    };
    const setPrompt = vi.fn();
    const setSessionId = vi.fn();
    const onActivateAgentTab = vi.fn();

    const { result } = renderHook(() =>
      useChatSession({
        name: "repo",
        sessionId: null,
        setSessionId,
        chat: makeChat(),
        setChat: vi.fn(),
        setPrompt,
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "agent-x",
        defaultAgentValue: "default",
        api,
        onActivateAgentTab,
      }),
    );

    await act(async () => {
      await result.current.handleSendMessage("hello", { clearPrompt: true });
    });

    expect(sendMessage).toHaveBeenCalledWith(
      "repo",
      "hello",
      undefined,
      undefined,
      "agent-x",
    );
    expect(setPrompt).toHaveBeenCalledWith("");
    expect(setSessionId).toHaveBeenCalledWith("session-2");
    expect(onActivateAgentTab).toHaveBeenCalled();
  });

  it("clears session state", async () => {
    const setSessionId = vi.fn();
    const setSelectedAgent = vi.fn();
    const api = {
      sendMessage: vi.fn(),
      getStatus: vi.fn(),
      cancelAgent: vi.fn(),
      getHistory: vi
        .fn()
        .mockResolvedValue({ sessionId: "session-1", messages: [] }),
      getSessions: vi.fn(),
    };

    const { result } = renderHook(() =>
      useChatSession({
        name: "repo",
        sessionId: "session-1",
        setSessionId,
        chat: makeChat(),
        setChat: vi.fn(),
        setPrompt: vi.fn(),
        setSelectedAgent,
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        api,
      }),
    );

    act(() => {
      result.current.handleClearSessionOnly();
    });

    expect(setSessionId).toHaveBeenCalledWith(null);
    expect(setSelectedAgent).toHaveBeenCalledWith("default");
  });

  it("honors external/no-op guards", async () => {
    const api = {
      sendMessage: vi.fn(),
      getStatus: vi.fn(),
      cancelAgent: vi.fn(),
      getHistory: vi.fn(),
      getSessions: vi.fn(),
    };

    const { result } = renderHook(() =>
      useChatSession({
        name: "doc",
        sessionId: "session-1",
        setSessionId: vi.fn(),
        chat: makeChat(),
        setChat: vi.fn(),
        setPrompt: vi.fn(),
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        isExternal: true,
        api,
      }),
    );

    await act(async () => {
      await result.current.handleSendMessage("hello");
      await result.current.handleCancel();
      await result.current.reloadCurrentSession();
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.cancelAgent).not.toHaveBeenCalled();
    expect(api.getHistory).not.toHaveBeenCalled();
  });

  it("reloads current session without restarting polling", async () => {
    const setChat = vi.fn();
    const api = {
      sendMessage: vi.fn(),
      getStatus: vi.fn().mockResolvedValue({ running: false }),
      cancelAgent: vi.fn(),
      getHistory: vi.fn().mockResolvedValue({
        sessionId: "session-1",
        messages: [
          { messageId: "m1", role: "user", type: "text", content: "hello" },
        ],
      }),
      getSessions: vi.fn(),
    };

    const { result } = renderHook(() =>
      useChatSession({
        name: "repo",
        sessionId: "session-1",
        setSessionId: vi.fn(),
        chat: makeChat(),
        setChat,
        setPrompt: vi.fn(),
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        api,
      }),
    );

    await act(async () => {
      await result.current.reloadCurrentSession();
    });

    expect(api.getHistory).toHaveBeenCalledWith(
      "repo",
      "session-1",
      undefined,
      expect.any(AbortSignal),
    );
    expect(setChat).toHaveBeenCalled();
  });

  it("preserves the send failure status after refresh", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("Network error"));
    const getStatus = vi.fn().mockResolvedValue({ running: false });
    const api = {
      sendMessage,
      getStatus,
      cancelAgent: vi.fn(),
      getHistory: vi.fn(),
      getSessions: vi.fn(),
    };

    const { result } = renderHook(() =>
      useChatSession({
        name: "repo",
        sessionId: null,
        setSessionId: vi.fn(),
        chat: makeChat(),
        setChat: vi.fn(),
        setPrompt: vi.fn(),
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        api,
      }),
    );

    await act(async () => {
      await result.current.handleSendMessage("hello");
    });

    expect(result.current.agentState).toEqual({
      status: "error",
      message: "Agent unavailable",
    });
  });

  it("resets to idle after cancel failure when agent not running", async () => {
    const cancelAgent = vi.fn().mockRejectedValue(new Error("cancel failed"));
    const getStatus = vi.fn().mockResolvedValue({ running: false });
    const api = {
      sendMessage: vi.fn(),
      getStatus,
      cancelAgent,
      getHistory: vi
        .fn()
        .mockResolvedValue({ sessionId: "session-1", messages: [] }),
      getSessions: vi.fn(),
    };

    const { result } = renderHook(() =>
      useChatSession({
        name: "repo",
        sessionId: "session-1",
        setSessionId: vi.fn(),
        chat: makeChat(),
        setChat: vi.fn(),
        setPrompt: vi.fn(),
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        api,
      }),
    );

    await waitFor(() => expect(getStatus).toHaveBeenCalled());

    await result.current.handleCancel();

    await waitFor(() =>
      expect(result.current.agentState).toEqual({ status: "idle" }),
    );
  });

  it("clears stale status after a successful cancel", async () => {
    const cancelAgent = vi.fn().mockResolvedValue(undefined);
    const getStatus = vi.fn().mockResolvedValue({ running: false });
    const api = {
      sendMessage: vi.fn(),
      getStatus,
      cancelAgent,
      getHistory: vi.fn(),
      getSessions: vi.fn(),
    };

    const { result } = renderHook(() =>
      useChatSession({
        name: "repo",
        sessionId: null,
        setSessionId: vi.fn(),
        chat: makeChat(),
        setChat: vi.fn(),
        setPrompt: vi.fn(),
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        api,
      }),
    );

    await act(async () => {
      await result.current.handleCancel();
    });

    expect(result.current.agentState).toEqual({ status: "idle" });
  });

  it("does not restart loading when the api wrapper identity changes", async () => {
    const chat = makeChat();
    const setChat = vi.fn();
    const setSessionId = vi.fn();
    const setPrompt = vi.fn();
    const setSelectedAgent = vi.fn();
    const sendMessage = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({ running: false });
    const cancelAgent = vi.fn();
    const getHistory = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      messages: [],
    });
    const getSessions = vi.fn();

    const makeApi = () => ({
      sendMessage,
      getStatus,
      cancelAgent,
      getHistory,
      getSessions,
    });

    const { rerender } = renderHook(
      ({ api }) =>
        useChatSession({
          name: "repo",
          sessionId: "session-1",
          setSessionId,
          chat,
          setChat,
          setPrompt,
          setSelectedAgent,
          normalizedSelectedAgent: "default",
          defaultAgentValue: "default",
          api,
        }),
      { initialProps: { api: makeApi() } },
    );

    await waitFor(() => expect(getHistory).toHaveBeenCalledTimes(1));

    rerender({ api: makeApi() });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getHistory).toHaveBeenCalledTimes(1);
    // Fix #686: getStatus is now always called once from onHistoryLoaded to probe
    // the authoritative backend state, regardless of history.processing.
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});
