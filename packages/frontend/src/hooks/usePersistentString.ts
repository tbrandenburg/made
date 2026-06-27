import { useCallback, useEffect, useState } from "react";

export const usePersistentString = (
  storageKey: string | undefined,
  initialValue: string | null = null,
) => {
  const readValue = useCallback(() => {
    if (!storageKey) return initialValue;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ?? initialValue;
    } catch (error) {
      console.warn("Failed to read value from localStorage", error);
      return initialValue;
    }
  }, [initialValue, storageKey]);

  const [value, setValue] = useState<string | null>(readValue);

  useEffect(() => {
    if (!storageKey) {
      // Key is unknown (e.g. agentCli not yet loaded). Keep the current
      // in-memory value — don't reset. The persist effect is also a no-op
      // while storageKey is undefined, so no spurious localStorage writes occur.
      return;
    }
    const stored = readValue();
    // Prefer the stored localStorage entry when it exists.
    // If storage is empty, keep the current in-memory value (e.g. set from a
    // URL bootstrap param while the key was still resolving) rather than
    // resetting to initialValue — the persist effect will write it on next tick.
    if (stored !== null) {
      setValue(stored);
    }
  }, [initialValue, readValue, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      if (value) {
        localStorage.setItem(storageKey, value);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.warn("Failed to persist value to localStorage", error);
    }
  }, [value, storageKey]);

  return [value, setValue] as const;
};
