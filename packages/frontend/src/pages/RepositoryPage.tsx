import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import { usePersistentChat } from "../hooks/usePersistentChat";
import {
  api,
  CommandDefinition,
  FileNode,
  RepositorySummary,
} from "../hooks/useApi";
import { ChatMessage } from "../types/chat";
import "../styles/page.css";

const stripCommandFrontmatter = (content: string) => {
  const delimiterPattern = /^\s*---(?:[\r\n]+[\s\S]*?[\r\n]+---|[\s\S]*?---)\s*/;
  return delimiterPattern.test(content)
    ? content.replace(delimiterPattern, "").trim()
    : content.trim();
};

const COMMAND_ACTIONS = [
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

const FolderIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    className="file-icon-svg"
    viewBox="0 0 24 24"
    role="img"
    focusable="false"
  >
    <path d="M3 4.5a1.5 1.5 0 0 1 1.5-1.5h5.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12a1.5 1.5 0 0 0 1.06.44H19.5A1.5 1.5 0 0 1 21 6.5v11A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-13Z" />
  </svg>
);

const FileIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    className="file-icon-svg"
    viewBox="0 0 24 24"
    role="img"
    focusable="false"
  >
    <path d="M14.25 3v4.5h4.5L14.25 3Z" />
    <path d="M5.25 4.5A1.5 1.5 0 0 1 6.75 3h7.5l4.5 4.5V19.5a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-15Z" />
  </svg>
);

