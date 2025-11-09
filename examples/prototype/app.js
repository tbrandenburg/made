// MADE Frontend Application
// API Configuration
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api' 
    : '/api';

// Demo mode (set to true for standalone browser demo without backend)
const DEMO_MODE = true;

// Application State
const state = {
    currentPage: 'homepage',
    currentRepo: null,
    currentArtefact: null,
    currentConstitution: null,
    currentFile: null,
    fileModified: false,
    selectedFileForAction: null,
    repositories: [],
    artefacts: [],
    constitutions: [],
    chatHistory: {},
    artefactChatHistory: {},
    constitutionChatHistory: {},
    agentConnected: false,
    fileStructure: {},
    expandedFolders: {},
    settings: {
        theme: 'auto',
        apiEndpoint: 'http://localhost:3000',
        enableNotifications: true
    }
};

// API Functions
async function apiRequest(endpoint, options = {}) {
    // Demo mode: Return mock data
    if (DEMO_MODE) {
        return mockApiRequest(endpoint, options);
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// Mock API for demo mode
function mockApiRequest(endpoint, options = {}) {
    return new Promise((resolve) => {
        setTimeout(() => {
            if (endpoint === '/repositories') {
                if (options.method === 'POST') {
                    const body = JSON.parse(options.body);
                    const newRepo = {
                        id: 'repo-' + Date.now(),
                        name: body.name,
                        hasGit: false,
                        lastCommit: null,
                        technology: null,
                        license: null
                    };
                    state.repositories.push(newRepo);
                    resolve(newRepo);
                } else {
                    resolve({ repositories: state.repositories });
                }
            } else if (endpoint.startsWith('/repositories/') && endpoint.endsWith('/files')) {
                const repoId = endpoint.split('/')[2];
                resolve({ 
                    files: mockFileStructure[repoId] || [
                        { name: 'README.md', path: 'README.md', type: 'markdown', size: '2.4 KB' },
                        { name: 'src', path: 'src', type: 'folder', children: [
                            { name: 'index.js', path: 'src/index.js', type: 'javascript', size: '1.2 KB' },
                            { name: 'utils.js', path: 'src/utils.js', type: 'javascript', size: '856 bytes' }
                        ]},
                        { name: 'package.json', path: 'package.json', type: 'json', size: '543 bytes' }
                    ]
                });
            } else if (endpoint.startsWith('/files/')) {
                const pathMatch = endpoint.match(/\/files\/([^\/]+)\/(.+)/);
                if (pathMatch && options.method === 'DELETE') {
                    resolve({ success: true });
                } else if (pathMatch) {
                    const filePath = decodeURIComponent(pathMatch[2]);
                    resolve({ content: `// Mock content for ${filePath}\n\nfunction example() {\n  console.log('Hello MADE');\n}` });
                } else if (options.method === 'PUT') {
                    resolve({ success: true });
                } else if (options.method === 'POST') {
                    resolve({ success: true });
                }
            } else if (endpoint.startsWith('/files/') && endpoint.includes('/rename')) {
                resolve({ success: true });
            } else if (endpoint === '/artefacts') {
                if (options.method === 'POST') {
                    const body = JSON.parse(options.body);
                    const newArtefact = { id: 'art-' + Date.now(), ...body };
                    state.artefacts.push(newArtefact);
                    resolve(newArtefact);
                } else {
                    resolve({ artefacts: state.artefacts });
                }
            } else if (endpoint.startsWith('/artefacts/')) {
                resolve({ success: true });
            } else if (endpoint === '/constitutions') {
                if (options.method === 'POST') {
                    const body = JSON.parse(options.body);
                    const newConst = { id: 'const-' + Date.now(), ...body };
                    state.constitutions.push(newConst);
                    resolve(newConst);
                } else {
                    resolve({ constitutions: state.constitutions });
                }
            } else if (endpoint.startsWith('/constitutions/')) {
                resolve({ success: true });
            } else if (endpoint === '/agent/status') {
                resolve({ connected: true });
            }
            resolve({ success: true });
        }, 300);
    });
}

const mockFileStructure = {};

async function fetchRepositories() {
    try {
        const data = await apiRequest('/repositories');
        state.repositories = data.repositories || [];
        updateDashboard();
        return state.repositories;
    } catch (error) {
        console.error('Failed to fetch repositories:', error);
        if (DEMO_MODE && state.repositories.length === 0) {
            // Initialize demo repositories
            state.repositories = [
                {
                    id: 'repo-demo-1',
                    name: 'my-web-app',
                    hasGit: true,
                    lastCommit: '2024-11-08',
                    technology: 'NodeJS',
                    license: 'MIT'
                },
                {
                    id: 'repo-demo-2',
                    name: 'python-ml-project',
                    hasGit: true,
                    lastCommit: '2024-11-06',
                    technology: 'Python',
                    license: 'Apache-2.0'
                },
                {
                    id: 'repo-demo-3',
                    name: 'new-folder',
                    hasGit: false,
                    lastCommit: null,
                    technology: null,
                    license: null
                }
            ];
            updateDashboard();
        }
        return state.repositories;
    }
}

async function createRepositoryAPI(name) {
    try {
        const data = await apiRequest('/repositories', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        return data;
    } catch (error) {
        console.error('Failed to create repository:', error);
        throw error;
    }
}

async function fetchRepositoryFiles(repoId) {
    try {
        const data = await apiRequest(`/repositories/${repoId}/files`);
        return data.files || [];
    } catch (error) {
        console.error('Failed to fetch files:', error);
        return [];
    }
}

async function fetchFileContent(repoId, filePath) {
    try {
        const encodedPath = encodeURIComponent(filePath);
        const data = await apiRequest(`/files/${repoId}/${encodedPath}`);
        return data.content;
    } catch (error) {
        console.error('Failed to fetch file content:', error);
        return '';
    }
}

async function saveFileAPI(repoId, filePath, content) {
    try {
        await apiRequest(`/files/${repoId}`, {
            method: 'PUT',
            body: JSON.stringify({ path: filePath, content })
        });
        return true;
    } catch (error) {
        console.error('Failed to save file:', error);
        throw error;
    }
}

async function createFileAPI(repoId, filePath, content = '') {
    try {
        await apiRequest('/files', {
            method: 'POST',
            body: JSON.stringify({ repoId, path: filePath, content })
        });
        return true;
    } catch (error) {
        console.error('Failed to create file:', error);
        throw error;
    }
}

async function deleteFileAPI(repoId, filePath) {
    try {
        const encodedPath = encodeURIComponent(filePath);
        await apiRequest(`/files/${repoId}/${encodedPath}`, {
            method: 'DELETE'
        });
        return true;
    } catch (error) {
        console.error('Failed to delete file:', error);
        throw error;
    }
}

async function renameFileAPI(repoId, oldPath, newPath) {
    try {
        await apiRequest(`/files/${repoId}/rename`, {
            method: 'POST',
            body: JSON.stringify({ oldPath, newPath })
        });
        return true;
    } catch (error) {
        console.error('Failed to rename file:', error);
        throw error;
    }
}

async function fetchArtefacts() {
    try {
        const data = await apiRequest('/artefacts');
        state.artefacts = data.artefacts || [];
        return state.artefacts;
    } catch (error) {
        console.error('Failed to fetch artefacts:', error);
        if (DEMO_MODE && state.artefacts.length === 0) {
            // Initialize demo artefacts
            state.artefacts = [
                {
                    id: 'art-demo-1',
                    name: 'API Documentation',
                    type: 'internal',
                    filename: 'api-docs.md',
                    tags: ['api', 'documentation'],
                    content: '---\ntitle: API Documentation\ntype: internal\n---\n\n# API Documentation\n\nThis artefact contains API documentation.'
                },
                {
                    id: 'art-demo-2',
                    name: 'Architecture Guidelines',
                    type: 'internal',
                    filename: 'architecture.md',
                    tags: ['architecture', 'design'],
                    content: '---\ntitle: Architecture Guidelines\ntype: internal\n---\n\n# Architecture Guidelines\n\nSystem architecture and design patterns.'
                }
            ];
        }
        return state.artefacts;
    }
}

async function fetchConstitutions() {
    try {
        const data = await apiRequest('/constitutions');
        state.constitutions = data.constitutions || [];
        return state.constitutions;
    } catch (error) {
        console.error('Failed to fetch constitutions:', error);
        if (DEMO_MODE && state.constitutions.length === 0) {
            // Initialize demo constitutions
            state.constitutions = [
                {
                    id: 'const-demo-1',
                    name: 'Code Quality Standards',
                    category: 'guidelines',
                    filename: 'code-quality.md',
                    content: '---\ntitle: Code Quality Standards\ncategory: guidelines\n---\n\n# Code Quality Standards\n\n## Rules\n1. Write clean, maintainable code\n2. Follow consistent style guides\n3. Write comprehensive tests'
                },
                {
                    id: 'const-demo-2',
                    name: 'Security Constraints',
                    category: 'constraints',
                    filename: 'security.md',
                    content: '---\ntitle: Security Constraints\ncategory: constraints\n---\n\n# Security Constraints\n\n## Requirements\n- Never commit secrets\n- Use environment variables\n- Follow OWASP guidelines'
                }
            ];
        }
        return state.constitutions;
    }
}

async function saveArtefactAPI(artefact) {
    try {
        if (artefact.id) {
            await apiRequest(`/artefacts/${artefact.id}`, {
                method: 'PUT',
                body: JSON.stringify(artefact)
            });
        } else {
            await apiRequest('/artefacts', {
                method: 'POST',
                body: JSON.stringify(artefact)
            });
        }
        return true;
    } catch (error) {
        console.error('Failed to save artefact:', error);
        throw error;
    }
}

async function saveConstitutionAPI(constitution) {
    try {
        if (constitution.id) {
            await apiRequest(`/constitutions/${constitution.id}`, {
                method: 'PUT',
                body: JSON.stringify(constitution)
            });
        } else {
            await apiRequest('/constitutions', {
                method: 'POST',
                body: JSON.stringify(constitution)
            });
        }
        return true;
    } catch (error) {
        console.error('Failed to save constitution:', error);
        throw error;
    }
}

async function checkAgentConnection() {
    try {
        const data = await apiRequest('/agent/status');
        state.agentConnected = data.connected || false;
        updateAgentStatus();
    } catch (error) {
        state.agentConnected = false;
        updateAgentStatus();
    }
}

function updateAgentStatus() {
    const statusLight = document.getElementById('agentStatus');
    if (statusLight) {
        statusLight.className = 'traffic-light ' + (state.agentConnected ? 'green' : 'red');
    }
}

// Theme Management
function changeTheme(theme) {
    state.settings.theme = theme;
    applyTheme();
}

function applyTheme() {
    const root = document.documentElement;
    
    if (state.settings.theme === 'light') {
        root.setAttribute('data-color-scheme', 'light');
    } else if (state.settings.theme === 'dark') {
        root.setAttribute('data-color-scheme', 'dark');
    } else {
        root.removeAttribute('data-color-scheme');
    }
}

// Settings Management
function loadSettings() {
    document.getElementById('settingApiEndpoint').value = state.settings.apiEndpoint;
    
    // Environment variables
    if (DEMO_MODE) {
        document.getElementById('settingMadeHome').value = '~/.made (demo mode)';
        document.getElementById('settingWorkspaceHome').value = '~/projects (demo mode)';
        document.getElementById('envMode').textContent = 'Demo (Browser-only)';
    } else {
        document.getElementById('settingMadeHome').value = process.env.MADE_HOME || process.cwd();
        document.getElementById('settingWorkspaceHome').value = process.env.MADE_WORKSPACE_HOME || process.cwd();
        document.getElementById('envMode').textContent = 'Production';
    }
    
    if (state.settings.theme === 'light') {
        document.getElementById('themeLight').checked = true;
    } else if (state.settings.theme === 'dark') {
        document.getElementById('themeDark').checked = true;
    } else {
        document.getElementById('themeAuto').checked = true;
    }
    
    if (state.settings.enableNotifications) {
        document.getElementById('notifYes').checked = true;
    } else {
        document.getElementById('notifNo').checked = true;
    }
}

function saveSettings() {
    state.settings.apiEndpoint = document.getElementById('settingApiEndpoint').value;
    
    const notifRadios = document.getElementsByName('notifications');
    for (const radio of notifRadios) {
        if (radio.checked) {
            state.settings.enableNotifications = radio.value === 'true';
            break;
        }
    }
    
    alert('Settings saved successfully!');
}

// Sidebar Functions
function openSidebar() {
    document.getElementById('sidebar').classList.add('active');
    document.getElementById('sidebarOverlay').classList.add('active');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('active');
    document.getElementById('sidebarOverlay').classList.remove('active');
}

// Navigation
function navigateTo(page) {
    state.currentPage = page;
    
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (event && event.target && event.target.closest) {
        event.target.closest('.nav-item').classList.add('active');
    }
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page + 'Page').classList.add('active');
    
    updateBreadcrumb();
    
    if (page === 'homepage') updateHomepage();
    else if (page === 'repositories') renderRepositories();
    else if (page === 'knowledge') renderArtefacts();
    else if (page === 'constitution') renderConstitutions();
    else if (page === 'dashboard') updateDashboard();
    
    closeSidebar();
}

// Navigate to homepage from breadcrumb
function navigateToHomepage(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }
    // Explicitly navigate to homepage
    state.currentPage = 'homepage';
    
    // Update sidebar
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const homeNavItem = document.querySelector('.nav-item[onclick*="homepage"]');
    if (homeNavItem) homeNavItem.classList.add('active');
    
    // Show homepage
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('homepagePage').classList.add('active');
    
    updateBreadcrumb();
    updateHomepage();
    closeSidebar();
    
    return false;
}

// Navigate to a page from homepage panels
function navigateToPage(page) {
    state.currentPage = page;
    
    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Find and activate the matching nav item
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const itemText = item.textContent.trim().toLowerCase();
        if ((page === 'dashboard' && itemText.includes('dashboard')) ||
            (page === 'repositories' && itemText.includes('repositories')) ||
            (page === 'knowledge' && itemText.includes('knowledge')) ||
            (page === 'constitution' && itemText.includes('constitution')) ||
            (page === 'settings' && itemText.includes('settings'))) {
            item.classList.add('active');
        }
    });
    
    // Show the correct page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page + 'Page').classList.add('active');
    
    updateBreadcrumb();
    
    // Load page-specific data
    if (page === 'repositories') renderRepositories();
    else if (page === 'knowledge') renderArtefacts();
    else if (page === 'constitution') renderConstitutions();
    else if (page === 'dashboard') updateDashboard();
    else if (page === 'settings') loadSettings();
    
    closeSidebar();
}

