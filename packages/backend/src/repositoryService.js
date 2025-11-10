const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getWorkspaceHome } = require('./config');

function listDirectories(basePath) {
  if (!fs.existsSync(basePath)) {
    return [];
  }
  return fs
    .readdirSync(basePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function detectTechnology(repoPath) {
  const indicators = [
    { files: ['package.json'], label: 'NodeJS' },
    { files: ['requirements.txt', 'pyproject.toml'], label: 'Python' },
    { files: ['Cargo.toml'], label: 'Rust' },
    { files: ['go.mod'], label: 'Go' },
    { files: ['Makefile'], label: 'C/C++' },
    { files: ['CMakeLists.txt'], label: 'C/C++' },
    { files: ['Gemfile'], label: 'Ruby' },
    { files: ['composer.json'], label: 'PHP' },
    { files: ['build.gradle', 'build.gradle.kts'], label: 'Java/Kotlin' },
    { files: ['.csproj'], label: 'C#' },
    { files: ['Dockerfile'], label: 'Container' }
  ];

  const filesInRoot = new Set(fs.readdirSync(repoPath));
  for (const indicator of indicators) {
    if (indicator.files.some((file) => filesInRoot.has(file))) {
      return indicator.label;
    }
  }

  const hasPython = walkForExtension(repoPath, '.py');
  if (hasPython) return 'Python';
  const hasTs = walkForExtension(repoPath, '.ts');
  if (hasTs) return 'TypeScript';
  const hasJs = walkForExtension(repoPath, '.js');
  if (hasJs) return 'JavaScript';

  return 'Unknown';
}

function walkForExtension(dir, ext, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) {
    return false;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (walkForExtension(fullPath, ext, depth + 1, maxDepth)) {
        return true;
      }
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function getLastCommitDate(repoPath) {
  try {
    const output = execFileSync('git', ['-C', repoPath, 'log', '-1', '--format=%cI'], {
      encoding: 'utf-8'
    }).trim();
    return output || null;
  } catch (error) {
    return null;
  }
}

function getLicense(repoPath) {
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
  for (const candidate of candidates) {
    const licensePath = path.join(repoPath, candidate);
    if (fs.existsSync(licensePath) && fs.statSync(licensePath).isFile()) {
      const content = fs.readFileSync(licensePath, 'utf-8');
      const firstLine = content.split('\n')[0].trim();
      return firstLine || path.basename(candidate);
    }
  }
  return 'Unknown';
}

function getRepositoryInfo(repoName) {
  const workspace = getWorkspaceHome();
  const repoPath = path.join(workspace, repoName);
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new Error('Repository not found');
  }

  const gitPath = path.join(repoPath, '.git');
  const isGit = fs.existsSync(gitPath) && fs.statSync(gitPath).isDirectory();

  return {
    name: repoName,
    path: repoPath,
    hasGit: isGit,
    lastCommit: isGit ? getLastCommitDate(repoPath) : null,
    technology: detectTechnology(repoPath),
    license: getLicense(repoPath)
  };
}

function listRepositories() {
  const workspace = getWorkspaceHome();
  const directories = listDirectories(workspace);
  return directories.map((dir) => getRepositoryInfo(dir));
}

function createRepository(name) {
  const workspace = getWorkspaceHome();
  const repoPath = path.join(workspace, name);
  if (fs.existsSync(repoPath)) {
    throw new Error('Repository already exists');
  }
  fs.mkdirSync(repoPath, { recursive: true });
  try {
    execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
  } catch (error) {
    // Clean up when git init fails
    fs.rmSync(repoPath, { recursive: true, force: true });
    throw new Error('Failed to initialize git repository');
  }
  return getRepositoryInfo(name);
}

function buildFileTree(currentPath, basePath) {
  const stats = fs.statSync(currentPath);
  const relativePath = path.relative(basePath, currentPath);
  if (stats.isDirectory()) {
    const children = fs
      .readdirSync(currentPath)
      .filter((name) => !name.startsWith('.git'))
      .map((child) => buildFileTree(path.join(currentPath, child), basePath));
    return {
      name: path.basename(currentPath),
      path: relativePath || '.',
      type: 'folder',
      children
    };
  }
  return {
    name: path.basename(currentPath),
    path: relativePath,
    type: 'file',
    size: stats.size
  };
}

function listRepositoryFiles(repoName) {
  const workspace = getWorkspaceHome();
  const repoPath = path.join(workspace, repoName);
  if (!fs.existsSync(repoPath)) {
    throw new Error('Repository not found');
  }
  return buildFileTree(repoPath, repoPath);
}

function readRepositoryFile(repoName, filePath) {
  const workspace = getWorkspaceHome();
  const repoPath = path.join(workspace, repoName, filePath);
  return fs.readFileSync(repoPath, 'utf-8');
}

function writeRepositoryFile(repoName, filePath, content) {
  const workspace = getWorkspaceHome();
  const repoPath = path.join(workspace, repoName, filePath);
  fs.writeFileSync(repoPath, content, 'utf-8');
}

function createRepositoryFile(repoName, filePath, content = '') {
  const workspace = getWorkspaceHome();
  const repoPath = path.join(workspace, repoName, filePath);
  const dir = path.dirname(repoPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(repoPath, content, 'utf-8');
}

function renameRepositoryFile(repoName, oldPath, newPath) {
  const workspace = getWorkspaceHome();
  const oldFullPath = path.join(workspace, repoName, oldPath);
  const newFullPath = path.join(workspace, repoName, newPath);
  fs.renameSync(oldFullPath, newFullPath);
}

function deleteRepositoryFile(repoName, filePath) {
  const workspace = getWorkspaceHome();
  const repoPath = path.join(workspace, repoName, filePath);
  const stats = fs.statSync(repoPath);
  if (stats.isDirectory()) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(repoPath);
  }
}

module.exports = {
  listRepositories,
  getRepositoryInfo,
  createRepository,
  listRepositoryFiles,
  readRepositoryFile,
  writeRepositoryFile,
  createRepositoryFile,
  renameRepositoryFile,
  deleteRepositoryFile,
  detectTechnology
};
