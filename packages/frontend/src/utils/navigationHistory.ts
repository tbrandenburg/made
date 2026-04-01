export type HistoryKind = "repository" | "task" | "knowledge" | "constitution";

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  name: string;
  path: string;
  visitedAt: string;
}

const STORAGE_KEY = "made.navigation-history.v1";
const MAX_ENTRIES = 40;

const isHistoryKind = (value: string): value is HistoryKind =>
  value === "repository" ||
  value === "task" ||
  value === "knowledge" ||
  value === "constitution";

const parseHistory = (raw: string | null): HistoryEntry[] => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (entry): entry is HistoryEntry =>
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.path === "string" &&
        typeof entry.visitedAt === "string" &&
        isHistoryKind(entry.kind),
    );
  } catch (error) {
    console.warn("Failed to parse navigation history", error);
    return [];
  }
};

export const getNavigationHistory = (): HistoryEntry[] => {
  return parseHistory(localStorage.getItem(STORAGE_KEY)).sort(
    (a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt),
  );
};

const toEntry = (pathname: string): HistoryEntry | null => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const [root, rawName] = segments;
  const name = decodeURIComponent(rawName);

  if (root === "repositories") {
    return {
      id: `repository:${name}`,
      kind: "repository",
      name,
      path: `/repositories/${encodeURIComponent(name)}`,
      visitedAt: new Date().toISOString(),
    };
  }

  if (root === "tasks") {
    return {
      id: `task:${name}`,
      kind: "task",
      name,
      path: `/tasks/${encodeURIComponent(name)}`,
      visitedAt: new Date().toISOString(),
    };
  }

  if (root === "knowledge") {
    return {
      id: `knowledge:${name}`,
      kind: "knowledge",
      name,
      path: `/knowledge/${encodeURIComponent(name)}`,
      visitedAt: new Date().toISOString(),
    };
  }

  if (root === "constitutions") {
    return {
      id: `constitution:${name}`,
      kind: "constitution",
      name,
      path: `/constitutions/${encodeURIComponent(name)}`,
      visitedAt: new Date().toISOString(),
    };
  }

  return null;
};

export const recordNavigationVisit = (pathname: string): void => {
  const entry = toEntry(pathname);
  if (!entry) return;

  const existing = parseHistory(localStorage.getItem(STORAGE_KEY));
  const withoutCurrent = existing.filter((item) => item.id !== entry.id);
  const next = [entry, ...withoutCurrent].slice(0, MAX_ENTRIES);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
};

export const getHistoryKindLabel = (kind: HistoryKind): string => {
  if (kind === "repository") return "Repository";
  if (kind === "task") return "Task";
  if (kind === "knowledge") return "Knowledge";
  return "Constitution";
};
