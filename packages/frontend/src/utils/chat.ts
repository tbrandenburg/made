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

export const formatChatMessageLabel = (message: ChatMessage) => {
  if (message.messageType === "tool") return "[tool]";
  if (message.messageType === "thinking") return "[agent:thinking]";
  if (message.messageType === "final") return "[agent:final]";
  return `[${message.role}]`;
};

export const formatChatMessageTimestamp = (message: ChatMessage) => {
  const parsed = Date.parse(message.timestamp);
  if (!Number.isFinite(parsed)) return "Unknown time";
  return new Date(parsed).toLocaleString();
};

export const buildMessageDedupKey = (message: ChatMessage) => {
  const normalizedText = normalizeChatMessageText(message.text);
  const userTextKey = normalizedText.slice(0, 300);
  const baseKey =
    message.role === "user"
      ? userTextKey || message.messageKey || message.id
      : message.messageKey || normalizedText || message.id;

  if (!baseKey) return undefined;

  return `${message.role}:${baseKey}`;
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
  const parts: AgentReply["responses"] =
    reply.responses && reply.responses.length
      ? reply.responses
      : reply.response
        ? [
            {
              text: reply.response,
              timestamp: reply.sent,
              type: "final",
            },
          ]
        : [];

  return (parts ?? []).map((part, index) => {
    const stableId = part.callId || part.partId || `${reply.messageId}-${index}`;
    const messageKey =
      part.callId || part.partId || `${reply.messageId}-${index}`;

    return {
      id: stableId,
      messageKey,
      role: "agent",
      text: part.text,
      timestamp: part.timestamp || reply.sent,
      messageType: normalizeMessageType(part.type),
    };
  });
};

const normalizeTimestamp = (rawTimestamp: string | null | undefined) => {
  if (rawTimestamp && !Number.isNaN(Date.parse(rawTimestamp))) {
    return new Date(rawTimestamp).toISOString();
  }
  return rawTimestamp || "";
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
    const partKey = message.callId || message.partId;

    return {
      id: `${baseId}-${count}`,
      messageKey:
        role === "agent"
          ? partKey || message.messageId || baseId
          : message.messageId || normalizedContent || baseId,
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
    const key = buildMessageDedupKey(message);
    if (!key) return;
    existingIndexByKey.set(key, index);
  });

  incoming.forEach((message) => {
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

    const incomingValid = !Number.isNaN(incomingTimestamp);
    const existingValid = !Number.isNaN(existingTimestamp);

    const incomingIsNewer =
      (incomingValid && existingValid && incomingTimestamp > existingTimestamp) ||
      (incomingValid && !existingValid);

    if (
      incomingText.length > existingText.length ||
      incomingIsNewer
    ) {
      next[existingIndex] = message;
    }
  });

  return next;
};
