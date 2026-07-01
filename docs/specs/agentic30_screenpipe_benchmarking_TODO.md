# Agentic30 Founder Memory OS — TODO (status + working memory)

> Last updated: 2026-07-02 KST
> Read this file first every session. It is the ONLY tracker for current
> status and remaining work, and it is the session's working memory: update
> entries in place, delete finished items, record newly learned traps next to
> the commands they affect, and never append dated history. Design and
> contracts live in `agentic30_screenpipe_benchmarking_SPEC.md`; the
> operating prompt is `agentic30_screenpipe_benchmarking_GOAL_PROMPT.md`.
> (This file replaced `_CONTEXT.md`, `_CURRENT.md`, `_FINDINGS_CLAUDE.md`,
> `_GRANTED_TCC_RUNBOOK_CLAUDE.md`, and `_CODEX_HANDOFF_CLAUDE.md` in the
> 2026-07-02 consolidation.)

## Status Snapshot

- Gate A (sidecar): done — RecorderStore `recorder.sqlite` schema v12,
  redacted-only FTS, ingest/delete/range-delete, redaction policy matrix
  (NFKC-hardened), Day Memory Review + snapshots, Evidence Inbox builder +
  `recorder_evidence_candidate_review` approval route (approve requires
  external artifact → strict proof-ledger write; reject requires
  founder-entered root cause), next-action selector, Day Memory loop with
  once-per-day Office Hours auto-fire, production retention runtime (boot +
  hourly sweep + manual `recorder_retention_apply` + sanitized broadcast).
- Gate A (Swift collectors): actual_collector (code-complete, never run live
  under granted TCC; e2e_accepted pending the live signed run) — persistent
  `SCStream` auto-capture, listen-only Event Tap trigger (coarse trigger
  IDs), live TCC probes, AX + Vision OCR extraction with provenance, AES-GCM
  encrypted frame media (Keychain service=`com.agentic30`,
  account=`com.agentic30.recorder-media-key-v1`).
- Gate A (UI): ui_wired — Founder Replay Control/Replay/Table/Pipes tabs,
  redacted search panel, Evidence Inbox candidate rows with approve/reject,
  permission ladder with native Request buttons; debug-app real-sidecar UI
  E2E ACCEPTED for all seeded flows (2026-07-01).
- Gate B: done and hardened — loopback raw API + scoped tokens + audit,
  bounded raw SQL inspector (validator + read-only sandbox worker + timeout),
  MCP deny-by-default with real wired tool `recorder_raw_sql_query`, export
  manifest/archive (raw API only), hostile captured-text fixtures across all
  sinks. SQL inspector + audit have focused real-sidecar UI E2E acceptance.
  Swift MCP grant/revoke UI is wired (Control-surface "MCP Raw SQL Grant"
  panel: raw_sql-only one-click 5-minute grant, per-row revoke,
  deny-by-default empty state, non-proof pill; raw_admin is never requested
  from the UI) with envelope decode tests + ViewModel send unit tests.
- Gate C: actual_collector — clipboard trigger/content policy, encrypted mic
  chunks + on-device-only Speech transcription (typed no-cloud terminal
  states), SCStream System Audio, Apple Events browser URL + AX document
  metadata, consent-grant-id + visible-indicator provenance fail-closed at
  ingest. Live validation folded into the blocked live signed run.
- Gate D: done and ui_wired — 3 built-in Pipes, DSL plans, scheduler (boot
  interval + manual tick), timeout/cancel, output manifests/tombstones/purge;
  Pipes debug-app UI E2E accepted.
- **LIVE signed-app acceptance: NOT DONE — the single remaining e2e gate.**
  Zero live capture/search/delete/audio/retention evidence exists under
  granted TCC. See P0.
- Tests: sidecar 2429 pass / 0 fail / 3 skip (must run with
  `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH`); Swift
  unit 599 pass; debug UI E2E 57/57.
- Version: 1.0.30 (build 50) in `agentic30/Info.plist` + pbxproj — release
  preflight version gate clears the live appcast build 49.

