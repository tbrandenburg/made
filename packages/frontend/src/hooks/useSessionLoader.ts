import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
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
}

interface UseSessionLoaderResult {
  sessionLoading: boolean;
  sessionError: string | null;
}

/**
 * Reactive hook that loads chat session history whenever name or sessionId
 * changes. Encapsulates the loading/error state and cleanup (AbortController)
 * so pages only need a dumb setter in handleSessionSelect.
 *
 * - Calls setChat([]) immediately when a new (name, sessionId) pair is seen.
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
}: UseSessionLoaderParams): UseSessionLoaderResult {
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

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
    setChat([]);

    const controller = new AbortController();

    getHistory(name, sessionId, controller.signal)
      .then((history) => {
        if (controller.signal.aborted) return;
        setSessionLoading(false);
        const mapped = mapHistoryToMessages(history.messages || []);
        setChat(mapped);
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

  return { sessionLoading, sessionError };
}
