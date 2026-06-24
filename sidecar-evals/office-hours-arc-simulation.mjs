#!/usr/bin/env node
/**
 * Office Hours Day-arc simulation.
 *
 * dogfood-simulation.mjs replays isolated single-touchpoint scenarios. This
 * harness instead drives the *continuous* office-hours arc through the real
 * sidecar: onboarding structured-input handshake -> office_hours_start
 * forcing-question loop -> day_progress commit -> next-day adaptation -> gate
 * authority. It answers as a configurable ICP persona so the run exercises the
 * specificity ladder, avoidance ("costume") naming, and the day-entry gates.
 *
 * Modes (same posture as the dogfood evaluator):
 *   - stub (default): AGENTIC30_TEST_STUB_PROVIDER=1, deterministic, CI-safe.
 *     Provider text is stubbed; the structured-input flow and the day-progress
 *     gates (provider-independent ledger checks) still run for real.
 *   - live: AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1, real provider. Captures the
 *     actual forcing questions and adaptation.
 *
 * Artifacts land under sidecar-evals/.artifacts/ (gitignored). Nothing here
 * touches dogfood-simulation.mjs — it is a composable sibling.
 *
 * Pure exports (personas, plan, response selection, run summary) are unit-tested
 * in sidecar-tests/office-hours-arc-simulation.test.mjs; the sidecar-spawning
 * runner is exercised via `npm run sim:office-hours[:live]`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { projectDocPath } from "../sidecar/project-doc-paths.mjs";
import { appendActiveUserSnapshot } from "../sidecar/active-users-snapshot.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_DEFAULT = process.env.AGENTIC30_RUN_LIVE_PROVIDER_EVAL === "1";

/**
 * Persona answer scripts. Each answer is consumed in order as the session asks
 * structured inputs (onboarding questions first, then office-hours forcing
 * questions). The default persona is the canonical ICP: a full-time solo macOS
 * developer with zero revenue, deliberately routed through an avoidance turn so
 * the run probes whether office-hours names the "costume" (VALUES #3) and climbs
 * the specificity ladder (ICP fit).
 */
