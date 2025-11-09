import path from 'node:path';
import { promises as fsp } from 'node:fs';
import matter from 'gray-matter';
import { resolveMadeDataDir } from './config.js';

export async function listConstitutions(options = {}) {
  const { fs = fsp } = options;
  const constitutionDir = path.join(resolveMadeDataDir(), 'constitutions');
  await fs.mkdir(constitutionDir, { recursive: true });
  const entries = await fs.readdir(constitutionDir).catch(() => []);
  const constitutions = [];
  for (const file of entries) {
    const filePath = path.join(constitutionDir, file);
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = matter(content);
    constitutions.push({
      name: file,
      path: filePath,
      body: parsed.content.trim(),
      frontMatter: parsed.data || {}
    });
  }
  return constitutions;
}

export async function getConstitution(fileName, options = {}) {
  const { fs = fsp } = options;
  const constitutionDir = path.join(resolveMadeDataDir(), 'constitutions');
  const filePath = path.join(constitutionDir, fileName);
  const content = await fs.readFile(filePath, 'utf8');
  return matter(content);
}

export async function saveConstitution(fileName, frontMatter, body, options = {}) {
  const { fs = fsp } = options;
  const constitutionDir = path.join(resolveMadeDataDir(), 'constitutions');
  await fs.mkdir(constitutionDir, { recursive: true });
  const filePath = path.join(constitutionDir, fileName);
  const payload = matter.stringify(body, frontMatter);
  await fs.writeFile(filePath, payload, 'utf8');
  return filePath;
}
