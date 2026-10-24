import { useEffect, useState } from "react";
import { api } from "../hooks/useApi";
import type { BuildTaskRun } from "../types/buildTasks";
import { Panel } from "./Panel";

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to load build tasks";

function RunOutput({ run }: { run: BuildTaskRun }) {
  const [tail, setTail] = useState("Loading output…");
  useEffect(() => {
    let active = true;
    const load = () => {
      void api.getBuildTaskRun(run.repository, run.runId).then(
        (detail) => {
          if (active) setTail(detail.tail || "No output yet.");
        },
        (error: unknown) => {
          if (active) setTail(errorMessage(error));
        },
      );
    };
    load();
    const timer =
      run.status === "running" ? window.setInterval(load, 2000) : undefined;
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [run.repository, run.runId, run.status]);
  return (
    <pre className="workflow-log-tail" aria-label={`Output for ${run.runId}`}>
      {tail}
    </pre>
  );
}

export function BuildTaskRuns({ runs }: { runs: BuildTaskRun[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Panel title="Runs">
      {!runs.length && <div className="empty">No build or task runs yet.</div>}
      <div className="build-task-runs harness-history">
        {runs.map((run) => (
          <article key={run.runId} aria-label={`${run.file} ${run.target} run`}>
            <div className="build-task-run-heading">
              <strong>
                {run.file} → {run.target}
              </strong>
              <span
                className={`build-task-status build-task-status--${run.status}`}
              >
                {run.status === "unknown"
                  ? "Unknown / interrupted"
                  : run.status[0].toUpperCase() + run.status.slice(1)}
              </span>
            </div>
            <div>
              PID {run.pid} · Exit {run.exitCode ?? "—"} ·{" "}
              {run.durationMs === null ? "Elapsed" : "Duration"}{" "}
              {(
                (run.durationMs ?? Date.now() - Date.parse(run.startedAt)) /
                1000
              ).toFixed(1)}
              s
            </div>
            <div>
              Started{" "}
              <time dateTime={run.startedAt}>
                {new Date(run.startedAt).toLocaleString()}
              </time>
              {run.finishedAt && (
                <>
                  {" "}
                  · Finished{" "}
                  <time dateTime={run.finishedAt}>
                    {new Date(run.finishedAt).toLocaleString()}
                  </time>
                </>
              )}
            </div>
            <small className="build-task-run-id">Run {run.runId}</small>
            {run.status === "unknown" && (
              <p>
                The backend cannot verify this run after restart. Inspect its
                output; PID existence is not used as proof.
              </p>
            )}
            <button
              className="secondary"
              aria-expanded={expanded === run.runId}
              onClick={() =>
                setExpanded(expanded === run.runId ? null : run.runId)
              }
            >
              View tail
            </button>
            {expanded === run.runId && <RunOutput run={run} />}
          </article>
        ))}
      </div>
    </Panel>
  );
}
