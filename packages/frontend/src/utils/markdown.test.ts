import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("adds attributes so markdown links open in a new tab", () => {
    const html = renderMarkdown("[OpenAI](https://openai.com)");

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("keeps existing link attributes from inline html", () => {
    const html = renderMarkdown(
      '<a href="https://example.com" target="_self" rel="bookmark">Example</a>',
    );

    expect(html).toContain('target="_self"');
    expect(html).toContain('rel="bookmark"');
  });

  it("renders markdown images", () => {
    const html = renderMarkdown("![A cat](https://example.com/cat.png)");

    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/cat.png"');
    expect(html).toContain('alt="A cat"');
  });

  it("removes unsafe image urls", () => {
    const html = renderMarkdown('![Injected](javascript:alert("xss"))');

    expect(html).toContain("<img");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("src=");
  });
});
