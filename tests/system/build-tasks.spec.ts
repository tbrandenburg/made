import { test, expect, type APIRequestContext } from "@playwright/test";
import { execFileSync, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  failureEvidence,
  startBackend,
  stopBackend,
} from "./fixtures/buildTaskBackend";

// Real HTTP/backend/browser fixture. No page.route or request mocks.
let directory: string;
let repository: string;
let base: string;
let backend: ChildProcess;
const gitEnvironment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  ),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
const fixtureGit = (args: string[]) =>
  execFileSync("git", args, { env: gitEnvironment, timeout: 10000 });

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "made-build-e2e-"));
  repository = join(directory, "fixture");
  await mkdir(join(repository, "services/api"), { recursive: true });
  await writeFile(
    join(repository, "Makefile"),
    `.PHONY: hello with-name fails long
hello:
\t@echo MAKE_OK
# made:args WHO!
with-name:
\t@echo "MAKE_NAME=$(WHO)"
fails:
\t@echo MAKE_ERROR >&2; exit 7
long:
\t@sleep 3; echo MAKE_LONG_DONE
# made:args WHO!
literal:
\t@python3 literal.py
`,
  );
  await writeFile(
    join(repository, "literal.py"),
    "import os\nprint('LITERAL=' + os.environ['WHO'])\n",
  );
  await writeFile(
    join(repository, "services/api/Taskfile.yml"),
    `version: '3'
tasks:
  hello:
    desc: Simple task logging
    cmds: [echo TASK_OK, pwd]
  with-name:
    requires:
      vars: [WHO]
    cmds:
      - echo "TASK_NAME={{.WHO}}"
  choose:
    requires:
      vars: [{name: ENV, enum: [staging, production]}]
    cmds: [echo chosen]
  fails:
    cmds: ["sh -c 'echo TASK_ERROR >&2; exit 9'"]
  long:
    cmds: [sleep 3, echo TASK_LONG_DONE]
  hidden:
    internal: true
    cmds: [echo SHOULD_NOT_APPEAR]
`,
  );
  await mkdir(join(repository, ".flowsh/logs"), { recursive: true });
  await writeFile(
    join(repository, ".flowsh/logs/flowsh-existing.log"),
    "EXISTING_WORKFLOW_OUTPUT\n",
  );
  await mkdir(join(repository, ".made"));
  await writeFile(
    join(repository, ".made/workflows.yml"),
    "workflows:\n  - id: regression\n    name: Existing workflow\n    enabled: false\n    schedule: '0 0 * * *'\n    shellScriptPath: .harness/existing.sh\n    steps: []\n",
  );
  fixtureGit(["init", "-q", repository]);
  fixtureGit([
    "-C",
    repository,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  fixtureGit([
    "-C",
    repository,
    "worktree",
    "add",
    "-q",
    "--detach",
    join(directory, "linked"),
  ]);
  await writeFile(
    join(directory, "linked/Makefile"),
    "hello:\n\t@echo LINKED_OK\n",
  );
  const started = await startBackend(directory);
  backend = started.process;
  base = started.base;
});

test.afterAll(async () => {
  if (backend) await stopBackend(backend);
  if (directory) await rm(directory, { recursive: true, force: true });
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && directory)
    await info.attach("failed-run-records", {
      body: await failureEvidence(directory),
      contentType: "application/json",
    });
});

async function finished(
  request: APIRequestContext,
  runId: string,
  repository = "fixture",
) {
  const endpoint = `${base}/api/repositories/${repository}/build-tasks/runs/${runId}`;
  await expect
    .poll(async () => (await (await request.get(endpoint)).json()).status, {
      timeout: 20000,
    })
    .not.toBe("running");
  return (await request.get(endpoint)).json();
}

