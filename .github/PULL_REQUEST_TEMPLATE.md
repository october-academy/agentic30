## Summary

- 

## Testing

- [ ] `npm run test:sidecar`
- [ ] `npm run test:swift:unit`
- [ ] `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run test:swift:ui:smoke` (only after local desktop approval, if UI behavior changed)
- [ ] Manual UI check, if relevant

## Checklist

- [ ] The change is scoped to the macOS app or sidecar in this repository.
- [ ] New behavior is covered by tests or a clear manual verification note.
- [ ] Logs, screenshots, and fixtures do not include secrets or private workspace data.
- [ ] Fork builds use a non-official Bundle ID when needed.
