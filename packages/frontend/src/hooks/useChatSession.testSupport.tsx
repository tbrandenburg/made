import { cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { vi } from "vitest";
import { ChatWindow } from "../components/ChatWindow";
import type { ChatMessage } from "../types/chat";
import type { ChatHistoryResponse } from "./useApi";
import { useChatSession, type ChatSessionApi } from "./useChatSession";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

export const historyFor = (sessionId: string): ChatHistoryResponse => ({
  sessionId,
  messages: [
    {
      messageId: `${sessionId}-user`,
      role: "user",
      type: "text",
      content: `${sessionId} question`,
    },
    {
      messageId: `${sessionId}-assistant`,
      role: "assistant",
      type: "text",
      content: `${sessionId} answer`,
    },
  ],
});

export const snapshot = (text = "original"): ChatHistoryResponse => ({
  sessionId: "A",
  historyMode: "snapshot",
  messages: [
    {
      messageId: "u1",
      role: "user",
      type: "text",
      content: "repeat",
      timestamp: "2026-01-01T00:00:00Z",
    },
    {
      messageId: "u2",
      role: "user",
      type: "text",
      content: "repeat",
      timestamp: "2026-01-01T00:00:01Z",
    },
    {
      messageId: "a",
      role: "assistant",
      type: "text",
      content: text,
      timestamp: "2026-01-01T00:00:02Z",
    },
  ],
});

export function renderSnapshotSession(
  api: ChatSessionApi,
  initialSession: string | null = "A",
  policy = false,
) {
  return renderHook(
    ({ name }) => {
      const [sessionId, setSessionId] = useState(initialSession);
      const [chat, setChat] = useState<ChatMessage[]>([]);
      const session = useChatSession({
        name,
        sessionId,
        setSessionId,
        chat,
        setChat,
        api,
        setPrompt: vi.fn(),
        setSelectedAgent: vi.fn(),
        normalizedSelectedAgent: "default",
        defaultAgentValue: "default",
        appendPolicy: policy ? (text) => `${text}\npolicy` : undefined,
      });
      return { ...session, chat, sessionId, navigate: setSessionId };
    },
    { initialProps: { name: "repo" }, wrapper: StrictMode },
  );
}

export function snapshotApi(
  getHistory = vi.fn().mockResolvedValue(snapshot()),
) {
  return {
    getHistory,
    sendMessage: vi.fn().mockResolvedValue({
      sessionId: "A",
      messageId: "receipt",
      sent: "now",
      response: "",
    }),
    getStatus: vi.fn().mockResolvedValue({ running: false }),
    cancelAgent: vi.fn().mockResolvedValue(undefined),
    getSessions: vi.fn(),
  };
}

export function cleanupSessionTests() {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

export function SessionWindow({ api }: { api: ChatSessionApi }) {
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
  return (
    <>
      <button onClick={() => void session.reloadCurrentSession()}>
        Refresh
      </button>
      <button onClick={() => void session.handleSendMessage("follow up")}>
        Send
      </button>
      <output aria-label="Transcript">
        {chat.map((message) => message.text).join(" | ")}
      </output>
      <ChatWindow
        chat={chat}
        running={session.agentState.status === "processing"}
        refreshing={session.isRefreshing}
        sessionLoading={session.sessionLoading}
        sessionId={sessionId}
        historyError={session.sessionError}
        historyReduced={session.historyReduced}
        emptyMessage="No conversation yet."
      />
    </>
  );
}