export const OFFICE_HOURS_ARC_PERSONAS = Object.freeze({
  "icp-solo-dev": {
    id: "icp-solo-dev",
    label: "전업 1인 개발자 (0매출·macOS·Codex)",
    mode: "startup",
    description:
      "ICP 정합 페르소나. polite interest만 있는 상태(증거 0)에서 시작해, 실명 제시 → 정직한 0 자백 → 코드 회피 → 회피 수용 후 구체 커밋으로 진단력을 자극한다.",
    // 답변 슬롯은 Day 1~8 연속 office-hours 루프 전체를 덮을 만큼 늘려 둔다.
    // selectStructuredResponse는 turnIndex가 길이를 넘으면 마지막 답변으로
    // 고정(clamp)하므로, 슬롯이 모자라도 안전하다(빈약 stub 답변 = 기능 손상 아님).
    answers: Object.freeze([
      "나는 퇴사한 전업 1인 개발자예요. macOS에서 Codex로 SaaS 사이드프로젝트를 만들고 있고 아직 수익은 0원이에요.",
      '아직 결제나 계약은 없어요. 지인 몇 명이 "오 괜찮네요" 했지만 돈 얘기는 안 나왔어요. 가격을 물어본 사람은 1명 있었어요.',
      "조은성이라는 1인 개발자요. 클로드 코드로 사이드 프로젝트 만드는 분이고 아직 수익은 없어요.",
      "그분은 지금 노션에 혼자 TODO 적으면서 해요. 최근 2주에 이 문제로 쓴 돈은... 솔직히 0원이에요.",
      "오늘 뭘 보내야 할지 잘 모르겠어요. 일단 온보딩 코드를 좀 더 다듬고 데모를 멋지게 만든 다음에 보여주는 게 낫지 않을까요?",
      '맞아요, 또 코드로 도망쳤네요. 오늘 조은성에게 카톡으로 "이 검증 문제로 30분만 통화 가능하냐"고 보낼게요. 캡처 남길게요.',
      "유료 대안 source를 찾아봤어요: 비슷한 SaaS 3개를 노션 표에 가격이랑 같이 정리했어요.",
      "조은성에게 Mom Test 질문으로 접촉했어요. 과거에 이 문제로 뭘 시도했는지 물었고 답장 캡처 남겼어요.",
      "SPEC에서 가장 약한 섹션은 활성화 흐름이에요. 고객이 첫 가치까지 가는 경로가 비어 있어요.",
      "돈 낼 후보는 조은성 1명으로 좁혔고, 비슷한 도구에 월 2만원 쓴다는 숫자 출처를 확인했어요.",
      "가격·받을 결과·기한을 넣은 유료 ask 초안을 만들어 조은성에게 보냈어요. 보낸 캡처 있어요.",
      "7일차 결정: 약한 증거지만 continue 하기로 했어요. supporting과 counter 증거를 둘 다 연결했어요.",
      "네, 그걸로 오늘 마무리할게요.",
      "네, 그걸로 오늘 마무리할게요.",
    ]),
    commitment: Object.freeze({
      customer: "조은성",
      channel: "kakao",
      message: "이 검증 문제로 30분 통화 가능?",
      expectedEvidenceKind: "screenshot",
      text: "조은성에게 카톡으로 이 검증 문제 30분 통화 요청 + 캡처",
    }),
  },
  "builder-side-project": {
    id: "builder-side-project",
    label: "빌더 모드 (사이드프로젝트·학습)",
    mode: "builder",
    description: "builder intent 페르소나. 수익보다 공개 산출물/학습 증거 루프를 따른다.",
    answers: Object.freeze([
      "주말마다 만드는 사이드프로젝트예요. 매출보다는 공개하고 배우는 게 목표예요.",
      "아직 사용자는 없어요. 깃허브에 올렸지만 반응은 못 봤어요.",
      "오늘은 핵심 화면 하나를 공개하고 반응을 보려고 해요.",
      "Threads에 데모 1개 올리고 링크를 남길게요.",
      "네, 그걸로 마무리할게요.",
    ]),
    commitment: Object.freeze({
      customer: "공개 채널 관찰자",
      channel: "threads",
      message: "데모 1개 공개 + 반응 관찰",
      expectedEvidenceKind: "url",
      text: "Threads에 데모 공개하고 공개 URL 남기기",
    }),
  },
  // Domain-matched persona for a Buddhist mindfulness app project (e.g. dongdong).
  // The default icp-solo-dev persona answers "조은성 개발자", which mismatches a
  // non-developer product and makes the judge penalize the cards as off-ICP even
  // when they adapt correctly. This persona answers in the project's own domain so
  // the measurement reflects real card→customer fit rather than a persona mismatch.
  "mindfulness-app": {
    id: "mindfulness-app",
    label: "마음챙김/불교 앱 창업자 (0매출)",
    mode: "startup",
    description: "비개발 도메인 페르소나. 불교·마음챙김 앱의 실제 고객(2030 직장인)으로 답해 카드가 도메인에 적응하는지 측정한다.",
    answers: Object.freeze([
      "명상이나 불경 콘텐츠를 한 번 끝까지 완료하고 다음 날 다시 앱을 연 사람만 활성 사용자로 세요.",
      "아직 결제는 없어요. 불교에 관심 있는 30대 직장인 지인 몇 명이 \"써보고 싶다\" 했지만 돈 얘기는 없었어요.",
      "불교에 관심 있는 30대 직장인 지인 한 명이요. 최근 명상 앱을 찾던 친구예요.",
      "그 친구는 지금 유튜브 명상 영상이나 종이 불경을 봐요. 이 문제로 쓴 돈은 0원이에요.",
      "오늘 뭘 보낼지 모르겠어요. 일단 명상 콘텐츠를 더 다듬고 보여주는 게 낫지 않을까요?",
      "맞아요, 또 콘텐츠로 도망쳤네요. 오늘 그 친구에게 베타 앱으로 명상 1회 해보고 느낌을 말해달라고 카톡 보낼게요. 캡처 남길게요.",
      "비슷한 명상 앱 3개를 노션 표에 가격이랑 정리했어요.",
      "그 친구에게 Mom Test 질문으로 접촉했어요. 과거에 마음챙김을 어떻게 시도했는지 물었고 답장 캡처 남겼어요.",
      "가장 약한 부분은 첫 명상까지 가는 온보딩 흐름이에요.",
      "돈 낼 후보는 그 친구 1명으로 좁혔고, 비슷한 앱에 월 9900원 쓴다는 숫자를 확인했어요.",
      "가격·받을 결과·기한을 넣은 유료 베타 제안을 그 친구에게 보냈어요. 보낸 캡처 있어요.",
      "7일차 결정: 약한 증거지만 continue 하기로 했어요. supporting과 counter 증거를 둘 다 연결했어요.",
      "네, 그걸로 오늘 마무리할게요.",
      "네, 그걸로 오늘 마무리할게요.",
    ]),
    commitment: Object.freeze({
      customer: "마음챙김에 관심 있는 30대 직장인 지인",
      channel: "kakao",
      message: "베타 앱으로 명상 1회 해보고 느낌 알려줄 수 있어?",
      expectedEvidenceKind: "screenshot",
      text: "지인에게 카톡으로 베타 명상 1회 요청 + 사용 캡처",
    }),
  },
});

/**
 * Strong proof-ledger events that open the G2 Foundation gate. Submitted via the
 * `proof_ledger_append` route (handleProofLedgerAppend) — the same provider-
 * independent contract the gate engine reads. G2 needs all three conditions
 * (program-gate-engine.mjs evaluateProgramGates):
 *   1. interview strong evidence ≥1 (accepted|verified)
 *   2. foundation closure status=closed → requires a completed Day 7 day_decision
 *      PLUS one strong supporting AND one strong counter evidence (execution-os.mjs
 *      evaluateFoundationClosure)
 *   3. Day 7 dayDecision recorded (continue/pivot/stop/restart, completed)
 * `verified` status auto-infers strength=strong (execution-os inferProofStrength).
 */
