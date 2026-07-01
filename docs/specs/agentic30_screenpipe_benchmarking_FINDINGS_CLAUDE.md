# Founder Memory OS — Verified Findings & Honest Status (Claude Code lane)

Last updated: 2026-07-01 KST.

This file is the Claude Code lane's record of independently-verified findings and
honest goal-state, kept separate from `..._CURRENT.md` / `..._SPEC.md` /
`..._GOAL_PROMPT.md` because Codex (session `019f1892-9fd3-7e23-bb2d-a26ee8a4f945`,
cwd this repo) is concurrently editing those docs and the Gate A wiring. Lane
split: Codex owns Gate A runtime wiring (`index.mjs`, `office-hours-effector-host.mjs`)
+ spec docs; Claude Code owns the recorder-module defect fixes below.

## Method

Three independent read-only adversarial reviews (security, implementation
correctness, product/spec-fit) plus direct grep/Read verification of every
structural claim. Baselines: sidecar `2358 pass` (6 clean full reruns), Swift
unit `575 pass`, `public-safety: clean`, recorder-scoped `171/171 pass`
post-fixes. `better-sqlite3 12.8.0` is a direct dependency. Proof writes flow
only through `execution-os.mjs appendProofLedgerEvent` (no recorder module
bypasses it — grep-verified).

## CRITICAL finding — Gate A journey was unwired (fake-completion at goal level)

Independently grep-verified, not just agent-reported:

- `recorder-day-loop.mjs` and `recorder-evidence-review.mjs` were **dead code**
  at runtime (imported only by their own tests).
- `recorder-day-memory-review.mjs` / `recorder-next-action.mjs` were reachable at
  runtime **only via Gate D Pipes**, never as the Gate A journey.
- `writeEvidenceCandidateThroughProofLedger` had **no runtime caller** (the
  verifier-gated proof write-through never executed outside tests).
- `office-hours*.mjs` / `chat-route.mjs` / `execution-os.mjs` / `specialists/*`
  had **zero** recorder references — the journey never fed Office Hours' one
  next action.
- Swift had **no** Day Memory Review / Evidence Inbox / redacted-search surface.

This violated the #1 non-negotiable ordering ("Gate A must serve the Day 0-3
loop before raw-API/Pipes"): Gate B (SQL inspector) and Gate D (Pipes) reached
`e2e_accepted` while the Gate A journey stayed unwired sidecar modules + synthetic
tests — the exact inversion the rule was written to prevent. Matches the project's
documented "evidence infrastructure built but not connected to the action loop"
pattern.

Status: **Codex is now actively wiring this** (`index.mjs` + `office-hours-effector-host.mjs`,
session 019f1892). Claude Code stood down from this lane to avoid collision.

## Five verified defect fixes (Claude Code, file-disjoint from Codex)

All CONFIRMED_FIXED by an adversarial verifier and green under recorder-scoped
`171/171` regression.

| Id | Sev | Defect | File | Fix |
|---|---|---|---|---|
| F2 | HIGH | proof-boundary gate fails OPEN on empty/unknown source kinds → forged customer/active/revenue proof | `recorder-proof-ledger-adapter.mjs` | denylist `.every()` → allowlist `.some()` of external evidence kinds; empty/unknown/recorder-only now throw `ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE` (fail-closed) |
| F4 | MED | idempotent re-write flips `written_to_ledger`→`verifier_rejected` while ledger event remains | `recorder-evidence-candidates.mjs` | short-circuit already-written rows to idempotent no-op (preserve `proof_ledger_event_id`) |
| F3 | HIGH | one orphan media file permanently deadlocks always-on retention → expired raw never purged (privacy) | `recorder-delete.mjs`, `recorder-retention.mjs` | ENOENT = already-satisfied per-row (still soft-delete/tombstone); non-ENOENT still fail-before-mutation |
| F5a | LOW | MCP grant scope check skipped on empty tool name | `recorder-raw-api-auth.mjs` | reject empty/mismatched tool name closed |
| F5b/c/d | LOW | `pragma_*` TVF token bypass; unbounded SQL view copy; day-review raw-key guard weaker than next-action | `recorder-raw-api-server.mjs`, `recorder-sql-worker.mjs`, `recorder-day-memory-review.mjs` | reject `pragma_\w+`; cap sandbox copy (200000); add document_path/snapshot_path/relative_path to guard |

## Honest per-surface status matrix (code-evidenced)

Legend: P=sidecar_policy_only, C=actual_collector, U=ui_wired, E=e2e_accepted.

- **Gate A**: permission ladder P+U · frame capture sparse-screenshot C+U (NOT
  the spec's always-on `SCStream` — open contradiction) · FTS search P (no Swift
  UI) · Day Memory Review P (Codex wiring) · Evidence Inbox P (Codex wiring) ·
  strict proof adapter real+correct, reachable once wiring lands.
- **Gate B**: token model C+E · raw API C+U+E · SQL inspector C+U+E (strongest
  surface) · audit C+U+E · MCP deny-by-default P (no Swift grant UI) · raw media C.
- **Gate C**: clipboard C+U · mic/system audio C (never run live) · transcript C
  (never run live) · browser/doc metadata C (never run live).
