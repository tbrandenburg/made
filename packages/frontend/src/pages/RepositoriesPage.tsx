import React, { useEffect, useState } from "react";
import { api, RepositorySummary } from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import { DiamondIcon } from "../components/icons/DiamondIcon";
import { TrashIcon } from "../components/icons/TrashIcon";
import "../styles/page.css";

export const RepositoriesPage: React.FC = () => {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [activeTab, setActiveTab] = useState("repositories");
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneBranch, setCloneBranch] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [isRemovingWorktree, setIsRemovingWorktree] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const [templateModal, setTemplateModal] = useState<{
    open: boolean;
    repoName: string | null;
  }>({ open: false, repoName: null });
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [templateResult, setTemplateResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [removeWorktreeModal, setRemoveWorktreeModal] = useState<{
    open: boolean;
    name: string | null;
  }>({ open: false, name: null });
  const [deleteRepositoryModal, setDeleteRepositoryModal] = useState<{
    open: boolean;
    name: string | null;
  }>({ open: false, name: null });
  const [isDeletingRepository, setIsDeletingRepository] = useState(false);
  const [alert, setAlert] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const sortRepositoriesByName = (
    items: RepositorySummary[],
  ): RepositorySummary[] =>
    [...items].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

  const loadRepositories = () => {
    api
      .listRepositories()
      .then((res) => setRepositories(sortRepositoriesByName(res.repositories)))
      .catch((err) => {
        console.error("Failed to load repositories", err);
        setAlert({ type: "error", message: "Unable to load repositories" });
      });
  };

  useEffect(() => {
    loadRepositories();
  }, []);

  const openTemplateModal = async (repoName: string) => {
    setTemplateModal({ open: true, repoName });
    setTemplateResult(null);
    setIsApplyingTemplate(false);
    try {
      const response = await api.listRepositoryTemplates();
      setTemplates(response.templates);
    } catch (error) {
      console.error("Failed to load templates", error);
      setTemplates([]);
      setTemplateResult({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to load templates",
      });
    }
  };

  const closeTemplateModal = () => {
    if (isApplyingTemplate) return;
    setTemplateModal({ open: false, repoName: null });
    setTemplateResult(null);
  };

  const handleApplyTemplate = async (templateName: string) => {
    if (!templateModal.repoName || isApplyingTemplate) return;
    setIsApplyingTemplate(true);
    setTemplateResult(null);
    try {
      await api.applyRepositoryTemplate(templateModal.repoName, templateName);
      setTemplateResult({
        type: "success",
        message: `Template '${templateName}' applied successfully.`,
      });
    } catch (error) {
      setTemplateResult({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to apply template",
      });
    } finally {
      setIsApplyingTemplate(false);
    }
  };

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

  const handleRemoveWorktree = async () => {
    if (!removeWorktreeModal.name) return;

    setIsRemovingWorktree(true);
    try {
      await api.removeRepositoryWorktree(removeWorktreeModal.name);
      setAlert({ type: "success", message: "Worktree removed successfully" });
      setRemoveWorktreeModal({ open: false, name: null });
      loadRepositories();
    } catch (error) {
      setAlert({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to remove worktree",
      });
    } finally {
      setIsRemovingWorktree(false);
    }
  };

  const handleDeleteRepository = async () => {
    if (!deleteRepositoryModal.name) return;
    setIsDeletingRepository(true);
    try {
      await api.deleteRepository(deleteRepositoryModal.name);
      setAlert({ type: "success", message: "Repository deleted successfully" });
      setDeleteRepositoryModal({ open: false, name: null });
      loadRepositories();
    } catch (error) {
      setAlert({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to delete repository",
      });
    } finally {
      setIsDeletingRepository(false);
    }
  };
  const handleClone = async () => {
    const trimmedUrl = cloneUrl.trim();
    const trimmedName = cloneName.trim();
    const trimmedBranch = cloneBranch.trim();
    if (!trimmedUrl) {
      setAlert({ type: "error", message: "Repository URL cannot be empty" });
      setCloneOpen(false);
      return;
    }
    setIsCloning(true);
    try {
      await api.cloneRepository(
        trimmedUrl,
        trimmedName || undefined,
        trimmedBranch || undefined,
      );
      setAlert({ type: "success", message: "Repository cloned successfully" });
      setCloneOpen(false);
      setCloneUrl("");
      setCloneName("");
      setCloneBranch("");
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
                      className={
                        repo.isWorktreeChild ? "worktree-child-pill" : undefined
                      }
                      actions={
                        <div className="repo-panel-actions">
                          <button
                            type="button"
                            className="copy-button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openTemplateModal(repo.name);
                            }}
                            aria-label={`Apply template to ${repo.name}`}
                            title={`Apply template to ${repo.name}`}
                          >
                            <DiamondIcon />
                          </button>
                          {repo.isWorktreeChild ? (
                            <button
                              type="button"
                              className="copy-button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setRemoveWorktreeModal({
                                  open: true,
                                  name: repo.name,
                                });
                              }}
                              aria-label={`Remove ${repo.name} worktree`}
                              title={`Remove ${repo.name} worktree`}
                            >
                              <TrashIcon />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="copy-button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setDeleteRepositoryModal({
                                open: true,
                                name: repo.name,
                              });
                            }}
                            aria-label={`Delete repository ${repo.name}`}
                            title={`Delete repository ${repo.name}`}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      }
                    >
                      <div className="metadata">
                        <span
                          className={`badge ${repo.hasGit ? "success" : "warning"}`}
                        >
                          {repo.hasGit ? "Git" : "No Git"}
                        </span>
                        <span className="badge">{repo.technology}</span>
                        <span className="badge">{repo.license}</span>
                        {repo.hasGit && repo.branch && (
                          <span className="badge">{repo.branch}</span>
                        )}
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
        <div className="form-group">
          <label htmlFor="repository-branch-clone">Branch (optional)</label>
          <input
            id="repository-branch-clone"
            value={cloneBranch}
            onChange={(event) => setCloneBranch(event.target.value)}
            placeholder="main"
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
      <Modal
        open={templateModal.open}
        title={
          templateModal.repoName
            ? `Apply Template: ${templateModal.repoName}`
            : "Apply Template"
        }
        onClose={closeTemplateModal}
      >
        {templateResult && (
          <div className={`alert ${templateResult.type}`}>
            {templateResult.message}
          </div>
        )}
        <div className="repo-template-grid">
          {templates.length === 0 ? (
            <div className="empty">No templates found.</div>
          ) : (
            templates.map((templateName) => (
              <button
                key={templateName}
                type="button"
                className="primary"
                disabled={isApplyingTemplate}
                onClick={() => handleApplyTemplate(templateName)}
              >
                {templateName}
              </button>
            ))
          )}
        </div>
      </Modal>
      <Modal
        open={deleteRepositoryModal.open}
        title="Delete Repository"
        onClose={() => {
          if (!isDeletingRepository) {
            setDeleteRepositoryModal({ open: false, name: null });
          }
        }}
      >
        <p>
          Are you sure you want to delete repository
          {deleteRepositoryModal.name ? ` ${deleteRepositoryModal.name}` : ""}?
        </p>
        <p className="muted">This action cannot be undone.</p>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setDeleteRepositoryModal({ open: false, name: null })}
            disabled={isDeletingRepository}
          >
            Cancel
          </button>
          <button
            className="danger"
            onClick={handleDeleteRepository}
            disabled={isDeletingRepository}
          >
            {isDeletingRepository ? "Deleting..." : "Delete"}
          </button>
        </div>
      </Modal>
      <Modal
        open={removeWorktreeModal.open}
        title="Remove Worktree"
        onClose={() => {
          if (!isRemovingWorktree) {
            setRemoveWorktreeModal({ open: false, name: null });
          }
        }}
      >
        <p>
          Are you sure you want to remove worktree
          {removeWorktreeModal.name ? ` ${removeWorktreeModal.name}` : ""}?
        </p>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setRemoveWorktreeModal({ open: false, name: null })}
            disabled={isRemovingWorktree}
          >
            Cancel
          </button>
          <button
            className="primary"
            onClick={handleRemoveWorktree}
            disabled={isRemovingWorktree}
          >
            {isRemovingWorktree ? "Removing..." : "Remove"}
          </button>
        </div>
      </Modal>
    </div>
  );
};
