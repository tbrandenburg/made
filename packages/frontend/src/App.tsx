import React, { useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./pages/HomePage";
import { DashboardPage } from "./pages/DashboardPage";
import { RepositoriesPage } from "./pages/RepositoriesPage";
import { RepositoryPage } from "./pages/RepositoryPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { KnowledgeArtefactPage } from "./pages/KnowledgeArtefactPage";
import { ConstitutionsPage } from "./pages/ConstitutionsPage";
import { ConstitutionPage } from "./pages/ConstitutionPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import "./styles/layout.css";

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

  return (
    <div className="app-shell">
      <TopBar onToggleSidebar={() => setSidebarOpen((open) => !open)} />
      <Sidebar
        open={sidebarOpen}
        onNavigate={() => window.innerWidth < 1024 && setSidebarOpen(false)}
      />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/repositories" element={<RepositoriesPage />} />
          <Route path="/repositories/:name/*" element={<RepositoryPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/knowledge/:name" element={<KnowledgeArtefactPage />} />
          <Route path="/constitutions" element={<ConstitutionsPage />} />
          <Route path="/constitutions/:name" element={<ConstitutionPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
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
