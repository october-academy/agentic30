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
- Synchronized frame rows: screenshot, text, app/window/browser/document metadata, trigger, hashes, timestamp.
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
- `encrypted INTEGER NOT NULL DEFAULT 0`
- `workspace_id TEXT`
- `project_id TEXT`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

Allowed `asset_type` values:

- `frame_jpeg`
- `audio_m4a`
- `export_bundle`

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

- **Capture cadence (Gate A):** default min interval, max-gap fallback, CPU/battery + storage budgets, multi-monitor, idle/sleep/wake, duplicate-frame suppression threshold. Gate A cannot claim event-driven completion without these values and tests.
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
