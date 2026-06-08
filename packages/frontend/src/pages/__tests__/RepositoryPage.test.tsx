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

  it("AC496-1: clearSessionOnly resets chatLoading when loading (fails: setChatLoading(false) missing)", async () => {
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );

    await renderAndWaitForClearButton();
    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel button should appear (chatLoading=true)",
      ).toBeInTheDocument();
    });

    openClearModal();

    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL: Cancel remains — handleClearSessionOnly missing setChatLoading(false)",
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send/i }),
        "Send should be enabled after clear",
      ).not.toBeDisabled();
    });
  });

  // ── AC496-2 ────────────────────────────────────────────────────────────

  it("AC496-2: clearSessionAndHistory resets chatLoading when loading (fails: setChatLoading(false) missing)", async () => {
    vi.mocked(api.sendAgentMessage).mockReturnValue(
      new Promise<AgentReply>(() => {}),
    );

    await renderAndWaitForClearButton();
    typeInTextarea();
    clickSend();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel/i }),
        "Cancel button should appear (chatLoading=true)",
      ).toBeInTheDocument();
    });

    openClearModal();

    await screen.findByRole("button", { name: /^yes$/i });
    confirmClearAndHistory();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "FAIL: Cancel remains — handleClearSessionAndHistory missing setChatLoading(false)",
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

  it("AC496-3: clearSessionOnly idempotent when chatLoading already false", async () => {
    await renderAndWaitForClearButton();

    vi.mocked(api.getRepositoryAgentHistory).mockClear();

    openClearModal();

    await screen.findByRole("button", { name: /^no$/i });
    confirmClearOnly();

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).not.toHaveBeenCalled();
    });
  });

  it("AC496-3: clearSessionAndHistory idempotent when chatLoading already false", async () => {
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
        "FAIL: 'Agent is thinking...' remains — handleClearSessionOnly missing setChatLoading(false)",
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

  it("U1 (AC1+AC3): refreshAgentStatus skips API call and does not re-stick chatLoading after clear", async () => {
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
      "FAIL (AC1): Cancel button remains after clear — refreshAgentStatus re-stuck chatLoading via effect re-fire",
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
        "FAIL (AC2): Cancel remains after clear — !sessionId guard missing or setChatLoading(false) missing in handler",
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
        "FAIL (U4 regression): Cancel should appear — refreshAgentStatus should setChatLoading(true) when session is active",
      ).toBeInTheDocument();
    });
  });

  // ── D1: AC6 stale-closure guard ──────────────────────────────────────

  it("D1 (AC6): stale in-flight refreshAgentStatus promise does not re-stick chatLoading after clear", async () => {
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

    // Session cleared — Cancel should not be visible (setChatLoading(false) called)
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel/i }),
        "Cancel should not appear after clear (even with in-flight promise pending)",
      ).not.toBeInTheDocument();
    });

    // Now resolve the stale in-flight promise with processing: true.
    // Without the stale-closure guard, setChatLoading(true) would fire
    // and Cancel would re-appear. With the guard, sessionIdRef.current
    // (null after clear) !== sessionId at closure time (session-a) → guard
    // returns false and chatLoading stays false.
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
    localStorage.clear();
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

  it("ADV-3: Refresh disabled while chatLoading=true (agent processing)", async () => {
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

    // Simulate chatLoading=true (agent processing)
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
      "FAIL (ADV-3): Refresh button not disabled while chatLoading=true",
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

  it("ADV-5: ChatWindow receives loading={chatLoading || isRefreshing} during refresh", async () => {
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
      "FAIL (ADV-5): Refresh button not disabled during fetch",
    ).toBeDisabled();

    // The Virtuoso mock renders children directly - check it's in loading state
    // (ChatWindow renders its content inside the Virtuoso mock)
    expect(
      screen.getByText(/Agent is thinking|Loading/),
      "FAIL (ADV-5): loading indicator not visible — isRefreshing not wired to ChatWindow loading prop",
    ).toBeInTheDocument();

    vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
    resolveFetch!(emptyHistory);
  });
});
