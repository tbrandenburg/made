import DOMPurify from "dompurify";
import { marked } from "marked";

export type MarkdownRenderOptions = {
  repositoryName?: string;
  currentFilePath?: string;
};

const addExternalLinkAttributes = (html: string) =>
  html.replace(/<a\s+([^>]*?)>/g, (_, attributes: string) => {
    let updatedAttributes = attributes;

    if (!/\btarget\s*=/.test(updatedAttributes)) {
      updatedAttributes += ' target="_blank"';
    }

    if (!/\brel\s*=/.test(updatedAttributes)) {
      updatedAttributes += ' rel="noopener noreferrer"';
    }

    return `<a ${updatedAttributes}>`;
  });

const isRelativePath = (value: string) =>
  !!value &&
  !value.startsWith("#") &&
  !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
  !value.startsWith("//");

const resolveRepositoryAssetUrl = (
  source: string,
  repositoryName?: string,
  currentFilePath?: string,
): string => {
  if (!repositoryName || !currentFilePath || !isRelativePath(source))
    return source;

  try {
    const baseDirectory = currentFilePath.includes("/")
      ? currentFilePath.slice(0, currentFilePath.lastIndexOf("/"))
      : "";

    const relativePath = source.startsWith("/")
      ? source.slice(1)
      : [baseDirectory, source].filter(Boolean).join("/");

    const normalized = relativePath
      .split("/")
      .reduce<string[]>((segments, segment) => {
        if (!segment || segment === ".") return segments;
        if (segment === "..") {
          if (segments.length > 0) segments.pop();
          return segments;
        }
        segments.push(segment);
        return segments;
      }, [])
      .join("/");

    const origin =
      (globalThis as { window?: Window }).window?.location?.origin || "";
    const encodedPath = normalized
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    return `${origin}/api/repositories/${encodeURIComponent(repositoryName)}/web/${encodedPath}`;
  } catch {
    return source;
  }
};

// DOMPurify is a factory — always bind explicitly to the current window
const getPurify = () => {
  const win = (globalThis as { window?: Window }).window;
  if (!win) return null;
  return DOMPurify(win);
};

const sanitizeHtml = (html: string) => {
  const purify = getPurify();
  if (!purify) return html;
  return purify.sanitize(html, {
    ALLOWED_TAGS: [
      "a",
      "b",
      "blockquote",
      "br",
      "code",
      "del",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "img",
      "li",
      "ol",
      "p",
      "pre",
      "span",
      "strong",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "ul",
    ],
    ALLOWED_ATTR: [
      "alt",
      "class",
      "colspan",
      "height",
      "href",
      "loading",
      "rel",
      "rowspan",
      "src",
      "target",
      "title",
      "width",
    ],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/i,
  });
};

marked.use({
  hooks: {
    postprocess(html) {
      return addExternalLinkAttributes(sanitizeHtml(html));
    },
  },
});

export const renderMarkdown = (
  content: string,
  options?: MarkdownRenderOptions,
) => {
  const rendered = marked.parse(content, {
    async: false,
  }) as string;

  if (!options?.repositoryName || !options.currentFilePath) {
    return rendered;
  }

  return rendered.replace(
    /<img\b([^>]*?)\bsrc="([^"]*)"([^>]*)>/gi,
    (_, before: string, src: string, after: string) => {
      const nextSrc = resolveRepositoryAssetUrl(
        src,
        options.repositoryName,
        options.currentFilePath,
      );

      return `<img${before}src="${nextSrc}"${after}>`;
    },
  );
};
