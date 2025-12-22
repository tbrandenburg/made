import React, { useEffect, useState } from "react";
import { api, RepositorySummary } from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import "../styles/page.css";

export const RepositoriesPage: React.FC = () => {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [activeTab, setActiveTab] = useState("repositories");
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [alert, setAlert] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadRepositories = () => {
    api
      .listRepositories()
      .then((res) => setRepositories(res.repositories))
      .catch((err) => {
        console.error("Failed to load repositories", err);
        setAlert({ type: "error", message: "Unable to load repositories" });
      });
  };

  useEffect(() => {
    loadRepositories();
  }, []);

  const handleCreate = async () => {
    if (!newRepoName.trim()) {
      setAlert({ type: "error", message: "Repository name cannot be empty" });
      return;
    }
    try {
      await api.createRepository(newRepoName.trim());
      setCreateOpen(false);
      setNewRepoName("");
      setAlert({ type: "success", message: "Repository created successfully" });
      loadRepositories();
    } catch (e) {
      setAlert({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to create repository",
      });
    }
  };

  const handleClone = async () => {
    const trimmedUrl = cloneUrl.trim();
    const trimmedName = cloneName.trim();
    if (!trimmedUrl) {
      setAlert({ type: "error", message: "Repository URL cannot be empty" });
      setCloneOpen(false);
      return;
    }
    setIsCloning(true);
    try {
      await api.cloneRepository(trimmedUrl, trimmedName || undefined);
      setAlert({ type: "success", message: "Repository cloned successfully" });
      setCloneOpen(false);
      setCloneUrl("");
      setCloneName("");
      loadRepositories();
    } catch (e) {
      setCloneOpen(false);
      setAlert({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to clone repository",
      });
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div className="page">
      <h1>Repositories</h1>
      <TabView
        tabs={[
          {
            id: "repositories",
            label: "Repositories",
            content: (
              <>
                <div className="button-bar">
                  <button
                    className="primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    Create Repository
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setCloneOpen(true)}
                  >
                    Clone Repository
                  </button>
                </div>
                {alert && (
                  <div className={`alert ${alert.type}`}>{alert.message}</div>
                )}
                <div className="panel-column">
                  {repositories.map((repo) => (
                    <Panel
                      key={repo.name}
                      title={repo.name}
                      to={`/repositories/${repo.name}`}
                    >
                      <div className="metadata">
                        <span
                          className={`badge ${repo.hasGit ? "success" : "warning"}`}
                        >
                          {repo.hasGit ? "Git" : "No Git"}
                        </span>
                        <span className="badge">{repo.technology}</span>
                        <span className="badge">{repo.license}</span>
                      </div>
                      <div className="meta-secondary">
                        Last commit:{" "}
                        {repo.lastCommit
                          ? new Date(repo.lastCommit).toLocaleString()
                          : "—"}
                      </div>
                    </Panel>
                  ))}
                  {repositories.length === 0 && (
                    <div className="empty">No repositories yet.</div>
                  )}
                </div>
              </>
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <Modal
        open={createOpen}
        title="Create Repository"
        onClose={() => setCreateOpen(false)}
      >
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
      <Modal
        open={cloneOpen}
        title="Clone Repository"
        onClose={() => {
          if (!isCloning) setCloneOpen(false);
        }}
      >
        <div className="form-group">
          <label htmlFor="repository-url">Repository URL</label>
          <input
            id="repository-url"
            value={cloneUrl}
            onChange={(event) => setCloneUrl(event.target.value)}
            placeholder="https://github.com/owner/repo.git"
          />
        </div>
        <div className="form-group">
          <label htmlFor="repository-name-clone">Folder Name (optional)</label>
          <input
            id="repository-name-clone"
            value={cloneName}
            onChange={(event) => setCloneName(event.target.value)}
            placeholder="custom-folder-name"
          />
        </div>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setCloneOpen(false)}
            disabled={isCloning}
          >
            Cancel
          </button>
          <button
            className="primary"
            onClick={handleClone}
            disabled={isCloning}
          >
            {isCloning ? "Cloning..." : "Clone"}
          </button>
        </div>
      </Modal>
    </div>
  );
};
