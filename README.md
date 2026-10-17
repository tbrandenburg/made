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
start/restart it or fall back to SQLite on history failure. V2 session listing
and activity detection still use SQLite. See the
[history security and refresh contract](/docs/CONFIGURATION.md#opencode-database-history)
and the [isolated real-service/browser acceptance](/docs/DOCKER.md#opencode-v2-acceptance).

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
need the standard development ports; do not run them over an existing session.
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
