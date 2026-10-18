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
  requestGenerationRef?: { current: number };
  applyHistory?: (history: ChatHistoryResponse) => void;
}

interface UseSessionLoaderResult {
  sessionLoading: boolean;
  sessionError: string | null;
  setSessionError: Dispatch<SetStateAction<string | null>>;
  clearSessionError: () => void;
  finishHistoryLoad: () => void;
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
  requestGenerationRef,
  applyHistory,
}: UseSessionLoaderParams): UseSessionLoaderResult {
  const [sessionLoading, setSessionLoading] = useState(() =>
    Boolean(name && sessionId),
  );
  const [sessionError, setSessionError] = useState<string | null>(null);
  const onHistoryLoadedRef = useRef(onHistoryLoaded);
  const clearSessionError = useCallback(() => {
    setSessionError(null);
  }, []);
  const finishHistoryLoad = useCallback(() => setSessionLoading(false), []);

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
    const generation = requestGenerationRef
      ? ++requestGenerationRef.current
      : 0;

    getHistory(name, sessionId, controller.signal)
      .then((history) => {
        if (
          controller.signal.aborted ||
          (requestGenerationRef && generation !== requestGenerationRef.current)
        )
          return;
        setSessionLoading(false);
        setSessionError(null);
        if (applyHistory) applyHistory(history);
        else setChat(mapHistoryToMessages(history.messages || []));
        onHistoryLoadedRef.current?.(history);
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          (requestGenerationRef && generation !== requestGenerationRef.current)
        )
          return;
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setSessionLoading(false);
        setSessionError(historyErrorMessage(error));
      });

    return () => {
      controller.abort();
      setSessionLoading(false);
    };
  }, [
    name,
    sessionId,
    getHistory,
    setChat,
    requestGenerationRef,
    applyHistory,
  ]);

  return {
    sessionLoading,
    sessionError,
    setSessionError,
    clearSessionError,
    finishHistoryLoad,
  };
}
