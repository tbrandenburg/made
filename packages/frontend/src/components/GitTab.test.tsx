// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitTab } from "./GitTab";

const status = {
  branch: "main",
  aheadBehind: { ahead: 1, behind: 2 },
  lineStats: { green: 10, red: 4 },
  lastCommit: { id: "abcdef123456", date: "2024-01-01T00:00:00Z" },
  counts: { issues: 3, pullRequests: 4, branches: 5, worktrees: 2 },
  links: {
    repo: "https://github.com/org/repo",
    issues: "https://github.com/org/repo/issues",
    pulls: "https://github.com/org/repo/pulls",
    branches: "https://github.com/org/repo/branches",
    commit: "https://github.com/org/repo/commit/abcdef123456",
  },
  diff: [{ path: "src/App.tsx", green: 8, red: 2 }],
};

describe("GitTab", () => {
  it("renders status and diff", () => {
    render(
      <GitTab
        status={status}
        loading={false}
        error={null}
        pulling={false}
        creatingWorktree={false}
        onRefresh={vi.fn()}
        onPull={vi.fn()}
        onCreateWorktree={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(screen.getByText("Branch")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/App.tsx" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "abcdef12" })).toBeInTheDocument();
  });

  it("invokes actions", () => {
    const onPull = vi.fn();
    const onCreateWorktree = vi.fn();
    const onOpenFile = vi.fn();

    render(
      <GitTab
        status={status}
        loading={false}
        error={null}
        pulling={false}
        creatingWorktree={false}
        onRefresh={vi.fn()}
        onPull={onPull}
        onCreateWorktree={onCreateWorktree}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "src/App.tsx" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/App.tsx");

    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    expect(onPull).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));
    fireEvent.change(screen.getByLabelText("Directory name"), {
      target: { value: "repo-worktree" },
    });
    fireEvent.change(screen.getByLabelText("Branch name"), {
      target: { value: "feature/test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onCreateWorktree).toHaveBeenCalledWith("repo-worktree", "feature/test");
  });
});
