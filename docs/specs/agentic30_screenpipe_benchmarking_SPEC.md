# Agentic30 Screenpipe Benchmarking SPEC

> Date: 2026-06-27 KST
> Status: **Final design spec — approved direction, grounded in existing Agentic30 features.**
> Scope of this doc: the **Founder Memory OS** substrate (always-on local recorder → search/memory → evidence → proof). Schema and FTS are specified to be implementable on the current stack; Section 16 records the feasibility grounding and the reuse-vs-net-new split.
> Product target: macOS-only execution OS for solo developers
> Operational prompt: `docs/specs/agentic30_screenpipe_benchmarking_GOAL_PROMPT.md`
> Compact session context: `docs/specs/agentic30_screenpipe_benchmarking_CONTEXT.md`
> Benchmark sources: local `../screenpipe`, DeepWiki `screenpipe/screenpipe`, and `.insane-review/`
> Companion permission spec: `docs/specs/agentic30_macos_permission_drag_helper_SPEC.md`

> **Context-budget note:** this full SPEC is canonical, but routine goal-prompt
> sessions should not read it in full. Start with the compact context file, then
> open only targeted sections or the Section 17 progress tail unless changing
> scope, architecture, schemas, privacy/proof rules, gate definitions, or making
> a final implementation-readiness claim.

## 1. Decision Summary

> **Build-order note (2026-06-27, recorded):** A GPT-5.5 Pro `insane-review` flagged that this substrate is large relative to the current Day 0-3 wedge (external evidence N=0, MVP Success 0/5 — `docs/SPEC.md`) and warned against letting recorder work stand in for customer evidence. The mitigation is kept structural, not by cutting scope: the proof-ledger boundary in Section 11 stays strict, Gate A (Section 13) ships only the Day-0-3-serving journey before any raw-API/Pipes surface, and Section 16 grounds the build on existing features so it reuses the proof spine instead of rebuilding it. Direction is **final design**, not deferred.

This is the **final design** for the Screenpipe-shaped substrate the previous draft deferred:

- always-on local background recording
- search and memory product surfaces
- raw local data access APIs
- Pi Agent / Pipes-like local automations
- expanded macOS media and permission capture

The exclusions remain:

- no new model or cloud expansion
- no Rust backend or non-macOS platform expansion
- no direct Screenpipe database import or runtime dependency

This is **Founder Memory OS**: a local, always-on, searchable, automatable work-memory layer for a solo developer. It must still serve Agentic30's execution loop: decide the next narrow action, surface proof candidates, preserve evidence debt, and keep proof-ledger standards strict.

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

macOS permission acquisition is handled by the native helper defined in `docs/specs/agentic30_macos_permission_drag_helper_SPEC.md`. The helper is part of the recorder permission ladder, not a TCC bypass: it resolves the actual protected-API actor, requests native macOS permission APIs from that actor where possible, opens System Settings with manual fallback instructions, uses drag guidance only for OS/pane combinations proven by validation, and marks success only after the correct actor passes preflight or runtime probe checks.

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

Reviews completed for this expanded-scope draft:

- Product/UX review: found the expanded scope too broad unless anchored to Day Memory Review -> Evidence Inbox -> Next Action. Incorporated as the lead journey and implementation gates.
- Implementation review: found ownership, schema, FTS, proof adapter, and Pipes runtime underspecified. Incorporated single data-plane ownership, typed tables, FTS contract, strict adapter ordering, and DSL-based Pipes.
- Security/privacy review: found raw media bypass, local API auth, MCP, pipe sandboxing, prompt injection, clipboard/audio, deletion, export, and egress blockers. Incorporated token model, raw media protections, MCP deny-by-default, pipe sandbox constraints, taint rules, minimization, delete semantics, and no-egress default.
- `insane-review` GPT-5.5 Pro (2026-06-27, recovered): a focused design review of this SPEC + GOAL_PROMPT against the product context (`docs/SPEC.md`, `VALUES.md`, `GOAL.md`, `ICP.md`, `PHILOSOPHY.md`, `known-limitations.md`) returned in full (response: `.insane-review/response_agentic30-public_20260627_224857_61137_ac461d.md`). **Verdict: blocked for MVP implementation; demote from "Final implementation spec" to "Deferred RFC."** Grounds: external evidence N=0 / MVP Success 0/5, the active wedge is still Day 0-3, and an always-on recorder substrate conflicts with VALUES #4/#5 — i.e. build-instead-of-sell. It also flagged real spec bugs: FTS rules reference `safe_for_search` on `memory_items`/`product_events`, which lacked the column; "optional encryption" is too weak for always-on raw media; and capture cadence, retention defaults, the redaction policy matrix, and the Pipe DSL grammar are undefined. Schema/FTS and raw-media fixes are incorporated below (Sections 6–7); the proof-ledger boundary and existing-feature grounding are addressed in Sections 11 and 16.
- `insane-review` GPT-5.5 Pro (2026-06-28, recovered): a narrower source-pack review of this SPEC + GOAL_PROMPT + recorder implementation status succeeded (response: `.insane-review/response_agentic30-public_20260628_135538_36318_8629c3.md`; pack ~228,058 tokens). It accepted the user's fixed required/excluded surfaces and returned blocker edits: mirror browser-extension exclusion in GOAL_PROMPT, make every required surface independently gateable, add `raw_sql` access-level implementation blockers, enforce SQL at SQLite authorizer/progress-handler level, split readiness modes, harden OCR provenance, promote redaction matrix to a blocker, sanitize browser URL FTS fields, add clipboard/audio schemas, broaden deletion/retention, block proof laundering from local artifacts, add captured-text adversarial fixtures, add completion-status legend, and align Pipe route namespace. Incorporated in Sections 2, 4, 6-11, 13-17 and GOAL_PROMPT.

Disposition: **final design — approved to build through the Section 13 gates.** The strategic flag (scope is large for an N=0 wedge) is recorded, and the user's direction is to proceed as the final design while keeping Gate A focused on the Day-0-3-serving journey and the proof-ledger boundary strict. The previous narrow manual-capture review is historical context only.

## 16. Feasibility And Existing-Feature Grounding

This substrate builds on Agentic30's current stack. The split below was verified against the codebase so the schema and FTS contract are implementable rather than aspirational.

### 16.1 Reuse (already implemented — do not rebuild)

- **Proof ledger** — `sidecar/execution-os.mjs` already owns `.agentic30/proof-ledger.json` (`schema agentic30.proof_ledger.v2`). It exposes `appendProofLedgerEvent()` with idempotency via `proofEventFingerprint()` (content fingerprint excluding `id`/`createdAt`), `inferProofStrength()`, and accepted statuses `accepted|verified|complete|completed`. The "strict proof-ledger adapter" in Section 11 is an adapter **onto this module**, not a second ledger; `evidence_candidates.proof_ledger_event_id` references events it writes.
- **Evidence model** — `sidecar/office-hours-contract.mjs` / `office-hours-evidence-state.mjs` already define grades (`action_proof`, `customer_outcome`, `goal_proof`), evidence kinds, rejected kinds (`self_report`, `ai_output`, `draft`, `demo`, `plan`, `intent_only`), and hard-evidence intents (`actual_payment_or_contract`, `concrete_purchase_conditions`). `evidence_candidates.proof_kind` and the Evidence Inbox statuses map onto these, not a new vocabulary.
- **Product events** — `sidecar/telemetry.mjs` (PostHog ingest with built-in redaction) and `captureExecutionOsTelemetryEvents()` already emit `mac_sidecar_execution_os_*` events. `product_events` derivation reuses this transport and redaction; it does not add a second telemetry path.
- **Persistence pattern** — durable JSON state today uses per-module `schemaVersion` + a `normalizeXxxState()` load step + `sidecar/atomic-store.mjs` `atomicWriteJson()`. Recorder JSON outputs (memory summaries, evidence bundles, search exports) follow this same pattern.

### 16.2 Net-new (this spec introduces them)

- **`recorder.sqlite` + FTS5** — there is **no SQLite or FTS in the sidecar today** (`better-sqlite3` is only a transitive dependency). This spec adds a **direct** SQLite dependency. Use `better-sqlite3` (synchronous, proven FTS5) unless `node:sqlite` is confirmed to ship FTS5 on the bundled Node runtime. All access goes through the `RecorderStore` module (Section 5.2); the FTS triggers in Section 7 require the chosen engine to support FTS5 virtual tables. Unlike the JSON stores, `recorder.sqlite` versioning uses SQLite `user_version` PRAGMA + forward-only migrations (Section 5.2), while its JSON sidecar outputs keep the `schemaVersion` + normalize pattern.
- **macOS capture** — ScreenCaptureKit, Accessibility extraction, Vision OCR, Event Tap, and audio capture do not exist in `agentic30/` today (only clipboard). The Swift collector (Section 5.1) is net-new.
- **macOS permission helper** — actor identity resolution, App Translocation guard, native TCC request flows, Settings anchor mapping, versioned drag-capability table, helper state machine, and redacted permission telemetry are net-new Swift surfaces. They must follow `docs/specs/agentic30_macos_permission_drag_helper_SPEC.md`; generic Settings links are not sufficient for external onboarding.
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

## 17. Implementation Progress

Progress is recorded here as implementation lands, so this SPEC remains the source of truth for the long-run build.

Status legend:

- `spec_only`: contract exists only in this document.
- `sidecar_policy_only`: enums, DTOs, policy functions, or synthetic tests exist, but no actual collector/route/UI path exists.
- `manual_capture_only`: a manually triggered or diagnostic path exists, but no automatic collector loop exists.
- `actual_collector`: the macOS collector or local route exists and writes through the sidecar contract.
- `ui_wired`: the user can see/control the surface in the app with named health/error states.
- `e2e_accepted`: the matching app/API surface has been driven end-to-end with required tests and manual QA evidence.

No required surface is complete until it reaches `actual_collector + ui_wired + e2e_accepted` for its intended mode. A slice note must name its status using this legend when it records incomplete work.

### 2026-06-27 KST — Gate A strict proof adapter slice

- Added `sidecar/recorder-proof-ledger-adapter.mjs` as the first Gate A implementation slice.
- The adapter writes recorder evidence candidates only through the existing `appendProofLedgerEvent()` proof ledger path.
- It rejects non-`approved_bundle` candidates, unsafe `source_state`, missing `source_ids_json`, missing `immutable_fingerprint`, duplicate `idempotency_key`, unknown proof event type/status/strength, non-complete proof event statuses, rejected Office Hours evidence kinds, and non-proof-only sources for customer/active-user/revenue gates.
- It exposes a verifier-rejection patch helper so future `evidence_candidates` persistence can record `verifier_rejected` with the exact root-cause code/message.
- Added focused node tests in `sidecar-tests/recorder-proof-ledger-adapter.test.mjs`.
- This slice does not implement recorder SQLite, capture, FTS, raw APIs, or Pipes yet; those remain gated behind the Day Memory Review -> Evidence Inbox -> proof-ledger journey.

### 2026-06-27 KST — Gate A recorder store + FTS foundation slice

- Added `better-sqlite3` as a direct dependency and verified the installed SQLite runtime supports FTS5.
- Added `sidecar/recorder-store.mjs` as the repository-owned SQLite access layer for `recorder.sqlite`; this is now the intended location for recorder DDL/DML instead of ad hoc SQL in sidecar callers.
- The v1 migration created the then-current 11 recorder tables, set SQLite `user_version`, created Section 7 FTS5 tables, and installed triggers for frames, transcript segments, memory items, and product events. After the 2026-06-28 GPT-5.5 review, Section 6 now requires a 12th `clipboard_events` table, so this slice is stale until a follow-up migration adds it and updates table-inventory tests.
- Search indexes only redacted `safe_for_search=1` rows and removes rows from FTS when `deleted_at` is set or `safe_for_search` is cleared.
- Added focused tests in `sidecar-tests/recorder-store.test.mjs` covering direct dependency presence, migration/user_version, base table inventory, FTS table inventory, redacted frame search, raw-text non-indexing, transcript FTS purge, memory FTS update, and product-event FTS update.
- This slice still does not implement Swift capture, permission UI, raw API tokens/endpoints, audit UI, media encryption/key management, Day Memory Review rendering, Evidence Inbox rendering, or Pipes execution.

### 2026-06-27 KST — Gate A Evidence Inbox write-through slice

- Added `sidecar/recorder-evidence-candidates.mjs` as the first persistence-backed Evidence Inbox write-through surface.
- Approved recorder evidence candidates stored in `RecorderStore` can now transition from `approved_bundle` to `written_to_ledger` only by calling the strict proof-ledger adapter.
- Adapter root-cause failures update the candidate row to `verifier_rejected` with the exact verifier result and do not append proof-ledger events.
- The write-through path persists `proof_ledger_event_id`, `reviewed_at`, and `verifier_result_json` on the `evidence_candidates` row after review.
- Added focused tests in `sidecar-tests/recorder-evidence-candidates.test.mjs` covering successful ledger write-through and unsafe-source verifier rejection.
- This slice still does not implement the Evidence Inbox UI, candidate generation, Swift capture, raw API review endpoints, or Day Memory Review rendering.

### 2026-06-27 KST — Gate A capture envelope ingest slice

- Added `sidecar/recorder-ingest.mjs` as the first Swift-to-Node capture-envelope normalization and write path.
- Frame ingest writes `media_assets` and `frames` through `RecorderStore.withTransaction()`; caller modules still do not issue ad hoc SQL.
- The ingest path rejects missing redacted text when `safe_for_search=1`, rejects search indexing for non-search-safe redaction statuses, and rejects absolute or path-traversing media paths before persistence.
- FTS remains redacted-only: raw accessibility/OCR text can be stored locally on the frame row, but only `redacted_text` enters search.
- Added focused tests in `sidecar-tests/recorder-ingest.test.mjs` covering redacted FTS writes, raw text non-indexing, redaction failure, media path safety, and duplicate ID root-cause failures.

### 2026-06-27 KST — Gate A physical frame deletion slice

- Added `sidecar/recorder-delete.mjs` as the first user-requested physical deletion path for captured frames.
- Frame deletion resolves snapshot media strictly under the recorder root, rejects absolute/path-traversing persisted paths, and fails explicitly when the physical frame file is missing.
- Successful deletion soft-deletes the `frames` and `media_assets` rows, clears frame search/memory/export flags, and removes the frame media file from disk.
- The existing FTS trigger path now has an end-to-end physical-delete test proving deleted frames disappear from redacted search.
- Added focused tests in `sidecar-tests/recorder-delete.test.mjs` covering physical removal, FTS purge, missing-media root-cause failure, and unsafe persisted media-path rejection.
- This slice still does not implement Swift UI delete controls, whole-day deletion, pause/stop session state, retention cleanup, encrypted media keys, or OS-level backup deletion boundaries.

### 2026-06-27 KST — Gate A Day Memory Review DTO slice

- Added `sidecar/recorder-day-memory-review.mjs` as the first read-only Day Memory Review builder over `RecorderStore`.
- The review summarizes capture counts, deleted-frame counts, search/memory-safe frame counts, top apps/domains/triggers, memory items, product events, Evidence Inbox status counts, empty states, warnings, and proof-boundary copy for an explicit time range.
- Frame samples include only `redacted_text` from memory-safe rows with search-safe redaction status; raw accessibility text and OCR text are never copied into the review DTO.
- The review keeps proof semantics explicit: it can report `written_to_ledger` candidates, but `proofAcceptedByReview` remains false because the review itself is not proof.
- Added focused tests in `sidecar-tests/recorder-day-memory-review.test.mjs` covering populated review summaries, raw text non-leakage, no-capture empty states, no-accepted-proof warning, and explicit time-range validation.
- This slice still does not implement the Swift Day Memory Review UI, provider summarization, Office Hours consumption of the DTO, or persisted memory-summary export files.

### 2026-06-27 KST — Gate A recorder control state slice

- Added `sidecar/recorder-control-state.mjs` as the host-local recorder consent, permission, pause, resume, and stop-for-today state authority.
- The control state persists under the recorder Application Support directory as `recorder-control-state.json` using `withFileLock()` and `atomicWriteJson()`, separate from workspace `.agentic30` proof/memory state.
- Capture readiness now requires Core Memory consent, visible recording indicator acknowledgement, Screen Recording permission, Accessibility permission, and active recorder mode.
- Input Monitoring, Vision OCR, and browser metadata produce explicit degraded warnings instead of being treated as silent fallback.
- `recordFrameCaptureEnvelope()` now rejects writes with `ERR_RECORDER_INGEST_CAPTURE_NOT_READY` when a supplied control state is paused, stopped, missing consent, missing visible indicator acknowledgement, or missing core permissions.
- Added focused tests in `sidecar-tests/recorder-control-state.test.mjs` covering consent/indicator gating, core permission gating, pause/resume/stop-for-today transitions, corrupt state failure, persisted host-local path, and ingest blocking while paused.
- This slice still does not implement Swift permission UI, menu-bar indicator rendering, OS-level TCC checks, automatic capture scheduling, or whole-day deletion.

### 2026-06-27 KST — Gate A whole-range frame deletion slice

- Extended `sidecar/recorder-delete.mjs` with `deleteRecorderFrameCapturesInRange()` for day/range-scoped frame deletion.
- The range delete path resolves every candidate frame's media asset and stats every physical media file before mutating any recorder rows, so a missing file fails with root cause before partial soft deletion.
- Successful range deletion soft-deletes every in-scope frame/media row, clears search/memory/export flags, removes every physical frame file, and leaves out-of-range frames intact.
- Added focused tests in `sidecar-tests/recorder-delete.test.mjs` covering scoped in-range deletion, out-of-range preservation, redacted FTS purge, and fail-before-mutation behavior when one in-range file is missing.
- This slice still does not implement Swift "delete today" controls, retention scheduling, media-key destruction, or OS backup/Spotlight/QuickLook deletion boundaries.

### 2026-06-28 KST — Gate A retention policy slice

- Added `sidecar/recorder-retention.mjs` as the first raw-frame retention planning and cleanup layer.
- The default policy keeps raw frame media for 24 hours and produces a dry-run retention plan before cleanup.
- Retention cleanup delegates physical removal to `deleteRecorderFrameCapturesInRange()` so the same path-safety, physical-file preflight, row soft-delete, and FTS purge invariants apply.
- Cleanup preserves recent and out-of-scope frames, and fails before mutating rows when any expired frame media file is missing.
- Added focused tests in `sidecar-tests/recorder-retention.test.mjs` covering scoped expired-frame planning, physical cleanup, recent-frame preservation, fail-before-mutation behavior, and invalid-policy rejection.
- This slice still does not implement a scheduler, low-disk trigger, user-configurable retention UI, memory-summary retention, encrypted media-key destruction, or OS backup/Spotlight/QuickLook deletion boundaries.

### 2026-06-28 KST — Gate A Day Memory Review snapshot slice

- Extended `sidecar/recorder-day-memory-review.mjs` with persisted redacted Day Memory Review snapshots under `.agentic30/recorder/memory-summaries/`.
- Snapshot writes use the existing JSON durability pattern: `withFileLock()` plus `atomicWriteJson()`.
- Snapshot normalization rejects unsafe raw frame/OCR/accessibility/browser URL fields and forces `proofAcceptedByReview=false`, preserving the rule that memory summaries are not proof.
- Snapshot files include redacted capture samples, memory items, product-event summaries, Evidence Inbox counts, warnings, and proof-boundary metadata for the explicit review range.
- Added focused tests in `sidecar-tests/recorder-day-memory-review.test.mjs` covering persisted path, redacted snapshot content, raw text non-leakage, proof-boundary preservation, and raw-field rejection.
- This slice still does not implement the Swift Day Memory Review UI, Office Hours consumption, provider summarization, scheduled summary jobs, export approval UI, or memory-summary retention cleanup.

### 2026-06-28 KST — Gate A redacted recorder search surface slice

- Added `sidecar/recorder-search.mjs` as a product-facing redacted search DTO layer over `RecorderStore.search()`.
- The search surface validates query, source types, limit, workspace/project scope, and optional time range before returning results.
- Search results are whitelisted DTOs only: frame results may include app/window/domain metadata, but not raw browser URLs, document paths, media paths, raw accessibility text, raw OCR text, or raw transcript text.
- The response keeps proof semantics explicit with `proofAcceptedBySearch=false`; recorder search is memory context and evidence input, not proof-ledger progress.
- Added focused tests in `sidecar-tests/recorder-search.test.mjs` covering scoped redacted search, raw URL/path/text non-leakage, source/time filter validation, missing-query failure, and empty scoped results.
- This slice still does not implement Swift search UI, timeline rendering, local API endpoints, raw API audit, or MCP grants.

### 2026-06-28 KST — Gate A Evidence Inbox candidate-builder slice

- Added `sidecar/recorder-evidence-inbox-builder.mjs` to create deterministic Evidence Inbox candidates from safe `product_events`.
- The builder scopes by workspace/project/time range, ignores unsupported/internal event types, requires `safe_for_memory=1`, fails explicitly when safe-for-memory event text appears to contain unredacted sensitive data, and marks source product events as `candidate_created`.
- Generated candidates stay `pending_review` or `degraded`; the builder never writes to the proof ledger and returns `proofAcceptedByBuilder=false`.
- Candidate source IDs are normalized into non-proof source kinds (`product_event`, `raw_frame`, `memory_summary`, `transcript_hit`, `raw_search_hit`, or `internal_trace`) so protected customer/active-user/revenue gates still require external accepted evidence before ledger writes.
- Added focused tests in `sidecar-tests/recorder-evidence-inbox-builder.test.mjs` covering candidate creation, degraded source-less events, unsupported/out-of-scope skips, deterministic duplicate avoidance, unsafe text failure, and strict adapter rejection when a local-only candidate is force-approved.
- This slice still does not implement Evidence Inbox Swift UI, human approve/reject controls, Office Hours next-action consumption, local API review endpoints, or external artifact attachment.

### 2026-06-28 KST — Gate A recorder next-action selector slice

- Added `sidecar/recorder-next-action.mjs` as a deterministic one-next-action selector for the Day Memory Review -> Evidence Inbox -> next-action loop.
- The selector consumes a Day Memory Review plus optional freshly built Evidence Inbox candidates and prioritizes recorder-health blockers, degraded proof debt, verifier-rejected proof debt, pending candidate review, missing product signal, and then one named external customer action.
- Next-action output rejects unsafe raw fields, includes only whitelisted candidate/action metadata, and keeps `proofAcceptedByNextAction=false`; selected actions are planning decisions, not proof-ledger progress.
- Added focused tests in `sidecar-tests/recorder-next-action.test.mjs` covering degraded-candidate priority, freshly built candidate priority, no-capture root-cause action, no-product-signal narrowing action, no-accepted-proof external action, and raw-field rejection.
- This slice still does not wire the selector into Office Hours runtime, Swift UI, notification scheduling, or human Evidence Inbox approval controls.

### 2026-06-28 KST — Gate A Day Memory loop orchestration slice

- Added `sidecar/recorder-day-loop.mjs` to run the Day Memory Review -> Evidence Inbox candidate build -> final Day Memory Review -> one next action sequence as one sidecar-owned loop.
- The loop can persist the final redacted Day Memory Review snapshot when `workspaceRoot` and `persistReviewSnapshot=true` are supplied; otherwise it returns an explicit non-persisted snapshot state.
- The loop returns stage counts before and after Evidence Inbox candidate generation, the final review, the candidate build result, the selected next action, and `proofAcceptedByDayLoop=false`; it never writes proof-ledger events.
- The loop tests exposed and fixed a scope bug in `sidecar/recorder-evidence-inbox-builder.mjs`: generated candidates now preserve `workspace_id` and `project_id`, so scoped final reviews can see the candidates they just created.
- Added focused tests in `sidecar-tests/recorder-day-loop.test.mjs` covering full loop orchestration, snapshot persistence, raw text non-leakage in persisted review JSON, no proof-ledger writes, no-capture root-cause action, invalid range failure, and missing snapshot workspace failure.
- This slice still does not wire the loop into Office Hours runtime, Swift UI, scheduling/notifications, human Evidence Inbox review controls, or Gate B raw API endpoints.

### 2026-06-28 KST — Gate A Evidence Inbox review-control slice

- Added `sidecar/recorder-evidence-review.mjs` as the human review control for Evidence Inbox candidates.
- `approve_bundle` now requires an explicit external artifact with accepted/verified status and a reviewable evidence kind; the review step updates the candidate to `approved_bundle`, appends the external source, clears evidence debt, and prepares the existing proof-ledger mapping for the strict adapter.
- `rejected` now requires a root-cause reason and updates the candidate to `rejected` with structured verifier-result metadata; rejected candidates still cannot write proof.
- The review control itself keeps `proofAcceptedByReview=false`; proof changes still happen only through `writeEvidenceCandidateThroughProofLedger()` and the strict proof adapter after approval.
- Added focused tests in `sidecar-tests/recorder-evidence-review.test.mjs` covering approval with external artifact followed by strict-adapter proof write, rejection with root cause and no proof write, rejected-kind failure, missing artifact location failure, and missing rejection reason failure.
- This slice still does not implement the Swift Evidence Inbox UI, local API review endpoints, attachment upload/export flows, or Office Hours runtime wiring.

### 2026-06-28 KST — Gate B raw API token/audit foundation slice

- Added `sidecar/recorder-raw-api-auth.mjs` as the sidecar-owned token, authorization, audit, and MCP raw-access policy layer for future loopback recorder endpoints.
- Token issuance stores only `sha256:` hashes in `api_tokens`, returns the raw token only at issuance, updates `last_used_at` on validation, supports revocation, fails expired/revoked/unknown tokens closed, caps raw-scope TTLs, and requires explicit local confirmation for `raw_admin`.
- Raw read authorization now requires token, trusted loopback/app origin, endpoint, request id, access level, and audit context; accepted and denied attempts write `recorder_audit` rows with sanitized source ids and named denial reasons.
- MCP recorder policy is deny-by-default for raw frame/audio/export/admin access while allowing only redacted summary/search by default; time-limited scoped grants can allow a specific raw level for a specific tool.
- Added focused tests in `sidecar-tests/recorder-raw-api-auth.test.mjs` covering hashed-token storage, validation `last_used_at`, raw TTL failure, missing `raw_admin` confirmation failure, accepted audit rows, denied audit rows for permission/origin failures, revocation/expiry rejection, and MCP raw-access denial/grant behavior.
- This slice still does not expose the HTTP loopback API server, per-endpoint response DTOs, audit UI, raw media response handling, token issuance through the Swift launch/auth bridge, or persisted MCP grant UI.

### 2026-06-28 KST — Gate B loopback raw API route slice

- Added `sidecar/recorder-raw-api-server.mjs` as a Node loopback-only raw API route/server layer over `RecorderStore`, `buildRecorderSearchResults()`, `authorizeRecorderRawRead()`, and the existing frame media path canonicalizer.
- Implemented initial HTTP `GET` routes for `/recorder/health`, `/recorder/search`, `/recorder/frames`, `/recorder/frames/:id`, `/recorder/frames/:id/text`, `/recorder/frames/:id/image`, and `/recorder/audit`.
- The route layer requires bearer/raw API token auth, trusted app/loopback origin, request id, endpoint access level, and audit context for every implemented read; accepted and denied reads write `recorder_audit`.
- Redacted routes omit raw browser URLs, document paths, raw captured text, token hashes, and filesystem paths; raw frame text/image routes require `raw_frame`; audit-log reads require `raw_admin`; debug media paths are exposed only when a `raw_admin` caller explicitly asks for them.
- Raw API responses carry `proofAcceptedByRawApi=false`; local raw API reads are access/audit events, not proof-ledger progress.
- Added HTTP-level tests in `sidecar-tests/recorder-raw-api-server.test.mjs` covering loopback bind refusal, health/search/frame metadata DTOs, redaction/no-path guarantees, raw frame image bytes, raw text gating, permission-denied audit rows, and `/recorder/audit` self-auditing behind `raw_admin`.
- This slice still does not wire the raw API server into `sidecar/index.mjs` startup, issue route tokens through the Swift launch/auth bridge, implement audio/transcript/memory/export/Pipes endpoint families, add audit UI, or persist MCP grant UI.

### 2026-06-28 KST — Gate B memory/audio/transcript endpoint slice

- Extended `sidecar/recorder-raw-api-server.mjs` with `GET /recorder/memory`, `GET /recorder/audio`, `GET /recorder/audio/:id`, and `GET /recorder/transcripts`.
- Memory responses require `summary` access and return only `safe_for_memory=1` memory summaries, source ids, redaction/privacy flags, and time ranges; unsafe memory rows are filtered out.
- Audio and transcript responses require `audio` access and return metadata/redacted transcript DTOs only; audio media relative paths, raw audio bytes, raw transcript text, and filesystem paths are not exposed in this slice.
- Added HTTP-level tests covering memory filtering, audio metadata, audio-by-id metadata, redacted transcript DTOs, raw transcript non-leakage, media path non-leakage, and permission denial when a summary/search token requests transcript access.
- Raw API responses still carry `proofAcceptedByRawApi=false`; memory/audio/transcript reads remain local context, not proof-ledger progress.
- This slice still does not implement raw audio bytes behind `raw_audio`, export manifests, Pipes endpoints, Swift launch/auth token issuance, sidecar startup wiring, audit UI, or MCP grant persistence.

### 2026-06-28 KST — Gate B export manifest endpoint slice

- Extended `sidecar/recorder-raw-api-server.mjs` with `POST /recorder/export` as a manifest-only export route requiring the explicit `export` access level, trusted origin, request id, and raw API audit context.
- Export requests must provide an explicit JSON body with supported data classes; this slice supports only `frames`, `memory`, and `product_events`, while audio/transcript/raw-media export requests fail closed with `ERR_RECORDER_RAW_API_EXPORT_UNSUPPORTED_DATA_CLASS`.
- Export manifests include only `safe_for_export=1` rows scoped by workspace/project/time range and omit raw browser URLs, document paths, raw captured text, raw OCR/accessibility text, media relative paths, filesystem paths, token hashes, and archive bytes.
- Manifest responses carry both `proofAcceptedByRawApi=false` and `proofAcceptedByExport=false`; export manifests are local data access artifacts, not accepted proof.
- Added HTTP-level tests covering `GET` method rejection, denied search-scope export attempts, unsupported audio export failure, safe export row filtering, redacted manifest contents across frame/memory/product event rows, and accepted/denied `/recorder/export` audit rows.
- This slice still does not implement archive file writing, raw audio bytes behind `raw_audio`, transcript export eligibility, Swift launch/auth token issuance, sidecar startup wiring, audit UI, MCP grant persistence, or Pipes endpoints.

