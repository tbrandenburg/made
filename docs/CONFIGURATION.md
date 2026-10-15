# Configuration reference

Use this reference when changing workspace locations, reusable commands, or
OpenCode history storage. For initial setup, return to the [README](/README.md#configuration).

## Workspace storage

`MADE_HOME` sets the base directory for configuration and knowledge.
`MADE_WORKSPACE_HOME` sets the directory containing repositories. Both default
to the backend's working directory; the root Makefile sets both to
`<repo>/workspace` unless overridden.

```text
$MADE_HOME/.made/
├── knowledge/      # Notes and documentation
├── constitutions/  # Development rules and guidelines
├── tasks/          # Task documents
└── settings.json   # Application settings
```

Select the agent CLI adapter in Settings. The selected executable must be on
the backend process's `PATH` and authenticated for the backend user.

## Command discovery

MADE combines commands from these locations and deduplicates by resolved file path:

| Scope      | Locations                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| MADE home  | `$MADE_HOME/.made/commands/`, `$MADE_HOME/.kiro/prompts/`                                                                         |
| Workspace  | `$MADE_WORKSPACE_HOME/.made/commands/`, `$MADE_WORKSPACE_HOME/.kiro/prompts/`                                                     |
| User       | `~/.made/commands/`, `~/.claude/commands/`, `~/.codex/commands/`, `~/.kiro/commands/`, `~/.kiro/prompts/`, `~/.opencode/command/` |
| Repository | `$MADE_WORKSPACE_HOME/<repo>/.*/commands/**/*.md`, `$MADE_WORKSPACE_HOME/<repo>/.*/prompts/**/*.md`                               |

Command listings use a 60-second in-memory cache. After adding a command,
wait for the cache to expire before checking discovery.

## OpenCode database history

The `opencode` and `opencode-v2` adapters read saved history using short-lived,
read-only SQLite connections. History reads do not invoke `opencode api`.

- Set `OPENCODE_DB` to an absolute database path to avoid CLI path discovery.
- The v1 adapter also supports `OPENCODE_DATABASE_PATH`; an existing file at
  that legacy override takes precedence.
- V2 caches successful path discovery across adapter instances, keyed by the
  working directory and the `PATH`, `HOME`, `XDG_DATA_HOME`, and `OPENCODE_DB`
  values. Explicit overrides are checked before the cache.
- If the cached file disappears, v2 discovers it again. Failed discovery is
  retried on the next read. Connections and history contents are not cached.
- Restart the backend after an OpenCode upgrade if the database moves but the
  old database still exists.

V2 tool messages show the tool name and input arguments in live responses and
saved history. Argument previews are truncated to 90 characters, matching the
v1 database adapter.

To verify a configuration change, save the adapter in Settings, reload the page,
send a message, and reopen the session after another reload. Use the
[isolated Docker acceptance process](/docs/DOCKER.md#agent-cli-acceptance) to test
without changing your host configuration.

## API reference

With the backend running, open its generated API documentation at
`http://localhost:3000/docs`. The OpenAPI schema is at
`http://localhost:3000/openapi.json`.

The API includes repository, file, agent chat, knowledge, constitution, task,
workflow, and settings operations. Check the generated reference for exact
methods, paths, and request bodies instead of copying frontend route patterns.
