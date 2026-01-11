# MADE [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![Node.js CI](https://img.shields.io/badge/CI-Node.js-green.svg)](https://nodejs.org/)

![8382E3F9-F4E9-43DD-8BBD-E2C1E5206DC6](https://github.com/user-attachments/assets/dfb345f8-eb0a-4ac9-81b5-7fe729c3b0e4)

**One-line:** A comprehensive web-based development environment for managing repositories, knowledge bases, and AI agent interactions - optimized for your phone 📱!

MADE (Mobile Agentic Development Environment) is a full-stack Node.js application that provides developers with an integrated workspace for project management, knowledge organization, and AI-powered development assistance. It features a React-based frontend with repository browsing, file editing, markdown-based knowledge management, and seamless agent communication through the A2A protocol.

## Key Features

- 📁 **Repository Management** - Create, browse, and manage multiple code repositories with Git integration
- 🤖 **AI Agent Integration** - Chat with AI agents for code assistance, project planning, and development guidance
- 📚 **Knowledge Base** - Organize documentation, notes, and project artifacts with markdown support
- ⚖️ **Constitution System** - Define and manage development rules, guidelines, and constraints
- 📝 **Integrated File Editor** - Edit files directly in the browser with live preview capabilities
- 🚀 **Publishment Workflows** - Streamlined deployment and publishing automation
- 🎨 **Modern UI** - Responsive React interface with dark/light theme support

## Quickstart

```bash
# Install dependencies (preferred)
make install

# Run development servers
make run
```

## Table of Contents

- [Quickstart](#quickstart)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)
- [Security](#security)
- [Maintainers](#maintainers)

## Installation

Install dependencies and start the development environment:

```bash
# Clone the repository
git clone https://github.com/tbrandenburg/made.git
cd made

# Install all dependencies (monorepo setup)
make install

# Run both frontend and Python backend
make run
```

(Alternative: build from source: `npm run build && npm run start`)

## Usage

Minimal example to get started:

```bash
# Start the development servers
make run

# Backend runs on: http://localhost:3000
# Frontend runs on: http://localhost:5173
```

Expected output:

```
MADE backend listening on http://0.0.0.0:3000
MADE frontend available on http://localhost:5173
```

Access the web interface at `http://localhost:5173` to:

1. **Browse Repositories** - View and manage your code projects
2. **Chat with Agents** - Get AI assistance for development tasks  
3. **Manage Knowledge** - Create and organize documentation
4. **Define Constitutions** - Set development rules and guidelines
5. **Edit Files** - Use the integrated editor with live preview

## Docker Deployment

Container images are provided for both the API backend and the static frontend. The [`docker-compose.yml`](./docker-compose.yml) file builds and runs the complete stack with one command.

```bash
# Build images and start the containers
docker compose up --build

# Backend API:    http://localhost:3000
# Frontend (Nginx): http://localhost:8080
```

The backend persists its `.made` workspace inside the named `made-data` volume defined in the compose file. Environment variables such as `MADE_HOME`, `MADE_WORKSPACE_HOME`, `MADE_BACKEND_HOST`, or `MADE_BACKEND_PORT` can be overridden by editing the `pybackend` service configuration.

## Configuration

Environment variables / config:

- `MADE_HOME` — string — default: `process.cwd()` — Base directory for MADE configuration and data storage
- `MADE_WORKSPACE_HOME` — string — default: `process.cwd()` — Root directory where repositories are stored
- `MADE_BACKEND_HOST` — string — default: `0.0.0.0` — Host address for the backend API server
- `MADE_BACKEND_PORT` — number — default: `3000` — Port for the backend API server

The application automatically creates a `.made` directory structure:
```
$MADE_HOME/.made/
├── knowledge/     # Knowledge base articles
├── constitutions/ # Development rules and guidelines
└── settings.json  # Application settings
```

### Command Discovery Locations

MADE loads commands from the following locations (first found are combined):

- `$MADE_HOME/.made/commands/` — pre-installed commands bundled at the MADE home.
- `$MADE_WORKSPACE_HOME/.made/commands/` — workspace-scoped commands.
- `~/.made/commands/`, `~/.claude/commands/`, `~/.codex/commands/`, `~/.kiro/commands/`, `~/.opencode/command/` — user commands.
- `$MADE_WORKSPACE_HOME/<repo>/.*/commands/**/*.md` — repository-specific commands inside hidden folders.

## API / Reference

The backend provides a RESTful API with endpoints for:

- **Repositories**: `/api/repositories` - CRUD operations for code repositories
- **Knowledge**: `/api/knowledge` - Manage documentation and knowledge artifacts  
- **Constitutions**: `/api/constitutions` - Define development rules and constraints
- **Agent Communication**: `/api/repositories/:name/agent` - AI agent chat interface
- **File Operations**: `/api/repositories/:name/file` - File management and editing
- **Settings**: `/api/settings` - Application configuration

## Tests & CI

### Quick Test Commands

```bash
# Unit tests (Python backend)
make unit-test

# System tests (Playwright)
make system-test

# All tests with coverage
make test-coverage

# Lint and format code
make qa
```

### Testing Execution Patterns

**For Unit Tests (Jest):**
```bash
# Simple - no dependencies required
npm test
```

**For End-to-End Tests (Playwright):**

Playwright tests require the full application stack running. Follow this sequence:

```bash
# 1. First-time setup (one-time only)
npm install
npx playwright install                    # Download browser binaries
sudo npx playwright install-deps         # Install system dependencies (optional)

# 2. Start application servers (keep running)
# Use make run to start both services:
make run
# Wait for both:
# "✅ Backend started" and "VITE v5.4.21 ready"

# 3. Verify server connectivity (optional)
curl http://localhost:3000 -I            # Backend health check
curl http://localhost:5173 -I            # Frontend health check

# 4. Run tests (separate terminal)
# Terminal 3 - Tests:
npx playwright test                       # All tests
npx playwright test --grep "test name"   # Specific test
npx playwright test --headed             # Visual debugging
```

**Alternative - Combined Server Start:**
```bash
# Start both servers in background
make run &
sleep 5                                   # Wait for startup
npx playwright test                       # Run tests
```

### Testing Architecture

Testing follows the pyramid approach:
- **Unit Tests** - Core business logic and services (pytest)
- **Integration Tests** - API endpoints and database interactions (pytest)
- **System Tests** - Full user journeys and workflows (Playwright)

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) (or follow the short flow below):

1. Fork the project
2. Create a branch `feature/your-feature`
3. Add tests and documentation
4. Open a pull request

Development setup:
```bash
# Install dependencies
make install

# Start development servers with hot reload
make run

# Run quality assurance checks before committing
make qa
```

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.

## Security

- Never commit secrets or API keys to the repository
- Use environment variables for sensitive configuration
- Follow secure coding practices for file operations
- Report security issues privately to the maintainers

## Maintainers

- **Tom Brandenburg** — contact: [GitHub Profile](https://github.com/tbrandenburg)
