import React from 'react';
import '../styles/tabview.css';

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabViewProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

export const TabView: React.FC<TabViewProps> = ({ tabs, activeTab, onTabChange }) => {
  const singleTab = tabs.length === 1;
  return (
    <div className="tabview">
      {!singleTab && (
        <div className="tabview-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tabview-tab ${tab.id === activeTab ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="tabview-content">{tabs.find((tab) => tab.id === activeTab)?.content}</div>
    </div>
  );
};
