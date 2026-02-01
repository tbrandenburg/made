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
            ? "🤖 "
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

const stripFrontmatter = (content: string) => {
  const delimiterPattern =
    /^\s*---(?:[\r\n]+[\s\S]*?[\r\n]+---|[\s\S]*?---)\s*/;
  return delimiterPattern.test(content)
    ? content.replace(delimiterPattern, "").trim()
    : content.trim();
};

const CopyIcon: React.FC = () => (
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
);

const TrashIcon: React.FC = () => (
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
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const ChatWindow: React.FC<ChatWindowProps> = ({
  chat,
  chatWindowRef,
  loading,
  emptyMessage,
  sessionId,
  onClearSession,
}) => (
  <div className="chat-window" ref={chatWindowRef}>
    {chat.map((message) => {
      const strippedMessage = stripFrontmatter(message.text || "");
      return (
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
            onClick={() => copyText(strippedMessage)}
          >
            <CopyIcon />
          </button>
          <div
            className="markdown"
            dangerouslySetInnerHTML={{
              __html: strippedMessage.trim()
                ? marked(strippedMessage)
                : "<em>Empty message</em>",
            }}
          />
        </div>
      );
    })}
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
          className="icon-button-small"
          aria-label="Clear session"
          title="Clear session"
          onClick={onClearSession}
          disabled={!onClearSession}
        >
          <TrashIcon />
        </button>
      </div>
    )}
  </div>
);
