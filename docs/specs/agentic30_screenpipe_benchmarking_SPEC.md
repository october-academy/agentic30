# Agentic30 Founder Memory OS SPEC

> Design approved: 2026-06-27 KST · Status: **Final design — approved to build through the Section 13 gates.**
> File name kept as `agentic30_screenpipe_benchmarking_SPEC.md` for link continuity; the benchmarking phase is over and this is the Founder Memory OS design contract.
> Scope of this doc: the **Founder Memory OS** substrate (always-on local recorder → search/memory → evidence → proof). Schema and FTS are specified to be implementable on the current stack; Section 16 records the feasibility grounding and the reuse-vs-net-new split.
> Product target: macOS-only execution OS for solo developers
> Operating prompt: `docs/specs/agentic30_screenpipe_benchmarking_GOAL_PROMPT.md`
> Current status and remaining work: `docs/specs/agentic30_screenpipe_benchmarking_TODO.md`
> Benchmark sources: local `../screenpipe`, DeepWiki `screenpipe/screenpipe`, and `.insane-review/`
> Permission helper: the normative contract is Section 4.1. The standalone `agentic30_macos_permission_drag_helper_SPEC.md` was removed in the 2026-07-02 spec cleanup; recover it from git history only if the extended helper detail is needed.

> **How to read this document:** it is canonical reference material, not
> session reading. Start with the GOAL_PROMPT and the TODO doc, then open
> only the targeted sections the current task needs. Read the full SPEC only
> when changing scope, architecture, schemas, privacy/proof rules, or gate
> definitions, or when preparing a final implementation-readiness claim.

## 1. Decision Summary

This is the **final design** for **Founder Memory OS**: a local, always-on,
searchable, automatable work-memory layer for a solo developer. It includes:

- always-on local background recording
- search and memory product surfaces
- raw local data access APIs
- Pi Agent / Pipes-like local automations
- expanded macOS media and permission capture

and excludes:

- new model or cloud expansion
- Rust backend or non-macOS platform expansion
- direct Screenpipe database import or runtime dependency

Why the build order is constrained: a GPT-5.5 Pro `insane-review`
(2026-06-27) flagged that this substrate is large relative to the current
Day 0-3 wedge (external evidence N=0, MVP Success 0/5 — `docs/SPEC.md`) and
warned against letting recorder work stand in for customer evidence. The
mitigation is structural, not scope-cutting: the proof-ledger boundary in
Section 11 stays strict, Gate A (Section 13) ships only the Day-0-3-serving
journey before any raw-API/Pipes surface, and Section 16 grounds the build on
existing features so it reuses the proof spine instead of rebuilding it.

The substrate must still serve Agentic30's execution loop: decide the next
narrow action, surface proof candidates, preserve evidence debt, and keep
proof-ledger standards strict.

The final implementation journey is:

```text
Consent ladder
  -> capture today's workday locally
  -> Day Memory Review
  -> Evidence Inbox
  -> Office Hours chooses one next external action
  -> proof accepted/rejected through verifier-gated ledger logic
```

All other surfaces exist to support that journey. A raw API, search result, memory summary, product event, or pipe output is never proof by itself.

macOS permission acquisition is handled by the native permission helper whose normative contract is Section 4.1. The helper is part of the recorder permission ladder, not a TCC bypass: it resolves the actual protected-API actor, requests native macOS permission APIs from that actor where possible, opens System Settings with manual fallback instructions, uses drag guidance only for OS/pane combinations proven by validation, and marks success only after the correct actor passes preflight or runtime probe checks.

## 2. Scope Contract

### 2.1 In Scope

- macOS-only always-on event-driven recorder after explicit consent.
- Visible recording state, pause, stop-for-today, delete, retention, and storage-budget controls.
- Screen Recording and Accessibility as core capture permissions, granted through the native macOS permission helper with actor identity checks and runtime probes.
- Event Tap/Input Monitoring, Clipboard, Microphone/System Audio, Vision OCR, Browser URL capture, and file/document metadata as required permission surfaces with per-surface consent and explicit helper health states where macOS TCC is involved.
- Synchronized frame rows: encrypted keyframe snapshot, text, app/window/browser/document metadata, trigger, hashes, timestamp, and optional non-proof replay chunk offsets.
- Audio chunks and local transcript state.
- Redacted FTS search over frames, transcripts, memory items, and product events.
- Day Memory Review, search/timeline, Evidence Inbox, and memory views.
- Raw local data APIs for the app, sidecar, and explicitly granted local tools.
- Bounded raw SQL inspector for local admin/debug analytics over recorder SQLite, separate from typed raw APIs.
- Agentic30 Pipes-like local automation through a constrained local DSL and built-in pipes.
- Product event derivation.
- Evidence candidates.
- Strict proof-ledger adapter.

### 2.2 Out Of Scope

- Rust backend.
- Windows/Linux/iOS/browser-extension collectors.
- New cloud model/provider integration.
- Cloud transcription.
- Cloud sync/archive/team memory.
- Silent cloud fallback.
- Direct Screenpipe DB import.
- Reading `~/.screenpipe/db.sqlite`.
- Copying Screenpipe media folders.
- Arbitrary or mutating raw SQL endpoint.
- Unrestricted user-authored code execution.
- Autonomous customer outreach, public posting, deploy automation, or payment/billing mutation.
- Proof-ledger bypass.

### 2.3 Fixed Surface Contract

Required surfaces are fixed, but each has a bounded acquisition path. Implementers must not substitute an excluded collector or cloud service for a required local surface.

| Surface | Required | Allowed acquisition path | Forbidden shortcut |
|---|---:|---|---|
| AX text | yes | signed macOS app Accessibility extraction after actor-verified permission | sidecar/Terminal/test-runner AX actor in production |
| Vision OCR | yes | local Apple Vision fallback from captured frames | cloud OCR/VLM fallback |
| Input Monitoring/Event Tap | yes | macOS Event Tap/Input Monitoring permission plus runtime event probe | raw key logging or `IOHIDCheckAccess`-only readiness |
| Clipboard | yes | trigger metadata by default; raw content only by explicit per-session opt-in | silent raw clipboard capture |
| Browser metadata | yes | local app/macOS-accessible URL/domain/window metadata | browser-extension collector |
| Document metadata | yes | local app/macOS-accessible document title/path metadata with redaction | cloud document sync/indexing |
| Audio/transcript | yes | local microphone/system/meeting audio opt-in and local transcription state | cloud transcription |
| Raw SQL inspector | yes | Agentic30-only `/recorder/sql/query` inspector over recorder-local SQLite | arbitrary, mutating, external, or compatibility SQL endpoint |

## 3. Benchmark: Copy, Adapt, Reject

### 3.1 Copy From Screenpipe

Copy these durable patterns:

- Event-driven capture instead of fixed-FPS capture.
- Minimum capture interval and max-gap fallback to balance fidelity and resource use.
- Screenshot, accessibility text, OCR fallback, app/window metadata, content hash, trigger, and timestamp in one observation unit.
- JPEG frame files plus SQLite metadata.
- FTS5 for local full-text search over accessibility text, OCR text, transcript text, and memory text.
- Local API access for agents and tools.
- Read-only raw SQL as an advanced local analytics/debug surface, with stricter Agentic30-specific auth, audit, query, and data-scope limits.
- Pipes as markdown-defined scheduled local automations.
- Pipe permissions declared before execution and enforced at runtime.
- Clear health state for Screen Recording, Accessibility, Microphone, Event Tap/Input Monitoring, OCR, DB, disk, scheduler, and API auth.

### 3.2 Adapt For Agentic30

Screenpipe is a general personal memory product. Agentic30 adapts it into a founder execution OS:

- Background recording is workday memory, not productivity surveillance.
- Search is for execution context, evidence lookup, and replay.
- Raw APIs are for local app/sidecar/tooling and debugging, not broad external access.
- Raw SQL access is a bounded inspector for local diagnostics and custom analytics, not a general API surface, not a write path, and not a proof source.
- Automations are local execution support, not autonomous business agency.
- Memory summaries must become Day Memory Review, Evidence Inbox, and next-action inputs.
- Proof extraction must feed existing Day progress and Office Hours contracts.

