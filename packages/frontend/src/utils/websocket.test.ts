import { describe, expect, it } from "vitest";

import { buildWebSocketUrl } from "./websocket";

describe("buildWebSocketUrl", () => {
  it("builds a websocket URL from a relative API base", () => {
    const origin = window.location.origin.replace(/^http/, "ws");
    const url = buildWebSocketUrl("/terminal", "/api");
    expect(url).toBe(`${origin}/api/terminal`);
  });

  it("handles API bases without a leading slash", () => {
    const origin = window.location.origin.replace(/^http/, "ws");
    const url = buildWebSocketUrl("/terminal", "api");
    expect(url).toBe(`${origin}/api/terminal`);
  });

  it("converts HTTP API URLs to websocket URLs", () => {
    const url = buildWebSocketUrl(
      "/terminal",
      "https://api.example.com/v1/base",
    );
    expect(url).toBe("wss://api.example.com/v1/base/terminal");
  });
});
