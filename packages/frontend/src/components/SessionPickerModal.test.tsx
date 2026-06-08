// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionPickerModal } from "./SessionPickerModal";
import { ChatSession } from "../hooks/useApi";

const mockSessions: ChatSession[] = [
  { id: "s1", title: "Session 1", updated: "2024-01-01" },
  { id: "s2", title: "Session 2", updated: "2024-01-02" },
];

const defaultProps = {
  open: true,
  loading: false,
  error: null,
  sessions: mockSessions,
  savedSessionIds: [],
  onClose: vi.fn(),
  onSelect: vi.fn(),
  onRemoveSavedSession: vi.fn(),
};

describe("SessionPickerModal", () => {
  it("renders session list when open", () => {
    render(<SessionPickerModal {...defaultProps} />);

    expect(screen.getByText("Session 1")).toBeInTheDocument();
    expect(screen.getByText("Session 2")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<SessionPickerModal {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <SessionPickerModal {...defaultProps} loading={true} sessions={[]} />,
    );

    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(
      <SessionPickerModal
        {...defaultProps}
        error="Failed to load"
        sessions={[]}
      />,
    );

    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("calls onSelect when a session is clicked", () => {
    const onSelect = vi.fn();
    render(<SessionPickerModal {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByTitle("Session 1"));

    expect(onSelect).toHaveBeenCalledWith(mockSessions[0]);
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<SessionPickerModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders saved sessions with remove button", () => {
    const onRemoveSavedSession = vi.fn();
    render(
      <SessionPickerModal
        {...defaultProps}
        savedSessionIds={["s1"]}
        onRemoveSavedSession={onRemoveSavedSession}
      />,
    );

    const removeBtn = screen.getByLabelText(/remove saved session s1/i);
    fireEvent.click(removeBtn);

    expect(onRemoveSavedSession).toHaveBeenCalledWith("s1");
  });

  it("has a default export (required for React.lazy)", async () => {
    const mod = await import("./SessionPickerModal");
    expect(mod.default).toBeDefined();
    expect(mod.default).toBe(mod.SessionPickerModal);
  });
});
