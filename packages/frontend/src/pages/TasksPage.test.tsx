// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TasksPage } from "./TasksPage";
import { api } from "../hooks/useApi";

vi.mock("../hooks/useApi", async () => {
  const actual =
    await vi.importActual<typeof import("../hooks/useApi")>("../hooks/useApi");
  return {
    ...actual,
    api: {
      ...actual.api,
      listTasks: vi.fn(),
      saveTask: vi.fn(),
      deleteTask: vi.fn(),
      getWorkspaceWorkflows: vi.fn(),
      getWorkflowLogs: vi.fn(),
      getAgentProcesses: vi.fn(),
      terminateAgentProcess: vi.fn(),
    },
  };
});

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWorkspaceWorkflows).mockResolvedValue({ workflows: [] });
    vi.mocked(api.getWorkflowLogs).mockResolvedValue({ logs: [] });
    vi.mocked(api.getAgentProcesses).mockResolvedValue({ processes: [] });
  });

  it("renders task schedules as green schedule tags", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          name: "daily-report.md",
          frontmatter: { type: "task", schedule: "0 9 * * 1-5" },
        },
      ],
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("0 9 * * 1-5")).toBeInTheDocument();
    expect(screen.getByText("0 9 * * 1-5")).toHaveClass("success");
  });

  it("renders nested task folders and encoded task links", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          name: "Engineering/Operations/nightly-check.md",
          frontmatter: { type: "task" },
        },
      ],
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Engineering/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Operations/ }));

    const nestedTaskTitle = await screen.findByText("nightly-check.md");
    expect(nestedTaskTitle.closest("a")).toHaveAttribute(
      "href",
      "/tasks/Engineering%2FOperations%2Fnightly-check.md",
    );
  });

  it("shows workspace workflows with repository names and links to harness tab", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.getWorkspaceWorkflows).mockResolvedValue({
      workflows: [
        {
          repository: "/workspace/sample-repo",
          id: "wf_release",
          name: "Release",
          enabled: true,
          schedule: "0 8 * * 1",
          lastRun: "2026-01-02T03:04:05Z",
          diagnostics: {
            lastStartedAt: "2026-01-02T03:00:00Z",
            lastFinishedAt: "2026-01-02T03:04:05Z",
            lastDurationMs: 245000,
            lastExitCode: 0,
            lastError: null,
            lastStdout: null,
            lastStderr: null,
            running: false,
          },
        },
      ],
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("0 8 * * 1")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Release" });
    expect(link).toHaveAttribute(
      "href",
      "/repositories/sample-repo?tab=harnesses",
    );
    expect(screen.getByLabelText("Release enabled")).toBeChecked();
    expect(screen.getByText("sample-repo")).toBeInTheDocument();
    expect(screen.getByText("Last run")).toBeInTheDocument();
    expect(
      screen.getAllByText(/2026|1\/2\/2026|2\/1\/2026/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Exit 0")).toBeInTheDocument();
  });

  it("shows fallback last-run labels for non-cron and never-run workflows", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.getWorkspaceWorkflows).mockResolvedValue({
      workflows: [
        {
          repository: "repo-a",
          id: "wf_no_cron",
          name: "No Cron",
          enabled: true,
          schedule: null,
          lastRun: null,
        },
        {
          repository: "repo-b",
          id: "wf_never",
          name: "Never Run",
          enabled: true,
          schedule: "0 8 * * 1",
          lastRun: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("n.a.")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("links scheduled tasks from .made/tasks to task detail page", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.getWorkspaceWorkflows).mockResolvedValue({
      workflows: [
        {
          repository: ".made/tasks",
          id: "task:daily-report.md",
          name: "daily-report.md",
          enabled: true,
          schedule: "0 8 * * 1",
          lastRun: null,
          diagnostics: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link", { name: "daily-report.md" });
    expect(link).toHaveAttribute("href", "/tasks/daily-report.md");
    expect(screen.getByText("tasks")).toBeInTheDocument();
  });

  it("prefers stderr diagnostics output in overview", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.getWorkspaceWorkflows).mockResolvedValue({
      workflows: [
        {
          repository: "repo-a",
          id: "wf_stderr",
          name: "Show stderr",
          enabled: true,
          schedule: "0 8 * * 1",
          diagnostics: {
            lastExitCode: 1,
            lastError: "captured stderr summary",
            lastStdout: "line-11\nline-12",
            lastStderr: "captured stderr",
            running: false,
          },
        },
      ],
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("captured stderr")).toBeInTheDocument();
    expect(screen.getByText("Stdout")).toBeInTheDocument();
    expect(screen.getByText(/line-11/)).toBeInTheDocument();
  });

  it("shows fallback diagnostics label when no diagnostics exist", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.getWorkspaceWorkflows).mockResolvedValue({
      workflows: [
        {
          repository: "repo-a",
          id: "wf_no_diagnostics",
          name: "No Diagnostics",
          enabled: true,
          schedule: "0 8 * * 1",
          lastRun: null,
          diagnostics: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No diagnostics yet")).toBeInTheDocument();
  });

  it("creates tasks with schedule metadata", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.saveTask).mockResolvedValue({});

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /create task/i }),
    );
    fireEvent.change(screen.getByLabelText(/file name/i), {
      target: { value: "new-task" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(api.saveTask).toHaveBeenCalledWith("new-task.md", {
        content: "# New Task\n\n- [ ] Define work\n",
        frontmatter: { type: "task", schedule: "" },
      });
    });
  });

  it("renders and terminates running agent CLI processes", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.getAgentProcesses)
      .mockResolvedValueOnce({
        processes: [
          {
            pid: 1234,
            ppid: 1,
            executable: "codex",
            command: "codex exec --json",
            workingDirectory: "/workspace/made",
          },
        ],
      })
      .mockResolvedValueOnce({ processes: [] });
    vi.mocked(api.terminateAgentProcess).mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Running Agent CLI Processes"),
    ).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("/workspace/made")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Terminate" }));

    await waitFor(() => {
      expect(api.terminateAgentProcess).toHaveBeenCalledWith(1234);
    });
  });

  it("paginates available workflow logs with five rows per page", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.getWorkflowLogs).mockResolvedValue({
      logs: Array.from({ length: 7 }, (_, index) => ({
        location: "workspace",
        name: `log-${index + 1}.txt`,
        path: `/logs/log-${index + 1}.txt`,
        modifiedAt: `2026-01-0${(index % 9) + 1}T10:00:00Z`,
        sizeBytes: 120 + index,
      })),
    });

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("log-1.txt")).toBeInTheDocument();
    expect(screen.getByText("log-5.txt")).toBeInTheDocument();
    expect(screen.queryByText("log-6.txt")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("log-6.txt")).toBeInTheDocument();
    expect(screen.getByText("log-7.txt")).toBeInTheDocument();
    expect(screen.queryByText("log-1.txt")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("deletes a task after confirmation", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({
      tasks: [
        {
          name: "cleanup.md",
          frontmatter: { type: "task" },
        },
      ],
    });
    vi.mocked(api.deleteTask).mockResolvedValue({});

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByLabelText("Delete task cleanup.md"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(api.deleteTask).toHaveBeenCalledWith("cleanup.md");
    });
  });
});