export const G2_FOUNDATION_EVIDENCE = Object.freeze([
  Object.freeze({
    type: "interview", status: "verified", day: 3, polarity: "supporting",
    title: "조은성 Mom Test 인터뷰", summary: "과거 행동 질문 인터뷰 + 응답 캡처 (strong supporting)",
  }),
  Object.freeze({
    type: "action_evidence", status: "verified", day: 6, polarity: "counter",
    title: "반증 증거: 현재 대안 만족", summary: "후보가 현 대안에 큰 불만 없음을 인정 (strong counter)",
  }),
  Object.freeze({
    type: "day_decision", status: "verified", day: 7, decision: "continue",
    title: "Day 7 foundation 결정", summary: "약한 증거지만 continue 결정, supporting+counter 연결",
    refs: ["interview-day3", "counter-day6"],
  }),
]);

/**
 * Strong proof-ledger events + a first_value snapshot that open the Day 15 G4
 * gate ("유료 ask + 계측"). G4 needs (program-gate-engine.mjs):
 *   1. paid_ask_strong_evidence — payment_intent, strong/verified (a MANUAL proof,
 *      so its absence is a genuine hard block, not a §21 source-unavailable skip)
 *   2. first_value_observed — a PostHog HogQL row. In stub the live source is
 *      unavailable, so we seed a persisted active-user snapshot directly in the
 *      workspace (active-users-snapshot.mjs latestFirstValueSignal reads it),
 *      which the gate engine maps to `{ observed:true, rowCount }`.
 * The first_value snapshot is carried on the step as `firstValueSnapshot` and
 * written to <ws>/.agentic30/metrics/active-users.json before the probe.
 */
export const G4_PAID_ASK_EVIDENCE = Object.freeze([
  Object.freeze({
    type: "payment_intent", status: "verified", day: 14, customer: "조은성", channel: "kakao",
    title: "유료 ask 발송", summary: "가격·결과·기한이 있는 유료 ask 발송 + 캡처 (strong)",
  }),
]);
export const G4_FIRST_VALUE_SNAPSHOT = Object.freeze({
  day: 14, activeUserCount: 2, firstValueEventName: "first_value",
});

/**
 * Default Day-arc plan — extended to meaningfully cover Day 1~30. The product's
 * real gate structure forbids walking 30 days straight: the Day 8 G2 Foundation
 * gate blocks Day 8+ entry without evidence (provider-independent, asserted
 * deterministically). So the arc is shaped to respect that structure and to
 * exercise TWO real gate transitions end-to-end in stub:
 *   (a) Day 1~7  — office-hours forcing-question loop + commits (foundation phase)
 *   (b) Day 8    — probe the G2 block with NO evidence (expectGateBlock:"G2")
 *   (c) submit foundation closure evidence (submitEvidence) to open G2
 *   (d) Day 8    — re-probe; the gate now passes (expectGatePass:"G2")
 *   (e) Day 15   — probe the next milestone gate G4 still blocks (expectGateBlock:"G4")
 *   (f) submit paid-ask + first_value evidence to open G4
 *   (g) Day 15   — re-probe; G4 now passes (expectGatePass:"G4")
 *
 * Note on stub source-dependent gates: G5 (traffic) / G7 (final decision) sit
 * behind auto-collected sources that are unavailable in stub, so they enter the
 * §21 provisional overlay and do not HARD-block a patch. The arc therefore
 * probes G2 and G4 — the two gates whose blocking conditions include a manual
 * proof — as the deterministic milestone contract; reaching Day 15 still proves
 * the late-program gate chain (G4 enforceDay=15) is wired and reachable.
 *
 * Step schema (all fields additive; absent = no-op, original behavior preserved):
 *   day               program day this step drives (required)
 *   runOfficeHours    run the office_hours_start forcing-question loop
 *   maxTurns          turn cap for the office-hours loop
 *   commit            close the day via a first_interview day_progress_patch commit
 *   commitStep        stepId used for an expectGateBlock / expectGatePass patch probe
 *   expectGateBlock   gateId expected to BLOCK a day_progress_patch at this day
 *   expectGatePass    gateId expected to be OPEN (patch not blocked) at this day
 *   submitEvidence    array of proof-ledger events to append (proof_ledger_append) before probing
 *   firstValueSnapshot active-user snapshot to seed (opens first_value-dependent gates)
 *   label             human-readable phase note (report only)
 */