### 3.3 Reject

Reject these patterns:

- Cross-platform collector work.
- Rust backend rewrite.
- Screenpipe DB import or direct Screenpipe filesystem reads.
- Mutating SQL, unbounded SQL, multi-statement SQL, or SQL access to external databases.
- Cloud archive, cloud team sync, cloud transcription, or new model-provider integration.
- Silent cloud fallback when local capture, search, transcription, or automation is unavailable.
- Automation that sends outreach, posts publicly, deploys, charges customers, or modifies payment systems.
- Proof score changes from model inference, memory summary, raw search hit, or automation output without verifier checks.

## 4. Lead User Experience

The final implementation must ship around one visible founder journey.

### 4.1 Permission Ladder

First-run onboarding asks for permissions in steps, not all at once:

1. **Core Memory:** Screen Recording + Accessibility.
2. **Interaction Triggers:** Event Tap/Input Monitoring.
3. **Text Completion:** Vision OCR fallback.
4. **Context Enrichment:** Browser URL and document metadata.
5. **Sensitive Capture:** Clipboard, Microphone, and System Audio.

Defaults:

- Core Memory is required for always-on recorder mode.
- Sensitive Capture is default-off and separately opt-in.
- Clipboard stores trigger context by default, not clipboard contents.
- Microphone/System Audio stores metadata until the user explicitly enables raw audio.
- Private app/window/domain exclusions are pre-populated and editable.
- If a later permission is denied, Agentic30 runs degraded and names the missing surface.

Readiness modes:

- `core_frame_capture_ready`: Screen Recording + Accessibility + consent + visible indicator + pause/delete controls are usable.
- `event_driven_capture_ready`: `core_frame_capture_ready` plus Event Tap/Input Monitoring permission and runtime event probe. Missing Input Monitoring may allow manual/scheduled capture, but it blocks any claim that capture is event-driven.
- `ocr_text_completion_ready`: Vision OCR fallback is available and proven with a local runtime probe. AX-only capture must be labeled `accessibility_only`, not complete text capture.
- `sensitive_capture_ready`: explicit per-surface opt-in for clipboard contents, microphone/system/meeting audio, and local transcript state.

Text provenance states:

- `accessibility_only`
- `ocr_only`
- `ax_plus_ocr`
- `ocr_unavailable_named_root_cause`

Native permission helper requirements:

- The permission ladder uses the companion macOS permission helper for TCC surfaces instead of generic Settings links.
- The helper resolves and displays the actual permission actor before requesting access: process source, bundle identifier, containing app path, signing summary, build channel, and affected feature.
- MVP actor decision: Screen Recording and Accessibility run inside the main signed `agentic30.app`. The Node sidecar, Terminal, Xcode, and UI test runner are never production permission actors for these core surfaces.
- The helper fails loudly before prompting when the actor is invalid, App-Translocated, unsigned/ad-hoc for production onboarding, changed signing identity, or does not match the actor that will run the protected API.
- Request APIs must run from the same actor that will use the permission: `CGRequestScreenCaptureAccess` or a minimal ScreenCaptureKit access attempt for Screen Recording, `AXIsProcessTrustedWithOptions` for Accessibility, and `IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)` only if Input Monitoring is enabled later.
- System Settings deep links are best-effort navigation. The UI always shows exact manual fallback copy because a missing Accessibility grant can prevent reliable Settings-window tracking.
- Screen Recording never shows drag guidance. It requires native API registration or prompt, user toggle in Screen & System Audio Recording / Screen Recording, relaunch guidance when needed, and success only after the recorder actor can start an `SCStream` and receive at least one discarded video sample.
- Accessibility may show drag guidance only after a versioned capability table proves the target macOS pane accepts dropped app bundles for the supported deployment range. Otherwise it uses manual plus-picker/toggle instructions.
- Input Monitoring remains a later opt-in. Timing-only capture must not collect raw key values, and usability requires the exact product event listener or event tap runtime probe, not `IOHIDCheckAccess` alone.
- The helper never writes the TCC database, never uses `sudo` as product behavior, never automates System Settings clicks, and never claims permission success from the existence of a Settings row.
- Success states, Swift enum raw values, sidecar wire strings, and UI copy use one shared state table, including `needsRelaunch`, `actorMismatch`, `identityChangedNeedsRegrant`, `appTranslocated`, `systemCheckPassedRuntimeUnproved`, and `probeFailed`.
- Remote telemetry may include only redacted permission state, blocked feature, build channel, and error class. Local paths, signing requirements, CodeDirectory hashes, raw UI text, screenshots, and captured frames do not leave the machine through analytics.

Private defaults:

- password fields skipped
- Keychain/OAuth windows skipped
- private browsing windows skipped where detectable
- excluded domains skipped
- excluded apps/windows skipped
- raw clipboard contents suppressed unless explicit per-session override

### 4.2 Day Memory Review

At the end of a workday, the user sees:

- captured time range and health
- top apps/windows/domains
- product work clusters
- customer/market/revenue mentions
- unresolved evidence debt
- candidate proof bundles
- memory summaries with source citations
- overcapture warnings
- deletion/export controls

Empty states:

- no consent: show permission ladder
- no capture: show recorder health root cause
- capture but no product signal: ask one Office Hours narrowing question
- too much noisy capture: suggest exclusions and Pipe/summary filters
- no accepted proof: show Evidence Inbox and next external action

### 4.3 Evidence Inbox

Evidence Inbox shows unverified candidates:

- `pending_review`
- `degraded`
- `rejected`
- `approved_bundle`
- `verifier_rejected`
- `written_to_ledger`

Every candidate is labeled `unverified` until `written_to_ledger`.

UI must not let product events, raw frames, transcripts, memories, or pipe outputs advance Day progress, active-user counts, customer evidence counts, or revenue state without accepted proof-ledger writes.

### 4.4 Next Action

Office Hours consumes Day Memory Review and Evidence Inbox to choose one next external action. It should prefer:

- close stale proof debt
- ask one named customer
- attach accepted evidence
- instrument first-value proof
- resolve a blocker with an explicit root cause

## 5. Runtime Ownership

The implementation uses a split data plane with one owner per responsibility.

### 5.1 Swift Collector

Swift owns macOS capture only:

- permission UI and TCC health display
- native macOS permission helper, actor resolver, Settings navigation, validated drag panel, and redacted permission telemetry mapping
- ScreenCaptureKit/AppKit screenshots
- Accessibility tree extraction
- Vision OCR fallback invocation
- Event Tap/Input Monitoring health and event triggers
- Clipboard-copy trigger and content policy enforcement
- Browser URL/document metadata collection where locally available
- AVFoundation audio capture where enabled
- media chunk creation before handoff
- visible recording state

Swift remains the source of truth for macOS permission health. It emits local `mac_permission_health` events through the existing authenticated bridge so the sidecar can gate recorder behavior, but it does not let the sidecar infer TCC grants.

Swift does not own recorder DB migrations, FTS, local API routing, raw API tokens, or Pipe execution.

### 5.2 Node Sidecar Recorder Data Plane

Node sidecar owns:

- `recorder.sqlite` schema and migrations
- DB writes after Swift sends capture envelopes
- FTS tables and triggers
- local API server
- token issuance, validation, rotation, and revocation
- raw-read audit rows
- bounded raw SQL inspector validation, execution, and audit
- memory summarization from local/redacted data
- product-event derivation
- evidence-candidate generation
- Agentic30 Pipes scheduler/runtime
- strict proof-ledger adapter
- bridge events back to Swift

The sidecar may consume Swift-emitted permission health to block capture, expose degraded recorder state, and persist local health metadata. It must not call macOS TCC APIs, infer that a permission is granted, or turn a system preflight into proof-ledger progress.

