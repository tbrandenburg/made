import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const runner = "scripts/opencode-v2-acceptance/run.py";
const state = process.env.MADE_ACCEPTANCE_STATE;
if (!state) throw new Error("Acceptance state is required");

interface Manifest {
  session: string;
  fixture: string;
  child: string;
  grandchild: string;
  foreignChild: string;
  realProvider: boolean;
  first: string;
  late: string;
  tool: string;
  model: string;
}
interface Message {
  messageId: string;
  role: string;
  type: string;
  content: string;
  callId?: string;
  partId?: string;
  timestamp: string;
}
interface History {
  historyMode: string;
  messages: Message[];
}

async function control(action: string): Promise<string> {
  const result = await execute(
    "python3",
    [runner, "--state", state!, "control", action],
    { timeout: 300_000 },
  );
  return result.stdout;
}
async function history(
  api: APIRequestContext,
  session: string,
): Promise<History> {
  const response = await api.get(
    `/api/repositories/repoA/agent/history?session_id=${session}`,
  );
  expect(response.status()).toBe(200);
  const result: History = await response.json();
  expect(result.historyMode).toBe("snapshot");
  expect(
    new Set(result.messages.map((message) => message.messageId)).size,
  ).toBe(result.messages.length);
  return result;
}
async function refresh(page: Page): Promise<void> {
  const response = page.waitForResponse((reply) =>
    new URL(reply.url()).pathname.endsWith("/agent/history"),
  );
  await page
    .getByRole("button", { name: "Refresh current session", exact: true })
    .click();
  await response;
  await expect(
    page.getByRole("button", { name: "Refresh current session", exact: true }),
  ).toBeEnabled();
}
async function open(page: Page, session: string): Promise<void> {
  await page.goto(`/repositories/repoA?sessionId=${session}`);
  await expect(
    page.getByRole("button", { name: "Refresh current session", exact: true }),
  ).toBeVisible();
}

test("owned stack browser smoke", async ({ page, request }) => {
  const response = await request.get("/api/settings");
  expect(response.status()).toBe(200);
  expect((await response.json()).agentCli).toBe("opencode-v2");
  await page.goto("/repositories");
  await expect(
    page.getByRole("heading", { name: "Repositories", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^repoA/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^repoB/ })).toHaveCount(1);
});

test("provider-free real browser pagination, isolation, outage and recovery", async ({
  page,
  request,
}) => {
  const manifest: Manifest = JSON.parse(await control("manifest"));
  const sessionsResponse = await request.get(
    "/api/repositories/repoA/agent/sessions",
  );
  expect(sessionsResponse.status()).toBe(200);
  const listedSessions: { id: string }[] = (await sessionsResponse.json())
    .sessions;
  expect(listedSessions).toHaveLength(10);
  expect(
    listedSessions.some((session) => session.id === manifest.session),
  ).toBe(false);
  expect(listedSessions.some((session) => session.id === manifest.child)).toBe(
    false,
  );
  const childSessionsResponse = await request.get(
    "/api/repositories/repoA/agent/child-sessions",
  );
  expect(childSessionsResponse.status()).toBe(200);
  const listedChildren: {
    id: string;
    parentId: string;
    parentTitle: string;
  }[] = (await childSessionsResponse.json()).sessions;
  expect(listedChildren.length).toBeLessThanOrEqual(50);
  expect(
    listedChildren.find((session) => session.id === manifest.child),
  ).toEqual(
    expect.objectContaining({
      id: manifest.child,
      parentId: manifest.session,
    }),
  );
  expect(
    listedChildren.find((session) => session.id === manifest.grandchild),
  ).toEqual(
    expect.objectContaining({
      id: manifest.grandchild,
      parentId: manifest.child,
    }),
  );
  expect(
    listedChildren.some((session) => session.id === manifest.foreignChild),
  ).toBe(false);
  const initial = await history(request, manifest.fixture);
  expect(initial.messages.map((message) => message.content)).toEqual([
    "MADE779_PAGE_FIRST",
    "MADE779_PAGE_LAST",
  ]);
  await open(page, manifest.fixture);
  await expect(
    page
      .locator(".chat-message.user")
      .filter({ hasText: "MADE779_PAGE_FIRST" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".chat-message.user").filter({ hasText: "MADE779_PAGE_LAST" }),
  ).toHaveCount(1);
  await refresh(page);
  expect((await history(request, manifest.fixture)).messages).toEqual(
    initial.messages,
  );

  for (const route of [
    "repositories/repoB",
    "knowledge/acceptance.md",
    "constitutions/acceptance.md",
    "tasks/acceptance.md",
  ]) {
    const response = await request.get(
      `/api/${route}/agent/history?session_id=${manifest.fixture}`,
    );
    expect(response.status(), route).toBe(409);
    const body = await response.text();
    expect(JSON.parse(body).detail.code).toBe("session_directory_mismatch");
    expect(body).not.toContain("/workspace/repoA");
    expect(body).not.toContain("MADE779_PAGE_FIRST");
  }

  await control("snapshot");
  await control("restart");
  await refresh(page);
  expect((await history(request, manifest.fixture)).messages).toEqual(
    initial.messages,
  );
  try {
    await control("stop");
    await refresh(page);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page
        .locator(".chat-message.user")
        .filter({ hasText: "MADE779_PAGE_LAST" }),
    ).toHaveCount(1);
    const unavailable = await request.get(
      `/api/repositories/repoA/agent/history?session_id=${manifest.fixture}`,
    );
    expect(unavailable.ok()).toBe(false);
    expect(await unavailable.text()).not.toContain("MADE779_PAGE_FIRST");
  } finally {
    await control("start");
  }
  await refresh(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await history(request, manifest.fixture)).messages).toEqual(
    initial.messages,
  );

  await page
    .getByRole("button", { name: "Choose a session", exact: true })
    .click();
  const child = listedChildren.find((session) => session.id === manifest.child);
  expect(child).toBeDefined();
  await expect(
    page.getByText(`Child of ${child?.parentTitle}`, { exact: true }),
  ).toBeVisible();
  const childSelection = page.waitForResponse((reply) => {
    const url = new URL(reply.url());
    return (
      url.pathname.endsWith("/agent/history") &&
      url.searchParams.get("session_id") === manifest.child
    );
  });
  await page
    .locator('button.session-pill-select[title="Child acceptance session"]')
    .click();
  const selectedChildHistory = await childSelection;
  expect(selectedChildHistory.status()).toBe(200);
  expect(
    ((await selectedChildHistory.json()) as History).messages.map(
      (message) => message.content,
    ),
  ).toContain("MADE800_CHILD_HISTORY_COBALT");
  await expect(
    page
      .locator(".chat-message.user")
      .filter({ hasText: "MADE800_CHILD_HISTORY_COBALT" }),
  ).toHaveCount(1);

  await page
    .getByRole("button", { name: "Choose a session", exact: true })
    .click();
  const grandchildSelection = page.waitForResponse((reply) => {
    const url = new URL(reply.url());
    return (
      url.pathname.endsWith("/agent/history") &&
      url.searchParams.get("session_id") === manifest.grandchild
    );
  });
  await page
    .getByRole("button", { name: /Grandchild acceptance session/ })
    .click();
  const selectedGrandchildHistory = await grandchildSelection;
  expect(selectedGrandchildHistory.status()).toBe(200);
  expect(
    ((await selectedGrandchildHistory.json()) as History).messages.map(
      (message) => message.content,
    ),
  ).toContain("MADE800_GRANDCHILD_HISTORY_COBALT");
});

