import React from "react";
import { Virtuoso } from "react-virtuoso";
import { MarkdownRenderOptions, renderMarkdown } from "../utils/markdown";
import { ChatMessage } from "../types/chat";
import { SaveIcon } from "./icons/SaveIcon";
import { TrashIcon } from "./icons/TrashIcon";

const SpacedItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function SpacedItem({ children, ...props }, ref) {
    return (
      <div ref={ref} {...props} style={{ paddingBottom: "1rem" }}>
        {children}
      </div>
    );
  },
);

interface ChatWindowProps {
  chat: ChatMessage[];
  chatWindowRef?: React.RefObject<ChatWindowHandle>;
  loading: boolean;
  emptyMessage: string;
  sessionId?: string | null;
  onClearSession?: () => void;
  onSaveSession?: () => void;
  isSessionSaved?: boolean;
  markdownOptions?: MarkdownRenderOptions;
}

export interface ChatWindowHandle {
  scrollToBottom: () => void;
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

interface ChatMessageItemProps {
  message: ChatMessage;
  markdownOptions?: MarkdownRenderOptions;
}

const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(
  function ChatMessageItem({ message, markdownOptions }) {
    const strippedMessage = React.useMemo(
      () => stripFrontmatter(message.text || ""),
      [message.text],
    );
    const timestamp = React.useMemo(
      () => formatTimestamp(message),
      [message.role, message.messageType, message.timestamp],
    );
    const html = React.useMemo(() => {
      if (!strippedMessage.trim()) return "<em>Empty message</em>";
      return renderMarkdown(strippedMessage, markdownOptions);
    }, [strippedMessage, markdownOptions]);

    return (
      <div
        className={`chat-message ${message.role} ${message.messageType || ""}`}
      >
        <div className="chat-meta">{timestamp}</div>
        <button
          type="button"
          className="copy-button chat-copy-button"
          aria-label="Copy message"
          title="Copy message"
          onClick={() => copyText(strippedMessage)}
        >
          <CopyIcon />
        </button>
        <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  },
);

export const ChatWindow: React.FC<ChatWindowProps> = React.memo(
  function ChatWindow({
    chat,
    chatWindowRef,
    loading,
    emptyMessage,
    sessionId,
    onClearSession,
    onSaveSession,
    isSessionSaved,
    markdownOptions,
  }) {
    const [, setIsAtBottom] = React.useState(true);
    const [scrollParent, setScrollParent] =
      React.useState<HTMLDivElement | null>(null);
    const setChatWindowElement = React.useCallback(
      (element: HTMLDivElement | null) => {
        setScrollParent(element);
      },
      [],
    );

    // Scroll to bottom once on initial data load (handles page reload).
    const initialScrollDoneRef = React.useRef(false);
    React.useEffect(() => {
      if (initialScrollDoneRef.current || !scrollParent || !chat.length) return;
      initialScrollDoneRef.current = true;
      requestAnimationFrame(() => {
        scrollParent.scrollTop = scrollParent.scrollHeight;
      });
    }, [scrollParent, chat.length]);

    // Defer to rAF so scrollHeight is read from the fully-painted DOM,
    // avoiding stale layout values during streaming or initial load.
    const scrollToBottom = React.useCallback(() => {
      if (!scrollParent || !chat.length) return;

      requestAnimationFrame(() => {
        scrollParent.scrollTo({
          top: scrollParent.scrollHeight,
          behavior: "smooth",
        });
      });
    }, [scrollParent, chat.length]);
    React.useImperativeHandle(chatWindowRef, () => ({ scrollToBottom }), [
      scrollToBottom,
    ]);
    const itemContent = React.useCallback(
      (_index: number, message: ChatMessage) => (
        <ChatMessageItem message={message} markdownOptions={markdownOptions} />
      ),
      [markdownOptions],
    );
    const footerContent = (
      <>
        {loading && (
          <div className="loading-indicator">
            <div className="loading-spinner"></div>
            <span>Agent is thinking...</span>
          </div>
        )}
        {sessionId && (
          <div className="chat-session-id" aria-label="Session ID">
            <span>Session ID: {sessionId}</span>
            <button
              type="button"
              className="icon-button-small"
              aria-label={isSessionSaved ? "Session saved" : "Save session"}
              title={isSessionSaved ? "Session already saved" : "Save session"}
              onClick={onSaveSession}
              disabled={!onSaveSession || isSessionSaved}
            >
              <SaveIcon />
            </button>
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
      </>
    );
    const components = React.useMemo(
      () => ({ Item: SpacedItem, Footer: () => footerContent }),
      [footerContent],
    );

    return (
      <div className="chat-window" ref={setChatWindowElement}>
        {chat.length > 0 && (
          <Virtuoso
            customScrollParent={scrollParent ?? undefined}
            data={chat}
            itemContent={itemContent}
            components={components}
            atBottomStateChange={setIsAtBottom}
            followOutput={(atBottom) => (atBottom ? "auto" : false)}
            increaseViewportBy={{ top: 300, bottom: 300 }}
            style={{ height: "auto" }}
          />
        )}
        {chat.length === 0 && loading && footerContent}
        {chat.length === 0 && !loading && (
          <div className="empty">{emptyMessage}</div>
        )}
        {chat.length === 0 && !loading && sessionId && footerContent}
      </div>
    );
  },
);
