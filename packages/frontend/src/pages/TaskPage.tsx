import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import { api } from "../hooks/useApi";
import { TabView } from "../components/TabView";
import "../styles/page.css";

export const TaskPage: React.FC = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("edit");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!name) {
      navigate("/tasks");
      return;
    }

    api
      .getTask(name)
      .then((data) => setContent(data.content ?? ""))
      .catch((error) => {
        console.error("Failed to load task", error);
        setStatus("Failed to load task");
      });
  }, [name, navigate]);

  const handleSave = async () => {
    if (!name) return;
    try {
      await api.saveTask(name, { content, frontmatter: { type: "task" } });
      setStatus("Saved successfully");
    } catch (error) {
      console.error("Failed to save task", error);
      setStatus("Save failed");
    }
  };

  return (
    <div className="page">
      <h1>{name}</h1>
      <TabView
        tabs={[
          {
            id: "edit",
            label: "Edit",
            content: (
              <>
                <div className="button-bar">
                  <button className="primary" onClick={handleSave}>
                    Save
                  </button>
                </div>
                <textarea
                  className="editor"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                />
              </>
            ),
          },
          {
            id: "preview",
            label: "Preview",
            content: (
              <div
                className="markdown-preview"
                dangerouslySetInnerHTML={{ __html: marked.parse(content) }}
              />
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      {status && <div className="status">{status}</div>}
    </div>
  );
};