function navigateToRepo(repoId) {
    state.currentRepo = state.repositories.find(r => r.id === repoId);
    state.currentPage = 'repositorySubPage';
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('repositorySubPage').classList.add('active');
    
    switchRepoTab('agent');
    renderRepoChat();
    loadRepositoryFiles();
    
    updateBreadcrumb();
    closeSidebar();
}

function navigateToArtefact(artefactId) {
    state.currentArtefact = state.artefacts.find(a => a.id === artefactId);
    state.currentPage = 'artefactSubPage';
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('artefactSubPage').classList.add('active');
    
    switchArtefactTab('content');
    loadArtefactContent();
    
    updateBreadcrumb();
    closeSidebar();
}

function navigateToConstitution(constitutionId) {
    state.currentConstitution = state.constitutions.find(c => c.id === constitutionId);
    state.currentPage = 'constitutionSubPage';
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('constitutionSubPage').classList.add('active');
    
    switchConstitutionTab('content');
    loadConstitutionContent();
    
    updateBreadcrumb();
    closeSidebar();
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    const parts = [];
    
    // MADE link: clickable when NOT on homepage, plain text when on homepage
    if (state.currentPage === 'homepage') {
        parts.push('<span class="breadcrumb-current">MADE</span>');
    } else {
        parts.push('<a href="#" class="breadcrumb-link breadcrumb-home-link" onclick="navigateToHomepage(event);">MADE</a>');
    }
    
    if (state.currentPage === 'dashboard') {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">Dashboard</span>');
    } else if (state.currentPage === 'repositories') {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">Repositories</span>');
    } else if (state.currentPage === 'repositorySubPage' && state.currentRepo) {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-link" onclick="navigateTo(\'repositories\')">Repositories</span>');
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">' + state.currentRepo.name + '</span>');
    } else if (state.currentPage === 'knowledge') {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">Knowledge Base</span>');
    } else if (state.currentPage === 'artefactSubPage' && state.currentArtefact) {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-link" onclick="navigateTo(\'knowledge\')">Knowledge Base</span>');
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">' + state.currentArtefact.name + '</span>');
    } else if (state.currentPage === 'constitution') {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">Constitution</span>');
    } else if (state.currentPage === 'constitutionSubPage' && state.currentConstitution) {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-link" onclick="navigateTo(\'constitution\')">Constitution</span>');
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">' + state.currentConstitution.name + '</span>');
    } else if (state.currentPage === 'settings') {
        parts.push('<span class="breadcrumb-separator">›</span>');
        parts.push('<span class="breadcrumb-current">Settings</span>');
    }
    
    breadcrumb.innerHTML = parts.join(' ');
}

