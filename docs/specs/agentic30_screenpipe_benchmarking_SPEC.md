# Agentic30 Screenpipe Benchmarking SPEC

> Date: 2026-06-27 KST  
> Status: V1 implementation spec plus roadmap  
> Owner surface: Agentic30 macOS app + Node sidecar  
> Source prompt: `docs/specs/agentic30_screenpipe_benchmarking_GOAL_PROMPT.md`  
> Benchmark sources: `../screenpipe`, DeepWiki `screenpipe/screenpipe`

## 1. Summary

Agentic30 should benchmark Screenpipe's local capture and memory substrate, not clone Screenpipe's general personal-memory product. Screenpipe answers:

```text
What did I see, say, or hear on this computer?
```

Agentic30 must answer:

```text
What did this solo developer execute for their product today?
Is there usable evidence?
What proof debt or next narrow action should change tomorrow's work?
```

V1 adds a macOS-only Founder Replay storage and processing layer. It uses a Screenpipe-style `frames` spine for raw observations, then separates Agentic30-specific execution semantics into `product_events`, `product_event_sources`, `evidence_candidates`, and existing proof ledger flow.

This spec is a target design. It does not claim the described recorder, schema, UI, or review pipeline is already shipped.

## 2. Product Contract

### 2.1 Positioning

Agentic30 is a local-first execution OS for full-time solo developers. It reads product work traces and turns them into today-specific execution guidance, not passive recall.

Founder Replay is the evidence substrate for that execution OS:

```text
capture raw work traces
  -> normalize product/execution events
  -> create evidence candidates
  -> accept into proof ledger or record evidence debt
  -> adapt Office Hours, Day progress, and next mission
```

### 2.2 Non-positioning

V1 is not:

- a Screenpipe clone
- a 24/7 everything recorder
- a raw screen search product
- a productivity surveillance score
- a Pi Agent or Pipes clone
- a general automation platform
- an agency feature that sends messages, posts, deploys, interviews, or sells for the user

### 2.3 User Value

For a solo developer, the valuable unit is not "a frame." The valuable unit is:

- a product-building event
- a customer/contact event
- a market validation event
- a proof candidate
- a blocker with an explicit root cause
- a next narrow action

The raw frame exists only to support those higher-level units.

## 3. Screenpipe Benchmark

### 3.1 Copy

Agentic30 should copy these Screenpipe design patterns:

- Event-driven capture instead of fixed-FPS capture.
- Screenshot and text extraction as one atomic capture.
- Accessibility tree text first, OCR fallback only when accessibility is empty or thin.
- JPEG snapshots on disk and searchable metadata in SQLite.
- `capture_trigger`, `app_name`, `window_name`, `browser_url`, `document_path`, `content_hash`, `simhash`, `text_source`, and `snapshot_path` on frame rows.
- Local-first storage under Application Support, with only approved bundles exported into the workspace.
- Bounded API access for agents, never direct unrestricted DB access.
- Explicit failure when capture, permission, redaction, model, or review environment is unavailable.

### 3.2 Adapt

Screenpipe's capture stream is general. Agentic30's capture stream must be mission scoped.

Screenpipe triggers:

```text
app_switch, window_focus, click, typing_pause, scroll_stop, clipboard, idle
```

Agentic30 V1 keeps those, then adds developer/product triggers:

```text
xcode_build_succeeded
xcode_build_failed
test_run_succeeded
test_run_failed
git_commit_created
git_diff_changed
codex_session_result
claude_session_result
customer_interview_added
customer_quote_found
analytics_checked
payment_checked
landing_page_updated
public_post_drafted
public_post_published
proof_uploaded
blocker_detected
```

### 3.3 Reject

Agentic30 V1 must reject these Screenpipe patterns as product defaults:

- raw SQL endpoints
- external AI access to all frames
- default 24/7 audio recording
- broad user-authored Pipes automation
- Pi Agent style arbitrary bash/JS/file/API execution
- timeline/rewind as the primary product surface
- silent cloud fallback when local capture or local processing is unavailable

## 4. V1 Scope

### 4.1 In Scope

