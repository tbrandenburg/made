import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchConstitution, saveConstitution, sendAgentPrompt } from '../hooks/useBackend.js';

const tabs = ['Content', 'Agent'];

export default function ConstitutionDetailPage() {
  const { file } = useParams();
  const [activeTab, setActiveTab] = useState('Content');
  const [metadata, setMetadata] = useState({});
  const [body, setBody] = useState('');
  const [agentLog, setAgentLog] = useState([]);

  useEffect(() => {
    async function load() {
      const data = await fetchConstitution(file);
      setMetadata(data.data || {});
      setBody(data.content || '');
    }
    load();
  }, [file]);

  const handleSave = async () => {
    await saveConstitution(file, metadata, body);
    alert('Constitution saved.');
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
            <button className="primary" onClick={handleSave}>Save constitution</button>
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
              </div>
              <div className="preview">
                <textarea value={body} onChange={(event) => setBody(event.target.value)} />
              </div>
            </div>
          )}
          {activeTab === 'Agent' && (
            <div className="panel">
              <textarea
                placeholder="Discuss constitution changes with the agent"
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
