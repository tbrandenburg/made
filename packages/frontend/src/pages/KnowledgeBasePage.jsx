import React from 'react';
import { Link } from 'react-router-dom';

export default function KnowledgeBasePage({ artefacts }) {
  return (
    <div className="page">
      <div className="tab-view single">
        <div className="tab-toolbar">
          <button className="primary" onClick={() => alert('Open artefact creation dialogue (mock)')}>
            Create new artefact
          </button>
        </div>
        <div className="tab-content">
          <div className="panel-grid">
            {artefacts.map((artefact) => (
              <Link
                to={`/knowledge/${encodeURIComponent(artefact.name)}`}
                className="panel"
                key={artefact.name}
              >
                <h3>{artefact.name}</h3>
                <div className="badges">
                  <span className="badge neutral">{artefact.type}</span>
                  {artefact.tags.map((tag) => (
                    <span key={tag} className="badge info">{tag}</span>
                  ))}
                </div>
                <p className="muted">{artefact.body.slice(0, 120)}...</p>
              </Link>
            ))}
            {artefacts.length === 0 && (
              <div className="panel">
                <p>No artefacts found in .made/knowledge.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
