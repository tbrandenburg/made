import React from "react";
import { ChatSession } from "../hooks/useApi";
import { Modal } from "./Modal";
import { TrashIcon } from "./icons/TrashIcon";

interface SessionPickerModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  sessions: ChatSession[];
  savedSessionIds: string[];
  savedSessionTitles?: Record<string, string>;
  onClose: () => void;
  onSelect: (session: ChatSession) => void;
  onRemoveSavedSession: (sessionId: string) => void;
}

export const SessionPickerModal: React.FC<SessionPickerModalProps> = ({
  open,
  loading,
  error,
  sessions,
  savedSessionIds,
  savedSessionTitles = {},
  onClose,
  onSelect,
  onRemoveSavedSession,
}) => {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const savedSessions = savedSessionIds
    .map(
      (id) =>
        sessionById.get(id) || {
          id,
          title: savedSessionTitles[id] || "Saved session",
          updated: "Not in recent sessions",
        },
    )
    .filter(
      (session, index, list) =>
        list.findIndex((candidate) => candidate.id === session.id) === index,
    );
  const regularSessions = sessions.filter(
    (session) => !savedSessionIds.includes(session.id),
  );

  const renderSessionPill = (session: ChatSession, allowRemove = false) => (
    <div key={session.id} className="session-pill">
      <button
        type="button"
        className="session-pill-select"
        title={session.title}
        onClick={() => onSelect(session)}
      >
        <span className="session-pill-id">{session.id}</span>
        <span className="session-pill-title">{session.title}</span>
        <span className="session-pill-date">{session.updated}</span>
      </button>
      {allowRemove && (
        <button
          type="button"
          className="icon-button-small session-pill-remove"
          aria-label={`Remove saved session ${session.id}`}
          title="Remove saved session"
          onClick={() => onRemoveSavedSession(session.id)}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );

  return (
    <Modal open={open} title="Choose a session" onClose={onClose}>
      {loading && <p>Loading sessions...</p>}
      {error && <div className="alert">{error}</div>}
      {!loading && (
        <div className="session-list">
          {savedSessions.map((session) => renderSessionPill(session, true))}
          {savedSessions.length > 0 && regularSessions.length > 0 && (
            <div className="session-list-divider" aria-hidden="true" />
          )}
          {regularSessions.map((session) => renderSessionPill(session))}
          {!savedSessions.length && !regularSessions.length && !error && (
            <p className="muted">No sessions available.</p>
          )}
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
