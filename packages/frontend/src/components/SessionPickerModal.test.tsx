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

    expect(screen.getByRole("status")).toBeInTheDocument();
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

  it("groups children by parent and selects the child's own session", () => {
    const child: ChatSession = {
      id: "ses_child",
      title: "Child session",
      updated: "2024-01-03",
      parentId: "ses_parent",
      parentTitle: "Parent session",
    };
    const parent: ChatSession = {
      id: "ses_parent",
      title: "Parent session",
      updated: "2024-01-02",
    };
    const onSelect = vi.fn();
    render(
      <SessionPickerModal
        {...defaultProps}
        sessions={[parent, child]}
        onSelect={onSelect}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Child sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Children of Parent session" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Child of Parent session")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Child session"));
    expect(onSelect).toHaveBeenCalledWith(child);
  });

  it("shows a saved child once with its own remove action", () => {
    const child: ChatSession = {
      id: "ses_child",
      title: "Child session",
      updated: "2024-01-03",
      parentId: "ses_parent",
      parentTitle: "Parent session",
    };
    const parent: ChatSession = {
      id: "ses_parent",
      title: "Parent session",
      updated: "2024-01-02",
    };
    const onSelect = vi.fn();
    const onRemoveSavedSession = vi.fn();
    render(
      <SessionPickerModal
        {...defaultProps}
        sessions={[parent, child]}
        savedSessionIds={[child.id]}
        onSelect={onSelect}
        onRemoveSavedSession={onRemoveSavedSession}
      />,
    );

    expect(screen.getAllByTitle("Child session")).toHaveLength(1);
    fireEvent.click(screen.getByTitle("Child session"));
    fireEvent.click(screen.getByLabelText("Remove saved session ses_child"));
    expect(onSelect).toHaveBeenCalledWith(child);
    expect(onRemoveSavedSession).toHaveBeenCalledWith(child.id);
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
