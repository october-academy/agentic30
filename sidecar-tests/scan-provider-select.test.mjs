import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSettingsProvider,
  selectScanProviderTargets,
} from "../sidecar/scan-provider-select.mjs";

const SCAN_MODELS = {
  claude: "claude-sonnet-4-6",
  codex: "gpt-5.1-codex-mini",
  gemini: "gemini-3.5-flash",
};

test("normalizeSettingsProvider accepts known providers and rejects others", () => {
  assert.equal(normalizeSettingsProvider("claude"), "claude");
  assert.equal(normalizeSettingsProvider("CODEX"), "codex");
  assert.equal(normalizeSettingsProvider(" Gemini "), "gemini");
  assert.equal(normalizeSettingsProvider(""), "");
  assert.equal(normalizeSettingsProvider("openai"), "");
  assert.equal(normalizeSettingsProvider(null), "");
});

test("a settings provider narrows the scan to exactly that one provider", () => {
  assert.deepEqual(selectScanProviderTargets("claude", SCAN_MODELS), [
    { provider: "claude", model: "claude-sonnet-4-6" },
  ]);
  assert.deepEqual(selectScanProviderTargets("codex", SCAN_MODELS), [
    { provider: "codex", model: "gpt-5.1-codex-mini" },
  ]);
  assert.deepEqual(selectScanProviderTargets("gemini", SCAN_MODELS), [
    { provider: "gemini", model: "gemini-3.5-flash" },
  ]);
});

test("an empty or unknown settings provider defaults to codex only", () => {
  const codexOnly = [{ provider: "codex", model: "gpt-5.1-codex-mini" }];
  assert.deepEqual(selectScanProviderTargets("", SCAN_MODELS), codexOnly);
  assert.deepEqual(selectScanProviderTargets("openai", SCAN_MODELS), codexOnly);
  assert.deepEqual(selectScanProviderTargets(undefined, SCAN_MODELS), codexOnly);
});

test("a known provider missing from the model map defaults to codex only", () => {
  const partial = { claude: "claude-sonnet-4-6", codex: "gpt-5.1-codex-mini" };
  assert.deepEqual(selectScanProviderTargets("gemini", partial), [
    { provider: "codex", model: "gpt-5.1-codex-mini" },
  ]);
});
