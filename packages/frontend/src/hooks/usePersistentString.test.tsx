import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { usePersistentString } from "./usePersistentString";

const TestComponent = ({
  storageKey,
  initialValue,
  scopeKey,
  setNextValue,
}: {
  storageKey: string | undefined;
  initialValue?: string | null;
  scopeKey?: string;
  setNextValue?: string | null;
}) => {
  const [value, setValue] = usePersistentString(
    storageKey,
    initialValue ?? null,
    scopeKey,
  );

  useEffect(() => {
    if (setNextValue !== undefined) {
      setValue(setNextValue);
    }
  }, [setNextValue, setValue]);

  return <div data-testid="value">{value ?? ""}</div>;
};

describe("usePersistentString", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads the stored value on mount", () => {
    localStorage.setItem("test-key", "stored-value");

    const { getByTestId } = render(
      <TestComponent storageKey="test-key" scopeKey="repo-a" />,
    );

    expect(getByTestId("value").textContent).toBe("stored-value");
  });

  it("resets to initialValue when the route scope changes to a new empty key", () => {
    localStorage.setItem("repo-a", "stale-value");

    const { getByTestId, rerender } = render(
      <TestComponent storageKey="repo-a" scopeKey="repo-a" />,
    );

    expect(getByTestId("value").textContent).toBe("stale-value");

    rerender(
      <TestComponent
        storageKey="repo-b"
        scopeKey="repo-b"
        initialValue={null}
      />,
    );

    expect(getByTestId("value").textContent).toBe("");
    expect(localStorage.getItem("repo-b")).toBeNull();
  });

  it("preserves the current value when only the bootstrap key changes", async () => {
    const { getByTestId, rerender } = render(
      <TestComponent
        storageKey={undefined}
        scopeKey="repo-a"
        initialValue="boot"
      />,
    );

    expect(getByTestId("value").textContent).toBe("boot");

    rerender(
      <TestComponent
        storageKey="repo-a-bootstrap"
        scopeKey="repo-a"
        initialValue="boot"
      />,
    );

    expect(getByTestId("value").textContent).toBe("boot");
    expect(localStorage.getItem("repo-a-bootstrap")).toBe("boot");
  });

  it("persists user updates to localStorage", () => {
    const { rerender } = render(
      <TestComponent storageKey="test-key" scopeKey="repo-a" />,
    );

    rerender(
      <TestComponent
        storageKey="test-key"
        scopeKey="repo-a"
        setNextValue="user-value"
      />,
    );

    expect(localStorage.getItem("test-key")).toBe("user-value");
  });
});
