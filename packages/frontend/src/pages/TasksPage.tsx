import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  ArtefactSummary,
  WorkspaceWorkflowSummary,
} from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import "../styles/page.css";

type WorkflowDiagnostics = WorkspaceWorkflowSummary["diagnostics"];

const formatDateTime = (value?: string | null, fallback = "-") => {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleString();
};

const formatDuration = (durationMs?: number | null) => {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return "-";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

const formatExitCode = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return String(value);
};

const formatErrorText = (value?: string | null) => {
  if (!value || !value.trim()) {
    return "-";
  }
  const normalized = value.trim();
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77)}...`;
};

const formatWorkflowLastRun = (workflow: WorkspaceWorkflowSummary) => {
  if (!workflow.schedule || !workflow.schedule.trim()) {
    return "n.a.";
  }

  if (!workflow.lastRun) {
    return "-";
  }

  return formatDateTime(workflow.lastRun);
};

const renderWorkflowDiagnosticsSummary = (diagnostics: WorkflowDiagnostics) => {
  if (!diagnostics) {
    return <span className="meta-secondary">No diagnostics yet</span>;
  }

  return (
    <details className="workflow-diagnostics">
      <summary className="workflow-diagnostics__summary">
        <span
          className={`badge ${diagnostics.running ? "success" : ""}`.trim()}
        >
          {diagnostics.running ? "Running" : "Idle"}
        </span>
        <span className="badge">
          Exit {formatExitCode(diagnostics.lastExitCode)}
        </span>
        <span className="badge">
          {formatDuration(diagnostics.lastDurationMs)}
        </span>
      </summary>
      <div className="meta-secondary">
        <span>Started: {formatDateTime(diagnostics.lastStartedAt)}</span>
        <span>Finished: {formatDateTime(diagnostics.lastFinishedAt)}</span>
      </div>
      <div className="meta-secondary">
        Error: {formatErrorText(diagnostics.lastStderr ?? diagnostics.lastError)}
      </div>
    </details>
  );
};

export const TasksPage: React.FC = () => {
  const [tasks, setTasks] = useState<ArtefactSummary[]>([]);
  const [activeTab, setActiveTab] = useState("tasks");
  const [workspaceWorkflows, setWorkspaceWorkflows] = useState<
    WorkspaceWorkflowSummary[]
  >([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();
  const isTemplate = (task: ArtefactSummary) => {
    if (typeof task.type === "string") {
      return task.type === "template";
    }
    const frontmatterType = task.frontmatter?.type;
    return (
      typeof frontmatterType === "string" && frontmatterType === "template"
    );
  };
  const templateTasks = tasks.filter(isTemplate);
  const documentTasks = tasks.filter((task) => !isTemplate(task));
  const getRepositoryName = (repository: string) => {
    const segments = repository.split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] || repository;
  };

  const loadTasks = () => {
    api
      .listTasks()
      .then((res) => setTasks(res.tasks))
      .catch((error) => console.error("Failed to load tasks", error));
  };

  useEffect(() => {
    loadTasks();
    api
      .getWorkspaceWorkflows()
      .then((res) => setWorkspaceWorkflows(res.workflows))
      .catch((error) =>
        console.error("Failed to load workspace workflows", error),
      );
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const filename = newName.trim().endsWith(".md")
      ? newName.trim()
      : `${newName.trim()}.md`;
    await api.saveTask(filename, {
      content: "# New Task\n\n- [ ] Define work\n",
      frontmatter: { type: "task", schedule: "" },
    });
    setCreateOpen(false);
    setNewName("");
    loadTasks();
    navigate(`/tasks/${filename}`);
  };

  return (
    <div className="page">
      <h1>Tasks</h1>
      <TabView
        tabs={[
          {
            id: "tasks",
            label: "Tasks",
            content: (
              <>
                <Panel title="Workflows">
                  {workspaceWorkflows.length === 0 ? (
                    <div className="empty">
                      No workflows found in repository .made/workflows.yml
                      files.
                    </div>
                  ) : (
                    <table className="git-table">
                      <thead>
                        <tr>
                          <th>Enabled</th>
                          <th>Schedule</th>
                          <th>Name</th>
                          <th>Repository</th>
                          <th>Last run</th>
                          <th>Diagnostics</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceWorkflows.map((workflow) => {
                          const repositoryName = getRepositoryName(
                            workflow.repository,
                          );
                          return (
                            <tr key={`${workflow.repository}:${workflow.id}`}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={workflow.enabled}
                                  readOnly
                                  aria-label={`${workflow.name} enabled`}
                                />
                              </td>
                              <td>{workflow.schedule || "-"}</td>
                              <td>
                                <Link
                                  to={`/repositories/${encodeURIComponent(repositoryName)}?tab=harnesses`}
                                >
                                  {workflow.name}
                                </Link>
                              </td>
                              <td>{repositoryName}</td>
                              <td>{formatWorkflowLastRun(workflow)}</td>
                              <td>
                                {renderWorkflowDiagnosticsSummary(
                                  workflow.diagnostics,
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </Panel>

                <div className="button-bar">
                  <button
                    className="primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    Create Task
                  </button>
                </div>
                <div className="panel-column">
                  {templateTasks.length > 0 && (
                    <Panel title="Templates">
                      <div className="panel-column">
                        {templateTasks.map((task) => (
                          <Panel
                            key={task.name}
                            title={task.name}
                            to={`/tasks/${task.name}`}
                          >
                            <div className="metadata">
                              {typeof task.frontmatter?.schedule === "string" &&
                                task.frontmatter.schedule.trim() && (
                                  <span className="badge success">
                                    {String(task.frontmatter.schedule)}
                                  </span>
                                )}
                              {typeof task.frontmatter?.type === "string" && (
                                <span className="badge">
                                  {String(task.frontmatter.type)}
                                </span>
                              )}
                            </div>
                          </Panel>
                        ))}
                      </div>
                    </Panel>
                  )}
                  {documentTasks.length > 0 && (
                    <Panel title="Tasks">
                      <div className="panel-column">
                        {documentTasks.map((task) => (
                          <Panel
                            key={task.name}
                            title={task.name}
                            to={`/tasks/${task.name}`}
                          >
                            <div className="metadata">
                              {typeof task.frontmatter?.schedule === "string" &&
                                task.frontmatter.schedule.trim() && (
                                  <span className="badge success">
                                    {String(task.frontmatter.schedule)}
                                  </span>
                                )}
                              {typeof task.frontmatter?.type === "string" && (
                                <span className="badge">
                                  {String(task.frontmatter.type)}
                                </span>
                              )}
                            </div>
                          </Panel>
                        ))}
                      </div>
                    </Panel>
                  )}
                  {tasks.length === 0 && (
                    <div className="empty">No tasks available.</div>
                  )}
                </div>
              </>
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <Modal
        open={createOpen}
        title="Create Task"
        onClose={() => setCreateOpen(false)}
      >
        <div className="form-group">
          <label htmlFor="task-name">File name</label>
          <input
            id="task-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="release-checklist"
          />
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setCreateOpen(false)}>
            Cancel
          </button>
          <button className="primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      </Modal>
    </div>
  );
};
