import {
  RecorderProofAdapterError,
  buildRecorderProofCandidateVerifierRejection,
  writeRecorderProofCandidateToLedger,
} from "./recorder-proof-ledger-adapter.mjs";

export const RECORDER_EVIDENCE_CANDIDATE_SCHEMA_VERSION = 1;

export class RecorderEvidenceCandidateError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderEvidenceCandidateError";
    this.code = code;
    this.details = details;
  }
}

export function insertRecorderEvidenceCandidate(store, candidate = {}) {
  const now = new Date().toISOString();
  const row = {
    id: requiredText(candidate.id ?? candidate.candidateId ?? candidate.candidate_id, "id"),
    workspace_id: textOrNull(candidate.workspaceId ?? candidate.workspace_id),
    project_id: textOrNull(candidate.projectId ?? candidate.project_id),
    candidate_status: requiredText(candidate.candidateStatus ?? candidate.candidate_status, "candidate_status"),
    source_state: requiredText(candidate.sourceState ?? candidate.source_state, "source_state"),
    claim: requiredText(candidate.claim, "claim"),
    proof_kind: requiredText(candidate.proofKind ?? candidate.proof_kind, "proof_kind"),
    source_ids_json: jsonText(candidate.sourceIds ?? candidate.source_ids ?? candidate.source_ids_json ?? []),
    proof_ledger_mapping_json: jsonText(candidate.proofLedgerMapping ?? candidate.proof_ledger_mapping ?? candidate.proof_ledger_mapping_json ?? {}),
    evidence_debt_json: jsonText(candidate.evidenceDebt ?? candidate.evidence_debt ?? candidate.evidence_debt_json ?? []),
    immutable_fingerprint: requiredText(candidate.immutableFingerprint ?? candidate.immutable_fingerprint, "immutable_fingerprint"),
    idempotency_key: requiredText(candidate.idempotencyKey ?? candidate.idempotency_key, "idempotency_key"),
    verifier_result_json: textOrNull(candidate.verifierResultJson ?? candidate.verifier_result_json),
    proof_ledger_event_id: textOrNull(candidate.proofLedgerEventId ?? candidate.proof_ledger_event_id),
    created_by: requiredText(candidate.createdBy ?? candidate.created_by ?? "evidence-inbox-builder", "created_by"),
    created_at: textOrNull(candidate.createdAt ?? candidate.created_at) || now,
    reviewed_at: textOrNull(candidate.reviewedAt ?? candidate.reviewed_at),
    deleted_at: textOrNull(candidate.deletedAt ?? candidate.deleted_at),
  };
  store.insertRecord("evidence_candidates", row);
  return row;
}

export async function writeEvidenceCandidateThroughProofLedger({
  store,
  workspaceRoot,
  candidateId,
  now = new Date(),
  append,
} = {}) {
  if (!store) {
    fail("ERR_RECORDER_EVIDENCE_STORE_REQUIRED", "writeEvidenceCandidateThroughProofLedger requires store");
  }
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    fail("ERR_RECORDER_EVIDENCE_WORKSPACE_REQUIRED", "writeEvidenceCandidateThroughProofLedger requires workspaceRoot");
  }
  const row = store.getRecord("evidence_candidates", candidateId);
  if (!row) {
    fail("ERR_RECORDER_EVIDENCE_CANDIDATE_NOT_FOUND", `evidence candidate not found: ${candidateId || "(missing)"}`);
  }
  if (String(row.candidate_status ?? "").trim() === "written_to_ledger") {
    return {
      status: "written_to_ledger",
      idempotent: true,
      candidate: row,
      proofLedgerEventId: row.proof_ledger_event_id || "",
      proof_ledger_event_id: row.proof_ledger_event_id || "",
    };
  }
  try {
    const result = await writeRecorderProofCandidateToLedger({
      workspaceRoot,
      candidate: evidenceCandidateRowToAdapterCandidate(row),
      existingCandidates: store.listRecords("evidence_candidates"),
      now,
      append,
    });
    // The ledger append above is async file I/O and can yield the event loop.
    // A concurrent retention sweep or consent-revocation delete may have
    // rejected/tombstoned this same candidate while we were awaiting it. The
    // ledger event is already durably appended (append-only, cannot be
    // retracted), but we must not clobber the deletion's protective state by
    // blindly resetting candidate_status back to "written_to_ledger".
    const latest = store.getRecord("evidence_candidates", row.id);
    if (!latest || latest.deleted_at) {
      return {
        status: "written_to_ledger_candidate_deleted",
        candidate: latest,
        proofLedgerResult: result,
        proof_ledger_result: result,
      };
    }
    const reviewedAt = toIso(now);
    const verifierResult = {
      status: "written_to_ledger",
      proofLedgerEventId: result.proofLedgerEventId,
      proof_ledger_event_id: result.proofLedgerEventId,
      deduped: result.deduped === true,
      reviewedAt,
      reviewed_at: reviewedAt,
    };
    store.updateRecord("evidence_candidates", row.id, {
      candidate_status: "written_to_ledger",
      proof_ledger_event_id: result.proofLedgerEventId,
      reviewed_at: reviewedAt,
      verifier_result_json: JSON.stringify(verifierResult),
    });
    return {
      status: "written_to_ledger",
      candidate: store.getRecord("evidence_candidates", row.id),
      proofLedgerResult: result,
      proof_ledger_result: result,
    };
  } catch (error) {
    if (!(error instanceof RecorderProofAdapterError)) throw error;
    const rejection = buildRecorderProofCandidateVerifierRejection(error, { now });
    store.updateRecord("evidence_candidates", row.id, {
      candidate_status: rejection.candidate_status,
      reviewed_at: rejection.reviewed_at,
      verifier_result_json: rejection.verifier_result_json,
    });
    return {
      status: "verifier_rejected",
      candidate: store.getRecord("evidence_candidates", row.id),
      error,
      verifierResult: rejection.verifierResult,
      verifier_result: rejection.verifierResult,
    };
  }
}

export function evidenceCandidateRowToAdapterCandidate(row = {}) {
  if (!row?.id) {
    fail("ERR_RECORDER_EVIDENCE_MALFORMED_ROW", "evidence candidate row requires id");
  }
  return {
    id: row.id,
    candidateStatus: row.candidate_status,
    sourceState: row.source_state,
    claim: row.claim,
    proofKind: row.proof_kind,
    sourceIds: parseJson(row.source_ids_json, []),
    proofLedgerMapping: parseJson(row.proof_ledger_mapping_json, {}),
    evidenceDebt: parseJson(row.evidence_debt_json, []),
    immutableFingerprint: row.immutable_fingerprint,
    idempotencyKey: row.idempotency_key,
  };
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function jsonText(value) {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value ?? null);
}

function requiredText(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) {
    fail("ERR_RECORDER_EVIDENCE_MISSING_FIELD", `evidence candidate requires ${fieldName}`, { fieldName });
  }
  return text;
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderEvidenceCandidateError(code, message, details);
}
