import { describe, expect, it } from "vitest";
import { formatBreadcrumb } from "./TopBar";

describe("formatBreadcrumb", () => {
  it("formats external matter ids using a readable file stem", () => {
    expect(
      formatBreadcrumb("/constitutions/external-~%2F.config%2Fopencode%2FAGENTS.md"),
    ).toBe("Constitutions / External AGENTS");
  });

  it("keeps normal breadcrumb segments readable", () => {
    expect(formatBreadcrumb("/knowledge/my-page")).toBe("Knowledge / My page");
  });
});