export const DEFAULT_ARC_PLAN = Object.freeze([
  { day: 1, runOfficeHours: true, maxTurns: 6, commit: true, expectGateBlock: null, label: "ICP/문제 정렬 + 첫 커밋" },
  { day: 2, runOfficeHours: true, maxTurns: 3, commit: true, expectGateBlock: null, label: "demand source 확인" },
  { day: 3, runOfficeHours: true, maxTurns: 3, commit: true, expectGateBlock: null, label: "Mom Test 접촉" },
  { day: 4, runOfficeHours: true, maxTurns: 3, commit: true, expectGateBlock: null, label: "wedge 정리" },
  { day: 5, runOfficeHours: true, maxTurns: 3, commit: true, expectGateBlock: null, label: "demand signal" },
  { day: 6, runOfficeHours: true, maxTurns: 3, commit: true, expectGateBlock: null, label: "paid ask 초안/발송" },
  { day: 7, runOfficeHours: true, maxTurns: 3, commit: true, expectGateBlock: null, label: "foundation decision (G2 준비)" },
  // (b) Day 8 entry blocked by G2 — no foundation evidence submitted yet.
  { day: 8, runOfficeHours: false, commit: false, expectGateBlock: "G2", commitStep: "scan", label: "G2 차단 probe (증거 0)" },
  // (c) submit the three strong proofs that close foundation + satisfy G2.
  { day: 8, submitEvidence: G2_FOUNDATION_EVIDENCE, label: "G2 통과용 증거 제출 (인터뷰 strong + supporting/counter + Day7 결정)" },
  // (d) Day 8 entry now passes the (formerly blocking) G2 gate.
  { day: 8, runOfficeHours: false, commit: false, expectGatePass: "G2", commitStep: "scan", label: "G2 통과 확인 (증거 제출 후)" },
  // (e) follow-up gate: Day 15 entry blocked by G4 — no paid-ask evidence yet.
  { day: 15, runOfficeHours: false, commit: false, expectGateBlock: "G4", commitStep: "scan", label: "G4 차단 probe (유료 ask 미발송)" },
  // (f) submit paid-ask strong + seed first_value snapshot to open G4.
  { day: 15, submitEvidence: G4_PAID_ASK_EVIDENCE, firstValueSnapshot: G4_FIRST_VALUE_SNAPSHOT, label: "G4 통과용 증거 제출 (유료 ask strong + first_value 관측)" },
  // (g) Day 15 entry now passes the (formerly blocking) G4 gate.
  { day: 15, runOfficeHours: false, commit: false, expectGatePass: "G4", commitStep: "scan", label: "G4 통과 확인 (증거 제출 후)" },
]);

/**
 * Choose the structured-input response for one question. Pure + deterministic so
 * it can be unit-tested without a sidecar. Prefers a persona free-text answer
 * for the current turn; if the question is office-hours demand-evidence with the
 * fixed option set, picks the honest "no evidence yet" option to keep the ICP
 * (N=0) realistic instead of inflating polite interest.
 */
export function selectStructuredResponse({ question, persona, turnIndex }) {
  const answers = persona?.answers || [];
  const freeText = answers[Math.min(turnIndex, answers.length - 1)] || "";
  const q = question || {};
  const options = Array.isArray(q.options) ? q.options : [];
  const signalId = q.signalId || q.generation?.signalId || "";
  // Office Hours Q1 demand-evidence: honest "no evidence yet" is the realistic
  // ICP answer and the one that tests whether the product lowers polite interest.
  if (/demand_evidence/i.test(signalId) && options.length) {
    const honest = options.find((o) => /관심만|증거가 없|no evidence|아직/i.test(o.label || o.description || ""));
    return { selectedOptions: honest ? [honest.label] : [], freeText };
  }
  return { selectedOptions: [], freeText };
}

/**
 * Reduce a completed arc run into provider-independent smoke assertions. Used by
 * the runner's verdict and by tests. Gate-block behavior is the hard contract;
 * forcing-question capture is informational (stub may not emit real questions).
 */
export function summarizeArcRun(captured = {}) {
  const days = Array.isArray(captured.days) ? captured.days : [];
  const gate = captured.gate || {};
  const gateBlock = gate.gateBlocked || null;
  const forcingQuestions = days.reduce((sum, d) => sum + (d.questions?.length || 0), 0);
  // New requestId reusing a signalId already asked this day = product re-asked the
  // same forcing question (contact-fixation signal), distinct from a harness re-read.
  const repeatedForcingSignals = days.flatMap((d) => d.repeatedQuestionSignals || []);
  const onboardingDrained = Number(captured.onboardingAnswered || 0);
  const expectedGate = captured.expectedGateBlock || null;
  const gateBlockWorks = expectedGate
    ? Boolean(gateBlock && gateBlock.gateId === expectedGate)
    : true;
  // Day coverage: every day touched by an office-hours loop OR a gate probe, so
  // the verdict reports how far across the 1~30 arc the run actually reached.
  const gateHistory = Array.isArray(captured.gateHistory) ? captured.gateHistory : [];
  const daysCovered = [...new Set([
    ...days.map((d) => d.day),
    ...gateHistory.map((g) => g.day),
  ].filter((d) => Number.isFinite(d)))].sort((a, b) => a - b);
  const maxDayReached = daysCovered.length ? Math.max(...daysCovered) : 0;
  // Every recorded gate probe (block + pass) must have matched its expectation.
  const gateProbesPassed = gateHistory.every((g) => g.ok === true);
  const gatesBlocked = gateHistory.filter((g) => g.kind === "block" && g.ok).map((g) => g.expected);
  const gatesPassed = gateHistory.filter((g) => g.kind === "pass" && g.ok).map((g) => g.expected);
  return {
    onboardingDrained,
    forcingQuestionsCaptured: forcingQuestions,
    repeatedForcingSignals,
    contactFixationObserved: repeatedForcingSignals.length > 0,
    daysRun: days.length,
    daysCovered,
    maxDayReached,
    gateBlockExpected: expectedGate,
    gateBlockObserved: gateBlock?.gateId || null,
    gateBlockWorks,
    gateRequiredEvidence: (gateBlock?.requiredEvidence || []).map((e) => e.id || e.label || e),
    gateHistory,
    gatesBlocked,
    gatesPassed,
    gateProbesPassed,
    evidenceSubmissions: Array.isArray(captured.evidenceSubmissions) ? captured.evidenceSubmissions.length : 0,
    errors: captured.errors || [],
    passed: gateBlockWorks && gateProbesPassed && (captured.errors || []).length === 0,
  };
}

