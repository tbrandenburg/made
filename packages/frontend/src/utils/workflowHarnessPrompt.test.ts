import { describe, expect, it } from "vitest";

import { WorkflowDefinition } from "../components/WorkflowBuilderPanel";
import { buildWorkflowHarnessPrompt } from "./workflowHarnessPrompt";

describe("buildWorkflowHarnessPrompt", () => {
  it("renders the configured cli and workflow yaml", () => {
    const workflow: WorkflowDefinition = {
      id: "wf_1",
      name: "Release Workflow",
      enabled: true,
      schedule: "0 5 * * *",
      steps: [
        {
          type: "agent",
          agent: "default",
          command: "plan",
          prompt: "Create release plan",
        },
        { type: "bash", run: "echo done" },
      ],
    };

    const prompt = buildWorkflowHarnessPrompt(workflow, "codex");

    expect(prompt).toContain("Only generate commands for this CLI:");
    expect(prompt).toContain("    codex");
    expect(prompt).toContain('name: "Release Workflow"');
    expect(prompt).toContain("enabled: true");
    expect(prompt).toContain('schedule: "0 5 * * *"');
    expect(prompt).toContain('agent: "default"');
    expect(prompt).toContain('command: "plan"');
    expect(prompt).toContain('run: "echo done"');
    expect(prompt).toContain('shellScriptPath: ".harness/release-workflow.sh"');
    expect(prompt).toContain("The script MUST be written exactly to:");
    expect(prompt).toContain("    .harness/release-workflow.sh");
    expect(prompt).toContain(
      "The script supports **exactly one optional argument**:",
    );
    expect(prompt).toContain(
      "Treat `run` as a shell command to execute directly in Bash,",
    );
    expect(prompt).toContain("Do NOT call `codex` for bash steps.");
    expect(prompt).toContain(
      "This section applies to `type: agent` steps only.",
    );
    expect(prompt).toContain(
      "Equivalent helper-based form is also allowed when behavior is identical:",
    );
    expect(prompt).toContain("run_agent() {");
    expect(prompt).toContain("run_step step2");
    expect(prompt).toContain(
      "Function-wrapped execution example with centralized error hook:",
    );
    expect(prompt).toContain("run_step() {");
    expect(prompt).toContain("run_step step1");
    expect(prompt).toContain("`STEP*_DESCRIPTION` variables are optional");
    expect(prompt).toContain("• No arguments → execute workflow normally");
    expect(prompt).toContain(".harness/release-workflow.sh --dry-run");
  });

  it("falls back to workflow file name when workflow name is empty", () => {
    const workflow: WorkflowDefinition = {
      id: "wf_2",
      name: "",
      enabled: false,
      schedule: null,
      steps: [],
    };

    const prompt = buildWorkflowHarnessPrompt(workflow, "opencode");

    expect(prompt).toContain(".harness/workflow.sh");
    expect(prompt).toContain("schedule: null");
    expect(prompt).toContain("enabled: false");
  });
  it("uses explicit workflow shell script path when provided", () => {
    const workflow: WorkflowDefinition = {
      id: "wf_3",
      name: "Any",
      enabled: true,
      schedule: null,
      shellScriptPath: ".harness/custom-script.sh",
      steps: [],
    };

    const prompt = buildWorkflowHarnessPrompt(workflow, "opencode");

    expect(prompt).toContain('shellScriptPath: ".harness/custom-script.sh"');
    expect(prompt).toContain("    .harness/custom-script.sh");
  });
});
