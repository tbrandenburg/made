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

function parseManualChunksChecks(content: string): string[] {
  // Extract the body of the manualChunks function
  const fnMatch = content.match(
    /manualChunks\s*\(\s*id\s*\)\s*\{([\s\S]*?)\n\s{8}\}/,
  );
  if (!fnMatch) return [];
  const body = fnMatch[1];
  const checks: string[] = [];
  // Match id.includes("...") patterns in order
  const re = /id\.includes\("([^"]+)"\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    checks.push(m[1]);
  }
  return checks;
}

describe("vite.config.ts manualChunks ordering", () => {
  const checks = parseManualChunksChecks(configContent);

  it("@heroicons check appears before /react/ check", () => {
    const heroIndex = checks.indexOf("@heroicons");
    const reactIndex = checks.indexOf("/react/");
    expect(heroIndex).toBeGreaterThanOrEqual(0);
    expect(reactIndex).toBeGreaterThanOrEqual(0);
    expect(heroIndex).toBeLessThan(reactIndex);
  });

  it("@xterm check appears first", () => {
    expect(checks[0]).toBe("@xterm");
  });

  it("node_modules check appears last", () => {
    expect(checks[checks.length - 1]).toBe("node_modules");
  });
});
