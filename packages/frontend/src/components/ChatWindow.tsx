import React from "react";
import { marked } from "marked";
import { ChatMessage } from "../types/chat";

interface ChatWindowProps {
  chat: ChatMessage[];
  chatWindowRef?: React.RefObject<HTMLDivElement>;
  loading: boolean;
  emptyMessage: string;
  sessionId?: string | null;
  onClearSession?: () => void;
}

const formatTimestamp = (message: ChatMessage) => {
  const prefix =
    message.role === "agent"
      ? message.messageType === "thinking"
        ? "🧠 "
        : message.messageType === "tool"
          ? "🛠️ "
          : message.messageType === "final"
            ? "🎯 "
            : ""
      : "";

  return `${prefix}${new Date(message.timestamp).toLocaleString()}`;
};

const copyText = (text: string) => {
  if (!navigator.clipboard) return;

  navigator.clipboard.writeText(text).catch((error) => {
    console.error("Failed to copy message", error);
  });
};

export const ChatWindow: React.FC<ChatWindowProps> = ({
  chat,
  chatWindowRef,
  loading,
  emptyMessage,
  sessionId,
  onClearSession,
}) => (
  <div className="chat-window" ref={chatWindowRef}>
    {chat.map((message) => (
      <div
        key={message.id}
        className={`chat-message ${message.role} ${message.messageType || ""}`}
      >
        <div className="chat-meta">{formatTimestamp(message)}</div>
        <button
          type="button"
          className="copy-button chat-copy-button"
          aria-label="Copy message"
          title="Copy message"
          onClick={() => copyText(message.text || "")}
        >
          📋
        </button>
        <div
          className="markdown"
          dangerouslySetInnerHTML={{
            __html: marked(message.text || ""),
          }}
        />
      </div>
    ))}
    {loading && (
      <div className="loading-indicator">
        <div className="loading-spinner"></div>
        <span>Agent is thinking...</span>
      </div>
    )}
    {chat.length === 0 && !loading && <div className="empty">{emptyMessage}</div>}
    {sessionId && (
      <div className="chat-session-id" aria-label="Session ID">
        <span>Session ID: {sessionId}</span>
        <button
          type="button"
          title="Clear session"
          onClick={onClearSession}
        >
          🗑️
        </button>
      </div>
    )}
  </div>
);
