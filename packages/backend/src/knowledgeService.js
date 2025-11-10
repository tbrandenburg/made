const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { ensureMadeStructure } = require('./config');

function getKnowledgeDirectory() {
  const madeDir = ensureMadeStructure();
  return path.join(madeDir, 'knowledge');
}

function listKnowledgeArtefacts() {
  const dir = getKnowledgeDirectory();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(content);
      const data = parsed.data || {};
      return {
        name: entry.name,
        type: data.type || 'internal',
        tags: data.tags || [],
        content: parsed.content,
        frontmatter: data
      };
    });
}

function readKnowledgeArtefact(fileName) {
  const dir = getKnowledgeDirectory();
  const filePath = path.join(dir, fileName);
  const content = fs.readFileSync(filePath, 'utf-8');
  return matter(content);
}

function writeKnowledgeArtefact(fileName, frontmatter, content) {
  const dir = getKnowledgeDirectory();
  const filePath = path.join(dir, fileName);
  const fileContent = matter.stringify(content, frontmatter);
  fs.writeFileSync(filePath, fileContent, 'utf-8');
}

module.exports = {
  listKnowledgeArtefacts,
  readKnowledgeArtefact,
  writeKnowledgeArtefact
};
