import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("adds attributes so markdown links open in a new tab", () => {
    const html = renderMarkdown("[OpenAI](https://openai.com)");

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("adds target=_blank and rel to links that have no target", () => {
    const html = renderMarkdown('<a href="https://example.com">Example</a>');

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders markdown images", () => {
    const html = renderMarkdown("![A cat](https://example.com/cat.png)");

    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/cat.png"');
    expect(html).toContain('alt="A cat"');
  });

  it("resolves repository-relative image paths into web URLs", () => {
    const html = renderMarkdown("![Diagram](../assets/flow.png)", {
      repositoryName: "sample repo",
      currentFilePath: "docs/guides/intro.md",
    });

    expect(html).toContain("<img");
    expect(html).toContain(
      'src="http://localhost:3000/api/repositories/sample%20repo/web/docs/assets/flow.png"',
    );
  });

  it("removes unsafe image urls", () => {
    const html = renderMarkdown('![Injected](javascript:alert("xss"))');

    expect(html).toContain("<img");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("src=");
  });

  describe("chat image rendering", () => {
    it("resolves relative image src before sanitization when repositoryName given", () => {
      const html = renderMarkdown("![Diagram](./assets/flow.png)", {
        repositoryName: "my-repo",
        currentFilePath: "docs/README.md",
      });
      expect(html).toContain("<img");
      expect(html).not.toContain('src=""');
      expect(html).toContain(
        "/api/repositories/my-repo/web/docs/assets/flow.png",
      );
    });

    it("sanitizes output even without repositoryName", () => {
      const html = renderMarkdown("<script>alert(1)</script>");
      expect(html).not.toContain("<script>");
    });

    it("does not preserve relative src when repositoryName is absent", () => {
      const html = renderMarkdown("![Pic](./image.png)");
      // relative path stripped by DOMPurify since no resolution occurred
      expect(html).not.toContain('src="./image.png"');
    });
  });
});
