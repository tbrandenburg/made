import { describe, expect, it } from "vitest";
import type { ChatHistoryMessage } from "../hooks/useApi";
import { reconcileChatSnapshot, type PendingUser } from "./chatSnapshot";

const user = (messageId: string, content: string): ChatHistoryMessage => ({
  messageId,
  content,
  role: "user",
  type: "text",
  timestamp: "2026-01-01T00:00:00Z",
});
const pending = (submitted = '"hello"'): PendingUser => ({
  message: {
    id: "local",
    role: "user",
    text: "hello",
    timestamp: "local-time",
  },
  submitted,
  baseline: ["old"],
});

describe("snapshot admission", () => {
  it("clears persisted content on a genuine empty snapshot but keeps the original pending message", () => {
    const entry = pending();
    const result = reconcileChatSnapshot([], [entry]);
    expect(result.messages).toEqual([
      { id: "local", role: "user", text: "hello", timestamp: "local-time" },
    ]);
    expect(result.pending).toEqual([entry]);
  });
  it("uses raw submitted text after the recorded baseline without rewriting the optimistic message", () => {
    const entry = pending('"hello"\npolicy');
    const result = reconcileChatSnapshot(
      [user("old", "hello"), user("other", "hello")],
      [entry],
    );
    expect(result.pending).toEqual([entry]);
    expect(result.messages.at(-1)).toEqual(entry.message);
    const admitted = reconcileChatSnapshot(
      [user("old", "hello"), user("new", '"hello"\npolicy')],
      [entry],
    );
    expect(admitted.pending).toEqual([]);
    expect(admitted.messages.map((message) => message.messageKey)).toEqual([
      "old",
      "new",
    ]);
    expect(entry.baseline).toEqual(["old"]);
  });

  it.each([null, ["missing"], ["later", "old"]])(
    "retains an unanchored baseline %s",
    (baseline) => {
      const entry = { ...pending(), baseline };
      const result = reconcileChatSnapshot(
        [user("old", "prior"), user("later", "prior"), user("new", '"hello"')],
        [entry],
      );
      expect(result.pending).toEqual([entry]);
      expect(result.messages.at(-1)?.id).toBe("local");
    },
  );

  it("does not normalize quotes or guess between duplicate persisted occurrences", () => {
    const entry = pending();
    const normalized = reconcileChatSnapshot(
      [user("old", "prior"), user("new", "hello")],
      [entry],
    );
    expect(normalized.pending).toHaveLength(1);
    expect(normalized.messages.at(-1)?.timestamp).toBe("local-time");
    const ambiguous = reconcileChatSnapshot(
      [user("old", "prior"), user("one", '"hello"'), user("two", '"hello"')],
      [entry],
    );
    expect(ambiguous.pending).toHaveLength(1);
    expect(ambiguous.messages.map((message) => message.id)).toEqual([
      "old-0",
      "one-0",
      "two-0",
      "local",
    ]);
  });

  it("prefers a reply ID that actually identifies a new persisted user and admits it once", () => {
    const entry = { ...pending(), replyId: "two" };
    const history = [
      user("old", "prior"),
      user("one", '"hello"'),
      user("two", '"hello"'),
    ];
    const result = reconcileChatSnapshot(history, [entry]);
    expect(result.pending).toEqual([]);
    expect(result.messages.map((message) => message.id)).toEqual([
      "old-0",
      "one-0",
      "two-0",
    ]);
    const replay = reconcileChatSnapshot(history, result.pending);
    expect(replay.messages).toEqual(result.messages);
    expect(replay.pending).toEqual([]);
  });

  it("keeps competing local occurrences rather than assigning the same user twice", () => {
    const first = pending();
    const second = {
      ...pending(),
      message: { ...pending().message, id: "second" },
    };
    const result = reconcileChatSnapshot(
      [user("old", "prior"), user("one", '"hello"')],
      [first, second],
    );
    expect(result.pending.map((entry) => entry.message.id)).toEqual([
      "local",
      "second",
    ]);
    expect(result.messages.map((message) => message.id)).toEqual([
      "old-0",
      "one-0",
      "local",
      "second",
    ]);
  });

  it("admits distinct submissions in order rather than assigning reversed occurrences", () => {
    const first = pending("first");
    const second = {
      ...pending("second"),
      message: { ...pending().message, id: "second" },
    };
    const result = reconcileChatSnapshot(
      [user("old", "prior"), user("two", "second"), user("one", "first")],
      [first, second],
    );
    expect(result.pending.map((entry) => entry.message.id)).toEqual(["second"]);
    expect(result.messages.map((message) => message.id)).toEqual([
      "old-0",
      "two-0",
      "one-0",
      "second",
    ]);
  });
});
