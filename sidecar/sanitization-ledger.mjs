import fs from "node:fs/promises";
import { z } from "zod";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";

export const SANITIZATION_LEDGER_SCHEMA_VERSION = 1;

export const LedgerEntrySchema = z.object({
  schema_version: z
    .literal(SANITIZATION_LEDGER_SCHEMA_VERSION)
    .default(SANITIZATION_LEDGER_SCHEMA_VERSION),
  created_at: z.string().datetime({ offset: true }),
  source_kind: z.enum([
    "wiki",
    "issue",
    "soul",
    "mandalart",
    "founder-note",
    "transcript",
  ]),
  source_ref: z.string().min(1),
  private_excerpt_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "must be SHA-256 hex (64 lowercase hex chars)"),
  // Optional. Set by `hashPrivateExcerpt()` (sidecar/private-hash.mjs) so the
  // ledger can be migrated forward when the pepper rotates. Absent for legacy
  // entries written before the helper was introduced.
  pepper_version: z.number().int().min(1).optional(),
  public_principle: z.string().min(1).max(2000),
  public_location: z.string().min(1),
  redaction_class: z.enum([
    "names",
    "metrics",
    "strategy",
    "founder-voice",
    "other",
  ]),
  reviewer: z.string().min(1),
  notes: z.string().max(4000).optional(),
});

export const LedgerPayloadSchema = z.object({
  schemaVersion: z.literal(SANITIZATION_LEDGER_SCHEMA_VERSION),
  savedAt: z.string().datetime({ offset: true }),
  entries: z.array(LedgerEntrySchema),
});

export async function readLedger(
  filePath,
  { onRecoverableError = null, now = () => new Date() } = {},
) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.entries)
        ? parsed.entries
        : [];
    return entries
      .map((entry) => LedgerEntrySchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
  } catch (error) {
    const quarantinePath = await quarantineCorrupt(filePath, raw, now);
    onRecoverableError?.({
      type: "sanitization_ledger_corrupt",
      filePath,
      quarantinePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function persistLedgerToFile(
  filePath,
  entries,
  { now = () => new Date() } = {},
) {
  const payload = {
    schemaVersion: SANITIZATION_LEDGER_SCHEMA_VERSION,
    savedAt: now().toISOString(),
    entries,
  };
  await atomicWriteJson(filePath, payload);
}

export async function appendLedgerEntry(filePath, entry, opts = {}) {
  const result = LedgerEntrySchema.safeParse(entry);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid sanitization ledger entry: ${issues}`);
  }
  return withFileLock(filePath, async () => {
    const existing = await readLedger(filePath, opts);
    await persistLedgerToFile(filePath, [...existing, result.data], opts);
    return result.data;
  });
}

async function quarantineCorrupt(filePath, raw, now) {
  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${filePath}.corrupt-${timestamp}`;
  try {
    await fs.rename(filePath, quarantinePath);
  } catch {
    await fs.writeFile(quarantinePath, raw, { mode: 0o600 });
    await fs.unlink(filePath).catch(() => {});
  }
  await fs.chmod(quarantinePath, 0o600).catch(() => {});
  return quarantinePath;
}
