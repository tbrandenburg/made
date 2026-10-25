import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

let server: Server;
let requests = 0;

beforeAll(async () => {
  // Exercise the real API client over HTTP, including failure and recovery.
  server = createServer((req, res) => {
    if (req.url !== "/api/system-metrics") {
      res.writeHead(404).end();
      return;
    }
    requests++;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    if (requests === 2) {
      res
        .writeHead(503)
        .end(JSON.stringify({ detail: "Temporarily unavailable" }));
      return;
    }
    res.end(
      JSON.stringify({
        cpuUtilization: requests === 1 ? 25.5 : 42.0,
        cpuPressure: 0,
        ramUtilization: 60.1,
        memoryPressure: null,
        diskUtilization: 70.2,
        ioPressure: 3.4,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  vi.stubEnv("VITE_API_BASE", `http://127.0.0.1:${address.port}/api`);
});

afterAll(async () => {
  cleanup();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

it("renders all six metrics, clears stale values on failure, and recovers on refresh", async () => {
  const { SystemMetrics } = await import("./SystemMetrics");
  const view = render(<SystemMetrics />);
  const card = (name: string) =>
    within(screen.getByRole("heading", { name }).closest("section")!);
  expect(await screen.findByText("25.5%")).toBeInTheDocument();
  expect(card("CPU pressure").getByText("0.0%")).toBeInTheDocument();
  expect(card("RAM utilization").getByText("60.1%")).toBeInTheDocument();
  expect(card("Memory pressure").getByText("Unavailable")).toBeInTheDocument();
  expect(card("Disk space utilization").getByText("70.2%")).toBeInTheDocument();
  expect(card("I/O pressure").getByText("3.4%")).toBeInTheDocument();

  await waitFor(
    () =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "temporarily unavailable",
      ),
    { timeout: 7000 },
  );
  expect(screen.queryByText("25.5%")).not.toBeInTheDocument();
  expect(screen.getAllByText("Unavailable")).toHaveLength(6);
  await waitFor(
    () =>
      expect(card("CPU utilization").getByText("42.0%")).toBeInTheDocument(),
    { timeout: 7000 },
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(requests).toBe(3);
  view.unmount();
}, 20000);
