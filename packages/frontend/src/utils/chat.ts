import { AgentReply, ChatHistoryMessage } from "../hooks/useApi";
import { ChatMessage } from "../types/chat";

const QUOTE_PAIRS: Record<string, string> = {
  "\"": "\"",
  "'": "'",
  "`": "`",
  "“": "”",
  "‘": "’",
  "«": "»",
};

export const normalizeChatMessageText = (text: string | undefined | null) => {
  let normalized = (text || "").trim();
  const openingQuote = normalized[0];
  const closingQuote = openingQuote ? QUOTE_PAIRS[openingQuote] : undefined;

  if (closingQuote && normalized.endsWith(closingQuote)) {
    normalized = normalized.slice(1, -closingQuote.length).trim();
  }

  return normalized;
};

export const buildMessageDedupKey = (message: ChatMessage) => {
  const normalizedText = normalizeChatMessageText(message.text);
  const normalizedType =
    message.role === "agent" ? message.messageType || "none" : "user";

  return `${message.role}-${normalizedType}-${normalizedText}`;
};

const normalizeMessageType = (
  value: string | undefined,
): ChatMessage["messageType"] => {
  if (value === "thinking" || value === "tool" || value === "final") {
    return value;
  }
  return undefined;
};

export const mapAgentReplyToMessages = (reply: AgentReply): ChatMessage[] => {
  const parts =
    reply.responses && reply.responses.length
      ? reply.responses
      : reply.response
        ? [{ text: reply.response, timestamp: reply.sent, type: "final" }]
        : [];

  return parts.map((part, index) => ({
    id: `${reply.messageId}-${index}`,
    role: "agent",
    text: part.text,
    timestamp: part.timestamp || reply.sent,
    messageType: normalizeMessageType(part.type),
  }));
};

const normalizeTimestamp = (rawTimestamp: string | null | undefined) => {
  if (rawTimestamp && !Number.isNaN(Date.parse(rawTimestamp))) {
    return new Date(rawTimestamp).toISOString();
  }
  return new Date().toISOString();
};

const normalizeHistoryMessageType = (
  rawType: ChatHistoryMessage["type"],
): ChatMessage["messageType"] => {
  if (rawType === "tool" || rawType === "tool_use") return "tool";
  if (rawType === "text") return "final";
  return undefined;
};

export const mapHistoryToMessages = (
  messages: ChatHistoryMessage[],
): ChatMessage[] => {
  const occurrenceCounter: Record<string, number> = {};

  return messages.map((message) => {
    const role = message.role === "assistant" ? "agent" : "user";
    const baseId = message.messageId || `${role}-${message.timestamp || "unknown"}`;
    const count = occurrenceCounter[baseId] ?? 0;
    occurrenceCounter[baseId] = count + 1;

    return {
      id: `${baseId}-${count}`,
      role,
      text: message.content || "",
      timestamp: normalizeTimestamp(message.timestamp),
      messageType: normalizeHistoryMessageType(message.type),
    };
  });
};
