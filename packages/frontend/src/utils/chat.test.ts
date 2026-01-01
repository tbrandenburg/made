import { describe, expect, it } from "vitest";

import { ChatMessage } from "../types/chat";
import { buildMessageDedupKey, mergeChatMessages } from "./chat";

const baseTimestamp = "2024-01-01T00:00:00.000Z";

describe("chat utils", () => {
  describe("buildMessageDedupKey", () => {
    it("prioritises messageKey over text when available", () => {
      const message: ChatMessage = {
        id: "msg-1",
        messageKey: "stable-key",
        role: "agent",
        text: "partial content",
        timestamp: baseTimestamp,
      };

      expect(buildMessageDedupKey(message)).toBe("stable-key");
    });

    it("falls back to normalised text when no key is provided", () => {
      const message: ChatMessage = {
        id: "msg-2",
        role: "agent",
        text: '"Wrapped content"',
        timestamp: baseTimestamp,
      };

      expect(buildMessageDedupKey(message)).toBe("Wrapped content");
    });
  });

  describe("mergeChatMessages", () => {
    it("replaces truncated messages with fuller versions sharing the same key", () => {
      const existing: ChatMessage[] = [
        {
          id: "message-1",
          messageKey: "session-1",
          role: "agent",
          text: "Short message",
          timestamp: baseTimestamp,
        },
      ];

      const incoming: ChatMessage[] = [
        {
          id: "message-1",
          messageKey: "session-1",
          role: "agent",
          text: "Short message that now includes the complete content",
          timestamp: baseTimestamp,
        },
        {
          id: "tool-1",
          role: "agent",
          text: "tool output",
          timestamp: baseTimestamp,
          messageType: "tool",
        },
      ];

      const merged = mergeChatMessages(existing, incoming);
      expect(merged).toHaveLength(2);
      expect(merged[0].text).toBe(
        "Short message that now includes the complete content",
      );
      expect(merged[1].messageType).toBe("tool");
    });

    it("prefers newer timestamps when lengths match", () => {
      const olderTimestamp = "2023-12-31T23:59:00.000Z";
      const newerTimestamp = "2024-01-01T00:01:00.000Z";

      const existing: ChatMessage[] = [
        {
          id: "message-2",
          messageKey: "session-2",
          role: "agent",
          text: "Complete",
          timestamp: olderTimestamp,
        },
      ];

      const incoming: ChatMessage[] = [
        {
          id: "message-2",
          messageKey: "session-2",
          role: "agent",
          text: "Replaced",
          timestamp: newerTimestamp,
        },
      ];

      const merged = mergeChatMessages(existing, incoming);
      expect(merged[0].text).toBe("Replaced");
      expect(merged[0].timestamp).toBe(newerTimestamp);
    });
  });
});
