// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ClearSessionModal } from "./ClearSessionModal";

describe("ClearSessionModal", () => {
  const defaultProps = {
    open: true,
    onCancel: vi.fn(),
    onClearSessionOnly: vi.fn(),
    onClearSessionAndHistory: vi.fn(),
  };

  it("renders action buttons when open", () => {
    render(<ClearSessionModal {...defaultProps} />);

    expect(screen.getByText(/clear the chat history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /yes/i })).toBeInTheDocument();
  });

  it("calls the appropriate handlers", () => {
    render(<ClearSessionModal {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /no/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes/i }));

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    expect(defaultProps.onClearSessionOnly).toHaveBeenCalledTimes(1);
    expect(defaultProps.onClearSessionAndHistory).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    render(<ClearSessionModal {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
