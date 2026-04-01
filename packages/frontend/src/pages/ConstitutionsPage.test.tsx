// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConstitutionsPage } from "./ConstitutionsPage";
import { api } from "../hooks/useApi";

vi.mock("../hooks/useApi", async () => {
  const actual =
    await vi.importActual<typeof import("../hooks/useApi")>("../hooks/useApi");
  return {
    ...actual,
    api: {
      ...actual.api,
      listConstitutions: vi.fn(),
      deleteConstitution: vi.fn(),
    },
  };
});

vi.mock("../utils/externalLinks", () => ({
  addExternalMatterLink: vi.fn(),
  listExternalMatter: vi.fn(() => []),
  removeExternalMatterLink: vi.fn(),
}));

describe("ConstitutionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a constitution document after modal confirmation", async () => {
    vi.mocked(api.listConstitutions).mockResolvedValue({
      constitutions: [
        {
          name: "governance.md",
          type: "global",
          tags: [],
          content: "",
          frontmatter: {},
        },
      ],
    });
    vi.mocked(api.deleteConstitution).mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <ConstitutionsPage />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByLabelText("Remove constitution governance.md"),
    );

    expect(
      screen.getByText("Are you sure you want to remove governance.md?"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(api.deleteConstitution).toHaveBeenCalledWith("governance.md");
    });
  });

  it("renders nested constitution folders", async () => {
    vi.mocked(api.listConstitutions).mockResolvedValue({
      constitutions: [
        {
          name: "Global/Runtime/policy.md",
          type: "global",
          tags: [],
          content: "",
          frontmatter: {},
        },
      ],
    });

    render(
      <MemoryRouter>
        <ConstitutionsPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Global/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Runtime/ }));

    expect(await screen.findByRole("link", { name: "policy.md" })).toHaveAttribute(
      "href",
      "/constitutions/Global%2FRuntime%2Fpolicy.md",
    );
  });
});
