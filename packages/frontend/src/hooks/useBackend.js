const API_BASE = '/api';

async function handleResponse(response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Unknown error');
  }
  return response.json();
}

export async function fetchRepositories() {
  const response = await fetch(`${API_BASE}/repositories`);
  return handleResponse(response);
}

export async function createRepositoryRequest(name) {
  const response = await fetch(`${API_BASE}/repositories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  return handleResponse(response);
}

export async function fetchRepositoryFiles(repo) {
  const response = await fetch(`${API_BASE}/repositories/${encodeURIComponent(repo)}/files`);
  return handleResponse(response);
}

export async function readRepositoryFile(repo, path) {
  const response = await fetch(`${API_BASE}/repositories/${encodeURIComponent(repo)}/files/${path}`);
  return handleResponse(response);
}

export async function writeRepositoryFile(repo, path, content) {
  const response = await fetch(`${API_BASE}/repositories/${encodeURIComponent(repo)}/files/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  return handleResponse(response);
}

export async function deleteRepositoryFileRequest(repo, path) {
  const response = await fetch(`${API_BASE}/repositories/${encodeURIComponent(repo)}/files/${path}`, {
    method: 'DELETE'
  });
  return handleResponse(response);
}

export async function renameRepositoryFileRequest(repo, from, to) {
  const response = await fetch(`${API_BASE}/repositories/${encodeURIComponent(repo)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to })
  });
  return handleResponse(response);
}

export async function fetchKnowledgeArtefacts() {
  const response = await fetch(`${API_BASE}/knowledge`);
  return handleResponse(response);
}

export async function fetchKnowledgeArtefact(name) {
  const response = await fetch(`${API_BASE}/knowledge/${name}`);
  return handleResponse(response);
}

export async function saveKnowledgeArtefact(name, data, content) {
  const response = await fetch(`${API_BASE}/knowledge/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, content })
  });
  return handleResponse(response);
}

export async function fetchConstitutions() {
  const response = await fetch(`${API_BASE}/constitutions`);
  return handleResponse(response);
}

export async function fetchConstitution(name) {
  const response = await fetch(`${API_BASE}/constitutions/${name}`);
  return handleResponse(response);
}

export async function saveConstitution(name, data, content) {
  const response = await fetch(`${API_BASE}/constitutions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, content })
  });
  return handleResponse(response);
}

export async function fetchSettings() {
  const response = await fetch(`${API_BASE}/settings`);
  return handleResponse(response);
}

export async function saveSettings(settings) {
  const response = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
  return handleResponse(response);
}

export async function sendAgentPrompt(context, prompt) {
  const response = await fetch(`${API_BASE}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, prompt })
  });
  return handleResponse(response);
}
