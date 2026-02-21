import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ArtefactSummary } from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { Modal } from "../components/Modal";
import "../styles/page.css";

export const TasksPage: React.FC = () => {
  const [tasks, setTasks] = useState<ArtefactSummary[]>([]);
  const [activeTab, setActiveTab] = useState("tasks");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();
  const isTemplate = (task: ArtefactSummary) => {
    if (typeof task.type === "string") {
      return task.type === "template";
    }
    const frontmatterType = task.frontmatter?.type;
    return typeof frontmatterType === "string" && frontmatterType === "template";
  };
  const templateTasks = tasks.filter(isTemplate);
  const documentTasks = tasks.filter(
    (task) => !isTemplate(task),
  );

  const loadTasks = () => {
    api
      .listTasks()
      .then((res) => setTasks(res.tasks))
      .catch((error) => console.error("Failed to load tasks", error));
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const filename = newName.trim().endsWith(".md")
      ? newName.trim()
      : `${newName.trim()}.md`;
    await api.saveTask(filename, {
      content: "# New Task\n\n- [ ] Define work\n",
      frontmatter: { type: "task" },
    });
    setCreateOpen(false);
    setNewName("");
    loadTasks();
    navigate(`/tasks/${filename}`);
  };

  return (
    <div className="page">
      <h1>Tasks</h1>
      <TabView
        tabs={[
          {
            id: "tasks",
            label: "Tasks",
            content: (
              <>
                <div className="button-bar">
                  <button
                    className="primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    Create Task
                  </button>
                </div>
                <div className="panel-column">
                  {templateTasks.length > 0 && (
                    <Panel title="Templates">
                      <div className="panel-column">
                        {templateTasks.map((task) => (
                          <Panel
                            key={task.name}
                            title={task.name}
                            to={`/tasks/${task.name}`}
                          >
                            <div className="metadata">
                              {typeof task.frontmatter?.type ===
                                "string" && (
                                <span className="badge">
                                  {String(task.frontmatter.type)}
                                </span>
                              )}
                            </div>
                          </Panel>
                        ))}
                      </div>
                    </Panel>
                  )}
                  {documentTasks.length > 0 && (
                    <Panel title="Documents">
                      <div className="panel-column">
                        {documentTasks.map((task) => (
                          <Panel
                            key={task.name}
                            title={task.name}
                            to={`/tasks/${task.name}`}
                          >
                            <div className="metadata">
                              {typeof task.frontmatter?.type ===
                                "string" && (
                                <span className="badge">
                                  {String(task.frontmatter.type)}
                                </span>
                              )}
                            </div>
                          </Panel>
                        ))}
                      </div>
                    </Panel>
                  )}
                  {tasks.length === 0 && (
                    <div className="empty">No tasks available.</div>
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
        title="Create Task"
        onClose={() => setCreateOpen(false)}
      >
        <div className="form-group">
          <label htmlFor="task-name">File name</label>
          <input
            id="task-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="release-checklist"
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
