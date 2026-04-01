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

export const ConstitutionsPage: React.FC = () => {
  const [constitutions, setConstitutions] = useState<ArtefactSummary[]>([]);
  const [activeTab, setActiveTab] = useState("constitutions");
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [removeModal, setRemoveModal] = useState<{
    open: boolean;
    name: string;
    routeName?: string;
    isExternal: boolean;
  }>({
    open: false,
    name: "",
    routeName: undefined,
    isExternal: false,
  });
  const [newName, setNewName] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const navigate = useNavigate();
  const isTemplate = (constitution: ArtefactSummary) => {
    if (typeof constitution.type === "string") {
      return constitution.type === "template";
    }
    const frontmatterType = constitution.frontmatter?.type;
    return (
      typeof frontmatterType === "string" && frontmatterType === "template"
    );
  };
  const templateConstitutions = constitutions.filter(isTemplate);
  const documentConstitutions = constitutions.filter(
    (constitution) => !isTemplate(constitution),
  );

  const loadConstitutions = () => {
    api
      .listConstitutions()
      .then((res) => {
        const external = listExternalMatter("constitution").map((item) => ({
          name: item.name,
          routeName: item.id,
          frontmatter: item.frontmatter,
          isExternal: true,
          externalPath: item.path,
          type:
            typeof item.frontmatter.type === "string"
              ? item.frontmatter.type
              : undefined,
        }));
        setConstitutions([...res.constitutions, ...external]);
      })
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

  const handleLink = () => {
    const linked = addExternalMatterLink("constitution", linkPath);
    if (!linked) return;
    setLinkOpen(false);
    setLinkPath("");
    loadConstitutions();
    navigate(`/constitutions/${linked.id}`);
  };

  const openRemoveModal = (constitution: ArtefactSummary) => {
    setRemoveModal({
      open: true,
      name: constitution.name,
      routeName: constitution.routeName,
      isExternal: Boolean(constitution.isExternal),
    });
  };

  const handleConfirmRemove = async () => {
    if (!removeModal.name) return;
    if (removeModal.isExternal && removeModal.routeName) {
      removeExternalMatterLink("constitution", removeModal.routeName);
    } else {
      await api.deleteConstitution(removeModal.name);
    }
    setRemoveModal({
      open: false,
      name: "",
      routeName: undefined,
      isExternal: false,
    });
    loadConstitutions();
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
                  <button className="secondary" onClick={() => setLinkOpen(true)}>
                    Link Constitution
                  </button>
                </div>
                <div className="panel-column">
                  {templateConstitutions.length > 0 && (
                    <Panel title="Templates">
                      <div className="panel-column">
                        {templateConstitutions.map((constitution) => (
                          <Panel
                            key={constitution.routeName ?? constitution.name}
                            title={constitution.name}
                            to={`/constitutions/${constitution.routeName ?? constitution.name}`}
                            actions={
                              (!constitution.isExternal ||
                                constitution.routeName) && (
                                <button
                                  type="button"
                                  className="copy-button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openRemoveModal(constitution);
                                  }}
                                  aria-label={`Remove constitution ${constitution.name}`}
                                  title={`Remove constitution ${constitution.name}`}
                                >
                                  <TrashIcon />
                                </button>
                              )
                            }
                          >
                            <div className="metadata">
                              {typeof constitution.frontmatter?.type ===
                                "string" && (
                                <span className="badge">
                                  {String(constitution.frontmatter.type)}
                                </span>
                              )}
                              {constitution.isExternal && (
                                <>
                                  <span className="badge external">External</span>
                                  {constitution.externalPath && (
                                    <span className="path-info">
                                      {constitution.externalPath}
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
                  {documentConstitutions.length > 0 && (
                    <Panel title="Documents">
                      <div className="panel-column">
                        {documentConstitutions.map((constitution) => (
                          <Panel
                            key={constitution.routeName ?? constitution.name}
                            title={constitution.name}
                            to={`/constitutions/${constitution.routeName ?? constitution.name}`}
                            actions={
                              (!constitution.isExternal ||
                                constitution.routeName) && (
                                <button
                                  type="button"
                                  className="copy-button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openRemoveModal(constitution);
                                  }}
                                  aria-label={`Remove constitution ${constitution.name}`}
                                  title={`Remove constitution ${constitution.name}`}
                                >
                                  <TrashIcon />
                                </button>
                              )
                            }
                          >
                            <div className="metadata">
                              {typeof constitution.frontmatter?.type ===
                                "string" && (
                                <span className="badge">
                                  {String(constitution.frontmatter.type)}
                                </span>
                              )}
                              {constitution.isExternal && (
                                <>
                                  <span className="badge external">External</span>
                                  {constitution.externalPath && (
                                    <span className="path-info">
                                      {constitution.externalPath}
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
      <Modal
        open={linkOpen}
        title="Link Constitution File"
        onClose={() => setLinkOpen(false)}
      >
        <div className="form-group">
          <label htmlFor="constitution-path">Path</label>
          <input
            id="constitution-path"
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
      <Modal
        open={removeModal.open}
        title={
          removeModal.isExternal
            ? "Remove Linked Constitution"
            : "Remove Constitution"
        }
        onClose={() =>
          setRemoveModal({
            open: false,
            name: "",
            routeName: undefined,
            isExternal: false,
          })
        }
      >
        <p>
          {removeModal.isExternal
            ? `Are you sure you want to remove the linked constitution ${removeModal.name}?`
            : `Are you sure you want to remove ${removeModal.name}?`}
        </p>
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() =>
              setRemoveModal({
                open: false,
                name: "",
                routeName: undefined,
                isExternal: false,
              })
            }
          >
            Cancel
          </button>
          <button className="primary" onClick={() => void handleConfirmRemove()}>
            Remove
          </button>
        </div>
      </Modal>
    </div>
  );
};
