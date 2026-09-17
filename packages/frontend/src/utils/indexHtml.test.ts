import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const indexHtmlPath = path.resolve(__dirname, "../../index.html");
const indexCssPath = path.resolve(__dirname, "../styles/index.css");

const indexHtml = fs.readFileSync(indexHtmlPath, "utf-8");
const indexCss = fs.readFileSync(indexCssPath, "utf-8");

function extractHeadStyleBlock(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) throw new Error("No <style> block found in index.html");
  return match[1];
}

function extractBgValue(css: string, selector: RegExp): string {
  const match = css.match(selector);
  if (!match) throw new Error(`No --bg value found for selector ${selector}`);
  return match[1];
}

describe("index.html critical CSS + theme bootstrap", () => {
  const style = extractHeadStyleBlock(indexHtml);

  it("contains :root.dark and a background-color rule", () => {
    expect(style).toMatch(/:root\.dark/);
    expect(style).toMatch(/background-color:\s*var\(--bg\)/);
  });

  it("mirrors the light --bg value exactly from index.css", () => {
    const cssLightBg = extractBgValue(
      indexCss,
      /:root\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]+)/,
    );
    const htmlLightBg = extractBgValue(
      style,
      /:root\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]+)/,
    );
    expect(htmlLightBg).toBe(cssLightBg);
  });

  it("mirrors the dark --bg value exactly from index.css", () => {
    const cssDarkBg = extractBgValue(
      indexCss,
      /:root\.dark\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]+)/,
    );
    const htmlDarkBg = extractBgValue(
      style,
      /:root\.dark\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]+)/,
    );
    expect(htmlDarkBg).toBe(cssDarkBg);
  });

  it("inline bootstrap script checks prefers-color-scheme and toggles a class", () => {
    const scriptMatch = indexHtml.match(
      /<script>([\s\S]*?prefers-color-scheme[\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();
    const script = scriptMatch ? scriptMatch[1] : "";
    expect(script).toMatch(/prefers-color-scheme:\s*dark/);
    expect(script).toMatch(/classList\.add/);
  });

  it("sets html, body, #root to full height with no margin", () => {
    expect(style).toMatch(
      /html,\s*\n?\s*body,\s*\n?\s*#root\s*\{[^}]*height:\s*100%;[^}]*margin:\s*0;/,
    );
  });
});
