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
  model?: string;
  capture?: string;
  expandPrompt?: boolean;
  expandFields?: boolean;
  dangerouslySkipPermissions?: boolean;
};

export type WorkflowParam = {
  name: string;
  description?: string;
  required: boolean;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string | null;
  shellScriptPath?: string;
  steps: WorkflowStep[];
  description?: string;
  params?: WorkflowParam[];
};
