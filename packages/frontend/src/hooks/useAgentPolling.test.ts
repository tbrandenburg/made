import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useAgentPolling } from "./useAgentPolling";

describe("useAgentPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not call syncHistory or checkStatus when isProcessing is false", () => {
    const syncHistory = vi.fn().mockResolvedValue(undefined);
    const checkStatus = vi.fn().mockResolvedValue(false);
    renderHook(() =>
      useAgentPolling({ isProcessing: false, syncHistory, checkStatus }),
    );
    expect(syncHistory).not.toHaveBeenCalled();
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it("calls syncHistory then checkStatus immediately when isProcessing becomes true", async () => {
    const syncHistory = vi.fn().mockResolvedValue(undefined);
    const checkStatus = vi.fn().mockResolvedValue(false);
    renderHook(() =>
      useAgentPolling({ isProcessing: true, syncHistory, checkStatus }),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(syncHistory).toHaveBeenCalledTimes(1);
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });

  it("re-polls after 5s when checkStatus returns true (still processing)", async () => {
    const syncHistory = vi.fn().mockResolvedValue(undefined);
    const checkStatus = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    renderHook(() =>
      useAgentPolling({ isProcessing: true, syncHistory, checkStatus }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(checkStatus).toHaveBeenCalledTimes(2);
  });

  it("stops polling when checkStatus returns false", async () => {
    const syncHistory = vi.fn().mockResolvedValue(undefined);
    const checkStatus = vi.fn().mockResolvedValue(false);
    renderHook(() =>
      useAgentPolling({ isProcessing: true, syncHistory, checkStatus }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });

  it("continues polling when checkStatus returns null (network error)", async () => {
    const syncHistory = vi.fn().mockResolvedValue(undefined);
    const checkStatus = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(false);
    renderHook(() =>
      useAgentPolling({ isProcessing: true, syncHistory, checkStatus }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(checkStatus).toHaveBeenCalledTimes(3);
  });

  it("aborts and clears timer on unmount", async () => {
    const syncHistory = vi.fn().mockResolvedValue(undefined);
    const checkStatus = vi.fn().mockResolvedValue(true);
    const { unmount } = renderHook(() =>
      useAgentPolling({ isProcessing: true, syncHistory, checkStatus }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    unmount();
    const callsBefore = checkStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(checkStatus.mock.calls.length).toBe(callsBefore);
  });
});
