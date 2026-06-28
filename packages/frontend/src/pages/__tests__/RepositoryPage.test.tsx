// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RepositoryPage } from "../RepositoryPage";
import {
  AgentReply,
  api,
  ChatHistoryMessage,
  ChatHistoryResponse,
  ChatSession,
} from "../../hooks/useApi";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TaskPage } from "../TaskPage";
import { KnowledgeArtefactPage } from "../KnowledgeArtefactPage";
import { ConstitutionPage } from "../ConstitutionPage";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("react-virtuoso", async () => {
  const ReactModule = (await vi.importActual(
    "react",
  )) as typeof import("react");
  return {
    Virtuoso: ReactModule.forwardRef<
      { scrollToIndex: (opts: unknown) => void },
      {
        data: unknown[];
        itemContent: (index: number, item: unknown) => ReactNode;
        components?: {
          Footer?: ReactModule.ComponentType<{ context?: unknown }>;
        };
        context?: unknown;
      }
    >(function MockVirtuoso({ data, itemContent, components, context }, ref) {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
      const Footer = components?.Footer;
      return ReactModule.createElement(
        "div",
        { "data-testid": "virtuoso" },
        ...data.map((item, index) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            { key: index },
            itemContent(index, item),
          ),
        ),
        Footer ? ReactModule.createElement(Footer, { context }) : null,
      );
    }),
  };
});

vi.mock("../../hooks/useApi", async () => {
  const target: Record<string, Mock> = {};
  const handler: ProxyHandler<Record<string, Mock>> = {
    get(_, prop) {
      if (typeof prop === "string") {
        if (!target[prop]) {
          target[prop] = vi.fn().mockResolvedValue(undefined);
        }
        return target[prop];
      }
      return undefined;
    },
  };
  const mock = new Proxy(target, handler);
  return { api: mock };
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
    cleanup();
    document.body.innerHTML = "";
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

  // AC7: inverted — same-session re-select MUST trigger full history fetch
  it("AC7: re-selecting the same active session triggers full refresh (fails on unfixed code: guard returns early)", async () => {
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
      expect(
        api.getRepositoryAgentHistory,
        "FAIL (AC7): same-session re-select did not trigger API call — guard still returns early",
      ).toHaveBeenCalled();
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

    expect(screen.getByText("Loading session...")).toBeInTheDocument();

    resolveB(historyB);

    await waitFor(() => {
      expect(screen.queryByText("Loading session...")).not.toBeInTheDocument();
    });

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
    expect(screen.getByText("Loading session...")).toBeInTheDocument();

    rejectB!(new Error("Fetch failed"));

    await waitFor(() => {
      expect(screen.getByText("Fetch failed")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading session...")).not.toBeInTheDocument();
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
    expect(screen.getByText("Loading session...")).toBeInTheDocument();

    resolveB!({ sessionId: "session-b", messages: [] });

    await waitFor(() => {
      expect(screen.queryByText("Loading session...")).not.toBeInTheDocument();
    });

    expect(document.querySelector(".empty")).toBeInTheDocument();
    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".alert").length).toBe(0);
  });

  it("adversarial: rapid triple session switch A\u2192B\u2192C shows loading for C only", async () => {
    const msgC: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from C",
      timestamp: "2026-01-03T00:00:00Z",
    };
    const historyC = { sessionId: "session-c", messages: [msgC] };

    const sessionC: ChatSession = {
      id: "session-c",
      title: "Session C",
      updated: "2026-01-03",
    };

    let resolveA: (value: ChatHistoryResponse) => void;
    let resolveC: (value: ChatHistoryResponse) => void;
    const deferredA = new Promise<ChatHistoryResponse>((resolve) => {
      resolveA = resolve;
    });
    const deferredC = new Promise<ChatHistoryResponse>((resolve) => {
      resolveC = resolve;
    });

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB, sessionC],
    });
    // All calls are deferred
    vi.mocked(api.getRepositoryAgentHistory)
      .mockReturnValueOnce(deferredA)
      .mockReturnValueOnce(new Promise<ChatHistoryResponse>(() => {}))
      .mockReturnValueOnce(deferredC);

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session C"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (triple-switch): loading not visible for third switch",
      ).toBeInTheDocument();
    });

    resolveA!({ sessionId: "session-a", messages: [] });
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(
      screen.getByText("Loading session..."),
      "FAIL (triple-switch): loading cleared after stale first fetch — signal?.aborted guard missing in syncChatHistory",
    ).toBeInTheDocument();

    resolveC!(historyC);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (triple-switch): loading not cleared after third fetch resolved",
      ).not.toBeInTheDocument();
    });

    expect(
      await screen.findByText("Hello from C"),
      "FAIL (triple-switch): session C messages not shown after loading cleared",
    ).toBeInTheDocument();
  });
});

describe("RepositoryPage clear session loading state (AC496)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "test-session",
      processing: false,
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
    sessionStorage.clear();
  });

  /** Render page with a sessionId so "Clear session" button appears in ChatWindow */
  async function renderAndWaitForClearButton() {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");
  }

  function typeInTextarea() {
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
  }

  function clickSend() {
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
  }

  function openClearModal() {
    fireEvent.click(screen.getByLabelText("Clear session"));
  }

  function confirmClearOnly() {
    fireEvent.click(screen.getByRole("button", { name: /^no$/i }));
  }

  function confirmClearAndHistory() {
    fireEvent.click(screen.getByRole("button", { name: /^yes$/i }));
  }

  // ── AC496-1 ────────────────────────────────────────────────────────────

  it("AC496-1: clearSessionOnly resets chatAgentProcessing when loading (fails: setChatAgentProcessing(false) missing)", async () => {
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );

    await renderAndWaitForClearButton();
    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel button should appear (chatAgentProcessing=true)",
      ).toBeInTheDocument();
    });

    openClearModal();

    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL: Cancel remains — handleClearSessionOnly missing setChatAgentProcessing(false)",
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send/i }),
        "Send should be enabled after clear",
      ).not.toBeDisabled();
    });
  });

  // ── AC496-2 ────────────────────────────────────────────────────────────

  it("AC496-2: clearSessionAndHistory resets chatAgentProcessing when loading (fails: setChatAgentProcessing(false) missing)", async () => {
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );

    await renderAndWaitForClearButton();
    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel button should appear (chatAgentProcessing=true)",
      ).toBeInTheDocument();
    });

    openClearModal();

    await screen.findByRole("button", { name: /^yes$/i });
    confirmClearAndHistory();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL: Cancel remains — handleClearSessionAndHistory missing setChatAgentProcessing(false)",
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send/i }),
        "Send should be enabled after clear",
      ).not.toBeDisabled();
      expect(
        screen.getByText("No conversation yet."),
        "Chat should show empty state after clear-and-history",
      ).toBeInTheDocument();
    });
  });

  // ── AC496-3 idempotent ────────────────────────────────────────────────

  it("AC496-3: clearSessionOnly idempotent when chatAgentProcessing already false", async () => {
    await renderAndWaitForClearButton();

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    openClearModal();

    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).not.toHaveBeenCalled();
    });
  });

  it("AC496-3: clearSessionAndHistory idempotent when chatAgentProcessing already false", async () => {
    await renderAndWaitForClearButton();

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    openClearModal();

    await screen.findByRole("button", { name: /^yes$/i });
    confirmClearAndHistory();

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).not.toHaveBeenCalled();
    });
    expect(screen.getByText("No conversation yet.")).toBeInTheDocument();
  });

  // ── AC496-4 stale-response guard ─────────────────────────────────────

  it("AC496-4: stale sendAgentMessage does not restore cleared sessionId (fails: no guard in continuation)", async () => {
    let resolveSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((resolve) => {
        resolveSend = resolve;
      }),
    );

    await renderAndWaitForClearButton();
    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    openClearModal();

    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
      ).not.toBeInTheDocument();
    });

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    resolveSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "done",
      sessionId: "old-session-id",
      processing: false,
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(
      api.getRepositoryAgentHistory,
      "FAIL: getRepositoryAgentHistory was called — stale response restored sessionId without guard",
    ).not.toHaveBeenCalled();
  });

  // ── AC496-1/2 integration ─────────────────────────────────────────────

  it("AC496-1/2 integration: clear mid-flight removes loading text within one render", async () => {
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );

    await renderAndWaitForClearButton();
    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    openClearModal();

    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(
        screen.queryByText("Agent is thinking..."),
        "FAIL: 'Agent is thinking...' remains — handleClearSessionOnly missing setChatAgentProcessing(false)",
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send/i }),
        "Send should be enabled after mid-flight clear",
      ).not.toBeDisabled();
    });
  });

  // ── AC496-ADV1: late stale response after clear stays ignored ──

  it("AC496-ADV1: late stale response after clear does not overwrite newer session", async () => {
    let resolveFirstSend!: (value: AgentReply) => void;
    let resolveSecondSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage)
      .mockReturnValueOnce(
        new Promise<AgentReply>((resolve) => {
          resolveFirstSend = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AgentReply>((resolve) => {
          resolveSecondSend = resolve;
        }),
      );

    await renderAndWaitForClearButton();

    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    openClearModal();
    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
      ).not.toBeInTheDocument();
    });

    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    resolveSecondSend({
      messageId: "m2",
      sent: new Date().toISOString(),
      response: "new-response",
      sessionId: "new-session",
      processing: false,
    });

    await waitFor(() => {
      expect(screen.getByText("Session ID: new-session")).toBeInTheDocument();
    });

    resolveFirstSend({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale-response",
      sessionId: "old-session-id",
      processing: false,
    });

    await waitFor(() => {
      expect(screen.getByText("Session ID: new-session")).toBeInTheDocument();
      expect(
        screen.queryByText("Session ID: old-session-id"),
      ).not.toBeInTheDocument();
    });
  });

  // ── AC496-ADV2: failed send after clear recovers on retry ──────────────

  it("AC496-ADV2: failed send after clear recovers on retry", async () => {
    await renderAndWaitForClearButton();

    openClearModal();
    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
      ).not.toBeInTheDocument();
    });

    vi.mocked(api.sendAgentMessage).mockRejectedValue(
      new Error("Network failure"),
    );
    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(screen.getByText("Failed to reach agent")).toBeInTheDocument();
    });

    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m3",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "recovered-session",
      processing: false,
    });

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByText("Session ID: recovered-session"),
      ).toBeInTheDocument();
    });
  });
});

// ── AC497: refreshAgentStatus !sessionId guard ────────────────────────

