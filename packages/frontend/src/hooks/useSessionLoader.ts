import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types/chat";
import type { ChatHistoryResponse } from "./useApi";
import { mapHistoryToMessages } from "../utils/chat";

export type GetHistoryFn = (
  name: string,
  sessionId: string,
  signal?: AbortSignal,
) => Promise<ChatHistoryResponse>;

export function historyErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Unable to load session history. Check your connection and retry refresh.";
  }
  return error instanceof Error
    ? error.message
    : "Failed to load session history. Retry refresh or select another session.";
}

interface UseSessionLoaderParams {
  name: string | undefined;
  sessionId: string | null | undefined;
  setChat: Dispatch<SetStateAction<ChatMessage[]>>;
  getHistory: GetHistoryFn;
  onHistoryLoaded?: (history: ChatHistoryResponse) => void;
}

interface UseSessionLoaderResult {
  sessionLoading: boolean;
  sessionError: string | null;
  setSessionError: Dispatch<SetStateAction<string | null>>;
  clearSessionError: () => void;
}

/**
 * Reactive hook that loads chat session history whenever name or sessionId
 * changes. Encapsulates the loading/error state and cleanup (AbortController)
 * so pages only need a dumb setter in handleSessionSelect.
 *
 * - Sets sessionLoading=true for the duration of the fetch.
 * - Ignores AbortError (stale request cancelled by cleanup).
 * - Shares sessionError with manual refresh and incremental history loads.
 * - Clears errors on successful history load or name/sessionId change.
 */
export function useSessionLoader({
  name,
  sessionId,
  setChat,
  getHistory,
  onHistoryLoaded,
}: UseSessionLoaderParams): UseSessionLoaderResult {
  const [sessionLoading, setSessionLoading] = useState(() =>
    Boolean(name && sessionId),
  );
  const [sessionError, setSessionError] = useState<string | null>(null);
  const onHistoryLoadedRef = useRef(onHistoryLoaded);
  const clearSessionError = useCallback(() => {
    setSessionError(null);
  }, []);

  useEffect(() => {
    onHistoryLoadedRef.current = onHistoryLoaded;
  }, [onHistoryLoaded]);

  // History errors belong to the selected session, independently of agent status.
  useEffect(() => {
    setSessionError(null);
  }, [name, sessionId]);

  useEffect(() => {
    if (!name || !sessionId) return;

    setSessionLoading(true);

    const controller = new AbortController();

    getHistory(name, sessionId, controller.signal)
      .then((history) => {
        if (controller.signal.aborted) return;
        setSessionLoading(false);
        setSessionError(null);
        const mapped = mapHistoryToMessages(history.messages || []);
        setChat(mapped);
        onHistoryLoadedRef.current?.(history);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setSessionLoading(false);
        setSessionError(historyErrorMessage(error));
      });

    return () => {
      controller.abort();
      setSessionLoading(false);
    };
  }, [name, sessionId, getHistory, setChat]);

  return { sessionLoading, sessionError, setSessionError, clearSessionError };
}
