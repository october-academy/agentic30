import { execFileSync as defaultExecFileSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes as cryptoRandomBytes,
} from "node:crypto";

export const RECORDER_MEDIA_ENCRYPTION_ALGORITHM = "aes-256-gcm";
export const RECORDER_MEDIA_KEY_BYTES = 32;
export const RECORDER_MEDIA_NONCE_BYTES = 12;
export const RECORDER_MEDIA_TAG_BYTES = 16;
export const DEFAULT_RECORDER_MEDIA_KEY_ID = "agentic30-recorder-media-v1";
export const DEFAULT_RECORDER_MEDIA_KEYCHAIN_SERVICE = "com.agentic30";
export const DEFAULT_RECORDER_MEDIA_KEYCHAIN_ACCOUNT = "com.agentic30.recorder-media-key-v1";

export class RecorderMediaEncryptionError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderMediaEncryptionError";
    this.code = code;
    this.details = details;
  }
}

export function encryptRecorderMediaBytes(input, {
  key,
  keyId = DEFAULT_RECORDER_MEDIA_KEY_ID,
  randomBytes = cryptoRandomBytes,
} = {}) {
  const normalizedKey = normalizeMediaKey(key);
  const cleanKeyId = requiredText(keyId, "key_id");
  const nonce = randomBytes(RECORDER_MEDIA_NONCE_BYTES);
  if (!Buffer.isBuffer(nonce) || nonce.length !== RECORDER_MEDIA_NONCE_BYTES) {
    fail("ERR_RECORDER_MEDIA_ENCRYPTION_INVALID_NONCE", "media encryption nonce generator returned invalid bytes", {
      expectedBytes: RECORDER_MEDIA_NONCE_BYTES,
      expected_bytes: RECORDER_MEDIA_NONCE_BYTES,
    });
  }
  const plaintext = Buffer.isBuffer(input) ? input : Buffer.from(input ?? "");
  const cipher = createCipheriv(RECORDER_MEDIA_ENCRYPTION_ALGORITHM, normalizedKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = mediaEncryptionEnvelope({
    keyId: cleanKeyId,
    nonce,
    tag,
    ciphertextSha256: `sha256:${sha256Hex(ciphertext)}`,
  });
  return {
    ciphertext,
    encryption: envelope,
    encryption_envelope: envelope,
  };
}

export function decryptRecorderMediaBytes(ciphertext, {
  key,
  encryption = null,
  envelope = null,
} = {}) {
  const input = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext ?? "");
  const normalizedKey = normalizeMediaKey(key);
  const normalizedEnvelope = normalizeRecorderMediaEncryptionEnvelope(encryption ?? envelope, {
    expectedSha256: `sha256:${sha256Hex(input)}`,
  });
  const decipher = createDecipheriv(
    RECORDER_MEDIA_ENCRYPTION_ALGORITHM,
    normalizedKey,
    Buffer.from(normalizedEnvelope.nonce, "base64"),
  );
  decipher.setAuthTag(Buffer.from(normalizedEnvelope.tag, "base64"));
  return Buffer.concat([decipher.update(input), decipher.final()]);
}

