import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchKnowledgeArtefact, saveKnowledgeArtefact, sendAgentPrompt } from '../hooks/useBackend.js';

const tabs = ['Content', 'Agent'];

export default function KnowledgeArtefactPage() {
  const { file } = useParams();
  const [activeTab, setActiveTab] = useState('Content');
  const [metadata, setMetadata] = useState({});
  const [body, setBody] = useState('');
  const [agentLog, setAgentLog] = useState([]);

  useEffect(() => {
    async function load() {
      const data = await fetchKnowledgeArtefact(file);
      setMetadata(data.data || {});
      setBody(data.content || '');
    }
    load();
  }, [file]);

  const handleSave = async () => {
    await saveKnowledgeArtefact(file, metadata, body);
    alert('Artefact saved.');
  };

  const handleAgentPrompt = async (prompt) => {
    if (!prompt || !prompt.trim()) return;
    const entry = await sendAgentPrompt(file, prompt);
    setAgentLog((prev) => [entry, ...prev]);
  };

  return (
    <div className="page">
      <div className="tab-view">
        <div className="tab-bar">
          {tabs.map((tab) => (
            <button key={tab} className={tab === activeTab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
        </div>
        <div className="tab-toolbar">
          {activeTab === 'Content' && (
            <button className="primary" onClick={handleSave}>Save artefact</button>
          )}
        </div>
        <div className="tab-content">
          {activeTab === 'Content' && (
            <div className="panel vertical">
              <div className="metadata-grid">
                <label>
                  Filename
                  <input value={file} readOnly />
                </label>
                <label>
                  Tags (comma separated)
                  <input
                    value={(metadata.tags || []).join(', ')}
                    onChange={(event) => setMetadata({ ...metadata, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })}
                  />
                </label>
                <label>
                  Type
                  <select
                    value={metadata.type || 'internal'}
                    onChange={(event) => setMetadata({ ...metadata, type: event.target.value })}
                  >
                    <option value="internal">Internal</option>
                    <option value="external">External</option>
                  </select>
                </label>
              </div>
              <div className="preview">
                {metadata.type === 'external' ? (
                  <iframe title="External artefact" src={body} />
                ) : (
                  <textarea value={body} onChange={(event) => setBody(event.target.value)} />
                )}
              </div>
            </div>
          )}
          {activeTab === 'Agent' && (
            <div className="panel">
              <textarea
                placeholder="Ask the agent about this artefact"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    handleAgentPrompt(event.currentTarget.value);
                    event.currentTarget.value = '';
                  }
                }}
              ></textarea>
              <div className="chat-log">
                {agentLog.map((entry, index) => (
                  <div key={index} className="chat-entry">
                    <p>{entry.prompt}</p>
                    <div className="chat-response">{entry.response.message}</div>
                  </div>
                ))}
                {agentLog.length === 0 && <p className="muted">No agent conversations yet.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
