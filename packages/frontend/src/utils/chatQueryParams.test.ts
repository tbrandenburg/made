import {
  getChatBootstrapParams,
  stripChatBootstrapParams,
} from "./chatQueryParams";
import { describe, expect, it } from "vitest";

describe("chatQueryParams", () => {
  it("reads session and user message aliases", () => {
    const params = new URLSearchParams(
      "sid=session-123&userMessage=hello%20agent&tab=agent",
    );
    expect(getChatBootstrapParams(params)).toEqual({
      sessionId: "session-123",
      message: "hello agent",
    });
  });

  it("removes only bootstrap parameters", () => {
    const params = new URLSearchParams(
      "sessionId=s1&message=hi&tab=agent&view=compact",
    );
    const { nextParams, changed } = stripChatBootstrapParams(params);
    expect(changed).toBe(true);
    expect(nextParams.toString()).toBe("tab=agent&view=compact");
  });
});
