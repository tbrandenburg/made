import { useCallback, useEffect, useRef, useState } from "react";

export const usePersistentString = (
  storageKey: string | undefined,
  initialValue: string | null = null,
  scopeKey?: string,
) => {
  const lastScopeKeyRef = useRef(scopeKey);
  const skipPersistRef = useRef(false);

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
      lastScopeKeyRef.current = scopeKey;
      return;
    }

    const stored = readValue();
    const scopeChanged = lastScopeKeyRef.current !== scopeKey;
    lastScopeKeyRef.current = scopeKey;

    if (stored !== null) {
      setValue(stored);
      skipPersistRef.current = true;
      return;
    }

    if (scopeChanged) {
      skipPersistRef.current = true;
      setValue(initialValue);
    }
  }, [initialValue, readValue, scopeKey, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
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
