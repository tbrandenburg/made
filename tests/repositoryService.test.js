const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

describe('repositoryService', () => {
  let workspaceDir;
  let repositoryService;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'made-repo-'));
    process.env.MADE_WORKSPACE_HOME = workspaceDir;
    jest.resetModules();
    repositoryService = require('../packages/backend/src/repositoryService');
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('detects technology based on key files', () => {
    const repoPath = path.join(workspaceDir, 'node-project');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'package.json'), '{"name":"demo"}');

    const info = repositoryService.getRepositoryInfo('node-project');
    expect(info.technology).toBe('NodeJS');
  });

  it('returns last commit as null when git data unavailable', () => {
    const repoPath = path.join(workspaceDir, 'plain-project');
    fs.mkdirSync(repoPath, { recursive: true });

    const info = repositoryService.getRepositoryInfo('plain-project');
    expect(info.hasGit).toBe(false);
    expect(info.lastCommit).toBeNull();
  });

  it('creates repository and initialises git', () => {
    jest.spyOn(childProcess, 'execFileSync').mockImplementation(() => '');
    const result = repositoryService.createRepository('new-project');
    expect(result.name).toBe('new-project');
    expect(fs.existsSync(path.join(workspaceDir, 'new-project'))).toBe(true);
  });

  it('builds file tree excluding git directory', () => {
    const repoPath = path.join(workspaceDir, 'sample-project');
    fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'src', 'index.js'), 'console.log("hi")');
    fs.mkdirSync(path.join(repoPath, '.git'));

    const tree = repositoryService.listRepositoryFiles('sample-project');
    expect(tree.children.some((child) => child.name === '.git')).toBe(false);
  });
});
