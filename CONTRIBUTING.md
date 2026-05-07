# Contributing to agentic30

Thanks for your interest in contributing.

## Quick start

```bash
npm install
npm run test:sidecar
xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'
```

For full prerequisites and signing notes, see the [README](./README.md).

## How this repo relates to October Academy

This is the public macOS companion app for the [October Academy](https://october-academy.com) `agentic30` learning platform. The platform itself remains private. Pull requests merged here flow back into the platform through a one-way submodule pointer bump — the public repo is the source of truth for this code.

## Pull request guidelines

- Keep PRs focused on one change.
- Add tests where possible (`npm run test:sidecar` for sidecar logic, `xcodebuild test` for UI behavior).
- Sidecar logs and UI behavior should both stay deterministic — avoid time-of-day or network-dependent assertions.
- Open an issue first if you plan a large refactor or new feature, so we can align on scope.

## Bundle ID and signing for forks

The shipped Bundle ID is `october-academy.agentic30`. If you fork and run a local build, change the Bundle ID to your own (for example `your.team.agentic30`) so it does not collide with an installed copy of the official build in your Keychain or Launch Services. In Xcode: **Targets → agentic30 → General → Bundle Identifier**.

Signing is set to "Sign to Run Locally". Set **Signing & Capabilities → Team** to your personal Apple ID for local builds.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.

## Reporting security issues

Do not open public issues for security vulnerabilities. Email `security@october-academy.com` instead.
