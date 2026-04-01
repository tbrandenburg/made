import React, { useMemo } from "react";
import { Panel } from "../components/Panel";
import "../styles/page.css";
import {
  getHistoryKindLabel,
  getNavigationHistory,
} from "../utils/navigationHistory";

const QUICK_LINKS = [
  {
    title: "Dashboard",
    description: "Monitor all projects and agent activity at a glance.",
    to: "/dashboard",
  },
  {
    title: "Repositories",
    description: "Browse and collaborate on repositories.",
    to: "/repositories",
  },
  {
    title: "Knowledge Base",
    description: "Manage global artefacts and documentation.",
    to: "/knowledge",
  },
  {
    title: "Constitution",
    description: "Review rules, guidelines and constraints.",
    to: "/constitutions",
  },
  {
    title: "Settings",
    description: "Configure MADE preferences and integrations.",
    to: "/settings",
  },
];

export const HomePage: React.FC = () => {
  const history = useMemo(() => getNavigationHistory(), []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Mobile Agentic Development Environment</h1>
        <p>
          Coordinate human engineers and autonomous agents to cultivate
          repositories.
        </p>
      </header>
      <div className="panel-grid">
        {QUICK_LINKS.map((link) => (
          <Panel key={link.title} title={link.title} to={link.to}>
            <p>{link.description}</p>
          </Panel>
        ))}
      </div>

      <section className="history-section">
        <h2>Recent history</h2>
        {history.length === 0 ? (
          <p className="meta-secondary">
            No visited repositories, tasks, knowledge artefacts, or
            constitutions yet.
          </p>
        ) : (
          <div className="panel-grid">
            {history.map((entry) => (
              <Panel
                key={entry.id}
                title={entry.name}
                to={entry.path}
                className="history-panel"
              >
                <p>{getHistoryKindLabel(entry.kind)}</p>
                <p className="meta-secondary">
                  {new Date(entry.visitedAt).toLocaleString()}
                </p>
              </Panel>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