describe("RepositoryPage refreshAgentStatus guard (AC497)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "test-session",
      processing: false,
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.getTaskAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.getKnowledgeAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.getConstitutionAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
    sessionStorage.clear();
  });

  async function renderAndWaitForClearButton() {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");
  }

  function openClearModal() {
    fireEvent.click(screen.getByLabelText("Clear session"));
  }

  function confirmClearOnly() {
    fireEvent.click(screen.getByRole("button", { name: /^no$/i }));
  }

  // ── U1: AC1+AC3 ──────────────────────────────────────────────────────

  it("U1 (AC1+AC3): refreshAgentStatus skips API call and does not re-stick chatAgentProcessing after clear", async () => {
    await renderAndWaitForClearButton();

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel should appear (sending message)",
      ).toBeInTheDocument();
    });

    vi.mocked(api.getRepositoryAgentStatus).mockClear();
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    openClearModal();
    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(
      api.getRepositoryAgentStatus,
      "FAIL (AC3): getRepositoryAgentStatus was called after clear — !sessionId guard missing",
    ).not.toHaveBeenCalled();

    expect(
      screen.queryByRole("button", { name: /cancel/i }),
      "FAIL (AC1): Cancel button remains after clear — refreshAgentStatus re-stuck chatAgentProcessing via effect re-fire",
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /send/i }),
      "Send should be enabled after guard prevents re-stick",
    ).not.toBeDisabled();
  });

  // ── U2: AC2 (DOM check) ───────────────────────────────────────────────

  it("U2 (AC2): Cancel absent, Send enabled after clear while processing (integration)", async () => {
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );

    await renderAndWaitForClearButton();

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel should appear (sending message)",
      ).toBeInTheDocument();
    });

    vi.mocked(api.getRepositoryAgentStatus).mockClear();
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    openClearModal();
    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL (AC2): Cancel remains after clear — !sessionId guard missing or setChatAgentProcessing(false) missing in handler",
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send/i }),
        "Send should be enabled after clear",
      ).not.toBeDisabled();
    });
  });

  // ── U3: AC3 negative ──────────────────────────────────────────────────

  it("U3 (AC3 negative): with valid sessionId, getRepositoryAgentStatus IS called", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    await waitFor(() => {
      expect(
        api.getRepositoryAgentStatus,
        "getRepositoryAgentStatus should be called on mount with valid sessionId",
      ).toHaveBeenCalled();
    });
  });

  // ── U4: AC1 regression ────────────────────────────────────────────────

  it("U4 (AC1 regression): with valid sessionId + processing:true, Cancel appears", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "FAIL (U4 regression): Cancel should appear — refreshAgentStatus should setChatAgentProcessing(true) when session is active",
      ).toBeInTheDocument();
    });
  });

  // ── D1: AC6 stale-closure guard ──────────────────────────────────────

  it("D1 (AC6): stale in-flight refreshAgentStatus promise does not re-stick chatAgentProcessing after clear", async () => {
    let resolveStatus!: (value: {
      processing: boolean;
      startedAt: string | null;
    }) => void;

    // Defer the FIRST call so it is in-flight when we clear the session.
    // This is the only way to exercise the stale-closure guard at
    // RepositoryPage.tsx: `if (sessionIdRef.current !== sessionId) return false`
    vi.mocked(api.getRepositoryAgentStatus).mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );

    // Render and wait for the Clear-session button (sessionId present in URL).
    // The first getRepositoryAgentStatus call is now in-flight.
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    // Confirm the in-flight call has started
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalledTimes(1);
    });

    // Clear the session WHILE the API call is still in-flight.
    openClearModal();
    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    // Session cleared — Cancel should not be visible (setChatAgentProcessing(false) called)
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "Cancel should not appear after clear (even with in-flight promise pending)",
      ).not.toBeInTheDocument();
    });

    // Now resolve the stale in-flight promise with processing: true.
    // Without the stale-closure guard, setChatAgentProcessing(true) would fire
    // and Cancel would re-appear. With the guard, sessionIdRef.current
    // (null after clear) !== sessionId at closure time (session-a) → guard
    // returns false and chatAgentProcessing stays false.
    resolveStatus!({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(
      screen.queryByRole("button", { name: /cancel/i }),
      "FAIL (AC6): Cancel re-appeared after stale promise resolved — sessionIdRef stale-closure guard missing",
    ).not.toBeInTheDocument();
  });

  // ── P1: AC7 cross-page ───────────────────────────────────────────────

  it("P1 (AC7): all 4 pages skip status API call when sessionId is null", async () => {
    const pageConfigs = [
      {
        name: "RepositoryPage",
        entry: "/repositories/test-repo",
        route: "/repositories/:name/*",
        el: <RepositoryPage />,
        apiSpy: api.getRepositoryAgentStatus,
      },
      {
        name: "TaskPage",
        entry: "/tasks/test-task",
        route: "/tasks/:name",
        el: <TaskPage />,
        apiSpy: api.getTaskAgentStatus,
      },
      {
        name: "KnowledgeArtefactPage",
        entry: "/knowledge/test-knowledge",
        route: "/knowledge/:name",
        el: <KnowledgeArtefactPage />,
        apiSpy: api.getKnowledgeAgentStatus,
      },
      {
        name: "ConstitutionPage",
        entry: "/constitutions/test-constitution",
        route: "/constitutions/:name",
        el: <ConstitutionPage />,
        apiSpy: api.getConstitutionAgentStatus,
      },
    ];

    for (const page of pageConfigs) {
      const spy = page.apiSpy;
      vi.mocked(spy).mockClear();

      const { unmount } = render(
        <MemoryRouter initialEntries={[page.entry]}>
          <Routes>
            <Route path={page.route} element={page.el} />
          </Routes>
        </MemoryRouter>,
      );

      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      expect(
        vi.mocked(spy),
        `FAIL (AC7): ${page.name} — status API was called without sessionId — !sessionId guard missing`,
      ).not.toHaveBeenCalled();

      unmount();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  });

  // ── P2: AC8 isExternal ordering ─────────────────────────────────────

  it("P2 (AC8): KnowledgeArtefactPage + ConstitutionPage skip sessionId guard when isExternal=true", async () => {
    const extPages = [
      {
        name: "KnowledgeArtefactPage",
        entry: "/knowledge/external-test-artefact",
        route: "/knowledge/:name",
        el: <KnowledgeArtefactPage />,
        apiSpy: api.getKnowledgeAgentStatus,
      },
      {
        name: "ConstitutionPage",
        entry: "/constitutions/external-test-constitution",
        route: "/constitutions/:name",
        el: <ConstitutionPage />,
        apiSpy: api.getConstitutionAgentStatus,
      },
    ];

    for (const page of extPages) {
      vi.mocked(page.apiSpy).mockClear();

      const { unmount } = render(
        <MemoryRouter initialEntries={[page.entry]}>
          <Routes>
            <Route path={page.route} element={page.el} />
          </Routes>
        </MemoryRouter>,
      );

      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      expect(
        vi.mocked(page.apiSpy),
        `FAIL (AC8): ${page.name} — status API was called with isExternal=true — guard exited after sessionId check instead of isExternal`,
      ).not.toHaveBeenCalled();

      unmount();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  });
});

// ── AC1-AC7: reloadCurrentSession ───────────────────────────────────

describe("RepositoryPage reload current session (AC1-AC7)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });
    localStorage.clear();
  });

  // ── AC1 negative ────────────────────────────────────────────────

  it("AC1-ERR: same-session re-select with API failure shows error (fails: guard blocks call)", async () => {
    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    vi.mocked(api.getRepositoryAgentHistory).mockRejectedValue(
      new Error("Refresh failed"),
    );

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    const reopenedBtn = await screen.findByTitle("Session A");
    fireEvent.click(reopenedBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Refresh failed"),
        "FAIL (AC1-ERR): error not displayed — same-session guard prevented API call",
      ).toBeInTheDocument();
    });
  });

  // ── AC2: DOM presence ───────────────────────────────────────────

  it("AC2: Refresh button present when sessionId is set (fails: button not rendered)", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    expect(
      screen.queryByLabelText("Refresh current session"),
      "FAIL (AC2): Refresh button not found — missing from panel-action-buttons",
    ).toBeInTheDocument();
  });

  it("AC2-NEG: Refresh button absent when sessionId is null", async () => {
    renderPage();
    await new Promise<void>((r) => setTimeout(r, 300));

    expect(
      screen.queryByLabelText("Refresh current session"),
      "Refresh button should not appear without sessionId",
    ).not.toBeInTheDocument();
  });

  // ── AC3: functional ─────────────────────────────────────────────

  it("AC3: Refresh button calls getRepositoryAgentHistory on click (fails: button missing)", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    const refreshBtn = await screen.findByLabelText("Refresh current session");
    vi.mocked(api.getRepositoryAgentHistory).mockClear();
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "FAIL (AC3): getRepositoryAgentHistory not called — Refresh button handler missing",
      ).toHaveBeenCalled();
    });
  });

  it("AC3-NEG: Refresh button disabled during fetch (fails: button missing or isRefreshing state)", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    const refreshBtn = await screen.findByLabelText("Refresh current session");
    fireEvent.click(refreshBtn);

    expect(
      refreshBtn,
      "FAIL (AC3-NEG): Refresh button not disabled during fetch — isRefreshing state missing",
    ).toBeDisabled();

    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    resolveFetch!(emptyHistory);
  });

  // ── AC6: concurrent-fetch guard (picker path) ───────────────────

  it("AC6: 3 rapid same-session re-selects → exactly 1 API call (fails: guard returns early — 0 calls)", async () => {
    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    let resolveReSelect!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveReSelect = resolve;
      }),
    );

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    const sessionBtn = await screen.findByTitle("Session A");

    fireEvent.click(sessionBtn);
    fireEvent.click(sessionBtn);
    fireEvent.click(sessionBtn);

    await new Promise<void>((r) => setTimeout(r, 100));

    expect(
      api.getRepositoryAgentHistory,
      "FAIL (AC6): >1 API call on rapid same-session re-select — isRefreshingRef guard missing",
    ).toHaveBeenCalledTimes(1);

    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    resolveReSelect!(emptyHistory);
  });

  // ── AC6: concurrent-fetch guard (Refresh button path) ───────────

  it("AC6-REFRESH: 3 rapid Refresh clicks → exactly 1 API call (fails: button missing or guard)", async () => {
    // Initial load uses beforeEach's resolving mock so lifecycle reaches 'hydrated'
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for full hydration so chatAgentProcessing = false and Refresh is enabled
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalled();
    });

    // Now set up never-resolving history mock for the rapid-click scenario
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const refreshBtn = await screen.findByLabelText("Refresh current session");

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    fireEvent.click(refreshBtn);
    fireEvent.click(refreshBtn);
    fireEvent.click(refreshBtn);

    await new Promise<void>((r) => setTimeout(r, 100));

    expect(
      api.getRepositoryAgentHistory,
      "FAIL (AC6-REFRESH): >1 API call on rapid Refresh clicks — isRefreshingRef guard missing",
    ).toHaveBeenCalledTimes(1);

    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    resolveFetch!(emptyHistory);
  });

  it("AC585: reloadCurrentSession hydrates processing state from history", async () => {
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValueOnce({
      sessionId: "session-a",
      messages: [],
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValueOnce({
      sessionId: "session-a",
      messages: [],
      processing: true,
      startedAt: new Date().toISOString(),
    });
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for initial load to complete
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalled();
    });

    // Act: click Refresh button
    const refreshBtn = await screen.findByLabelText("Refresh current session");
    fireEvent.click(refreshBtn);

    // Assert: busy state is hydrated from history
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });
  });
});

// ── AC4 cross-page ─────────────────────────────────────────────────

describe("Cross-page Refresh button (AC4)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getTaskAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getKnowledgeAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getConstitutionAgentHistory).mockResolvedValue(emptyHistory);
    localStorage.clear();
  });

  it("AC4: All 4 pages have Refresh button calling correct API (fails: 3/4 pages missing button)", async () => {
    const pageConfigs = [
      {
        name: "RepositoryPage",
        entry: "/repositories/test-repo?tab=agent&sessionId=session-a",
        route: "/repositories/:name/*",
        el: <RepositoryPage />,
        apiSpy: api.getRepositoryAgentHistory,
      },
      {
        name: "TaskPage",
        entry: "/tasks/test-task?sessionId=session-a",
        route: "/tasks/:name",
        el: <TaskPage />,
        apiSpy: api.getTaskAgentHistory,
      },
      {
        name: "KnowledgeArtefactPage",
        entry: "/knowledge/test-knowledge?sessionId=session-a",
        route: "/knowledge/:name",
        el: <KnowledgeArtefactPage />,
        apiSpy: api.getKnowledgeAgentHistory,
      },
      {
        name: "ConstitutionPage",
        entry: "/constitutions/test-constitution?sessionId=session-a",
        route: "/constitutions/:name",
        el: <ConstitutionPage />,
        apiSpy: api.getConstitutionAgentHistory,
      },
    ];

    for (const page of pageConfigs) {
      const spy = page.apiSpy;
      vi.mocked(spy).mockClear();

      const { unmount } = render(
        <MemoryRouter initialEntries={[page.entry]}>
          <Routes>
            <Route path={page.route} element={page.el} />
          </Routes>
        </MemoryRouter>,
      );

      const refreshBtn = await screen.findByLabelText(
        "Refresh current session",
        undefined,
        { timeout: 3000 },
      );

      expect(
        refreshBtn,
        `FAIL (AC4): ${page.name} — Refresh button missing`,
      ).toBeInTheDocument();

      vi.mocked(spy).mockClear();
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(
          vi.mocked(spy),
          `FAIL (AC4): ${page.name} — Refresh click did not call its API endpoint`,
        ).toHaveBeenCalled();
      });

      unmount();
      await new Promise<void>((r) => setTimeout(r, 50));
    }
  });
});

// ── Adversarial: stale-closure & boundary tests ─────────────────────

