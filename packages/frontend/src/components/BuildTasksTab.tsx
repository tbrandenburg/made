import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../hooks/useApi";
import type {
  BuildTaskFile,
  BuildTaskRun,
  BuildTaskTarget,
} from "../types/buildTasks";
import { Panel } from "./Panel";
import { BuildTaskParameters } from "./BuildTaskParameters";
import { BuildTaskRuns, errorMessage } from "./BuildTaskRuns";
import "../styles/build-tasks.css";

type Selection = { file: BuildTaskFile; target: BuildTaskTarget };

// A keyed boundary prevents state and pending responses crossing repositories.
export function BuildTasksTab({ repository }: { repository: string }) {
  return <RepositoryBuildTasks key={repository} repository={repository} />;
}

function RepositoryBuildTasks({ repository }: { repository: string }) {
  const [files, setFiles] = useState<BuildTaskFile[]>([]);
  const [runs, setRuns] = useState<BuildTaskRun[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const launching = useRef(false);
  const generation = useRef(0);
  const history = useRef(0);

  const loadRuns = useCallback(async () => {
    const current = ++history.current;
    const response = await api.getBuildTaskRuns(repository);
    if (mounted.current && history.current === current) setRuns(response.runs);
  }, [repository]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const revision = ++history.current;
    setLoading(true);
    setError(null);
    try {
      const [discovery, recent] = await Promise.all([
        api.getBuildTasks(repository),
        api.getBuildTaskRuns(repository),
      ]);
      if (!mounted.current || generation.current !== current) return;
      setFiles(discovery.files);
      setWarnings(discovery.warnings);
      if (history.current === revision) setRuns(recent.runs);
    } catch (error) {
      if (mounted.current && generation.current === current)
        setError(errorMessage(error));
    } finally {
      if (mounted.current && generation.current === current) setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      generation.current++;
      history.current++;
    };
  }, [refresh]);

  const running = runs.some((run) => run.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void loadRuns().catch((error: unknown) => {
        if (mounted.current) setError(errorMessage(error));
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [running, loadRuns]);

  const launch = async (
    chosen: Selection,
    parameters: Record<string, string>,
  ) => {
    if (launching.current) return;
    launching.current = true;
    history.current++;
    setPending(true);
    setError(null);
    try {
      const run = await api.runBuildTask(
        repository,
        chosen.file.path,
        chosen.target.name,
        parameters,
      );
      if (!mounted.current) return;
      setRuns((previous) =>
        [run, ...previous.filter((entry) => entry.runId !== run.runId)].slice(
          0,
          10,
        ),
      );
      setSelection(null);
      await loadRuns();
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      launching.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const choose = (chosen: Selection) => {
    if (!chosen.target.parameters.length) {
      void launch(chosen, {});
      return;
    }
    setError(null);
    setSelection(chosen);
  };

  return (
    <div className="build-tasks">
      <Panel
        title="Build & Tasks"
        actions={
          <button
            className="secondary"
            onClick={() => void refresh()}
            disabled={loading || pending}
          >
            Refresh
          </button>
        }
      >
        <p>
          Run repository-authored code directly on the backend, not in agent
          chat. Only run targets you trust. Output can contain secrets.
        </p>
        {loading && <p role="status">Discovering build files…</p>}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
        {!loading && !error && !files.length && (
          <div className="empty">
            No supported Makefiles or Taskfiles found.
          </div>
        )}
      </Panel>
      {files.map((file) => (
        <Panel
          key={file.path}
          title={`${file.path.split("/").pop()} · ${file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "."}`}
        >
          <span className="command-meta">
            {file.kind === "make" ? "GNU Make" : "go-task"} · {file.path}
          </span>
          {file.error && <div className="alert error">{file.error}</div>}
          {!file.error && !file.targets.length && (
            <div className="empty">
              No supported public targets in this file.
            </div>
          )}
          <div className="commands-grid">
            {file.targets.map((target) => (
              <button
                key={target.name}
                className="primary command-button"
                disabled={pending || !target.runnable}
                title={target.reason || target.description}
                aria-label={`Run ${file.path} ${target.name}`}
                onClick={() => choose({ file, target })}
              >
                <span className="command-button__badges">
                  <span className="command-button__badge">{file.kind}</span>
                  {target.parameters.length > 0 && (
                    <span className="command-button__badge command-button__badge--args">
                      Args
                    </span>
                  )}
                </span>
                <span className="command-button__title">{target.name}</span>
                {target.description && (
                  <span className="command-button__description">
                    {target.description}
                  </span>
                )}
                {target.reason && (
                  <span className="command-button__description">
                    {target.reason}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Panel>
      ))}
      <BuildTaskRuns runs={runs} />
      {selection && (
        <BuildTaskParameters
          target={selection.target}
          pending={pending}
          error={error}
          close={() => setSelection(null)}
          launch={(values) => void launch(selection, values)}
        />
      )}
    </div>
  );
}