### 2026-06-28 KST — Gate B raw audio media endpoint slice

- Extended `sidecar/recorder-raw-api-server.mjs` with `GET /recorder/audio/:id/media` behind the explicit `raw_audio` access level.
- Raw audio reads require bearer/raw API token auth, trusted origin, request id, source id, and audit context; both accepted and denied attempts write `/recorder/audio/:id/media` audit rows.
- Audio media path resolution now validates `media/audio/` relative paths under the recorder root before reading bytes and fails closed for missing, absolute, escaping, wrong-prefix, or wrong-type media assets.
- Raw audio responses stream bytes with no filesystem path headers and still remain local raw API access, not proof-ledger progress.
- Added HTTP-level tests proving `audio` metadata scope cannot read raw audio bytes, `raw_audio` can read the local m4a bytes, headers do not expose paths, and accepted/denied raw-audio reads are audited.
- This slice still does not implement transcript export eligibility, archive file writing, Swift launch/auth token issuance, sidecar startup wiring, audit UI, MCP grant persistence, or Pipes endpoints.

### 2026-06-28 KST — Gate B sidecar startup and token bridge slice

- Wired the recorder store and loopback raw API server into `sidecar/index.mjs` startup using the existing sidecar app-support root; recorder SQLite migration/open failure now fails sidecar bootstrap with a named root cause instead of leaving an inert route layer.
- Added raw API metadata to the stdout `sidecar-ready` record and authenticated WebSocket `ready` payload so the Swift bridge can discover the loopback raw API URL without exposing a raw API token.
- Added authenticated WebSocket commands for raw API status and scoped token issuance; token issuance uses the existing sidecar auth channel as the trust root, stores only hashed tokens, respects raw-scope TTL caps, and still requires explicit `raw_admin` confirmation.
- Added graceful raw API server/store shutdown on sidecar exit.
- Added `sidecar-tests/recorder-raw-api-runtime.test.mjs` covering sidecar boot, raw API URL discovery, authenticated WebSocket token issuance, a real loopback `/recorder/health` read using the issued token, no token hash leakage, and `raw_admin` issuance denial without confirmation.
- This slice still does not implement Swift UI consumption of raw API metadata, audit UI/source rendering, MCP grant persistence, transcript export eligibility, archive file writing, or Pipes endpoints.

### 2026-06-28 KST — Gate B MCP raw-access grant persistence slice

- Added `sidecar/recorder-mcp-grants.mjs` as the sidecar-owned durable grant store for MCP raw recorder access.
- Grants persist under app support as metadata only: tool name, raw access levels, grant/revoke timestamps, expiry, reason, and local issuer; raw API tokens, token hashes, filesystem paths, and captured data are never stored in the grant file.
- MCP grants are raw-access-only, per-tool, time-limited, capped at 15 minutes, revocable, and fail closed for unsupported scopes, missing tool names, overlong TTLs, expired grants, revoked grants, mismatched tools, and `raw_admin` grants without explicit confirmation.
- Wired authenticated WebSocket commands for grant list, create, revoke, and access-check; the access check reuses `assertRecorderMcpAccess()` so the existing deny-by-default policy remains the enforcement point.
- Extended `sidecar-tests/recorder-raw-api-runtime.test.mjs` and added `sidecar-tests/recorder-mcp-grants.test.mjs` covering persisted grant creation, active lookup, wrong-tool denial, expiry denial, revoke denial, raw-admin confirmation failure, no token leakage, and runtime create/list/check/revoke behavior.
- This slice still does not implement Swift UI for granting/revoking raw MCP access, audit UI/source rendering, transcript export eligibility, archive file writing, or Pipes endpoints.

### 2026-06-28 KST — Gate B recorder audit source slice

- Added `sidecar/recorder-audit-source.mjs` as the sidecar-owned sanitized audit DTO layer for app/UI consumption of `recorder_audit` rows.
- The audit source supports workspace/project/endpoint/access-level/decision filters, caps result limits, rejects invalid filters with named root causes, and fails closed rather than exposing unsafe filesystem-looking source ids.
- Audit source responses include only whitelisted audit metadata and explicit proof-boundary flags: `proofAcceptedByAuditSource=false`, `proofAcceptedByRawApi=false`, and `proofLedgerWriteAllowed=false`.
- Wired authenticated WebSocket `recorder_audit_list` to emit `recorder_audit_events` without minting or exposing a raw-admin raw API token.
- Added `sidecar-tests/recorder-audit-source.test.mjs` and extended `sidecar-tests/recorder-raw-api-runtime.test.mjs` to cover sanitized rows, filter validation, non-proof semantics, token/hash/header non-leakage, and a live sidecar audit event after an actual `/recorder/health` raw API read.
- This slice still does not implement Swift audit UI rendering, transcript export eligibility, archive file writing, or Pipes endpoints.

### 2026-06-28 KST — Gate B transcript export eligibility slice

- Extended the raw API export manifest data classes with `transcripts` / `transcript_segments` normalization while keeping raw audio and archive bytes unsupported.
- Transcript export entries are manifest-only and require local completed transcript state, `safe_for_search=1`, `safe_for_memory=1`, `redaction_status=redacted`, and an export-safe privacy state; raw transcript text is never emitted.
- Transcript export DTOs include only whitelisted segment metadata, speaker label, timing, redacted text, privacy/redaction flags, and local transcript status; they omit audio media paths, raw audio bytes, raw text, token hashes, and filesystem paths.
- Extended `sidecar-tests/recorder-raw-api-server.test.mjs` to cover transcript manifest inclusion plus exclusion of raw/redaction-unsafe segments and locally unavailable transcripts.
- Export manifests remain local data access only: `proofAcceptedByExport=false` and `proofAcceptedByRawApi=false`.
- This slice still does not implement archive file writing, Swift export UI, or Pipes endpoints.

### 2026-06-28 KST — Gate B local export archive writer slice

- Extended the raw API with `POST /recorder/export/archive` as a user-triggered local archive writer over the existing export manifest builder.
- Archive writing requires the `export` access level, trusted origin, request id, normal raw API audit context, and explicit `approvedByLocalUser=true`; missing local approval fails closed with a named root cause.
- Archive files are written atomically under the host-local recorder `exports/` directory and contain only the redacted export manifest JSON; raw media bytes, raw transcript text, raw captured text, token hashes, and filesystem paths are not emitted.
- API responses return archive metadata only: archive id, manifest id, item count, data classes, byte size, SHA-256, local-only flag, and `pathExposed=false`.
- Extended `sidecar-tests/recorder-raw-api-server.test.mjs` to cover missing confirmation, denied scope, successful archive write, written JSON contents, audit rows, path non-exposure, and proof-boundary flags.
- Export archives remain local data access only: `proofAcceptedByArchive=false`, `proofAcceptedByExport=false`, and `proofAcceptedByRawApi=false`.
- This slice still does not implement Swift export UI or Pipes endpoints.

### 2026-06-28 KST — Gate C expanded media policy slice

- Extended `sidecar/recorder-control-state.mjs` with explicit expanded-media policy evaluation for clipboard, microphone, system audio, browser metadata, and document metadata.
- Clipboard defaults to `trigger_only`; raw clipboard contents require the explicit `content_opt_in` policy and Clipboard permission before `canCaptureContents=true`.
- Microphone and System Audio remain disabled by policy until explicitly enabled; if enabled without permission they emit named degraded states instead of silently falling back.
- Browser and document metadata now have explicit degraded states, so capture can continue with less context while naming the missing optional surface.
- `evaluateRecorderCaptureReadiness()` now includes `expandedMedia` / `expanded_media` policy details and keeps Core Memory blockers separate from optional Gate C degradation.
- Added `set_sensitive_capture` control action plus focused tests covering default trigger-only clipboard, opt-in clipboard contents, audio permission gating, metadata degradation, non-proof policy flags, and continued capture readiness once core permissions are satisfied.
- This slice still does not implement Swift permission UI/TCC probes, actual clipboard/audio collectors, local transcription execution, or Pipes endpoints.

### 2026-06-28 KST — Gate D built-in Pipe manifest foundation slice

- Added `sidecar/recorder-pipes.mjs` with the three required built-in Pipe definitions: `daily-founder-memory`, `evidence-inbox-builder`, and `stale-debt-resurfacer`.
- Pipe manifest validation enforces `kind=built_in`, workspace-scoped pipe paths, execution-scoped `files_under`, allowed DSL actions only, non-raw read permissions by default, non-raw recorder endpoints, timeout/concurrency/retention bounds, and explicit non-proof flags.
- Blocked DSL actions such as shell, network, browser automation, outreach, public posting, deploy, payment mutation, raw file read, and raw media read fail with named root causes.
- Sidecar bootstrap now persists the built-in Pipe definitions into `recorder.sqlite` `pipe_definitions` idempotently, without raw API tokens, token hashes, media root paths, or captured data.
- Added `sidecar-tests/recorder-pipes.test.mjs` and extended runtime coverage to verify required built-ins, persistence, write-scope enforcement, raw endpoint denial, action denial, and boot-time `pipe_definitions` rows.
- This slice still does not implement the Pipe DSL interpreter, scheduler, run lifecycle, cancellation/timeout execution, output manifests, Swift Pipe UI, or endpoint middleware integration.

### 2026-06-28 KST — Gate D built-in Pipe run lifecycle slice

- Extended `sidecar/recorder-pipes.mjs` with `runBuiltInRecorderPipe()` for the three built-ins, using existing recorder helpers instead of introducing arbitrary execution.
- Pipe runs now persist `pipe_runs` lifecycle rows with input manifests, audit logs, succeeded/failed status, ended timestamps, error messages, and redacted output manifests.
- `daily-founder-memory` builds a Day Memory Review and can persist the existing redacted review snapshot when a workspace root is supplied; `evidence-inbox-builder` creates unverified candidates through the existing builder; `stale-debt-resurfacer` emits a next-action input through the existing next-action selector.
- Execution enforces each Pipe's declared actions, endpoints, and write permissions before running; raw endpoints and raw filesystem/media/token access remain denied.
- Output manifests expose only counts, source ids, privacy state, action statuses, and proof-boundary metadata; they reject raw capture fields, token fields, media paths, browser URLs, document paths, and raw text.
- Added tests covering successful lifecycle rows for all three built-ins, workspace snapshot persistence without path exposure, Evidence Inbox candidate creation, stale-debt next-action output, failed-run lifecycle recording with named root cause, and no proof effect.
- This slice still does not implement the scheduler, cancellation/timeout execution, Swift Pipe UI, or endpoint middleware integration.

### 2026-06-28 KST — Gate D Pipe raw API endpoint, cancellation, and timeout slice

- Added a non-raw `pipe` raw API access level so Pipe listing/running/cancellation does not require `raw_admin` but still requires a scoped token, trusted origin, request id, and audit row.
- Extended `sidecar/recorder-raw-api-server.mjs` with `GET /recorder/pipes`, `GET /recorder/pipes/runs`, `POST /recorder/pipes/:pipeId/run`, and `POST /recorder/pipes/runs/:runId/cancel`.
- Pipe run requests now require an explicit JSON body with both `startedAt` and `endedAt`; malformed JSON, missing ranges, bad limits, denied scopes, terminal cancellation, and missing runs fail with named root causes.
- Extended `sidecar/recorder-pipes.mjs` with safe definition/run DTOs, timeout handling, cancellation handling, and incomplete output manifests for `timed_out` and `cancelled` runs.
- Cancellation and timeout outputs are redacted manifest-only records with `complete=false`, `proofAcceptedByPipeRun=false`, and `proofLedgerWriteAllowed=false`; they do not expose raw text, media paths, browser URLs, document paths, raw API tokens, or token hashes.
- Added focused coverage in `sidecar-tests/recorder-pipes.test.mjs` and `sidecar-tests/recorder-raw-api-server.test.mjs` for timeout rows, cancelled queued runs, Pipe endpoint scope gating, run/list/cancel endpoints, audit rows, redaction, and proof-boundary flags.
- This slice still does not implement the scheduler, Swift Pipe UI, or actual user-visible Pipe management surface.

### 2026-06-28 KST — Gate D Pipe scheduler tick slice

- Extended `sidecar/recorder-pipes.mjs` with a local daily Pipe scheduler over existing `pipe_runs` state instead of adding a parallel scheduler table.
- Scheduler enqueue evaluates the built-in `every day at HH:MM` schedules, creates deterministic `queued` run ids, records scheduler metadata in the input manifest, skips duplicates, and enforces `skip_if_running` concurrency.
- Scheduler drain promotes queued runs to `running` and executes them through the same permission checks, timeout handling, redacted output manifests, and proof-boundary rules as manual Pipe runs.
- Added `POST /recorder/pipes/scheduler/tick` for explicit local scheduler driving through the existing raw API token/origin/audit boundary; it can enqueue only or enqueue-and-drain.
- Added a sidecar background scheduler interval after recorder bootstrap; the interval is unref'd, cleared on shutdown, and gated by existing recorder control-state readiness so it does not run before consent/core recording permissions.
- Added tests covering pre-due skips, due enqueue, duplicate scheduled-run skips, queued-run drain, raw API scheduler tick, audit rows, redaction, and non-proof scheduler output.
- This slice still does not implement Swift Pipe UI or the user-visible Pipe management surface.

### 2026-06-28 KST — Day 0-3 loop preservation fix during Gate D verification

- Full sidecar verification exposed a Day 1 Office Hours regression where `syncPendingUserInputRequests()` cleared a host-created commitment card after the transient user-input artifact disappeared, then failed the session as detached pending state.
- Updated `sidecar/index.mjs` to keep an attached Office Hours structured pending card when it still matches the durable pending-question snapshot and has not been answered.
- Refined that keep-alive guard to use exact `requestId` answer matching for already-attached pending cards; question-text fallback remains for restore validation, but it no longer false-positives against a new commitment card with similar copy.
- The fix keeps explicit failure for truly detached pending sessions; it only prevents the active Day 1 commitment card from being misclassified as detached.
- Reproduced the failing Day 1 `get_users` test in isolation, then verified it and the adjacent detached-pending test path pass.

### 2026-06-28 KST — Gate D Swift Pipe management surface slice

- Added authenticated WebSocket Pipe management commands so the macOS app can list built-in Pipe definitions/runs, run a Pipe for the last 24 hours, cancel queued/running runs, and trigger a scheduler tick without minting raw API tokens in Swift.
- The WebSocket responses reuse the same sidecar-owned `recorder-pipes.mjs` DTOs and lifecycle functions as the raw API; returned definition/run/scheduler state is explicitly non-proof (`proofAcceptedByPipeDefinition=false`, `proofAcceptedByPipeRun=false`, `proofAcceptedByScheduler=false`).
- Added Swift `RecorderPipeDefinition`, `RecorderPipeRun`, and `RecorderPipeSchedulerResult` DTOs plus `AgenticViewModel` state/actions for refresh, manual run, cancel, and scheduler tick.
- Extended the Founder Replay route with a user-visible `Pipes` tab showing built-in Pipe definitions, enabled/non-proof state, recent runs, scheduler summary, explicit errors, and cancel controls for active runs.
- Added runtime WebSocket coverage in `sidecar-tests/recorder-raw-api-runtime.test.mjs` and Swift decoding coverage in `SidecarEventDecodingTests`; focused sidecar and Swift unit suites pass.
- This slice still does not implement Swift audit/export UI, actual ScreenCaptureKit frame ingestion, local audio/transcription collectors, or live app/manual UI E2E validation; project instructions still require explicit local approval before running blocking UI E2E.

### 2026-06-28 KST — Gate A Swift recorder control/readiness surface slice

- Added authenticated WebSocket recorder control commands so Swift can fetch recorder control state/readiness and request consent, revoke, pause, resume, or stop-for-today through the sidecar-owned `recorder-control-state.mjs` policy path.
- Control responses include both camel/snake payloads and explicit proof-boundary flags: `proofAcceptedByRecorderControl=false` and `proofAcceptedByCaptureReadiness=false`; recorder readiness remains evidence input only.
- Added Swift `RecorderControlState`, `RecorderCaptureReadiness`, and related DTOs plus `AgenticViewModel` state/actions for refresh, visible-indicator consent acknowledgement, pause/resume/stop, and explicit error surfacing.
- Extended Founder Replay with a `Control` tab showing local-only readiness, blockers/warnings, consent state, pause/resume/stop controls, permission ladder rows, macOS Settings links for TCC surfaces, and sensitive-capture policy status.
- The Swift permission ladder does not fake TCC grants; it opens System Settings for user-owned Screen Recording/Accessibility/Input Monitoring/Microphone changes while the sidecar remains the source of recorder readiness state.
- Added runtime WebSocket coverage for default blocked state, consent, permission readiness, pause/resume, proof flags, and token/hash redaction; added Swift decoding coverage for `recorder_control_state`; focused sidecar checks and Swift unit suite pass.
- This slice still does not implement actual ScreenCaptureKit frame ingestion, live TCC probing from Swift, Swift audit/export UI, local audio/transcription collectors, or live app/manual UI E2E validation; project instructions still require explicit local approval before running blocking UI E2E.

### 2026-06-28 KST — Gate A manual ScreenCaptureKit frame ingest slice

- Added authenticated WebSocket `recorder_frame_capture_ingest` so the macOS app can hand a captured frame envelope to the sidecar without opening a raw API token in Swift.
- The sidecar ingest command reuses `recordFrameCaptureEnvelope()` and loads current recorder control state before writing, so consent/core-permission readiness still gates every frame row.
- Ingest acknowledgements return only sanitized frame/media receipt fields: ids, timestamps, hashes, safety flags, `pathExposed=false`, and non-proof flags; they do not echo raw screen text, media relative paths, raw API tokens, or token hashes.
- Added a manual `Capture` action in Founder Replay Control using ScreenCaptureKit (`SCShareableContent` + `SCScreenshotManager`) to capture display pixels, write a JPEG under the local recorder media directory, hash it, and send the envelope through the authenticated bridge.
- The manual capture action is disabled unless recorder readiness says `canRecord=true`; failures surface the named readiness blocker, ScreenCaptureKit availability/display errors, JPEG encoding errors, or sidecar send failures instead of falling back to fake capture.
- Added runtime WebSocket coverage proving sanitized ingest ack plus persisted frame/media rows, and Swift decoding coverage for `recorder_frame_capture_ingested`; focused sidecar checks and Swift unit suite pass.
- This slice is not the always-on event-driven recorder yet: it does not run a background `SCStream`, schedule continuous capture, probe TCC live from Swift, render actual captured thumbnails in Replay, or perform live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A live TCC permission probe slice

- Added a user-triggered macOS permission probe in Swift that reads Screen Recording via `CGPreflightScreenCaptureAccess()` and Accessibility via `AXIsProcessTrusted()`.
- The Founder Replay Control permission ladder now has a visible `Check` action that sends the probed TCC states through the authenticated recorder control bridge using the existing sidecar `set_permission` policy path.
- The probe does not fabricate grants or bypass System Settings; it only mirrors the host app's current local TCC state into the sidecar-owned readiness model after the user explicitly checks.
- Probe requests emit `mac_recorder_permission_probe_requested` with permission states only, no raw screen text, media paths, tokens, hashes, or captured data.
- The mirrored permission states can unblock manual ScreenCaptureKit capture only when sidecar readiness also has consent and core policy satisfied; readiness remains evidence input, not proof-ledger progress.
- This slice still does not implement an always-on background `SCStream`, continuous event-driven capture, Input Monitoring probing, microphone/system-audio probing, captured thumbnail replay, audit/export UI, local audio/transcription collectors, or live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A visible automatic frame capture slice

- Added a visible automatic frame-capture control in Founder Replay so the user can start/stop local ScreenCaptureKit capture independently from the one-shot manual `Capture` action.
- Automatic capture reuses the existing Swift ScreenCaptureKit screenshot path and authenticated `recorder_frame_capture_ingest` bridge; it does not introduce a second media write path or any raw API token handling in Swift.
- The automatic loop records an immediate start frame, app-activation frames via `NSWorkspace.didActivateApplicationNotification`, and a 120-second heartbeat frame, while skipping overlapping captures instead of queueing unbounded work.
- Capture triggers are persisted as explicit labels (`auto_swift_screencapturekit_start`, `auto_swift_screencapturekit_app_activation`, `auto_swift_screencapturekit_interval`) so recorder rows distinguish automatic capture from manual user capture.
- The loop stops with a named reason when consent is revoked, capture is paused/stopped for today, sidecar send fails, ScreenCaptureKit capture fails, or sidecar readiness becomes blocked; it does not silently keep pretending capture is active.
- The UI shows automatic capture running/stopped state, the last automatic trigger, and non-proof status alongside the latest sanitized frame receipt.
- This slice still is not the final always-on `SCStream` implementation: it does not stream frames continuously, capture input-event triggers, probe Input Monitoring, render captured thumbnails in Replay, or run live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A auto-arm capture after readiness slice

- Recorder control readiness now auto-arms Swift frame capture when the sidecar reports `canRecord=true`, so consent plus core local permissions can start visible recording without an extra `Auto` click.
- The auto-arm still reuses the same visible automatic capture path and records its first frame with `captureTrigger=auto_swift_screencapturekit_readiness_auto_arm`.
- A local user stop remains authoritative: the `Auto` stop button, consent revoke, pause, and stop-for-today set a local stop flag so subsequent readiness refreshes do not silently restart capture against the user's explicit control action.
- Grant-consent and resume actions clear the local stop flag so the next sidecar readiness event can arm recording again after the user has intentionally re-enabled capture.
- ScreenCaptureKit runtime failure now stops automatic capture with a named error and local stop flag instead of repeatedly auto-retrying from later readiness events.
- This slice moves toward always-on-after-consent behavior but still uses sparse screenshot capture; it does not yet replace the heartbeat/app-activation path with a continuous background `SCStream`, Input Monitoring triggers, replay thumbnails, or live UI E2E proof.

### 2026-06-28 KST — Gate A visible frame delete slice

- Added authenticated WebSocket `recorder_frame_capture_delete` so Swift can delete the latest frame through the sidecar-owned recorder delete module instead of touching SQLite or media files directly.
- The sidecar route calls `deleteRecorderFrameCapture()`, preserving existing behavior: safe path resolution under `media/frames/`, physical JPEG existence checks, soft-deleted frame/media rows, search-safe flags cleared, and local media unlink.
- Delete responses are sanitized receipts containing frame id, media asset id, removal status, deleted timestamp, `pathExposed=false`, `proofAcceptedByRecorderDelete=false`, and `proofLedgerWriteAllowed=false`; they do not expose `mediaPath`, `relative_path`, raw API tokens, token hashes, or local filesystem paths.
- Swift now decodes `recorder_frame_capture_deleted`, tracks delete in-flight/error/last receipt state, clears the latest frame only after sidecar confirmation, and surfaces a visible `Delete` action in Founder Replay Control.
- The delete action stops automatic capture with an explicit local stop reason before deleting the latest frame so the UI does not immediately recreate the frame the user just removed.
- Runtime coverage now creates physical test media, deletes it through the authenticated bridge, asserts sanitized receipt fields, confirms the JPEG is gone, and verifies frame/media rows have `deleted_at`; Swift decoding coverage covers the delete event.
- This slice still deletes only the latest captured frame from the visible Control surface. It does not yet implement range/day deletion UI, replay-thumbnail deletion affordances, raw API delete/audit UI, or live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A recent frame replay/table surface slice

- Added authenticated WebSocket `recorder_frame_captures_list` so Swift can load recent recorder frames from sidecar-owned `RecorderStore` rows instead of maintaining a UI-only placeholder timeline.
- The sidecar route filters soft-deleted frame rows, sorts by `captured_at`, and maps each row through the existing sanitized frame ingest DTO; responses keep `proofAcceptedByRecorderFrames=false` and `proofLedgerWriteAllowed=false`.
- The recent-frame response intentionally does not expose `mediaPath`, `relative_path`, raw screen text, raw API token material, token hashes, or local filesystem paths.
- Swift now decodes `recorder_frame_captures`, tracks refresh/error/list state, refreshes the list on Founder Replay appear, upserts new ingest receipts into the visible list, and removes deleted frames after sidecar-confirmed delete receipts.
- Founder Replay Replay and Table modes now render recent sanitized frame receipts: the viewport shows latest frame metadata, the rail shows recent non-proof frame ticks, and the table lists captured time, trigger, safety state, and proof boundary.
- Focused runtime coverage verifies sanitized list responses before and after frame delete, and Swift decoding coverage verifies the `recorder_frame_captures` event.
- This slice still renders metadata receipts rather than actual captured image thumbnails. It does not yet implement continuous `SCStream`, range/day delete UI, timeline scrubbing over media bytes, or live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A audited replay image surface slice

- Founder Replay now loads the latest frame image through the existing audited raw API route `GET /recorder/frames/:id/image` instead of reading host media paths from Swift.
- Swift requests a short-lived `raw_frame` token through the authenticated WebSocket `recorder_raw_api_token_issue` bridge only after the Founder Replay surface asks to display a frame image; the raw token is consumed immediately for the HTTP read and is not published into UI state.
- The image request uses trusted origin `agentic30://app`, a per-request id, and the sidecar raw API audit path; the UI stores only decoded JPEG bytes, frame id, media asset id, audit id, `pathExposed=false`, and non-proof state.
- The Replay viewport now renders an actual local JPEG preview when available, keeps the path-hidden/audited/non-proof labels visible, and shows named image-loading errors from the raw API URL, HTTP status, content type, or JPEG decode boundary.
- Runtime coverage now proves a WebSocket-issued `raw_frame` token can read `/recorder/frames/frame-runtime-1/image`, that the response returns bytes and audit headers without path headers, and that the accepted raw-frame read appears in `recorder_audit`.
- Swift decoding coverage now covers `recorder_raw_api_token_issued` with raw API status and token scope data.
- This slice still does not implement continuous `SCStream`, timeline scrubbing over multiple image frames, range/day deletion UI, media encryption/key management, or live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A audited replay scrubbing surface slice

- Founder Replay now keeps a local selected-frame cursor for recent sanitized frame receipts instead of hard-locking the Replay viewport to the newest receipt.
- Replay rail ticks and Table rows are selectable; selecting a frame updates the viewport metadata and requests that frame's image through the same short-lived `raw_frame` token and audited `GET /recorder/frames/:id/image` route.
- The selection is UI-local and does not expose paths, token material, token hashes, raw screen text, or proof authority; the viewport continues to show `selected`, `non-proof`, `path hidden`, and `raw API audited` labels.
- If the selected frame is deleted or disappears from the recent frame list, the UI falls back to the newest available frame and reloads through the same audited path.
- Swift unit coverage proves the updated view compiles with the existing recorder event-decoding suite; no new sidecar route or proof-ledger write is introduced by this slice.
- This slice still does not implement continuous `SCStream`, range/day deletion UI, media encryption/key management, raw API audit UI, or live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A selected-frame delete surface slice

- Founder Replay can now delete the currently selected frame from the Replay viewport and individual frames from the Table view instead of limiting deletion to the latest Control receipt.
- The UI action calls the existing authenticated WebSocket `recorder_frame_capture_delete` route with the selected frame id; Swift still never reads SQLite, media paths, raw filesystem paths, token material, or raw frame text.
- The sidecar remains the deletion authority: `deleteRecorderFrameCapture()` performs path safety checks, physical JPEG removal, soft-deletes frame/media rows, clears search/memory/export flags, and returns only the sanitized deletion receipt.
- Selected-frame deletion does not stop always-on capture; the existing Control-tab latest-frame delete still stops automatic capture before deleting so a user-control delete is not immediately recreated.
- The UI removes the deleted selected frame only after the sidecar emits `recorder_frame_capture_deleted`, then falls back to the newest remaining sanitized receipt through the same selected-frame reconciliation path.
- Swift unit coverage proves the new closure wiring and table/replay controls compile with the existing recorder event-decoding suite; focused sidecar delete coverage remains in `sidecar-tests/recorder-delete.test.mjs` and runtime bridge coverage in `sidecar-tests/recorder-raw-api-runtime.test.mjs`.
- This slice still does not implement multi-frame range/day deletion UI, raw API audit UI, media encryption/key management, continuous `SCStream`, or live app/manual UI E2E validation.

### 2026-06-28 KST — Gate A visible-range delete surface slice

- Added authenticated WebSocket `recorder_frame_captures_delete_range` so Swift can delete the currently visible Founder Replay frame range through the sidecar-owned `deleteRecorderFrameCapturesInRange()` primitive.
- The range route requires `confirm=true`, `startedAt`, and `endedAt`; missing confirmation, invalid timestamps, missing media files, unsafe paths, and range ordering errors fail with named root causes from the recorder delete module.
- Range delete responses are sanitized `recorder_frame_captures_deleted` receipts with frame/media ids, counts, deleted timestamp, `pathExposed=false`, and proof-ledger denial flags; they do not expose media paths, relative paths, raw screen text, token material, or token hashes.
- Swift now decodes `recorder_frame_captures_deleted`, tracks the last range deletion receipt, removes deleted frame receipts only after sidecar confirmation, and clears latest-frame state if the latest frame was part of the range.
- Founder Replay now has a two-step `보이는 기록 삭제` / `확인 삭제` control in the Replay rail; it derives the visible sanitized frame ids from UI state, lets the view model compute a bounded range, and sends `confirm=true` only on the second click.
- Runtime coverage now ingests multiple frames, proves the WebSocket range-delete route physically removes the scoped JPEG files, confirms frame/media rows are soft-deleted, and asserts the receipt has no path/token/proof leakage.
- This slice still does not implement calendar day picker deletion, raw API audit UI, media encryption/key management, continuous `SCStream`, or live app/manual UI E2E validation.

### 2026-06-28 KST — Gate B bounded raw SQL inspector slice

