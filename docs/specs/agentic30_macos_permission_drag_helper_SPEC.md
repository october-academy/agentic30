# Agentic30 macOS Permission Helper SPEC

> Date: 2026-06-28 KST
> Status: Reviewed design spec after 3-agent and GPT-5.5 Pro review
> Scope: macOS TCC permission acquisition helper for Agentic30 recorder / Founder Replay surfaces
> Review inputs: local Screenpipe source review, Codex Computer Use bundle inspection, Claude Code adversarial review, Codex adversarial review, Antigravity Gemini review, GPT-5.5 Pro insane review via `fivetaku/insane-review` commit `cb3f0f9`

## 1. Decision Summary

Agentic30 should implement a native macOS permission helper for recorder and Founder Replay surfaces, but the helper must not assume that every privacy pane accepts app-bundle drag-and-drop.

The primary grant path is:

1. Resolve the exact runtime actor that will call the protected API.
2. Trigger the official macOS request API from that same actor where one exists.
3. Open the best-known System Settings pane.
4. Give exact manual instructions for the user-visible row or switch.
5. Use drag guidance only for panes and macOS versions where a validation spike has proven that a dropped `.app` is accepted.
6. Mark success only after the correct actor passes the relevant preflight or runtime probe.

This helper does not bypass TCC. It never writes the TCC database, never uses `sudo` as product behavior, and never claims a permission is granted because a Settings row appears.

First implementation target:

1. Screen Recording for Founder Replay pixel capture.
2. Accessibility for UI/window context.
3. Input Monitoring only as a later opt-in if the product decision requires event-trigger capture.

## 2. Problem

macOS permissions required by a local execution recorder are high-friction:

- Screen Recording is required to capture real desktop frames with ScreenCaptureKit.
- Accessibility is required to read UI structure and app/window context.
- Input Monitoring is required only if Agentic30 captures global keyboard or pointer event timing.
- Microphone, system audio, Automation, and Full Disk Access have separate request semantics.

The default macOS prompt is not enough because:

- some prompts appear once and do not reappear after denial
- some rows are registered only after the protected API is called
- users often grant the wrong process, helper, terminal, or test runner
- a copied helper app and the main app can have different TCC identities
- the same bundle ID with a different signing identity can be a different TCC subject
- stale or cached process state can make a newly toggled permission unusable until relaunch

Agentic30 should prefer explicit root-cause failure over invisible fallback. If a grant is missing, the UI must name the surface, actor source, bundle ID, path, and signing identity that are blocked.

## 3. Non-Goals

- No silent TCC database edits.
- No `sudo`, `sqlite3`, or direct TCC DB writes as product behavior.
- No attempt to bypass System Settings.
- No direct dependence on Screenpipe source or Screenpipe runtime.
- No broad "Computer Use permission" abstraction. macOS grants concrete TCC services.
- No permission prompt that hides the target actor identity.
- No fake success state after the user toggles a permission that requires relaunch.
- No System Settings UI automation for production permission grants.
- No Full Disk Access in the generic recorder permission ladder.

## 4. Permission Surfaces

| Surface | Required For | Grant Mechanism | Drag Panel | First Agentic30 Phase |
|---|---|---|---|---|
| Screen Recording | ScreenCaptureKit frames / Founder Replay | `CGRequestScreenCaptureAccess` or ScreenCaptureKit access attempt, then user toggles listed app in Privacy & Security | No. Screen Recording rows are API-registered; do not show drag for this surface | Core |
| Accessibility | UI tree, app/window context, control metadata | `AXIsProcessTrustedWithOptions(prompt: true)` from the actor that uses AX, plus Accessibility settings | Candidate only after OS/pane validation | Core |
| Input Monitoring | global keyboard/mouse event timing if explicitly enabled | `IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)`, plus Input Monitoring settings | Candidate only after OS/pane validation | Later opt-in |
| Microphone | user voice / meeting audio | AVFoundation prompt after `NSMicrophoneUsageDescription` exists, then Microphone settings | No | Later |
| System Audio | system audio capture | ScreenCaptureKit/system-audio path gated with Screen Recording-style consent | No generic drag assumption | Later |
| Automation | Apple Events to specific target apps | first Apple Event attempt creates per-target Automation row | No | Later |
| Full Disk Access | broad local file/archive inspection | Full Disk Access settings only after separate product justification | Out of scope for generic helper | Not MVP |

