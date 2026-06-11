// Provider selection for agent-backed workspace scan and Day 1 alignment
// synthesis. Policy: run a SINGLE explicit provider — the one the user picked
// in settings — or fall back to the single default (codex) when the caller did
// not supply a usable settings provider. No multi-provider fan-out / frontier
// ensemble: exactly one { provider, model } target is always returned.
// No automatic fallback either: when the provider hits its usage limit (or is
// unavailable) the sidecar broadcasts workspace_scan_blocked with a
// recommended next provider and the Mac side offers an explicit "proceed with
// <provider>" button — switching requires the user's consent. Without any
// available provider the scan stays blocked: local-only signals never pass.

const KNOWN_PROVIDERS = ["claude", "codex", "gemini", "cursor"];
const DEFAULT_PROVIDER = "codex";

// User-prescribed guidance chain: Codex 한도/불가 → Claude → Gemini → Cursor.
// Mirrors AgentProvider.fallbackCycle on the Swift side — keep both in sync.
export const PROVIDER_FALLBACK_CYCLE = ["codex", "claude", "gemini", "cursor"];

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

/**
 * After `failedProvider` could not verify the scan (usage limit, missing auth,
 * or a run error), pick what the UI should offer next. Walks
 * PROVIDER_FALLBACK_CYCLE starting after the failed provider, skipping the
 * failed provider itself, keeping only providers `isAvailable` confirms.
 *
 * Returns { nextProvider, availableProviders }:
 * - nextProvider: the single recommended provider (first available in cycle
 *   order), or null when nothing is available — Agentic30 cannot proceed.
 * - availableProviders: every available provider ≠ failed, in cycle order
 *   starting after the failed provider, nextProvider first.
 */
export function selectNextScanProvider(failedProvider, isAvailable) {
  const failed = normalizeSettingsProvider(failedProvider) || DEFAULT_PROVIDER;
  const start = PROVIDER_FALLBACK_CYCLE.indexOf(failed);
  const ordered = [];
  for (let offset = 1; offset < PROVIDER_FALLBACK_CYCLE.length; offset += 1) {
    const candidate = PROVIDER_FALLBACK_CYCLE[(start + offset) % PROVIDER_FALLBACK_CYCLE.length];
    if (candidate === failed) continue;
    let available = false;
    try {
      available = Boolean(isAvailable(candidate));
    } catch {
      available = false;
    }
    if (available) ordered.push(candidate);
  }
  return {
    nextProvider: ordered[0] ?? null,
    availableProviders: ordered,
  };
}
