import { describe, expect, it } from "vitest";

import { workflowShellScriptPath } from "./workflowHarnessPrompt";

describe("workflowShellScriptPath", () => {
  it("normalizes a workflow name into a harness shell script path", () => {
    expect(workflowShellScriptPath("Release Workflow")).toBe(
      ".harness/release-workflow.sh",
    );
    expect(workflowShellScriptPath("Any")).toBe(".harness/any.sh");
  });

  it("falls back to a generic workflow file name when the name is empty", () => {
    expect(workflowShellScriptPath("")).toBe(".harness/workflow.sh");
    expect(workflowShellScriptPath("   ")).toBe(".harness/workflow.sh");
  });
});
