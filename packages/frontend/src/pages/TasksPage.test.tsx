// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TasksPage } from "./TasksPage";
import { api } from "../hooks/useApi";

vi.mock("../hooks/useApi", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useApi")>(
    "../hooks/useApi",
  );
  return {
    ...actual,
    api: {
      ...actual.api,
      listTasks: vi.fn(),
      saveTask: vi.fn(),
    },
  };
});

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("creates tasks with schedule metadata", async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.saveTask).mockResolvedValue({});

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /create task/i }));
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