Each permission surface must define:

- display name
- protected API actor
- TCC service name for diagnostics
- System Settings deep link candidates
- manual fallback path
- status preflight function
- runtime probe function where needed
- request function
- OS/pane drag capability
- relaunch scope after grant
- product surface blocked when denied

## 5. Permission Actor Identity

TCC grants attach to the process and code-signing subject that calls the protected API. The permission helper must model that actor per surface, not just the visible app bundle.

### 5.1 Permission Actor

Each surface must declare the runtime actor that invokes the protected API:

```text
requestingProcessName
executablePath
containingBundleURL
bundleIdentifier
teamIdentifier
signingRequirementSummary
codeDirectoryHashSummary
buildChannel: debug | beta | release
source: mainApp | recorderHelper | loginItem | xpcService | nodeSidecar | terminal | testRunner | unknown
```

MVP decision: Screen Recording and Accessibility run in the main signed app actor. The sidecar, Terminal, node, and UI test runner are never production permission actors for these surfaces.

A dedicated recorder helper is a separate future migration. It must not be introduced after external users grant main-app TCC permissions unless the release includes an explicit migration plan, updated copy, and regrant workflow.

Current production bundle identifier is read from `CFBundleIdentifier` / `PRODUCT_BUNDLE_IDENTIFIER` and is expected to be `october-academy.agentic30` for the main app build. The helper must not hardcode this value except in tests that explicitly assert the current project setting.

### 5.2 Main App Actor

If the protected API call happens in `agentic30.app`, the actor resolver returns:

```text
Bundle.main.bundleURL
Bundle.main.bundleIdentifier
SecCodeCopyDesignatedRequirement summary
team identifier when signed
```

The UI may display the app name, but display name is cosmetic only. Display names can be localized or changed by the user in Finder.

### 5.3 Helper or Sidecar Actor

If capture later moves into a separate signed helper, login item, XPC service, or bundled sidecar binary, the permission helper must target that actor, not the visible shell app.

The helper must block recorder start if:

- the actor that performs the probe does not match the actor shown in the UI
- the actor has no containing `.app` and the target pane requires an app bundle
- the actor is an external `node` binary, terminal process, or test runner in a developer-only run
- the actor is unsigned, ad-hoc signed, or has a signing identity that cannot be summarized

Developer builds may show diagnostics for Terminal, iTerm, or node, but the production onboarding flow must never instruct end users to grant permissions to a developer tool.

### 5.4 Signing and Update Identity

Bundle ID alone is not a TCC identity check. Persist and compare:

```text
bundleIdentifier
teamIdentifier
signingRequirementSummary
codeDirectoryHashSummary
buildChannel
appPath
```

Use `bundleIdentifier`, `teamIdentifier`, and the designated requirement summary as the primary TCC identity comparator. If the same bundle ID appears with a different team ID or designated requirement, surface `identityChangedNeedsRegrant`.

`codeDirectoryHashSummary` is diagnostic, not a regrant trigger by itself. A normal signed update changes the CodeDirectory hash. If the designated requirement and Team ID are stable, a changed CodeDirectory hash should be recorded as update/tamper diagnostic metadata, not as permission failure.

Debug and ad-hoc builds are TCC-unstable. The debug UI must label them as such because each rebuild or launch path can produce a different grant subject.

### 5.5 App Translocation Guard

Before requesting any TCC permission, detect App Translocation. If the app is running from a translocated path such as `/private/var/folders/.../AppTranslocation/...`, fail loudly:

