// office-hours-artifact-registry.test.mjs — durable single-use + idempotency
// store. LIVE-free, deterministic; each test gets its own tmp workspace under
// os.tmpdir and cleans up.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ARTIFACT_REGISTRY_SCHEMA_VERSION,
  ARTIFACT_REGISTRY_ORIGINS,
  ArtifactRegistryError,
  resolveArtifactRegistryPath,
  deriveEvidenceIdentity,
  loadArtifactRegistry,
  registerArtifact,
  consumeArtifact,
  revokeEvidence,
} from "../sidecar/office-hours-artifact-registry.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

async function withWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oh-artifact-registry-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function readStore(root) {
  const filePath = resolveArtifactRegistryPath({ workspaceRoot: root });
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeRawStore(root, json) {
  const filePath = resolveArtifactRegistryPath({ workspaceRoot: root });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, json, "utf8");
}

const reg = (over = {}) => ({
  evidenceIdentity: "upload:actor_1:" + SHA_A,
  artifactId: "art_1",
  sha256: SHA_A,
  origin: "swift_upload",
  mediaType: "image/png",
  byteLength: 1234,
  ...over,
});

const consumeArgs = (over = {}) => ({
  evidenceIdentity: "upload:actor_1:" + SHA_A,
  attemptId: "att_1",
  evidenceContractId: "ec_1",
  eventId: "ev_1",
  sha256: SHA_A,
  origin: "swift_upload",
  ...over,
});

// ── deriveEvidenceIdentity ────────────────────────────────────────────────────

test("deriveEvidenceIdentity: swift_upload + url_snapshot use upload:actor:sha", () => {
  assert.equal(
    deriveEvidenceIdentity({ origin: "swift_upload", actorId: "actor_1", sha256: SHA_A }),
    `upload:actor_1:${SHA_A}`,
  );
  assert.equal(
    deriveEvidenceIdentity({ origin: "url_snapshot", actorId: "actor_2", sha256: SHA_B }),
    `upload:actor_2:${SHA_B}`,
  );
});

test("deriveEvidenceIdentity: provider_event uses provider:account:eventId", () => {
  assert.equal(
    deriveEvidenceIdentity({ origin: "provider_event", providerAccount: "acct_1", providerEventId: "pe_9" }),
    "provider:acct_1:pe_9",
  );
});

test("deriveEvidenceIdentity: recipient_callback uses callback:nonce", () => {
  assert.equal(
    deriveEvidenceIdentity({ origin: "recipient_callback", callbackNonce: "nonce_xyz" }),
    "callback:nonce_xyz",
  );
});

test("deriveEvidenceIdentity: fail-closed on missing inputs per origin", () => {
  // upload origins need actorId + sha256
  assert.throws(() => deriveEvidenceIdentity({ origin: "swift_upload", sha256: SHA_A }), ArtifactRegistryError);
  assert.throws(() => deriveEvidenceIdentity({ origin: "swift_upload", actorId: "a" }), ArtifactRegistryError);
  assert.throws(
    () => deriveEvidenceIdentity({ origin: "swift_upload", actorId: "a", sha256: "A".repeat(64) }),
    ArtifactRegistryError,
  ); // uppercase hex rejected
  // provider needs both account + eventId
  assert.throws(() => deriveEvidenceIdentity({ origin: "provider_event", providerAccount: "x" }), ArtifactRegistryError);
  // callback needs nonce
  assert.throws(() => deriveEvidenceIdentity({ origin: "recipient_callback" }), ArtifactRegistryError);
});

test("deriveEvidenceIdentity: unknown origin throws", () => {
  assert.throws(() => deriveEvidenceIdentity({ origin: "smtp_relay", actorId: "a", sha256: SHA_A }), ArtifactRegistryError);
  assert.throws(() => deriveEvidenceIdentity({}), ArtifactRegistryError);
});

// ── registerArtifact ──────────────────────────────────────────────────────────

test("registerArtifact: first register writes available registration durably", async () => {
  await withWorkspace(async (root) => {
    const res = await registerArtifact({ workspaceRoot: root }, reg());
    assert.equal(res.ok, true);
    assert.equal(res.idempotent, false);
    assert.equal(res.registration.status, "available");
    const store = await readStore(root);
    assert.equal(store.schemaVersion, ARTIFACT_REGISTRY_SCHEMA_VERSION);
    assert.equal(Object.keys(store.registrations).length, 1);
    assert.equal(store.registrations[reg().evidenceIdentity].artifactId, "art_1");
    assert.ok(Array.isArray(store.consumptions));
  });
});

