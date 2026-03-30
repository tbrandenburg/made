export type ExternalMatterKind = "knowledge" | "constitution";

export type ExternalMatter = {
  id: string;
  path: string;
  name: string;
  content: string;
  frontmatter: Record<string, unknown>;
};

const STORAGE_PREFIX = "external-matter";
const ID_PREFIX = "external-";

const storageKey = (kind: ExternalMatterKind) => `${STORAGE_PREFIX}-${kind}`;

const createId = (path: string) => `${ID_PREFIX}${encodeURIComponent(path)}`;

const normalizeId = (id: string) => {
  if (!id.startsWith(ID_PREFIX)) return id;
  const rawPath = id.slice(ID_PREFIX.length);
  try {
    return createId(decodeURIComponent(rawPath));
  } catch {
    return createId(rawPath);
  }
};

const nameFromPath = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed) return "external-file";
  const normalized = trimmed.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

const parseStored = (kind: ExternalMatterKind): ExternalMatter[] => {
  try {
    const raw = localStorage.getItem(storageKey(kind));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ExternalMatter =>
        Boolean(
          item &&
            typeof item.id === "string" &&
            typeof item.path === "string" &&
            typeof item.name === "string" &&
            typeof item.content === "string" &&
            item.frontmatter &&
            typeof item.frontmatter === "object",
        ),
    );
  } catch (error) {
    console.warn("Failed to parse external matter from localStorage", error);
    return [];
  }
};

const writeStored = (kind: ExternalMatterKind, values: ExternalMatter[]) => {
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify(values));
  } catch (error) {
    console.warn("Failed to persist external matter to localStorage", error);
  }
};

export const listExternalMatter = (kind: ExternalMatterKind) => parseStored(kind);

export const addExternalMatterLink = (
  kind: ExternalMatterKind,
  path: string,
): ExternalMatter | null => {
  const normalizedPath = path.trim();
  if (!normalizedPath) return null;

  const existing = parseStored(kind);
  const existingEntry = existing.find((item) => item.path === normalizedPath);
  if (existingEntry) return existingEntry;

  const nextEntry: ExternalMatter = {
    id: createId(normalizedPath),
    path: normalizedPath,
    name: nameFromPath(normalizedPath),
    content: "",
    frontmatter: {},
  };
  const next = [...existing, nextEntry];
  writeStored(kind, next);
  return nextEntry;
};

export const getExternalMatter = (
  kind: ExternalMatterKind,
  id: string,
): ExternalMatter | null => {
  const normalizedId = normalizeId(id);
  const found = parseStored(kind).find((item) => item.id === normalizedId);
  return found ?? null;
};

export const saveExternalMatter = (
  kind: ExternalMatterKind,
  id: string,
  content: string,
  frontmatter: Record<string, unknown>,
) => {
  const normalizedId = normalizeId(id);
  const current = parseStored(kind);
  const next = current.map((item) =>
    item.id === normalizedId ? { ...item, content, frontmatter } : item,
  );
  writeStored(kind, next);
};

export const removeExternalMatterLink = (
  kind: ExternalMatterKind,
  id: string,
): boolean => {
  const normalizedId = normalizeId(id);
  const current = parseStored(kind);
  const next = current.filter((item) => item.id !== normalizedId);
  if (next.length === current.length) return false;
  writeStored(kind, next);
  return true;
};

export const isExternalMatterId = (value: string) => value.startsWith(ID_PREFIX);