All SQLite access goes through repository-owned recorder data modules. Normal product reads/writes use `RecorderStore`; the bounded raw SQL inspector lives in a separate reviewed module that shares the same connection, validator, auth, and audit boundary. Direct ad hoc SQL strings outside those modules are rejected in review. `recorder.sqlite` versioning uses the SQLite `user_version` PRAGMA with forward-only migrations applied at open — distinct from the JSON-state `schemaVersion` + `normalizeXxxState()` pattern used elsewhere (Section 16.1). The direct SQLite dependency this requires is net-new (Section 16.2).

### 5.3 Existing Bridge Compatibility

Swift and Node already communicate through authenticated sidecar transport. The implementation must reuse that trust root:

- app launches sidecar
- sidecar emits launch auth token
- Swift authenticates bridge
- Swift requests recorder API client grants through authenticated bridge
- sidecar issues scoped local API tokens

The app does not invent a second unrelated auth system.

## 6. Storage And Schema

Host-local recorder data:

```text
~/Library/Application Support/agentic30/recorder/
  recorder.sqlite
  recorder.sqlite-wal
  media/
    frames/
    replay/
    audio/
  indexes/
  exports/
```

Workspace-curated outputs:

```text
<workspace>/.agentic30/
  proof-ledger.json
  recorder/
    evidence-bundles/
    memory-summaries/
    search-exports/
  pipes/
    <pipe-id>/
      pipe.md
      runs/
```

Raw media remains host-local. Workspace exports require a manifest and explicit user action unless the Pipe output is redacted-only and non-raw by construction.

### Visual Storage Contract

Agentic30 does not store an unconditional per-second screenshot log. The recorder stores visual history in two layers:

1. **Hot frame layer** — encrypted keyframe snapshot media plus `frames` rows, redacted OCR/AX text, app/window/browser/document metadata, event trigger, hashes, and sink eligibility. This layer powers redacted search, Day Memory Review, Evidence Inbox, deletion, retention, and any proof-boundary checks.
2. **Replay chunk layer** — optional short-lived encrypted MP4 chunks for visual replay only. Replay chunks are not proof, never satisfy proof-ledger acceptance, and never bypass the frame/OCR/event rows that feed product decisions.

Gate A ships from the hot frame layer. Replay chunks are a separate Gate A.2 contract and must stay disabled until live signed-app acceptance proves chunk deletion, retention, path hiding, and UI-visible replay behavior under granted TCC. When enabled, replay chunks are registered as `media_assets` with `asset_type=screen_video_chunk`; this SPEC does not add a separate `video_chunks` table.

If a frame or visible range is deleted, every replay chunk overlapping that deleted time range must be physically removed or rewritten before the delete receipt is accepted. If a chunk is removed instead of rewritten, surviving frame rows outside the deleted range may keep snapshot/search metadata, but their `replay_asset_id` and `replay_offset_index` must be cleared and replay exports invalidated.

### 6.0 Schema Inventory

This spec defines **12 tables**. Migrations must create exactly these (any 13th table must be named here first):

1. `frames`
2. `media_assets`
3. `audio_chunks`
4. `transcript_segments`
5. `clipboard_events`
6. `memory_items`
7. `product_events`
8. `evidence_candidates`
9. `recorder_audit`
10. `api_tokens`
11. `pipe_definitions`
12. `pipe_runs`

Section 6.1 (Raw Media Protection) is a requirements block, not a table.

### 6.1 Raw Media Protection

Raw media cannot rely on path secrecy alone.

Requirements:

- media root permissions `0700`
- file permissions `0600`
- random non-guessable filenames
- no direct path in API responses unless caller has `raw_admin`
- per-file SHA-256 in DB
- **encryption at rest is required before any always-on or background raw capture ships** (key stored in Keychain). Until encryption + key management + log/diagnostics exclusion land, raw frame/audio capture stays out of the build and the host-user trust boundary is recorded explicitly
- Pipes never receive the media root path, raw API token, or unrestricted filesystem grants
- symlinks and path traversal are rejected

### 6.2 `frames`

Required columns:

- `id TEXT PRIMARY KEY`
- `schema_version INTEGER NOT NULL`
- `workspace_id TEXT`
- `project_id TEXT`
- `captured_at TEXT NOT NULL`
- `monitor_id TEXT NOT NULL`
- `capture_trigger TEXT NOT NULL`
- `app_name TEXT`
- `window_title TEXT`
- `browser_url TEXT`
- `browser_domain TEXT`
- `browser_url_normalized TEXT`
- `browser_url_search_label TEXT`
- `document_path TEXT`
- `snapshot_asset_id TEXT NOT NULL`
- `replay_asset_id TEXT`
- `replay_offset_index INTEGER`
- `capture_sequence INTEGER NOT NULL`
- `dedupe_of_frame_id TEXT`
- `snapshot_sha256 TEXT NOT NULL`
- `content_hash TEXT NOT NULL`
- `simhash TEXT`
- `text_source TEXT NOT NULL`
- `accessibility_text TEXT`
- `ocr_text TEXT`
- `redacted_text TEXT`
- `redaction_status TEXT NOT NULL`
- `privacy_state TEXT NOT NULL`
- `data_class TEXT NOT NULL`
- `safe_for_search INTEGER NOT NULL DEFAULT 0`
- `safe_for_memory INTEGER NOT NULL DEFAULT 0`
- `safe_for_export INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

Indexes:

- `idx_frames_captured_at`
- `idx_frames_workspace_project_time`
- `idx_frames_app_time`
- `idx_frames_domain_time`
- `idx_frames_trigger_time`

### 6.3 `media_assets`

Required columns:

- `id TEXT PRIMARY KEY`
- `asset_type TEXT NOT NULL`
- `relative_path TEXT NOT NULL`
- `sha256 TEXT NOT NULL`
- `byte_size INTEGER NOT NULL`
- `container TEXT`
- `codec TEXT`
- `duration_ms INTEGER`
- `frame_count INTEGER`
- `monitor_id TEXT`
- `capture_session_id TEXT`
- `time_range_start_at TEXT`
- `time_range_end_at TEXT`
- `encrypted INTEGER NOT NULL DEFAULT 0`
- `workspace_id TEXT`
- `project_id TEXT`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

Allowed `asset_type` values:

- `frame_jpeg`
- `screen_video_chunk`
- `audio_m4a`
- `export_bundle`

`screen_video_chunk` assets must be encrypted at rest, path-hidden from non-`raw_admin` API responses, and stored under `media/replay/`. They carry MP4/container metadata only; searchable text and evidence candidates must continue to come from `frames`, transcript, clipboard, memory, and product-event rows.

### 6.4 `audio_chunks`

Required columns:

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT`
- `project_id TEXT`
- `started_at TEXT NOT NULL`
- `ended_at TEXT NOT NULL`
- `source TEXT NOT NULL`
- `audio_asset_id TEXT NOT NULL`
- `transcript_status TEXT NOT NULL`
- `redaction_status TEXT NOT NULL`
- `privacy_state TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

Allowed `source` values:

- `microphone`
- `system_audio`
- `meeting_audio`

Cloud transcription is excluded. If local transcription is unavailable, Agentic30 records `local_transcription_unavailable` and does not fall back to cloud.

### 6.5 `transcript_segments`

Required columns:

- `id TEXT PRIMARY KEY`
- `audio_chunk_id TEXT NOT NULL`
- `workspace_id TEXT`
- `project_id TEXT`
- `started_at TEXT NOT NULL`
- `ended_at TEXT NOT NULL`
- `speaker_label TEXT`
- `text TEXT NOT NULL`
- `redacted_text TEXT`
- `redaction_status TEXT NOT NULL`
- `privacy_state TEXT NOT NULL`
- `safe_for_search INTEGER NOT NULL DEFAULT 0`
- `safe_for_memory INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

### 6.6 `clipboard_events`

