import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import type { ComponentType } from "react";

let BuildTasksTab: ComponentType<{ repository: string }>;
// Real subprocess/HTTP tests need headroom when the suite saturates CPU workers.
configure({ asyncUtilTimeout: 10000 });
vi.setConfig({ testTimeout: 30000 });
let backend: ChildProcess;
let directory: string;
let base: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "made-build-component-"));
  const repository = join(directory, "sample");
  await mkdir(join(repository, "nested"), { recursive: true });
  await mkdir(join(directory, "empty"));
  await writeFile(
    join(repository, "Makefile"),
    "hello:\n\t@echo COMPONENT_OK\n# made:args WHO!\nwith-name:\n\t@echo 'NAME=$(WHO)'\n",
  );
  await writeFile(
    join(repository, "nested/Taskfile.yml"),
    "version: '3'\ntasks:\n  hello:\n    cmds: [echo nested]\n  choose:\n    requires:\n      vars: [{name: ENV, enum: [staging, production]}]\n    cmds: [echo selected]\n",
  );
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>((done) => socket.close(() => done()));
  base = `http://127.0.0.1:${port}`;
  const cwd = resolve("../pybackend");
  backend = spawn(
    join(cwd, ".venv/bin/python"),
    [
      "-m",
      "uvicorn",
      "build_task_test_app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd,
      env: {
        ...process.env,
        MADE_HOME: directory,
        MADE_WORKSPACE_HOME: directory,
        PYTHONPATH: `${cwd}/tests/fixtures:${cwd}`,
      },
      stdio: "ignore",
    },
  );
  let failure: Error | null = null;
  backend.once("error", (error) => {
    failure = error;
  });
  const deadline = Date.now() + 20000;
  while (true) {
    if (failure) throw failure;
    try {
      if ((await fetch(`${base}/api/repositories/sample/build-tasks`)).ok)
        break;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    if (Date.now() > deadline)
      throw new Error("Real test backend did not start");
    await new Promise((done) => setTimeout(done, 100));
  }
  vi.stubEnv("VITE_API_BASE", `${base}/api`);
  BuildTasksTab = (await import("./BuildTasksTab")).BuildTasksTab;
}, 30000);

afterEach(cleanup);
afterAll(async () => {
  vi.unstubAllEnvs();
  if (backend?.pid && backend.exitCode === null) {
    const exited = new Promise((done) => backend.once("exit", done));
    backend.kill("SIGTERM");
    const timer = setTimeout(() => backend.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("groups files, runs no-argument targets immediately, persists PID and reads real output", async () => {
  const first = render(<BuildTasksTab repository="sample" />);
  expect(
    await screen.findByRole("button", { name: "Run Makefile hello" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Run nested/Taskfile.yml hello" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Run Makefile hello" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const run = await screen.findByRole("article", {
    name: "Makefile hello run",
  });
  await waitFor(() => expect(within(run).getByText("Succeeded")).toBeVisible());
  expect(within(run).getByText(/PID \d+ · Exit 0/)).toBeVisible();
  fireEvent.click(within(run).getByRole("button", { name: "View tail" }));
  expect(await screen.findByText(/COMPONENT_OK/)).toBeVisible();
  first.unmount();
  render(<BuildTasksTab repository="sample" />);
  expect(
    await screen.findByRole("article", { name: "Makefile hello run" }),
  ).toHaveTextContent("Exit 0");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("requires declared arguments and offers literal enum choices without running on modal open", async () => {
  render(<BuildTasksTab repository="sample" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Run Makefile with-name" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("WHO (required)"), {
    target: { value: "Ada Lovelace" },
  });
  expect(
    within(dialog).getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Run", exact: true }),
  );
  const run = await screen.findByRole("article", {
    name: "Makefile with-name run",
  });
  await waitFor(() => expect(run).toHaveTextContent("Succeeded"));
  fireEvent.click(within(run).getByRole("button", { name: "View tail" }));
  expect(await screen.findByText(/NAME=Ada Lovelace/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Run nested/Taskfile.yml choose" }),
  );
  expect(screen.getByRole("combobox", { name: "ENV (required)" })).toHaveValue(
    "",
  );
  expect(
    screen.getByRole("option", { name: "production" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("dialog")).not.toHaveTextContent("PID");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
});

test("repository switching resets selections and runs, and errors/empty states are scoped", async () => {
  const view = render(<BuildTasksTab repository="sample" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Run Makefile with-name" }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  view.rerender(<BuildTasksTab repository="empty" />);
  expect(
    await screen.findByText("No supported Makefiles or Taskfiles found."),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  view.rerender(<BuildTasksTab repository="missing" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Repository not found",
  );
  expect(
    screen.queryByRole("button", { name: "Run Makefile hello" }),
  ).not.toBeInTheDocument();
});
