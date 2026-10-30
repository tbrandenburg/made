import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { promisify } from "node:util";

const run = promisify(execFile);
const frontendBuilds = new Map<string, Promise<string>>();

function buildFrontend(directory: string): Promise<string> {
  const outDir = join(directory, ".frontend-dist");
  return run(
    "npm",
    ["exec", "--", "vite", "build", "--outDir", outDir, "--emptyOutDir"],
    {
      cwd: resolve("packages/frontend"),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    },
  ).then(() => outDir);
}

export async function failureEvidence(directory: string): Promise<string> {
  const logs = join(directory, "fixture/.flowsh/logs");
  const names = await readdir(logs).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const entries = await Promise.all(
    names.map(async (name) => [name, await readFile(join(logs, name), "utf8")]),
  );
  return JSON.stringify(Object.fromEntries(entries), null, 2);
}

export async function stopBackend(process: ChildProcess) {
  if (!process.pid || process.exitCode !== null) return;
  const exited = new Promise<void>((done) =>
    process.once("exit", () => done()),
  );
  process.kill("SIGTERM");
  const timer = setTimeout(() => process.kill("SIGKILL"), 10000);
  await exited;
  clearTimeout(timer);
}

export async function startBackend(
  directory: string,
  path?: string,
): Promise<{ base: string; process: ChildProcess }> {
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((done) => socket.close(() => done()));
  const frontendDist =
    frontendBuilds.get(directory) ?? buildFrontend(directory);
  frontendBuilds.set(directory, frontendDist);
  const dist = await frontendDist;
  const home = await mkdtemp(join(directory, "home-"));
  const cwd = resolve("packages/pybackend");
  const process = spawn(
    join(cwd, ".venv/bin/python"),
    [
      "-m",
      "uvicorn",
      "build_task_e2e_app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      cwd,
      env: {
        ...global.process.env,
        ...(path ? { PATH: path } : {}),
        MADE_HOME: home,
        MADE_WORKSPACE_HOME: directory,
        MADE_BUILD_TASK_DIST: dist,
        PYTHONPATH: `${cwd}/tests/fixtures:${cwd}`,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let failure: Error | null = null;
  process.once("error", (error) => {
    failure = error;
  });
  let errors = "";
  process.stderr?.on("data", (data: Buffer) => {
    errors = (errors + data.toString()).slice(-8000);
  });
  const base = `http://127.0.0.1:${address.port}`;
  const deadline = Date.now() + 30000;
  try {
    while (true) {
      if (failure) throw failure;
      try {
        if (
          (
            await fetch(`${base}/api/repositories/fixture/build-tasks`, {
              signal: AbortSignal.timeout(2000),
            })
          ).ok
        )
          return { base, process };
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof DOMException))
          throw error;
      }
      if (process.exitCode !== null || Date.now() > deadline)
        throw new Error(`Backend failed to start: ${errors}`);
      await new Promise((done) => setTimeout(done, 100));
    }
  } catch (error) {
    await stopBackend(process);
    throw error;
  }
}
