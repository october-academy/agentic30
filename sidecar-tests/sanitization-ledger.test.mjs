import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  SANITIZATION_LEDGER_SCHEMA_VERSION,
  LedgerEntrySchema,
  readLedger,
  persistLedgerToFile,
  appendLedgerEntry,
} from "../sidecar/sanitization-ledger.mjs";

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-ledger-"));
  return path.join(dir, "sanitization-ledger.json");
}

const VALID_HASH = "a".repeat(64);

function validEntry(overrides = {}) {
  return {
    schema_version: 1,
    created_at: "2026-05-07T20:00:00.000Z",
    source_kind: "wiki",
    source_ref: "wiki/2026-Q2",
    private_excerpt_hash: VALID_HASH,
    public_principle: "사용자 시간·돈 낭비 0 우선",
    public_location: "docs/SPEC.md#성공-기준",
    redaction_class: "strategy",
    reviewer: "zetta",
    ...overrides,
  };
}

test("schema version constant equals 1", () => {
  assert.equal(SANITIZATION_LEDGER_SCHEMA_VERSION, 1);
});

test("schema accepts valid entry", () => {
  const result = LedgerEntrySchema.safeParse(validEntry());
  assert.equal(result.success, true);
});

test("schema rejects non-hex hash", () => {
  const result = LedgerEntrySchema.safeParse(
    validEntry({ private_excerpt_hash: "not-a-hash" }),
  );
  assert.equal(result.success, false);
});

test("schema rejects too-short hash", () => {
  const result = LedgerEntrySchema.safeParse(
    validEntry({ private_excerpt_hash: "a".repeat(40) }),
  );
  assert.equal(result.success, false);
});

test("schema rejects unknown source_kind", () => {
  const result = LedgerEntrySchema.safeParse(
    validEntry({ source_kind: "novel-kind" }),
  );
  assert.equal(result.success, false);
});

test("schema rejects unknown redaction_class", () => {
  const result = LedgerEntrySchema.safeParse(
    validEntry({ redaction_class: "novel-class" }),
  );
  assert.equal(result.success, false);
});

test("schema rejects empty public_principle", () => {
  const result = LedgerEntrySchema.safeParse(
    validEntry({ public_principle: "" }),
  );
  assert.equal(result.success, false);
});

test("persist + read round-trip preserves entry shape", async () => {
  const filePath = await tempFile();
  await persistLedgerToFile(filePath, [validEntry()]);
  const loaded = await readLedger(filePath);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].source_kind, "wiki");
  assert.equal(loaded[0].redaction_class, "strategy");
});

test("appendLedgerEntry validates and appends", async () => {
  const filePath = await tempFile();
  await appendLedgerEntry(filePath, validEntry({ source_ref: "first" }));
  await appendLedgerEntry(filePath, validEntry({ source_ref: "second" }));
  const loaded = await readLedger(filePath);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map((e) => e.source_ref), ["first", "second"]);
});

test("appendLedgerEntry throws on invalid entry", async () => {
  const filePath = await tempFile();
  await assert.rejects(
    appendLedgerEntry(filePath, validEntry({ source_kind: "bogus" })),
    /invalid sanitization ledger entry/,
  );
});

test("readLedger returns [] for missing file", async () => {
  const filePath = path.join(os.tmpdir(), `agentic30-nonexistent-${Date.now()}.json`);
  const loaded = await readLedger(filePath);
  assert.deepEqual(loaded, []);
});

test("readLedger quarantines corrupt JSON", async () => {
  const filePath = await tempFile();
  await fs.writeFile(filePath, "{junk", { mode: 0o600 });
  const errors = [];
  const loaded = await readLedger(filePath, {
    onRecoverableError: (e) => errors.push(e),
  });
  assert.deepEqual(loaded, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].type, "sanitization_ledger_corrupt");
  assert.match(errors[0].quarantinePath, /\.corrupt-/);
});

test("schema accepts entry with pepper_version (output of hashPrivateExcerpt helper)", () => {
  // R3 / Codex HIGH: hash generation is centralized in `private-hash.mjs` and
  // its output includes a `pepperVersion`. The ledger entry must accept the
  // matching `pepper_version` field so callers can spread the helper's
  // output directly into the entry.
  const result = LedgerEntrySchema.safeParse(validEntry({ pepper_version: 1 }));
  assert.equal(result.success, true, JSON.stringify(result.error?.issues, null, 2));
  // Legacy entries without the field still pass.
  const legacy = LedgerEntrySchema.safeParse(validEntry());
  assert.equal(legacy.success, true);
});

test("file persisted with mode 0o600", async () => {
  const filePath = await tempFile();
  await persistLedgerToFile(filePath, [validEntry()]);
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
});
