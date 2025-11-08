// Application State
const state = {
    currentPage: 'dashboard',
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
    agentConnected: true,
    fileStructure: {},
    expandedFolders: {},
    settings: {
        theme: 'auto',
        apiEndpoint: 'http://localhost:8000',
        autoSaveInterval: '30',
        language: 'en',
        enableNotifications: true,
        debugMode: false
    }
};

// Initialize with mock data
function initializeData() {
    state.repositories = [
        {
            id: 'repo-001',
            name: 'ecommerce-platform',
            path: './ecommerce-platform',
            lastModified: '2025-11-08',
            lastCommit: '2025-11-06',
            status: 'active',
            description: 'Full-stack e-commerce platform with React and Node.js',
            hasGit: true,
            technology: 'NodeJS',
            license: 'MIT',
            hasGit: true
        },
        {
            id: 'repo-002',
            name: 'ai-chatbot',
            path: './ai-chatbot',
            lastModified: '2025-11-07',
            lastCommit: '2025-11-07',
            status: 'active',
            description: 'AI-powered chatbot with multi-agent architecture',
            hasGit: true,
            technology: 'Python',
            license: 'Apache-2.0',
            hasGit: true
        },
        {
            id: 'repo-003',
            name: 'analytics-dashboard',
            path: './analytics-dashboard',
            lastModified: '2025-11-05',
            lastCommit: '2025-10-28',
            status: 'archived',
            description: 'Real-time analytics dashboard with data visualization',
            hasGit: false,
            technology: 'C++',
            license: 'GPL-3.0',
            hasGit: false
        }
    ];

    state.artefacts = [
        {
            id: 'art-001',
            name: 'API Design Patterns',
            type: 'internal',
            filename: 'api-design-patterns.md',
            tags: ['api', 'architecture', 'design'],
            content: `---
title: API Design Patterns
type: internal
category: architecture
tags: [api, rest, design]
---

# API Design Patterns

## RESTful Design
- Use nouns for resources
- Leverage HTTP methods appropriately
- Version your APIs

## Error Handling
- Return appropriate status codes
- Include descriptive error messages`
        },
        {
            id: 'art-002',
            name: 'React Component Library',
            type: 'external',
            filename: 'react-components.md',
            tags: ['react', 'ui', 'components'],
            content: `---
title: React Component Library
type: external
url: https://example.com/components
tags: [react, ui]
---

# React Component Library Reference

External reference to component library documentation.`
        },
        {
            id: 'art-003',
            name: 'Database Schema Guidelines',
            type: 'internal',
            filename: 'database-schema.md',
            tags: ['database', 'schema', 'postgresql'],
            content: `---
title: Database Schema Guidelines
type: internal
category: database
tags: [database, postgresql]
---

# Database Schema Guidelines

## Naming Conventions
- Use snake_case for table and column names
- Prefix junction tables with both entity names`
        }
    ];

    state.constitutions = [
        {
            id: 'const-001',
            name: 'Code Quality Standards',
            filename: 'code-quality.md',
            category: 'guidelines',
            content: `---
title: Code Quality Standards
category: guidelines
priority: high
---

# Code Quality Standards

## Testing
- Maintain >80% test coverage
- Write unit tests for all functions

## Code Style
- Follow ESLint configuration
- Use TypeScript strict mode`
        },
        {
            id: 'const-002',
            name: 'Security Constraints',
            filename: 'security.md',
            category: 'constraints',
            content: `---
title: Security Constraints
category: constraints
priority: critical
---

# Security Constraints

## Authentication
- All endpoints require authentication
- Use JWT tokens with expiration

## Data Protection
- Encrypt sensitive data at rest
- Use HTTPS for all communications`
        }
    ];

    // Initialize chat history
    state.chatHistory['repo-001'] = [
        { role: 'user', message: 'Create a new API endpoint for user authentication', timestamp: '2025-11-08T10:30:00' },
        { role: 'agent', message: "I'll create a new authentication endpoint. Here's my implementation plan: 1) Create route handler 2) Add JWT token generation 3) Add validation middleware. Shall I proceed?", timestamp: '2025-11-08T10:30:15' },
        { role: 'user', message: 'Yes, proceed', timestamp: '2025-11-08T10:31:00' },
        { role: 'agent', message: 'Implementation completed. I\'ve created the following files: src/routes/auth.js, src/middleware/validate.js, and updated the main router. The endpoint is available at POST /api/auth/login', timestamp: '2025-11-08T10:31:45' }
    ];

    // Initialize file structure
    state.fileStructure['repo-001'] = [
        {
            id: 'file-001',
            path: 'src',
            name: 'src',
            type: 'folder',
            children: [
                {
                    id: 'file-002',
                    path: 'src/index.js',
                    name: 'index.js',
                    type: 'javascript',
                    size: '2.4 KB',
                    modified: '2025-11-08T09:15:00',
                    content: "const express = require('express');\nconst authRoutes = require('./routes/auth');\n\nconst app = express();\napp.use(express.json());\napp.use('/api/auth', authRoutes);\n\napp.listen(3000, () => {\n  console.log('Server running on port 3000');\n});"
                },
                {
                    id: 'file-003',
                    path: 'src/routes',
                    name: 'routes',
                    type: 'folder',
                    children: [
                        {
                            id: 'file-004',
                            path: 'src/routes/auth.js',
                            name: 'auth.js',
                            type: 'javascript',
                            size: '1.8 KB',
                            modified: '2025-11-08T10:45:00',
                            content: "const express = require('express');\nconst router = express.Router();\n\nrouter.post('/login', (req, res) => {\n  // Authentication logic\n  res.json({ token: 'jwt-token' });\n});\n\nmodule.exports = router;"
                        }
                    ]
                },
                {
                    id: 'file-005',
                    path: 'src/middleware',
                    name: 'middleware',
                    type: 'folder',
                    children: [
                        {
                            id: 'file-006',
                            path: 'src/middleware/validate.js',
                            name: 'validate.js',
                            type: 'javascript',
                            size: '0.9 KB',
                            modified: '2025-11-08T10:20:00',
                            content: "const validateToken = (req, res, next) => {\n  const token = req.headers.authorization;\n  if (!token) return res.status(401).json({ error: 'No token' });\n  next();\n};\n\nmodule.exports = { validateToken };"
                        }
                    ]
                }
            ]
        },
        {
            id: 'file-007',
            path: 'README.md',
            name: 'README.md',
            type: 'markdown',
            size: '3.2 KB',
            modified: '2025-11-08T08:00:00',
            content: "# E-Commerce Platform\n\nFull-stack e-commerce platform with React frontend and Node.js backend.\n\n## Features\n- Product catalog\n- Shopping cart\n- User authentication\n- Payment processing"
        },
        {
            id: 'file-008',
            path: 'package.json',
            name: 'package.json',
            type: 'json',
            size: '1.1 KB',
            modified: '2025-11-08T07:30:00',
            content: "{\n  \"name\": \"ecommerce-platform\",\n  \"version\": \"1.0.0\",\n  \"description\": \"Full-stack e-commerce platform\",\n  \"main\": \"src/index.js\",\n  \"dependencies\": {\n    \"express\": \"^4.18.0\",\n    \"react\": \"^18.0.0\"\n  }\n}"
        }
    ];

    updateDashboard();
    loadSettings();
    applyTheme();
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
        // Auto mode - remove attribute to use media query
        root.removeAttribute('data-color-scheme');
    }
}