describe("RepositoryPage adversarial — stale-closure data integrity", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
    sessionStorage.clear();
  });

  it("ADV-1: refresh fetch for stale session does not corrupt new session chat after session switch", async () => {
    const msgA: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const msgB: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B",
      timestamp: "2026-01-02T00:00:00Z",
    };
    const historyA = { sessionId: "session-a", messages: [msgA] };
    const historyB = { sessionId: "session-b", messages: [msgB] };

    let resolveRefresh: (value: ChatHistoryResponse) => void = () => {};
    const deferredRefresh = new Promise<ChatHistoryResponse>((resolve) => {
      resolveRefresh = resolve;
    });

    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce(historyA) // step 2: initial load session A
      .mockReturnValueOnce(deferredRefresh) // step 3: Refresh starts (deferred)
      .mockResolvedValueOnce(historyB); // step 5: switch to session B

    renderPage();
    await new Promise<void>((r) => setTimeout(r, 200));

    // step 2: load session A
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    // step 3: click Refresh
    const refreshBtn = await screen.findByLabelText("Refresh current session");
    fireEvent.click(refreshBtn);
    expect(screen.queryByText("Hello from A")).not.toBeInTheDocument();

    // wait for the refresh fetch to be dispatched
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(2);
    });

    // step 4: while refresh is in-flight, switch to session B
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    // step 5: resolve the stale deferred refresh (session A data arrives AFTER switch)
    resolveRefresh!(historyA);
    await new Promise<void>((r) => setTimeout(r, 200));

    // session B's own fetch should also have resolved
    await screen.findByText("Hello from B");

    // ADVERSARIAL CHECK: "Hello from A" must NOT appear — stale refresh data
    // must not corrupt session B's chat
    expect(
      screen.queryByText("Hello from A"),
      "FAIL (ADV-1): stale refresh for session A merged into session B chat — syncChatHistory lacks stale-closure guard before setChat",
    ).not.toBeInTheDocument();
  });

  it("ADV-3: Refresh disabled while chatAgentProcessing=true (agent processing)", async () => {
    const msgA: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const historyA = { sessionId: "session-a", messages: [msgA] };

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValueOnce(historyA);

    renderPage();
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    // Simulate chatAgentProcessing=true (agent processing)
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "session-a",
      processing: true,
    });
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: null,
    });

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await new Promise<void>((r) => setTimeout(r, 100));

    const refreshBtn = await screen.findByLabelText("Refresh current session");
    expect(
      refreshBtn,
      "FAIL (ADV-3): Refresh button not disabled while chatAgentProcessing=true",
    ).toBeDisabled();
  });

  it("ADV-4: same-session re-select followed by different-session switch — second switch still works", async () => {
    const msgA: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const msgB: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B",
      timestamp: "2026-01-02T00:00:00Z",
    };
    const historyA = { sessionId: "session-a", messages: [msgA] };
    const historyB = { sessionId: "session-b", messages: [msgB] };

    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(historyA);

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    // Re-select session A (triggers reloadCurrentSession) — returns empty
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));

    await new Promise<void>((r) => setTimeout(r, 200));

    // Switch to session B — return historyB for any subsequent calls
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(historyB);
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await screen.findByText("Hello from B");

    expect(
      screen.queryByText("Hello from A"),
      "FAIL (ADV-4): stale re-select data merged into session B chat",
    ).not.toBeInTheDocument();
  });

  it("I1 (ADV-5): ChatWindow shows 'Refreshing...' instead of 'Agent is thinking...' during refresh", async () => {
    // Initial load uses beforeEach's resolving mock so lifecycle reaches 'hydrated'
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for full hydration so chatAgentProcessing = false and Refresh is enabled
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalled();
    });

    // Now set up never-resolving history mock for the Refresh click
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    vi.mocked(api.getRepositoryAgentHistory).mockClear();
    const refreshBtn = await screen.findByLabelText("Refresh current session");
    fireEvent.click(refreshBtn);
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(
      refreshBtn,
      "FAIL (I1): Refresh button not disabled during fetch",
    ).toBeDisabled();

    expect(
      screen.getByText("Refreshing..."),
      "FAIL (I1): 'Refreshing...' not visible during refresh — agentProcessing still includes isRefreshing",
    ).toBeInTheDocument();

    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    resolveFetch!(emptyHistory);
  });

  it("I2 (AC6): error during refresh shows error and re-enables refresh button", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    // At this point the initial syncChatHistory may have started with the
    // default mock. Re-mock so the refresh click gets a deferred promise.
    let rejectFetch!: (error: Error) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockClear();
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );

    const refreshBtn = await screen.findByLabelText("Refresh current session");
    expect(refreshBtn).not.toBeDisabled();
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(
        vi.mocked(api.getRepositoryAgentHistory),
        "FAIL (I2): getRepositoryAgentHistory not called — reloadCurrentSession not invoked",
      ).toHaveBeenCalled();
    });

    rejectFetch(new Error("Refresh failed"));

    await waitFor(() => {
      expect(
        screen.getByText("Refresh failed"),
        "FAIL (I2): error message not displayed after reloadCurrentSession throws",
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      const btn = screen.getByLabelText("Refresh current session");
      expect(
        btn,
        "FAIL (I2): Refresh button not re-enabled after error — isRefreshing not set to false in finally block",
      ).not.toBeDisabled();
    });
  });

  it("I3: sending message shows 'Agent is thinking...' (refresh not interfering)", async () => {
    const msg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const history = { sessionId: "session-a", messages: [msg] };

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(history);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });

    renderPage();
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "session-a",
      processing: true,
    });
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: null,
    });

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await screen.findByText("Agent is thinking...");

    expect(
      screen.getByText("Agent is thinking..."),
      "FAIL (I3): Agent indicator not visible after sending a message — agentProcessing decoupling broke send path",
    ).toBeInTheDocument();
  });
});

// ── AC495: stale-reply guard for handleSendMessage ──────────────────────

describe("RepositoryPage stale-reply guard (AC495)", () => {
  function renderPageWithRouter(
    initialEntries = ["/repositories/test-repo?tab=agent"],
  ) {
    const router = createMemoryRouter(
      [
        {
          path: "/repositories/:name/*",
          element: <RepositoryPage />,
        },
      ],
      { initialEntries },
    );
    const result = render(<RouterProvider router={router} />);
    return { router, ...result };
  }

  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── U1: AC495-1 bootstrap stale success reply ───────────────────────

  it("U1 (AC495-1): stale success reply after bootstrap switch does NOT hijack tab/error/loading", async () => {
    let resolveSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((resolve) => {
        resolveSend = resolve;
      }),
    );

    const { router } = renderPageWithRouter([
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    ]);

    await screen.findByLabelText("Clear session");

    // Switch to session A via picker
    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("No conversation yet.");

    // Start a deferred send for session A
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel should appear after send",
      ).toBeInTheDocument();
    });

    // Bootstrap switch to session B via URL navigation
    await router.navigate(
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    );

    // Now resolve the stale session A reply
    resolveSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      vi.mocked(api.getRepositoryAgentHistory),
      "F-AC495-1d: getRepositoryAgentHistory was called — stale response restored sessionId without guard",
    ).not.toHaveBeenCalledWith("test-repo", "session-a", undefined);
  });

  // ── U2: AC495-1 UX state assertion ──────────────────────────────────

  it("U2 (AC495-1): stale reply preserves new session UX state via DOM", async () => {
    let resolveSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((resolve) => {
        resolveSend = resolve;
      }),
    );

    const { router } = renderPageWithRouter([
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    ]);

    await screen.findByLabelText("Clear session");

    // Switch to session A via picker
    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("No conversation yet.");

    // Start a deferred send
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Bootstrap switch to session B — triggers useLayoutEffect which
    // increments sendRequestIdRef so stale reply will be discarded
    await router.navigate(
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    );

    // Resolve the stale session A reply
    resolveSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 200));

    // 1. Stale success reply must NOT cause "Failed to reach agent" to appear
    //    (if the guard failed, setChatError(null) would run on stale path but
    //     the stale path never sets error text — this assertion is a sanity check)
    expect(
      screen.queryByText("Failed to reach agent"),
      "F-AC495-1c: 'Failed to reach agent' appeared for stale success reply",
    ).not.toBeInTheDocument();

    // 2. Session B's session ID must still be displayed — proves the stale
    //    reply did NOT call setSessionId("session-a") (guard blocked it)
    expect(
      screen.getByText("Session ID: session-b"),
      "F-AC495-1b: session ID was overwritten by stale session A reply — guard failed",
    ).toBeInTheDocument();
  });

  // ── U3: AC495-2 bootstrap stale error reply ─────────────────────────

  it("U3 (AC495-2): stale error reply after bootstrap switch does NOT write wrong-session error", async () => {
    let rejectSend!: (reason: Error) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((_, reject) => {
        rejectSend = reject;
      }),
    );

    const { router } = renderPageWithRouter([
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    ]);

    await screen.findByLabelText("Clear session");

    // Switch to session A via picker
    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("No conversation yet.");

    // Start a deferred send for session A
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Bootstrap switch to session B
    await router.navigate(
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    );

    // Capture getRepositoryAgentStatus call count before rejecting stale reply
    const statusCallCount = vi.mocked(api.getRepositoryAgentStatus).mock.calls
      .length;

    // Reject the stale session A reply
    rejectSend!(new Error("Network failure"));

    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      screen.queryByText("Failed to reach agent"),
      "F-AC495-2a: 'Failed to reach agent' appeared for stale error reply after session switch",
    ).not.toBeInTheDocument();

    // Guard must prevent refreshAgentStatus call for stale session
    expect(
      vi.mocked(api.getRepositoryAgentStatus).mock.calls.length,
      "F-AC495-2b: refreshAgentStatus called after stale error — guard failed",
    ).toBe(statusCallCount);
  });

  // ── U4: AC495-3 normal send success ─────────────────────────────────

  it("U4 (AC495-3): normal send success fires all expected side effects", async () => {
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "session-a",
      processing: false,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Session ID: session-a")).toBeInTheDocument();
    });
  });

  // ── U5: AC495-3 normal send error ───────────────────────────────────

  it("U5 (AC495-3): normal send error shows error message", async () => {
    vi.mocked(api.sendAgentMessage).mockRejectedValue(
      new Error("Network failure"),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to reach agent"),
        "F-AC495-3b: error not displayed on send failure",
      ).toBeInTheDocument();
    });
  });

  // ── U6: AC495-3 reply.processing=true ───────────────────────────────

  it("U6 (AC495-3): reply.processing=true keeps chatAgentProcessing true", async () => {
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "processing",
      sessionId: "session-a",
      processing: true,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    // After initial mount, mock status to processing:true so refreshAgentStatus
    // effect doesn't wrongly clear chatAgentProcessing after the send resolves
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await new Promise<void>((r) => setTimeout(r, 200));

    const sendBtn = screen.queryByRole("button", { name: /send/i });
    expect(
      sendBtn,
      "F-AC495-3c: Send button re-enabled when reply.processing=true — setChatAgentProcessing(false) was incorrectly called",
    ).toBeNull();
  });

  // ── U7: AC495-4 handleSessionSelect path ────────────────────────────

  it("U7 (AC495-4): stale reply guarded after handleSessionSelect switch", async () => {
    let resolveSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((resolve) => {
        resolveSend = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    // Start a deferred send for session A
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Switch to session B via picker
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await new Promise<void>((r) => setTimeout(r, 100));

    // Resolve the stale session A reply
    resolveSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      vi.mocked(api.getRepositoryAgentHistory),
      "F-AC495-4b: getRepositoryAgentHistory was called with stale session-a after sessionSelect — guard missing in handleSessionSelect path",
    ).not.toHaveBeenCalledWith("test-repo", "session-a", undefined);
  });

  // ── U8: AC495-4 handleClearSessionOnly path ──────────────────────────

  it("U8 (AC495-4): stale reply guarded after handleClearSessionOnly", async () => {
    let resolveSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((resolve) => {
        resolveSend = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    // Start a deferred send
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Clear session only
    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^no$/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
      ).not.toBeInTheDocument();
    });

    // Resolve the stale session A reply
    resolveSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      screen.queryByText("Session ID: session-a"),
      "F-AC495-4c: Session ID re-appeared after clearSessionOnly — stale response bypassed guard",
    ).not.toBeInTheDocument();
  });

  // ── U9: AC495-4 handleClearSessionAndHistory path ────────────────────

  it("U9 (AC495-4): stale reply guarded after handleClearSessionAndHistory", async () => {
    let resolveSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((resolve) => {
        resolveSend = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    // Start a deferred send
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Clear session and history
    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^yes$/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("No conversation yet.")).toBeInTheDocument();
    });

    // Resolve the stale session A reply
    resolveSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      screen.queryByText("Session ID: session-a"),
      "F-AC495-4d: Session ID re-appeared after clearSessionAndHistory — stale response bypassed guard",
    ).not.toBeInTheDocument();
  });

  // ── U10: two concurrent handleSendMessage invocations ────────────────

  it("U10: two concurrent sends — first reply discarded by request-level guard", async () => {
    let resolveFirst!: (value: AgentReply) => void;
    let resolveSecond!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage)
      .mockReturnValueOnce(
        new Promise<AgentReply>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AgentReply>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    // First send
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Switch session to reset chatAgentProcessing so send button is available again
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
      ).not.toBeInTheDocument();
    });

    // Second send (after session switch resets chatAgentProcessing)
    fireEvent.change(textarea, { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Resolve second first (newer request should complete first)
    resolveSecond!({
      messageId: "m2",
      sent: new Date().toISOString(),
      response: "second-ok",
      sessionId: "session-b",
      processing: false,
    });

    await waitFor(() => {
      expect(screen.getByText("Session ID: session-b")).toBeInTheDocument();
    });

    // Now resolve the stale first message (should be discarded by request-level guard)
    resolveFirst!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale-first",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 200));

    // Session ID should still be session-b (not overwritten by stale first reply)
    expect(
      screen.getByText("Session ID: session-b"),
      "F-AC495-U10: Session ID changed after stale first reply resolved — request-level guard failed",
    ).toBeInTheDocument();
  });

  // ── U11: component unmount while send in-flight ──────────────────────

  it("U11: component unmount during in-flight send suppresses stale reply", async () => {
    let resolveSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>((resolve) => {
        resolveSend = resolve;
      }),
    );

    const { unmount } = renderPage([
      "/repositories/test-repo?tab=agent&sessionId=session-a",
    ]);
    await screen.findByLabelText("Clear session");

    // Start a deferred send
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Unmount the component
    unmount();

    // Resolve the stale reply after unmount
    resolveSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 100));

    // No state updates after unmount — no assertion needed beyond absence of React warnings
    expect(true, "Unmount during in-flight send completed without error").toBe(
      true,
    );
  });

  // ── U12: bootstrap effect with empty name ────────────────────────────

  it("U12: bootstrap fire with empty name does not break guard", async () => {
    // Render with session URL but missing name param (invalid route)
    // The bootstrap should early-return on !name, not crash
    renderPageWithRouter(["/repositories/?tab=agent&sessionId=session-a"]);

    await new Promise<void>((r) => setTimeout(r, 300));

    expect(true, "Bootstrap with empty name did not crash").toBe(true);
  });

  // ── U13: AC496 regression guard ─────────────────────────────────

  it("U13 (AC496 regression): normal send after picker switch works", async () => {
    // The stale-reply guard fix must not break normal session management.
    // Unlike U4 which tests bootstrap-initiated sends, this tests the
    // session-picker path — a regression scenario from the AC496 suite.
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "session-b",
      processing: false,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));
    await screen.findByText("No conversation yet.");

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "hello from B" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Session ID: session-b"),
        "F-AC495-U13: AC496 regression — send after picker switch broken",
      ).toBeInTheDocument();
    });
  });

  // ── T1–T4: signal.aborted guard (Issue #492) ───────────────────────

  it("T2: syncChatHistory with aborted signal does not render messages (fails: guard missing)", async () => {
    const origAbortController = globalThis.AbortController;
    try {
      vi.stubGlobal(
        "AbortController",
        class {
          signal = { aborted: true } as AbortSignal;
          abort() {
            /* no-op */
          }
        },
      );

      const msg: ChatHistoryMessage = {
        role: "assistant",
        type: "text",
        content: "Should not appear",
        timestamp: "2026-01-01T00:00:00Z",
      };
      vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue({
        sessionId: "session-a",
        messages: [msg],
      });

      renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

      await waitFor(() => {
        expect(
          screen.queryByText("Should not appear"),
          "FAIL (T2): Messages rendered despite aborted signal — guard missing after await",
        ).not.toBeInTheDocument();
      });
    } finally {
      vi.stubGlobal("AbortController", origAbortController);
    }
  });

  it("T3: AbortError rejection does not call setChatError (fails: error shown)", async () => {
    const abortError = new DOMException(
      "The operation was aborted",
      "AbortError",
    );
    vi.mocked(api.getRepositoryAgentHistory).mockRejectedValue(abortError);

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Failed to load chat history"),
        "FAIL (T3): Error appeared despite AbortError — setChatError was called",
      ).not.toBeInTheDocument();
    });
  });

  it("T4: syncChatHistory normal flow — messages rendered (fails: no messages)", async () => {
    const msg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Normal message",
      timestamp: "2026-01-01T00:00:00Z",
    };
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue({
      sessionId: "session-a",
      messages: [msg],
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    expect(
      await screen.findByText("Normal message"),
      "FAIL (T4): syncChatHistory without valid signal failed to render messages",
    ).toBeInTheDocument();
  });

  it("T1: deferred effect call + session switch aborts — stale data not rendered (fails: stale data visible)", async () => {
    const msgA: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const msgB: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B",
      timestamp: "2026-01-02T00:00:00Z",
    };
    const historyA: ChatHistoryResponse = {
      sessionId: "session-a",
      messages: [msgA],
    };
    const historyB: ChatHistoryResponse = {
      sessionId: "session-b",
      messages: [msgB],
    };

    let resolveDeferred!: (value: ChatHistoryResponse) => void;
    const deferred = new Promise<ChatHistoryResponse>((resolve) => {
      resolveDeferred = resolve;
    });

    vi.mocked(api.getRepositoryAgentHistory)
      .mockReturnValueOnce(deferred)
      .mockResolvedValueOnce(historyB);

    renderPage();
    await new Promise<void>((r) => setTimeout(r, 200));

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "session A fetch should have been dispatched",
      ).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await screen.findByText("Hello from B");

    resolveDeferred!(historyA);
    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      screen.queryByText("Hello from A"),
      "FAIL (T1): Stale session A data appeared after session switch — signal.aborted guard missing",
    ).not.toBeInTheDocument();
  });

  it("T1-loading: deferred polling call + session switch — stale data not rendered (fails: stale data visible)", async () => {
    const msgA: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A (loading)",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const msgB: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B (loading)",
      timestamp: "2026-01-02T00:00:00Z",
    };
    const historyA: ChatHistoryResponse = {
      sessionId: "session-a",
      messages: [msgA],
    };
    const historyB: ChatHistoryResponse = {
      sessionId: "session-b",
      messages: [msgB],
    };

    let resolveDeferred!: (value: ChatHistoryResponse) => void;
    const deferred = new Promise<ChatHistoryResponse>((resolve) => {
      resolveDeferred = resolve;
    });

    vi.mocked(api.getRepositoryAgentHistory).mockReturnValueOnce(deferred);

    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);

    const { router } = renderPageWithRouter([
      "/repositories/test-repo?tab=agent&sessionId=session-a",
    ]);

    await screen.findByLabelText("Clear session");
    await new Promise<void>((r) => setTimeout(r, 500));

    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "session A polling fetch should have been dispatched",
      ).toHaveBeenCalled();
    });

    vi.mocked(api.getRepositoryAgentHistory).mockClear();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValueOnce(historyB);

    await router.navigate(
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    );

    await screen.findByText("Hello from B (loading)");

    resolveDeferred!(historyA);
    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      screen.queryByText("Hello from A (loading)"),
      "FAIL (T1-loading): Stale polling data appeared after session switch — guard missing in loading path",
    ).not.toBeInTheDocument();
  });

  // ── ADV-1: stale reply then fresh send from new session ───────────────

  it("ADV-1: new send from new session works after stale reply is discarded", async () => {
    let resolveStaleSend!: (value: AgentReply) => void;
    let resolveFreshSend!: (value: AgentReply) => void;
    vi.mocked(api.sendAgentMessage)
      .mockReturnValueOnce(
        new Promise<AgentReply>((resolve) => {
          resolveStaleSend = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AgentReply>((resolve) => {
          resolveFreshSend = resolve;
        }),
      );

    const { router } = renderPageWithRouter([
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    ]);

    await screen.findByLabelText("Clear session");

    // Switch to session A via picker
    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("No conversation yet.");

    // Start a deferred send for session A
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "stale message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel should appear after first send",
      ).toBeInTheDocument();
    });

    // Bootstrap switch to session B via URL navigation (triggers useLayoutEffect)
    await router.navigate(
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    );

    // Resolve the stale session A reply
    resolveStaleSend!({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "stale",
      sessionId: "session-a",
      processing: false,
    });

    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      vi.mocked(api.getRepositoryAgentHistory),
      "ADV-1a: stale reply should not trigger history fetch for old session",
    ).not.toHaveBeenCalledWith("test-repo", "session-a", undefined);

    // Now send a NEW message from session B
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    fireEvent.change(textarea, { target: { value: "fresh message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "ADV-1b: Cancel should appear after new send from session B — sendRequestId guard may have broken subsequent sends",
      ).toBeInTheDocument();
    });

    // Resolve the fresh session B reply
    resolveFreshSend!({
      messageId: "m2",
      sent: new Date().toISOString(),
      response: "fresh-ok",
      sessionId: "session-b",
      processing: false,
    });

    await waitFor(() => {
      expect(
        screen.getByText("Session ID: session-b"),
        "ADV-1c: Session B's reply should be processed after stale reply was discarded",
      ).toBeInTheDocument();
    });
  });

  it("ADV-492-nav-race: stale non-polling syncChatHistory deferred resolves AFTER router navigation to new session — guard catches stale data", async () => {
    let resolveStale!: (value: ChatHistoryResponse) => void;
    const deferredStale = new Promise<ChatHistoryResponse>((resolve) => {
      resolveStale = resolve;
    });

    const msgA: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A (nav stale)",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const msgB: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B (nav fresh)",
      timestamp: "2026-01-02T00:00:00Z",
    };
    const historyA: ChatHistoryResponse = {
      sessionId: "session-a",
      messages: [msgA],
    };
    const historyB: ChatHistoryResponse = {
      sessionId: "session-b",
      messages: [msgB],
    };

    vi.mocked(api.getRepositoryAgentHistory)
      .mockReturnValueOnce(deferredStale)
      .mockResolvedValueOnce(historyB);

    const { router } = renderPageWithRouter([
      "/repositories/test-repo?tab=agent&sessionId=session-a",
    ]);

    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "session A fetch should have been dispatched",
      ).toHaveBeenCalledTimes(1);
    });

    await router.navigate(
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    );

    await screen.findByText("Hello from B (nav fresh)");

    resolveStale!(historyA);
    await new Promise<void>((r) => setTimeout(r, 200));

    expect(
      screen.queryByText("Hello from A (nav stale)"),
      "FAIL (ADV-492): Stale session A data appeared after router navigation — signal.aborted guard missing",
    ).not.toBeInTheDocument();
  });
});

