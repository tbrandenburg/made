import React from 'react';
import { Link } from 'react-router-dom';

export default function RepositoriesPage({ repositories, onCreateRepository }) {
  return (
    <div className="page">
      <div className="tab-view single">
        <div className="tab-toolbar">
          <button className="primary" onClick={onCreateRepository}>Create repository</button>
        </div>
        <div className="tab-content">
          {repositories.length === 0 && (
            <div className="panel">
              <p>No repositories found. Create one to get started.</p>
            </div>
          )}
          <div className="panel-grid">
            {repositories.map((repo) => (
              <Link to={`/repositories/${repo.name}`} className="panel" key={repo.name}>
                <h3>{repo.name}</h3>
                <div className="badges">
                  <span className={`badge ${repo.hasGit ? 'success' : 'warning'}`}>
                    {repo.hasGit ? 'Git' : 'No Git'}
                  </span>
                  <span className="badge neutral">{repo.tech}</span>
                  <span className="badge neutral">{repo.license}</span>
                </div>
                <p className="muted">Last commit: {repo.lastCommit || 'n/a'}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
