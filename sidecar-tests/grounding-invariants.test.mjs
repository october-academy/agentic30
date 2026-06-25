import test from "node:test";
import assert from "node:assert/strict";
import {
  computeGroundingInvariants,
  summarizeGroundingInvariants,
} from "../sidecar-evals/grounding-invariants.mjs";
import {
  classifyFirstCandidateCard,
  isGenericSourcingOptionLabel,
  isNoCandidateBlockerLabel,
  carriesSpecificIdentity,
} from "../sidecar/office-hours-first-candidate-grounding.mjs";

// ── Synthetic captures ───────────────────────────────────────────────────────
// A generic-only first_candidate card: 4 generic sourcing-category options, no
// free-text named capture, no grounded hints. This is the pre-fix failure mode.
const GENERIC_ONLY_CARD = {
  signalId: "get_users_first_candidate",
  header: "첫 후보",
  question: "이번 주에 첫 검증을 보낼 상대를 어디서 잡을까요?",
  allowFreeText: true,
  options: [
    { label: "최근 이 문제를 말한 지인" },
    { label: "소개를 요청할 경로" },
    { label: "비슷한 사람이 모인 커뮤니티" },
    { label: "아직 후보 없음" },
  ],
};

// A free-text-forcing card: the question + placeholder + primary option demand an
// exact 실명·핸들, plus exactly one explicit blocker. This is the host-authored
// canonical card shape (and what the tightened prompt should produce).
const FREE_TEXT_FORCING_CARD = {
  signalId: "get_users_first_candidate",
  header: "첫 후보 확정",
  question:
    "오늘 실제로 연락하거나 글을 올릴 수 있는 첫 사람의 실명·핸들, 또는 구체적 스레드·모임·채널을 한 곳만 적어 주세요.",
  freeTextPlaceholder: "예: 조은성(@handle) — 오늘 카톡으로 이 검증 30분 통화 요청",
  allowFreeText: true,
  requiresFreeText: false,
  options: [
    { label: "오늘 연락할 실명·핸들을 직접 적기" },
    { label: "아직 후보 없음 — 오늘은 이름 찾기부터" },
  ],
};

// A grounded-hints card: non-blocker options carry a candidateHintId (dormant
// hints-present branch). forces_specificity via grounded hints, not free text.
const GROUNDED_HINTS_CARD = {
  signalId: "get_users_first_candidate",
  header: "첫 후보 확정",
  question: "검증된 후보 중 누구에게 먼저 보낼까요?",
  allowFreeText: true,
  requiresFreeText: false,
  options: [
    { label: "검증된 후보 A", candidateHintId: "hint-001" },
    { label: "검증된 후보 B", candidateHintId: "hint-002" },
    { label: "아직 후보 없음" },
  ],
};

function captureWith(cards, extra = {}) {
  return { days: [{ day: 1, questions: cards }], verifiedCandidateHintsInjected: false, ...extra };
}

// ── shared matcher unit tests ────────────────────────────────────────────────
test("isGenericSourcingOptionLabel flags generic buckets, not named candidates or blockers", () => {
  assert.equal(isGenericSourcingOptionLabel("최근 이 문제를 말한 지인"), true);
  assert.equal(isGenericSourcingOptionLabel("소개를 요청할 경로"), true);
  assert.equal(isGenericSourcingOptionLabel("비슷한 사람이 모인 커뮤니티"), true);
  assert.equal(isGenericSourcingOptionLabel("Threads 채널에서 찾기"), true);
  // A named/handle-bearing label is never generic.
  assert.equal(isGenericSourcingOptionLabel("조은성 (@joeunseong)"), false);
  assert.equal(isGenericSourcingOptionLabel("오늘 연락할 실명·핸들을 직접 적기"), false);
  // A blocker is never generic.
  assert.equal(isGenericSourcingOptionLabel("아직 후보 없음"), false);
  assert.equal(isGenericSourcingOptionLabel(""), false);
});

