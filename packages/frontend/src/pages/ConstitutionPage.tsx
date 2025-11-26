import React, { useEffect, useState } from "react";
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

export const ConstitutionPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("content");
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);

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
    try {
      const reply = await api.sendConstitutionAgent(name, userMessage.text);
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
    }
  };

  return (
    <div className="page">
      <h1>Constitution: {name}</h1>
      {status && <div className="alert">{status}</div>}
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
              <Panel title="Agent Conversation">
                <div className="chat-window">
                  {chat.map((message) => (
                    <div
                      key={message.id}
                      className={`chat-message ${message.role}`}
                    >
                      <div className="chat-meta">
                        {new Date(message.timestamp).toLocaleString()}
                      </div>
                      <pre>{message.text}</pre>
                    </div>
                  ))}
                  {chat.length === 0 && (
                    <div className="empty">
                      Engage agents to adapt the constitution.
                    </div>
                  )}
                </div>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask the agent to update governance rules..."
                />
                <div className="button-bar">
                  <button className="primary" onClick={handleSend}>
                    Send
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
