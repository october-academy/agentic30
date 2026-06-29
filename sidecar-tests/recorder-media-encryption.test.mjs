import test from "node:test";
import assert from "node:assert/strict";

import {
  RecorderMediaEncryptionError,
  createMemoryRecorderMediaKeyStore,
  decryptRecorderMediaBytes,
  encryptRecorderMediaBytes,
  loadOrCreateRecorderMediaKey,
  normalizeRecorderMediaEncryptionEnvelope,
} from "../sidecar/recorder-media-encryption.mjs";

test("recorder media encryption round-trips bytes with deterministic envelope metadata", () => {
  const key = Buffer.alloc(32, 7);
  const plaintext = Buffer.from("local recorder media bytes");
  const result = encryptRecorderMediaBytes(plaintext, {
    key,
    keyId: "test-key",
    randomBytes: () => Buffer.alloc(12, 9),
  });

  assert.notDeepEqual(result.ciphertext, plaintext);
  assert.equal(result.encryption.algorithm, "aes-256-gcm");
  assert.equal(result.encryption.keyId, "test-key");
  assert.equal(result.encryption.nonce, Buffer.alloc(12, 9).toString("base64"));
  assert.match(result.encryption.ciphertextSha256, /^sha256:[a-f0-9]{64}$/);

  const decrypted = decryptRecorderMediaBytes(result.ciphertext, {
    key,
    encryption: result.encryption,
  });
  assert.deepEqual(decrypted, plaintext);
});

test("recorder media encryption validates envelope hash and generated key persistence", () => {
  assert.throws(
    () => normalizeRecorderMediaEncryptionEnvelope({
      algorithm: "aes-256-gcm",
      keyId: "test-key",
      nonce: Buffer.alloc(12, 1).toString("base64"),
      tag: Buffer.alloc(16, 2).toString("base64"),
      ciphertextSha256: `sha256:${"a".repeat(64)}`,
    }, {
      expectedSha256: `sha256:${"b".repeat(64)}`,
    }),
    (error) => error instanceof RecorderMediaEncryptionError
      && error.code === "ERR_RECORDER_MEDIA_ENCRYPTION_HASH_MISMATCH",
  );

  const keyStore = createMemoryRecorderMediaKeyStore();
  const first = loadOrCreateRecorderMediaKey({
    keyStore,
    randomBytes: () => Buffer.alloc(32, 8),
  });
  const second = loadOrCreateRecorderMediaKey({
    keyStore,
    randomBytes: () => Buffer.alloc(32, 9),
  });
  assert.deepEqual(first, Buffer.alloc(32, 8));
  assert.deepEqual(second, first);
});
