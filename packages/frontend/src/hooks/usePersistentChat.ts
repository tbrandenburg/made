import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "../types/chat";

const EMPTY_CHAT: ChatMessage[] = [];

const parseChat = (
  storageKey: string | undefined,
  fallback: ChatMessage[],
): ChatMessage[] => {
  if (!storageKey) return fallback;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed as ChatMessage[];
      }
    }
  } catch (error) {
    console.warn("Failed to read chat history from localStorage", error);
  }
  return fallback;
};

const persistChat = (storageKey: string, chat: ChatMessage[]) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(chat));
  } catch (error) {
    console.warn("Failed to persist chat history to localStorage", error);
  }
};

export const usePersistentChat = (
  storageKey: string | undefined,
  fallback: ChatMessage[] = EMPTY_CHAT,
) => {
  const [chat, setChat] = useState<ChatMessage[]>(() =>
    parseChat(storageKey, fallback),
  );
  const persistTimeoutRef = useRef<number | undefined>();
  const pendingStorageKeyRef = useRef<string | undefined>();
  const latestChatRef = useRef(chat);

  latestChatRef.current = chat;

  useEffect(() => {
    setChat(parseChat(storageKey, fallback));
  }, [storageKey, fallback]);

  useEffect(() => {
    if (!storageKey) return;

    if (persistTimeoutRef.current !== undefined) {
      window.clearTimeout(persistTimeoutRef.current);
    }

    pendingStorageKeyRef.current = storageKey;
    persistTimeoutRef.current = window.setTimeout(() => {
      persistChat(storageKey, latestChatRef.current);
      persistTimeoutRef.current = undefined;
      pendingStorageKeyRef.current = undefined;
    }, 300);
  }, [chat, storageKey]);

  useEffect(
    () => () => {
      if (!storageKey) return;
      if (persistTimeoutRef.current === undefined) return;
      if (pendingStorageKeyRef.current !== storageKey) return;
      window.clearTimeout(persistTimeoutRef.current);
      persistChat(storageKey, latestChatRef.current);
      persistTimeoutRef.current = undefined;
      pendingStorageKeyRef.current = undefined;
    },
    [storageKey],
  );

  return [chat, setChat] as const;
};