// ── WS plumbing (self-contained; mirrors dogfood-simulation.mjs patterns) ──────

function readSidecarReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for sidecar ready")), 15_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (parsed.type === "sidecar-ready" && Number.isFinite(parsed.port) && parsed.authToken) {
          clearTimeout(timer);
          resolve(parsed);
        }
      }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Sidecar exited before ready: ${code}`)); });
  });
}
const onceOpen = (ws) => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
async function waitForEventAfter(events, offset, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.slice(offset).find(predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}
const latestSession = (events, sid) => [...events].reverse().find((e) => e.session?.id === sid)?.session;
const finalAssistants = (s) => (s?.messages ?? []).filter((m) => m.role === "assistant" && m.state === "final");

/** Pull the current pending structured-input request for a session, if any. */
function pendingInputFor(events, sessionId) {
  const sess = latestSession(events, sessionId);
  return sess?.pendingUserInput || null;
}

// ── Fixture: an onboarding-complete ICP workspace ─────────────────────────────

async function seedWorkspace(persona) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "a30-oh-arc-"));
  const docsDir = path.dirname(path.join(root, projectDocPath("icp")));
  await fs.mkdir(docsDir, { recursive: true });
  for (const type of ["icp", "values", "goal", "spec"]) {
    const rel = projectDocPath(type);
    const src = path.join(packageRoot, "docs", path.basename(rel));
    try { await fs.copyFile(src, path.join(root, rel)); } catch { /* docs optional */ }
  }
  // Approved IDD foundation so office-hours starts past onboarding setup.
  const iddDir = path.join(root, ".agentic30", "idd");
  await fs.mkdir(iddDir, { recursive: true });
  const now = new Date().toISOString();
  await fs.writeFile(path.join(iddDir, "setup-state.json"), JSON.stringify({
    schemaVersion: 1, status: "approved", currentDocType: "spec",
    docOrder: ["icp", "goal", "values", "spec"],
    transcript: [{ at: now, role: "system", docType: "spec", content: "arc-sim seed" }],
    ambiguityScore: 12, unresolvedAssumptions: [], drafts: {},
    approvedAt: now,
    approvedDocPaths: ["icp", "goal", "values", "spec"].map((t) => projectDocPath(t)),
    lastProvider: "codex", providerRecovery: null, updatedAt: now,
  }, null, 2));
  await fs.mkdir(path.join(root, "transcripts"), { recursive: true });
  await fs.writeFile(path.join(root, "transcripts", "interview-1.md"),
    "# 인터뷰\n고객: 에이전트 코딩으로 여러 제품을 만들었지만 매출 0. 무엇을 팔지 모름. 인터뷰는 해보겠다고 함.");
  await fs.writeFile(path.join(root, "README.md"), `# ${persona.label}\nmacOS 1인 개발 프로젝트.`);
  // git source readiness for the daily digest gate.
  try {
    const g = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    g(["init"]); g(["config", "user.email", "sim@test.local"]); g(["config", "user.name", "arc-sim"]);
    g(["add", "-A"]); g(["commit", "-m", "seed"]);
  } catch { /* git optional */ }
  return root;
}

async function writeBipConfig(appSupportPath, root) {
  await fs.mkdir(appSupportPath, { recursive: true });
  await fs.writeFile(path.join(appSupportPath, "bip-config.json"), JSON.stringify({
    workspace: {
      root,
      icp: projectDocPath("icp"), values: projectDocPath("values"),
      goal: projectDocPath("goal"), spec: projectDocPath("spec"),
      designSystem: "", adr: "", docs: "", sheet: "",
    },
    externalDocs: { googleDocs: [], googleSheets: [], notion: [] },
    social: { threads: "october", x: "" },
  }, null, 2));
}

// ── Session drivers ───────────────────────────────────────────────────────────

/** Answer one pending structured input as the persona; returns the question shape. */
function answerPendingInput({ ws, events, sessionId, pending, persona, turnIndex }) {
  const q = pending.questions?.[0] || {};
  const question = {
    header: q.header || "",
    question: q.question || "",
    options: (q.options || []).map((o) => o.label),
    signalId: pending.generation?.signalId || "",
    mode: pending.generation?.mode || "",
  };
  const resp = selectStructuredResponse({
    question: { ...q, signalId: question.signalId },
    persona,
    turnIndex,
  });
  ws.send(JSON.stringify({
    type: "submit_user_input",
    sessionId,
    requestId: pending.requestId,
    responses: [{ question: question.question || "선택", selectedOptions: resp.selectedOptions, freeText: resp.freeText }],
  }));
  return question;
}

