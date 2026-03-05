import workflowPromptTemplate from "../templates/WORKFLOW_TO_HARNESS_PROMPT_TEMPLATE.md?raw";
import { WorkflowDefinition, WorkflowStep } from "../components/WorkflowBuilderPanel";

const escapeYamlValue = (value: string) => {
  const normalized = value.replace(/\r\n/g, "\n");
  return JSON.stringify(normalized);
};

const stepToYaml = (step: WorkflowStep, indent: string) => {
  const lines: string[] = [`${indent}- type: ${step.type}`];
  if (step.type === "agent") {
    if (step.agent) lines.push(`${indent}  agent: ${escapeYamlValue(step.agent)}`);
    if (step.command) lines.push(`${indent}  command: ${escapeYamlValue(step.command)}`);
    if (step.prompt) lines.push(`${indent}  prompt: ${escapeYamlValue(step.prompt)}`);
    return lines;
  }
  lines.push(`${indent}  run: ${escapeYamlValue(step.run || "")}`);
  return lines;
};

const workflowToYaml = (workflow: WorkflowDefinition) => {
  const lines: string[] = ["workflows:", "  - id: " + escapeYamlValue(workflow.id), "    name: " + escapeYamlValue(workflow.name), "    schedule: " + (workflow.schedule ? escapeYamlValue(workflow.schedule) : "null"), "    steps:"];

  if (!workflow.steps.length) {
    lines.push("      []");
  } else {
    workflow.steps.forEach((step) => {
      lines.push(...stepToYaml(step, "      "));
    });
  }

  return lines.join("\n");
};

const normalizeWorkflowName = (value: string) => {
  const fallback = "workflow";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

export const buildWorkflowHarnessPrompt = (
  workflow: WorkflowDefinition,
  agentCli: string,
) => {
  const apply = (template: string, key: string, value: string) =>
    template.split(key).join(value);

  let output = workflowPromptTemplate;
  output = apply(output, "{{WORKFLOW_NAME}}", workflow.name);
  output = apply(
    output,
    "{{WORKFLOW_FILE_NAME}}",
    `${normalizeWorkflowName(workflow.name)}.sh`,
  );
  output = apply(output, "{{WORKFLOW_YAML}}", workflowToYaml(workflow));
  output = apply(output, "{{CURRENT_AGENT_CLI}}", agentCli || "opencode");
  return output;
};
