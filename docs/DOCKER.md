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

This is a **standalone** Compose configuration, not an override for the normal
developer stack. The host runner creates a unique `made-779-*` project/network,
three dedicated volumes, and two free loopback host ports. It checks availability
before starting listeners and never uses/stops ports 3000 or 5173. Inside the
backend container MADE listens on 13079; the harness selects/checks a free
OS-assigned port for OpenCode before starting it through its supported CLI.
No host HOME, XDG directory, service registration, credentials,
repository, MCP config, plugins or ancestor instructions are mounted.

Prerequisites: Docker with Compose, Python 3.11+, Node/npm, and an installed
Chromium browser for the repository's Playwright version. From the repository root:

```bash
npm ci
npx --no-install playwright install chromium
# On a minimal Linux host, browser OS libraries may also be required:
# npx --no-install playwright install-deps chromium

python3 scripts/opencode-v2-acceptance/run.py \
  --state /tmp/opencode/made-v2-acceptance.json run
```

Use a **new state filename per run**. It contains resource names/ports, never
registration passwords. `run` builds and starts the stack, executes the opt-in
real CLI integration test, complete-history benchmark, and the dedicated
unmocked browser tests, then tears down in `finally`. A nonzero exit, skipped
pytest test, provider-free smoke, or absent runner summary is **not an acceptance
pass**. The general `tests/system/made.spec.ts` uses network mocks and is not a
substitute for `tests/acceptance/opencode-v2.spec.ts`.

The minimum tested version, image and version assertion pin are **2.0.18**.
The real CLI, HTTP and browser scenarios below verify this version, not a
general range of V2 releases. Repeat acceptance after an upgrade.
The default real-provider test uses `opencode/big-pickle` (a real provider, not
a fake endpoint). Availability/authentication/rate limits can change. To test a
different version/model, explicitly set these before the run:

```bash
MADE_ACCEPTANCE_OPENCODE_VERSION=2.0.28 \
MADE_ACCEPTANCE_MODEL=opencode/big-pickle \
python3 scripts/opencode-v2-acceptance/run.py \
  --state /tmp/opencode/made-v2-other-version.json run
```

