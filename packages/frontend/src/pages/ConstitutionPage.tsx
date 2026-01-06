import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { ChatWindow } from "../components/ChatWindow";
import { usePersistentChat } from "../hooks/usePersistentChat";
import { usePersistentString } from "../hooks/usePersistentString";
import { api, ChatSession } from "../hooks/useApi";
import { ChatMessage } from "../types/chat";
import "../styles/page.css";
import { mapAgentReplyToMessages, mapHistoryToMessages } from "../utils/chat";
import { ClearSessionModal } from "../components/ClearSessionModal";
import { SessionPickerModal } from "../components/SessionPickerModal";
import { DatabaseIcon } from "../components/icons/DatabaseIcon";

export const ConstitutionPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("content");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState("");
  const chatStorageKey = useMemo(
    () => (name ? `constitution-chat-${name}` : "constitution-chat"),
    [name],
  );
  const sessionStorageKey = useMemo(
    () => (name ? `constitution-session-${name}` : "constitution-session"),
    [name],
  );
  const [chat, setChat] = usePersistentChat(chatStorageKey);
  const [sessionId, setSessionId] = usePersistentString(sessionStorageKey);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [clearSessionModalOpen, setClearSessionModalOpen] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionOptions, setSessionOptions] = useState<ChatSession[]>([]);
  const [sessionListError, setSessionListError] = useState<string | null>(null);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const chatWindowRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chat]);

  const copyAllMessages = useCallback(() => {
    if (!navigator.clipboard || !chat.length) return;

    const content = chat
      .map((message) => message.text || "")
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
  }, [name, navigate]);

  const refreshAgentStatus = useCallback(async () => {
    if (!name) return false;
    try {
      const status = await api.getConstitutionAgentStatus(name);
      setChatLoading(status.processing);
      setAgentStatus(
        status.processing
          ? "Agent is still processing the previous message."
          : null,
      );
      return status.processing;
    } catch (error) {
      console.error("Failed to load agent status", error);
      return false;
    }
  }, [name]);

  useEffect(() => {
    refreshAgentStatus();
  }, [refreshAgentStatus]);

  const openSessionModal = useCallback(async () => {
    if (!name) return;
    setSessionModalOpen(true);
    setSessionListLoading(true);
    try {
      const response = await api.getConstitutionAgentSessions(name, 10);
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
      await api.saveConstitution(name, { content, frontmatter });
      setStatus("Saved successfully");
    } catch (error) {
      console.error("Failed to save constitution", error);
      setStatus("Save failed");
    }
  };

  const handleSend = async () => {
    if (!name || !prompt.trim()) return;
    const timestamp = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `${timestamp}-user`,
      role: "user",
      text: prompt.trim(),
      timestamp,
    };
    setChat((prev) => [...prev, userMessage]);
    setPrompt("");
    setChatLoading(true);
    try {
      const reply = await api.sendConstitutionAgent(
        name,
        userMessage.text,
        sessionId || undefined,
      );
      setChat((prev) => [...prev, ...mapAgentReplyToMessages(reply)]);
      if (reply.sessionId) {
        setSessionId(reply.sessionId);
      }
      setActiveTab("agent");
      setAgentStatus(null);
      setChatLoading(false);
    } catch (error) {
      console.error("Failed to contact agent", error);
      const message = error instanceof Error ? error.message : "";
      const busy = message.toLowerCase().includes("processing");
      setAgentStatus(
        busy
          ? "Agent is still processing the previous message."
          : "Agent unavailable",
      );
      const processing = await refreshAgentStatus();
      if (!processing) {
        setChatLoading(false);
      }
    }
  };

  const handleCancelClearSession = () => {
    setClearSessionModalOpen(false);
  };

  const handleClearSessionOnly = () => {
    setSessionId(null);
    setClearSessionModalOpen(false);
  };

  const handleClearSessionAndHistory = () => {
    setSessionId(null);
    setChat([]);
    setClearSessionModalOpen(false);
  };

  const handleSessionSelect = async (session: ChatSession) => {
    if (!name) return;
    setSessionModalOpen(false);
    setChat([]);
    setSessionId(session.id);
    setChatLoading(true);
    try {
      const history = await api.getConstitutionAgentHistory(name, session.id);
      const mapped = mapHistoryToMessages(history.messages || []);
      setChat(mapped);
      setAgentStatus(null);
    } catch (error) {
      console.error("Failed to load session history", error);
      const message =
        error instanceof Error ? error.message : "Failed to load session history";
      setAgentStatus(message);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="page">
      <h1>Constitution: {name}</h1>
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
                    dangerouslySetInnerHTML={{ __html: marked(content || "") }}
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
                      onClick={openSessionModal}
                      aria-label="Choose a session"
                      title="Choose a session"
                    >
                      <DatabaseIcon />
                    </button>
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
                  loading={chatLoading}
                  emptyMessage="Start a conversation to discuss this constitution."
                  sessionId={sessionId}
                  onClearSession={() => setClearSessionModalOpen(true)}
                />
                {agentStatus && <div className="alert">{agentStatus}</div>}
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask the agent to update governance rules..."
                />
                <div className="button-bar">
                  <button
                    className="primary"
                    onClick={handleSend}
                    disabled={chatLoading || !prompt.trim()}
                  >
                    {chatLoading ? "Sending..." : "Send"}
                  </button>
                </div>
              </Panel>
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
      <SessionPickerModal
        open={sessionModalOpen}
        loading={sessionListLoading}
        error={sessionListError}
        sessions={sessionOptions}
        onClose={() => setSessionModalOpen(false)}
        onSelect={handleSessionSelect}
      />
    </div>
  );
};
