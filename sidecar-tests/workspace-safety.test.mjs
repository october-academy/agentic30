import test from "node:test";
import assert from "node:assert/strict";

import {
  isSecretFilename,
  isSecretPath,
  isNoisePath,
  redactSecrets,
  containsSecret,
} from "../sidecar/workspace-safety.mjs";

// Token-shaped strings are built via concatenation so the literal source of
// this file never matches scripts/check-public-safety.mjs (mirrors the trick in
// public-safety.test.mjs). Values only take secret shape at runtime.
const githubToken = `ghp_${"a".repeat(40)}`;
const anthropicKey = `sk-ant-${"b".repeat(24)}`;
const openaiToken = `sk-${"proj-"}${"c".repeat(30)}`;
const awsKey = `AKIA${"D".repeat(16)}`;
const googleKey = `AIza${"e".repeat(35)}`;

test("isSecretFilename flags env/credential/key files and secret dirs", () => {
  for (const name of [
    ".env",
    ".env.local",
    ".env.production",
    ".envrc",
    ".npmrc",
    ".netrc",
    "credentials.json",
    ".credentials",
    "service-account.pem",
    "developer-id.key",
    "cert.p12",
    "id_rsa",
    "auth.json",
    "my-secret.txt",
    "api_key.ts",
    ".ssh",
    ".aws",
  ]) {
    assert.equal(isSecretFilename(name), true, `expected secret: ${name}`);
  }
  for (const name of ["README.md", "index.mjs", "package.json", "src", "GOAL.md"]) {
    assert.equal(isSecretFilename(name), false, `expected non-secret: ${name}`);
  }
});

test("isSecretPath catches secrets at any depth", () => {
  assert.equal(isSecretPath(".env"), true);
  assert.equal(isSecretPath("config/.env.local"), true);
  assert.equal(isSecretPath("infra/secrets/db.txt"), true);
  assert.equal(isSecretPath("certs/server.pem"), true);
  assert.equal(isSecretPath(".ssh/id_ed25519"), true);
  assert.equal(isSecretPath("home/.aws/credentials"), true);
  assert.equal(isSecretPath("src/app.ts"), false);
  assert.equal(isSecretPath("docs/GOAL.md"), false);
  assert.equal(isSecretPath(""), false);
});

test("isNoisePath flags build/dependency dirs but not source", () => {
  assert.equal(isNoisePath("node_modules/foo/index.js"), true);
  assert.equal(isNoisePath("dist/bundle.js"), true);
  assert.equal(isNoisePath("DerivedData/x"), true);
  assert.equal(isNoisePath("src/app.ts"), false);
});

test("redactSecrets masks token-shaped content with stable ids", () => {
  assert.match(redactSecrets(`token = '${githubToken}'`), /‹redacted:github-token›/);
  assert.match(redactSecrets(`key=${anthropicKey}`), /‹redacted:anthropic-key›/);
  assert.match(redactSecrets(`OPENAI='${openaiToken}'`), /‹redacted:/);
  assert.match(redactSecrets(`aws ${awsKey}`), /‹redacted:aws-access-key›/);
  assert.match(redactSecrets(`g ${googleKey}`), /‹redacted:google-api-key›/);
  // the raw secret must not survive
  assert.doesNotMatch(redactSecrets(`token = '${githubToken}'`), new RegExp(githubToken));
});

test("redactSecrets masks env-style and assignment secrets", () => {
  const envLine = `OPENAI_API_KEY='${openaiToken}'`;
  const redacted = redactSecrets(envLine);
  assert.match(redacted, /‹redacted:/);
  assert.doesNotMatch(redacted, new RegExp(openaiToken));

  const clientSecret = `client_secret=${"f".repeat(20)}`;
  assert.match(redactSecrets(clientSecret), /‹redacted:client-secret›/);
});

test("redactSecrets leaves innocuous text untouched and is null-safe", () => {
  const clean = "이 프로젝트는 macOS 메뉴바 AI 어시스턴트입니다. README 기준.";
  assert.equal(redactSecrets(clean), clean);
  assert.equal(redactSecrets(""), "");
  assert.equal(redactSecrets(null), "");
  assert.equal(redactSecrets(undefined), "");
});

test("containsSecret detects without mutating", () => {
  assert.equal(containsSecret(`x ${awsKey}`), true);
  assert.equal(containsSecret("no secrets here"), false);
  // repeated calls stay correct (global regex lastIndex reset)
  assert.equal(containsSecret(`x ${awsKey}`), true);
  assert.equal(containsSecret(`x ${awsKey}`), true);
});
