import { beforeEach, describe, expect, it } from "vitest";

import {
  addExternalMatterLink,
  getExternalMatter,
  listExternalMatter,
  removeExternalMatterLink,
} from "./externalLinks";

describe("externalLinks", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes a linked external matter entry", () => {
    const linked = addExternalMatterLink(
      "constitution",
      "~/.config/opencode/AGENTS.md",
    );
    expect(linked).not.toBeNull();
    expect(listExternalMatter("constitution")).toHaveLength(1);

    const removed = removeExternalMatterLink("constitution", linked!.id);
    expect(removed).toBe(true);
    expect(listExternalMatter("constitution")).toHaveLength(0);
    expect(getExternalMatter("constitution", linked!.id)).toBeNull();
  });

  it("returns false when removing a missing entry", () => {
    expect(removeExternalMatterLink("knowledge", "external-missing")).toBe(
      false,
    );
  });
});
