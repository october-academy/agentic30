import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_FALLBACK_CYCLE,
  normalizeSettingsProvider,
  selectNextScanProvider,
  selectScanProviderTargets,
} from "../sidecar/scan-provider-select.mjs";

const SCAN_MODELS = {
  claude: "claude-sonnet-4-6",
  codex: "gpt-5.5",
  gemini: "gemini-3.5-flash",
  cursor: "composer-2.5",
};

test("normalizeSettingsProvider accepts known providers and rejects others", () => {
  assert.equal(normalizeSettingsProvider("claude"), "claude");
  assert.equal(normalizeSettingsProvider("CODEX"), "codex");
  assert.equal(normalizeSettingsProvider(" Gemini "), "gemini");
  assert.equal(normalizeSettingsProvider("cursor"), "cursor");
  assert.equal(normalizeSettingsProvider(""), "");
  assert.equal(normalizeSettingsProvider("openai"), "");
  assert.equal(normalizeSettingsProvider(null), "");
});

test("a settings provider narrows the scan to exactly that one provider", () => {
  assert.deepEqual(selectScanProviderTargets("claude", SCAN_MODELS), [
    { provider: "claude", model: "claude-sonnet-4-6" },
  ]);
  assert.deepEqual(selectScanProviderTargets("codex", SCAN_MODELS), [
    { provider: "codex", model: "gpt-5.5" },
  ]);
  assert.deepEqual(selectScanProviderTargets("gemini", SCAN_MODELS), [
    { provider: "gemini", model: "gemini-3.5-flash" },
  ]);
  assert.deepEqual(selectScanProviderTargets("cursor", SCAN_MODELS), [
    { provider: "cursor", model: "composer-2.5" },
  ]);
});

test("an empty or unknown settings provider defaults to codex only", () => {
  const codexOnly = [{ provider: "codex", model: "gpt-5.5" }];
  assert.deepEqual(selectScanProviderTargets("", SCAN_MODELS), codexOnly);
  assert.deepEqual(selectScanProviderTargets("openai", SCAN_MODELS), codexOnly);
  assert.deepEqual(selectScanProviderTargets(undefined, SCAN_MODELS), codexOnly);
});

test("a known provider missing from the model map defaults to codex only", () => {
  const partial = { claude: "claude-sonnet-4-6", codex: "gpt-5.5" };
  assert.deepEqual(selectScanProviderTargets("gemini", partial), [
    { provider: "codex", model: "gpt-5.5" },
  ]);
});

test("workspace scan model maps can omit cursor so a cursor preference falls back to codex", () => {
  const workspaceScanModels = {
    claude: "claude-sonnet-4-6",
    codex: "gpt-5.5",
    gemini: "gemini-3.5-flash",
  };
  assert.deepEqual(selectScanProviderTargets("cursor", workspaceScanModels), [
    { provider: "codex", model: "gpt-5.5" },
  ]);
});

test("fallback cycle is the prescribed generic codex -> claude -> gemini -> cursor chain", () => {
  assert.deepEqual(PROVIDER_FALLBACK_CYCLE, ["codex", "claude", "gemini", "cursor"]);
});

test("codex failure recommends claude first when claude is available", () => {
  const { nextProvider, availableProviders } = selectNextScanProvider(
    "codex",
    () => true,
  );
  assert.equal(nextProvider, "claude");
  assert.deepEqual(availableProviders, ["claude", "gemini", "cursor"]);
});

test("codex failure skips an unavailable claude and recommends gemini", () => {
  const { nextProvider, availableProviders } = selectNextScanProvider(
    "codex",
    (candidate) => candidate !== "claude",
  );
  assert.equal(nextProvider, "gemini");
  assert.deepEqual(availableProviders, ["gemini", "cursor"]);
});

test("codex failure with only cursor available recommends cursor", () => {
  const { nextProvider, availableProviders } = selectNextScanProvider(
    "codex",
    (candidate) => candidate === "cursor",
  );
  assert.equal(nextProvider, "cursor");
  assert.deepEqual(availableProviders, ["cursor"]);
});

test("scan readiness predicates can keep cursor out of scan recommendations", () => {
  const authenticatedProviders = new Set(["cursor"]);
  const scanReadyProviders = new Set();
  const { nextProvider, availableProviders } = selectNextScanProvider(
    "codex",
    (candidate) => authenticatedProviders.has(candidate) && scanReadyProviders.has(candidate),
  );
  assert.equal(nextProvider, null);
  assert.deepEqual(availableProviders, []);
});

test("claude failure wraps the cycle: gemini, cursor, then codex", () => {
  const { availableProviders } = selectNextScanProvider("claude", () => true);
  assert.deepEqual(availableProviders, ["gemini", "cursor", "codex"]);
});

test("the failed provider is never recommended even when it reports available", () => {
  const { nextProvider, availableProviders } = selectNextScanProvider(
    "codex",
    (candidate) => candidate === "codex",
  );
  assert.equal(nextProvider, null);
  assert.deepEqual(availableProviders, []);
});

test("no available provider yields a null recommendation (Agentic30 cannot proceed)", () => {
  const { nextProvider, availableProviders } = selectNextScanProvider(
    "codex",
    () => false,
  );
  assert.equal(nextProvider, null);
  assert.deepEqual(availableProviders, []);
});

test("an availability probe that throws counts as unavailable", () => {
  const { nextProvider } = selectNextScanProvider("codex", (candidate) => {
    if (candidate === "claude") throw new Error("probe failed");
    return candidate === "gemini";
  });
  assert.equal(nextProvider, "gemini");
});

test("an unknown failed provider falls back to the codex slot in the cycle", () => {
  const { nextProvider } = selectNextScanProvider("openai", () => true);
  assert.equal(nextProvider, "claude");
});
