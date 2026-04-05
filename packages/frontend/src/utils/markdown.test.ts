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
});
