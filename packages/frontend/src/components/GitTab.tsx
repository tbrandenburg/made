import React, { useState } from "react";
import { Panel } from "./Panel";
import { Modal } from "./Modal";
import { RepositoryGitStatus } from "../hooks/useApi";

type GitTabProps = {
  status: RepositoryGitStatus | null;
  loading: boolean;
  error: string | null;
  pulling: boolean;
  creatingWorktree: boolean;
  onRefresh: () => void;
  onPull: () => void;
  onCreateWorktree: (directoryName: string, branchName: string) => void;
  onOpenFile: (path: string) => void;
};

const formatDate = (value: string | null) => {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
};

const renderMaybeLink = (count: number | null, href: string | null, label: string) => {
  const content = `${count ?? 0}`;
  if (!href) return content;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {content} {label}
    </a>
  );
};

export const GitTab: React.FC<GitTabProps> = ({
  status,
  loading,
  error,
  pulling,
  creatingWorktree,
  onRefresh,
  onPull,
  onCreateWorktree,
  onOpenFile,
}) => {
  const [worktreeModalOpen, setWorktreeModalOpen] = useState(false);
  const [directoryName, setDirectoryName] = useState("");
  const [branchName, setBranchName] = useState("");

  const lastCommitLabel = status?.lastCommit.id
    ? status.lastCommit.id.slice(0, 8)
    : "Unknown";

  return (
    <div className="command-center">
      <Panel
        title="Status"
        actions={
          <button className="secondary" onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
        }
      >
        {loading && <div className="alert">Loading git status...</div>}
        {error && <div className="alert error">{error}</div>}
        {!loading && !error && status && (
          <table className="git-table">
            <tbody>
              <tr><th>Branch</th><td>{status.branch || "Unknown"}</td></tr>
              <tr><th>Commits ahead/behind</th><td>{status.aheadBehind.ahead}/{status.aheadBehind.behind}</td></tr>
              <tr><th>Line Stats</th><td>{status.lineStats.green} / {status.lineStats.red}</td></tr>
              <tr>
                <th>Last Commit</th>
                <td>
                  {formatDate(status.lastCommit.date)} ({status.links.commit ? (
                    <a href={status.links.commit} target="_blank" rel="noreferrer">{lastCommitLabel}</a>
                  ) : lastCommitLabel})
                </td>
              </tr>
              <tr><th>Issues</th><td>{renderMaybeLink(status.counts.issues, status.links.issues, "open")}</td></tr>
              <tr><th>Pull Requests</th><td>{renderMaybeLink(status.counts.pullRequests, status.links.pulls, "open")}</td></tr>
              <tr><th>Branches</th><td>{renderMaybeLink(status.counts.branches, status.links.branches, "total")}</td></tr>
              <tr><th>Worktrees</th><td>{renderMaybeLink(status.counts.worktrees, status.links.branches, "total")}</td></tr>
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Diff">
        {!status || status.diff.length === 0 ? (
          <div className="empty">No local changes.</div>
        ) : (
          <table className="git-table">
            <tbody>
              {status.diff.map((entry) => (
                <tr key={entry.path}>
                  <td>
                    <button className="link-button" onClick={() => onOpenFile(entry.path)}>
                      {entry.path}
                    </button>
                  </td>
                  <td className="git-added">+{entry.green}</td>
                  <td className="git-removed">-{entry.red}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Management">
        <div className="button-bar">
          <button className="primary" onClick={onPull} disabled={pulling}>Pull</button>
          <button className="secondary" onClick={() => setWorktreeModalOpen(true)}>
            Create worktree
          </button>
        </div>
      </Panel>

      <Modal
        open={worktreeModalOpen}
        title="Create Worktree"
        onClose={() => setWorktreeModalOpen(false)}
      >
        <div className="form-group">
          <label htmlFor="worktree-directory">Directory name</label>
          <input
            id="worktree-directory"
            value={directoryName}
            onChange={(event) => setDirectoryName(event.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="worktree-branch">Branch name</label>
          <input
            id="worktree-branch"
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
          />
        </div>
        <div className="button-bar">
          <button
            className="primary"
            disabled={!directoryName.trim() || !branchName.trim() || creatingWorktree}
            onClick={() => {
              onCreateWorktree(directoryName.trim(), branchName.trim());
              setWorktreeModalOpen(false);
              setDirectoryName("");
              setBranchName("");
            }}
          >
            Create
          </button>
        </div>
      </Modal>
    </div>
  );
};