test("real CLI root, terminal resume/manual refresh, tools and executed polling refresh", async ({
  page,
  request,
}) => {
  const manifest: Manifest = JSON.parse(await control("manifest"));
  expect(
    manifest.realProvider,
    "A smoke fixture is NOT a real-provider acceptance pass",
  ).toBe(true);
  const initial = await history(request, manifest.session);
  const tools = initial.messages.filter(
    (message) => message.type === "tool_use",
  );
  expect(tools.length).toBeGreaterThan(0);
  expect(
    tools.some(
      (message) =>
        Boolean(message.callId) && message.content.includes(manifest.tool),
    ),
  ).toBe(true);
  await open(page, manifest.session);
  await expect(
    page
      .locator(".chat-message.agent.final")
      .filter({ hasText: manifest.first }),
  ).toHaveCount(1);

  const resumed = control("resume");
  for (let index = 0; index < 3; index += 1) await refresh(page);
  await resumed;
  await refresh(page);
  await expect(
    page
      .locator(".chat-message.agent.final")
      .filter({ hasText: manifest.late }),
  ).toHaveCount(1);
  const updated = await history(request, manifest.session);
  for (const message of initial.messages) {
    expect(
      updated.messages.find(
        (candidate) => candidate.messageId === message.messageId,
      ),
    ).toEqual(message);
  }
  expect(updated.messages.length).toBeGreaterThan(initial.messages.length);

  // MADE starts its own processing state; external-activity detection is not required.
  let posting = false;
  let polled = 0;
  page.on("request", (outgoing) => {
    if (
      outgoing.method() === "POST" &&
      new URL(outgoing.url()).pathname.endsWith("/agent")
    )
      posting = true;
  });
  page.on("response", (incoming) => {
    const url = new URL(incoming.url());
    if (
      incoming.request().method() === "POST" &&
      url.pathname.endsWith("/agent")
    )
      posting = false;
    if (
      posting &&
      url.pathname.endsWith("/agent/history") &&
      incoming.status() === 200
    )
      polled += 1;
  });
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .selectOption(manifest.model);
  await page
    .getByPlaceholder("Describe the change or ask the agent...")
    .fill(
      "Use the shell tool to run sleep 8, then reply exactly MADE779_POLL_COBALT.",
    );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => polled, { timeout: 180_000 }).toBeGreaterThan(0);
  await expect(
    page
      .locator(".chat-message.agent.final")
      .filter({ hasText: "MADE779_POLL_COBALT" }),
  ).toHaveCount(1, { timeout: 240_000 });
  const final = await history(request, manifest.session);
  expect(
    final.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.content.includes("MADE779_POLL_COBALT"),
    ),
  ).toBe(true);
  expect(new Set(final.messages.map((message) => message.messageId)).size).toBe(
    final.messages.length,
  );
});