```text
Cannot request Screen Recording while Agentic30 is app-translocated.
Move Agentic30 to /Applications, relaunch it, then retry.
Granting a translocated bundle can create a stale or disposable TCC row.
```

Use `SecTranslocateIsTranslocatedURL` where available, plus a defensive path check for diagnostics.

### 5.6 Wrong Target Guard

The helper must fail before showing a permission flow when the actor is invalid:

```text
Cannot request Accessibility: permission actor does not match protected API actor.
surface=accessibility
shownBundleId=october-academy.agentic30
probeActor=/opt/homebrew/bin/node
expectedSource=mainApp or signed recorderHelper
```

This is required because TCC grants are attached to the actual actor that touches the protected API, not to the feature name.

### 5.7 Release Identity and Update Gate

Do not enable the production helper until a release identity fixture proves:

- `CFBundleIdentifier` matches the expected production bundle ID for the release channel.
- the signed app exposes a stable Team ID and designated requirement.
- release signing is Developer ID or an explicitly approved distribution identity.
- hardened runtime and notarization policy are part of the release gate.
- Sparkle update verification is configured when automatic updates are enabled.
- `SUPublicEDKey` / `SPARKLE_PUBLIC_ED_KEY` is non-empty for signed update feeds.
- update-in-place preserves the TCC identity comparator across a normal app update.

If any release identity field is unavailable, the helper may run only in debug diagnostics mode and must not onboard external users.

## 6. System Settings Navigation

Use `x-apple.systempreferences:` deep links as best-effort navigation only. The helper must always show the manual path at the same time because programmatic detection of the active Settings pane often requires Accessibility, which may be the missing permission.

Settings navigation must be mapped only for the app's actual supported macOS deployment range. `Info.plist` reads `LSMinimumSystemVersion` from `MACOSX_DEPLOYMENT_TARGET`; at this review the project build settings set that target to `26.4`. Therefore the shipped helper must not claim macOS 13, 14, or 15 support unless the project deployment target is lowered and those OS versions are manually validated.

Maintain two separate tables:

1. `shippingSettingsAnchors`: validated anchors for the current supported deployment range.
2. `candidateSettingsAnchors`: unshipped seed anchors used only by the validation spike.

Candidate seeds may include:

```text
macOS 13-14 candidate anchors:
Screen Recording: x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture
Accessibility:    x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility
Input Monitoring: x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent
Microphone:       x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone
Automation:       x-apple.systempreferences:com.apple.preference.security?Privacy_Automation
Full Disk Access: x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles

macOS 15+ candidate anchors:
Privacy root:     x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension
Screen Recording: x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture
Accessibility:    x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility
Input Monitoring: x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent
```

No candidate seed may appear in `shippingSettingsAnchors` until manual validation records the OS version/build, target pane, fallback behavior, and whether the row can be added manually or only toggled after native API registration.

If an anchor fails, opens the wrong pane, or drops the query, open the Privacy & Security root and show exact fallback copy:

```text
System Settings -> Privacy & Security -> Screen & System Audio Recording
System Settings -> Privacy & Security -> Accessibility
System Settings -> Privacy & Security -> Input Monitoring
```

The flow must not fail solely because the deep link lands on Privacy & Security root.

## 7. Drag Capability Model

Drag guidance is a capability, not a promise. It ships only after a validation spike confirms the exact pane and macOS version accept dropped app bundles from the Agentic30 drag source.

### 7.1 Capability Table

Maintain a versioned capability table in code and tests:

```text
surface            macOS range      app drop      plus picker     relaunch
screenRecording    supported only   no            no              app relaunch
accessibility      verified only    unknown       yes             no relaunch
inputMonitoring    verified only    unknown       yes             app relaunch / recorder restart
fullDiskAccess     future only      unknown       yes             app relaunch
automation         n/a              no            no              per target app
```