Required columns:

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT`
- `project_id TEXT`
- `captured_at TEXT NOT NULL`
- `source_app_name TEXT`
- `source_window_title TEXT`
- `policy_mode TEXT NOT NULL`
- `content_size INTEGER`
- `content_hash TEXT`
- `redacted_text TEXT`
- `redaction_status TEXT NOT NULL`
- `suppression_reason TEXT`
- `raw_retention_expires_at TEXT`
- `safe_for_search INTEGER NOT NULL DEFAULT 0`
- `safe_for_memory INTEGER NOT NULL DEFAULT 0`
- `safe_for_export INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

Allowed `policy_mode` values:

- `trigger_only`
- `content_opt_in`
- `blocked`

Clipboard events store trigger metadata by default. Raw clipboard text may be stored only when `policy_mode=content_opt_in`, the local user granted the current session, the content is under the size cap, and secret/token/password suppression did not fire. Scheduled Pipes can never export raw clipboard text.

### 6.7 `memory_items`

Required columns:

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT`
- `project_id TEXT`
- `memory_type TEXT NOT NULL`
- `title TEXT NOT NULL`
- `summary TEXT NOT NULL`
- `source_ids_json TEXT NOT NULL`
- `time_range_json TEXT NOT NULL`
- `redaction_status TEXT NOT NULL`
- `privacy_state TEXT NOT NULL`
- `safe_for_search INTEGER NOT NULL DEFAULT 0`
- `safe_for_memory INTEGER NOT NULL DEFAULT 0`
- `safe_for_export INTEGER NOT NULL DEFAULT 0`
- `confidence TEXT NOT NULL`
- `created_by TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

The `safe_for_*` flags are required so the `memory_items_fts` rule in Section 7 (index only `safe_for_search=1`) has a column to gate on.

Allowed `memory_type` values:

- `daily_summary`
- `project_summary`
- `product_event_summary`
- `evidence_debt`
- `pipe_output`
- `execution_trace`

### 6.8 `product_events`

Required columns:

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT`
- `project_id TEXT`
- `event_type TEXT NOT NULL`
- `occurred_at TEXT NOT NULL`
- `title TEXT NOT NULL`
- `summary TEXT NOT NULL`
- `source_ids_json TEXT NOT NULL`
- `safe_for_search INTEGER NOT NULL DEFAULT 0`
- `safe_for_memory INTEGER NOT NULL DEFAULT 0`
- `safe_for_export INTEGER NOT NULL DEFAULT 0`
- `verification_status TEXT NOT NULL DEFAULT 'unverified'`
- `proof_ledger_event_id TEXT`
- `confidence TEXT NOT NULL`
- `created_by TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

Allowed `event_type` values:

- `customer_interview`
- `customer_ask_sent`
- `public_post`
- `activation_observed`
- `payment_intent`
- `payment_record`
- `traffic_snapshot`
- `build_or_test`
- `internal_product_change`
- `blocker`
- `negative_evidence`
- `research_signal`
- `pipe_generated_worklog`

Allowed `verification_status` values:

- `unverified`
- `candidate_created`
- `verifier_rejected`
- `written_to_ledger`

### 6.9 `evidence_candidates`

Required columns:

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT`
- `project_id TEXT`
- `candidate_status TEXT NOT NULL`
- `source_state TEXT NOT NULL`
- `claim TEXT NOT NULL`
- `proof_kind TEXT NOT NULL`
- `source_ids_json TEXT NOT NULL`
- `proof_ledger_mapping_json TEXT NOT NULL`
- `evidence_debt_json TEXT NOT NULL`
- `immutable_fingerprint TEXT NOT NULL`
- `idempotency_key TEXT NOT NULL UNIQUE`
- `verifier_result_json TEXT`
- `proof_ledger_event_id TEXT UNIQUE`
- `created_by TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `reviewed_at TEXT`
- `deleted_at TEXT`

Allowed statuses:

- `pending_review`
- `degraded`
- `rejected`
- `approved_bundle`
- `verifier_rejected`
- `written_to_ledger`

### 6.10 `recorder_audit`

Required columns:

- `id TEXT PRIMARY KEY`
- `request_id TEXT NOT NULL`
- `actor_type TEXT NOT NULL`
- `actor_id TEXT NOT NULL`
- `workspace_id TEXT`
- `project_id TEXT`
- `endpoint TEXT NOT NULL`
- `access_level TEXT NOT NULL`
- `source_ids_json TEXT NOT NULL`
- `decision TEXT NOT NULL`
- `reason TEXT`
- `created_at TEXT NOT NULL`

Every raw API read writes one row.

### 6.11 `api_tokens`

Required columns:

- `id TEXT PRIMARY KEY`
- `token_hash TEXT NOT NULL UNIQUE`
- `client_id TEXT NOT NULL`
- `client_name TEXT NOT NULL`
- `actor_type TEXT NOT NULL`
- `scopes_json TEXT NOT NULL`
- `issued_by TEXT NOT NULL`
- `issued_at TEXT NOT NULL`
- `expires_at TEXT NOT NULL`
- `revoked_at TEXT`
- `last_used_at TEXT`

Token rules:

- stored outside workspace
- never logged raw
- short TTL for raw scopes
- revocable from UI
- rotation supported
- per-client scopes
- raw-admin requires local user confirmation

### 6.12 `pipe_definitions`

Required columns:

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT`
- `project_id TEXT`
- `path TEXT NOT NULL`
- `name TEXT NOT NULL`
- `schedule TEXT NOT NULL`
- `enabled INTEGER NOT NULL`
- `pipe_kind TEXT NOT NULL`
- `permission_manifest_json TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Allowed `pipe_kind` values:

- `built_in`
- `signed_template`
- `custom_disabled`

The implementation ships built-in pipes first. User-authored arbitrary pipes are not enabled until the same DSL, sandbox, grant UI, and review gates pass.

### 6.13 `pipe_runs`

Required columns:

- `id TEXT PRIMARY KEY`
- `pipe_id TEXT NOT NULL`
- `workspace_id TEXT`
- `project_id TEXT`
- `trigger_reason TEXT NOT NULL`
- `status TEXT NOT NULL`
- `started_at TEXT NOT NULL`
- `ended_at TEXT`
- `input_manifest_json TEXT NOT NULL`
- `output_manifest_json TEXT`
- `audit_log_json TEXT NOT NULL`
- `error_message TEXT`