export function normalizeRecorderMediaEncryptionEnvelope(envelope = {}, {
  expectedSha256 = "",
  mediaKind = "media",
  fail: failCallback = fail,
} = {}) {
  const source = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope : null;
  if (!source) {
    return failWith(failCallback, "ERR_RECORDER_MEDIA_ENCRYPTION_ENVELOPE_REQUIRED", `${mediaKind} encrypted media requires encryption envelope metadata`, {
      mediaKind,
      media_kind: mediaKind,
    });
  }
  const algorithm = cleanString(source.algorithm ?? source.alg ?? source.encryptionAlg ?? source.encryption_alg).toLowerCase();
  if (algorithm !== RECORDER_MEDIA_ENCRYPTION_ALGORITHM) {
    return failWith(failCallback, "ERR_RECORDER_MEDIA_ENCRYPTION_UNSUPPORTED_ALGORITHM", `${mediaKind} encrypted media requires aes-256-gcm envelope`, {
      mediaKind,
      media_kind: mediaKind,
      algorithm: algorithm || "(missing)",
    });
  }
  const keyId = requiredEnvelopeText(source.keyId ?? source.key_id ?? source.encryptionKeyId ?? source.encryption_key_id, "key_id", failCallback, mediaKind);
  const nonce = requiredBase64Field(source.nonce, "nonce", RECORDER_MEDIA_NONCE_BYTES, failCallback, mediaKind);
  const tag = requiredBase64Field(source.tag, "tag", RECORDER_MEDIA_TAG_BYTES, failCallback, mediaKind);
  const ciphertextSha256 = normalizeSha256(
    source.ciphertextSha256 ?? source.ciphertext_sha256 ?? source.sha256,
    "ciphertext_sha256",
    failCallback,
    mediaKind,
  );
  const expected = expectedSha256 ? normalizeSha256(expectedSha256, "expected_sha256", failCallback, mediaKind) : "";
  if (expected && ciphertextSha256 !== expected) {
    return failWith(failCallback, "ERR_RECORDER_MEDIA_ENCRYPTION_HASH_MISMATCH", `${mediaKind} encrypted media envelope hash does not match media asset hash`, {
      mediaKind,
      media_kind: mediaKind,
      fieldName: "ciphertext_sha256",
      field_name: "ciphertext_sha256",
    });
  }
  return {
    algorithm,
    keyId,
    key_id: keyId,
    nonce,
    tag,
    ciphertextSha256,
    ciphertext_sha256: ciphertextSha256,
  };
}

export function createMacOSRecorderMediaKeyStore({
  execFileSync = defaultExecFileSync,
  service = DEFAULT_RECORDER_MEDIA_KEYCHAIN_SERVICE,
  account = DEFAULT_RECORDER_MEDIA_KEYCHAIN_ACCOUNT,
} = {}) {
  const cleanService = requiredText(service, "service");
  const cleanAccount = requiredText(account, "account");
  return {
    load() {
      try {
        const output = execFileSync("/usr/bin/security", [
          "find-generic-password",
          "-s", cleanService,
          "-a", cleanAccount,
          "-w",
        ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return decodeStoredMediaKey(output.trim());
      } catch (error) {
        if (isKeychainItemMissing(error)) return null;
        fail("ERR_RECORDER_MEDIA_KEYCHAIN_READ_FAILED", "failed to read recorder media key from macOS Keychain", {
          status: error?.status ?? null,
        });
      }
    },
    save(key) {
      const normalizedKey = normalizeMediaKey(key);
      try {
        execFileSync("/usr/bin/security", [
          "add-generic-password",
          "-s", cleanService,
          "-a", cleanAccount,
          "-w", normalizedKey.toString("base64"),
          "-U",
        ], { stdio: "ignore" });
      } catch (error) {
        fail("ERR_RECORDER_MEDIA_KEYCHAIN_WRITE_FAILED", "failed to write recorder media key to macOS Keychain", {
          status: error?.status ?? null,
        });
      }
      return true;
    },
  };
}

export function createMemoryRecorderMediaKeyStore(initialKey = null) {
  let storedKey = initialKey ? normalizeMediaKey(initialKey) : null;
  return {
    load() {
      return storedKey ? Buffer.from(storedKey) : null;
    },
    save(key) {
      storedKey = normalizeMediaKey(key);
      return true;
    },
  };
}

export function loadOrCreateRecorderMediaKey({
  keyStore = createMacOSRecorderMediaKeyStore(),
  randomBytes = cryptoRandomBytes,
} = {}) {
  const existing = keyStore.load();
  if (existing) return normalizeMediaKey(existing);
  const created = randomBytes(RECORDER_MEDIA_KEY_BYTES);
  const normalizedCreated = normalizeMediaKey(created);
  keyStore.save(normalizedCreated);
  return normalizedCreated;
}

export function loadRecorderMediaKey({
  keyStore = createMacOSRecorderMediaKeyStore(),
} = {}) {
  const existing = keyStore.load();
  if (!existing) {
    fail("ERR_RECORDER_MEDIA_KEY_UNAVAILABLE", "recorder media key is unavailable");
  }
  return normalizeMediaKey(existing);
}

function mediaEncryptionEnvelope({ keyId, nonce, tag, ciphertextSha256 }) {
  return {
    algorithm: RECORDER_MEDIA_ENCRYPTION_ALGORITHM,
    keyId,
    key_id: keyId,
    nonce: nonce.toString("base64"),
    tag: tag.toString("base64"),
    ciphertextSha256,
    ciphertext_sha256: ciphertextSha256,
  };
}

function normalizeMediaKey(value) {
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value ?? ""), "base64");
  if (key.length !== RECORDER_MEDIA_KEY_BYTES) {
    fail("ERR_RECORDER_MEDIA_KEY_INVALID", "recorder media encryption key must be 32 bytes", {
      expectedBytes: RECORDER_MEDIA_KEY_BYTES,
      expected_bytes: RECORDER_MEDIA_KEY_BYTES,
    });
  }
  return key;
}