/** Drain non-office-hours onboarding structured inputs before starting office-hours. */
async function drainOnboarding({ ws, events, sessionId, persona, answeredRequestIds, maxInputs = 4 }) {
  let answered = 0;
  for (let i = 0; i < maxInputs; i++) {
    const pending = pendingInputFor(events, sessionId);
    if (!pending || answeredRequestIds.has(pending.requestId)) break;
    if (isOfficeHoursMode(pending.generation?.mode)) break; // already in office-hours
    const offset = events.length;
    answerPendingInput({ ws, events, sessionId, pending, persona, turnIndex: answered });
    answeredRequestIds.add(pending.requestId);
    answered++;
    await waitForEventAfter(events, offset, (e) =>
      e.type === "session_updated" && e.session?.id === sessionId, 60_000);
  }
  return answered;
}

const isOfficeHoursMode = (mode) => /office_hours/i.test(String(mode || ""));

async function runOfficeHoursDay({ ws, events, sessionId, day, maxTurns, persona, baseTurn, answeredRequestIds }) {
  const dayLog = { day, questions: [], assistantMessages: [], outcome: "", eventTypesSeen: [], repeatedQuestionSignals: [] };
  const startOffset = events.length;
  const pendingFromEvent = (e) => {
    if (e.type === "office_hours_pending_input" && e.sessionId === sessionId) return e.pendingUserInput;
    if (e.type === "session_updated" && e.session?.id === sessionId && isOfficeHoursMode(e.session?.pendingUserInput?.generation?.mode)) return e.session.pendingUserInput;
    return null;
  };
  ws.send(JSON.stringify({
    type: "office_hours_start",
    sessionId,
    day,
    visiblePrompt: `Day ${day} Office Hours`,
    source: "manual",
    selectedSources: ["git"],
  }));
  const seenSignals = new Set();
  let turn = 0;
  for (; turn < maxTurns; turn++) {
    // Only match an *unanswered* pending input so the loop advances instead of
    // re-reading the same forcing-question event each turn.
    const ev = await waitForEventAfter(events, startOffset, (e) => {
      const p = pendingFromEvent(e);
      if (p && !answeredRequestIds.has(p.requestId)) return true;
      return (e.type === "office_hours_status" && e.sessionId === sessionId && e.stage === "completed") || e.type === "error";
    }, 90_000);
    if (!ev) { dayLog.outcome = `turn${turn}: timeout`; break; }
    if (ev.type === "error") { dayLog.outcome = `turn${turn}: error ${ev.message || ""}`; break; }
    if (ev.type === "office_hours_status" && ev.stage === "completed") { dayLog.outcome = `completed@${turn}`; break; }
    const pending = pendingFromEvent(ev);
    if (!pending) { dayLog.outcome = `turn${turn}: ${ev.type} without pending`; break; }
    const question = answerPendingInput({ ws, events, sessionId, pending, persona, turnIndex: baseTurn + turn });
    answeredRequestIds.add(pending.requestId);
    // A new requestId that reuses the same signalId == the product re-asked the
    // same forcing question (contact-fixation signal, v2 spec §4), not a harness
    // re-read. Record it so the verdict can distinguish the two.
    if (question.signalId && seenSignals.has(question.signalId)) dayLog.repeatedQuestionSignals.push(question.signalId);
    if (question.signalId) seenSignals.add(question.signalId);
    dayLog.questions.push({ turn, requestId: pending.requestId, ...question });
    const terminal = Boolean(pending.terminal) || /대안|마무리|정리|alternatives/i.test(question.header);
    if (terminal) { dayLog.outcome = `terminal@${turn}`; break; }
  }
  if (!dayLog.outcome) dayLog.outcome = `maxTurns(${maxTurns})`;
  dayLog.eventTypesSeen = [...new Set(events.slice(startOffset).map((e) => e.type))];
  dayLog.assistantMessages = finalAssistants(latestSession(events, sessionId)).slice(-2).map((m) => m.content);
  return { dayLog, turnsUsed: turn };
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runOfficeHoursArcSimulation({
  outputDir = defaultOutputDir(),
  mode = LIVE_DEFAULT ? "live" : "stub",
  personaId = "icp-solo-dev",
  plan = DEFAULT_ARC_PLAN,
} = {}) {
  const persona = OFFICE_HOURS_ARC_PERSONAS[personaId];
  if (!persona) throw new Error(`Unknown persona "${personaId}". Known: ${Object.keys(OFFICE_HOURS_ARC_PERSONAS).join(", ")}`);

  const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const runDir = path.join(outputDir, `office-hours-arc-${runId}`);
  await fs.mkdir(runDir, { recursive: true });

  const workspaceRoot = await seedWorkspace(persona);
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "a30-oh-arc-app-"));
  await writeBipConfig(appSupportPath, workspaceRoot);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspaceRoot], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_CODEX_MODEL: process.env.AGENTIC30_CODEX_MODEL || "gpt-5.4-mini",
      ...(mode === "stub" ? { AGENTIC30_TEST_STUB_PROVIDER: "1", AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += String(c); });

  // gateHistory records every gate probe (block + pass) in order so the verdict
  // can report the full gate timeline; gate/expectedGateBlock keep their original
  // meaning (the LAST expectGateBlock probe) for backward compatibility.
  // evidenceSubmissions records each proof_ledger_append batch that opened a gate.
  const captured = {
    runId, mode, personaId, workspaceRoot, days: [], onboardingAnswered: 0,
    gate: null, day1Commit: null, expectedGateBlock: null,
    gateHistory: [], evidenceSubmissions: [], errors: [],
  };
  const events = [];
  let ws;
  try {
    const ready = await readSidecarReady(child);
    ws = new WebSocket(`ws://127.0.0.1:${ready.port}`);
    ws.on("message", (raw) => { try { events.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "authenticate", authToken: ready.authToken }));
    if (!await waitForEventAfter(events, 0, (e) => e.type === "ready", 30_000)) throw new Error("no ready event");
    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEventAfter(events, 0, (e) => e.type === "session_created", 30_000);
    if (!created) throw new Error("no session_created");
    const sessionId = created.session.id;

    const answeredRequestIds = new Set();
    captured.onboardingAnswered = await drainOnboarding({ ws, events, sessionId, persona, answeredRequestIds });

    let baseTurn = captured.onboardingAnswered;
    for (const step of plan) {
      if (step.runOfficeHours) {
        try {
          const { dayLog, turnsUsed } = await runOfficeHoursDay({
            ws, events, sessionId, day: step.day, maxTurns: step.maxTurns || 4, persona, baseTurn, answeredRequestIds,
          });
          captured.days.push(dayLog);
          baseTurn += turnsUsed;
        } catch (e) { captured.errors.push(`day${step.day} office-hours: ${e.message}`); }
      }
      if (step.commit) {
        const offset = events.length;
        ws.send(JSON.stringify({
          type: "day_progress_patch", sessionId, workspaceRoot,
          stepId: "first_interview", status: "done", day: step.day,
          commitmentText: persona.commitment.text, commitment: persona.commitment,
        }));
        const patched = await waitForEventAfter(events, offset, (e) => e.type === "day_progress_state", 30_000);
        captured.day1Commit = patched
          ? { gateBlocked: patched.gateBlocked || null, currentDay: patched.currentDay ?? null }
          : { error: "no day_progress_state" };
      }
      // Evidence submission: append proof-ledger events (+ optionally seed a
      // first_value snapshot) so the next day-progress probe finds an OPEN gate.
      // Both write to <ws>/.agentic30/, which the sidecar reads on the next patch.
      if (Array.isArray(step.submitEvidence) && step.submitEvidence.length) {
        const submission = { day: step.day, appended: [], firstValueSeeded: false };
        for (const event of step.submitEvidence) {
          const offset = events.length;
          ws.send(JSON.stringify({ type: "proof_ledger_append", sessionId, workspaceRoot, event }));
          const ack = await waitForEventAfter(events, offset, (e) =>
            e.type === "execution_os_state" && e.workspaceRoot === workspaceRoot, 30_000);
          submission.appended.push({
            type: event.type,
            ok: Boolean(ack && ack.success !== false),
            error: ack?.error || (ack ? null : "no execution_os_state"),
          });
        }
        if (step.firstValueSnapshot) {
          // Seed the persisted active-user snapshot directly (no live PostHog in
          // stub). latestFirstValueSignal reads this on the next gate evaluation.
          try {
            await appendActiveUserSnapshot({
              workspaceRoot,
              snapshot: { at: new Date().toISOString(), ...step.firstValueSnapshot },
            });
            submission.firstValueSeeded = true;
          } catch (e) {
            submission.firstValueError = e.message;
          }
        }
        captured.evidenceSubmissions.push(submission);
      }
      // Gate-block probe: a patch expected to be WITHHELD by a milestone gate.
      if (step.expectGateBlock) {
        captured.expectedGateBlock = step.expectGateBlock;
        const offset = events.length;
        ws.send(JSON.stringify({
          type: "day_progress_patch", sessionId, workspaceRoot,
          day: step.day, stepId: step.commitStep || "scan", status: "done",
        }));
        const gate = await waitForEventAfter(events, offset, (e) =>
          e.type === "day_progress_state" && (e.gateBlocked || e.message), 30_000);
        captured.gate = gate ? { gateBlocked: gate.gateBlocked || null, message: gate.message || "" } : { error: "no gate response" };
        captured.gateHistory.push({
          day: step.day, kind: "block", expected: step.expectGateBlock,
          observed: gate?.gateBlocked?.gateId || null,
          ok: Boolean(gate?.gateBlocked && gate.gateBlocked.gateId === step.expectGateBlock),
        });
      }
      // Gate-pass probe: a patch expected to be ALLOWED (the named gate is open).
      // A blocked response carrying the named gateId fails the probe.
      if (step.expectGatePass) {
        const offset = events.length;
        ws.send(JSON.stringify({
          type: "day_progress_patch", sessionId, workspaceRoot,
          day: step.day, stepId: step.commitStep || "scan", status: "done",
        }));
        const resp = await waitForEventAfter(events, offset, (e) =>
          e.type === "day_progress_state" && (e.gateBlocked || e.dayProgress || e.message), 30_000);
        const blockedGateId = resp?.gateBlocked?.gateId || null;
        const passed = Boolean(resp) && blockedGateId !== step.expectGatePass;
        captured.gateHistory.push({
          day: step.day, kind: "pass", expected: step.expectGatePass,
          observedBlock: blockedGateId, ok: passed,
        });
        if (!passed) {
          captured.errors.push(`day${step.day} gate ${step.expectGatePass} expected open but blocked by ${blockedGateId || "(no response)"}`);
        }
      }
    }
  } catch (e) {
    captured.errors.push(`fatal: ${e.message}`);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    await terminateChild(child);
    if (stderr.trim()) captured.stderrTail = stderr.split("\n").slice(-15).join("\n");
  }

  const summary = summarizeArcRun(captured);
  await fs.writeFile(path.join(runDir, "captured.json"), JSON.stringify(captured, null, 2) + "\n");
  await fs.writeFile(path.join(runDir, "report.md"), renderArcReport(captured, summary, persona));
  await fs.rm(workspaceRoot, { recursive: true, force: true });
  await fs.rm(appSupportPath, { recursive: true, force: true });
  return { runDir, captured, summary, passed: summary.passed };
}