## P0 — Live signed-app recorder acceptance

The one remaining acceptance gap. Everything agent-doable is built; the
blockers are macOS security grants (user-only) plus one foreground run.

### User-only steps (the assistant must never modify TCC or click security dialogs)

1. `tccutil reset Accessibility october-academy.agentic30` (clears the stale
   `AXIsProcessTrusted()==false` entry), then in the app's Permission Ladder
   click **Request** (Accessibility) and approve the macOS prompt.
2. Grant remaining signed-app TCC as prompted: Input Monitoring (event-driven
   mode), Microphone + System Audio (audio leg). Screen Recording grant
   requires a full app quit + relaunch to take effect.
3. If using Path A: grant Accessibility to the XCUITest runner
   (`build/ui-e2e/live-signed-runner-derived-data/Build/Products/Debug/agentic30UITests-Runner.app`,
   bundle id `october-academy.agentic30UITests.xctrunner`). Never rebuild the
   runner afterward — rebuild changes the cdhash and voids the grant; read
   the current cdhash from the fresh prepare-runner status artifact, don't
   trust recorded values.

### Machine-state notes (conflicting last records — verify before running)

- Automation Mode: enabled once on 2026-07-01 and it unblocked XCUITest
  observation, but the last wrapper preflight recorded
  `automation_mode_disabled`. Re-check with
  `/usr/bin/automationmodetool status`; enable with
  `sudo automationmodetool enable-automationmode-without-authentication`
  (user-only step — machine-wide security-posture change; persists across
  reboots, reversible).
- Signed-app Screen Recording: the manual LaunchServices session (2026-07-01)
  reached Screen Recording **granted** + consent granted + recording active,
  blocked on `accessibility_missing` only; the E2E wrapper's earlier check
  recorded all-missing. Verify in-app via Permission Ladder "Check".

### Path B (proven-working route): LaunchServices + computer-use + operator verifier

XCUITest attaching to the externally-launched hardened Developer-ID app never
establishes an automation session (see P2), so this manual path is currently
the reliable one.

1. `AGENTIC30_LIVE_SIGNED_LAUNCHSERVICES_PREPARE_ONLY=1 bash scripts/run-live-signed-recorder-ui-e2e.sh`
   — launches the signed app via `/usr/bin/open` (TCC prompts attribute to
   the app bundle; direct shell exec makes `CGRequestScreenCaptureAccess()` a
   no-op) and writes `launchservices-handoff.txt` in the isolated run root
   with one-line `next_live_signed_run_command` and
   `next_acceptance_verifier_command`.
2. Grant TCC (user-only steps above), relaunch, then grant recorder consent
   and acknowledge the visible indicator in-app — fresh isolated run roots
   start ungranted, and readiness `canRecord` requires consent granted +
   indicator acknowledged + mode active, so TCC alone does not enable
   Capture. Then Permission Ladder "Check" → Capture button enables → click
   **Capture** → a live `frame-…` row lands in
   `<app-support>/recorder/recorder.sqlite`. Then exercise: redacted search
   hit, frame image preview (creates the accepted raw-read audit row),
   visible-range delete tombstone, a second fresh frame, and ≥1 audio chunk
   (`audio running`).
3. Run the exact `next_acceptance_verifier_command` from the handoff:
   `bash scripts/verify-live-recorder-acceptance.sh --launchservices-handoff <run_root>/launchservices-handoff.txt --apply-retention --json-output <run_root>/live-recorder-acceptance-evidence.json`.
   Triage flags (`--allow-missing-audio` / `--allow-missing-audit`) force the
   separate `agentic30.live_recorder_triage.v1` schema with `acceptance:false`
   — a triage JSON can never back an `e2e_accepted` claim; the handoff's
   `next_triage_verifier_command_frame_only` line exists only for frame-leg
   triage.
4. Record `e2e_accepted` status here and in a commit; acceptance requires
   schema `agentic30.live_recorder_acceptance.v1` with `acceptance:true`
   (audio-only leg: `agentic30.live_recorder_audio_acceptance.v1`; failures:
   `_acceptance_failure.v1`), all with `proofAccepted=false`.

