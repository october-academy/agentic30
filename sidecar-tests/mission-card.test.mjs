import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MISSION_CARD_EVENT_TYPE,
  buildMissionCardEvent,
} from "../sidecar/mission-card.mjs";
import { evaluateProgramGates } from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

test("mission card loads the IDD mission for the day with evidence spec", () => {
  const card = buildMissionCardEvent({
    workspaceRoot: "/tmp/product",
    day: 9,
    now: T0,
  });

  assert.equal(card.type, MISSION_CARD_EVENT_TYPE);
  assert.equal(card.missionCard.day, 9);
  assert.equal(card.missionCard.source, "idd");
  assert.equal(card.missionCard.mission.shortTitle, "Input Flow");
  assert.equal(card.missionCard.mission.phase, "build");
  assert.ok(card.missionCard.mission.tasks.length >= 3);
  assert.equal(card.missionCard.mission.substituted, false);
  assert.equal(card.missionCard.evidenceSpec.evidenceRequired, true);
  assert.deepEqual(card.missionCard.evidenceSpec.allowedEvidenceTypes, ["link", "file"]);
  assert.equal(card.missionCard.evidenceSpec.minimumStrength, "medium");
});

test("education and review days require no evidence; out-of-range days return null", () => {
  const education = buildMissionCardEvent({ day: 10, now: T0 });
  assert.equal(education.missionCard.mission.dayType, "education");
  assert.equal(education.missionCard.evidenceSpec.evidenceRequired, false);
  assert.deepEqual(education.missionCard.evidenceSpec.allowedEvidenceTypes, []);

  const review = buildMissionCardEvent({ day: 14, now: T0 });
  assert.equal(review.missionCard.mission.dayType, "review");
  assert.equal(review.missionCard.evidenceSpec.evidenceRequired, false);

  assert.equal(buildMissionCardEvent({ day: 31, now: T0 }), null);
  assert.equal(buildMissionCardEvent({ day: 0, now: T0 }), null);
});

test("mission card carries milestone gate context", () => {
  const evaluation = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 8,
    now: T0,
  });
  const card = buildMissionCardEvent({
    day: 8,
    gateEvaluation: evaluation,
    now: T0,
  });

  assert.equal(card.missionCard.gateContext.blockingGateId, "G1");
  assert.equal(card.missionCard.gateContext.states.G2, "blocked");
  assert.equal(card.missionCard.gateContext.states.G4, "locked");
});

test("the latest gate-ledger substitution for the day overrides the full mission payload", () => {
  const card = buildMissionCardEvent({
    day: 15,
    substitutions: [
      {
        day: 15,
        failedGate: "G4",
        replacedMission: "오래된 ask 회복",
        exitCondition: "old condition",
        reason: "G4_failed",
        recordedAt: "2026-06-12T10:00:00.000Z",
      },
      {
        day: 16,
        failedGate: "G4",
        replacedMission: "first_value 계측 삽입",
        reason: "G4_failed",
        recordedAt: "2026-06-12T09:00:00.000Z",
      },
      {
        day: 15,
        failedGate: "G4",
        replacedMission: "유료 ask 재작성+발송",
        exitCondition: "paymentIntent strong ≥1 + first_value ≥1행",
        reason: "G4_failed",
        recordedAt: "2026-06-12T11:00:00.000Z",
      },
    ],
    now: T0,
  });

  assert.equal(card.missionCard.mission.substituted, true);
  assert.equal(card.missionCard.mission.title, "유료 ask 재작성+발송");
  assert.equal(card.missionCard.mission.shortTitle, "유료 ask 재작성+발송");
  assert.equal(card.missionCard.mission.substitutionReason, "G4_failed");
  assert.equal(card.missionCard.mission.exitCondition, "paymentIntent strong ≥1 + first_value ≥1행");
  assert.match(card.missionCard.mission.summary, /회복 미션/);
  assert.ok(card.missionCard.mission.tasks.some((task) => /종료 조건/.test(task)));
  assert.equal(card.missionCard.mission.output, "게이트 해제 증거: paymentIntent strong ≥1 + first_value ≥1행");
  assert.equal(card.missionCard.evidenceSpec.evidenceRequired, true);
  assert.equal(card.missionCard.evidenceSpec.artifact, "게이트 해제 증거: paymentIntent strong ≥1 + first_value ≥1행");
});
