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

marked.use({
  hooks: {
    postprocess(html) {
      return addExternalLinkAttributes(html);
    },
  },
});

export const renderMarkdown = (content: string) => marked(content) as string;