Unknown means disabled. The product defaults to manual instructions until verified.

### 7.2 Drag Panel Requirements

For surfaces where drag is enabled:

- Use a borderless floating `NSPanel` with obvious Agentic30 branding.
- Keep one active permission flow at a time.
- Open System Settings before showing the panel.
- Default to a fixed safe position near the main app window or screen margin.
- Do not attempt System Settings window tracking during first-run Accessibility onboarding.
- Track the System Settings window only when Accessibility is already granted.
- Never overlay the actual Settings list, plus button, or toggle area.
- Show the target app icon, display name, bundle ID, actor source, and requested permission.
- Close when the permission is granted, relaunch is required, or the user cancels.

### 7.3 Drag Source Requirements

The app card must behave like a Finder-originated `.app` file drag.

Preferred implementation:

```swift
let draggingItem = NSDraggingItem(pasteboardWriter: appURL as NSURL)
```

Do not manually synthesize the primary file URL pasteboard representation unless a validation test proves it is needed. `NSFilenamesPboardType` may be added only as a compatibility supplement.

During drag:

- start an `NSDraggingSession`
- use `.copy`
- ignore modifier keys
- show the app icon as the drag image
- set mouse transparency only for the minimum drag window needed
- restore hit testing on cancellation, interruption, focus loss, and drag end

### 7.4 Copy

Screen Recording copy:

```text
Turn on Agentic30 in Screen & System Audio Recording, then restart Agentic30.
Target: october-academy.agentic30
```

Accessibility copy for a verified drag-capable pane:

```text
Add Agentic30 to Accessibility, turn its switch on, then return here.
Target: october-academy.agentic30
```

The UI must not say "Agentic30 has permission" until the correct actor passes the status check or runtime probe.

## 8. Permission Request Functions

Drag guidance is not a replacement for native prompt APIs. Request APIs must run in the same actor that will use the protected API.

### 8.1 Screen Recording

Status:

- Use `CGPreflightScreenCaptureAccess` as the coarse TCC preflight.
- After preflight is true, require the actual recorder actor to enumerate `SCShareableContent`, create an `SCStream`, start capture, and receive at least one video sample callback.
- The proof frame is non-persisted and is discarded immediately after the probe.
- Do not use a fake capture, static image, or OCR-only fallback as proof of Screen Recording.

Request:

- Call `CGRequestScreenCaptureAccess()` where available, or attempt the minimal ScreenCaptureKit path that triggers the native TCC prompt.
- Open the Screen Recording / Screen & System Audio Recording settings pane.
- Do not display the drag panel for Screen Recording.
- Tell the user to toggle the already listed app row, then quit and reopen Agentic30 when required.

Failure classification:

```text
tccDeniedOrUnavailable
nativePromptAlreadyConsumed
runtimeActorMismatch
screenCaptureKitUnavailable
noDisplayAvailable
shareableContentFailed
streamStartFailed
firstFrameTimedOut
needsRelaunch
```

If preflight stays false after the user returns from Settings, do not claim a proven denial unless the API proves it. For Screen Recording, prefer `needsRelaunch` or `preflightDeniedOrUnavailable` with exact next steps.

### 8.2 Accessibility

Status:

- Use `AXIsProcessTrusted`.
- Run AX probes in the actor that will read Accessibility data.

Request:

- Call `AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt: true` from the actor that will use AX.
- Open the Accessibility settings pane.
- If and only if the OS/pane capability table says drag is supported, show drag guidance. Otherwise show plus-picker/manual add instructions.

Failure:

- If still ungranted, report `accessibilityPreflightDeniedOrUnavailable`.
- If the Settings window cannot be tracked because Accessibility is denied, use fixed panel positioning. Do not fail because window tracking is unavailable.
- Accessibility does not require app relaunch once the actor is trusted.

### 8.3 Input Monitoring

Input Monitoring must be split by product intent:

