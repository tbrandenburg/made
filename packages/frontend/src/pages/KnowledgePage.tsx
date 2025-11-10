import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ArtefactSummary } from '../hooks/useApi';
import { Panel } from '../components/Panel';
import { TabView } from '../components/TabView';
import { Modal } from '../components/Modal';
import '../styles/page.css';

export const KnowledgePage: React.FC = () => {
  const [artefacts, setArtefacts] = useState<ArtefactSummary[]>([]);
  const [activeTab, setActiveTab] = useState('artefacts');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTags, setNewTags] = useState('');
  const navigate = useNavigate();

  const loadArtefacts = () => {
    api
      .listKnowledge()
      .then((res) => setArtefacts(res.artefacts))
      .catch((error) => console.error('Failed to load artefacts', error));
  };

  useEffect(() => {
    loadArtefacts();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const filename = newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`;
    await api.saveKnowledge(filename, {
      content: '# New Artefact\n',
      frontmatter: { type: 'internal', tags: newTags ? newTags.split(',').map((tag) => tag.trim()) : [] }
    });
    setCreateOpen(false);
    setNewName('');
    setNewTags('');
    loadArtefacts();
    navigate(`/knowledge/${filename}`);
  };

  return (
    <div className="page">
      <h1>Knowledge Base</h1>
      <TabView
        tabs={[
          {
            id: 'artefacts',
            label: 'Artefacts',
            content: (
              <>
                <div className="button-bar">
                  <button className="primary" onClick={() => setCreateOpen(true)}>
                    Create Artefact
                  </button>
                </div>
                <div className="panel-column">
                  {artefacts.map((artefact) => (
                    <Panel
                      key={artefact.name}
                      title={artefact.name}
                      actions={
                        <button className="link-button" onClick={() => navigate(`/knowledge/${artefact.name}`)}>
                          Open
                        </button>
                      }
                    >
                      <div className="metadata">
                        <span className="badge">{artefact.type ?? 'internal'}</span>
                        {artefact.tags && artefact.tags.length > 0 && (
                          <span className="badge">{artefact.tags.join(', ')}</span>
                        )}
                      </div>
                    </Panel>
                  ))}
                  {artefacts.length === 0 && <div className="empty">No artefacts available.</div>}
                </div>
              </>
            )
          }
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <Modal open={createOpen} title="Create Knowledge Artefact" onClose={() => setCreateOpen(false)}>
        <div className="form-group">
          <label htmlFor="artefact-name">File name</label>
          <input
            id="artefact-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="architecture-overview"
          />
        </div>
        <div className="form-group">
          <label htmlFor="artefact-tags">Tags (comma separated)</label>
          <input
            id="artefact-tags"
            value={newTags}
            onChange={(event) => setNewTags(event.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setCreateOpen(false)}>
            Cancel
          </button>
          <button className="primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      </Modal>
    </div>
  );
};
