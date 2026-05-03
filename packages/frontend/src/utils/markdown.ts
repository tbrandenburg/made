import DOMPurify from "dompurify";
import { marked } from "marked";

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

export const renderMarkdown = (content: string) => marked(content) as string;