```text
keyboardEventTiming
mouseEventTiming
rawKeystrokeCapture
```

`rawKeystrokeCapture` defaults off and requires separate explicit product consent. Timing-only use must not collect raw key values.

Status:

- Import IOKit and use `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)`.
- Treat `IOHIDCheckAccess` as a system authorization check, not as product runtime proof.
- Require the exact product listener path to start successfully before a recorder feature is marked usable.
- If the recorder uses a CG event tap, the runtime probe must create that same tap/listener path and verify it is enabled without collecting raw key values.
- Distinguish TCC denied, Secure Input active, event tap disabled, session unavailable, and recorder not started.

Request:

- Call `IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)` to trigger the native prompt.
- Open the Input Monitoring settings pane.
- Show drag guidance only if the OS/pane capability table says it is verified.

Post-grant:

- `IOHIDCheckAccess` success without the product listener probe yields `systemCheckPassedRuntimeUnproved`.
- Mark the recorder usable only after the exact event listener or event tap used by the product succeeds.
- Show relaunch or recorder-restart guidance when the running recorder started without access.

### 8.4 Automation

Automation is not a single grant. It is a map:

```text
requestingActor -> targetBundleIdentifier -> grantState
```

Rows normally appear only after the first Apple Event attempt. Do not reuse the drag helper model for Automation.

## 9. State Machine

Each permission request follows observable states:

```text
idle
  -> checking
  -> grantedByPreflight | grantedByRuntimeProbe | systemCheckPassedRuntimeUnproved | requestable | failed
requestable
  -> promptIssued
  -> openingSettings
  -> showingManualInstructions | showingDragPanel
  -> waitingForUser
  -> postGrantChecking
  -> grantedByPreflight | grantedByRuntimeProbe | systemCheckPassedRuntimeUnproved | needsRelaunch | actorMismatch | probeFailed | userCanceledHelperFlow | failed
```

State meanings:

- `requestable`: status is not granted and the helper has a valid actor.
- `promptIssued`: the native API request was attempted.
- `showingManualInstructions`: System Settings is open and the UI explains the exact row/switch/manual path.
- `showingDragPanel`: enabled only for verified drag-capable surfaces.
- `systemCheckPassedRuntimeUnproved`: a system preflight/check passed, but the product runtime path still has not proven it can capture.
- `needsRelaunch`: Screen Recording or Input Monitoring changed but the running actor cannot use the grant until restart.
- `actorMismatch`: the actor shown to the user is not the actor failing the probe.
- `probeFailed`: preflight or runtime probe failed with a typed reason.
- `failed`: target resolution, Settings open, prompt, or probe failed with an explicit error.

Do not claim `denied` unless an API or explicit user action proves denial. Otherwise use `preflightDeniedOrUnavailable` or `probeFailed(reason)`.

## 10. Health Model

Expose a single Swift-side health object:

```swift
struct MacPermissionHealth {
    var schemaVersion: Int
    var checkedAt: Date
    var target: PermissionActorIdentity
    var surfaces: [MacPermissionSurface: PermissionSurfaceHealth]
}
```

Each surface health includes:

```swift
enum PermissionGrantState: String {
    case notNeeded
    case unknown
    case ungrantedUnknown
    case promptIssued
    case grantedByPreflight
    case grantedByRuntimeProbe
    case systemCheckPassedRuntimeUnproved
    case preflightDeniedOrUnavailable
    case needsRelaunch
    case actorMismatch
    case identityChangedNeedsRegrant
    case appTranslocated
    case probeFailed
    case userCanceledHelperFlow
    case failed
}
```

The state-machine state, Swift enum raw value, and sidecar wire string must share this table. Adding a state requires Swift decoder tests and sidecar schema tests.

Swift remains the source of truth for macOS permission checks. The sidecar may consume permission health, but it must not infer TCC state or mark a permission granted.

## 11. UX Placement

The helper appears in three places.

### 11.1 First-Run Permission Ladder

