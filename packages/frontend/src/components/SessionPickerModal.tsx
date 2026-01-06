import React from "react";
import { ChatSession } from "../hooks/useApi";
import { Modal } from "./Modal";

interface SessionPickerModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  sessions: ChatSession[];
  onClose: () => void;
  onSelect: (session: ChatSession) => void;
}

export const SessionPickerModal: React.FC<SessionPickerModalProps> = ({
  open,
  loading,
  error,
  sessions,
  onClose,
  onSelect,
}) => {
  return (
    <Modal open={open} title="Choose a session" onClose={onClose}>
      {loading && <p>Loading sessions...</p>}
      {error && <div className="alert">{error}</div>}
      {!loading && (
        <div className="session-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              className="session-pill"
              onClick={() => onSelect(session)}
            >
              <span className="session-pill-id">{session.id}</span>
              <span className="session-pill-title">{session.title}</span>
              <span className="session-pill-date">{session.updated}</span>
            </button>
          ))}
          {!sessions.length && !error && <p className="muted">No sessions available.</p>}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
};
