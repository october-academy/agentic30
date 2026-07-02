# Agentic30 Founder Memory OS SPEC

> Design approved: 2026-06-27 KST · Status: **Final design — approved to build through the Section 13 gates.**
> Revised 2026-07-02 KST: frame-storage architecture review incorporated (Section 15) — tiered aging ladder, dedup/cadence semantics and authority, storage budget contract, long-horizon retention.
> Revised again 2026-07-02 KST (founder direction, Section 15 second entry): indefinite local retention + end-to-end-encrypted cloud archive (Gate E, Section 10.7), screenpipe-style snapshot compaction via VideoToolbox (Gate A.2), unified visual pointer, `video_quality` resolution profiles. Deletion semantics unified: explicit user delete / budget pressure / user-configured TTL only — compaction and archival are never deletions.
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
- end-to-end-encrypted cloud archive for long-horizon durability (user-held keys, explicit opt-in; Gate E)

and excludes:

- new cloud model/provider integration
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

All other surfaces exist to support that journey. A raw API, search result, memory summary, product event, usage aggregate, or pipe output is never proof by itself.

macOS permission acquisition is handled by the native permission helper whose normative contract is Section 4.1. The helper is part of the recorder permission ladder, not a TCC bypass: it resolves the actual protected-API actor, requests native macOS permission APIs from that actor where possible, opens System Settings with manual fallback instructions, uses drag guidance only for OS/pane combinations proven by validation, and marks success only after the correct actor passes preflight or runtime probe checks.

## 2. Scope Contract

### 2.1 In Scope

- macOS-only always-on event-driven recorder after explicit consent.
- Visible recording state, pause, stop-for-today, delete, retention, and storage-budget controls.
- Screen Recording and Accessibility as core capture permissions, granted through the native macOS permission helper with actor identity checks and runtime probes.
- Event Tap/Input Monitoring, Clipboard, Microphone/System Audio, Vision OCR, Browser URL capture, and file/document metadata as required permission surfaces with per-surface consent and explicit helper health states where macOS TCC is involved.
- Synchronized frame rows: encrypted keyframe snapshot, text, app/window/browser/document metadata, trigger, hashes, timestamp, and optional non-proof compacted-chunk offsets.
- Audio chunks and local transcript state.
- Redacted FTS search over frames, transcripts, memory items, and product events.
- Day Memory Review, search/timeline, Evidence Inbox, and memory views.
- Tiered visual-memory aging (hot encrypted frames -> compacted encrypted chunks -> cold text/aggregates/rollups) serving day/month/quarter/year founder coaching.
- Snapshot compaction (hot JPEG -> encrypted HEVC chunks via VideoToolbox) as a storage-optimization tier move, never a deletion (Gate A.2).
- End-to-end-encrypted cloud archive to a user-configured S3-compatible target (user-held keys only, explicit opt-in, deletion propagation; Gate E, Section 10.7).
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
- Cloud team memory/sync.
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
- Snapshot compaction lifecycle: JPEGs older than a minimum age are batch-encoded into HEVC chunks per monitor, frame rows are repointed, and originals are deleted only after the chunk file and the repoint transaction have committed (crash-safe, no data loss).
- Zero-knowledge archive shape: client-side encryption, watermark-tracked upload of time-window sync chunks, and restore on demand.
- One `video_quality` knob driving snapshot max width, JPEG quality, and chunk encoding quality together.

### 3.2 Adapt For Agentic30

Screenpipe is a general personal memory product. Agentic30 adapts it into a founder execution OS:

- Background recording is workday memory, not productivity surveillance.
- Search is for execution context, evidence lookup, and replay.
- Raw APIs are for local app/sidecar/tooling and debugging, not broad external access.
- Raw SQL access is a bounded inspector for local diagnostics and custom analytics, not a general API surface, not a write path, and not a proof source.
- Automations are local execution support, not autonomous business agency.
- Memory summaries must become Day Memory Review, Evidence Inbox, and next-action inputs.
- Proof extraction must feed existing Day progress and Office Hours contracts.
- Snapshot compaction is adapted to macOS-native encoding: VideoToolbox hardware HEVC instead of a bundled ffmpeg/libx265 (GPL-incompatible with proprietary DMG distribution, 30-70MB binary + signing surface, and real CPU/battery cost in an always-on menu-bar app; the M-series media engine encodes at near-zero CPU). Acceptance is a measured byte budget, not a CRF number (Section 16.3), with a measured kill criterion: if the live median reduction is below 1.5x, compaction ships disabled.
- Screenpipe's cloud archive is adapted, not copied: the key hierarchy is strengthened (user passphrase -> Argon2id KEK -> random archive master key, instead of an auth-token-derived key), the uploader is never a second delete path (archive-verified upload is a deletion precondition, not a trigger — Section 10.7), and restore is manifest-based time-range selection instead of full-archive download.
- The storage-resolution decision is made explicit: the benchmark's dominant saving is the resolution cap, ahead of the codec. Capture stores at `effective_width = min(1x logical width, snapshot_max_width)` per the `video_quality` profile (Section 16.3).

### 3.3 Reject

Reject these patterns:

- Cross-platform collector work.
- Rust backend rewrite.
- Screenpipe DB import or direct Screenpipe filesystem reads.
- Mutating SQL, unbounded SQL, multi-statement SQL, or SQL access to external databases.
- Provider-readable or plaintext cloud archive, cloud team sync/team memory, cloud transcription, or new model-provider integration. (The original ground for rejecting "cloud archive" was an operator who can read your memory; the zero-knowledge, user-keyed archive in Section 10.7 does not have that property and is in scope as Gate E.)
- Screenpipe's auth-token-derived archive key (an operator who knows the token can derive the key — not zero-knowledge) and its upload-triggered local deletion.
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
6. **Cloud Archive (Gate E):** end-to-end-encrypted archive to a user-configured target; requires setting a recovery passphrase and acknowledging the "passphrase + device both lost = archive unrecoverable" boundary (Section 10.7). Default off.

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
- `dedupe_reference` (dedupe rows only; text lives on the original frame — Section 6.2)

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

Weekly/monthly/quarterly/yearly review surfaces are explicitly deferred to a follow-up spec. This SPEC only guarantees that their substrate survives (cold tier of the Visual Storage Contract; Sections 6.14 and 10.5): surfaces can be added later, deleted data cannot be recovered.

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
- compaction chunk encoding on sidecar request: VideoToolbox hardware HEVC with job-scoped, memory-only decryption of hot JPEGs (Section 6.1 exception; plaintext frames stay in `CVPixelBuffer` memory, never on disk)
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
- compaction lifecycle: polling, frame selection, chunk verification (decrypt + MP4 box parse + frame-count match, before the asset row is inserted), frames repoint, and original-JPEG removal (Section 16.3)
- cloud archive uploader, watermark state, deletion propagation, and restore (Gate E, Section 10.7)
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

Agentic30 does not store an unconditional per-second screenshot log. The recorder stores visual history as a **tiered aging ladder**: data moves from raw JPEG into compact encrypted video chunks and cheap text/aggregate rows locally, and — when the user enables the archive — into an end-to-end-encrypted cloud archive for indefinite durability. Compaction and archival are storage optimizations, never deletions.

