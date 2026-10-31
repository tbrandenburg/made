# MADE

![MADE mobile development workspace](https://github.com/user-attachments/assets/dfb345f8-eb0a-4ac9-81b5-7fe729c3b0e4)

**Your repositories. Your AI agents. From your phone.**

MADE (**Mobile Agentic Development Environment**) brings repository browsing,
file editing, agent chat, and project knowledge into a mobile-friendly web
workspace. Run it on your development machine or server, then work through
your browser.

[![Tests](https://github.com/tbrandenburg/made/actions/workflows/tests.yml/badge.svg)](https://github.com/tbrandenburg/made/actions/workflows/tests.yml)
[![Latest release](https://img.shields.io/github/v/release/tbrandenburg/made)](https://github.com/tbrandenburg/made/releases)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)

[Quickstart](#quickstart) · [Features](#features) · [Docker](#run-with-docker) ·
[Configuration](#configuration) · [Development](#development) · [Get help](#get-help)

## Why MADE?

Coding agents run where your code lives. MADE gives you a browser interface to
that environment, so you can inspect a repository, ask an agent to work on it,
and keep the project's notes and development rules close at hand—even on a
small screen.

The frontend is **React + Vite**; the backend is **Python + FastAPI**. Agent
chat uses CLI adapters on the backend host rather than requiring a separate
editor on your phone.

## Quickstart

### Repository Build & Tasks

Open a repository's **Build & Tasks** tab to run trusted Make/go-task targets as
backend processes (not agent prompts). Targets without declared parameters start
on click; parameterized targets show a required-value/enum dialog. Each file has
its own button grid. **Runs** shows independent run IDs, PID, timestamps, actual
exit status, duration and **View tail** output. Refresh re-discovers changed files.

Discovery is static: it never runs Make, Task, recipes, `$(shell ...)`, or YAML
`sh:` variables. It scans the root and four nested directory levels, bounded to
2,000 directories, 200 files, 256 KiB/file and 500 targets/file. Hidden,
dependency/generated directories and symlinks are excluded. Supported files:
`GNUmakefile`, `makefile`, `Makefile`, and `Taskfile.yml`/`.yaml`, lowercase variants
and `Taskfile.dist.yml`/`.yaml` (also lowercase).

Make discovery recognizes literal rules, including multiple targets, adjacent
description comments and `##` descriptions. It does not resolve includes,
computed targets, patterns, `define` bodies or conditional expansion. Declare
parameters directly above a rule; `!` marks a required parameter:

```make
# Run a selected test file
# made:args FILE! NAME
test-file:
	@test -n "$(FILE)"
	@echo "Run $(FILE) with optional filter $(NAME)"
```

Taskfiles use safe YAML parsing, `desc`/`summary`, `requires.vars` and literal
`enum` choices. Public local task names (including namespaces) are shown;
`internal: true` tasks and local files included with `internal: true` are hidden.
Discovery does not expand include namespaces,
task-name aliases, templates or dynamic enum references. YAML aliases and merge
keys (`<<`) are rejected before loading, including small chained-merge documents;
v1 does not support YAML anchor reuse. Nested files run explicitly from
their containing directory; Task's authored `dir:` remains effective. Interactive
or confirmation-prompt tasks are disabled; v1 has no terminal/PTY and closes stdin.
Install **GNU Make** and/or [go-task](https://taskfile.dev/docs/installation) on the
backend host's PATH. One missing tool does not prevent discovery or other tools.

Runs persist in the repository's `.flowsh/logs/build-task-<runId>.log` and private
JSON sidecars. **Tasks → Run logs** labels these **Build & Tasks**, separately from
existing flowsh workflow logs. Tail reads are capped to 64 KiB/200 lines (the shared
Tasks view requests 20 lines); run-list responses contain at most 50 records.
Files are created with mode `0600` and new log directories with `0700`; `.flowsh/logs`
must stay ignored by Git. Newly used log directories receive an ignore-everything
`.gitignore` if none exists; existing ignore files are preserved. There is no
automatic retention/deletion in v1.
After a backend restart, an unowned unfinished run is **Unknown / interrupted**,
never declared successful/running based only on its old PID. The process may
survive; MADE does not implicitly cancel it or other runs.

**Security:** this is not a sandbox. Clicking a target executes repository code
with backend permissions. Parameters use validated names and single argv values,
not a shell command assembled by MADE; dollar signs are escaped against Make's
own recursive variable expansion. Repository recipes/templates can themselves
expand/interpolate variables: authors must quote or pass environment values safely.
Discovery and dispatch reject reserved Make parameters: `SHELL`, `MAKESHELL`,
`COMSPEC`, `MAKE`, `MAKE_COMMAND`, `MAKEFLAGS`, `GNUMAKEFLAGS`, `MFLAGS`, `MAKEFILES`,
`MAKEOVERRIDES`, `MAKELEVEL`, `MAKE_RESTARTS`, `MAKEFILE_LIST`, `MAKECMDGOALS`,
`MAKE_HOST`, `MAKE_VERSION`, `MAKE_TERMOUT`, `MAKE_TERMERR`, `CURDIR`, `GPATH`, `VPATH`.
Dot-prefixed Make special variables are excluded by the parameter-name grammar.
Task's reserved template variables are also rejected: `CLI_ARGS`, `CLI_ARGS_LIST`,
`CLI_FORCE`, `CLI_SILENT`, `CLI_VERBOSE`, `CLI_OFFLINE`, `CLI_ASSUME_YES`, `TASK`,
`ALIAS`, `TASK_EXE`, `ROOT_TASKFILE`, `ROOT_DIR`, `TASKFILE`, `TASKFILE_DIR`, `TASK_DIR`,
`USER_WORKING_DIR`, `FILE_PATH_SEPARATOR`, `PATH_LIST_SEPARATOR`, `CHECKSUM`,
`TIMESTAMP`, `ITEM`, `EXIT_CODE`, `TASK_VERSION`.
Parameter names use `[A-Za-z_][A-Za-z0-9_]{0,63}`; requests accept up to 50 values,
each at most 4,096 characters with no NUL or line breaks. Task required-variable
lists are capped at 50 entries and literal enums at 100 choices.
Log access pins directory handles rather than following a validated pathname later.
If output disappears or becomes unreadable, run details report **Output unavailable**
while retaining the true process outcome, exit code and timing independently.
Output can contain secrets, including anything scripts print. Backend lifecycle
logs omit submitted values and bulk output; run logs are private but not redacted.

Focused real verification (after dependency installation and frontend build):

```bash
(cd packages/pybackend && uv run pytest tests/unit/test_build_task_service.py tests/unit/test_build_task_security.py tests/unit/test_run_log_security.py)
npm --workspace packages/frontend test -- src/components/BuildTasksTab.test.tsx
npm run build:frontend
npx playwright test tests/system/build-tasks.spec.ts --reporter=list
```

The component tests start a real scoped feature backend. The browser test starts
the real MADE backend with built frontend, temporary MADE/workspace homes, harmless
fixtures and dynamically allocated nonstandard ports. It exercises the 16 issue
acceptance steps and writes screenshot/run-ID/log evidence under `test-results/`.
It requires `make`, `task`, Python, Git, and an installed Playwright Chromium;
it never calls the project's run/stop/restart targets or uses ports 3000/5173.

### Prerequisites

- **Node.js 22.12+** and npm.
- **Python 3.12+** and [uv](https://docs.astral.sh/uv/getting-started/installation/).
- **Git** and **Make**.
- For agent chat: a supported agent CLI installed and authenticated on the
  backend host. Repository browsing and editing do not require an agent CLI.

```bash
git clone https://github.com/tbrandenburg/made.git
cd made
make install
make run
```

Open **[https://localhost:5173](https://localhost:5173)**. The development frontend
uses a self-signed certificate; your browser may ask you to accept it.
The backend API listens at `http://localhost:3000`.

> **Existing development session?** `make run` stops processes using its configured
> backend and frontend ports before starting. Do not run it over a session you
> want to keep. See [starting services separately](/docs/DEVELOPMENT.md#start-services-without-stopping-an-existing-session).

### Your first session

1. **Open Settings** and choose the adapter for your installed agent CLI.
2. **Create or clone a repository** in the workspace, then open it.
3. **Browse a file** to get your bearings, or edit it in the browser.
4. **Open Agent chat** and ask a concrete question, such as “Explain this
   repository's structure and suggest the next step.”
5. **Keep context nearby:** add project notes to Knowledge and development
   guidelines to Constitutions.

To use MADE from your phone, the device needs a route to the host. Use a trusted
private network or an authenticated HTTPS gateway; `localhost` on your phone is
not your development machine. See [security](#security) before exposing MADE.

## Features

| Work on…                | With MADE                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **Repositories**        | Create, clone, browse, and inspect Git-backed projects.                                  |
| **Agent conversations** | Chat with a backend CLI agent and revisit saved sessions where supported by the adapter. |
| **Files**               | Read and edit repository files with Markdown preview.                                    |
| **Project knowledge**   | Organize notes and documentation as Markdown files.                                      |
| **Development rules**   | Maintain constitutions that describe project guidelines and constraints.                 |
| **Repeatable work**     | Discover reusable commands and manage workflows and scheduled tasks.                     |
| **Small screens**       | Use a responsive interface with light and dark themes.                                   |

Agent choices include OpenCode (database, v2, and legacy adapters), Claude Code,
Codex, GitHub Copilot, Kiro, OB1, and Pi. Capabilities and model availability
depend on the selected CLI and its configuration.

The `opencode-v2` adapter reads selected-session history through OpenCode's
authenticated local HTTP service. The service must be running; MADE does not
start/restart it or fall back to SQLite. If JSON complexity prevents a full
snapshot, it retries newest-first and may return up to 50 recent records with a
reduced-history warning. V2 session listing and activity detection still use
SQLite. History reads support up to 10,000 records within shared resource
budgets and run off the server event loop. See the
[history security and refresh contract](/docs/CONFIGURATION.md#opencode-database-history)
and the [isolated real-service/browser acceptance](/docs/DOCKER.md#opencode-v2-acceptance).
The session picker also lists v2 child sessions in a separate parent-labeled
section, scoped to the same repository directory.

### JavaScript-free Lite chat

Open `/lite/` on the backend or web interface to browse repositories and chat
without JavaScript. To view an existing conversation, select its session and click
**Load**; selecting an option alone does not fetch history. A fresh page without
a selected session explains this workflow instead of implying that saved history
is empty. Choosing **New session** clears that repository's saved session cookie;
a page request without a session parameter can still restore the remembered session.

Lite displays each history message once. If history cannot be loaded, it shows a
generic error and **Retry history** link that preserves the selected session,
rather than reporting an empty conversation. Successful empty sessions retain the
**No messages yet.** state.

Lite acknowledges **Send** immediately and redirects to a JavaScript-free
waiting page while the existing agent runner executes in the background. The
page tracks the submission separately from its eventual session ID and opens
that session when execution succeeds. Failures and unknown/expired submissions
are reported explicitly; going back does not cancel an accepted submission.

Submission tracking is process-local and requires a **single backend worker**.
It is not a durable queue: restarting the backend may lose queued work or its
tracking, and an agent process may survive the restart. Unknown submissions are
never automatically resent. Keep the waiting-page link until completion; avoid
resubmitting an uncertain request, which could create another agent execution.
Each worker admits up to eight pending Lite submissions and retains up to 128
tracking records; completed records expire after 15 minutes. A full worker
rejects new submissions instead of accepting an unbounded queue.

## Run with Docker

From the repository root, build and start the backend and Nginx frontend:

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

- **Web interface:** [http://localhost:8080](http://localhost:8080).
- **Backend API:** `http://localhost:3000`.
- **Persistent data:** named volumes `made-data` (settings and knowledge) and
  `made-workspace` (repositories).

The backend image installs OpenCode. Configure its authentication inside the
container before chatting; host credentials are not mounted automatically.

Stop this stack without deleting its data:

```bash
docker compose -f docker/docker-compose.yml down
```

See the [Docker guide](/docs/DOCKER.md) for isolated agent acceptance testing and
the pinned OpenCode v2 environment.

## Configuration

| Variable               | Purpose                                                 | Default                                                        |
| ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| `MADE_HOME`            | Base directory for `.made` configuration and knowledge. | Backend working directory; `make run` uses `<repo>/workspace`. |
| `MADE_WORKSPACE_HOME`  | Directory containing your repositories.                 | Backend working directory; `make run` uses `<repo>/workspace`. |
| `MADE_BACKEND_HOST`    | Backend bind address.                                   | `0.0.0.0`                                                      |
| `MADE_BACKEND_PORT`    | Backend port when using `made-backend`.                 | `3000`                                                         |
| `MADE_ALLOWED_ORIGINS` | Comma-separated CORS origins.                           | `http://localhost:5173,http://127.0.0.1:5173`                  |

Set Make variables when using `make run`, for example:

```bash
make run MADE_HOME=/path/to/data MADE_WORKSPACE_HOME=/path/to/projects
```

MADE stores knowledge, constitutions, tasks, and settings under
`$MADE_HOME/.made/`. Select the agent adapter in **Settings**.
See the [configuration reference](/docs/CONFIGURATION.md) for command discovery
and OpenCode database settings.

## Development

| Command              | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `make install`       | Install dependencies and the pre-push quality hook.           |
| `make run`           | Start the backend and frontend with development reload.       |
| `make qa-quick`      | Format, lint, check the backend lockfile, and run unit tests. |
| `make test-coverage` | Run frontend and backend coverage checks.                     |
| `make system-test`   | Run full-stack Playwright and backend system tests.           |
| `make build`         | Build the frontend and Python package.                        |

`make qa-quick` can rewrite files through its formatting step. System tests
refuse occupied ports rather than interrupting an existing session. To run
alongside development servers, choose free nonstandard ports, for example
`make system-test PORT=3100 FRONTEND_PORT=5273`. The runner waits for successful
GET readiness checks, reports startup failures, and cleans up its own services.
See the [development guide](/docs/DEVELOPMENT.md) for focused tests, contribution
steps, and releases.

### Repository map

```text
packages/frontend/   React interface and component tests
packages/pybackend/  FastAPI services, CLI adapters, and Python tests
tests/               Playwright end-to-end tests
docker/              Container images and Compose configurations
scripts/             Development, quality, and release tooling
docs/                Configuration, Docker, and contributor guides
```

## Security

MADE can edit files and invoke coding agents with the backend user's permissions.
Treat access to the application as access to that development environment.

- Keep the backend and frontend on a trusted network, or place them behind an
  authenticated gateway. Do not expose the default setup directly to the internet.
- Keep API keys and CLI credentials out of Git and container images.
- Report vulnerabilities privately through
  [GitHub's security reporting page](https://github.com/tbrandenburg/made/security).
  If private reporting is unavailable, contact the maintainer before posting details publicly.

## Get help

- **Bug reports and feature requests:** [GitHub Issues](https://github.com/tbrandenburg/made/issues).
- **Versions and release notes:** [Releases](https://github.com/tbrandenburg/made/releases)
  and [Changelog](/CHANGELOG.md).
- **Maintainer:** [Tom Brandenburg](https://github.com/tbrandenburg).

Want to contribute? Start with the [development guide](/docs/DEVELOPMENT.md#contribute).

## License

MADE is released under the [MIT License](/LICENSE).
