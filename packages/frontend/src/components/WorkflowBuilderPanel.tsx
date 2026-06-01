import React, { useEffect, useMemo, useState } from "react";
import { MentionPathTextarea } from "./MentionPathTextarea";
import { Modal } from "./Modal";
import { AvailableAgent } from "../hooks/useApi";
import { ArrowDownIcon } from "./icons/ArrowDownIcon";
import { CheckboxIcon } from "./icons/CheckboxIcon";
import { ClockIcon } from "./icons/ClockIcon";
import { PlayIcon } from "./icons/PlayIcon";
import { PlusIcon } from "./icons/PlusIcon";
import { RefreshIcon } from "./icons/RefreshIcon";
import { SaveIcon } from "./icons/SaveIcon";
import { TrashIcon } from "./icons/TrashIcon";
import { XIcon } from "./icons/XIcon";
import { workflowShellScriptPath } from "../utils/workflowHarnessPrompt";

export type WorkflowStep = {
  type: "agent" | "bash" | "vars";
  agent?: string;
  varName?: string;
  command?: string;
  prompt?: string;
  run?: string;
  values?: Record<string, string>;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  shellScriptPath?: string;
  steps: WorkflowStep[];
};

type WorkflowBuilderPanelProps = {
  loadWorkflows: () => Promise<{ workflows: WorkflowDefinition[] }>;
  saveWorkflows: (payload: {
    workflows: WorkflowDefinition[];
  }) => Promise<unknown>;
  listAgents: () => Promise<{ agents: AvailableAgent[] }>;
  onRunWorkflow: (workflows: WorkflowDefinition[]) => Promise<void>;
  mentionPathSuggestions?: string[];
};

const previewText = (step: WorkflowStep) => {
  const raw =
    step.type === "bash"
      ? step.run || ""
      : step.type === "vars"
        ? step.run || ""
        : step.command
          ? `/${step.command}${step.prompt ? ` ${step.prompt}` : ""}`
          : step.prompt || "";
  const [firstLine] = raw.split(/\r?\n/, 1);
  return firstLine || (step.type === "agent" ? "Prompt" : "Command");
};

const toBashVariableName = (value: string) => {
  const upper = value.toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9_]/g, "");
  if (!cleaned) return "";
  const [first, ...rest] = cleaned;
  const safeFirst = /[A-Z_]/.test(first) ? first : "_";
  return `${safeFirst}${rest.join("")}`;
};

const parseAgentText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return { prompt: value, command: undefined as string | undefined };
  }
  const withoutSlash = trimmed.slice(1).trim();
  if (!withoutSlash) {
    return { prompt: "", command: undefined as string | undefined };
  }
  const [command, ...rest] = withoutSlash.split(/\s+/);
  return {
    command,
    prompt: rest.join(" "),
  };
};

const normalizeStep = (step: WorkflowStep): WorkflowStep => {
  if (step.type !== "vars") {
    return step;
  }

  const entries = Object.entries(step.values || {});
  const [firstVarName = "", firstValue = ""] = entries[0] || [];
  const varName = step.varName || firstVarName;
  const run =
    step.run ?? (varName && firstVarName === varName ? firstValue : "");

  return {
    ...step,
    varName,
    run,
    values: varName ? { [varName]: run } : {},
  };
};

const normalizeWorkflows = (items: WorkflowDefinition[]) =>
  items.map((workflow) => ({
    ...workflow,
    steps: workflow.steps.map(normalizeStep),
  }));
