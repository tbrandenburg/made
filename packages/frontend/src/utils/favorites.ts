import { HistoryEntry, HistoryKind } from "./navigationHistory";

export interface FavoriteEntry {
  id: string;
  kind: HistoryKind;
  name: string;
  path: string;
  favoritedAt: string;
}

const STORAGE_KEY = "made.favorites.v1";

const isFavoriteEntry = (value: unknown): value is FavoriteEntry => {
  if (!value || typeof value !== "object") return false;

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.kind === "string" &&
    typeof entry.name === "string" &&
    typeof entry.path === "string" &&
    typeof entry.favoritedAt === "string"
  );
};

const parseFavorites = (raw: string | null): FavoriteEntry[] => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isFavoriteEntry);
  } catch (error) {
    console.warn("Failed to parse favorites", error);
    return [];
  }
};

const saveFavorites = (favorites: FavoriteEntry[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
};

export const getFavorites = (): FavoriteEntry[] => {
  return parseFavorites(localStorage.getItem(STORAGE_KEY)).sort(
    (a, b) => Date.parse(b.favoritedAt) - Date.parse(a.favoritedAt),
  );
};

export const isFavorite = (id: string): boolean => {
  return getFavorites().some((entry) => entry.id === id);
};

export const toggleFavorite = (entry: HistoryEntry): boolean => {
  const existing = getFavorites();
  const isCurrentlyFavorite = existing.some((item) => item.id === entry.id);

  if (isCurrentlyFavorite) {
    saveFavorites(existing.filter((item) => item.id !== entry.id));
    return false;
  }

  saveFavorites([
    {
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      path: entry.path,
      favoritedAt: new Date().toISOString(),
    },
    ...existing,
  ]);
  return true;
};
