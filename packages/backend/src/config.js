const path = require('path');
const fs = require('fs');

function getMadeHome() {
  return process.env.MADE_HOME || process.cwd();
}

function getWorkspaceHome() {
  return process.env.MADE_WORKSPACE_HOME || process.cwd();
}

function getMadeDirectory() {
  return path.join(getMadeHome(), '.made');
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function ensureMadeStructure() {
  const madeDir = ensureDirectory(getMadeDirectory());
  ensureDirectory(path.join(madeDir, 'knowledge'));
  ensureDirectory(path.join(madeDir, 'constitutions'));
  return madeDir;
}

module.exports = {
  getMadeHome,
  getWorkspaceHome,
  getMadeDirectory,
  ensureMadeStructure
};
