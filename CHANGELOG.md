# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.2.4] - 2026-11-25

### Security
- Update TypeScript-ESLint beyond the affected range and force patched minimatch where compatible.
- Remove unused npm-run-all2 dependency.
- Stryker 9.6.1 still pins vulnerable minimatch 10.2.6; npm currently reports no available fix for that development-only dependency.

### Added
- Initial changelog setup

## [v0.2.2] - 2026-11-22

### Fixed
- Recover OpenCode v2 history when its local service is unavailable.

## [v0.2.1] - 2026-11-21

### Added
- Add GPT-6.2 Astra and Sol model options for GitHub Copilot and OpenAI

## [v0.1.0] - 2026-03-28

### Added
- Initial stable release
- FastAPI backend with comprehensive API
- React frontend with modern UI components  
- Full CI/CD pipeline with quality gates
- Docker containerization support
- Comprehensive test suite (unit, integration, E2E)
- Security vulnerability management
- Git tagging and release automation

### Infrastructure
- GitHub Actions workflows for testing and deployment
- Makefile automation for development tasks
- Python backend with uv dependency management
- Node.js frontend with npm workspaces
- Playwright E2E testing framework

[Unreleased]: https://github.com/tbrandenburg/made/compare/v0.2.4...HEAD
[v0.2.4]: https://github.com/tbrandenburg/made/releases/tag/v0.2.4
[v0.1.0]: https://github.com/tbrandenburg/made/releases/tag/v0.1.0
