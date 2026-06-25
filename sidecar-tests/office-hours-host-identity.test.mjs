// The host identity + HMAC key authority must: mint stable install/project ids,
// scope projectId per canonical workspace, keep the keyring OUTSIDE the workspace at
// 0600, compose with the receipt verifier (a receipt signed by the active key
// verifies against the resolved keyring), and fail closed on a corrupt store.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  resolveHostStoreDir,
  resolveHostIdentity,
  resolveEvidenceSigningKey,
  resolveEvidenceKeyring,
  HostIdentityError,
} from "../sidecar/office-hours-host-identity.mjs";
import { signEvidenceReceipt, verifyEvidenceReceipt } from "../sidecar/office-hours-evidence-receipt.mjs";

async function withTmpStore(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "a30-host-store-"));
  const prev = process.env.AGENTIC30_HOST_STORE_DIR;
  process.env.AGENTIC30_HOST_STORE_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.AGENTIC30_HOST_STORE_DIR;
    else process.env.AGENTIC30_HOST_STORE_DIR = prev;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("identity is stable across calls and scoped per workspace", async () => {
  await withTmpStore(async () => {
    const wsA = await fs.mkdtemp(path.join(os.tmpdir(), "a30-wsA-"));
    const wsB = await fs.mkdtemp(path.join(os.tmpdir(), "a30-wsB-"));
    try {
      const a1 = await resolveHostIdentity({ workspaceRoot: wsA });
      const a2 = await resolveHostIdentity({ workspaceRoot: wsA });
      const b1 = await resolveHostIdentity({ workspaceRoot: wsB });
      assert.equal(a1.projectId, a2.projectId, "same workspace → same projectId");
      assert.equal(a1.installActorId, a2.installActorId, "install actor is stable");
      assert.equal(a1.installActorId, b1.installActorId, "install actor is shared across workspaces");
      assert.notEqual(a1.projectId, b1.projectId, "different workspaces → different projectId");
    } finally {
      await fs.rm(wsA, { recursive: true, force: true });
      await fs.rm(wsB, { recursive: true, force: true });
    }
  });
});

test("keyring is stored OUTSIDE the workspace at 0600 with a 0700 parent", async () => {
  await withTmpStore(async (storeDir) => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "a30-ws-"));
    try {
      await resolveEvidenceSigningKey({ workspaceRoot: ws });
      const keyFile = path.join(resolveHostStoreDir(), "office-hours-evidence-keyring.json");
      assert.ok(keyFile.startsWith(storeDir), "keyring lives in the host store dir, not the workspace");
      assert.ok(!keyFile.startsWith(path.resolve(ws)), "keyring is NOT under the workspace");
      const st = await fs.stat(keyFile);
      assert.equal(st.mode & 0o777, 0o600, "keyring file is 0600");
      const dirSt = await fs.stat(storeDir);
      assert.equal(dirSt.mode & 0o700, 0o700, "host store dir is owner-accessible (0700)");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});

test("a receipt signed by the active key verifies against the resolved keyring", async () => {
  await withTmpStore(async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "a30-ws-"));
    try {
      const { installActorId, projectId } = await resolveHostIdentity({ workspaceRoot: ws });
      const { keyId, secret } = await resolveEvidenceSigningKey({ workspaceRoot: ws });
      const sha = "a".repeat(64);
      const token = signEvidenceReceipt({
        evidenceIdentity: `upload:${installActorId}:${sha}`,
        artifactId: "art_1",
        projectId,
        attemptId: "att_1",
        actorId: installActorId,
        evidenceContractId: "ec_1",
        sha256: sha,
        byteLength: 1234,
        declaredMediaType: "image/png",
        detectedMediaType: "image/png",
        contentValidation: "image_decode_succeeded",
        origin: "swift_upload",
        issuedAt: "2026-06-26T10:00:00.000Z",
        expiresAt: "2026-06-26T11:00:00.000Z",
        verifiedClaims: ["message.sent"],
      }, { secret, keyId });

      const { keyring } = await resolveEvidenceKeyring({ workspaceRoot: ws });
      const verified = verifyEvidenceReceipt(token, {
        keyring,
        attemptId: "att_1",
        actorId: installActorId,
        projectId,
        evidenceContractId: "ec_1",
        now: "2026-06-26T10:30:00.000Z",
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      });
      assert.equal(verified.ok, true, `signing key must verify against its own keyring: ${verified.rejection || ""}`);
      assert.equal(verified.trustTier, "artifact_backed");
      assert.equal(verified.maxGrade, "action_proof");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});

test("corrupt identity store fails closed (throws, never silently re-mints)", async () => {
  await withTmpStore(async (storeDir) => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "a30-ws-"));
    try {
      await resolveHostIdentity({ workspaceRoot: ws });
      const idFile = path.join(storeDir, "office-hours-host-identity.json");
      await fs.writeFile(idFile, "{ not json", "utf8");
      await assert.rejects(() => resolveHostIdentity({ workspaceRoot: ws }), (e) => e instanceof HostIdentityError);
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});