function decodeStoredMediaKey(value) {
  return normalizeMediaKey(cleanString(value, 2000));
}

function requiredEnvelopeText(value, fieldName, failCallback, mediaKind) {
  const text = cleanString(value, 500);
  if (!text) {
    return failWith(failCallback, "ERR_RECORDER_MEDIA_ENCRYPTION_ENVELOPE_MISSING_FIELD", `${mediaKind} encryption envelope requires ${fieldName}`, {
      mediaKind,
      media_kind: mediaKind,
      fieldName,
      field_name: fieldName,
    });
  }
  return text;
}

function requiredBase64Field(value, fieldName, expectedBytes, failCallback, mediaKind) {
  const text = requiredEnvelopeText(value, fieldName, failCallback, mediaKind);
  let decoded;
  try {
    decoded = Buffer.from(text, "base64");
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length !== expectedBytes) {
    return failWith(failCallback, "ERR_RECORDER_MEDIA_ENCRYPTION_ENVELOPE_INVALID_BASE64", `${mediaKind} encryption envelope has invalid ${fieldName}`, {
      mediaKind,
      media_kind: mediaKind,
      fieldName,
      field_name: fieldName,
      expectedBytes,
      expected_bytes: expectedBytes,
    });
  }
  return text;
}

function normalizeSha256(value, fieldName, failCallback, mediaKind) {
  const text = requiredEnvelopeText(value, fieldName, failCallback, mediaKind);
  const normalized = text.startsWith("sha256:") ? text : `sha256:${text}`;
  if (!/^sha256:[a-f0-9]{64}$/i.test(normalized)) {
    return failWith(failCallback, "ERR_RECORDER_MEDIA_ENCRYPTION_ENVELOPE_INVALID_HASH", `${mediaKind} encryption envelope has invalid ${fieldName}`, {
      mediaKind,
      media_kind: mediaKind,
      fieldName,
      field_name: fieldName,
    });
  }
  return normalized.toLowerCase();
}

function isKeychainItemMissing(error) {
  const stderr = String(error?.stderr ?? "");
  return error?.status === 44 || /could not be found|item.*not found/i.test(stderr);
}

function requiredText(value, fieldName) {
  const text = cleanString(value, 1000);
  if (!text) fail("ERR_RECORDER_MEDIA_ENCRYPTION_MISSING_FIELD", `recorder media encryption requires ${fieldName}`, { fieldName });
  return text;
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function failWith(failCallback, code, message, details = {}) {
  if (typeof failCallback === "function" && failCallback !== fail) {
    return failCallback(code, message, details);
  }
  return fail(code, message, details);
}

function fail(code, message, details = {}) {
  throw new RecorderMediaEncryptionError(code, message, details);
}
