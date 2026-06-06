// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RepositoryPage } from "../RepositoryPage";
import {
  api,
  ChatHistoryMessage,
  ChatHistoryResponse,
  ChatSession,
} from "../../hooks/useApi";

vi.mock("react-virtuoso", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    Virtuoso: ReactModule.forwardRef<
      { scrollToIndex: (opts: unknown) => void },
      {
        data: unknown[];
        itemContent: (i: number, d: unknown) => React.ReactNode;
      }
    >(function MockVirtuoso({ data, itemContent }, ref) {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
      return ReactModule.createElement(
        "div",
        { "data-testid": "virtuoso" },
        data.map((item, i) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            { key: i },
            itemContent(i, item),
          ),
        ),
      );
    }),
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

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
    let resolveB: (value: ChatHistoryResponse) => void;
    const promise = new Promise<ChatHistoryResponse>((resolve) => {
      resolveB = resolve;
    });

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce(historyA)
      .mockResolvedValueOnce(promise);

    renderPage();

    // Select session A
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    // Select session B
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    await screen.findByTitle("Session B");
    fireEvent.click(screen.getByTitle("Session B"));

    // AC490-1: Old content absent from DOM after clicking new session
    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();

    // AC490-2: Empty-state container present while fetch pending (no stale content)
    expect(document.querySelector(".empty")).toBeInTheDocument();

    // Resolve B's fetch
    resolveB!(historyB);

    // AC490-3: New session content rendered after fetch resolves
    expect(await screen.findByText("Hello from B")).toBeInTheDocument();
  });
});
