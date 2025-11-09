import path from 'node:path';

export function resolveMadeHome() {
  return process.env.MADE_HOME ? path.resolve(process.env.MADE_HOME) : process.cwd();
}

export function resolveWorkspaceHome() {
  return process.env.MADE_WORKSPACE_HOME ? path.resolve(process.env.MADE_WORKSPACE_HOME) : process.cwd();
}

export function resolveMadeDataDir() {
  const home = resolveMadeHome();
  return path.join(home, '.made');
}
