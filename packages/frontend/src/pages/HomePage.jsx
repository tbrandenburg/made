import React from 'react';
import { Link } from 'react-router-dom';

const tiles = [
  { title: 'Dashboard', description: 'Statistics and monitoring of your MADE system.', to: '/dashboard' },
  { title: 'Repositories', description: 'Browse and collaborate with agents on codebases.', to: '/repositories' },
  { title: 'Knowledge Base', description: 'Centralised artefacts for all MADE projects.', to: '/knowledge' },
  { title: 'Constitution', description: 'Global rules, guidelines and constraints.', to: '/constitutions' },
  { title: 'Settings', description: 'Configure workspace, agents and preferences.', to: '/settings' }
];

export default function HomePage() {
  return (
    <div className="page">
      <header className="page-header">
        <h2>Welcome to MADE</h2>
        <p>The Mobile Agentic Development Environment for multi-agent collaboration on your repositories.</p>
      </header>
      <div className="tile-grid">
        {tiles.map((tile) => (
          <Link key={tile.title} to={tile.to} className="panel tile">
            <h3>{tile.title}</h3>
            <p>{tile.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
