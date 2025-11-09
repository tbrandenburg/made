import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRepositoryFiles,
  readRepositoryFile,
  writeRepositoryFile,
  deleteRepositoryFileRequest,
  renameRepositoryFileRequest,
  sendAgentPrompt
} from '../hooks/useBackend.js';

const tabs = ['Agent', 'File Browser', 'File Editor', 'Publishment'];

export default function RepositoryPage() {
  const { repoId } = useParams();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('Agent');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [agentMessages, setAgentMessages] = useState([]);

  const filesQuery = useQuery(['repo-files', repoId], () => fetchRepositoryFiles(repoId), {
    enabled: Boolean(repoId)
  });

  useEffect(() => {
    setActiveTab('Agent');
  }, [repoId]);

  const loadFile = async (relativePath) => {
    const data = await readRepositoryFile(repoId, relativePath);
    setSelectedFile(relativePath);
    setFileContent(data.content);
    setActiveTab('File Editor');
  };

  const saveFileMutation = useMutation({
    mutationFn: ({ path, content }) => writeRepositoryFile(repoId, path, content),
    onSuccess: () => {
      queryClient.invalidateQueries(['repo-files', repoId]);
    }
  });

  const deleteFileMutation = useMutation({
    mutationFn: (path) => deleteRepositoryFileRequest(repoId, path),
    onSuccess: () => {
      queryClient.invalidateQueries(['repo-files', repoId]);
      setSelectedFile(null);
      setFileContent('');
    }
  });

  const renameFileMutation = useMutation({
    mutationFn: ({ from, to }) => renameRepositoryFileRequest(repoId, from, to),
    onSuccess: () => {
      queryClient.invalidateQueries(['repo-files', repoId]);
    }
  });

  const handleCreateFile = async () => {
    const path = prompt('New file path');
    if (!path) return;
    await saveFileMutation.mutateAsync({ path, content: '' });
    await loadFile(path);
  };

  const handleRenameFile = async (file) => {
    const newPath = prompt('Rename file', file.relativePath);
    if (!newPath || newPath === file.relativePath) return;
    await renameFileMutation.mutateAsync({ from: file.relativePath, to: newPath });
    if (selectedFile === file.relativePath) {
      setSelectedFile(newPath);
    }
  };

  const handleDeleteFile = async (file) => {
    if (!confirm(`Delete ${file.relativePath}?`)) return;
    await deleteFileMutation.mutateAsync(file.relativePath);
  };

  const handleMoveFile = async (file) => {
    const newPath = prompt('Move file to path', file.relativePath);
    if (!newPath || newPath === file.relativePath) return;
    await renameFileMutation.mutateAsync({ from: file.relativePath, to: newPath });
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    await saveFileMutation.mutateAsync({ path: selectedFile, content: fileContent });
  };

  const handleAgentSend = async (promptMessage) => {
    if (!promptMessage || !promptMessage.trim()) return;
    const entry = await sendAgentPrompt(repoId, promptMessage);
    setAgentMessages((prev) => [entry, ...prev]);
  };

  const handlePublishmentAction = async (promptMessage) => {
    await handleAgentSend(promptMessage);
    setActiveTab('Agent');
  };

  return (
    <div className="page">
      <div className="tab-view">
        <div className="tab-bar">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={tab === activeTab ? 'active' : ''}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="tab-toolbar">
          {activeTab === 'File Browser' && (
            <button className="primary" onClick={handleCreateFile}>Create file</button>
          )}
          {activeTab === 'File Editor' && (
            <button className="primary" onClick={handleSaveFile} disabled={saveFileMutation.isLoading}>
              {saveFileMutation.isLoading ? 'Saving…' : 'Save file'}
            </button>
          )}
        </div>
        <div className="tab-content">
          {activeTab === 'Agent' && (
            <div className="panel split">
              <div className="chat-input">
                <textarea
                  placeholder="Send instructions to the agent"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      handleAgentSend(event.currentTarget.value);
                      event.currentTarget.value = '';
                    }
                  }}
                ></textarea>
                <button
                  className="primary"
                  onClick={() => {
                    const textArea = document.querySelector('.chat-input textarea');
                    if (!textArea?.value) return;
                    handleAgentSend(textArea.value);
                    textArea.value = '';
                  }}
                >
                  Send
                </button>
              </div>
              <div className="chat-log" id="agent">
                {agentMessages.length === 0 && <p className="muted">No messages yet.</p>}
                {agentMessages.map((entry, index) => (
                  <div className="chat-entry" key={index}>
                    <div className="chat-meta">
                      <span>Prompt</span>
                      <time>{new Date(entry.response.timestamp).toLocaleString()}</time>
                    </div>
                    <p>{entry.prompt}</p>
                    <div className="chat-response">
                      <strong>Agent:</strong> {entry.response.message}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeTab === 'File Browser' && (
            <div className="panel">
              {filesQuery.isLoading && <p>Loading files…</p>}
              {filesQuery.data && (
                <ul className="file-list">
                  {filesQuery.data.map((file) => (
                    <li key={file.relativePath}>
                      <span className="file-name" onClick={() => loadFile(file.relativePath)}>
                        {file.relativePath}
                      </span>
                      <div className="actions">
                        <button onClick={() => loadFile(file.relativePath)}>Edit</button>
                        <button onClick={() => handleRenameFile(file)}>Rename</button>
                        <button onClick={() => handleMoveFile(file)}>Move</button>
                        <button onClick={() => handleDeleteFile(file)} className="danger">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {activeTab === 'File Editor' && (
            <div className="panel vertical">
              <div className="editor">
                <div className="editor-header">
                  <h4>{selectedFile || 'Select a file'}</h4>
                </div>
                <textarea
                  value={fileContent}
                  onChange={(event) => setFileContent(event.target.value)}
                  disabled={!selectedFile}
                  placeholder="Select a file to edit"
                ></textarea>
              </div>
              <div className="preview">
                <h4>Preview</h4>
                <pre>{fileContent}</pre>
              </div>
            </div>
          )}
          {activeTab === 'Publishment' && (
            <div className="panel">
              <div className="button-grid">
                {[
                  { label: 'Initialize Repository', prompt: 'Initialize the repository with recommended defaults.' },
                  { label: 'Create remote repository', prompt: 'Create a remote repository for this project.' },
                  { label: 'Create PR', prompt: 'Prepare a pull request with the latest changes.' },
                  { label: 'Deploy', prompt: 'Deploy the project to the configured environment.' },
                  { label: 'Preview', prompt: 'Generate a preview environment for the current branch.' },
                  { label: 'Publish', prompt: 'Publish the project to the web.' }
                ].map((action) => (
                  <button
                    key={action.label}
                    className="secondary"
                    onClick={() => handlePublishmentAction(action.prompt)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
