import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { api } from "./useApi";

describe("useApi retry behavior", () => {
  const originalFetch = window.fetch;
  const consoleSpy = vi.spyOn(console, "log");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    window.fetch = originalFetch;
    consoleSpy.mockRestore();
  });

  describe("idempotent methods (GET, HEAD, OPTIONS)", () => {
    it("should retry GET requests on network error", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ repositories: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const result = await api.listRepositories();

      expect(window.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
      expect(result).toEqual({ repositories: [] });
    });
  });

  describe("non-idempotent methods (POST, PUT, PATCH, DELETE)", () => {
    it("should NOT retry POST requests on network error", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendAgentMessage("test-repo", "hello world"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
    });

    it("should NOT retry DELETE requests on network error", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(api.deleteRepository("test-repo")).rejects.toThrow(
        "Failed to fetch",
      );

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should still retry on HTTP 5xx errors for all methods", async () => {
      window.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ repositories: [] }), { status: 200 }),
        );

      const result = await api.listRepositories();

      expect(window.fetch).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("status 500"),
      );
      expect(result).toEqual({ repositories: [] });
    });
  });

  describe("integration with agent endpoints", () => {
    it("should not retry sendAgentMessage on network timeout", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendAgentMessage("test-repo", "test message"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendKnowledgeAgent on network timeout", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendKnowledgeAgent("test message", "artefact-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendConstitutionAgent on network timeout", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendConstitutionAgent("test message", "constitution-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendTaskAgent on network timeout", async () => {
      window.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendTaskAgent("test message", "task-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("GET request deduplication", () => {
  const originalFetch = window.fetch;

  afterAll(() => {
    window.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should issue only one fetch for concurrent identical GET requests", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ agents: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const [result1, result2] = await Promise.all([
      api.getAgents(),
      api.getAgents(),
    ]);

    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(result1).toEqual({ agents: [] });
    expect(result2).toEqual({ agents: [] });
  });

  it("should allow a fresh request after the previous one completes", async () => {
    let callCount = 0;
    window.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ agents: [{ name: `agent-${callCount}` }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    await api.getAgents();
    const result = await api.getAgents();

    expect(window.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ agents: [{ name: "agent-2" }] });
  });
});

describe("sessionId forwarding for status and cancel endpoints", () => {
  const originalFetch = window.fetch;

  afterAll(() => {
    window.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include session_id query param in getRepositoryAgentStatus when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.getRepositoryAgentStatus("my-repo", "ses_abc123");

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("session_id=ses_abc123"),
      expect.anything(),
    );
  });

  it("should omit session_id query param in getRepositoryAgentStatus when not provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.getRepositoryAgentStatus("my-repo");

    expect(window.fetch).toHaveBeenCalledWith(
      expect.not.stringContaining("session_id"),
      expect.anything(),
    );
  });

  it("should include sessionId in request body for cancelRepositoryAgent when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.cancelRepositoryAgent("my-repo", "ses_xyz");

    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ sessionId: "ses_xyz" });
  });

  it("should send cancel without body when sessionId is not provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.cancelRepositoryAgent("my-repo");

    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it("should include session_id query param in getKnowledgeAgentStatus when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.getKnowledgeAgentStatus("my-doc.md", "ses_k1");

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("session_id=ses_k1"),
      expect.anything(),
    );
  });

  it("should include sessionId in request body for cancelKnowledgeAgent when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.cancelKnowledgeAgent("my-doc.md", "ses_k1");

    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ sessionId: "ses_k1" });
  });

  it("should include session_id query param in getConstitutionAgentStatus when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.getConstitutionAgentStatus("my-const.md", "ses_c1");

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("session_id=ses_c1"),
      expect.anything(),
    );
  });

  it("should include sessionId in request body for cancelConstitutionAgent when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.cancelConstitutionAgent("my-const.md", "ses_c1");

    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ sessionId: "ses_c1" });
  });

  it("should include session_id query param in getTaskAgentStatus when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ running: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.getTaskAgentStatus("my-task.md", "ses_t1");

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining("session_id=ses_t1"),
      expect.anything(),
    );
  });

  it("should include sessionId in request body for cancelTaskAgent when provided", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.cancelTaskAgent("my-task.md", "ses_t1");

    const [, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ sessionId: "ses_t1" });
  });
});
