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
    expect(prompt).toContain("shellScriptPath: \".harness/release-workflow.sh\"");
    expect(prompt).toContain("Use this exact script path when generating the harness script:");
    expect(prompt).toContain("`.harness/release-workflow.sh`");
    expect(prompt).toContain("Support exactly one optional flag: `--dry-run`.");
    expect(prompt).toContain("Without any parameter, the script should execute the workflow normally.");
    expect(prompt).toContain(".harness/release-workflow.sh --dry-run");
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
  it("uses explicit workflow shell script path when provided", () => {
    const workflow: WorkflowDefinition = {
      id: "wf_3",
      name: "Any",
      schedule: null,
      shellScriptPath: ".harness/custom-script.sh",
      steps: [],
    };

    const prompt = buildWorkflowHarnessPrompt(workflow, "opencode");

    expect(prompt).toContain("shellScriptPath: \".harness/custom-script.sh\"");
    expect(prompt).toContain("`.harness/custom-script.sh`");
  });

});