// Settings Management
function loadSettings() {
    // Load settings into form
    document.getElementById('settingApiEndpoint').value = state.settings.apiEndpoint;
    document.getElementById('settingAutoSave').value = state.settings.autoSaveInterval;
    document.getElementById('settingLanguage').value = state.settings.language;
    
    // Set theme radio
    if (state.settings.theme === 'light') {
        document.getElementById('themeLight').checked = true;
    } else if (state.settings.theme === 'dark') {
        document.getElementById('themeDark').checked = true;
    } else {
        document.getElementById('themeAuto').checked = true;
    }
    
    // Set notifications
    if (state.settings.enableNotifications) {
        document.getElementById('notifYes').checked = true;
    } else {
        document.getElementById('notifNo').checked = true;
    }
    
    // Set debug mode
    if (state.settings.debugMode) {
        document.getElementById('debugYes').checked = true;
    } else {
        document.getElementById('debugNo').checked = true;
    }
}

function saveSettings() {
    // Save form values to state
    state.settings.apiEndpoint = document.getElementById('settingApiEndpoint').value;
    state.settings.autoSaveInterval = document.getElementById('settingAutoSave').value;
    state.settings.language = document.getElementById('settingLanguage').value;
    
    // Get notifications setting
    const notifRadios = document.getElementsByName('notifications');
    for (const radio of notifRadios) {
        if (radio.checked) {
            state.settings.enableNotifications = radio.value === 'true';
            break;
        }
    }
    
    // Get debug mode setting
    const debugRadios = document.getElementsByName('debug');
    for (const radio of debugRadios) {
        if (radio.checked) {
            state.settings.debugMode = radio.value === 'true';
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
    
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    event.target.closest('.nav-item').classList.add('active');
    
    // Update active page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page + 'Page').classList.add('active');
    
    // Update breadcrumb
    updateBreadcrumb();
    
    // Render page content
    if (page === 'repositories') renderRepositories();
    else if (page === 'knowledge') renderArtefacts();
    else if (page === 'constitution') renderConstitutions();
    
    closeSidebar();
}

function navigateToRepo(repoId) {
    state.currentRepo = state.repositories.find(r => r.id === repoId);
    state.currentPage = 'repositorySubPage';
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('repositorySubPage').classList.add('active');
    
    // Reset to agent tab
    switchRepoTab('agent');
    
    // Load chat history
    renderRepoChat();
    renderFileTree();
    
    updateBreadcrumb();
    closeSidebar();
}

function navigateToArtefact(artefactId) {
    state.currentArtefact = state.artefacts.find(a => a.id === artefactId);
    state.currentPage = 'artefactSubPage';
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('artefactSubPage').classList.add('active');
    
    // Reset to content tab
    switchArtefactTab('content');
    
    // Load artefact
    loadArtefactContent();
    
    updateBreadcrumb();
    closeSidebar();
}

function navigateToConstitution(constitutionId) {
    state.currentConstitution = state.constitutions.find(c => c.id === constitutionId);
    state.currentPage = 'constitutionSubPage';
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('constitutionSubPage').classList.add('active');
    
    // Reset to content tab
    switchConstitutionTab('content');
    
    // Load constitution
    loadConstitutionContent();
    
    updateBreadcrumb();
    closeSidebar();
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    const parts = [];
    
    parts.push('<span class="breadcrumb-link" onclick="navigateTo(\'dashboard\')">MADE</span>');
    
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

// Dashboard
function updateDashboard() {
    document.getElementById('projectCount').textContent = state.repositories.length;
    const statusLight = document.getElementById('agentStatus');
    statusLight.className = 'traffic-light ' + (state.agentConnected ? 'green' : 'red');
}

// Repositories
function renderRepositories() {
    const list = document.getElementById('repositoriesList');
    
    if (state.repositories.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No repositories yet. Create your first repository.</div>';
        return;
    }
    
    list.innerHTML = state.repositories.map(repo => {
        const daysSince = Math.floor((new Date() - new Date(repo.lastCommit)) / (1000 * 60 * 60 * 24));
        const commitText = daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`;
        
        return `
        <div class="panel-item" onclick="navigateToRepo('${repo.id}')">
            <div class="panel-item-title">${repo.name}</div>
            <div style="color: var(--color-text-secondary); margin: var(--space-8) 0;">${repo.description}</div>
            <div class="panel-badges">
                <span class="badge ${repo.hasGit ? 'badge-git' : 'badge-no-git'}">
                    ${repo.hasGit ? '✓ Git' : '✗ No Git'}
                </span>
                <span class="badge badge-tech-${repo.technology.toLowerCase()}">
                    ${repo.technology}
                </span>
                <span class="badge badge-license">
                    ${repo.license}
                </span>
            </div>
            <div class="panel-item-meta" style="margin-top: var(--space-12);">
                <span>Last commit: ${commitText}</span>
                <span class="status-badge status-${repo.status}">${repo.status}</span>
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
    document.getElementById('newRepoDescription').value = '';
}

function createRepository() {
    const name = document.getElementById('newRepoName').value.trim();
    const description = document.getElementById('newRepoDescription').value.trim();
    
    if (!name) {
        alert('Please enter a repository name');
        return;
    }
    
    const newRepo = {
        id: 'repo-' + Date.now(),
        name: name,
        path: './' + name,
        lastModified: new Date().toISOString().split('T')[0],
        status: 'active',
        description: description || 'No description'
    };
    
    state.repositories.push(newRepo);
    state.chatHistory[newRepo.id] = [];
    
    closeCreateRepoModal();
    renderRepositories();
    updateDashboard();
}

// Repository Tabs
function switchRepoTab(tab) {
    // Update tabs
    document.querySelectorAll('#repositorySubPage .tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update content
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
    
    // Simulate agent response
    setTimeout(() => {
        state.chatHistory[state.currentRepo.id].push({
            role: 'agent',
            message: 'I understand. Let me help you with that. I\'ll analyze the repository and provide recommendations.',
            timestamp: new Date().toISOString()
        });
        renderRepoChat();
    }, 800);
}

// File Browser
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
    const isFolder = file.type === 'folder';
    const isExpanded = state.expandedFolders[file.id];
    
    let html = `
        <div class="file-item ${isFolder ? 'folder' : ''}" style="padding-left: ${indent + 12}px;">
            ${isFolder ? `<span class="folder-toggle ${isExpanded ? 'expanded' : ''}" onclick="toggleFolder('${file.id}')">▶</span>` : ''}
            <span class="file-icon" onclick="${isFolder ? `toggleFolder('${file.id}')` : `showFilePreview('${file.id}')`}">${getFileIcon(file.type)}</span>
            <span class="file-name" onclick="${isFolder ? `toggleFolder('${file.id}')` : `showFilePreview('${file.id}')`}">${file.name}</span>
            ${!isFolder ? `<span class="file-meta">${file.size}</span>` : ''}
            ${!isFolder ? `
            <div class="file-actions">
                <button class="file-action-btn" onclick="openRenameFileModal('${file.id}')" title="Rename">✏️</button>
                <button class="file-action-btn" onclick="openFileInEditor('${file.id}')" title="Edit">📝</button>
                <button class="file-action-btn" onclick="openMoveFileModal('${file.id}')" title="Move">📁</button>
                <button class="file-action-btn" onclick="openDeleteFileModal('${file.id}')" title="Delete">🗑️</button>
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
        'javascript': '📜',
        'json': '📋',
        'markdown': '📝',
        'html': '🌐',
        'css': '🎨',
        'image': '🖼️',
        'default': '📄'
    };
    return icons[type] || icons.default;
}

function toggleFolder(fileId) {
    state.expandedFolders[fileId] = !state.expandedFolders[fileId];
    renderFileTree();
}

function findFileById(fileId, files = null) {
    if (!files) {
        files = state.fileStructure[state.currentRepo.id] || [];
    }
    
    for (const file of files) {
        if (file.id === fileId) return file;
        if (file.children) {
            const found = findFileById(fileId, file.children);
            if (found) return found;
        }
    }
    return null;
}

function showFilePreview(fileId) {
    const file = findFileById(fileId);
    if (file && file.content) {
        alert(`File: ${file.path}\n\nPreview:\n${file.content.substring(0, 200)}...`);
    }
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
    const actions = {
        'remote': 'Creating remote repository on GitHub...',
        'pr': 'Creating pull request...',
        'deploy': 'Deploying to package manager...',
        'preview': 'Creating web preview...'
    };
    
    // Inject into chat
    if (!state.chatHistory[state.currentRepo.id]) {
        state.chatHistory[state.currentRepo.id] = [];
    }
    
    state.chatHistory[state.currentRepo.id].push({
        role: 'user',
        message: actions[action],
        timestamp: new Date().toISOString()
    });
    
    document.getElementById('publishStatus').innerHTML = `<span style="color: var(--color-primary);">${actions[action]}</span>`;
    
    setTimeout(() => {
        state.chatHistory[state.currentRepo.id].push({
            role: 'agent',
            message: 'Action completed successfully!',
            timestamp: new Date().toISOString()
        });
    }, 1000);
}

// Artefacts
function renderArtefacts() {
    const list = document.getElementById('artefactsList');
    
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
                ${art.tags.map(tag => `<span class="badge badge-tag">${tag}</span>`).join('')}
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

function createArtefact() {
    const name = document.getElementById('newArtefactName').value.trim();
    
    if (!name) {
        alert('Please enter an artefact name');
        return;
    }
    
    const newArtefact = {
        id: 'art-' + Date.now(),
        name: name,
        type: 'internal',
        filename: name.toLowerCase().replace(/\s+/g, '-') + '.md',
        tags: [],
        content: `---\ntitle: ${name}\ntype: internal\n---\n\n# ${name}\n\nStart writing your content here...`
    };
    
    state.artefacts.push(newArtefact);
    
    closeCreateArtefactModal();
    renderArtefacts();
}

// Artefact Tabs
function switchArtefactTab(tab) {
    // Update tabs
    document.querySelectorAll('#artefactSubPage .tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update content
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

function saveArtefact() {
    state.currentArtefact.filename = document.getElementById('artefactFilename').value;
    state.currentArtefact.content = document.getElementById('artefactContent').value;
    
    // Get tags from input field
    const tagsInput = document.getElementById('artefactTags').value.trim();
    if (tagsInput) {
        state.currentArtefact.tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
    } else {
        state.currentArtefact.tags = [];
    }
    
    // Update YAML header with tags
    let content = state.currentArtefact.content;
    const tagsYaml = state.currentArtefact.tags.length > 0 ? `tags: [${state.currentArtefact.tags.join(', ')}]` : '';
    if (content.match(/^---/)) {
        // Has YAML header - update or add tags
        if (content.match(/tags:\s*\[/)) {
            content = content.replace(/tags:\s*\[[^\]]*\]/, tagsYaml);
        } else if (tagsYaml) {
            content = content.replace(/^(---\n)/, `$1${tagsYaml}\n`);
        }
    }
    state.currentArtefact.content = content;
    
    // Extract type from YAML header
    const typeMatch = state.currentArtefact.content.match(/type:\s*(internal|external)/);
    if (typeMatch) {
        state.currentArtefact.type = typeMatch[1];
    }
    
    alert('Artefact saved!');
    renderArtefacts();
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
            message: 'I can help you improve this artefact. What specific aspects would you like to enhance?'
        });
        renderArtefactChat();
    }, 800);
}

function updateArtefactPreviewLive() {
    const content = document.getElementById('artefactContent').value;
    const preview = document.getElementById('artefactPreviewLive');
    
    if (!preview) return;
    
    // Check if external type
    const yamlMatch = content.match(/type:\s*(external|internal)/);
    const urlMatch = content.match(/url:\s*(.+)/);
    
    if (yamlMatch && yamlMatch[1] === 'external' && urlMatch) {
        preview.innerHTML = `<iframe src="${urlMatch[1].trim()}" style="width: 100%; height: 400px; border: none; border-radius: var(--radius-base);"></iframe>`;
    } else {
        preview.innerHTML = renderMarkdown(content);
    }
}

// Constitutions
function renderConstitutions() {
    const list = document.getElementById('constitutionsList');
    
    if (state.constitutions.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--color-text-secondary); padding: var(--space-32);">No constitutions yet. Create your first constitution.</div>';
        return;
    }
    
    list.innerHTML = state.constitutions.map(con => `
        <div class="panel-item" onclick="navigateToConstitution('${con.id}')">
            <div class="panel-item-title">${con.name}</div>
            <div class="panel-item-meta">
                <span>Category: ${con.category}</span>
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

function createConstitution() {
    const name = document.getElementById('newConstitutionName').value.trim();
    
    if (!name) {
        alert('Please enter a constitution name');
        return;
    }
    
    const newConstitution = {
        id: 'const-' + Date.now(),
        name: name,
        filename: name.toLowerCase().replace(/\s+/g, '-') + '.md',
        category: 'guidelines',
        content: `---\ntitle: ${name}\ncategory: guidelines\n---\n\n# ${name}\n\nDefine your rules and constraints here...`
    };
    
    state.constitutions.push(newConstitution);
    
    closeCreateConstitutionModal();
    renderConstitutions();
}

// Constitution Tabs
function switchConstitutionTab(tab) {
    // Update tabs
    document.querySelectorAll('#constitutionSubPage .tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update content
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

function saveConstitution() {
    state.currentConstitution.filename = document.getElementById('constitutionFilename').value;
    state.currentConstitution.content = document.getElementById('constitutionContent').value;
    alert('Constitution saved!');
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
            message: 'I can help you refine this constitution. What aspects would you like to clarify or enhance?'
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
    
    // Remove YAML front matter
    html = html.replace(/^---[\s\S]*?---\n/m, '');
    
    // Code blocks
    html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // Paragraphs
    html = html.replace(/^(?!<[hul]|```|<pre)(.+)$/gm, '<p>$1</p>');
    
    return html;
}

// File Editor Functions
function openFileInEditor(fileId) {
    const file = findFileById(fileId);
    if (!file || !file.content) return;
    
    // Check file size (mock check - in real app would check actual size)
    const sizeInMB = parseInt(file.size) / 1000; // rough estimate
    if (sizeInMB > 5) {
        alert('File is too large to edit (>5MB)');
        return;
    }
    
    state.currentFile = file;
    state.fileModified = false;
    
    // Load content
    document.getElementById('fileEditorContent').value = file.content;
    document.getElementById('editorFilePath').textContent = file.path;
    document.getElementById('saveFileBtn').disabled = true;
    
    // Update preview
    updateFilePreview();
    
    // Switch to editor tab
    document.querySelectorAll('#repositorySubPage .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#repositorySubPage .tab')[2].classList.add('active'); // File Editor tab
    document.querySelectorAll('#repositorySubPage .tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('editorTab').classList.add('active');
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
    
    if (state.currentFile.type === 'markdown') {
        preview.innerHTML = renderMarkdown(content);
    } else if (state.currentFile.type === 'json') {
        try {
            const formatted = JSON.stringify(JSON.parse(content), null, 2);
            preview.innerHTML = `<pre>${escapeHtml(formatted)}</pre>`;
        } catch (e) {
            preview.innerHTML = '<div style="color: var(--color-error); padding: var(--space-16);">Invalid JSON</div>';
        }
    } else if (state.currentFile.type === 'javascript' || state.currentFile.type === 'css' || state.currentFile.type === 'html') {
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

function saveFile() {
    if (!state.currentFile) return;
    
    const newContent = document.getElementById('fileEditorContent').value;
    state.currentFile.content = newContent;
    state.currentFile.modified = new Date().toISOString();
    state.fileModified = false;
    
    document.getElementById('saveFileBtn').disabled = true;
    alert('File saved successfully!');
    
    // Update file tree
    renderFileTree();
}

// File Action Modals
function openNewFileModal() {
    document.getElementById('newFileModal').classList.add('active');
}

function closeNewFileModal() {
    document.getElementById('newFileModal').classList.remove('active');
    document.getElementById('newFilePath').value = '';
}

function createNewFile() {
    const path = document.getElementById('newFilePath').value.trim();
    if (!path) {
        alert('Please enter a file path');
        return;
    }
    
    const pathParts = path.split('/');
    const fileName = pathParts[pathParts.length - 1];
    const fileType = fileName.split('.').pop();
    
    const newFile = {
        id: 'file-' + Date.now(),
        path: path,
        name: fileName,
        type: fileType === 'js' ? 'javascript' : fileType,
        size: '0 KB',
        modified: new Date().toISOString(),
        content: ''
    };
    
    if (!state.fileStructure[state.currentRepo.id]) {
        state.fileStructure[state.currentRepo.id] = [];
    }
    
    state.fileStructure[state.currentRepo.id].push(newFile);
    
    closeNewFileModal();
    renderFileTree();
    alert('File created successfully!');
}

function openRenameFileModal(fileId) {
    state.selectedFileForAction = fileId;
    const file = findFileById(fileId);
    if (file) {
        document.getElementById('renameFilePath').value = file.path;
        document.getElementById('renameFileModal').classList.add('active');
    }
}

function closeRenameFileModal() {
    document.getElementById('renameFileModal').classList.remove('active');
    state.selectedFileForAction = null;
}

function renameFile() {
    const newPath = document.getElementById('renameFilePath').value.trim();
    if (!newPath) {
        alert('Please enter a new path');
        return;
    }
    
    const file = findFileById(state.selectedFileForAction);
    if (file) {
        const pathParts = newPath.split('/');
        file.path = newPath;
        file.name = pathParts[pathParts.length - 1];
        file.modified = new Date().toISOString();
        
        closeRenameFileModal();
        renderFileTree();
        alert('File renamed successfully!');
    }
}

function openMoveFileModal(fileId) {
    state.selectedFileForAction = fileId;
    const file = findFileById(fileId);
    if (file) {
        document.getElementById('moveFilePath').value = file.path;
        document.getElementById('moveFileModal').classList.add('active');
    }
}

function closeMoveFileModal() {
    document.getElementById('moveFileModal').classList.remove('active');
    state.selectedFileForAction = null;
}

function moveFile() {
    const newPath = document.getElementById('moveFilePath').value.trim();
    if (!newPath) {
        alert('Please enter a new path');
        return;
    }
    
    const file = findFileById(state.selectedFileForAction);
    if (file) {
        const pathParts = newPath.split('/');
        file.path = newPath;
        file.name = pathParts[pathParts.length - 1];
        file.modified = new Date().toISOString();
        
        closeMoveFileModal();
        renderFileTree();
        alert('File moved successfully!');
    }
}

function openDeleteFileModal(fileId) {
    state.selectedFileForAction = fileId;
    const file = findFileById(fileId);
    if (file) {
        document.getElementById('deleteFileName').textContent = file.path;
        document.getElementById('deleteFileModal').classList.add('active');
    }
}

function closeDeleteFileModal() {
    document.getElementById('deleteFileModal').classList.remove('active');
    state.selectedFileForAction = null;
}

function deleteFile() {
    const fileId = state.selectedFileForAction;
    
    function removeFileFromStructure(files) {
        for (let i = 0; i < files.length; i++) {
            if (files[i].id === fileId) {
                files.splice(i, 1);
                return true;
            }
            if (files[i].children) {
                if (removeFileFromStructure(files[i].children)) {
                    return true;
                }
            }
        }
        return false;
    }
    
    removeFileFromStructure(state.fileStructure[state.currentRepo.id]);
    
    closeDeleteFileModal();
    renderFileTree();
    alert('File deleted successfully!');
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeData();
    updateBreadcrumb();
    
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