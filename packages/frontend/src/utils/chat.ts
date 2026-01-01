import { AgentReply, ChatHistoryMessage } from "../hooks/useApi";
import { ChatMessage } from "../types/chat";

const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
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
  const normalizedText = normalizeChatMessageText(message.text).slice(0, 200);

  if (message.role === "agent") {
    if (message.messageKey) return message.messageKey;
    return normalizedText || message.id;
  }

  return normalizedText || message.messageKey || message.id;
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
    messageKey: reply.messageId,
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
    const baseId =
      message.messageId || `${role}-${message.timestamp || "unknown"}`;
    const count = occurrenceCounter[baseId] ?? 0;
    occurrenceCounter[baseId] = count + 1;
    const normalizedContent = normalizeChatMessageText(message.content);

    return {
      id: `${baseId}-${count}`,
      messageKey:
        role === "agent"
          ? message.messageId || baseId
          : normalizedContent || message.messageId || baseId,
      role,
      text:
        role === "user"
          ? normalizedContent
          : message.content || "",
      timestamp: normalizeTimestamp(message.timestamp),
      messageType: normalizeHistoryMessageType(message.type),
    };
  });
};

export const mergeChatMessages = (
  existing: ChatMessage[],
  incoming: ChatMessage[],
) => {
  const next = [...existing];
  const existingIndexByKey = new Map<string, number>();

  existing.forEach((message, index) => {
    if (message.messageType === "tool") return;
    const key = buildMessageDedupKey(message);
    if (!key) return;
    if (!existingIndexByKey.has(key)) {
      existingIndexByKey.set(key, index);
    }
  });

  incoming.forEach((message) => {
    if (message.messageType === "tool") {
      next.push(message);
      return;
    }

    const key = buildMessageDedupKey(message);
    if (!key) {
      next.push(message);
      return;
    }

    const existingIndex = existingIndexByKey.get(key);
    if (existingIndex === undefined) {
      existingIndexByKey.set(key, next.length);
      next.push(message);
      return;
    }

    const existingMessage = next[existingIndex];
    const incomingText = normalizeChatMessageText(message.text);
    const existingText = normalizeChatMessageText(existingMessage.text);
    const incomingTimestamp = Date.parse(message.timestamp);
    const existingTimestamp = Date.parse(existingMessage.timestamp);

    const incomingIsNewer =
      incomingTimestamp > existingTimestamp ||
      (!Number.isNaN(incomingTimestamp) && Number.isNaN(existingTimestamp));

    if (
      incomingText.length > existingText.length ||
      incomingIsNewer
    ) {
      next[existingIndex] = message;
    }
  });

  return next;
};