Ask only for permissions tied to the selected feature.

Founder Replay recorder mode:

1. Screen Recording.
2. Accessibility.
3. Input Monitoring only if the user enables event-trigger capture.

Do not request Microphone, System Audio, Automation, or Full Disk Access during first-run unless the user enables a feature that needs them.

### 11.2 Recorder Health Recovery

If a permission is revoked after setup:

- show the missing permission
- show the affected feature
- show the actor source, bundle ID, path, and signing summary
- provide `Fix in System Settings`
- restart only the app, helper, or recorder actor that needs reinitialization

### 11.3 Settings

Settings should show every permission surface with:

- status
- last checked time
- actor identity
- why Agentic30 needs it
- what still works without it
- request/fix button
- reset guidance where appropriate

## 12. Failure Rules

Agentic30 must prefer explicit failure over meaningless fallback.

Required failures:

- Cannot resolve protected API actor.
- Actor is not an `.app` where the pane requires an app bundle.
- Actor is App-Translocated.
- Actor bundle ID changed since last known grant.
- Actor signing identity changed since last known grant.
- User granted the wrong app, helper, terminal, or test runner.
- System Settings could not be opened.
- Native prompt was unavailable, already consumed, or dismissed.
- Permission remains ungranted after user returns.
- Permission was granted but the recorder actor still lacks runtime access.
- Runtime actor does not match the actor shown in UI.
- TCC appears stale or cached and requires relaunch.

Forbidden failures:

- silently disabling capture
- claiming setup complete when Screen Recording is missing
- falling back to fake replay data
- treating OCR-only capture as equivalent to Accessibility capture without labeling degraded mode
- using `sudo` or direct TCC DB writes as product behavior
- asking end users to grant production permissions to Terminal, node, Xcode, or the test runner

## 13. Reset and Recovery

The product may offer reset instructions, but not as the normal grant path.

Allowed:

- explain that the user can remove Agentic30 from a privacy list and re-add it
- offer developer-only diagnostic commands in debug builds
- expose root-cause messages with TCC service names and actor identity

Debug reset command rules:

- Generate copy-only commands.
- Include the exact TCC service and exact bundle ID.
- Never run the command automatically.
- Never suggest `sudo`.
- Warn that reset removes the existing grant and may require relaunch.

Example debug-only copy:

```bash
tccutil reset ScreenCapture october-academy.agentic30
```

Never run `tccutil reset` automatically in production.

## 14. Privacy, Trust, and Threat Model

The helper must make permission consequences clear:

- Screen Recording captures pixels for Founder Replay.
- Accessibility reads UI structure and text metadata.
- Input Monitoring can capture event timing; raw keystroke capture is a separate product decision and defaults off.
- Microphone and system audio are separate sensitive captures and must not be bundled into the core recorder grant.

All permission copy should state:

- what is captured
- where it stays
- what feature breaks without it
- how to pause, stop, or revoke capture

Permission requests must be initiated only by explicit user action. Workspace content, sidecar messages, scripts, or remote prompts must not automatically trigger scary OS permission prompts.

### 14.1 Telemetry and Diagnostic Boundary

Permission actor identity is local diagnostic data by default.

Remote analytics may include only coarse permission state, feature blocked, build channel, and error class. Remote analytics must not include:

- full local app paths
- raw signing requirements
- CodeDirectory hashes
- Team ID unless explicitly approved as release-channel metadata
- workspace paths
- raw UI text, key values, screenshots, or captured frames

If the user explicitly uploads diagnostics, redact paths or replace them with per-install salted hashes. The local sidecar may receive detailed permission health for gating recorder behavior, but PostHog or any remote telemetry path must use a separate redacted event schema.

### 14.2 Floating Panel Security Constraints

