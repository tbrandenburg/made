const normalizeWorkflowName = (value: string) => {
  const fallback = "workflow";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

export const workflowShellScriptPath = (workflowName: string) =>
  `.harness/${normalizeWorkflowName(workflowName)}.sh`;