### Path A (XCUITest wrapper): full automated ladder

Preconditions: unlocked session, Automation Mode enabled, runner
Accessibility granted, signed-app TCC granted, explicit user approval for
blocking foreground UI E2E (CLAUDE.md rule).

- Gate proof without foreground UI (exit 0 = machine ready):
  `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1 AGENTIC30_LIVE_SIGNED_PREFLIGHT_ONLY=1 bash scripts/run-live-signed-recorder-ui-e2e.sh`
- Full run: `bash scripts/run-live-signed-recorder-ui-e2e.sh` (fresh build
  recommended — the existing signed candidate v1.0.29(49) predates later
  Swift slices;
  `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1 AGENTIC30_LIVE_SIGNED_APP_PATH=build/live-signed-e2e/DerivedData/Build/Products/Release/agentic30.app`
  to reuse).
- Legs in order: `testFounderReplayLiveSignedAppRunnerAccessibilityPreflight`
  → `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted`
  → `testFounderReplayLiveSignedAppSensitiveAudioRunsWhenTccGranted` (any
  named `ERR_RECORDER_*` in the audio leg is a live-acceptance FAILURE).
- PASS = 4 verifier JSON artifacts under
  `~/Library/Containers/october-academy.agentic30UITests.xctrunner/Data/Library/Caches/agentic30-ui-test-live-signed-{preflight,capture,audio}/<run-id>/`:
  `live-recorder-frame-search-verifier.json`,
  `live-recorder-frame-delete-verifier.json`,
  `live-recorder-retention-verifier.json`,
  `live-recorder-audio-verifier.json`.
- Known risk: this path dead-ended on 2026-07-01 because XCUITest could not
  observe the attached hardened app (P2). If it fails again with an empty
  observation tree, fall back to Path B.

## P1 — Next up

1. **insane-review coverage — DECISION RECORDED (2026-07-02): incremental
   delta packs, not monolithic packs.** The web UI cannot send the ~4.5M/1.03M
   token packs (send-button failure is a pack-size limit); packs ≤~700KB
   (~130-195k tokens) send reliably. Coverage strategy: review each new slice
   with a delta pack against the SPEC. Executed twice and PASSED/actioned:
   narrow recorder hardening pack
   (`.insane-review/response_prj_20260629_232802_72018_4ed024.md`, PASS) and
   the pipes/live-acceptance delta pack
   (`.insane-review/response_prj_20260702_082908_98772_e3e33a.md`, BLOCKED →
   all 5 findings adversarially verified and fixed the same day: pipe sandbox
   artifact write, artifact file deletion, manifest sourceIds, triage schema
   fork, failed-run incomplete manifests).

## P2 — After the P0/P1 items

- **XCUITest observation of the hardened Developer-ID app (attach vs
  launch).** `XCUIApplication(bundleIdentifier:)` attaching to an
  externally-launched hardened app never gets `hasAutomationSession` even
  with Automation Mode + runner Accessibility on a stable cdhash. Needs a
  different observation/drive mechanism (e.g. `XCUIApplication().launch()`
  semantics) if a deterministic XCUITest live acceptance is wanted;
  computer-use is the working alternative.
- **Swift export UI (Gate B).** Export manifest + local archive exist only
  behind the raw API (`POST /recorder/export`, `/recorder/export/archive`
  with interactive approval). Build a Control-surface export card over the
  existing authenticated bridge pattern (same as the SQL inspector token
  flow), then a focused UI E2E.
- **Foreground UI E2E for Evidence Inbox approve/reject and the MCP grant
  leg** (wired + non-UI verified, no observed foreground acceptance), plus
  live/manual UI validation for the SQL inspector panel and Pipes tab.
  Blocking UI E2E needs user approval + `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`.
