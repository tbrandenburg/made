# Investigation: Critical: Implement Git tagging strategy with semantic versioning

**Issue**: #299 (https://github.com/tbrandenburg/made/issues/299)
**Type**: ENHANCEMENT
**Investigated**: 2026-03-28T14:30:00Z

### Assessment

| Metric     | Value | Reasoning |
|------------|-------|-----------|
| Priority   | HIGH  | Issue explicitly marked "Critical" by repository owner, blocking reliable production deployments for 700+ commit project with active development |
| Complexity | LOW   | Only 3-4 files to modify (create tag, update README, add CI workflow, extend Makefile), no architectural changes required |
| Confidence | HIGH  | Clear requirements with concrete acceptance criteria, all current version numbers consistently 0.1.0, solid CI/CD foundation exists to extend |

---

## Problem Statement

The repository has zero Git tags despite 700+ commits and active development, creating critical operational issues: impossible to create reproducible deployments, no way to identify stable release points, cannot roll back to known-good versions, and unable to correlate runtime issues with source code.

---

## Analysis

### Root Cause / Change Rationale

This is an enhancement issue requiring implementation of a complete versioning strategy. The repository is production-ready but lacks release management infrastructure despite having:
- Comprehensive CI/CD with quality gates (lint, test, coverage)
- Consistent version 0.1.0 across all package.json and pyproject.toml files  
- Active security vulnerability management and PR workflow

### Evidence Chain

**Problem**: No reproducible deployments possible
↓ BECAUSE: Zero Git tags exist (`git tag --list` returns empty)
Evidence: Confirmed 0 tags in repository with 700 commits

↓ BECAUSE: No versioning strategy implemented
Evidence: Missing release workflows in `.github/workflows/` directory

↓ ROOT CAUSE: Missing release management infrastructure
Evidence: No automated tagging, no documentation, no release process

### Affected Files

| File | Lines | Action | Description |
|------|-------|--------|-------------|
| `README.md` | 136-170 | UPDATE | Add versioning documentation section |
| `.github/workflows/release.yml` | NEW | CREATE | Automated release workflow |
| `Makefile` | 14,17-58,147 | UPDATE | Add release targets and help |
| `CHANGELOG.md` | NEW | CREATE | Initialize changelog for v0.1.0 |

### Integration Points

- `.github/workflows/tests.yml:3-7` - Existing workflow triggers to mirror
- `Makefile:117-121` - Existing `qa` target integrates with release process  
- `package.json:4` - Current version "0.1.0" becomes first tag
- `packages/frontend/package.json:3` - Version "0.1.0" stays synchronized
- `packages/pybackend/pyproject.toml:3` - Version "0.1.0" stays synchronized

### Git History

