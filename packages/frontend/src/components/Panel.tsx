import React from "react";
import { Link } from "react-router-dom";
import "../styles/panel.css";

interface PanelProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  to?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

export const Panel: React.FC<PanelProps> = ({
  title,
  actions,
  children,
  to,
  onClick,
}) => {
  const content = (
    <>
      {(title || actions) && (
        <header className="panel-header">
          <h3>{title}</h3>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="panel panel-link" onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <section className="panel" onClick={onClick}>
      {content}
    </section>
  );
};
