import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { api } from "../hooks/useApi";
import "../styles/page.css";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
}

export const KnowledgeArtefactPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("content");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
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
        {
          id: reply.messageId,
          role: "agent",
          text: reply.response,
          timestamp: reply.sent,
        },
      ]);
      setActiveTab("agent");
    } catch (error) {
      console.error("Failed to contact agent", error);
      setStatus("Agent unavailable");
    } finally {
      setChatLoading(false);
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
                      className={`chat-message ${message.role}`}
                    >
                      <div className="chat-meta">
                        {new Date(message.timestamp).toLocaleString()}
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
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!chatLoading && prompt.trim()) {
                        handleSend();
                      }
                    }
                  }}
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
