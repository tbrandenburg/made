// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RepositoryPage } from "../RepositoryPage";
import {
  api,
  AgentReply,
  ChatHistoryMessage,
  ChatHistoryResponse,
  ChatSession,
} from "../../hooks/useApi";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("react-virtuoso", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    Virtuoso: ReactModule.forwardRef<
      { scrollToIndex: (opts: unknown) => void },
      {
        data: unknown[];
        itemContent: (index: number, item: unknown) => ReactNode;
      }
    >(function MockVirtuoso({ data, itemContent }, ref) {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
      return ReactModule.createElement(
        "div",
        { "data-testid": "virtuoso" },
        data.map((item, index) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            { key: index },
            itemContent(index, item),
          ),
        ),
      );
    }),
  };
});

vi.mock("../../hooks/useApi", async () => {
  const actual =
    await vi.importActual<typeof import("../../hooks/useApi")>(
      "../../hooks/useApi",
    );
  return {
    ...actual,
    api: {
      ...actual.api,
      getRepositoryAgentSessions: vi.fn(),
      getRepositoryAgentHistory: vi.fn(),
      sendAgentMessage: vi.fn(),
      getRepositoryAgentStatus: vi.fn().mockResolvedValue({ processing: false }),
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
    localStorage.clear();
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

    const reopenedSessionBtn = await screen.findByTitle("Session A");

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    fireEvent.click(reopenedSessionBtn);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).not.toHaveBeenCalled();
    });
  });

  it("adversarial: session select clears previous fetch error (AC5)", async () => {
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });

    renderPage();

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    vi.mocked(api.getRepositoryAgentHistory).mockRejectedValue(
      new Error("Network failure"),
    );

    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(
      () => {
        expect(screen.getByText("Network failure")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);

    fireEvent.click(chooseBtn);
    await screen.findByTitle("Session B");
    fireEvent.click(screen.getByTitle("Session B"));

    await waitFor(() => {
      expect(screen.queryByText("Network failure")).not.toBeInTheDocument();
    });
  });

  it("adversarial: selecting session with empty string ID does not crash", async () => {
    const emptyIdSession: ChatSession = {
      id: "",
      title: "Empty ID Session",
      updated: "2026-01-01",
    };

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [emptyIdSession],
    });

    renderPage();

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    const sessionBtn = await screen.findByTitle("Empty ID Session");
    expect(() => fireEvent.click(sessionBtn)).not.toThrow();
  });

  it("clears stale content, shows empty transient state, then renders new session messages on switch (AC490-1/2/3)", async () => {
    const sessionAMsg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const sessionBMsg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B",
      timestamp: "2026-01-02T00:00:00Z",
    };
    const historyA = { sessionId: "session-a", messages: [sessionAMsg] };
    const historyB = { sessionId: "session-b", messages: [sessionBMsg] };
    let resolveB: (value: ChatHistoryResponse) => void = () => {};
    const promise = new Promise<ChatHistoryResponse>((resolve) => {
      resolveB = resolve;
    });

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce(historyA)
      .mockReturnValueOnce(promise);

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    await screen.findByTitle("Session B");
    fireEvent.click(screen.getByTitle("Session B"));

    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();

    expect(document.querySelector(".empty")).toBeInTheDocument();

    resolveB(historyB);

    expect(await screen.findByText("Hello from B")).toBeInTheDocument();
  });

  it("adversarial: deferred promise rejection on session switch shows error and preserves empty state", async () => {
    const sessionAMsg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const historyA = { sessionId: "session-a", messages: [sessionAMsg] };
    let rejectB: (reason: Error) => void;
    const promise = new Promise<ChatHistoryResponse>((_, reject) => {
      rejectB = reject;
    });

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce(historyA)
      .mockReturnValueOnce(promise);

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    await screen.findByTitle("Session B");
    fireEvent.click(screen.getByTitle("Session B"));

    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();
    expect(document.querySelector(".empty")).toBeInTheDocument();

    rejectB!(new Error("Fetch failed"));

    await waitFor(() => {
      expect(screen.getByText("Fetch failed")).toBeInTheDocument();
    });

    expect(document.querySelector(".empty")).toBeInTheDocument();
    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();
  });

  it("adversarial: empty history response on session switch preserves empty state without error", async () => {
    const sessionAMsg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const historyA = { sessionId: "session-a", messages: [sessionAMsg] };
    let resolveB: (value: ChatHistoryResponse) => void;
    const promise = new Promise<ChatHistoryResponse>((resolve) => {
      resolveB = resolve;
    });

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce(historyA)
      .mockReturnValueOnce(promise);

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    await screen.findByTitle("Session B");
    fireEvent.click(screen.getByTitle("Session B"));

    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();
    expect(document.querySelector(".empty")).toBeInTheDocument();

    resolveB!({ sessionId: "session-b", messages: [] });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(document.querySelector(".empty")).toBeInTheDocument();
    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".alert").length).toBe(0);
  });

  it("resets chatLoading when switching sessions while agent is processing (AC493-1)", async () => {
    const sendPromise = new Promise<AgentReply>(() => {});
    vi.mocked(api.sendAgentMessage).mockReturnValue(sendPromise);

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);

    vi.mocked(api.getRepositoryAgentStatus).mockReturnValue(
      new Promise(() => {}),
    );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(
      screen.getByPlaceholderText("Describe the change or ask the agent..."),
      { target: { value: "hello" } },
    );

    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(screen.queryByText("Send")).not.toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(screen.getByText("Send")).toBeInTheDocument();
      expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    });
  });
});
