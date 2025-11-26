import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import { api, FileNode, RepositorySummary } from "../hooks/useApi";
import "../styles/page.css";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
}

const PUBLISHMENT_ACTIONS = [
  {
    id: "init",
    label: "Initialize Repository",
    prompt: "Please initialise this repository with sensible defaults.",
  },
  {
    id: "remote",
    label: "Create Remote Repository",
    prompt: "Create a remote repository and connect it to this project.",
  },
  {
    id: "pr",
    label: "Create Pull Request",
    prompt: "Draft a pull request with the latest repository changes.",
  },
  {
    id: "deploy",
    label: "Deploy",
    prompt: "Prepare deployment steps for this project.",
  },
  {
    id: "preview",
    label: "Preview",
    prompt: "Create a preview build for review.",
  },
  {
    id: "publish",
    label: "Publish",
    prompt: "Publish the project to the designated target.",
  },
];

export const RepositoryPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("agent");
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["."]));
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorStatus, setEditorStatus] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [renameModal, setRenameModal] = useState<{
    open: boolean;
    from: string | null;
  }>({ open: false, from: null });
  const [moveModal, setMoveModal] = useState<{
    open: boolean;
    from: string | null;
  }>({ open: false, from: null });
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    target: string | null;
  }>({ open: false, target: null });
  const [newFilePath, setNewFilePath] = useState("");
  const [renamePath, setRenamePath] = useState("");
  const [movePath, setMovePath] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    if (!name) {
      navigate("/repositories");
      return;
    }
    api
      .getRepository(name)
      .then(setRepository)
      .catch((error) => {
        console.error("Failed to load repository", error);
      });
    api
      .getRepositoryFiles(name)
      .then((tree) => setFileTree(tree))
      .catch((error) => console.error("Failed to load file tree", error));
  }, [name, navigate]);

  const toggleFolder = (pathId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pathId)) {
        next.delete(pathId);
      } else {
        next.add(pathId);
      }
      return next;
    });
  };

  const openFile = async (filePath: string) => {
    if (!name) return;
    setLoadingFile(true);
    try {
      const response = await api.readRepositoryFile(name, filePath);
      setSelectedFile(filePath);
      setEditorContent(response.content);
      setEditorStatus(null);
      setActiveTab("editor");
    } catch (error) {
      console.error("Failed to open file", error);
      setEditorStatus("Unable to open file");
    } finally {
      setLoadingFile(false);
    }
  };

  const refreshFiles = () => {
    if (!name) return;
    api
      .getRepositoryFiles(name)
      .then((tree) => setFileTree(tree))
      .catch((error) => console.error("Failed to load file tree", error));
  };

  const handleSendMessage = async (prompt?: string) => {
    if (!name) return;
    const message = (prompt ?? pendingPrompt).trim();
    if (!message) return;
    const timestamp = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `${timestamp}-user`,
      role: "user",
      text: message,
      timestamp,
    };
    setChat((prev) => [...prev, userMessage]);
    setPendingPrompt("");
    try {
      const reply = await api.sendAgentMessage(name, message);
      setChat((prev) => [
        ...prev,
        {
          id: reply.messageId,
          role: "agent",
          text: reply.response,
          timestamp: reply.sent,
        },
      ]);
      setChatError(null);
      setActiveTab("agent");
    } catch (error) {
      setChatError("Failed to reach agent");
      console.error("Failed to send agent message", error);
    }
  };

  const handleSaveFile = async () => {
    if (!name || !selectedFile) return;
    try {
      await api.saveRepositoryFile(name, selectedFile, editorContent);
      setEditorStatus("Saved successfully");
      refreshFiles();
    } catch (error) {
      setEditorStatus("Failed to save file");
      console.error("Failed to save file", error);
    }
  };

  const handleCreateFile = async () => {
    if (!name || !newFilePath.trim()) return;
    try {
      await api.createRepositoryFile(name, newFilePath.trim(), "");
      setCreateModal(false);
      setNewFilePath("");
      refreshFiles();
    } catch (error) {
      console.error("Failed to create file", error);
    }
  };

  const handleRenameFile = async () => {
    if (!name || !renameModal.from || !renamePath.trim()) return;
    try {
      await api.renameRepositoryFile(name, renameModal.from, renamePath.trim());
      setRenameModal({ open: false, from: null });
      setRenamePath("");
      refreshFiles();
    } catch (error) {
      console.error("Failed to rename file", error);
    }
  };

  const handleMoveFile = async () => {
    if (!name || !moveModal.from || !movePath.trim()) return;
    try {
      await api.renameRepositoryFile(name, moveModal.from, movePath.trim());
      setMoveModal({ open: false, from: null });
      setMovePath("");
      refreshFiles();
    } catch (error) {
      console.error("Failed to move file", error);
    }
  };

  const handleDeleteFile = async () => {
    if (!name || !deleteModal.target) return;
    try {
      await api.deleteRepositoryFile(name, deleteModal.target);
      if (selectedFile === deleteModal.target) {
        setSelectedFile(null);
        setEditorContent("");
      }
      setDeleteModal({ open: false, target: null });
      refreshFiles();
    } catch (error) {
      console.error("Failed to delete file", error);
    }
  };

  const renderNode = (node: FileNode, depth = 0): React.ReactNode => {
    if (node.path === ".") {
      return node.children?.map((child) => renderNode(child, depth));
    }
    const indent = { marginLeft: depth * 16 };
    const isFolder = node.type === "folder";
    const isExpanded = expanded.has(node.path);
    return (
      <div key={node.path} className="file-node" style={indent}>
        <div className="file-row">
          {isFolder ? (
            <button
              className="icon-button"
              onClick={() => toggleFolder(node.path)}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="file-spacer" />
          )}
          <span
            className="file-name"
            onClick={() => !isFolder && openFile(node.path)}
          >
            {node.name}
          </span>
          <div className="file-actions">
            {!isFolder && (
              <button
                className="link-button"
                onClick={() => openFile(node.path)}
              >
                Edit
              </button>
            )}
            <button
              className="link-button"
              onClick={() => {
                setRenamePath(node.path);
                setRenameModal({ open: true, from: node.path });
              }}
            >
              Rename
            </button>
            <button
              className="link-button"
              onClick={() => {
                setMovePath(node.path);
                setMoveModal({ open: true, from: node.path });
              }}
            >
              Move
            </button>
            <button
              className="link-button"
              onClick={() => setDeleteModal({ open: true, target: node.path })}
            >
              Delete
            </button>
          </div>
        </div>
        {isFolder &&
          isExpanded &&
          node.children?.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const tabs = [
    {
      id: "agent",
      label: "Agent",
      content: (
        <Panel title="Agent Collaboration">
          <div className="chat-window">
            {chat.map((message) => (
              <div key={message.id} className={`chat-message ${message.role}`}>
                <div className="chat-meta">
                  {new Date(message.timestamp).toLocaleString()}
                </div>
                <pre>{message.text}</pre>
              </div>
            ))}
            {chat.length === 0 && (
              <div className="empty">No conversation yet.</div>
            )}
          </div>
          {chatError && <div className="alert">{chatError}</div>}
          <textarea
            value={pendingPrompt}
            onChange={(event) => setPendingPrompt(event.target.value)}
            placeholder="Describe the change or ask the agent..."
          />
          <div className="button-bar">
            <button className="primary" onClick={() => handleSendMessage()}>
              Send
            </button>
          </div>
        </Panel>
      ),
    },
    {
      id: "files",
      label: "File Browser",
      content: (
        <>
          <div className="button-bar">
            <button className="primary" onClick={() => setCreateModal(true)}>
              Create File
            </button>
            <button className="secondary" onClick={refreshFiles}>
              Refresh
            </button>
          </div>
          <Panel title={`Files in ${name}`}>
            <div className="file-browser">
              {fileTree ? (
                renderNode(fileTree)
              ) : (
                <div className="empty">No files found.</div>
              )}
            </div>
          </Panel>
        </>
      ),
    },
    {
      id: "editor",
      label: "File Editor",
      content: (
        <div className="editor-grid">
          <Panel
            title={
              selectedFile ? `Editing ${selectedFile}` : "Select a file to edit"
            }
            actions={
              selectedFile && (
                <button
                  className="primary"
                  onClick={handleSaveFile}
                  disabled={loadingFile}
                >
                  Save File
                </button>
              )
            }
          >
            {loadingFile && <div className="alert">Loading file...</div>}
            {editorStatus && (
              <div 
                className={`alert ${
                  editorStatus.includes("successfully") ? "success" : 
                  editorStatus.includes("Failed") || editorStatus.includes("failed") ? "error" : 
                  ""
                }`}
              >
                {editorStatus}
              </div>
            )}
            <textarea
              value={editorContent}
              onChange={(event) => setEditorContent(event.target.value)}
              disabled={!selectedFile}
              className="editor-input"
            />
          </Panel>
          <Panel title="Preview">
            {selectedFile?.endsWith('.md') ? (
              <div
                className="markdown"
                dangerouslySetInnerHTML={{ __html: marked(editorContent || "") }}
              />
            ) : (
              <pre className="preview">{editorContent}</pre>
            )}
          </Panel>
        </div>
      ),
    },
    {
      id: "publishment",
      label: "Publishment",
      content: (
        <Panel title="Publishment Actions">
          <div className="publishment-grid">
            {PUBLISHMENT_ACTIONS.map((action) => (
              <button
                key={action.id}
                className="primary"
                onClick={() => {
                  handleSendMessage(action.prompt);
                  setActiveTab("agent");
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </Panel>
      ),
    },
  ];

  return (
    <div className="page">
      <h1>Repository: {name}</h1>
      {repository && (
        <div className="repository-meta">
          <span className="badge">{repository.technology}</span>
          <span className="badge">{repository.license}</span>
          <span
            className={`badge ${repository.hasGit ? "success" : "warning"}`}
          >
            {repository.hasGit ? "Git" : "No Git"}
          </span>
        </div>
      )}
      <TabView tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <Modal
        open={createModal}
        title="Create File"
        onClose={() => setCreateModal(false)}
      >
        <div className="form-group">
          <label htmlFor="new-file">File path</label>
          <input
            id="new-file"
            value={newFilePath}
            onChange={(event) => setNewFilePath(event.target.value)}
            placeholder="src/index.ts"
          />
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setCreateModal(false)}>
            Cancel
          </button>
          <button className="primary" onClick={handleCreateFile}>
            Create
          </button>
        </div>
      </Modal>

      <Modal
        open={renameModal.open}
        title="Rename File"
        onClose={() => setRenameModal({ open: false, from: null })}
      >
        <div className="form-group">
          <label htmlFor="rename-file">New path</label>
          <input
            id="rename-file"
            value={renamePath}
            onChange={(event) => setRenamePath(event.target.value)}
            placeholder="new-name.ts"
          />
        </div>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setRenameModal({ open: false, from: null })}
          >
            Cancel
          </button>
          <button className="primary" onClick={handleRenameFile}>
            Rename
          </button>
        </div>
      </Modal>

      <Modal
        open={moveModal.open}
        title="Move File"
        onClose={() => setMoveModal({ open: false, from: null })}
      >
        <div className="form-group">
          <label htmlFor="move-file">Target path</label>
          <input
            id="move-file"
            value={movePath}
            onChange={(event) => setMovePath(event.target.value)}
            placeholder="folder/new-file.ts"
          />
        </div>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setMoveModal({ open: false, from: null })}
          >
            Cancel
          </button>
          <button className="primary" onClick={handleMoveFile}>
            Move
          </button>
        </div>
      </Modal>

      <Modal
        open={deleteModal.open}
        title="Delete File"
        onClose={() => setDeleteModal({ open: false, target: null })}
      >
        <p>Are you sure you want to delete {deleteModal.target}?</p>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setDeleteModal({ open: false, target: null })}
          >
            Cancel
          </button>
          <button className="danger" onClick={handleDeleteFile}>
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
};
