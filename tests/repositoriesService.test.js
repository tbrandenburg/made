import { jest } from '@jest/globals';
import { vol } from 'memfs';

process.env.MADE_WORKSPACE_HOME = '/workspace';

const logMock = jest.fn().mockResolvedValue({ total: 1, latest: { date: '2024-03-01T12:00:00Z' } });

jest.unstable_mockModule('simple-git', () => ({
  default: () => ({
    log: logMock
  })
}));

const { listRepositories } = await import(new URL('../packages/backend/src/repositoriesService.js', import.meta.url));

beforeEach(() => {
  vol.reset();
  logMock.mockClear();
});

test('lists repositories with metadata', async () => {
  vol.fromJSON({
    '/workspace/alpha/package.json': '{"name":"alpha"}',
    '/workspace/alpha/.git/config': '',
    '/workspace/alpha/LICENSE': 'MIT',
    '/workspace/beta/main.py': 'print("hi")'
  });

  const repos = await listRepositories({ workspacePath: '/workspace', fs: vol.promises });
  expect(repos).toHaveLength(2);
  const alpha = repos.find((repo) => repo.name === 'alpha');
  expect(alpha.hasGit).toBe(true);
  expect(alpha.tech).toBe('NodeJS');
  expect(alpha.license).toBe('LICENSE');
  expect(alpha.lastCommit).toBe('2024-03-01T12:00:00Z');

  const beta = repos.find((repo) => repo.name === 'beta');
  expect(beta.tech).toBe('Python');
  expect(beta.hasGit).toBe(false);
});