test("registerArtifact: idempotent on same (artifactId, sha256)", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const res = await registerArtifact({ workspaceRoot: root }, reg());
    assert.equal(res.ok, true);
    assert.equal(res.idempotent, true);
    const store = await readStore(root);
    assert.equal(Object.keys(store.registrations).length, 1);
  });
});

test("registerArtifact: same identity, different artifactId → evidence_identity_conflict", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const res = await registerArtifact({ workspaceRoot: root }, reg({ artifactId: "art_DIFFERENT" }));
    assert.deepEqual(res, { ok: false, rejection: "evidence_identity_conflict" });
  });
});

test("registerArtifact: same identity, different sha256 → evidence_identity_conflict", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const res = await registerArtifact({ workspaceRoot: root }, reg({ sha256: SHA_B }));
    assert.deepEqual(res, { ok: false, rejection: "evidence_identity_conflict" });
  });
});

test("registerArtifact: validation throws on bad sha256 / byteLength / origin / missing fields", async () => {
  await withWorkspace(async (root) => {
    await assert.rejects(() => registerArtifact({ workspaceRoot: root }, reg({ sha256: "xyz" })), ArtifactRegistryError);
    await assert.rejects(() => registerArtifact({ workspaceRoot: root }, reg({ byteLength: 0 })), ArtifactRegistryError);
    await assert.rejects(() => registerArtifact({ workspaceRoot: root }, reg({ byteLength: 1.5 })), ArtifactRegistryError);
    await assert.rejects(() => registerArtifact({ workspaceRoot: root }, reg({ origin: "smtp_relay" })), ArtifactRegistryError);
    await assert.rejects(() => registerArtifact({ workspaceRoot: root }, reg({ evidenceIdentity: "" })), ArtifactRegistryError);
    await assert.rejects(() => registerArtifact({ workspaceRoot: root }, reg({ mediaType: "" })), ArtifactRegistryError);
    // no store should have been written by a throwing register
    await assert.rejects(() => readStore(root));
  });
});

// ── consumeArtifact ───────────────────────────────────────────────────────────

test("consumeArtifact: not_registered when no registration exists", async () => {
  await withWorkspace(async (root) => {
    const res = await consumeArtifact({ workspaceRoot: root }, consumeArgs());
    assert.deepEqual(res, { ok: false, rejection: "not_registered" });
  });
});

test("consumeArtifact: happy path appends one consumption", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const res = await consumeArtifact({ workspaceRoot: root }, consumeArgs());
    assert.equal(res.ok, true);
    assert.equal(res.idempotent, false);
    assert.equal(res.consumption.attemptId, "att_1");
    const store = await readStore(root);
    assert.equal(store.consumptions.length, 1);
  });
});

test("consumeArtifact: not_available after revoke", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const rev = await revokeEvidence({ workspaceRoot: root }, { evidenceIdentity: reg().evidenceIdentity, reason: "abuse" });
    assert.equal(rev.ok, true);
    const res = await consumeArtifact({ workspaceRoot: root }, consumeArgs());
    assert.deepEqual(res, { ok: false, rejection: "not_available" });
  });
});

test("consumeArtifact: metadata_mismatch on sha256 or origin divergence", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const shaRes = await consumeArtifact({ workspaceRoot: root }, consumeArgs({ sha256: SHA_B }));
    assert.deepEqual(shaRes, { ok: false, rejection: "metadata_mismatch" });
    const originRes = await consumeArtifact({ workspaceRoot: root }, consumeArgs({ origin: "url_snapshot" }));
    assert.deepEqual(originRes, { ok: false, rejection: "metadata_mismatch" });
  });
});

test("consumeArtifact: idempotent on identical (identity, attempt, contract, event) tuple", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const first = await consumeArtifact({ workspaceRoot: root }, consumeArgs());
    assert.equal(first.idempotent, false);
    const retry = await consumeArtifact({ workspaceRoot: root }, consumeArgs());
    assert.equal(retry.ok, true);
    assert.equal(retry.idempotent, true);
    assert.equal(retry.consumption.consumedAt, first.consumption.consumedAt);
    const store = await readStore(root);
    assert.equal(store.consumptions.length, 1, "no duplicate consumption appended on idempotent retry");
  });
});

