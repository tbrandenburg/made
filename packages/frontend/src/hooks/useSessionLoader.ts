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
  clearSessionError: () => void;
}

/**
 * Reactive hook that loads chat session history whenever name or sessionId
 * changes. Encapsulates the loading/error state and cleanup (AbortController)
 * so pages only need a dumb setter in handleSessionSelect.
 *
 * - Sets sessionLoading=true for the duration of the fetch.
 * - Ignores AbortError (stale request cancelled by cleanup).
 * - Surfaces other errors in sessionError.
 * - Resets sessionError when name/sessionId becomes falsy (e.g. session clear).
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

  // Reset error state when the session is cleared (name or sessionId goes falsy).
  useEffect(() => {
    if (!name || !sessionId) {
      setSessionError(null);
    }
  }, [name, sessionId]);

  useEffect(() => {
    if (!name || !sessionId) return;

    setSessionLoading(true);
    setSessionError(null);

    const controller = new AbortController();

    getHistory(name, sessionId, controller.signal)
      .then((history) => {
        if (controller.signal.aborted) return;
        setSessionLoading(false);
        const mapped = mapHistoryToMessages(history.messages || []);
        setChat(mapped);
        onHistoryLoadedRef.current?.(history);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setSessionLoading(false);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load session history";
        setSessionError(message);
      });

    return () => {
      controller.abort();
      setSessionLoading(false);
    };
  }, [name, sessionId, getHistory, setChat]);

  return { sessionLoading, sessionError, clearSessionError };
}
