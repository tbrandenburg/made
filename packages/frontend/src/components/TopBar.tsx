import { Bars3Icon, MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import '../styles/topbar.css';

interface TopBarProps {
  onToggleSidebar: () => void;
}

const formatBreadcrumb = (pathname: string) => {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 'MADE';
  return segments
    .map((segment) => segment.replace(/-/g, ' '))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' / ');
};

export const TopBar: React.FC<TopBarProps> = ({ onToggleSidebar }) => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <button className="icon-button" onClick={onToggleSidebar} aria-label="Toggle navigation">
        <Bars3Icon />
      </button>
      <div className="breadcrumb">{formatBreadcrumb(location.pathname)}</div>
      <button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  );
};