test("consumeArtifact: artifact_reuse on different attempt", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    await consumeArtifact({ workspaceRoot: root }, consumeArgs({ attemptId: "att_1" }));
    const res = await consumeArtifact({ workspaceRoot: root }, consumeArgs({ attemptId: "att_2", eventId: "ev_2" }));
    assert.deepEqual(res, { ok: false, rejection: "artifact_reuse" });
    const store = await readStore(root);
    assert.equal(store.consumptions.length, 1);
  });
});

test("consumeArtifact: artifact_reuse on different contract", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    await consumeArtifact({ workspaceRoot: root }, consumeArgs({ evidenceContractId: "ec_1" }));
    const res = await consumeArtifact(
      { workspaceRoot: root },
      consumeArgs({ evidenceContractId: "ec_2", eventId: "ev_2" }),
    );
    assert.deepEqual(res, { ok: false, rejection: "artifact_reuse" });
    const store = await readStore(root);
    assert.equal(store.consumptions.length, 1);
  });
});

test("consumeArtifact: validation throws on bad inputs (infra failure, not a verdict)", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    await assert.rejects(() => consumeArtifact({ workspaceRoot: root }, consumeArgs({ sha256: "nope" })), ArtifactRegistryError);
    await assert.rejects(() => consumeArtifact({ workspaceRoot: root }, consumeArgs({ origin: "smtp_relay" })), ArtifactRegistryError);
    await assert.rejects(() => consumeArtifact({ workspaceRoot: root }, consumeArgs({ attemptId: "" })), ArtifactRegistryError);
  });
});

// ── Concurrency (the load-bearing requirement) ────────────────────────────────

test("two concurrent consumes for SAME identity, DIFFERENT attempts → exactly one success; store has 1 consumption", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    const [a, b] = await Promise.all([
      consumeArtifact({ workspaceRoot: root }, consumeArgs({ attemptId: "att_A", eventId: "ev_A" })),
      consumeArtifact({ workspaceRoot: root }, consumeArgs({ attemptId: "att_B", eventId: "ev_B" })),
    ]);
    const successes = [a, b].filter((r) => r.ok && r.idempotent === false);
    const reuses = [a, b].filter((r) => r.ok === false && r.rejection === "artifact_reuse");
    assert.equal(successes.length, 1, "exactly one consume succeeds");
    assert.equal(reuses.length, 1, "the other gets artifact_reuse");
    const store = await readStore(root);
    assert.equal(store.consumptions.length, 1, "durable store holds exactly one consumption for the identity");
  });
});

// ── Strict fail-closed loader ──────────────────────────────────────────────────

test("loadArtifactRegistry: absent file → empty store (not a throw)", async () => {
  await withWorkspace(async (root) => {
    const store = await loadArtifactRegistry({ workspaceRoot: root });
    assert.equal(store.schemaVersion, ARTIFACT_REGISTRY_SCHEMA_VERSION);
    assert.deepEqual(store.registrations, {});
    assert.deepEqual(store.consumptions, []);
  });
});

test("loadArtifactRegistry: corrupt JSON throws (never silently empty)", async () => {
  await withWorkspace(async (root) => {
    await writeRawStore(root, "{ this is not json");
    await assert.rejects(() => loadArtifactRegistry({ workspaceRoot: root }), ArtifactRegistryError);
  });
});

test("loadArtifactRegistry: schemaVersion mismatch throws", async () => {
  await withWorkspace(async (root) => {
    await writeRawStore(root, JSON.stringify({ schemaVersion: 99, registrations: {}, consumptions: [] }));
    await assert.rejects(() => loadArtifactRegistry({ workspaceRoot: root }), ArtifactRegistryError);
  });
});