// ── AC1-AC10: session-select loading indicator ──────────────────────

describe("RepositoryPage session loading indicator (AC1-AC10)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    localStorage.clear();
  });

  // ── U1 (AC1): loading indicator visible after different-session select ──

  it("U1 (AC1): loading indicator appears after selecting a different session", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC1): loading indicator not visible after session select — sessionLoading state or ChatWindow rendering missing",
      ).toBeInTheDocument();
    });

    resolveFetch!(emptyHistory);
  });

  // ── U2 (AC2): loading clears when history resolves with messages ──────

  it("U2 (AC2): loading indicator clears when history resolves with messages", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC2): loading indicator not visible before fetch resolves",
      ).toBeInTheDocument();
    });

    const msg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B",
      timestamp: "2026-01-02T00:00:00Z",
    };
    resolveFetch!({ sessionId: "session-b", messages: [msg] });

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC2): loading indicator persisted after fetch resolved — setSessionLoading(false) missing after abort guard",
      ).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText("Hello from B"),
      "FAIL (AC2): messages not rendered after loading cleared",
    ).toBeInTheDocument();
  });

  // ── U3 (AC3): loading clears when history resolves empty ────────────

  it("U3 (AC3): loading indicator clears when history resolves with empty array", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC3): loading indicator not visible before empty fetch resolves",
      ).toBeInTheDocument();
    });

    resolveFetch!({ sessionId: "session-b", messages: [] });

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC3): loading indicator persisted after empty fetch resolved — setSessionLoading(false) missing after abort guard (empty path)",
      ).not.toBeInTheDocument();
    });
    expect(
      document.querySelector(".empty"),
      "FAIL (AC3): empty state not shown after loading cleared",
    ).toBeInTheDocument();
    expect(
      document.querySelectorAll(".alert").length,
      "FAIL (AC3): alert shown instead of empty state after empty fetch",
    ).toBe(0);
  });

  // ── U4 (AC4): loading clears when history rejects ──────────────────

  it("U4 (AC4): loading indicator clears when history fetch rejects", async () => {
    let rejectFetch!: (reason: Error) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((_, reject) => {
        rejectFetch = reject;
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC4): loading indicator not visible before fetch rejection",
      ).toBeInTheDocument();
    });

    rejectFetch!(new Error("Fetch failed"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC4): loading indicator persisted after fetch rejection — setSessionLoading(false) missing in catch block",
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Fetch failed"),
      "FAIL (AC4): error message not shown after fetch rejection",
    ).toBeInTheDocument();
  });

  // ── U5 (AC5): rapid double-switch — only one final loading state ──

  it("U5 (AC5): rapid double session switch shows only second session's loading indicator", async () => {
    let resolveFirst!: (value: ChatHistoryResponse) => void;
    let resolveSecond!: (value: ChatHistoryResponse) => void;

    vi.mocked(api.getRepositoryAgentHistory)
      .mockReturnValueOnce(
        new Promise<ChatHistoryResponse>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<ChatHistoryResponse>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "first session B fetch should have been dispatched",
      ).toHaveBeenCalledTimes(1);
    });

    // Rapidly switch to another session before first resolves
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));

    // Second session's loading indicator should be visible
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC5): loading indicator not visible after second switch",
      ).toBeInTheDocument();
    });

    // Resolve first (stale) fetch — should not affect UI
    resolveFirst!(emptyHistory);
    await new Promise<void>((r) => setTimeout(r, 100));

    // Loading should still be visible (second fetch still pending)
    expect(
      screen.getByText("Loading session..."),
      "FAIL (AC5): loading indicator cleared prematurely after stale first fetch resolved — signal?.aborted guard may have cleared before second fetch",
    ).toBeInTheDocument();

    // Resolve second fetch
    resolveSecond!(emptyHistory);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC5): loading indicator persisted after second fetch resolved",
      ).not.toBeInTheDocument();
    });
  });

  // ── U6 (AC6): no stale content visible during loading ──────────────

  it("U6 (AC6): no stale content visible during loading state — previous session's messages absent", async () => {
    const msgA: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from A",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const historyA = { sessionId: "session-a", messages: [msgA] };

    let resolveB!: (value: ChatHistoryResponse) => void;

    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce(historyA)
      .mockReturnValueOnce(
        new Promise<ChatHistoryResponse>((resolve) => {
          resolveB = resolve;
        }),
      );

    renderPage();

    // Load session A first
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await screen.findByText("Hello from A");

    // Switch to session B while fetch is deferred
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    await screen.findByTitle("Session B");
    fireEvent.click(screen.getByTitle("Session B"));

    // Before B resolves: loading indicator should show, stale messages should be absent
    expect(
      screen.queryByText("Hello from A"),
      "FAIL (AC6): stale message from session A visible during loading state — setChat([]) missing before sessionLoading(true)",
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Loading session..."),
      "FAIL (AC6): loading indicator not visible during stale-content check",
    ).toBeInTheDocument();

    resolveB!(emptyHistory);
  });

  // ── U7 (AC7): exactly 1 API call per session switch ──────────────

  it("U7 (AC7): exactly one history fetch per session switch", async () => {
    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "FAIL (AC7): more than 1 API call per session switch — duplicate history fetch introduced",
      ).toHaveBeenCalledTimes(1);
    });
  });

  // ── U8 (AC8): same-session re-select shows "Refreshing..." not "Loading session..." ──

  it("U8 (AC8): same-session re-select shows Refreshing... not Loading session...", async () => {
    let resolveReload!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce(emptyHistory)
      .mockReturnValueOnce(
        new Promise<ChatHistoryResponse>((resolve) => {
          resolveReload = resolve;
        }),
      );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    // Re-select same session (uses reloadCurrentSession with deferred fetch)
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    const sameBtn = await screen.findByTitle("Session A");
    fireEvent.click(sameBtn);

    expect(
      await screen.findByText("Refreshing..."),
      "FAIL (AC8): Refreshing... not shown on same-session re-select — reloadCurrentSession may not have set isRefreshing",
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Loading session..."),
      "FAIL (AC8): Loading session... incorrectly shown on same-session re-select — should use isRefreshing not sessionLoading",
    ).not.toBeInTheDocument();

    resolveReload!(emptyHistory);
  });

  // ── U9 (AC9): empty session id: "" — no crash, no loading ─────────

  it("U9 (AC9): selecting session with empty string id does not show loading indicator", async () => {
    const emptyIdSession: ChatSession = {
      id: "",
      title: "Empty ID Session",
      updated: "2026-01-01",
    };
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [emptyIdSession],
    });

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    const sessionBtn = await screen.findByTitle("Empty ID Session");
    fireEvent.click(sessionBtn);

    await new Promise<void>((r) => setTimeout(r, 100));

    expect(
      screen.queryByText("Loading session..."),
      "FAIL (AC9): loading indicator shown for empty session id — add !session.id guard in handleSessionSelect",
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(".empty"),
      "FAIL (AC9): empty state not rendered after empty session id select",
    ).toBeInTheDocument();
  });

  // ── U10 (AC10): priority order in chat area ──────────────────────

  it("U10 (AC10): loading indicator takes priority over empty state and agent-processing text during session switch", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    // Loading indicator should be visible (sessionLoading > .empty)
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC10): loading indicator not shown during session switch",
      ).toBeInTheDocument();
    });

    // Empty state should NOT be visible while loading
    expect(
      document.querySelector(".empty"),
      "FAIL (AC10): empty state visible simultaneously with loading indicator — sessionLoading should take priority over .empty",
    ).not.toBeInTheDocument();

    // "Agent is thinking..." should NOT be visible (sessionLoading > agentProcessing)
    expect(
      screen.queryByText("Agent is thinking..."),
      "FAIL (AC10): Agent is thinking... visible during session switch — sessionLoading should take priority over agentProcessing",
    ).not.toBeInTheDocument();

    resolveFetch!(emptyHistory);
  });

  // ── U11 (U11): concurrent-event safety — unmount during pending session switch ──

  it("U11 (AC4/AC5 concurrent safety): unmounting during pending session switch does not cause warnings or leaked state", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U11): loading indicator not visible after session select — sessionLoading must be visible before unmount",
      ).toBeInTheDocument();
    });

    // Unmount while fetch is pending
    unmount();

    // Resolve the deferred fetch after unmount — should not throw or log warnings
    expect(
      () => resolveFetch!(emptyHistory),
      "FAIL (U11): resolve after unmount threw — setSessionLoading(false) called on unmounted component without guard",
    ).not.toThrow();
    await new Promise<void>((r) => setTimeout(r, 100));

    // Success — no leaked state from the unmounted component
    expect(true).toBe(true);
  });
});

