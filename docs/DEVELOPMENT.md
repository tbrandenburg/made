# Development guide

> Set up MADE, validate a change, and submit it without interrupting an existing development session.

## Definition of done

- [ ] The affected behavior or documentation has been checked directly.
- [ ] `make qa-quick` exits successfully.
- [ ] Relevant system or integration tests pass when the change needs them.
- [ ] The pull request explains the change and includes verification results.

## Setup

Use the prerequisites and installation steps in the [quickstart](/README.md#quickstart).
`make install` installs frontend and backend dependencies and the pre-push hook.
The hook runs `make qa-quick`; do not bypass it.

### Start services without stopping an existing session

`make run` stops processes on its configured ports. If a development session
is running, use it rather than starting another on the same ports.

For a fresh session, you can start services explicitly in two terminals without
the Makefile's stop step. Run these commands from the repository root:

```bash
# Terminal 1: backend
MADE_HOME="$PWD/workspace" MADE_WORKSPACE_HOME="$PWD/workspace" \
  uv run --directory packages/pybackend made-backend
```

```bash
# Terminal 2: HTTPS frontend
npm run dev:frontend -- --host 0.0.0.0
```

Verify the backend at `http://localhost:3000/docs` and the frontend at
`https://localhost:5173`. Accept the frontend's local self-signed certificate
in your browser. Check that neither terminal reports a port conflict.

## Validate changes

```bash
# Required local/pre-push gate: formatting, lint, lockfile, unit tests
make qa-quick

# Frontend and backend coverage
make test-coverage

# Build frontend and Python package
make build
```

`make qa-quick` formats files in place. Inspect `git diff` afterward.

For faster feedback, run a focused test with a path relative to its package:

```bash
make test-frontend FILE=src/path/to/file.test.tsx NAME=pattern
make test-backend FILE=tests/unit/test_foo.py NAME=pattern
```

Omit `NAME` to run the selected file. Package-scoped gates are
`make qa-quick-frontend` and `make qa-quick-backend`.

### System and integration tests

`make system-test` starts the stack and runs Playwright plus backend system
tests on ports 3000 and 5173 by default. It refuses occupied ports; it does not
stop an existing development session. Use `PORT` and `FRONTEND_PORT` to select
free nonstandard ports when testing alongside a running stack.

Install Playwright's browser binaries before the first system test:

```bash
npx playwright install --with-deps
make system-test
# Alongside development servers, after checking these ports are free:
make system-test PORT=3100 FRONTEND_PORT=5273
```

Readiness uses GET requests, including the backend's lightweight `/api/health`
endpoint. Startup timeouts fail the command and report service diagnostics;
cleanup targets only services started by the test runner.

`make test-integration` is opt-in and requires real agent CLIs on `PATH`,
authentication, and network access. For an isolated real-CLI check, follow the
[Docker acceptance guide](/docs/DOCKER.md#agent-cli-acceptance).

If Python tests fail to collect with missing imports, sync and run them inside
the backend environment, not through a system Python installation:

```bash
uv sync --project packages/pybackend
uv run --project packages/pybackend python -m pytest packages/pybackend/tests/unit
```

## Contribute

1. Fork the repository if you do not have write access.
2. Create a focused branch from the default branch.
3. Make the change and update relevant tests and documentation.
4. Run the validation commands above and inspect the resulting diff.
5. Push your branch and open a pull request with a summary and test results.

For help, use [GitHub Issues](https://github.com/tbrandenburg/made/issues).
Report security issues privately as described in the [README](/README.md#security).

## Releases

MADE uses [Semantic Versioning](https://semver.org/): major for incompatible
changes, minor for backward-compatible features, patch for fixes.

> **Maintainers only:** the following commands create commits, annotated tags,
> and push to the remote. Start with a clean worktree and inspect your branch.

```bash
make release BUMP=patch   # Also accepts minor/major, case-insensitive
# Or choose an explicit version instead:
make release VERSION=1.2.3
```

The release target runs `make qa-quick`, synchronizes the root and frontend
`package.json` versions with the backend `pyproject.toml`, regenerates `uv.lock`,
commits, tags `vX.Y.Z`, and pushes the commit and tag together.

The [release workflow](/.github/workflows/release.yml) runs `make qa`, builds
the frontend, backend package, and Docker images, checks the tag against the
package versions, and publishes a GitHub Release. System tests and the explicit
real-CLI integration target are separate checks; run them before releasing
when relevant.
