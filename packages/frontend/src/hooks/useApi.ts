const API_BASE = '/api';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

type AgentReply = {
  messageId: string;
  sent: string;
  response: string;
  prompt?: string;
};

export const api = {
  getDashboard: () => request<{ projectCount: number; agentConnection: boolean; repositories: RepositorySummary[] }>(
    '/dashboard'
  ),
  listRepositories: () => request<{ repositories: RepositorySummary[] }>('/repositories'),
  createRepository: (name: string) => request<RepositorySummary>('/repositories', {
    method: 'POST',
    body: JSON.stringify({ name })
  }),
  getRepository: (name: string) => request<RepositorySummary>(`/repositories/${name}`),
  getRepositoryFiles: (name: string) => request<FileNode>(`/repositories/${name}/files`),
  readRepositoryFile: (name: string, filePath: string) => request<{ content: string }>(
    `/repositories/${name}/file?path=${encodeURIComponent(filePath)}`
  ),
  saveRepositoryFile: (name: string, filePath: string, content: string) =>
    request(`/repositories/${name}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content })
    }),
  createRepositoryFile: (name: string, filePath: string, content: string) =>
    request(`/repositories/${name}/file`, {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content })
    }),
  renameRepositoryFile: (name: string, from: string, to: string) =>
    request(`/repositories/${name}/file/rename`, {
      method: 'POST',
      body: JSON.stringify({ from, to })
    }),
  deleteRepositoryFile: (name: string, filePath: string) =>
    request(`/repositories/${name}/file`, {
      method: 'DELETE',
      body: JSON.stringify({ path: filePath })
    }),
  sendAgentMessage: (name: string, message: string) =>
    request<AgentReply>(`/repositories/${name}/agent`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),
  listKnowledge: () => request<{ artefacts: ArtefactSummary[] }>('/knowledge'),
  getKnowledge: (name: string) => request<MatterFile>(`/knowledge/${name}`),
  saveKnowledge: (name: string, payload: MatterFile) =>
    request(`/knowledge/${name}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  sendKnowledgeAgent: (name: string, message: string) =>
    request<AgentReply>(`/knowledge/${name}/agent`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),
  listConstitutions: () => request<{ constitutions: ArtefactSummary[] }>('/constitutions'),
  getConstitution: (name: string) => request<MatterFile>(`/constitutions/${name}`),
  saveConstitution: (name: string, payload: MatterFile) =>
    request(`/constitutions/${name}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  sendConstitutionAgent: (name: string, message: string) =>
    request<AgentReply>(`/constitutions/${name}/agent`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),
  getSettings: () => request<Record<string, unknown>>('/settings'),
  saveSettings: (settings: Record<string, unknown>) =>
    request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    })
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
  type: 'folder' | 'file';
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
