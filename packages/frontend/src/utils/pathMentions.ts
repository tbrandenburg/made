import { CommandDefinition, FileNode } from "../hooks/useApi";

const SPECIAL_FOLDER_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

const hasIgnoredFileSegment = (path: string) =>
  path
    .split("/")
    .some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment.startsWith(".") ||
        segment.startsWith("__") ||
        SPECIAL_FOLDER_NAMES.has(segment),
    );

const normalizePath = (value: string) => value.replace(/^\.\//, "").trim();

const normalizeAbsolutePath = (value: string) => {
  const normalized = normalizePath(value).replace(/\\/g, "/");
  const withoutTrailingSlash = normalized.replace(/\/+$/, "");
  if (/^[A-Za-z]:\//.test(withoutTrailingSlash)) {
    return withoutTrailingSlash.toLowerCase();
  }
  return withoutTrailingSlash;
};

const isAbsolutePath = (value: string) =>
  value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);

const relativizePath = (value: string, scopeRoot?: string) => {
  const normalizedValue = normalizePath(value);
  if (!scopeRoot || !isAbsolutePath(normalizedValue)) {
    return normalizedValue;
  }

  const base = normalizeAbsolutePath(scopeRoot);
  const target = normalizeAbsolutePath(normalizedValue);
  if (!base || !target || !isAbsolutePath(base) || !isAbsolutePath(target)) {
    return normalizedValue;
  }

  const baseParts = base.split("/").filter(Boolean);
  const targetParts = target.split("/").filter(Boolean);
  let commonLength = 0;

  while (
    commonLength < baseParts.length &&
    commonLength < targetParts.length &&
    baseParts[commonLength] === targetParts[commonLength]
  ) {
    commonLength += 1;
  }

  const upSegments = Array.from(
    { length: baseParts.length - commonLength },
    () => "..",
  );
  const downSegments = targetParts.slice(commonLength);
  const relativePath = [...upSegments, ...downSegments].join("/");
  return relativePath || ".";
};

const dedupePaths = (
  paths: string[],
  shouldIgnore: (path: string) => boolean,
  scopeRoot?: string,
) => {
  const deduped: string[] = [];
  const seen = new Set<string>();

  paths.forEach((value) => {
    const normalized = relativizePath(value, scopeRoot);
    if (!normalized || shouldIgnore(normalized) || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    deduped.push(normalized);
  });

  return deduped;
};

export const commandPathsFromDefinitions = (
  commands: CommandDefinition[],
  scopeRoot?: string,
) =>
  dedupePaths(
    commands.map((command) => normalizePath(command.path || "")),
    () => false,
    scopeRoot,
  );

export const flattenRepositoryTreePaths = (
  tree?: FileNode | null,
  scopeRoot?: string,
): string[] => {
  if (!tree?.children?.length) return [];

  const collected: string[] = [];

  const walk = (nodes: FileNode[]) => {
    nodes.forEach((node) => {
      const path = relativizePath(node.path || "", scopeRoot);
      if (!path || hasIgnoredFileSegment(path)) return;
      if (node.type === "file") {
        collected.push(path);
      }
      if (node.type === "folder" && node.children?.length) {
        walk(node.children);
      }
    });
  };

  walk(tree.children);
  return collected;
};

export type MentionPathSections = {
  commands: string[];
  files: string[];
};

export const buildMentionPathSections = (
  commandPaths: string[],
  tree?: FileNode | null,
  scopeRoot?: string,
): MentionPathSections => ({
  commands: dedupePaths(commandPaths, () => false, scopeRoot),
  files: dedupePaths(
    flattenRepositoryTreePaths(tree, scopeRoot),
    hasIgnoredFileSegment,
    scopeRoot,
  ),
});

export const buildMentionPathCandidates = (
  commandPaths: string[],
  tree?: FileNode | null,
  scopeRoot?: string,
) => {
  const sections = buildMentionPathSections(commandPaths, tree, scopeRoot);
  return dedupePaths(
    [...sections.commands, ...sections.files],
    () => false,
    scopeRoot,
  );
};
