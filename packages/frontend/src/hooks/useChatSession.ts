import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage } from "../types/chat";
import { mapHistoryToMessages, mergeChatMessages } from "../utils/chat";
import type { AgentReply, ChatHistoryResponse, ChatSession } from "./useApi";
import { useAgentPolling } from "./useAgentPolling";
import { useSessionLoader, type GetHistoryFn } from "./useSessionLoader";

type AgentStatusResponse = {
  running: boolean;
};

export interface ChatSessionApi {
  sendMessage: (
    name: string,
    message: string,
    sessionId?: string,
    model?: string,
    agent?: string,
  ) => Promise<AgentReply>;
  getStatus: (name: string, sessionId?: string) => Promise<AgentStatusResponse>;
  cancelAgent: (name: string, sessionId?: string) => Promise<unknown>;
  getHistory: (
    name: string,
    sessionId: string,
    startTimestamp?: number,
    signal?: AbortSignal,
  ) => Promise<ChatHistoryResponse>;
  getSessions: (
    name: string,
    limit?: number,
  ) => Promise<{ sessions?: ChatSession[] }>;
}

export interface UseChatSessionParams {
  name: string | undefined;
  sessionId: string | null;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  chat: ChatMessage[];
  setChat: Dispatch<SetStateAction<ChatMessage[]>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setSelectedAgent: Dispatch<SetStateAction<string | null>>;
  normalizedSelectedAgent: string;
  defaultAgentValue: string;
  normalizedSelectedModel?: string;
  defaultModelValue?: string;
  appendPolicy?: (message: string, name: string) => string;
  isExternal?: boolean;
  api: ChatSessionApi;
  onActivateAgentTab?: () => void;
  onClearSessionOnly?: () => void;
  onClearSessionAndHistory?: () => void;
}

export interface UseChatSessionResult {
  agentStatus: string | null;
  chatAgentProcessing: boolean;
  clearSessionModalOpen: boolean;
  closeClearSessionModal: () => void;
  closeSessionModal: () => void;
  handleCancel: () => Promise<void>;
  handleClearSessionAndHistory: () => void;
  handleClearSessionOnly: () => void;
  handleSendMessage: (
    message: string,
    options?: { clearPrompt?: boolean },
  ) => Promise<void>;
  handleSessionSelect: (session: ChatSession) => void;
  isCancelingAgent: boolean;
  isRefreshing: boolean;
  openClearSessionModal: () => void;
  openSessionModal: () => Promise<void>;
  reloadCurrentSession: () => Promise<void>;
  sessionError: string | null;
  sessionListError: string | null;
  sessionListLoading: boolean;
  sessionLoading: boolean;
  sessionModalOpen: boolean;
  sessionOptions: ChatSession[];
}

