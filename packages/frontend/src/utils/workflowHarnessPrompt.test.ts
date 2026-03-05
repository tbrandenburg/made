import { describe, expect, it } from "vitest";

import { WorkflowDefinition } from "../components/WorkflowBuilderPanel";
import { buildWorkflowHarnessPrompt } from "./workflowHarnessPrompt";

describe("buildWorkflowHarnessPrompt", () => {
  it("renders current cli, full workflows yaml, and selected workflow id hint", () => {
    const workflows: WorkflowDefinition[] = [
      {
        id: "wf_release",
        name: "Release Workflow",
        schedule: "0 5 * * *",
        steps: [
          {
            type: "agent",
            agent: "default",
            command: "plan",
            prompt: "Create release plan",
          },
        ],
      },
      {
        id: "wf_other",
        name: "Other Workflow",
        schedule: null,
        steps: [{ type: "bash", run: "echo other" }],
      },
    ];

    const prompt = buildWorkflowHarnessPrompt(workflows, "wf_release", "codex");

    expect(prompt).toContain("`codex`");
    expect(prompt).toContain("Only generate a script for workflow ID `wf_release`.");
    expect(prompt).toContain('id: "wf_release"');
    expect(prompt).toContain('id: "wf_other"');
    expect(prompt).toContain("select only ID `wf_release`");
    expect(prompt).toContain(".harness/release-workflow.sh");
  });

  it("falls back to workflow id for file naming when id cannot be found", () => {
    const workflows: WorkflowDefinition[] = [];

    const prompt = buildWorkflowHarnessPrompt(workflows, "wf_missing", "opencode");

    expect(prompt).toContain(".harness/wf-missing.sh");
    expect(prompt).toContain("workflows:\n  []");
  });
});