export const RepositoryPage: React.FC = () => {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("agent");
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["."]));
  const chatStorageKey = useMemo(
    () => (name ? `repository-chat-${name}` : "repository-chat"),
    [name],
  );
  const [chat, setChat] = usePersistentChat(chatStorageKey);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [availableCommands, setAvailableCommands] = useState<
    CommandDefinition[]
  >([]);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandModal, setCommandModal] = useState<{
    open: boolean;
    command: CommandDefinition | null;
    labels: string[];
    placeholders: string[];
    values: string[];
  }>({
    open: false,
    command: null,
    labels: [],
    placeholders: [],
    values: [],
  });
  const chatWindowRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chat]);
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

  const loadCommands = useCallback(() => {
    if (!name) return;
    setCommandsLoading(true);
    api
      .getRepositoryCommands(name)
      .then((response) => {
        setAvailableCommands(response.commands);
        setCommandsError(null);
      })
      .catch((error) => {
        console.error("Failed to load commands", error);
        const message =
          error instanceof Error ? error.message : "Failed to load commands";
        setCommandsError(message);
      })
      .finally(() => setCommandsLoading(false));
  }, [name]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

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

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    if (newTab === "files") {
      refreshFiles();
    }
  };

  const refreshFiles = () => {
    if (!name) return;
    api
      .getRepositoryFiles(name)
      .then((tree) => setFileTree(tree))
      .catch((error) => console.error("Failed to load file tree", error));
  };

  const refreshAgentStatus = useCallback(async () => {
    if (!name) return false;
    try {
      const status = await api.getRepositoryAgentStatus(name);
      setChatLoading(status.processing);
      setChatError(
        status.processing ? "Agent is still processing the previous message." : null,
      );
      return status.processing;
    } catch (error) {
      console.error("Failed to load agent status", error);
      return false;
    }
  }, [name]);

  useEffect(() => {
    refreshAgentStatus();
  }, [refreshAgentStatus]);

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
    setChatLoading(true);
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
      setChatLoading(false);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "";
      const agentBusy = messageText.toLowerCase().includes("processing");
      setChatError(
        agentBusy ? "Agent is still processing the previous message." : "Failed to reach agent",
      );
      console.error("Failed to send agent message", error);
      const processing = await refreshAgentStatus();
      if (!processing) {
        setChatLoading(false);
      }
    }
  };

  const getCommandArgumentPlan = (command: CommandDefinition) => {
    const labelsFromHint = command.argumentHint
      ? Array.from(command.argumentHint.matchAll(/\[([^\]]+)\]/g)).map(
          (match) => match[1],
        )
      : [];

    if (labelsFromHint.length) {
      return {
        labels: labelsFromHint,
        placeholders: labelsFromHint.map((_, index) => `$${index + 1}`),
      };
    }

    const numericPlaceholders = Array.from(
      new Set(
        Array.from(command.content.matchAll(/\$([1-9]\d*)/g)).map(
          (match) => match[1],
        ),
      ),
    ).sort((a, b) => Number(a) - Number(b));

    if (numericPlaceholders.length) {
      return {
        labels: numericPlaceholders.map((value) => `Arg ${value}`),
        placeholders: numericPlaceholders.map((value) => `$${value}`),
      };
    }

    if (command.content.includes("$ARGUMENTS")) {
      return { labels: ["Arguments"], placeholders: ["$ARGUMENTS"] };
    }

    return { labels: [], placeholders: [] };
  };

  const handleCommandSelection = (command: CommandDefinition) => {
    const plan = getCommandArgumentPlan(command);
    if (plan.labels.length === 0) {
      handleSendMessage(stripCommandFrontmatter(command.content));
      setActiveTab("agent");
      return;
    }

    setCommandModal({
      open: true,
      command,
      labels: plan.labels,
      placeholders: plan.placeholders,
      values: Array(plan.labels.length).fill(""),
    });
  };

  const handleCommandValueChange = (index: number, value: string) => {
    setCommandModal((prev) => ({
      ...prev,
      values: prev.values.map((existing, idx) =>
        idx === index ? value : existing
      ),
    }));
  };

  const closeCommandModal = () =>
    setCommandModal({
      open: false,
      command: null,
      labels: [],
      placeholders: [],
      values: [],
    });

  const handleCommandConfirm = () => {
    if (!commandModal.command) return;
    let text = stripCommandFrontmatter(commandModal.command.content);
    commandModal.placeholders.forEach((placeholder, index) => {
      const value = commandModal.values[index] ?? "";
      text = text.split(placeholder).join(value);
    });

    if (text.includes("$ARGUMENTS")) {
      text = text
        .split("$ARGUMENTS")
        .join(commandModal.values.join(" ").trim());
    }

    handleSendMessage(text.trim());
    setActiveTab("agent");
    closeCommandModal();
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

    const handleFolderToggle = () => toggleFolder(node.path);
    const handleToggleKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleFolderToggle();
      }
    };
    const handleNameKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (isFolder) {
          handleFolderToggle();
        } else {
          openFile(node.path);
        }
      }
    };
    return (
      <div key={node.path} className="file-node" style={indent}>
        <div className="file-row">
          <span
            className={`file-icon ${isFolder ? "folder-toggle" : ""}`}
            role={isFolder ? "button" : undefined}
            tabIndex={isFolder ? 0 : undefined}
            aria-expanded={isFolder ? isExpanded : undefined}
            aria-label={
              isFolder
                ? `${isExpanded ? "Collapse" : "Expand"} ${node.name}`
                : undefined
            }
            onClick={isFolder ? handleFolderToggle : undefined}
            onKeyDown={isFolder ? handleToggleKeyDown : undefined}
          >
            {isFolder ? <FolderIcon /> : <FileIcon />}
          </span>
          <span
            className="file-name"
            role="button"
            tabIndex={0}
            onClick={() =>
              isFolder ? handleFolderToggle() : openFile(node.path)
            }
            onKeyDown={handleNameKeyDown}
          >
            {node.name}
          </span>
          <div className="file-actions">
            {!isFolder && (
              <button
                className="link-button"
                onClick={() => openFile(node.path)}
              >
                📝
              </button>
            )}
            <button
              className="link-button"
              onClick={() => {
                setRenamePath(node.path);
                setRenameModal({ open: true, from: node.path });
              }}
            >
              🏷️
            </button>
            <button
              className="link-button"
              onClick={() => {
                setMovePath(node.path);
                setMoveModal({ open: true, from: node.path });
              }}
            >
              ↔️
            </button>
            <button
              className="link-button"
              onClick={() => setDeleteModal({ open: true, target: node.path })}
            >
              🗑
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
          <div className="chat-window" ref={chatWindowRef}>
            {chat.map((message) => (
              <div key={message.id} className={`chat-message ${message.role}`}>
                <div className="chat-meta">
                  {new Date(message.timestamp).toLocaleString()}
                </div>
                <div
                  className="markdown"
                  dangerouslySetInnerHTML={{
                    __html: marked(message.text || ""),
                  }}
                />
              </div>
            ))}
            {chatLoading && (
              <div className="loading-indicator">
                <div className="loading-spinner"></div>
                <span>Agent is thinking...</span>
              </div>
            )}
            {chat.length === 0 && !chatLoading && (
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
            <button
              className="primary"
              onClick={() => handleSendMessage()}
              disabled={chatLoading || !pendingPrompt.trim()}
            >
              {chatLoading ? "Sending..." : "Send"}
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
                  editorStatus.includes("successfully")
                    ? "success"
                    : editorStatus.includes("Failed") ||
                        editorStatus.includes("failed")
                      ? "error"
                      : ""
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
            {selectedFile?.endsWith(".md") ? (
              <div
                className="markdown"
                dangerouslySetInnerHTML={{
                  __html: marked(editorContent || ""),
                }}
              />
            ) : (
              <pre className="preview">{editorContent}</pre>
            )}
          </Panel>
        </div>
      ),
    },
    {
      id: "commands",
      label: "Commands",
      content: (
        <div className="command-center">
          <Panel
            title="User Commands"
            actions={
              <button
                className="secondary"
                onClick={loadCommands}
                disabled={commandsLoading}
              >
                Refresh
              </button>
            }
          >
            {commandsLoading && <div className="alert">Loading commands...</div>}
            {commandsError && <div className="alert error">{commandsError}</div>}
            {!commandsLoading && !commandsError && (
              <>
                {availableCommands.length === 0 ? (
                  <div className="empty">
                    No commands found in configured directories.
                  </div>
                ) : (
                  <div className="commands-grid">
                    {availableCommands.map((command) => (
                      <button
                        key={command.id}
                        className="primary command-button"
                        title={`${command.source} • ${command.name}${
                          command.argumentHint ? ` • ${command.argumentHint}` : ""
                        }`}
                        onClick={() => handleCommandSelection(command)}
                      >
                        <span className="command-button__title">
                          {command.description || command.name}
                        </span>
                        {command.argumentHint && (
                          <span className="command-hint">
                            {command.argumentHint}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
          <Panel title="Pre-installed Commands">
            <div className="commands-grid">
              {COMMAND_ACTIONS.map((action) => (
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
        </div>
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
      <TabView
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      <Modal
        open={commandModal.open}
        title={commandModal.command?.description || "Run Command"}
        onClose={closeCommandModal}
      >
        {commandModal.labels.length > 0 ? (
          commandModal.labels.map((label, index) => (
            <div className="form-group" key={`${label}-${index}`}>
              <label>{label}</label>
              <input
                value={commandModal.values[index] || ""}
                onChange={(event) =>
                  handleCommandValueChange(index, event.target.value)
                }
                placeholder={
                  commandModal.command?.argumentHint || `Value for ${label}`
                }
              />
            </div>
          ))
        ) : (
          <p>This command does not require any arguments.</p>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={closeCommandModal}>
            Cancel
          </button>
          <button className="primary" onClick={handleCommandConfirm}>
            Insert into chat
          </button>
        </div>
      </Modal>

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
