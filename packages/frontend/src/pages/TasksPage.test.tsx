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
      getWorkspaceWorkflows: vi.fn(),
    },
  };
});

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWorkspaceWorkflows).mockResolvedValue({ workflows: [] });
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
    expect(screen.getByText(/Error: captured stderr/)).toBeInTheDocument();
    expect(screen.getByText(/Stdout: line-11/)).toBeInTheDocument();
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
});
