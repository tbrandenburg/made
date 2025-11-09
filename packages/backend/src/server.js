import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  listRepositories,
  createRepository,
  listRepositoryFiles,
  readRepositoryFile,
  writeRepositoryFile,
  deleteRepositoryFile,
  renameRepositoryFile,
  listArtefacts,
  getArtefact,
  saveArtefact,
  listConstitutions,
  getConstitution,
  saveConstitution,
  readSettings,
  writeSettings,
  sendAgentMessage
} from './index.js';
import { resolveMadeDataDir, resolveWorkspaceHome } from './config.js';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

app.get('/api/repositories', async (req, res) => {
  try {
    const repos = await listRepositories();
    res.json(repos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/repositories', async (req, res) => {
  try {
    const { name } = req.body;
    const repoPath = await createRepository(name);
    res.json({ path: repoPath });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/repositories/:repo/files', async (req, res) => {
  try {
    const files = await listRepositoryFiles(req.params.repo);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repositories/:repo/files/*', async (req, res) => {
  try {
    const relativePath = req.params[0];
    const content = await readRepositoryFile(req.params.repo, relativePath);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/repositories/:repo/files/*', async (req, res) => {
  try {
    const relativePath = req.params[0];
    await writeRepositoryFile(req.params.repo, relativePath, req.body.content || '');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/repositories/:repo/files/*', async (req, res) => {
  try {
    const relativePath = req.params[0];
    await deleteRepositoryFile(req.params.repo, relativePath);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/repositories/:repo/rename', async (req, res) => {
  try {
    const { from, to } = req.body;
    await renameRepositoryFile(req.params.repo, from, to);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/knowledge', async (req, res) => {
  try {
    const artefacts = await listArtefacts();
    res.json(artefacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/knowledge/:name', async (req, res) => {
  try {
    const artefact = await getArtefact(req.params.name);
    res.json({
      content: artefact.content,
      data: artefact.data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/knowledge/:name', async (req, res) => {
  try {
    const { data, content } = req.body;
    await saveArtefact(req.params.name, data, content);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/constitutions', async (req, res) => {
  try {
    const constitutions = await listConstitutions();
    res.json(constitutions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/constitutions/:name', async (req, res) => {
  try {
    const constitution = await getConstitution(req.params.name);
    res.json({
      content: constitution.content,
      data: constitution.data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/constitutions/:name', async (req, res) => {
  try {
    const { data, content } = req.body;
    await saveConstitution(req.params.name, data, content);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await readSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const saved = await writeSettings(req.body);
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent', async (req, res) => {
  try {
    const { context, prompt } = req.body;
    const payload = await sendAgentMessage({ context, prompt });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';

async function bootstrap() {
  await fsp.mkdir(resolveMadeDataDir(), { recursive: true });
  const workspace = resolveWorkspaceHome();
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.mkdir(path.join(resolveMadeDataDir(), 'constitutions'), { recursive: true });
  const entries = await fsp.readdir(workspace).catch(() => []);
  if (entries.length === 0) {
    const sampleRepo = path.join(workspace, 'sample-project');
    await fsp.mkdir(sampleRepo, { recursive: true });
    await fsp.writeFile(path.join(sampleRepo, 'README.md'), '# Sample Project\nThis is a starter repository for MADE.');
    const knowledgeDir = path.join(resolveMadeDataDir(), 'knowledge');
    await fsp.mkdir(knowledgeDir, { recursive: true });
    await fsp.writeFile(path.join(knowledgeDir, 'welcome.md'), '---\ntype: internal\ntags: [intro]\n---\n# Welcome to MADE\nUse the knowledge base to store artefacts.');
    const constitutionsDir = path.join(resolveMadeDataDir(), 'constitutions');
    await fsp.mkdir(constitutionsDir, { recursive: true });
    await fsp.writeFile(path.join(constitutionsDir, 'global.md'), '---\nscope: global\n---\n# MADE Constitution\nEnsure agents collaborate responsibly.');
  }
}

bootstrap().finally(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Backend listening on http://${HOST}:${PORT}`);
  });
});