- The panel must be clearly branded as Agentic30, not System Settings.
- The panel must never overlay Settings list rows, plus buttons, or toggles.
- The panel must not synthesize clicks, drags, or keyboard input.
- The user must physically drag the app card when drag is used.
- `ignoresMouseEvents` must reset to `false` if the drag session is interrupted, cancelled, or the app loses focus.
- Permission request attempts should be locally auditable without recording raw secrets or input events.

## 15. Implementation Shape

### 15.1 Swift Modules

Suggested files:

```text
agentic30/MacPermissionSurface.swift
agentic30/MacPermissionActorResolver.swift
agentic30/MacPermissionHealthStore.swift
agentic30/MacPermissionRequestController.swift
agentic30/MacPermissionDragPanel.swift
agentic30/MacPermissionDragSourceView.swift
agentic30/MacPermissionSettingsNavigator.swift
```

### 15.2 Public Swift API

```swift
protocol MacPermissionManaging {
    func refreshAll() async -> MacPermissionHealth
    func request(_ surface: MacPermissionSurface) async -> PermissionRequestResult
    func openSettings(_ surface: MacPermissionSurface) async -> PermissionRequestResult
    func stopActiveRequest()
}
```

Under UI testing and `AGENTIC30_TEST_STUB_PROVIDER=1`, inject `StubMacPermissionManager`. The stub path must not call `CG*`, `AX*`, `IOHID*`, `SecCode*`, or System Settings APIs.

### 15.3 Events to Sidecar

Swift emits sidecar events:

```json
{
  "type": "mac_permission_health",
  "schemaVersion": 1,
  "checkedAt": "2026-06-28T03:00:00Z",
  "target": {
    "source": "mainApp",
    "bundleId": "october-academy.agentic30",
    "teamId": "TEAMID",
    "path": "/Applications/Agentic30.app",
    "signingRequirementSummary": "anchor apple generic and certificate leaf[subject.OU] = TEAMID"
  },
  "surfaces": {
    "screenRecording": {
      "state": "needsRelaunch",
      "reason": "preflight_still_false_after_user_returned",
      "blocks": ["founderReplayCapture"]
    },
    "accessibility": {
      "state": "grantedByPreflight",
      "reason": null,
      "blocks": []
    }
  }
}
```

The sidecar may block recorder start or show degraded state from this event, but it must not infer TCC state itself.

This detailed event is local-only. Do not forward `path`, `signingRequirementSummary`, `teamId`, or CodeDirectory diagnostics to remote analytics. If analytics are needed, emit a separate redacted event such as:

```json
{
  "type": "mac_permission_state_redacted",
  "surface": "screenRecording",
  "state": "needsRelaunch",
  "blocks": ["founderReplayCapture"],
  "buildChannel": "release"
}
```

## 16. Acceptance Criteria

### 16.1 Manual QA Matrix

Before enabling drag guidance for any pane, verify and record:

- macOS version and build
- project deployment target and `LSMinimumSystemVersion`
- Debug app from Xcode
- signed/notarized release app in `/Applications`
- release Team ID and designated requirement fixture
- non-empty Sparkle EdDSA public key when automatic updates are enabled
- copied app in Downloads
- app launched from a DMG/quarantined location
- app updated in place
- old app deleted and new app installed
- helper introduced after main app already has permission
- two Agentic30 builds with different bundle IDs installed simultaneously

Core manual QA:

- Screen Recording request triggers the native prompt or API registration.
- Screen Recording flow never shows drag guidance.
- Screen Recording tells the user to toggle the listed app and relaunch when needed.
- Screen Recording success requires a started `SCStream` and at least one discarded video sample from the correct actor.
- Accessibility request opens the Accessibility pane and uses drag only if verified for the OS.
- Input Monitoring uses IOKit request/check APIs and is opt-in.
- Input Monitoring success requires the exact product listener or event tap path, not `IOHIDCheckAccess` alone.
- The floating panel shows the exact actor source, bundle ID, and path.
- Permission status changes to granted only after the correct actor passes preflight or runtime probe.
- Denying or closing the Settings flow leaves an explicit pending or failed state.
- Restart-required state is shown only for surfaces that require it.
- Remote telemetry uses the redacted permission schema only.
- Microphone capture cannot be enabled until `NSMicrophoneUsageDescription` exists and has been reviewed.

