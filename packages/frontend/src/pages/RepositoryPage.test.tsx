// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, ChatSession } from "../hooks/useApi";

let onSessionSelect: ((session: ChatSession) => void) | null = null;

vi.mock("../components/SessionPickerModal", () => ({
  default: ({
    onSelect,
  }: {
    open: boolean;
    onSelect: (session: ChatSession) => void;
  }) => {
    onSessionSelect = onSelect;
    return null;
  },
}));

const SESSIONS_A = {
  id: "sess-a",
  title: "Session A",
  updated: "2024-06-01T00:00:00Z",
} as ChatSession;

const SESSIONS_B = {
  id: "sess-b",
  title: "Session B",
  updated: "2024-06-02T00:00:00Z",
} as ChatSession;

vi.mock("../hooks/useApi", async () => {
  const actual =
    await vi.importActual<typeof import("../hooks/useApi")>("../hooks/useApi");
  return {
    ...actual,
    api: {
      ...actual.api,
      getRepository: vi.fn().mockResolvedValue({
        name: "test-repo",
        path: "/tmp/test-repo",
        hasGit: false,
        lastCommit: null,
        branch: "main",
        technology: "TypeScript",
        license: "MIT",
      }),
      getRepositoryFiles: vi.fn().mockResolvedValue({
        name: "test-repo",
        path: ".",
        type: "folder",
        children: [],
      }),
      getRepositoryCommands: vi.fn().mockResolvedValue({ commands: [] }),
      getRepositoryHarnesses: vi.fn().mockResolvedValue({ harnesses: [] }),
      getRepositoryAgentSessions: vi.fn().mockResolvedValue({
        sessions: [
          {
            id: "sess-a",
            title: "Session A",
            updated: "2024-06-01T00:00:00Z",
          },
          {
            id: "sess-b",
            title: "Session B",
            updated: "2024-06-02T00:00:00Z",
          },
        ],
      }),
      getRepositoryAgentHistory: vi.fn().mockResolvedValue({
        sessionId: "sess-a",
        messages: [
          {
            messageId: "msg-1",
            role: "user",
            type: "text",
            content: "Session content",
            timestamp: "2024-06-01T00:00:00.000Z",
          },
        ],
      }),
      getRepositoryAgentStatus: vi.fn().mockResolvedValue({ processing: false }),
      getRepositoryTodos: vi.fn().mockResolvedValue({ todos: [] }),
      getRepositoryAgents: vi.fn().mockResolvedValue({ agents: [] }),
      getSettings: vi.fn().mockResolvedValue({}),
      sendAgentMessage: vi.fn().mockResolvedValue({
        messageId: "msg-new",
        sent: "2024-06-01T00:00:00Z",
        response: "OK",
        sessionId: "sess-new",
        processing: false,
      }),
    },
  };
});

import { RepositoryPage } from "./RepositoryPage";

const renderPage = () => {
  onSessionSelect = null;
  return render(
    <MemoryRouter initialEntries={["/repositories/test-repo"]}>
      <Routes>
        <Route path="/repositories/:name" element={<RepositoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe("RepositoryPage session-select (failing tests for fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    onSessionSelect = null;
  });

  it("UT-1: handleSessionSelect does not call getRepositoryAgentHistory (synchronous dumb setter)", async () => {
    renderPage();
    await waitFor(() => expect(onSessionSelect).not.toBeNull());

    await act(async () => {
      onSessionSelect!(SESSIONS_A);
    });

    expect(vi.mocked(api.getRepositoryAgentHistory)).not.toHaveBeenCalled();
  });

  it("UT-2: selecting a session triggers exactly one API call via Effect 1", async () => {
    renderPage();
    await waitFor(() => expect(onSessionSelect).not.toBeNull());

    await act(async () => {
      onSessionSelect!(SESSIONS_A);
    });

    await waitFor(
      () => {
        expect(vi.mocked(api.getRepositoryAgentHistory)).toHaveBeenCalledTimes(
          1,
        );
      },
      { timeout: 3000 },
    );
  });

  it("UT-4: second session gets full fetch (startTimestamp === undefined)", async () => {
    renderPage();
    await waitFor(() => expect(onSessionSelect).not.toBeNull());

    await act(async () => {
      onSessionSelect!(SESSIONS_B);
    });
    await waitFor(() => {
      expect(vi.mocked(api.getRepositoryAgentHistory)).toHaveBeenCalled();
    });

    const callArgs =
      vi.mocked(api.getRepositoryAgentHistory).mock.calls[0];
    expect(callArgs[2]).toBeUndefined();
  });
});
