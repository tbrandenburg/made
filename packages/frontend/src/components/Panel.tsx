import React from 'react';
import '../styles/panel.css';

interface PanelProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const Panel: React.FC<PanelProps> = ({ title, actions, children }) => {
  return (
    <section className="panel">
      {(title || actions) && (
        <header className="panel-header">
          <h3>{title}</h3>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
};
