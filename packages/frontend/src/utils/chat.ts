import { AgentReply } from "../hooks/useApi";
import { ChatMessage } from "../types/chat";

export const mapAgentReplyToMessages = (reply: AgentReply): ChatMessage[] => {
  const parts =
    reply.responses && reply.responses.length
      ? reply.responses
      : reply.response
        ? [{ text: reply.response, timestamp: reply.sent }]
        : [];

  return parts.map((part, index) => ({
    id: `${reply.messageId}-${index}`,
    role: "agent",
    text: part.text,
    timestamp: part.timestamp || reply.sent,
  }));
};
