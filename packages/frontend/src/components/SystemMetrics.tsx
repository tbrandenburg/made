import { useEffect, useState } from "react";
import { api, type SystemMetrics as Metrics } from "../hooks/useApi";
import { Panel } from "./Panel";

const METRICS: [keyof Metrics, string][] = [
  ["cpuUtilization", "CPU utilization"],
  ["cpuPressure", "CPU pressure"],
  ["ramUtilization", "RAM utilization"],
  ["memoryPressure", "Memory pressure"],
  ["diskUtilization", "Disk space utilization"],
  ["ioPressure", "I/O pressure"],
];

export function SystemMetrics() {
  const [data, setData] = useState<Metrics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const metrics = await api.getSystemMetrics(controller.signal);
        if (!controller.signal.aborted) {
          setData(metrics);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setData(null);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  return (
    <section aria-label="System resources" className="system-resources">
      <h2>System resources</h2>
      <p>
        Overall system visible to the backend (host or VM in containers). Disk
        usage covers the workspace filesystem. Refreshes every 5 seconds.
      </p>
      <p>
        Pressure is the percentage of time at least one task was stalled over
        the last 10 seconds. Available on Linux with PSI enabled.
      </p>
      {failed && <p role="status">System metrics temporarily unavailable.</p>}
      <div className="dashboard-grid">
        {METRICS.map(([key, label]) => (
          <Panel key={key} title={label}>
            <div
              className={data?.[key] != null ? "metric" : "metric-unavailable"}
            >
              {data?.[key] != null ? `${data[key].toFixed(1)}%` : "Unavailable"}
            </div>
          </Panel>
        ))}
      </div>
    </section>
  );
}
