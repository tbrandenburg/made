import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import simpleGit from 'simple-git';
import { resolveWorkspaceHome } from './config.js';

const exec = promisify(execCb);

const TECH_HINTS = [
  { badge: 'NodeJS', files: ['package.json', 'pnpm-lock.yaml', 'yarn.lock'] },
  { badge: 'Python', files: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
  { badge: 'C++', files: ['CMakeLists.txt', 'conanfile.txt', 'conanfile.py'] },
  { badge: 'C', files: ['Makefile'] },
  { badge: 'Shell', files: ['.sh'] },
  { badge: 'Rust', files: ['Cargo.toml'] }
];

const LICENSE_HINTS = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt'
];

export async function listRepositories(options = {}) {
  const {
    workspacePath = resolveWorkspaceHome(),
    fs = fsp
  } = options;

  let entries = [];
  try {
    entries = await fs.readdir(workspacePath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(workspacePath, entry.name);
    const metadata = await buildRepositoryMetadata(repoPath, entry.name, fs);
    repos.push(metadata);
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

async function buildRepositoryMetadata(repoPath, name, fs) {
  const hasGit = await directoryExists(path.join(repoPath, '.git'), fs);
  const lastCommit = await resolveLastCommit(repoPath, hasGit);
  const tech = await detectTech(repoPath, fs);
  const license = await detectLicense(repoPath, fs);
  return {
    name,
    path: repoPath,
    hasGit,
    lastCommit,
    tech,
    license
  };
}

async function directoryExists(pathToCheck, fs) {
  try {
    const stats = await fs.stat(pathToCheck);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

async function fileExists(pathToCheck, fs) {
  try {
    await fs.access(pathToCheck);
    return true;
  } catch {
    return false;
  }
}

async function resolveLastCommit(repoPath, hasGit) {
  if (!hasGit) return null;
  try {
    const git = simpleGit(repoPath);
    const log = await git.log({ maxCount: 1 });
    if (log.total > 0) {
      return log.latest?.date ?? null;
    }
    return null;
  } catch (error) {
    try {
      const { stdout } = await exec('git log -1 --format=%cI', { cwd: repoPath });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

async function detectTech(repoPath, fs) {
  for (const hint of TECH_HINTS) {
    for (const file of hint.files) {
      if (file.startsWith('.')) {
        const matches = await fs.readdir(repoPath).catch(() => []);
        if (matches.some(name => name.endsWith(file))) {
          return hint.badge;
        }
      } else if (await fileExists(path.join(repoPath, file), fs)) {
        return hint.badge;
      }
    }
  }
  const files = await fs.readdir(repoPath).catch(() => []);
  if (files.some(name => name.endsWith('.py'))) return 'Python';
  if (files.some(name => name.endsWith('.js'))) return 'NodeJS';
  if (files.some(name => name.endsWith('.ts'))) return 'TypeScript';
  return 'Unknown';
}

async function detectLicense(repoPath, fs) {
  for (const file of LICENSE_HINTS) {
    if (await fileExists(path.join(repoPath, file), fs)) {
      return file;
    }
  }
  return 'Unlicensed';
}

export async function createRepository(name, options = {}) {
  const {
    workspacePath = resolveWorkspaceHome(),
    fs = fsp
  } = options;
  const sanitized = name.trim().replace(/\s+/g, '-');
  if (!sanitized) {
    throw new Error('Repository name is required');
  }
  const repoPath = path.join(workspacePath, sanitized);
  await fs.mkdir(repoPath, { recursive: true });
  try {
    await exec('git init', { cwd: repoPath });
  } catch (error) {
    // Non-fatal - allow repository creation even if git is unavailable
    if (process.env.NODE_ENV !== 'test') {
      console.warn('git init failed:', error.message);
    }
  }
  return repoPath;
}

export async function listRepositoryFiles(repoName, options = {}) {
  const {
    workspacePath = resolveWorkspaceHome(),
    fs = fsp
  } = options;
  const repoPath = path.join(workspacePath, repoName);
  return listFilesRecursive(repoPath, repoPath, fs);
}

async function listFilesRecursive(basePath, currentPath, fs) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      files.push(...await listFilesRecursive(basePath, entryPath, fs));
    } else {
      files.push({
        name: entry.name,
        path: entryPath,
        relativePath: path.relative(basePath, entryPath)
      });
    }
  }
  return files;
}

export async function readRepositoryFile(repoName, relativePath, options = {}) {
  const {
    workspacePath = resolveWorkspaceHome(),
    fs = fsp
  } = options;
  const repoPath = path.join(workspacePath, repoName, relativePath);
  return fs.readFile(repoPath, 'utf8');
}

export async function writeRepositoryFile(repoName, relativePath, content, options = {}) {
  const {
    workspacePath = resolveWorkspaceHome(),
    fs = fsp
  } = options;
  const filePath = path.join(workspacePath, repoName, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return true;
}

export async function deleteRepositoryFile(repoName, relativePath, options = {}) {
  const {
    workspacePath = resolveWorkspaceHome(),
    fs = fsp
  } = options;
  const filePath = path.join(workspacePath, repoName, relativePath);
  await fs.unlink(filePath);
  return true;
}

export async function renameRepositoryFile(repoName, fromPath, toPath, options = {}) {
  const {
    workspacePath = resolveWorkspaceHome(),
    fs = fsp
  } = options;
  const source = path.join(workspacePath, repoName, fromPath);
  const target = path.join(workspacePath, repoName, toPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  return true;
}
