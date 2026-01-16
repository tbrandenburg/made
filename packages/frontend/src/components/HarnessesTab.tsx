import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "./Panel";
import { Modal } from "./Modal";
import { HarnessDefinition } from "../hooks/useApi";

type HarnessRun = {
  pid: number;
  name: string;
  path: string;
  startedAt: string;
};

type HarnessesTabProps = {
  loadHarnesses: () => Promise<HarnessDefinition[]>;
  runHarness: (
    harnessPath: string,
    args?: string,
  ) => Promise<{ pid: number; name: string; path: string }>;
  getHarnessStatus: (pid: number) => Promise<{ pid: number; running: boolean }>;
  historyStorageKey: string;
  maxHistory?: number;
};

const formatHarnessTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown time";
  return new Date(parsed).toLocaleString();
};

export const HarnessesTab: React.FC<HarnessesTabProps> = ({
  loadHarnesses,
  runHarness,
  getHarnessStatus,
  historyStorageKey,
  maxHistory = 10,
}) => {
  const [availableHarnesses, setAvailableHarnesses] = useState<
    HarnessDefinition[]
  >([]);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [harnessLoading, setHarnessLoading] = useState(false);
  const [harnessRunError, setHarnessRunError] = useState<string | null>(null);
  const [harnessStatuses, setHarnessStatuses] = useState<
    Record<number, boolean | undefined>
  >({});
  const [harnessModal, setHarnessModal] = useState<{
    open: boolean;
    harness: HarnessDefinition | null;
    args: string;
  }>({
    open: false,
    harness: null,
    args: "",
  });

  const readHarnessHistory = useCallback(() => {
    if (!historyStorageKey) return [];
    try {
      const stored = localStorage.getItem(historyStorageKey);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (entry) =>
            entry &&
            typeof entry.pid === "number" &&
            typeof entry.name === "string" &&
            typeof entry.path === "string" &&
            typeof entry.startedAt === "string",
        )
        .slice(0, maxHistory);
    } catch (error) {
      console.warn("Failed to read harness history", error);
      return [];
    }
  }, [historyStorageKey, maxHistory]);

  const [harnessHistory, setHarnessHistory] = useState<HarnessRun[]>(() =>
    readHarnessHistory(),
  );
  const skipHarnessHistoryPersist = useRef(true);

  const fetchHarnesses = useCallback(() => {
    setHarnessLoading(true);
    loadHarnesses()
      .then((response) => {
        setAvailableHarnesses(response);
        setHarnessError(null);
      })
      .catch((error) => {
        console.error("Failed to load harnesses", error);
        const message =
          error instanceof Error ? error.message : "Failed to load harnesses";
        setHarnessError(message);
      })
      .finally(() => setHarnessLoading(false));
  }, [loadHarnesses]);

  useEffect(() => {
    fetchHarnesses();
  }, [fetchHarnesses]);

  useEffect(() => {
    skipHarnessHistoryPersist.current = true;
    setHarnessHistory(readHarnessHistory());
  }, [readHarnessHistory]);

  useEffect(() => {
    if (!historyStorageKey) return;
    if (skipHarnessHistoryPersist.current) {
      skipHarnessHistoryPersist.current = false;
      return;
    }
    try {
      if (harnessHistory.length) {
        localStorage.setItem(
          historyStorageKey,
          JSON.stringify(harnessHistory),
        );
      } else {
        localStorage.removeItem(historyStorageKey);
      }
    } catch (error) {
      console.warn("Failed to persist harness history", error);
    }
  }, [harnessHistory, historyStorageKey]);

  const refreshHarnessStatuses = useCallback(async () => {
    if (!harnessHistory.length) return;
    const updates = await Promise.all(
      harnessHistory.map(async (entry) => {
        try {
          const response = await getHarnessStatus(entry.pid);
          return { pid: entry.pid, running: response.running };
        } catch (error) {
          console.error("Failed to fetch harness status", error);
          return { pid: entry.pid, running: false };
        }
      }),
    );
    setHarnessStatuses((prev) => {
      const next = { ...prev };
      updates.forEach((update) => {
        if (update) {
          next[update.pid] = update.running;
        }
      });
      return next;
    });
  }, [getHarnessStatus, harnessHistory]);

  useEffect(() => {
    if (!harnessHistory.length) return;
    let active = true;
    const refreshIfActive = async () => {
      if (!active) return;
      await refreshHarnessStatuses();
    };

    refreshIfActive();
    const interval = window.setInterval(refreshIfActive, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [harnessHistory, refreshHarnessStatuses]);

  const openHarnessModal = (harness: HarnessDefinition) => {
    setHarnessModal({
      open: true,
      harness,
      args: "",
    });
  };

  const closeHarnessModal = () =>
    setHarnessModal({ open: false, harness: null, args: "" });

  const handleHarnessRun = async () => {
    if (!harnessModal.harness) return;
    setHarnessRunError(null);
    try {
      const argsValue = harnessModal.args;
      const response = await runHarness(
        harnessModal.harness.path,
        argsValue.trim() ? argsValue : undefined,
      );
      const entry: HarnessRun = {
        pid: response.pid,
        name: response.name || harnessModal.harness.name,
        path: response.path || harnessModal.harness.path,
        startedAt: new Date().toISOString(),
      };
      setHarnessHistory((prev) => [entry, ...prev].slice(0, maxHistory));
      setHarnessStatuses((prev) => ({ ...prev, [entry.pid]: true }));
      closeHarnessModal();
    } catch (error) {
      console.error("Failed to run harness", error);
      const message =
        error instanceof Error ? error.message : "Failed to run harness";
      setHarnessRunError(message);
    }
  };

  const refreshDisabled = useMemo(
    () => !harnessHistory.length,
    [harnessHistory.length],
  );

  return (
    <div className="harness-center">
      <Panel
        title="Harness Scripts"
        actions={
          <button
            className="secondary"
            onClick={fetchHarnesses}
            disabled={harnessLoading}
          >
            Refresh
          </button>
        }
      >
        {harnessLoading && <div className="alert">Loading harnesses...</div>}
        {harnessError && <div className="alert error">{harnessError}</div>}
        {harnessRunError && <div className="alert error">{harnessRunError}</div>}
        {!harnessLoading && !harnessError && (
          <>
            {availableHarnesses.length === 0 ? (
              <div className="empty">
                No harness scripts found in configured directories.
              </div>
            ) : (
              <div className="commands-grid">
                {availableHarnesses.map((harness) => (
                  <button
                    key={harness.id}
                    className="primary command-button"
                    title={`${harness.source} • ${harness.path}`}
                    onClick={() => openHarnessModal(harness)}
                  >
                    <span className="command-button__title">{harness.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Panel>
      <Panel
        title="Harness Runs"
        actions={
          <button
            className="secondary"
            onClick={refreshHarnessStatuses}
            disabled={refreshDisabled}
          >
            Refresh
          </button>
        }
      >
        <div className="harness-history">
          {harnessHistory.length === 0 ? (
            <div className="empty">No harness runs yet.</div>
          ) : (
            <div className="harness-history__list">
              {harnessHistory.map((entry) => {
                const running = harnessStatuses[entry.pid];
                const statusClass =
                  running === undefined
                    ? "pending"
                    : running
                      ? "running"
                      : "done";
                const statusIcon =
                  running === undefined ? "…" : running ? "●" : "✓";
                const statusLabel =
                  running === undefined
                    ? "Checking status"
                    : running
                      ? "Running"
                      : "Finished";
                return (
                  <div
                    className="harness-pill"
                    key={`${entry.pid}-${entry.startedAt}`}
                  >
                    <span
                      className={`harness-status ${statusClass}`}
                      title={statusLabel}
                      aria-label={statusLabel}
                    >
                      {statusIcon}
                    </span>
                    <span className="harness-pill__label">
                      PID {entry.pid} • {entry.name}
                    </span>
                    <span className="harness-pill__timestamp">
                      {formatHarnessTimestamp(entry.startedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      <Modal
        open={harnessModal.open}
        title={`Run Harness${harnessModal.harness ? `: ${harnessModal.harness.name}` : ""}`}
        onClose={closeHarnessModal}
      >
        <div className="form-group">
          <label htmlFor="harness-args">Arguments</label>
          <textarea
            id="harness-args"
            value={harnessModal.args}
            onChange={(event) =>
              setHarnessModal((prev) => ({
                ...prev,
                args: event.target.value,
              }))
            }
            placeholder="Optional arguments, e.g. --verbose --limit 10"
            rows={4}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={closeHarnessModal}>
            Cancel
          </button>
          <button className="primary" onClick={handleHarnessRun}>
            Run
          </button>
        </div>
      </Modal>
    </div>
  );
};
