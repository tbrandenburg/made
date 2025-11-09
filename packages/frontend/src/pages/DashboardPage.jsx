import React from 'react';

export default function DashboardPage({ repositories }) {
  const projectCount = repositories?.length || 0;
  const agentConnected = true; // mocked connection status
  return (
    <div className="page">
      <div className="tab-view single">
        <div className="tab-content">
          <div className="panel">
            <div className="panel-header">
              <h3>Statistics</h3>
            </div>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-label">Project Count</span>
                <span className="stat-value">{projectCount}</span>
              </div>
            </div>
            <div className="monitoring">
              <h4>Agent-2-Agent connection</h4>
              <div className={`status-light ${agentConnected ? 'ok' : 'error'}`}></div>
              <span>{agentConnected ? 'Connection established' : 'Connection lost'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
