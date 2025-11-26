import React from "react";
import { Panel } from "../components/Panel";
import "../styles/page.css";

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
    </div>
  );
};
