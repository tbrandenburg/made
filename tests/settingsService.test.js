import { vol } from 'memfs';

const settingsModule = await import(new URL('../packages/backend/src/settingsService.js', import.meta.url));

const { readSettings, writeSettings, getDefaultSettings } = settingsModule;

process.env.MADE_HOME = '/home';

test('reads default settings when file missing', async () => {
  vol.reset();
  const settings = await readSettings({ fs: vol.promises });
  expect(settings.theme).toBe(getDefaultSettings().theme);
});

test('writes and reads settings', async () => {
  vol.reset();
  const updated = { ...getDefaultSettings(), theme: 'dark', notifications: false };
  await writeSettings(updated, { fs: vol.promises });
  const reloaded = await readSettings({ fs: vol.promises });
  expect(reloaded.theme).toBe('dark');
  expect(reloaded.notifications).toBe(false);
});
