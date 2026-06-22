import { appendProofLedgerEvent } from "./execution-os.mjs";
import {
  gradeCommitment,
  resolveCommitmentWithoutEvidence,
} from "./office-hours-memory.mjs";
import { buildProgramV2DailyCardContext } from "./program-v2-cards.mjs";
import { withSubmissionReceiptStoreLock } from "./program-v2-submit-store.mjs";

const HARD_EVIDENCE_KINDS = new Set(["url", "screenshot", "commit", "payment"]);
const DAILY_CARD_ACTIONS = new Set([
  "attach_evidence",
  "keep_open_today",
  "resolve_without_evidence",
  "replace_candidate",
]);

export async function handleOfficeHoursDailyCardSubmit({
  payload = {},
  workspaceRoot,
  appSupportPath = "",
  env = process.env,
  now = new Date(),
} = {}) {
  if (String(env?.AGENTIC30_ENABLE_PROGRAM_V2 || "").trim() !== "1") {
    throw codedError("ERR_PROGRAM_V2_DISABLED", "AGENTIC30_ENABLE_PROGRAM_V2=1 is required.");
  }
  const input = normalizeSubmission(payload);
  return submitWithReceiptLock({ input, workspaceRoot, appSupportPath, env, now });
}

function enforceSubmissionOrder({ card, context }) {
  if (card.type === "office_hours_state_transition") return;
  const staleCard = context.staleCandidate
    ? [...context.cardsById.values()].find((candidate) => candidate.type === "office_hours_state_transition")
    : null;
  if (staleCard) {
    throw codedError("ERR_OUT_OF_ORDER_DAILY_CARD_SUBMISSION", "Resolve the stale Office Hours state card before later daily cards.");
  }
}

async function applyDailyCardMutation({ input, workspaceRoot, commitment, now }) {
  if (input.action === "keep_open_today") return { skipReceipt: true };
  if (input.action === "attach_evidence") {
    const evidence = normalizeHardEvidence(input.evidenceRefs[0]);
    const [graded, proof] = await Promise.all([
      gradeCommitment({ workspaceRoot, commitmentId: input.sourceCommitmentId, evidence, gradedCycle: input.programDay, now }),
      appendProofLedgerEvent({
        workspaceRoot,
        now,
        event: {
          type: evidence.kind === "payment" ? "payment_record" : "action_evidence",
          status: "accepted",
          strength: "strong",
          day: input.programDay,
          actionId: input.sourceCommitmentId,
          evidenceType: evidence.kind === "url" ? "link" : evidence.kind,
          sourceUrl: evidence.sourceUrl,
          artifactPath: evidence.artifactPath,
          summary: evidence.note || commitment?.text || "Office Hours daily-card proof",
          metadata: { source: "office_hours_daily_card_submit" },
        },
      }),
    ]);
    return { memory: graded.memory, proofEvent: proof.event };
  }
  const reason = input.action === "replace_candidate" ? "replaced_by_next_candidate" : input.resolutionReason;
  return resolveCommitmentWithoutEvidence({
    workspaceRoot,
    commitmentId: input.sourceCommitmentId,
    reason,
    note: input.note,
    originText: input.originText,
    nextCommitment: input.replacementCandidate,
    cycle: input.programDay,
    day: input.programDay,
    now,
  });
}

function normalizeSubmission(payload) {
  const sourceCommitmentId = cleanString(payload.sourceCommitmentId ?? payload.source_commitment_id, 180);
  const cardId = cleanString(payload.cardId ?? payload.card_id, 180);
  const action = cleanToken(payload.action);
  const choiceId = cleanToken(payload.choiceId ?? payload.choice_id);
  const sourceStateVersion = cleanString(payload.sourceStateVersion ?? payload.source_state_version, 120);
  const cardGenerationId = cleanString(payload.cardGenerationId ?? payload.card_generation_id, 180);
  if (!cardId) throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", "office_hours_daily_card_submit requires cardId.");
  if (!cardGenerationId && !sourceStateVersion) {
    throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", "office_hours_daily_card_submit requires cardGenerationId or sourceStateVersion.");
  }
  if (!sourceCommitmentId) throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", "office_hours_daily_card_submit requires sourceCommitmentId.");
  if (!action) throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", "office_hours_daily_card_submit requires action.");
  if (!DAILY_CARD_ACTIONS.has(action)) {
    throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", `unknown daily-card submission action: ${action}`);
  }
  if (choiceId && choiceId !== action) {
    throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", "office_hours_daily_card_submit choiceId must match action.");
  }
  const evidenceRefs = Array.isArray(payload.evidenceRefs ?? payload.evidence_refs) ? (payload.evidenceRefs ?? payload.evidence_refs) : [];
  const input = {
    cardId,
    cardGenerationId,
    sourceStateVersion,
    cardType: cleanToken(payload.cardType ?? payload.card_type),
    sourceCommitmentId,
    action,
    resolutionReason: cleanToken(payload.resolutionReason ?? payload.resolution_reason ?? action),
    replacementCandidate: payload.replacementCandidate ?? payload.replacement_candidate ?? null,
    evidenceRefs,
    note: cleanString(payload.note, 500),
    originText: cleanString(payload.originText ?? payload.origin_text ?? payload.note ?? action, 500) || action,
    programDay: normalizeDay(payload.day ?? payload.programDay ?? payload.program_day) ?? 3,
  };
  input.canonicalBody = stableJson(input);
  input.key = `${cardId}:${sourceCommitmentId}`;
  return input;
}