- Added `raw_sql` as a first-class recorder raw API access level, including token issuance/validation, `raw_admin` implication, raw-scope TTL capping, MCP grant validation, and audit-source filter compatibility.
- Added sidecar-owned redacted SQLite inspector views (`recorder_sql_frames_redacted`, `recorder_sql_transcripts_redacted`, `recorder_sql_memory_items`, `recorder_sql_product_events`, `recorder_sql_audit_sanitized`, `recorder_sql_capture_health`, and `recorder_sql_storage_stats`) on recorder DB open so SQL reads use allowlisted views instead of base tables.
- Added authenticated `POST /recorder/sql/query` with bearer token, trusted origin, request id, `raw_sql` scope, raw API audit context, `query_only` SQLite enforcement during execution, result row caps, and explicit non-proof flags (`proofAcceptedByRawSql=false`, `proofAcceptedByRawApi=false`, `proofLedgerWriteAllowed=false`).
- The SQL validator allows only single `SELECT` / `WITH` / `EXPLAIN` statements, rejects comments, semicolons, mutating/schema/attachment tokens, direct base-table reads, forbidden raw columns, unknown sources, oversized queries, over-cap limits, missing limits on row-returning queries, and overlong timeouts with named root-cause errors.
- SQL responses include only sanitized row values, query fingerprint, allowlisted view names, counts, cap/truncation metadata, `pathExposed=false`, and proof-boundary fields; they do not expose raw frame text, raw transcript text, media paths, document paths, browser URLs, token hashes, raw API tokens, or filesystem paths.
- Focused coverage in `sidecar-tests/recorder-raw-api-server.test.mjs`, `sidecar-tests/recorder-raw-api-auth.test.mjs`, `sidecar-tests/recorder-mcp-grants.test.mjs`, and `sidecar-tests/recorder-store.test.mjs` proves allowed redacted-view reads, scope denial, aggregate reads without `LIMIT`, raw-column/base-table rejection, missing-limit rejection, mutating-statement rejection, comment rejection, sanitized output, and accepted/denied audit rows.
- This slice still does not implement SQLite authorizer/progress-handler interruption beyond `query_only` plus conservative validation, raw-admin raw-column views, SQL inspector UI, live app/manual UI E2E validation, or a full adversarial SQL bypass suite for Unicode/token-spacing edge cases.

### 2026-06-28 KST — Day 0-3 loop preservation fix during Gate B verification

- Full sidecar verification exposed a locked Day 1 `get_users` regression where a non-blocking provider run could finish after the host had already committed the final Evidence Format answer, then reattach a stale pending card because the run-end runtime merge overwrote the newer ValidationAttempt projection.
- Updated `attachOfficeHoursRuntime()` so locked Day 1 `get_users` keeps the newer live projection fields (`attemptId`, `revision`, `nextAction`, `gatherProgress`, `acceptableDay1Close`, and `candidateBlocker`) when the provider-run-start runtime is stale.
- Hardened pending request sync for locked Day 1 `get_users` so stale/duplicate provider-created Office Hours request files cannot replace the current host-attached card after the ValidationAttempt projection has advanced; the sync loop deletes the extra request artifact and preserves the host-owned pending card.
- Marked submitted locked `get_users` request ids as resolved immediately after the ValidationAttempt commit succeeds, and delayed the provider response-file write until after the next host-owned card is attached, so file watchers cannot canonicalize the just-submitted request into a duplicate hidden ladder card.
- This preserves the proof/Day loop boundary: the ValidationAttempt projection remains authority for host-completed `get_users` gather state, and stale provider cards cannot turn a completed gather back into another pending prompt.
- Reproduced the failure in `sidecar-tests/request-emit.test.mjs`, verified that file passes in order (`71/71`), then reran the full sidecar suite successfully (`2440` tests, `2437` pass, `3` skipped, `0` fail).

### 2026-06-28 KST — Gate B raw SQL worker timeout isolation slice

- Moved bounded raw SQL execution off the raw API request handler and store connection into `sidecar/recorder-sql-worker.mjs`, so inspector queries run in an isolated worker thread.
- The worker opens `recorder.sqlite` through `better-sqlite3` with `readonly: true`, `fileMustExist: true`, and `PRAGMA query_only=ON`; it also rejects non-reader prepared statements before iterating rows.
- `/recorder/sql/query` now enforces the per-request SQL timeout by terminating the worker and returning named root cause `ERR_RECORDER_RAW_API_SQL_TIMEOUT` with HTTP `408`; successful and failed attempts still pass through the existing raw API authorization and accepted/denied audit rows.
- Focused raw API coverage now proves over-cap SQL timeouts fail closed, a 1ms query deadline returns `ERR_RECORDER_RAW_API_SQL_TIMEOUT`, timed-out responses contain no `sql` payload, and the existing redaction/scope/base-table/mutation/comment/audit assertions still pass.
- Public `better-sqlite3` docs checked during this slice did not expose SQLite authorizer/progress-handler hooks, so the remaining gap is true SQLite authorizer/progress-handler enforcement if the runtime later exposes it; this slice also still lacks raw-admin raw-column views, SQL inspector UI, live app/manual UI E2E validation, and the full adversarial SQL bypass suite.

### 2026-06-28 KST — Gate B raw-admin SQL view and CTE bypass-hardening slice

- Added sidecar-owned raw-admin SQL inspector views (`recorder_sql_frames_raw_admin` and `recorder_sql_transcripts_raw_admin`) for local admin/debug inspection of raw frame text, OCR text, browser URLs, document paths, transcript text, and media-relative paths.
- Raw SQL remains redacted by default: raw-admin views require the token to carry both `raw_sql` and `raw_admin`, and the request must explicitly set `includeRawColumns=true`; otherwise the route fails closed with named raw-admin errors before execution.
- SQL response sanitization now preserves raw-admin path/URL/raw-text columns only for the `includeRawColumns=true` raw-admin path, continues to suppress token-material columns, and marks `pathExposed=true` when a raw-admin view is used.
- Hardened validator source discovery so `FROM` / `JOIN` detection is case-insensitive and CTE bodies are inspected; CTE aliases are allowed only as aliases over already-allowlisted inspector views, so CTEs cannot hide base-table reads.
- Focused coverage now proves redacted CTE reads, raw view denial without `raw_admin`, raw view denial without `includeRawColumns`, raw frame/transcript column access with `raw_sql + raw_admin`, CTE base-table bypass rejection, raw-admin CTE flag enforcement, `ATTACH` rejection, extension-loading rejection, raw output path exposure, and continued token-hash/token redaction.
- This slice closes the prior raw-admin raw-column view and CTE bypass coverage gaps. Remaining SQL gaps are SQLite authorizer/progress-handler hooks if the runtime exposes them, a broader Unicode/token-spacing adversarial corpus, SQL inspector UI, and live app/manual UI E2E validation.

### 2026-06-28 KST — Gate D Pipe DSL forbidden-family root-cause hardening slice

- Tightened built-in recorder Pipe DSL validation so every forbidden action family is rejected by explicit policy, not by a generic unknown-action fallback.
- `shell`, `network`, `browser_automation`, `customer_outreach`, `public_post`, `deploy`, `payment_mutation`, `raw_file_read`, and `raw_media_read` are now blocked both as exact actions and as dotted sub-actions such as `browser_automation.click`, `public_post.threads`, or `raw_file_read.workspace`.
- This preserves the Gate D boundary that Pipes are constrained local DSL automations only: they cannot shell out, touch the network/browser, perform outreach/posting/deploy/payment mutation, or read raw files/media.
- Focused coverage in `sidecar-tests/recorder-pipes.test.mjs` now proves the forbidden action families fail with named root cause `ERR_RECORDER_PIPE_ACTION_BLOCKED` while the existing non-raw permission, endpoint, timeout, cancellation, scheduler, and non-proof manifest assertions still pass.
- Remaining Pipe gaps include UI/manual scheduler exercise and live app/manual UI E2E validation.

### 2026-06-28 KST — Gate D Pipe output-manifest raw-value hardening slice

- Added value-level Pipe output-manifest scanning in addition to the existing raw-field-name scan.
- Pipe outputs now fail closed with named root cause `ERR_RECORDER_PIPE_OUTPUT_RAW_VALUE` if a manifest string contains raw-looking local filesystem paths, recorder media paths, raw API token material, bearer tokens, or secret assignment patterns.
- The failure details report only the manifest field path and matched rule, not the leaked value.
- End-to-end coverage now forces a `stale-debt-resurfacer` run to carry an unsafe `media/frames/...` source id from an Evidence Inbox candidate into `sourceIds`; the runner rejects the output, records the run as `failed`, and persists no output manifest.
- Normal built-in Pipe runs, scheduler runs, timeout/cancellation manifests, non-proof boundaries, blocked-action checks, raw-access denial, raw-endpoint denial, and unsafe write-scope denial continue to pass in `sidecar-tests/recorder-pipes.test.mjs`.
- Remaining Pipe gaps include UI/manual scheduler exercise and live app/manual UI E2E validation.

### 2026-06-28 KST — Gate C clipboard event persistence and policy-enforced ingest slice

- Added sidecar-owned `clipboard_events` persistence as recorder schema v2, including current migration support, trigger/content metadata, raw content storage only under explicit content opt-in, and recorder SQL inspector views.
- Trigger-only clipboard events store event kind, app/window context, content type/hash, redacted text, policy state, and safe flags without storing raw content; sanitized receipts expose neither raw content nor paths and remain non-proof.
- Clipboard content capture now fails closed unless recorder control state evaluates to Clipboard permission granted plus `content_opt_in`; blocked policy, missing trigger permission, missing control state, missing redacted text for search, unsafe redaction status, and duplicate ids return named root-cause errors.
- Added authenticated WebSocket `recorder_clipboard_event_record`, which loads the persisted recorder control state and records clipboard events through the same sidecar-owned store boundary as frame ingest.
- Raw SQL remains view-bound: `clipboard_events` is a forbidden base source, `recorder_sql_clipboard_redacted` exposes only redacted/search-safe columns, and `recorder_sql_clipboard_raw_admin` exposes `clipboard_text` only through `raw_sql + raw_admin + includeRawColumns=true`.
- Focused coverage now proves trigger-only persistence without raw content, opt-in-only raw content storage, redacted sanitized receipts, explicit blocked-policy failures, duplicate-id failures, SQL redacted/raw-admin clipboard views, base-table rejection, and the WebSocket route smoke.
- Remaining Gate C gaps include Swift-side clipboard collector integration, UI controls for clipboard policy, local audio/transcript collectors, browser/document metadata runtime probes, and live app/manual UI E2E validation.

### 2026-06-28 KST — Day 0-3 loop stale-card-after-wait suppression during Gate C verification

- Focused Day 1 request-flow verification exposed a narrower locked `get_users` regression: after the host had already completed the required visible cards and the ValidationAttempt projection had advanced to `wait`, a late provider-created structured card was being treated as a hard failure.
- The stale-card path now raises explicit root cause `ERR_LOCKED_GET_USERS_STALE_CARD_AFTER_WAIT`; locked Day 1 pending-request sync deletes the stale request artifact, marks it resolved, clears the pending question, settles the session back to idle/completed status, and aborts the active provider run at the question cap.
- Other structured-card mismatches still fail loudly; this suppression is limited to locked Day 1 `get_users` where the projection authority says no card should be shown.
- This preserves the Day 0-3 loop boundary: host-completed ValidationAttempt state remains authoritative, and a late provider card cannot revive a completed gather into another visible prompt or fake proof progress.
- Focused coverage in `sidecar-tests/request-emit.test.mjs` now passes in order (`71/71`) after the stale-card guard.

### 2026-06-28 KST — Gate C local audio chunk and transcript ingest slice

- Added `sidecar/recorder-audio.mjs` as the sidecar-owned write path for opted-in local audio chunks and local transcript segments over the existing `media_assets`, `audio_chunks`, and `transcript_segments` tables.
- Audio ingest requires recorder control state, Core Memory readiness, and expanded media policy approval. Microphone/system-audio/meeting-audio capture fails closed with named root cause `ERR_RECORDER_AUDIO_CAPTURE_BLOCKED` when the user has not enabled the relevant sensitive capture policy or permission.
- Raw audio metadata remains local and path-hidden: audio assets must live under `media/audio/`, unsafe/absolute paths are rejected before writes, duplicate chunk/asset/segment ids fail before partial inserts, and sanitized receipts expose neither `relative_path` nor raw audio bytes.
- Transcript segments are local-only. Cloud transcription provider/status values fail with `ERR_RECORDER_AUDIO_CLOUD_TRANSCRIPTION_BLOCKED`; `safe_for_search` transcript rows require redacted text and search-safe redaction status, so FTS indexes redacted transcript text only.
- Added authenticated WebSocket `recorder_audio_chunk_record`, which loads persisted recorder control state, writes through `RecorderStore`, and returns a non-proof receipt with `proofAcceptedByAudioChunk=false` and `proofLedgerWriteAllowed=false`.
- Focused coverage now proves opted-in microphone audio ingest, redacted-only transcript search, raw transcript non-leakage, disabled/missing-permission failures, cloud-transcription fallback rejection, unsafe media path rejection, duplicate protection, and the WebSocket runtime route smoke.
- Remaining Gate C gaps include Swift-side clipboard/audio collectors, UI controls for clipboard/audio policy, browser/document metadata runtime probes, media encryption/key management before always-on raw background capture, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C browser/document metadata runtime-probe state slice

- Tightened expanded-media readiness so Browser metadata and Document metadata are no longer considered available from permission state alone.
- Added persisted `metadataProbes` / `metadata_probes` to recorder control state plus `record_metadata_probe` control actions for `browserMetadata` and `documentMetadata`; probes can report `available`, `unavailable`, or `degraded`.
- Unavailable/degraded metadata probe results must include a named root cause, otherwise the control action fails with `ERR_RECORDER_CONTROL_METADATA_PROBE_ROOT_CAUSE_REQUIRED`.
- `evaluateRecorderExpandedMediaPolicy()` now reports `probe_unverified` while permission is granted but no runtime probe has succeeded, and reports probe-root-cause degraded states when the runtime probe fails.
- Added `assertRecorderMetadataAvailable()` so future metadata-dependent capture paths can fail with named root cause `ERR_RECORDER_METADATA_CAPTURE_UNAVAILABLE` instead of silently degrading or pretending metadata exists.
- The existing authenticated WebSocket `recorder_control_action` route now carries metadata probe actions through the same persisted control-state boundary; runtime coverage drives the probe route before the recorder becomes fully `ready`.
- Focused coverage now proves probe-unverified degraded readiness, unavailable probe root-cause enforcement, explicit metadata-required failure, available browser/document probe recovery, recorder runtime bridge behavior, and continued Day 1 request-flow safety.
- Remaining Gate C gaps include Swift-side clipboard/audio collectors, UI controls for clipboard/audio policy, Swift runtime emission of browser/document probes, media encryption/key management before always-on raw background capture, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C raw-media encryption guard slice

- Added shared raw-media protection in `sidecar/recorder-media-protection.mjs` and wired it into frame and audio ingest before any `media_assets`, `frames`, or `audio_chunks` rows are persisted.
- Automatic/background raw frame and audio capture now fails closed unless the media asset declares `encrypted=true`; failures use named root cause `ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED`.
- Manual or explicit user-triggered capture remains allowed under the documented host-user trust boundary until full key management lands; generic triggers such as `app_switch` are not treated as background capture without an explicit automatic/background mode.
- The authenticated WebSocket frame/audio ingest handlers now carry root-level capture hints (`captureMode`, `captureTrigger`, `automatic`, `background`) into the nested envelope before normalization, so bridge callers cannot bypass the guard by placing mode metadata outside the payload body.
- Swift automatic frame capture is also fail-fast gated before `ScreenCaptureKit` writes a JPEG. Until encrypted media writing/key management lands, auto-arm/start records `ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED`, sets the local stop flag, and does not write raw background media to disk; manual capture still sends `captureMode=manual`.
- Focused coverage now proves unencrypted automatic frame ingest and unencrypted background audio ingest fail before partial writes, while encrypted background media continues through the same sidecar-owned store boundary.
- Runtime WebSocket coverage now proves root-level frame/audio capture hints are merged into the nested payload before normalization, so an unencrypted automatic/background bridge request emits `ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED` and persists no frame, audio, or media-asset rows.
- Verification passed: `node --check` for changed sidecar/test modules, focused frame/audio recorder tests (`10/10`), recorder raw API runtime smoke (`1/1`), full recorder shard (`88/88`), `sidecar-tests/request-emit.test.mjs` (`68/68`), `npm run check:public-safety`, `npm run build:sidecar`, and Swift unit tests with isolated DerivedData (`559/559`).
- Remaining Gate C gaps include actual encryption/key generation and Keychain-backed key management, encrypted Swift automatic/background media output, Swift-side clipboard/audio collectors, UI controls for clipboard/audio policy, Swift runtime metadata probes, raw API audit UI, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift browser/document metadata probe emission slice

- Extended Swift's user-triggered recorder permission probe so, after recorder consent is granted, it emits `record_metadata_probe` actions for `browserMetadata` and `documentMetadata` through the existing authenticated `recorder_control_action` bridge.
- The host also marks browser/document metadata permission states as `granted` for the local probe path, so sidecar readiness can report the probe result itself instead of staying at generic `unknown` permission state.
- Probe results are intentionally conservative: Swift currently records both metadata surfaces as `degraded` with named root causes `browser_url_extraction_not_implemented` and `document_path_extraction_not_implemented`; it does not pretend URL/path extraction is available from weak app/window-title signals.
- Pre-consent `Check` still mirrors only core macOS TCC state and does not send metadata probe actions that the sidecar would reject for missing consent.
- Added Swift unit coverage proving consented permission refresh sends browser/document metadata permission updates and degraded `record_metadata_probe` payloads with the expected root causes.
- Verification passed: Swift unit tests with isolated DerivedData (`560/560`), `git diff --check` for the changed Swift/SPEC files, and `npm run check:public-safety`.
- Remaining Gate C gaps include actual browser URL and document path extraction, Swift-side clipboard/audio collectors, UI controls for clipboard/audio policy, actual encryption/key generation and Keychain-backed key management, raw API audit UI, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift sensitive-capture policy controls slice

- Added Swift view-model wrappers for `set_sensitive_capture` so clipboard policy, microphone opt-in, and system-audio opt-in all travel through the existing authenticated `recorder_control_action` bridge.
- Clipboard mode is fail-fast validated in Swift against the sidecar contract (`trigger_only`, `content_opt_in`, `blocked`); invalid UI/client calls set `ERR_RECORDER_SENSITIVE_CAPTURE_INVALID_CLIPBOARD_MODE` and send no sidecar payload.
- Wired the policy actions through `ContentView`, `OpenDesignDayPageView`, `OpenDesignDayShell`, and the Founder Replay control surface.
- Founder Replay now exposes a segmented clipboard policy control plus microphone/system-audio switches. These controls only update policy state; they do not collect clipboard contents, microphone audio, or system audio.
- Fixed the sensitive-capture status tone to treat `blocked` as the disabled clipboard policy state instead of the non-contract value `disabled`.
- Added Swift unit coverage proving the three policy controls send exact `set_sensitive_capture` patches and proving invalid clipboard mode is rejected before any sidecar send.
- Verification passed: Swift unit tests with isolated DerivedData (`562/562`) and `git diff --check` for the changed Swift files.
- Remaining Gate C gaps include Swift-side clipboard/audio collectors, actual browser URL and document path extraction, microphone/system-audio TCC runtime probes beyond policy toggles, actual encryption/key generation and Keychain-backed key management, raw API audit UI, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift trigger-only clipboard collector slice

- Added a Swift-side Clipboard trigger collector driven by `NSPasteboard.changeCount`; it starts only when recorder control state is active, consent is granted, Clipboard trigger permission is marked granted, and the Clipboard policy is not `blocked`.
- The collector emits the existing sidecar `recorder_clipboard_event_record` payload shape and writes through the sidecar-owned policy-enforced `recordClipboardEvent()` path.
- This slice intentionally does not read raw clipboard contents. Swift inspects pasteboard type metadata only, emits `contentType`, `eventKind=change`, `redactionStatus=not_collected`, `privacyState=trigger_only_local`, and all search/memory/export flags as false.
- Swift recorder permission refresh now marks `clipboard` as `granted` for trigger access because `NSPasteboard.changeCount` is locally available; raw contents remain gated by the separate `content_opt_in` policy and are still not collected by Swift.
- The collector is stopped on sidecar stop/reconnect, workspace switching, sidecar status/error events, consent revoke/pause/block policy state changes, or deinit, so stale polling does not survive recorder shutdown boundaries.
- Added Swift unit coverage proving the permission probe includes Clipboard trigger access and proving the trigger-only Clipboard event payload contains no `contentText` while preserving app/window metadata.
- Verification passed: Swift unit tests with isolated DerivedData (`563/563`) and `git diff --check` for the changed Swift files.
- Remaining Gate C gaps include raw clipboard content opt-in collection with redaction, Swift-side microphone/system-audio collectors, actual browser URL and document path extraction, microphone/system-audio TCC runtime probes beyond policy toggles, actual encryption/key generation and Keychain-backed key management, raw API audit UI, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift audio permission probe slice

- Extended Swift's recorder permission probe to include microphone authorization state using `AVCaptureDevice.authorizationStatus(for: .audio)` without prompting for access.
- Microphone maps into the sidecar permission contract as `granted`, `denied`, `restricted`, `not_determined`, or `unknown`, so microphone opt-in now produces a concrete readiness state instead of staying at generic unknown.
- Swift now marks `systemAudio` permission as `unavailable`; this is explicit until a real System Audio capture permission/readiness path exists and prevents the UI toggle from implying working capture.
- Added Swift unit coverage that tolerates the host's current microphone permission state while proving a microphone permission update is emitted and system audio is explicitly `unavailable`.
- Verification passed: Swift unit tests with isolated DerivedData (`563/563`) and `git diff --check` for the changed Swift files.
- Remaining Gate C gaps include raw clipboard content opt-in collection with redaction, Swift-side microphone/system-audio collectors, actual System Audio permission/capture implementation, actual browser URL and document path extraction, actual encryption/key generation and Keychain-backed key management, raw API audit UI, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate B/C Swift raw API audit UI slice

- Added Swift DTO decoding for the existing sidecar `recorder_audit_events` / `recorder_audit_source` payload, including endpoint, access level, decision, reason, created time, and sanitized source ids.
- Added `refreshRecorderAuditEvents()` in `AgenticViewModel`; it sends the existing authenticated `recorder_audit_list` WebSocket request with a capped limit and stores the returned audit source.
- Founder Replay Control now has a compact Raw API Audit panel with refresh, row count, non-proof status, and recent audit rows. It displays the sidecar-sanitized audit source only; it does not expose raw tokens, filesystem paths, or raw SQL.
- Added Swift unit coverage proving the bounded audit-list request payload and decoding of sanitized audit rows from `recorder_audit_events`.
- Verification passed: Swift unit tests with isolated DerivedData (`565/565`) and `git diff --check` for the changed Swift files.
- Remaining Gate C gaps include raw clipboard content opt-in collection with recorder-grade redaction, Swift-side microphone/system-audio collectors, actual System Audio permission/capture implementation, actual browser URL and document path extraction, actual encryption/key generation and Keychain-backed key management, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C raw clipboard content opt-in redaction slice

- Tightened sidecar clipboard content ingest so raw Clipboard text is no longer silently truncated before policy checks; content over 2,000 characters fails before persistence with `ERR_RECORDER_CLIPBOARD_CONTENT_TOO_LARGE`.
- Clipboard content opt-in now runs through the existing runtime secret detector/redactor in `workspace-safety.mjs`. Secret-shaped raw Clipboard text fails before any row insert with `ERR_RECORDER_CLIPBOARD_CONTENT_SECRET_BLOCKED`, and failure details do not echo the raw content.
- Safe raw content can be stored only when the persisted recorder control state evaluates to `content_opt_in`; the sidecar derives a safe redaction receipt/status for non-secret content and keeps sanitized record acknowledgements from echoing raw content when redacted text is identical to the stored raw text.
- Swift's Clipboard collector now reads `NSPasteboard` string content only when the active sensitive-capture policy is `content_opt_in`, and only for text/URL clipboard types. Trigger-only events remain metadata-only and continue to send no `contentText`.
- Swift opt-in payloads send raw text to the sidecar with `privacyState=raw_local`, no preclaimed redaction status, and all search/memory/export flags false, so the sidecar remains the single owner of recorder-grade redaction and persistence decisions.
- Focused sidecar coverage now proves content policy blocking, safe opt-in persistence, secret suppression without partial rows, oversize rejection without truncation, sanitized acknowledgement non-leakage, duplicate protection, and trigger-only non-proof receipts.
- Added Swift unit coverage proving trigger-only payloads still contain no `contentText` and opt-in payloads carry raw text only in the explicit content event shape for sidecar redaction.
- Verification passed: `node --check sidecar/recorder-clipboard.mjs`, `node --check sidecar-tests/recorder-clipboard.test.mjs`, `node --test sidecar-tests/recorder-clipboard.test.mjs` (`3/3`), `npm run build:sidecar`, Swift unit tests with isolated DerivedData (`566/566`), `git diff --check` for touched files, and `npm run check:public-safety`.
- Remaining Gate C gaps include Swift-side microphone/system-audio collectors, actual System Audio permission/capture implementation, actual browser URL and document path extraction, actual encryption/key generation and Keychain-backed key management, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C raw-media encryption envelope and key-management slice

- Added sidecar-owned recorder media encryption helpers in `recorder-media-encryption.mjs` using AES-256-GCM with 32-byte local keys, 12-byte nonces, 16-byte tags, ciphertext SHA-256 binding, decrypt verification, and an injectable key-store boundary.
- Added a macOS Keychain adapter for recorder media keys plus an in-memory test key store. Focused tests exercise key generation/persistence through the injected store; they do not touch the user's live Keychain.
- Bumped recorder store schema to v3 and added `media_assets` encryption metadata columns: `encryption_key_id`, `encryption_alg`, `encryption_nonce`, and `encryption_tag`. Existing v1/v2 databases migrate those columns explicitly; fresh databases create them in the base schema.
- Tightened `assertRawMediaEncryptionPolicy()` so `encrypted=true` now requires a valid AES-GCM envelope. Automatic/background frame and audio ingest still fails with `ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED` when encryption is absent, and now fails with `ERR_RECORDER_MEDIA_ENCRYPTION_ENVELOPE_REQUIRED` or `ERR_RECORDER_MEDIA_ENCRYPTION_HASH_MISMATCH` when metadata is incomplete or not bound to the stored ciphertext hash.
- Frame and audio ingest now persist the normalized non-secret envelope metadata on `media_assets`; sanitized audio receipts still do not expose key ids or raw paths.
- Updated Day Memory Loop fixtures and raw API runtime coverage to keep using the strict ingest path without bypassing the encryption envelope requirement.
- Verification passed: `node --check` for changed media encryption/protection/ingest/audio/store modules and tests, `node --test sidecar-tests/recorder-media-encryption.test.mjs` (`2/2`), `node --test sidecar-tests/recorder-ingest.test.mjs` (`5/5`), `node --test sidecar-tests/recorder-audio.test.mjs` (`5/5`), `node --test sidecar-tests/recorder-store.test.mjs` (`3/3`), `node --test sidecar-tests/recorder-day-loop.test.mjs` (`3/3`), `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs` (`1/1`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check` for touched files.
- Remaining Gate C gaps include Swift-side encrypted media writing using the recorder media key, Swift-side microphone/system-audio collectors, actual System Audio permission/capture implementation, actual browser URL and document path extraction, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift automatic frame encryption slice

- Added Swift recorder media key management through `KeychainHelper.loadOrCreateRecorderMediaKey()`. Release builds store the 32-byte recorder media key in macOS Keychain; DEBUG builds follow the existing dev-secrets policy to avoid repeated local Keychain prompts.
- Automatic/background ScreenCaptureKit frame capture is now unblocked because Swift can write encrypted media. The old local fail-fast guard remains as a root-cause message constant but no longer blocks automatic capture when encrypted writing is available.
- Automatic frame capture now AES-GCM seals the JPEG bytes, writes only ciphertext to `media/frames/<day>/<asset>.jpg.enc`, computes `snapshot.sha256` over ciphertext, and attaches the sidecar-required `encryption` envelope (`algorithm`, `keyId`, `nonce`, `tag`, `ciphertextSha256`).
- Manual frame capture still writes normal JPEGs under the documented host-user trust boundary so the existing manual preview/read path is not broken before encrypted preview/decryption is implemented.
- Added explicit Swift errors for media key and encryption failures (`ERR_RECORDER_MEDIA_KEY_UNAVAILABLE`, `ERR_RECORDER_MEDIA_ENCRYPTION_FAILED`) rather than falling back to unencrypted automatic capture.
- Verification passed: Swift unit tests with isolated DerivedData (`565/565`).
- Remaining Gate C gaps include encrypted preview/decryption for stored automatic frames, Swift-side microphone/system-audio collectors, encrypted Swift audio writing, actual System Audio permission/capture implementation, actual browser URL and document path extraction, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift AX browser/document metadata extraction slice

- Replaced the hard-coded Swift browser/document metadata `not_implemented` probes with a real Accessibility-based runtime probe.
- Swift now reads frontmost app/window AX metadata candidates (`AXURL`, `AXDocument`, `AXFilename`, `AXTitle`) when Accessibility is trusted. HTTP(S) candidates mark `browserMetadata` as `available`; file URLs or absolute paths mark `documentMetadata` as `available`.
- When AX metadata is unavailable, probes remain explicit degraded states with named root causes such as `accessibility_permission_missing`, `frontmost_application_unavailable`, `browser_url_ax_attribute_unavailable`, and `document_path_ax_attribute_unavailable`.
- ScreenCaptureKit frame envelopes now include `browserUrl` and `documentPath` when the same AX probe can read them; missing metadata is sent as `null` rather than guessed from weak app/window title signals.
- The AX element cast now validates Core Foundation type IDs before casting, so malformed accessibility values degrade instead of crashing the recorder path.
- Updated Swift unit coverage to accept either `available` or `degraded` metadata probes while still requiring named root causes on degraded probes.
- Verification passed: Swift unit tests with isolated DerivedData (`565/565`).
- Remaining Gate C gaps include encrypted preview/decryption for stored automatic frames, Swift-side microphone/system-audio collectors, encrypted Swift audio writing, actual System Audio permission/capture implementation, broader browser-specific URL extraction beyond AX, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate B/C encrypted frame image raw API decryption slice

- Aligned the sidecar recorder media key defaults with Swift's shared macOS Keychain item (`service=com.agentic30`, `account=com.agentic30.recorder-media-key-v1`) so Node and Swift address the same local media key.
- Swift recorder media keys are now Keychain-backed in all builds instead of DEBUG-only dev-secret storage, because the sidecar must be able to decrypt encrypted media written by the app.
- Added `loadRecorderMediaKey()` for read paths so raw API decryption fails with `ERR_RECORDER_MEDIA_KEY_UNAVAILABLE` rather than silently creating a new wrong key when the original media key is missing.
- The raw frame image endpoint now decrypts `media_assets.encrypted=1` frame ciphertext with the persisted AES-GCM envelope before returning `image/jpeg`; unencrypted manual frames continue to stream directly.
- The endpoint still requires `raw_frame`, writes audit rows for denied and accepted image reads, does not expose filesystem paths, and returns plaintext image bytes only through the authenticated raw API boundary.
- Added raw API server coverage that stores an encrypted `.jpg.enc` frame, injects an in-memory media key store, proves the endpoint returns the original JPEG bytes, and audits the encrypted image read.
- Verification passed: `node --check sidecar/recorder-raw-api-server.mjs`, `node --check sidecar-tests/recorder-raw-api-server.test.mjs`, `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`8/8`), `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs` (`1/1`), `npm run build:sidecar`, Swift unit tests with isolated DerivedData (`565/565`), `npm run check:public-safety`, and `git diff --check` for touched files.
- Remaining Gate C gaps include Swift-side microphone/system-audio collectors, encrypted Swift audio writing, actual System Audio permission/capture implementation, broader browser-specific URL extraction beyond AX, live timeline/manual UI validation for encrypted frames, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift encrypted microphone audio collector slice