function renderArcReport(captured, summary, persona) {
  const lines = [
    "# Office Hours Day-arc Simulation",
    "",
    `Run: ${captured.runId}`,
    `Mode: ${captured.mode}`,
    `Persona: ${persona.label} (${captured.personaId})`,
    `Verdict: ${summary.passed ? "PASS" : "FAIL"}`,
    "",
    "## Smoke summary",
    `- onboarding structured inputs drained: ${summary.onboardingDrained}`,
    `- office-hours forcing questions captured: ${summary.forcingQuestionsCaptured}`,
    `- days covered (1~30 arc): ${summary.daysCovered.join(", ") || "(none)"} · max day reached: ${summary.maxDayReached}`,
    `- gates blocked (probe ok): ${summary.gatesBlocked.join(", ") || "(none)"} · gates passed (probe ok): ${summary.gatesPassed.join(", ") || "(none)"}`,
    `- evidence submission batches: ${summary.evidenceSubmissions} · all gate probes matched: ${summary.gateProbesPassed}`,
    `- gate-block expected: ${summary.gateBlockExpected || "(none)"} · observed: ${summary.gateBlockObserved || "(none)"} · works: ${summary.gateBlockWorks}`,
    summary.gateRequiredEvidence.length ? `- gate required evidence: ${summary.gateRequiredEvidence.join(", ")}` : "",
    summary.errors.length ? `- errors: ${summary.errors.join("; ")}` : "",
    "",
  ];
  for (const d of captured.days) {
    lines.push(`## Day ${d.day} — ${d.outcome}`, "");
    for (const q of d.questions) {
      lines.push(`### [turn ${q.turn}] ${q.header} (signalId: ${q.signalId || "-"}, mode: ${q.mode || "-"})`);
      lines.push(`Q: ${q.question}`);
      if (q.options.length) lines.push(`options: ${q.options.join(" | ")}`);
      lines.push(`→ persona[${persona.answers[Math.min(q.turn, persona.answers.length - 1)] ? "answered" : "-"}]`, "");
    }
    if (d.assistantMessages.length) {
      lines.push("assistant:", ...d.assistantMessages.map((m) => "> " + String(m).replace(/\n/g, "\n> ")), "");
    }
  }
  lines.push("## Day commit", "```json", JSON.stringify(captured.day1Commit, null, 2), "```", "");
  if (Array.isArray(captured.evidenceSubmissions) && captured.evidenceSubmissions.length) {
    lines.push("## Evidence submissions (gate openers)", "```json", JSON.stringify(captured.evidenceSubmissions, null, 2), "```", "");
  }
  if (Array.isArray(captured.gateHistory) && captured.gateHistory.length) {
    lines.push("## Gate history (block + pass probes)", "```json", JSON.stringify(captured.gateHistory, null, 2), "```", "");
  }
  lines.push("## Gate authority (last block probe)", "```json", JSON.stringify(captured.gate, null, 2), "```");
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

function defaultOutputDir() {
  return process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR
    ? path.resolve(process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR)
    : path.join(packageRoot, "sidecar-evals", ".artifacts");
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } resolve(); }, 2_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    try { child.kill("SIGTERM"); } catch { clearTimeout(timeout); resolve(); }
  });
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--persona") opts.personaId = argv[++i];
    else if (a === "--live") opts.mode = "live";
    else if (a === "--stub") opts.mode = "stub";
  }
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOfficeHoursArcSimulation(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`Office Hours arc report: ${path.join(result.runDir, "report.md")}`);
      console.log(`Verdict: ${result.passed ? "PASS" : "FAIL"} · ${JSON.stringify(result.summary)}`);
      process.exit(result.passed ? 0 : 1);
    })
    .catch((error) => { console.error(error); process.exit(1); });
}
