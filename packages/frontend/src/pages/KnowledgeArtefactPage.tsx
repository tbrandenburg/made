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
import { usePersistentChat } from "../hooks/usePersistentChat";
import { api } from "../hooks/useApi";
import { ChatMessage } from "../types/chat";
import "../styles/page.css";
import { mapAgentReplyToMessages } from "../utils/chat";

export const KnowledgeArtefactPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("content");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState("");
  const chatStorageKey = useMemo(
    () => (name ? `knowledge-chat-${name}` : "knowledge-chat"),
    [name],
  );
  const [chat, setChat] = usePersistentChat(chatStorageKey);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const chatWindowRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chat]);

  useEffect(() => {
    if (!name) {
      navigate("/knowledge");
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
  }, [name, navigate]);

  const refreshAgentStatus = useCallback(async () => {
    if (!name) return false;
    try {
      const status = await api.getKnowledgeAgentStatus(name);
      setChatLoading(status.processing);
      setAgentStatus(
        status.processing ? "Agent is still processing the previous message." : null,
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

  const handleSave = async () => {
    if (!name) return;
    try {
      await api.saveKnowledge(name, { content, frontmatter });
      setStatus("Saved successfully");
    } catch (error) {
      console.error("Failed to save artefact", error);
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
      const reply = await api.sendKnowledgeAgent(name, userMessage.text);
      setChat((prev) => [
        ...prev,
        ...mapAgentReplyToMessages(reply),
      ]);
      setActiveTab("agent");
      setAgentStatus(null);
      setChatLoading(false);
    } catch (error) {
      console.error("Failed to contact agent", error);
      const message = error instanceof Error ? error.message : "";
      const busy = message.toLowerCase().includes("processing");
      setAgentStatus(
        busy ? "Agent is still processing the previous message." : "Agent unavailable",
      );
      const processing = await refreshAgentStatus();
      if (!processing) {
        setChatLoading(false);
      }
    }
  };

  const tags = Array.isArray(frontmatter.tags)
    ? (frontmatter.tags as string[]).join(", ")
    : "";

  return (
    <div className="page">
      <h1>Artefact: {name}</h1>
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
                      value={(frontmatter.type as string) || "internal"}
                      onChange={(event) =>
                        setFrontmatter({
                          ...frontmatter,
                          type: event.target.value,
                        })
                      }
                    >
                      <option value="internal">Internal</option>
                      <option value="external">External</option>
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
              <Panel title="Agent Conversation">
                <div className="chat-window" ref={chatWindowRef}>
                    {chat.map((message) => (
                      <div
                        key={message.id}
                        className={`chat-message ${message.role} ${message.messageType || ""}`}
                      >
                        <div className="chat-meta">
                          {`${message.role === "agent"
                            ? message.messageType === "thinking"
                              ? "🧠 "
                              : message.messageType === "tool"
                                ? "🛠️ "
                                : message.messageType === "final"
                                  ? "🎯 "
                                  : ""
                            : ""}${new Date(message.timestamp).toLocaleString()}`}
                        </div>
                        <div
                          className="markdown"
                          dangerouslySetInnerHTML={{
                            __html: marked(message.text || ""),
                        }}
                      />
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="loading-indicator">
                      <div className="loading-spinner"></div>
                      <span>Agent is thinking...</span>
                    </div>
                  )}
                  {chat.length === 0 && !chatLoading && (
                    <div className="empty">
                      Start a conversation to collaborate with agents.
                    </div>
                  )}
                </div>
                {agentStatus && <div className="alert">{agentStatus}</div>}
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask the agent about this artefact..."
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
    </div>
  );
};
