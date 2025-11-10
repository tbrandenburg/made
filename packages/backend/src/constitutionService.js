const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { ensureMadeStructure } = require('./config');

function getConstitutionDirectory() {
  const madeDir = ensureMadeStructure();
  return path.join(madeDir, 'constitutions');
}

function listConstitutions() {
  const dir = getConstitutionDirectory();
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
        tags: data.tags || [],
        content: parsed.content,
        frontmatter: data
      };
    });
}

function readConstitution(fileName) {
  const dir = getConstitutionDirectory();
  const filePath = path.join(dir, fileName);
  const content = fs.readFileSync(filePath, 'utf-8');
  return matter(content);
}

function writeConstitution(fileName, frontmatter, content) {
  const dir = getConstitutionDirectory();
  const filePath = path.join(dir, fileName);
  const fileContent = matter.stringify(content, frontmatter);
  fs.writeFileSync(filePath, fileContent, 'utf-8');
}

module.exports = {
  listConstitutions,
  readConstitution,
  writeConstitution
};
