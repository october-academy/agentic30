# QMD Advice Setup

QMD advice is optional context retrieval for local coaching. It should improve answers when configured, but it must not block first-run onboarding or Today Mission.

## Expected Behavior

- Without QMD, short coaching prompts use cached BIP/workspace context or the local fallback mission path.
- With QMD, memory-style prompts can retrieve project guidance and prior notes through the sidecar read-only lane.
- QMD is never a prerequisite for Google Docs/Sheets setup or first local mission generation.

## Local Setup

1. Run `npm install` in `packages/mac/agentic30`.
2. Launch the app from Xcode.
3. Select a project folder.
4. Ask a project-memory question such as `ICP.md 문서 어디에 있어?`.
5. Use Diagnostics to confirm whether QMD is available. If unavailable, the app should still answer from cached BIP/workspace context.

## Troubleshooting

- If QMD is unavailable, confirm the sidecar can start and that the selected workspace path exists.
- If retrieval returns stale context, refresh the project folder selection and restart the sidecar.
- If the answer asks for Google setup before giving a mission, treat it as a regression: first mission should be local-first, and Google setup belongs to proof capture.
