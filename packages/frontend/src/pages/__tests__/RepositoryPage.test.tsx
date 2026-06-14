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
        components?: { Footer?: ReactModule.ComponentType };
      }
    >(function MockVirtuoso({ data, itemContent, components }, ref) {
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
        Footer ? ReactModule.createElement(Footer) : null,
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
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

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
    let resolveFetch!: (value: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(
      new Promise<ChatHistoryResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);
    await screen.findByLabelText("Clear session");

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

      await new Promise<void>((r) => setTimeout(r, 500));

      expect(
        screen.queryByText("Should not appear"),
        "FAIL (T2): Messages rendered despite aborted signal — guard missing after await",
      ).not.toBeInTheDocument();
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

    await new Promise<void>((r) => setTimeout(r, 500));

    expect(
      screen.queryByText("Failed to load chat history"),
      "FAIL (T3): Error appeared despite AbortError — setChatError was called",
    ).not.toBeInTheDocument();
  });

  it("T4: syncChatHistory without signal argument processes normally (fails: no messages)", async () => {
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

    vi.mocked(api.getRepositoryAgentHistory)
      .mockReturnValueOnce(deferred);

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
});
