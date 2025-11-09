import { test, expect } from '@playwright/test';

const waitForPanel = async (page, heading) => {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
};

test('core MADE journeys', async ({ page }) => {
  await page.goto('/');
  await waitForPanel(page, 'Welcome to MADE');

  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await expect(page).toHaveURL(/dashboard/);
  await waitForPanel(page, 'Statistics');
  await expect(page.getByText('Project Count')).toBeVisible();

  await page.getByRole('link', { name: 'Repositories' }).first().click();
  await expect(page).toHaveURL(/repositories/);
  await expect(page.getByText('sample-project')).toBeVisible();
  await page.getByRole('link', { name: /sample-project/ }).click();
  await expect(page).toHaveURL(/repositories\/sample-project/);
  await page.getByRole('button', { name: 'File Browser' }).click();
  await expect(page.getByText('README.md')).toBeVisible();
  await page.getByText('README.md').click();
  await page.getByRole('button', { name: 'File Editor' }).click();
  await expect(page.getByRole('heading', { name: 'README.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Publishment' }).click();
  await page.getByRole('button', { name: 'Initialize Repository' }).click();
  await page.getByRole('button', { name: 'Agent' }).click();
  await expect(page.getByText('Agent handshake successful')).toBeVisible();

  await page.getByRole('link', { name: 'Knowledge Base' }).click();
  await expect(page).toHaveURL(/knowledge$/);
  await expect(page.getByText('welcome.md')).toBeVisible();
  await page.getByRole('link', { name: /welcome.md/ }).click();
  await expect(page).toHaveURL(/knowledge\/welcome.md/);
  await page.getByRole('button', { name: 'Agent' }).click();
  const textArea = page.getByPlaceholder('Ask the agent about this artefact');
  await textArea.fill('Summarise this artefact');
  await textArea.press('Meta+Enter');
  await expect(page.getByText('Agent handshake successful')).toBeVisible();

  await page.getByRole('link', { name: 'Constitution' }).click();
  await expect(page).toHaveURL(/constitutions/);
  await expect(page.getByText('global.md')).toBeVisible();
  await page.getByRole('link', { name: /global.md/ }).click();
  await expect(page).toHaveURL(/constitutions\/global.md/);
  await page.getByRole('button', { name: 'Content' }).click();
  await expect(page.getByDisplayValue('global.md')).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/settings/);
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});
