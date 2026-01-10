const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) || "/api";

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const maxRetries = 3;
  const retryDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
          "Content-Type": "application/json",
        },
        ...options,
      });

      if (!response.ok) {
        let message = await response.text();
        try {
          const parsed = JSON.parse(message);
          if (parsed?.detail) {
            message =
              typeof parsed.detail === "string"
                ? parsed.detail
                : JSON.stringify(parsed.detail);
          }
        } catch {
          // Ignore JSON parse errors and keep the raw message
        }

        if (response.status >= 500 && attempt < maxRetries) {
          console.log(
            `API attempt ${attempt} failed with status ${response.status}, retrying in ${retryDelay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        throw new Error(message || "Request failed");
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      const isNetworkError =
        error instanceof TypeError ||
        (error instanceof Error &&
          (error.message.includes("fetch") ||
            error.message.includes("Failed to fetch")));

      if (attempt < maxRetries && isNetworkError) {
        console.log(
          `API attempt ${attempt} failed due to network error, retrying in ${retryDelay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }

      throw error;
    }
  }

  throw new Error("Maximum retry attempts exceeded");
}

export type AgentResponsePart = {
  text: string;
  timestamp?: string;
  type?: "thinking" | "tool" | "final";
  partId?: string;
  callId?: string;
};

export type AgentReply = {
  messageId: string;
  sent: string;
  response: string;
  prompt?: string;
  responses?: AgentResponsePart[];
  sessionId?: string;
};

type AgentStatus = {
  processing: boolean;
  startedAt?: string | null;
};

export type ChatHistoryMessage = {
  messageId?: string;
  role: "user" | "assistant";
  type: "text" | "tool" | "tool_use";
  content: string;
  timestamp?: string | null;
  partId?: string;
  callId?: string;
};

export type ChatHistoryResponse = {
  sessionId: string;
  messages: ChatHistoryMessage[];
};

export type ChatSession = {
  id: string;
  title: string;
  updated: string;
};

export type CommandDefinition = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  argumentHint?: string | string[] | null;
};

