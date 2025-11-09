import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { resolveMadeDataDir, resolveWorkspaceHome } from './config.js';

const SETTINGS_FILE = 'settings.json';

export async function readSettings(options = {}) {
  const { fs = fsp } = options;
  const madeDir = resolveMadeDataDir();
  await fs.mkdir(madeDir, { recursive: true });
  const filePath = path.join(madeDir, SETTINGS_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return getDefaultSettings();
    }
    throw error;
  }
}

export async function writeSettings(settings, options = {}) {
  const { fs = fsp } = options;
  const madeDir = resolveMadeDataDir();
  await fs.mkdir(madeDir, { recursive: true });
  const filePath = path.join(madeDir, SETTINGS_FILE);
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}

export function getDefaultSettings() {
  return {
    theme: 'light',
    agentEndpoint: 'https://a2a-protocol.mock',
    agentApiKey: '',
    workspace: resolveWorkspaceHome(),
    notifications: true
  };
}
