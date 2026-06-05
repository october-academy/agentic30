// Provider selection for agent-backed workspace scan and Day 1 alignment
// synthesis. These flows historically fanned out to every authenticated
// provider (claude + codex + gemini) as a "best of 3" frontier ensemble. The
// product decision is to honor the provider the user picked in settings: run
// only that one. We still fall back to the full provider set when the caller
// did not supply a settings provider (e.g. an older Mac client that omits
// preferredProvider), so version skew never silently drops the agent scan.

const KNOWN_PROVIDERS = ["claude", "codex", "gemini"];

export function normalizeSettingsProvider(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  return KNOWN_PROVIDERS.includes(provider) ? provider : "";
}

/**
 * Resolve which { provider, model } targets a scan / Day 1 synthesis run should
 * spawn, given the settings-selected provider and a provider→model map.
 *
 * - A known settings provider that exists in the map → exactly that one target.
 * - Empty / unknown settings provider, or one missing from the map → every
 *   target in the map (legacy frontier fallback).
 */
export function selectScanProviderTargets(preferredProvider, modelByProvider = {}) {
  const settingsProvider = normalizeSettingsProvider(preferredProvider);
  if (settingsProvider && Object.prototype.hasOwnProperty.call(modelByProvider, settingsProvider)) {
    return [{ provider: settingsProvider, model: modelByProvider[settingsProvider] }];
  }
  return Object.keys(modelByProvider).map((provider) => ({
    provider,
    model: modelByProvider[provider],
  }));
}
