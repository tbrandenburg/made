import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ArtefactSummary } from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import "../styles/page.css";

export const ConstitutionsPage: React.FC = () => {
  const [constitutions, setConstitutions] = useState<ArtefactSummary[]>([]);
  const [activeTab, setActiveTab] = useState("constitutions");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();

  const loadConstitutions = () => {
    api
      .listConstitutions()
      .then((res) => setConstitutions(res.constitutions))
      .catch((error) => console.error("Failed to load constitutions", error));
  };

  useEffect(() => {
    loadConstitutions();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const filename = newName.trim().endsWith(".md")
      ? newName.trim()
      : `${newName.trim()}.md`;
    await api.saveConstitution(filename, {
      content: "# New Constitution\n",
      frontmatter: { type: "global" },
    });
    setCreateOpen(false);
    setNewName("");
    loadConstitutions();
    navigate(`/constitutions/${filename}`);
  };

  return (
    <div className="page">
      <h1>Constitutions</h1>
      <TabView
        tabs={[
          {
            id: "constitutions",
            label: "Constitutions",
            content: (
              <>
                <div className="button-bar">
                  <button
                    className="primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    Create Constitution
                  </button>
                </div>
                <div className="panel-column">
                  {constitutions.map((constitution) => (
                    <Panel
                      key={constitution.name}
                      title={constitution.name}
                      to={`/constitutions/${constitution.name}`}
                    >
                      <div className="metadata">
                        {typeof constitution.frontmatter?.type === "string" && (
                          <span className="badge">
                            {String(constitution.frontmatter.type)}
                          </span>
                        )}
                      </div>
                    </Panel>
                  ))}
                  {constitutions.length === 0 && (
                    <div className="empty">No constitutions available.</div>
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
        title="Create Constitution"
        onClose={() => setCreateOpen(false)}
      >
        <div className="form-group">
          <label htmlFor="constitution-name">File name</label>
          <input
            id="constitution-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="governance"
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
