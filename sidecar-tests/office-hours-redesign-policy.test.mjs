import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOfficeHoursDayClosePolicy,
  formatOfficeHoursDayClosePolicyForPrompt,
} from "../sidecar/office-hours-redesign-policy.mjs";

test("office hours redesign v1 policy keeps mandatory BIP target-only and manual candidate fallback", () => {
  const policy = buildOfficeHoursDayClosePolicy({
    day: 3,
    proofSink: "local",
    bipResearchSnapshot: {
      status: { state: "failed", reason: "not_loaded" },
      candidates: [
        {
          id: "ignored",
          title: "Stale candidate must not be used",
        },
      ],
    },
    unavailableSources: ["git", "posthog", "cloudflare"],
    marketRadar: { state: "ready", confidence: "weak", cardCount: 0 },
  });

  assert.equal(policy.role, "evidence_closing_operator");
  assert.deepEqual(policy.closeTypes, ["customer_evidence", "posted_url_target", "blocked", "carry"]);
  assert.equal(policy.mandatoryBip.state, "target_behavior");
  assert.equal(policy.mandatoryBip.autoPosting, false);
  assert.deepEqual(policy.mandatoryBip.allowedProofSinks, ["local", "bip_optional"]);
  assert.equal(policy.mandatoryBip.currentProofSink, "local");
  assert.equal(policy.bipResearchCandidatePolicy.state, "manual_fallback");
  assert.equal(policy.bipResearchCandidatePolicy.readyCacheRequired, true);
  assert.equal(policy.bipResearchCandidatePolicy.cachePath, ".agentic30/bip/research/day-3-cache.json");
  assert.equal(policy.bipResearchCandidatePolicy.candidateCount, 0);
  assert.equal(policy.bipResearchCandidatePolicy.fallbackAction, "manually_named_reachable_customer");
  assert.deepEqual(policy.evidenceSourcePolicy.unavailableSources, ["git", "posthog", "cloudflare"]);
  assert.equal(policy.evidenceSourcePolicy.marketRadarCardsAvailable, false);

  const promptBlock = formatOfficeHoursDayClosePolicyForPrompt(policy);
  assert.match(promptBlock, /OFFICE_HOURS_REDESIGN_V1_DAY_CLOSE_POLICY/);
  assert.match(promptBlock, /mandatory BIP.*target behavior/i);
  assert.match(promptBlock, /proofSink.*local\|bip_optional/);
  assert.match(promptBlock, /manual.*reachable customer/i);
  assert.doesNotMatch(promptBlock, /Stale candidate/);
});

test("office hours redesign v1 policy allows BIP research candidates only from a ready day cache", () => {
  const policy = buildOfficeHoursDayClosePolicy({
    day: 8,
    proofSink: "bip_optional",
    bipResearchSnapshot: {
      status: { state: "ready", reason: "manual" },
      candidates: [
        {
          id: "candidate-1",
          title: "Builder with sourced Threads post",
          sourceRefs: [{ url: "https://www.threads.net/@builder/post/1" }],
        },
      ],
    },
  });

  assert.equal(policy.bipResearchCandidatePolicy.state, "ready_cache");
  assert.equal(policy.bipResearchCandidatePolicy.cachePath, ".agentic30/bip/research/day-8-cache.json");
  assert.equal(policy.bipResearchCandidatePolicy.candidateCount, 1);
  assert.deepEqual(policy.bipResearchCandidatePolicy.candidateTitles, ["Builder with sourced Threads post"]);
  assert.equal(policy.bipResearchCandidatePolicy.fallbackAction, null);

  const promptBlock = formatOfficeHoursDayClosePolicyForPrompt(policy);
  assert.match(promptBlock, /ready \.agentic30\/bip\/research\/day-8-cache\.json/);
  assert.match(promptBlock, /Builder with sourced Threads post/);
  assert.match(promptBlock, /Do not invent/);
  assert.doesNotMatch(promptBlock, /fabricated candidate|발명한 후보/);
});
