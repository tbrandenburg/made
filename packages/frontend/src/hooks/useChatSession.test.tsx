import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import type { ChatMessage } from "../types/chat";

const makeChat = (): ChatMessage[] => [];

describe("useChatSession", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

    expect(result.current.chatAgentProcessing).toBe(false);
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

    expect(api.getHistory).toHaveBeenCalledWith("repo", "session-1");
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

    expect(result.current.agentStatus).toBe("Agent unavailable");
  });

  it("preserves the cancel failure status after refresh", async () => {
    const cancelAgent = vi.fn().mockRejectedValue(new Error("cancel failed"));
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

    expect(result.current.agentStatus).toBe(
      "Unable to cancel the agent request.",
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

    expect(result.current.agentStatus).toBeNull();
  });
});