1. **Hot frame tier** — encrypted keyframe snapshot media (`asset_type=frame_jpeg`) plus `frames` rows, redacted OCR/AX text, app/window/browser/document metadata, event trigger, hashes, and sink eligibility. This tier powers redacted search, Day Memory Review, Evidence Inbox, deletion, retention, and any proof-boundary checks. All snapshot media — automatic and manual capture alike — is encrypted at rest per Section 6.1; a plaintext snapshot file on disk is a defect. Hot JPEGs have no TTL of their own: they live until the compaction repoint replaces them (Gate A.2) or a Section 10.5 deletion cause removes them.
2. **Compacted chunk tier (Gate A.2)** — encrypted HEVC fragmented MP4 chunks (`asset_type=screen_video_chunk`) at the stored snapshot resolution (single `video_quality` authority, Section 16.3; no separate chunk knob). Compaction batch-encodes hot JPEGs into chunks and repoints their frame rows; chunks then serve both visual replay and long-horizon visual memory. Chunks are not proof, never satisfy proof-ledger acceptance, and never bypass the frame/OCR/event rows that feed product decisions. Searchable text and evidence candidates continue to come from rows, never from chunk pixels.
3. **Cold long-horizon tier (Gate A)** — `frames` rows with redacted text and metadata (retained independently of media, Section 10.5), `usage_daily_aggregates` rows (Section 6.14), `product_events`, and rollup `memory_items`. This tier is the primary substrate for weekly/monthly/quarterly/yearly founder coaching and must remain byte-cheap (tens of KB per frame at most; see the Section 6.2 column prohibition).
4. **Archive durability layer (Gate E, Section 10.7)** — end-to-end-encrypted sync chunks in a user-configured S3-compatible target. The archive is a durability replica with user-held keys, not a policy sink: it never changes privacy/redaction states, never serves silent cloud queries, and honors deletion propagation.

**Deletion rule (single authority):** recorder data is deleted only by (a) an explicit user delete, (b) storage-budget pressure (Section 10.6 ladder), or (c) a user-configured TTL. Compaction is not deletion — original JPEGs are removed only after the chunk file and the frames repoint transaction have committed (Section 16.3). Archival is not deletion — the uploader never deletes; instead, **archive-before-expiry** makes checksum-verified upload a precondition for (b) and (c) when the archive is enabled (Section 10.7). **Compaction-before-expiry** additionally requires a day's cold-tier outputs (`usage_daily_aggregates` rows and the `daily_summary` memory item) to be committed before that day's visual data leaves local disk via (b) or (c). Explicit user deletes always win immediately, skip both preconditions, and propagate to the archive: privacy beats memory.

**Dedupe asset ownership:** a frame row carrying `dedupe_of_frame_id` shares the original frame's `snapshot_asset_id`, writes no new media file, and re-runs no OCR/AX extraction (Section 6.2). `media_assets` rows may therefore be referenced by multiple frames; a media asset is physically deleted only when no live (non-deleted) frame references it, and a frame's delete receipt must state whether its asset was removed or retained for surviving references.

**Unified visual pointer:** a frame's visual source is always the pair (`snapshot_asset_id`, `snapshot_offset_index`) — a `frame_jpeg` asset with a null offset before compaction, a `screen_video_chunk` asset with the frame's index after the compaction repoint. There is no separate replay pointer column and no reader fallback chain. If a chunk is removed without rewrite (fail-closed downgrade, Section 16.3), surviving frames keep pointing at the tombstoned asset and readers return the named error `ERR_RECORDER_MEDIA_CHUNK_REMOVED` — rows, redacted text, and search survive; the pixels are gone.

Gate A ships from the hot frame tier plus the cold-tier rows; until Gate A.2 ships, the visual horizon is bounded by the storage budget and the UI must say so (Section 10.6). Compaction/chunks are the Gate A.2 contract and stay disabled until live signed-app acceptance proves chunk encoding verification, deletion, retention, path hiding, and UI-visible replay behavior under granted TCC. Chunks are registered as `media_assets` with `asset_type=screen_video_chunk`; this SPEC does not add a separate `video_chunks` table.

If a frame or visible range is deleted, every chunk overlapping that deleted time range must be physically removed or rewritten before the delete receipt is accepted. If a chunk is removed instead of rewritten, surviving frame rows outside the deleted range keep their snapshot/search metadata but lose pixels (named error above), and replay exports are invalidated. The atomicity, crash-recovery, and failure-downgrade rules for compaction and delete-or-rewrite are part of the Gate A.2 contract in Section 16.3.

### 6.0 Schema Inventory

This spec defines **13 base tables**. Migrations must create exactly these (any 14th base table must be named here first). The count excludes the Section 7 FTS5 virtual tables and the shadow tables SQLite creates for them (`*_data`, `*_idx`, `*_content`, `*_docsize`, `*_config`), plus SQLite internals (`sqlite_*`); a schema census or snapshot test must apply the same exclusions rather than flagging FTS artifacts as unnamed tables:

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
13. `usage_daily_aggregates`

Section 6.1 (Raw Media Protection) is a requirements block, not a table.

### 6.1 Raw Media Protection

Raw media cannot rely on path secrecy alone.

Requirements:

