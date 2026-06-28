import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { renderMarkdown } from "../utils/markdown";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { ChatWindow, type ChatWindowHandle } from "../components/ChatWindow";
import { MentionPathTextarea } from "../components/MentionPathTextarea";
import { HarnessesTab } from "../components/HarnessesTab";
const CommandsTab = React.lazy(() => import("../components/CommandsTab"));
import { usePersistentChat } from "../hooks/usePersistentChat";
import { usePersistentString } from "../hooks/usePersistentString";
import { usePersistentStringList } from "../hooks/usePersistentStringList";
import { useAgentCli } from "../hooks/useAgentCli";
import { api, ChatSession } from "../hooks/useApi";
import { ChatMessage } from "../types/chat";
import "../styles/page.css";
import {
  formatChatMessageLabel,
  formatChatMessageTimestamp,
  mapHistoryToMessages,
  mergeChatMessages,
} from "../utils/chat";
import { useSessionLoader } from "../hooks/useSessionLoader";
import { useAgentPolling } from "../hooks/useAgentPolling";
import { appendRestrictedAccessPolicy } from "../utils/agentPrompt";
import { ClearSessionModal } from "../components/ClearSessionModal";
const SessionPickerModal = React.lazy(
  () => import("../components/SessionPickerModal"),
);
import { ArrowDownIcon } from "../components/icons/ArrowDownIcon";
import { DatabaseIcon } from "../components/icons/DatabaseIcon";
import { RefreshIcon } from "../components/icons/RefreshIcon";
import {
  AgentSelector,
  DEFAULT_AGENT_VALUE,
} from "../components/AgentSelector";
import { commandPathsFromDefinitions } from "../utils/pathMentions";
import {
  getChatBootstrapParams,
  hasConsumedChatBootstrap,
  markChatBootstrapConsumed,
  stripChatBootstrapParams,
} from "../utils/chatQueryParams";

