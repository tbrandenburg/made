export interface BuildTaskParameter {
  name: string;
  required: boolean;
  choices: string[];
}

export interface BuildTaskTarget {
  name: string;
  description: string;
  parameters: BuildTaskParameter[];
  runnable: boolean;
  reason: string | null;
}

export interface BuildTaskFile {
  path: string;
  kind: "make" | "task";
  targets: BuildTaskTarget[];
  error: string | null;
}

export interface BuildTaskDiscovery {
  files: BuildTaskFile[];
  warnings: string[];
}

export interface BuildTaskRun {
  runId: string;
  pid: number;
  repository: string;
  file: string;
  kind: "make" | "task";
  target: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: "running" | "succeeded" | "failed" | "unknown";
  exitCode: number | null;
  logLocation: string;
  logName: string;
}
