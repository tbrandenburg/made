import type { ChatHistoryMessage } from "../hooks/useApi";
import type { ChatMessage } from "../types/chat";
import { mapHistoryToMessages } from "./chat";

export interface PendingUser {
  message: ChatMessage;
  submitted: string;
  baseline: string[] | null;
  replyId?: string;
}

export function reconcileChatSnapshot(
  history: ChatHistoryMessage[],
  pending: PendingUser[],
): { messages: ChatMessage[]; pending: PendingUser[] } {
  const users = history.filter((message) => message.role === "user");
  const used = new Set<string>();
  let admittedPosition = -1;
  let unresolved = false;
  const remaining = pending.filter((entry, index) => {
    const boundary = entry.baseline?.length
      ? users.findIndex(
          (message) => message.messageId === entry.baseline?.at(-1),
        )
      : -1;
    // A missing/reordered baseline cannot establish which occurrence is new.
    const baseline = users
      .slice(0, boundary + 1)
      .map((message) => message.messageId);
    const anchored =
      entry.baseline !== null &&
      entry.baseline.every((id, position) => baseline[position] === id);
    const candidates = users.filter(
      (message, position) =>
        message.messageId &&
        !used.has(message.messageId) &&
        !entry.baseline?.includes(message.messageId) &&
        position > boundary &&
        position > admittedPosition &&
        message.content === entry.submitted,
    );
    const exact = candidates.find(
      (message) => message.messageId === entry.replyId,
    );
    const competing = pending.some(
      (other, position) =>
        position !== index && other.submitted === entry.submitted,
    );
    const match =
      exact ??
      (anchored && !unresolved && !competing && candidates.length === 1
        ? candidates[0]
        : undefined);
    if (!match?.messageId) {
      unresolved = true;
      return true;
    }
    admittedPosition = users.indexOf(match);
    used.add(match.messageId);
    return false;
  });
  return {
    messages: [
      ...mapHistoryToMessages(history),
      ...remaining.map((entry) => entry.message),
    ],
    pending: remaining,
  };
}
