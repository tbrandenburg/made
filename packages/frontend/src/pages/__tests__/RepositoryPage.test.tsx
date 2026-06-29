// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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
import { api, ChatHistoryResponse, ChatSession } from "../../hooks/useApi";

// ── Static stubs ────────────────────────────────────────────────────────────

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// Prevent harness-refresh setInterval from outliving tests.
vi.stubGlobal(
  "setInterval",
  vi.fn(() => 0),
);
vi.stubGlobal("clearInterval", vi.fn());

// Stub WebSocket so TerminalTab never opens a live socket.
vi.stubGlobal(
  "WebSocket",
  class {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 3; // CLOSED
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  },
);

// Mock the polling hook so its recursive setTimeout never fires.
vi.mock("../../hooks/useAgentPolling", () => ({
  useAgentPolling: vi.fn(),
}));

// Mock usePersistentChat so its debounce timeout never fires.
// The hook returns [value, setter, clear] — match that tuple shape.
vi.mock("../../hooks/usePersistentChat", () => ({
  usePersistentChat: vi.fn(() => [[], vi.fn(), vi.fn()]),
}));

// Mock HarnessesTab to avoid its own polling setInterval.
vi.mock("../../../components/HarnessesTab", () => ({
  HarnessesTab: () => null,
}));

vi.mock("react-virtuoso", async () => {
  const R = (await vi.importActual("react")) as typeof import("react");
  return {
    Virtuoso: R.forwardRef<
      { scrollToIndex: (opts: unknown) => void },
      {
        data: unknown[];
        itemContent: (index: number, item: unknown) => ReactNode;
        components?: { Footer?: R.ComponentType<{ context?: unknown }> };
        context?: unknown;
      }
    >(function MockVirtuoso({ data, itemContent, components, context }, ref) {
      R.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
      const Footer = components?.Footer;
      return R.createElement(
        "div",
        { "data-testid": "virtuoso" },
        ...data.map((item, i) =>
          R.createElement(R.Fragment, { key: i }, itemContent(i, item)),
        ),
        Footer ? R.createElement(Footer, { context }) : null,
      );
    }),
  };
});

vi.mock("../../hooks/useApi", async () => {
  const target: Record<string, Mock> = {};
  const handler: ProxyHandler<Record<string, Mock>> = {
    get(_, prop) {
      if (typeof prop === "string") {
        if (!target[prop]) target[prop] = vi.fn().mockResolvedValue(undefined);
        return target[prop];
      }
      return undefined;
    },
  };
  return { api: new Proxy(target, handler) };
});

// ── Shared fixtures ─────────────────────────────────────────────────────────

const sessionA: ChatSession = {
  id: "session-a",
  title: "Session A",
  updated: "2026-01-01",
};
const emptyHistory: ChatHistoryResponse = { sessionId: "", messages: [] };

function renderPage(initialEntries = ["/repositories/test-repo?tab=agent"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/repositories/:name/*" element={<RepositoryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setupDefaultMocks() {
  vi.mocked(api.getRepositoryAgentHistory).mockResolvedValue(emptyHistory);
  vi.mocked(api.getRepositoryAgentStatus).mockResolvedValue({ running: false });
  vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({ sessions: [] });
  vi.mocked(api.cancelRepositoryAgent).mockResolvedValue(undefined);
  // Prevent destructure errors from secondary page data loads.
  vi.mocked(api.getAgents).mockResolvedValue({ agents: [] });
  vi.mocked(api.getRepositoryAgents).mockResolvedValue({ agents: [] });
  vi.mocked(api.getRepositoryCommands).mockResolvedValue({ commands: [] });
  vi.mocked(api.getRepositoryHarnesses).mockResolvedValue({ harnesses: [] });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

// ── Session selection ───────────────────────────────────────────────────────

describe("RepositoryPage session selection", () => {
  beforeEach(setupDefaultMocks);

  it("AC1: selects session from modal — history API called", async () => {
    vi.mocked(api.getRepositoryAgentSessions).mockResolvedValue({
      sessions: [sessionA],
    });

    renderPage();

    fireEvent.click(await screen.findByLabelText("Choose a session"));
    fireEvent.click(await screen.findByTitle("Session A"));

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalled();
    });
  });

  it("AC2: ?sessionId=X on load — history API called", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalled();
    });
  });

  it("AC2b: history API called with correct session on load", async () => {
    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-b"]);

    await waitFor(() => {
      expect(api.getRepositoryAgentHistory).toHaveBeenCalledWith(
        "test-repo",
        "session-b",
        undefined,
        expect.anything(),
      );
    });
  });
});

// ── Lifecycle guards ────────────────────────────────────────────────────────

describe("RepositoryPage lifecycle guards", () => {
  beforeEach(setupDefaultMocks);

  it("no-session mount: Send enabled, no loading indicator", () => {
    renderPage();

    fireEvent.change(
      screen.getByPlaceholderText("Describe the change or ask the agent..."),
      { target: { value: "hello" } },
    );

    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
    expect(screen.queryByText(/loading session/i)).not.toBeInTheDocument();
  });

  it("Send disabled while history loading, re-enabled after resolve", async () => {
    let resolveHistory!: (v: ChatHistoryResponse) => void;
    vi.mocked(api.getRepositoryAgentHistory).mockReturnValueOnce(
      new Promise<ChatHistoryResponse>((res) => {
        resolveHistory = res;
      }),
    );

    renderPage(["/repositories/test-repo?tab=agent&sessionId=session-a"]);

    fireEvent.change(
      screen.getByPlaceholderText("Describe the change or ask the agent..."),
      { target: { value: "test" } },
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled(),
    );

    resolveHistory(emptyHistory);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled(),
    );
  });

  it("loads repository commands on mount", async () => {
    renderPage();

    await waitFor(() =>
      expect(api.getRepositoryCommands).toHaveBeenCalledWith("test-repo"),
    );
  });
});

// ── localStorage session-key namespacing (#611) ─────────────────────────────

describe("useAgentCli session key namespacing", () => {
  beforeEach(setupDefaultMocks);

  it("reads sessionId from namespaced localStorage key on mount", async () => {
    localStorage.setItem("repository-session-test-repo-opencode", "session-x");

    renderPage();

    await waitFor(
      () =>
        expect(api.getRepositoryAgentHistory).toHaveBeenCalledWith(
          "test-repo",
          "session-x",
          undefined,
          expect.anything(),
        ),
      { timeout: 2000 },
    );
  });
});