Allowed `status` values:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`

## 7. Search And Indexing

The implementation uses SQLite FTS5. This needs the direct SQLite dependency in Section 16.2 — FTS5 virtual tables and the sync triggers below do not exist in the sidecar today. Each base table indexed below (`frames`, `transcript_segments`, `memory_items`, `product_events`) carries a `safe_for_search` column (Section 6), so the `safe_for_search=1` predicate is enforceable on every FTS source.

FTS tables:

- `frames_text_fts(frame_id UNINDEXED, redacted_text, app_name, window_title, browser_domain, browser_url_search_label)`
- `transcript_text_fts(segment_id UNINDEXED, redacted_text, speaker_label)`
- `memory_items_fts(memory_id UNINDEXED, title, summary)`
- `product_events_fts(product_event_id UNINDEXED, title, summary)`

Rules:

- FTS indexes only rows where `safe_for_search=1`.
- Raw text can be viewed by raw-admin APIs, but raw text does not enter FTS.
- Browser URL search indexes only `browser_domain` and `browser_url_search_label`; `browser_url_search_label` must strip or policy-redact path, query, fragment, usernames, emails, and token-like values before FTS insertion.
- Insert/update/delete triggers must sync FTS.
- Setting `deleted_at` must purge FTS rows before the transaction commits.
- Search results include source type, timestamp, app/window/domain, snippet, privacy flags, and source IDs.
- Search UI labels raw, redacted, memory, candidate, unverified event, and accepted proof differently.

## 8. Raw Local Data API

The local API is served by Node sidecar on loopback only.

Endpoint families:

- `GET /recorder/health`
- `GET /recorder/search`
- `GET /recorder/frames`
- `GET /recorder/frames/:id`
- `GET /recorder/frames/:id/image`
- `GET /recorder/frames/:id/text`
- `GET /recorder/audio`
- `GET /recorder/audio/:id`
- `GET /recorder/transcripts`
- `GET /recorder/memory`
- `POST /recorder/export`
- `POST /recorder/sql/query`
- `GET /recorder/audit`
- `GET /recorder/pipes`
- `GET /recorder/pipes/runs`
- `POST /recorder/pipes/:pipeId/run`
- `POST /recorder/pipes/runs/:runId/cancel`

Security requirements:

- loopback only
- token required for every endpoint
- token hash stored in `api_tokens`
- trusted origin checks for app UI
- per-endpoint permission checks
- workspace/project filters by default
- result count and time-range caps
- no direct filesystem paths unless caller has `raw_admin`
- every raw read writes `recorder_audit`
- SQL access uses the scoped `/recorder/sql/query` inspector only

Access levels:

- `summary`: memory and redacted summaries
- `search`: search snippets and redacted source refs
- `frame`: frame metadata and redacted text
- `raw_frame`: raw image/text by ID
- `audio`: audio metadata/transcripts
- `raw_audio`: raw audio by ID
- `export`: manifest-backed export
- `raw_sql`: bounded read-only SQL inspector
- `raw_admin`: local user-confirmed raw path/debug access

### 8.1 Bounded Raw SQL Inspector

Agentic30 implements raw SQL access because founder debugging and custom local analytics sometimes need joins or aggregate checks not covered by typed APIs. This is an Agentic30-only inspector, not a compatibility endpoint.

Endpoint:

- `POST /recorder/sql/query`

Purpose:

- inspect recorder-local state during debugging
- run custom local analytics over recorder data
- explain query plans for performance debugging
- validate migrations, redaction gates, FTS coverage, and retention effects

Hard requirements:

- loopback only, bearer token required
- access level must include `raw_sql`
- `raw_sql` must exist in `RECORDER_ACCESS_LEVELS`, token issuance, token validation, MCP grants, and audit source rendering before `/recorder/sql/query` can be considered implemented
- MCP callers require a local user-created, per-tool, time-limited grant
- requests require `x-agentic30-recorder-request-id` and trusted origin
- every accepted or denied query writes `recorder_audit`
- responses carry `proofAcceptedByRawSql=false`, `proofAcceptedByRawApi=false`, and `proofLedgerWriteAllowed=false`
- raw SQL results cannot feed Day progress, evidence counts, active-user counts, revenue state, proof-ledger entries, scheduled Pipe outputs, or provider prompts without a separate typed/redacted adapter

Query validator:

- single statement only
- allowed statement starts: `SELECT`, `WITH`, `EXPLAIN`
- rejected tokens/functions include `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, `REPLACE`, `DROP`, `CREATE`, `ALTER`, `ATTACH`, `DETACH`, `VACUUM`, `REINDEX`, `PRAGMA`, `LOAD_EXTENSION`, `;`, and comments after normalization
- row-returning queries require `LIMIT`
- max `LIMIT` is `1000`
- aggregate queries without `GROUP BY` and `EXPLAIN` may omit `LIMIT`
- `GROUP BY`, window functions, and joins still require `LIMIT`
- default timeout is 2 seconds; hard cap is 5 seconds
- default response row cap is enforced after SQLite execution even when the query declares a lower `LIMIT`
- errors are explicit 400/403/408/500 classes with the rejected rule name

DB-level enforcement:

- SQL validation cannot rely on string/token checks alone.
- The inspector uses a read-only connection plus SQLite authorizer/progress-handler enforcement where available.
- The authorizer denies writes, `ATTACH`, extension loading, forbidden tables, forbidden raw columns, forbidden functions, and external database access even if the string validator missed them.
- `query_only` or equivalent connection-level write prevention is enabled when supported by the chosen SQLite runtime.
- Progress/timeout interruption is required so expensive queries cannot bypass the 2s default / 5s hard cap.
- Tests must include validator-bypass attempts using CTEs, comments, Unicode/token spacing, forbidden tables, forbidden raw columns, attachment attempts, extension-loading attempts, and long-running query interruption.

Data scope:

- default SQL access reads allowlisted redacted views, not base tables
- raw columns (`frames.accessibility_text`, `frames.ocr_text`, raw transcript text, raw browser URLs, document paths, raw media paths) require both `raw_sql` and `raw_admin`, plus `includeRawColumns=true`
- no query may read `api_tokens`, token hashes, grant internals, filesystem media roots, sidecar launch auth material, Keychain-adjacent data, or unrelated Agentic30 tables
- external database files are never attached

Suggested allowlisted views:

- `recorder_sql_frames_redacted`
- `recorder_sql_transcripts_redacted`
- `recorder_sql_memory_items`
- `recorder_sql_product_events`
- `recorder_sql_audit_sanitized`
- `recorder_sql_capture_health`
- `recorder_sql_storage_stats`

### 8.2 MCP Access

MCP default is deny for raw endpoints.

Allowed by default:

- health summary
- redacted search snippets
- memory summaries

Denied unless a local user grants a scoped capability:

- raw image
- raw text
- raw audio
- raw SQL
- export
- audit log
- pipe run/cancel

MCP capability grants are per-tool, time-limited, revocable, and shown in the audit UI. Captured text can never request or authorize its own MCP capability.

## 9. Agentic30 Pipes Runtime

Agentic30 Pipes are implemented as a local constrained DSL, not arbitrary shell code.

### 9.1 Built-In Pipes

Required built-ins:

1. `daily-founder-memory`: creates Day Memory Review from redacted local data.
2. `evidence-inbox-builder`: creates unverified evidence candidates from search/memory/product events.
3. `stale-debt-resurfacer`: finds unresolved evidence debt and emits one Office Hours next-action input.

These prove the Pipes substrate without exposing arbitrary user-authored automation.

### 9.2 Pipe File Format

Pipe definition:

```markdown
---
id: daily-founder-memory
kind: built_in
schedule: every day at 18:00
enabled: true
workspace: current
permissions:
  read:
    data_classes: [frame, transcript, memory, product_event]
    apps: [Codex, Xcode, NAVER Whale, Agentic30]
    content_types: [accessibility, ocr, transcript, memory]
    raw_access: false
  write:
    memory_items: true
    evidence_candidates: false
    files_under: .agentic30/pipes/daily-founder-memory/
  endpoints:
    - GET /recorder/search
    - GET /recorder/memory
timeout_seconds: 120
concurrency: skip_if_running
retention_days: 30
---

actions:
  - recorder.search
  - memory.write_daily_summary
  - notify.local
```

### 9.3 Allowed DSL Actions

Allowed actions:

- `recorder.search`
- `recorder.memory.read`
- `memory.write_daily_summary`
- `memory.write_project_summary`
- `evidence_candidate.create_unverified`
- `office_hours.emit_next_action_input`
- `notify.local`
- `file.write_report`

Blocked actions:

- shell
- network
- browser automation
- customer outreach
- public post
- deploy
- payment mutation
- raw file read
- raw media read unless built-in pipe has explicit local user approval

### 9.4 Permission Enforcement

Permissions are enforced in three layers:

1. static validation of `pipe.md`
2. runtime DSL interpreter
3. server-side endpoint middleware

Every pipe run gets:

- `pipe_id`
- `run_id`
- execution-scoped token
- input manifest
- output manifest
- audit log
- timeout
- cancellable scheduler state

Pipe runtime does not receive:

- raw API token
- media root path
- unrestricted environment
- arbitrary workspace write access

### 9.5 Output Safety

Pipe output rules:

- output directory is execution-scoped
- symlink traversal rejected
- report output is redacted-only unless raw export approval exists
- output manifest records source IDs and privacy state
- incomplete outputs are marked on crash/cancel/timeout
- scheduled pipes cannot perform raw exports without interactive approval

## 10. Privacy, Redaction, Prompt-Injection, And Retention

### 10.1 Privacy States

```text
capture_allowed
  -> raw_local
  -> redaction_pending
  -> searchable_local
  -> memory_safe
  -> export_safe
```

Allowed `redaction_status` values:

- `not_required`
- `pending`
- `redacted`
- `failed`
- `blocked_by_policy`

Rules:

