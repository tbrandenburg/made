export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
  messageType?: "thinking" | "tool" | "final";
}