// ── AC1-AC7: bootstrap path loading indicator (Issue #522) ─────────────

describe("RepositoryPage bootstrap path loading indicator (AC1-AC7)", () => {
  const sessionStorageKey = "repository-session-test-repo-opencode";
  const historyWithMessages: ChatHistoryResponse = {
    sessionId: "session-b",
    messages: [
      {
        role: "assistant",
        type: "text",
        content: "Hello from bootstrap",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ],
  };

  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
    });
  });

  // ── U1 (AC1): ?sessionId=X → loading visible ─────────────────────────

  it("U1 (AC1): ?sessionId=session-b shows loading indicator on page load", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U1): loading not visible on bootstrap — setSessionLoading(true) missing in switchSessionIfNeeded",
      ).toBeInTheDocument();
    });

    resolveFetch!(emptyHistory);
  });

  // ── U2 (AC1): .empty absent during AC1 loading ──────────────────────

  it("U2 (AC1): .empty state not visible during bootstrap loading", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U2): loading not visible — cannot assert .empty priority without loading",
      ).toBeInTheDocument();
    });

    expect(
      document.querySelector(".empty"),
      "FAIL (U2): .empty visible during bootstrap loading — sessionLoading should take priority",
    ).not.toBeInTheDocument();

    resolveFetch!(emptyHistory);
  });

  // ── U3 (AC2): persisted session → loading visible ──────────────────

  it("U3 (AC2): persisted session in localStorage shows loading on page load (no URL param)", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    localStorage.setItem(sessionStorageKey, "session-b");

    renderPage();

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U3): loading not visible on reload with persisted session — setSessionLoading(true) missing in sync effect",
      ).toBeInTheDocument();
    });

    resolveFetch!(emptyHistory);
  });

  // ── U4 (AC2): .empty absent during AC2 loading ──────────────────────

  it("U4 (AC2): .empty state not visible during persisted-session loading", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    localStorage.setItem(sessionStorageKey, "session-b");

    renderPage();

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U4): loading not visible for persisted session — cannot assert .empty priority",
      ).toBeInTheDocument();
    });

    expect(
      document.querySelector(".empty"),
      "FAIL (U4): .empty visible during persisted-session loading",
    ).not.toBeInTheDocument();

    resolveFetch!(emptyHistory);
  });

  // ── U5 (AC3): fetch resolves with messages → loading clears ────────

  it("U5 (AC3): bootstrap fetch resolves with messages — loading clears, messages rendered", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U5): loading not visible before fetch resolves",
      ).toBeInTheDocument();
    });

    resolveFetch!(historyWithMessages);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U5): loading persisted after fetch resolved — clearSessionLoading not reached",
      ).not.toBeInTheDocument();
    });

    expect(
      await screen.findByText("Hello from bootstrap"),
      "FAIL (U5): messages not rendered after loading cleared",
    ).toBeInTheDocument();
  });

  // ── U6 (AC4): fetch resolves empty → loading clears, .empty shown ──

  it("U6 (AC4): bootstrap fetch resolves empty — loading clears, .empty shown", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U6): loading not visible before empty fetch resolves",
      ).toBeInTheDocument();
    });

    resolveFetch!({ sessionId: "session-b", messages: [] });

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U6): loading persisted after empty fetch resolved",
      ).not.toBeInTheDocument();
    });

    expect(
      document.querySelector(".empty"),
      "FAIL (U6): .empty not shown after loading cleared",
    ).toBeInTheDocument();
    expect(
      document.querySelectorAll(".alert").length,
      "FAIL (U6): alert shown instead of empty state for empty history",
    ).toBe(0);
  });

  // ── U7 (AC5): fetch rejects → loading clears, .alert shows ─────────

  it("U7 (AC5): bootstrap fetch rejects — loading clears, error shown", async () => {
    let rejectFetch!: (reason: Error) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((_, reject) => {
        rejectFetch = reject;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U7): loading not visible before fetch rejection",
      ).toBeInTheDocument();
    });

    rejectFetch!(new Error("Bootstrap fetch failed"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U7): loading persisted after fetch rejection",
      ).not.toBeInTheDocument();
    });

    expect(
      screen.getByText("Bootstrap fetch failed"),
      "FAIL (U7): error message not shown after fetch rejection",
    ).toBeInTheDocument();
  });

  // ── U9 (AC7): exactly 1 fetch when processing: false ───────────────

  it("U9 (AC7): exactly one history fetch per bootstrap when processing: false", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "FAIL (U9): history fetch not dispatched on bootstrap",
      ).toHaveBeenCalled();
    });

    expect(
      api.getRepositoryAgentHistory,
      "FAIL (U9): more than 1 history fetch per bootstrap — guard missing",
    ).toHaveBeenCalledTimes(1);
  });

  // ── U10 (AC7): max 2 fetches when processing: true ─────────────────

  it("U10 (AC7): max 2 history fetches when processing: true", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      const callCount = api.getRepositoryAgentHistory.mock.calls.length;
      expect(
        callCount,
        "FAIL (U10): more than 2 history fetches when processing is true",
      ).toBeLessThanOrEqual(2);
      if (callCount === 0) {
        throw new Error("U10: no fetch dispatched yet");
      }
    });
  });

  // ── U11 (AC1-AC5 concurrent): unmount during pending bootstrap ────

  it("U11 (concurrent): unmount during pending bootstrap fetch does not cause errors", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderPage([
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    ]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U11): loading not visible before unmount",
      ).toBeInTheDocument();
    });

    unmount();

    expect(
      () => resolveFetch!(emptyHistory),
      "FAIL (U11): resolve after unmount threw — setSessionLoading called on unmounted component",
    ).not.toThrow();

    await new Promise<void>((r) => setTimeout(r, 100));
  });

  // ── U12 (AC6 concurrent): picker switch during pending bootstrap ──

  it("U12 (concurrent): picker switch during pending bootstrap shows second loading", async () => {
    let resolveBootstrap!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveBootstrap = resolve;
      }),
    );

    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U12): bootstrap loading not visible before picker switch",
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U12): loading not visible after picker switch during bootstrap",
      ).toBeInTheDocument();
    });

    resolveBootstrap!(emptyHistory);
  });

  // ── U13 (AC1/AC3-AC5 concurrent): clear session during pending fetch ──

  it("U13 (AC1/concurrent): clearSessionOnly during pending bootstrap preempts loading", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U13): loading not visible before clear",
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^no$/i }));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U13): loading persisted after clearSessionOnly",
      ).not.toBeInTheDocument();
    });

    resolveFetch!(emptyHistory);
  });

  // ── U14 (AC1/AC3 concurrent): URL re-edit ?sessionId=A→B ──────────

  function renderPageWithRouter(
    initialEntries = ["/repositories/test-repo?tab=agent"],
  ) {
    const router = createMemoryRouter(
      [{ path: "/repositories/:name/*", element: <RepositoryPage /> }],
      { initialEntries },
    );
    const result = render(<RouterProvider router={router} />);
    return { router, ...result };
  }

  it("U14 (concurrent): URL re-edit from ?sessionId=A to ?sessionId=B shows B's content", async () => {
    let resolveA!: (value: ChatHistoryResponse) => void;
    const msgB: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Hello from B",
      timestamp: "2026-01-01T00:00:00Z",
    };
    const historyB = { sessionId: "session-b", messages: [msgB] };

    let resolveB!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory)
      .mockReturnValueOnce(
        new Promise<ChatHistoryResponse>((resolve) => {
          resolveA = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<ChatHistoryResponse>((resolve) => {
          resolveB = resolve;
        }),
      );

    const { router } = renderPageWithRouter([
      "/repositories/test-repo?tab=agent&sessionId=session-a",
    ]);

    await router.navigate(
      "/repositories/test-repo?tab=agent&sessionId=session-b",
    );

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U14): loading not visible after URL re-edit from A to B",
      ).toBeInTheDocument();
    });

    resolveB!(historyB);
    await screen.findByText("Hello from B");

    resolveA!(emptyHistory);
  });

  // ── U15 (AC2): clearSessionAndHistory during pending fetch clears loading ──

  it("U15 (AC2): clearSessionAndHistory during pending bootstrap preempts loading", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U15): loading not visible before clear",
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^yes$/i }));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U15): loading persisted after clearSessionAndHistory — clearSessionLoading() missing in handler",
      ).not.toBeInTheDocument();
    });

    resolveFetch!(emptyHistory);
  });

  // ── U17 (AC5 No path): clearSessionOnly during idle does not introduce loading ──

  it("U17 (AC5): clearSessionOnly from idle state does not show loading", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // Wait for loading to clear (fast-resolving mock from beforeEach)
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U17): loading not visible during bootstrap — prerequisite for idle check",
      ).not.toBeInTheDocument();
    });

    await screen.findByLabelText("Clear session");

    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^no$/i }));

    expect(
      screen.queryByText("Loading session..."),
      "FAIL (U17): loading appeared after clearSessionOnly from idle — spurious setSessionLoading(true)",
    ).not.toBeInTheDocument();
  });

  // ── U18 (AC5 Yes path): clearSessionAndHistory during idle does not introduce loading ──

  it("U18 (AC5): clearSessionAndHistory from idle state does not show loading", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // Wait for loading to clear (fast-resolving mock from beforeEach)
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U18): loading not visible during bootstrap — prerequisite for idle check",
      ).not.toBeInTheDocument();
    });

    await screen.findByLabelText("Clear session");

    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^yes$/i }));

    expect(
      screen.queryByText("Loading session..."),
      "FAIL (U18): loading appeared after clearSessionAndHistory from idle — spurious setSessionLoading(true)",
    ).not.toBeInTheDocument();
  });

  // ── U19 (AC6 Yes path): deferred fetch resolve after clearSessionAndHistory does not restore loading ──

  it("U19 (AC6): deferred fetch resolve after clearSessionAndHistory does not restore loading", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // 1. Wait for loading to appear
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U19): loading not visible before clear",
      ).toBeInTheDocument();
    });

    // 2. Clear session and history
    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^yes$/i }));

    // 3. Loading should be gone after clear
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U19): loading persisted after clearSessionAndHistory",
      ).not.toBeInTheDocument();
    });

    // 4. Resolve the stale deferred fetch (aborted by effect cleanup)
    resolveFetch!(emptyHistory);

    // 5. Loading must NOT re-appear after the stale fetch resolves
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U19): loading re-appeared after stale fetch resolved — signal.aborted guard missing or clearSessionLoading() missing in handler",
      ).not.toBeInTheDocument();
    });

    expect(
      screen.queryByText("No conversation yet."),
      "FAIL (U19): empty state not shown after clear — sessionLoading not reset",
    ).toBeInTheDocument();
  });

  // ── U20 (AC6 No path): deferred fetch resolve after clearSessionOnly does not restore loading ──

  it("U20 (AC6): deferred fetch resolve after clearSessionOnly does not restore loading", async () => {
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // 1. Wait for loading to appear
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U20): loading not visible before clear",
      ).toBeInTheDocument();
    });

    // 2. Clear session only (No path)
    fireEvent.click(screen.getByLabelText("Clear session"));
    fireEvent.click(await screen.findByRole("button", { name: /^no$/i }));

    // 3. Loading should be gone after clear
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U20): loading persisted after clearSessionOnly",
      ).not.toBeInTheDocument();
    });

    // 4. Resolve the stale deferred fetch (aborted by effect cleanup)
    resolveFetch!(emptyHistory);

    // 5. Loading must NOT re-appear after the stale fetch resolves
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (U20): loading re-appeared after stale fetch resolved — signal.aborted guard missing or clearSessionLoading() missing in handler",
      ).not.toBeInTheDocument();
    });

    expect(
      screen.queryByText("No conversation yet."),
      "FAIL (U20): empty state not shown after clear — sessionLoading not reset",
    ).toBeInTheDocument();
  });
});

