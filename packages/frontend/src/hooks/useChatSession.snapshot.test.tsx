import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanupSessionTests,
  historyFor,
  renderSnapshotSession,
  SessionWindow,
  snapshot,
  snapshotApi,
} from "./useChatSession.testSupport";

afterEach(cleanupSessionTests);

it("replaces snapshot initial/manual revisions at the original identity and timestamp, including empty", async () => {
  const api = snapshotApi();
  const { result } = renderSnapshotSession(api);
  await waitFor(() => expect(result.current.chat).toHaveLength(3));
  expect(
    result.current.chat.filter((entry) => entry.role === "user"),
  ).toHaveLength(2);
  for (const text of ["longer revision", "equal! revision", "x"]) {
    api.getHistory.mockResolvedValue(snapshot(text));
    await act(async () => result.current.reloadCurrentSession());
    expect(result.current.chat.map((entry) => entry.text)).toEqual([
      "repeat",
      "repeat",
      text,
    ]);
    expect(result.current.chat[2]).toMatchObject({
      id: "a-0",
      timestamp: "2026-01-01T00:00:02.000Z",
    });
  }
  api.getHistory.mockResolvedValue({ ...snapshot(), messages: [] });
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat).toEqual([]);
  expect(result.current.sessionError).toBeNull();
});

it("executes actual polling and applies longer, equal-length and shorter snapshot revisions", async () => {
  vi.useFakeTimers();
  const api = snapshotApi();
  api.getStatus.mockResolvedValue({ running: true });
  const { result } = renderSnapshotSession(api);
  await act(async () => {
    await Promise.resolve();
  });
  for (const text of ["longer revision", "equal! revision", "x"]) {
    api.getHistory.mockResolvedValue(snapshot(text));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.chat.map((entry) => entry.text)).toEqual([
      "repeat",
      "repeat",
      text,
    ]);
    expect(result.current.chat[2]).toMatchObject({
      id: "a-0",
      timestamp: "2026-01-01T00:00:02.000Z",
    });
  }
  expect(
    api.getHistory.mock.calls.some(
      (call) => call[2] === Date.parse("2026-01-01T00:00:02Z") + 1,
    ),
  ).toBe(true);
});

it("restores absent-historyMode initial/manual replacement", async () => {
  const api = snapshotApi(vi.fn().mockResolvedValue(historyFor("A")));
  const { result } = renderSnapshotSession(api);
  await waitFor(() => expect(result.current.chat).toHaveLength(2));
  api.getHistory.mockResolvedValue(historyFor("B"));
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "B question",
    "B answer",
  ]);
  expect(result.current.chat.some((entry) => entry.text === "A answer")).toBe(
    false,
  );
  api.getHistory.mockResolvedValue({ sessionId: "A", messages: [] });
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.chat).toEqual([]);
  expect(result.current.sessionError).toBeNull();
});

it("retains a snapshot transcript and actionable history UI on refresh failure, then recovers", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  const api = snapshotApi();
  render(<SessionWindow api={api} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Transcript")).toHaveTextContent(
      "repeat | repeat | original",
    ),
  );
  api.getHistory.mockRejectedValue(new TypeError("Failed to fetch"));
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Check your connection and retry refresh",
    ),
  );
  expect(screen.getByLabelText("Transcript")).toHaveTextContent(
    "repeat | repeat | original",
  );
  expect(screen.queryByText("No conversation yet.")).not.toBeInTheDocument();
  api.getHistory.mockResolvedValue({ ...snapshot(), messages: [] });
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Transcript")).toBeEmptyDOMElement();
  expect(screen.getByText("No conversation yet.")).toBeInTheDocument();
});

it("keeps V1 polling's incremental merge and timestamp boundary rather than snapshot replacement", async () => {
  vi.useFakeTimers();
  const history = historyFor("A");
  history.messages[1].timestamp = "2026-01-01T00:00:00Z";
  const api = snapshotApi(vi.fn().mockResolvedValue(history));
  api.getStatus.mockResolvedValue({ running: true });
  const { result } = renderSnapshotSession(api);
  await act(async () => {
    await Promise.resolve();
  });
  api.getHistory.mockResolvedValue({
    sessionId: "A",
    messages: [
      {
        messageId: "new",
        role: "assistant",
        type: "text",
        content: "next",
        timestamp: "2026-01-01T00:00:01Z",
      },
    ],
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "A question",
    "A answer",
    "next",
  ]);
  expect(api.getHistory.mock.calls.at(-1)?.[2]).toBe(
    Date.parse("2026-01-01T00:00:00Z") + 1,
  );
  api.getHistory.mockResolvedValue({ sessionId: "A", messages: [] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(result.current.chat.map((entry) => entry.text)).toEqual([
    "A question",
    "A answer",
    "next",
  ]);
  expect(result.current.sessionError).toBeNull();
});

it("warns for reduced history and clears warning after full recovery", async () => {
  // This test renders a populated ChatWindow, activating react-virtuoso.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  const api = snapshotApi(
    vi.fn().mockResolvedValue({ ...snapshot(), historyReduced: true }),
  );
  render(<SessionWindow api={api} />);
  await waitFor(() =>
    expect(
      screen.getByText(/Only recent history is shown/),
    ).toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Transcript")).toHaveTextContent("original");
  expect(screen.getByText(/Only recent history is shown/)).toHaveTextContent(
    "JSON complexity limit",
  );

  api.getHistory.mockResolvedValue(snapshot("restored"));
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(
      screen.queryByText(/Only recent history is shown/),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Transcript")).toHaveTextContent("restored");
});

it("keeps warning after failed refresh but clears on session switch", async () => {
  const api = snapshotApi(
    vi.fn().mockResolvedValue({ ...snapshot(), historyReduced: true }),
  );
  const { result } = renderSnapshotSession(api);
  await waitFor(() => expect(result.current.historyReduced).toBe(true));
  api.getHistory.mockRejectedValue(new Error("service offline"));
  await act(async () => result.current.reloadCurrentSession());
  expect(result.current.sessionError).toBe("service offline");
  expect(result.current.historyReduced).toBe(true);

  act(() => result.current.navigate("B"));
  expect(result.current.historyReduced).toBe(false);
  expect(result.current.sessionId).toBe("B");
});
