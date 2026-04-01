import React, { useMemo, useState } from "react";
import { Panel } from "./Panel";

type TreeItem<T> = {
  name: string;
  value: T;
};

type TreeNode<T> = {
  folders: Map<string, TreeNode<T>>;
  items: TreeItem<T>[];
};

const MAX_FOLDER_LEVEL = 3;

const createNode = <T,>(): TreeNode<T> => ({
  folders: new Map<string, TreeNode<T>>(),
  items: [],
});

const buildTree = <T extends { name: string }>(items: T[]): TreeNode<T> => {
  const root = createNode<T>();

  items.forEach((item) => {
    const parts = item.name.split("/").filter(Boolean);
    const fileName = parts.pop();

    if (!fileName) {
      return;
    }

    const folderParts = parts.slice(0, MAX_FOLDER_LEVEL);
    const overflowParts = parts.slice(MAX_FOLDER_LEVEL);
    const mergedFileName = [...overflowParts, fileName].join("/");

    let current = root;
    folderParts.forEach((part) => {
      if (!current.folders.has(part)) {
        current.folders.set(part, createNode<T>());
      }
      current = current.folders.get(part)!;
    });

    current.items.push({ name: mergedFileName, value: item });
  });

  return root;
};

interface NestedArtefactPanelsProps<T extends { name: string; routeName?: string }> {
  items: T[];
  basePath: string;
  renderMetadata: (item: T) => React.ReactNode;
  renderActions?: (item: T) => React.ReactNode;
}

export const NestedArtefactPanels = <
  T extends { name: string; routeName?: string },
>({
  items,
  basePath,
  renderMetadata,
  renderActions,
}: NestedArtefactPanelsProps<T>) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(
    {},
  );

  const tree = useMemo(() => buildTree(items), [items]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [folderPath]: !current[folderPath],
    }));
  };

  const renderNode = (node: TreeNode<T>, folderPath: string, depth: number) => {
    const folderEntries = Array.from(node.folders.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    const sortedItems = [...node.items].sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div className="nested-tree-block">
        {folderEntries.length > 0 && (
          <div className="nested-tree-section">
            <div className="meta-secondary">Folders</div>
            <div className="panel-column">
              {folderEntries.map(([folderName, folderNode]) => {
                const nextPath = folderPath ? `${folderPath}/${folderName}` : folderName;
                const isExpanded = Boolean(expandedFolders[nextPath]);

                return (
                  <div key={nextPath} className="nested-folder-item">
                    <button
                      type="button"
                      className="nested-folder-toggle"
                      onClick={() => toggleFolder(nextPath)}
                    >
                      <span>{isExpanded ? "▾" : "▸"}</span>
                      <span>{folderName}</span>
                    </button>
                    {isExpanded && depth < MAX_FOLDER_LEVEL && (
                      <Panel title={folderName} className="nested-folder-panel">
                        {renderNode(folderNode, nextPath, depth + 1)}
                      </Panel>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sortedItems.length > 0 && (
          <div className="nested-tree-section">
            <div className="meta-secondary">Files</div>
            <div className="panel-column">
              {sortedItems.map(({ name, value }) => {
                const routeName = value.routeName ?? value.name;
                return (
                  <Panel
                    key={routeName}
                    title={name}
                    to={`${basePath}/${encodeURIComponent(routeName)}`}
                    actions={renderActions?.(value)}
                  >
                    {renderMetadata(value)}
                  </Panel>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return renderNode(tree, "", 1);
};
