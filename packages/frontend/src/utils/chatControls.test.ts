import { describe, expect, it } from "vitest";
import { showCancel } from "./chatControls";

describe("showCancel", () => {
  it("is never shown while idle", () => {
    expect(showCancel(false, "", "s1")).toBe(false);
    expect(showCancel(false, "hello", null)).toBe(false);
  });

  it("is shown while processing with an empty or blank draft", () => {
    expect(showCancel(true, "", "s1")).toBe(true);
    expect(showCancel(true, "  \n", "s1")).toBe(true);
  });

  it("switches to Send once text is typed in an existing session", () => {
    expect(showCancel(true, "also this", "s1")).toBe(false);
  });

  it("stays Cancel for a new chat that has no session id yet", () => {
    expect(showCancel(true, "also this", null)).toBe(true);
    expect(showCancel(true, "also this", undefined)).toBe(true);
  });
});
