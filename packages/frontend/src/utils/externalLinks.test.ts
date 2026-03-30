import { beforeEach, describe, expect, it } from "vitest";

import {
  addExternalMatterLink,
  getExternalMatter,
  listExternalMatter,
  removeExternalMatterLink,
  saveExternalMatter,
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

  it("resolves entries by decoded route IDs", () => {
    const linked = addExternalMatterLink(
      "constitution",
      "~/.config/opencode/AGENTS.md",
    );
    expect(linked).not.toBeNull();

    const decodedRouteId = `external-${linked!.path}`;
    expect(getExternalMatter("constitution", decodedRouteId)).toEqual(linked);

    saveExternalMatter("constitution", decodedRouteId, "updated", {
      type: "global",
    });
    expect(getExternalMatter("constitution", linked!.id)?.content).toBe(
      "updated",
    );

    expect(removeExternalMatterLink("constitution", decodedRouteId)).toBe(true);
    expect(listExternalMatter("constitution")).toHaveLength(0);
  });
});
