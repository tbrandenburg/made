import React, { Suspense, useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import "./styles/layout.css";
import { recordNavigationVisit } from "./utils/navigationHistory";

// Eagerly-loaded pages (listing/first-view pages — small dependency trees)
import { HomePage } from "./pages/HomePage";
import { DashboardPage } from "./pages/DashboardPage";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ConstitutionsPage } from "./pages/ConstitutionsPage";
import { TasksPage } from "./pages/TasksPage";
import { SettingsPage } from "./pages/SettingsPage";

// Lazy-loaded detail pages (large dependency trees — deferred until route visited)
const RepositoryPage = React.lazy(() =>
  import("./pages/RepositoryPage").then((m) => ({ default: m.RepositoryPage })),
);
const KnowledgeArtefactPage = React.lazy(() =>
  import("./pages/KnowledgeArtefactPage").then((m) => ({
    default: m.KnowledgeArtefactPage,
  })),
);
const ConstitutionPage = React.lazy(() =>
  import("./pages/ConstitutionPage").then((m) => ({
    default: m.ConstitutionPage,
  })),
);
const TaskPage = React.lazy(() =>
  import("./pages/TaskPage").then((m) => ({ default: m.TaskPage })),
);

const AppShell: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(window.innerWidth > 1200);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setSidebarOpen(window.innerWidth > 1024);
  }, [location.pathname]);

  useEffect(() => {
    recordNavigationVisit(location.pathname);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <TopBar onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      <Sidebar
        open={sidebarOpen}
        onNavigate={() => window.innerWidth < 1024 && setSidebarOpen(false)}
      />
      <main className="app-content">
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/repositories" element={<RepositoriesPage />} />
            <Route path="/repositories/:name/*" element={<RepositoryPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route
              path="/knowledge/:name"
              element={<KnowledgeArtefactPage />}
            />
            <Route path="/constitutions" element={<ConstitutionsPage />} />
            <Route path="/constitutions/:name" element={<ConstitutionPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:name" element={<TaskPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

const App: React.FC = () => (
  <ThemeProvider>
    <AppShell />
  </ThemeProvider>
);

export default App;
