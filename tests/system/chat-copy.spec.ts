import { test, expect } from '@playwright/test';

const repositoryName = 'demo-project';
const repositoryResponse = {
  name: repositoryName,
  path: `/workspace/${repositoryName}`,
  hasGit: true,
  lastCommit: '2024-06-12T10:00:00.000Z',
  technology: 'NodeJS',
  license: 'MIT'
};

const routes = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/settings', (route) =>
    route.fulfill({ json: { theme: 'system', agentEndpoint: 'mock' } })
  );
  await page.route('**/api/repositories', (route) =>
    route.fulfill({ json: { repositories: [repositoryResponse] } })
  );
  await page.route(`**/api/repositories/${repositoryName}`, (route) =>
    route.fulfill({ json: repositoryResponse })
  );
  await page.route(`**/api/repositories/${repositoryName}/files`, (route) =>
    route.fulfill({
      json: {
        name: repositoryName,
        path: '.',
        type: 'folder',
        children: []
      }
    })
  );
  await page.route(`**/api/repositories/${repositoryName}/commands`, (route) =>
    route.fulfill({ json: { commands: [] } })
  );
  await page.route(`**/api/repositories/${repositoryName}/agent/status`, (route) =>
    route.fulfill({ json: { active: false } })
  );
  await page.route(`**/api/repositories/${repositoryName}/agent/history`, (route) =>
    route.fulfill({ json: { messages: [] } })
  );
};

test.describe('chat copy controls', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await routes(page);

    const chatHistory = [
      {
        id: 'msg-1',
        role: 'agent',
        text: 'Agent reply for copy',
        timestamp: new Date().toISOString()
      },
      {
        id: 'msg-2',
        role: 'user',
        text: 'User question',
        timestamp: new Date().toISOString()
      }
    ];

    await context.addInitScript(
      ({ chatKey, sessionKey, chat }) => {
        window.localStorage.setItem(chatKey, JSON.stringify(chat));
        window.localStorage.setItem(sessionKey, 'session-123');
      },
      {
        chatKey: `repository-chat-${repositoryName}`,
        sessionKey: `repository-session-${repositoryName}`,
        chat: chatHistory
      }
    );
  });

  test('copies individual messages and entire chat', async ({ page }) => {
    await page.goto(`/repositories/${repositoryName}`);

    const messageCopyButtons = page.getByRole('button', { name: 'Copy message' });
    await expect(messageCopyButtons.first()).toBeVisible();

    await messageCopyButtons.first().click();
    const singleClipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(singleClipboard).toBe('Agent reply for copy');

    const copyAllButton = page.getByRole('button', { name: 'Copy chat messages' });
    await expect(copyAllButton).toBeEnabled();
    await copyAllButton.click();
    const allClipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(allClipboard).toBe('Agent reply for copy\n\nUser question');
  });
});