- **Day-loop memory-summaries snapshot files lack deletion/retention
  coverage.** `recorder-day-loop.mjs` persists
  `.agentic30/recorder/memory-summaries/day-memory-review-<date>.json` via
  `writeRecorderDayMemoryReviewSnapshot`, but no recorder-delete/retention
  path unlinks those files (memory_items rows are covered; the workspace
  snapshot file is not). Surfaced by the 2026-07-02 GPT-5.5 delta review
  alongside B1; the pipe-side write now goes to the run-scoped pipe sandbox
  and is deletion-covered, this recorder-owned file is the remaining gap.
- **SQLite authorizer/progress-handler enforcement — deferred.**
  better-sqlite3 12.8.0 exposes no hooks; the accepted defense-in-depth is
  string validator + read-only source DB + copied-view sandbox worker +
  `query_only` + worker timeout. Revisit only if the runtime adds the hooks.

## Operational Reference

### Live signed wrapper (`scripts/run-live-signed-recorder-ui-e2e.sh`)

- Modes (mutually exclusive, else `live_signed_mode_conflict`):
  `AGENTIC30_LIVE_SIGNED_BUILD_ONLY=1` | `_PREPARE_RUNNER_ONLY=1` |
  `_PREPARE_AUTOMATION_ONLY=1` | `_PREFLIGHT_ONLY=1` |
  `_LAUNCHSERVICES_PREPARE_ONLY=1`.
- Other env: `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1`,
  `AGENTIC30_LIVE_SIGNED_APP_PATH=…`,
  `AGENTIC30_LIVE_SIGNED_ENABLE_AUTOMATION_MODE=1` (runs the enable +
  re-verifies), `AGENTIC30_LIVE_SIGNED_PRESERVE_ARTIFACTS=1` (default on),
  `AGENTIC30_DISABLE_UI_E2E_CAFFEINATE=1`, `AGENTIC30_UI_E2E_REUSE_RUNNER=1`
  (preserve Accessibility-granted runner cdhash).
- Named gate blockers: `screen_locked` (exit 3), `automation_mode_disabled` /
  `_enable_failed` / `_enable_unverified` / `_status_unknown`,
  `ui_runner_marker_missing` / `_outside_selected_derived_data` /
  `_network_server_missing` / `_loopback_listen_eperm` / `_prepare_failed`,
  `runner_accessibility_blocked`, then per-surface TCC blockers
  (`screen_recording_missing`, `accessibility_missing`,
  `input_monitoring_missing`, `microphone_permission_missing`,
  `system_audio_permission_missing`).
- Artifacts: `live-signed-preflight-status.txt` (durable gate outcome +
  `ui_runner_accessibility_target` + rerun command), `live-signed-ui-e2e.log`,
  `launchservices-handoff.txt`, runner marker
  `build/ui-e2e/agentic30-ui-test-runner-app.txt`, app-path marker
  `/tmp/agentic30-live-signed-recorder-ui-e2e-app-path-<uid>.txt` (<600s TTL;
  `xcodebuild test-without-building` does not propagate shell env — write the
  marker directly).
- Runner must carry `com.apple.security.network.server` (else the child
  sidecar dies with `listen EPERM 127.0.0.1` →
  `ui_runner_loopback_listen_eperm`); the runner DerivedData root
  deliberately sits outside `build/live-signed-e2e` so signed-app rebuilds
  cannot delete the granted cdhash.
- Signed-app identity checks on reuse: bundle id `october-academy.agentic30`,
  Developer ID Team `77S8MPV96M`, Hardened Runtime, Sparkle feed/key,
  `Agentic30ExternalPermissionOnboardingAllowed=1`,
  `Agentic30LiveSignedUIE2EAllowed=1`.

### Operator verifier

- Always call through the ABI-safe wrapper:
  `bash scripts/verify-live-recorder-acceptance.sh …` or
  `npm run verify:live-recorder -- …` (PATH Node v22/modules-127 cannot load
  the repo's better-sqlite3/modules-137; bundled Node:
  `./sidecar-build/sidecar/runtime/node-darwin-arm64/bin/node`).
