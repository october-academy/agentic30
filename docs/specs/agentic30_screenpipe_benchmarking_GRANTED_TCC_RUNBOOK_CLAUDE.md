<!-- Claude Code lane deliverable — kept in a separate file so it does not collide with Codex-owned docs (SPEC/CONTEXT/GOAL/CURRENT). Generated 2026-07-01 KST from an independent read-only trace. Swift/sidecar line numbers are as-of that trace; re-verify before relying on an exact line. This runbook is the (a) prep for the single BLOCKED acceptance gap: a real captured row under granted TCC, which a headless agent cannot produce. A GRANTED-branch UI test already exists (testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted); it XCSkips unless AGENTIC30_LIVE_SIGNED_APP_PATH is set. The Claude-lane helper sidecar/recorder-live-verify.mjs (isLiveCapturedFrameRow / assertLiveRecorderFrameRow / summarizeLiveRecorderCapture, tested) certifies a row as live-vs-seeded. -->

# Operator Runbook — Founder Memory OS: GRANTED-TCC Live Recorder Acceptance E2E

**Goal:** Drive the macOS recorder collector end-to-end under *granted* TCC on an unlocked, signed machine and produce live acceptance evidence that closes the single decisive gap (no real captured row has ever existed under granted TCC). Legend target for the LIVE path: `actual_collector + ui_wired + e2e_accepted`.

**Why this is the only blocker:** the code path is already complete and wired. Swift owns a real `ScreenCaptureKitFrameCaptureSession` (`AgenticViewModel.swift:154`) and `ScreenCaptureKitSystemAudioCaptureSession` (`:293`); `captureRecorderFrame(...)` (`:9673`) builds a real JPEG via `buildScreenCaptureKitFrameEnvelopeAvailable` (`:10986`) and emits `recorder_frame_capture_ingest` (`:10507`); the sidecar handler `handleRecorderFrameCaptureIngest` (`index.mjs:3905`) calls `recordFrameCaptureEnvelope` (`recorder-ingest.mjs:46`) with the live `controlState`, which fail-closes via `assertRecorderCaptureReady` unless readiness is granted. A GRANTED-branch UI test **already exists**: `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted` (`agentic30UITests.swift:1766`), gated by `liveSignedAppBundleURL()` (`:5665`) which `XCTSkip`s unless `AGENTIC30_LIVE_SIGNED_APP_PATH` points to a signed bundle. The blocker is purely operational: TCC-blocked + screen-locked machine, no signed bundle, env var unset.

---

## 0. The live-vs-seeded discriminator (read this first)

Every assertion below must distinguish a *live-captured* row from the UI-test *seed fixture* (`seedFounderReplayDayMemoryCandidateFixture`, `agentic30UITests.swift:7131`). The discriminator is deterministic:

| Field | Seeded fixture | Live SCStream collector |
|---|---|---|
| `frames.id` | `ui-frame-1` | `frame-<uuid>` (`AgenticViewModel.swift:11009`) |
| `media_assets.id` | `ui-asset-frame-1` | `asset-<uuid>` (`:11010`) |
| `media_assets.relative_path` | `media/frames/ui-frame-1.jpg` | `media/frames/<YYYY-MM-DD>/asset-<uuid>.jpg` (or `.jpg.enc` when encrypted) (`:11014`) |
| `frames.capture_trigger` | `ui_test_seed` | `manual_swift_screencapturekit` (manual) / `auto_swift_screencapturekit_interval` etc. (auto) |
| media file on disk | never written (seed only inserts rows) | real JPEG bytes at `<recorderRoot>/media/frames/<day>/asset-<uuid>.jpg[.enc]` |

**A live row is proven iff** `frames.id LIKE 'frame-%'` AND `frames.capture_trigger LIKE '%screencapturekit%'` AND a real media file exists on disk at the asset's `relative_path` with `byte_size > 0`. The live signed-app test for this run must run against a **clean app-support root** (its own `appSupportPath`, `:1777`) with **no seed fixture call**, so the *only* rows present are live ones — this is already how `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted` is constructed (it does NOT call `seedFounderReplayDayMemoryCandidateFixture`).

