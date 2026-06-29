import { normalizeRecorderMediaEncryptionEnvelope } from "./recorder-media-encryption.mjs";

const BACKGROUND_CAPTURE_MODES = new Set([
  "automatic",
  "auto",
  "background",
  "always_on",
  "event_driven",
  "scheduled",
]);

const BACKGROUND_TRIGGER_TOKENS = [
  "auto",
  "automatic",
  "background",
  "always_on",
  "scheduled",
  "event_driven",
  "recorder_auto",
  "recorder_background",
];

export function assertRawMediaEncryptionPolicy({
  mediaKind = "media",
  encrypted = false,
  encryption = null,
  mediaSha256 = "",
  captureMode = "",
  captureTrigger = "",
  fail = null,
} = {}) {
  if (typeof fail !== "function") {
    throw new Error("ERR_RECORDER_MEDIA_POLICY_FAIL_REQUIRED: assertRawMediaEncryptionPolicy requires fail callback");
  }
  const mode = normalizeToken(captureMode);
  const trigger = normalizeToken(captureTrigger);
  const backgroundLike = BACKGROUND_CAPTURE_MODES.has(mode)
    || (!mode && BACKGROUND_TRIGGER_TOKENS.some((token) => trigger === token || trigger.startsWith(`${token}_`)));
  const encryptedFlag = encrypted === true || encrypted === 1;
  if (encryptedFlag) {
    return normalizeRecorderMediaEncryptionEnvelope(encryption, {
      expectedSha256: mediaSha256,
      mediaKind,
      fail,
    });
  }
  if (!backgroundLike) return null;
  fail(
    "ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED",
    `${mediaKind} background raw media capture requires encryption at rest before persistence`,
    {
      mediaKind,
      media_kind: mediaKind,
      captureMode: mode || "inferred_from_trigger",
      capture_mode: mode || "inferred_from_trigger",
      captureTrigger: trigger,
      capture_trigger: trigger,
      encrypted: false,
      requiredBy: "raw_media_protection",
      required_by: "raw_media_protection",
    },
  );
}

export function normalizeMediaCaptureMode(value = "") {
  const mode = normalizeToken(value);
  return BACKGROUND_CAPTURE_MODES.has(mode) || mode === "manual" ? mode : "";
}

function normalizeToken(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