const newWorkflow = (): WorkflowDefinition => ({
  id: `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  name: "New workflow",
  enabled: false,
  schedule: null,
  steps: [],
});

export const WorkflowBuilderPanel: React.FC<WorkflowBuilderPanelProps> = ({
  loadWorkflows,
  saveWorkflows,
  listAgents,
  onRunWorkflow,
  mentionPathSuggestions = [],
}) => {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [agents, setAgents] = useState<AvailableAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversionMessage, setConversionMessage] = useState<string | null>(
    null,
  );
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [editStep, setEditStep] = useState<{
    workflowId: string;
    stepIndex: number;
  } | null>(null);
  const [editStepValue, setEditStepValue] = useState("");
  const [scheduleEditor, setScheduleEditor] = useState<{
    workflowId: string;
    value: string;
  }>({
    workflowId: "",
    value: "",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [workflowData, agentData] = await Promise.all([
        loadWorkflows(),
        listAgents(),
      ]);
      setWorkflows(normalizeWorkflows(workflowData.workflows || []));
      setAgents(agentData.agents || []);
      setExpandedIds((prev) => {
        const next = { ...prev };
        (workflowData.workflows || []).forEach((workflow) => {
          if (next[workflow.id] === undefined) {
            next[workflow.id] = true;
          }
        });
        return next;
      });
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load workflows";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const persist = async (nextWorkflows: WorkflowDefinition[]) => {
    setWorkflows(nextWorkflows);
    setSaving(true);
    setError(null);
    try {
      await saveWorkflows({ workflows: nextWorkflows });
      return true;
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Failed to save workflows";
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const agentNames = useMemo(() => agents.map((agent) => agent.name), [agents]);

  const addStep = (workflowId: string) => {
    const defaultAgent = agentNames[0] || "default";
    const next = workflows.map((workflow) =>
      workflow.id === workflowId
        ? {
            ...workflow,
            steps: [
              ...workflow.steps,
              { type: "agent" as const, agent: defaultAgent, prompt: "" },
            ],
          }
        : workflow,
    );
    void persist(next);
  };

  return (
    <div className="workflow-builder">
      <div className="workflow-builder__header">
        <div className="workflow-builder__actions">
          <button
            className="copy-button workflow-icon-button"
            onClick={load}
            disabled={loading || saving}
            title="Refresh workflows"
            aria-label="Refresh workflows"
          >
            <RefreshIcon />
          </button>
          <button
            className="copy-button workflow-icon-button"
            onClick={() => void persist([...workflows, newWorkflow()])}
            disabled={saving}
            title="Add workflow"
            aria-label="Add workflow"
          >
            <PlusIcon />
          </button>
        </div>
      </div>
      {loading && <div className="alert">Loading workflows...</div>}
      {saving && <div className="alert">Saving workflows...</div>}
      {conversionMessage && (
        <div className="alert success">{conversionMessage}</div>
      )}
      {conversionError && <div className="alert error">{conversionError}</div>}
      {error && <div className="alert error">{error}</div>}
      {!loading && workflows.length === 0 && (
        <div className="empty">No workflows yet.</div>
      )}
      <div className="workflow-list">
        {workflows.map((workflow) => {
          const expanded = expandedIds[workflow.id] ?? true;
          return (
            <div className="workflow-card" key={workflow.id}>
              <div className="workflow-card__header">
                <button
                  className="copy-button workflow-icon-button"
                  onClick={() =>
                    setExpandedIds((prev) => ({
                      ...prev,
                      [workflow.id]: !expanded,
                    }))
                  }
                  title={expanded ? "Collapse workflow" : "Expand workflow"}
                  aria-label={
                    expanded ? "Collapse workflow" : "Expand workflow"
                  }
                >
                  <span
                    className={
                      expanded
                        ? "workflow-icon workflow-icon--down"
                        : "workflow-icon workflow-icon--right"
                    }
                  >
                    <ArrowDownIcon />
                  </span>
                </button>
                <input
                  className="workflow-name-input"
                  value={workflow.name}
                  onChange={(event) => {
                    const next = workflows.map((item) =>
                      item.id === workflow.id
                        ? { ...item, name: event.target.value }
                        : item,
                    );
                    void persist(next);
                  }}
                />
                <button
                  className="copy-button workflow-icon-button"
                  title={
                    workflow.enabled ? "Disable workflow" : "Enable workflow"
                  }
                  aria-label={
                    workflow.enabled ? "Disable workflow" : "Enable workflow"
                  }
                  onClick={() => {
                    const next = workflows.map((item) =>
                      item.id === workflow.id
                        ? { ...item, enabled: !item.enabled }
                        : item,
                    );
                    void persist(next);
                  }}
                >
                  <span
                    className={
                      workflow.enabled
                        ? "workflow-icon workflow-icon--enabled"
                        : "workflow-icon"
                    }
                  >
                    <CheckboxIcon checked={workflow.enabled} />
                  </span>
                </button>
                <button
                  className="copy-button workflow-icon-button"
                  title={workflow.schedule || "Set schedule"}
                  aria-label={
                    workflow.schedule
                      ? `Edit schedule: ${workflow.schedule}`
                      : "Set schedule"
                  }
                  onClick={() =>
                    setScheduleEditor({
                      workflowId: workflow.id,
                      value: workflow.schedule || "",
                    })
                  }
                >
                  <ClockIcon />
                </button>
                <button
                  className="copy-button workflow-icon-button"
                  onClick={() => addStep(workflow.id)}
                  title="Add step"
                  aria-label="Add step"
                >
                  <PlusIcon />
                </button>
                <button
                  className="copy-button workflow-icon-button"
                  title="Run workflow"
                  aria-label="Run workflow"
                  onClick={async () => {
                    const shellScriptPath = workflowShellScriptPath(
                      workflow.name,
                    );
                    setConversionMessage(null);
                    setConversionError(null);
                    const next = workflows.map((item) =>
                      item.id === workflow.id
                        ? { ...item, shellScriptPath }
                        : item,
                    );
                    const persisted = await persist(next);
                    if (!persisted) {
                      setConversionError(
                        "Failed to save workflow before conversion. Check required fields and try again.",
                      );
                      return;
                    }
                    try {
                      await onRunWorkflow(next);
                      setConversionMessage(
                        `Workflow converted to harness shell script: ${shellScriptPath}`,
                      );
                    } catch (error) {
                      const message =
                        error instanceof Error && error.message
                          ? error.message
                          : "unknown error";
                      setConversionError(
                        `Failed to convert workflow to harness shell script (${message}). Check workflow schema, especially vars values, and try again.`,
                      );
                    }
                  }}
                >
                  <PlayIcon />
                </button>
                <button
                  className="copy-button workflow-icon-button workflow-icon-button--danger"
                  title="Remove workflow"
                  aria-label="Remove workflow"
                  onClick={() =>
                    void persist(
                      workflows.filter((item) => item.id !== workflow.id),
                    )
                  }
                >
                  <TrashIcon />
                </button>
              </div>
              {expanded && (
                <div className="workflow-steps">
                  {workflow.steps.length === 0 ? (
                    <div className="empty">No steps yet.</div>
                  ) : (
                    workflow.steps.map((step, stepIndex) => (
                      <div
                        className="workflow-step-row"
                        key={`${workflow.id}-${stepIndex}`}
                      >
                        <div className="workflow-step-target">
                          <select
                            value={step.type}
                            onChange={(event) => {
                              const nextType = event.target.value as
                                | "agent"
                                | "bash"
                                | "vars";
                              const nextStep: WorkflowStep =
                                nextType === "bash"
                                  ? { type: "bash", run: "" }
                                  : nextType === "vars"
                                    ? {
                                        type: "vars",
                                        varName: "",
                                        run: "",
                                        values: {},
                                      }
                                    : {
                                        type: "agent",
                                        agent: agentNames[0] || "default",
                                        prompt: "",
                                      };
                              const next = workflows.map((item) =>
                                item.id === workflow.id
                                  ? {
                                      ...item,
                                      steps: item.steps.map(
                                        (itemStep, itemIndex) =>
                                          itemIndex === stepIndex
                                            ? nextStep
                                            : itemStep,
                                      ),
                                    }
                                  : item,
                              );
                              void persist(next);
                            }}
                          >
                            <option value="agent">Agent</option>
                            <option value="bash">Bash</option>
                            <option value="vars">Vars</option>
                          </select>
                          {step.type === "agent" ? (
                            <select
                              value={step.agent || "default"}
                              onChange={(event) => {
                                const next = workflows.map((item) =>
                                  item.id === workflow.id
                                    ? {
                                        ...item,
                                        steps: item.steps.map(
                                          (itemStep, itemIndex) =>
                                            itemIndex === stepIndex
                                              ? {
                                                  ...itemStep,
                                                  agent: event.target.value,
                                                }
                                              : itemStep,
                                        ),
                                      }
                                    : item,
                                );
                                void persist(next);
                              }}
                            >
                              {agentNames.length === 0 ? (
                                <option value="default">default</option>
                              ) : (
                                agentNames.map((agentName) => (
                                  <option key={agentName}>{agentName}</option>
                                ))
                              )}
                            </select>
                          ) : step.type === "vars" ? (
                            <input
                              className="workflow-step-target__input"
                              value={step.varName || ""}
                              placeholder="VARIABLE_NAME"
                              onChange={(event) => {
                                const next = workflows.map((item) =>
                                  item.id === workflow.id
                                    ? {
                                        ...item,
                                        steps: item.steps.map(
                                          (itemStep, itemIndex) => {
                                            if (itemIndex !== stepIndex) {
                                              return itemStep;
                                            }
                                            const varName = toBashVariableName(
                                              event.target.value,
                                            );
                                            return {
                                              ...itemStep,
                                              varName,
                                              values: varName
                                                ? {
                                                    [varName]:
                                                      itemStep.run || "",
                                                  }
                                                : {},
                                            };
                                          },
                                        ),
                                      }
                                    : item,
                                );
                                void persist(next);
                              }}
                            />
                          ) : null}
                        </div>
                        <button
                          className="workflow-step-preview"
                          onClick={() => {
                            const currentText =
                              step.type === "agent"
                                ? step.command
                                  ? `/${step.command}${step.prompt ? ` ${step.prompt}` : ""}`
                                  : step.prompt || ""
                                : step.run || "";
                            setEditStep({ workflowId: workflow.id, stepIndex });
                            setEditStepValue(currentText);
                          }}
                        >
                          {previewText(step)}
                        </button>
                        <div className="workflow-step-controls">
                          <button
                            className="copy-button workflow-icon-button"
                            disabled={stepIndex === 0}
                            title="Move step up"
                            aria-label="Move step up"
                            onClick={() => {
                              const next = workflows.map((item) => {
                                if (item.id !== workflow.id || stepIndex === 0)
                                  return item;
                                const steps = [...item.steps];
                                [steps[stepIndex - 1], steps[stepIndex]] = [
                                  steps[stepIndex],
                                  steps[stepIndex - 1],
                                ];
                                return { ...item, steps };
                              });
                              void persist(next);
                            }}
                          >
                            <span className="workflow-icon workflow-icon--up">
                              <ArrowDownIcon />
                            </span>
                          </button>
                          <button
                            className="copy-button workflow-icon-button"
                            disabled={stepIndex === workflow.steps.length - 1}
                            title="Move step down"
                            aria-label="Move step down"
                            onClick={() => {
                              const next = workflows.map((item) => {
                                if (
                                  item.id !== workflow.id ||
                                  stepIndex >= item.steps.length - 1
                                )
                                  return item;
                                const steps = [...item.steps];
                                [steps[stepIndex + 1], steps[stepIndex]] = [
                                  steps[stepIndex],
                                  steps[stepIndex + 1],
                                ];
                                return { ...item, steps };
                              });
                              void persist(next);
                            }}
                          >
                            <span className="workflow-icon workflow-icon--down">
                              <ArrowDownIcon />
                            </span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal
        open={Boolean(editStep)}
        title="Edit Step"
        onClose={() => {
          setEditStep(null);
          setEditStepValue("");
        }}
      >
        <div className="form-group">
          <label htmlFor="workflow-step-editor">Command or Prompt</label>
          <MentionPathTextarea
            id="workflow-step-editor"
            rows={8}
            value={editStepValue}
            onChange={setEditStepValue}
            suggestions={mentionPathSuggestions}
          />
        </div>
        <div className="modal-actions">
          <button
            className="copy-button workflow-icon-button"
            onClick={() => setEditStep(null)}
            title="Cancel"
            aria-label="Cancel"
          >
            <XIcon />
          </button>
          <button
            className="copy-button workflow-icon-button"
            title="Save step"
            aria-label="Save step"
            onClick={() => {
              if (!editStep) return;
              const next = workflows.map((workflow) => {
                if (workflow.id !== editStep.workflowId) return workflow;
                return {
                  ...workflow,
                  steps: workflow.steps.map((step, index) => {
                    if (index !== editStep.stepIndex) return step;
                    if (step.type !== "agent") {
                      if (step.type === "vars") {
                        const varName = step.varName || "";
                        return {
                          ...step,
                          run: editStepValue,
                          values: varName ? { [varName]: editStepValue } : {},
                        };
                      }
                      return { ...step, run: editStepValue };
                    }
                    const parsed = parseAgentText(editStepValue);
                    return {
                      ...step,
                      command: parsed.command,
                      prompt: parsed.prompt,
                    };
                  }),
                };
              });
              setEditStep(null);
              setEditStepValue("");
              void persist(next);
            }}
          >
            <SaveIcon />
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(scheduleEditor.workflowId)}
        title="Edit Schedule"
        onClose={() => setScheduleEditor({ workflowId: "", value: "" })}
      >
        <div className="form-group">
          <label htmlFor="workflow-schedule">Cron expression</label>
          <input
            id="workflow-schedule"
            value={scheduleEditor.value}
            onChange={(event) =>
              setScheduleEditor((prev) => ({
                ...prev,
                value: event.target.value,
              }))
            }
            placeholder="*/15 * * * *"
          />
        </div>
        <div className="modal-actions">
          <button
            className="copy-button workflow-icon-button"
            onClick={() => setScheduleEditor({ workflowId: "", value: "" })}
            title="Cancel"
            aria-label="Cancel"
          >
            <XIcon />
          </button>
          <button
            className="copy-button workflow-icon-button"
            title="Save schedule"
            aria-label="Save schedule"
            onClick={() => {
              const next = workflows.map((workflow) =>
                workflow.id === scheduleEditor.workflowId
                  ? {
                      ...workflow,
                      schedule: scheduleEditor.value.trim() || null,
                    }
                  : workflow,
              );
              setScheduleEditor({ workflowId: "", value: "" });
              void persist(next);
            }}
          >
            <SaveIcon />
          </button>
        </div>
      </Modal>
    </div>
  );
};
export default WorkflowBuilderPanel;