// Homepage
function updateHomepage() {
    document.getElementById('homepageProjectCount').textContent = state.repositories.length + ' Projects';
    const homepageAgentStatus = document.getElementById('homepageAgentStatus');
    if (homepageAgentStatus) {
        homepageAgentStatus.className = 'traffic-light ' + (state.agentConnected ? 'green' : 'red');
    }
    
    // Update workspace paths
    if (DEMO_MODE) {
        document.getElementById('homepageWorkspace').textContent = '~/projects (demo)';
        document.getElementById('homepageHome').textContent = '~/.made (demo)';
    } else {
        document.getElementById('homepageWorkspace').textContent = '$MADE_WORKSPACE_HOME';
        document.getElementById('homepageHome').textContent = '$MADE_HOME';
    }
}

// Dashboard
function updateDashboard() {
    document.getElementById('projectCount').textContent = state.repositories.length;
    updateAgentStatus();
}

// Repositories
async function renderRepositories() {
    const list = document.getElementById('repositoriesList');
    list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Loading repositories...</div>';
    
    await fetchRepositories();
    
    if (state.repositories.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No repositories yet. Create your first repository.</div>';
        return;
    }
    
    list.innerHTML = state.repositories.map(repo => {
        const commitText = repo.lastCommit || 'No commits yet';
        
        return `
        <div class="panel-item" onclick="navigateToRepo('${repo.id}')">
            <div class="panel-item-title">${repo.name}</div>
            <div class="panel-badges">
                <span class="badge ${repo.hasGit ? 'badge-git' : 'badge-no-git'}">
                    ${repo.hasGit ? '✓ Git' : '✗ No Git'}
                </span>
                ${repo.technology ? `<span class="badge badge-tech-${repo.technology.toLowerCase()}">${repo.technology}</span>` : ''}
                ${repo.license ? `<span class="badge badge-license">${repo.license}</span>` : ''}
            </div>
            <div class="panel-item-meta" style="margin-top: var(--space-12);">
                <span>Last commit: ${commitText}</span>
            </div>
        </div>
        `;
    }).join('');
}

