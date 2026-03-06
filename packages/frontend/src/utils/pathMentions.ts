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

const dedupePaths = (paths: string[], shouldIgnore: (path: string) => boolean) => {
  const deduped: string[] = [];
  const seen = new Set<string>();

  paths.forEach((value) => {
    const normalized = normalizePath(value);
    if (!normalized || shouldIgnore(normalized) || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    deduped.push(normalized);
  });

  return deduped;
};

export const commandPathsFromDefinitions = (commands: CommandDefinition[]) =>
  dedupePaths(
    commands.map((command) => normalizePath(command.path || "")),
    () => false,
  );

export const flattenRepositoryTreePaths = (tree?: FileNode | null): string[] => {
  if (!tree?.children?.length) return [];

  const collected: string[] = [];

  const walk = (nodes: FileNode[]) => {
    nodes.forEach((node) => {
      const path = normalizePath(node.path || "");
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
): MentionPathSections => ({
  commands: dedupePaths(commandPaths, () => false),
  files: dedupePaths(flattenRepositoryTreePaths(tree), hasIgnoredFileSegment),
});

export const buildMentionPathCandidates = (
  commandPaths: string[],
  tree?: FileNode | null,
) => {
  const sections = buildMentionPathSections(commandPaths, tree);
  return dedupePaths([...sections.commands, ...sections.files], () => false);
};
