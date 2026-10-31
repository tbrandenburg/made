import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

export async function startLiteBackend(): Promise<{
  base: string;
  directory: string;
  process: ChildProcess;
}> {
  const directory = await mkdtemp(join(tmpdir(), "made-lite-browser-"));
  const repository = join(directory, "workspace", "lite-fixture");
  await mkdir(join(repository, ".made"), { recursive: true });
  const database = join(directory, "opencode.db");

  const socket = createServer();
  await new Promise<void>((done, fail) => {
    socket.once("error", fail);
    socket.listen(0, "127.0.0.1", done);
  });
  const address = socket.address();
  if (!address || typeof address === "string") {
    await socket.close();
    throw new Error("Could not allocate an isolated Lite browser-test port");
  }
  await new Promise<void>((done, fail) =>
    socket.close((error) => (error ? fail(error) : done())),
  );

  const backend = resolve("packages/pybackend");
  const home = join(directory, "home");
  await mkdir(home);
  const python = join(backend, ".venv/bin/python");
  const seeded = spawnSync(
    python,
    [resolve("tests/system/fixtures/seedLiteSession.py"), repository, database],
    { encoding: "utf8", timeout: 10000 },
  );
  if (seeded.error || seeded.status !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error("Could not create isolated Lite history fixture");
  }
  const child = spawn(
    python,
    [
      "-m",
      "uvicorn",
      "app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      cwd: backend,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        MADE_HOME: home,
        MADE_WORKSPACE_HOME: join(directory, "workspace"),
        MADE_BACKEND_PORT: String(address.port),
        OPENCODE_DB: database,
        PYTHONPATH: backend,
        OPENCODE_DISABLE_MODELS_FETCH: "1",
      },
      stdio: "ignore",
    },
  );

  const base = `http://127.0.0.1:${address.port}`;
  const deadline = Date.now() + 30000;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(
          `Lite backend exited during startup (${child.exitCode})`,
        );
      try {
        if (
          (
            await fetch(`${base}/api/health`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        )
          return { base, directory, process: child };
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof DOMException))
          throw error;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("Lite backend did not become ready within 30 seconds");
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function stopLiteBackend(
  child: ChildProcess,
  directory: string,
): Promise<void> {
  if (child.exitCode === null) {
    const exited = new Promise<void>((done) =>
      child.once("exit", () => done()),
    );
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timeout);
  }
  await rm(directory, { recursive: true, force: true });
}