- **Latest commit**: `9060223` - "Investigate issue #295: CI/CD Pipeline Failure - RESOLVED"
- **Total commits**: 700
- **Recent activity**: Active security fixes (#278, #282, #312)
- **Implication**: Mature project ready for formal versioning strategy

---

## Implementation Plan

### Step 1: Create initial Git tag for current stable state

**Action**: CREATE TAG
**Command**: `git tag -a v0.1.0 -m "Initial stable release v0.1.0"`

**Why**: Establishes baseline for reproducible deployments matching existing package versions

---

### Step 2: Add versioning documentation to README

**File**: `README.md`
**Lines**: INSERT after line 135 (before Tests section)
**Action**: UPDATE

**Content to add:**

```markdown
## 📦 Releases & Versioning

This project follows [Semantic Versioning](https://semver.org/) (SemVer).

### Version Format

Given a version number `MAJOR.MINOR.PATCH`:
- **MAJOR** - Incompatible API changes  
- **MINOR** - New functionality (backwards compatible)
- **PATCH** - Bug fixes (backwards compatible)

### Latest Release

[![Latest Release](https://img.shields.io/github/v/release/tbrandenburg/made)](https://github.com/tbrandenburg/made/releases)

Check the latest version:
```bash
git fetch --tags
git tag --list | tail -1
```

### Creating a Release

```bash
# Run quality assurance
make qa

# Create and push release tag
make release VERSION=v0.1.1

# Automated: CI creates GitHub release
```

### Release Automation

Releases are automated via GitHub Actions:
1. Developer creates annotated tag (`v*.*.*` format)
2. CI runs full test suite (`make qa`)  
3. GitHub release is created automatically
4. Release artifacts are built and attached

```

**Why**: Documents versioning strategy following existing README patterns and badge style

---

### Step 3: Create automated release workflow

**File**: `.github/workflows/release.yml`
**Action**: CREATE

**Content:**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    name: Create Release
    runs-on: ubuntu-latest
    
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Node.js  
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install uv
        uses: astral-sh/setup-uv@v3
        with:
          version: "latest"

      - name: Install dependencies
        run: |
          npm install
          cd packages/pybackend && uv sync

      - name: Run quality assurance
        run: make qa

      - name: Build frontend
        run: npm run build:frontend

      - name: Build backend package
        run: cd packages/pybackend && uv build

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/}" >> $GITHUB_OUTPUT

      - name: Generate changelog excerpt
        id: changelog
        run: |
          if [ -f CHANGELOG.md ]; then
            # Extract version section from CHANGELOG.md
            sed -n "/## \[${{ steps.version.outputs.version }}\]/,/## \[/p" CHANGELOG.md | head -n -1 > release_notes.md
          else
            echo "Release ${{ steps.version.outputs.version }}" > release_notes.md
            echo "" >> release_notes.md
            echo "See commit history for detailed changes." >> release_notes.md
          fi

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ steps.version.outputs.version }}
          name: Release ${{ steps.version.outputs.version }}
          body_path: release_notes.md
          draft: false
          prerelease: ${{ contains(steps.version.outputs.version, 'alpha') || contains(steps.version.outputs.version, 'beta') || contains(steps.version.outputs.version, 'rc') }}
          files: |
            packages/pybackend/dist/*
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Why**: Automates release creation following existing CI patterns from tests.yml, includes quality gates and artifact publishing

---

### Step 4: Add release targets to Makefile

**File**: `Makefile`  
**Lines**: Multiple locations
**Action**: UPDATE

**Update .PHONY target (line 14):**
```makefile
.PHONY: help install run stop restart logs clean format lint test qa test-quick test-coverage test-system build docker-build docker-run docker-stop docker-logs release tag-release
```

**Add to help section (after line 58):**
```makefile
	@echo "  release            Interactive release creation workflow"
	@echo "  tag-release        Create and push version tag (VERSION=v0.1.1)"
```

**Add release targets (after line 147):**
```makefile

# Release Management
release: qa
	@echo "🚀 Release Workflow"
	@echo "=================="
	@echo ""
	@echo "Current version tags:"
	@git tag --list --sort=-version:refname | head -5 || echo "  (no tags yet)"
	@echo ""
	@read -p "Enter new version tag (e.g., v0.1.1): " VERSION; \
	if [ -z "$$VERSION" ]; then \
		echo "❌ Version is required"; \
		exit 1; \
	fi; \
	if ! echo "$$VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+(\.[0-9]+)?)?$$'; then \
		echo "❌ Version must follow semantic versioning (e.g., v1.0.0, v1.0.0-beta.1)"; \
		exit 1; \
	fi; \
	if git tag --list | grep -q "^$$VERSION$$"; then \
		echo "❌ Tag $$VERSION already exists"; \
		exit 1; \
	fi; \
	echo "🏷️  Creating annotated tag $$VERSION..."; \
	git tag -a $$VERSION -m "Release $$VERSION"; \
	echo "🚀 Pushing tag to trigger release workflow..."; \
	git push origin $$VERSION; \
	echo "✅ Release $$VERSION created and pushed"; \
	echo "📦 Check GitHub Actions for automated release: https://github.com/tbrandenburg/made/actions"

tag-release:
	@if [ -z "$(VERSION)" ]; then \
		echo "❌ Usage: make tag-release VERSION=v0.1.1"; \
		exit 1; \
	fi; \
	echo "🏷️  Creating tag $(VERSION)..."; \
	git tag -a $(VERSION) -m "Release $(VERSION)"; \
	git push origin $(VERSION); \
	echo "✅ Tag $(VERSION) pushed"
```

**Why**: Provides CLI interface following existing Makefile patterns, includes validation and user-friendly workflow

---

### Step 5: Initialize changelog

**File**: `CHANGELOG.md`
**Action**: CREATE

**Content:**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial changelog setup

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

[Unreleased]: https://github.com/tbrandenburg/made/compare/v0.1.0...HEAD
[v0.1.0]: https://github.com/tbrandenburg/made/releases/tag/v0.1.0
```

**Why**: Establishes changelog format for future releases and documents initial release scope

---

## Patterns to Follow

**From existing CI workflow - mirror tests.yml:3-7:**

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

**From existing Makefile - follow target patterns:**

```makefile
# Makefile:117-121 - qa target pattern
qa: format lint test
	@echo "✅ Quality assurance completed"
```

**From existing README - badge and section style:**

```markdown
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
```

---

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
|----------------|------------|
| Invalid semver format | Makefile validation with regex check |
| Duplicate tag creation | Git tag existence check before creation |
| CI failure on release | Release workflow runs full `make qa` |
| Missing release notes | CHANGELOG.md fallback to commit history |
| Workflow permission issues | Uses standard GITHUB_TOKEN with releases scope |

---

## Validation

### Automated Checks

```bash
# Verify current state (should show zero tags)
git tag --list | wc -l

# After implementation - verify tag creation workflow
make release  # Interactive workflow

# Verify workflow syntax
yamllint .github/workflows/release.yml

# Verify makefile syntax  
make help | grep release

# Run quality gates
make qa
```

### Manual Verification

1. Create test tag locally: `git tag -a v0.1.0-test -m "Test tag"`
2. Verify tag format: `git tag --list | grep v0.1.0-test` 
3. Delete test tag: `git tag -d v0.1.0-test`
4. Verify README renders with new sections
5. Test release workflow dry-run

---

## Scope Boundaries

**IN SCOPE:**

- Creating initial v0.1.0 Git tag
- Documenting semantic versioning strategy in README
- Automating release creation via GitHub Actions
- Adding Makefile release targets
- Initializing CHANGELOG.md structure

**OUT OF SCOPE (do not touch):**

- Version numbers in package files (keep existing 0.1.0)
- Existing CI/CD workflows (tests.yml, docker.yml)
- Docker image versioning strategy  
- Automatic version bumping in package files
- Advanced changelog generation tools

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-03-28T14:30:00Z
- **Artifact**: `.claude/PRPs/issues/issue-299.md`