test("issue 781: sixteen real acceptance requirements", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  const evidence: { step: number; runId?: string; detail: string }[] = [];
  await page.goto(`${base}/repositories/fixture?tab=build-tasks`);
  await page
    .getByRole("button", { name: "Build & Tasks", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Makefile · ." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Taskfile.yml · services/api" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Run .* hidden/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /Run .* PHONY/ })).toHaveCount(
    0,
  );
  evidence.push({
    step: 1,
    detail:
      "Distinct root Make and nested Task panels; internal/special targets absent",
  });

  const launch = async (file: string, target: string, parameter?: string) => {
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/build-tasks/runs") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: `Run ${file} ${target}`, exact: true })
      .click();
    if (parameter !== undefined) {
      await expect(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "Run", exact: true }),
      ).toBeDisabled();
      await page.getByLabel("WHO (required)").fill(parameter);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Run", exact: true })
        .click();
    } else await expect(page.getByRole("dialog")).toHaveCount(0);
    const result = await (await response).json();
    expect(result.pid).toBeGreaterThan(0);
    expect(result.status).toBe("running");
    return result;
  };
  const make = await launch("Makefile", "hello");
  const makeDone = await finished(request, make.runId);
  expect(makeDone.exitCode).toBe(0);
  expect(makeDone.tail).toContain("MAKE_OK");
  expect(makeDone.tail).toContain("MADE finish");
  await expect(
    page.getByRole("article", { name: "Makefile hello run" }),
  ).toContainText("Succeeded");
  await expect(
    page.getByRole("article", { name: "Makefile hello run" }),
  ).toContainText("Exit 0");
  evidence.push({ step: 2, runId: make.runId, detail: makeDone.tail });
  const task = await launch("services/api/Taskfile.yml", "hello");
  const taskDone = await finished(request, task.runId);
  expect(taskDone.exitCode).toBe(0);
  expect(taskDone.tail).toContain("TASK_OK");
  expect(taskDone.tail).toContain(join(repository, "services/api"));
  await expect(
    page.getByRole("article", { name: "services/api/Taskfile.yml hello run" }),
  ).toContainText("Succeeded");
  evidence.push({ step: 3, runId: task.runId, detail: taskDone.tail });
  for (const [file, prefix, step] of [
    ["Makefile", "MAKE_NAME", 4],
    ["services/api/Taskfile.yml", "TASK_NAME", 5],
  ] as const) {
    const run = await launch(file, "with-name", "Ada Lovelace");
    const result = await finished(request, run.runId);
    expect(result.exitCode).toBe(0);
    expect(result.tail).toContain(`${prefix}=Ada Lovelace`);
    evidence.push({ step, runId: run.runId, detail: result.tail });
  }
  const longMake = await launch("Makefile", "long");
  const longTask = await launch("services/api/Taskfile.yml", "long");
  expect(longMake.runId).not.toBe(longTask.runId);
  expect(longMake.pid).not.toBe(longTask.pid);
  for (const run of [longMake, longTask]) {
    await expect(
      page.getByRole("article", { name: `${run.file} long run` }),
    ).toContainText("Running");
  }
  for (const run of [longMake, longTask]) {
    const result = await finished(request, run.runId);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThan(2500);
    await expect(
      page.getByRole("article", { name: `${run.file} long run` }),
    ).toContainText("Succeeded");
    await expect(
      page.getByRole("article", { name: `${run.file} long run` }),
    ).toContainText("Exit 0");
    evidence.push({ step: 6, runId: run.runId, detail: result.tail });
  }
  for (const [file, output] of [
    ["Makefile", "MAKE_ERROR"],
    ["services/api/Taskfile.yml", "TASK_ERROR"],
  ] as const) {
    const run = await launch(file, "fails");
    const result = await finished(request, run.runId);
    expect(result.status).toBe("failed");
    expect(result.exitCode).not.toBe(0);
    expect(result.tail).toContain(output);
    await expect(
      page.getByRole("article", { name: `${file} fails run` }),
    ).toContainText("Failed");
    await expect(
      page.getByRole("article", { name: `${file} fails run` }),
    ).toContainText(`Exit ${result.exitCode}`);
    evidence.push({ step: 7, runId: run.runId, detail: result.tail });
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Build & Tasks", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(8);
  const firstRun = page.getByRole("article").first();
  await firstRun.getByRole("button", { name: "View tail" }).click();
  await expect(firstRun.locator("pre")).toContainText("MADE finish");
  evidence.push({
    step: 8,
    detail:
      "Eight persisted runs after browser refresh; output tail opened through UI",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("heading", { name: "Build & Tasks", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("build-tasks-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath("build-tasks-desktop.png"),
    fullPage: true,
  });

  await page.goto(`${base}/tasks`);
  await expect(
    page.getByRole("heading", { name: "Run logs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Build & Tasks", exact: true }).first(),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "View tail" }).first().click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "MADE finish",
  );
  await page.getByRole("button", { name: "Close modal" }).click();
  const workflowTail = await request.get(
    `${base}/api/workflow-logs/fixture/flowsh-existing.log`,
  );
  expect((await workflowTail.json()).tail).toBe("EXISTING_WORKFLOW_OUTPUT");
  evidence.push({
    step: 9,
    detail:
      "Shared Run logs type and browser tail work; existing flowsh tail preserved",
  });

  await page.goto(`${base}/repositories/fixture?tab=build-tasks`);
  await page
    .getByRole("button", { name: "Build & Tasks", exact: true })
    .click();
  await writeFile(
    join(repository, "Makefile"),
    (await readFile(join(repository, "Makefile"), "utf8")) +
      "\nadded:\n\t@echo ADDED\n",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run Makefile added" }),
  ).toBeVisible();
  await writeFile(
    join(repository, "Makefile"),
    (await readFile(join(repository, "Makefile"), "utf8")).replace(
      "added:",
      "renamed:",
    ),
  );
  await page.getByRole("button", { name: "Run Makefile added" }).click();
  await expect(page.getByRole("alert")).toContainText("Target not found");
  evidence.push({
    step: 10,
    detail:
      "Refresh discovers new rule; stale target execution rejected visibly",
  });

  const tools = join(directory, "missing-task-path");
  await mkdir(tools);
  await symlink(
    execFileSync("which", ["make"], { encoding: "utf8" }).trim(),
    join(tools, "make"),
  );
  await symlink(
    execFileSync("which", ["echo"], { encoding: "utf8" }).trim(),
    join(tools, "echo"),
  );
  const missing = await startBackend(directory, tools);
  try {
    await page.goto(`${missing.base}/repositories/fixture?tab=build-tasks`);
    await page
      .getByRole("button", { name: "Build & Tasks", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Run services/api/Taskfile.yml hello" })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Missing executable: go-task",
    );
    const success = await request.post(
      `${missing.base}/api/repositories/fixture/build-tasks/runs`,
      { data: { file: "Makefile", target: "hello" } },
    );
    expect(success.ok()).toBe(true);
    const launched = await success.json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(
                `${missing.base}/api/repositories/fixture/build-tasks/runs/${launched.runId}`,
              )
            ).json()
          ).status,
      )
      .toBe("succeeded");
    evidence.push({
      step: 11,
      runId: launched.runId,
      detail: "Task missing executable feedback visible; Make still launches",
    });
  } finally {
    await stopBackend(missing.process);
  }
  await symlink(directory, join(repository, "escape"));
  for (const data of [
    { file: "../Makefile", target: "hello" },
    { file: "/etc/Makefile", target: "hello" },
    { file: "escape/Makefile", target: "hello" },
    { file: "Makefile", target: "unknown" },
    { file: "Makefile", target: "hello", parameters: { UNKNOWN: "x" } },
  ]) {
    const response = await request.post(
      `${base}/api/repositories/fixture/build-tasks/runs`,
      { data },
    );
    expect([400, 404]).toContain(response.status());
    expect((await response.json()).detail).toBeTruthy();
  }
  evidence.push({
    step: 12,
    detail: "Five invalid path/target/parameter requests rejected with 400/404",
  });
  const literal = "Ada Lovelace; touch SHOULD_NOT_EXIST & | literal";
  const literalRun = await (
    await request.post(`${base}/api/repositories/fixture/build-tasks/runs`, {
      data: {
        file: "Makefile",
        target: "literal",
        parameters: { WHO: literal },
      },
    })
  ).json();
  const literalDone = await finished(request, literalRun.runId);
  expect(literalDone.exitCode).toBe(0);
  expect(literalDone.tail).toContain(`LITERAL=${literal}`);
  evidence.push({
    step: 13,
    runId: literalRun.runId,
    detail: literalDone.tail,
  });
  const linked = await (
    await request.post(`${base}/api/repositories/linked/build-tasks/runs`, {
      data: { file: "Makefile", target: "hello" },
    })
  ).json();
  const linkedDone = await finished(request, linked.runId, "linked");
  expect(linkedDone.tail).toContain("LINKED_OK");
  const wrongScope = await request.get(
    `${base}/api/repositories/fixture/build-tasks/runs/${linked.runId}`,
  );
  expect(wrongScope.status()).toBe(404);
  const shared = await (await request.get(`${base}/api/workflow-logs`)).json();
  expect(
    shared.logs.some(
      (log: { name: string; location: string }) =>
        log.name === linked.logName && log.location === "linked",
    ),
  ).toBe(true);
  evidence.push({ step: 14, runId: linked.runId, detail: linkedDone.tail });

  const homes = await (await import("node:fs/promises")).readdir(directory);
  const logs = await Promise.all(
    homes
      .filter((home) => home.startsWith("home-"))
      .map((home) =>
        readFile(join(directory, home, ".made/logs/backend.log"), "utf8"),
      ),
  );
  const backendLog = logs.join("\n");
  expect(backendLog).toContain(make.runId);
  expect(backendLog).toContain("exitCode=0");
  expect(backendLog).not.toContain(literal);
  expect(backendLog).not.toContain("TASK_OK");
  expect(backendLog).not.toContain("MAKE_OK");
  evidence.push({
    step: 15,
    detail:
      "backend.log contains lifecycle IDs/exit codes, not submitted values or captured output",
  });
  await page.goto(`${base}/repositories/fixture`);
  for (const tab of ["Commands", "Harnesses"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator(".tabview-content")).not.toBeEmpty();
  }
  const workflows = await request.get(`${base}/api/workspace/workflows`);
  expect(
    (await workflows.json()).workflows.some(
      (workflow: { name: string }) => workflow.name === "Existing workflow",
    ),
  ).toBe(true);
  await page.goto(`${base}/tasks`);
  await expect(
    page.getByText("Existing workflow", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  evidence.push({
    step: 16,
    detail:
      "Commands/Harnesses tabs open; existing scheduled workflow appears in API and Tasks page; no standard-port services used or interrupted",
  });
  await testInfo.attach("acceptance-evidence", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  await writeFile(
    testInfo.outputPath("acceptance-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  expect(new Set(evidence.map((entry) => entry.step)).size).toBe(16);
});