export const TaskPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("content");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState("");
  const chatStorageKey = useMemo(
    () => (name ? `task-chat-${name}` : "task-chat"),
    [name],
  );
  const agentCli = useAgentCli();
  const sessionStorageKey = useMemo(
    () =>
      name ? `task-session-${name}-${agentCli}` : `task-session-${agentCli}`,
    [agentCli, name],
  );
  const savedSessionStorageKey = useMemo(
    () =>
      name
        ? `task-saved-sessions-${name}-${agentCli}`
        : `task-saved-sessions-${agentCli}`,
    [agentCli, name],
  );
  const harnessHistoryStorageKey = useMemo(
    () => (name ? `task-harness-history-${name}` : "task-harness-history"),
    [name],
  );
  const agentStorageKey = useMemo(
    () => (name ? `task-agent-${name}` : "task-agent"),
    [name],
  );
  const [chat, setChat] = usePersistentChat(chatStorageKey);
  const [sessionId, setSessionId] = usePersistentString(
    sessionStorageKey,
    null,
    name,
  );
  const [savedSessionIds, setSavedSessionIds] = usePersistentStringList(
    savedSessionStorageKey,
  );
  // One-time migration: move old un-namespaced keys to new agentCli-namespaced keys.
  const oldSessionKey = useMemo(
    () => (name ? `task-session-${name}` : "task-session"),
    [name],
  );
  const oldSavedSessionKey = useMemo(
    () => (name ? `task-saved-sessions-${name}` : "task-saved-sessions"),
    [name],
  );
  useEffect(() => {
    if (!agentCli || !sessionStorageKey || !savedSessionStorageKey) return;
    try {
      const oldSession = localStorage.getItem(oldSessionKey);
      if (oldSession && !localStorage.getItem(sessionStorageKey)) {
        localStorage.setItem(sessionStorageKey, oldSession);
        localStorage.removeItem(oldSessionKey);
        setSessionId(oldSession);
      }
      const oldSaved = localStorage.getItem(oldSavedSessionKey);
      if (oldSaved && !localStorage.getItem(savedSessionStorageKey)) {
        localStorage.setItem(savedSessionStorageKey, oldSaved);
        localStorage.removeItem(oldSavedSessionKey);
        try {
          const parsed = JSON.parse(oldSaved);
          if (Array.isArray(parsed)) {
            setSavedSessionIds(
              parsed.filter(
                (entry): entry is string => typeof entry === "string",
              ),
            );
          }
        } catch {
          // ignore parse error — localStorage data already written for next load
        }
      }
    } catch {
      // localStorage unavailable
    }
  }, [
    agentCli,
    sessionStorageKey,
    savedSessionStorageKey,
    oldSessionKey,
    oldSavedSessionKey,
  ]);
  const [selectedAgent, setSelectedAgent] = usePersistentString(
    agentStorageKey,
    DEFAULT_AGENT_VALUE,
    name,
  );
  const normalizedSelectedAgent = selectedAgent ?? DEFAULT_AGENT_VALUE;
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [chatAgentProcessing, setChatAgentProcessing] = useState(false);
  const [clearSessionModalOpen, setClearSessionModalOpen] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<ChatSession[]>([]);
  const savedSessionTitles = useMemo(
    () =>
      sessionOptions.reduce<Record<string, string>>((titles, session) => {
        titles[session.id] = session.title;
        return titles;
      }, {}),
    [sessionOptions],
  );
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [mentionCommandPaths, setMentionCommandPaths] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const chatWindowRef = useRef<ChatWindowHandle>(null);
  const sendRequestIdRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  const chatRef = useRef(chat);
  const chatInputId = "task-agent-prompt";
  const chatMarkdownOptions = useMemo(
    () => ({
      repositoryName: name || undefined,
      currentFilePath: name || undefined,
    }),
    [name],
  );

  sessionIdRef.current = sessionId;
  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  const lastKnownTimestamp = useMemo(() => {
    if (!chat.length) return undefined;
    const parsed = Date.parse(chat[chat.length - 1].timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [chat]);
  const lastKnownTimestampRef = useRef<number | undefined>(lastKnownTimestamp);
  useEffect(() => {
    lastKnownTimestampRef.current = lastKnownTimestamp;
  }, [lastKnownTimestamp]);

  const getTaskHistory = useCallback(
    (n: string, sid: string, signal?: AbortSignal) =>
      api.getTaskAgentHistory(n, sid, undefined, signal),
    [],
  );
  const { sessionLoading, sessionError } = useSessionLoader({
    name,
    sessionId,
    setChat,
    getHistory: getTaskHistory,
    onHistoryLoaded: (history) => {
      if (history.processing !== undefined) {
        setChatAgentProcessing(history.processing);
      }
      setAgentStatus(null);
      void refreshAgentStatus();
    },
  });

  const scrollToBottom = useCallback(() => {
    chatWindowRef.current?.scrollToBottom();
  }, []);

  useEffect(() => {
    if (!name) return;
    const { sessionId: incomingSessionId, message: incomingMessage } =
      getChatBootstrapParams(searchParams);
    if (!incomingSessionId && !incomingMessage) return;

    const { nextParams, changed } = stripChatBootstrapParams(searchParams);
    if (changed) {
      setSearchParams(nextParams, { replace: true });
    }

    const switchSessionIfNeeded = () => {
      if (!incomingSessionId || incomingSessionId === sessionId) return;
      setSessionId(incomingSessionId);
      // useSessionLoader effect handles setChat([]) + loading
    };
    switchSessionIfNeeded();

    if (
      hasConsumedChatBootstrap(
        location.pathname,
        incomingSessionId,
        incomingMessage,
      )
    ) {
      return;
    }
    markChatBootstrapConsumed(
      location.pathname,
      incomingSessionId,
      incomingMessage,
    );
    if (incomingMessage) {
      setPrompt(incomingMessage);
    }
    setActiveTab("agent");

    requestAnimationFrame(() => {
      const textarea = document.getElementById(
        chatInputId,
      ) as HTMLTextAreaElement | null;
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [
    location.pathname,
    name,
    searchParams,
    sessionId,
    setSearchParams,
    setSessionId,
  ]);

  const copyAllMessages = useCallback(() => {
    if (!navigator.clipboard || !chat.length) return;

    const content = chat
      .map((message) => {
        const label = formatChatMessageLabel(message);
        const timestamp = formatChatMessageTimestamp(message);
        const messageText = message.text || "";
        const header = `${label} ${timestamp}`.trim();
        return messageText ? `${header} ${messageText}` : header;
      })
      .join("\n\n")
      .trim();

    navigator.clipboard.writeText(content).catch((error) => {
      console.error("Failed to copy chat history", error);
    });
  }, [chat]);

  useEffect(() => {
    if (!name) {
      navigate("/tasks");
      return;
    }
    api
      .getTask(name)
      .then((data) => {
        setFrontmatter(data.frontmatter ?? data.data ?? {});
        setContent(data.content ?? "");
      })
      .catch((error) => {
        console.error("Failed to load task", error);
        setStatus("Failed to load task");
      });
  }, [name, navigate]);

  const syncChatHistory = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      if (!name || !sessionId) return;
      const startTimestamp = lastKnownTimestampRef.current
        ? lastKnownTimestampRef.current + 1
        : undefined;
      try {
        const history = await api.getTaskAgentHistory(
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
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        console.error("Failed to sync chat history", error);
      }
    },
    [name, sessionId, setChat],
  );

  const refreshAgentStatus = useCallback(
    async (targetSessionId = sessionId) => {
      if (!name) return false;
      if (!targetSessionId) {
        setChatAgentProcessing(false);
        return false;
      }
      try {
        const status = await api.getTaskAgentStatus(name, targetSessionId);
        if (sessionIdRef.current !== targetSessionId) return false;
        setChatAgentProcessing(status.processing);
        setAgentStatus(
          status.processing
            ? "Agent is still processing the previous message."
            : null,
        );
        return status.processing;
      } catch (error) {
        console.error("Failed to load agent status", error);
        return null; // network error — caller should not stop polling
      }
    },
    [name, sessionId],
  );

  useAgentPolling({
    isProcessing: chatAgentProcessing,
    syncHistory: syncChatHistory,
    checkStatus: refreshAgentStatus,
  });

  const openSessionModal = useCallback(async () => {
    if (!name) return;
    setSessionModalOpen(true);
    setSessionListLoading(true);
    try {
      const response = await api.getTaskAgentSessions(name, 10);
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
  }, [name]);

  const handleSave = async () => {
    if (!name) return;
    try {
      await api.saveTask(name, { content, frontmatter });
      setStatus("Saved successfully");
    } catch (error) {
      console.error("Failed to save task", error);
      setStatus("Save failed");
    }
  };

  const handleSendMessage = useCallback(
    async (message: string, options?: { clearPrompt?: boolean }) => {
      if (!name) return;
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
      setChat((prev) => [...prev, userMessage]);
      if (options?.clearPrompt) {
        setPrompt("");
      }
      setChatAgentProcessing(true);
      try {
        const promptWithPolicy = appendRestrictedAccessPolicy(
          userMessage.text,
          name,
        );
        const agent =
          normalizedSelectedAgent === DEFAULT_AGENT_VALUE
            ? undefined
            : normalizedSelectedAgent.trim();
        const reply = await api.sendTaskAgent(
          name,
          promptWithPolicy,
          sessionId || undefined,
          undefined,
          agent,
        );

        // No immediate message processing - polling handles everything
        if (sendRequestIdRef.current !== sendRequestId) return;
        if (reply.sessionId) {
          setSessionId(reply.sessionId);
        }
        setActiveTab("agent");
        setAgentStatus(null);

        await refreshAgentStatus(reply.sessionId ?? sessionId);
      } catch (error) {
        console.error("Failed to contact agent", error);
        const errorMessage = error instanceof Error ? error.message : "";
        const busy = errorMessage.toLowerCase().includes("processing");
        setAgentStatus(
          busy
            ? "Agent is still processing the previous message."
            : "Agent unavailable",
        );
        const processing = await refreshAgentStatus();
        if (!processing) {
          setChatAgentProcessing(false);
        }
      }
    },
    [
      name,
      refreshAgentStatus,
      normalizedSelectedAgent,
      sessionId,
      setActiveTab,
      setAgentStatus,
      setChat,
      setChatAgentProcessing,
      setPrompt,
      setSessionId,
    ],
  );

  const handleSend = async () => {
    if (!prompt.trim()) return;
    await handleSendMessage(prompt, { clearPrompt: true });
  };

  const handleCancel = async () => {
    if (!name) return;
    try {
      await api.cancelTaskAgent(name, sessionId || undefined);
    } catch (error) {
      console.error("Failed to cancel agent request", error);
      setAgentStatus("Unable to cancel the agent request.");
    } finally {
      await refreshAgentStatus();
    }
  };

  const handleCancelClearSession = () => {
    setClearSessionModalOpen(false);
  };

  const handleClearSessionOnly = () => {
    sendRequestIdRef.current += 1;
    lastKnownTimestampRef.current = undefined;
    setSessionId(null);
    setChatAgentProcessing(false);
    setAgentStatus(null);
    setSelectedAgent(DEFAULT_AGENT_VALUE);
    setClearSessionModalOpen(false);
  };

  const handleClearSessionAndHistory = () => {
    sendRequestIdRef.current += 1;
    lastKnownTimestampRef.current = undefined;
    setSessionId(null);
    setChatAgentProcessing(false);
    setAgentStatus(null);
    setSelectedAgent(DEFAULT_AGENT_VALUE);
    setChat([]);
    setClearSessionModalOpen(false);
  };

  const handleSessionSelect = (session: ChatSession) => {
    if (!name) return;
    if (!session.id) {
      setSessionModalOpen(false);
      return;
    }
    if (session.id === sessionId) {
      setSessionModalOpen(false);
      reloadCurrentSession();
      return;
    }
    sendRequestIdRef.current += 1;
    setSessionModalOpen(false);
    setChatAgentProcessing(false);
    setAgentStatus(null);
    setSessionId(session.id);
  };

  const reloadCurrentSession = useCallback(async () => {
    if (!name || !sessionId || isRefreshingRef.current) return;
    const sessionIdAtCall = sessionId;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    const chatBeforeRefresh = chatRef.current;
    setChat([]);
    try {
      const history = await api.getTaskAgentHistory(name, sessionIdAtCall);
      if (sessionIdRef.current !== sessionIdAtCall) return;
      const mapped = mapHistoryToMessages(history.messages || []);
      setChat(mapped);
      setAgentStatus(null);
      if (history.processing !== undefined) {
        setChatAgentProcessing(history.processing);
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
  }, [name, sessionId, setChat, setAgentStatus, setChatAgentProcessing]);

  const handleSaveSession = useCallback(() => {
    if (!sessionId) return;
    setSavedSessionIds((previous) =>
      previous.includes(sessionId) ? previous : [sessionId, ...previous],
    );
  }, [sessionId, setSavedSessionIds]);

  const handleRemoveSavedSession = useCallback(
    (savedId: string) => {
      setSavedSessionIds((previous) =>
        previous.filter((session) => session !== savedId),
      );
    },
    [setSavedSessionIds],
  );

  const loadCommands = useCallback(async () => {
    const response = await api.getCommands();
    const commands = response.commands || [];
    setMentionCommandPaths(commandPathsFromDefinitions(commands));
    return commands;
  }, []);

  const loadHarnesses = useCallback(async () => {
    const response = await api.getHarnesses();
    return response.harnesses;
  }, []);

  const runHarness = useCallback(
    async (harnessPath: string, args?: string) =>
      api.runHarness(harnessPath, args),
    [],
  );

  const getHarnessStatus = useCallback(
    async (pid: number) => api.getHarnessStatus(pid),
    [],
  );

  return (
    <div className="page">
      <h1>Task: {name}</h1>
      {status && (
        <div
          className={`alert ${
            status.includes("successfully")
              ? "success"
              : status.includes("failed") ||
                  status.includes("Failed") ||
                  status.includes("unavailable")
                ? "error"
                : ""
          }`}
        >
          {status}
        </div>
      )}
      <TabView
        tabs={[
          {
            id: "content",
            label: "Content",
            content: (
              <div className="artefact-grid">
                <Panel
                  title="Metadata"
                  actions={
                    <button className="primary" onClick={handleSave}>
                      Save
                    </button>
                  }
                >
                  <div className="form-group">
                    <label htmlFor="task-schedule">Schedule (cron)</label>
                    <input
                      id="task-schedule"
                      value={(frontmatter.schedule as string) || ""}
                      onChange={(event) =>
                        setFrontmatter({
                          ...frontmatter,
                          schedule: event.target.value,
                        })
                      }
                      placeholder="0 9 * * 1-5"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="task-type">Type</label>
                    <select
                      id="task-type"
                      value={(frontmatter.type as string) || "task"}
                      onChange={(event) =>
                        setFrontmatter({
                          ...frontmatter,
                          type: event.target.value,
                        })
                      }
                    >
                      <option value="task">Task</option>
                      <option value="template">Template</option>
                    </select>
                  </div>
                </Panel>
                <Panel title="Markdown">
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    className="editor-input"
                  />
                </Panel>
                <Panel title="Preview">
                  <div
                    className="markdown"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(content || ""),
                    }}
                  />
                </Panel>
              </div>
            ),
          },
          {
            id: "agent",
            label: "Agent",
            content: (
              <Panel
                title="Agent Conversation"
                actions={
                  <div className="panel-action-buttons">
                    <button
                      type="button"
                      className="copy-button"
                      onClick={scrollToBottom}
                      aria-label="Scroll to last message"
                      title="Scroll to last message"
                      disabled={!chat.length}
                    >
                      <ArrowDownIcon />
                    </button>
                    <button
                      type="button"
                      className={`copy-button${chat.length ? "" : " is-muted"}`}
                      onClick={openSessionModal}
                      aria-label="Choose a session"
                      title="Choose a session"
                    >
                      <DatabaseIcon />
                    </button>
                    {sessionId && (
                      <button
                        type="button"
                        className="copy-button"
                        onClick={reloadCurrentSession}
                        aria-label="Refresh current session"
                        title="Refresh current session"
                        disabled={chatAgentProcessing || isRefreshing}
                      >
                        <RefreshIcon />
                      </button>
                    )}
                    <button
                      type="button"
                      className="copy-button"
                      onClick={copyAllMessages}
                      aria-label="Copy chat messages"
                      title="Copy chat messages"
                      disabled={!chat.length}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <rect
                          x="9"
                          y="9"
                          width="13"
                          height="13"
                          rx="2"
                          ry="2"
                        />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                  </div>
                }
              >
                <ChatWindow
                  chat={chat}
                  chatWindowRef={chatWindowRef}
                  agentProcessing={chatAgentProcessing}
                  sessionLoading={sessionLoading}
                  refreshing={isRefreshing}
                  emptyMessage="Start a conversation to discuss this task."
                  sessionId={sessionId}
                  onClearSession={() => setClearSessionModalOpen(true)}
                  onSaveSession={handleSaveSession}
                  isSessionSaved={Boolean(
                    sessionId && savedSessionIds.includes(sessionId),
                  )}
                  markdownOptions={chatMarkdownOptions}
                />
                {(agentStatus || sessionError) && (
                  <div className="alert">{agentStatus ?? sessionError}</div>
                )}
                <MentionPathTextarea
                  id={chatInputId}
                  value={prompt}
                  onChange={setPrompt}
                  suggestions={mentionCommandPaths}
                  placeholder="Ask the agent to refine this task..."
                />
                <div className="button-bar chat-controls">
                  <div className="chat-controls__left">
                    <AgentSelector
                      selectId="agent-select"
                      selectedAgent={normalizedSelectedAgent}
                      onChange={setSelectedAgent}
                      disabled={chatAgentProcessing}
                    />
                  </div>
                  <div className="chat-controls__right">
                    {chatAgentProcessing ? (
                      <button className="danger" onClick={handleCancel}>
                        Cancel
                      </button>
                    ) : (
                      <button
                        className="primary"
                        onClick={handleSend}
                        disabled={!prompt.trim()}
                      >
                        Send
                      </button>
                    )}
                  </div>
                </div>
              </Panel>
            ),
          },
          {
            id: "harnesses",
            label: "Harnesses",
            content: (
              <HarnessesTab
                loadHarnesses={loadHarnesses}
                runHarness={runHarness}
                getHarnessStatus={getHarnessStatus}
                loadWorkflows={() => api.getWorkflows()}
                saveWorkflows={(workflows) => api.saveWorkflows(workflows)}
                listAgents={() => api.getAgents()}
                onGenerateHarnesses={async (workflows) => {
                  await api.generateWorkflowHarnesses(workflows);
                  await loadHarnesses();
                }}
                historyStorageKey={harnessHistoryStorageKey}
                mentionPathSuggestions={mentionCommandPaths}
              />
            ),
          },
          {
            id: "commands",
            label: "Commands",
            content: (
              <Suspense fallback={<div className="loading-spinner" />}>
                <CommandsTab
                  loadCommands={loadCommands}
                  onSendMessage={(message) => handleSendMessage(message)}
                />
              </Suspense>
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <ClearSessionModal
        open={clearSessionModalOpen}
        onCancel={handleCancelClearSession}
        onClearSessionOnly={handleClearSessionOnly}
        onClearSessionAndHistory={handleClearSessionAndHistory}
      />
      <Suspense fallback={null}>
        <SessionPickerModal
          open={sessionModalOpen}
          loading={sessionListLoading}
          error={sessionListError}
          sessions={sessionOptions}
          savedSessionIds={savedSessionIds}
          savedSessionTitles={savedSessionTitles}
          onClose={() => setSessionModalOpen(false)}
          onSelect={handleSessionSelect}
          onRemoveSavedSession={handleRemoveSavedSession}
        />
      </Suspense>
    </div>
  );
};
export default TaskPage;