function handleDuplicateSubmission({ duplicate, input }) {
  if (duplicate.canonicalBody === input.canonicalBody) return { ...duplicate.result, deduped: true };
  if (duplicate.action !== input.action) {
    throw codedError("ERR_COMMITMENT_ALREADY_RESOLVED", `Commitment ${input.sourceCommitmentId} is already resolved.`);
  }
  throw codedError("ERR_DUPLICATE_DAILY_CARD_SUBMISSION", "Daily card submission body differs from the recorded submission.");
}

function normalizeHardEvidence(ref = {}) {
  const kind = cleanToken(ref.kind ?? ref.evidenceKind ?? ref.evidence_kind);
  const locator = cleanString(
    ref.url
      ?? ref.locator
      ?? ref.sourceUrl
      ?? ref.source_url
      ?? ref.artifactPath
      ?? ref.artifact_path
      ?? ref.path
      ?? ref.reference
      ?? ref.ref
      ?? ref.externalRecordReference
      ?? ref.external_record_reference
      ?? ref.paymentRecordId
      ?? ref.payment_record_id
      ?? ref.commitSha
      ?? ref.commit_sha,
    500,
  );
  const note = cleanString(ref.note ?? ref.summary, 500);
  if (!HARD_EVIDENCE_KINDS.has(kind)) {
    throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", "attach_evidence requires a hard evidence ref.");
  }
  if (!locator) {
    if (kind === "payment") {
      throw codedError("ERR_SELF_REPORT_COUNTED_AS_PROOF", "payment proof requires a concrete payment record locator.");
    }
    throw codedError("ERR_MALFORMED_DAILY_CARD_SUBMISSION", "attach_evidence requires a concrete evidence locator.");
  }
  const sourceUrl = kind === "url" || /^https?:\/\//i.test(locator) ? locator : "";
  const artifactPath = sourceUrl ? "" : locator;
  return { kind, url: locator, sourceUrl, artifactPath, note };
}

function findCommitment(memory, commitmentId) {
  const commitment = (Array.isArray(memory?.commitments) ? memory.commitments : []).find((entry) => entry.id === commitmentId);
  if (!commitment) throw codedError("ERR_STALE_DAILY_CARD_SUBMISSION", `Unknown source commitment ${commitmentId}.`);
  return commitment;
}

function isCommitmentResolved(commitment) {
  return commitment?.status === "met"
    || commitment?.status === "abandoned"
    || commitment?.status === "resolved_without_evidence"
    || Boolean(commitment?.evidence);
}

async function submitWithReceiptLock({ input, workspaceRoot, appSupportPath, env, now }) {
  return withSubmissionReceiptStoreLock(workspaceRoot, async ({ current, writeStore }) => {
    const duplicate = current.submissions.find((entry) =>
      entry.key === input.key && !isKeepOpenAction(entry.action)
    );
    if (duplicate) return handleDuplicateSubmission({ duplicate, input });

    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: input.programDay,
      appSupportPath,
      env,
      now,
    });
    const card = context.cardsById.get(input.cardId);
    if (!card || (input.sourceStateVersion && card.sourceStateVersion !== input.sourceStateVersion)) {
      throw codedError("ERR_STALE_DAILY_CARD_SUBMISSION", "Daily card id or source state version is stale.");
    }
    if (input.cardGenerationId && card.generation?.generationId !== input.cardGenerationId) {
      throw codedError("ERR_STALE_DAILY_CARD_SUBMISSION", "Daily card generation is stale.");
    }
    enforceSubmissionOrder({ card, context });
    const commitment = findCommitment(context.memory, input.sourceCommitmentId);
    if (isCommitmentResolved(commitment)) {
      throw codedError("ERR_COMMITMENT_ALREADY_RESOLVED", `Commitment ${input.sourceCommitmentId} is already resolved.`);
    }
    validateResolutionNote(input);

    const mutation = await applyDailyCardMutation({ input, workspaceRoot, commitment, now });
    const result = {
      type: "office_hours_daily_card_submit_result",
      workspaceRoot,
      success: true,
      deduped: false,
      cardId: input.cardId,
      action: input.action,
      commitmentId: input.sourceCommitmentId,
      proofEventId: mutation.proofEvent?.id ?? null,
      replacementCommitmentId: mutation.replacement?.id ?? null,
    };
    if (mutation.skipReceipt === true) return result;
    await writeStore({
      ...current,
      updatedAt: now.toISOString(),
      submissions: [...current.submissions, {
        key: input.key,
        canonicalBody: input.canonicalBody,
        action: input.action,
        result,
        submittedAt: now.toISOString(),
      }],
    });
    return result;
  });
}

function validateResolutionNote(input) {
  if ((input.action === "resolve_without_evidence" || input.action === "replace_candidate") && !input.note) {
    throw codedError("ERR_RESOLUTION_NOTE_REQUIRED", "Non-evidence resolution requires an explanatory note.");
  }
}

function isKeepOpenAction(action) {
  return action === "keep_open_today";
}

function normalizeDay(value) {
  const day = Number.parseInt(value, 10);
  return Number.isInteger(day) && day >= 1 ? day : null;
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value, out = {}) {
  if (!value || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    out[key] = true;
    flattenKeys(child, out);
  }
  return out;
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
