import { useEffect } from "react";

/**
 * Polls agent status every 5 seconds while chatAgentProcessing is true.
 * Stops when checkStatus() returns false (agent done) or component unmounts.
 * null (network error) keeps polling.
 */
export function useAgentPolling({
  isProcessing,
  syncHistory,
  checkStatus,
}: {
  isProcessing: boolean;
  syncHistory: (signal: AbortSignal) => Promise<void>;
  checkStatus: () => Promise<boolean | null>;
}): void {
  useEffect(() => {
    if (!isProcessing) return;

    const controller = new AbortController();
    let timeoutId: number | undefined;

    const tick = async () => {
      await syncHistory(controller.signal);
      if (controller.signal.aborted) return;
      const stillProcessing = await checkStatus();
      if (controller.signal.aborted) return;
      // null = network error; keep polling. false = agent done; stop.
      if (stillProcessing === false) return;
      timeoutId = window.setTimeout(tick, 5000);
    };

    tick();

    return () => {
      controller.abort();
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isProcessing, syncHistory, checkStatus]);
}