Configure a provider only inside this disposable environment using the
[official V2 provider instructions](https://opencode.ai/v2/docs/providers).
Do not mount host credentials or print the service registration. The default
command never passes host provider secrets into the container. If provider
setup is required, use staged execution below; do not commit the configuration.

### Staged debugging and provider-free smoke

The same state file addresses only resources created by this runner. `up`
prints the owned project and API/web ports; its web URL is
`http://127.0.0.1:<web>`. Keep the state file private and outside the repository.

```bash
python3 scripts/opencode-v2-acceptance/run.py --state /tmp/opencode/made-v2-staged.json up
# Optional real-service contract/import/transport + browser startup smoke. No provider call:
python3 scripts/opencode-v2-acceptance/run.py --state /tmp/opencode/made-v2-staged.json smoke
# Prepares a NEW real-provider session/manifest and checks production conversion:
python3 scripts/opencode-v2-acceptance/run.py --state /tmp/opencode/made-v2-staged.json prepare
python3 scripts/opencode-v2-acceptance/run.py --state /tmp/opencode/made-v2-staged.json benchmark
python3 scripts/opencode-v2-acceptance/run.py --state /tmp/opencode/made-v2-staged.json browser
# Required cleanup, including after a failed staged command:
python3 scripts/opencode-v2-acceptance/run.py --state /tmp/opencode/made-v2-staged.json down
```

The smoke fixture cannot satisfy the real-provider browser test. For only the
provider-free **browser** scenario after `smoke`, select its explicit test:

```bash
MADE_ACCEPTANCE_STATE=/tmp/opencode/made-v2-staged.json \
npx --no-install playwright test --config tests/acceptance/playwright.config.ts \
  --grep 'provider-free real browser'
```

To isolate real provider execution from the service lifecycle scenario, run
`prepare`, then select `--grep 'real CLI root'` with the same configuration and
state environment variable. Use a new `prepare` before repeating that scenario:
it asserts one occurrence of each marker, not duplicate turns from a previous
test run. A real model that prints a proposed JSON tool call instead of actually
executing the shell tool fails acceptance; no tool completion is fabricated.

The browser scenarios cover initial load and manual refresh; terminal resume
while repeatedly refreshing; real shell-tool preview/call identity; an executed
polling history request while a MADE send is processing; a >50-record fixture
with early/late visible markers; unique/stable message identities; safe 409s
from repository B and knowledge/constitution/task scopes; and owned service
replacement, unavailable-service errors with retained chat, and recovery without
restarting MADE. The harness never depends on external-terminal activity
automatically starting polling. Deterministic same-ID text revisions and
optimistic-send races remain covered by the focused backend/frontend tests.
OpenCode 2.0.18 can retain its endpoint/password on plain `service restart`;
the harness explicitly selects a different free owned port with
`service set port`, then starts the replacement and checks discovery rotation.
This is a test-only lifecycle operation, never a MADE history repair path.

The benchmark reads the complete **89-record / approximately 1.76 MB** fixture
through the production exporter, not a three-message tail or a per-refresh CLI.
It validates equivalent displayed content and reports six samples (first adapter
read plus five warm reads), pages, message-page decoded JSON bytes, versions
and environment. Timed exports also include two metadata validations.
`cProfile` separates registration discovery and HTTP reading from the remaining
conversion/adapter time; profiling overhead is included. “Cold” is not an OS
cache flush. The fixture contains two displayable user markers and 87 explicitly
synthetic non-display payload records: it exercises transfer/pagination size,
**not** the original PoC's 169-tool/182-display-part distribution. Real tool
behavior is tested separately. A warm sample over one second fails the benchmark
and requires investigation, not a fabricated latency claim or universal SLA.
`smoke` emits transport-only timings with conversion explicitly unset; these
are incomplete acceptance evidence.

An integrated OpenCode 2.0.18 / Python 3.12.15 Linux-container reference run
fetched and converted the complete fixture in 176.837 ms on its first adapter
read and 148.190–155.297 ms across five warm reads. Warm registration discovery
was 0.398–0.421 ms and conversion/adapter work 1.014–1.212 ms; the remainder was
the HTTP read. These are measured complete-export results, not the earlier
transport-only smoke timings or a universal SLA.

`down` first saves synthetic CLI logs/manifest/benchmark under
`<state-without-.json>.artifacts`, removes this project's containers/network/
volumes, and verifies no project containers remain. Browser traces are under
`<state>.browser`. These contain synthetic test content only; keep them local.
Teardown destroys the disposable provider configuration too. No curated demo
files or host OpenCode lifecycle are touched. Do not paste raw service logs or
registrations into issues; preserve only sanitized failure/version/count evidence.

The real CLI helper keeps its 240-second bound and explicitly sets stdin to
EOF for argv prompts. Without that, Node `execFile` leaves an inherited pipe
open through Python and Compose, and OpenCode 2.0.18 waits on stdin before
submitting the prompt. This can look like a provider timeout while the healthy
service remains idle. A controlled real-CLI probe confirmed no prompt admission
until stdin closed. This does not alter MADE's production stdin prompt path.
On a timeout or CLI error, partial stdout/stderr and sanitized before/after
service observations are saved locally: active state, recent record types,
structured error codes, inbox/permission counts, and log error-class indicators.
No registration values, raw service logs or prompts are included in the
diagnostic summaries. Inspect these before increasing a timeout or retrying;
the harness does not automatically retry failed provider calls.
The bounded startup readiness loop also tolerates connection resets while
Nginx/backend listeners initialize. If startup fails before artifact creation,
collection reports its unavailability without masking the startup error;
container/network/volume teardown verification still runs.

For the production contract and the residual SQLite listing/activity limits,
see [OpenCode history configuration](/docs/CONFIGURATION.md#opencode-database-history).