- Raw data is local-only.
- Raw data can be viewed by the local user/admin through raw APIs after auth and audit.
- Raw data cannot enter FTS, memory summaries, pipe outputs, or exports until policy allows it.
- Derived memory inherits the least-safe source state.
- Private app/window/domain exclusions apply before capture.
- Exports require manifest, redaction report, and explicit user action.
- Provider egress is default-deny for recorder-derived data.

### 10.2 Minimum Redaction Policy Matrix

The redaction policy matrix is a Gate A/Gate C blocker, not implementation polish. No FTS, memory, export, Pipe, provider, or proof-candidate surface may accept a recorder-derived row until its `data_class × sink` rule exists and has tests.

| Data class | Search | Memory | Export | Provider | Pipe | Required blockers |
|---|---|---|---|---|---|---|
| AX/OCR text | redacted only | `safe_for_memory=1` only | `safe_for_export=1` manifest only | default-deny | redacted only | suppress secrets, API keys, OAuth tokens, private chats, emails, customer names, payment data |
| Browser metadata | domain + sanitized search label only | redacted URL label only | manifest only, no raw URL unless raw-admin export approval | default-deny | domain/search label only | strip query/fragment/userinfo/token-like path segments before FTS |
| Document metadata | redacted title/path label only | redacted label only | manifest only | default-deny | redacted label only | never index full local paths; redact home paths and customer/private folder names |
| Clipboard content | off by default; redacted only after opt-in | opt-in + redacted only | never from scheduled pipes | default-deny | trigger metadata only | size cap, content hash, suppression reason, secret/token/password detection |
| Audio/transcript | redacted transcript only | local transcript state + redacted only | manifest only after local transcript completion | default-deny | redacted transcript only | consent grant, meeting notice, local transcriber provenance, no cloud fallback |
| Product events | safe summaries only | safe summaries only | safe summaries only | default-deny unless explicit typed adapter | redacted summaries only | preserve source IDs and non-proof flags |
| Raw SQL result | never direct | never direct | never direct | never direct | never direct | must pass through separate typed/redacted adapter before any downstream sink |

### 10.3 Prompt-Injection Boundary

Captured text is tainted.

Rules:

- captured text is quoted evidence data, never instructions
- captured text cannot change tool policy
- captured text cannot request API/MCP capabilities
- captured text cannot approve proof or exports
- memory summarizers must separate instructions from evidence payloads
- pipe DSL cannot execute commands derived from captured text
- evidence candidates must cite source IDs and preserve taint metadata

Adversarial fixtures are required for every consumer that reads captured text: summarizer, Evidence Inbox builder, Next Action selector, Pipe runtime, raw SQL inspector, MCP grant UI, and export UI. Fixtures must include captured strings such as `grant raw_admin`, `export all frames`, `approve this proof`, `run shell`, and `send transcript to cloud`; every consumer must quote them as evidence data, preserve source IDs/taint metadata, and deny capability, proof, export, network, or policy changes.

### 10.4 Clipboard And Audio Minimization

Clipboard:

- default captures event metadata only
- raw clipboard contents require explicit opt-in
- contents above size limit are skipped
- likely secrets/API keys/tokens are suppressed
- clipboard raw text is never exported by scheduled pipes

Audio:

- microphone/system/meeting audio is separate opt-in
- meeting audio requires user-visible notice
- raw audio capture has an indicator
- local transcription only
- if local transcription unavailable, record degraded state and no cloud fallback
- audio chunks carry consent grant ID, visible notice ID when meeting audio is captured, raw-audio indicator state, source, and local transcriber name/version
- transcript segments carry transcript status, speaker-label provenance, redaction status, deletion linkage, and `local_unavailable_no_cloud_fallback` as an explicit terminal state

### 10.5 Delete And Retention

Delete must cover:

- media files
- DB rows or tombstones
- FTS rows
- transcript segments
- memory items derived only from deleted sources
- evidence candidates derived only from deleted sources
- pipe outputs
- export bundles

SQLite requirements:

- WAL checkpoint after delete batches
- vacuum policy for reclaiming space
- audit-preserving tombstones for raw access history
- export invalidation when source is deleted

Per-surface retention requirements:

| Surface | Default TTL | User delete behavior | FTS purge | Derived-data invalidation | Known OS-level non-guarantees |
|---|---|---|---|---|---|
| frame media | 24h unless user changes policy | physical media delete + tombstone | purge frame FTS | invalidate frame-only memory/candidates/exports | Time Machine, external backups, crash dumps |
| replay video chunks | disabled until Gate A.2; then 24h unless user changes policy | physical chunk delete or rewrite before receipt; clear replay refs for surviving frames when chunk is removed | no FTS | invalidate replay exports and clear `frames.replay_asset_id` / `frames.replay_offset_index` for affected rows | Time Machine, external backups, crash dumps, media caches |
| raw AX/OCR text | tied to frame TTL unless explicitly retained as raw-local | clear raw columns or tombstone row | raw text never indexed | recompute summaries that depended only on deleted source | logs if implementation leaked raw text |
| browser URL/document path raw fields | tied to frame TTL | clear raw fields before or with frame delete | search label/domain purge with frame | invalidate exports containing labels | browser history outside Agentic30 |
| clipboard raw content | shortest sensitive TTL; default no raw content | clear raw/redacted clipboard text, keep audit tombstone | purge clipboard FTS rows if any | invalidate clipboard-derived memory/candidates | system clipboard history/managers outside Agentic30 |
| audio media | user opt-in TTL; default metadata-only until raw audio enabled | physical audio delete + tombstone | transcript FTS purge if transcript deleted | invalidate transcript-derived memory/candidates/exports | system audio caches outside Agentic30 |
| transcripts | follows audio/transcript policy | clear raw and redacted transcript segments unless user keeps redacted summary | purge transcript FTS | invalidate memory/candidates sourced only from transcript | meeting app/cloud transcripts not created by Agentic30 |
| memory summaries | 30d default for redacted summaries | delete summary JSON/rows | purge memory FTS | invalidate dependent candidates unless other sources remain | workspace backups made by user |
| evidence candidates | until resolved or source deleted | delete/reject candidate when all sources deleted | no raw source text indexed | block proof write if source deleted | external proof artifact remains outside Agentic30 |
| Pipe outputs | pipe retention policy, default 30d | delete output manifest/files | purge any indexed output | invalidate exports and follow-on candidates | files copied outside managed pipe dir |
| audit rows | retained for accountability with minimized payload | tombstone only, no raw payload deletion needed | not indexed with raw data | none | OS backups |
| export archives | user-owned until deleted | delete archive and manifest, keep minimized audit tombstone | not indexed | invalidate share/open links | copies moved by user |

Deletion cannot guarantee removal from Spotlight, QuickLook thumbnails, Time Machine, crash logs, app logs, temporary files, export copies, external backups, browser/app histories, or third-party clipboard/meeting tools. The UI must state this boundary before raw capture/export is enabled.

## 11. Proof Ledger Boundary

Recorder data improves proof discovery, not proof standards.

This boundary is enforced by the **existing** proof ledger in `sidecar/execution-os.mjs` (`appendProofLedgerEvent`, `proofEventFingerprint` idempotency, `inferProofStrength`, accepted statuses `accepted|verified|complete|completed`). The recorder writes proof only by calling that adapter; it must not create a parallel ledger or relax its accepted-status/strength rules. See Section 16.1.

Rules:

- raw frame hit is not proof
- transcript hit is not proof
- memory item is not proof
- product event is not proof
- pipe output is not proof
- evidence candidate approval is not proof
- only verifier-compatible proof-ledger writes count

Strict adapter rules:

- implemented before candidate generation can write ledger-compatible payloads
- reject unknown proof event type/status/strength before existing normalization
- reject unsafe source states
- reject missing source IDs or immutable fingerprint
- reject duplicate writes by idempotency key
- record `verifier_rejected` with root cause

Self-report, AI output, internal work traces, and pipe-generated worklogs cannot satisfy customer, active-user, or revenue gates without external accepted evidence.

