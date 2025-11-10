import { test, expect } from '@playwright/test';

const repositoriesResponse = {
  repositories: [
    {
      name: 'demo-project',
      path: '/workspace/demo-project',
      hasGit: true,
      lastCommit: '2024-06-12T10:00:00.000Z',
      technology: 'NodeJS',
      license: 'MIT'
    }
  ]
};

const dashboardResponse = {
  projectCount: 1,
  agentConnection: true,
  repositories: repositoriesResponse.repositories
};

test.describe('MADE journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/dashboard', (route) => route.fulfill({ json: dashboardResponse }));
    await page.route('**/api/repositories', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ json: repositoriesResponse });
      } else {
        route.fulfill({ json: repositoriesResponse.repositories[0] });
      }
    });
    await page.route('**/api/repositories/demo-project', (route) =>
      route.fulfill({ json: repositoriesResponse.repositories[0] })
    );
    await page.route('**/api/repositories/demo-project/files', (route) =>
      route.fulfill({
        json: {
          name: 'demo-project',
          path: '.',
          type: 'folder',
          children: [
            { name: 'README.md', path: 'README.md', type: 'file', size: 12 }
          ]
        }
      })
    );
    await page.route('**/api/repositories/demo-project/agent', (route) =>
      route.fulfill({ json: { messageId: '1', sent: new Date().toISOString(), response: 'ok' } })
    );
    await page.route('**/api/settings', (route) => route.fulfill({ json: { theme: 'system', agentEndpoint: 'mock' } }));
    await page.route('**/api/knowledge', (route) =>
      route.fulfill({ json: { artefacts: [{ name: 'guide.md', type: 'internal', tags: ['guide'] }] } })
    );
    await page.route('**/api/constitutions', (route) =>
      route.fulfill({ json: { constitutions: [{ name: 'global.md', frontmatter: { type: 'global' } }] } })
    );
  });

  test('welcome and dashboard overview', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Mobile Agentic Development Environment' })).toBeVisible();
    await page.locator('.panel-grid').getByRole('link', { name: /Dashboard/ }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Project Count')).toBeVisible();
    await expect(page.getByText('1')).toBeVisible();
  });

  test('repository browser and agent chat', async ({ page }) => {
    await page.goto('/repositories');
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    await expect(page.getByText('demo-project')).toBeVisible();
    await page.getByRole('link', { name: /^demo-project/ }).click();
    await expect(page.getByRole('heading', { name: 'Repository: demo-project' })).toBeVisible();
    await page.getByRole('button', { name: 'File Browser' }).click();
    await expect(page.getByRole('button', { name: 'Create File' })).toBeVisible();
    await page.getByRole('button', { name: 'Publishment' }).click();
    await page.getByRole('button', { name: 'Create Pull Request' }).click();
    await page.getByRole('button', { name: 'Agent' }).click();
    await expect(page.getByPlaceholder('Describe the change or ask the agent...')).toBeVisible();
  });
});
