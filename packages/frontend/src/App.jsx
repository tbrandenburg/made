import React, { useMemo, useState, useEffect } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchRepositories,
  createRepositoryRequest,
  fetchKnowledgeArtefacts,
  fetchConstitutions,
  fetchSettings,
  saveSettings
} from './hooks/useBackend.js';
import HomePage from './pages/HomePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import RepositoriesPage from './pages/RepositoriesPage.jsx';
import RepositoryPage from './pages/RepositoryPage.jsx';
import KnowledgeBasePage from './pages/KnowledgeBasePage.jsx';
import KnowledgeArtefactPage from './pages/KnowledgeArtefactPage.jsx';
import ConstitutionsPage from './pages/ConstitutionsPage.jsx';
import ConstitutionDetailPage from './pages/ConstitutionDetailPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

const menuItems = [
  { label: 'MADE', to: '/' },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Repositories', to: '/repositories' },
  { label: 'Knowledge Base', to: '/knowledge' },
  { label: 'Constitution', to: '/constitutions' },
  { label: 'Settings', to: '/settings' }
];

export default function App() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState('light');

  const { data: repositories = [] } = useQuery(['repositories'], fetchRepositories);
  const { data: artefacts = [] } = useQuery(['knowledge'], fetchKnowledgeArtefacts);
  const { data: constitutions = [] } = useQuery(['constitutions'], fetchConstitutions);
  const { data: settings } = useQuery(['settings'], fetchSettings, {
    onSuccess: (data) => {
      if (data?.theme) {
        setTheme(data.theme);
      }
    }
  });

  const createRepoMutation = useMutation({
    mutationFn: createRepositoryRequest,
    onSuccess: () => {
      queryClient.invalidateQueries(['repositories']);
    }
  });

  const saveSettingsMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: (saved) => {
      if (saved?.theme) setTheme(saved.theme);
      queryClient.invalidateQueries(['settings']);
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const breadcrumb = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    const crumbs = [{ label: 'MADE', path: '/' }];
    let currentPath = '';
    segments.forEach((segment) => {
      currentPath += `/${segment}`;
      const label = segment.replace(/-/g, ' ');
      crumbs.push({ label, path: currentPath });
    });
    return crumbs;
  }, [location.pathname]);

  const handleCreateRepository = async () => {
    const name = prompt('Repository name');
    if (!name) return;
    await createRepoMutation.mutateAsync(name);
  };

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (settings) {
      saveSettingsMutation.mutate({ ...settings, theme: nextTheme });
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h1>MADE</h1>
          <span className="mode-pill">{theme === 'dark' ? 'Tokyo Night' : 'Tokyo Light'}</span>
        </div>
        <nav>
          {menuItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'active' : ''}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <header className="top-bar">
          <button className="icon-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">
            ☰
          </button>
          <div className="breadcrumb">
            {breadcrumb.map((crumb, index) => (
              <span key={crumb.path}>
                {index > 0 && <span className="separator">/</span>}
                <NavLink to={crumb.path}>{crumb.label}</NavLink>
              </span>
            ))}
          </div>
          <button className="icon-button" onClick={handleToggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? '🌙' : '🌞'}
          </button>
        </header>
        <div className="page-body">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage repositories={repositories} />} />
            <Route
              path="/repositories"
              element={
                <RepositoriesPage
                  repositories={repositories}
                  onCreateRepository={handleCreateRepository}
                />
              }
            />
            <Route path="/repositories/:repoId/*" element={<RepositoryPage />} />
            <Route path="/knowledge" element={<KnowledgeBasePage artefacts={artefacts} />} />
            <Route path="/knowledge/:file" element={<KnowledgeArtefactPage />} />
            <Route path="/constitutions" element={<ConstitutionsPage constitutions={constitutions} />} />
            <Route path="/constitutions/:file" element={<ConstitutionDetailPage />} />
            <Route
              path="/settings"
              element={<SettingsPage settings={settings} onSave={saveSettingsMutation.mutateAsync} saving={saveSettingsMutation.isLoading} />}
            />
          </Routes>
        </div>
      </main>
    </div>
  );
}
