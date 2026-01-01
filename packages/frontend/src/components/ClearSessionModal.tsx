import React from "react";
import { Modal } from "./Modal";

interface ClearSessionModalProps {
  open: boolean;
  onCancel: () => void;
  onClearSessionOnly: () => void;
  onClearSessionAndHistory: () => void;
}

export const ClearSessionModal: React.FC<ClearSessionModalProps> = ({
  open,
  onCancel,
  onClearSessionOnly,
  onClearSessionAndHistory,
}) => {
  return (
    <Modal open={open} title="Clear session" onClose={onCancel}>
      <p>Do you also want to clear the chat history for this session?</p>
      <div className="modal-actions">
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="secondary" onClick={onClearSessionOnly}>
          No
        </button>
        <button className="danger" onClick={onClearSessionAndHistory}>
          Yes
        </button>
      </div>
    </Modal>
  );
};