test("isNoCandidateBlockerLabel + carriesSpecificIdentity behave deterministically", () => {
  assert.equal(isNoCandidateBlockerLabel("아직 후보 없음"), true);
  assert.equal(isNoCandidateBlockerLabel("아직 후보 없음 — 오늘은 이름 찾기부터"), true);
  assert.equal(isNoCandidateBlockerLabel("최근 이 문제를 말한 지인"), false);
  assert.equal(carriesSpecificIdentity("조은성 (@joeunseong)"), true);
  assert.equal(carriesSpecificIdentity("오늘 연락할 실명·핸들을 직접 적기"), true);
  assert.equal(carriesSpecificIdentity("비슷한 사람이 모인 커뮤니티"), false);
});

test("classifyFirstCandidateCard: generic-only card", () => {
  const c = classifyFirstCandidateCard(GENERIC_ONLY_CARD);
  assert.equal(c.genericOnly, true);
  assert.equal(c.forcesSpecificity, false);
  assert.equal(c.blockerCount, 1);
  assert.equal(c.nonBlockerCount, 3);
  assert.equal(c.genericNonBlockerCount, 3);
  assert.equal(c.groundedHintCount, 0);
});

test("classifyFirstCandidateCard: free-text-forcing card", () => {
  const c = classifyFirstCandidateCard(FREE_TEXT_FORCING_CARD);
  assert.equal(c.genericOnly, false);
  assert.equal(c.forcesSpecificity, true);
  assert.equal(c.blockerCount, 1);
});

test("classifyFirstCandidateCard: grounded-hints card", () => {
  const c = classifyFirstCandidateCard(GROUNDED_HINTS_CARD);
  assert.equal(c.genericOnly, false);
  assert.equal(c.forcesSpecificity, true);
  assert.equal(c.groundedHintCount, 2);
  assert.equal(c.blockerCount, 1);
});

// ── computeGroundingInvariants ───────────────────────────────────────────────
test("generic-only card → first_candidate_generic_only TRUE, forces_specificity FALSE", () => {
  const inv = computeGroundingInvariants(captureWith([GENERIC_ONLY_CARD]));
  assert.equal(inv.first_candidate_present, true);
  assert.equal(inv.first_candidate_generic_only, true);
  assert.equal(inv.first_candidate_forces_specificity, false);
  assert.equal(inv.first_candidate_has_blocker, true);
});

test("free-text + single-blocker card → forces_specificity TRUE & generic_only FALSE", () => {
  const inv = computeGroundingInvariants(captureWith([FREE_TEXT_FORCING_CARD]));
  assert.equal(inv.first_candidate_present, true);
  assert.equal(inv.first_candidate_generic_only, false);
  assert.equal(inv.first_candidate_forces_specificity, true);
  assert.equal(inv.first_candidate_has_blocker, true);
});

test("grounded-hints card → forces_specificity TRUE via candidateHintId & generic_only FALSE", () => {
  const inv = computeGroundingInvariants(captureWith([GROUNDED_HINTS_CARD]));
  assert.equal(inv.first_candidate_generic_only, false);
  assert.equal(inv.first_candidate_forces_specificity, true);
});

test("no first_candidate card → first_candidate_present FALSE, others default safe", () => {
  const inv = computeGroundingInvariants(captureWith([
    { signalId: "get_users_active_user_definition", options: [{ label: "x" }, { label: "y" }] },
  ]));
  assert.equal(inv.first_candidate_present, false);
  assert.equal(inv.first_candidate_generic_only, false);
  assert.equal(inv.first_candidate_forces_specificity, false);
});

test("thin context with no fabricated names → thin_context_no_fabricated_names TRUE", () => {
  const inv = computeGroundingInvariants(captureWith([FREE_TEXT_FORCING_CARD]));
  assert.equal(inv.thin_context_no_fabricated_names, true);
});

test("thin context with a fabricated @handle as a real candidate → flag FALSE", () => {
  const fabricated = {
    signalId: "get_users_first_candidate",
    header: "첫 후보",
    question: "후보를 고르세요",
    allowFreeText: true,
    options: [
      { label: "김철수 @kim_invented", description: "워크스페이스에서 본 후보" },
      { label: "아직 후보 없음" },
    ],
  };
  const inv = computeGroundingInvariants(captureWith([fabricated]));
  assert.equal(inv.thin_context_no_fabricated_names, false);
});

