import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

function parseIncludeEntries(content: string): string[] {
  const match = content.match(/include:\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  const block = match[1];
  const entries: string[] = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    entries.push(m[1]);
  }
  return entries;
}

const configPath = path.resolve(__dirname, "../../vite.config.ts");
const configContent = fs.readFileSync(configPath, "utf-8");

describe("vite.config.ts optimizeDeps.include", () => {
  it("include array parses to exactly one entry", () => {
    const entries = parseIncludeEntries(configContent);
    expect(entries).toHaveLength(1);
  });

  it("only @xterm/xterm is in the include array", () => {
    const entries = parseIncludeEntries(configContent);
    expect(entries).toEqual(["@xterm/xterm"]);
  });

  const REMOVED_DEPS = [
    "dompurify",
    "react-virtuoso",
    "marked",
    "@xterm/addon-fit",
  ];

  for (const dep of REMOVED_DEPS) {
    it(`removed dep "${dep}" not in the include array structure`, () => {
      const entries = parseIncludeEntries(configContent);
      expect(entries).not.toContain(dep);
    });
  }
});
