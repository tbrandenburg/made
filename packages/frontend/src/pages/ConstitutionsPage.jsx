import React from 'react';
import { Link } from 'react-router-dom';

export default function ConstitutionsPage({ constitutions }) {
  return (
    <div className="page">
      <div className="tab-view single">
        <div className="tab-toolbar">
          <button className="primary" onClick={() => alert('Open constitution creation dialogue (mock)')}>
            Create new constitution
          </button>
        </div>
        <div className="tab-content">
          <div className="panel-grid">
            {constitutions.map((constitution) => (
              <Link
                to={`/constitutions/${encodeURIComponent(constitution.name)}`}
                className="panel"
                key={constitution.name}
              >
                <h3>{constitution.name}</h3>
                <p className="muted">{constitution.body.slice(0, 140)}...</p>
              </Link>
            ))}
            {constitutions.length === 0 && (
              <div className="panel">
                <p>No constitutions found in .made/constitutions.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
