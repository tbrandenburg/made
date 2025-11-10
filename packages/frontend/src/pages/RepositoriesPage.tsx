import React, { useEffect, useState } from 'react';
import { api, RepositorySummary } from '../hooks/useApi';
import { Panel } from '../components/Panel';
import { TabView } from '../components/TabView';
import { Modal } from '../components/Modal';
import '../styles/page.css';

export const RepositoriesPage: React.FC = () => {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [activeTab, setActiveTab] = useState('repositories');
  const [createOpen, setCreateOpen] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadRepositories = () => {
    api
      .listRepositories()
      .then((res) => setRepositories(res.repositories))
      .catch((err) => {
        console.error('Failed to load repositories', err);
        setError('Unable to load repositories');
      });
  };

  useEffect(() => {
    loadRepositories();
  }, []);

  const handleCreate = async () => {
    if (!newRepoName.trim()) {
      setError('Repository name cannot be empty');
      return;
    }
    try {
      await api.createRepository(newRepoName.trim());
      setCreateOpen(false);
      setNewRepoName('');
      setError(null);
      loadRepositories();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create repository');
    }
  };

  return (
    <div className="page">
      <h1>Repositories</h1>
      <TabView
        tabs={[
          {
            id: 'repositories',
            label: 'Repositories',
            content: (
              <>
                <div className="button-bar">
                  <button className="primary" onClick={() => setCreateOpen(true)}>
                    Create Repository
                  </button>
                </div>
                {error && <div className="alert">{error}</div>}
                <div className="panel-column">
                  {repositories.map((repo) => (
                    <Panel key={repo.name} title={repo.name} to={`/repositories/${repo.name}`}>
                      <div className="metadata">
                        <span className={`badge ${repo.hasGit ? 'success' : 'warning'}`}>
                          {repo.hasGit ? 'Git' : 'No Git'}
                        </span>
                        <span className="badge">{repo.technology}</span>
                        <span className="badge">{repo.license}</span>
                      </div>
                      <div className="meta-secondary">
                        Last commit: {repo.lastCommit ? new Date(repo.lastCommit).toLocaleString() : '—'}
                      </div>
                    </Panel>
                  ))}
                  {repositories.length === 0 && <div className="empty">No repositories yet.</div>}
                </div>
              </>
            )
          }
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <Modal open={createOpen} title="Create Repository" onClose={() => setCreateOpen(false)}>
        <div className="form-group">
          <label htmlFor="repository-name">Repository Name</label>
          <input
            id="repository-name"
            value={newRepoName}
            onChange={(event) => setNewRepoName(event.target.value)}
            placeholder="my-repository"
          />
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setCreateOpen(false)}>
            Cancel
          </button>
          <button className="primary" onClick={handleCreate}>
            Create &amp; Init Git
          </button>
        </div>
      </Modal>
    </div>
  );
};
