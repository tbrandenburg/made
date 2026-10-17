import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

const state = process.env.MADE_ACCEPTANCE_STATE;
if (!state)
  throw new Error(
    "Use scripts/opencode-v2-acceptance/run.py; no shared server fallback",
  );
const stack: { web: number } = JSON.parse(readFileSync(state, "utf8"));

export default defineConfig({
  testDir: ".",
  testMatch: "opencode-v2.spec.ts",
  timeout: 360_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  // This fixture contains synthetic content only. No provider/network interception.
  outputDir: `${state}.browser`,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${stack.web}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
