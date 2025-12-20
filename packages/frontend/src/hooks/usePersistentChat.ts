import { useEffect, useState } from "react";
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

export const usePersistentChat = (
  storageKey: string | undefined,
  fallback: ChatMessage[] = EMPTY_CHAT,
) => {
  const [chat, setChat] = useState<ChatMessage[]>(() =>
    parseChat(storageKey, fallback),
  );

  useEffect(() => {
    setChat(parseChat(storageKey, fallback));
  }, [storageKey, fallback]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(chat));
  }, [chat, storageKey]);

  return [chat, setChat] as const;
};
