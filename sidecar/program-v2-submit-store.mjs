import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";

const SUBMISSION_SCHEMA_VERSION = 1;

export async function withSubmissionReceiptStoreLock(workspaceRoot, callback) {
  const filePath = resolveSubmissionPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const current = await loadSubmissionStore(filePath);
    return callback({
      current,
      filePath,
      writeStore: (next) => atomicWriteJson(filePath, normalizeSubmissionStore(next)),
    });
  });
}

function resolveSubmissionPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "program-v2-daily-card-submissions.json");
}

async function loadSubmissionStore(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw codedError("ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT", `Daily card submission receipt store is unreadable: ${error.message}`);
    }
    return normalizeSubmissionStore({});
  }
  try {
    return validateSubmissionStore(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT") throw error;
    throw codedError("ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT", `Daily card submission receipt store is corrupt JSON: ${error.message}`);
  }
}

function normalizeSubmissionStore(value = {}) {
  return {
    schemaVersion: SUBMISSION_SCHEMA_VERSION,
    updatedAt: cleanString(value.updatedAt) || new Date(0).toISOString(),
    submissions: Array.isArray(value.submissions) ? value.submissions.slice(-200) : [],
  };
}

function validateSubmissionStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw corruptReceiptStore("Daily card submission receipt store must be an object.");
  }
  if (value.schemaVersion !== SUBMISSION_SCHEMA_VERSION) {
    throw corruptReceiptStore(`Daily card submission receipt store schemaVersion must be ${SUBMISSION_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(value.submissions)) {
    throw corruptReceiptStore("Daily card submission receipt store submissions must be an array.");
  }
  for (const [index, entry] of value.submissions.entries()) {
    validateSubmissionReceiptEntry(entry, index);
  }
  return {
    schemaVersion: value.schemaVersion,
    updatedAt: cleanString(value.updatedAt) || new Date(0).toISOString(),
    submissions: value.submissions.slice(-200),
  };
}

function validateSubmissionReceiptEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} must be an object.`);
  }
  if (!cleanString(entry.key, 240)) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} requires key.`);
  }
  if (!cleanString(entry.canonicalBody, 20_000)) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} requires canonicalBody.`);
  }
  assertCanonicalBody(entry.canonicalBody, index);
  if (!cleanToken(entry.action)) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} requires action.`);
  }
  if (!entry.result || typeof entry.result !== "object" || Array.isArray(entry.result)) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} requires result.`);
  }
  if (entry.result.type !== "office_hours_daily_card_submit_result" || entry.result.success !== true) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} has invalid result.`);
  }
  if (!cleanString(entry.submittedAt, 120)) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} requires submittedAt.`);
  }
}

function assertCanonicalBody(canonicalBody, index) {
  try {
    const parsedBody = JSON.parse(canonicalBody);
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      throw new Error("canonicalBody must decode to an object");
    }
  } catch (error) {
    throw corruptReceiptStore(`Daily card submission receipt entry ${index} has invalid canonicalBody: ${error.message}`);
  }
}

function cleanString(value = "", maxLength = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanToken(value = "") {
  return cleanString(value, 120).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function corruptReceiptStore(message) {
  return codedError("ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT", message);
}
