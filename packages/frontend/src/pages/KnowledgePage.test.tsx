// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KnowledgePage } from "./KnowledgePage";
import { api } from "../hooks/useApi";

vi.mock("../hooks/useApi", async () => {
  const actual =
    await vi.importActual<typeof import("../hooks/useApi")>("../hooks/useApi");
  return {
    ...actual,
    api: {
      ...actual.api,
      listKnowledge: vi.fn(),
      deleteKnowledge: vi.fn(),
    },
  };
});

vi.mock("../utils/externalLinks", () => ({
  addExternalMatterLink: vi.fn(),
  listExternalMatter: vi.fn(() => []),
  removeExternalMatterLink: vi.fn(),
}));

describe("KnowledgePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a knowledge document after modal confirmation", async () => {
    vi.mocked(api.listKnowledge).mockResolvedValue({
      artefacts: [
        {
          name: "guide.md",
          type: "document",
          tags: [],
          content: "",
          frontmatter: {},
        },
      ],
    });
    vi.mocked(api.deleteKnowledge).mockResolvedValue({ success: true });

    render(
      <MemoryRouter>
        <KnowledgePage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByLabelText("Remove artefact guide.md"));

    expect(
      screen.getByText("Are you sure you want to remove guide.md?"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(api.deleteKnowledge).toHaveBeenCalledWith("guide.md");
    });
  });

  it("renders nested folders and links nested artefacts with encoded paths", async () => {
    vi.mocked(api.listKnowledge).mockResolvedValue({
      artefacts: [
        {
          name: "Engineering/Architecture/guide.md",
          type: "document",
          tags: [],
          content: "",
          frontmatter: {},
        },
      ],
    });

    render(
      <MemoryRouter>
        <KnowledgePage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Engineering/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Architecture/ }),
    );

    const nestedTitle = await screen.findByText("guide.md");
    expect(nestedTitle.closest("a")).toHaveAttribute(
      "href",
      "/knowledge/Engineering%2FArchitecture%2Fguide.md",
    );
  });
});
