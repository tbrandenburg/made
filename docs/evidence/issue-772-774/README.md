# Advisory and QA Gate Validation

Verified 2026-10-13 in isolated worktrees based on commit `3928d70`, then in an
isolated real application stack. This is supplemental evidence for #772, #773,
and #774; the earlier #771 evidence remains a historical record.

## Dependency changes

| Package | Previous lock | Updated lock | Manifest minimum |
| --- | --- | --- | --- |
| DOMPurify | 3.4.15 | 3.4.17 | ^3.4.16 |
| shell-quote | 1.10.0 | 1.12.0 | >=1.11.0 |
| source-map-js | 1.2.1 | 1.2.2 | >=1.2.2 |
| PyJWT | 2.13.0 | 2.15.1 | >=2.15.0 |
| urllib3 | 2.7.0 | 2.8.0 | >=2.8.0 |

No package removals, unrelated dependency version changes, downgrades, advisory
ignores, audit filters, or major upgrades were used. Project Python minimum stays
`>=3.11`; PyJWT requires >=3.9 and urllib3 >=3.10, compatible with CI Python 3.12.

`PYSEC-2026-4146` / `GHSA-gvp8-978c-rx2q` has no fixed-version event but reports
an affected range through 2.13.0. Released 2.15.0/2.15.1 sources contain the
defensive options copy. Coordinator behavior checks confirmed:

| Version | Caller options mutated | Expired claim rejected after options reuse |
| --- | --- | --- |
| 2.13.0 | true | false |
| 2.15.1 | false | true |

[Upstream advisory](https://github.com/jpadilla/pyjwt/security/advisories/GHSA-gvp8-978c-rx2q).

## Clean installs, audits, and normal gates

Coordinator commands were executed in the integration worktree with
credential-like environment variables withheld from test children.

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0; npm lockfile unchanged |
| Backend `uv sync --frozen` | Exit 0; uv lockfile unchanged |
| Root and frontend `npm audit` | Exit 0; zero findings |
| `make security-audit` | Exit 0; Python: no known vulnerabilities; both npm audits: zero findings |
| Backend `uv lock --check`, `uv pip check` | Passed; installed packages compatible |
| `make qa-quick` | Real frontend: 30 files / 190 passed; backend: 543 passed, 1 existing skip, 2 subtests passed |
| `make test-coverage` | Frontend 190 passed; non-external backend 562 passed, 2 skipped, 2 subtests passed; total backend coverage 78.92% |
| `make build` | TypeScript/Vite build and backend wheel/sdist succeeded |
| `npm test -- src/utils/markdown.test.ts` | 8 passed, proving root argument forwarding and real renderer regressions |
| Frontend `npx prettier --check src`, `git diff --check` | Passed |

## QA failure propagation

The root `test` and `test:watch` scripts now delegate to frontend Vitest rather
than echoing instructions. No Makefile or hook bypass was needed.

A temporary diagnostic frontend test contained two deliberately failing
assertions. Before correction, root `npm test` and `make qa-quick` exited 0 while
direct Vitest exited 1. After correction, root exited 1 and combined QA exited 2
because of that diagnostic. The coordinator independently repeated the corrected
failure path. The temporary test was removed, then the normal suites passed.

## Real integration and browser checks

Project: `made-opencode-v2-acceptance`; loopback ports 13000/18080 were checked
free before startup. Dedicated volumes and no host OpenCode configuration/database
mounts were used. The Docker backend installed PyJWT 2.15.1 and urllib3 2.8.0.

The unchanged opt-in production-adapter acceptance test was explicitly enabled:

```bash
docker compose -p made-opencode-v2-acceptance \
  -f docker-compose.yml -f docker-compose.opencode-v2.yml \
  exec -T -e MADE_OPENCODE_V2_ACCEPTANCE=1 pybackend \
  .venv/bin/pytest -q tests/integration/test_opencode_v2_acceptance.py
```

- Pinned **opencode v2.0.18**: 1 passed, no skip.
- Separately prepared **opencode v2.0.28** image, explicit
  `MADE_OPENCODE_V2_EXPECTED_VERSION='opencode v2.0.28'`: 1 passed, no skip.

The real frontend, backend, OpenCode v2.0.28, and `build` / `opencode/big-pickle`
model completed a fresh three-turn marker conversation. No model responses,
history routes, or UI routes were stubbed.

- Main session: `ses_ec92ff41fffeCZPsYBm0ioMc2g`.
- Marker: `security-mv73fre3`; replies were ACK + marker, marker, marker + THIRD.
- Three POSTs retained one exact ID, including a turn after reload.
- S appeared in backend recent results and the UI picker before saving.
- Selecting alternate `ses_ec92491ffffeser3U2kxfQFWZT` loaded 2 messages; selecting
  exact S again loaded 6 messages.
- Refresh and reload returned HTTP 200 / 6 conversation messages, 3 users +
  3 assistant replies, with 6 distinct message IDs.
- Repository B listed no S; direct S history returned 409 with the stable mismatch
  code, preserving isolation.
- A real browser connection failure retained the six messages and showed an
  actionable error. Networking was restored in `finally`; online refresh fetched
  6 messages and cleared the error.
- The ordinary message-rendering check displayed markup as literal text without
  activating it. The initial diagnostic incorrectly required an image element;
  inspecting the actual escaped rendering corrected that expectation. No source
  change, further active-content payload, or bypass was used.

At `2026-10-13T20:04:09.116713+00:00`, OpenCode's API and MADE history had matching
message contents, three user messages and three replies, zero tool parts, and
location `/workspace/security-qa-a`. Backend cwd/PWD remained `/app`.

- [Persisted three-turn conversation](/docs/evidence/issue-772-774/persisted.jpg)
- [Connection failure retaining the transcript](/docs/evidence/issue-772-774/offline.jpg)

Adversarial review reported zero critical/high/medium/low introduced findings.
Protected host development servers were not restarted or dependency-reinstalled;
validation and dependency installation remained isolated.
