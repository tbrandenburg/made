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
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendAgentMessage("test-repo", "hello world"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("retrying"),
      );
    });

    it("should NOT retry DELETE requests on network error", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.deleteRepository("test-repo"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should still retry on HTTP 5xx errors for all methods", async () => {
      window.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ repositories: [] }), { status: 200 }));

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
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendAgentMessage("test-repo", "test message"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendKnowledgeAgent on network timeout", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendKnowledgeAgent("test message", "artefact-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendConstitutionAgent on network timeout", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendConstitutionAgent("test message", "constitution-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it("should not retry sendTaskAgent on network timeout", async () => {
      window.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(
        api.sendTaskAgent("test message", "task-id"),
      ).rejects.toThrow("Failed to fetch");

      expect(window.fetch).toHaveBeenCalledTimes(1);
    });
  });
});