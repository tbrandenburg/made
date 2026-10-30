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

The `opencode` adapter reads saved history using read-only SQLite connections.
V2 selected-session history uses the authenticated local HTTP service registered
at `$XDG_STATE_HOME/opencode/service.json` (defaulting to
`~/.local/state/opencode/service.json`). The service must be running; MADE does
not start or restart it, invoke a per-refresh CLI, or fall back to SQLite.
Requests accept only literal loopback IP addresses over HTTP (not `localhost`
or other DNS names), disable environment proxies and redirects, and are
bounded across discovery/retry/pages to 30 seconds, 201 pages, 10,000 records,
and 32 MiB decoded response bytes. Connect/read timeouts are 2/5 seconds;
they do not replace the complete-operation deadline. One shared whole-read
retry budget covers rediscovery and detectable pagination conflicts. V2 session
listing and activity detection remain SQLite-backed and retain their existing
freshness limitations. External terminal activity need not start MADE polling;
manual refresh and a polling refresh that executes normally read a complete
V2 snapshot. If a page exceeds the JSON complexity preflight, selected-session
history instead retries newest-first, reducing page size from 10 down to 1 as
needed. It recovers at most 50 recent API records under the same cumulative
30-second, byte, record, and page budgets. When older records are omitted, the
response has `historyReduced: true` and chat views warn that history was
reduced due to JSON complexity. The warning persists after failed refreshes
and clears on a complete successful refresh or session switch. If even one
newest record is too complex, recovery fails explicitly rather than reporting
empty history. V1 keeps its incremental history behavior. The page budget
includes an empty terminating page after 200 full pages. Retries and recovery
consume the same cumulative budgets, so repeated or short pages can exhaust
the page budget first.

JSON history routes and the Lite repository view run synchronous history work
in FastAPI worker threads. Other async callers must offload the synchronous
adapter with `asyncio.to_thread`; direct reads on a running event loop fail
immediately rather than block unrelated requests.

Responses must use identity encoding; compressed responses are rejected rather
than decompressed. Raw reads are at most 64 KiB per chunk. Per-response JSON
preflight limits are 100,000 structural punctuation bytes, depth 64, and 128
bytes per unquoted primitive token. Quoted tool text shares the operation's
32 MiB byte budget. The async deadline covers I/O and cooperative preflight;
the bounded standard-library JSON decode is not CPU-preemptible.

The minimum tested version and isolated image pin are OpenCode **2.0.18**.
The maintained [real acceptance command](/docs/DOCKER.md#opencode-v2-acceptance)
exercises CLI creation/resume/tools and MADE initial/manual/polling refresh,
pagination, isolation and owned service replacement/outage/recovery. Run it
when changing the adapter or upgrading OpenCode; the issue's 2.0.28 PoC does
not establish a tested version range.

MADE reads Basic authentication locally from the registration; do not copy its
password into settings, command arguments, bug reports, or browser code. Only
literal local HTTP loopback endpoints are accepted, with no redirects or environment
proxies. Session IDs, root status, and the exact canonical directory are checked
before content access and again before return. Repository, knowledge,
constitution, and task scope mismatches return safe HTTP 409 responses.
Service/auth/schema/network/limit failures remain explicit except for the
bounded JSON-complexity recovery described above; there is no stale SQL
fallback. Failed refresh retains the displayed transcript. A replacement
service is rediscovered on the next export, without MADE managing its lifecycle.
Full and reduced snapshots are best-effort reads, not atomic transactions: a
concurrent edit can require another refresh.

- Set `OPENCODE_DB` to an absolute database path to avoid CLI path discovery.
- The v1 adapter also supports `OPENCODE_DATABASE_PATH`; an existing file at
  that legacy override takes precedence.
- V2's SQLite session-listing reader caches successful path discovery across
  adapter instances, keyed by the working directory and the `PATH`, `HOME`,
  `XDG_DATA_HOME`, and `OPENCODE_DB` values. Explicit overrides are checked before
  the cache.
- If the cached file disappears, v2 discovers it again. Failed discovery is
  retried on the next read. Connections and history contents are not cached.
- Restart the backend after an OpenCode upgrade if the database moves but the
  old database still exists.

V2 tool messages show the tool name and input arguments in live responses and
saved history. Argument previews are truncated to 90 characters, matching the
v1 database adapter.

To verify a configuration change, save the adapter in Settings, reload the page,
send a message, and reopen the session after another reload. Use the
[isolated Docker acceptance process](/docs/DOCKER.md#opencode-v2-acceptance) to test
without changing your host configuration.

## API reference

With the backend running, open its generated API documentation at
`http://localhost:3000/docs`. The OpenAPI schema is at
`http://localhost:3000/openapi.json`.

The API includes repository, file, agent chat, knowledge, constitution, task,
workflow, and settings operations. Check the generated reference for exact
methods, paths, and request bodies instead of copying frontend route patterns.

## Dashboard system metrics

The dashboard refreshes overall CPU, RAM, and workspace filesystem utilization
every five seconds. Utilization is collected with `psutil`; RAM usage accounts
for available (including reclaimable) memory. Linux pressure readings use
`some avg10` from `/proc/pressure/{cpu,memory,io}`: the percentage of time at
least one task was stalled over the last ten seconds. Missing or unreadable
metrics display as **Unavailable**. Pressure requires Linux with PSI enabled.

These are system readings visible to the backend, not MADE process metrics or
container quota usage. In containers they may describe the host or Linux VM;
disk utilization describes the filesystem containing `MADE_WORKSPACE_HOME`.
The read-only `/api/system-metrics` endpoint returns six nullable percentages.