Recorder DB path: `<appSupportPath>/recorder/recorder.sqlite` (`recorder-store.mjs:394`). Media + WAL live alongside it under `<appSupportPath>/recorder/`.

---

## 1. Preconditions

### 1.1 Machine / session
- A physical (or persistently-unlocked VNC) Mac, **logged in and unlocked**, foreground GUI session. ScreenCaptureKit returns no displays and `CGPreflightScreenCaptureAccess()` is meaningless on a locked screen. Disable screen lock / screensaver / display sleep for the run (`caffeinate -dimsu` in a side terminal).
- Apple Silicon or Intel; the app you sign must match the arch you run.

### 1.2 Signed app bundle (release-gated)
- A **Developer ID-signed, hardened-runtime, notarized** `agentic30.app`. The live test asserts the in-app permission actor shows `releaseGate release_ready` and `releasePolicyVerified true` (`agentic30UITests.swift:1838`), so an ad-hoc/dev-signed build will fail the gate. Build via `scripts/build-and-notarize.sh` and staple.
- The bundle must NOT be translocated (run it from `/Applications` or a stable path, not from a quarantined DMG mount). The actor row surfaces `translocation` state (`:1502`).
- Bundle ID must be `october-academy.agentic30` (or your fork's ID) consistently — TCC grants are keyed to the signed bundle identity + Team ID.

### 1.3 TCC grants (System Settings → Privacy & Security)
Grant to the **signed agentic30.app** (the entries below are what the recorder readiness ladder requires; `recorder-control-state.mjs:33` `CORE_PERMISSION_IDS` + the live test's permission rows at `:1549`–`:1591`):

| Capability | TCC service | Required for | Readiness gate |
|---|---|---|---|
| Screen Recording | `kTCCServiceScreenCapture` | always-on frame capture | **core blocker** (`evaluateRecorderCaptureReadiness`, `:276`) |
| Accessibility | `kTCCServiceAccessibility` | AX text provenance | **core blocker** (`:276`) |
| Input Monitoring | `kTCCServiceListenEvent` | event-driven capture trigger | event-driven mode + the live test's capture-enable path |
| Microphone | `kTCCServiceMicrophone` | mic audio chunk path | sensitive-capture mode (audio leg) |
| (System Audio) | via ScreenCaptureKit audio | system-audio chunk path | sensitive-capture mode (audio leg) |

After granting Screen Recording, **fully quit and relaunch** the app (macOS caches the grant per-process at launch).

For Path A only, also grant **Accessibility** to the local
`agentic30UITests-Runner.app` bundle
(`october-academy.agentic30UITests.xctrunner`) after it has been built under
Xcode DerivedData. This runner grant is not a production recorder permission
and does not replace the signed `agentic30.app` Screen Recording/Accessibility
grants. It only lets XCUITest observe and drive the already-running signed app.
Without it, the live workflow can launch the signed app and sidecar while
XCUITest still reports no windows/static text; classify that as
`runner_accessibility_blocked`.

### 1.4 Consent + visible indicator
The sidecar control-state ladder requires, beyond TCC: `consent.status == "granted"` AND `visibleIndicatorAcknowledged == true` AND `mode == "active"` (`recorder-control-state.mjs:270`–`291`). The in-app permission/consent surface drives `grant_consent` (`index.mjs:3869` → `transitionRecorderControlState` `:125`) which requires `visibleIndicatorAcknowledged: true`. Acknowledge the recording indicator in the Founder Replay control surface before capture.

### 1.5 Env flags for the run
- `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1` — required for the blocking UI scheme (per `CLAUDE.md`).
- `AGENTIC30_LIVE_SIGNED_APP_PATH=/Applications/agentic30.app` — required, else `liveSignedAppBundleURL()` `XCTSkip`s (`:5672`).
- `AGENTIC30_APP_SUPPORT_PATH` is set per-run by the test to an isolated dir (`:1777`); for manual runs, point it at a throwaway dir so you start from a clean DB.
- Do **not** set `AGENTIC30_TEST_STUB_PROVIDER` expectations to defeat capture — the live test sets it to `1` only to keep chat deterministic; SCStream capture is independent of the stub provider.
- `NODE_BINARY` resolvable (the test resolves Node for fixtures, but the live test doesn't seed; still, the app needs Node to launch the sidecar).

---

## 2. Run path A — driven by the existing live UI test (preferred, deterministic)

This is the lowest-risk path because the assertions are already coded.

```bash
export AGENTIC30_ALLOW_BLOCKING_UI_E2E=1
export AGENTIC30_LIVE_SIGNED_APP_PATH=/Applications/agentic30.app
caffeinate -dimsu &   # keep unlocked/awake for the run
xcodebuild test \
  -project agentic30.xcodeproj \
  -scheme agentic30UITests \
  -only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted \
  -resultBundlePath ./live-recorder-acceptance.xcresult
```

What the test does, in order (matches the required ladder):
1. Attaches to the **signed** bundle via `launchAppByAttachingToProcess(..., appBundleURLOverride:)` (`:1784`, helper `:5602`) so TCC identity = signed app.
2. Waits for `opendesign.day.shell` + sidecar `ready_event_received` (`:1813`).
3. Opens Founder Replay rail → Control mode → control surface (`:1820`–`:1834`).
4. Asserts release gate (`releaseGate release_ready`, `releasePolicyVerified true`, `:1838`).
5. Clicks `opendesign.founderReplay.control.permissions.check` (re-probes TCC, `:1848`).
6. Waits for `opendesign.founderReplay.control.captureFrame` to become **enabled** — this only happens when `recorderCaptureReadiness.canRecord == true` (`AgenticViewModel.swift:9682`). If it never enables, the test dumps the readiness blocker prefix `opendesign.founderReplay.control.readiness.blockers.` and fails with the "requires granted Screen Recording, Accessibility, and Input Monitoring TCC" message (`:1860`–`:1872`). **This is your TCC-not-granted signal.**
7. Clicks capture → waits for `opendesign.founderReplay.control.lastFrameCapture` receipt and an **enabled** `deleteFrame` button (`:1883`–`:1893`). The receipt label is `<frame-id> · <ts> · <asset-id>` (`OpenDesignDayPageView.swift:9988`) — assert it begins `frame-` not `ui-frame-`.
8. Clicks delete → waits for `opendesign.founderReplay.control.lastFrameDelete` containing **`media removed`** and **`path exposed no`** (`:1907`–`:1908`), and `deleteFrame` going disabled.

**Pass line for Path A:** the test passes (not skipped). A skip means `AGENTIC30_LIVE_SIGNED_APP_PATH` was unset; a failure at step 6 means TCC not actually granted to the signed identity.

> NOTE: Path A as written covers permission-ladder → frame capture → live row → delete tombstone. It does **not** by itself exercise FTS search over live text, retention purge, or the audio chunk. Use Path B (manual) plus the SQL verification in §4 to complete the full ladder, OR have Codex extend the test per §6.

---

## 3. Run path B — manual app drive (covers full ladder incl. search, audio, retention)

Launch the signed app manually (from `/Applications`), complete onboarding to unlock the Founder Replay rail, open **Founder Replay → Control**.

1. **Permission ladder:** click `permissions.check`; confirm all four readiness mode rows resolve — `core_frame_capture_ready`, `event_driven_capture_ready`, `ocr_text_completion_ready`, `sensitive_capture_ready` (identifiers at `agentic30UITests.swift:2213`). Acknowledge the visible indicator / grant consent so `mode==active`.
2. **Always-on frame capture:** start auto-capture (`startRecorderAutoCapture`, `AgenticViewModel.swift:9576`) — this installs an interval timer + app-activation observer + event-tap trigger (`:9733`, `:9758`) that fire `captureRecorderFrame(automatic:true)` on a cadence, writing encrypted media. Let it run ≥2 capture cycles. (For a single deterministic frame, click `captureFrame` instead → `captureRecorderFrameNow()` `:9461`.)
3. **Real captured row:** verify via §4.1.
4. **Redacted FTS search hit:** in the control surface type a token you know appears in live redacted text into `opendesign.founderReplay.control.search.query` (`OpenDesignDayPageView.swift:10790`), click `...search.run` (`:10779`). This calls `runRecorderSearch` (`AgenticViewModel.swift:10729`) → raw-API `search` endpoint → `buildRecorderSearchResults` (`recorder-search.mjs:25`). Confirm `...search.summary` shows non-zero results + `schema agentic30.recorder.search.v1` + `search proof rejected`. Verify the hit is live via §4.2. (Note: live AX/OCR redacted text content is environment-dependent; if you cannot guarantee a token, drive search against frame metadata such as the app name shown on screen, which redaction preserves as a search label.)
5. **Audio chunk path (≥1):** grant Microphone, enable mic capture in the sensitive-capture section, start mic recording (`recorder_audio_chunk_record`, `:10402`; session `:293`). Confirm `opendesign.founderReplay.control.audioStatus` flips to `audio running` (`:10550`) and a chunk is recorded (`recorder_audio_chunk_recorded`, `index.mjs:3950`). Verify via §4.5.
6. **Visible-range delete tombstone:** select the live frame(s) in the replay timeline and delete the visible range (`deleteRecorderFrameRange`, `:9486` → `recorder_frame_captures_delete_range`) OR delete the latest (`deleteLastRecorderFrame`, `:9465`). Verify tombstone via §4.3.
7. **Retention purge:** retention runs on the standard policy (raw frame/audio = 24h, `recorder-retention.mjs:24`). To force a purge deterministically without waiting 24h, use §4.4 (operator runs `applyRecorderRetentionPolicy` with a tiny retention window against the same live DB while the app is stopped) — or simply re-run after backdating, but the offline harness in §4.4 is the clean path.

---

## 4. Observable assertions (concrete SQL / API) — proves a REAL row

Run these against the run's `recorder.sqlite`. Quit the app first (or use `PRAGMA wal_checkpoint`) so WAL is flushed; the store opens WAL mode (`recorder-store.mjs:151`).

```bash
DB="$AGENTIC30_APP_SUPPORT_PATH/recorder/recorder.sqlite"
ROOT="$(dirname "$DB")"
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);"
```

### 4.1 A real frame row + real media asset on disk (NOT the fixture)
```sql
-- live frame rows only
SELECT id, capture_trigger, snapshot_asset_id, redaction_status, safe_for_search, byte_no
FROM (
  SELECT f.id, f.capture_trigger, f.snapshot_asset_id, f.redaction_status, f.safe_for_search,
         m.byte_size AS byte_no, m.relative_path
  FROM frames f JOIN media_assets m ON m.id = f.snapshot_asset_id
  WHERE f.deleted_at IS NULL
    AND f.id LIKE 'frame-%'                 -- live id, not ui-frame-1
    AND f.capture_trigger LIKE '%screencapturekit%'
);
```
**PASS:** ≥1 row; `id` begins `frame-`; `snapshot_asset_id` begins `asset-`. Then confirm the file exists with bytes:
```bash
sqlite3 "$DB" "SELECT relative_path, byte_size FROM media_assets WHERE id LIKE 'asset-%' AND deleted_at IS NULL;" \
 | while IFS='|' read -r rp bs; do test -s "$ROOT/$rp" && echo "OK $rp $bs bytes" || echo "MISSING $rp"; done
```
**PASS:** every live asset's media file exists on disk and is non-empty (`byte_size > 0`). **FAIL:** any `MISSING`, or only `ui-frame-1` present (means seed, not live).

### 4.2 A search hit over live-captured redacted_text
```sql
-- FTS hit restricted to live rows
SELECT f.id, snippet(frames_text_fts, 1, '[', ']', '...', 12) AS snip
FROM frames_text_fts
JOIN frames f ON f.id = frames_text_fts.frame_id
WHERE frames_text_fts MATCH '"<your token>"'
  AND f.safe_for_search = 1 AND f.deleted_at IS NULL
  AND f.id LIKE 'frame-%';
```
**PASS:** ≥1 row whose `f.id LIKE 'frame-%'`. The redaction policy is enforced at ingest (`recorder-ingest.mjs:138`) and again at search (`recorder-search.mjs:266`), so a hit here is over redacted text only. **FAIL:** the only hit is `ui-frame-1` (seeded).

### 4.3 A tombstone after delete
```sql
SELECT id, deleted_at, redaction_status, privacy_state, safe_for_search, redacted_text, browser_url, ocr_text
FROM frames WHERE id LIKE 'frame-%' AND deleted_at IS NOT NULL;
SELECT id, sha256, byte_size, relative_path, deleted_at FROM media_assets WHERE id LIKE 'asset-%' AND deleted_at IS NOT NULL;
```
**PASS (matches `recorder-delete.mjs:71`–`88`):** `deleted_at` set; `redaction_status='deleted'`, `privacy_state='deleted'`, `safe_for_search=0`, `redacted_text/ocr_text/browser_url` all NULL; media asset `sha256` = 64 zeros, `byte_size=0`, `relative_path` like `media/frames/deleted/asset-<id>.deleted`. Also confirm the media file is unlinked from disk (delete returns `mediaRemoved:true` → UI `media removed`):
```bash
test -e "$ROOT/$(sqlite3 "$DB" "SELECT relative_path FROM media_assets WHERE id='<original asset relative path before tombstone>'")" \
  && echo "STILL PRESENT (FAIL)" || echo "UNLINKED (OK)"
```
The FTS row must also be gone (trigger `frames_text_fts_au` deletes it on update, `recorder-store.mjs:760`): `SELECT count(*) FROM frames_text_fts WHERE frame_id LIKE 'frame-%';` → 0 for deleted frames.

### 4.4 Retention purge of an expired raw file (offline operator harness)
With the app stopped, run the operator verifier against the live app-support
root. This uses the **production** `applyRecorderRetentionPolicy`, not a stub,
and also rechecks the live-vs-seeded discriminator, redacted search, audio
media, and raw-read audit before applying the tiny retention window:

```bash
npm run verify:live-recorder -- \
  --app-support "$AGENTIC30_APP_SUPPORT_PATH" \
  --search-query "<your live search token>" \
  --apply-retention \
  --json-output ./live-recorder-acceptance/operator-verifier.json
```

**PASS:** JSON schema `agentic30.live_recorder_acceptance.v1`,
`liveFrame.id` begins `frame-`, `liveFrame.captureTrigger` contains
`screencapturekit`, `liveFrame.mediaExists=true`, `search.schema` is
`agentic30.recorder.search.v1`, `search.proofAcceptedBySearch=false`,
`audio.id` begins `audio-`, `rawReadAudit.decision="accepted"`, and
`retention.status="applied"` with `deletedFrameCount >= 1`,
`deletedAudioChunkCount >= 1`, and `deletedMediaCount >= 1`. Re-run §4.3 SQL —
the frame/audio are now tombstones via retention (same delete primitives).
Confirm the raw media file is gone from `$ROOT/media/frames/<day>/` and
`$ROOT/media/audio/<day>/`.

If you already used the visible delete control on every live frame in §3.6,
capture one additional live frame/audio pair before running this verifier. The
retention verifier intentionally requires an undeleted live row so it can prove
the retention path itself, not merely inspect an already-deleted tombstone.
(`buildRecorderRetentionPlan` selects frames with `captured_at < cutoff`,
`recorder-retention.mjs:165`; `assertRetentionTargetFilesAvailable` stats each
file, `:810`; ENOENT is treated as already-purged so a single orphan cannot
deadlock the sweep, `:926`.)

### 4.5 At least one live audio chunk + its raw asset on disk
```sql
SELECT a.id, a.source, a.transcript_status, a.raw_audio_indicator_state, m.relative_path, m.byte_size
FROM audio_chunks a JOIN media_assets m ON m.id = a.audio_asset_id
WHERE a.deleted_at IS NULL AND a.id LIKE 'audio-%';
```
**PASS:** ≥1 row; `id` begins `audio-` (live, `AgenticViewModel.swift:11335`); `relative_path` like `media/audio/<day>/asset-<uuid>.m4a.enc`; the `.m4a.enc` file exists on disk with `byte_size>0`.

### 4.6 An audit row for the raw read
A raw read (e.g. opening the raw frame image, which hits the `raw_frame` endpoint, `recorder-raw-api-server.mjs:351`) writes a `recorder_audit` row via `recordRecorderAudit` (`recorder-raw-api-auth.mjs:243`). To trigger it, open the live frame's image preview in the replay UI (`requestRecorderFrameImageIfNeeded`, `AgenticViewModel.swift:10534`, request-id header `frame-image-<uuid>`, `:10681`), then:
```sql
SELECT id, request_id, actor_type, endpoint, access_level, decision, source_ids_json
FROM recorder_audit WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5;
```
**PASS:** ≥1 row with `decision='accepted'`, `access_level` in (`raw_frame`/`raw_admin`/`frame`), `source_ids_json` referencing a live `frame-…` id. (`buildRecorderAuditSource`, `recorder-audit-source.mjs:20`, surfaces these in-app.) **FAIL:** no audit row for the raw access — means the raw read path was not exercised.

---

## 5. Evidence to capture (per surface) + pass/fail legend

Collect into one evidence bundle (`./live-recorder-acceptance/`):

| Surface | Evidence artifact | PASS line | FAIL line |
|---|---|---|---|
| Permission ladder | `.xcresult` + screenshot "Founder Replay Live Signed App Permission Actor"; `permissionActor` diagnostics | `releaseGate release_ready` + `releasePolicyVerified true` AND `captureFrame` enabled | readiness blocker row under `...readiness.blockers.*` present → TCC not granted |
| Frame capture (real row) | §4.1 SQL dump (`frames`+`media_assets`), `ls -l` of media file, receipt screenshot | live row `frame-%` + media file `>0` bytes on disk | only `ui-frame-1` / no media file |
| Redacted FTS search | §4.2 SQL dump, `...search.summary` screenshot | hit with `frame-%` id; summary has `schema agentic30.recorder.search.v1`, `search proof rejected` | only `ui-frame-1` hit, or `0 results` |
| Audio chunk | §4.5 SQL dump, `ls -l` of `.m4a.enc`, `audioStatus=audio running` screenshot | live `audio-%` row + media file `>0` bytes | no `audio-%` row |
| Visible-range delete tombstone | §4.3 SQL dump, `...lastFrameDelete` screenshot | `deleted_at` set, `media removed`, `path exposed no`, sha256=zeros, FTS row gone, file unlinked | media file still present, or fields not nulled |
| Retention purge | §4.4 `operator-verifier.json` + post-purge §4.3 SQL | verifier schema `agentic30.live_recorder_acceptance.v1`, `retention.status=applied`, `deletedFrameCount>=1`, `deletedAudioChunkCount>=1`, raw files gone | `status:noop`, missing live frame/audio/audit/search, or file still present |
| Raw-read audit | §4.6 SQL dump | `recorder_audit` row `decision=accepted` referencing live frame | no audit row |

**Overall LIVE legend = `actual_collector + ui_wired + e2e_accepted`** is satisfied iff: frame §4.1 PASS (actual_collector), Path A test passes or manual capture+delete via the wired control surface succeeds (ui_wired), and the full ladder (capture→search→delete→retention + audio + audit) all PASS with the live-vs-seeded discriminator holding (e2e_accepted).

---

## 6. Swift-side GRANTED-branch assertions

Codex owns `agentic30UITests/*.swift`. Current built-in assertions plus remaining additions:

1. **Implemented:** `testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted` now asserts the live-vs-seeded discriminator at the UI layer. After `lastFrameCapture` appears, it requires a `frame-` and `asset-` receipt and rejects `ui-frame-` / `ui-asset`.

2. **Implemented:** the same test now runs live redacted search before delete. It uses `opendesign.founderReplay.control.search.query` / `.run` / `.summary` / `.result.N`, queries `Agentic30`, requires non-zero results with `schema agentic30.recorder.search.v1` and `search proof rejected`, and requires at least one result row with a live `frame-` id and no `ui-frame-`. Swift frame envelopes with AX/OCR text now set `redactionStatus=redacted` and `safeForSearch=true`, letting sidecar ingest derive redacted public text instead of indexing raw AX/OCR text.

3. **Remaining:** add a sibling live test `testFounderReplayLiveSignedAppRetentionPurgesExpiredFrameWhenTccGranted` only if a UI affordance exists. Otherwise keep retention exercised from the §4.4 sidecar/operator harness. Do NOT add an `applyRecorderRetentionPolicy` call into Swift.

4. **Implemented, pending unblocked execution:** `testFounderReplayLiveSignedAppSensitiveAudioRunsWhenTccGranted` launches the same signed app path, grants recorder consent/indicator acknowledgement, toggles Microphone and System Audio, and requires `opendesign.founderReplay.control.audioStatus` to reach `audio running`. A named `opendesign.founderReplay.control.audioError` / `ERR_RECORDER_*` is a live-acceptance failure. The live workflow runs this after frame/search/delete, but the current machine still stops at the runner Accessibility preflight before reaching it.

5. **Do NOT weaken the seeded test.** `testFounderReplayRecorderControlSurfaceReportsTccReadinessAndDrivesCaptureWhenGranted` (`:1914`) intentionally runs the TCC-blocked branch over the seed fixture and must keep asserting `ui-frame-1` (`:1960`). The live tests are additive and skip-gated; they must not share the seed fixture's app-support root.

---

## 7. Known failure modes / triage

- **`captureFrame` never enables (Path A step 6 fails):** TCC not granted to the *signed* identity. Re-grant Screen Recording to `/Applications/agentic30.app`, fully quit/relaunch. Check `CGPreflightScreenCaptureAccess()` reflects in the permission rows (`AgenticViewModel.swift:11561`).
- **XCUITest cannot observe any Agentic30 window/static text while System Events can:** missing Accessibility grant for `agentic30UITests-Runner.app` (`october-academy.agentic30UITests.xctrunner`). Grant the runner in System Settings → Privacy & Security → Accessibility, then rerun the live workflow. This is a runner-control blocker, not live recorder acceptance evidence.
- **Live script fails in `testFounderReplayLiveSignedAppRunnerAccessibilityPreflight`:** same runner-control blocker as above. The preflight intentionally stops before the long capture/delete path and emits `runner_accessibility_blocked` when the XCUITest process cannot see a window plus known Office Hours/Day 2 static text.
- **Test is SKIPPED:** `AGENTIC30_LIVE_SIGNED_APP_PATH` unset or not an `.app` (`:5670`–`:5683`).
- **Release gate not `release_ready`:** unsigned/dev build or translocated bundle. Run a notarized build from `/Applications`.
- **Capture produces a row but no media file:** disk write failed (`buildScreenCaptureKitFrameEnvelopeAvailable` writes the JPEG before emitting, `:10986`); check `$ROOT/media/frames/<day>/` perms (recorder dir is `0o700`, `recorder-store.mjs:794`).
- **Search returns rows but all `ui-frame-%`:** you are reading a seeded DB — confirm `AGENTIC30_APP_SUPPORT_PATH` is the live run's isolated root and the seed fixture was not invoked.
- **Screen locks mid-run:** SCStream silently stops; keep `caffeinate -dimsu` running and lock disabled.