test("hints injected disables the fabricated-name check (only thin context enforces it)", () => {
  const fabricated = {
    signalId: "get_users_first_candidate",
    question: "후보를 고르세요",
    allowFreeText: true,
    options: [
      { label: "검증된 후보 @verified", candidateHintId: "hint-1" },
      { label: "아직 후보 없음" },
    ],
  };
  const inv = computeGroundingInvariants(captureWith([fabricated], { verifiedCandidateHintsInjected: true }));
  assert.equal(inv.thin_context_no_fabricated_names, true);
});

test("candidate_ref_consistency_4_6: candidate token referenced in cards 4-6 → high rate", () => {
  const firstCandidate = {
    signalId: "get_users_first_candidate",
    header: "첫 후보 확정",
    question: "오늘 연락할 실명·핸들을 적어 주세요",
    freeTextPlaceholder: "예: 조은성(@joeunseong)",
    allowFreeText: true,
    options: [
      { label: "조은성 (@joeunseong)" },
      { label: "아직 후보 없음" },
    ],
  };
  const todayRequest = {
    signalId: "get_users_today_request",
    header: "오늘 요청",
    question: "조은성 (@joeunseong)에게 오늘 무엇을 보낼까요?",
    allowFreeText: true,
    options: [{ label: "조은성 (@joeunseong)에게 30분 통화 요청" }, { label: "막힘" }],
  };
  const commitment = {
    signalId: "get_users_day1_commitment",
    header: "오늘 약속",
    question: "조은성 (@joeunseong)에게 보낼 요청을 약속으로",
    allowFreeText: true,
    options: [{ label: "오늘 18시까지 조은성 (@joeunseong)에게 발송" }, { label: "막힘" }],
  };
  const inv = computeGroundingInvariants(captureWith([firstCandidate, todayRequest, commitment]));
  assert.equal(inv._detail.candidateToken, "조은성 (@joeunseong)");
  assert.equal(inv.candidate_ref_consistency_4_6, 1);
});

test("candidate_ref_consistency_4_6: candidate reintroduced generically → low rate", () => {
  const firstCandidate = {
    signalId: "get_users_first_candidate",
    question: "오늘 연락할 실명·핸들을 적어 주세요",
    freeTextPlaceholder: "예: 조은성(@joeunseong)",
    allowFreeText: true,
    options: [{ label: "조은성 (@joeunseong)" }, { label: "아직 후보 없음" }],
  };
  const todayRequest = {
    signalId: "get_users_today_request",
    question: "고객 후보에게 오늘 무엇을 보낼까요?",
    allowFreeText: true,
    options: [{ label: "비슷한 사람에게 요청" }, { label: "막힘" }],
  };
  const inv = computeGroundingInvariants(captureWith([firstCandidate, todayRequest]));
  assert.equal(inv.candidate_ref_consistency_4_6, 0);
});

test("summarizeGroundingInvariants rolls up booleans across projects", () => {
  const a = computeGroundingInvariants(captureWith([FREE_TEXT_FORCING_CARD]));
  const b = computeGroundingInvariants(captureWith([GROUNDED_HINTS_CARD]));
  const summary = summarizeGroundingInvariants([
    { label: "p1", invariants: a },
    { label: "p2", invariants: b },
  ]);
  assert.equal(summary.projectCount, 2);
  assert.equal(summary.first_candidate_forces_specificity_all, true);
  assert.equal(summary.first_candidate_generic_only_any, false);
  assert.equal(summary.first_candidate_has_blocker_all, true);
});

test("summarizeGroundingInvariants flags a regression when any project is generic-only", () => {
  const good = computeGroundingInvariants(captureWith([FREE_TEXT_FORCING_CARD]));
  const bad = computeGroundingInvariants(captureWith([GENERIC_ONLY_CARD]));
  const summary = summarizeGroundingInvariants([
    { label: "p1", invariants: good },
    { label: "p2", invariants: bad },
  ]);
  assert.equal(summary.first_candidate_generic_only_any, true);
  assert.equal(summary.first_candidate_forces_specificity_all, false);
});

test("office_hours_-prefixed signalId is recognized as the first_candidate slot", () => {
  const prefixed = { ...FREE_TEXT_FORCING_CARD, signalId: "office_hours_get_users_first_candidate" };
  const inv = computeGroundingInvariants(captureWith([prefixed]));
  assert.equal(inv.first_candidate_present, true);
  assert.equal(inv.first_candidate_forces_specificity, true);
});
