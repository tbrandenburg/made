import { Bars3Icon, MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import React from "react";
import { useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import "../styles/topbar.css";

interface TopBarProps {
  onToggleSidebar: () => void;
}

const toTitleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

const decodePathSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const extractReadableExternalName = (segment: string) => {
  if (!segment.startsWith("external-")) return null;
  const rawPath = decodePathSegment(segment.slice("external-".length));
  const pathParts = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] ?? rawPath;
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return stem.trim() || "file";
};

export const formatBreadcrumb = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "MADE";
  return segments
    .map((segment) => {
      const externalName = extractReadableExternalName(segment);
      if (externalName) return `External ${externalName}`;
      return decodePathSegment(segment).replace(/-/g, " ");
    })
    .map(toTitleCase)
    .join(" / ");
};

export const TopBar: React.FC<TopBarProps> = ({ onToggleSidebar }) => {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <button
        className="icon-button"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
      >
        <Bars3Icon />
      </button>
      <div className="breadcrumb">{formatBreadcrumb(location.pathname)}</div>
      <button
        className="icon-button"
        onClick={toggleTheme}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  );
};
