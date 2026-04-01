import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AgentProcessSummary,
  api,
  ArtefactSummary,
  WorkflowLogSummary,
  WorkspaceWorkflowSummary,
} from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import { TrashIcon } from "../components/icons/TrashIcon";
import { NestedArtefactPanels } from "../components/NestedArtefactPanels";
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
  return value.trim();
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

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
      <div className="meta-secondary">Error</div>
      <pre className="workflow-diagnostics__output">
        {formatErrorText(diagnostics.lastStderr ?? diagnostics.lastError)}
      </pre>
      <div className="meta-secondary">Stdout</div>
      <pre className="workflow-diagnostics__output">
        {formatErrorText(diagnostics.lastStdout)}
      </pre>
    </details>
  );
};

export const TasksPage: React.FC = () => {
  const workflowLogsPerPage = 5;
  const [tasks, setTasks] = useState<ArtefactSummary[]>([]);
  const [activeTab, setActiveTab] = useState("tasks");
  const [workspaceWorkflows, setWorkspaceWorkflows] = useState<
    WorkspaceWorkflowSummary[]
  >([]);
  const [workflowLogs, setWorkflowLogs] = useState<WorkflowLogSummary[]>([]);
  const [workflowLogsPage, setWorkflowLogsPage] = useState(1);
  const [logModal, setLogModal] = useState<{
    open: boolean;
    title: string;
    content: string;
  }>({ open: false, title: "", content: "" });
  const [loadingLog, setLoadingLog] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    name: string;
  }>({ open: false, name: "" });
  const [deletingTask, setDeletingTask] = useState(false);
  const [agentProcesses, setAgentProcesses] = useState<AgentProcessSummary[]>([]);
  const [terminatingAgentPid, setTerminatingAgentPid] = useState<number | null>(
    null,
  );
  const [terminatingWorkflow, setTerminatingWorkflow] = useState<string | null>(
    null,
  );
  const [terminateModal, setTerminateModal] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkspaceWorkflowSummary | null>(null);
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
  const workflowLogsPageCount = Math.max(
    1,
    Math.ceil(workflowLogs.length / workflowLogsPerPage),
  );
  const workflowLogsPageStart = (workflowLogsPage - 1) * workflowLogsPerPage;
  const visibleWorkflowLogs = workflowLogs.slice(
    workflowLogsPageStart,
    workflowLogsPageStart + workflowLogsPerPage,
  );
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
    Promise.all([
      api.getWorkspaceWorkflows(),
      api.getWorkflowLogs(),
      api.getAgentProcesses(),
    ])
      .then(([workflowRes, logRes, processRes]) => {
        setWorkspaceWorkflows(workflowRes.workflows);
        setWorkflowLogs(logRes.logs);
        setWorkflowLogsPage(1);
        setAgentProcesses(processRes.processes);
      })
      .catch((error) => console.error("Failed to load tasks page data", error));
  }, []);

  useEffect(() => {
    if (workflowLogsPage > workflowLogsPageCount) {
      setWorkflowLogsPage(workflowLogsPageCount);
    }
  }, [workflowLogsPage, workflowLogsPageCount]);

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

  const handleDeleteTask = async () => {
    if (!deleteModal.name) return;
    setDeletingTask(true);
    try {
      await api.deleteTask(deleteModal.name);
      setDeleteModal({ open: false, name: "" });
      loadTasks();
    } catch (error) {
      console.error("Failed to delete task", error);
      alert(
        `Failed to delete task: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setDeletingTask(false);
    }
  };

  const handleTerminate = (workflow: WorkspaceWorkflowSummary) => {
    setSelectedWorkflow(workflow);
    setTerminateModal(true);
  };

  const handleConfirmTerminate = async () => {
    if (!selectedWorkflow) return;

    const workflowId = `${selectedWorkflow.repository}:${selectedWorkflow.id}`;
    setTerminatingWorkflow(workflowId);
    setTerminateModal(false);

    try {
      await api.terminateWorkflow(workflowId);
      // Refresh workflow list
      const res = await api.getWorkspaceWorkflows();
      setWorkspaceWorkflows(res.workflows);
    } catch (error) {
      console.error("Failed to terminate workflow:", error);
      alert(
        `Failed to terminate workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setTerminatingWorkflow(null);
      setSelectedWorkflow(null);
    }
  };

  const openLogTail = async (logFile: WorkflowLogSummary) => {
    setLoadingLog(`${logFile.location}:${logFile.name}`);
    try {
      const result = await api.getWorkflowLogTail(
        logFile.location,
        logFile.name,
      );
      setLogModal({
        open: true,
        title: logFile.name,
        content: result.tail || "-",
      });
    } catch (error) {
      console.error("Failed to load workflow log tail", error);
      setLogModal({
        open: true,
        title: logFile.name,
        content: `Failed to read log file: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setLoadingLog(null);
    }
  };

  const handleTerminateAgentProcess = async (pid: number) => {
    setTerminatingAgentPid(pid);
    try {
      await api.terminateAgentProcess(pid);
      const processRes = await api.getAgentProcesses();
      setAgentProcesses(processRes.processes);
    } catch (error) {
      console.error("Failed to terminate agent process", error);
      alert(
        `Failed to terminate process: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setTerminatingAgentPid(null);
    }
  };

  const renderTaskActions = (task: ArtefactSummary) => (
    <button
      type="button"
      className="copy-button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDeleteModal({ open: true, name: task.name });
      }}
      aria-label={`Delete task ${task.name}`}
      title={`Delete task ${task.name}`}
    >
      <TrashIcon />
    </button>
  );

  const renderTaskMetadata = (task: ArtefactSummary) => (
    <div className="metadata">
      {typeof task.frontmatter?.schedule === "string" &&
        task.frontmatter.schedule.trim() && (
          <span className="badge success">{String(task.frontmatter.schedule)}</span>
        )}
      {typeof task.frontmatter?.type === "string" && (
        <span className="badge">{String(task.frontmatter.type)}</span>
      )}
    </div>
  );

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
                <Panel title="Schedule">
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
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspaceWorkflows.map((workflow) => {
                          const repositoryName = getRepositoryName(
                            workflow.repository,
                          );
                          const isScheduledTask = workflow.id.startsWith("task:");
                          const scheduledTaskName = isScheduledTask
                            ? workflow.id.slice("task:".length)
                            : null;
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
                                {isScheduledTask && scheduledTaskName ? (
                                  <Link to={`/tasks/${encodeURIComponent(scheduledTaskName)}`}>
                                    {workflow.name}
                                  </Link>
                                ) : (
                                  <Link
                                    to={`/repositories/${encodeURIComponent(repositoryName)}?tab=harnesses`}
                                  >
                                    {workflow.name}
                                  </Link>
                                )}
                              </td>
                              <td>{repositoryName}</td>
                              <td>{formatWorkflowLastRun(workflow)}</td>
                              <td>
                                {renderWorkflowDiagnosticsSummary(
                                  workflow.diagnostics,
                                )}
                              </td>
                              <td>
                                {workflow.diagnostics?.running && (
                                  <button
                                    className="danger"
                                    onClick={() => handleTerminate(workflow)}
                                    disabled={
                                      terminatingWorkflow ===
                                      `${workflow.repository}:${workflow.id}`
                                    }
                                    title="Terminate running workflow"
                                  >
                                    {terminatingWorkflow ===
                                    `${workflow.repository}:${workflow.id}`
                                      ? "Terminating..."
                                      : "Terminate"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  <h3>Available workflow logs</h3>
                  {workflowLogs.length === 0 ? (
                    <div className="empty">No workflow logs found.</div>
                  ) : (
                    <>
                      <table className="git-table">
                        <thead>
                          <tr>
                            <th>Filename</th>
                            <th>Location</th>
                            <th>Modified</th>
                            <th>Size</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleWorkflowLogs.map((logFile) => (
                            <tr key={`${logFile.location}:${logFile.name}`}>
                              <td>{logFile.name}</td>
                              <td>{logFile.path}</td>
                              <td>{formatDateTime(logFile.modifiedAt)}</td>
                              <td>{formatBytes(logFile.sizeBytes)}</td>
                              <td>
                                <button
                                  className="secondary"
                                  onClick={() => void openLogTail(logFile)}
                                  disabled={
                                    loadingLog ===
                                    `${logFile.location}:${logFile.name}`
                                  }
                                >
                                  {loadingLog ===
                                  `${logFile.location}:${logFile.name}`
                                    ? "Loading..."
                                    : "View tail"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {workflowLogsPageCount > 1 && (
                        <div className="meta-secondary">
                          <button
                            className="secondary"
                            onClick={() =>
                              setWorkflowLogsPage((page) => Math.max(1, page - 1))
                            }
                            disabled={workflowLogsPage === 1}
                          >
                            Previous
                          </button>
                          <span>
                            Page {workflowLogsPage} of {workflowLogsPageCount}
                          </span>
                          <button
                            className="secondary"
                            onClick={() =>
                              setWorkflowLogsPage((page) =>
                                Math.min(workflowLogsPageCount, page + 1),
                              )
                            }
                            disabled={workflowLogsPage === workflowLogsPageCount}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </Panel>
                <Panel title="Running Agent CLI Processes">
                  {agentProcesses.length === 0 ? (
                    <div className="empty">No running agent CLI processes.</div>
                  ) : (
                    <table className="git-table">
                      <thead>
                        <tr>
                          <th>PID</th>
                          <th>PPID</th>
                          <th>Executable</th>
                          <th>Command</th>
                          <th>Working Directory</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentProcesses.map((process) => (
                          <tr key={process.pid}>
                            <td>{process.pid}</td>
                            <td>{process.ppid}</td>
                            <td>{process.executable}</td>
                            <td>{process.command}</td>
                            <td>{process.workingDirectory ?? "-"}</td>
                            <td>
                              <button
                                className="danger"
                                onClick={() =>
                                  void handleTerminateAgentProcess(process.pid)
                                }
                                disabled={terminatingAgentPid === process.pid}
                              >
                                {terminatingAgentPid === process.pid
                                  ? "Terminating..."
                                  : "Terminate"}
                              </button>
                            </td>
                          </tr>
                        ))}
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
                      <NestedArtefactPanels
                        items={templateTasks}
                        basePath="/tasks"
                        renderActions={renderTaskActions}
                        renderMetadata={renderTaskMetadata}
                      />
                    </Panel>
                  )}
                  {documentTasks.length > 0 && (
                    <Panel title="Tasks">
                      <NestedArtefactPanels
                        items={documentTasks}
                        basePath="/tasks"
                        renderActions={renderTaskActions}
                        renderMetadata={renderTaskMetadata}
                      />
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

      <Modal
        open={deleteModal.open}
        title="Delete Task"
        onClose={() => {
          if (!deletingTask) {
            setDeleteModal({ open: false, name: "" });
          }
        }}
      >
        <p>
          Are you sure you want to delete task
          {deleteModal.name ? ` ${deleteModal.name}` : ""}?
        </p>
        <p className="muted">This action cannot be undone.</p>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setDeleteModal({ open: false, name: "" })}
            disabled={deletingTask}
          >
            Cancel
          </button>
          <button
            className="danger"
            onClick={() => void handleDeleteTask()}
            disabled={deletingTask}
          >
            {deletingTask ? "Deleting..." : "Delete"}
          </button>
        </div>
      </Modal>

      <Modal
        open={terminateModal}
        title="Terminate Workflow"
        onClose={() => setTerminateModal(false)}
      >
        <p>Are you sure you want to terminate this job?</p>
        {selectedWorkflow && (
          <p className="muted">Workflow: {selectedWorkflow.name}</p>
        )}
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setTerminateModal(false)}
          >
            Cancel
          </button>
          <button className="danger" onClick={handleConfirmTerminate}>
            Terminate
          </button>
        </div>
      </Modal>

      <Modal
        open={logModal.open}
        title={logModal.title}
        onClose={() => setLogModal({ open: false, title: "", content: "" })}
      >
        <pre className="workflow-log-tail">{logModal.content}</pre>
      </Modal>
    </div>
  );
};