export function useChatSession({
  name,
  sessionId,
  setSessionId,
  chat,
  setChat,
  setPrompt,
  setSelectedAgent,
  normalizedSelectedAgent,
  defaultAgentValue,
  normalizedSelectedModel,
  defaultModelValue = "default",
  appendPolicy,
  isExternal,
  api,
  onActivateAgentTab,
  onClearSessionOnly,
  onClearSessionAndHistory,
}: UseChatSessionParams): UseChatSessionResult {
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [chatAgentProcessing, setChatAgentProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const [isCancelingAgent, setIsCancelingAgent] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<ChatSession[]>([]);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [clearSessionModalOpen, setClearSessionModalOpen] = useState(false);
  const sendRequestIdRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  const chatRef = useRef(chat);

  sessionIdRef.current = sessionId;
  chatRef.current = chat;

  const lastKnownTimestamp = useMemo(() => {
    if (!chat.length) return undefined;
    const parsed = Date.parse(chat[chat.length - 1].timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [chat]);
  const lastKnownTimestampRef = useRef<number | undefined>(lastKnownTimestamp);

  useEffect(() => {
    lastKnownTimestampRef.current = lastKnownTimestamp;
  }, [lastKnownTimestamp]);

  const refreshAgentStatus = useCallback(
    async (targetSessionId = sessionId) => {
      if (!name || isExternal) return false;
      if (!targetSessionId) {
        setChatAgentProcessing(false);
        setAgentStatus(null);
        return false;
      }

      try {
        const status = await api.getStatus(name, targetSessionId);
        if (sessionIdRef.current !== targetSessionId) return false;
        setChatAgentProcessing(status.running);
        setAgentStatus(
          status.running
            ? "Agent is still processing the previous message."
            : null,
        );
        return status.running;
      } catch (error) {
        console.error("Failed to load agent status", error);
        return null;
      }
    },
    [api, isExternal, name, sessionId],
  );

  const getHistory: GetHistoryFn = useCallback(
    (agentName: string, agentSessionId: string, signal?: AbortSignal) =>
      api.getHistory(agentName, agentSessionId, undefined, signal),
    [api],
  );

  const {
    sessionLoading,
    sessionError,
    clearSessionError: clearSessionHistoryError,
  } = useSessionLoader({
    name: isExternal ? undefined : name,
    sessionId,
    setChat,
    getHistory,
    onHistoryLoaded: (history: ChatHistoryResponse) => {
      if (history.processing !== undefined) {
        setChatAgentProcessing(history.processing);
      }
      setAgentStatus(null);
      void refreshAgentStatus(history.sessionId);
    },
  });

  const syncChatHistory = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      if (!name || isExternal || !sessionId) return;
      const startTimestamp = lastKnownTimestampRef.current
        ? lastKnownTimestampRef.current + 1
        : undefined;

      try {
        const history = await api.getHistory(
          name,
          sessionId,
          startTimestamp,
          signal,
        );
        if (signal.aborted) return;
        if (!history.messages?.length) return;
        setChat((previousChat) => {
          const mapped = mapHistoryToMessages(history.messages);
          return mergeChatMessages(previousChat, mapped);
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("Failed to sync chat history", error);
      }
    },
    [api, isExternal, name, sessionId, setChat],
  );

  useAgentPolling({
    isProcessing: chatAgentProcessing,
    syncHistory: syncChatHistory,
    checkStatus: refreshAgentStatus,
  });

  const reloadCurrentSession = useCallback(async () => {
    if (!name || !sessionId || isExternal || isRefreshingRef.current) return;

    const sessionIdAtCall = sessionId;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    clearSessionHistoryError();
    const chatBeforeRefresh = chatRef.current;
    setChat([]);

    try {
      const history = await api.getHistory(name, sessionIdAtCall);
      if (sessionIdRef.current !== sessionIdAtCall) return;
      const mapped = mapHistoryToMessages(history.messages || []);
      setChat(mapped);
      setAgentStatus(null);
      if (history.processing !== undefined) {
        setChatAgentProcessing(history.processing);
      } else {
        await refreshAgentStatus(sessionIdAtCall);
      }
    } catch (error) {
      setChat(chatBeforeRefresh);
      console.error("Failed to load session history", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load session history";
      setAgentStatus(message);
    } finally {
      setIsRefreshing(false);
      isRefreshingRef.current = false;
    }
  }, [
    api,
    clearSessionHistoryError,
    isExternal,
    name,
    refreshAgentStatus,
    sessionId,
    setChat,
  ]);

  const handleSendMessage = useCallback(
    async (message: string, options?: { clearPrompt?: boolean }) => {
      if (!name || isExternal) return;
      const trimmed = message.trim();
      if (!trimmed) return;

      const sendRequestId = ++sendRequestIdRef.current;
      const timestamp = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: `${timestamp}-user`,
        role: "user",
        text: trimmed,
        timestamp,
      };

      setChat((previousChat) => [...previousChat, userMessage]);
      if (options?.clearPrompt) {
        setPrompt("");
      }
      setChatAgentProcessing(true);

      try {
        const promptWithPolicy = appendPolicy
          ? appendPolicy(userMessage.text, name)
          : userMessage.text;
        const model =
          normalizedSelectedModel &&
          normalizedSelectedModel !== defaultModelValue
            ? normalizedSelectedModel.trim()
            : undefined;
        const agent =
          normalizedSelectedAgent &&
          normalizedSelectedAgent !== defaultAgentValue
            ? normalizedSelectedAgent.trim()
            : undefined;
        const reply = await api.sendMessage(
          name,
          promptWithPolicy,
          sessionId || undefined,
          model,
          agent,
        );

        if (sendRequestIdRef.current !== sendRequestId) return;
        if (reply.sessionId) {
          setSessionId(reply.sessionId);
        }
        setAgentStatus(null);
        onActivateAgentTab?.();
        await refreshAgentStatus(reply.sessionId ?? sessionId);
      } catch (error) {
        if (sendRequestIdRef.current !== sendRequestId) return;
        console.error("Failed to contact agent", error);
        const errorMessage = error instanceof Error ? error.message : "";
        const busy = errorMessage.toLowerCase().includes("processing");
        setAgentStatus(
          busy
            ? "Agent is still processing the previous message."
            : "Agent unavailable",
        );
        const processing = await refreshAgentStatus();
        if (processing === false) {
          setChatAgentProcessing(false);
        }
      }
    },
    [
      api,
      appendPolicy,
      defaultAgentValue,
      defaultModelValue,
      isExternal,
      name,
      normalizedSelectedAgent,
      normalizedSelectedModel,
      onActivateAgentTab,
      refreshAgentStatus,
      setPrompt,
      sessionId,
      setChat,
      setSessionId,
    ],
  );

  const handleCancel = useCallback(async () => {
    if (!name || isExternal || isCancelingAgent) return;

    setIsCancelingAgent(true);
    try {
      await api.cancelAgent(name, sessionId || undefined);
    } catch (error) {
      console.error("Failed to cancel agent request", error);
      setAgentStatus("Unable to cancel the agent request.");
    } finally {
      await refreshAgentStatus();
      setIsCancelingAgent(false);
    }
  }, [api, isCancelingAgent, isExternal, name, refreshAgentStatus, sessionId]);

  const openSessionModal = useCallback(async () => {
    if (!name || isExternal) return;

    setSessionModalOpen(true);
    setSessionListLoading(true);
    try {
      const response = await api.getSessions(name, 10);
      setSessionOptions(response.sessions || []);
      setSessionListError(null);
    } catch (error) {
      console.error("Failed to load sessions", error);
      const message =
        error instanceof Error ? error.message : "Unable to load sessions";
      setSessionListError(message);
    } finally {
      setSessionListLoading(false);
    }
  }, [api, isExternal, name]);

  const closeSessionModal = useCallback(() => {
    setSessionModalOpen(false);
  }, []);

  const handleSessionSelect = useCallback(
    (session: ChatSession) => {
      if (!name || isExternal) return;
      if (!session.id) {
        setSessionModalOpen(false);
        return;
      }
      if (session.id === sessionId) {
        setSessionModalOpen(false);
        void reloadCurrentSession();
        return;
      }

      sendRequestIdRef.current += 1;
      setSessionModalOpen(false);
      setChatAgentProcessing(false);
      setAgentStatus(null);
      lastKnownTimestampRef.current = undefined;
      setSessionId(session.id);
    },
    [isExternal, name, reloadCurrentSession, sessionId, setSessionId],
  );

  const openClearSessionModal = useCallback(() => {
    setClearSessionModalOpen(true);
  }, []);

  const closeClearSessionModal = useCallback(() => {
    setClearSessionModalOpen(false);
  }, []);

  const handleClearSessionOnly = useCallback(() => {
    sendRequestIdRef.current += 1;
    lastKnownTimestampRef.current = undefined;
    setSessionId(null);
    setChatAgentProcessing(false);
    setAgentStatus(null);
    setSelectedAgent(defaultAgentValue);
    onClearSessionOnly?.();
    setClearSessionModalOpen(false);
  }, [defaultAgentValue, onClearSessionOnly, setSelectedAgent, setSessionId]);

  const handleClearSessionAndHistory = useCallback(() => {
    sendRequestIdRef.current += 1;
    lastKnownTimestampRef.current = undefined;
    setSessionId(null);
    setChatAgentProcessing(false);
    setAgentStatus(null);
    setSelectedAgent(defaultAgentValue);
    setChat([]);
    onClearSessionAndHistory?.();
    setClearSessionModalOpen(false);
  }, [
    defaultAgentValue,
    onClearSessionAndHistory,
    setChat,
    setSelectedAgent,
    setSessionId,
  ]);

  return {
    agentStatus,
    chatAgentProcessing,
    clearSessionModalOpen,
    closeClearSessionModal,
    closeSessionModal,
    handleCancel,
    handleClearSessionAndHistory,
    handleClearSessionOnly,
    handleSendMessage,
    handleSessionSelect,
    isCancelingAgent,
    isRefreshing,
    openClearSessionModal,
    openSessionModal,
    reloadCurrentSession,
    sessionError,
    sessionListError,
    sessionListLoading,
    sessionLoading,
    sessionModalOpen,
    sessionOptions,
  };
}