- Added `NSMicrophoneUsageDescription` so macOS microphone capture has a concrete, local-only purpose string instead of failing behind an opaque platform prompt.
- Swift now reconciles the microphone collector from authenticated recorder control state: recorder mode active, consent granted, microphone sensitive-capture opt-in, sidecar permission state `granted`, and live AVFoundation authorization `granted` are all required before capture starts.
- Added a bounded `AVAudioRecorder` microphone chunk path that writes temporary `.m4a`, encrypts bytes with the shared recorder media Keychain key, writes only `.m4a.enc` under recorder media, and sends `recorder_audio_chunk_record` over the existing sidecar bridge with `captureMode=background`, `automatic=true`, and `background=true`.
- Audio chunk payloads initially used `transcriptStatus=not_requested`; the follow-up local-transcription state slice below changes Swift microphone chunks to `local_transcription_unavailable` until a real local transcriber is wired. Redaction stays `not_redacted`, privacy stays `raw_local`, no transcript segments are emitted, and no proof acceptance flags are set; the sidecar still owns opt-in policy, encryption-envelope validation, store writes, and proof-boundary enforcement.
- System Audio remains an explicit named unavailable state (`ERR_RECORDER_SYSTEM_AUDIO_UNAVAILABLE`) until a real local system-audio capture implementation exists; the UI toggle cannot imply working system-audio capture.
- Extended the raw audio API media endpoint to decrypt encrypted audio assets through the same local media key store used by frame previews before returning `audio/mp4`, preserving raw-audio token/audit requirements and no filesystem path exposure.
- Updated raw API coverage so the audio fixture stores real AES-GCM ciphertext plus envelope columns and proves `/recorder/audio/:id/media` returns the original audio bytes only through a `raw_audio` token.
- Added Swift unit coverage for the encrypted microphone chunk builder/bridge seam: it writes ciphertext under a temporary recorder root, proves plaintext is not written as media, verifies the AES-GCM envelope binds to the media hash, and checks the sidecar payload route/hints.
- Verification passed after repairing local generated dependency state with `npm ci`: `node --check sidecar/recorder-raw-api-server.mjs`, `node --check sidecar-tests/recorder-raw-api-server.test.mjs`, `node --test sidecar-tests/recorder-audio.test.mjs` (`5/5`), `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`8/8`), `npm run build:sidecar`, `npm run test:swift:unit` (`566/566`), `npm run check:public-safety`, `plutil -lint agentic30/Info.plist`, and `git diff --check` for touched files.
- Live microphone capture/manual UI validation and blocking UI E2E were not run in this slice; project instructions still require explicit local approval before any foreground UI E2E run.
- Remaining Gate C gaps include actual System Audio permission/capture implementation, local transcription execution/state beyond `not_requested`, broader browser-specific URL extraction beyond generic AX, live timeline/manual UI validation for encrypted media, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C local browser URL Apple Events extraction slice

- Added `NSAppleEventsUsageDescription` so local browser URL extraction has a concrete purpose string and macOS Automation prompts are tied to Founder Replay context capture rather than appearing as an opaque app request.
- Swift browser metadata extraction now tries local Apple Events for known browser bundle IDs before falling back to generic Accessibility attributes. Supported script families cover Safari/Safari Technology Preview front-document URLs and Chromium-style active-tab URLs for Chrome, Chrome Canary, Chromium, Brave, Edge, Arc, Vivaldi, Opera, and NAVER Whale.
- The extractor still uses no browser extension and no cloud path. If Apple Events are denied or unavailable, the recorder degrades with named root causes such as `browser_url_apple_events_permission_denied`, `browser_url_apple_events_application_unavailable`, `browser_url_apple_events_empty`, `browser_url_apple_events_invalid_url`, or `browser_url_apple_events_unavailable`.
- Browser metadata can now succeed through Apple Events even when Accessibility is missing; document path metadata remains AX-based and still degrades with `accessibility_permission_missing` when AX is unavailable.
- Updated the metadata probe copy to describe local Apple Events or AX rather than AX-only extraction.
- Added Swift unit coverage for generated Safari/Chromium/NAVER Whale AppleScript source selection and Apple Events error-root-cause mapping, and widened the metadata probe degraded-root-cause assertions to include the new browser URL root causes.
- Verification passed: `plutil -lint agentic30/Info.plist`, `npm run test:swift:unit` (`567/567`), and `git diff --check` for touched Swift/plist files.
- Live browser Automation permission prompts and live browser URL extraction were not exercised in this slice; they require an interactive app/browser validation pass.
- Remaining Gate C gaps include actual System Audio permission/capture implementation, local transcription execution/state beyond `not_requested`, live timeline/manual UI validation for encrypted media and browser metadata, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C explicit local transcription unavailable state slice

- Swift encrypted microphone chunks now send `transcriptStatus=local_transcription_unavailable` instead of `not_requested`, because no local transcription engine is wired yet and cloud transcription remains explicitly forbidden.
- The chunk still carries no transcript segments, no raw/redacted transcript text, `redactionStatus=not_redacted`, `privacyState=raw_local`, encrypted media metadata only, and no proof acceptance flags.
- Added sidecar audio coverage proving `local_transcription_unavailable` stores on `audio_chunks`, emits zero transcript segments, does not index transcript FTS, does not leak raw transcript/media paths in receipts, and cannot become proof.
- Updated Swift unit expectations for the encrypted microphone payload seam to require `local_transcription_unavailable`.
- Verification passed: `node --check sidecar-tests/recorder-audio.test.mjs`, `node --test sidecar-tests/recorder-audio.test.mjs` (`6/6`), `npm run test:swift:unit` (`567/567`), `npm run check:public-safety`, and `git diff --check` for touched files.
- Remaining Gate C gaps include actual local transcription execution with on-device/local-only transcripts, actual System Audio permission/capture implementation, live timeline/manual UI validation for encrypted media and browser metadata, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C audio provenance and no-cloud terminal-state slice

- Bumped recorder store schema to v4 and added audio/transcript provenance columns. `audio_chunks` now stores nullable `consent_grant_id`, `visible_notice_id`, `raw_audio_indicator_state`, `local_transcriber_name`, `local_transcriber_version`, and `transcription_terminal_state`; `transcript_segments` now stores `transcript_status`, `speaker_label_provenance`, and `deletion_source_id`.
- Added forward migration coverage so existing v1-v3 recorder databases receive the new columns, while fresh v4 databases create them in the base schema. Recorder SQL inspector views are recreated on open so the redacted/raw transcript views expose safe provenance metadata instead of stale view definitions.
- Tightened audio ingest validation: `local_complete` chunks must name a local transcriber and version, `meeting_audio` chunks must carry a visible notice id, speaker labels require speaker-label provenance, and `local_transcription_unavailable` defaults to the explicit `local_unavailable_no_cloud_fallback` terminal state.
- Swift encrypted microphone chunks now include `rawAudioIndicatorState=visible_indicator_active`, null local transcriber fields, and `transcriptionTerminalState=local_unavailable_no_cloud_fallback`, matching the no-cloud fallback contract until a real local transcriber is wired.
- Raw audio/transcript API DTOs now include safe provenance fields while still omitting raw audio bytes, raw transcript text, media paths, filesystem paths, and proof-acceptance flags.
- Verification passed: `node --check` for changed recorder store/audio/raw API modules and audio tests, `node --test sidecar-tests/recorder-audio.test.mjs` (`7/7`), `node --test sidecar-tests/recorder-store.test.mjs` (`3/3`), `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`8/8`), `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs` (`1/1`), `npm run build:sidecar`, `npm run test:swift:unit` (`567/567`), `npm run check:public-safety`, and `git diff --check` for touched files.
- Remaining Gate C gaps include actual local transcription execution with on-device/local-only transcripts, actual System Audio permission/capture implementation, live timeline/manual UI validation for encrypted media and browser metadata, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift local-only speech transcription attempt slice

- Added `NSSpeechRecognitionUsageDescription` and a Swift `Speech.framework` adapter for microphone chunks. The adapter uses `SFSpeechURLRecognitionRequest` with `requiresOnDeviceRecognition=true`; it never retries with network/cloud transcription.
- The adapter only runs when Speech authorization is already granted. Missing authorization, unavailable local recognition, recognizer errors, empty results, or timeout degrade to `transcriptStatus=local_transcription_unavailable` with `transcriptionTerminalState=local_unavailable_no_cloud_fallback`.
- When on-device Speech returns a final local result, Swift emits `transcriptStatus=local_complete`, `localTranscriberName=apple-speech-on-device`, the OS version as local transcriber version, and raw-local transcript segments. Those segments are `safeForSearch=false`, `safeForMemory=false`, `redactionStatus=not_redacted`, and have no redacted text, so local transcript execution does not create search/memory/proof material before a redaction path exists.
- The microphone collector now marks the chunk as in-flight while local transcription/encryption is processing, preventing overlapping chunks. If the user stops capture while the local transcription attempt is still running, the async completion does not send the stale chunk afterward.
- Added Swift unit coverage for the local-complete transcript envelope seam and kept the existing unavailable/no-cloud encrypted microphone payload coverage.
- Verification passed: `plutil -lint agentic30/Info.plist` and `npm run test:swift:unit` (`568/568`).
- Remaining Gate C gaps include transcript redaction/search eligibility for local transcripts, actual System Audio permission/capture implementation, live microphone/Speech permission validation, live timeline/manual UI validation for encrypted media and browser metadata, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C local transcript redaction/search eligibility slice

- Added sidecar-owned transcript redaction in `recorder-audio.mjs` for `local_complete` transcript segments. Swift still sends raw-local Speech output without claiming redaction; the sidecar derives redacted transcript text before FTS/search/memory eligibility is granted.
- Transcript redaction now reuses the runtime secret redactor and additionally masks email addresses, URL spans, and phone-shaped numbers before a segment can become search-safe.
- Local transcript segments with derived search-safe redaction are promoted to `safe_for_search=1` and `safe_for_memory=1`; raw transcript text remains raw-local in the recorder DB, but receipts, raw API DTOs, and FTS expose only redacted text and continue to carry `rawTranscriptExposed=false`.
- Existing unsafe-search validation remains fail-closed when a caller explicitly supplies a non-search-safe redaction status.
- Added sidecar coverage proving derived redaction indexes the preserved safe phrase, does not index raw email/token/url text, does not leak raw transcript/media paths in receipts, and keeps proof acceptance false through the existing audio receipt boundary.
- Verification passed: `node --check sidecar/recorder-audio.mjs`, `node --check sidecar-tests/recorder-audio.test.mjs`, `node --test sidecar-tests/recorder-audio.test.mjs` (`8/8`), `node --test sidecar-tests/recorder-store.test.mjs` (`3/3`), `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`8/8`), `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs` (`1/1`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check` for touched files.
- Remaining Gate C gaps include actual System Audio permission/capture implementation, live microphone/Speech permission validation, live timeline/manual UI validation for encrypted media and browser metadata, and live app/manual UI E2E validation.

### 2026-06-29 KST — Gate C Swift System Audio collector slice

- Replaced the Swift-side hard-coded `systemAudio=unavailable` probe with a concrete ScreenCaptureKit availability and Screen Recording permission probe. The permission state now reports `granted`, `denied`, or `unavailable` instead of pretending the surface has no implementation path.
- Added a local ScreenCaptureKit System Audio collector behind the existing sensitive-capture policy. It starts only when the recorder is active, consent is granted, `systemAudio` permission is granted, and the `systemAudio` opt-in flag is enabled.
- The collector uses `SCStream` audio sample output (`capturesAudio=true`, `excludesCurrentProcessAudio=true`) and writes each chunk to a temporary local `.m4a` via `AVAssetWriter`, then reuses the existing encrypted audio media envelope with `source=system_audio`.
- System Audio chunks continue through the same sidecar-owned `recorder_audio_chunk_record` route, policy enforcement, encryption requirement, transcript no-cloud state, raw API/audit boundary, and proof-non-acceptance contract as microphone chunks. No new sidecar route or proof path was added.
- Added explicit root-cause errors for missing runtime permission, ScreenCaptureKit unavailability, stream start/stop failures, writer failures, no samples, and empty output files.
- Added Swift unit coverage proving the permission probe emits a concrete System Audio state and proving encrypted `system_audio` payloads use the existing sidecar audio route.
- Verification passed: first Swift unit run failed on an SDK compile issue (`AVAssetWriterInput` has no `error` member), then after fixing the writer error source `npm run test:swift:unit` passed (`569/569`), `node --test sidecar-tests/recorder-audio.test.mjs` passed (`8/8`), `npm run check:public-safety` passed, and `git diff --check` passed for touched Swift/SPEC files.
- Remaining Gate C gaps include live System Audio permission/capture validation on the signed app, live microphone/Speech permission validation, live timeline/manual UI validation for encrypted media and browser metadata, and live app/manual UI E2E validation. This slice is `actual_collector` for Swift System Audio but not `e2e_accepted`.

### 2026-06-29 KST — Gate B Swift raw SQL inspector UI slice

- Added Swift `RecorderSqlQueryResult` / `RecorderSqlCell` decoding for the sidecar `/recorder/sql/query` response, including snake_case and camelCase field support, mixed JSON cell values, redacted-view metadata, and proof-boundary flags.
- Added a Founder Replay Control-mode `Raw SQL Inspector` panel that requests local `raw_sql` tokens, posts inspector queries to the loopback raw API with `includeRawColumns=false`, and renders a bounded redacted result table plus query fingerprint, row count, truncation, timeout, path exposure, and proof-write status.
- The Swift token flow uses a dedicated `agentic30-recorder-sql-inspector` client ID and never requests `raw_admin`. Successful SQL responses refresh the existing Raw API Audit panel so local reads remain inspectable.
- Added focused Swift unit coverage for the `raw_sql` token request payload and SQL result decoder. The sidecar route coverage remains in `recorder-raw-api-server.test.mjs`.
- Verification passed: `xcodebuild build -project agentic30.xcodeproj -destination 'platform=macOS' -scheme agentic30 CODE_SIGNING_ALLOWED=NO`, `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`8/8`), `npm run check:public-safety`, and final `git diff --check` across the touched files.
- Swift unit execution is now accepted for this slice: `xcodebuild build-for-testing -project agentic30.xcodeproj -destination 'platform=macOS' -scheme agentic30 -only-testing:agentic30Tests -derivedDataPath /tmp/agentic30-sql-build-for-testing CODE_SIGNING_ALLOWED=NO` passed, then raw `xcodebuild test-without-building ... -only-testing:agentic30Tests ... -resultBundlePath /tmp/agentic30-sql-test-without-building.xcresult` passed (`571/571`). `sparkshell` remained stale around the test execution wrapper, so the accepted evidence is the raw xcodebuild exit/result bundle, not the stale wrapper.
- Live app/manual UI E2E was not run. Remaining Gate B SQL gaps are live app/manual UI validation for the new inspector panel and SQLite authorizer/progress-handler hooks if the runtime later exposes them.

### 2026-06-29 KST — Gate B raw SQL comma-join bypass hardening slice

- Hardened `extractSqlSources()` so the raw SQL inspector also scans top-level comma-separated `FROM` entries, not only `FROM` and explicit `JOIN` tokens. This closes the bypass where an allowlisted view could be followed by a base table through legacy comma join syntax.
- Added regression coverage for comma-join attempts that introduce `frames`, bracket-quoted `[frames]`, and quoted `"api_tokens"` after an allowlisted redacted view. Each is rejected with `ERR_RECORDER_RAW_API_SQL_BASE_TABLE_REJECTED`.
- Verification passed: `node --check sidecar/recorder-raw-api-server.mjs` and `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`8/8`).
- Remaining Gate B SQL gaps are broader Unicode/token-spacing adversarial coverage and SQLite authorizer/progress-handler hooks if the runtime later exposes them.

### 2026-06-29 KST — Gate B raw SQL adversarial corpus expansion slice

- Expanded the raw SQL inspector route-level adversarial corpus for Unicode/token-spacing and source parsing variants that must stay rejected even when the string validator is the first line of defense.
- Added coverage for non-breaking-space token separation, quoted base tables, recursive CTE reads from `api_tokens`, `UNION` reads from `api_tokens`, schema-qualified base-table reads (`main.frames`), bracket-quoted raw columns, and spaced `load_extension ( ... )` function calls.
- These cases prove the current validator rejects with named root-cause errors before execution and keeps the `/recorder/sql/query` response free of SQL rows on denial.
- Verification passed: `node --check sidecar-tests/recorder-raw-api-server.test.mjs` and `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`8/8`).
- Remaining Gate B SQL gap is true SQLite authorizer/progress-handler enforcement if the runtime later exposes it.

### 2026-06-29 KST — Gate B raw SQL copied-view sandbox worker slice

- Checked the installed `better-sqlite3` runtime (`12.8.0`): it exposes `Statement#columns()` and read-only/query-only controls, but not SQLite authorizer or progress-handler hooks.
- Added a second execution boundary in `recorder-sql-worker.mjs`: the worker opens the recorder DB read-only, copies only the validator-approved inspector views into an in-memory SQLite database, sets `query_only=ON`, and executes the user SQL against that copied-view sandbox instead of the recorder DB.
- The server now passes the validator-approved `plan.sources` into the worker. If a future validator miss lets a base table through syntactically, the worker sandbox still has no base tables to read.
- Added direct worker coverage proving an allowed redacted view query succeeds while `SELECT id FROM frames LIMIT 1` fails with no `frames` table when only `recorder_sql_frames_redacted` was copied.
- Verification passed: `node --check sidecar/recorder-sql-worker.mjs`, `node --check sidecar/recorder-raw-api-server.mjs`, `node --check sidecar-tests/recorder-raw-api-server.test.mjs`, `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`9/9`), `npm run build:sidecar`, and `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs` (`1/1`) after restoring local `node_modules` with `npm install`.
- Remaining Gate B SQL gap is native SQLite authorizer/progress-handler enforcement if the selected runtime later exposes those hooks; current implementation now has string validation, read-only source DB, copied-view sandbox execution, query-only execution DB, and worker timeout interruption.

### 2026-06-29 KST — Gate B raw SQL downstream-boundary flags slice

- Made `/recorder/sql/query` responses explicitly non-eligible for downstream product paths, not only proof: SQL results now emit `safeForSearch=false`, `safeForMemory=false`, `safeForExport=false`, `providerPromptAllowed=false`, `pipeOutputAllowed=false`, and `dayProgressWriteAllowed=false` alongside the existing proof-deny flags.
- Swift `RecorderSqlQueryResult` now decodes the downstream-deny flags, and the Founder Replay Control-mode SQL inspector shows a compact `downstream off` status pill when all forbidden paths remain closed.
- Updated focused sidecar and Swift decoder coverage so the raw SQL inspector contract proves local SQL output cannot silently become search, memory, export, provider prompt, Pipe output, Day progress, or proof material.
- Verification passed: `node --check sidecar/recorder-raw-api-server.mjs`, `node --check sidecar-tests/recorder-raw-api-server.test.mjs`, `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (`9/9`), `npm run test:swift:unit` (`571/571` after fixing the local `HStack` return compile issue introduced in this slice), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check`.
- Live app/manual UI E2E was not run. Remaining Gate B SQL gaps are live app/manual UI validation for the inspector panel and native SQLite authorizer/progress-handler enforcement if the selected runtime later exposes those hooks.

### 2026-06-29 KST — Gate C audio deletion and retention slice

- Extended recorder deletion beyond frame media with `deleteRecorderAudioChunksInRange()`: scoped audio chunk deletion now tombstones `audio_chunks`, marks linked `media_assets` deleted, tombstones linked `transcript_segments`, clears transcript search/memory eligibility, records `deletion_source_id`, and physically removes the local `.m4a` file.
- Added `resolveRecorderAudioMediaPath()` with the same recorder-root containment checks as frame deletion, requiring audio media to stay under `media/audio/` and failing with named root-cause errors for absolute, escaping, wrong-prefix, missing, non-file, or unexpected media rows.
- Extended retention policy with `rawAudioRetentionHours` / `raw_audio_retention_hours`. Retention plans now include separate audio targets and transcript counts, but expose only IDs/counts and `pathExposed=false`; resolved filesystem paths are used internally only.
- `applyRecorderRetentionPolicy()` now applies expired frame and audio media retention, including a preflight over all planned frame and audio files before any mutation so a missing audio file cannot partially delete frame rows/media first.
- Added focused coverage for audio deletion, transcript FTS purge, missing audio media fail-before-mutation, expired audio retention planning/application, and mixed frame+audio retention preflight.
- Verification passed: `node --check sidecar/recorder-delete.mjs`, `node --check sidecar/recorder-retention.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --check sidecar-tests/recorder-retention.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs` (`14/14`), `node --test sidecar-tests/recorder-audio.test.mjs sidecar-tests/recorder-store.test.mjs` (`11/11`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check`.
- Remaining Gate C deletion/retention gaps include memory items, evidence candidates, Pipe outputs, audits, exports, and a live/manual acceptance pass for the signed app surfaces. Audio deletion/retention is now covered at the sidecar store/media level, not `e2e_accepted`.

### 2026-06-29 KST — Gate C clipboard deletion and retention slice

