import React, { useEffect, useState } from "react";
import { api, type CronClockSummary } from "../hooks/useApi";
import { Panel } from "../components/Panel";
import { TabView } from "../components/TabView";
import "../styles/page.css";

type DashboardData = {
  projectCount: number;
  agentConnection: boolean;
  madeHome: string;
  workspaceHome: string;
  madeDirectory: string;
  cronClock: CronClockSummary;
};

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState("statistics");
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api
      .getDashboard()
      .then((res) =>
        setData({
          projectCount: res.projectCount,
          agentConnection: res.agentConnection,
          madeHome: res.madeHome,
          workspaceHome: res.workspaceHome,
          madeDirectory: res.madeDirectory,
          cronClock: res.cronClock,
        }),
      )
      .catch((error) => console.error("Failed to load dashboard", error));
  }, []);

  const cronLight = data?.cronClock.trafficLight ?? "warning";

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <TabView
        tabs={[
          {
            id: "statistics",
            label: "Statistics",
            content: (
              <div className="dashboard-grid">
                <Panel title="Project Count">
                  <div className="metric">{data?.projectCount ?? "—"}</div>
                </Panel>
                <Panel title="Agent-2-Agent Connection">
                  <div
                    className={`status-indicator ${data?.agentConnection ? "ok" : "error"}`}
                  >
                    <span className="light" />
                    {data?.agentConnection
                      ? "Connection established"
                      : "Connection lost"}
                  </div>
                </Panel>
                <Panel title="Cron Clock Status">
                  <div className={`status-indicator ${cronLight}`}>
                    <span className="light" />
                    {data?.cronClock.message ?? "Cron status unknown"}
                  </div>
                </Panel>
                <Panel title="Cron Jobs Started Since Startup">
                  <div className="metric">
                    {data?.cronClock.startedJobsSinceStartup ?? "—"}
                  </div>
                </Panel>
                <Panel title="MADE Home">
                  <div className="path-info">{data?.madeHome ?? "—"}</div>
                </Panel>
                <Panel title=".made Folder">
                  <div className="path-info">{data?.madeDirectory ?? "—"}</div>
                </Panel>
                <Panel title="Workspace Home">
                  <div className="path-info">{data?.workspaceHome ?? "—"}</div>
                </Panel>
              </div>
            ),
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  );
};
