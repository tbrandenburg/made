import React, { useEffect, useState } from "react";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import { api } from "../hooks/useApi";
import "../styles/page.css";

type SettingsMap = Record<string, unknown>;

const agentCliOptions = ["opencode", "kiro-cli"];

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [activeTab, setActiveTab] = useState("settings");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((data) => setSettings(data))
      .catch((error) => {
        console.error("Failed to load settings", error);
        setStatus("Failed to load settings");
      });
  }, []);

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      await api.saveSettings(settings);
      setStatus("Settings saved");
    } catch (error) {
      console.error("Failed to save settings", error);
      setStatus("Save failed");
    }
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      {status && <div className="alert">{status}</div>}
      <TabView
        tabs={[
          {
            id: "settings",
            label: "Settings",
            content: (
              <Panel
                title="Configuration"
                actions={
                  <button className="primary" onClick={handleSave}>
                    Save
                  </button>
                }
              >
                <div className="settings-grid">
                  {Object.entries(settings).map(([key, value]) => (
                    <div key={key} className="settings-row">
                      <label htmlFor={`setting-${key}`}>{key}</label>
                      {key === "agentCli" ? (
                        <select
                          id={`setting-${key}`}
                          value={String(value ?? "")}
                          onChange={(event) =>
                            handleChange(key, event.target.value)
                          }
                        >
                          {agentCliOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`setting-${key}`}
                          value={String(value ?? "")}
                          onChange={(event) =>
                            handleChange(key, event.target.value)
                          }
                        />
                      )}
                    </div>
                  ))}
                  {Object.keys(settings).length === 0 && (
                    <div className="empty">No settings available.</div>
                  )}
                </div>
              </Panel>
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  );
};
