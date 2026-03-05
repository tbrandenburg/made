import { describe, expect, it } from "vitest";

import { WorkflowDefinition } from "../components/WorkflowBuilderPanel";
import { buildWorkflowHarnessPrompt } from "./workflowHarnessPrompt";

describe("buildWorkflowHarnessPrompt", () => {
  it("renders the configured cli and workflow yaml", () => {
    const workflow: WorkflowDefinition = {
      id: "wf_1",
      name: "Release Workflow",
      schedule: "0 5 * * *",
      steps: [
        { type: "agent", agent: "default", command: "plan", prompt: "Create release plan" },
        { type: "bash", run: "echo done" },
      ],
    };

    const prompt = buildWorkflowHarnessPrompt(workflow, "codex");

    expect(prompt).toContain("`codex`");
    expect(prompt).toContain('name: "Release Workflow"');
    expect(prompt).toContain('schedule: "0 5 * * *"');
    expect(prompt).toContain('agent: "default"');
    expect(prompt).toContain('command: "plan"');
    expect(prompt).toContain('run: "echo done"');
    expect(prompt).toContain(".harness/release-workflow.sh");
    expect(prompt).toContain("--dry-run");
    expect(prompt).toContain("run without additional parameters in normal mode");
  });

  it("falls back to workflow file name when workflow name is empty", () => {
    const workflow: WorkflowDefinition = {
      id: "wf_2",
      name: "",
      schedule: null,
      steps: [],
    };

    const prompt = buildWorkflowHarnessPrompt(workflow, "opencode");

    expect(prompt).toContain(".harness/workflow.sh");
    expect(prompt).toContain("schedule: null");
  });
});
