export type WorkflowStep = {
  type: "agent" | "bash" | "vars" | "for" | "while" | "parallel";
  agent?: string;
  varName?: string;
  command?: string;
  prompt?: string;
  run?: string;
  values?: Record<string, string>;
  when?: string;
  in?: string;
  item?: string;
  condition?: string;
  steps?: WorkflowStep[];
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  shellScriptPath?: string;
  steps: WorkflowStep[];
};