function openCreateRepoModal() {
    document.getElementById('createRepoModal').classList.add('active');
}

function closeCreateRepoModal() {
    document.getElementById('createRepoModal').classList.remove('active');
    document.getElementById('newRepoName').value = '';
}

async function createRepository() {
    const name = document.getElementById('newRepoName').value.trim();
    
    if (!name) {
        alert('Please enter a repository name');
        return;
    }
    
    try {
        await createRepositoryAPI(name);
        closeCreateRepoModal();
        await renderRepositories();
        alert('Repository created successfully!');
    } catch (error) {
        alert('Failed to create repository: ' + error.message);
    }
}

// Repository Tabs
function switchRepoTab(tab) {
    document.querySelectorAll('#repositorySubPage .tab').forEach(t => t.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    document.querySelectorAll('#repositorySubPage .tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'agent') {
        document.getElementById('agentTab').classList.add('active');
        renderRepoChat();
    } else if (tab === 'files') {
        document.getElementById('filesTab').classList.add('active');
        renderFileTree();
    } else if (tab === 'editor') {
        document.getElementById('editorTab').classList.add('active');
    } else if (tab === 'publishment') {
        document.getElementById('publishmentTab').classList.add('active');
    }
}

// Repository Chat
function renderRepoChat() {
    const messages = state.chatHistory[state.currentRepo.id] || [];
    const container = document.getElementById('chatMessages');
    
    if (messages.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Start chatting with the agent to manage this repository.</div>';
        return;
    }
    
    container.innerHTML = messages.map(msg => `
        <div class="chat-message ${msg.role}">
            <div class="chat-avatar">${msg.role === 'user' ? 'U' : 'AI'}</div>
            <div class="chat-content">${msg.message}</div>
        </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    if (!state.chatHistory[state.currentRepo.id]) {
        state.chatHistory[state.currentRepo.id] = [];
    }
    
    state.chatHistory[state.currentRepo.id].push({
        role: 'user',
        message: message,
        timestamp: new Date().toISOString()
    });
    
    input.value = '';
    renderRepoChat();
    
    setTimeout(() => {
        state.chatHistory[state.currentRepo.id].push({
            role: 'agent',
            message: 'I understand your request. Based on our conversation context and your project needs, here\'s my analysis and recommendations for moving forward. (A2A Protocol Mock Response)',
            timestamp: new Date().toISOString()
        });
        renderRepoChat();
    }, 800);
}

// File Browser
async function loadRepositoryFiles() {
    if (!state.currentRepo) return;
    
    const files = await fetchRepositoryFiles(state.currentRepo.id);
    state.fileStructure[state.currentRepo.id] = files;
    renderFileTree();
}

function renderFileTree() {
    const tree = document.getElementById('fileTree');
    const files = state.fileStructure[state.currentRepo.id] || [];
    
    if (files.length === 0) {
        tree.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No files in this repository</div>';
        return;
    }
    
    tree.innerHTML = files.map(file => renderFileItem(file)).join('');
}

function renderFileItem(file, level = 0) {
    const indent = level * 24;
    const isFolder = file.type === 'folder' || file.type === 'directory';
    const isExpanded = state.expandedFolders[file.path];
    
    let html = `
        <div class="file-item ${isFolder ? 'folder' : ''}" style="padding-left: ${indent + 12}px;">
            ${isFolder ? `<span class="folder-toggle ${isExpanded ? 'expanded' : ''}" onclick="toggleFolder('${file.path}')">▶</span>` : ''}
            <span class="file-icon" onclick="${isFolder ? `toggleFolder('${file.path}')` : `showFilePreview('${file.path}')`}">${getFileIcon(file.type)}</span>
            <span class="file-name" onclick="${isFolder ? `toggleFolder('${file.path}')` : `showFilePreview('${file.path}')`}">${file.name}</span>
            ${!isFolder && file.size ? `<span class="file-meta">${file.size}</span>` : ''}
            ${!isFolder ? `
            <div class="file-actions">
                <button class="file-action-btn" onclick="openRenameFileModal('${file.path}')" title="Rename">✏️</button>
                <button class="file-action-btn" onclick="openFileInEditor('${file.path}')" title="Edit">📝</button>
                <button class="file-action-btn" onclick="openMoveFileModal('${file.path}')" title="Move">📁</button>
                <button class="file-action-btn" onclick="openDeleteFileModal('${file.path}')" title="Delete">🗑️</button>
            </div>
            ` : ''}
        </div>
    `;
    
    if (isFolder && isExpanded && file.children) {
        html += '<div class="file-children">';
        html += file.children.map(child => renderFileItem(child, level + 1)).join('');
        html += '</div>';
    }
    
    return html;
}

function getFileIcon(type) {
    const icons = {
        'folder': '📁',
        'directory': '📁',
        'javascript': '📜',
        'js': '📜',
        'json': '📋',
        'markdown': '📝',
        'md': '📝',
        'html': '🌐',
        'css': '🎨',
        'image': '🖼️',
        'default': '📄'
    };
    return icons[type] || icons.default;
}

function toggleFolder(path) {
    state.expandedFolders[path] = !state.expandedFolders[path];
    renderFileTree();
}

function findFileByPath(path, files = null) {
    if (!files) {
        files = state.fileStructure[state.currentRepo.id] || [];
    }
    
    for (const file of files) {
        if (file.path === path) return file;
        if (file.children) {
            const found = findFileByPath(path, file.children);
            if (found) return found;
        }
    }
    return null;
}

function showFilePreview(path) {
    openFileInEditor(path);
}

function filterFiles() {
    const searchTerm = document.getElementById('fileSearchInput').value.toLowerCase();
    const allFileItems = document.querySelectorAll('.file-item');
    
    allFileItems.forEach(item => {
        const fileName = item.querySelector('.file-name')?.textContent.toLowerCase() || '';
        if (fileName.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Publishment
function publishAction(action) {
    // Define prompts for each action
    const prompts = {
        'init': 'Initialize this repository with proper structure, dependencies, and configuration files.',
        'remote': 'Create a remote repository on GitHub for this project and configure the local remote.',
        'pr': 'Create a pull request for the current changes with proper description and testing.',
        'deploy': 'Package this project and deploy it to the appropriate package manager (npm, PyPI, etc).',
        'preview': 'Generate a web preview or documentation site for this project and deploy it.',
        'publish': 'Publish this project as a website, configure hosting, and set up deployment pipeline.'
    };
    
    const actionNames = {
        'init': 'Initialize Repository',
        'remote': 'Create Remote Repository',
        'pr': 'Create PR',
        'deploy': 'Deploy to Package Manager',
        'preview': 'Create Web Preview',
        'publish': 'Publish Website'
    };
    
    const prompt = prompts[action];
    const actionName = actionNames[action];
    
    if (!prompt) return;
    
    // Initialize chat history if needed
    if (!state.chatHistory[state.currentRepo.id]) {
        state.chatHistory[state.currentRepo.id] = [];
    }
    
    // Add user message with the prompt
    state.chatHistory[state.currentRepo.id].push({
        role: 'user',
        message: prompt,
        timestamp: new Date().toISOString()
    });
    
    // Update publish status
    document.getElementById('publishStatus').innerHTML = `
        <div style="margin-bottom: var(--space-12);">
            <strong style="color: var(--color-primary);">${actionName}</strong> action triggered
        </div>
        <div style="font-size: var(--font-size-sm); color: var(--color-text-secondary);">
            Prompt injected: "${prompt}"
        </div>
        <div style="margin-top: var(--space-12); font-size: var(--font-size-sm); color: var(--color-success);">
            ✓ Switched to Agent tab and sent prompt
        </div>
    `;
    
    // Switch to Agent tab
    switchRepoTab('agent');
    
    // Update tab active states
    document.querySelectorAll('#repositorySubPage .tab').forEach((t, index) => {
        t.classList.remove('active');
        if (index === 0) t.classList.add('active');
    });
    
    // Render the chat with the new message
    renderRepoChat();
    
    // Simulate agent response with A2A mock
    setTimeout(() => {
        state.chatHistory[state.currentRepo.id].push({
            role: 'agent',
            message: 'I understand your request. Based on our conversation context and your project needs, here\'s my analysis and recommendations for moving forward. I\'ve analyzed the requirements and will now proceed with implementing this step in your repository evolution.',
            timestamp: new Date().toISOString()
        });
        renderRepoChat();
    }, 800);
}

// Artefacts
async function renderArtefacts() {
    const list = document.getElementById('artefactsList');
    list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Loading artefacts...</div>';
    
    await fetchArtefacts();
    
    if (state.artefacts.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No artefacts yet. Create your first artefact.</div>';
        return;
    }
    
    list.innerHTML = state.artefacts.map(art => `
        <div class="panel-item" onclick="navigateToArtefact('${art.id}')">
            <div class="panel-item-title">${art.name}</div>
            <div class="panel-badges">
                <span class="badge badge-type-${art.type}">
                    ${art.type === 'internal' ? '📄 Internal' : '🔗 External'}
                </span>
                ${art.tags ? art.tags.map(tag => `<span class="badge badge-tag">${tag}</span>`).join('') : ''}
            </div>
        </div>
    `).join('');
}

function openCreateArtefactModal() {
    document.getElementById('createArtefactModal').classList.add('active');
}

function closeCreateArtefactModal() {
    document.getElementById('createArtefactModal').classList.remove('active');
    document.getElementById('newArtefactName').value = '';
}

async function createArtefact() {
    const name = document.getElementById('newArtefactName').value.trim();
    
    if (!name) {
        alert('Please enter an artefact name');
        return;
    }
    
    const newArtefact = {
        name: name,
        type: 'internal',
        filename: name.toLowerCase().replace(/\s+/g, '-') + '.md',
        tags: [],
        content: `---\ntitle: ${name}\ntype: internal\n---\n\n# ${name}\n\nStart writing your content here...`
    };
    
    try {
        await saveArtefactAPI(newArtefact);
        closeCreateArtefactModal();
        await renderArtefacts();
        alert('Artefact created successfully!');
    } catch (error) {
        alert('Failed to create artefact: ' + error.message);
    }
}

// Artefact Tabs
function switchArtefactTab(tab) {
    document.querySelectorAll('#artefactSubPage .tab').forEach(t => t.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    document.querySelectorAll('#artefactSubPage .tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'content') {
        document.getElementById('artefactContentTab').classList.add('active');
        updateArtefactPreviewLive();
    } else if (tab === 'agent') {
        document.getElementById('artefactAgentTab').classList.add('active');
        renderArtefactChat();
    }
}

function loadArtefactContent() {
    document.getElementById('artefactFilename').value = state.currentArtefact.filename;
    document.getElementById('artefactTags').value = state.currentArtefact.tags ? state.currentArtefact.tags.join(', ') : '';
    document.getElementById('artefactContent').value = state.currentArtefact.content;
    updateArtefactPreviewLive();
}

async function saveArtefact() {
    state.currentArtefact.filename = document.getElementById('artefactFilename').value;
    state.currentArtefact.content = document.getElementById('artefactContent').value;
    
    const tagsInput = document.getElementById('artefactTags').value.trim();
    if (tagsInput) {
        state.currentArtefact.tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
    } else {
        state.currentArtefact.tags = [];
    }
    
    const typeMatch = state.currentArtefact.content.match(/type:\s*(internal|external)/);
    if (typeMatch) {
        state.currentArtefact.type = typeMatch[1];
    }
    
    try {
        await saveArtefactAPI(state.currentArtefact);
        alert('Artefact saved!');
        await renderArtefacts();
    } catch (error) {
        alert('Failed to save artefact: ' + error.message);
    }
}

function renderArtefactChat() {
    const messages = state.artefactChatHistory[state.currentArtefact.id] || [];
    const container = document.getElementById('artefactChatMessages');
    
    if (messages.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Discuss this artefact with the agent.</div>';
        return;
    }
    
    container.innerHTML = messages.map(msg => `
        <div class="chat-message ${msg.role}">
            <div class="chat-avatar">${msg.role === 'user' ? 'U' : 'AI'}</div>
            <div class="chat-content">${msg.message}</div>
        </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
}

function sendArtefactMessage() {
    const input = document.getElementById('artefactChatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    if (!state.artefactChatHistory[state.currentArtefact.id]) {
        state.artefactChatHistory[state.currentArtefact.id] = [];
    }
    
    state.artefactChatHistory[state.currentArtefact.id].push({
        role: 'user',
        message: message
    });
    
    input.value = '';
    renderArtefactChat();
    
    setTimeout(() => {
        state.artefactChatHistory[state.currentArtefact.id].push({
            role: 'agent',
            message: 'I understand your request. Based on our conversation context and this artefact, here are my recommendations for improvement. (A2A Protocol Mock Response)'
        });
        renderArtefactChat();
    }, 800);
}

function updateArtefactPreviewLive() {
    const content = document.getElementById('artefactContent').value;
    const preview = document.getElementById('artefactPreviewLive');
    
    if (!preview) return;
    
    const yamlMatch = content.match(/type:\s*(external|internal)/);
    const urlMatch = content.match(/url:\s*(.+)/);
    
    if (yamlMatch && yamlMatch[1] === 'external' && urlMatch) {
        preview.innerHTML = `<iframe src="${urlMatch[1].trim()}" style="width: 100%; height: 400px; border: none; border-radius: var(--radius-base);"></iframe>`;
    } else {
        preview.innerHTML = renderMarkdown(content);
    }
}

// Constitutions
async function renderConstitutions() {
    const list = document.getElementById('constitutionsList');
    list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Loading constitutions...</div>';
    
    await fetchConstitutions();
    
    if (state.constitutions.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No constitutions yet. Create your first constitution.</div>';
        return;
    }
    
    list.innerHTML = state.constitutions.map(con => `
        <div class="panel-item" onclick="navigateToConstitution('${con.id}')">
            <div class="panel-item-title">${con.name}</div>
            <div class="panel-item-meta">
                <span>Category: ${con.category || 'general'}</span>
            </div>
        </div>
    `).join('');
}

function openCreateConstitutionModal() {
    document.getElementById('createConstitutionModal').classList.add('active');
}

function closeCreateConstitutionModal() {
    document.getElementById('createConstitutionModal').classList.remove('active');
    document.getElementById('newConstitutionName').value = '';
}

async function createConstitution() {
    const name = document.getElementById('newConstitutionName').value.trim();
    
    if (!name) {
        alert('Please enter a constitution name');
        return;
    }
    
    const newConstitution = {
        name: name,
        filename: name.toLowerCase().replace(/\s+/g, '-') + '.md',
        category: 'guidelines',
        content: `---\ntitle: ${name}\ncategory: guidelines\n---\n\n# ${name}\n\nDefine your rules and constraints here...`
    };
    
    try {
        await saveConstitutionAPI(newConstitution);
        closeCreateConstitutionModal();
        await renderConstitutions();
        alert('Constitution created successfully!');
    } catch (error) {
        alert('Failed to create constitution: ' + error.message);
    }
}

// Constitution Tabs
function switchConstitutionTab(tab) {
    document.querySelectorAll('#constitutionSubPage .tab').forEach(t => t.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    document.querySelectorAll('#constitutionSubPage .tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'content') {
        document.getElementById('constitutionContentTab').classList.add('active');
        updateConstitutionPreviewLive();
    } else if (tab === 'agent') {
        document.getElementById('constitutionAgentTab').classList.add('active');
        renderConstitutionChat();
    }
}

function loadConstitutionContent() {
    document.getElementById('constitutionFilename').value = state.currentConstitution.filename;
    document.getElementById('constitutionContent').value = state.currentConstitution.content;
    updateConstitutionPreviewLive();
}

async function saveConstitution() {
    state.currentConstitution.filename = document.getElementById('constitutionFilename').value;
    state.currentConstitution.content = document.getElementById('constitutionContent').value;
    
    try {
        await saveConstitutionAPI(state.currentConstitution);
        alert('Constitution saved!');
    } catch (error) {
        alert('Failed to save constitution: ' + error.message);
    }
}

function renderConstitutionChat() {
    const messages = state.constitutionChatHistory[state.currentConstitution.id] || [];
    const container = document.getElementById('constitutionChatMessages');
    
    if (messages.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Discuss this constitution with the agent.</div>';
        return;
    }
    
    container.innerHTML = messages.map(msg => `
        <div class="chat-message ${msg.role}">
            <div class="chat-avatar">${msg.role === 'user' ? 'U' : 'AI'}</div>
            <div class="chat-content">${msg.message}</div>
        </div>
    `).join('');
    
    container.scrollTop = container.scrollHeight;
}

function sendConstitutionMessage() {
    const input = document.getElementById('constitutionChatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    if (!state.constitutionChatHistory[state.currentConstitution.id]) {
        state.constitutionChatHistory[state.currentConstitution.id] = [];
    }
    
    state.constitutionChatHistory[state.currentConstitution.id].push({
        role: 'user',
        message: message
    });
    
    input.value = '';
    renderConstitutionChat();
    
    setTimeout(() => {
        state.constitutionChatHistory[state.currentConstitution.id].push({
            role: 'agent',
            message: 'I understand your request. Based on our conversation context and this constitution, here are my recommendations for refinement. (A2A Protocol Mock Response)'
        });
        renderConstitutionChat();
    }, 800);
}

function updateConstitutionPreviewLive() {
    const content = document.getElementById('constitutionContent').value;
    const preview = document.getElementById('constitutionPreviewLive');
    
    if (!preview) return;
    
    preview.innerHTML = renderMarkdown(content);
}

// Markdown Renderer
function renderMarkdown(text) {
    if (!text) return '';
    
    let html = text;
    
    html = html.replace(/^---[\s\S]*?---\n/m, '');
    html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^(?!<[hul]|```|<pre)(.+)$/gm, '<p>$1</p>');
    
    return html;
}

// File Editor Functions
async function openFileInEditor(path) {
    const file = findFileByPath(path);
    if (!file) return;
    
    state.currentFile = file;
    state.fileModified = false;
    
    try {
        const content = await fetchFileContent(state.currentRepo.id, file.path);
        document.getElementById('fileEditorContent').value = content;
        document.getElementById('editorFilePath').textContent = file.path;
        document.getElementById('saveFileBtn').disabled = true;
        
        updateFilePreview();
        
        document.querySelectorAll('#repositorySubPage .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#repositorySubPage .tab')[2].classList.add('active');
        document.querySelectorAll('#repositorySubPage .tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('editorTab').classList.add('active');
    } catch (error) {
        alert('Failed to load file: ' + error.message);
    }
}

function markFileAsModified() {
    if (state.currentFile) {
        state.fileModified = true;
        document.getElementById('saveFileBtn').disabled = false;
        updateFilePreview();
    }
}

function updateFilePreview() {
    if (!state.currentFile) return;
    
    const content = document.getElementById('fileEditorContent').value;
    const preview = document.getElementById('filePreviewContent');
    
    if (!preview) return;
    
    const ext = state.currentFile.name.split('.').pop();
    
    if (ext === 'md') {
        preview.innerHTML = renderMarkdown(content);
    } else if (ext === 'json') {
        try {
            const formatted = JSON.stringify(JSON.parse(content), null, 2);
            preview.innerHTML = `<pre>${escapeHtml(formatted)}</pre>`;
        } catch (e) {
            preview.innerHTML = '<div style="color: var(--color-error); padding: var(--space-16);">Invalid JSON</div>';
        }
    } else if (['js', 'css', 'html', 'txt'].includes(ext)) {
        preview.innerHTML = `<pre>${escapeHtml(content)}</pre>`;
    } else {
        preview.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">Preview not available for this file type</div>';
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

async function saveFile() {
    if (!state.currentFile) return;
    
    const newContent = document.getElementById('fileEditorContent').value;
    
    try {
        await saveFileAPI(state.currentRepo.id, state.currentFile.path, newContent);
        state.fileModified = false;
        document.getElementById('saveFileBtn').disabled = true;
        alert('File saved successfully!');
        await loadRepositoryFiles();
    } catch (error) {
        alert('Failed to save file: ' + error.message);
    }
}

// File Action Modals
function openNewFileModal() {
    document.getElementById('newFileModal').classList.add('active');
}

function closeNewFileModal() {
    document.getElementById('newFileModal').classList.remove('active');
    document.getElementById('newFilePath').value = '';
}

async function createNewFile() {
    const path = document.getElementById('newFilePath').value.trim();
    if (!path) {
        alert('Please enter a file path');
        return;
    }
    
    try {
        await createFileAPI(state.currentRepo.id, path, '');
        closeNewFileModal();
        await loadRepositoryFiles();
        alert('File created successfully!');
    } catch (error) {
        alert('Failed to create file: ' + error.message);
    }
}

function openRenameFileModal(path) {
    state.selectedFileForAction = path;
    document.getElementById('renameFilePath').value = path;
    document.getElementById('renameFileModal').classList.add('active');
}

function closeRenameFileModal() {
    document.getElementById('renameFileModal').classList.remove('active');
    state.selectedFileForAction = null;
}

async function renameFile() {
    const newPath = document.getElementById('renameFilePath').value.trim();
    if (!newPath) {
        alert('Please enter a new path');
        return;
    }
    
    try {
        await renameFileAPI(state.currentRepo.id, state.selectedFileForAction, newPath);
        closeRenameFileModal();
        await loadRepositoryFiles();
        alert('File renamed successfully!');
    } catch (error) {
        alert('Failed to rename file: ' + error.message);
    }
}

function openMoveFileModal(path) {
    state.selectedFileForAction = path;
    document.getElementById('moveFilePath').value = path;
    document.getElementById('moveFileModal').classList.add('active');
}

function closeMoveFileModal() {
    document.getElementById('moveFileModal').classList.remove('active');
    state.selectedFileForAction = null;
}

async function moveFile() {
    const newPath = document.getElementById('moveFilePath').value.trim();
    if (!newPath) {
        alert('Please enter a new path');
        return;
    }
    
    try {
        await renameFileAPI(state.currentRepo.id, state.selectedFileForAction, newPath);
        closeMoveFileModal();
        await loadRepositoryFiles();
        alert('File moved successfully!');
    } catch (error) {
        alert('Failed to move file: ' + error.message);
    }
}

function openDeleteFileModal(path) {
    state.selectedFileForAction = path;
    document.getElementById('deleteFileName').textContent = path;
    document.getElementById('deleteFileModal').classList.add('active');
}

function closeDeleteFileModal() {
    document.getElementById('deleteFileModal').classList.remove('active');
    state.selectedFileForAction = null;
}

async function deleteFile() {
    try {
        await deleteFileAPI(state.currentRepo.id, state.selectedFileForAction);
        closeDeleteFileModal();
        await loadRepositoryFiles();
        alert('File deleted successfully!');
    } catch (error) {
        alert('Failed to delete file: ' + error.message);
    }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + K to open sidebar
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openSidebar();
        }
        
        // Escape to close sidebar
        if (e.key === 'Escape') {
            closeSidebar();
        }
    });
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    applyTheme();
    loadSettings();
    updateBreadcrumb();
    
    // Load initial data
    await fetchRepositories();
    checkAgentConnection();
    
    // Update homepage
    updateHomepage();
    
    // Set up periodic agent status check
    setInterval(checkAgentConnection, 30000);
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Show demo mode notification
    if (DEMO_MODE) {
        console.log('%c MADE Demo Mode ', 'background: #32b8c6; color: #1f3b3b; font-weight: bold; padding: 8px;');
        console.log('%c This is a frontend demo running in standalone browser mode. ', 'color: #62767d;');
        console.log('%c For full production setup: ', 'color: #62767d;');
        console.log('%c - Node.js backend with filesystem API ', 'color: #62767d;');
        console.log('%c - Jest unit tests for core logic ', 'color: #62767d;');
        console.log('%c - Playwright E2E tests for user journeys ', 'color: #62767d;');
        console.log('%c See documentation at: https://github.com/your-org/made ', 'color: #32b8c6;');
    }
    
    // Enter key handlers
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    document.getElementById('artefactChatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendArtefactMessage();
        }
    });
    
    document.getElementById('constitutionChatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendConstitutionMessage();
        }
    });
});
