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

function groupChildSessions(sessions: ChatSession[]) {
  const groups = new Map<
    string,
    { parentTitle: string; sessions: ChatSession[] }
  >();
  sessions.forEach((session) => {
    const parentId = session.parentId;
    if (!parentId) return;
    const group = groups.get(parentId) || {
      parentTitle: session.parentTitle || parentId,
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(parentId, group);
  });
  return groups;
}

function getRootSessions(sessions: ChatSession[]) {
  return sessions.filter((session) => !session.parentId);
}

interface SessionPillProps {
  session: ChatSession;
  allowRemove?: boolean;
  onSelect: (session: ChatSession) => void;
  onRemoveSavedSession: (sessionId: string) => void;
}

const SessionPill: React.FC<SessionPillProps> = ({
  session,
  allowRemove = false,
  onSelect,
  onRemoveSavedSession,
}) => (
  <div className="session-pill">
    <button
      type="button"
      className="session-pill-select"
      title={session.title}
      onClick={() => onSelect(session)}
    >
      <span className="session-pill-id">{session.id}</span>
      <span className="session-pill-title">{session.title}</span>
      {session.parentId && (
        <span className="session-pill-parent">
          Child of {session.parentTitle || session.parentId}
        </span>
      )}
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

interface ChildSessionGroupSectionProps {
  groups: Map<string, { parentTitle: string; sessions: ChatSession[] }>;
  onSelect: (session: ChatSession) => void;
  onRemoveSavedSession: (sessionId: string) => void;
}

const ChildSessionGroupSection: React.FC<ChildSessionGroupSectionProps> = ({
  groups,
  onSelect,
  onRemoveSavedSession,
}) => {
  if (groups.size === 0) return null;
  return (
    <section className="session-child-groups" aria-label="Child sessions">
      <h3>Child sessions</h3>
      {[...groups].map(([parentId, group]) => (
        <div className="session-child-group" key={parentId}>
          <h4>Children of {group.parentTitle}</h4>
          {group.sessions.map((session) => (
            <SessionPill
              key={session.id}
              session={session}
              onSelect={onSelect}
              onRemoveSavedSession={onRemoveSavedSession}
            />
          ))}
        </div>
      ))}
    </section>
  );
};

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
  const regularRoots = getRootSessions(regularSessions);
  const childGroups = groupChildSessions(regularSessions);

  return (
    <Modal open={open} title="Choose a session" onClose={onClose}>
      {loading && (
        <div
          className="loading-indicator"
          role="status"
          aria-label="Loading sessions"
        >
          <div className="loading-spinner"></div>
        </div>
      )}
      {error && <div className="alert">{error}</div>}
      {!loading && (
        <div className="session-list">
          {savedSessions.map((session) => (
            <SessionPill
              key={session.id}
              session={session}
              allowRemove
              onSelect={onSelect}
              onRemoveSavedSession={onRemoveSavedSession}
            />
          ))}
          {savedSessions.length > 0 && regularSessions.length > 0 && (
            <div className="session-list-divider" aria-hidden="true" />
          )}
          {regularRoots.map((session) => (
            <SessionPill
              key={session.id}
              session={session}
              onSelect={onSelect}
              onRemoveSavedSession={onRemoveSavedSession}
            />
          ))}
          <ChildSessionGroupSection
            groups={childGroups}
            onSelect={onSelect}
            onRemoveSavedSession={onRemoveSavedSession}
          />
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

export default SessionPickerModal;
