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
import { api } from "../hooks/useApi";
import "../styles/page.css";
import {
  formatChatMessageLabel,
  formatChatMessageTimestamp,
} from "../utils/chat";
import { useChatSession } from "../hooks/useChatSession";
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

export const ConstitutionPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("content");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState("");
  const chatStorageKey = useMemo(
    () => (name ? `constitution-chat-${name}` : "constitution-chat"),
    [name],
  );
  const agentCli = useAgentCli();
  const sessionStorageKey = useMemo(
    () =>
      name
        ? `constitution-session-${name}-${agentCli}`
        : `constitution-session-${agentCli}`,
    [agentCli, name],
  );
  const savedSessionStorageKey = useMemo(
    () =>
      name
        ? `constitution-saved-sessions-${name}-${agentCli}`
        : `constitution-saved-sessions-${agentCli}`,
    [agentCli, name],
  );
  const harnessHistoryStorageKey = useMemo(
    () =>
      name
        ? `constitution-harness-history-${name}`
        : "constitution-harness-history",
    [name],
  );
  const agentStorageKey = useMemo(
    () => (name ? `constitution-agent-${name}` : "constitution-agent"),
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
    () => (name ? `constitution-session-${name}` : "constitution-session"),
    [name],
  );
  const oldSavedSessionKey = useMemo(
    () =>
      name
        ? `constitution-saved-sessions-${name}`
        : "constitution-saved-sessions",
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
  const [mentionCommandPaths, setMentionCommandPaths] = useState<string[]>([]);
  const [externalPath, setExternalPath] = useState<string | null>(null);
  const chatWindowRef = useRef<ChatWindowHandle>(null);
  const chatInputId = "constitution-agent-prompt";
  const chatMarkdownOptions = useMemo(
    () => ({
      repositoryName: name || undefined,
      currentFilePath: name || undefined,
    }),
    [name],
  );
  const isExternal = Boolean(name && isExternalMatterId(name));
  const linkedExternalMatter = useMemo(
    () => (isExternal && name ? getExternalMatter("constitution", name) : null),
    [isExternal, name],
  );

  const {
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
    isRefreshing,
    openClearSessionModal,
    openSessionModal,
    reloadCurrentSession,
    sessionError,
    sessionLoading,
    sessionListError,
    sessionListLoading,
    sessionModalOpen,
    sessionOptions,
  } = useChatSession({
    name,
    sessionId,
    setSessionId,
    chat,
    setChat,
    setPrompt,
    setSelectedAgent,
    normalizedSelectedAgent,
    defaultAgentValue: DEFAULT_AGENT_VALUE,
    appendPolicy: appendRestrictedAccessPolicy,
    isExternal,
    api: {
      sendMessage: api.sendConstitutionAgent,
      getStatus: api.getConstitutionAgentStatus,
      cancelAgent: api.cancelConstitutionAgent,
      getHistory: api.getConstitutionAgentHistory,
      getSessions: api.getConstitutionAgentSessions,
    },
    onActivateAgentTab: () => setActiveTab("agent"),
  });

  const savedSessionTitles = useMemo(
    () =>
      sessionOptions.reduce<Record<string, string>>((titles, session) => {
        titles[session.id] = session.title;
        return titles;
      }, {}),
    [sessionOptions],
  );

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
      navigate("/constitutions");
      return;
    }
    if (isExternal) {
      if (!linkedExternalMatter) {
        setStatus("Linked external constitution not found");
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
          console.error("Failed to load external constitution", error);
          setStatus("Failed to load linked external constitution file");
        });
      return;
    }
    api
      .getConstitution(name)
      .then((data) => {
        setFrontmatter(data.frontmatter ?? data.data ?? {});
        setContent(data.content ?? "");
      })
      .catch((error) => {
        console.error("Failed to load constitution", error);
        setStatus("Failed to load constitution");
      });
  }, [isExternal, linkedExternalMatter, name, navigate]);

  const handleSave = async () => {
    if (!name) return;
    try {
      if (isExternal) {
        if (!externalPath) {
          setStatus("Missing external constitution path");
          return;
        }
        await api.writeExternalMatter({
          path: externalPath,
          content,
          frontmatter,
        });
        saveExternalMatter("constitution", name, content, frontmatter);
        setStatus("Saved successfully");
        return;
      }
      await api.saveConstitution(name, { content, frontmatter });
      setStatus("Saved successfully");
    } catch (error) {
      console.error("Failed to save constitution", error);
      setStatus("Save failed");
    }
  };

  const handleRemoveLink = useCallback(() => {
    if (!name || !isExternal) return;
    const confirmed = window.confirm(
      "Remove this external constitution link from MADE?",
    );
    if (!confirmed) return;
    removeExternalMatterLink("constitution", name);
    navigate("/constitutions");
  }, [isExternal, name, navigate]);

  const handleSend = async () => {
    if (!prompt.trim()) return;
    await handleSendMessage(prompt, { clearPrompt: true });
  };

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
                    aria-label="Remove external constitution link"
                    title="Remove external constitution link"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            }
          >
            {externalPath && <div className="path-info">{externalPath}</div>}
            <div className="form-group">
              <label htmlFor="constitution-type">Type</label>
              <select
                id="constitution-type"
                value={(frontmatter.type as string) || "global"}
                onChange={(event) =>
                  setFrontmatter({
                    ...frontmatter,
                    type: event.target.value,
                  })
                }
              >
                <option value="global">Global</option>
                <option value="project">Project</option>
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
  ];
  if (!isExternal) {
    tabs.push(
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
              running={chatAgentProcessing}
              sessionLoading={sessionLoading}
              refreshing={isRefreshing}
              emptyMessage="Start a conversation to discuss this constitution."
              sessionId={sessionId}
              onClearSession={openClearSessionModal}
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
              placeholder="Ask the agent to update governance rules..."
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
    );
  }

  return (
    <div className="page">
      <h1>
        Constitution: {isExternal ? (linkedExternalMatter?.name ?? name) : name}
      </h1>
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
      <TabView tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      <ClearSessionModal
        open={clearSessionModalOpen}
        onCancel={closeClearSessionModal}
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
          onClose={closeSessionModal}
          onSelect={handleSessionSelect}
          onRemoveSavedSession={handleRemoveSavedSession}
        />
      </Suspense>
    </div>
  );
};
export default ConstitutionPage;
