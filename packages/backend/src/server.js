const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const {
  listRepositories,
  getRepositoryInfo,
  createRepository,
  listRepositoryFiles,
  readRepositoryFile,
  writeRepositoryFile,
  createRepositoryFile,
  renameRepositoryFile,
  deleteRepositoryFile
} = require('./repositoryService');
const { listKnowledgeArtefacts, readKnowledgeArtefact, writeKnowledgeArtefact } = require('./knowledgeService');
const { listConstitutions, readConstitution, writeConstitution } = require('./constitutionService');
const { readSettings, writeSettings } = require('./settingsService');
const { getDashboardSummary } = require('./dashboardService');
const { sendAgentMessage } = require('./agentService');
const { getWorkspaceHome, getMadeDirectory, ensureMadeStructure } = require('./config');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', workspace: getWorkspaceHome(), made: getMadeDirectory() });
});

app.get('/api/dashboard', (_req, res) => {
  try {
    const summary = getDashboardSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/repositories', (_req, res) => {
  try {
    const repositories = listRepositories();
    res.json({ repositories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/repositories', (req, res) => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Repository name is required' });
    return;
  }
  try {
    const repository = createRepository(name);
    res.status(201).json(repository);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/repositories/:name', (req, res) => {
  try {
    const info = getRepositoryInfo(req.params.name);
    res.json(info);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get('/api/repositories/:name/files', (req, res) => {
  try {
    const tree = listRepositoryFiles(req.params.name);
    res.json(tree);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get('/api/repositories/:name/file', (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }
  try {
    const content = readRepositoryFile(req.params.name, filePath);
    res.json({ content });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.put('/api/repositories/:name/file', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }
  try {
    writeRepositoryFile(req.params.name, filePath, content || '');
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/repositories/:name/file', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }
  try {
    createRepositoryFile(req.params.name, filePath, content || '');
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/repositories/:name/file/rename', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) {
    res.status(400).json({ error: 'Both from and to paths are required' });
    return;
  }
  try {
    renameRepositoryFile(req.params.name, from, to);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/repositories/:name/file', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }
  try {
    deleteRepositoryFile(req.params.name, filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/repositories/:name/agent', (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }
  const reply = sendAgentMessage(req.params.name, message);
  res.json(reply);
});

app.get('/api/knowledge', (_req, res) => {
  try {
    const artefacts = listKnowledgeArtefacts();
    res.json({ artefacts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/knowledge/:name', (req, res) => {
  try {
    const artefact = readKnowledgeArtefact(req.params.name);
    res.json(artefact);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.put('/api/knowledge/:name', (req, res) => {
  const { frontmatter, content } = req.body;
  try {
    writeKnowledgeArtefact(req.params.name, frontmatter || {}, content || '');
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/knowledge/:name/agent', (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }
  const reply = sendAgentMessage(`knowledge:${req.params.name}`, message);
  res.json(reply);
});

app.get('/api/constitutions', (_req, res) => {
  try {
    const constitutions = listConstitutions();
    res.json({ constitutions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/constitutions/:name', (req, res) => {
  try {
    const constitution = readConstitution(req.params.name);
    res.json(constitution);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.put('/api/constitutions/:name', (req, res) => {
  const { frontmatter, content } = req.body;
  try {
    writeConstitution(req.params.name, frontmatter || {}, content || '');
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/constitutions/:name/agent', (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }
  const reply = sendAgentMessage(`constitution:${req.params.name}`, message);
  res.json(reply);
});

app.get('/api/settings', (_req, res) => {
  try {
    const settings = readSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    const settings = writeSettings(req.body || {});
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/bootstrap', (_req, res) => {
  try {
    ensureMadeStructure();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`MADE backend listening on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
