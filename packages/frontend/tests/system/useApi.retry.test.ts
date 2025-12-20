import { api } from "../../src/hooks/useApi.ts";

type FetchCall = { url: string; options?: RequestInit };

global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  throw new Error(`Unhandled fetch call: ${String(input)}`);
};

async function testNetworkRetry() {
  const calls: FetchCall[] = [];
  let attempt = 0;

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), options: init });
    attempt += 1;

    if (attempt < 3) {
      throw new TypeError("Simulated network failure");
    }

    return new Response(JSON.stringify({ value: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await api.getSettings();

  if (attempt !== 3 || result.value !== "ok") {
    throw new Error(`Network retry test failed after ${attempt} attempts`);
  }

  return calls;
}

async function testServerRetry() {
  const calls: FetchCall[] = [];
  let attempt = 0;

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), options: init });
    attempt += 1;

    if (attempt < 3) {
      return new Response("Server error", { status: 500 });
    }

    return new Response(JSON.stringify({ value: "healthy" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await api.getSettings();

  if (attempt !== 3 || result.value !== "healthy") {
    throw new Error(`Server retry test failed after ${attempt} attempts`);
  }

  return calls;
}

(async () => {
  try {
    const networkCalls = await testNetworkRetry();
    const serverCalls = await testServerRetry();

    console.log("Network retry calls:", networkCalls);
    console.log("Server retry calls:", serverCalls);
    console.log("System test passed");
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.stack);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
})();
