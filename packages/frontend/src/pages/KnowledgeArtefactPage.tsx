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
import { TrashIcon } from "../components/icons/TrashIcon";
import {
  AgentSelector,
  DEFAULT_AGENT_VALUE,
} from "../components/AgentSelector";
import { commandPathsFromDefinitions } from "../utils/pathMentions";
import {
  getExternalMatter,
  isExternalMatterId,
  removeExternalMatterLink,
  saveExternalMatter,
} from "../utils/externalLinks";
import {
  getChatBootstrapParams,
  hasConsumedChatBootstrap,
  markChatBootstrapConsumed,
  stripChatBootstrapParams,
} from "../utils/chatQueryParams";

export const KnowledgeArtefactPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("content");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState("");
  const chatStorageKey = useMemo(
    () => (name ? `knowledge-chat-${name}` : "knowledge-chat"),
    [name],
  );
  const agentCli = useAgentCli();
  const sessionStorageKey = useMemo(
    () =>
      name
        ? `knowledge-session-${name}-${agentCli}`
        : `knowledge-session-${agentCli}`,
    [agentCli, name],
  );
  const savedSessionStorageKey = useMemo(
    () =>
      name
        ? `knowledge-saved-sessions-${name}-${agentCli}`
        : `knowledge-saved-sessions-${agentCli}`,
    [agentCli, name],
  );
  const harnessHistoryStorageKey = useMemo(
    () =>
      name ? `knowledge-harness-history-${name}` : "knowledge-harness-history",
    [name],
  );
  const agentStorageKey = useMemo(
    () => (name ? `knowledge-agent-${name}` : "knowledge-agent"),
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
    () => (name ? `knowledge-session-${name}` : "knowledge-session"),
    [name],
  );
  const oldSavedSessionKey = useMemo(
    () =>
      name ? `knowledge-saved-sessions-${name}` : "knowledge-saved-sessions",
    [name],
  );
  useEffect(() => {
    if (!agentCli || !sessionStorageKey || !savedSessionStorageKey) return;
    try {
      const oldSession = localStorage.getItem(oldSessionKey);
      if (oldSession && !localStorage.getItem(sessionStorageKey)) {
        localStorage.setItem(sessionStorageKey, oldSession);
        localStorage.removeItem(oldSessionKey);
      }
      const oldSaved = localStorage.getItem(oldSavedSessionKey);
      if (oldSaved && !localStorage.getItem(savedSessionStorageKey)) {
        localStorage.setItem(savedSessionStorageKey, oldSaved);
        localStorage.removeItem(oldSavedSessionKey);
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
  const [externalPath, setExternalPath] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const chatWindowRef = useRef<ChatWindowHandle>(null);
  const sendRequestIdRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  const chatRef = useRef(chat);
  const chatInputId = "knowledge-agent-prompt";
  const chatMarkdownOptions = useMemo(
    () => ({
      repositoryName: name || undefined,
      currentFilePath: name || undefined,
    }),
    [name],
  );
  const isExternal = Boolean(name && isExternalMatterId(name));
  const linkedExternalMatter = useMemo(
    () => (isExternal && name ? getExternalMatter("knowledge", name) : null),
    [isExternal, name],
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

  const getKnowledgeHistory = useCallback(
    (n: string, sid: string, signal?: AbortSignal) =>
      api.getKnowledgeAgentHistory(n, sid, undefined, signal),
    [],
  );
  const { sessionLoading, sessionError } = useSessionLoader({
    name: isExternal ? undefined : name,
    sessionId,
    setChat,
    getHistory: getKnowledgeHistory,
    onHistoryLoaded: (history) => {
      if (history.processing !== undefined) {
        setChatAgentProcessing(history.processing);
      }
      setAgentStatus(null);
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
      navigate("/knowledge");
      return;
    }
    if (isExternal) {
      if (!linkedExternalMatter) {
        setStatus("Linked external artefact not found");
        return;
      }
      setExternalPath(linkedExternalMatter.path);
      api
        .readExternalMatter(linkedExternalMatter.path)
        .then((data) => {
          setFrontmatter(data.frontmatter ?? {});
          setContent(data.content ?? "");
          setStatus(null);
        })
        .catch((error) => {
          console.error("Failed to load external artefact", error);
          setStatus("Failed to load linked external artefact file");
        });
      return;
    }
    api
      .getKnowledge(name)
      .then((data) => {
        setFrontmatter(data.frontmatter ?? data.data ?? {});
        setContent(data.content ?? "");
      })
      .catch((error) => {
        console.error("Failed to load artefact", error);
        setStatus("Failed to load artefact");
      });
  }, [isExternal, linkedExternalMatter, name, navigate]);

  const syncChatHistory = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      if (!name || isExternal || !sessionId) return;
      const startTimestamp = lastKnownTimestampRef.current
        ? lastKnownTimestampRef.current + 1
        : undefined;
      try {
        const history = await api.getKnowledgeAgentHistory(
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
    [isExternal, name, sessionId, setChat],
  );

  const refreshAgentStatus = useCallback(async () => {
    if (!name || isExternal) return false;
    if (!sessionId) {
      setChatAgentProcessing(false);
      return false;
    }
    try {
      const status = await api.getKnowledgeAgentStatus(
        name,
        sessionId || undefined,
      );
      if (sessionIdRef.current !== sessionId) return false;
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
  }, [isExternal, name, sessionId]);

  useAgentPolling({
    isProcessing: chatAgentProcessing,
    syncHistory: syncChatHistory,
    checkStatus: refreshAgentStatus,
  });

  const openSessionModal = useCallback(async () => {
    if (!name || isExternal) return;
    setSessionModalOpen(true);
    setSessionListLoading(true);
    try {
      const response = await api.getKnowledgeAgentSessions(name, 10);
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
  }, [isExternal, name]);

  const handleSave = async () => {
    if (!name) return;
    try {
      if (isExternal) {
        if (!externalPath) {
          setStatus("Missing external artefact path");
          return;
        }
        await api.writeExternalMatter({
          path: externalPath,
          content,
          frontmatter,
        });
        saveExternalMatter("knowledge", name, content, frontmatter);
        setStatus("Saved successfully");
        return;
      }
      await api.saveKnowledge(name, { content, frontmatter });
      setStatus("Saved successfully");
    } catch (error) {
      console.error("Failed to save artefact", error);
      setStatus("Save failed");
    }
  };

  const handleRemoveLink = useCallback(() => {
    if (!name || !isExternal) return;
    const confirmed = window.confirm(
      "Remove this external knowledge link from MADE?",
    );
    if (!confirmed) return;
    removeExternalMatterLink("knowledge", name);
    navigate("/knowledge");
  }, [isExternal, name, navigate]);

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
        const reply = await api.sendKnowledgeAgent(
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

        // Keep chatAgentProcessing=true if still processing; polling loop handles the rest
        if (!reply.processing) setChatAgentProcessing(false);
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
    if (!name || isExternal) return;
    try {
      await api.cancelKnowledgeAgent(name, sessionId || undefined);
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
    if (!name || !sessionId || isRefreshingRef.current || isExternal) return;
    const sessionIdAtCall = sessionId;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    const chatBeforeRefresh = chatRef.current;
    setChat([]);
    try {
      const history = await api.getKnowledgeAgentHistory(name, sessionIdAtCall);
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
  }, [
    name,
    sessionId,
    isExternal,
    setChat,
    setAgentStatus,
    setChatAgentProcessing,
  ]);

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

  const tags = Array.isArray(frontmatter.tags)
    ? (frontmatter.tags as string[]).join(", ")
    : "";

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

  const tabs = [
    {
      id: "content",
      label: "Content",
      content: (
        <div className="artefact-grid">
          <Panel
            title="Metadata"
            actions={
              <div className="panel-action-buttons">
                <button className="primary" onClick={handleSave}>
                  Save
                </button>
                {isExternal && (
                  <button
                    type="button"
                    className="copy-button"
                    onClick={handleRemoveLink}
                    aria-label="Remove external artefact link"
                    title="Remove external artefact link"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            }
          >
            {externalPath && <div className="path-info">{externalPath}</div>}
            <div className="form-group">
              <label htmlFor="artefact-tags">Tags</label>
              <input
                id="artefact-tags"
                value={tags}
                onChange={(event) =>
                  setFrontmatter({
                    ...frontmatter,
                    tags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div className="form-group">
              <label htmlFor="artefact-type">Type</label>
              <select
                id="artefact-type"
                value={(frontmatter.type as string) || "document"}
                onChange={(event) =>
                  setFrontmatter({
                    ...frontmatter,
                    type: event.target.value,
                  })
                }
              >
                <option value="document">Document</option>
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
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
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
            emptyMessage="Start a conversation to collaborate with agents."
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
            placeholder="Ask the agent about this artefact..."
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
  ];
  const visibleTabs = isExternal
    ? tabs.filter((tab) => tab.id !== "agent" && tab.id !== "commands")
    : tabs;

  return (
    <div className="page">
      <h1>
        Artefact: {isExternal ? (linkedExternalMatter?.name ?? name) : name}
      </h1>
      {status && (
        <div
          className={`alert ${
            status.includes("successfully")
              ? "success"
              : status.includes("failed") || status.includes("Failed")
                ? "error"
                : ""
          }`}
        >
          {status}
        </div>
      )}
      <TabView
        tabs={visibleTabs}
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
export default KnowledgeArtefactPage;
