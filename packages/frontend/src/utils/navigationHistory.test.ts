// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNavigationHistory,
  recordNavigationVisit,
  getHistoryKindLabel,
} from "./navigationHistory";

describe("navigationHistory", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("records only supported detail pages", () => {
    recordNavigationVisit("/");
    recordNavigationVisit("/repositories");
    recordNavigationVisit("/repositories/demo-repo");

    const history = getNavigationHistory();

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: "repository:demo-repo",
      path: "/repositories/demo-repo",
      kind: "repository",
    });
  });

  it("keeps entries distinct and sorted by latest visit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    recordNavigationVisit("/tasks/task-a.md");

    vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
    recordNavigationVisit("/knowledge/guide.md");

    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    recordNavigationVisit("/tasks/task-a.md");

    const history = getNavigationHistory();

    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("task:task-a.md");
    expect(history[1].id).toBe("knowledge:guide.md");
    expect(Date.parse(history[0].visitedAt)).toBeGreaterThan(
      Date.parse(history[1].visitedAt),
    );
  });

  it("returns display labels for kinds", () => {
    expect(getHistoryKindLabel("repository")).toBe("Repository");
    expect(getHistoryKindLabel("task")).toBe("Task");
    expect(getHistoryKindLabel("knowledge")).toBe("Knowledge");
    expect(getHistoryKindLabel("constitution")).toBe("Constitution");
  });

  it("caps history to the latest 10 unique entries", () => {
    for (let index = 1; index <= 12; index += 1) {
      recordNavigationVisit(`/repositories/repo-${index}`);
    }

    const history = getNavigationHistory();

    expect(history).toHaveLength(10);
    expect(history[0].name).toBe("repo-12");
    expect(history[9].name).toBe("repo-3");
  });
});
