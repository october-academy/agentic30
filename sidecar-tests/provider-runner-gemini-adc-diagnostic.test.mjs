import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  geminiAdcDiagnostic,
  getProviderAuthState,
  hasGcloudBinary,
  resetProviderSettingsForTest,
} from "../sidecar/provider-runner.mjs";

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("hasGcloudBinary returns false when no install path matches and PATH has no gcloud", () => {
  const result = hasGcloudBinary({
    installPaths: ["/var/empty/agentic30-no-gcloud"],
    env: { PATH: "/var/empty" },
  });
  assert.equal(result, false);
});

test("hasGcloudBinary returns true when an injected install path exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gcloud-bin-"));
  const fakeBinary = path.join(dir, "gcloud");
  try {
    await fs.writeFile(fakeBinary, "#!/bin/sh\n");
    const result = hasGcloudBinary({
      installPaths: [fakeBinary],
      env: { PATH: "/var/empty" },
    });
    assert.equal(result, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("geminiAdcDiagnostic returns gcloud-missing when neither binary nor ADC file exists", async () => {
  const previousHome = process.env.HOME;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-adc-empty-"));
  try {
    process.env.HOME = dir;
    const diagnostic = geminiAdcDiagnostic({
      installPaths: ["/var/empty/agentic30-no-gcloud"],
      env: { PATH: "/var/empty" },
    });
    assert.equal(diagnostic.status, "gcloud-missing");
    assert.equal(diagnostic.gcloudInstalled, false);
    assert.equal(diagnostic.adcCredentialsPresent, false);
  } finally {
    restoreEnv("HOME", previousHome);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("geminiAdcDiagnostic returns gcloud-present-no-adc when binary exists but ADC file missing", async () => {
  const previousHome = process.env.HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-adc-no-creds-"));
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gcloud-only-"));
  const fakeBinary = path.join(binDir, "gcloud");
  try {
    process.env.HOME = homeDir;
    await fs.writeFile(fakeBinary, "#!/bin/sh\n");
    const diagnostic = geminiAdcDiagnostic({
      installPaths: [fakeBinary],
      env: { PATH: "/var/empty" },
    });
    assert.equal(diagnostic.status, "gcloud-present-no-adc");
    assert.equal(diagnostic.gcloudInstalled, true);
    assert.equal(diagnostic.adcCredentialsPresent, false);
  } finally {
    restoreEnv("HOME", previousHome);
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test("geminiAdcDiagnostic returns ready when ADC credentials file exists with content", async () => {
  const previousHome = process.env.HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-adc-ready-"));
  try {
    process.env.HOME = homeDir;
    await fs.mkdir(path.join(homeDir, ".config", "gcloud"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".config", "gcloud", "application_default_credentials.json"),
      JSON.stringify({ type: "authorized_user", refresh_token: "test" }),
    );
    const diagnostic = geminiAdcDiagnostic({
      installPaths: ["/var/empty/agentic30-no-gcloud"],
      env: { PATH: "/var/empty" },
    });
    assert.equal(diagnostic.status, "ready");
    assert.equal(diagnostic.adcCredentialsPresent, true);
  } finally {
    restoreEnv("HOME", previousHome);
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("getProviderAuthState gemini exposes geminiAdc field with gcloud-missing message when nothing is configured", async () => {
  const previousHome = process.env.HOME;
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  const previousStub = process.env.AGENTIC30_TEST_STUB_PROVIDER;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gemini-state-"));
  try {
    resetProviderSettingsForTest();
    process.env.HOME = dir;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.AGENTIC30_TEST_STUB_PROVIDER;

    const state = getProviderAuthState("gemini");

    assert.equal(state.available, false);
    assert.equal(state.source, "missing");
    assert.ok(state.geminiAdc, "geminiAdc payload must be present on missing-gemini state");
    assert.equal(state.geminiAdc.adcCredentialsPresent, false);
    assert.match(state.message, /GEMINI_API_KEY|gcloud/);
  } finally {
    resetProviderSettingsForTest();
    restoreEnv("HOME", previousHome);
    restoreEnv("GEMINI_API_KEY", previousGemini);
    restoreEnv("GOOGLE_API_KEY", previousGoogle);
    restoreEnv("AGENTIC30_TEST_STUB_PROVIDER", previousStub);
  }
});