- **Gate D**: 3 built-in Pipes C+U+E · DSL P · scheduler C+E.

## Residual blockers (honest)

1. **Live signed-app TCC acceptance** — current machine is TCC-blocked; every UI
   E2E passes on the TCC-blocked path, so NO macOS collector (frame or audio) has
   produced a single real row. All `actual_collector` claims are
   code-exists/never-run.
2. **Gate A journey UI** (Swift Day Memory Review + Evidence Inbox + search) —
   pending; Codex is wiring the sidecar commands first.
3. **Spec contradiction**: "always-on `SCStream`" (spec) vs sparse-screenshot
   (impl) — needs an explicit product decision.
4. **Rare full-suite-parallel test flake** in `recorder-raw-api-runtime/server`
   under the ~2361-test parallel run (resource contention on server-starting
   tests). NOT reproduced in 18 recorder-scoped + 12 raw-api-scoped reruns;
   `node --check` clean — not a recorder-code defect. Documented, not chased.
5. **`insane-review` (GPT-5.5 Pro) NOT run** this session — not preparing a final
   readiness claim, and it needs the web ChatGPT Pro flow. Do not claim it ran.

## Adversarial Re-Verification — deeper bypasses found & closed (2026-06-30)

The two HIGH fixes (proof boundary, retention deadlock) were re-attacked by fresh
independent adversaries. Both first-pass fixes had DEEPER residual bypasses, now
closed and re-confirmed:

**Proof boundary (crown jewel) — 3 rounds → fail-closed redesign, final NO_BYPASS.**
- Round 1 found the source-kind denylist failed open (empty/unknown kinds) →
  replaced with an external-source allowlist.
- Round 2 found the gate ignored the proof EVENT TYPE: a recorder-only candidate
  could forge an accepted `payment_record`/`dm_ask` by omitting `targetGate` and
  picking a non-protected `proofKind` → added event-type protection.
- A deeper round 2 attack found the hand-picked event-type set still omitted
  `traffic_snapshot` (forges G5 first-external-traffic acquisition gate;
  `metadata.observed` defaults true) and `interview` (forges G1/G2 foundation
  gate) — both traced through the real gate engine `program-gate-engine.mjs`.
- Round 3 = structural fix: inverted to FAIL-CLOSED. `EXTERNAL_REQUIRED_PROOF_EVENT_TYPES`
  is now derived as *every* `PROOF_EVENT_TYPES` value EXCEPT a small allowlist of
  recorder-self-reportable process milestones `{setup, mission, bip, work_log,
  action_evidence, day_decision, landing_metric}`. Any new event type defaults to
  protected. The safe-list was validated gate-by-gate against `program-gate-engine.mjs`
  (only `day_decision` advances a gate — G7 "Final Decision", a process/graduation
  gate, not customer/active/revenue → correctly self-reportable).
- Final independent security re-verify: **NO_BYPASS** — single recorder→ledger
  path, consistent NFKC/case normalization across adapter↔append↔gate-engine,
  pipes capped at unverified, review writes no proof, `approved_bundle` requires
  human review, no over-block. One LOW defense-in-depth note (adapter still trusts
  a top-level `candidate.sourceKinds` field that no production caller sets — the
  inbox builder funnels all recorder sources through the `nonProofSourceKind`
  whitelist, so it is unreachable from recorder-only data; deferred as an unwired
  exotic edge rather than over-polished).

**Retention deadlock — deeper export-archive path → NO_BYPASS.**
- The first ENOENT-tolerance fix covered only the direct frame/audio path; the
  EXPORT-ARCHIVE closure (`preflightExportArchiveTargetsSync`,
  `assertRetentionFileAvailable`) still hard-failed on ENOENT and could re-deadlock
  the always-on sweep via an orphaned export bundle.
- Fixed: ENOENT → `alreadyMissing` (skip unlink, still tombstone the row);
  non-ENOENT / not-a-file still fail-before-mutation; the ENOENT-hard-failing
  `assertPhysicalFile` is now dead code (0 callers). 4+ orphan-export regression
  tests added.
- Independent re-verify: **NO_BYPASS** — every reachable stat/preflight tolerates
  ENOENT, partial mutation is impossible (the tombstone transaction runs
  unconditionally), deleted rows leave FTS/raw-API/SQL views.

Post-fix state: recorder-scoped regression **180/180 pass**. All edits are
file-disjoint from Codex's Gate A wiring; Codex's `recorder_day_memory_loop_run`
is non-proof (`proofAcceptedByDayLoop:false`), so the stricter proof boundary only
blocks recorder-only forgeries and is fully compatible with the wired journey.

## Round 2 — multi-agent adversarial hardening sweep (2026-07-01)

Codex landed Gate C audio/transcript work overnight (`recorder-audio.mjs`,
`recorder-control-state.mjs`, new `consent_grant_id` / `raw_audio_indicator_state`
/ `transcription_terminal_state` columns) — both NOT in the Claude Code lane.
Before continuing hardening, re-ran the full sidecar suite cold: **2384 pass, 0
fail** (own files untouched at that point), confirming Codex's concurrent work
left the baseline green.

