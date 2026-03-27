// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RepositoriesPage } from "./RepositoriesPage";
import { api } from "../hooks/useApi";

vi.mock("../hooks/useApi", async () => {
  const actual = await vi.importActual<typeof import("../hooks/useApi")>(
    "../hooks/useApi",
  );
  return {
    ...actual,
    api: {
      ...actual.api,
      listRepositories: vi.fn(),
      removeRepositoryWorktree: vi.fn(),
      listRepositoryTemplates: vi.fn(),
      applyRepositoryTemplate: vi.fn(),
    },
  };
});

describe("RepositoriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows remove worktree button only for worktree repositories", async () => {
    vi.mocked(api.listRepositories).mockResolvedValue({
      repositories: [
        {
          name: "main-repo",
          path: "/tmp/main-repo",
          hasGit: true,
          isWorktreeChild: false,
          lastCommit: null,
          branch: "main",
          technology: "TypeScript",
          license: "MIT",
        },
        {
          name: "main-repo-feature",
          path: "/tmp/main-repo-feature",
          hasGit: true,
          isWorktreeChild: true,
          lastCommit: null,
          branch: "feature/test",
          technology: "TypeScript",
          license: "MIT",
        },
      ],
    });

    render(
      <MemoryRouter>
        <RepositoriesPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByLabelText("Remove main-repo-feature worktree"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Remove main-repo worktree"),
    ).not.toBeInTheDocument();
  });

  it("removes a worktree after confirmation", async () => {
    vi.mocked(api.listRepositories).mockResolvedValue({
      repositories: [
        {
          name: "main-repo-feature",
          path: "/tmp/main-repo-feature",
          hasGit: true,
          isWorktreeChild: true,
          lastCommit: null,
          branch: "feature/test",
          technology: "TypeScript",
          license: "MIT",
        },
      ],
    });
    vi.mocked(api.removeRepositoryWorktree).mockResolvedValue({
      removed: "main-repo-feature",
    });

    render(
      <MemoryRouter>
        <RepositoriesPage />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByLabelText("Remove main-repo-feature worktree"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(api.removeRepositoryWorktree).toHaveBeenCalledWith(
        "main-repo-feature",
      );
    });
  });

  it("opens template modal and applies template", async () => {
    vi.mocked(api.listRepositories).mockResolvedValue({
      repositories: [
        {
          name: "main-repo",
          path: "/tmp/main-repo",
          hasGit: true,
          isWorktreeChild: false,
          lastCommit: null,
          branch: "main",
          technology: "TypeScript",
          license: "MIT",
        },
      ],
    });
    vi.mocked(api.listRepositoryTemplates).mockResolvedValue({
      templates: ["starter-kit"],
    });
    vi.mocked(api.applyRepositoryTemplate).mockResolvedValue({
      repository: "main-repo",
      template: "starter-kit",
    });

    render(
      <MemoryRouter>
        <RepositoriesPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByLabelText("Apply template to main-repo"));

    expect(await screen.findByRole("button", { name: "starter-kit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "starter-kit" }));

    await waitFor(() => {
      expect(api.applyRepositoryTemplate).toHaveBeenCalledWith(
        "main-repo",
        "starter-kit",
      );
    });

    expect(
      await screen.findByText("Template 'starter-kit' applied successfully."),
    ).toBeInTheDocument();
  });
});
