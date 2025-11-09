import path from 'node:path';
import { promises as fsp } from 'node:fs';
import matter from 'gray-matter';
import { resolveMadeDataDir } from './config.js';

export async function listArtefacts(options = {}) {
  const { fs = fsp } = options;
  const knowledgeDir = path.join(resolveMadeDataDir(), 'knowledge');
  await fs.mkdir(knowledgeDir, { recursive: true });
  const entries = await fs.readdir(knowledgeDir).catch(() => []);
  const artefacts = [];
  for (const file of entries) {
    const filePath = path.join(knowledgeDir, file);
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = matter(content);
    artefacts.push({
      name: file,
      type: (parsed.data?.type || 'internal').toLowerCase(),
      tags: Array.isArray(parsed.data?.tags) ? parsed.data.tags : [],
      path: filePath,
      body: parsed.content.trim()
    });
  }
  return artefacts;
}

export async function getArtefact(fileName, options = {}) {
  const { fs = fsp } = options;
  const knowledgeDir = path.join(resolveMadeDataDir(), 'knowledge');
  const filePath = path.join(knowledgeDir, fileName);
  const content = await fs.readFile(filePath, 'utf8');
  return matter(content);
}

export async function saveArtefact(fileName, frontMatter, body, options = {}) {
  const { fs = fsp } = options;
  const knowledgeDir = path.join(resolveMadeDataDir(), 'knowledge');
  await fs.mkdir(knowledgeDir, { recursive: true });
  const filePath = path.join(knowledgeDir, fileName);
  const payload = matter.stringify(body, frontMatter);
  await fs.writeFile(filePath, payload, 'utf8');
  return filePath;
}