test("loadArtifactRegistry: corrupt registration record throws (no fail-open coercion)", async () => {
  await withWorkspace(async (root) => {
    const key = "upload:a:" + SHA_A;
    await writeRawStore(
      root,
      JSON.stringify({
        schemaVersion: ARTIFACT_REGISTRY_SCHEMA_VERSION,
        registrations: {
          [key]: { evidenceIdentity: key, artifactId: "x", sha256: "bad", origin: "swift_upload", status: "available", byteLength: 1 },
        },
        consumptions: [],
      }),
    );
    await assert.rejects(() => loadArtifactRegistry({ workspaceRoot: root }), ArtifactRegistryError);
  });
});

test("loadArtifactRegistry: corrupt consumption record throws", async () => {
  await withWorkspace(async (root) => {
    await writeRawStore(
      root,
      JSON.stringify({
        schemaVersion: ARTIFACT_REGISTRY_SCHEMA_VERSION,
        registrations: {},
        consumptions: [{ evidenceIdentity: "x", attemptId: "", evidenceContractId: "ec", eventId: "ev" }],
      }),
    );
    await assert.rejects(() => loadArtifactRegistry({ workspaceRoot: root }), ArtifactRegistryError);
  });
});

// ── Append-only / revocation ───────────────────────────────────────────────────

test("revokeEvidence: append-only — registration revoked, consumptions never deleted", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    await consumeArtifact({ workspaceRoot: root }, consumeArgs());
    const before = await readStore(root);
    assert.equal(before.consumptions.length, 1);

    const rev = await revokeEvidence({ workspaceRoot: root }, { evidenceIdentity: reg().evidenceIdentity, reason: "fraud" });
    assert.equal(rev.ok, true);
    assert.equal(rev.registration.status, "revoked");

    const after = await readStore(root);
    assert.equal(after.registrations[reg().evidenceIdentity].status, "revoked");
    assert.equal(after.consumptions.length, 1, "revocation does NOT delete the consumption");
    assert.deepEqual(after.consumptions, before.consumptions);
  });
});

test("revokeEvidence: not_registered for unknown identity; idempotent on already-revoked", async () => {
  await withWorkspace(async (root) => {
    const miss = await revokeEvidence({ workspaceRoot: root }, { evidenceIdentity: "upload:ghost:" + SHA_A });
    assert.deepEqual(miss, { ok: false, rejection: "not_registered" });

    await registerArtifact({ workspaceRoot: root }, reg());
    await revokeEvidence({ workspaceRoot: root }, { evidenceIdentity: reg().evidenceIdentity });
    const again = await revokeEvidence({ workspaceRoot: root }, { evidenceIdentity: reg().evidenceIdentity });
    assert.equal(again.ok, true);
    assert.equal(again.idempotent, true);
  });
});

test("consumption count only grows across a register → consume → reuse → revoke lifecycle", async () => {
  await withWorkspace(async (root) => {
    await registerArtifact({ workspaceRoot: root }, reg());
    let counts = [];
    counts.push((await loadArtifactRegistry({ workspaceRoot: root })).consumptions.length); // 0
    await consumeArtifact({ workspaceRoot: root }, consumeArgs());
    counts.push((await loadArtifactRegistry({ workspaceRoot: root })).consumptions.length); // 1
    await consumeArtifact({ workspaceRoot: root }, consumeArgs()); // idempotent
    counts.push((await loadArtifactRegistry({ workspaceRoot: root })).consumptions.length); // 1
    await consumeArtifact({ workspaceRoot: root }, consumeArgs({ attemptId: "att_2", eventId: "ev_2" })); // reuse reject
    counts.push((await loadArtifactRegistry({ workspaceRoot: root })).consumptions.length); // 1
    await revokeEvidence({ workspaceRoot: root }, { evidenceIdentity: reg().evidenceIdentity });
    counts.push((await loadArtifactRegistry({ workspaceRoot: root })).consumptions.length); // 1
    assert.deepEqual(counts, [0, 1, 1, 1, 1]);
    // monotonic non-decreasing
    for (let i = 1; i < counts.length; i += 1) {
      assert.ok(counts[i] >= counts[i - 1], "consumption count never decreases");
    }
  });
});

// ── Surface sanity ─────────────────────────────────────────────────────────────

test("ARTIFACT_REGISTRY_ORIGINS is the allowlist used everywhere", () => {
  assert.deepEqual([...ARTIFACT_REGISTRY_ORIGINS].sort(), [
    "provider_event",
    "recipient_callback",
    "swift_upload",
    "url_snapshot",
  ]);
});
