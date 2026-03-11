import React from "react";
import { createPortal } from "react-dom";
import "../styles/modal.css";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  onClose,
  children,
  className,
}) => {
  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal${className ? ` ${className}` : ""}`}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
