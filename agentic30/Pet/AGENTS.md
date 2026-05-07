<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-07 | Updated: 2026-05-07 -->

# Pet

## Purpose
Floating "wolf" pet/companion overlay window. Owns the always-on-top NSWindow that hosts the wolf sprite, the state machine that maps app/sidecar events to wolf moods (idle, thinking, working, sleeping, error, attention, happy, etc.), and the sequence package that scripts multi-frame transitions. Sprite assets live in `../wolf/` (PNG frames + GIF animations) and are not part of this directory.

## Key Files

| File | Description |
|------|-------------|
| `PetView.swift` | SwiftUI view that renders the wolf sprite using sprite frames / GIFs from `../wolf/` |
| `PetWindowController.swift` | NSWindowController that hosts `PetView` as a borderless, always-on-top floating window |
| `WolfState.swift` | Enum + helpers describing wolf moods and asset selection |
| `WolfStateMachine.swift` | Maps app/sidecar events into `WolfState` transitions |
| `WolfStateSequencePackage.swift` | Pre-recorded transition sequences (e.g., "carry → drop → idle") |

## For AI Agents

### Working In This Directory
- The pet window is borderless and intentionally not in the regular window list. Do not add `.titleBar` style — it would defeat the floating-overlay UX.
- New wolf states must come with sprite assets in `../wolf/` and a `WolfState` enum case.
- The state machine is consumed by `AgenticViewModel` and driven by sidecar events surfaced through `pet-hooks.mjs`. Adding a new event type requires sidecar + Swift changes in lockstep.
- Animations should remain GPU-friendly — avoid CPU-bound per-frame Swift logic.

### Testing Requirements
- Covered by `agentic30Tests/WolfStateMachineTests.swift` and `agentic30Tests/WolfStateSequencePackageTests.swift`.
- Visual regressions are caught in hermetic UI tests (where applicable).

### Common Patterns
- `@MainActor` on the state machine for SwiftUI safety.
- Asset paths use bundle URL resolution; do not hardcode workspace paths.

## Dependencies

### Internal
- `../wolf/` — sprite assets.
- `agentic30/SidecarBridge.swift` and `sidecar/pet-hooks.mjs` — drive transitions.

### External
- SwiftUI / AppKit only.

<!-- MANUAL: -->
