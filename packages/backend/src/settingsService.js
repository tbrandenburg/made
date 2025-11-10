const fs = require('fs');
const path = require('path');
const { ensureMadeStructure } = require('./config');

const SETTINGS_FILE = 'settings.json';

function getSettingsPath() {
  const dir = ensureMadeStructure();
  return path.join(dir, SETTINGS_FILE);
}

function readSettings() {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    const defaults = {
      theme: 'system',
      agentEndpoint: 'https://a2a-protocol.org/mock',
      notifications: true
    };
    fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  const content = fs.readFileSync(settingsPath, 'utf-8');
  return JSON.parse(content);
}

function writeSettings(settings) {
  const settingsPath = getSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return settings;
}

module.exports = {
  readSettings,
  writeSettings
};
