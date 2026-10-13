# Issue 771 Acceptance Evidence

Verified on 2026-10-13 after implementation, adversarial review, focused correction,
and coordinator-run automated gates. This evidence uses isolated diagnostic
sessions, not existing user conversations. Session IDs are historical evidence,
not portable test fixtures. No routes, histories, or model responses were stubbed
in the browser flow.

## Tested snapshot

- MADE: `0.1.5`, working tree based on `17292a5a0292981f31448105570b4a7839955f87`.
- SHA-256 of the tested `git diff HEAD -- packages`:
  `ae949cc2909cb09565c17890a021c69d09c54efd8e12161394f904bbc093332b`.
- Isolated Compose project: `made-opencode-v2-acceptance`.
- Frontend/API: `http://127.0.0.1:18080` / `http://127.0.0.1:13000`.
- Backend cwd and inherited PWD: `/app`; repository A: `/workspace/issue-771-a`.
- Settings: `opencode-v2`, persisted through reload.
- Browser agent/model: default selections; real assistant metadata confirms
  `build` and `openai/gpt-5-mini` for each of the three replies.
- Final API cross-check: `2026-10-13T18:16:40.905698+00:00`.

The browser's tab-scoped diagnostic storage held IDs/marker only, not a transcript
used by MADE. Refresh, reselection, and reload responses were inspected directly.
Provider credentials were supplied through container runtime environment only;
host OpenCode configuration/database were not mounted.

## Automated validation

| Command | Coordinator result |
| --- | --- |
| `make qa-quick` | 543 passed, 1 existing unit skip, 2 subtests passed |
| `make test-backend FILE=tests/unit/test_opencode_v2_agent_cli.py` | 6 passed, 2 subtests passed |
| `make test-backend FILE=tests/unit/test_cron_service.py` | 29 passed |
| `make test-backend FILE=tests/unit/test_v2_history_isolation.py` | 5 passed |
| `make test-backend FILE=tests/unit/test_unit.py NAME=export_chat_history` | 2 passed |
| `make test-backend FILE=tests/unit/test_api.py NAME=history` | 11 passed |
| `make test-frontend FILE=src/hooks/useChatSession.test.tsx` | 20 passed |
| `make test-frontend FILE=src/components/ChatWindow.test.tsx` | 33 passed |
| `make test-coverage` | Frontend: 30 files / 190 passed. Non-external backend suite: 562 passed, 2 skipped, 2 subtests passed; 78.86% total coverage |
| `make build` | TypeScript/Vite build and backend wheel/sdist succeeded |
| `npx prettier --check src` (frontend directory) | Passed |
| Scoped `uv run ruff check` and `uv run ruff format --check` | Passed for changed backend source/tests |
| `git diff --check` | Passed |

Automated test children were given an environment without credential-like
variables. Real-model acceptance ran separately in the isolated containers.
The full suite's opt-in skip was not counted as real acceptance: the test below
was explicitly enabled and passed on both versions. External-adapter integration
tests unrelated to OpenCode v2 were not enabled.

### Real CLI acceptance

```bash
docker compose -p made-opencode-v2-acceptance \
  -f docker-compose.yml -f docker-compose.opencode-v2.yml \
  exec -T -e MADE_OPENCODE_V2_ACCEPTANCE=1 pybackend \
  .venv/bin/pytest -q tests/integration/test_opencode_v2_acceptance.py
```

- Pinned image: **opencode v2.0.18**, **1 passed**, session
  `ses_ec99e9adfffe2NG14jwSEC50Gs`.
- Separately prepared disposable image: **opencode v2.0.28**, same command with
  `-e 'MADE_OPENCODE_V2_EXPECTED_VERSION=opencode v2.0.28'`: **1 passed**.
  Inspected session: `ses_ec99961a1ffeeVjCWnIA1PjDd5`. The final rebuilt .28
  snapshot also passed this opt-in test before the browser run.
- Both inspected sessions persisted `/workspace/opencode-v2-acceptance`, appeared
  in scoped listing, resumed the same ID, and exported two user turns and two
  assistant replies. The inherited parent PWD remained `/app`.
- Fresh pre-fix disposable probes reproduced wrong-location creation in .18 and
  .28: requested `/workspace/771 baseline repo`, persisted `/app`, with successful
  real `LOCATION-PROBE` replies. Probe containers were removed afterward.

## Real browser acceptance

