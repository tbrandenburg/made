import React, { useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import "../styles/page.css";
import { StarIcon } from "../components/icons/StarIcon";
import { getFavorites, toggleFavorite } from "../utils/favorites";
import {
  getHistoryKindLabel,
  getNavigationHistory,
} from "../utils/navigationHistory";

const QUICK_LINKS = [
  {
    title: "Dashboard",
    description: "Monitor all projects and agent activity at a glance.",
    to: "/dashboard",
  },
  {
    title: "Repositories",
    description: "Browse and collaborate on repositories.",
    to: "/repositories",
  },
  {
    title: "Knowledge Base",
    description: "Manage global artefacts and documentation.",
    to: "/knowledge",
  },
  {
    title: "Constitution",
    description: "Review rules, guidelines and constraints.",
    to: "/constitutions",
  },
  {
    title: "Settings",
    description: "Configure MADE preferences and integrations.",
    to: "/settings",
  },
];

export const HomePage: React.FC = () => {
  const history = useMemo(() => getNavigationHistory(), []);
  const [favorites, setFavorites] = useState(() => getFavorites());
  const favoriteIds = useMemo(
    () => new Set(favorites.map((entry) => entry.id)),
    [favorites],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Mobile Agentic Development Environment</h1>
        <p>
          Coordinate human engineers and autonomous agents to cultivate
          repositories.
        </p>
      </header>
      <div className="panel-grid">
        {QUICK_LINKS.map((link) => (
          <Panel key={link.title} title={link.title} to={link.to}>
            <p>{link.description}</p>
          </Panel>
        ))}
      </div>

      <section className="history-section">
        <h2>Favorites</h2>
        {favorites.length === 0 ? (
          <p className="meta-secondary">
            No favorite repositories, tasks, knowledge artefacts, or
            constitutions yet.
          </p>
        ) : (
          <div className="panel-grid">
            {favorites.map((entry) => (
              <Panel key={entry.id} title={entry.name} to={entry.path}>
                <p>{getHistoryKindLabel(entry.kind)}</p>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <section className="history-section">
        <h2>Recent history</h2>
        {history.length === 0 ? (
          <p className="meta-secondary">
            No visited repositories, tasks, knowledge artefacts, or
            constitutions yet.
          </p>
        ) : (
          <div className="panel-grid">
            {history.map((entry) => (
              <Panel
                key={entry.id}
                title={entry.name}
                to={entry.path}
                className="history-panel"
                actions={
                  <button
                    type="button"
                    className="copy-button favorite-toggle"
                    aria-label={
                      favoriteIds.has(entry.id)
                        ? `Remove ${entry.name} from favorites`
                        : `Add ${entry.name} to favorites`
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleFavorite(entry);
                      setFavorites(getFavorites());
                    }}
                  >
                    <StarIcon filled={favoriteIds.has(entry.id)} />
                  </button>
                }
              >
                <p>{getHistoryKindLabel(entry.kind)}</p>
                <p className="meta-secondary">
                  {new Date(entry.visitedAt).toLocaleString()}
                </p>
              </Panel>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
