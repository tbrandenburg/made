export interface ChatMessage {
  id: string;
  /**
   * Stable key for deduplication across partial/updated messages.
   * Falls back to the message ID or normalized text when absent.
   */
  messageKey?: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
  messageType?: "thinking" | "tool" | "final";
}