### 16.2 Regression Tests

Unit tests:

- actor resolver rejects non-`.app` paths where an app bundle is required
- actor resolver reports bundle ID, team ID, signing summary, path, and source
- same bundle ID with changed signing summary yields `identityChangedNeedsRegrant`
- same bundle ID, same Team ID, same designated requirement, and changed CodeDirectory hash does not yield `identityChangedNeedsRegrant`
- App Translocation yields `appTranslocated`
- each permission maps to the correct Settings anchor candidates and fallback manual path
- unsupported or unknown OS/pane combinations disable drag panel
- state machine handles cancel, grant, actor mismatch, stale/cached state, and relaunch-required paths
- sidecar cannot mark TCC granted
- analytics mapper drops local path, raw signing requirement, CodeDirectory hash, and raw capture data
- debug/test runner identity is rejected for production setup

UI tests:

- permission ladder renders fixture health from `StubMacPermissionManager`
- settings health card names the exact actor identity
- recovery flow does not auto-advance until all required surfaces are granted
- no UI test opens System Settings or manipulates live TCC

### 16.3 CI Boundaries

CI and default UI tests must not depend on real TCC state. Live System Settings and drag tests are manual/local diagnostics only and require the repo's explicit blocking UI approval policy.

Provide a debug-only simulation flag, such as:

```text
--simulate-permission-flow
```

This may render the drag panel positioning and state transitions without opening System Settings or requiring real permission changes.

## 17. Decisions and Open Questions

MVP decision:

- Screen Recording and Accessibility run inside `agentic30.app`.
- A dedicated signed recorder helper is post-MVP unless it is selected before any external TCC onboarding.
- Moving capture from the main app to a helper later is a permission migration and requires a release note, regrant UX, and telemetry flag.

Open questions:

- Should Input Monitoring be included in first-run for Founder Replay or remain a later opt-in?
- Should raw keystroke capture exist at all, or should Input Monitoring only provide trigger timing?
- Should Full Disk Access ever be requested, or should workspace-scoped file selection and security-scoped bookmarks cover the product need?
- How should the helper behave when multiple builds exist, such as Debug, Beta, and Release apps with different bundle IDs?

## 18. Build Order

0. Lock the production actor decision to `agentic30.app` for MVP and add a release identity fixture.
1. Fix or gate release update identity before external permission onboarding:
   - non-empty Sparkle public EdDSA key when Sparkle update verification is enabled
   - stable Team ID and designated requirement
   - hardened runtime and notarization release gate
   - update-in-place TCC persistence check
2. Run a validation spike on the actual supported macOS deployment range:
   - confirm Screen Recording API registration and relaunch behavior
   - confirm whether Accessibility accepts app drag, plus-picker, or only toggles
   - confirm whether Input Monitoring accepts app drag or requires plus-picker
   - record results in the capability table
3. Implement actor resolver, signing summary, and App Translocation guard.
4. Implement Screen Recording request/status with runtime `SCStream` first-sample probe.
5. Implement Settings navigation with unconditional manual fallback copy.
6. Implement Accessibility request/status without relying on Settings window tracking.
7. Implement health store and state machine with unified wire enum.
8. Wire first-run permission ladder for recorder mode.
9. Add drag panel only for verified drag-capable panes.
10. Add Input Monitoring only after product consent and exact listener/tap runtime proof are implemented.
11. Add recovery/settings surfaces.
12. Add tests for mapping, actor identity, signing drift, translocation, sidecar event schema, redacted analytics schema, and state transitions.

The first shippable slice is Screen Recording + Accessibility for the correct signed actor, with Screen Recording using API registration rather than drag, and explicit degraded recorder state when either required surface is unavailable.
