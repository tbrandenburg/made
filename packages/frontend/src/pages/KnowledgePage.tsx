import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ArtefactSummary } from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import { TrashIcon } from "../components/icons/TrashIcon";
import {
  addExternalMatterLink,
  listExternalMatter,
  removeExternalMatterLink,
} from "../utils/externalLinks";
import "../styles/page.css";

export const KnowledgePage: React.FC = () => {
  const [artefacts, setArtefacts] = useState<ArtefactSummary[]>([]);
  const [activeTab, setActiveTab] = useState("artefacts");
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTags, setNewTags] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const navigate = useNavigate();
  const isTemplate = (artefact: ArtefactSummary) => {
    if (typeof artefact.type === "string") {
      return artefact.type === "template";
    }
    const frontmatterType = artefact.frontmatter?.type;
    return (
      typeof frontmatterType === "string" && frontmatterType === "template"
    );
  };
  const templateArtefacts = artefacts.filter(isTemplate);
  const documentArtefacts = artefacts.filter(
    (artefact) => !isTemplate(artefact),
  );

  const loadArtefacts = () => {
    api
      .listKnowledge()
      .then((res) => {
        const external = listExternalMatter("knowledge").map((item) => ({
          name: item.name,
          routeName: item.id,
          frontmatter: item.frontmatter,
          isExternal: true,
          externalPath: item.path,
          type:
            typeof item.frontmatter.type === "string"
              ? item.frontmatter.type
              : "document",
          tags: Array.isArray(item.frontmatter.tags)
            ? (item.frontmatter.tags as string[])
            : [],
        }));
        setArtefacts([...res.artefacts, ...external]);
      })
      .catch((error) => console.error("Failed to load artefacts", error));
  };

  useEffect(() => {
    loadArtefacts();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const filename = newName.trim().endsWith(".md")
      ? newName.trim()
      : `${newName.trim()}.md`;
    await api.saveKnowledge(filename, {
      content: "# New Artefact\n",
      frontmatter: {
        type: "document",
        tags: newTags ? newTags.split(",").map((tag) => tag.trim()) : [],
      },
    });
    setCreateOpen(false);
    setNewName("");
    setNewTags("");
    loadArtefacts();
    navigate(`/knowledge/${filename}`);
  };

  const handleLink = () => {
    const linked = addExternalMatterLink("knowledge", linkPath);
    if (!linked) return;
    setLinkOpen(false);
    setLinkPath("");
    loadArtefacts();
    navigate(`/knowledge/${linked.id}`);
  };

  const handleRemoveExternalLink = (id: string) => {
    if (!window.confirm("Remove this linked knowledge artefact?")) return;
    removeExternalMatterLink("knowledge", id);
    loadArtefacts();
  };

  return (
    <div className="page">
      <h1>Knowledge Base</h1>
      <TabView
        tabs={[
          {
            id: "artefacts",
            label: "Artefacts",
            content: (
              <>
                <div className="button-bar">
                  <button
                    className="primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    Create Artefact
                  </button>
                  <button className="secondary" onClick={() => setLinkOpen(true)}>
                    Link Artefact
                  </button>
                </div>
                <div className="panel-column">
                  {templateArtefacts.length > 0 && (
                    <Panel title="Templates">
                      <div className="panel-column">
                        {templateArtefacts.map((artefact) => (
                          <Panel
                            key={artefact.routeName ?? artefact.name}
                            title={artefact.name}
                            to={`/knowledge/${artefact.routeName ?? artefact.name}`}
                            actions={
                              artefact.isExternal &&
                              artefact.routeName && (
                                <button
                                  type="button"
                                  className="copy-button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleRemoveExternalLink(
                                      artefact.routeName as string,
                                    );
                                  }}
                                  aria-label={`Remove linked artefact ${artefact.name}`}
                                  title={`Remove linked artefact ${artefact.name}`}
                                >
                                  <TrashIcon />
                                </button>
                              )
                            }
                          >
                            <div className="metadata">
                              <span className="badge">
                                {artefact.type ?? "document"}
                              </span>
                              {artefact.tags && artefact.tags.length > 0 && (
                                <span className="badge">
                                  {artefact.tags.join(", ")}
                                </span>
                              )}
                              {artefact.isExternal && (
                                <>
                                  <span className="badge external">External</span>
                                  {artefact.externalPath && (
                                    <span className="path-info">
                                      {artefact.externalPath}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </Panel>
                        ))}
                      </div>
                    </Panel>
                  )}
                  {documentArtefacts.length > 0 && (
                    <Panel title="Documents">
                      <div className="panel-column">
                        {documentArtefacts.map((artefact) => (
                          <Panel
                            key={artefact.routeName ?? artefact.name}
                            title={artefact.name}
                            to={`/knowledge/${artefact.routeName ?? artefact.name}`}
                            actions={
                              artefact.isExternal &&
                              artefact.routeName && (
                                <button
                                  type="button"
                                  className="copy-button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleRemoveExternalLink(
                                      artefact.routeName as string,
                                    );
                                  }}
                                  aria-label={`Remove linked artefact ${artefact.name}`}
                                  title={`Remove linked artefact ${artefact.name}`}
                                >
                                  <TrashIcon />
                                </button>
                              )
                            }
                          >
                            <div className="metadata">
                              <span className="badge">
                                {artefact.type ?? "document"}
                              </span>
                              {artefact.tags && artefact.tags.length > 0 && (
                                <span className="badge">
                                  {artefact.tags.join(", ")}
                                </span>
                              )}
                              {artefact.isExternal && (
                                <>
                                  <span className="badge external">External</span>
                                  {artefact.externalPath && (
                                    <span className="path-info">
                                      {artefact.externalPath}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </Panel>
                        ))}
                      </div>
                    </Panel>
                  )}
                  {artefacts.length === 0 && (
                    <div className="empty">No artefacts available.</div>
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
        title="Create Knowledge Artefact"
        onClose={() => setCreateOpen(false)}
      >
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
      <Modal
        open={linkOpen}
        title="Link Knowledge Artefact"
        onClose={() => setLinkOpen(false)}
      >
        <div className="form-group">
          <label htmlFor="artefact-path">Path</label>
          <input
            id="artefact-path"
            value={linkPath}
            onChange={(event) => setLinkPath(event.target.value)}
            placeholder="~/.config/opencode/AGENTS.md"
          />
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
          <button className="primary" onClick={handleLink}>
            Link
          </button>
        </div>
      </Modal>
    </div>
  );
};