- media root permissions `0700`
- file permissions `0600`
- random non-guessable filenames
- no direct path in API responses unless caller has `raw_admin`
- per-file SHA-256 in DB
- **encryption at rest is required for all snapshot/audio media — automatic, background, and manual capture alike — before any raw capture ships.** The implemented contract is normative: a per-file AES-256-GCM envelope with a random 96-bit nonce per file and an `encryption_key_id` for key rotation, key stored in Keychain. Key loss is fail-closed: media becomes unreadable with an explicit error, never silently served or re-keyed. Until encryption + key management + log/diagnostics exclusion land, raw frame/audio capture stays out of the build and the host-user trust boundary is recorded explicitly
- per-`asset_type` encryption invariant: `frame_jpeg`, `screen_video_chunk`, and `audio_m4a` require `encrypted=1`; `export_bundle` follows the export manifest policy. Writers reject an unencrypted row for a required type; a plaintext snapshot on disk is a defect, not a mode
- decryption happens only inside the sidecar recorder data plane (RecorderStore-mediated streaming for `GET /recorder/frames/:id/image`, Day Memory Review thumbnails, and replay), with exactly one named exception: the Swift compaction encoder receives a job-scoped, memory-only key handoff over the authenticated bridge to decrypt hot JPEGs for chunk encoding — plaintext stays in `CVPixelBuffer` memory, is never written to disk, and the key material is never logged (auth-context scrubbing rules apply). This exception covers the encoding job only; it does not extend decryption rights to Pipes, MCP, or any API surface. Plaintext media is never written to temp files, caches, logs, or diagnostics
- decryption is whole-file: a chunk is decrypted as a unit for replay or frame extraction, so the chunk size cap (<= 100 frames / <= 16MB, Section 16.3) is part of this encryption contract — it bounds the memory a single decryption may require
- Pipes never receive the media root path, raw API token, or unrestricted filesystem grants
- symlinks and path traversal are rejected
- orphan-file containment: if a capture envelope fails to send or is rejected by ingest, the capture side must delete the already-written media file (compensating cleanup); the retention sweep must additionally walk the media tree and remove files not referenced by `media_assets` once they are older than a grace window — at least 2x the compaction poll interval for `media/replay/` (so in-flight chunk encodes are never swept) and at least the compaction minimum age for `media/frames/` — reporting counts in the retention result
- the media root is excluded from Spotlight (`.noindex`) and marked for Time Machine exclusion at creation; TTL sweeps run in low-load/idle windows

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
- `document_path_search_label TEXT`
- `snapshot_asset_id TEXT NOT NULL`
- `snapshot_offset_index INTEGER` *(added by the Gate A.2 migration; the frame's index within a compacted chunk — null while the snapshot asset is a `frame_jpeg`. There is no separate replay pointer: see the Visual Storage Contract unified visual pointer)*
- `capture_sequence INTEGER NOT NULL`
- `dedupe_of_frame_id TEXT`
- `snapshot_sha256 TEXT NOT NULL`
- `content_hash TEXT` *(writer-enforced non-null at ingest; cleared with the raw minimization window — see Column Semantics)*
- `simhash TEXT` *(cleared with the raw minimization window — see Column Semantics)*
- `text_source TEXT NOT NULL`
- `text_provenance_root_cause TEXT`
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

#### Column Semantics And Dedup Contract

These definitions are part of the Gate A capture-envelope contract (Section 16.3); column names alone are not implementable.

- `content_hash` — SHA-256 over the **pre-encryption** capture content: the normalized AX/OCR plain text concatenated with the context key (`app_name`, `window_title`, `browser_url_normalized`, `document_path`, `monitor_id`). When no text is available it falls back to the SHA-256 of the plaintext JPEG bytes. Computed by the Swift collector at capture time, before any encryption. A ciphertext digest is never a valid `content_hash` — AES-GCM's random nonce makes it non-deterministic and useless for dedup, and `snapshot_sha256` already covers the stored bytes.
- `simhash` — 64-bit perceptual hash (dHash over a downsampled grayscale plaintext frame), computed by Swift. Initial acceptance threshold: Hamming distance <= 3/64 counts as visually identical (tunable; calibrate against screenpipe's 5% visual-change reference).
- Raw-derived digest lifecycle: `content_hash` and `simhash` exist only for the ingest dedup window — dedup always compares against the last persisted frame per monitor (Section 16.3), so neither digest has any purpose after the raw minimization window (Section 10.5, default 24h) closes. A digest of raw content is still raw-derived: left in place it becomes a confirmation-attack target (hash a guessed document, URL, or window text and compare against the stored digest) that would otherwise outlive the raw fields by the whole row lifetime. The retention sweep therefore clears both columns whenever it clears the frame's raw AX/OCR text and raw browser/document fields (Section 10.5). The columns are nullable in schema for exactly this reason; ingest still writer-enforces presence — a frame envelope without `content_hash` is an explicit error, not a null row. HMAC-with-rotating-key was considered and rejected: the digests have no post-window purpose, so clearing them is strictly stronger and simpler than key management.
- `capture_sequence` — monotonically increasing per `monitor_id` within one recorder capture session, generated by Swift; gaps are allowed and the counter resets on session restart. It orders frames; it does not identify them (`id` does).
- Duplicate suppression: the sidecar ingest is the single cadence/dedup authority (Section 16.3). A capture whose dedup context key (same app/window/browser/document/monitor) matches the previous persisted frame AND whose `content_hash` matches exactly (or whose `simhash` is within threshold) is either skipped or persisted as a dedupe row: `dedupe_of_frame_id` points to the original, `snapshot_asset_id` reuses the original's asset (Visual Storage Contract), text columns stay null, OCR/AX extraction is skipped, and `text_source` records the provenance value `dedupe_reference` (Section 4.1).
- Dedupe row semantics: `dedupe_of_frame_id` always points at the root original frame (the row that owns the extracted text), never at another dedupe row — ingest flattens chains. A dedupe row still carries its own `captured_at`, `capture_sequence`, `monitor_id`, and app/window/browser/document context columns; only text extraction is skipped. Dedupe rows are never FTS-indexed (`safe_for_search` stays 0 — there is no text to index): content search resolves to the original frame, while timeline surfaces, Day Memory Review, and `usage_daily_aggregates` derivation read dedupe rows' metadata directly, so a duplicate-heavy hour still counts as screen time. A user delete of an original frame includes its dedupe chain in the same receipt — a dedupe row without its original is content-free and must not keep the shared asset alive after a privacy delete. TTL row expiry needs no cascade: expiry is uniform by `captured_at`, and a dedupe row that briefly outlives its expired original stays valid for timeline/aggregate reads.
- Envelope idempotency: re-sending an identical envelope (same frame `id`, same `snapshot_sha256`) is an idempotent no-op success; the same `id` with different content is an explicit error. Hard-failing every duplicate `id` is not compliant — retries must be safe.
- Compaction repoint: the Gate A.2 compaction transaction repoints `snapshot_asset_id` to the chunk asset and sets `snapshot_offset_index` for the batch's originals **and their dedupe rows together** (one `UPDATE ... WHERE snapshot_asset_id = :jpeg_asset AND deleted_at IS NULL`). `snapshot_sha256` and `content_hash` are capture-time provenance and are never rewritten by compaction — envelope idempotency and dedup history stay valid. The replaced JPEG asset row is tombstoned with audit root cause `compaction_repoint`, distinguishing tier moves from privacy deletes.

Column prohibition: `frames` must not grow AX-tree JSON or OCR word-box JSON columns (screenpipe's `text_json`/`accessibility_tree_json` pattern measures ~100KB+/frame — an 8x row-size blowup that destroys the cold tier's year-scale viability). Any such column must be named here first, like the Section 6.0 table rule.

### 6.3 `media_assets`

Required columns:

- `id TEXT PRIMARY KEY`
- `asset_type TEXT NOT NULL`
- `relative_path TEXT NOT NULL`
- `sha256 TEXT NOT NULL`
- `byte_size INTEGER NOT NULL`
- `width INTEGER`
- `height INTEGER`
- `container TEXT` *(added by the Gate A.2 migration)*
- `codec TEXT` *(added by the Gate A.2 migration)*
- `duration_ms INTEGER` *(added by the Gate A.2 migration)*
- `frame_count INTEGER` *(added by the Gate A.2 migration)*
- `monitor_id TEXT`
- `capture_session_id TEXT` *(added by the Gate A.2 migration)*
- `time_range_start_at TEXT` *(added by the Gate A.2 migration)*
- `time_range_end_at TEXT` *(added by the Gate A.2 migration)*
- `encrypted INTEGER NOT NULL DEFAULT 0`
- `encryption_key_id TEXT`
- `encryption_alg TEXT`
- `encryption_nonce TEXT`
- `encryption_tag TEXT`
- `source_ids_json TEXT`
- `workspace_id TEXT`
- `project_id TEXT`
- `created_at TEXT NOT NULL`
- `deleted_at TEXT`

Allowed `asset_type` values:

- `frame_jpeg`
- `screen_video_chunk`
- `audio_m4a`
- `export_bundle`

`screen_video_chunk` assets must be encrypted at rest, path-hidden from non-`raw_admin` API responses, and stored under `media/replay/`. They carry MP4/container metadata only; searchable text and evidence candidates must continue to come from `frames`, transcript, clipboard, memory, and product-event rows. Chunk files are the compacted storage of hot frames, not a second capture product: after the compaction repoint, `frames.snapshot_asset_id` points at a chunk asset, so every frame-delete path must be chunk-aware — asset-type-branched validation, a `media/replay/` path validator, and a chunk tombstone `relative_path` under `media/replay/deleted/`. A frame delete that hard-fails on `asset_type != 'frame_jpeg'` is a defect.

Schema invariants:

- `width`/`height` record the pixel dimensions of the stored asset and are required for `frame_jpeg` and `screen_video_chunk` rows — the `video_quality` `snapshot_max_width` acceptance value (Section 16.3) must be auditable by query (`width <= snapshot_max_width`), not by decrypting files. The Swift frame envelope carries `width`/`height` in its snapshot subobject (asset-scoped, once per asset; dedupe envelopes reuse the original's asset and do not repeat it).
- The required-column lists in Sections 6.2/6.3 and the actual `CREATE TABLE`/migration output must match exactly per gate; a schema snapshot test pins this (Section 14). Columns marked *(added by the Gate A.2 migration)* arrive with that gate's forward-only migration, not at first install.
- `media_assets` rows may be referenced by multiple `frames` rows (dedupe sharing). Physical deletion of an asset requires zero live frame references; delete paths must check references, not assume 1:1.

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

`content_hash` is a digest of raw clipboard content and must never outlive the content's retention window: it is cleared no later than `raw_retention_expires_at`, and under `trigger_only` policy it may exist only within the same shortest sensitive TTL it serves for dedup (Section 10.5). A clipboard digest that survives indefinitely is a dictionary-attack oracle for short secrets (passwords, tokens) that pass through the clipboard.

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
- `weekly_summary`
- `monthly_summary`
- `quarterly_summary`
- `yearly_summary`
- `project_summary`
- `product_event_summary`
- `evidence_debt`
- `pipe_output`
- `execution_trace`

Rollup rule: each rollup tier is derived from the tier below **before** that tier's TTL expires (Section 10.5 ordering invariant), cites its source memory IDs in `source_ids_json`, and survives the expiry of the rows it summarizes. A rollup never resurrects deleted raw data — it summarizes what was safe at derivation time and inherits the least-safe source state like any other memory item.

### 6.8 `product_events`

Required columns:

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT`
- `project_id TEXT`
- `event_type TEXT NOT NULL`
- `occurred_at TEXT NOT NULL`
- `title TEXT NOT NULL`
- `summary TEXT NOT NULL`
- `metrics_json TEXT`
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
- `ad_metric_snapshot`
- `post_engagement_snapshot`
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

`metrics_json` rules: numeric and enumerated values only (e.g. `{"ctr":0.021,"spend_usd":12.4,"impressions":8300,"reactions":57}`); free text belongs in `summary` and passes the same redaction gates. Frames from ad/analytics domains (Meta Ads, Google Ads, AdMob, AdSense, PostHog, and user-configured additions) must attempt structured `metrics_json` derivation before the source frame's media TTL expires; a failed derivation is recorded as a derivation failure, not silently skipped. `metrics_json` is coaching input for BIP/marketing trend feedback, never proof (Section 11), and never advances Day progress, evidence counts, or revenue state.

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

### 6.14 `usage_daily_aggregates`

Long-horizon, byte-cheap usage rollups — the cold tier's aggregate substrate (Visual Storage Contract). Rows are derived from `frames` metadata before frame expiry (compaction-before-expiry ordering, Section 10.5) and contain no raw text, no URLs beyond the already-sanitized domain, and no media references.

Required columns:

- `id TEXT PRIMARY KEY`
- `day TEXT NOT NULL` (local calendar date, `YYYY-MM-DD`)
- `workspace_id TEXT NOT NULL DEFAULT ''`
- `project_id TEXT NOT NULL DEFAULT ''`
- `app_name TEXT NOT NULL DEFAULT ''`
- `browser_domain TEXT NOT NULL DEFAULT ''`
- `frame_count INTEGER NOT NULL`
- `first_seen_at TEXT NOT NULL`
- `last_seen_at TEXT NOT NULL`
- `active_ms_estimate INTEGER`
- `event_counts_json TEXT` (per-trigger counts, e.g. app switches / clipboard copies)
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Rules:

- Uniqueness: one row per `(day, workspace_id, project_id, app_name, browser_domain)`, enforced by a unique index over exactly those five columns, which re-derivation upserts against (`ON CONFLICT` target). SQLite treats NULLs as distinct in unique indexes — nullable dimension columns would both allow duplicate rows and make the upsert miss — so the four dimension columns are `NOT NULL` with the empty string `''` as the explicit "none" sentinel: derivation normalizes absent `frames` values to `''`, and readers treat `''` as unattributed.
- Aggregates answer trend questions ("how often was the Meta Ads dashboard open last quarter") after the source frames are gone; they are the cheapest layer of the coaching substrate (KB per day, viable for years).
- Aggregates are not proof and never advance Day progress, active-user counts, evidence counts, or revenue state (Section 11).
- Retention: indefinite, user-delete only (Section 10.5). Full-day user deletion offers deleting that day's aggregates alongside frames.

## 7. Search And Indexing

The implementation uses SQLite FTS5. This needs the direct SQLite dependency in Section 16.2 — FTS5 virtual tables and the sync triggers below do not exist in the sidecar today. Each base table indexed below (`frames`, `transcript_segments`, `memory_items`, `product_events`) carries a `safe_for_search` column (Section 6), so the `safe_for_search=1` predicate is enforceable on every FTS source.

FTS tables:

- `frames_text_fts(frame_id UNINDEXED, redacted_text, app_name, window_title, browser_domain, browser_url_search_label)`
- `transcript_text_fts(segment_id UNINDEXED, redacted_text, speaker_label)`
- `memory_items_fts(memory_id UNINDEXED, title, summary)`
- `product_events_fts(product_event_id UNINDEXED, title, summary)`

Rules:

- FTS indexes only rows where `safe_for_search=1`.
- Dedupe rows (`dedupe_of_frame_id` set) are never FTS-indexed; content hits resolve to the original frame (Section 6.2).
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
- `GET /recorder/archive/status` *(Gate E)*
- `POST /recorder/archive/restore` *(Gate E; explicit user action, manifest-displayed)*

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
- archive control — enable/disable/scope/restore/delete propagation is never a DSL action (Section 10.7)

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
- `retention_days` in a pipe definition governs files under `.agentic30/pipes/<pipe-id>/runs/` only; `memory_items` rows written by a pipe follow the Section 10.5 memory-summary tiers (a pipe-written `daily_summary` follows the daily tier), and `pipe_output`-type memory items follow the Pipe outputs retention row

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

- Raw plaintext is local-only. Ciphertext encrypted with user-held keys may leave the device only through the explicit archive sink (Section 10.7); upload never changes `privacy_state`, `redaction_status`, or `safe_for_*` — the archive is a durability replica, not a policy sink.
- Raw data can be viewed by the local user/admin through raw APIs after auth and audit.
- Raw data cannot enter FTS, memory summaries, pipe outputs, or exports until policy allows it.
- Derived memory inherits the least-safe source state.
- Private app/window/domain exclusions apply before capture.
- Exports require manifest, redaction report, and explicit user action.
- Provider egress is default-deny for recorder-derived data. The archive sink is not provider egress: it is a separately named channel with its own opt-in (Section 4.1 step 6) and never feeds model prompts.

### 10.2 Minimum Redaction Policy Matrix

The redaction policy matrix is a Gate A/Gate C blocker, not implementation polish. No FTS, memory, export, Pipe, provider, or proof-candidate surface may accept a recorder-derived row until its `data_class × sink` rule exists and has tests.

| Data class | Search | Memory | Export | Provider | Pipe | Archive | Required blockers |
|---|---|---|---|---|---|---|---|
| AX/OCR text | redacted only | `safe_for_memory=1` only | `safe_for_export=1` manifest only | default-deny | redacted only | ciphertext only | suppress secrets, API keys, OAuth tokens, private chats, emails, customer names, payment data |
| Browser metadata | domain + sanitized search label only | redacted URL label only | manifest only, no raw URL unless raw-admin export approval | default-deny | domain/search label only | ciphertext only | strip query/fragment/userinfo/token-like path segments before FTS |
| Document metadata | redacted title/path label only | redacted label only | manifest only | default-deny | redacted label only | ciphertext only | never index full local paths; redact home paths and customer/private folder names |
| Clipboard content | off by default; redacted only after opt-in | opt-in + redacted only | never from scheduled pipes | default-deny | trigger metadata only | ciphertext only, within the raw-content window | size cap, content hash, suppression reason, secret/token/password detection |
| Audio/transcript | redacted transcript only | local transcript state + redacted only | manifest only after local transcript completion | default-deny | redacted transcript only | ciphertext only | consent grant, meeting notice, local transcriber provenance, no cloud fallback |
| Product events | safe summaries only | safe summaries only | safe summaries only | default-deny unless explicit typed adapter | redacted summaries only | ciphertext only | preserve source IDs and non-proof flags |
| Usage aggregates | safe (app names/domains/counts only) | safe | manifest only | default-deny unless explicit typed adapter | safe | ciphertext only | no raw text, no full URLs/paths; sanitized domains only |
| Raw SQL result | never direct | never direct | never direct | never direct | never direct | never | must pass through separate typed/redacted adapter before any downstream sink |

Archive-sink blockers (apply to every "ciphertext only" cell): user-held key hierarchy only (Section 10.7), client-side encryption before any byte leaves the device, no server-side plaintext processing ever, deletion propagation honored, and upload changes no privacy/redaction/safe flags.

### 10.3 Prompt-Injection Boundary

Captured text is tainted.

Rules:

- captured text is quoted evidence data, never instructions
- captured text cannot change tool policy
- captured text cannot request API/MCP capabilities
- captured text cannot approve proof or exports
- memory summarizers must separate instructions from evidence payloads
- pipe DSL cannot execute commands derived from captured text
- captured text can never enable, scope, restore, or delete the archive — archive controls are UI-only surfaces (Section 10.7)
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
- product events derived only from deleted sources when the user requests it (default: the safe summary survives and `source_ids_json` re-points at tombstone references)
- usage daily aggregates for the affected day when the user requests full-day deletion
- pipe outputs
- export bundles
- archived copies of the deleted data (deletion propagation, Section 10.7 — a user delete is a lie if the archive keeps the bytes)

SQLite requirements:

- WAL checkpoint after delete batches
- vacuum policy for reclaiming space
- audit-preserving tombstones for raw access history
- export invalidation when source is deleted

Deletion rule (single authority, Visual Storage Contract): recorder data is deleted only by (a) an explicit user delete, (b) storage-budget pressure (Section 10.6 ladder), or (c) a user-configured TTL — there are no defaults-driven TTL deletions of visual or row data anymore. Compaction is a tier move, not a deletion. Two expiry preconditions apply to (b) and (c): **compaction-before-expiry** — a day's visual data leaves local disk only after that day's `usage_daily_aggregates` rows and `daily_summary` memory item are committed, and rollup memory items are derived before the tier below expires; **archive-before-expiry** — when the archive is enabled, only data whose sync chunk upload has been checksum-verified (Section 10.7) may be deleted by (b) or (c). Explicit user deletes skip both preconditions, propagate to the archive, and win immediately — privacy beats memory. Budget-pressure deletions follow the same delete semantics and receipts as TTL deletions; the archive uploader is never a delete path; there is no second, weaker delete.

The **raw minimization window** (default 24h, a fixed privacy dial independent of media retention): raw AX/OCR text, raw browser URL/document-path fields, and the raw-derived digests `content_hash`/`simhash` (Section 6.2) are cleared when this window closes, regardless of how long the media and rows live. Making media retention indefinite must not silently make raw plaintext indefinite. The redacted row lives on as the cold tier's search substrate.

Per-surface retention requirements:

| Surface | Default TTL | User delete behavior | FTS purge | Derived-data invalidation | Known OS-level non-guarantees |
|---|---|---|---|---|---|
| frame media (hot JPEG) | none — lives until the compaction repoint replaces it (Gate A.2); bounded by the Section 10.6 budget backstop, explicit user delete, or a user-configured TTL; before Gate A.2 the budget is the only bound and the UI states the visual horizon | physical media delete + tombstone (asset removed only when no live frame references it) | media removal alone keeps FTS; FTS follows the frame row | invalidate frame-only memory/candidates/exports | Time Machine, external backups, crash dumps |
| frame rows (metadata + redacted text) | indefinite unless the user sets a TTL; budget-pressure deletion only for archive-verified rows (Section 10.6) | row tombstone + redacted text cleared | purge frame FTS at row expiry/delete | recompute or invalidate summaries that depended only on expired rows | Time Machine, external backups |
| compacted video chunks | disabled until Gate A.2; then indefinite local under the storage budget; archive-before-expiry applies when the archive is enabled | physical chunk delete or rewrite before receipt; surviving frames keep the tombstoned pointer and readers return `ERR_RECORDER_MEDIA_CHUNK_REMOVED` (unified visual pointer) | no FTS | invalidate replay exports for affected ranges | Time Machine, external backups, crash dumps, media caches |
| raw AX/OCR text | raw minimization window (default 24h, independent of media retention) unless explicitly retained as raw-local | clear raw columns (including the raw-derived digests `content_hash`/`simhash`) or tombstone row | raw text never indexed | recompute summaries that depended only on deleted source | logs if implementation leaked raw text |
| browser URL/document path raw fields | raw minimization window (default 24h) | clear raw fields when the window closes or with frame delete | sanitized search label/domain follow the frame row | invalidate exports containing labels | browser history outside Agentic30 |
| clipboard raw content | shortest sensitive TTL; default no raw content | clear raw/redacted clipboard text and `content_hash`, keep audit tombstone | purge clipboard FTS rows if any | invalidate clipboard-derived memory/candidates | system clipboard history/managers outside Agentic30 |
| audio media | user opt-in TTL; default metadata-only until raw audio enabled | physical audio delete + tombstone | transcript FTS purge if transcript deleted | invalidate transcript-derived memory/candidates/exports | system audio caches outside Agentic30 |
| transcripts | follows audio/transcript policy | clear raw and redacted transcript segments unless user keeps redacted summary | purge transcript FTS | invalidate memory/candidates sourced only from transcript | meeting app/cloud transcripts not created by Agentic30 |
| memory summaries | indefinite, user delete only (users may set per-tier TTLs; rollups are always derived before a lower tier expires) | delete summary JSON/rows | purge memory FTS | invalidate dependent candidates unless other sources remain; higher rollups survive lower-tier expiry | workspace backups made by user |
| product events | indefinite, user delete only | delete row; on source deletion the safe summary survives by default with `source_ids_json` re-pointed at tombstone references | purge product-event FTS on delete | invalidate candidates sourced only from deleted events | OS backups |
| usage daily aggregates | indefinite, user delete only | delete rows for the day/range | not FTS-indexed | recompute dependent rollups | OS backups |
| archived data (cloud, Gate E) | until the user deletes it | user deletes propagate: overlapping sync chunks are deleted or rewritten in the archive before the delete receipt closes; offline propagation queues as `pending_delete` with a named health state | not indexed | restore never resurrects tombstoned rows | provider-side backups are outside the zero-knowledge boundary only as ciphertext |
| restored archive data | user-managed, default 30d after restore | delete restored rows/media like any local data | follows normal FTS rules for its privacy flags | none beyond normal rules | restored copies excluded from the uploader (no echo) and from TTL sweeps until the user's restore window closes |
| evidence candidates | until resolved or source deleted | delete/reject candidate when all sources deleted | no raw source text indexed | block proof write if source deleted | external proof artifact remains outside Agentic30 |
| Pipe outputs | pipe retention policy, default 30d | delete output manifest/files | purge any indexed output | invalidate exports and follow-on candidates | files copied outside managed pipe dir |
| audit rows | retained for accountability with minimized payload | tombstone only, no raw payload deletion needed | not indexed with raw data | none | OS backups |
| export archives | user-owned until deleted | delete archive and manifest, keep minimized audit tombstone | not indexed | invalidate share/open links | copies moved by user |

Deletion cannot guarantee removal from Spotlight, QuickLook thumbnails, Time Machine, crash logs, app logs, temporary files, export copies, external backups, browser/app histories, or third-party clipboard/meeting tools. The UI must state this boundary before raw capture/export is enabled.

### 10.6 Storage Budget Contract

Storage budget is a Gate A contract (Sections 2.1 and 16.3), not UI polish. With indefinite local retention as the default, the byte budget IS the retention boundary: cadence parameters alone leave a theoretical ceiling near 90GB/day (1s min-interval x multi-monitor x uncapped-resolution capture), dedup efficiency is workload-dependent, and "indefinite local" honestly means "budget-bounded local + indefinite archive" (Section 10.7).

- Measurement scope: recursive bytes under the recorder home (`recorder.sqlite` + WAL + `media/` + `indexes/` + `exports/`), recomputed by every sweep and on demand for the UI.
- Default budget: 100GB total, user-adjustable. The retention UI must show the projected steady-state usage for any finite retention policy (frames/day x bytes/frame x retention days, using `media_assets` averages) and — because the default retention is indefinite — the measured growth rate (GB/year) plus the projected date the budget fills, next to the budget control.
- Soft threshold (80% of budget): the sweep first attempts one compaction cycle regardless of power state (compression preserves memory better than deletion; Section 16.3 `compaction_requires_ac` yields here), then deletes in order, oldest first and respecting both Section 10.5 expiry preconditions: (1) compacted chunks — archive-verified ones first when the archive is enabled; (2) archive-verified frame rows. `usage_daily_aggregates`, memory items, `product_events`, and audit rows are never auto-deleted. Export archives are never auto-deleted; they are counted, named in the UI, and left to the user. With the archive enabled and reachable, budget pressure therefore moves data to the archive rather than destroying it; with no archive, the UI names what will be destroyed before it is.
- Hard threshold (100% of budget): new capture pauses fail-closed, recorder health becomes `storage_budget_exceeded`, and the UI names the state and the recovery actions (raise budget, enable/repair the archive, delete exports, lower a user-set TTL). Capture resumes automatically once usage falls below the soft threshold.
- Budget-pressure deletion and TTL deletion share one code path and one receipt semantics; the archive uploader is never a delete path; there is no second, weaker delete.
- Gate A acceptance requires tests for soft-threshold compaction-then-deletion order, hard-threshold pause + health state, automatic resume, and projected-usage/growth-rate display values.

### 10.7 Cloud Archive Contract (Gate E)

The archive gives "무기한" its honest meaning: local disk holds what the budget allows; the archive holds everything, end-to-end encrypted, for as long as the user wants. It is a durability replica — never a policy sink, never a search backend, never a delete path of its own.

Key hierarchy (user-held, zero-knowledge):

- user recovery passphrase -> Argon2id KEK (parameters fixed and versioned in the manifest; `node:crypto` scrypt is the named allowed alternative, algorithm-ID'd in the manifest) -> wraps a locally generated random 256-bit **archive master key** (stored in Keychain under its own `key_id`, separate from the Section 6.1 media key — local key exposure must not equal archive exposure) -> per-sync-chunk keys derived via HKDF(master, chunk_id), never stored.
- AEAD is the existing AES-256-GCM envelope (single crypto stack); ChaCha20-Poly1305 was considered and rejected — macOS-only means hardware AES everywhere.
- Plaintext key material (master key, chunk keys, passphrase) never leaves the device. The Argon2id-wrapped master-key blob and KDF parameters are uploaded as the archive manifest header — this is what makes "empty machine + passphrase" recovery real. Passphrase + device both lost = archive permanently unrecoverable; the enable flow states this and requires passphrase re-entry verification.
- Key loss is fail-closed with an explicit error, same wording family as Section 6.1; silent re-key is forbidden.

Upload contract:

- Unit: time-window **sync chunks** — encrypted media chunk files plus encrypted row-export JSONL (frames metadata/redacted text, transcripts, product events, memory items, aggregates) with a manifest (time range, source IDs, sha256 checksums, byte sizes).
- A watermark timestamp tracks the verified-uploaded boundary; verification means a checksum comparison (stored object sha256 metadata vs manifest), not an HTTP 200.
- The uploader never deletes local data. Deletion stays with the Section 10.5/10.6 sweep, for which verified upload is the archive-before-expiry precondition.
- Restored data and export archives are excluded from upload (no echo loops).
- Upload failure is a named health state (`archive_upload_failing`), never a silent skip; a growing un-uploaded backlog while budget pressure rises must surface in the UI.

Deletion propagation (Gate E blocker):

- An explicit user delete applies to the archive in the same receipt: overlapping sync chunks are deleted or rewritten (same delete-or-rewrite semantics as local chunks, Section 16.3). If the target is unreachable, the propagation queues as `pending_delete` with a named health state and the receipt says so — the deletion is not silently forgotten.
- Restore consults tombstones and never resurrects deleted rows.

Restore contract:

- Manifest-based time-range selective restore (full-archive download is not the primary path); explicit user action with a displayed manifest (chunk list, byte totals).
- Restored rows keep their original `privacy_state`/`redaction_status`/`safe_for_*`/taint metadata — restore performs no state promotion; FTS re-entry only via the existing `safe_for_search=1` trigger path.
- Restored media is re-encrypted with the local Section 6.1 envelope on landing (one read path; no archive-format-specific reader surface).
- Restored data lands inside the recorder home marked `restored_at`, counts toward the Section 10.6 budget, is excluded from the uploader and from TTL sweeps for its restore window (Section 10.5), and is still recorder media for Section 11 purposes — restoring an old screenshot does not make it external-origin proof.
- Search beyond the local horizon shows "N sync chunks in archive for this range" plus an explicit restore action; there is no silent cloud query.

Storage target:

- Contract: SigV4-signed S3-compatible object storage with the minimal verb set PUT/GET/HEAD/DELETE/List. The verified reference target is Cloudflare R2 (already operated for `updates.agentic30.app`); other S3-compatible stores are best-effort.
- Credentials (access key/secret) live in Keychain, never in sidecar JSON state, and are scrubbed from logs/telemetry like all auth material.
- The archive is the single named exception to the Section 10.1 egress default-deny, as the separately named **archive sink** (Section 10.2 column); it is not provider egress and never feeds model prompts.
- An Agentic30-operated archive service implementing this same client contract (managed storage, Paddle-billed) is a future adapter under a separate spec, per the Section 12 pattern — subscription-lapse grace, data reclamation, and hosting obligations are that spec's problem, not this one's.

Controls: enabling, scoping, restoring, and deleting the archive are UI-only surfaces behind permission-ladder step 6 (Section 4.1). Captured text and Pipe DSL can never touch them (Sections 9.3 and 10.3).

## 11. Proof Ledger Boundary

Recorder data improves proof discovery, not proof standards.

This boundary is enforced by the **existing** proof ledger in `sidecar/execution-os.mjs` (`appendProofLedgerEvent`, `proofEventFingerprint` idempotency, `inferProofStrength`, accepted statuses `accepted|verified|complete|completed`). The recorder writes proof only by calling that adapter; it must not create a parallel ledger or relax its accepted-status/strength rules. See Section 16.1.

Rules:

- raw frame hit is not proof
- transcript hit is not proof
- memory item is not proof
- product event (including its `metrics_json`) is not proof
- usage aggregate row is not proof
- pipe output is not proof
- archive-restored data is not proof (it remains recorder media — restore confers no external origin)
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
- cadence + dedup authority at sidecar ingest with the Section 16.3 acceptance values and boundary tests
- storage budget contract (Section 10.6): soft/hard thresholds, `storage_budget_exceeded` health state, projected-usage display
- cold-tier long-horizon rows: `usage_daily_aggregates`, `product_events` retention + `metrics_json` derivation-before-media-TTL, rollup memory types, the raw minimization window, and compaction-before-expiry ordering
- orphan media containment: capture-side compensating cleanup plus retention-sweep orphan scan
- visual-horizon honesty: until Gate A.2 ships, UI copy states that visual memory is bounded by the storage budget (Section 10.6)

### Gate A.2: Snapshot Compaction And Chunks

Ships after Gate A acceptance, independently of Gates B-D; chunks stay disabled until this gate's live signed-app acceptance passes.

- compaction lifecycle (sidecar-owned) + VideoToolbox chunk encoding (Swift-owned) per Section 16.3
- unified-pointer migration: `snapshot_offset_index`, `media_assets` chunk-metadata columns, `asset_type` CHECK rebuild to include `screen_video_chunk` (one forward-only migration)
- chunk-aware frame delete path (type-branched validation, `media/replay/` path validator, chunk tombstone path)
- delete-or-rewrite with `pending_delete` ordering, crash recovery, fail-closed downgrade, and named health states (Section 16.3)
- measured kill criterion: live median byte reduction >= 1.5x, else compaction ships disabled (Section 16.3)
- indefinite visual retention becomes the effective default only when this gate ships — compaction is what makes it affordable

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

### Gate E: Cloud Archive

- key hierarchy + empty-machine recovery rehearsal (Section 10.7)
- sync-chunk uploader with checksum-verified watermark and named failure health states
- archive-before-expiry wired into the TTL/budget sweep as a deletion precondition
- deletion propagation (including offline `pending_delete` queueing) proven before any local deletion depends on the archive
- manifest-based selective restore with no state promotion, no upload echo, and tombstone non-resurrection
- permission-ladder step 6 opt-in UI with the unrecoverability boundary stated
- R2-verified S3 contract; credentials in Keychain; egress limited to the named archive sink

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
- cadence boundary tests for the four Section 16.3 values, enforced at sidecar ingest (min-interval, debounce, active/idle max-gap)
- dedup tests: context+content-hash skip, simhash Hamming threshold, dedupe-row asset sharing, shared-asset delete with surviving references, dedupe-chain flattening to the root original, original-delete cascading its dedupe chain, dedupe-row FTS exclusion
- envelope idempotency tests: identical resend is a no-op, same-id-different-content is an explicit error
- orphan media tests: ingest-rejected file compensating cleanup plus sweep of unreferenced files
- zero-plaintext-media test: every `frame_jpeg`/`audio_m4a`/`screen_video_chunk` on disk is encrypted, manual capture included
- schema snapshot tests pinning Section 6.2/6.3 required columns to the actual CREATE TABLE/migration output per gate
- storage budget tests: soft-threshold acceleration, hard-threshold pause + `storage_budget_exceeded`, automatic resume, projected-usage values
- compaction-before-expiry ordering tests: frame sweep blocked until daily aggregates + daily summary commit
- product-event retention tests: indefinite survival, tombstone re-pointing on source deletion, FTS purge on delete
- rollup survival tests: weekly/monthly rollups outlive expired daily summaries and never resurrect deleted raw data
- `metrics_json` derivation tests: ad/analytics-domain frames attempt derivation before media TTL, failures recorded, non-proof invariant enforced
- raw-derived digest expiry tests: `content_hash`/`simhash` cleared together with raw text/fields at frame-media TTL; clipboard `content_hash` never outlives its raw-content window
- `usage_daily_aggregates` uniqueness tests: `''` sentinel normalization at derivation and NULL-free unique upsert (re-derivation updates rows with unattributed dimensions, never duplicates them)
- warm chunk delete-or-rewrite tests (Gate A.2): overlapping-range chunk delete/rewrite, `pending_delete` crash recovery on restart, fail-closed rewrite-to-delete downgrade, stale replay/offset reference clearing for surviving frames (Section 16.3)

## 15. Review Evidence And Disposition

Reviews incorporated into this final design:

- **Product/UX:** the expanded scope is too broad unless anchored to Day Memory Review -> Evidence Inbox -> Next Action. Incorporated as the lead journey and the implementation gates.
- **Implementation:** ownership, schema, FTS, proof adapter, and Pipes runtime were underspecified. Incorporated as single data-plane ownership, typed tables, the FTS contract, strict adapter ordering, and DSL-based Pipes.
- **Security/privacy:** raw media bypass, local API auth, MCP, pipe sandboxing, prompt injection, clipboard/audio, deletion, export, and egress blockers. Incorporated as the token model, raw media protections, MCP deny-by-default, pipe sandbox constraints, taint rules, minimization, delete semantics, and the no-egress default.
- **`insane-review` GPT-5.5 Pro, 2026-06-27** (`.insane-review/response_agentic30-public_20260627_224857_61137_ac461d.md`): focused design review of this SPEC + GOAL_PROMPT against the product context (`docs/SPEC.md`, `VALUES.md`, `GOAL.md`, `ICP.md`, `PHILOSOPHY.md`, `known-limitations.md`). Verdict: **blocked for MVP implementation; demote from "Final implementation spec" to "Deferred RFC"** — grounds: external evidence N=0 / MVP Success 0/5, the active wedge is still Day 0-3, and an always-on recorder substrate conflicts with VALUES #4/#5 (build-instead-of-sell). It also flagged real spec bugs: FTS rules referenced `safe_for_search` on `memory_items`/`product_events`, which lacked the column; "optional encryption" is too weak for always-on raw media; and capture cadence, retention defaults, the redaction policy matrix, and the Pipe DSL grammar were undefined. The spec bugs are fixed in Sections 6-7; the strategic flag is answered structurally in Sections 11 and 16 (see Section 1).
- **`insane-review` GPT-5.5 Pro, 2026-06-28** (`.insane-review/response_agentic30-public_20260628_135538_36318_8629c3.md`; pack ~228,058 tokens): narrower source-pack review of this SPEC + GOAL_PROMPT + recorder implementation status. It accepted the user's fixed required/excluded surfaces and returned blocker edits: mirror the browser-extension exclusion in the GOAL_PROMPT, make every required surface independently gateable, add `raw_sql` access-level implementation blockers, enforce SQL at the SQLite authorizer/progress-handler level, split readiness modes, harden OCR provenance, promote the redaction matrix to a blocker, sanitize browser URL FTS fields, add clipboard/audio schemas, broaden deletion/retention, block proof laundering from local artifacts, add captured-text adversarial fixtures, add the completion-status legend, and align the Pipe route namespace. Incorporated in Sections 2, 4, 6-11, 13-17 and the GOAL_PROMPT.

- **Frame-storage architecture review, 2026-07-02** (Fable multi-agent adversarial review, session-internal; 17 findings confirmed, 1 refuted. Unlike the `.insane-review/` entries above, no response artifact was persisted — the auditable residue is the incorporated section list below, with anchors measured against real screenpipe data on the target machine): capture cadence and dedup had no enforcement authority (`content_hash` was specified without semantics and implemented as a ciphertext digest, making dedup structurally impossible); the retention ladder (frame media 24h, memory summaries 30d) contradicted the month/quarter/year coaching goal with no aging tier, no `product_events` retention row, no aggregates table, and no storage-budget or capture-resolution contract; ingest failures orphaned media files outside the TTL boundary. Measured anchors: ~5,000-9,000 keyframes/day for this workload; screenpipe's 5-10GB/month is [1x logical resolution ~4x] x [HEVC ~2.2x], so the resolution decision dominates the codec. Incorporated as: the tiered-aging Visual Storage Contract with compaction-before-expiry ordering, the Section 6.2 column-semantics + dedup/idempotency contract and dedupe asset-ownership rules, `usage_daily_aggregates` (table 13), rollup memory types, `product_events.metrics_json` + snapshot event types + retention row, the frame media/row TTL split in Section 10.5, the Section 10.6 storage budget, capture-scale and cadence-authority acceptance values in Section 16.3, and the normative encryption envelope + orphan containment in Section 6.1. The encryption-contract finding was refuted — the implemented AES-256-GCM envelope already exceeded the spec text, which now documents it.

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

- **Capture cadence (Gate A):** event-driven keyframe capture with bounded fallback, not a per-second screenshot log. Initial acceptance values are `automatic_capture_min_interval_ms=1000`, `event_debounce_ms=750`, `active_max_gap_ms=10000`, `idle_max_gap_ms=60000`, duplicate suppression by same app/window/browser/document/monitor context plus the content/perceptual hash thresholds defined in Section 6.2, OCR/AX extraction only for persisted keyframes, multi-monitor attribution via `monitor_id`, and explicit idle/sleep/wake behavior. **The sidecar ingest is the single cadence/dedup authority**: it enforces min-interval and duplicate suppression against the last persisted frame and answers with persist/dedupe/skip results; Swift triggers (timers, app-activation observers, event tap) are advisory producers, never the only enforcement. Cadence values and the dedup context key apply per `monitor_id`; idle detection and the storage budget are global. `capture_scale=1x_logical` is an acceptance value: snapshot media is captured at 1x logical resolution by default (native-scale capture is a ~4x storage multiplier and requires an explicit spec change; `media_assets.width/height` make the policy auditable). Envelope idempotency follows Section 6.2 (identical resend = no-op). Gate A cannot claim event-driven completion without boundary tests for the four cadence values, the dedup thresholds, per-monitor application, and CPU/battery/storage-budget failure states.
- **Replay chunk storage (Gate A.2):** optional encrypted low-FPS fragmented MP4 chunks at 1x logical resolution are registered as `media_assets.asset_type=screen_video_chunk`, never as proof, and never as a source for search/evidence without matching `frames` rows. Chunks double as the warm tier of the Visual Storage Contract (default TTL 90d, Section 10.5): eligible expired hot frames are re-encoded into chunks so long-horizon visual memory survives locally. Delete-or-rewrite is contract-complete only with: a fixed order (mark `pending_delete` in DB -> perform file removal/rewrite -> update rows and issue the receipt), crash recovery that resumes `pending_delete` work on restart, fail-closed downgrade (a failed rewrite becomes a full chunk delete with surviving frames' replay refs cleared), fragment-boundary chunking so partial rewrite reduces to fragment drops, a rewrite timeout, and a named recorder health state on failure. Gate A.2 cannot ship until deletion/retention acceptance proves overlapping chunk delete-or-rewrite semantics, clears stale replay offsets for surviving frames, and passes the crash-recovery and downgrade tests.
- **Permission helper validation (Gate A):** release actor fixture, supported macOS Settings anchors, Screen Recording prompt/registration behavior, Screen Recording relaunch behavior, Accessibility plus-picker or drag capability, Input Monitoring opt-in behavior, and update-in-place TCC identity persistence.
- **Retention defaults (Gate A/C):** per-surface TTL/delete/FTS/derived-data/OS-non-guarantee rows in Section 10.5 must exist before the related collector or export ships. Runtime default policies must equal the Section 10.5 defaults, and a test pins each default value — silent spec/code drift on a retention default is a Gate A regression.
- **Storage budget (Gate A):** the Section 10.6 contract (measurement scope, 100GB default, 80% soft acceleration, 100% hard pause with `storage_budget_exceeded`, single delete path, projected-usage display) must exist with tests before always-on capture ships. "Failure states" without defined expected behavior are untestable and do not satisfy this item.
- **Long-horizon memory contract (Gate A):** compaction-before-expiry ordering (Section 10.5), `usage_daily_aggregates` derivation (Section 6.14), and rollup memory types (Section 6.7) must exist before the TTL sweep may delete frame rows or media. Deleted history is unrecoverable; review surfaces may be deferred (Section 4.2), the substrate may not.
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