export const api = {
  getDashboard: () =>
    request<{
      projectCount: number;
      agentConnection: boolean;
      repositories: RepositorySummary[];
      madeHome: string;
      workspaceHome: string;
      madeDirectory: string;
    }>("/dashboard"),
  listRepositories: () =>
    request<{ repositories: RepositorySummary[] }>("/repositories"),
  createRepository: (name: string) =>
    request<RepositorySummary>("/repositories", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  cloneRepository: (url: string, name?: string, branch?: string) =>
    request<RepositorySummary>("/repositories/clone", {
      method: "POST",
      body: JSON.stringify({ url, name, branch }),
    }),
  getRepository: (name: string) =>
    request<RepositorySummary>(`/repositories/${name}`),
  getRepositoryFiles: (name: string) =>
    request<FileNode>(`/repositories/${name}/files`),
  readRepositoryFile: (name: string, filePath: string) =>
    request<{ content: string }>(
      `/repositories/${name}/file?path=${encodeURIComponent(filePath)}`,
    ),
  saveRepositoryFile: (name: string, filePath: string, content: string) =>
    request(`/repositories/${name}/file`, {
      method: "PUT",
      body: JSON.stringify({ path: filePath, content }),
    }),
  createRepositoryFile: (name: string, filePath: string, content: string) =>
    request(`/repositories/${name}/file`, {
      method: "POST",
      body: JSON.stringify({ path: filePath, content }),
    }),
  renameRepositoryFile: (name: string, from: string, to: string) =>
    request(`/repositories/${name}/file/rename`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  deleteRepositoryFile: (name: string, filePath: string) =>
    request(`/repositories/${name}/file`, {
      method: "DELETE",
      body: JSON.stringify({ path: filePath }),
    }),
  sendAgentMessage: (name: string, message: string, sessionId?: string) =>
    request<AgentReply>(`/repositories/${name}/agent`, {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),
  getRepositoryAgentStatus: (name: string) =>
    request<AgentStatus>(`/repositories/${name}/agent/status`),
  cancelRepositoryAgent: (name: string) =>
    request(`/repositories/${name}/agent/cancel`, { method: "POST" }),
  getRepositoryAgentHistory: (
    name: string,
    sessionId: string,
    startTimestamp?: number,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ session_id: sessionId });
    if (typeof startTimestamp === "number" && Number.isFinite(startTimestamp)) {
      params.append("start", Math.floor(startTimestamp).toString());
    }

    return request<ChatHistoryResponse>(
      `/repositories/${name}/agent/history?${params.toString()}`,
      { signal },
    );
  },
  getKnowledgeAgentHistory: (
    name: string,
    sessionId: string,
    startTimestamp?: number,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ session_id: sessionId });
    if (typeof startTimestamp === "number" && Number.isFinite(startTimestamp)) {
      params.append("start", Math.floor(startTimestamp).toString());
    }

    return request<ChatHistoryResponse>(
      `/knowledge/${name}/agent/history?${params.toString()}`,
      { signal },
    );
  },
  getConstitutionAgentHistory: (
    name: string,
    sessionId: string,
    startTimestamp?: number,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ session_id: sessionId });
    if (typeof startTimestamp === "number" && Number.isFinite(startTimestamp)) {
      params.append("start", Math.floor(startTimestamp).toString());
    }

    return request<ChatHistoryResponse>(
      `/constitutions/${name}/agent/history?${params.toString()}`,
      { signal },
    );
  },
  getRepositoryAgentSessions: (name: string, limit = 10) => {
    const params = new URLSearchParams({ limit: String(limit) });
    return request<{ sessions: ChatSession[] }>(
      `/repositories/${name}/agent/sessions?${params.toString()}`,
    );
  },
  getKnowledgeAgentSessions: (name: string, limit = 10) => {
    const params = new URLSearchParams({ limit: String(limit) });
    return request<{ sessions: ChatSession[] }>(
      `/knowledge/${name}/agent/sessions?${params.toString()}`,
    );
  },
  getConstitutionAgentSessions: (name: string, limit = 10) => {
    const params = new URLSearchParams({ limit: String(limit) });
    return request<{ sessions: ChatSession[] }>(
      `/constitutions/${name}/agent/sessions?${params.toString()}`,
    );
  },
  getRepositoryCommands: (name: string) =>
    request<{ commands: CommandDefinition[] }>(
      `/repositories/${name}/commands`,
    ),
  listKnowledge: () => request<{ artefacts: ArtefactSummary[] }>("/knowledge"),
  getKnowledge: (name: string) => request<MatterFile>(`/knowledge/${name}`),
  saveKnowledge: (name: string, payload: MatterFile) =>
    request(`/knowledge/${name}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  sendKnowledgeAgent: (name: string, message: string, sessionId?: string) =>
    request<AgentReply>(`/knowledge/${name}/agent`, {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),
  getKnowledgeAgentStatus: (name: string) =>
    request<AgentStatus>(`/knowledge/${name}/agent/status`),
  cancelKnowledgeAgent: (name: string) =>
    request(`/knowledge/${name}/agent/cancel`, { method: "POST" }),
  listConstitutions: () =>
    request<{ constitutions: ArtefactSummary[] }>("/constitutions"),
  getConstitution: (name: string) =>
    request<MatterFile>(`/constitutions/${name}`),
  saveConstitution: (name: string, payload: MatterFile) =>
    request(`/constitutions/${name}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  sendConstitutionAgent: (name: string, message: string, sessionId?: string) =>
    request<AgentReply>(`/constitutions/${name}/agent`, {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),
  getConstitutionAgentStatus: (name: string) =>
    request<AgentStatus>(`/constitutions/${name}/agent/status`),
  cancelConstitutionAgent: (name: string) =>
    request(`/constitutions/${name}/agent/cancel`, { method: "POST" }),
  getSettings: () => request<Record<string, unknown>>("/settings"),
  saveSettings: (settings: Record<string, unknown>) =>
    request("/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};

export type RepositorySummary = {
  name: string;
  path: string;
  hasGit: boolean;
  lastCommit: string | null;
  technology: string;
  license: string;
};

export type FileNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  size?: number;
  children?: FileNode[];
};

export type ArtefactSummary = {
  name: string;
  type?: string;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
  content?: string;
};

export type MatterFile = {
  content: string;
  data?: Record<string, unknown>;
  frontmatter?: Record<string, unknown>;
};
