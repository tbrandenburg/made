import { Dispatch, SetStateAction, useEffect, useState } from "react";

const readStringList = (storageKey: string): string[] => {
  try {
    const value = localStorage.getItem(storageKey);
    if (!value) return [];

    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch (error) {
    console.warn("Failed to read string list from localStorage", error);
    return [];
  }
};

export const usePersistentStringList = (
  storageKey: string,
): [string[], Dispatch<SetStateAction<string[]>>] => {
  const [value, setValue] = useState<string[]>(() =>
    readStringList(storageKey),
  );

  useEffect(() => {
    setValue(readStringList(storageKey));
  }, [storageKey]);

  useEffect(() => {
    try {
      if (value.length) {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.warn("Failed to persist string list to localStorage", error);
    }
  }, [storageKey, value]);

  return [value, setValue];
};