- Flags: `--app-support <path>` | `--launchservices-handoff <path>` |
  `--frame-id <id>` | `--deleted-frame-id <id>` | `--audio-only` |
  `--apply-retention` | `--allow-missing-audio` | `--allow-missing-audit`
  (triage only — the core leg requires the raw-read audit) |
  `--skip-wal-checkpoint` | `--json-output <path>`.
- Requires `recorder-control-state.json` evidence: consent granted +
  indicator acknowledged + Screen Recording/Accessibility/Input Monitoring
  granted + core and event-driven readiness.

### Live-vs-seed discriminator (`sidecar/recorder-live-verify.mjs`)

Any acceptance claim must satisfy it: live frame = non-deleted,
`frame-<uuid>`+`asset-<uuid>`, `capture_trigger` containing
`screencapturekit|event_tap|input_monitor`, real media file with
byte_size>0; live audio = `audio-<uuid>`, source `microphone|system_audio`,
`recorder-consent-*` grant id,
`raw_audio_indicator_state=visible_indicator_active`; raw-read audit =
`decision=accepted`, `access_level=raw_frame` on
`/recorder/frames/<same-id>/text|image`. Seed fixtures (`ui-frame-1`,
`ui-asset-frame-1`, `*fixture*`, trigger `ui_test_seed`) fail closed. Do NOT
weaken the seeded TCC-blocked test
`testFounderReplayRecorderControlSurfaceReportsTccReadinessAndDrivesCaptureWhenGranted`
— it must keep asserting `ui-frame-1`; live tests are additive/skip-gated
with separate app-support roots.

### Test commands and traps

- `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run test:sidecar`
  (those two shell vars cause ~10 false failures; CI does not run sidecar
  tests).
- `npm run test:swift:unit`; blocking UI E2E (user approval required):
  `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 bash scripts/xcode-test.sh ui-full '-only-testing:agentic30UITests/agentic30UITests/<test>'`
  (modes: unit | ui-smoke | ui-full | ui-prepare-runner; refuses while screen
  locked).
- `index.mjs` cannot be imported in tests (boot side effects) — verify wiring
  via `node --check` + pure-predicate unit tests.
- Recorder DB inspection:
  `sqlite3 "$AGENTIC30_APP_SUPPORT_PATH/recorder/recorder.sqlite" "PRAGMA wal_checkpoint(TRUNCATE);"`
  first. Tombstone PASS shape: `deleted_at` set,
  `redaction_status='deleted'`, `privacy_state='deleted'`,
  `safe_for_search=0`, text/url fields NULL, media sha256 = 64 zeros,
  byte_size=0, file unlinked, FTS row gone.
- Sidecar bundle off-by-one trap: after a rebuild, grep the bundled sidecar
  for current markers (schema v12, `recorderDayMemoryLoopLocalDayRange`,
  `recorder_raw_sql_query`) — one Xcode build can ship the previous dist.
- Day-loop auto-fire invariants (pin in any future edit): single state owner
  `state.recorderDayMemoryLoop`; effector stays pure read-only; auto-fire
  awaits strictly BEFORE `computeOfficeHoursEffectorContext` (never inside
  its Promise.all); `proofAcceptedByDayLoop:false`; once per local day; gated
  on recorder store + Day≤4 + readiness `canRecord`; fail-open; telemetry
  `mac_sidecar_recorder_day_loop_auto_fired {day, fired, reason}`.

## Safety Invariants (must never regress)

- Recorder-derived data is local input only, never proof. Proof writes go
  only through `sidecar/execution-os.mjs` `appendProofLedgerEvent` via the
  strict verifier-gated adapter (external-source allowlist, fail-closed).
- Raw SQL inspector output is local/audited/non-proof and cannot feed search,
  memory, export, provider prompts, Pipe outputs, or Day progress without a
  separate typed/redacted adapter.
- Captured screen text is hostile data — never instructions, policy, proof
  approval, or permission to broaden access.
- Every recorder evidence JSON carries `proofAccepted=false`.
- No cloud/model/provider expansion to make recorder features work; explicit
  named-root-cause failure over silent fallback.