Ran a 4-lens parallel adversarial review (proof-boundary, retention/deletion
completeness against the Gate C data-class list, SQL-inspector/raw-API
redaction-boundary consistency, day-review raw-key guard) restricted to the 8
owned files, each finding independently re-verified by 2 adversarial refuters
that had to reproduce the failure against the real code before confirming.
6 candidates → **4 confirmed** (reproduced, not just argued), 2 refuted
(unanimous):

| Id | Sev | Defect | File | Fix |
|---|---|---|---|---|
| F6 | HIGH | Frame deletion nulled `browser_url_search_label` but left `browser_domain` populated; RecorderStore's frame-specific merge-and-rederive logic in `normalizeRecordForTable` silently regenerated the label from the still-present domain on the same update, so a "purged" frame kept the visited domain (e.g. a bank URL) in the raw row indefinitely | `recorder-delete.mjs` (`deleteRecorderFrameCapture`, `deleteRecorderFrameCapturesInRange`) | add `browser_domain: null` to both delete patches |
| F7 | MED | `writeEvidenceCandidateThroughProofLedger` awaits the (real, file-locked, event-loop-yielding) proof-ledger append, then unconditionally overwrote `candidate_status` back to `written_to_ledger` with no re-check — a concurrent retention/consent-revocation delete that rejected the same candidate mid-await got clobbered, leaving `deleted_at != null AND candidate_status = "written_to_ledger"` | `recorder-evidence-candidates.mjs` | re-fetch the row immediately after the await (no intervening async work — closes the race); if it's gone or `deleted_at` is set, return `written_to_ledger_candidate_deleted` and leave the deletion's protective state untouched instead of clobbering it |
| F8 | MED | `audioDto()` exposed `consent_grant_id` / `visible_notice_id` at the base `"audio"` access tier, while the paired SQL-inspector views (`recorder_sql_transcripts_redacted` vs `_raw_admin`) deliberately classify those same two columns as `raw_admin`-only — a REST/SQL authorization-boundary inconsistency (split adversarial vote 1/2 refuted: the refuter argued these are non-secret audit IDs per SPEC §10.4 and not in the raw-SQL blocklist; kept the fix anyway for consistency with the SQL view's explicit classification, which is the stronger signal of intended sensitivity, and because tightening is the safe direction) | `recorder-raw-api-server.mjs` | `audioDto()` takes `includeAdminFields`, gated on `raw_admin` scope at both `/recorder/audio` call sites |
| F9 | MED | `copyAllowedViewsIntoSandbox` copies each allowed view with `LIMIT 200000` and no `ORDER BY`; the caller-visible `truncated` flag only reflected the *query result* cap (max 1000 rows), never the *copy* cap — once a view's true row count exceeds 200000 (plausible for `recorder_sql_audit_sanitized`, which has no `deleted_at` filter and grows on every raw-API access), an unbounded aggregate like `COUNT(*)` (exempt from the LIMIT requirement) silently returned a wrong, capped total with `truncated:false` | `recorder-sql-worker.mjs` | `copyAllowedViewsIntoSandbox` now returns whether any view hit the copy cap; that ORs into the worker's `truncated` result, which `recorder-raw-api-server.mjs` already forwarded verbatim (no caller-side change needed) |

Refuted (unanimous, not fixed): a claimed `evidence_candidates` idempotency-key
duplicate-write via the 1000-row `listRecords` cap — closed by the DB-level
`idempotency_key UNIQUE` constraint plus the fingerprint coupling between
`candidateId`/`immutableFingerprint`/`idempotencyKey` in the only production
candidate-creation path; and a claimed day-review raw-key-guard gap for Gate C
audio fields — the guard's denylist already covers the relevant path-shaped
fields and the new audio columns are not path-shaped.

4 new regression tests added (browser_domain purge ×2, TOCTOU race, SQL
copy-truncation via a real 200,001-row bulk insert) plus 2 new assertions on
the existing audio-DTO test. Focused suites green
(`recorder-delete.test.mjs` 26/26, `recorder-evidence-candidates.test.mjs`
4/4, `recorder-raw-api-server.test.mjs` 19/19). Full sidecar suite re-run
clean after all four fixes: **2388 tests, 2385 pass, 0 fail, 3 skipped**
(2384→2388 = the 4 new tests; skip count unchanged). All edits stayed
file-disjoint from Codex's `recorder-audio.mjs` / `recorder-control-state.mjs`
/ `index.mjs` / `office-hours-effector-host.mjs` / Swift / docs lane.

## Independent verification of Codex's completion report (2026-07-01)

Codex reported ~60% SPEC-acceptance (70-75% impl-progress). A 7-agent read-only
audit workflow (4 per-gate legend auditors + 1 fake-completion adversary + 1
acceptance auditor + synthesis, each grounded in real grep/Read traces, not
agent assertion) independently re-scored it. **Verified overall ≈ 52% (range
48-56%)** by the SPEC completion rule (`actual_collector + ui_wired +
e2e_accepted` for the intended mode); the acceptance-criteria auditor landed
58% separately.

| Gate | Codex | Verified | Verdict |
|---|---:|---:|---|
| A Founder Memory Journey | 60% | **33%** | too high |
| B Raw API / Audit / SQL | 80% | **68%** | too high |
| C Expanded Media | 40% | **42%** | accurate |
| D Pipes | 85% | **68%** | too high |

Three honest top-line conclusions (all evidence-traced, not asserted):

1. **The progress board is honest, not inflated.** It is unusually
   self-deprecating: every collector is repeatedly down-rated to
   "code-exists/never-run under TCC," debug-app/seeded E2E is distinguished
   from live signed-app acceptance in nearly every slice note, and the
   sparse-vs-always-on gap is self-disclosed in §17. Codex's 60% is best read
   as "fraction of code scaffolded" (defensible) and is materially too high
   only as a measure of SPEC-rule completion.
2. **The decisive ceiling is live TCC.** ZERO capture surface has produced one
   real row under granted permission — the machine is TCC-blocked and screen
   locked, so every capture-surface UI E2E passes only on the seeded-store /
   `Founder Replay TCC Blocked` branch. By the completion rule every macOS
   collector across Gates A/B/C/D is capped below complete. This is the single
   gap holding the number at ~52% instead of 70%+, and a headless agent cannot
   close it.
3. **The forbidden ordering inversion is real (partially mitigated).** Gate B's
   raw API/SQL inspector/audit and Gate D's Pipes/scheduler are the most-complete
   surfaces, but both operate exclusively over an empty/seeded `recorder.sqlite`
   because Gate A capture has never run live — the inspection/automation layer
   (B/D) is polished on top of a capture substrate (A) that produced zero rows.
   Mitigation: Gate A's journey is no longer dead code — `recorder-day-loop.mjs`
   is now genuinely wired (`index.mjs:555` import, `:1356` WS handler, `:4061`
   call), closing the documented dead-code gap. But the Day-0-3 loop is still
   manual-trigger + passive-read (Office Hours only reads `state.recorderDayMemoryLoop`,
   never fires it).

Three fake-completion vectors still over-counted (verified by grep):

- **MCP grant UI** — `assertRecorderMcpAccess` + durable grant store + 10/10
  tests exist, but ZERO Swift caller for `recorder_mcp_grant_*` and
  `mcp-server.mjs` exposes zero recorder tools: deny-by-default guards a door
  the MCP surface never opens. → `sidecar_policy_only`. **Codex/Swift lane.**
- **SQLite authorizer/progress-handler** — SPEC §8.1 / Gate B require it; the
  worker substitutes `query_only` PRAGMA + in-memory sandbox-copy of allowlisted
  views + `setTimeout`/`worker.terminate()` (no `setAuthorizer`/`progress_handler`
  anywhere; better-sqlite3 lacks the hooks). Honestly flagged in §17 but counted
  toward the Gate B line item. Defensible-partial, not literal spec compliance.
- **Evidence Inbox → proof-ledger write leg** — `writeEvidenceCandidateThroughProofLedger`
  / `writeRecorderProofCandidateToLedger` have NO non-test caller. This is
  **correct-by-design** (the verifier-gated proof write should fire only on
  explicit approval, whose runtime route lives in `index.mjs` = Codex lane), so
  it is an unwired approval path, not a recorder-module defect. Should not be
  counted toward Gate A Evidence Inbox completion until the approval route exists.

Two unwired dead-code modules confirmed (non-test importers = 0):
`recorder-retention.mjs` (presented as a "landed slice" in §17 yet has no
scheduler/low-disk-trigger/UI caller) and `recorder-evidence-review.mjs`
(orphaned; superseded by inbox-builder + candidates + adapter). **Decision: do
NOT delete from this lane** — `recorder-retention.mjs` is part of Codex's §17
narrative and wiring it into a scheduler is `index.mjs` (Codex) work; deleting
would clobber that lane. Flagged here for a coordinated decision. The retention
LOGIC itself is already hardened (F3 orphan-media ENOENT) so it is correct once
wired.

Claude-lane next actions (file-disjoint recorder-*.mjs only): harvest the Round 3
adversarial sweep and apply any reproduced+reachable recorder-module fix; keep
the proof boundary / redaction / retention logic correct-when-wired. The
highest-leverage remaining items (live TCC capture run = blocked; Day-loop
auto-fire + MCP grant UI = Codex) are out of this lane.

## Round 3 — convergence sweep + 2 confirmed fixes (2026-07-01)

13-agent adversarial workflow (6 lenses, reproduce-or-refute by 2 independent
refuters each that had to trace/run the real code, + a flake root-cause lane).
Baseline `185/185` recorder-scoped at start. **4 of 6 lenses converged with no
production-reachable defect** (proof-boundary, retention/deletion,
raw-API/SQL-authz, concurrency/idempotency — each note records the trace).
2 lenses found a genuine, reproduced, production-reachable, in-lane defect:

| Id | Sev | Defect | File | Fix |
|---|---|---|---|---|
| F10 | HIGH | `cleanText` collapsed whitespace only — no Unicode normalization — so fullwidth/NFKC PII (`ｓｅｃｒｅｔ＠ｖｉｃｔｉｍ．ｃｏｍ` → `secret@victim.com`) and zero-width-split PII (`leak​@victim.com`) evaded every ASCII-range redactor + the `UNSAFE_TEXT_PATTERN` sink gate, landing raw email/secret/URL in the search/memory/export sinks + FTS, recoverable with one `.normalize("NFKC")`. Reachable from the real Swift producer (sends window/AX text with no NFKC) — the spec's "captured text is hostile" model. | `recorder-redaction-policy.mjs` | `cleanText` now `.normalize("NFKC")` + strips `\p{Cf}` (zero-width/format) before whitespace-collapse, so all 7 sink call sites see the normalized form; ASCII control still blocked |
| F11 | MED/HIGH | `buildCaptureSummary` computed `topApps`/`topDomains` over **all** `activeFrames`, including default raw_local frames (`safe_for_*=0`) whose `app_name`/`browser_domain` are never sink-scanned, leaking raw hostile metadata into the `privacy_state:"memory_safe"` Day Memory Review snapshot + returned review object (not a provider prompt — confined to the on-disk snapshot/DTO) | `recorder-day-memory-review.mjs` | `topApps`/`topDomains` now derived from `memorySafeFrames` (the redaction-scanned set `samples[]` already uses); counts (`frameCount`) and coarse collector `triggers` stay over `activeFrames` |

**Flake (documented blocker #4) root-caused — NOT a product defect.** The rare
`recorder-raw-api-server.test.mjs` test #16 ("truncated when row count exceeds
copy cap") POSTs a 200,001-row SQL query with no `timeoutMs`, inheriting the
2000ms default; copying ~200k rows costs ~650ms unloaded but starves past 2000ms
under the full ~2388-test parallel run, flipping the (correct, fail-closed)
408-timeout path and failing the `=== 200` assert. Not a port/temp-dir/leak/
sqlite-collision issue (all probed clean). Fix is test-only: pin `timeoutMs:5000`
(= `MAX_SQL_TIMEOUT_MS`, ~7.5x headroom). Product behavior unchanged.

3 regression tests added (fullwidth+ZWSP redactor + gate; raw_local-frame
memory-snapshot exclusion). **Recorder-scoped `188/188 pass, 0 fail`** after all
three fixes (185 → 188 = the 3 new tests). All edits file-disjoint from Codex
(`recorder-redaction-policy.mjs` / `recorder-day-memory-review.mjs` + 3 recorder
test files only; no `index.mjs` / effector / `recorder-audio.mjs` /
`recorder-control-state.mjs` / Swift / Codex docs).

**Convergence declared for the recorder-hardening lane.** Defect yield is
diminishing (Round 1: 5, Round 2: 4, Round 3: 2) and the 4 highest-risk lenses
are clean. Remaining unwired exotic edges (product_events dedup UNIQUE wart;
unwired retention / write-through range deletes) are correctly deferred to
wiring-time integration tests — they have zero production caller, so polishing
them now is out of scope. Working tree left uncommitted (Codex is concurrently
editing the shared tree; committing would bundle its in-flight edits).

## a/b/c parallel workstreams + F12 migration crash fix (2026-07-01)

A 9-agent parallel workflow produced three deliverables (user-directed):

**(a) GRANTED-TCC acceptance runbook** — `agentic30_screenpipe_benchmarking_GRANTED_TCC_RUNBOOK_CLAUDE.md`
(new, non-colliding). Key finding: the whole live path is already wired AND a
GRANTED-branch UI test **already exists** — `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted`
(agentic30UITests.swift:1766), which `XCSkip`s unless `AGENTIC30_LIVE_SIGNED_APP_PATH`
points to a signed bundle. So the blocker is purely operational (signed app +
granted TCC + unlocked screen), not missing code. The runbook gives exact
preconditions, run steps, and observable pass/fail assertions.
In-lane support built: `sidecar/recorder-live-verify.mjs` (`isLiveCapturedFrameRow`
/ `assertLiveRecorderFrameRow` / `summarizeLiveRecorderCapture`) — a tested
live-vs-seeded discriminator so an acceptance run cannot certify the UI seed
fixture (`ui-frame-1` / `ui_test_seed`) as a real captured row. `5/5` tests.

**(b) Codex-lane wiring handoff** — `agentic30_screenpipe_benchmarking_CODEX_HANDOFF_CLAUDE.md`
(new, non-colliding). Two implementation specs for Codex (both OUTSIDE this lane):
(1) Day Memory loop auto-fire in the Day-0-3 journey via a pure context producer
(single-authority-for-state, non-proof, once-per-session idempotency, non-blocking);
(2) MCP grant UI + a real recorder MCP tool in `mcp-server.mjs` that actually
consults `assertRecorderMcpAccess`, wired to `recorder_mcp_grant_*` with a Swift
grant/revoke UI. These close the two verified fake-completion vectors.

**(c) fresh in-lane hardening sweep** — 4 lenses (pipes-sandbox, store-schema-fts,
media-export, clipboard-search-ingest), each finding reproduce-or-refuted by 2
independent verifiers. 3 lenses converged clean; 1 confirmed defect:

| Id | Sev | Defect | File | Fix |
|---|---|---|---|---|
| F12 | HIGH | `rebuildFramesFtsSchema` references `frames.document_path_search_label` (backfill INSERT + AI/AU triggers) but the column is only added by the `< 12` migration step, while the rebuild runs at the `< 7` and `< 10` steps. A `recorder.sqlite` at user_version 2-9 therefore threw `no such column: document_path_search_label`, rolled back the whole migration, and — because the sidecar bootstrap `process.exit(1)`s on `RecorderStore.open()` failure — **crashed the entire sidecar (chat, office-hours, everything) on every launch**. | `recorder-store.mjs` | `rebuildFramesFtsSchema` is now self-guarding: it `ensureFrameBrowserUrlSearchLabelColumn` + `ensureFrameDocumentPathSearchLabelColumn` (both idempotent) before the rebuild, fixing all three call sites uniformly and future-proofing reorderings. |

Regression test (`recorder-store.test.mjs`): a v9 pre-document-column frames DB
migrates to v12 without crashing + backfills FTS. **Negative-checked**: with the
fix reverted, the new test fails with exactly `no such column: document_path_search_label`;
restored → passes. On-disk proof: a copy of this machine's real
`recorder.sqlite` migrates cleanly (it is currently at user_version 0 / fresh, so
no immediate brick today — the earlier v7 state the verifier found has been reset
— but the v2-9 crash was a genuine latent brick for any dogfood machine carrying
a pre-v12 DB, now closed).

Recorder-scoped suite: **193/193 pass, 0 fail** (188 → +1 migration regression
+ 4 live-verify). New files: `sidecar/recorder-live-verify.mjs`,
`sidecar-tests/recorder-live-verify.test.mjs`, the two `_CLAUDE.md` handoff docs.
All edits file-disjoint from Codex; working tree still uncommitted.

## Feature: deny-by-default recorder MCP tool (2026-07-01)

Follow-up migration-integrity sweep (migration / fix-interaction / next-action +
audit-source lenses, reproduce-or-refute) **converged fully clean — 0 findings**,
confirming F10/F11/F12 are regression-free and no F12-class migration sibling
exists. Recorder-hardening lane is genuinely converged.

Then, per user direction ("implement missing GOAL/SPEC features" → chose the
in-lane-safe scope), implemented the one clearly-in-latitude SPEC gap: **Gate B
"MCP raw access denied by default, granted per tool."** The audit had confirmed
this as fake-completion — the MCP grant policy (`recorder-mcp-grants.mjs` +
`assertRecorderMcpAccess`) existed but NO MCP tool consulted it, so deny-by-default
guarded a door `mcp-server.mjs` never opened.

- New `sidecar/recorder-mcp-tools.mjs`: `runRecorderMcpRawSqlQuery` (pure/DI) +
  `runRecorderMcpRawSqlQueryFromAppSupport` (resolves the on-disk per-tool grant).
  Deny-by-default via `assertRecorderMcpAccess` (raw_sql is non-default → grant
  required); denials write a DENIED audit row and fail closed. On a valid grant it
  bridges to the vetted raw-API SQL pipeline (`handleRecorderRawApiRequest`) with an
  ephemeral, immediately-revoked raw_sql token, so there is exactly one SQL
  validation + sandbox-worker + per-value redaction + ACCEPTED-audit path. Output is
  local, redacted, audited, never proof; mutating SQL still fails closed.
- Registered the `recorder_raw_sql_query` tool in `sidecar/mcp-server.mjs` (NOT on
  the Codex stand-down list — stand-down is index.mjs/effector/Swift/docs). Opens a
  short-lived RecorderStore per call with `busy_timeout=5000` for WAL cross-process
  safety; denials/errors return a structured `isError` result, never a crash.
- 7 tests (`recorder-mcp-tools.test.mjs`): deny-by-default+audit, tool-mismatch deny,
  granted redacted query + accepted-audit + token-revoked, mutating-SQL fail-closed,
  store-required, and the on-disk-grant convenience path (grant present → runs;
  absent → deny). `mcp-server-security`/`mcp-server-redact` still `9/9`.

This moves Gate B MCP from `sidecar_policy_only` to a real wired tool (the policy
now guards an actual door). It is not yet e2e-usable without the **Swift grant UI
(Codex)** — the one remaining piece of the handoff's Part 2; the mcp-server tool
half is now DONE. **Recorder-scoped suite: `200/200 pass, 0 fail`** (193 → +7).
Codex stand-down files (index.mjs/effector/recorder-audio/recorder-control-state)
untouched; working tree uncommitted.

## Feature: Day Memory loop AUTO-FIRE + live signed-app run (2026-07-01)

**Coordination change:** the user explicitly LIFTED both blockers — authorized
(a) the live signed-app TCC run and (b) Codex-lane crossing. So the stand-down on
`index.mjs` no longer applies for this specific feature; edits use re-read-first +
exact-string (fail-loud). Codex's `index.mjs`/`office-hours-effector-host.mjs` were
idle ~11.5h (mtime 22:22) at edit time.

**(b) Day Memory loop auto-fire (the #1 Gate A product-value gap).** Implemented
per the CODEX_HANDOFF Part 1 design (single authority for state, pure effector
preserved, once-per-day idempotency, readiness-gated, fail-open, never proof):

- **Claude-lane (pure, tested):** `sidecar/recorder-day-loop-autofire.mjs` —
  `shouldAutoRunRecorderDayMemoryLoop({recorderStoreReady, day, readinessCanRecord,
  lastRunDayKey, todayKey})` (precedence not_running > out_of_window >
  already_ran_today > not_ready > ok) + `recorderDayMemoryLoopRanForDayKey`. And
  `recorderDayMemoryLoopLocalDayRange(now)` in `recorder-day-loop.mjs` (local-day
  window, +1ms at exact midnight so the range guard never throws). 9 tests.
- **index.mjs (now-authorized crossing):** `maybeAutoRunRecorderDayMemoryLoop({now,
  debtSink})` — calls the pure predicate, then does the I/O (loadRecorderControlState
  + evaluateRecorderCaptureReadiness + runRecorderDayMemoryLoop), refreshing ONLY
  the reducer-owned `state.recorderDayMemoryLoop` (same field the manual button
  writes — no new state owner). Wired at all 3 office-hours effector sites
  (`:5969` question continuation, `:10622` Day-1 warmup, `:11499` interview turn),
  sequenced BEFORE each `computeOfficeHoursEffectorContext` (which reads the cache
  synchronously) — never co-scheduled inside the sibling `Promise.all`. Fail-open:
  any error leaves the cache untouched and never blocks the office-hours turn.
  Emits scrubbed telemetry `mac_sidecar_recorder_day_loop_auto_fired {day, fired,
  reason}`. Keeps `proofAcceptedByDayLoop:false`; no proof path, no snapshot persist.

The effector (`office-hours-effector-host.mjs`) stays a pure read-only context
producer — UNCHANGED (§8c effector regression test still green). index.mjs can't be
imported in tests (boot side effects), so the wiring is verified by node --check +
export/symbol resolution + the pure predicate's unit tests + the effector
regression. **Recorder-scoped suite `209/209 pass, 0 fail`** (200 → +9).

**Independent adversarial verification of the wiring (3-lens, reproduce-or-refute):**
a workflow reviewed the auto-fire against all 6 design invariants (single-authority,
non-proof, fail-open, once-per-day idempotency, correct pre-Promise.all sequencing,
readiness gate) — **0 confirmed violations, 0 candidate findings**. Verdict:
"Day-loop auto-fire wiring upholds all 6 invariants." The bundled signed app
(rebuild) confirmed to inline the current code: schema v12, F12 fix (×2),
`recorderDayMemoryLoopLocalDayRange` (×3), MCP `recorder_raw_sql_query`, and the
bundle parses (`node --check`).

**Full-suite check (`2412 tests, 2398 pass, 11 fail, 3 skipped`) — the 11 are ALL
environmental, NONE from my changes.** Diagnosed by isolation + env-var toggling:
- **9** — provider auth-detection tests (Cursor/Gemini/Claude) fail because the
  shell has `AGENTIC30_TEST_STUB_PROVIDER` set: `getProviderAuthState()` returns
  `'test-stub'` instead of `'api-key'`. `env -u AGENTIC30_TEST_STUB_PROVIDER` → all 9 pass.
- **1** — `buildCodexEnv points Codex CLI at an isolated app config home` fails
  because the shell has `AGENTIC30_APP_SUPPORT_PATH` set. Unset → passes.
- **1** — `workspace-memory.test.mjs` "day memory persists ... Day 30 retrieval"
  (`'' !== 'Day 1 질문'`) fails even with both unset, on a file **clean vs HEAD**
  (untouched by me or Codex) — a pre-existing/date-dependent (today=2026-07-01)
  hermeticity issue, out of the recorder lane. Flagged as a separate task.

Every file I touched passes in isolation (recorder-scoped 209/209, mcp-server 9/9,
effector §8c green, auto-fire 6-invariants clean). Net: my changes introduced zero
regressions; the full-suite reds are the shell's stub/config env vars + one
pre-existing non-hermetic test.

**(a) Live signed-app run.** Built a Developer-ID-signed, hardened-runtime Release
`agentic30.app` (v1.0.29(49), Team 77S8MPV96M, satisfies Designated Requirement,
`Agentic30LiveSignedUIE2EAllowed=1`) via `scripts/run-live-signed-recorder-ui-e2e.sh
BUILD_ONLY=1` — build exit 0. Then launched the blocking live E2E (SKIP_BUILD,
reuse the signed build) under the user's unlocked session.

**Result: blocked one step short — on the XCUITest RUNNER's Accessibility grant,
NOT the app's capture TCC.** The gating preflight
`testFounderReplayLiveSignedAppRunnerAccessibilityPreflight` failed with
`runner_accessibility_blocked`: the signed `october-academy.agentic30` app
launched, but XCUITest (`october-academy.agentic30UITests.xctrunner`) could not
observe its window/static text because the RUNNER lacks Accessibility. The actual
capture test never ran. `recorder-live-verify` over the real
`~/Library/Application Support/agentic30/recorder/recorder.sqlite`: user_version 7,
**0 frames (0 live, 0 seed)** — no live captured row yet.
Next step (human, one-time): System Settings → Privacy & Security → Accessibility →
enable `october-academy.agentic30UITests.xctrunner`, then rerun (SKIP_BUILD). This
matches the long-standing open follow-up "ensure Accessibility for the
agentic30UITests-Runner."

**Secondary confirmation:** the real on-disk `recorder.sqlite` is at **user_version
7** — exactly the F12 crash scenario. F12 is a genuine latent brick on THIS machine
for any sidecar carrying schema 12 (now fixed). (Its 0-frame state also means the
bundled sidecar in the built app did not advance it past 7 — worth confirming the
build bundles the current F12-fixed + auto-fire sidecar before the rerun.)

## Live-TCC XCUITest acceptance — genuine infra blocker (2026-07-01, session 2)

Rebuilt the signed app with the current F12+auto-fire+MCP sidecar (verified inlined:
schema v12, F12 ×2, MCP tool, parses). Then exhausted the standard fixes to get the
live capture E2E's runner-Accessibility preflight to pass — ALL failed with an
**empty XCUITest observation tree** (`runner_accessibility_blocked`):
- Root-caused the cdhash churn: the ad-hoc XCUITest runner (`october-academy.agentic30UITests.xctrunner`)
  is re-signed for network.server every run → new cdhash → each manual Accessibility
  grant is invalidated. Switched to `xcodebuild test-without-building` (reuses the
  built runner, NO rebuild/resign) so the cdhash stays stable (`afcd8dc5…`).
- Fixed the env-propagation skip: the test reads `AGENTIC30_LIVE_SIGNED_APP_PATH`
  OR a `/tmp/agentic30-live-signed-recorder-ui-e2e-app-path-<uid>.txt` marker
  (<600s). `xcodebuild test-without-building` does NOT propagate shell env to the
  runner, so wrote the marker directly → the test now runs (not skips).
- `tccutil reset Accessibility october-academy.agentic30UITests.xctrunner` to clear
  the many stale per-cdhash grants; user then added a FRESH grant to the exact
  current runner (afcd8dc5). The xctestrun confirms the launched runner IS that
  granted one (`__TESTROOT__/Debug/agentic30UITests-Runner.app`) — not a path/cdhash
  mismatch.
- Still blocked. The signed app is Developer-ID + **hardened runtime** with **no
  `get-task-allow`** (correct for a notarizable release; get-task-allow is
  incompatible with Developer ID anyway). On macOS 26.5, XCUITest cannot observe
  the signed+hardened app's UI tree even with the runner granted Accessibility on
  its exact stable cdhash.

**Verdict:** the live-signed-app recorder acceptance is blocked by a real
XCUITest-on-macOS-26.5 limitation (observing a Developer-ID + hardened-runtime app),
NOT by any recorder/sidecar defect. This is the long-standing "ensure Accessibility
for agentic30UITests-Runner" follow-up; it needs dedicated harness investigation (a
different observation/drive mechanism), not a quick grant. `recorder.sqlite` remains
user_version 7, 0 frames. Every recorder feature (F12, Day-loop auto-fire, MCP tool)
is DONE + verified (recorder-scoped 209/209) independent of this gate.

### BREAKTHROUGH (session 2, cont.): the real blocker was macOS Automation Mode, not runner Accessibility

Web research (exa) surfaced the actual cause. macOS 12+ has TWO gates for UI
automation: (1) TCC Accessibility for the runner, and (2) **Authorization Services
"Automation Mode"** — a separate gate. With Automation Mode NOT enabled, XCTest can't
enable UI automation, so the runner observes an EMPTY tree → `runner_accessibility_blocked`
(mis-attributed). `automationmodetool` confirmed: "This device requires user
authentication to enable Automation Mode." Fix (one-time, admin, persists across
reboots, reversible): `sudo automationmodetool enable-automationmode-without-authentication`.

After the user ran it, **XCUITest now fully observes the Developer-ID + hardened-runtime
signed app** — the exported "App UI hierarchy" attachment shows the complete tree
(Window 'workspace', `intakeV2.progress` "Step 1 of 8", all cards). Hardened runtime
does NOT block observation (earlier hypothesis wrong). The long-standing runner-Accessibility
follow-up is fundamentally resolved.

**New, separate remaining blocker (well-diagnosed, tractable):** the signed E2E build
now launches into **Intake V2 onboarding (Step 1/8)** instead of the seeded Day-1
workspace, so the capture test fails "Workspace Missing". Root cause:
`requiresMacOnboarding = !(WorkspaceSettings.hasExplicitWorkspace || macOnboardingIntakeOnlyCompleted)`
(AgenticViewModel.swift:6502) is true because the live-E2E seed args (which predate the
Intake V2 onboarding feature) set NEITHER — diagnostics show `macOnboardingIntakeOnlyCompleted`
null and the seeded workspace not registering as explicit. Fix (Swift/app + test +
rebuild, Codex lane): make the live-signed E2E seed set `macOnboardingIntakeOnlyCompleted=true`
(or a valid explicit workspace) so the app routes past Intake V2 to the Day-1 workspace.
Then the capture test can drive Founder Replay → capture → delete → retention. Detailed
in memory `project_live_signed_e2e_automation_gate`.