- Added `deleteRecorderClipboardEventsInRange()` for scoped clipboard cleanup. It tombstones matching `clipboard_events`, clears `content_text`, resets `content_captured=0`, disables search/memory/export eligibility, and leaves no raw clipboard content in redacted or raw-admin SQL inspector views.
- Extended retention policy with `rawClipboardRetentionHours` / `raw_clipboard_retention_hours`. Retention plans now include clipboard targets with IDs, timestamps, capture mode, and content-captured booleans only; raw clipboard text and paths stay unexposed.
- `applyRecorderRetentionPolicy()` now applies expired clipboard retention alongside frame/audio retention and reports deleted clipboard event and purged content counts.
- Added focused coverage for scoped clipboard deletion, raw content purge, redacted/raw-admin SQL view removal, expired clipboard retention planning, retention application, and no raw content exposure in retention manifests.
- Verification passed: `node --check sidecar/recorder-delete.mjs`, `node --check sidecar/recorder-retention.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --check sidecar-tests/recorder-retention.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs sidecar-tests/recorder-clipboard.test.mjs` (`20/20`), `node --test sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs` (`12/12`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check`.
- Remaining Gate C deletion/retention gaps include memory items, product events, evidence candidates, Pipe outputs, audits, exports, and a live/manual acceptance pass for the signed app surfaces. Clipboard deletion/retention is now covered at the sidecar store/SQL-view level, not `e2e_accepted`.

### 2026-06-29 KST — Gate C memory and product-event deletion and retention slice

- Added `deleteRecorderMemoryItemsInRange()` for scoped memory cleanup. It tombstones matching `memory_items` and clears search/memory/export eligibility so deleted memories leave FTS and downstream sinks without deleting unrelated workspace/project rows.
- Added `deleteRecorderProductEventsInRange()` for scoped product-event cleanup. It tombstones matching `product_events` and clears search/memory/export eligibility while preserving `proof_ledger_event_id` and `verification_status`, so local retention does not rewrite historical proof-ledger linkage.
- Extended retention policy with `memoryRetentionHours` / `memory_retention_hours` and `productEventRetentionHours` / `product_event_retention_hours`. Retention plans now include derived-data targets with IDs, type/status, timestamps, proof-link booleans, and explicit `contentExposed=false` / `pathExposed=false`; title, summary, event summary, raw content, and paths are not exposed in the plan/result manifest.
- `applyRecorderRetentionPolicy()` now applies expired memory and product-event retention alongside frame/audio/clipboard retention and reports deleted memory-item and product-event counts.
- Added focused coverage for scoped memory tombstoning, memory FTS purge, product-event tombstoning with proof-link preservation, product-event FTS purge, expired memory/product-event retention planning, retention application, and no content/label exposure in retention manifests.
- Verification passed: `node --check sidecar/recorder-delete.mjs`, `node --check sidecar/recorder-retention.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --check sidecar-tests/recorder-retention.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs` (`21/21`), `node --test sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs` (`12/12`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check`.
- Remaining Gate C deletion/retention gaps include evidence candidates, Pipe outputs, audits, exports, and a live/manual acceptance pass for the signed app surfaces. Memory/product-event deletion/retention is now covered at the sidecar store/FTS level, not `e2e_accepted`.

### 2026-06-29 KST — Gate C evidence-candidate deletion and retention slice

- Added `deleteRecorderEvidenceCandidatesInRange()` for scoped evidence-candidate cleanup. It tombstones matching `evidence_candidates`; unresolved proof debt (`pending_review`, `degraded`, `approved_bundle`) is explicitly moved to `rejected` with an `ERR_RECORDER_EVIDENCE_CANDIDATE_DELETED` verifier-result root cause, while already resolved rows keep their review status.
- Written proof candidates preserve `proof_ledger_event_id` and `candidate_status=written_to_ledger` when tombstoned, so local recorder retention does not rewrite the historical proof-ledger boundary.
- Extended retention policy with `evidenceCandidateRetentionHours` / `evidence_candidate_retention_hours`. Retention plans target only resolved candidates (`rejected`, `verifier_rejected`, `written_to_ledger`) by `reviewed_at`; old unresolved candidates stay visible for review instead of silently disappearing by age.
- Evidence-candidate retention manifests include only IDs, status, source state, proof kind, reviewed/created timestamps, proof-link booleans, and explicit `contentExposed=false` / `pathExposed=false`; claims, proof-ledger mapping JSON, evidence debt, source IDs, raw text, and paths are not exposed.
- `applyRecorderRetentionPolicy()` now applies expired resolved evidence-candidate retention alongside frame/audio/clipboard/memory/product-event retention and reports deleted and rejected evidence-candidate counts.
- Added focused coverage for scoped candidate tombstoning, unresolved-candidate rejection root cause, proof-link preservation, resolved-only retention planning, pending-candidate retention exclusion, retention application, and no claim/proof/source payload exposure in retention manifests.
- Verification passed: `node --check sidecar/recorder-delete.mjs`, `node --check sidecar/recorder-retention.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --check sidecar-tests/recorder-retention.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs` (`24/24` after the final bundled rebuild), `node --test sidecar-tests/recorder-evidence-candidates.test.mjs sidecar-tests/recorder-evidence-review.test.mjs sidecar-tests/recorder-evidence-inbox-builder.test.mjs sidecar-tests/recorder-proof-ledger-adapter.test.mjs` (`15/15`), `node --test sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs` (`12/12`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check`.
- Remaining Gate C deletion/retention gaps include Pipe outputs, audits, exports, and a live/manual acceptance pass for the signed app surfaces. Evidence-candidate deletion/retention is now covered at the sidecar store/proof-boundary level, not `e2e_accepted`.

### 2026-06-29 KST — Gate C Pipe output deletion and retention slice

- Bumped `recorder.sqlite` schema to v5 and added `pipe_runs.deleted_at` with a forward migration for existing recorder databases. New Pipe run rows start with `deleted_at=null`, and Pipe run DTOs now expose the tombstone timestamp.
- Added `deleteRecorderPipeRunsInRange()` for scoped Pipe output cleanup. It targets only terminal runs (`succeeded`, `failed`, `cancelled`, `timed_out`) with an existing `output_manifest_json`, clears the output manifest, sets `deleted_at`, and preserves lifecycle status, timestamps, `audit_log_json`, and `error_message`.
- Extended retention policy with `pipeOutputRetentionHours` / `pipe_output_retention_hours`. Retention plans target terminal Pipe outputs by `ended_at`; queued/running or output-less runs are not purged by output retention.
- Pipe output retention manifests include only run id, pipe id, run status, output kind, timestamps, artifact/action-result counts, and explicit `contentExposed=false` / `pathExposed=false` / `proofAcceptedByPipeRun=false`; output manifest JSON, item payloads, artifact payloads, raw text, and paths are not exposed.
- `applyRecorderRetentionPolicy()` now purges expired Pipe output manifests alongside frame/audio/clipboard/memory/product-event/evidence-candidate retention and reports deleted Pipe run and purged output counts.
- Added focused coverage for scoped Pipe output purge, terminal-only targeting, queued-run exclusion, audit preservation, schema migration column presence, retention planning/application, and no Pipe manifest payload exposure in retention manifests.
- Verification passed: `node --check sidecar/recorder-store.mjs`, `node --check sidecar/recorder-pipes.mjs`, `node --check sidecar/recorder-delete.mjs`, `node --check sidecar/recorder-retention.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --check sidecar-tests/recorder-retention.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs` (`27/27` after the final bundled rebuild), `node --test sidecar-tests/recorder-pipes.test.mjs sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs` (`21/21`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check`.
- Remaining Gate C deletion/retention gaps include audits, exports, and a live/manual acceptance pass for the signed app surfaces. Pipe output deletion/retention is now covered at the sidecar store/manifest level, not `e2e_accepted`.

### 2026-06-29 KST — Gate C audit tombstone retention slice

- Bumped `recorder.sqlite` schema to v6 and added `recorder_audit.deleted_at` with a forward migration for existing recorder databases. New raw API audit rows start with `deleted_at=null`.
- Added `deleteRecorderAuditRowsInRange()` for scoped audit cleanup. It sets `deleted_at` only and preserves request id, actor type/id, workspace/project scope, endpoint, access level, source ids, decision, reason, and created timestamp for accountability.
- Extended retention policy with `auditRetentionHours` / `audit_retention_hours`. Audit retention plans target audit rows by `created_at` and mark them as `tombstoneOnly=true`; they do not claim media/data deletion.
- Audit retention manifests include only audit id, endpoint, access level, decision, created timestamp, and explicit `tombstoneOnly=true` / `contentExposed=false` / `pathExposed=false`; request ids, actor ids, source IDs, and raw payloads are not exposed in the plan/result manifest.
- Raw API audit listing and the `buildRecorderAuditSource()` DTO now include `deletedAt` / `deleted_at`, so tombstoned audit rows remain visible as accountable access-history records.
- `applyRecorderRetentionPolicy()` now tombstones expired audit rows alongside frame/audio/clipboard/memory/product-event/evidence-candidate/Pipe-output retention and reports tombstoned audit-row counts separately from destructive delete counts.
- Added focused coverage for scoped audit tombstoning, accountability-field preservation, sanitized audit-source rendering of tombstones, schema migration column presence, retention planning/application, and no request/actor/source payload exposure in retention manifests.
- Verification passed: `node --check sidecar/recorder-store.mjs`, `node --check sidecar/recorder-raw-api-auth.mjs`, `node --check sidecar/recorder-audit-source.mjs`, `node --check sidecar/recorder-raw-api-server.mjs`, `node --check sidecar/recorder-delete.mjs`, `node --check sidecar/recorder-retention.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --check sidecar-tests/recorder-retention.test.mjs`, `node --check sidecar-tests/recorder-audit-source.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs` (`30/30` after the final bundled rebuild), `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs sidecar-tests/recorder-audit-source.test.mjs sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs` (`44/44`), `npm run build:sidecar`, `npm run check:public-safety`, and `git diff --check`.
- Remaining Gate C deletion/retention gaps include exports and a live/manual acceptance pass for the signed app surfaces. Audit retention is now covered at the sidecar store/raw-API DTO level, not `e2e_accepted`.

### 2026-06-29 KST — Gate C export archive deletion and retention slice

- Raw API export archive creation now registers each local archive JSON as a managed `media_assets` row with `asset_type=export_bundle`, scoped workspace/project ids, SHA-256, byte size, creation timestamp, and `deleted_at=null`. The raw API response still keeps `pathExposed=false` and does not expose the archive filesystem path.
- Added `deleteRecorderExportArchivesInRange()` for scoped export cleanup. It targets only managed `export_bundle` media assets by `created_at`, validates the persisted relative path under `exports/*.json`, preflights every archive file before mutation, tombstones the media asset, and physically removes the local archive JSON.
- Extended retention policy with `exportArchiveRetentionHours` / `export_archive_retention_hours`. The default is long-lived/user-owned (`87600` hours), while configured retention targets only managed export archives and reports deleted export-archive/media counts separately.
- Export archive retention manifests include only archive/media ids, creation timestamp, byte size, SHA-256, and explicit `contentExposed=false` / `pathExposed=false` / `proofAcceptedByExport=false`; archive JSON content, filesystem paths, export manifest payloads, and copied raw data are not exposed.
- Added focused coverage for raw API managed-asset registration, scoped archive deletion, physical JSON removal, workspace isolation, retention planning/application, and no archive path/content exposure in retention plans or results.
- Verification passed: `node --check sidecar/recorder-delete.mjs`, `node --check sidecar/recorder-retention.mjs`, `node --check sidecar/recorder-raw-api-server.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --check sidecar-tests/recorder-retention.test.mjs`, `node --check sidecar-tests/recorder-raw-api-server.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs sidecar-tests/recorder-store.test.mjs` (`45/45`), `npm run build:sidecar`, `npm run check:public-safety`, `git diff --check`, post-build `node --test sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs` (`33/33`), broader `npm run test:sidecar` (`2310/2313` pass, `3` skipped, no failures), and `npm run test:swift:unit` (`572/572`).
- Gate C deletion/retention is now covered at the sidecar store/file level for frames, AX/OCR/search rows, browser/document metadata through frame retention, clipboard content, audio/transcripts, memory, product events, evidence candidates, Pipe outputs, audits, and export archives. It is not `e2e_accepted`; remaining readiness work still requires live/manual acceptance on signed app surfaces and the required adversarial/readiness reviews before any final implementation-readiness claim.

### 2026-06-29 KST — Post-`insane-review` recorder hardening status

- A full `insane-review` source pack (~4.50M tokens) and a focused 25-file pack (~1.03M tokens) both reached ChatGPT GPT-5.5 Pro with model verification but could not create a user turn because the send control stayed disabled. Narrow recorder packs were therefore used for the sidecar/store hardening review, while preserving the failed large-pack blocker as a non-readiness condition.
- The first successful narrow recorder review (`.insane-review/response_prj_20260629_205956_95790_7baa1b.md`, ~159k tokens) returned **Blocked**. Follow-up GPT-5.5 Pro reviews also returned **Blocked** while checking: browser URL/domain FTS sanitization, clipboard Gate C envelope migration, export archive registration cleanup, retention fail-before-mutation archive preflight, non-expired source-linked archive invalidation, fixed-point derived-row invalidation, direct evidence-candidate archive invalidation, and same-table memory/product derived-row deletion. Blocking response artifacts include `.insane-review/response_prj_20260629_215619_36851_87f6d1.md`, `.insane-review/response_prj_20260629_221458_88655_4058f1.md`, `.insane-review/response_prj_20260629_222834_15726_1076aa.md`, `.insane-review/response_prj_20260629_224033_41058_66dcba.md`, `.insane-review/response_prj_20260629_225051_49281_a55f75.md`, `.insane-review/response_prj_20260629_230309_58535_d547ab.md`, and `.insane-review/response_prj_20260629_231626_66508_421d38.md`.
- The final focused GPT-5.5 Pro recorder review passed (`.insane-review/response_prj_20260629_232802_72018_4ed024.md`, ~194k tokens). Scope of the PASS: sidecar/store hardening only. GPT accepted the fixed-point source-ref closure across `memory_items`, `product_events`, `evidence_candidates`, and Pipe output refs; archive preflight/unlink/tombstone reuse of that closure; direct evidence-candidate export archive invalidation; cleanup failure surfacing for failed archive registration; browser URL/domain FTS sanitization; Gate C clipboard envelope/policy; raw API request-id enforcement; injected interactive archive approval; deletion-time sensitive-field clearing; unlink-before-tombstone ordering; ordered retention scans; and WAL checkpoint/vacuum maintenance.
- Post-review implementation fixes now cover: redacted `browser_domain` / `browser_url_search_label` storage and FTS migration instead of raw/normalized URL indexing; canonical Gate C clipboard envelope storage/migration (`captured_at`, `policy_mode`, `source_app_name`, `source_window_title`, `content_size`, `suppression_reason`, `raw_retention_expires_at`); managed export archive source maps (`media_assets.source_ids_json`); fixed-point source-aware archive unlink/tombstone invalidation; explicit post-retention store maintenance with WAL checkpoint and vacuum policy; deletion-time clearing for frame URL/document/text, transcript text, clipboard content/hash/text/size/raw-retention metadata, memory/product summaries, and evidence candidate payloads; required `x-agentic30-recorder-request-id` on raw API requests; interactive export approval through an injected verifier instead of trusting `approvedByLocalUser`; archive-file cleanup when media-asset registration fails; and fail-before-mutation preflight for direct media, direct archives, and source-linked archives.
- Focused verification passed after the final blocker fixes: `node --check` on changed recorder modules/tests, focused delete/retention/raw-API suites (`53/53`), and full recorder glob `node --test sidecar-tests/recorder-*.test.mjs` (`132/132`).
- Final non-UI verification passed after the focused GPT-5.5 PASS: full `npm run test:sidecar` (`2330` passed, `3` skipped, `0` failed), forced `AGENTIC30_FORCE_SIDECAR_BUILD=1 npm run build:sidecar` with bundled `better-sqlite3` rebuild, `npm run check:public-safety`, and `git diff --check`. The forced build still reports the existing npm audit/deprecation warnings.
- Remaining blockers before any readiness claim: the full/focused large-pack `insane-review` attempts remain blocked by the ChatGPT send-button failure, and no live/manual signed-app acceptance pass has been run. This status is sidecar/store-level hardening, not `actual_collector + ui_wired + e2e_accepted`.

### 2026-06-30 KST — Approved blocking UI E2E run and Office Hours/Intake repair

- With explicit local approval for foreground UI E2E, smoke verification passed: `OMO_SPARKSHELL_SPARK=0 omo sparkshell -- env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` executed `16` selected UI tests with `0` failures. Result bundle: `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.06.30_07-01-57-+0900.xcresult`.
- The first full direct run failed with `57` tests executed and `3` failures. Result bundle: `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.06.30_07-12-24-+0900.xcresult`. Failing tests were `testIntakeV2ScanWaitDoesNotShowEarlyAnswerQuestions`, `testIntakeV2ScanWaitRendersInDarkTheme`, and `testOpenDesignDayHandoffFlowSmoke`.
- Root cause 1: `requiresMacOnboarding` treated `AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES=1` as an unconditional onboarding bypass, so scan-wait UI tests jumped to `workspace.surface` instead of the Intake V2 focus-area step. The shortcut was removed so tests with inline provider stubs still honor the real onboarding state.
- Root cause 2: the Office Hours first-question structured prompt used a taller footer than later questions, pushing `assistant.structuredContinueButton` just below the measured `opendesign.officeHours.main.scroll` viewport (`-5.5` bottom gap). The Office Hours structured-prompt footer now uses the same compact vertical spacing across questions.
- Targeted verification passed after the fixes: `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 bash scripts/xcode-test.sh ui-full -only-testing:agentic30UITests/agentic30UITests/testIntakeV2ScanWaitDoesNotShowEarlyAnswerQuestions -only-testing:agentic30UITests/agentic30UITests/testIntakeV2ScanWaitRendersInDarkTheme -only-testing:agentic30UITests/agentic30UITests/testOpenDesignDayHandoffFlowSmoke` executed `3` tests with `0` failures. Result bundle: `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.06.30_07-42-27-+0900.xcresult`.
- Full post-fix UI E2E passed: `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:full` executed `57` tests with `0` failures in `1213.818s`. Result bundle: `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.06.30_07-46-29-+0900.xcresult`.
- This closes the blocking debug-app UI E2E failure found during the approved run. It still does not replace live/manual signed-app acceptance for ScreenCaptureKit/media timelines, permissions, encrypted media preview, or real recorder capture behavior, and it does not resolve the earlier large-pack ChatGPT send-button blocker.

### 2026-06-30 KST — Gate A mode-specific recorder readiness slice

- Extended `evaluateRecorderCaptureReadiness()` with explicit `modeReadiness` / `mode_readiness` DTOs for `core_frame_capture_ready`, `event_driven_capture_ready`, `ocr_text_completion_ready`, and `sensitive_capture_ready` while keeping legacy `canRecord` as the core frame-capture compatibility flag.
- Missing Input Monitoring now blocks only the `event_driven_capture_ready` mode with `input_monitoring_missing`, so manual/scheduled ScreenCaptureKit frame capture can stay available while the app cannot claim event-driven readiness.
- Missing Vision OCR now blocks only the `ocr_text_completion_ready` mode with `vision_ocr_unavailable_named_root_cause`, keeping AX-only capture separate from OCR-complete text capture.
- Sensitive capture readiness now checks explicit clipboard-content, microphone, and System Audio opt-ins plus their expanded-media permission policy. Raw frames/search hits/mode status remain non-proof through `proofAcceptedByReadinessMode=false`.
- Swift now probes and sends `inputMonitoring` and `visionOcr` permission states in `refreshRecorderPermissionProbe()`. The Input Monitoring check uses `CGPreflightListenEventAccess()` plus a non-running listen-only `CGEvent.tapCreate()` runtime probe; it does not capture or log raw key values. Vision OCR readiness uses a local `VNRecognizeTextRequest` supported-language runtime probe.
- Founder Replay Control now decodes and renders the mode-specific readiness rows so the UI can show core/event/OCR/sensitive readiness separately instead of only the top-level `can record` state.
- Verification passed: `node --check sidecar/recorder-control-state.mjs`, `node --test sidecar-tests/recorder-control-state.test.mjs` (`5/5`), `npm run test:swift:unit` (`572/572`), `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run test:sidecar` (`2330` passed, `3` skipped, `0` failed), approved foreground `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` (`16/16`, result bundle `Test-agentic30UITests-2026.06.30_08-46-31-+0900.xcresult`), `npm run check:public-safety`, and `git diff --check`.
- A raw `npm run test:sidecar` first failed `10` provider-runner tests because this shell had `AGENTIC30_TEST_STUB_PROVIDER=1` and a temporary `AGENTIC30_APP_SUPPORT_PATH`; rerunning with those two environment variables removed produced the passing result above.
- This slice is `sidecar_policy_only + ui_wired` for mode-specific readiness and Swift permission probing. It is not `e2e_accepted`: live signed-app validation still needs to prove Input Monitoring registration/settings behavior, the event-tap runtime probe under real TCC state, Vision OCR probe behavior on target macOS versions, and UI-visible mode transitions during actual recorder operation.

### 2026-06-30 KST — Gate A frame text provenance enforcement slice

- `normalizeFrameCaptureEnvelope()` now accepts only the four Gate A text provenance states: `accessibility_only`, `ocr_only`, `ax_plus_ocr`, and `ocr_unavailable_named_root_cause`. Legacy/fake values such as `screen_capture`, `accessibility`, or `ocr` now fail explicitly with `ERR_RECORDER_INGEST_INVALID_TEXT_PROVENANCE`.
- The ingest validator checks the stored AX/OCR text shape against the declared provenance. AX-only rows require `accessibility_text` and no `ocr_text`; OCR-only rows require `ocr_text` and no `accessibility_text`; `ax_plus_ocr` requires both; OCR-unavailable rows require a named `text_provenance_root_cause` and no OCR text.
- Bumped `recorder.sqlite` to schema v11 with `frames.text_provenance_root_cause`. The migration canonicalizes old local rows by deriving strict provenance from existing `accessibility_text` / `ocr_text`, and maps legacy no-text `screen_capture` rows to `ocr_unavailable_named_root_cause` with `legacy_screen_capture_text_extraction_unavailable`.
- Frame receipts and raw API frame DTOs now expose `textSource` / `text_source` plus `textProvenanceRootCause` / `text_provenance_root_cause`. SQL inspector frame views expose the same root-cause metadata while leaving raw AX/OCR text gated to raw-admin views as before.
- Swift ScreenCaptureKit frame capture no longer labels screenshots as `screen_capture`; until local AX/OCR extraction is implemented on that path, it sends `ocr_unavailable_named_root_cause` with `screen_capture_text_extraction_not_implemented`. Founder Replay frame rows render the provenance/root-cause status so the UI does not hide OCR gaps.
- Verification passed: `node --check sidecar/recorder-ingest.mjs`, `node --check sidecar/recorder-store.mjs`, `node --check sidecar/index.mjs`, `node --check sidecar/recorder-raw-api-server.mjs`, focused recorder suite `node --test sidecar-tests/recorder-ingest.test.mjs sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs sidecar-tests/recorder-raw-api-runtime.test.mjs sidecar-tests/recorder-delete.test.mjs sidecar-tests/recorder-retention.test.mjs sidecar-tests/recorder-search.test.mjs sidecar-tests/recorder-day-memory-review.test.mjs sidecar-tests/recorder-day-loop.test.mjs sidecar-tests/recorder-pipes.test.mjs sidecar-tests/recorder-control-state.test.mjs` (`93/93`), `npm run test:swift:unit` (`572/572`, result bundle `Test-agentic30-2026.06.30_09-08-44-+0900.xcresult`), `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run test:sidecar` (`2333` passed, `3` skipped, `0` failed), approved foreground `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` (`16/16`, result bundle `Test-agentic30UITests-2026.06.30_09-12-04-+0900.xcresult`), `npm run check:public-safety`, and `git diff --check`.
- This slice is `sidecar_policy_only + ui_wired` for text provenance enforcement. It is not `actual_collector` or `e2e_accepted` for OCR: live signed-app validation still needs real Accessibility extraction, local Vision OCR extraction/fallback, and UI-visible transitions from `ocr_unavailable_named_root_cause` to `accessibility_only` / `ocr_only` / `ax_plus_ocr` during actual recorder operation.

### 2026-06-30 KST — Gate A local AX/OCR frame text extraction slice

- The Swift ScreenCaptureKit frame capture path now attempts local text extraction before ingest. If Accessibility is trusted, it takes a bounded raw AX snapshot from the focused element, focused window, and app-level AX attributes (`AXSelectedText`, `AXValue`, `AXTitle`, `AXDescription`, `AXHelp`).
- The same capture path runs a local `VNRecognizeTextRequest` over the captured `CGImage`. No cloud OCR/VLM fallback was added. OCR failures/no-text states stay named root causes rather than falling back to fake text completion.
- The frame envelope now derives the strict Gate A provenance from actual text availability: `ax_plus_ocr` when both collectors return text, `accessibility_only` for AX-only text, `ocr_only` for Vision-only text, and `ocr_unavailable_named_root_cause` with a combined named root cause when neither collector returns text.
- Extracted AX/OCR text remains `raw_local`, `redactionStatus=not_redacted`, and `safeForSearch=false` / `safeForMemory=false` / `safeForExport=false`. This keeps raw screen text out of FTS, memory, export, provider prompts, and proof paths until a redaction adapter explicitly approves it.
- Verification passed: focused Swift compile/decode test `bash scripts/xcode-test.sh unit -only-testing:agentic30Tests/SidecarEventDecodingTests` (`130/130`, result bundle `Test-agentic30-2026.06.30_09-18-54-+0900.xcresult`), full `npm run test:swift:unit` (`572/572`, result bundle `Test-agentic30-2026.06.30_09-20-55-+0900.xcresult`), approved foreground `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` (`16/16`, result bundle `Test-agentic30UITests-2026.06.30_09-21-15-+0900.xcresult`), `npm run check:public-safety`, and `git diff --check`.
- This slice adds the local collector code path for manual ScreenCaptureKit frame capture, but it is still not a Gate A completion claim. It needs live signed-app acceptance that proves real TCC states, AX text extraction, Vision OCR text extraction/no-text root causes, sidecar ingest receipts, UI provenance transitions, and deletion/retention behavior under actual recorder operation.

### 2026-06-30 KST — Gate A redaction policy matrix enforcement slice

- Added `sidecar/recorder-redaction-policy.mjs` as the Gate A policy matrix for recorder-derived rows before they can become search, memory, export, provider, Pipe, day-progress, or proof inputs.
- `RecorderStore` now enforces the matrix at the insert/update boundary for `frames`, `transcript_segments`, `clipboard_events`, `memory_items`, `product_events`, and evidence-candidate references. This means unsafe `safe_for_search`, `safe_for_memory`, or `safe_for_export` rows fail before SQLite triggers can index them into FTS or downstream product code can consume them.
- Tables with `redaction_status` require a safe status plus required public text fields before any public sink eligibility is accepted. `product_events` do not currently have a `redaction_status` column, so the matrix requires public title/summary text and rejects obvious raw-sensitive patterns before a row can be marked safe for search, memory, or export.
- Existing defensive checks in the Evidence Inbox builder and Pipe path remain in place. Their tests now seed unsafe legacy/corrupt `product_events` rows through direct SQL to prove downstream rejection still works even if old data bypassed the newer store policy.
- Verification passed: `node --check sidecar/recorder-redaction-policy.mjs`, `node --check sidecar/recorder-store.mjs`, `node --check sidecar-tests/recorder-store.test.mjs`, `node --check sidecar-tests/recorder-evidence-inbox-builder.test.mjs`, `node --check sidecar-tests/recorder-pipes.test.mjs`, `node --check sidecar-tests/recorder-raw-api-server.test.mjs`, `node --test sidecar-tests/recorder-store.test.mjs` (`10/10`), focused recorder suite (`64/64`), `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run test:sidecar` (`2336` passed, `3` skipped, `0` failed), approved foreground `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` (`16/16`, result bundle `Test-agentic30UITests-2026.06.30_09-49-35-+0900.xcresult`), `npm run check:public-safety`, and `git diff --check`.
- An approved `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:full` attempt was interrupted and is not counted as passing evidence: after several minutes, the active app process still carried the `--ui-testing-seed-intake-scan-wait` arguments but the visible desktop showed an inconsistent Day 12 briefing surface rather than the expected intake wait state. The bounded UI smoke run above is the current accepted UI signal for this sidecar-policy slice.
- This slice is `sidecar_policy_only` for the redaction matrix. It does not complete Gate A redaction acceptance: live signed-app validation still needs the actual redaction adapter that turns raw local screen/audio/clipboard/document text into policy-approved public labels, proves FTS sync under real capture, and shows UI-visible search/memory/export eligibility transitions without leaking raw text.

### 2026-06-30 KST — Gate A browser/document metadata search-label slice

- Bumped `recorder.sqlite` to schema v12 with `frames.document_path_search_label`. The v12 migration adds the column, sanitizes existing frame metadata labels, and rebuilds frame FTS only when a `frames` table exists so partial legacy stores such as clipboard-only migrations still open.
- Frame FTS now indexes only `redacted_text`, app/window labels, `browser_domain`, `browser_url_search_label`, and `document_path_search_label`. It still never indexes `browser_url`, `browser_url_normalized`, or `document_path`.
- `RecorderStore` normalizes frame metadata before store writes: raw browser labels collapse to domain labels, raw document paths or path-looking document labels collapse to conservative type labels such as `md document`, and unsafe URL/path-looking metadata labels are rejected by the redaction policy if they survive normalization.
- Search results, `/recorder/search`, `/recorder/frames`, safe export frame items, and SQL inspector redacted frame views now expose the safe URL/document search labels while keeping raw URL/path fields restricted to raw-admin views and raw-frame permissions.
- Verification passed: `node --check` on changed recorder modules/tests, focused metadata surface suite `node --test sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-ingest.test.mjs sidecar-tests/recorder-search.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs sidecar-tests/recorder-pipes.test.mjs` (`39/39`), and full `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run test:sidecar` (`2336` passed, `3` skipped, `0` failed).
- This slice is `sidecar_policy_only` for the Gate A browser/document metadata indexing blocker. It is not a browser/document metadata completion claim: the actual macOS-accessible collector, degraded-state UI, live signed-app capture acceptance, and retention/delete acceptance for real browser/document metadata remain required before the surface can be marked `actual_collector + ui_wired + e2e_accepted`.

### 2026-06-30 KST — Gate A safe metadata label WebSocket/UI wiring slice

- Normal recorder frame WebSocket receipts now carry the safe metadata labels from the stored frame row: `browserDomain` / `browser_domain`, `browserUrlSearchLabel` / `browser_url_search_label`, and `documentPathSearchLabel` / `document_path_search_label`. The receipt still does not expose raw `browser_url`, `browser_url_normalized`, `document_path`, media relative paths, raw token hashes, or raw screen text.
- `recordFrameCaptureEnvelope()` now returns the `RecorderStore`-normalized frame/media rows after insert, so ingest receipts use the same browser/document label sanitization policy that SQLite persistence and FTS use. This prevents a pre-store response from reporting `null` for derived document labels while the stored row contains a safe type label.
- Swift `RecorderFrameCaptureReceipt` decodes both camelCase and snake_case safe metadata label keys. Founder Replay table rows render window/app context plus safe browser/document labels, using conservative labels such as `example.com` and `md document` rather than raw URL/path strings.
- Focused verification passed: `node --check sidecar/index.mjs`, `node --check sidecar/recorder-ingest.mjs`, `node --check sidecar-tests/recorder-raw-api-runtime.test.mjs`, `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs` (`1/1`), and `bash scripts/xcode-test.sh unit -only-testing:agentic30Tests/SidecarEventDecodingTests` (`130/130`, result bundle `Test-agentic30-2026.06.30_10-14-58-+0900.xcresult`).
- Broad non-UI verification passed after clearing this shell's UI/test overrides: `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run test:sidecar` (`2336` passed, `3` skipped, `0` failed). The unclean shell environment first failed provider-runner expectations because `AGENTIC30_TEST_STUB_PROVIDER=1` and `AGENTIC30_APP_SUPPORT_PATH=/tmp/...` were active.
- Approved UI E2E smoke was attempted with `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke`, but it is not acceptance evidence for this slice. All `16/16` selected UI tests failed before app assertions because XCUITest could launch the built app but could not activate it (`current state: Running Background`), with repeated `DebuggerLLDB.DebuggerVersionStore.StoreError error 0`, `no debugger version`, `sysmond service not found`, and `pkill: Cannot get process list`. A clean-env single-case retry of `testWorkspaceStartupDay1RoutesToOfficeHours` reproduced the same activation failure.
- This slice is `ui_wired` for safe browser/document metadata label display in the normal Swift receipt/UI path. It is not `actual_collector` or `e2e_accepted`: the local UI E2E activation blocker must be resolved before live signed-app capture can prove browser/document metadata collection, degraded states, deletion/retention, and UI-visible label transitions.

### 2026-06-30 KST — UI E2E locked-session root-cause guard slice

- Re-ran the approved local UI E2E path after the harness repairs. Focused `testWorkspaceStartupDay1RoutesToOfficeHours` and `testAgentSettingsModelPickersSaveClaudeCodexAndGeminiModels` passed, and `xcodebuild build-for-testing -project agentic30.xcodeproj -destination 'platform=macOS,arch=arm64' -scheme agentic30UITests` passed.
- The full approved smoke command `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` executed 16 tests with 10 passed and 6 failed. Exported attachments and `ioreg` showed the root cause was a locked/loginwindow-shielded macOS session, not a product assertion: the screenshot attachment was the lock screen, app accessibility roots were `Disabled`, XCTest reported a full-screen `com.apple.loginwindow` interrupting element, and `CGSSessionScreenIsLocked=Yes`.
- Fixed the UI E2E wrapper preflight in `scripts/xcode-test.sh`: the previous `ioreg | grep -q` check was unreliable under `set -o pipefail` because `grep -q` could close the pipe early and make the pipeline look failed. The guard now captures `ioreg` output first, then checks it, and exits `3` before invoking `xcodebuild` when the screen is locked.
- Added an XCUITest `setUpWithError()` guard that fails raw `xcodebuild test` invocations with the same explicit root cause if `CGSessionScreenIsLocked` is true or `com.apple.loginwindow` is frontmost, so direct UI runs no longer degrade into misleading activation/hittability failures.
- Verification passed for the guard path: `bash -n scripts/xcode-test.sh`, `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` while locked exits `3` with the explicit locked-session message and does not launch XCTest, `xcodebuild test-without-building ... -only-testing:agentic30UITests/agentic30UITests/testWorkspaceStartupDay1RoutesToOfficeHours` fails in `setUpWithError()` with the explicit locked-session message (`CGSSessionScreenIsLocked=true`, `frontmostApplication=com.apple.loginwindow`), and `git diff --check` passes for the touched harness/script/SPEC files.
- This slice is an E2E harness/root-cause hardening step, not `e2e_accepted` evidence for Founder Memory OS. Live signed-app UI acceptance still requires an unlocked foreground session and a successful rerun that drives the recorder surfaces end-to-end.

### 2026-06-30 KST — Gate A frame text redaction adapter slice

- Added a sidecar-owned public-text redaction adapter in `sidecar/recorder-redaction-policy.mjs` and wired it into `recordFrameCaptureEnvelope()` normalization. When a frame asks for a search/memory/export-safe sink and carries a safe redaction status but no `redacted_text`, the ingest path can now derive bounded public text from local AX/OCR text before the row reaches `RecorderStore` and FTS triggers.
- The adapter masks email addresses, HTTP URLs, secret/token/password assignments, token-like values, phone-like numbers, and local path locators. It then reuses the existing unsafe-text and raw-locator checks, failing with `ERR_RECORDER_REDACTION_ADAPTER_UNSAFE_OUTPUT` if the derived public text still looks unsafe.
- Safe sinks still fail closed when neither explicit `redacted_text` nor local AX/OCR text exists (`ERR_RECORDER_INGEST_REDACTION_INPUT_REQUIRED`), and unsafe redaction statuses still cannot become FTS/search/memory/export rows.
- Added ingest coverage proving the adapter indexes safe derived terms while raw emails, private URL paths, local filesystem paths, and token values remain absent from FTS. The test fixture uses a local non-provider-shaped token string so public-safety scans do not treat the repository as containing an API key.
- Verification passed: `node --check sidecar/recorder-redaction-policy.mjs`, `node --check sidecar/recorder-ingest.mjs`, `node --check sidecar-tests/recorder-ingest.test.mjs`, `node --test sidecar-tests/recorder-ingest.test.mjs` (`9/9`), adjacent recorder suite `node --test sidecar-tests/recorder-store.test.mjs sidecar-tests/recorder-search.test.mjs sidecar-tests/recorder-raw-api-server.test.mjs sidecar-tests/recorder-pipes.test.mjs sidecar-tests/recorder-evidence-inbox-builder.test.mjs` (`35/35`), `env -u AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run test:sidecar` (`2338` passed, `3` skipped, `0` failed), and `npm run check:public-safety`.
- This slice is `sidecar_policy_only` for Gate A redaction acceptance. It advances the actual ingest-to-FTS policy path, but still does not complete Gate A because live signed-app validation must prove real AX/OCR capture, UI-visible eligibility transitions, search results under actual recorder operation, and deletion/retention behavior.

### 2026-06-30 KST — Gate C frame document metadata deletion hardening slice

- Hardened frame deletion so `document_path_search_label` is cleared together with raw `document_path`, browser URL labels, AX/OCR text, redacted text, sink eligibility flags, and the deleted privacy/redaction statuses. This closes the lingering safe-label metadata gap for both direct frame deletion and range/retention-driven frame deletion.
- Strengthened `deleteRecorderFrameCapture()` coverage so the fixture starts with a non-null document path and document search label, then proves both are purged after deletion.
- Strengthened `deleteRecorderFrameCapturesInRange()` coverage so in-range frame document paths and document labels are purged while an out-of-range frame keeps its document metadata.
- Verification passed: `node --check sidecar/recorder-delete.mjs`, `node --check sidecar-tests/recorder-delete.test.mjs`, `node --test sidecar-tests/recorder-delete.test.mjs` (`19/19`), `node --test sidecar-tests/recorder-retention.test.mjs` (`24/24`), `npm run check:public-safety`, and `git diff --check`.
- This slice is sidecar deletion/retention hardening for document metadata. It is not `e2e_accepted`: live signed-app recorder acceptance still needs an unlocked foreground session and real capture/delete/retention validation for the Founder Memory surfaces.

### 2026-06-30 KST — UI E2E runner network entitlement and Strategy sidecar smoke slice

- The dynamic Strategy UI E2E root cause was the sandboxed `agentic30UITests-Runner.app` missing `com.apple.security.network.server`. Direct `Process.run()` launch kept app arguments/environment deterministic, but the child sidecar inherited the runner sandbox and failed sidecar bootstrap with `listen EPERM: operation not permitted 127.0.0.1`.
- `scripts/xcode-test.sh` local UI modes now run `build-for-testing`, locate the real non-Index DerivedData `agentic30UITests-Runner.app`, re-sign it ad-hoc with `network.server`, verify the entitlement, then run `test-without-building`. `AGENTIC30_UI_E2E_RESIGN_NETWORK_SERVER=0` disables the local adjustment if needed.
- Failed LaunchServices/`launchctl setenv` experiments were removed from the XCUITest harness. The Strategy sidecar test now keeps the direct app executable launch path, uses app-readable cache workspace/app-support paths, preserves failure artifacts, waits for `ready_event_received`, and asserts canonical run/cache diagnostics before UI badge assertions.
- The Strategy provider stub path now recognizes Strategy report research/synthesis prompts before live auth checks in UI-test mode, so the dynamic Strategy test does not depend on live Exa/provider credentials while still exercising sidecar startup, WebSocket routing, persistence, and UI rendering.
- UI smoke blockers found during the approved run were repaired: Office Hours daily-card replacement now uses one sheet state owner instead of three independent `.sheet(item:)` modifiers, and the Strategy matrix/loading accessibility identifiers were adjusted so tests target stable, concrete nodes rather than off-screen/ambiguous containers.
- Verification passed: targeted dynamic Strategy sidecar UI E2E `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 bash scripts/xcode-test.sh ui-full -only-testing:agentic30UITests/agentic30UITests/testStrategyResearchRunsThroughSidecarAndPersistsCanonicalRunDiagnostics` (`1/1`, result bundle `Test-agentic30UITests-2026.06.30_13-35-33-+0900.xcresult`) and approved local UI smoke `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 bash scripts/xcode-test.sh ui-smoke` (`16/16`, `231.723s`, result bundle `Test-agentic30UITests-2026.06.30_13-36-24-+0900.xcresult`).
- This is debug-app UI E2E harness and Strategy/Office Hours smoke evidence. It is not live signed-app recorder acceptance for Founder Memory OS capture/delete/retention under real TCC and media state.

### 2026-07-01 KST — Gate A SCStream first-frame collector slice

- Swift frame capture no longer uses `SCScreenshotManager.captureImage`. Manual
  and automatic frame capture now start a short-lived `SCStream` screen output,
  wait for the first `.screen` sample buffer, convert the pixel buffer to
  `CGImage` locally, and then continue through the existing recorder frame
  envelope/media path.
- The stream collector fails explicitly instead of falling back to another
  capture API: unconfigured stream, stream-start failure, missing first frame,
  missing pixel buffer, and CGImage conversion failure surface as
  `ERR_RECORDER_FRAME_STREAM_*` root causes.
- This closes the specific "screenshot manager" implementation gap for the
  Swift frame collector, but it is not a final always-on completion claim: the
  current auto path still records discrete first-frame samples on readiness,
  timer, and app-activation triggers rather than maintaining a continuous
  background frame stream.
- Verification passed: `xcodebuild build-for-testing -project
  agentic30.xcodeproj -destination 'platform=macOS' -scheme agentic30` (`TEST
  BUILD SUCCEEDED`), `env SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml
  bash scripts/preflight-release.sh --skip-tests` (`Release configuration
  compiles`, no Swift warnings emitted), `npm run check:public-safety`
  (`public-safety: clean`), and targeted `git diff --check`.
- Approved focused UI E2E for the Founder Replay recorder control was retried
  after this change, but `scripts/xcode-test.sh` refused before app launch
  because the macOS screen is locked. This slice is therefore compile/build
  evidenced only; live signed-app recorder acceptance still requires an
  unlocked foreground session and granted TCC so the UI can drive real
  capture/delete/retention/media behavior.

### 2026-07-01 KST — Gate A persistent SCStream auto-capture session slice

- Swift auto-capture no longer starts a fresh frame stream for every automatic
  frame. Starting auto-capture now starts a persistent `SCStream` screen session
  first, stores it on `AgenticViewModel`, and uses that live stream's latest
  frame for readiness-auto-arm, timer, and app-activation captures.
- Manual capture also reuses the active auto-capture stream when one exists;
  otherwise it keeps the short-lived `SCStream` first-frame path from the prior
  slice.
- Auto-capture stop, latest-frame delete, and `AgenticViewModel` deinit now stop
  and release the frame stream session, so the stream lifetime is tied to the
  visible recorder control state instead of leaking after local stop conditions.
- This is still not a full Gate A acceptance claim: it moves the Swift collector
  from screenshot API / per-frame stream startup toward an always-on stream
  while auto-capture is active, but live signed-app acceptance still must prove
  real TCC permission states, UI-visible capture/delete/retention, media rows,
  and Input Monitoring/event-driven transitions.
- Verification passed: `xcodebuild build-for-testing -project
  agentic30.xcodeproj -destination 'platform=macOS' -scheme agentic30` (`TEST
  BUILD SUCCEEDED`), `env SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml
  bash scripts/preflight-release.sh --skip-tests` (`Release configuration
  compiles`), `npm run check:public-safety` (`public-safety: clean`), and
  targeted `git diff --check`.
- Approved focused UI E2E for the Founder Replay recorder control was retried
  again, but `scripts/xcode-test.sh` refused before app launch because the macOS
  screen is locked.

### 2026-07-01 KST — Gate A listen-only event tap trigger slice

- Swift auto-capture now starts a listen-only Event Tap/Input Monitoring trigger
  while recorder auto-capture is running, but only after
  `event_driven_capture_ready` is true and the main app actor's runtime event tap
  probe still reports granted.
- The trigger does not capture raw keys or pointer payloads. It maps macOS input
  events to coarse event-class trigger IDs such as
  `auto_swift_event_tap_keyboard_activity`,
  `auto_swift_event_tap_pointer_click`, and
  `auto_swift_event_tap_scroll_activity`, then routes them through the existing
  recorder frame capture path with a 10 second debounce.
- Event tap creation and run-loop source failures are explicit root causes
  (`ERR_RECORDER_EVENT_TAP_CREATE_FAILED` and
  `ERR_RECORDER_EVENT_TAP_RUN_LOOP_SOURCE_FAILED`). They do not silently claim
  event-driven readiness or hide the system permission/runtime failure behind
  timer-only capture.
- Auto-capture readiness reconciliation now handles the late-grant transition:
  if core frame capture is already running and a later control-state refresh
  moves `event_driven_capture_ready` to true, Swift attempts to attach the
  listen-only event tap instead of returning early. If event-driven readiness
  later becomes false while core capture remains usable, Swift stops only the
  event tap trigger and keeps the timer/app-activation capture path separate.
- Verification passed: `xcodebuild build-for-testing -project
  agentic30.xcodeproj -destination 'platform=macOS' -scheme agentic30` (`TEST
  BUILD SUCCEEDED`), targeted Swift unit test
  `bash scripts/xcode-test.sh unit '-only-testing:agentic30Tests/AgenticViewModelAuthTests/recorderEventTapTriggerRequiresEventDrivenReadiness()'`
  (`TEST SUCCEEDED`), `env SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml
  bash scripts/preflight-release.sh --skip-tests` (`preflight passed`),
  `npm run check:public-safety` (`public-safety: clean`), and targeted
  `git diff --check`.
- Approved focused UI E2E for the Founder Replay recorder control was retried
  again after this change, but `scripts/xcode-test.sh` refused before app launch
  because the macOS screen is locked. This slice is therefore
  `actual_collector` code/build evidence for the trigger path, not
  `e2e_accepted` live recorder acceptance under granted TCC.
- The same approved focused UI E2E target was retried after the readiness-update
  transition fix and refused at the same screen-lock guard before app launch.

### 2026-07-01 KST — Gate C typed local-transcription unavailable root-cause slice

- Swift microphone local transcription now distinguishes local-only failure
  causes instead of collapsing every unavailable path to
  `local_unavailable_no_cloud_fallback`.
- The emitted no-cloud terminal states cover Speech framework unavailable,
  Speech permission missing, local recognizer unavailable, local recognition
  error, and local recognition timeout. None of these states enables a cloud
  transcription retry.
- `sidecar/recorder-audio.mjs` now allowlists those typed terminal states for
  `transcriptStatus=local_transcription_unavailable`, persists the exact state,
  rejects unknown/cloud-retry-like terminal states, and keeps unavailable audio
  chunks out of transcript segment insertion and search/memory indexing.
- Added Swift envelope coverage for constructing an encrypted microphone chunk
  with a typed unavailable terminal state, plus sidecar coverage for preserving
  every typed state and rejecting `cloud_retry_available`.
- Verification passed: `node --check sidecar/recorder-audio.mjs`,
  `node --check sidecar-tests/recorder-audio.test.mjs`,
  `node --test sidecar-tests/recorder-audio.test.mjs` (`9/9`), and
  `xcodebuild build-for-testing -project agentic30.xcodeproj -destination
  'platform=macOS' -scheme agentic30` (`TEST BUILD SUCCEEDED`). Follow-up
  release/public checks passed with `env SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml
  bash scripts/preflight-release.sh --skip-tests`, `npm run
  check:public-safety`, targeted `git diff --check`, and a whitespace scan for
  the untracked checkpoint file.
- The targeted Swift unit invocation for this new envelope test hung after
  launching the host app, so this slice is sidecar-contract plus Swift
  compile/build evidence only. It still needs live microphone/Speech permission
  validation and unlocked UI/live signed-app recorder acceptance.
- Follow-up focused debug-app UI E2E passed for the adjacent recorder
  consent/visible-indicator/sensitive-audio opt-in surface, but this typed
  transcription slice itself remains sidecar-contract plus Swift compile/build
  evidenced until live microphone/Speech permission validation runs.

### 2026-07-01 KST — Gate C audio consent-grant provenance slice

- Recorder control-state now creates a durable consent grant id when
  `grant_consent` succeeds, returning it as both `consent.grantId` and
  `consent.grant_id`. Normalization also derives the same stable id from
  `grantedAt` for older granted control-state files without an explicit id.
- Swift decodes the consent grant id and includes it in microphone and System
  Audio envelopes. Runtime audio finalization now fails explicitly with
  `ERR_RECORDER_AUDIO_CONSENT_GRANT_ID_MISSING` before sending an audio chunk if
  the current recorder control-state is granted but lacks a grant id.
- `recordAudioChunk()` now requires `consent_grant_id` and fails closed before
  persistence when it is absent, so background raw audio cannot enter the local
  recorder without a consent trace.
- Focused coverage proves control-state id generation, Swift envelope id
  propagation, sidecar fail-closed ingest, and real sidecar WebSocket raw API
  runtime ingestion preserving the same grant id.
- Verification passed: `node --test sidecar-tests/recorder-audio.test.mjs`
  (`9/9`), `node --test sidecar-tests/recorder-control-state.test.mjs` (`5/5`),
  `node --test sidecar-tests/recorder-delete.test.mjs
  sidecar-tests/recorder-retention.test.mjs` (`51/51`),
  `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs
  sidecar-tests/recorder-raw-api-server.test.mjs` (`19/19`),
  `npm run check:public-safety`, and `xcodebuild build-for-testing -project
  agentic30.xcodeproj -destination 'platform=macOS' -scheme agentic30`
  (`TEST BUILD SUCCEEDED`). Follow-up release/diff verification also passed
  with `env SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml bash
  scripts/preflight-release.sh --skip-tests`, targeted `git diff --check`, and
  docs whitespace scan.
- This is still contract/build evidence, not live signed-app audio acceptance:
  live microphone/System Audio capture under granted TCC and unlocked UI E2E
  remain required.
- Focused debug-app real-sidecar UI E2E now passes for the visible consent
  grant path: it grants recorder consent, observes the revoke control plus
  `granted`/`indicator ack`, toggles Microphone and System Audio opt-in, and
  requires either `audio running` or a named `ERR_RECORDER_*` blocker.

### 2026-07-01 KST — Gate C raw-audio indicator provenance slice

- `recordAudioChunk()` no longer accepts missing or explicit `unknown`
  `raw_audio_indicator_state` values. Both cases fail closed with
  `ERR_RECORDER_AUDIO_INDICATOR_STATE_REQUIRED` before an audio chunk, media
  asset, transcript row, or search row can be persisted.
- The accepted Swift microphone/System Audio contract remains explicit:
  envelopes carry `rawAudioIndicatorState=visible_indicator_active` when raw
  audio is captured under the visible recording indicator.
- The raw API runtime test fixture for unencrypted background audio now names
  `visible_indicator_active`, so the expected failure remains
  `ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED` and cannot be masked by the new
  provenance requirement.
- Verification passed: `node --check sidecar/recorder-audio.mjs`,
  `node --check sidecar-tests/recorder-audio.test.mjs`,
  `node --check sidecar-tests/recorder-raw-api-runtime.test.mjs`,
  `node --test sidecar-tests/recorder-audio.test.mjs` (`9/9`),
  `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs
  sidecar-tests/recorder-raw-api-server.test.mjs` (`19/19`), and
  `node --test sidecar-tests/recorder-delete.test.mjs
  sidecar-tests/recorder-retention.test.mjs` (`51/51`).
  Follow-up release/safety/broad verification also passed: `npm run
  check:public-safety`, `env
  SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml bash
  scripts/preflight-release.sh --skip-tests`, `env -u
  AGENTIC30_TEST_STUB_PROVIDER -u AGENTIC30_APP_SUPPORT_PATH npm run
  test:sidecar` (`2381` passed, `3` skipped, `0` failed), targeted
  `git diff --check`, and whitespace scan.
- Focused debug-app real-sidecar UI E2E now passes for the visible
  indicator/sensitive-audio opt-in path: it observes `indicator ack`, enables
  Microphone/System Audio, and requires either `audio running` or a named
  `ERR_RECORDER_*` blocker.
- This is still contract/runtime-test evidence. It does not replace live
  signed-app microphone/System Audio validation under granted TCC, visible
  indicator behavior, and unlocked UI E2E recorder acceptance.

### 2026-07-01 KST — Gate A redacted search Swift UI slice

- Founder Replay Control now exposes the existing recorder redacted search path
  as a user-visible panel instead of leaving `/recorder/search` as sidecar-only
  behavior.
- `AgenticViewModel` now owns `recorderSearchResult`, running/error state, and a
  pending query. It requests an authenticated raw API token with exactly
  `search` scope, calls `/recorder/search` with redacted source types
  (`frame,transcript,memory,product_event`) and `limit=12`, decodes result rows,
  empty states, and `proof_boundary`, and refreshes raw API audit rows after a
  successful fetch.
- Sidecar error envelopes now clear pending search state explicitly, so a
  failed token/request path does not leave the Swift UI stuck in a running
  state.
- `OpenDesignDayPageView` threads the result/running/error state from
  `ContentView` into Founder Replay and renders a `Redacted Search` control
  panel with `search`, `redacted`, and `non-proof` badges, stable
  accessibility identifiers, result rows, empty-state rendering, and a summary
  accessibility label that keeps search hits explicitly non-proof.
- Focused verification passed:
  `xcrun swiftc -parse agentic30/AgenticViewModel.swift`,
  `xcrun swiftc -parse agentic30/OpenDesignDayPageView.swift`,
  `xcrun swiftc -parse agentic30/ContentView.swift`, targeted Swift unit tests
  `recorderSearchRequestsRedactedSearchToken()` and
  `recorderSearchResultDecodesRedactedBoundaryAndMetadata()` (`2/2`),
  `xcodebuild build-for-testing -project agentic30.xcodeproj -destination
  'platform=macOS' -scheme agentic30` (`TEST BUILD SUCCEEDED`),
  `npm run check:public-safety`, and `env
  SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml bash
  scripts/preflight-release.sh --skip-tests`.
- Approved focused UI E2E was retried with
  `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`, but `scripts/xcode-test.sh` refused
  before app launch because the macOS screen is locked.
- This slice is `ui_wired` and compile/unit evidenced, not unlocked UI E2E
  acceptance and not live signed-app recorder acceptance. It still needs a
  foreground unlocked UI run and live signed-app validation under granted TCC
  before redacted search can be counted as an accepted Founder Memory surface.

### 2026-07-01 KST — Gate A Evidence Inbox candidate rows Swift UI slice

- Founder Replay Control's Day Memory Review panel now surfaces concrete
  Evidence Inbox candidates from the existing `recorder_day_memory_loop_result`
  payload instead of only showing aggregate counts.
- `AgenticViewModel` decodes `evidence_build_result.created` into
  `RecorderEvidenceCandidateSummary`, including real sidecar DB-row shape:
  snake-case fields plus JSON-string `source_ids_json`,
  `proof_ledger_mapping_json`, and `evidence_debt_json`.
- Candidate rows render status, proof kind, target gate, claim, source count,
  evidence-debt count, and stable accessibility identifiers. Accessibility
  labels explicitly include `evidence inbox candidate` and `non-proof`, so
  recorder-derived candidate material remains review input only.
- Verification passed: targeted Swift tests
  `recorderDayMemoryLoopResultUpdatesViewModelState()` and
  `decodesRecorderDayMemoryLoopResultEvent()` (`2/2`), `xcodebuild
  build-for-testing -project agentic30.xcodeproj -destination 'platform=macOS'
  -scheme agentic30` (`TEST BUILD SUCCEEDED`), `npm run check:public-safety`,
  `npm run preflight:bundle`, and `env
  SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml bash
  scripts/preflight-release.sh --skip-tests`.
- The same release preflight against the live appcast failed before bundle
  checks because `CFBundleVersion` is `49` while the live Sparkle appcast build
  is also `49`. That is a release numbering gate to resolve before shipping,
  not a candidate-row regression.
- Approved focused UI E2E was retried with
  `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`, but `scripts/xcode-test.sh` refused
  before app launch because the macOS screen is locked.
- This slice is `ui_wired` and compile/unit evidenced only. It still needs
  unlocked UI E2E plus live signed-app recorder validation before Evidence
  Inbox candidate review can be treated as accepted product behavior.

### 2026-07-01 KST — Gate A Evidence Inbox candidate row UI E2E fixture/assertion slice

- Candidate rows are now exposed as first-class accessibility elements on the
  row itself instead of through hidden 1x1 overlay elements. The row label still
  includes candidate id/status/proof kind/target gate/claim/source count/debt
  count plus `evidence inbox candidate` and `non-proof`.
- The existing focused Founder Replay recorder UI E2E now seeds its temporary
  `AGENTIC30_APP_SUPPORT_PATH` recorder DB through the real sidecar
  `RecorderStore` and `recordFrameCaptureEnvelope` modules before app launch.
  The seed creates a recent frame plus customer-interview product event inside
  the default 24-hour Day Memory Review range.
- The same UI E2E now requires the real `recorder_day_memory_loop_run` path to
  produce `review_evidence_inbox`, `candidate rows 1`, and
  `opendesign.founderReplay.control.dayMemory.candidate.0` with pending
  customer-reply/non-proof labels.
- Verification passed: `xcrun swiftc -parse
  agentic30/OpenDesignDayPageView.swift`, `xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift`, standalone Node seed smoke,
  `xcodebuild build-for-testing -project agentic30.xcodeproj -destination
  'platform=macOS' -scheme agentic30` (`TEST BUILD SUCCEEDED`), `npm run
  check:public-safety`, `npm run preflight:bundle`, and `env
  SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml bash
  scripts/preflight-release.sh --skip-tests`.
- Approved focused UI E2E was retried with
  `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`, but `scripts/xcode-test.sh` refused
  before app launch because the macOS screen is locked.
- This strengthens the unlocked UI E2E gate for candidate review but does not
  count as observed UI acceptance until the Mac is unlocked and the focused
  test actually drives the Agentic30 window.

### 2026-07-01 KST — Gate A redacted search UI E2E fixture/assertion slice

- The `Redacted Search` query identifier now sits on the actual SwiftUI
  `TextField`, so the focused UI E2E can enter a seeded query directly instead
  of relying on a container-level identifier.
- Search result rows are now first-class accessibility elements on the row
  itself. Their labels include source type/id, timestamp, title/snippet,
  metadata, `redacted search result`, and `search proof rejected`.
- Raw API Audit rows now expose an accepted search-specific identifier,
  `opendesign.founderReplay.control.audit.search.accepted`, when a row is
  `/recorder/search` + `search` + `accepted`. The existing SQL-specific audit
  identifier remains unchanged.
- The focused Founder Replay recorder UI E2E now reuses the real recorder-store
  fixture created for Day Memory Review, types `founder activation`, and
  requires `/recorder/search` to return one non-proof frame result for
  `ui-frame-1`. It also waits for the accepted `/recorder/search` audit row and
  asserts the raw-read/audit proof boundary language.
- Verification passed: `xcrun swiftc -parse
  agentic30/OpenDesignDayPageView.swift`, `xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift`, standalone Node recorder-search
  smoke (`resultCount=1`, `sourceId=ui-frame-1`), `git diff --check`,
  `xcodebuild build-for-testing -project agentic30.xcodeproj -destination
  'platform=macOS' -scheme agentic30` (`TEST BUILD SUCCEEDED`), `npm run
  check:public-safety`, `npm run preflight:bundle`, and `env
  SPARKLE_APPCAST_URL=http://127.0.0.1:9/appcast.xml bash
  scripts/preflight-release.sh --skip-tests`.
- Approved focused UI E2E was retried with
  `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`, but `scripts/xcode-test.sh` refused
  before app launch because the macOS screen is locked.
- This strengthens the unlocked UI E2E gate for redacted search but does not
  count as observed UI acceptance until the Mac is unlocked and the focused
  test actually drives the Agentic30 window.

### 2026-07-01 KST — Gate A visible-range delete UI E2E acceptance slice

- Founder Replay replay mode now exposes the seeded recorder frame list through
  leaf accessibility identifiers for refresh, status, visible-range delete, and
  timeline frame buttons. The previous container-level
  `opendesign.founderReplay.timeline` identifier clobbered those child
  identifiers in the macOS accessibility tree; it was removed so the actual
  controls are queryable.
- `AgenticViewModel` now retries `recorder_frame_captures_list` once the sidecar
  ready event arrives if the earlier display prepare call ran before connection.
  This keeps the replay rail from staying empty after a pre-ready first render.
- The new focused UI E2E
  `testFounderReplaySeededVisibleRangeDeleteReceipt()` seeds `ui-frame-1` through
  the real `RecorderStore` and `recordFrameCaptureEnvelope`, opens the real
  Founder Replay replay surface, observes `ui-frame-1` / `ui-asset-frame-1`
  through the sidecar frame-list path, deletes the currently visible range, and
  asserts the non-proof range tombstone receipt. The receipt labels frame ids,
  media ids, delete status, path exposure, and `range delete proof rejected`.
- Verification passed: `xcrun swiftc -parse agentic30/AgenticViewModel.swift`,
  `xcrun swiftc -parse agentic30/OpenDesignDayPageView.swift`,
  `xcrun swiftc -parse agentic30UITests/agentic30UITests.swift`, targeted
  `git diff --check`, and `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 omo sparkshell
  bash scripts/xcode-test.sh ui-full
  '-only-testing:agentic30UITests/agentic30UITests/testFounderReplaySeededVisibleRangeDeleteReceipt'`
  (`TEST EXECUTE SUCCEEDED`, 1 test, 0 failures).
- This is debug-app real-sidecar UI acceptance for the seeded visible-range
  deletion path. It does not replace live signed-app recorder validation under
  granted Screen Recording/Accessibility/Input Monitoring TCC, real media
  capture, retention, and manual/timeline validation.

### 2026-07-01 KST — Gate A candidate/search focused UI E2E acceptance slice

- Added the focused UI E2E
  `testFounderReplaySeededDayMemoryCandidateAndRedactedSearchReceipt()` to
  isolate Day Memory candidate review and redacted search/audit assertions from
  the broader Founder Replay control UI E2E.
- The test seeds a temporary `AGENTIC30_APP_SUPPORT_PATH` recorder DB through
  the real `RecorderStore`/ingest modules, launches the debug app against the
  real sidecar, opens Founder Replay Control, runs the real
  `recorder_day_memory_loop_run` path, and asserts `candidate rows 1` plus
  `opendesign.founderReplay.control.dayMemory.candidate.0` with pending
  customer-reply, `evidence inbox candidate`, and `non-proof` labels.
- The same run types `founder activation` into the actual `Redacted Search`
  text field, drives `/recorder/search` through the authenticated `search`
  scope, asserts the single non-proof `ui-frame-1` result, and verifies
  `opendesign.founderReplay.control.audit.search.accepted` includes
  `/recorder/search`, `search`, `accepted`, `authorized_raw_read`,
  `no sources`, and `audit proof rejected`.
- Verification passed: `xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift`, targeted `git diff --check`, and
  `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 omo sparkshell bash
  scripts/xcode-test.sh ui-full
  '-only-testing:agentic30UITests/agentic30UITests/testFounderReplaySeededDayMemoryCandidateAndRedactedSearchReceipt'`
  (`TEST EXECUTE SUCCEEDED`, 1 test, 0 failures; result bundle
  `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.07.01_08-02-03-+0900.xcresult`).
- This is debug-app real-sidecar UI acceptance for seeded Day Memory candidate
  review plus redacted search/audit. It still does not complete Gate A because
  live signed-app validation under granted Screen
  Recording/Accessibility/Input Monitoring TCC must prove actual capture,
  search, delete, retention, media behavior, and manual/timeline validation.

### 2026-07-01 KST — Gate A broad Founder Replay control UI E2E cleanup slice

- Cleaned the broad Founder Replay control UI E2E so it no longer duplicates
  the focused exact-query redacted-search assertion. The broad path now uses the
  default `activation` query to prove integrated search/audit flow, while
  `testFounderReplaySeededDayMemoryCandidateAndRedactedSearchReceipt()` remains
  responsible for exact `founder activation` single-result coverage.
- The broad test now allows multiple redacted search hits, waits for the seeded
  `ui-frame-1` row anywhere in the first three rendered result rows, and checks
  the non-proof/search-boundary labels instead of depending on a brittle
  text-field replacement sequence.
- The SQL inspector step now uses the same 1360x960 UI-test workspace window as
  the focused slices, emits screenshot/tree/element diagnostics if the SQL run
  button is not hittable, and falls through to the existing accessibility press
  helper when the button exists and is enabled.
- Verification passed with Xcode output redirected to a local log to avoid the
  UI trace exceeding the 64 MB capture limit:
  `env AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 bash scripts/xcode-test.sh ui-full
  '-only-testing:agentic30UITests/agentic30UITests/testFounderReplayRecorderControlSurfaceReportsTccReadinessAndDrivesCaptureWhenGranted'`
  (`TEST EXECUTE SUCCEEDED`, 1 test, 0 failures; result bundle
  `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.07.01_08-19-57-+0900.xcresult`).
- The passing run reached the explicit `Founder Replay TCC Blocked` attachment
  path. This is debug-app real-sidecar UI acceptance for
  readiness/search/audit/SQL/replay flow stability, not live signed-app capture
  acceptance under granted TCC.

### 2026-07-01 KST — Gate A permission ladder focused UI E2E acceptance slice

- Added the focused UI E2E
  `testFounderReplayPermissionLadderExposesNativeRequestsAndActorDiagnostics()`
  to isolate native permission request exposure and actor/release diagnostics
  from the broader Founder Replay control flow.
- The test launches the debug app against the real sidecar, opens Founder Replay
  Control, and asserts the native `Request` buttons plus permission-row
  diagnostics for Screen Recording/System Audio, Accessibility,
  Input Monitoring/Event Tap, Microphone, and System Audio. It verifies TCC
  service names, manual System Settings paths, relaunch scopes,
  settings-anchor labels, drag-capability labels, `actorSource mainApp`, and
  actor/release-gate diagnostics including Sparkle key/feed and release-policy
  fields.
- The first focused run proved a test issue, not a product defect:
  offscreen-hittable scrolling could not bring the lower permission ladder
  `Check` button into hit-test range. The final test keeps this slice to
  exposure/diagnostic assertions and intentionally does not click native TCC
  prompts.
- Verification passed: `omo sparkshell xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift` and `env
  AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 omo sparkshell bash scripts/xcode-test.sh
  ui-full
  '-only-testing:agentic30UITests/agentic30UITests/testFounderReplayPermissionLadderExposesNativeRequestsAndActorDiagnostics'`
  (`TEST EXECUTE SUCCEEDED`, 1 test, 0 failures; result bundle
  `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.07.01_08-33-40-+0900.xcresult`).
- This is debug-app real-sidecar UI acceptance for native permission request
  exposure and permission actor diagnostics. It is not live signed-app TCC
  acceptance: granted Screen Recording/Accessibility/Input
  Monitoring/microphone/System Audio permissions must still be validated through
  actual capture, media, delete, retention, and timeline/manual behavior.

### 2026-07-01 KST — Gate C sensitive audio consent/indicator focused UI E2E acceptance slice

- Added the focused UI E2E
  `testFounderReplaySensitiveAudioConsentExposesVisibleIndicatorAndNamedOutcome()`
  to isolate recorder consent, visible indicator acknowledgement, and sensitive
  Microphone/System Audio opt-in from the broader Founder Replay control flow.
- The test launches the debug app against the real sidecar, opens Founder
  Replay Control, grants recorder consent when needed, asserts the revoke
  control plus `granted` and `indicator ack`, toggles Microphone and System
  Audio opt-in, and requires the UI to expose either `audio running` or a named
  `ERR_RECORDER_*` blocker. This keeps explicit local TCC/recorder root causes
  visible instead of hiding them behind fallback logic.
- Verification passed: `omo sparkshell xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift` and `env
  AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 omo sparkshell bash scripts/xcode-test.sh
  ui-full
  '-only-testing:agentic30UITests/agentic30UITests/testFounderReplaySensitiveAudioConsentExposesVisibleIndicatorAndNamedOutcome'`
  (`TEST EXECUTE SUCCEEDED`, 1 test, 0 failures; result bundle
  `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.07.01_08-43-22-+0900.xcresult`).
- This is debug-app real-sidecar UI acceptance for consent/indicator/audio
  named-outcome exposure. It does not replace live signed-app microphone/System
  Audio capture validation under granted TCC, visible recording indicator
  behavior, local transcription permission behavior, media retention, delete,
  and timeline/manual validation.

### 2026-07-01 KST — Gate A live signed-app core capture/delete harness slice

- Added the env-gated UI E2E
  `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted()`.
  It intentionally does not use the debug app as a substitute: the test starts
  by reading `AGENTIC30_LIVE_SIGNED_APP_PATH`, requires it to point to an
  existing `.app` bundle, and otherwise throws an explicit `XCTSkip`.
- The harness launches that app bundle with an isolated test workspace/app
  support path, opens Founder Replay Control, verifies the permission actor
  reports `releaseGate release_ready` and `releasePolicyVerified true`, clicks
  the permission check when available, and only then drives the visible
  `captureFrame` and `deleteFrame` controls. If the capture button is disabled,
  the failure preserves UI diagnostics and states that granted Screen
  Recording/Accessibility/Input Monitoring TCC is required.
- Verification passed for harness compilation and skip behavior:
  `omo sparkshell xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift`, and `env
  AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 omo sparkshell bash scripts/xcode-test.sh
  ui-full
  '-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted'`
  (`TEST EXECUTE SUCCEEDED`, 1 test skipped, 0 failures; result bundle
  `/Users/october/Library/Developer/Xcode/DerivedData/agentic30-fqojdvkkhmwzswfynutajcrvmkte/Logs/Test/Test-agentic30UITests-2026.07.01_08-55-24-+0900.xcresult`).
- This is live-acceptance harness readiness, not live signed-app acceptance.
  The gate remains open until the same test is run with a signed
  `agentic30.app` that already has granted Screen
  Recording/Accessibility/Input Monitoring TCC and observes actual
  capture/delete/media behavior.

### 2026-07-01 KST — Gate A current signed-app workflow and locked-session blocker

- Added `scripts/run-live-signed-recorder-ui-e2e.sh` as the repeatable
  current-source workflow for the live signed-app acceptance test. It builds a
  Release `agentic30.app` with the local Developer ID Application identity,
  embeds `AGENTIC30_EXTERNAL_PERMISSION_ONBOARDING_ALLOWED=1` plus Sparkle
  feed/key values, strips sidecar `.bin` symlinks, re-signs with Hardened
  Runtime and app entitlements, verifies strict codesign, enforces Developer ID
  authority, Team ID, Hardened Runtime, bundle identity, Sparkle feed/key
  values, and the release permission flag, and then runs
  `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted` with
  `AGENTIC30_LIVE_SIGNED_APP_PATH` pointing at the built app.
- Current-source signed candidate was produced at
  `build/live-signed-e2e/DerivedData/Build/Products/Release/agentic30.app` and
  verified with strict codesign. The app reports version `1.0.29`, build `49`,
  `Agentic30ExternalPermissionOnboardingAllowed=1`, Developer ID Team
  `77S8MPV96M`, and Hardened Runtime.
- The focused live signed-app UI E2E was then attempted through the new
  workflow, reusing that app path, but `scripts/xcode-test.sh` exited `3`
  before launching XCTest because the macOS session is locked/loginwindow
  shielded. This preserves the explicit root cause: XCUITest can read parts of
  the tree behind loginwindow, but Agentic30 windows are disabled and controls
  are not reliably hittable.
- A 2026-07-01 09:12 KST rerun with
  `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1` and the same
  `build/live-signed-e2e/DerivedData/Build/Products/Release/agentic30.app`
  path re-verified strict codesign and the `1.0.29` build `49` permission flag,
  then exited at the same locked-session guard before XCTest launch.
- Follow-up read-only review identified that the reuse/build-only path needed
  stronger identity checks than `codesign --verify`. The runner now rejects
  apps unless the bundle id, permission actor bundle id, Developer ID authority,
  Team ID, Hardened Runtime, Sparkle feed/key values, and
  `Agentic30ExternalPermissionOnboardingAllowed=1` all match the live acceptance
  requirements. A strengthened skip-build rerun passed those identity checks
  (`77S8MPV96M`, Hardened Runtime `26.5.0`) before reaching the same locked
  session guard.
- This is still not Gate A live signed-app acceptance. It advances the
  acceptance workflow from "harness exists" to "current signed app can be
  produced and verified"; the remaining acceptance evidence requires an
  unlocked foreground session, granted Screen
  Recording/Accessibility/Input Monitoring TCC for that signed app, and an
  observed capture/delete/media result from the same focused test.

### 2026-07-01 KST — Gate A live signed-app runner Accessibility blocker

- Hardened the live signed-app workflow beyond the earlier locked-session
  blocker. `scripts/run-live-signed-recorder-ui-e2e.sh` now checks for an
  unlocked GUI session before running live UI E2E, writes a short-lived signed
  app path marker for the XCTest process, builds the Release candidate with the
  `AGENTIC30_LIVE_SIGNED_UI_E2E` compilation condition, and requires
  `Agentic30LiveSignedUIE2EAllowed=1` on skip-build reuse so stale signed apps
  cannot be accepted accidentally.
- The live signed UI test now launches with `--ui-testing-direct-workspace-window`
  and treats actual OpenDesign workspace text as a readiness signal if the
  top-level `opendesign.day.shell` accessibility identifier is not visible to
  the attached process. Failure now preserves an explicit
  "workspace missing" root cause instead of silently waiting on one container
  identifier.
- Latest focused run:
  `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1 AGENTIC30_LIVE_SIGNED_APP_PATH=build/live-signed-e2e/DerivedData/Build/Products/Release/agentic30.app scripts/run-live-signed-recorder-ui-e2e.sh`.
  It verified signed app version `1.0.29` build `49`, Team ID `77S8MPV96M`,
  Hardened Runtime `26.5.0`, `Agentic30ExternalPermissionOnboardingAllowed=1`,
  and `Agentic30LiveSignedUIE2EAllowed=1`; the app launched with the isolated
  workspace and the sidecar reached `ready_event_received`.
- The run still failed before Founder Replay rail interaction because
  `agentic30UITests-Runner` could not observe any app window/static text through
  XCUITest, while System Events observed two `Agentic30` windows and the
  Office Hours/Day 2 surface in the same app process. Current blocker:
  `runner_accessibility_blocked` / missing local Accessibility/TCC grant for
  `october-academy.agentic30UITests.xctrunner`.
- The live signed workflow now executes
  `testFounderReplayLiveSignedAppRunnerAccessibilityPreflight` before the
  longer capture/delete test. The preflight uses the same signed app launch
  path and fails fast with `runner_accessibility_blocked` if the XCUITest runner
  cannot observe a window plus known Office Hours/Day 2 static text.
- 2026-07-01 09:55 KST skip-build rerun verified this ordering with
  `Test-agentic30UITests-2026.07.01_09-55-57-+0900.xcresult`: the preflight ran
  first, emitted `runner_accessibility_blocked`, preserved its launch
  diagnostics/artifact root, and the longer capture/delete test did not run.
- Hardened the granted branch for the next unblocked run. Swift now sends
  `redactionStatus=redacted` and `safeForSearch=true` for live frame envelopes
  that contain AX/OCR text, so sidecar ingest can derive redacted public text
  and create searchable FTS rows without indexing raw text. The live signed UI
  E2E now requires a live `frame-`/`asset-` receipt, rejects `ui-frame-` and
  `ui-asset`, runs redacted search for `Agentic30` before delete, and requires a
  non-proof result row with a live `frame-` id.
- 2026-07-01 10:04 KST skip-build rerun after this hardening still stopped at
  the runner Accessibility preflight:
  `Test-agentic30UITests-2026.07.01_10-04-58-+0900.xcresult`. The new
  capture/search assertions remain unexecuted until
  `october-academy.agentic30UITests.xctrunner` can observe the signed app.
- Added the live signed sensitive-audio leg
  `testFounderReplayLiveSignedAppSensitiveAudioRunsWhenTccGranted` to the
  workflow after core frame/search/delete. It launches the same signed app path,
  verifies the release-ready permission actor, grants consent and visible
  indicator acknowledgement, toggles Microphone and System Audio, and requires
  `audio running`; named `ERR_RECORDER_*` audio errors fail live acceptance.
  This test is wired into `scripts/run-live-signed-recorder-ui-e2e.sh` but
  remains unexecuted while the runner Accessibility preflight is blocked.
- Verification passed for the added audio leg: Swift parse, script
  `bash -n`/`shellcheck`, targeted diff check, public-safety, and
  `xcodebuild build-for-testing -project agentic30.xcodeproj -destination
  "platform=macOS" -scheme agentic30UITests` (`TEST BUILD SUCCEEDED`). A
  direct UI run of the new audio test was refused by the local screen-lock guard
  because macOS was locked/loginwindow-shielded.
- The live signed workflow now defaults
  `AGENTIC30_LIVE_SIGNED_PRESERVE_ARTIFACTS=1` and forwards it to the runner
  Accessibility preflight, core frame/search/delete test, and sensitive-audio
  test. All three live signed teardowns honor the flag, so a successful
  unblocked run keeps the xctrunner-container evidence roots under
  `~/Library/Containers/october-academy.agentic30UITests.xctrunner/Data/Library/Caches/agentic30-ui-test-live-signed-{preflight,capture,audio}/<run-id>`.
  The workflow prints that path pattern plus
  `live-recorder-frame-search-verifier.json`, allowing the operator to collect
  the core verifier JSON with the isolated app-support recorder DB/media rather
  than relying only on `.xcresult` attachments.
- This is not `actual_collector + ui_wired + e2e_accepted`. The signed app and
  sidecar launch path are verified, but live capture/delete/media acceptance
  still requires the UI-test runner to be allowed to observe/drive the app and
  the signed app itself to have granted recorder TCC permissions.

### 2026-07-01 KST — Gate A/C live recorder operator verifier slice

- Added `scripts/verify-live-recorder-acceptance.mjs` plus the npm alias
  `npm run verify:live-recorder -- --app-support <path>` for the
  post-run/operator acceptance lane that should not be embedded into Swift UI.
- The verifier opens the target app-support root and fails closed unless it
  finds an undeleted live `frame-` row whose `capture_trigger` contains
  `screencapturekit`, a live `asset-` media row with a non-empty file on disk,
  a redacted search result for the same live frame with
  `proofAcceptedBySearch=false`, a live `audio-` chunk with non-empty media
  unless `--allow-missing-audio` is explicitly provided, and an accepted
  raw-read audit row referencing the live frame unless
  `--allow-missing-audit` is explicitly provided.
- With `--apply-retention`, the verifier calls the production
  `applyRecorderRetentionPolicy` using a tiny raw frame/audio window and
  requires `status:"applied"`, `deletedFrameCount >= 1`,
  `deletedAudioChunkCount >= 1` when audio was present, and
  `deletedMediaCount >= 1`. This keeps retention as an operator harness unless
  a real UI affordance exists.
- Verification passed: `node --check
  scripts/verify-live-recorder-acceptance.mjs`, `node
  scripts/verify-live-recorder-acceptance.mjs --help`, and a temporary
  live-like recorder fixture smoke that produced schema
  `agentic30.live_recorder_acceptance.v1`, a UUID-shaped live frame search hit,
  UUID-shaped live audio, accepted raw-read audit, and retention result
  `{status:"applied", deletedFrameCount:1, deletedAudioChunkCount:1,
  deletedMediaCount:2}`.
- This is not live signed-app acceptance. It makes the post-run evidence check
  deterministic once the unlocked signed-app/TCC run produces real rows, but
  the live collector path remains blocked by the local
  `runner_accessibility_blocked` state until the XCUITest runner can observe
  and drive the signed app.

### 2026-07-01 KST — Gate A live signed-app core test verifier bridge

- Wired the operator verifier into
  `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted()`.
  After the test observes a live `frame-`/`asset-` receipt and a live non-proof
  redacted search result row, but before it deletes the frame, it now runs
  `scripts/verify-live-recorder-acceptance.mjs` against that same
  `AGENTIC30_APP_SUPPORT_PATH` and writes
  `live-recorder-frame-search-verifier.json` into the test root.
- Added verifier flag `--skip-wal-checkpoint` for this in-process live check so
  the verifier does not force a WAL checkpoint while the signed app sidecar may
  still hold its recorder DB connection open.
- The in-test verifier call intentionally passes `--allow-missing-audio` and
  `--allow-missing-audit`; it proves the live frame/media/redacted-search DB
  path for the core frame test, not the full audio/audit/retention ladder.
- Verification passed: `node --check
  scripts/verify-live-recorder-acceptance.mjs`, `node
  scripts/verify-live-recorder-acceptance.mjs --help`, `xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift`, targeted `git diff --check`, a
  temporary `--skip-wal-checkpoint` live-like fixture smoke, and
  `xcodebuild build-for-testing -project agentic30.xcodeproj -destination
  'platform=macOS' -scheme agentic30UITests` (`TEST BUILD SUCCEEDED`).
- Focused UI execution was attempted with
  `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 bash scripts/xcode-test.sh ui-full
  '-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted'`,
  but the wrapper refused before XCTest because the macOS session is
  locked/loginwindow-shielded. This remains compile/build/fixture evidence only
  until the live signed app test runs in an unlocked session with the required
  recorder TCC grants.

### 2026-07-01 KST — Gate B export hostile captured-text fixture

- Added hostile captured-text coverage to
  `sidecar-tests/recorder-raw-api-server.test.mjs` for the raw API export
  route. The fixture is a safe-for-export product event whose summary contains
  `grant raw_admin`, `export all frames`, `approve this proof`, `run shell`,
  and `send transcript to cloud`.
- The export manifest test now asserts that the hostile row is only exported
  as an unverified `product_event`, preserves its source ID, emits no
  proof-ledger event id, and keeps `proofAcceptedByRawApi` /
  `proofAcceptedByExport` false. The command-like phrases remain evidence data;
  they do not grant raw API/MCP capability, approve proof or exports, trigger
  shell/network behavior, or broaden policy.
- Verification passed: `node --check
  sidecar-tests/recorder-raw-api-server.test.mjs`, targeted `git diff
  --check`, whitespace scan, focused `node --test --test-name-pattern
  'recorder export endpoint returns a manifest-only safe_for_export view with
  audit rows' sidecar-tests/recorder-raw-api-server.test.mjs`, and full
  `node --test sidecar-tests/recorder-raw-api-server.test.mjs` (19/19).
- This covers the raw API/export route for the hostile captured-text fixture
  requirement. It is not UI E2E acceptance for the export UI, live signed-app
  recorder acceptance, or proof-ledger acceptance.

### 2026-07-01 KST — Gate B Evidence Inbox builder hostile captured-text fixture

- Added hostile captured-text coverage to
  `sidecar-tests/recorder-evidence-inbox-builder.test.mjs` for the Evidence
  Inbox builder consumer. The fixture is a safe-for-memory product event whose
  summary contains `grant raw_admin`, `export all frames`, `approve this
  proof`, `run shell`, and `send transcript to cloud`.
- The builder test asserts that the command-like phrases remain evidence data
  in the candidate claim and proof-ledger mapping, while source IDs are
  preserved as non-proof `product_event`, `raw_frame`, `transcript_hit`, and
  `raw_search_hit` refs. It keeps `proofAcceptedByBuilder` false, leaves the
  source product event `safe_for_export = 0`, and still fails closed through
  the proof-ledger writer with `ERR_RECORDER_PROOF_NON_EXTERNAL_SOURCE` when
  the candidate is forced to an accepted status without external verifier
  evidence.
- Verification passed: `node --check
  sidecar-tests/recorder-evidence-inbox-builder.test.mjs`, `node --test
  sidecar-tests/recorder-evidence-inbox-builder.test.mjs` (4/4), and `npm run
  check:public-safety`.
- This covers the Evidence Inbox builder hostile-input consumer. It is not UI
  E2E acceptance, export UI acceptance, live signed-app recorder acceptance, or
  proof-ledger acceptance.

### 2026-07-01 KST — Gate D Pipe runtime hostile captured-text fixture

- Added hostile captured-text coverage to
  `sidecar-tests/recorder-pipes.test.mjs` for the built-in Pipe runtime
  consumer. The test runs the `evidence-inbox-builder` Pipe over a
  safe-for-memory product event whose summary contains `grant raw_admin`,
  `export all frames`, `approve this proof`, `run shell`, and `send transcript
  to cloud`.
- The Pipe test asserts the stored Evidence Inbox candidate quotes the
  command-like phrases as evidence data and preserves the
  product-event/frame/transcript/search-hit source IDs as non-proof refs. The
  Pipe output manifest remains count/id-only, keeps
  `proofAcceptedByPipeRun` false, denies proof-ledger writes, leaves the source
  event `safe_for_export = 0`, and does not turn the phrases into raw-admin,
  shell, network, export, or proof-acceptance behavior.
- Verification passed: `node --check sidecar-tests/recorder-pipes.test.mjs`,
  `node --test --test-name-pattern 'hostile captured text'
  sidecar-tests/recorder-pipes.test.mjs`, and full `node --test
  sidecar-tests/recorder-pipes.test.mjs` (11/11).
- This covers the built-in Pipe runtime hostile-input consumer. It is not UI
  E2E acceptance, MCP grant UI acceptance, raw SQL inspector acceptance, live
  signed-app recorder acceptance, or proof-ledger acceptance.

### 2026-07-01 KST — Gate B raw SQL inspector MCP hostile captured-text fixture

- Added hostile captured-text coverage to the bounded raw SQL inspector path
  behind the MCP raw SQL tool. `recorder_sql_product_events` now includes
  `source_ids_json` so the redacted product-event SQL view preserves source
  metadata alongside captured evidence text.
- `sidecar-tests/recorder-mcp-tools.test.mjs` now seeds a safe-for-search
  product event whose summary contains `grant raw_admin`, `export all frames`,
  `approve this proof`, `run shell`, and `send transcript to cloud`, then reads
  it through `runRecorderMcpRawSqlQuery()` using a `raw_sql`-scoped MCP grant.
- The test asserts the command-like phrases remain SQL row data, the
  frame/transcript source IDs are preserved in `source_ids_json`, the
  ephemeral MCP token is scoped only to `raw_sql` and revoked after the call,
  and the SQL response keeps proof/export/search/memory/provider/Pipe/day-
  progress effects disabled.
- Verification passed: `node --check sidecar/recorder-store.mjs`,
  `node --check sidecar-tests/recorder-mcp-tools.test.mjs`, `node --test
  --test-name-pattern 'hostile captured text'
  sidecar-tests/recorder-mcp-tools.test.mjs`, full `node --test
  sidecar-tests/recorder-mcp-tools.test.mjs` (8/8), and `node --test
  sidecar-tests/recorder-store.test.mjs` (11/11).
- This covers the raw SQL inspector path behind the MCP raw SQL tool. It is
  not Swift raw SQL UI acceptance, MCP grant UI acceptance, live signed-app
  recorder acceptance, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A Day Memory Review hostile captured-text fixture

- Added hostile captured-text coverage to the Day Memory Review summarizer.
  `sidecar-tests/recorder-day-memory-review.test.mjs` now seeds safe-for-memory
  product-event and memory-item summaries whose captured text contains
  `grant raw_admin`, `export all frames`, `approve this proof`, `run shell`,
  and `send transcript to cloud`.
- The test asserts Day Memory Review quotes those command-like phrases only as
  product/memory summary evidence data, preserves frame/product/memory source
  IDs, keeps `proofAcceptedByReview` false, keeps proof-ledger event ids absent,
  preserves `safe_for_export = 0` on the source rows, and does not enable
  proof/export/provider/Pipe effects.
- Verification passed: `node --check
  sidecar-tests/recorder-day-memory-review.test.mjs`, `node --test
  --test-name-pattern 'hostile captured text'
  sidecar-tests/recorder-day-memory-review.test.mjs`, and full `node --test
  sidecar-tests/recorder-day-memory-review.test.mjs` (10/10).
- This covers the Day Memory Review summarizer hostile-input consumer. It is
  not Swift Day Memory Review UI acceptance, live signed-app recorder
  acceptance, or proof-ledger acceptance.

### 2026-07-01 KST — Gate B MCP grant hostile captured-text fixture

- Added hostile captured-text coverage to the MCP grant authorization policy
  and Swift state boundary. The fixture reason contains `grant raw_admin`,
  `export all frames`, `approve this proof`, `run shell`, and `send transcript
  to cloud`.
- `sidecar-tests/recorder-mcp-grants.test.mjs` now asserts the hostile phrases
  remain persisted reason data, `accessLevels` / `access_levels` remain exactly
  `["raw_sql"]`, the grant permits only the matching SQL tool/access pair,
  `raw_admin`, `raw_frame`, `raw_audio`, and other tools remain denied, and no
  raw API token hash is persisted.
- `agentic30Tests/SidecarEventDecodingTests.swift` and
  `agentic30Tests/AgenticViewModelAuthTests.swift` now assert hostile reason
  text can flow through decoded MCP grant events and view-model state without
  expanding capability beyond `raw_sql`. The Swift grant-create path still sends
  the fixed local SQL inspector reason instead of captured text.
- Verification passed: `node --check
  sidecar-tests/recorder-mcp-grants.test.mjs`, full `node --test
  sidecar-tests/recorder-mcp-grants.test.mjs` (3/3), full
  `bash scripts/xcode-test.sh unit` (153 XCTest tests + 597 Swift Testing
  tests), `npm run check:public-safety`, and targeted `git diff --check`.
- This covers the MCP grant authorization policy and Swift non-foreground
  state boundary for hostile captured text. It is not live foreground MCP grant
  UI E2E acceptance, export UI acceptance, live signed-app recorder acceptance,
  or proof-ledger acceptance.

### 2026-07-01 KST — Gate B export archive hostile captured-text fixture

- Strengthened hostile captured-text coverage for the implemented export
  manifest/archive boundary. `sidecar-tests/recorder-raw-api-server.test.mjs`
  now shares the same fixture string across the safe-for-export product-event
  row and archive approval/reason assertions: `grant raw_admin`, `export all
  frames`, `approve this proof`, `run shell`, and `send transcript to cloud`.
- The export manifest route still returns the hostile product event only as
  manifest-only `product_event` evidence data, preserves source IDs, keeps
  verification status unverified, and leaves proof/export acceptance flags
  false.
- The archive route now asserts a hostile `approvalGrantId` / reason cannot
  satisfy the local interactive approval verifier. A valid archive request whose
  reason contains the hostile text still exports only the explicitly requested
  `transcripts` and `memory` classes, does not include frames or product events
  because the reason says `export all frames`, writes the hostile reason as
  archive metadata only, and keeps archive/export proof flags false.
- Verification passed: `node --check
  sidecar-tests/recorder-raw-api-server.test.mjs`, focused `node --test
  --test-name-pattern 'manifest-only safe_for_export view'
  sidecar-tests/recorder-raw-api-server.test.mjs`, full `node --test
  sidecar-tests/recorder-raw-api-server.test.mjs` (19/19), `npm run
  check:public-safety`, and targeted `git diff --check`.
- This covers the implemented export manifest/archive acceptance boundary. It
  is not live foreground Swift export UI E2E acceptance, live signed-app
  recorder acceptance, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A/C live-recorder verifier shared live discriminator

- Strengthened the live signed-app operator verifier so it uses the single
  repo-owned live-vs-seed discriminator instead of a duplicated
  `screencapturekit`-only predicate.
- `scripts/verify-live-recorder-acceptance.mjs` now imports
  `isLiveCapturedFrameRow`, `assertLiveRecorderFrameRow`, and
  `summarizeLiveRecorderCapture` from `sidecar/recorder-live-verify.mjs`. The
  verifier selects the latest live row through the shared predicate, re-checks
  that exact frame by ID, and includes `liveCaptureSummary` in its emitted JSON
  evidence.
- `sidecar-tests/recorder-live-verify.test.mjs` now covers the full live
  collector trigger family expected by the helper: `screencapturekit`,
  `event_tap`, and `input_monitor`. It also proves UI seed rows,
  non-collector triggers, deleted rows, and missing/seed assets fail closed, and
  that an event-tap row is counted in the store summary without accepting the UI
  seed fixture.
- Verification passed: `node --check
  scripts/verify-live-recorder-acceptance.mjs`, `node --check
  sidecar-tests/recorder-live-verify.test.mjs`, `node --test
  sidecar-tests/recorder-live-verify.test.mjs` (4/4), and `node
  scripts/verify-live-recorder-acceptance.mjs --help`.
- This covers the operator verifier's live-vs-seed guard only. It is not live
  signed-app recorder acceptance, foreground UI E2E acceptance, granted TCC
  proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live-recorder verifier Swift frame-shape binding

- Tightened the live-recorder frame discriminator so fixture-looking frame rows
  cannot satisfy the signed-app acceptance verifier just by using a live-looking
  collector trigger.
- `sidecar/recorder-live-verify.mjs` now requires frame rows to match the actual
  Swift collector shape: non-deleted, non-fixture, `frame-<uuid>`,
  `asset-<uuid>`, and a live macOS collector trigger containing
  `screencapturekit`, `event_tap`, or `input_monitor`.
- `isSeedFixtureFrameRow` now also treats `fixture`-marked frame/media ids as
  seeded, so the old synthetic `frame-live-fixture` / `asset-live-fixture`
  pair fails closed before it can certify a live capture run.
- `sidecar-tests/verify-live-recorder-acceptance.test.mjs` now uses
  UUID-shaped frame/media ids for the positive subprocess fixture and adds a
  negative subprocess case proving a synthetic non-UUID frame fixture is
  rejected even when missing audio/audit are allowed for triage.
- Verification passed: syntax checks for `sidecar/recorder-live-verify.mjs`,
  `scripts/verify-live-recorder-acceptance.mjs`,
  `sidecar-tests/recorder-live-verify.test.mjs`, and
  `sidecar-tests/verify-live-recorder-acceptance.test.mjs`; targeted
  `git diff --check`; and `node --test
  sidecar-tests/recorder-live-verify.test.mjs
  sidecar-tests/verify-live-recorder-acceptance.test.mjs` (14/14).
- This is verifier hardening for the next unblocked live signed run. It is not
  live signed-app recorder acceptance, foreground UI E2E acceptance, granted TCC
  proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A/C live-recorder verifier permanent subprocess fixture

- Added permanent `node:test` coverage for the live-recorder operator verifier
  script. `sidecar-tests/verify-live-recorder-acceptance.test.mjs` creates a
  live-shaped recorder app-support root with physical local frame/audio media, a
  live `frame-`/`asset-` row, redacted search text for `Agentic30`, a live
  `audio-` chunk/media row, and an accepted raw-read audit row.
- The positive test runs `scripts/verify-live-recorder-acceptance.mjs` as a
  subprocess with `--apply-retention` and `--json-output`, then asserts schema
  `agentic30.live_recorder_acceptance.v1`, live capture summary IDs, non-proof
  redacted search evidence, audio evidence, accepted audit evidence, the written
  JSON artifact, and production retention deletion counts for frame/audio media.
- The negative test seeds only the UI fixture markers `ui-frame-1`,
  `ui-asset-frame-1`, and `ui_test_seed`, then asserts the verifier fails closed
  with `No undeleted live frame row found` even when missing audio/audit are
  explicitly allowed.
- Verification passed: `node --check
  sidecar-tests/verify-live-recorder-acceptance.test.mjs` and `node --test
  sidecar-tests/verify-live-recorder-acceptance.test.mjs` (2/2).
- This is deterministic verifier-script regression coverage. It is not live
  signed-app recorder acceptance, foreground UI E2E acceptance, granted TCC
  proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live signed core verifier frame-id binding

- Tightened the live signed core frame/search/delete harness so the UI-observed
  frame receipt and the operator verifier cannot silently diverge.
- `scripts/verify-live-recorder-acceptance.mjs` now accepts `--frame-id <id>`.
  When provided, it validates that exact frame with
  `assertLiveRecorderFrameRow` instead of selecting the latest live row, and
  emits `requestedFrameId` in `agentic30.live_recorder_acceptance.v1` evidence.
- `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted()` now
  extracts the `frame-` id from the visible
  `opendesign.founderReplay.control.lastFrameCapture` receipt and passes that id
  into the operator verifier before deleting the frame. A seeded `ui-frame-`
  receipt still fails before verifier invocation.
- `sidecar-tests/verify-live-recorder-acceptance.test.mjs` now runs the
  subprocess verifier with `--frame-id`, asserts `requestedFrameId` matches the
  live fixture id, and asserts requesting `ui-frame-1` fails closed with
  `ERR_RECORDER_LIVE_VERIFY_FRAME_IS_SEED_FIXTURE`.
- Verification passed: `node --check
  scripts/verify-live-recorder-acceptance.mjs`, `node --check
  sidecar-tests/verify-live-recorder-acceptance.test.mjs`, `node --test
  sidecar-tests/verify-live-recorder-acceptance.test.mjs` (2/2), `xcrun
  swiftc -parse agentic30UITests/agentic30UITests.swift`, and `node
  scripts/verify-live-recorder-acceptance.mjs --help`.
- This is harness hardening for the next unblocked live signed run. It is not
  live signed-app recorder acceptance, foreground UI E2E acceptance, granted TCC
  proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live signed core delete verifier tombstone binding

- Extended the live signed core harness so the post-delete UI receipt is backed
  by the same frame id's recorder DB/media tombstone state.
- `scripts/verify-live-recorder-acceptance.mjs` now accepts
  `--deleted-frame-id <id>`. This mode asserts the frame exists with
  `deleted_at`, `redaction_status=deleted`, `privacy_state=deleted`, search/
  memory/export sink flags disabled, raw/search text fields cleared, the linked
  frame media asset tombstoned under `media/frames/deleted/`, media byte/hash/
  encryption fields cleared, no tombstone media file present, and no redacted
  search result for that frame id.
- `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted()` now
  invokes the delete verifier after the visible `media removed` / `path exposed
  no` delete receipt, using the same `frame-` id extracted from the live capture
  receipt. The preserved live evidence root now includes
  `live-recorder-frame-delete-verifier.json` next to the pre-delete search
  verifier JSON.
- `sidecar-tests/verify-live-recorder-acceptance.test.mjs` now covers the
  positive deleted-frame subprocess path by running production
  `deleteRecorderFrameCapture()` first, then asserting schema
  `agentic30.live_recorder_delete_acceptance.v1`, deleted/tombstoned frame/media
  fields, `searchResultCount=0`, and `proofAccepted=false`. It also asserts
  `--deleted-frame-id` fails before deletion.
- Verification passed: `node --check
  scripts/verify-live-recorder-acceptance.mjs`, `node --check
  sidecar-tests/verify-live-recorder-acceptance.test.mjs`, `node --test
  sidecar-tests/verify-live-recorder-acceptance.test.mjs` (4/4), `xcrun
  swiftc -parse agentic30UITests/agentic30UITests.swift`, and `node
  scripts/verify-live-recorder-acceptance.mjs --help`.
- This is delete/media acceptance hardening for the next live signed run. It is
  not live signed-app recorder acceptance, foreground UI E2E acceptance, granted
  TCC proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live signed runner Accessibility trust preflight

- Tightened the current live signed workflow blocker so it fails on the actual
  missing local runner TCC grant instead of waiting for the app accessibility
  tree to become visible.
- `testFounderReplayLiveSignedAppRunnerAccessibilityPreflight()` now attaches a
  `Founder Replay Live Signed Runner Accessibility Trust` diagnostic before the
  window/static-text wait. The diagnostic records `AXIsProcessTrusted()`, the
  runner bundle/process identity, frontmost app, signed app path, isolated
  app-support path, XCUITest window/static-text visibility, and OS-level running
  `october-academy.agentic30` processes.
- If the XCUITest runner itself is not Accessibility-trusted, the preflight now
  fails immediately with `runner_accessibility_blocked:
  AXIsProcessTrusted=false` while preserving the existing screenshot,
  accessibility tree, and app launch diagnostics. This keeps the longer
  capture/search/delete and sensitive-audio legs behind a precise preflight
  rather than a broad timeout.
- Verification passed: `xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift`, `xcodebuild build-for-testing
  -project agentic30.xcodeproj -scheme agentic30UITests -destination
  'platform=macOS' -quiet`, `npm run check:public-safety`, and targeted
  `git diff --check`.
- This improves operator evidence quality for the next unblocked signed-app run.
  It is not live signed-app recorder acceptance, foreground UI E2E acceptance,
  granted recorder TCC proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live signed runner identity preparation

- Added a non-foreground runner preparation path for the current
  `runner_accessibility_blocked` workflow blocker.
- `scripts/xcode-test.sh` now supports `ui-prepare-runner`. It runs
  `build-for-testing` only when no reusable runner exists, applies the same
  local `com.apple.security.network.server` re-signing used before UI
  `test-without-building`, and prints the exact XCUITest runner app path, bundle
  id, cdhash, signature, and Accessibility target path. With
  `AGENTIC30_UI_E2E_REUSE_RUNNER=1`, this mode reuses the existing runner so a
  granted Accessibility entry is not invalidated by a rebuild.
- The runner selection path is now pinned through a repo-local marker at
  `build/ui-e2e/agentic30-ui-test-runner-app.txt` and validates the selected
  runner before use: the runner bundle id must be
  `october-academy.agentic30UITests.xctrunner`, and the sibling built app must
  be `october-academy.agentic30`. This avoids accidentally selecting a stale or
  unrelated `agentic30UITests-Runner.app` from the user's broad DerivedData
  tree after multiple local builds.
- `scripts/run-live-signed-recorder-ui-e2e.sh` now calls `ui-prepare-runner`
  before the live runner Accessibility preflight, core frame/search/delete leg,
  and sensitive-audio leg. It also supports
  `AGENTIC30_LIVE_SIGNED_PREPARE_RUNNER_ONLY=1`, which verifies the signed app
  and prepares the runner without launching foreground UI E2E.
- Verification passed: `bash -n scripts/xcode-test.sh
  scripts/run-live-signed-recorder-ui-e2e.sh`, direct
  `AGENTIC30_UI_E2E_REUSE_RUNNER=1
  AGENTIC30_DISABLE_UI_E2E_CAFFEINATE=1 bash scripts/xcode-test.sh
  ui-prepare-runner`, and wrapper
  `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1
  AGENTIC30_LIVE_SIGNED_PREPARE_RUNNER_ONLY=1
  AGENTIC30_DISABLE_UI_E2E_CAFFEINATE=1 bash
  scripts/run-live-signed-recorder-ui-e2e.sh`. Both runner-preparation paths
  printed `Reusing existing UI test runner ... preserve the
  Accessibility-granted cdhash`; the prepared runner printed bundle id
  `october-academy.agentic30UITests.xctrunner`, cdhash
  `16808302be34aaa2660ccf0c4dec736e9c670af6`, signature `adhoc`, and the
  DerivedData runner `.app` path to grant in System Settings. The marker file
  was written with that same runner path and the wrapper prepare-only rerun
  completed in reuse mode without launching foreground UI.
- This makes the next operator action precise and repeatable. It is not live
  signed-app recorder acceptance, foreground UI E2E acceptance, granted recorder
  TCC proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live signed runner DerivedData binding

- Bound live signed runner preparation to the same DerivedData root that the
  foreground UI `test-without-building` legs will use.
- `scripts/xcode-test.sh` now honors `AGENTIC30_DERIVED_DATA_PATH` in the
  shared xcodebuild argument list. This lets `ui-prepare-runner`,
  `build-for-testing`, and `test-without-building` resolve runner/app products
  from one selected DerivedData tree instead of relying on Xcode's broad default
  lookup.
- The repo-local runner marker remains the reuse authority for cdhash stability,
  but marked runners are accepted only when their path is under the currently
  selected DerivedData search root. If the live signed wrapper switches to its
  stable runner root, an older marker from `~/Library/Developer/Xcode/DerivedData`
  is ignored and the runner is rebuilt/resigned in the selected root.
- Explicit `AGENTIC30_UI_TEST_RUNNER_APP` overrides now fail closed when
  `AGENTIC30_DERIVED_DATA_PATH` is set and the override path is outside that
  DerivedData root. This prevents the signing helper from signing one runner
  while `xcodebuild test-without-building` resolves another runner from the
  selected root.
- `scripts/run-live-signed-recorder-ui-e2e.sh` now defaults the runner build root
  to `build/ui-e2e/live-signed-runner-derived-data`, prints that path, and
  passes it through `AGENTIC30_DERIVED_DATA_PATH` for `ui-prepare-runner`, the
  runner Accessibility preflight, the core frame/search/delete leg, and the
  sensitive-audio leg. This stable runner root intentionally sits outside the
  signed-app build root `build/live-signed-e2e`, because signed app rebuilds
  clean that app root and must not delete the Accessibility-granted runner
  cdhash. The path can be overridden with
  `AGENTIC30_LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH`.
- Focused non-foreground verification passed: `bash -n scripts/xcode-test.sh
  scripts/run-live-signed-recorder-ui-e2e.sh`, `shellcheck
  scripts/xcode-test.sh scripts/run-live-signed-recorder-ui-e2e.sh`, targeted
  `git diff --check`, and a CURRENT trailing-whitespace scan.
- This tightens runner identity repeatability for the next live signed run. It
  is not live signed-app recorder acceptance, foreground UI E2E acceptance,
  granted recorder TCC proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live signed Intake V2 seed bypass

- Fixed the next live signed-app blocker after Automation Mode allowed XCUITest
  to observe the Developer ID + hardened-runtime app: the signed E2E launch could
  still route to Intake V2 Step 1/8 instead of the Day workspace.
- The live signed tests already pass `--ui-testing-seed-onboarding-context`,
  `--ui-testing-seed-workspace=<path>`, and `--ui-testing-open-workspace`; the
  app-side view model also treats `--ui-testing-open-workspace` as an in-memory
  intake completion signal. The pre-launch defaults seed, however, only wrote
  `agentic30.workspaceRoot` and `agentic30.macOnboardingIntroCompleted`, so the
  launch diagnostics could still show
  `agentic30.macOnboardingIntakeOnlyCompleted = null` and route through Intake V2
  before the live capture path reached Founder Replay.
- `agentic30UITests/agentic30UITests.swift` now writes
  `agentic30.macOnboardingIntakeOnlyCompleted=true` during UI-test preseed when
  an onboarding context is seeded and `--ui-testing-open-workspace` is requested.
  This keeps the signed live E2E pre-launch defaults aligned with the app-side
  runtime routing decision.
- Focused non-foreground verification passed: `xcrun swiftc -parse
  agentic30UITests/agentic30UITests.swift`, targeted `git diff --check`, and a
  CURRENT trailing-whitespace scan. This is not live signed-app recorder
  acceptance, foreground UI E2E acceptance, granted recorder TCC proof, or
  proof-ledger acceptance.

### 2026-07-01 KST — Gate C retention sidecar runtime wiring

- Production retention is no longer verifier-script-only. `sidecar/index.mjs`
  now starts a boot-plus-hourly recorder retention sweep after the recorder store
  and raw API server initialize, serializes concurrent sweeps with an explicit
  `already_running` skip result, and clears the timer on shutdown.
- The authenticated sidecar route `recorder_retention_apply` runs
  `applyRecorderRetentionPolicy` on demand and emits `recorder_retention_result`
  with frame/audio/media delete counts plus
  `proofAcceptedByRetention=false` and `proofLedgerWriteAllowed=false`.
- Automatic retention telemetry is scrubbed to reason/status/counts only, and
  the manual route does not accept arbitrary payload reasons, so captured text
  and local paths are not promoted into telemetry.
- This wires the existing retention policy into the production sidecar runtime.
  It is not live signed-app recorder acceptance until actual captured media is
  retained/deleted under granted TCC and observed through the live verifier.

### 2026-07-01 KST — Gate A Evidence Inbox approval-to-proof sidecar route

- `sidecar/index.mjs` now exposes authenticated
  `recorder_evidence_candidate_review` for explicit local review of Evidence
  Inbox candidates.
- The route calls `reviewRecorderEvidenceCandidate` before any proof write,
  requires an accepted external artifact for approvals, and uses
  `writeEvidenceCandidateThroughProofLedger` for the strict proof-ledger adapter
  write.
- Reject decisions never write proof. Approvals emit
  `recorder_evidence_candidate_review_result` with
  `proofAcceptedByReview=false`, `proofAcceptedByEvidenceCandidate=true` only
  when the adapter wrote an accepted ledger event, and
  `proofLedgerWriteAllowed=true` only for that accepted write.
- The route updates the in-memory Day Memory loop candidate row when present so
  the current Founder Replay state can show `written_to_ledger` without rerunning
  the loop.
- Verification passed: `node --check sidecar/index.mjs`, focused
  `node --test sidecar-tests/recorder-evidence-review.test.mjs
  sidecar-tests/recorder-evidence-candidates.test.mjs` (`7/7`), and a temporary
  real-sidecar WebSocket smoke that seeded a pending candidate, approved it with
  an external artifact, and observed one accepted proof-ledger event.
- This closes the sidecar runtime approval route gap. It is not Swift foreground
  UI acceptance for approval controls and not live signed-app recorder
  acceptance under granted TCC.

### 2026-07-01 KST — Gate A Evidence Inbox Swift approval controls

- Founder Replay Control candidate rows now expose explicit review controls for
  reviewable Evidence Inbox candidates (`pending_review`, `degraded`, and
  `verifier_rejected`).
- The Swift row renders an external URL/local-path field, keeps Approve disabled
  until the founder enters an artifact location, then sends
  `recorder_evidence_candidate_review` with `decision=approve_bundle` and an
  accepted external artifact object. The evidence kind is the candidate's
  reviewable proof kind when it is allowlisted, otherwise `external_evidence`.
- Reject sends `decision=rejected` with a root-cause reason and no external
  artifact, preserving the no-proof-write path.
- `AgenticViewModel` tracks candidate review requests in flight, decodes
  `recorder_evidence_candidate_review_result`, updates the current Day Memory
  loop from the sidecar result, clears the in-flight candidate, and surfaces
  sidecar errors in the existing Day Memory Review error slot.
- Verification passed: `xcodebuild build -project agentic30.xcodeproj
  -destination 'platform=macOS' -scheme agentic30 CODE_SIGNING_ALLOWED=NO`.
  Targeted sidecar verification from the route slice remains valid:
  `node --check sidecar/index.mjs`, focused review/candidate tests (`7/7`), and
  the temporary real-sidecar WebSocket smoke with one accepted proof-ledger
  event.
- This is Swift control wiring, not foreground UI E2E acceptance and not live
  signed-app recorder acceptance under granted TCC.

### 2026-07-01 KST — Gate C Retention Swift control wiring

- Founder Replay Control now exposes a manual Retention Sweep card in the
  recorder control surface, immediately after Day Memory Review.
- `AgenticViewModel` sends the existing authenticated
  `recorder_retention_apply` sidecar command, tracks in-flight/error/result
  state, decodes `recorder_retention_result`, and clears pending state on
  sidecar error.
- The Swift card renders retention status/reason, deleted frame/audio/media
  counts, explicit sidecar errors, and proof-boundary pills for
  `proofAcceptedByRetention=false` and `proofLedgerWriteAllowed=false`.
- Verification passed: `node --check sidecar/index.mjs`, targeted
  `git diff --check`, and `xcodebuild build -project agentic30.xcodeproj
  -destination 'platform=macOS' -scheme agentic30 CODE_SIGNING_ALLOWED=NO`.
- This is Swift control wiring for the production retention route, not
  foreground UI E2E acceptance and not live signed-app recorder acceptance under
  granted TCC.

### 2026-07-01 KST — Gate A Day Memory loop Office Hours auto-fire

- `sidecar/recorder-day-loop-autofire.mjs` now owns the pure auto-fire decision
  for the Day Memory loop: fire at most once per local day, only when the
  recorder store is running, only in Day 0-3 or unknown-day contexts, and only
  when recorder capture readiness allows recording.
- `sidecar/index.mjs` invokes the auto-fire path before Office Hours computes
  the effector context. The result updates the same reducer-owned
  `state.recorderDayMemoryLoop` cache as the manual Control button; the Office
  Hours effector remains a read-only context producer and never writes proof.
- The path is fail-open for Office Hours and never persists snapshots from the
  auto-fire run. Errors leave the previous cache untouched, append context debt
  when available, emit scrubbed telemetry, and keep
  `proofAcceptedByDayLoop=false`.
- The authenticated WebSocket Day Memory smoke now uses fresh relative seed
  timestamps so the production boot retention sweep does not delete its frame
  fixture before the command runs. This keeps the smoke aligned with the real
  retention runtime instead of disabling retention or weakening assertions.
- Verification passed: syntax checks for `sidecar/index.mjs`,
  `sidecar/recorder-day-loop-autofire.mjs`, `sidecar/mcp-server.mjs`, and
  `sidecar/recorder-mcp-tools.mjs`; targeted `git diff --check`; and
  `node --test sidecar-tests/recorder-mcp-tools.test.mjs
  sidecar-tests/recorder-mcp-grants.test.mjs
  sidecar-tests/recorder-day-loop-autofire.test.mjs
  sidecar-tests/recorder-day-loop-ws.test.mjs` (`20/20`).
- This is focused sidecar runtime verification for the Office Hours auto-fire
  path plus adjacent MCP raw SQL boundaries. It is not foreground UI E2E
  acceptance and not live signed-app recorder acceptance under granted TCC.

### 2026-07-01 KST — Gate C live audio verifier seed rejection

- `sidecar/recorder-live-verify.mjs` now treats audio acceptance like frame
  acceptance: fixture rows are rejected before they can satisfy a live signed-app
  gate.
- Full live audio acceptance now requires an undeleted, non-fixture
  `audio-<uuid>` row backed by an `asset-<uuid>` media asset, a live source
  (`microphone` or `system_audio`), a `recorder-consent-*` consent grant, and
  `raw_audio_indicator_state=visible_indicator_active`.
- `scripts/verify-live-recorder-acceptance.mjs` uses
  `assertLiveRecorderAudioChunkRow()` for full audio acceptance. The
  `--allow-missing-audio` option remains only for frame-only triage; without it,
  a seeded row such as `audio-live-fixture` fails closed with
  `ERR_RECORDER_LIVE_VERIFY_AUDIO_IS_SEED_FIXTURE`.
- The verifier subprocess test now uses UUID-shaped audio ids for the positive
  path and adds a negative seeded-audio fixture path, so future live signed audio
  evidence cannot be certified by the old synthetic fixture naming.
- Verification passed: `node --check` for the verifier module, operator script,
  and focused tests; targeted `git diff --check`; and `node --test
  sidecar-tests/recorder-live-verify.test.mjs
  sidecar-tests/verify-live-recorder-acceptance.test.mjs` (`14/14`).
- This tightens the acceptance harness only. It is not live signed-app recorder
  acceptance, foreground UI E2E acceptance, or granted microphone/System Audio
  TCC proof.

### 2026-07-01 KST — Gate A/B live raw-read audit verifier tightening

- `scripts/verify-live-recorder-acceptance.mjs` now treats accepted raw-read
  audit evidence as a typed acceptance condition, not a substring search.
- A matching audit row must be undeleted, `decision=accepted`,
  `access_level=raw_frame`, use a real raw frame endpoint
  (`/recorder/frames/<id>/text` or `/recorder/frames/<id>/image`), and include
  the live frame id in `source_ids_json` with `source_type=frame`. The endpoint
  frame id must match the same live frame id.
- The positive subprocess verifier fixture now records
  `/recorder/frames/<id>/text` with a structured frame source id. A new negative
  fixture proves an accepted summary/frame-level audit (`access_level=frame`,
  `/recorder/frames/<id>`) does not satisfy full live acceptance. Another
  negative fixture proves an accepted `raw_frame` audit for a different endpoint
  frame id also fails closed.
- Verification passed: `node --check` for the operator script and subprocess
  test, targeted `git diff --check`, and `node --test
  sidecar-tests/verify-live-recorder-acceptance.test.mjs` (`8/8`).
- This tightens the capture/search/audit acceptance harness only. It is not live
  signed-app recorder acceptance, foreground UI E2E acceptance, or granted TCC
  proof.

### 2026-07-01 KST — Gate D Pipe scheduler state bridge

- `sidecar/index.mjs` now persists the latest Pipe scheduler result in
  `state.recorderPipeLastSchedulerResult` for both background scheduler ticks
  and manual `recorder_pipe_scheduler_tick` requests.
- Capture-readiness blocks now return and persist a schema-versioned scheduler
  result with `skipped_count=1`, `reason=recorder_capture_not_ready`, typed
  readiness blockers, `proofAcceptedByScheduler=false`, and
  `proofLedgerWriteAllowed=false`. The scheduler boundary remains explicit and
  inspectable instead of becoming an unobservable no-op.
- `recorder_pipes_list` includes that scheduler snapshot in
  `recorder_pipes_state`, and Swift updates `recorderPipeLastSchedulerResult`
  from the state event so the Control surface can retain the latest scheduler
  proof boundary after refresh.
- Background and manual scheduler ticks now broadcast the same
  `recorder_pipes_state` payload after updating the scheduler snapshot, so
  connected Control surfaces receive the latest scheduler boundary without
  waiting for a manual refresh.
- Manual scheduler ticks that fail capture readiness still send the explicit
  `ERR_RECORDER_PIPE_SCHEDULER_CAPTURE_NOT_READY` error, but now first persist
  and broadcast the same skipped scheduler snapshot with the named readiness
  blockers.
- Manual `recorder_pipe_scheduler_tick_result` returns a combined `scheduler`
  snapshot that includes both queued/skipped enqueue decisions and
  executed/failed drain decisions. Swift uses that explicit snapshot first,
  keeping the visible scheduler summary stable across the tick response and the
  next Pipe-state refresh.
- Swift now decodes scheduler `generated_at`, `skipped[]`,
  skipped-readiness blockers, and the scheduler proof boundary. The Founder
  Replay Pipes surface shows skipped count, the first skipped root cause
  (`recorder_capture_not_ready` plus blocker ids when present), and
  `proof write off` in visible/accessibility scheduler rows instead of
  collapsing the state to counts only.
- Verification passed: `node --check sidecar/index.mjs
  sidecar-tests/recorder-raw-api-runtime.test.mjs`, targeted `git diff
  --check`, `node --test sidecar-tests/recorder-raw-api-runtime.test.mjs`
  (`1/1`, including scheduler-state broadcast), `xcrun swiftc -parse
  agentic30/AgenticViewModel.swift
  agentic30Tests/AgenticViewModelAuthTests.swift`, and `bash
  scripts/xcode-test.sh unit
  '-only-testing:agentic30Tests/AgenticViewModelAuthTests'` (`121/121`).
  Additional focused Swift verification passed after the UI root-cause
  visibility change: `xcrun swiftc -parse agentic30/AgenticViewModel.swift
  agentic30/OpenDesignDayPageView.swift
  agentic30Tests/SidecarEventDecodingTests.swift
  agentic30Tests/AgenticViewModelAuthTests.swift`, targeted `git diff --check`,
  and `bash scripts/xcode-test.sh unit
  '-only-testing:agentic30Tests/SidecarEventDecodingTests'` (`132/132`).
- This covers Gate D scheduler state visibility and proof-boundary retention.
  It is not foreground UI E2E acceptance, live signed-app recorder acceptance
  under granted TCC, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A Evidence Inbox ledger-written visibility

- `RecorderEvidenceCandidateSummary` already decodes `proofLedgerEventId` /
  `proof_ledger_event_id` from sidecar review results and Day Memory loop
  snapshots. The Founder Replay Control Evidence Inbox row now uses that value
  to switch its proof status pill from generic `non-proof` to `ledger written`
  once the strict proof-ledger adapter has accepted the external artifact.
- Written candidates render a compact `ledger <event-id>` row with a stable
  accessibility identifier, and the candidate accessibility label includes the
  full proof-ledger event id. Pending/degraded candidates still stay non-proof,
  and rejected candidates remain rejected.
- Verification passed: `xcrun swiftc -parse agentic30/OpenDesignDayPageView.swift
  agentic30/AgenticViewModel.swift` and targeted `git diff --check`.
- This improves the visible Evidence Inbox -> proof-ledger confirmation surface.
  It is not foreground UI E2E acceptance, live signed-app recorder acceptance,
  or new proof-ledger acceptance evidence.

### 2026-07-01 KST — Gate A Evidence Inbox review receipt visibility

- `recorder_evidence_candidate_review_result` now includes top-level
  `candidateId` / `candidate_id` alongside the candidate row and proof-ledger
  fields. This gives the Swift bridge a stable candidate identity even when the
  updated candidate row is absent or not currently visible in the Day Memory
  candidate prefix.
- Swift now decodes the review-result proof fields (`proofLedgerEventId`,
  `proofAcceptedByReview`, `proofAcceptedByEvidenceCandidate`, and
  `proofLedgerWriteAllowed`), stores the latest result as
  `recorderLastEvidenceCandidateReviewResult`, and clears candidate review
  in-flight state by the decoded candidate id.
- Founder Replay Control now shows a compact Day Memory `last review` receipt
  row with candidate id, candidate status, compact ledger event id, and proof
  write on/off state. This makes the review result visible independently from
  the first-three Evidence Inbox candidate rows.
- Verification passed: `node --check sidecar/index.mjs`, `xcrun swiftc -parse
  agentic30/AgenticViewModel.swift agentic30/OpenDesignDayPageView.swift
  agentic30/ContentView.swift agentic30Tests/AgenticViewModelAuthTests.swift`,
  and `bash scripts/xcode-test.sh unit
  '-only-testing:agentic30Tests/AgenticViewModelAuthTests'` (`122/122`).
- This covers Swift/sidecar visibility for the Evidence Inbox review receipt.
  It is not foreground UI E2E acceptance, live signed-app recorder acceptance,
  or new proof-ledger acceptance evidence.

### 2026-07-01 KST — Gate A Evidence Inbox review state refresh

- `recorder_evidence_candidate_review` now refreshes the cached Day Memory Loop
  snapshot after an approved candidate is written through the strict
  proof-ledger adapter. The updated snapshot replaces the candidate row in
  `evidenceBuildResult.created`, updates the Day Memory Review Evidence Inbox
  candidate row when present, and adjusts status counts, `unresolvedCount`,
  `writtenToLedgerCount`, empty states, and warnings.
- The sidecar now recomputes `nextAction` from the updated Day Memory Review and
  Evidence Inbox build result before returning
  `recorder_evidence_candidate_review_result`. This prevents a completed
  proof-ledger write from leaving the UI on a stale `review_evidence_inbox`
  instruction when the pending candidate has already moved to
  `written_to_ledger`.
- Verification passed: `node --check sidecar/index.mjs`, `node --check
  sidecar-tests/recorder-day-loop-ws.test.mjs`, and `node --test
  sidecar-tests/recorder-day-loop-ws.test.mjs` (`3/3`).
- This covers sidecar state continuity after an Evidence Inbox proof write. It
  is not foreground UI E2E acceptance, live signed-app recorder acceptance, or
  granted-TCC capture proof.

### 2026-07-01 KST — Gate A Day Memory next-action context visibility

- `RecorderNextActionResult.Action` now decodes the sidecar's richer next-action
  contract: `priority`, `reason`, `preferredBy` / `preferred_by`, `sourceIds` /
  `source_ids`, and `targetCandidate` / `target_candidate`, in addition to the
  existing action type, title, instruction, and proof effect.
- Founder Replay Control now renders the Day Memory next action as a compact
  actionable block instead of a single type/title line. The visible row includes
  priority/action/title, instruction, reason, target candidate, and source ids
  when present; the accessibility label preserves the same context plus the
  `proofEffect` non-proof boundary.
- Verification passed: `xcrun swiftc -parse agentic30/AgenticViewModel.swift
  agentic30/OpenDesignDayPageView.swift
  agentic30Tests/SidecarEventDecodingTests.swift`, targeted `git diff --check`,
  and `bash scripts/xcode-test.sh unit
  '-only-testing:agentic30Tests/SidecarEventDecodingTests'` (`132/132`).
- This improves the Day Memory Review -> one next action handoff. It is not
  foreground UI E2E acceptance or live signed-app recorder acceptance under
  granted TCC.

### 2026-07-01 KST — Gate A Evidence Inbox rejection root-cause UI

- Founder Replay Control reviewable Evidence Inbox candidate rows now separate
  approval and rejection controls. Approval still requires an explicit external
  artifact location, while rejection now has its own `Reject root cause` field.
- The Reject button is disabled until the founder enters a non-empty reason, and
  `rejectEvidenceCandidate` sends that founder-entered reason to
  `recorder_evidence_candidate_review` instead of the previous fixed generic UI
  string. This keeps verifier rejection evidence explicit and user-authored.
- Verification passed: `xcrun swiftc -parse
  agentic30/OpenDesignDayPageView.swift` and targeted `git diff --check`.
- This improves the visible Evidence Inbox review integrity. It is not
  foreground UI E2E acceptance or live signed-app recorder acceptance under
  granted TCC.

### 2026-07-01 KST — Gate A live signed runner reuse diagnostics

- Tightened the non-foreground live signed runner handoff so stale runner reuse
  state is visible instead of silent.
- `scripts/xcode-test.sh` now reports why a marked reusable runner is ignored:
  no marker, empty marker, missing app, invalid Agentic30 runner identity, or a
  marker outside the selected DerivedData search root. The live signed wrapper no
  longer suppresses that stderr while deciding whether to reuse a runner, so a
  stale `~/Library/Developer/Xcode/DerivedData` marker is exposed before the
  script rebuilds/resigns the runner in
  `build/ui-e2e/live-signed-runner-derived-data`.
- The `ui-prepare-runner` identity output now includes the
  `com.apple.security.network.server` entitlement status, selected DerivedData
  search root, and marker path alongside runner app path, bundle id, cdhash,
  signature, and Accessibility target.
- Verification passed: `bash -n scripts/xcode-test.sh
  scripts/run-live-signed-recorder-ui-e2e.sh`, `shellcheck
  scripts/xcode-test.sh scripts/run-live-signed-recorder-ui-e2e.sh`, targeted
  `git diff --check`, and `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1
  AGENTIC30_LIVE_SIGNED_PREPARE_RUNNER_ONLY=1
  AGENTIC30_DISABLE_UI_E2E_CAFFEINATE=1 bash
  scripts/run-live-signed-recorder-ui-e2e.sh`. The prepare-only run verified the
  existing signed app, printed the stale marker/root mismatch, built and
  re-signed the selected-root runner, and ended with
  `network.server entitlement: true`.
- This reduces ambiguity around the current runner Accessibility blocker. It is
  not foreground UI E2E acceptance, live signed-app recorder acceptance, granted
  recorder TCC proof, or proof-ledger acceptance.

### 2026-07-01 KST — Gate A live signed Automation Mode preflight

- Split the current live signed preflight blocker taxonomy so macOS Automation
  Mode is no longer collapsed into `runner_accessibility_blocked`.
- `testFounderReplayLiveSignedAppRunnerAccessibilityPreflight()` now runs
  `/usr/bin/automationmodetool status` and includes the exit status/output in
  the `Founder Replay Live Signed Runner Accessibility Trust` attachment beside
  `AXIsProcessTrusted()`, runner identity, frontmost app, signed app path, and
  XCUITest visibility counts.
- `scripts/run-live-signed-recorder-ui-e2e.sh` now runs the same Automation Mode
  check after signed-app verification and runner preparation, but before writing
  the app-path marker or launching any foreground UI E2E leg. Build-only and
  prepare-runner-only workflows still skip this gate so signing and runner grants
  can be prepared without enabling foreground UI automation.
- If Automation Mode is disabled, the wrapper exits with
  `automation_mode_disabled` and status `3`; the XCTest preflight also fails
  early with the same root cause if reached. This keeps an empty XCUITest tree
  from being misreported as only a runner TCC grant problem.
- Operators can opt in to the machine-local enable step with
  `AGENTIC30_LIVE_SIGNED_ENABLE_AUTOMATION_MODE=1`. The wrapper then runs
  `automationmodetool enable-automationmode-without-authentication`, prints the
  command output, re-checks status, and still exits before foreground UI with
  `automation_mode_enable_failed` or `automation_mode_enable_unverified` unless
  the follow-up status proves Automation Mode is enabled.
- Verification passed: `/usr/bin/automationmodetool status`, `xcrun swiftc
  -parse agentic30UITests/agentic30UITests.swift`, `bash -n
  scripts/run-live-signed-recorder-ui-e2e.sh scripts/xcode-test.sh`,
  `shellcheck scripts/run-live-signed-recorder-ui-e2e.sh
  scripts/xcode-test.sh`, targeted `git diff --check`, and `xcodebuild
  build-for-testing -project agentic30.xcodeproj -scheme agentic30UITests
  -destination 'platform=macOS' -quiet`. The wrapper-level verification
  `AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1
  AGENTIC30_DISABLE_UI_E2E_CAFFEINATE=1 bash
  scripts/run-live-signed-recorder-ui-e2e.sh` verified the signed app and runner
  handoff, then stopped before foreground UI with
  `live_signed_wrapper_exit_status=3` and `automation_mode_disabled`.
  Fake-tool opt-in verification also stopped before foreground UI with
  `automation_mode_enable_failed` and `automation_mode_enable_unverified`.
- Current non-foreground verification reports `Automation Mode is disabled`.
  The next full live signed run cannot reach capture/search/delete until
  Automation Mode is enabled. This is not foreground UI E2E acceptance, live
  signed-app recorder acceptance, granted recorder TCC proof, or proof-ledger
  acceptance.
