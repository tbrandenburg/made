// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders with skeleton class", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("skeleton");
  });

  it("applies custom width and height via style", () => {
    const { container } = render(<Skeleton width="5rem" height="1rem" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("5rem");
    expect(el.style.height).toBe("1rem");
  });

  it("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("appends extra className", () => {
    const { container } = render(<Skeleton className="skeleton-badge" />);
    expect(container.firstChild).toHaveClass("skeleton");
    expect(container.firstChild).toHaveClass("skeleton-badge");
  });
});
