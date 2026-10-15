# Docker guide

> Run the container stack or test a real agent adapter without changing host agent configuration.

## Definition of done

- [ ] The intended Compose project is running and its web interface responds.
- [ ] Agent acceptance checks pass if testing a CLI adapter.
- [ ] The test project is stopped after testing without affecting another stack.

## Prerequisites

- Docker Engine and Docker Compose. Acceptance overrides use `!override`,
  requiring Docker Compose 2.24.4 or newer.
- Run the commands below from the repository root.
- For chat, authenticate the selected CLI inside the backend container.
  Pass credentials at runtime or through a dedicated volume; never bake them
  into an image or commit them to the repository.

## Standard stack

```bash
docker compose -f docker/docker-compose.yml up --build -d
docker compose -f docker/docker-compose.yml ps
```

Open `http://localhost:8080`; the backend API is at `http://localhost:3000`.
The `made-data` volume persists `/app/.made`, and `made-workspace` persists
repositories under `/workspace`.

Use the [Compose file](/docker/docker-compose.yml) to configure the deployment.
The backend image starts Uvicorn directly on port 3000; changing an environment
variable alone does not change that container command or its published port.

Inspect problems and stop the stack without deleting its data:

```bash
docker compose -f docker/docker-compose.yml logs --tail=100
docker compose -f docker/docker-compose.yml down
```

## Agent CLI acceptance

This process checks the real application and selected CLI without mounting
host agent configuration or using the standard development ports.

1. Check [the backend Dockerfile](/docker/pybackend.Dockerfile). It installs
   OpenCode by default. For another CLI, replace that install step or add the
   selected CLI's official non-interactive installer and put it on `PATH`.
2. Supply the selected CLI's authentication at runtime in the isolated agent
   home, then start the acceptance project:

```bash
docker compose -p made-agent-acceptance \
  -f docker/docker-compose.yml -f docker/docker-compose.agent-acceptance.yml \
  up --build -d
```

3. Open `http://127.0.0.1:18080`. In Settings, select the matching adapter,
   save, reload, and confirm it persisted.
4. Create a repository in the isolated workspace and add a small file with a
   unique marker.
5. Run the browser checks below. The backend is at `http://127.0.0.1:13000`.

### Browser verification

Use a browser or Playwright against the real UI; do not substitute mocked agent responses.

- [ ] Open the fixture repository's Agent chat and select an available model.
- [ ] Ask the agent to read the fixture file and return its exact marker.
      Verify the response and displayed session ID.
- [ ] Ask for the previous marker without naming it. Verify the answer and
      that the same session continues.
- [ ] Reload the repository page. Verify saved request/response history;
      reopen the session through the picker if needed.
- [ ] Reload Settings and verify the selected adapter persisted.

> **Data deletion:** the next command deletes only this acceptance project's
> volumes, including its test repositories and agent home. Keep the explicit
> project name and Compose files to avoid targeting a different stack.

```bash
docker compose -p made-agent-acceptance \
  -f docker/docker-compose.yml -f docker/docker-compose.agent-acceptance.yml down -v
```

## OpenCode v2 acceptance

The pinned v2 image isolates OpenCode home/config and its SQLite database as
well as MADE settings and repositories. Do not run this and the general
acceptance stack simultaneously: they use the same loopback ports.

```bash
docker compose -p made-opencode-v2-acceptance \
  -f docker/docker-compose.yml -f docker/docker-compose.opencode-v2.yml \
  up --build -d

# Run the opt-in persistence/resume test inside the v2 container
docker compose -p made-opencode-v2-acceptance \
  -f docker/docker-compose.yml -f docker/docker-compose.opencode-v2.yml \
  exec -T -e MADE_OPENCODE_V2_ACCEPTANCE=1 pybackend \
  .venv/bin/pytest -q tests/integration/test_opencode_v2_acceptance.py
```

Authenticate the container's CLI before the persistence test. Create or seed a
test repository under `/workspace`, select `opencode-v2` in Settings, and run
the browser verification checklist at `http://127.0.0.1:18080`.

See [OpenCode database configuration](/docs/CONFIGURATION.md#opencode-database-history)
for history overrides and path-discovery behavior.

> **Data deletion:** this removes the v2 acceptance project's dedicated volumes.

```bash
docker compose -p made-opencode-v2-acceptance \
  -f docker/docker-compose.yml -f docker/docker-compose.opencode-v2.yml down -v
```

If a check fails, inspect `docker compose` logs using the same project name and
Compose files, confirm the CLI is on `PATH` and authenticated, and retry the
failed browser step before declaring acceptance complete.