- macOS-only Swift-native collector.
- Local SQLite recorder store plus media files.
- Screenpipe-style `frames` table as the raw observation spine.
- Product/execution semantic tables above raw frames.
- Read-only sidecar query APIs over the recorder store.
- Evidence candidate generation for Office Hours and Day progress.
- User review before writing accepted proof into the proof ledger.
- Explicit `degraded` and `evidenceDebt` handling when a trace is suggestive but insufficient.
- A recorder privacy state machine that gates local summary, provider payloads, and workspace export separately.

### 4.2 Out of Scope for V1

- Windows, Linux, iOS, or browser extension support.
- Rust backend.
- Tauri.
- Screenpipe database import.
- General personal-memory search UI.
- Always-on microphone recording.
- VLM as the default path.
- Raw frame MCP exposure.
- Automated customer outreach, posting, deploys, or payments.
- Replacing existing `.agentic30` JSON state files in one migration.

## 5. Runtime Architecture

```text
Swift macOS Collector
  -> local recorder SQLite + media files
  -> sidecar read APIs
  -> evidence candidate generator
  -> Office Hours / Day progress / mission card
  -> proof ledger append after user approval
```

### 5.1 Swift Collector

Swift owns platform APIs and user-facing permission state:

- ScreenCaptureKit or AppKit capture plumbing.
- Accessibility permission and AX tree extraction.
- Vision OCR fallback.
- app/window/browser URL/document metadata.
- screenshot encoding and local media writes.
- recorder health and degraded states.
- redaction preflight where feasible.

Rust is intentionally not part of V1. The only acceptable future Rust role is a measured support binary for diffing, hashing, video chunking, local STT/VAD, or high-throughput SQLite writes after Swift/Node bottlenecks are proven.

### 5.2 Node Sidecar

Node remains the reasoning and workflow layer:

- reads summarized recorder data through bounded APIs
- creates product events and evidence candidates
- routes Office Hours and Day progress decisions
- calls providers under existing auth and telemetry contracts
- writes accepted proof to `proof-ledger.json` through the existing proof path

Node must not own ScreenCaptureKit, AX, Vision OCR, or macOS TCC flows.

### 5.3 Local Storage

The recorder DB lives in host App Support, not the project workspace:

```text
~/Library/Application Support/agentic30/recorder/
  recorder.sqlite
  recorder.sqlite-wal
  media/
    frames/YYYY-MM-DD/<frame-id>.jpg
    audio/YYYY-MM-DD/<chunk-id>.m4a   # post-V1 unless explicitly enabled
```

Workspace exports stay curated:

```text
<workspace>/.agentic30/
  proof-ledger.json
  recorder/
    evidence-bundles/
    session-summaries/
    redaction-reports/
```

Raw frame media is not copied into the workspace by default.

Workspace export rules:

- exported recorder files must be redacted-only by construction
- exported bundles must include an `export-manifest.json` with source IDs, redaction status, and reviewer decision
- `.agentic30/recorder/raw/` is forbidden
- `.agentic30/recorder/` must be gitignored or blocked by public-safety checks before export
- export fails if secret/public-safety scan fails
- raw screenshots, raw accessibility trees, and raw OCR boxes stay in App Support

## 6. Data Model

### 6.1 Layering Rule

Do not mix raw observation fields with product meaning.

```text
frames = what was observed
product_events = what the developer did for the product
evidence_candidates = whether it may count as proof
proof_ledger_entries = accepted proof
```

### 6.2 `frames`

`frames` is the Screenpipe-style capture spine.