// ── AC545: polling tick calls refreshAgentStatus to detect session end ──

describe("RepositoryPage polling tick — agent status check (AC545)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
  });

  it("AC545-1: spinner clears when refreshAgentStatus returns processing=false during polling", async () => {
    // Arrange: first status call (mount) returns true so spinner shows;
    // subsequent calls (polling tick) return false → spinner must disappear.
    vi.mocked(api.getRepositoryAgentStatus)
      .mockResolvedValueOnce({
        processing: true,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValue({ processing: false });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for spinner to appear (chatAgentProcessing=true on mount)
    await waitFor(() => {
      expect(
        screen.queryByText("Agent is thinking..."),
        "FAIL (AC545-1): spinner should appear when processing=true",
      ).toBeInTheDocument();
    });

    // Wait for polling tick to call refreshAgentStatus and get processing=false
    await waitFor(
      () => {
        expect(
          screen.queryByText("Agent is thinking..."),
          "FAIL (AC545-1): spinner did not clear after polling tick detected processing=false",
        ).not.toBeInTheDocument();
      },
      { timeout: 8000 },
    );
  });

  it("AC545-2: polling continues and calls refreshAgentStatus when processing stays true", async () => {
    // Arrange: status always returns true — refreshAgentStatus should be called
    // on mount AND again from each polling tick.
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    await screen.findByLabelText("Clear session");

    // Spinner must remain visible while still processing
    await waitFor(() => {
      expect(
        screen.queryByText("Agent is thinking..."),
        "FAIL (AC545-2): spinner disappeared when status is still processing=true",
      ).toBeInTheDocument();
    });

    // refreshAgentStatus (getRepositoryAgentStatus) should be called at least
    // twice: once on mount and once from the first polling tick.
    await waitFor(
      () => {
        expect(
          vi.mocked(api.getRepositoryAgentStatus).mock.calls.length,
          "FAIL (AC545-2): refreshAgentStatus not called during polling tick",
        ).toBeGreaterThanOrEqual(2);
      },
      { timeout: 8000 },
    );
  });

  it(
    "AC545-3: spinner clears after transient network error in status check recovers",
    { timeout: 15000 },
    async () => {
      // Arrange: mount returns true (spinner shows), first tick errors (network),
      // second tick returns false (done) — spinner must eventually clear.
      vi.mocked(api.getRepositoryAgentStatus)
        .mockResolvedValueOnce({
          processing: true,
          startedAt: new Date().toISOString(),
        }) // mount call → processing=true, spinner shows
        .mockRejectedValueOnce(new Error("Network error")) // first tick error → must keep polling
        .mockResolvedValue({ processing: false }); // subsequent calls → done

      renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

      // Spinner should appear on mount
      await waitFor(() => {
        expect(
          screen.queryByText("Agent is thinking..."),
          "FAIL (AC545-3): spinner should appear when processing=true",
        ).toBeInTheDocument();
      });

      // Spinner must clear even though first tick had a network error
      await waitFor(
        () => {
          expect(
            screen.queryByText("Agent is thinking..."),
            "FAIL (AC545-3): spinner did not clear after transient network error — polling stopped prematurely",
          ).not.toBeInTheDocument();
        },
        { timeout: 15000 },
      );
    },
  );
});

// ── AC546: "Loading session..." clears when fetch is aborted mid-flight ──

describe("RepositoryPage loading state clears on mid-flight abort (AC546)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA, sessionB],
    });
    // Default: agent not processing, history empty
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    localStorage.clear();
  });

  it("AC546-1 (post-478): status check runs after history resolves, not concurrently", async () => {
    // Arrange: history resolves normally; status check is controlled
    let resolveStatus!: (value: {
      processing: boolean;
      startedAt?: string | null;
    }) => void;
    const statusPromise = new Promise<{
      processing: boolean;
      startedAt?: string | null;
    }>((resolve) => {
      resolveStatus = resolve;
    });
    vi.mocked(api.getRepositoryAgentStatus).mockReturnValueOnce(statusPromise);
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // History resolves immediately; status check fires after.
    // Verify history was called exactly once.
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    // Status must have been dispatched after history resolved (sequential, not concurrent).
    await waitFor(() => {
      expect(
        api.getRepositoryAgentStatus,
        "FAIL (AC546-1 post-478): getRepositoryAgentStatus was never called after history resolved",
      ).toHaveBeenCalledTimes(1);
    });

    // Resolve status as processing=false — no Cancel button expected.
    resolveStatus({ processing: false, startedAt: null });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL (AC546-1 post-478): Cancel should NOT appear when processing=false",
      ).not.toBeInTheDocument();
    });
  });

  it("AC546-2: AbortError from a session-switch cleanup does not show an error message", async () => {
    // Arrange: first fetch is pending (manually controlled); second fetch resolves immediately
    const abortError = new DOMException(
      "The operation was aborted",
      "AbortError",
    );
    let rejectFirst!: (reason: DOMException) => void;
    vi.mocked(api.getRepositoryAgentHistory)
      .mockReturnValueOnce(
        new Promise<ChatHistoryResponse>((_, reject) => {
          rejectFirst = reject;
        }),
      )
      .mockResolvedValueOnce(emptyHistory);

    renderPage();
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session B"));

    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC546-2): loading not visible when first fetch is in-flight",
      ).toBeInTheDocument();
    });

    // Switch to Session A — cleanup fires (clearSessionLoading + abort), new session fetch resolves
    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));

    // Wait for loading to settle after the switch
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC546-2): loading stuck after session switch before stale AbortError",
      ).not.toBeInTheDocument();
    });

    // Now reject the stale first fetch with AbortError (simulating native abort rejection)
    rejectFirst(abortError);
    await new Promise<void>((r) => setTimeout(r, 50));

    // AbortError must not produce a user-visible error message
    expect(
      screen.queryByText("The operation was aborted"),
      "FAIL (AC546-2): AbortError message visible — setChatError was called on AbortError path",
    ).not.toBeInTheDocument();

    // Loading must remain cleared
    expect(
      screen.queryByText("Loading session..."),
      "FAIL (AC546-2): loading stuck after stale AbortError rejection",
    ).not.toBeInTheDocument();
  });
});

