// Provider selection for agent-backed workspace scan and Day 1 alignment
// synthesis. Policy: run a SINGLE explicit provider — the one the user picked
// in settings — or fall back to the single default (codex) when the caller did
// not supply a usable settings provider. No multi-provider fan-out / frontier
// ensemble: exactly one { provider, model } target is always returned.
// No automatic fallback either: when the provider hits its usage limit the
// sidecar broadcasts workspace_scan_provider_limited and the Mac side offers
// an explicit "switch provider and re-scan" button — switching requires the
// user's consent.

const KNOWN_PROVIDERS = ["claude", "codex", "gemini"];
const DEFAULT_PROVIDER = "codex";

export function normalizeSettingsProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  return KNOWN_PROVIDERS.includes(provider) ? provider : "";
}

/**
 * Resolve the single { provider, model } target a scan / Day 1 synthesis run
 * should spawn, given the settings-selected provider and a provider→model map.
 *
 * - A known settings provider that exists in the map → exactly that one target.
 * - Empty / unknown settings provider, or one missing from the map → the codex
 *   default target. Never fans out to multiple providers.
 */
export function selectScanProviderTargets(preferredProvider, modelByProvider = {}) {
  const settingsProvider = normalizeSettingsProvider(preferredProvider);
  const provider = (settingsProvider && Object.prototype.hasOwnProperty.call(modelByProvider, settingsProvider))
    ? settingsProvider
    : DEFAULT_PROVIDER;
  return [{ provider, model: modelByProvider[provider] }];
}
