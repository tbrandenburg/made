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
      setValue(initialValue);
      return;
    }
    setValue(readValue());
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