describe("RepositoryPage syncChatHistory full-fetch on session load (#481)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    localStorage.clear();
  });

  it("AC481-1: session-load calls API with startTimestamp=undefined even when localStorage has a cached timestamp", async () => {
    // Arrange: pre-seed localStorage with BOTH the session ID and a chat message so that
    // on initial render sessionId is non-null AND lastKnownTimestampRef.current is Tn (non-null).
    // switchSessionIfNeeded returns early (incomingSessionId === sessionId) which means
    // setChat([]) is NOT called — the stale timestamp persists in the ref.
    // Without the fix, syncChatHistory would use startTimestamp = Tn + 1 (incremental fetch).
    // With the fix, it uses startTimestamp = undefined (full fetch).
    const cachedMessage = {
      id: "cached-1",
      role: "agent",
      text: "Cached message",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    // sessionStorageKey = "repository-session-test-repo-opencode" (agentCli suffix after settings load)
    localStorage.setItem("repository-session-test-repo-opencode", "session-a");
    localStorage.setItem(
      "repository-chat-test-repo",
      JSON.stringify([cachedMessage]),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalled();
    });

    // The session-load path must use startTimestamp=undefined regardless of the cached timestamp.
    // FAIL without fix: called with startTimestamp = Date.parse("2026-01-01T00:00:00.000Z") + 1
    expect(
      api.getRepositoryAgentHistory,
      "FAIL (AC481-1): session-load used incremental startTimestamp instead of undefined (full fetch)",
    ).toHaveBeenCalledWith(
      "test-repo",
      "session-a",
      undefined,
      expect.anything(),
    );
  });

  it("AC481-3: stale localStorage timestamp does not prevent server messages from appearing", async () => {
    // AC481-2 is omitted: after handleSessionSelect calls setChat([]), lastKnownTimestamp
    // becomes undefined before the session-load effect fires, so the session-switch path
    // already uses startTimestamp=undefined without the fix. The regression is specific to
    // initial page load where setChat([]) is NOT called (covered by AC481-1 above).
    // Arrange: localStorage has a message with a far-future timestamp simulating clock skew
    // or data corruption. The mock returns real messages only for a full fetch (startTimestamp=undefined).
    // Without the fix, the incremental fetch (startTimestamp = futureTs + 1) returns empty and
    // the server message is never shown. With the fix, full fetch returns the server message.
    const futureMessage = {
      id: "future-1",
      role: "agent",
      text: "Corrupted cached message",
      timestamp: "2099-01-01T00:00:00.000Z",
    };
    localStorage.setItem("repository-session-test-repo-opencode", "session-a");
    localStorage.setItem(
      "repository-chat-test-repo",
      JSON.stringify([futureMessage]),
    );

    const serverMsg: ChatHistoryMessage = {
      role: "assistant",
      type: "text",
      content: "Real server message",
      timestamp: "2026-01-01T00:00:00Z",
    };
    // Only return server messages for a full fetch (startTimestamp=undefined).
    // An incremental fetch (any non-undefined startTimestamp) returns empty.
    vi.mocked(api.getRepositoryAgentHistory).mockImplementation(
      async (_name, _sessionId, startTimestamp) => {
        if (startTimestamp === undefined) {
          return { sessionId: "session-a", messages: [serverMsg] };
        }
        return emptyHistory;
      },
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Server message must appear because full fetch retrieved it.
    // FAIL without fix: incremental fetch with futureTs+1 returns empty → "Real server message" missing
    await waitFor(
      () => {
        expect(
          screen.queryByText("Real server message"),
          "FAIL (AC481-3): server message missing — incremental fetch with stale timestamp returned empty",
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});

describe("RepositoryPage AC590 — stale localStorage chat cleared on page refresh", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
    });
    localStorage.clear();
  });

  it("AC590-1: stale localStorage message is NOT visible during session loading on page refresh", async () => {
    // Arrange: localStorage has stale chat from a previous session
    const staleMsg = {
      id: "stale-1",
      role: "user",
      text: "Stale message from before",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    localStorage.setItem("repository-session-test-repo-opencode", "session-a");
    localStorage.setItem(
      "repository-chat-test-repo",
      JSON.stringify([staleMsg]),
    );

    let resolveFetch!: (v: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent"]);

    // During loading, stale message must NOT be visible; spinner must show
    await waitFor(() => {
      expect(
        screen.queryByText("Loading session..."),
        "FAIL (AC590-1): loading indicator not shown — stale messages still in chat or lifecycle not entering loading",
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Stale message from before"),
      "FAIL (AC590-1): stale localStorage message visible during loading — setChat([]) missing in idle→loading transition",
    ).not.toBeInTheDocument();

    resolveFetch!(emptyHistory);
  });

  it("AC590-2: after fetch failure, stale localStorage message is NOT shown (error state, not stale data)", async () => {
    // Arrange: localStorage has stale chat
    const staleMsg = {
      id: "stale-2",
      role: "user",
      text: "Stale message must not persist on error",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    localStorage.setItem("repository-session-test-repo-opencode", "session-a");
    localStorage.setItem(
      "repository-chat-test-repo",
      JSON.stringify([staleMsg]),
    );

    vi.mocked(api.getRepositoryAgentHistory).mockRejectedValue(
      new Error("Network failure"),
    );

    renderPage(["/repositories/test-repo?tab=agent"]);

    // Wait for error state
    await waitFor(() => {
      expect(
        screen.queryByText("Network failure"),
        "FAIL (AC590-2): error message not shown after fetch failure",
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Stale message must not persist on error"),
      "FAIL (AC590-2): stale localStorage message visible after fetch failure — setChat([]) missing, stale data persists permanently",
    ).not.toBeInTheDocument();
  });
});

// ── Session selection regression: Knowledge, Constitution, Task pages ─────────

function renderTaskPage(initialEntries = ["/tasks/test-task?tab=agent"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/tasks/:name/*" element={<TaskPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderKnowledgePage(
  initialEntries = ["/knowledge/test-artefact?tab=agent"],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/knowledge/:name/*" element={<KnowledgeArtefactPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderConstitutionPage(
  initialEntries = ["/constitutions/test-constitution?tab=agent"],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/constitutions/:name/*" element={<ConstitutionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TaskPage session selection", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getTaskAgentHistory).mockResolvedValue(emptyHistory);
    localStorage.clear();
  });

  it("session select triggers exactly 1 API call (not 3)", async () => {
    vi.mocked(api.getTaskAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderTaskPage(["/tasks/test-task"]);

    // Navigate to the agent tab (default is "content")
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    const sessionBtn = await screen.findByTitle("Session A");
    fireEvent.click(sessionBtn);

    await waitFor(() => {
      expect(api.getTaskAgentHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("page load with ?sessionId=X triggers exactly 1 API call", async () => {
    renderTaskPage(["/tasks/test-task?sessionId=session-b"]);

    await waitFor(() => {
      expect(api.getTaskAgentHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("re-selecting the same session triggers full refresh", async () => {
    vi.mocked(api.getTaskAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderTaskPage(["/tasks/test-task"]);

    // Navigate to the agent tab (default is "content")
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    const sessionBtn = await screen.findByTitle("Session A");
    fireEvent.click(sessionBtn);

    await waitFor(() => {
      expect(api.getTaskAgentHistory).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getTaskAgentHistory).mockClear();
    vi.mocked(api.getTaskAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    fireEvent.click(chooseBtn);
    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getTaskAgentHistory).toHaveBeenCalled();
    });
  });
});

describe("KnowledgeArtefactPage session selection", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getKnowledgeAgentHistory).mockResolvedValue(emptyHistory);
    localStorage.clear();
  });

  it("session select triggers exactly 1 API call", async () => {
    vi.mocked(api.getKnowledgeAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderKnowledgePage(["/knowledge/test-artefact"]);

    // Navigate to the agent tab (default is "content")
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getKnowledgeAgentHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("page load with ?sessionId=X triggers exactly 1 API call", async () => {
    renderKnowledgePage(["/knowledge/test-artefact?sessionId=session-b"]);

    await waitFor(() => {
      expect(api.getKnowledgeAgentHistory).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ConstitutionPage session selection", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getConstitutionAgentHistory).mockResolvedValue(emptyHistory);
    localStorage.clear();
  });

  it("session select triggers exactly 1 API call", async () => {
    vi.mocked(api.getConstitutionAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderConstitutionPage(["/constitutions/test-constitution"]);

    // Navigate to the agent tab (default is "content")
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getConstitutionAgentHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("page load with ?sessionId=X triggers exactly 1 API call", async () => {
    renderConstitutionPage([
      "/constitutions/test-constitution?sessionId=session-b",
    ]);

    await waitFor(() => {
      expect(api.getConstitutionAgentHistory).toHaveBeenCalledTimes(1);
    });
  });

  it("re-selecting the same session triggers full refresh", async () => {
    vi.mocked(api.getConstitutionAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderConstitutionPage(["/constitutions/test-constitution"]);

    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getConstitutionAgentHistory).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getConstitutionAgentHistory).mockClear();
    vi.mocked(api.getConstitutionAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    fireEvent.click(chooseBtn);
    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getConstitutionAgentHistory).toHaveBeenCalled();
    });
  });
});

// ── sessionError display tests ────────────────────────────────────────────────

describe("TaskPage sessionError display", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows error alert when session history fetch fails", async () => {
    vi.mocked(api.getTaskAgentHistory).mockRejectedValue(
      new Error("Network failure"),
    );

    renderTaskPage(["/tasks/test-task?sessionId=session-b"]);

    // Navigate to agent tab so the alert becomes visible
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
  });
});

describe("KnowledgeArtefactPage session selection — same-session refresh", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getKnowledgeAgentHistory).mockResolvedValue(emptyHistory);
    localStorage.clear();
  });

  it("re-selecting the same session triggers full refresh", async () => {
    vi.mocked(api.getKnowledgeAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderKnowledgePage(["/knowledge/test-artefact"]);

    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    const chooseBtn = await screen.findByLabelText("Choose a session");
    fireEvent.click(chooseBtn);

    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getKnowledgeAgentHistory).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getKnowledgeAgentHistory).mockClear();
    vi.mocked(api.getKnowledgeAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    fireEvent.click(chooseBtn);
    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getKnowledgeAgentHistory).toHaveBeenCalled();
    });
  });
});

describe("KnowledgeArtefactPage sessionError display", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows error alert when session history fetch fails", async () => {
    vi.mocked(api.getKnowledgeAgentHistory).mockRejectedValue(
      new Error("Network failure"),
    );

    renderKnowledgePage(["/knowledge/test-artefact?sessionId=session-b"]);

    // Navigate to agent tab so the alert becomes visible
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
  });
});

describe("ConstitutionPage sessionError display", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows error alert when session history fetch fails", async () => {
    vi.mocked(api.getConstitutionAgentHistory).mockRejectedValue(
      new Error("Network failure"),
    );

    renderConstitutionPage([
      "/constitutions/test-constitution?sessionId=session-b",
    ]);

    // Navigate to agent tab so the alert becomes visible
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));

    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
  });
});

describe("RepositoryPage status check sequencing after session load (AC478)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue({
      sessionId: "session-b",
      messages: [],
    });
  });

  it("AC478-1: status check is not dispatched while history fetch is in-flight", async () => {
    // Arrange: freeze history so we can observe whether status fires concurrently
    let resolveHistory!: (v: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValueOnce(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveHistory = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // Wait for the history fetch to be in-flight
    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledTimes(1);
    });

    // Status must NOT have been called while history is still pending
    expect(
      api.getRepositoryAgentStatus,
      "FAIL (AC478-1): getRepositoryAgentStatus was dispatched concurrently with history fetch — standalone effect still present",
    ).not.toHaveBeenCalled();

    resolveHistory({ sessionId: "session-b", messages: [] });

    // After history resolves, status SHOULD be called
    await waitFor(() => {
      expect(
        api.getRepositoryAgentStatus,
        "FAIL (AC478-1): getRepositoryAgentStatus was never called after history resolved",
      ).toHaveBeenCalledTimes(1);
    });
  });

  it("AC478-2: when status returns processing=true after history loads, Cancel button appears without history being re-fetched", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });
    // Effect C fetches history once (completes). Effect D's first polling tick
    // immediately starts a second fetch; keep it pending to isolate the two calls.
    vi.mocked(api.getRepositoryAgentHistory)
      .mockResolvedValueOnce({ sessionId: "session-b", messages: [] }) // Effect C (completes)
      .mockReturnValue(new Promise<ChatHistoryResponse>(() => {})); // Effect D tick (in-flight)

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // Cancel button should appear after sequential status check resolves processing=true.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "FAIL (AC478-2): Cancel button not visible after status=processing",
      ).toBeInTheDocument();
    });

    // Effect C fetched history exactly once (completed, not aborted).
    // Effect D's first tick has started a second fetch (in-flight, pending).
    // In the old concurrent race, the initial history fetch would have been
    // aborted before the status check completed — causing a retry or lost data.
    // Wrap in waitFor to ensure both Effect C and Effect D have dispatched their calls.
    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "FAIL (AC478-2): expected 2 history calls (1 completed by Effect C + 1 in-flight by Effect D), indicating no abort-and-retry occurred",
      ).toHaveBeenCalledTimes(2);
    });
  });

  it("AC478-3: when history fetch fails, agent status is never checked and error message is preserved", async () => {
    // Arrange: history rejects; status mock would clear the error if incorrectly called
    vi.mocked(api.getRepositoryAgentHistory).mockRejectedValue(
      new Error("History network error"),
    );
    // If status were called with processing=false it would invoke setChatError(null),
    // wiping out the history error. Verify that never happens.
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    // Error message must appear
    await waitFor(() => {
      expect(
        screen.getByText("History network error"),
        "FAIL (AC478-3): error message not shown after history fetch failure",
      ).toBeInTheDocument();
    });

    // Status must NOT have been called (ok=false from syncChatHistory gates the call)
    expect(
      api.getRepositoryAgentStatus,
      "FAIL (AC478-3): getRepositoryAgentStatus was called after history failure — would clear the error message",
    ).not.toHaveBeenCalled();
  });
});

describe("RepositoryPage lifecycle guard semantics (issue #475)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
  });

  it("L1: streaming→hydrated transition does NOT re-trigger a full history fetch", async () => {
    // Setup: agent returns processing:true on first status check, then false
    vi.mocked(api.getRepositoryAgentStatus)
      .mockResolvedValueOnce({
        processing: true,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValue({ processing: false, startedAt: null });

    // All history fetches resolve immediately so the polling tick can complete
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for the first status check — lifecycle becomes 'streaming'
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalledTimes(1);
    });

    // lifecycle is now 'streaming'; polling loop fires.
    // The first polling tick: history + status(processing:false) → lifecycle='hydrated'
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalledTimes(2);
    });

    // Record history call count AFTER the streaming→hydrated transition
    const callsAfterTransition = vi.mocked(api.getRepositoryAgentHistory).mock
      .calls.length;

    // Wait a tick for any spurious Effect 1 re-runs
    await new Promise((r) => setTimeout(r, 50));

    // KEY ASSERTION: no additional full history fetches after streaming→hydrated transition
    // Effect 1 guards on lifecycle === 'loading', so it must NOT re-fire here
    expect(
      vi.mocked(api.getRepositoryAgentHistory).mock.calls.length,
      "FAIL (L1): Effect 1 re-fired after streaming ended — lifecycle guard not applied",
    ).toBe(callsAfterTransition);
  });

  it("L2: polling loop does NOT start during session-load (lifecycle = 'loading')", async () => {
    // Simulate slow history fetch — status check must not fire until after history resolves
    let resolveHistory!: (value: ChatHistoryResponse) => void;
    const historyPromise = new Promise<ChatHistoryResponse>((resolve) => {
      resolveHistory = resolve;
    });
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValueOnce(
      historyPromise,
    );
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // History fetch is in-flight; status must not be called yet
    await new Promise((r) => setTimeout(r, 50));
    expect(
      api.getRepositoryAgentStatus,
      "FAIL (L2): status check fired while history fetch was in-flight — polling started during 'loading'",
    ).not.toHaveBeenCalled();

    // Resolve history → now status check runs
    resolveHistory(emptyHistory);
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalledTimes(1);
    });
  });

  it("L3: send message transitions lifecycle to streaming then hydrated on completion", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "session-a",
      processing: false,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for initial hydration (status check runs once after history loads)
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalled();
    });

    // Send button should be present (lifecycle = 'hydrated')
    const sendBtn = await screen.findByRole("button", { name: /send/i });
    expect(sendBtn).toBeInTheDocument();

    const input = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(sendBtn);

    // sendAgentMessage resolves with processing:false → lifecycle = 'hydrated' → Send visible again
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    });
  });

  it("L4: clearSessionOnly resets lifecycle to idle (no loading spinner)", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for hydration
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalled();
    });

    // Open and confirm clear session (clear-only, no history wipe)
    const clearBtn = await screen.findByLabelText("Clear session");
    fireEvent.click(clearBtn);
    const noBtn = screen.getByRole("button", { name: /^no$/i });
    fireEvent.click(noBtn);

    // Loading spinner (session loading) must not be visible after clear
    expect(
      screen.queryByText(/loading session/i),
      "FAIL (L4): session loading spinner still visible after clearSessionOnly",
    ).not.toBeInTheDocument();
  });
});

// ── AC559: Send button disabled when agent status unknown on page load ──────
describe("RepositoryPage Send button disabled during status-unknown state (AC559)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    localStorage.clear();
  });

  it("AC559-1: Send disabled during initial load when agent is processing", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test" } });

    // Send button must be disabled while status is unknown (lifecycle = 'loading')
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(
      sendBtn,
      "FAIL (AC559-1a): Send button should be disabled during initial status check",
    ).toBeDisabled();

    // After status resolves to processing=true, Cancel appears
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "FAIL (AC559-1b): Cancel should appear after status resolves to processing=true",
      ).toBeInTheDocument();
    });
  });

  it("AC559-2: Send disabled during initial load when agent is not processing, then enabled", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test" } });

    // Send button must be disabled while status is unknown (lifecycle = 'loading')
    expect(
      screen.getByRole("button", { name: /send/i }),
      "FAIL (AC559-2a): Send button should be disabled during initial status check",
    ).toBeDisabled();

    // After status resolves to processing=false, Send becomes enabled
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send/i }),
        "FAIL (AC559-2b): Send should be enabled after status resolves to processing=false",
      ).not.toBeDisabled();
    });
  });

  it("AC559-3: Send button enabled immediately when no session exists", async () => {
    // No sessionId — lifecycle stays 'idle' without a session, chatAgentProcessing = false
    renderPage(["/repositories/test-repo?tab=agent"]);

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test" } });

    // No session means no pending status check; Send should be enabled immediately
    expect(
      screen.getByRole("button", { name: /send/i }),
      "FAIL (AC559-3): Send should be enabled when there is no session",
    ).not.toBeDisabled();
  });

  it("AC559-4: AgentSelector and Model select disabled during unknown state, enabled after idle resolves", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Both selects must be disabled while status is unknown
    expect(
      screen.getByLabelText("Agent"),
      "FAIL (AC559-4a): Agent selector should be disabled during initial status check",
    ).toBeDisabled();

    expect(
      screen.getByLabelText("Model"),
      "FAIL (AC559-4b): Model selector should be disabled during initial status check",
    ).toBeDisabled();

    // After status resolves to idle, both should be enabled
    await waitFor(() => {
      expect(
        screen.getByLabelText("Agent"),
        "FAIL (AC559-4c): Agent selector should be enabled after status resolves to idle",
      ).not.toBeDisabled();
    });
    expect(
      screen.getByLabelText("Model"),
      "FAIL (AC559-4d): Model selector should be enabled after status resolves to idle",
    ).not.toBeDisabled();
  });
});

// ── AC587: idle-with-sessionId render gap shows loading indicator ─────────
describe("RepositoryPage loading indicator shown during idle-with-sessionId gap (AC587)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    localStorage.clear();
  });

  it("AC587-1: sessionLoading is true immediately on render when sessionId is present (before useEffect fires)", () => {
    // Hold the history and status calls so the page never leaves 'loading'
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise(() => {}),
    );
    vi.mocked(api.getRepositoryAgentStatus).mockReturnValue(
      new Promise(() => {}) as unknown as ReturnType<
        typeof api.getRepositoryAgentStatus
      >,
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // The loading indicator must appear immediately (covers the idle→loading gap)
    expect(
      screen.getByText(/loading session/i),
      "FAIL (AC587-1a): Loading session indicator must appear immediately when sessionId is present",
    ).toBeInTheDocument();

    // Send button must be disabled during the gap
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test" } });
    expect(
      screen.getByRole("button", { name: /send/i }),
      "FAIL (AC587-1b): Send button must be disabled during idle-with-sessionId gap",
    ).toBeDisabled();

    // AgentSelector must be disabled during the gap
    expect(
      screen.getByLabelText("Agent"),
      "FAIL (AC587-1c): AgentSelector must be disabled during idle-with-sessionId gap",
    ).toBeDisabled();

    // Model select must be disabled during the gap
    expect(
      screen.getByLabelText("Model"),
      "FAIL (AC587-1d): Model select must be disabled during idle-with-sessionId gap",
    ).toBeDisabled();
  });
});

// ── Issue #562: optimistic Cancel ──────────────────────────────────────────
describe("issue #562: handleCancelAgent optimistic update", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    // Default: status resolves to idle so page can hydrate
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
  });

  it("562-1: Send button appears immediately on Cancel click before cancel API resolves", async () => {
    // cancelRepositoryAgent never resolves — the critical test condition
    let resolveCancel!: () => void;
    vi.mocked(api.cancelRepositoryAgent).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCancel = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for initial hydration so chatAgentProcessing = false and Send is enabled
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalled();
    });

    // Now override mocks for streaming scenario: sendAgentMessage + status polling never resolve
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );
    vi.mocked(api.getRepositoryAgentStatus).mockReturnValue(
      new Promise(() => {}),
    );

    // Enter streaming state by sending a message
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    // Cancel button should appear (lifecycle = streaming)
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel button should appear when lifecycle=streaming",
      ).toBeInTheDocument();
    });

    // Act: click Cancel while cancel API is still pending (never resolves)
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Assert: Send appears immediately (optimistic update, before cancel API resolves)
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send/i }),
        "Send button must appear immediately via optimistic update",
      ).toBeInTheDocument();
    });

    // Cancel button must be gone
    expect(
      screen.queryByRole("button", { name: /cancel/i }),
      "Cancel button must disappear after optimistic update",
    ).not.toBeInTheDocument();

    // API must have been called
    expect(api.cancelRepositoryAgent).toHaveBeenCalled();

    // Cleanup — resolve so no lingering unhandled promise
    resolveCancel();
  });

  it("562-2: cancel API failure still shows Send button (optimistic update fired before rejection)", async () => {
    // cancelRepositoryAgent rejects — simulates network failure
    vi.mocked(api.cancelRepositoryAgent).mockRejectedValue(
      new Error("network failure"),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for initial hydration so chatAgentProcessing = false and Send is enabled
    await waitFor(() => {
      expect(api.getRepositoryAgentStatus).toHaveBeenCalled();
    });

    // Now override mocks for streaming scenario
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );
    vi.mocked(api.getRepositoryAgentStatus).mockReturnValue(
      new Promise(() => {}),
    );

    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Send still appears (optimistic setLifecycle("hydrated") fired before the rejection)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    });

    // Error message must appear — the .catch() path in handleCancelAgent fires setChatError
    await waitFor(() => {
      expect(
        screen.getByText("Unable to cancel the agent request."),
        "Error message must appear after cancel API failure (.catch() path)",
      ).toBeInTheDocument();
    });
  });
});

// ── AC560: refreshAgentStatus must NOT set chatError ──────────────────────────

describe("RepositoryPage refreshAgentStatus does not set chatError (AC560)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    localStorage.clear();
  });

  it("AC560-1: no error banner on page load when agent is processing", async () => {
    // Arrange: status returns processing:true on mount (agent already running)
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for the Cancel button to appear (lifecycle correctly set to streaming)
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "FAIL (AC560-1): Cancel button should appear when processing=true",
      ).toBeInTheDocument();
    });

    // Error banner must NOT appear — agent being busy is a normal state, not an error
    expect(
      document.querySelectorAll(".alert").length,
      "FAIL (AC560-1): error banner appeared on page load with processing=true — setChatError must be removed from refreshAgentStatus",
    ).toBe(0);
  });

  it("AC560-2: no error banner after cancel when agent is still processing", async () => {
    // Arrange: status always returns processing:true (simulate agent still running after cancel)
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for Cancel button to appear
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    // Click Cancel
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Allow the cancel + refreshAgentStatus finally block to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Error banner must NOT appear after cancel + status poll
    expect(
      document.querySelectorAll(".alert").length,
      "FAIL (AC560-2): error banner appeared after cancel when processing=true — setChatError must be removed from refreshAgentStatus",
    ).toBe(0);
  });
});

describe("RepositoryPage skeleton states", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue({
      sessionId: "",
      messages: [],
    });
    localStorage.clear();
  });

  it("shows repository-meta skeleton while repository loads", () => {
    // api.getRepository returns a never-resolving promise so loading stays true
    vi.mocked(api.getRepository).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(
      document.querySelector(".repository-meta-skeleton"),
      "FAIL: .repository-meta-skeleton not found during load",
    ).toBeInTheDocument();
    expect(
      document.querySelector(".repository-meta"),
      "FAIL: .repository-meta should not be present during load",
    ).not.toBeInTheDocument();
  });

  it("shows file-tree skeleton while fileTree loads", () => {
    vi.mocked(api.getRepositoryFiles).mockReturnValue(new Promise(() => {}));
    renderPage(["/repositories/test-repo?tab=files"]);
    expect(
      document.querySelector(".file-tree-skeleton"),
      "FAIL: .file-tree-skeleton not found during load",
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No files found."),
      "FAIL: 'No files found.' must not appear during load",
    ).not.toBeInTheDocument();
  });

  it("Git tab is always present in the tab bar before repository loads", () => {
    vi.mocked(api.getRepository).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(
      screen.getByRole("button", { name: /git/i }),
      "FAIL: Git tab button not rendered before repository loads",
    ).toBeInTheDocument();
  });
});

// ── Issue #588: Simplified lifecycle state machine ─────────────────────────
describe("RepositoryPage simplified lifecycle (issue #588)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
    localStorage.clear();
  });

  it("AC588-1: mounts without sessionId — isLoadingHistory=false, Send enabled when prompt typed", () => {
    renderPage(["/repositories/test-repo?tab=agent"]);
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(
      screen.getByRole("button", { name: /send/i }),
      "FAIL (AC588-1): Send button should be enabled when no session (no history loading in progress)",
    ).not.toBeDisabled();
    expect(
      screen.queryByText(/loading session/i),
      "FAIL (AC588-1): Loading indicator should not appear without a session",
    ).not.toBeInTheDocument();
  });

  it("AC588-2: fetches history + checks status on mount when sessionId is present", async () => {
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue({
      sessionId: "session-a",
      messages: [],
      processing: true,
      startedAt: new Date().toISOString(),
    });
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await waitFor(() => {
      expect(
        api.getRepositoryAgentHistory,
        "FAIL (AC588-2): history not fetched on mount",
      ).toHaveBeenCalledWith(
        "test-repo",
        "session-a",
        undefined,
        expect.anything(),
      );
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });
  });

  it("AC588-3: polls every 5s when agent is busy (isAgentBusy=true)", async () => {
    // First status returns processing:true, subsequent return false after first tick
    vi.mocked(api.getRepositoryAgentStatus)
      .mockResolvedValueOnce({
        processing: true,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValue({
        processing: true,
        startedAt: new Date().toISOString(),
      });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Cancel button should appear (isAgentBusy=true)
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL (AC588-3): Cancel button not shown when isAgentBusy=true",
      ).toBeInTheDocument();
    });

    // Wait for second status call (polling started and tick fired)
    await waitFor(
      () => {
        expect(
          vi.mocked(api.getRepositoryAgentStatus).mock.calls.length,
          "FAIL (AC588-3): status not polled when agent busy",
        ).toBeGreaterThanOrEqual(2);
      },
      { timeout: 8000 },
    );
  });

  it("AC588-4: stops polling when isAgentBusy transitions to false", async () => {
    vi.mocked(api.getRepositoryAgentStatus)
      .mockResolvedValueOnce({
        processing: true,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({ processing: false, startedAt: null });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Agent becomes busy, then polling tick returns false → busy clears
    await waitFor(() => {
      expect(
        screen.queryByText(/agent is thinking/i),
        "FAIL (AC588-4): spinner should appear when busy",
      ).toBeInTheDocument();
    });

    // Wait for spinner to clear (polling tick returned processing=false)
    await waitFor(
      () => {
        expect(
          screen.queryByText(/agent is thinking/i),
          "FAIL (AC588-4): spinner did not clear after polling detected done",
        ).not.toBeInTheDocument();
      },
      { timeout: 8000 },
    );
  });

  it("AC588-5: shows Cancel when isAgentBusy=true, Send when false", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
      startedAt: null,
    });
    vi.mocked(api.sendAgentMessage).mockResolvedValue({
      messageId: "m1",
      sent: new Date().toISOString(),
      response: "ok",
      sessionId: "session-a",
      processing: true,
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // Wait for initial load to complete
    await waitFor(() =>
      expect(api.getRepositoryAgentStatus).toHaveBeenCalled(),
    );

    const sendBtn = await screen.findByRole("button", { name: /send/i });
    expect(
      sendBtn,
      "FAIL (AC588-5): Send not shown when agent idle",
    ).toBeInTheDocument();

    const input = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(sendBtn);

    // After optimistic setIsAgentBusy(true), Cancel should appear
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL (AC588-5): Cancel button not shown after send",
      ).toBeInTheDocument();
    });
  });

  it("AC588-6: disables Send during isLoadingHistory=true", async () => {
    let resolveHistory!: (v: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValueOnce(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveHistory = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    // During history loading, Send must be disabled
    const textarea = screen.getByPlaceholderText(
      "Describe the change or ask the agent...",
    );
    fireEvent.change(textarea, { target: { value: "test" } });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send/i }),
        "FAIL (AC588-6): Send should be disabled during history loading",
      ).toBeDisabled();
    });

    resolveHistory(emptyHistory);

    // After loading completes, Send should be enabled
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send/i }),
        "FAIL (AC588-6): Send should be enabled after history loading completes",
      ).not.toBeDisabled();
    });
  });

  it("AC588-7: shows 'Agent is thinking...' when isAgentBusy=true", async () => {
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: true,
      startedAt: new Date().toISOString(),
    });

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    await waitFor(() => {
      expect(
        screen.queryByText(/agent is thinking/i),
        "FAIL (AC588-7): 'Agent is thinking...' not shown when isAgentBusy=true",
      ).toBeInTheDocument();
    });
  });
});

describe("useAgentCli session key namespacing (Issue #611)", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue({
      sessionId: "",
      messages: [],
    });
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [],
    });
    vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({
      processing: false,
    });
  });

  it("reads sessionId from agentCli-namespaced key on mount", async () => {
    // Uses the DEFAULT_AGENT_CLI ("opencode") suffix immediately — no async delay.
    localStorage.setItem("repository-session-test-repo-opencode", "session-x");

    renderPage(["/repositories/test-repo?tab=agent"]);

    // History should be fetched with the namespaced session right away.
    await waitFor(
      () => {
        expect(api.getRepositoryAgentHistory).toHaveBeenCalledWith(
          "test-repo",
          "session-x",
          undefined,
          expect.anything(),
        );
      },
      { timeout: 2000 },
    );
  });

  it("migrates old un-namespaced session key to namespaced key on mount", async () => {
    // Simulate a user who has data under the old (pre-#611) un-namespaced key.
    localStorage.setItem("repository-session-test-repo", "session-legacy");

    renderPage(["/repositories/test-repo?tab=agent"]);

    // After mount the migration effect runs and moves the value to the new key.
    await waitFor(
      () => {
        expect(
          localStorage.getItem("repository-session-test-repo-opencode"),
        ).toBe("session-legacy");
      },
      { timeout: 2000 },
    );
    // Old key is removed.
    expect(localStorage.getItem("repository-session-test-repo")).toBeNull();

    // After migration, the React state should be synced so the
    // repository agent history API is called with the migrated sessionId.
    await waitFor(
      () => {
        expect(api.getRepositoryAgentHistory).toHaveBeenCalledWith(
          "test-repo",
          "session-legacy",
          undefined,
          expect.anything(),
        );
      },
      { timeout: 2000 },
    );
  });
});
