import {
  test,
  expect,
  type BrowserContext,
  type ChildProcess,
} from "@playwright/test";
import { startLiteBackend, stopLiteBackend } from "./fixtures/liteBackend";

let context: BrowserContext;
let base: string;
let directory: string;
let backend: ChildProcess;

test.beforeAll(async ({ browser }) => {
  const started = await startLiteBackend();
  base = started.base;
  directory = started.directory;
  backend = started.process;
  context = await browser.newContext({ javaScriptEnabled: false });
});

test.afterAll(async () => {
  await context?.close();
  if (backend && directory) await stopLiteBackend(backend, directory);
});

test("Lite New session clears the remembered cookie without JavaScript", async () => {
  const page = await context.newPage();
  await page.goto(`${base}/lite/repo/lite-fixture`);
  await page
    .locator('select[name="session_id"]')
    .selectOption("ses_browser_fixture_only");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page).toHaveURL(
    `${base}/lite/repo/lite-fixture?session_id=ses_browser_fixture_only`,
  );
  await expect(page.locator(".chat")).toContainText(
    "LITE_EXISTING_TRANSCRIPT_MARKER",
  );
  await expect(page.locator('input[name="session_id"]')).toHaveValue(
    "ses_browser_fixture_only",
  );
  expect(
    (await context.cookies(base)).some(
      (cookie) =>
        cookie.name === "lite_session_lite-fixture" &&
        cookie.value === "ses_browser_fixture_only",
    ),
  ).toBe(true);

  await page.locator('select[name="session_id"]').selectOption("");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page).toHaveURL(`${base}/lite/repo/lite-fixture?session_id=`);
  await expect(page.locator('input[name="session_id"]')).toHaveValue("");
  await expect(page.locator(".chat")).toContainText(
    "Select a session and click Load to view its history",
  );
  await expect(page.locator(".chat")).not.toContainText(
    "LITE_EXISTING_TRANSCRIPT_MARKER",
  );
  expect(
    (await context.cookies(base)).some(
      (cookie) => cookie.name === "lite_session_lite-fixture",
    ),
  ).toBe(false);

  await page.reload();
  await expect(page.locator('input[name="session_id"]')).toHaveValue("");
  await expect(page.locator(".chat")).toContainText(
    "Select a session and click Load to view its history",
  );
  expect(
    (await context.cookies(base)).some(
      (cookie) => cookie.name === "lite_session_lite-fixture",
    ),
  ).toBe(false);

  const postResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/lite/repo/lite-fixture/chat",
  );
  await page
    .locator('textarea[name="message"]')
    .fill("new-session-browser-submit");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const accepted = await postResponse;
  expect(accepted.status()).toBe(303);
  expect(new URL(accepted.headers().location ?? "", base).pathname).toMatch(
    /\/lite\/repo\/lite-fixture\/wait\//,
  );
  const submitted = accepted.request();
  const body = new URLSearchParams(submitted.postData() ?? "");
  expect(body.get("message")).toBe("new-session-browser-submit");
  expect(body.get("session_id")).toBe("");
  expect(body.toString()).not.toContain("ses_browser_fixture_only");
  await page.close();
});