Main session **S**: `ses_ec989bad1ffehL7QAQSnGW5nOQ`.
Alternate session **R**: `ses_ec9884a90ffeOVBQF7vwtCm4So`.
Wrong-directory diagnostic **W**: `ses_ec9b49e50ffesQG9xWobVWJqnM`.
Marker: `771-mv6zz1ux`.

| Action | Exact observed outcome |
| --- | --- |
| First prompt asks to remember marker | Real POST returns S; user remains visible; assistant replies `ACK 771-mv6zz1ux` |
| Second prompt asks for prior marker without naming it | POST carries S; reply is `771-mv6zz1ux`; 2 user / 2 assistant messages |
| Open recent-session picker before saving S | S present in real backend listing and picker, not a saved placeholder |
| Select S, R, then exact S again | History responses: 4, 2, 4 conversation messages; IDs match selected sessions |
| Refresh and page reload | HTTP 200 history for S; 4 conversation messages in order |
| Third prompt after reload | POST carries S; reply is `771-mv6zz1ux THIRD` without the marker in the prompt |
| Final refresh and reload | HTTP 200 history for S; 3 user / 3 assistant messages; 6 distinct message IDs |
| Repository B listing and direct S history | B listing empty; history HTTP 409 with `session_directory_mismatch`, no foreign messages or internal directory path |
| Select saved diagnostic W | HTTP 409; explicit actionable alert; 0 chat messages; no `No conversation yet.` state |
| Refresh W, then wait for real idle-status probe | History 409, status 200 / `running:false`; alert remains; no successful-empty state |
| Browser offline, refresh S | Six messages retained; visible connection/retry alert outside scrolling pane; pane client height 520 / scroll height 620 |
| Restore browser networking and refresh | HTTP 200 / 6 messages; error clears only after history recovery |
| Recheck Settings, then return to A | `opencode-v2` persists; S and 6 fetched conversation messages restored; browser online; 0 history alerts |

OpenCode API verification confirms S's directory is `/workspace/issue-771-a`,
three user messages, three assistant replies, `build` / `openai/gpt-5-mini`, and
zero tool parts. MADE history agrees. W remains at `/app`; it was not moved.
The two fixture README files are unchanged.

Independent diagnostic commands, while this isolated stack exists:

```bash
docker compose -p made-opencode-v2-acceptance \
  -f docker-compose.yml -f docker-compose.opencode-v2.yml \
  exec -T pybackend opencode api get /api/session/ses_ec989bad1ffehL7QAQSnGW5nOQ
docker compose -p made-opencode-v2-acceptance \
  -f docker-compose.yml -f docker-compose.opencode-v2.yml \
  exec -T pybackend opencode api get /api/session/ses_ec989bad1ffehL7QAQSnGW5nOQ/message
curl --max-time 15 'http://127.0.0.1:13000/api/repositories/issue-771-a/agent/history?session_id=ses_ec989bad1ffehL7QAQSnGW5nOQ'
curl --max-time 15 'http://127.0.0.1:13000/api/repositories/issue-771-b/agent/history?session_id=ses_ec989bad1ffehL7QAQSnGW5nOQ'
```

Expected summaries: A returns 200 and six conversation messages; B returns 409
and the safe mismatch discriminator. These diagnostics require the retained test
database; they will not resolve after isolated acceptance cleanup.

## Screenshots

- [Loaded two-turn conversation](/docs/evidence/issue-771/loaded.png)
- [Exact session reselected](/docs/evidence/issue-771/reselected.png)
- [Three-turn conversation after refresh/reload](/docs/evidence/issue-771/reloaded.png)
- [Wrong-directory diagnostic error](/docs/evidence/issue-771/inaccessible.png)
- [Real offline failure with retained transcript](/docs/evidence/issue-771/offline.png)

## Review and separate follow-ups

Adversarial review found one high error-state finding and one medium test-teardown
finding. Both were corrected; focused re-review found zero remaining findings.
Regression tests failed before correction and passed afterward; raw regression
logs are not published.

- #772: pre-existing npm dependency advisories.
- #773: combined QA target invokes a root test script that only echoes; explicit
  frontend coverage/testing above closes that validation gap for this correction.
- #774: pre-existing Python dependency advisories.

No dependency upgrades, historical session moves, SQL recovery updates, or
protected host-service restarts are part of this correction. Ports were checked
before starting isolated services. Cleanup is restricted to the named acceptance
project and its newly created resources.
