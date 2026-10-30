import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ChatMessage } from "../types/chat";
import { mapHistoryToMessages, mergeChatMessages } from "../utils/chat";
import { reconcileChatSnapshot, type PendingUser } from "../utils/chatSnapshot";
import type { AgentReply, ChatHistoryResponse, ChatSession } from "./useApi";
import { HttpError } from "./useApi";
import { useAgentPolling } from "./useAgentPolling";
import {
  useSessionLoader,
  historyErrorMessage,
  type GetHistoryFn,
} from "./useSessionLoader";

type AgentStatusResponse = {
  running: boolean;
};

type AgentState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "error"; message: string };

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
  agentState: AgentState;
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
  invalidatePendingRequests: () => void;
  isCancelingAgent: boolean;
  isRefreshing: boolean;
  historyReduced: boolean;
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
  const {
    sendMessage,
    getStatus,
    cancelAgent,
    getHistory: getHistoryApi,
    getSessions,
  } = api;
  const [agentState, setAgentState] = useState<AgentState>({ status: "idle" });
  // Stable setters that return the previous state reference when logically unchanged,
  // preventing spurious re-renders when consumers pass new inline api object literals.
  const setIdle = useCallback(
    () =>
      setAgentState((prev) =>
        prev.status === "idle" ? prev : { status: "idle" },
      ),
    [],
  );
  const setProcessing = useCallback(
    () =>
      setAgentState((prev) =>
        prev.status === "processing" ? prev : { status: "processing" },
      ),
    [],
  );
  const setError = useCallback(
    (message: string) =>
      setAgentState((prev) =>
        prev.status === "error" && prev.message === message
          ? prev
          : { status: "error", message },
      ),
    [],
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [historyReduced, setHistoryReduced] = useState(false);
  const isRefreshingRef = useRef(false);
  const setRefreshing = useCallback((value: boolean) => {
    isRefreshingRef.current = value;
    setIsRefreshing(value);
  }, []);
  const [isCancelingAgent, setIsCancelingAgent] = useState(false);
  const isCancelingAgentRef = useRef(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<ChatSession[]>([]);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [clearSessionModalOpen, setClearSessionModalOpen] = useState(false);
  const sendRequestIdRef = useRef(0);
  const historyRequestGenerationRef = useRef(0);
  const pendingUsersRef = useRef<PendingUser[]>([]);
  const persistedUsersRef = useRef<string[] | null>(null);
  const ownSessionRef = useRef<string | null>(null);
  const identityRef = useRef({ name, sessionId });
  const statusGenerationRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef(sessionId);

  useLayoutEffect(() => {
    const previous = identityRef.current;
    if (previous.name !== name || previous.sessionId !== sessionId) {
      const ownTransition =
        previous.name === name && ownSessionRef.current === sessionId;
      if (!ownTransition) {
        sendRequestIdRef.current += 1;
        pendingUsersRef.current = [];
        persistedUsersRef.current = null;
      }
      ownSessionRef.current = null;
      historyRequestGenerationRef.current += 1;
      setHistoryReduced(false);
      statusGenerationRef.current += 1;
      refreshControllerRef.current?.abort();
      setRefreshing(false);
      identityRef.current = { name, sessionId };
    }
    sessionIdRef.current = sessionId;
  }, [name, sessionId, setRefreshing]);

  const historyIsCurrent = useCallback(
    (
      generation: number,
      channel: string,
      session: string,
      signal?: AbortSignal,
    ) =>
      !signal?.aborted &&
      identityRef.current.name === channel &&
      identityRef.current.sessionId === session &&
      generation === historyRequestGenerationRef.current,
    [],
  );

  const applyHistory = useCallback(
    (history: ChatHistoryResponse, incremental = false) => {
      setHistoryReduced(history.historyReduced === true);
      const messages = history.messages || [];
      if (history.historyMode === "snapshot") {
        const result = reconcileChatSnapshot(messages, pendingUsersRef.current);
        pendingUsersRef.current = result.pending;
        persistedUsersRef.current = messages.flatMap((entry) =>
          entry.role === "user" && entry.messageId ? [entry.messageId] : [],
        );
        setChat(result.messages);
        return;
      }
      pendingUsersRef.current = [];
      const mapped = mapHistoryToMessages(messages);
      if (incremental) {
        if (mapped.length)
          setChat((previous) => mergeChatMessages(previous, mapped));
        return;
      }
      setChat(mapped);
    },
    [setChat],
  );

  const lastKnownTimestamp = useMemo(() => {
    if (!chat.length) return undefined;
    const parsed = Date.parse(chat[chat.length - 1].timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [chat]);
  const lastKnownTimestampRef = useRef<number | undefined>(lastKnownTimestamp);
  lastKnownTimestampRef.current = lastKnownTimestamp;

  const refreshAgentStatus = useCallback(
    async (targetSessionId = sessionIdRef.current): Promise<boolean | null> => {
      if (!name || isExternal) return false;
      if (!targetSessionId) {
        // No session yet — don't kill the spinner; caller will set sessionId soon.
        return null; // null = keep polling
      }

      try {
        const generation = ++statusGenerationRef.current;
        const historyGeneration = historyRequestGenerationRef.current;
        const sendGeneration = sendRequestIdRef.current;
        const status = await getStatus(name, targetSessionId);
        if (
          !historyIsCurrent(historyGeneration, name, targetSessionId) ||
          generation !== statusGenerationRef.current ||
          sendGeneration !== sendRequestIdRef.current
        )
          return null;
        if (status.running) setProcessing();
        else setIdle();
        return status.running;
      } catch (error) {
        console.error("Failed to load agent status", error);
        return null;
      }
    },
    [getStatus, historyIsCurrent, isExternal, name, setIdle, setProcessing],
  );

  const getHistory: GetHistoryFn = useCallback(
    (agentName: string, agentSessionId: string, signal?: AbortSignal) =>
      getHistoryApi(agentName, agentSessionId, undefined, signal),
    [getHistoryApi],
  );

  const {
    sessionLoading,
    sessionError,
    setSessionError: setSessionHistoryError,
    clearSessionError: clearSessionHistoryError,
    finishHistoryLoad,
  } = useSessionLoader({
    name: isExternal ? undefined : name,
    sessionId,
    setChat,
    getHistory,
    requestGenerationRef: historyRequestGenerationRef,
    applyHistory,
    onHistoryLoaded: () => {
      setIdle();
      // Always probe backend for authoritative status on initial load (#686).
      // Do not trust history.processing alone — it may be stale.
      void refreshAgentStatus();
    },
  });

  const syncChatHistory = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      if (!name || isExternal || !sessionId) return;
      const generation = ++historyRequestGenerationRef.current;
      finishHistoryLoad();
      const startTimestamp = lastKnownTimestampRef.current
        ? lastKnownTimestampRef.current + 1
        : undefined;

      try {
        const history = await getHistoryApi(
          name,
          sessionId,
          startTimestamp,
          signal,
        );
        if (!historyIsCurrent(generation, name, sessionId, signal)) return;
        clearSessionHistoryError();
        finishHistoryLoad();
        applyHistory(history, true);
      } catch (error) {
        if (!historyIsCurrent(generation, name, sessionId, signal)) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("Failed to sync chat history", error);
        setSessionHistoryError(historyErrorMessage(error));
        finishHistoryLoad();
      }
    },
    [
      clearSessionHistoryError,
      applyHistory,
      finishHistoryLoad,
      getHistoryApi,
      historyIsCurrent,
      isExternal,
      name,
      sessionId,
      setChat,
      setSessionHistoryError,
    ],
  );

  const isProcessing = agentState.status === "processing";

  useAgentPolling({
    isProcessing,
    syncHistory: syncChatHistory,
    checkStatus: refreshAgentStatus,
  });

  // Idle watchdog: probe every 10 s when not already polling.
  // Detects externally-started CLI agents without relying on a user action.
  useEffect(() => {
    if (!name || isExternal || !sessionId || isProcessing) return;

    let active = true;
    let timeoutId: number | undefined;
    const probe = async () => {
      if (!active) return;
      const running = await refreshAgentStatus();
      if (active && !running) {
        timeoutId = window.setTimeout(probe, 10_000);
      }
    };
    timeoutId = window.setTimeout(probe, 10_000);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [isProcessing, isExternal, name, refreshAgentStatus, sessionId]);

  const reloadCurrentSession = useCallback(async () => {
    if (!name || !sessionId || isExternal || isRefreshingRef.current) return;

    const sessionIdAtCall = sessionId;
    const generation = ++historyRequestGenerationRef.current;
    finishHistoryLoad();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    isRefreshingRef.current = true;
    setRefreshing(true);

    try {
      const history = await getHistoryApi(
        name,
        sessionIdAtCall,
        undefined,
        controller.signal,
      );
      if (
        !historyIsCurrent(generation, name, sessionIdAtCall, controller.signal)
      )
        return;
      clearSessionHistoryError();
      finishHistoryLoad();
      applyHistory(history);
      setIdle();
      // Always probe backend for authoritative status on manual refresh (#686).
      await refreshAgentStatus(sessionIdAtCall);
    } catch (error) {
      if (
        !historyIsCurrent(generation, name, sessionIdAtCall, controller.signal)
      )
        return;
      console.error("Failed to load session history", error);
      setSessionHistoryError(historyErrorMessage(error));
      finishHistoryLoad();
    } finally {
      if (refreshControllerRef.current === controller) setRefreshing(false);
    }
  }, [
    clearSessionHistoryError,
    applyHistory,
    finishHistoryLoad,
    getHistoryApi,
    historyIsCurrent,
    isExternal,
    name,
    refreshAgentStatus,
    sessionId,
    setChat,
    setSessionHistoryError,
    setIdle,
    setRefreshing,
  ]);

  const handleSendMessage = useCallback(
    async (message: string, options?: { clearPrompt?: boolean }) => {
      if (!name || isExternal) return;
      const trimmed = message.trim();
      if (!trimmed) return;

      const sendRequestId = ++sendRequestIdRef.current;
      const timestamp = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: `${timestamp}-user-${sendRequestId}`,
        role: "user",
        text: trimmed,
        timestamp,
      };

      setChat((previousChat) => [...previousChat, userMessage]);
      if (options?.clearPrompt) {
        setPrompt("");
      }
      setProcessing();

      try {
        const promptWithPolicy = appendPolicy
          ? appendPolicy(userMessage.text, name)
          : userMessage.text;
        const pendingUser: PendingUser = {
          message: userMessage,
          submitted: promptWithPolicy,
          baseline: !sessionId
            ? []
            : (persistedUsersRef.current?.slice() ?? null),
        };
        pendingUsersRef.current.push(pendingUser);
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
        const reply = await sendMessage(
          name,
          promptWithPolicy,
          sessionId || undefined,
          model,
          agent,
        );

        if (sendRequestIdRef.current !== sendRequestId) return;
        pendingUser.replyId = reply.messageId;
        if (reply.sessionId) {
          ownSessionRef.current = reply.sessionId;
          setSessionId(reply.sessionId);
        }
        setIdle();
        onActivateAgentTab?.();
        await syncChatHistory(new AbortController().signal);
        if (sendRequestIdRef.current !== sendRequestId) return;
        // Fix #687: never clear the optimistic `true` from a potentially stale
        // reply.processing value. If the reply says running, trust it; otherwise
        // let refreshAgentStatus() confirm the real state so we don't prematurely
        // clear the spinner before the polling loop has had a chance to confirm.
        if (reply.processing === true) {
          setProcessing();
        } else {
          await refreshAgentStatus(reply.sessionId ?? sessionId ?? undefined);
        }
      } catch (error) {
        pendingUsersRef.current = pendingUsersRef.current.filter(
          (entry) => entry.message.id !== userMessage.id,
        );
        if (sendRequestIdRef.current !== sendRequestId) return;
        console.error("Failed to contact agent", error);
        const busy = error instanceof HttpError && error.status === 409;
        setError(
          busy
            ? "Agent is still processing the previous message."
            : "Agent unavailable",
        );
        await refreshAgentStatus();
      }
    },
    [
      appendPolicy,
      defaultAgentValue,
      defaultModelValue,
      isExternal,
      name,
      normalizedSelectedAgent,
      normalizedSelectedModel,
      onActivateAgentTab,
      refreshAgentStatus,
      sendMessage,
      setError,
      setIdle,
      setProcessing,
      setPrompt,
      sessionId,
      setChat,
      setSessionId,
      syncChatHistory,
    ],
  );

  const handleCancel = useCallback(async () => {
    if (!name || isExternal || isCancelingAgentRef.current) return;

    isCancelingAgentRef.current = true;
    const cancellation = ++sendRequestIdRef.current;
    pendingUsersRef.current = [];
    historyRequestGenerationRef.current += 1;
    setIsCancelingAgent(true);
    try {
      await cancelAgent(name, sessionId || undefined);
      if (
        sendRequestIdRef.current === cancellation &&
        identityRef.current.name === name &&
        !sessionIdRef.current
      )
        setIdle();
    } catch (error) {
      if (
        sendRequestIdRef.current !== cancellation ||
        identityRef.current.name !== name ||
        sessionIdRef.current !== sessionId
      )
        return;
      console.error("Failed to cancel agent request", error);
      setError("Unable to cancel the agent request.");
    } finally {
      if (sendRequestIdRef.current === cancellation) await refreshAgentStatus();
      isCancelingAgentRef.current = false;
      setIsCancelingAgent(false);
    }
  }, [
    cancelAgent,
    isExternal,
    name,
    refreshAgentStatus,
    sessionId,
    setError,
    setIdle,
  ]);

  const openSessionModal = useCallback(async () => {
    if (!name || isExternal) return;

    setSessionModalOpen(true);
    setSessionListLoading(true);
    try {
      const response = await getSessions(name, 10);
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
  }, [getSessions, isExternal, name]);

  const closeSessionModal = useCallback(() => {
    setSessionModalOpen(false);
  }, []);

  const invalidatePendingRequests = useCallback(() => {
    sendRequestIdRef.current += 1;
    pendingUsersRef.current = [];
    historyRequestGenerationRef.current += 1;
    refreshControllerRef.current?.abort();
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
      pendingUsersRef.current = [];
      setSessionModalOpen(false);
      setIdle();
      lastKnownTimestampRef.current = undefined;
      setChat([]);
      setSessionId(session.id);
    },
    [
      isExternal,
      name,
      reloadCurrentSession,
      sessionId,
      setChat,
      setIdle,
      setSessionId,
    ],
  );

  const openClearSessionModal = useCallback(() => {
    setClearSessionModalOpen(true);
  }, []);

  const closeClearSessionModal = useCallback(() => {
    setClearSessionModalOpen(false);
  }, []);

  const handleClearSessionOnly = useCallback(() => {
    sendRequestIdRef.current += 1;
    pendingUsersRef.current = [];
    lastKnownTimestampRef.current = undefined;
    setSessionId(null);
    setIdle();
    setSelectedAgent(defaultAgentValue);
    onClearSessionOnly?.();
    setClearSessionModalOpen(false);
  }, [
    defaultAgentValue,
    onClearSessionOnly,
    setIdle,
    setSelectedAgent,
    setSessionId,
  ]);

  const handleClearSessionAndHistory = useCallback(() => {
    sendRequestIdRef.current += 1;
    pendingUsersRef.current = [];
    lastKnownTimestampRef.current = undefined;
    setSessionId(null);
    setIdle();
    setSelectedAgent(defaultAgentValue);
    setChat([]);
    onClearSessionAndHistory?.();
    setClearSessionModalOpen(false);
  }, [
    defaultAgentValue,
    onClearSessionAndHistory,
    setChat,
    setIdle,
    setSelectedAgent,
    setSessionId,
  ]);

  return {
    agentState,
    clearSessionModalOpen,
    closeClearSessionModal,
    closeSessionModal,
    handleCancel,
    handleClearSessionAndHistory,
    handleClearSessionOnly,
    handleSendMessage,
    handleSessionSelect,
    invalidatePendingRequests,
    isCancelingAgent,
    isRefreshing,
    historyReduced,
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