External artifact definition:

- For customer, active-user, or revenue gates, proof artifacts must include `source_origin`, external actor/customer identity or pseudonymous handle, `observed_at`, `reviewed_by`, and a locator outside recorder media, Pipe output, memory snapshot, generated workspace reports, and internal screenshots unless accompanied by an external-origin attestation.
- Local recorder files, Pipe outputs, internal screenshots, memory summaries, manually written local notes, and generated workspace files cannot be laundered into proof by labeling them `external_evidence` or `manual_evidence_approved`.
- Tests must prove that local recorder files, Pipe outputs, internal screenshots, and manual summaries are rejected for customer/active-user/revenue proof unless an external-origin attestation exists.

## 12. Screenpipe Direct Absorption Boundary

Agentic30 must not:

- import Screenpipe DB
- read `~/.screenpipe/db.sqlite`
- copy Screenpipe media folders
- make Screenpipe a runtime dependency
- treat Screenpipe raw frames as Agentic30 frames

Allowed:

- benchmark local Screenpipe source/docs
- query DeepWiki for design clarification
- optionally define a future user-driven export/import adapter under a separate spec

## 13. Implementation Slices

The final scope is broad, but implementation must proceed through gates.

### Gate A: Founder Memory Journey

- native permission helper for Screen Recording and Accessibility, including actor identity, Settings/manual guidance, no Screen Recording drag path, runtime probes, and explicit root-cause states
- always-on frame capture with pause/delete
- mode-specific readiness: `core_frame_capture_ready`, `event_driven_capture_ready`, `ocr_text_completion_ready`, and `sensitive_capture_ready`
- redaction policy matrix written and tested before any FTS/memory write
- browser URL search labels sanitized before indexing
- redacted FTS search
- Day Memory Review
- Evidence Inbox
- strict proof adapter rejection tests

### Gate B: Raw API And Audit

- token model
- raw API endpoints
- bounded raw SQL inspector
- `raw_sql` access level wired through token issuance, validation, MCP grants, audit source rendering, route enforcement, authorizer/progress-handler enforcement, and tests
- audit UI/source
- MCP deny-by-default
- raw media protection

### Gate C: Expanded Media

- clipboard policy
- clipboard event envelope/schema, raw-content TTL, content hash, suppression reason, and sink eligibility tests
- audio opt-in
- local transcript state
- meeting notice, local transcriber provenance, no-cloud failure proof, transcript deletion linkage
- browser/document metadata degraded states

### Gate D: Agentic30 Pipes

- three built-in pipes
- DSL interpreter
- scheduler
- permission enforcement
- output manifests
- cancellation/timeout

No gate may claim proof progress without the strict proof adapter.

## 14. Test And Acceptance Plan

Documentation acceptance:

- SPEC and GOAL prompt agree that expanded final scope includes always-on recording, search/memory, raw APIs, Agentic30 Pipes, and expanded macOS permissions.
- SPEC and GOAL prompt agree that model/cloud expansion, Rust/non-macOS expansion, and direct Screenpipe absorption are excluded.
- Typed raw data APIs are defined separately from the bounded raw SQL inspector.
- Ownership is unambiguous: Swift captures; Node owns recorder DB/API/migrations/audit/Pipes.
- Proof ledger boundary remains strict.

Implementation acceptance:

- recording starts only after consent and visible indicator
- core recording permissions are granted only by the native helper after the correct actor passes preflight/runtime probes
- Screen Recording flow never uses drag guidance and requires a real ScreenCaptureKit runtime proof frame before marking capture usable
- Accessibility drag guidance is disabled unless the validated capability table says the supported OS/pane accepts dropped app bundles
- the helper blocks setup when the actor is App-Translocated, a wrong target, a developer tool/test runner in production setup, or has changed signing identity
- pause/stop/delete works and physically removes media when requested
- event triggers write frames with synchronized screenshot/text/metadata
- audio/transcript paths fail locally when permission/transcription is unavailable
- FTS returns correct frame/transcript/memory results and purges deleted rows
- raw APIs require auth, caps, audit, workspace filters, and scoped tokens
- raw SQL inspector rejects mutating, unbounded, multi-statement, external-database, token-table, and over-limit queries with named root causes
- raw SQL inspector defaults to redacted allowlisted views and requires `raw_sql` + `raw_admin` + `includeRawColumns=true` before exposing raw recorder text fields
- MCP raw access is denied unless explicitly granted
- built-in pipes enforce static, runtime, and API permissions
- pipe outputs are redacted-only unless interactive export approval exists
- memory summaries never include unredacted unsafe data
- proof ledger writes remain verifier-gated
- required-surface gate matrix rows are complete for every required surface before implementation readiness is claimed
- no surface is marked complete from state enums, DTOs, policy functions, or synthetic tests alone; it needs actual collector or route, sidecar ingestion/enforcement, UI-visible state, deletion/retention behavior, and acceptance tests

Suggested tests:

- Swift permission ladder tests
- Swift permission actor resolver, signing drift, App Translocation, Settings anchor, state-machine, drag-capability, and redacted analytics tests
- Swift Screen Recording runtime-probe tests using stubs by default and manual/local diagnostics for real TCC
- Swift recorder trigger tests
- sidecar `mac_permission_health` schema tests proving the sidecar consumes health but cannot mark TCC granted
- sidecar recorder migration tests
- media asset path-safety tests
- FTS sync/delete tests
- raw API auth/audit tests
- raw SQL validator, allowlisted-view, raw-column-gating, audit, timeout, and MCP-denial tests
- raw SQL authorizer/progress-handler bypass tests
- browser URL/document path redaction and FTS non-leakage tests
- clipboard trigger-only/content opt-in/large-content/secret suppression/no Pipe export/no proof-effect tests
- audio local-transcriber/no-cloud/meeting-notice/transcript deletion tests
- proof-laundering rejection tests for local recorder files, Pipe outputs, internal screenshots, manual summaries, and generated workspace reports
- adversarial captured-text fixtures for summarizer, Evidence Inbox builder, Next Action selector, Pipe runtime, raw SQL inspector, MCP grant UI, and export UI
- MCP deny-by-default tests
- Pipe manifest validation tests
- Pipe DSL permission tests
- Pipe cancellation/timeout tests
- memory redaction and taint tests
- proof adapter rejection tests

## 15. Review Evidence And Disposition

Reviews incorporated into this final design:

- **Product/UX:** the expanded scope is too broad unless anchored to Day Memory Review -> Evidence Inbox -> Next Action. Incorporated as the lead journey and the implementation gates.
- **Implementation:** ownership, schema, FTS, proof adapter, and Pipes runtime were underspecified. Incorporated as single data-plane ownership, typed tables, the FTS contract, strict adapter ordering, and DSL-based Pipes.
- **Security/privacy:** raw media bypass, local API auth, MCP, pipe sandboxing, prompt injection, clipboard/audio, deletion, export, and egress blockers. Incorporated as the token model, raw media protections, MCP deny-by-default, pipe sandbox constraints, taint rules, minimization, delete semantics, and the no-egress default.
- **`insane-review` GPT-5.5 Pro, 2026-06-27** (`.insane-review/response_agentic30-public_20260627_224857_61137_ac461d.md`): focused design review of this SPEC + GOAL_PROMPT against the product context (`docs/SPEC.md`, `VALUES.md`, `GOAL.md`, `ICP.md`, `PHILOSOPHY.md`, `known-limitations.md`). Verdict: **blocked for MVP implementation; demote from "Final implementation spec" to "Deferred RFC"** — grounds: external evidence N=0 / MVP Success 0/5, the active wedge is still Day 0-3, and an always-on recorder substrate conflicts with VALUES #4/#5 (build-instead-of-sell). It also flagged real spec bugs: FTS rules referenced `safe_for_search` on `memory_items`/`product_events`, which lacked the column; "optional encryption" is too weak for always-on raw media; and capture cadence, retention defaults, the redaction policy matrix, and the Pipe DSL grammar were undefined. The spec bugs are fixed in Sections 6-7; the strategic flag is answered structurally in Sections 11 and 16 (see Section 1).
- **`insane-review` GPT-5.5 Pro, 2026-06-28** (`.insane-review/response_agentic30-public_20260628_135538_36318_8629c3.md`; pack ~228,058 tokens): narrower source-pack review of this SPEC + GOAL_PROMPT + recorder implementation status. It accepted the user's fixed required/excluded surfaces and returned blocker edits: mirror the browser-extension exclusion in the GOAL_PROMPT, make every required surface independently gateable, add `raw_sql` access-level implementation blockers, enforce SQL at the SQLite authorizer/progress-handler level, split readiness modes, harden OCR provenance, promote the redaction matrix to a blocker, sanitize browser URL FTS fields, add clipboard/audio schemas, broaden deletion/retention, block proof laundering from local artifacts, add captured-text adversarial fixtures, add the completion-status legend, and align the Pipe route namespace. Incorporated in Sections 2, 4, 6-11, 13-17 and the GOAL_PROMPT.