```sql
CREATE TABLE frames (
  id TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  monitor_id TEXT,
  capture_trigger TEXT NOT NULL,
  app_name TEXT,
  bundle_id TEXT,
  window_title TEXT,
  browser_url TEXT,
  document_path TEXT,
  workspace_root TEXT,
  focused INTEGER NOT NULL DEFAULT 1,
  snapshot_path TEXT,
  content_hash TEXT,
  simhash TEXT,
  text_source TEXT,
  full_text TEXT,
  accessibility_text TEXT,
  accessibility_tree_json TEXT,
  ocr_text_json TEXT,
  redaction_status TEXT NOT NULL DEFAULT 'pending',
  sensitive_risk TEXT NOT NULL DEFAULT 'unknown',
  safe_for_model INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Rules:

- `captured_at` is UTC ISO-8601.
- `snapshot_path` points to local App Support media.
- `full_text` is redacted text only; unredacted extracted text is never exposed to sidecar search APIs.
- `accessibility_text`, `accessibility_tree_json`, and `ocr_text_json` are quarantined raw fields until redaction completes.
- `safe_for_model=0` blocks provider transmission.
- `safe_for_export=0` is implied unless an evidence candidate explicitly approves a redacted bundle.
- Missing OCR/accessibility is allowed only after Screen Recording and Accessibility permission checks pass and the row is marked text-degraded. Missing permission blocks default capture instead of becoming silent OCR-only capture.

### 6.3 `ui_events`

```sql
CREATE TABLE ui_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  frame_id TEXT,
  event_type TEXT NOT NULL,
  app_name TEXT,
  bundle_id TEXT,
  window_title TEXT,
  browser_url TEXT,
  document_path TEXT,
  element_role TEXT,
  element_name TEXT,
  text_content_redacted TEXT,
  text_length INTEGER,
  side_effect_class TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(frame_id) REFERENCES frames(id)
);
```

Rules:

- Store redacted text only.
- Do not implement raw keylogging.
- Clipboard capture is context capture, not clipboard-history storage.

### 6.4 `product_events`

`product_events` is Agentic30's semantic execution layer.

```sql
CREATE TABLE product_events (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  workspace_root TEXT,
  occurred_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  mission_slot TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
```

Allowed V1 `mission_slot` values:

```text
build_product
get_users
make_money
```

Allowed V1 `event_type` values:

```text
code_changed
build_succeeded
build_failed
test_succeeded
test_failed
commit_created
customer_interview_added
customer_quote_found
analytics_checked
payment_checked
landing_page_updated
public_post_drafted
public_post_published
proof_uploaded
blocker_detected
```

Rules:

- A `product_event` can be weak or degraded.
- A `product_event` is not proof by itself.
- A `product_event` must never be created solely from an LLM inference without at least one source row.

### 6.5 `product_event_sources`

```sql
CREATE TABLE product_event_sources (
  id TEXT PRIMARY KEY,
  product_event_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  frame_id TEXT,
  source_path TEXT,
  source_url TEXT,
  quote TEXT,
  source_hash TEXT,
  confidence TEXT NOT NULL,
  data_class TEXT NOT NULL DEFAULT 'unknown',
  redaction_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  FOREIGN KEY(product_event_id) REFERENCES product_events(id),
  FOREIGN KEY(frame_id) REFERENCES frames(id)
);
```

Allowed V1 `source_type` values:

```text
frame
ui_event
file
git_commit
test_output
provider_session
transcript
browser_url
manual_upload
office_hours_receipt
```

Rules:

- Multi-source evidence is expected.
- Store enough locator data to re-open the source.
- Do not store raw secrets or private customer text unless redaction policy permits it.
- `quote` must be redacted unless `data_class='public'`.
- A source with `redaction_status!='safe'` can support local review but cannot be exported, sent to a provider, or written into proof text.

### 6.6 `evidence_candidates`

```sql
CREATE TABLE evidence_candidates (
  id TEXT PRIMARY KEY,
  product_event_id TEXT NOT NULL,
  claim TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_status TEXT NOT NULL,
  strength_hint TEXT,
  missing_evidence TEXT,
  evidence_debt_json TEXT,
  reviewer_note TEXT,
  safe_for_export INTEGER NOT NULL DEFAULT 0,
  model_payload_manifest_json TEXT,
  proof_ledger_event_id TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY(product_event_id) REFERENCES product_events(id)
);
```

Allowed V1 `evidence_status` values:

```text
pending_review
degraded
approved
rejected
written_to_ledger
```

Rules:

- `degraded` means keep the trace and state what is missing.
- `approved` means user accepted the candidate as an evidence bundle.
- `written_to_ledger` means the sidecar verifier accepted it into the existing proof ledger.
- `rejected` candidates remain useful negative training data.
- `model_payload_manifest_json` is required before any provider call that references recorder data.

### 6.7 Privacy State Machine

Every frame/source/candidate moves through explicit privacy states:

```text
blocked
capture_allowed
redaction_pending_quarantine
safe_for_local_summary
safe_for_provider
safe_for_export
```

Rules:

- `blocked`: missing permission, denylisted app/domain, disk failure, or policy failure. No capture write except health/audit metadata.
- `capture_allowed`: raw media can be written to App Support, but cannot be read by sidecar summaries.
- `redaction_pending_quarantine`: raw text/media exists locally but is excluded from search, provider payloads, proof text, and workspace export.
- `safe_for_local_summary`: sidecar can read redacted text and metadata for summaries and candidate generation.
- `safe_for_provider`: provider payload may include the redacted summary and source citations listed in a manifest.
- `safe_for_export`: user-approved, scan-passed bundle may be written under `.agentic30/recorder/`.
- State transitions are monotonic except user deletion/revocation, which tombstones derived candidates and blocks future reads.

### 6.8 FTS

V1 creates FTS over safe text only:

```sql
CREATE VIRTUAL TABLE frames_fts USING fts5(
  full_text,
  app_name,
  window_title,
  browser_url,
  content='frames',
  content_rowid='rowid',
  tokenize='unicode61'
);
```

If SQLite FTS5 is unavailable in the target runtime, V1 must fail with a recorder health error or fall back to bounded LIKE search with an explicit `search_degraded` status. It must not silently pretend full search exists.

## 7. Capture And Processing

### 7.1 Trigger Policy

Default V1 trigger policy:

| Trigger | Debounce | Notes |
|---|---:|---|
| app_switch | 300ms | Highest-value context change |
| window_focus | 300ms | Includes browser tab/document changes when observable |
| click | 200ms | Capture after user interaction settles |
| typing_pause | 500ms | Capture result, not each key |
| scroll_stop | 400ms | Capture newly visible content |
| clipboard | 200ms | Capture surrounding context, not raw clipboard archive |
| idle | 5s | Catch passive changes |
| max_gap | 10s | Force capture when active but no trigger fires |

Hard constraints:

- Minimum interval is 200ms per monitor.
- Identical idle frames are deduped by hash.
- Active monitor is prioritized; secondary monitors get idle fallback only.

### 7.2 Text Extraction

Order:

```text
permission check
  -> if Screen Recording or Accessibility is missing: recorder blocked with root cause
Accessibility tree
  -> if empty/thin/error: Vision OCR fallback
  -> if still empty: frame may be saved only as redaction_pending_quarantine/text_degraded
```

Rules:

- Accessibility has a hard timeout.
- OCR is a fallback, not a parallel default.
- VLM is not part of V1 hot path.
- Semantic image understanding is separate from OCR/text extraction.
- OCR fallback handles thin accessibility output, not missing Accessibility permission.
- Text-degraded frames can support local UX diagnostics, but cannot generate proof candidates until another source supplies usable evidence.

### 7.3 Product Event Derivation

The sidecar derives `product_events` after raw capture.

Examples:

| Raw signals | Product event | Evidence candidate |
|---|---|---|
| Xcode build result frame + test output | `build_succeeded` | "Swift unit tests passed" |
| Codex result + changed files + test output | `code_changed` | "Implementation completed with tests" |
| browser URL + PostHog view | `analytics_checked` | "Activation metric inspected" |
| customer transcript + quote | `customer_quote_found` | "Named pain quote captured" |
| sent-message frame + recipient metadata | `proof_uploaded` | "Customer ask sent" |

Rules:

- Internal build activity does not satisfy customer evidence.
- AI output and workpacks are preparation, not proof.
- Self-report can close a repeated debt but cannot count as customer, active user, or revenue proof.
- Captured text is hostile data. It must never be treated as instructions, tool parameters, access grants, proof approvals, or export authorization.
- Product event derivation may quote captured text only through a deterministic extractor that returns source IDs, data classes, redaction status, and confidence.
- Provider prompts must wrap recorder excerpts as quoted evidence data with an explicit instruction that the quoted content is not executable instruction.

## 8. API Boundaries

V1 sidecar APIs are bounded and mission scoped.

```text
GET /recorder/health
GET /recorder/today-execution-summary
GET /recorder/product-events?mission_slot=...
GET /recorder/evidence-candidates?status=...
POST /recorder/evidence-candidates/:id/approve
POST /recorder/evidence-candidates/:id/reject
POST /recorder/evidence-candidates/:id/write-proof-ledger
```

Rules:

- No raw SQL endpoint.
- No unbounded frame listing.
- Frame retrieval requires a candidate/session context and `safe_for_model`/redaction checks.
- External MCP clients do not get raw recorder access in V1.
- Provider prompts receive summaries and citations first, never raw screenshots by default.
- APIs bind to loopback only.
- Every request requires a per-app-session bearer token minted outside the workspace.
- Browser-origin requests are rejected unless they match an allowlisted app origin; CSRF-like local webpage access is blocked.
- MCP clients require an explicit recorder capability ACL; default ACL is no recorder access.
- Every recorder read writes an audit row with caller, endpoint, source IDs, data classes, and decision.
- API responses must carry `data_class`, `redaction_status`, and `privacy_state` for every cited source.

### 8.1 Provider Payload Manifest

Before any provider call uses recorder-derived content, the sidecar must build and persist a manifest:

```json
{
  "payloadId": "model_payload_...",
  "providerClass": "cloud",
  "purpose": "evidence_candidate_review",
  "sourceIds": ["frame_...", "product_event_source_..."],
  "dataClasses": ["redacted_customer_quote"],
  "redactionStatuses": ["safe"],
  "privacyStates": ["safe_for_provider"],
  "userApprovedScreenshotIds": [],
  "unsafeExcludedSourceIds": ["frame_secret_..."],
  "createdAt": "2026-06-27T12:00:00Z"
}
```

Rules:

- The provider call is blocked if any source lacks `safe_for_provider`.
- Cloud providers cannot receive raw screenshots in V1.
- Telemetry stores manifest IDs and status only, never raw extracted text or screenshots.
- A model response cannot broaden source access, mark proof approved, or write the proof ledger.

## 9. UI Surfaces

### 9.1 V1 Surfaces

V1 adds three product surfaces:

- Recorder health card: permission, capture, OCR, DB, redaction, and sidecar API status.
- Evidence candidate review: approve, reject, request redaction, or mark degraded.
- Daily execution summary: product events grouped by `build_product`, `get_users`, `make_money`.

### 9.2 Not V1

Do not make a Screenpipe-style all-day rewind UI the primary surface. A frame timeline may exist only inside a specific evidence candidate or mission review.

## 10. Privacy, Safety, And Failure

### 10.1 Local-first

- Raw frames stay in App Support.
- Workspace export is opt-in, curated, redacted, scan-passed, and manifest-backed.
- Provider transmission requires a manifest whose sources are already `safe_for_provider`.
- File permissions should be restrictive for DB, media, and review outputs.

### 10.2 Fail Explicitly

Agentic30 must expose root cause when:

- Screen Recording permission is missing.
- Accessibility permission is missing.
- OCR is unavailable and no safe text path remains.
- DB open or migration fails.
- disk is full.
- redaction is incomplete.
- FTS is unavailable.
- provider model fallback would be required.
- `insane-review` cannot verify GPT-5.5 Pro.

Meaningless fallback is not acceptable.

### 10.3 Sensitive Data

V1 must not:

- store raw keystrokes
- store raw clipboard history
- send screenshots to a provider automatically
- expose customer names or private quotes in workspace exports without redaction
- let prompt-injected screen text broaden agent access
- allow a local webpage or unrelated local process to query recorder APIs
- write unredacted recorder exports into a public git workspace

## 11. Roadmap

### V1: Recorder Spine And Evidence Candidates

- Swift-native macOS collector.
- `frames`, `ui_events`, `product_events`, `product_event_sources`, `evidence_candidates`.
- privacy state machine and read audit log.
- local media directory.
- recorder health.
- evidence candidate review.
- proof ledger write-through for approved candidates.

### V2: Mission Replay And Better Signals

- mission-scoped replay UI.
- integration with git, tests, provider sessions, PostHog, Paddle/Stripe, and public-post URLs.
- explicit negative evidence and blocker learning.
- bounded local semantic image understanding for ambiguous frames.

### V3: Playbooks

- approved playbook executor for mission-scoped workflows.
- no general Pi/Pipes clone.
- no arbitrary bash/JS execution.
- all playbooks run under allowlisted sources and explicit user approval.

## 12. Implementation Notes

### 12.1 Suggested Work Slices

1. Add recorder DB schema and migration harness.
2. Add privacy state machine, denylist, export manifest, and audit tables.
3. Add Swift recorder health shell with no capture writes.
4. Add frame capture write path for manual capture only.
5. Add redaction quarantine before any sidecar read.
6. Add event-driven triggers.
7. Add accessibility text and OCR fallback.
8. Add sidecar read API and daily execution summary.
9. Add product event and evidence candidate generation.
10. Add user review and proof ledger write-through.

### 12.2 Existing Contracts To Preserve

- `proof-ledger.json` schema stays the accepted proof sink.
- Office Hours evidence receipts remain stronger than self-attestation.
- Day progress does not advance from weak traces alone.
- `.agentic30/docs/*` remains canonical product-doc output, not raw recorder storage.
- Bridge/schema changes require Swift decoder and sidecar test updates.

## 13. Test Plan

### Documentation Acceptance

- SPEC and GOAL prompt files exist.
- SPEC does not claim V1 is shipped.
- SPEC separates `frames` from product/execution events.
- GOAL prompt can be handed to a long-running Codex agent without product decisions left open.

### Unit And Integration Tests For Implementation PR

When implementation starts, require:

- SQLite migration tests for every recorder table.
- Swift tests for recorder health state encoding where possible.
- Sidecar tests for bounded APIs and no raw SQL access.
- API auth tests for loopback-only token, origin rejection, MCP ACL denial, and audit rows.
- Evidence candidate tests for `pending_review`, `degraded`, `approved`, `rejected`, `written_to_ledger`.
- Proof ledger write-through tests that reject weak/self-report candidates for customer/active-user/revenue proof.
- Redaction tests that prevent unsafe frames from provider prompts.
- Provider payload manifest tests that block unsafe sources and scrub telemetry.
- Workspace export tests that fail on unredacted bundles, missing manifest, or public-safety scan failure.
- Bridge decoder tests for new sidecar events.

### Manual QA For Implementation PR

- Grant Screen Recording and Accessibility, then confirm first frame capture.
- Revoke one permission and confirm explicit degraded root cause.
- Trigger app switch, click, typing pause, and scroll stop.
- Confirm a build/test event becomes `product_event` but not customer proof.
- Approve one evidence candidate and verify proof ledger append.
- Reject one candidate and verify it does not reappear as accepted proof.
- Try to query recorder APIs from an untrusted local origin and verify rejection.
- Attempt provider use of an unsafe frame and verify the manifest blocks it.

## 14. Review Evidence

This spec must be reviewed before implementation by:

- read-only Claude-style adversarial review
- read-only Codex-style adversarial review
- read-only Gemini-style adversarial review
- `insane-review` GPT-5.5 Pro review

Review status after this rewrite:

```text
subagent_reviews:
  gemini_style_security: completed; blockers incorporated in privacy/API/review sections
  claude_style_product: pending
  codex_style_implementation: pending
insane_review: running or pending final response
```

Review readiness is fail-closed. An implementation PR cannot claim "ready" unless the subagent reviews and `insane-review` complete, or a human override records the exact blocker and accepted risk. `insane-review` packs must include the current implementation diff and all new recorder files, not just this static source pack.

### 14.1 Review Disposition

Security review findings incorporated:

- raw capture persistence now has quarantine and privacy-state gates
- provider exposure now requires model payload manifests
- captured screen text is explicitly hostile data
- missing permission vs degraded text extraction is disambiguated
- recorder APIs now require local auth, origin checks, MCP ACLs, and audit rows
- workspace exports are redacted-only, manifest-backed, and scan-gated
- review readiness is fail-closed and must include implementation diffs

## 15. Source Pack

Local Agentic30 sources:

- `docs/SPEC.md`
- `docs/specs/agentic30-office-hours-redesign-v1.md`
- `docs/specs/agentic30-30day-adaptive-program-v2.md`
- `sidecar/execution-os.mjs`
- `sidecar/office-hours-structured-input.mjs`

Local Screenpipe sources:

- `../screenpipe/docs/EVENT_DRIVEN_CAPTURE_SPEC.md`
- `../screenpipe/docs/VISION_PIPELINE_SPEC.md`
- `../screenpipe/docs/PIPE_EXECUTION_SPEC.md`
- `../screenpipe/README.md`

DeepWiki:

- `screenpipe/screenpipe`: storage, frames, event-driven capture, MCP/Pipes/Pi, permissions.
