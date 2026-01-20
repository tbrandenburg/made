import React, { useCallback, useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { Panel } from "./Panel";
import { Modal } from "./Modal";
import { CommandDefinition } from "../hooks/useApi";

const stripCommandFrontmatter = (content: string) => {
  const delimiterPattern =
    /^\s*---(?:[\r\n]+[\s\S]*?[\r\n]+---|[\s\S]*?---)\s*/;
  return delimiterPattern.test(content)
    ? content.replace(delimiterPattern, "").trim()
    : content.trim();
};

const ARGUMENT_SPECIFIER_PATTERN = /\[([^\]]+)\]|<([^>]+)>/g;
const PARENTHETICAL_COMMENT_PATTERN = /\s*\([^()]*\)\s*$/g;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]*`/g;

const stripCodeBlocks = (content: string) =>
  content.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");

const normalizeArgumentHint = (argumentHint?: string | string[] | null) => {
  if (!argumentHint) return "";
  if (Array.isArray(argumentHint)) {
    return argumentHint
      .filter((value) => typeof value === "string")
      .map((value) => value.replace(PARENTHETICAL_COMMENT_PATTERN, "").trim())
      .filter(Boolean)
      .join(" ");
  }
  return typeof argumentHint === "string"
    ? argumentHint.replace(PARENTHETICAL_COMMENT_PATTERN, "").trim()
    : "";
};

const extractArgumentLabels = (argumentHint?: string | string[] | null) => {
  const normalizedHint = normalizeArgumentHint(argumentHint);
  return normalizedHint
    ? Array.from(normalizedHint.matchAll(ARGUMENT_SPECIFIER_PATTERN))
        .map((match) => (match[1] || match[2] || "").trim())
        .filter(Boolean)
    : [];
};

const formatArgumentHint = (argumentHint?: string | string[] | null) => {
  const normalizedHint = normalizeArgumentHint(argumentHint);
  if (!normalizedHint) return "";
  const labels = extractArgumentLabels(normalizedHint);
  if (labels.length) {
    return labels.join(" ");
  }

  return normalizedHint.trim();
};

const formatCommandSourceLabel = (source: string) => {
  switch (source) {
    case "user":
      return "USER";
    case "made":
      return "MADE";
    case "workspace":
      return "WS";
    case "repository":
      return "REPO";
    default:
      return source.toUpperCase();
  }
};

const COMMAND_ACTIONS = [
  {
    id: "init-openspec",
    label: "Initialize OpenSpec",
    prompt: 'Execute "openspec init --tools opencode" to initialize OpenSpec.',
  },
  {
    id: "init-spec-kit",
    label: "Initialize Spec Kit",
    prompt:
      'Execute "specify init . --ai opencode --script sh" to initialize the Spec Kit.',
  },
  {
    id: "init",
    label: "Initialize Repository",
    prompt: "Please initialise this repository with sensible defaults.",
  },
  {
    id: "remote",
    label: "Create Remote Repository",
    prompt: "Create a remote repository and connect it to this project.",
  },
  {
    id: "pr",
    label: "Create Pull Request",
    prompt: "Draft a pull request with the latest repository changes.",
  },
  {
    id: "deploy",
    label: "Deploy",
    prompt: "Prepare deployment steps for this project.",
  },
  {
    id: "preview",
    label: "Preview",
    prompt: "Create a preview build for review.",
  },
  {
    id: "publish",
    label: "Publish",
    prompt: "Publish the project to the designated target.",
  },
];

const MagnifyingGlassIcon: React.FC = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" role="img" focusable="false">
    <path
      d="M11 4a7 7 0 1 0 4.39 12.46l3.58 3.58a1 1 0 0 0 1.42-1.42l-3.58-3.58A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type CommandModalState = {
  open: boolean;
  command: CommandDefinition | null;
  labels: string[];
  placeholders: string[];
  values: string[];
};

type CommandsTabProps = {
  loadCommands: () => Promise<CommandDefinition[]>;
  onSendMessage: (message: string) => void;
};

export const CommandsTab: React.FC<CommandsTabProps> = ({
  loadCommands,
  onSendMessage,
}) => {
  const [availableCommands, setAvailableCommands] = useState<
    CommandDefinition[]
  >([]);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandPreview, setCommandPreview] = useState<CommandDefinition | null>(
    null,
  );
  const [commandModal, setCommandModal] = useState<CommandModalState>({
    open: false,
    command: null,
    labels: [],
    placeholders: [],
    values: [],
  });

  const fetchCommands = useCallback(() => {
    setCommandsLoading(true);
    loadCommands()
      .then((commands) => {
        const sortedCommands = [...commands].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        setAvailableCommands(sortedCommands);
        setCommandsError(null);
      })
      .catch((error) => {
        console.error("Failed to load commands", error);
        const message =
          error instanceof Error ? error.message : "Failed to load commands";
        setCommandsError(message);
      })
      .finally(() => setCommandsLoading(false));
  }, [loadCommands]);

  useEffect(() => {
    fetchCommands();
  }, [fetchCommands]);

  const getCommandArgumentPlan = (command: CommandDefinition) => {
    const labelsFromHint = extractArgumentLabels(command.argumentHint);

    if (labelsFromHint.length) {
      return {
        labels: labelsFromHint,
        placeholders: labelsFromHint.map((_, index) => `$${index + 1}`),
      };
    }

    const contentWithoutCode = stripCodeBlocks(command.content);
    const numericPlaceholders = Array.from(
      new Set(
        Array.from(contentWithoutCode.matchAll(/\$([1-9]\d*)/g)).map(
          (match) => match[1],
        ),
      ),
    ).sort((a, b) => Number(a) - Number(b));

    if (numericPlaceholders.length) {
      return {
        labels: numericPlaceholders.map((value) => `Arg ${value}`),
        placeholders: numericPlaceholders.map((value) => `$${value}`),
      };
    }

    if (contentWithoutCode.includes("$ARGUMENTS")) {
      return { labels: ["Arguments"], placeholders: ["$ARGUMENTS"] };
    }

    return { labels: [], placeholders: [] };
  };

  const handleCommandSelection = (command: CommandDefinition) => {
    closeCommandPreview();
    const plan = getCommandArgumentPlan(command);
    if (plan.labels.length === 0) {
      onSendMessage(stripCommandFrontmatter(command.content));
      return;
    }

    setCommandModal({
      open: true,
      command,
      labels: plan.labels,
      placeholders: plan.placeholders,
      values: Array(plan.labels.length).fill(""),
    });
  };

  const handleCommandValueChange = (index: number, value: string) => {
    setCommandModal((prev) => ({
      ...prev,
      values: prev.values.map((existing, idx) =>
        idx === index ? value : existing,
      ),
    }));
  };

  const closeCommandModal = () =>
    setCommandModal({
      open: false,
      command: null,
      labels: [],
      placeholders: [],
      values: [],
    });

  const openCommandPreview = (command: CommandDefinition) => {
    setCommandPreview(command);
  };

  const closeCommandPreview = () => {
    setCommandPreview(null);
  };

  const handleCommandConfirm = () => {
    if (!commandModal.command) return;
    let text = stripCommandFrontmatter(commandModal.command.content);
    commandModal.placeholders.forEach((placeholder, index) => {
      const value = commandModal.values[index] ?? "";
      text = text.split(placeholder).join(value);
    });

    if (text.includes("$ARGUMENTS")) {
      text = text
        .split("$ARGUMENTS")
        .join(commandModal.values.join(" ").trim());
    }

    onSendMessage(text.trim());
    closeCommandModal();
  };

  const commandPreviewContent = useMemo(
    () =>
      commandPreview ? stripCommandFrontmatter(commandPreview.content) : "",
    [commandPreview],
  );

  return (
    <div className="command-center">
      <Panel
        title="User Commands"
        actions={
          <button
            className="secondary"
            onClick={fetchCommands}
            disabled={commandsLoading}
          >
            Refresh
          </button>
        }
      >
        {commandsLoading && <div className="alert">Loading commands...</div>}
        {commandsError && <div className="alert error">{commandsError}</div>}
        {!commandsLoading && !commandsError && (
          <>
            {availableCommands.length === 0 ? (
              <div className="empty">
                No commands found in configured directories.
              </div>
            ) : (
              <div className="commands-grid">
                {availableCommands.map((command) => {
                  const description = command.description || command.name;
                  const argumentPlan = getCommandArgumentPlan(command);
                  const usesArguments = argumentPlan.labels.length > 0;
                  return (
                    <div className="command-button-wrapper" key={command.id}>
                      <button
                        className="primary command-button command-button--previewable"
                        title={`${command.source} • ${command.name}`}
                        onClick={() => handleCommandSelection(command)}
                      >
                        <span className="command-button__badges">
                          {usesArguments && (
                            <span className="command-button__badge command-button__badge--args">
                              ARGS
                            </span>
                          )}
                          <span className="command-button__badge">
                            {formatCommandSourceLabel(command.source)}
                          </span>
                        </span>
                        <span className="command-button__title">
                          {command.name}
                        </span>
                        <span className="command-button__description">
                          {description}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="command-button__preview"
                        onClick={() => openCommandPreview(command)}
                        aria-label={`Preview ${command.name} command`}
                        title="Preview command"
                      >
                        <MagnifyingGlassIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Panel>
      <Panel title="Pre-installed Commands">
        <div className="commands-grid">
          {COMMAND_ACTIONS.map((action) => (
            <button
              key={action.id}
              className="primary"
              onClick={() => onSendMessage(action.prompt)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </Panel>

      <Modal
        open={commandModal.open}
        title={commandModal.command?.description || "Run Command"}
        onClose={closeCommandModal}
      >
        {commandModal.labels.length > 0 ? (
          commandModal.labels.map((label, index) => (
            <div className="form-group" key={`${label}-${index}`}>
              <label>{label}</label>
              <textarea
                value={commandModal.values[index] || ""}
                onChange={(event) =>
                  handleCommandValueChange(index, event.target.value)
                }
                placeholder={
                  formatArgumentHint(commandModal.command?.argumentHint) ||
                  `Value for ${label}`
                }
                rows={3}
              />
            </div>
          ))
        ) : (
          <p>This command does not require any arguments.</p>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={closeCommandModal}>
            Cancel
          </button>
          <button className="primary" onClick={handleCommandConfirm}>
            Insert into chat
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(commandPreview)}
        title={
          commandPreview ? `Command Preview: ${commandPreview.name}` : "Preview"
        }
        onClose={closeCommandPreview}
        className="modal--command-preview"
      >
        {commandPreview && commandPreviewContent ? (
          <div
            className="markdown"
            dangerouslySetInnerHTML={{
              __html: marked(commandPreviewContent),
            }}
          />
        ) : (
          <p>No command content available.</p>
        )}
      </Modal>
    </div>
  );
};