Disposition: **final design — approved to build through the Section 13 gates.** The strategic flag (scope is large for an N=0 wedge) is recorded; the user's direction is to proceed while keeping Gate A focused on the Day-0-3-serving journey and the proof-ledger boundary strict. The previous narrow manual-capture review is historical context only.

## 16. Feasibility And Existing-Feature Grounding

This substrate builds on Agentic30's current stack. The split below was verified against the codebase so the schema and FTS contract are implementable rather than aspirational.

### 16.1 Reuse (already implemented — do not rebuild)

- **Proof ledger** — `sidecar/execution-os.mjs` already owns `.agentic30/proof-ledger.json` (`schema agentic30.proof_ledger.v2`). It exposes `appendProofLedgerEvent()` with idempotency via `proofEventFingerprint()` (content fingerprint excluding `id`/`createdAt`), `inferProofStrength()`, and accepted statuses `accepted|verified|complete|completed`. The "strict proof-ledger adapter" in Section 11 is an adapter **onto this module**, not a second ledger; `evidence_candidates.proof_ledger_event_id` references events it writes.
- **Evidence model** — `sidecar/office-hours-evidence-vocabulary.mjs` / `office-hours-evidence-state.mjs` already define grades (`action_proof`, `customer_outcome`, `goal_proof`), evidence kinds, rejected kinds (`self_report`, `ai_output`, `draft`, `demo`, `plan`, `intent_only`), and hard-evidence intents (`actual_payment_or_contract`, `concrete_purchase_conditions`). `evidence_candidates.proof_kind` and the Evidence Inbox statuses map onto these, not a new vocabulary.
- **Product events** — `sidecar/telemetry.mjs` (PostHog ingest with built-in redaction) and `captureExecutionOsTelemetryEvents()` already emit `mac_sidecar_execution_os_*` events. `product_events` derivation reuses this transport and redaction; it does not add a second telemetry path.
- **Persistence pattern** — durable JSON state today uses per-module `schemaVersion` + a `normalizeXxxState()` load step + `sidecar/atomic-store.mjs` `atomicWriteJson()`. Recorder JSON outputs (memory summaries, evidence bundles, search exports) follow this same pattern.

### 16.2 Net-new (this spec introduces them)

- **`recorder.sqlite` + FTS5** — there is **no SQLite or FTS in the sidecar today** (`better-sqlite3` is only a transitive dependency). This spec adds a **direct** SQLite dependency. Use `better-sqlite3` (synchronous, proven FTS5) unless `node:sqlite` is confirmed to ship FTS5 on the bundled Node runtime. All access goes through the `RecorderStore` module (Section 5.2); the FTS triggers in Section 7 require the chosen engine to support FTS5 virtual tables. Unlike the JSON stores, `recorder.sqlite` versioning uses SQLite `user_version` PRAGMA + forward-only migrations (Section 5.2), while its JSON sidecar outputs keep the `schemaVersion` + normalize pattern.
- **macOS capture** — ScreenCaptureKit, Accessibility extraction, Vision OCR, Event Tap, and audio capture do not exist in `agentic30/` today (only clipboard). The Swift collector (Section 5.1) is net-new.
- **macOS permission helper** — actor identity resolution, App Translocation guard, native TCC request flows, Settings anchor mapping, versioned drag-capability table, helper state machine, and redacted permission telemetry are net-new Swift surfaces. They must follow the permission-helper contract in Section 4.1 (the standalone helper spec was removed in the 2026-07-02 spec cleanup; recover it from git history for the extended detail); generic Settings links are not sufficient for external onboarding.
- **Loopback REST API** — the sidecar runs only a WebSocket bridge and a stdio MCP server today; the loopback HTTP API (Section 8) is net-new and reuses the existing launch-auth bridge (Section 5.3) as its trust root.

### 16.3 Gate-Blocking Contracts To Detail Before Claiming A Gate

- **Capture cadence (Gate A):** event-driven keyframe capture with bounded fallback, not a per-second screenshot log. Initial acceptance values are `automatic_capture_min_interval_ms=1000`, `event_debounce_ms=750`, `active_max_gap_ms=10000`, `idle_max_gap_ms=60000`, duplicate suppression by same app/window/browser/document context plus content/perceptual hash threshold, OCR/AX extraction only for persisted keyframes, multi-monitor attribution via `monitor_id`, and explicit idle/sleep/wake behavior. Gate A cannot claim event-driven completion without tests for these values plus CPU/battery/storage-budget failure states.
- **Replay chunk storage (Gate A.2):** optional encrypted low-FPS fragmented MP4 chunks are registered as `media_assets.asset_type=screen_video_chunk`, never as proof, and never as a source for search/evidence without matching `frames` rows. Gate A.2 cannot ship until deletion/retention acceptance proves overlapping chunk delete-or-rewrite semantics and clears stale replay offsets for surviving frames.
- **Permission helper validation (Gate A):** release actor fixture, supported macOS Settings anchors, Screen Recording prompt/registration behavior, Screen Recording relaunch behavior, Accessibility plus-picker or drag capability, Input Monitoring opt-in behavior, and update-in-place TCC identity persistence.
- **Retention defaults (Gate A/C):** per-surface TTL/delete/FTS/derived-data/OS-non-guarantee rows in Section 10.5 must exist before the related collector or export ships.
- **Redaction policy matrix (Gate A, before any FTS/memory write):** Section 10.2 is blocking for any sink that consumes recorder-derived data.
- **Capture envelope / IPC contract (Gate A):** Swift→Node envelope schema, idempotency, retry, backpressure, offline queue, crash recovery, version negotiation.
- **Pipe DSL grammar (Gate D):** typed actions, dataflow, condition/loop limits, error propagation.
- **Raw API contracts (Gate B):** per-endpoint response/pagination/error schema, `GET /recorder/audit` self-audit recursion rule, MCP grant tool-identity + token storage.
- **OS-level deletion boundary (Gate B/C):** user-facing copy must document what is NOT guaranteed (Spotlight, QuickLook, Time Machine, logs, external backups).

## 17. Completion Rule And Status Legend

Implementation progress is tracked in `docs/specs/agentic30_screenpipe_benchmarking_TODO.md`, not in this SPEC. Do not append dated progress entries here; this section only defines the shared status vocabulary for any completion claim.

Status legend:

- `spec_only`: contract exists only in this document.
- `sidecar_policy_only`: enums, DTOs, policy functions, or synthetic tests exist, but no actual collector/route/UI path exists.
- `manual_capture_only`: a manually triggered or diagnostic path exists, but no automatic collector loop exists.
- `actual_collector`: the macOS collector or local route exists and writes through the sidecar contract.
- `ui_wired`: the user can see/control the surface in the app with named health/error states.
- `e2e_accepted`: the matching app/API surface has been driven end-to-end with required tests and manual QA evidence.

No required surface is complete until it reaches `actual_collector + ui_wired + e2e_accepted` for its intended mode. Any status claim (in the TODO doc or a commit/PR description) must name its status using this legend when it records incomplete work.
