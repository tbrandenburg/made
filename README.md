# MADE [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![Node.js CI](https://img.shields.io/badge/CI-Node.js-green.svg)](https://nodejs.org/)

**One-line:** A comprehensive web-based development environment for managing repositories, knowledge bases, and AI agent interactions.

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
npm install

# Run development servers
npm run dev
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
npm install

# Start both backend and frontend
npm run dev
```

(Alternative: build from source: `npm run build && npm run start`)

## Usage

Minimal example to get started:

```bash
# Start the development servers
npm run dev

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

## Configuration

Required environment variables / config:

- `MADE_HOME` — string — default: `process.cwd()` — Base directory for MADE configuration and data storage
- `MADE_WORKSPACE_HOME` — string — default: `process.cwd()` — Root directory where repositories are stored
- `PORT` — number — default: `3000` — Port for the backend API server
- `NODE_ENV` — string — default: `development` — Environment mode (development/production)

The application automatically creates a `.made` directory structure:
```
$MADE_HOME/.made/
├── knowledge/     # Knowledge base articles
├── constitutions/ # Development rules and guidelines
└── settings.json  # Application settings
```

## API / Reference

The backend provides a RESTful API with endpoints for:

- **Repositories**: `/api/repositories` - CRUD operations for code repositories
- **Knowledge**: `/api/knowledge` - Manage documentation and knowledge artifacts  
- **Constitutions**: `/api/constitutions` - Define development rules and constraints
- **Agent Communication**: `/api/repositories/:name/agent` - AI agent chat interface
- **File Operations**: `/api/repositories/:name/file` - File management and editing
- **Settings**: `/api/settings` - Application configuration

## Tests & CI

Run tests:

```bash
# Unit tests (Jest)
npm test

# End-to-end tests (Playwright) 
npm run test:e2e

# Watch mode for development
npm run test:watch

# Lint code
npm run lint
```

Testing follows the pyramid approach:
- **Unit Tests** - Core business logic and services
- **Integration Tests** - API endpoints and database interactions  
- **System Tests** - Complete user workflows with Playwright

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) (or follow the short flow below):

1. Fork the project
2. Create a branch `feature/your-feature`
3. Add tests and documentation
4. Open a pull request

Development setup:
```bash
# Install dependencies
npm install

# Start development servers with hot reload
npm run dev

# Run tests before committing
npm test && npm run test:e2e
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
