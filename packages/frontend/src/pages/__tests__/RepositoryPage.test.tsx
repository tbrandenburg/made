// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RepositoryPage } from "../RepositoryPage";
import { api, ChatSession } from "../../hooks/useApi";

vi.mock("../../hooks/useApi", async () => {
  const actual =
    await vi.importActual<typeof import("../../hooks/useApi")>("../../hooks/useApi");
  return {
    ...actual,
    api: {
      ...actual.api,
      getRepositoryAgentSessions: vi.fn(),
      getRepositoryAgentHistory: vi.fn(),
    },
  };
});

const sessionA: ChatSession = {
  id: "session-a",
  title: "Session A",
  updated: "2026-01-01",
};
const sessionB: ChatSession = {
  id: "session-b",
  title: "Session B",
  updated: "2026-01-02",
};

const emptyHistory = { sessionId: "", messages: [] };

function renderPage(initialEntries = ["/repositories/test-repo?tab=agent"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/repositories/:name/*" element={<RepositoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RepositoryPage session selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
  });

  it("AC1: selects session from modal — exactly 1 API call (fails on unfixed code: 3 calls)", async () => {
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderPage();

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    const sessionBtn = await screen.findByTitle("Session A");
    fireEvent.click(sessionBtn);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("AC2: page loads with ?sessionId=X — exactly 1 API call (fails on unfixed code: 3 calls)", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("AC7: re-selecting the same active session is a no-op (fails on unfixed code: clears chat + fires 3 calls)", async () => {
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderPage();

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    const sessionBtn = await screen.findByTitle("Session A");
    fireEvent.click(sessionBtn);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    fireEvent.click(chooseBtn);

    await screen.findByTitle("Session A");

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    fireEvent.click(sessionBtn);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).not.toHaveBeenCalled();
    });
  });
});
