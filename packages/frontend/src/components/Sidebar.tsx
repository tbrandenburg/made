import AdjustmentsHorizontalIcon from "@heroicons/react/24/outline/AdjustmentsHorizontalIcon.js";
import BookOpenIcon from "@heroicons/react/24/outline/BookOpenIcon.js";
import CpuChipIcon from "@heroicons/react/24/outline/CpuChipIcon.js";
import HomeModernIcon from "@heroicons/react/24/outline/HomeModernIcon.js";
import RectangleGroupIcon from "@heroicons/react/24/outline/RectangleGroupIcon.js";
import Squares2X2Icon from "@heroicons/react/24/outline/Squares2X2Icon.js";
import { RecurringTasksIcon } from "./icons/RecurringTasksIcon";
import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import "../styles/sidebar.css";

type MenuItem = {
  path: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const MENU_ITEMS: MenuItem[] = [
  { path: "/", label: "Homepage", icon: HomeModernIcon },
  { path: "/dashboard", label: "Dashboard", icon: Squares2X2Icon },
  { path: "/repositories", label: "Repositories", icon: RectangleGroupIcon },
  { path: "/knowledge", label: "Knowledge Base", icon: BookOpenIcon },
  { path: "/constitutions", label: "Constitution", icon: CpuChipIcon },
  { path: "/tasks", label: "Tasks", icon: RecurringTasksIcon },
  { path: "/settings", label: "Settings", icon: AdjustmentsHorizontalIcon },
];

interface SidebarProps {
  open: boolean;
  onNavigate?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ open, onNavigate }) => {
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    fetch("/api/version")
      .then((res) => res.json())
      .then((data: { version: string }) => setVersion(data.version))
      .catch(() => setVersion(""));
  }, []);

  return (
    <nav className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-header">MADE</div>
      <ul>
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={onNavigate}
              >
                <Icon />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      {version && <div className="sidebar-version">v{version}</div>}
    </nav>
  );
};
