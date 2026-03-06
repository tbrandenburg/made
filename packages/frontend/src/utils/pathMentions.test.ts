import { describe, expect, it } from "vitest";
import {
  buildMentionPathCandidates,
  buildMentionPathSections,
  commandPathsFromDefinitions,
  flattenRepositoryTreePaths,
} from "./pathMentions";

describe("pathMentions", () => {
  it("prioritizes command paths and deduplicates tree paths", () => {
    const commandPaths = commandPathsFromDefinitions([
      { id: "1", name: "c1", description: "", path: "commands/run.md", source: "user", content: "" },
      { id: "2", name: "c2", description: "", path: "./commands/build.md", source: "user", content: "" },
    ]);

    const treePaths = buildMentionPathCandidates(commandPaths, {
      name: ".",
      path: ".",
      type: "folder",
      children: [
        { name: "commands", path: "commands", type: "folder", children: [{ name: "run.md", path: "commands/run.md", type: "file" }] },
        { name: "src", path: "src", type: "folder", children: [{ name: "main.ts", path: "src/main.ts", type: "file" }] },
      ],
    });

    expect(treePaths).toEqual(["commands/run.md", "commands/build.md", "src/main.ts"]);
  });

  it("keeps command files even when hidden and separates command and file sections", () => {
    const commandPaths = commandPathsFromDefinitions([
      { id: "1", name: "c1", description: "", path: ".claude/commands/myCommand.md", source: "user", content: "" },
      { id: "2", name: "c2", description: "", path: "../.made/commands/centralCommand.md", source: "user", content: "" },
    ]);

    const sections = buildMentionPathSections(commandPaths, {
      name: ".",
      path: ".",
      type: "folder",
      children: [
        { name: "src", path: "src", type: "folder", children: [{ name: "main.py", path: "src/main.py", type: "file" }] },
        { name: "README.md", path: "README.md", type: "file" },
        { name: ".claude", path: ".claude", type: "folder", children: [{ name: "commands", path: ".claude/commands", type: "folder" }] },
      ],
    });

    expect(sections.commands).toEqual([
      ".claude/commands/myCommand.md",
      "../.made/commands/centralCommand.md",
    ]);
    expect(sections.files).toEqual(["src/main.py", "README.md"]);
  });

  it("filters dot and special folders", () => {
    const flattened = flattenRepositoryTreePaths({
      name: ".",
      path: ".",
      type: "folder",
      children: [
        { name: ".git", path: ".git", type: "folder", children: [{ name: "config", path: ".git/config", type: "file" }] },
        { name: "node_modules", path: "node_modules", type: "folder", children: [{ name: "pkg", path: "node_modules/pkg", type: "folder" }] },
        { name: "__pycache__", path: "__pycache__", type: "folder", children: [{ name: "x.pyc", path: "__pycache__/x.pyc", type: "file" }] },
        { name: "docs", path: "docs", type: "folder", children: [{ name: "README.md", path: "docs/README.md", type: "file" }] },
      ],
    });

    expect(flattened).toEqual(["docs/README.md"]);
  });
});
