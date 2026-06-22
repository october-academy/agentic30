import { createHash } from "node:crypto";

export function withProgramV2CardIdentity(card, context) {
  const sourceCommitmentId = card.sourceCommitmentId || card.commitmentId || context.staleCandidate?.commitmentId || "";
  const id = `daily-card-${hashJson({ type: card.type, day: context.programDay, sourceCommitmentId, sourceStateVersion: context.sourceStateVersion })}`;
  const generationId = `generation-${hashJson({ id, signalId: card.generation?.signalId, sourceStateVersion: context.sourceStateVersion })}`;
  return {
    ...card,
    id,
    sourceStateVersion: context.sourceStateVersion,
    source_state_version: context.sourceStateVersion,
    sourceCommitmentId,
    source_commitment_id: sourceCommitmentId,
    generation: { ...card.generation, generationId, generation_id: generationId },
  };
}

export function buildProgramV2SourceStateVersion({ memory, proofLedger, activeUsersStore, programDay, evaluation }) {
  return hashJson({
    memory: (memory.commitments ?? []).map((entry) => ({
      id: entry.id,
      status: entry.status,
      evidence: Boolean(entry.evidence),
      resolution: entry.resolution?.reason ?? "",
      carriedForwardTo: entry.carriedForwardTo ?? "",
    })),
    proof: (proofLedger.events ?? []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      status: entry.status,
      sourceUrl: entry.sourceUrl,
      artifactPath: entry.artifactPath,
    })),
    activeUsers: (activeUsersStore.snapshots ?? []).map((entry) => ({
      at: entry.at,
      count: entry.activeUserCount,
      event: entry.firstValueEventName,
    })),
    day: programDay,
    gateStates: Object.fromEntries(Object.entries(evaluation.gates ?? {}).map(([gateId, gate]) => [gateId, gate?.state ?? ""])),
  });
}

export function buildProgramV2Generation(signalId, signalLabel, context) {
  return { signalId, signalLabel, sourceStateVersion: context.sourceStateVersion };
}

export function hashProgramV2CardText(value) {
  return hashText(value);
}

function hashJson(value) {
  return hashText(stableJson(value));
}

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
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
