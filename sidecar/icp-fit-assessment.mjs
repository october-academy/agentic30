/**
 * ICP-fit assessment for the Day-1 coaching fast path.
 *
 * The Day-1 ICP diagnosis used to emit a generic "조건부 ICP fit" verdict that
 * never checked the founder against `docs/ICP.md`'s required conditions item by
 * item. The live product-value judge scored that path icp_fit ~4/10 with the
 * exact complaint: "ICP 조건을 항목별로 대조하지 않고", "기록/인터뷰 의향이라는 ICP 필수
 * 신호를 확인하거나 다음 판단 기준에 명시하지 않았다".
 *
 * This module makes the check explicit and deterministic (so the fast path stays
 * fast — no extra provider call): it enumerates the five ICP required conditions
 * and matches the founder's prompt/context against each, returning a checklist
 * plus the conditions still needing confirmation. `index.mjs` cannot be imported
 * in tests (boot side effects), so the pure logic lives here and is unit-tested
 * directly — mirroring the daily-office-hours-digest extraction.
 *
 * Source of truth: docs/ICP.md "필수 조건".
 */

/** docs/ICP.md 필수 조건. `structural` = Agentic30 사용 자체로 충족되는 조건. */
export const ICP_FIT_CONDITIONS = Object.freeze([
  {
    key: "full_time_solo",
    label: "전업 1인 개발자",
    detect: /전업|풀타임|full[\s-]?time|퇴사|1인|혼자|solo|독립 개발/i,
    structural: false,
  },
  {
    key: "pre_revenue",
    label: "첫 매출 전(수익 0)",
    detect: /매출\s*(?:0|없|전)|수익\s*(?:0|은?\s*없)|0\s*원|첫 매출 전|pre[\s-]?revenue|아직.*매출|no revenue|돈을? 못/i,
    structural: false,
  },
  {
    key: "macos",
    label: "macOS 사용자",
    detect: /mac\s?os|맥북|맥에서|맥\b|macbook|apple silicon|애플 실리콘/i,
    structural: true,
    structuralNote: "Agentic30은 macOS 전용이라 사용 자체로 충족됩니다.",
  },
  {
    key: "agent_coding_tool",
    label: "에이전트 코딩 도구 사용",
    detect: /claude\s?code|codex|cursor|gemini|copilot|에이전트 코딩|agent(?:ic)? coding|ai 코딩/i,
    structural: false,
  },
  {
    key: "records_intent",
    label: "프로젝트 path + 30일 기록 의향",
    detect: /기록|인터뷰|transcript|업무\s?일지|일지|\bbip\b|프로젝트 (?:경로|path)|매일.*(?:남|기록)|로그|남길게|남기겠/i,
    structural: false,
  },
]);

const CONDITION_STATUS = Object.freeze({ CONFIRMED: "confirmed", UNCONFIRMED: "unconfirmed" });

function textHits(condition, haystack) {
  return condition.detect.test(haystack);
}

/**
 * Match the founder against the five ICP required conditions.
 *
 * @param {object} opts
 * @param {string} opts.prompt       The founder's Day-1 message.
 * @param {object} opts.hypothesis   Onboarding hypothesis (targetUser/problem/goal).
 * @param {string} opts.contextText  Cached BIP context text (includes ICP.md body).
 * @param {boolean} opts.hasProjectPath  Whether a workspace project path is selected.
 * @returns {{conditions:Array,confirmedCount:number,unconfirmed:string[],checklist:string,checklistLines:string[],namedCustomerNeeded:boolean,allConfirmed:boolean}}
 */
export function assessIcpFitConditions({ prompt = "", hypothesis = {}, contextText = "", hasProjectPath = false } = {}) {
  // The founder's own words (prompt) are the strongest signal. Context text holds
  // ICP.md itself, so it is NOT used to "confirm" a condition (that would always
  // pass); only the prompt + hypothesis describe the actual founder.
  const founderText = [
    String(prompt || ""),
    String(hypothesis?.targetUser || ""),
    String(hypothesis?.problem || ""),
    String(hypothesis?.goal || hypothesis?.purpose || ""),
    Array.isArray(hypothesis?.likelyUsers) ? hypothesis.likelyUsers.join(" ") : "",
  ].join("\n");

  const conditions = ICP_FIT_CONDITIONS.map((condition) => {
    let status = CONDITION_STATUS.UNCONFIRMED;
    let note = "";
    if (condition.structural) {
      status = CONDITION_STATUS.CONFIRMED;
      note = condition.structuralNote || "";
    } else if (textHits(condition, founderText)) {
      status = CONDITION_STATUS.CONFIRMED;
    } else if (condition.key === "records_intent" && hasProjectPath) {
      // A selected project path is concrete evidence of the path/record condition.
      status = CONDITION_STATUS.CONFIRMED;
      note = "프로젝트 path가 연결돼 있습니다.";
    }
    return { key: condition.key, label: condition.label, status, note };
  });

  const confirmed = conditions.filter((c) => c.status === CONDITION_STATUS.CONFIRMED);
  const unconfirmed = conditions.filter((c) => c.status === CONDITION_STATUS.UNCONFIRMED);
  const checklistLines = conditions.map((c) => `${c.status === CONDITION_STATUS.CONFIRMED ? "✓" : "?"} ${c.label}`);

  const targetUser = String(hypothesis?.targetUser || (Array.isArray(hypothesis?.likelyUsers) ? hypothesis.likelyUsers[0] : "") || "").trim();

  return {
    conditions,
    confirmedCount: confirmed.length,
    unconfirmed: unconfirmed.map((c) => c.label),
    checklist: checklistLines.join(" · "),
    checklistLines,
    namedCustomerNeeded: !targetUser,
    allConfirmed: unconfirmed.length === 0,
  };
}

/**
 * Render the ICP-fit lines for the Day-1 coaching message. Always names which
 * conditions are confirmed and which still need confirmation today, so the next
 * judgement criterion is explicit (the judge's missing-evidence complaint).
 */
export function buildIcpFitDiagnosisLines(assessment) {
  const a = assessment || {};
  const lines = [`ICP 적합 점검(${a.confirmedCount ?? 0}/${(a.conditions || []).length} 확인): ${a.checklist || ""}`];
  if ((a.unconfirmed || []).length) {
    lines.push(`확인 필요: ${a.unconfirmed.join(", ")} — 오늘 한 줄로 확인해 기록에 남기면 ICP 적합 판단이 닫힙니다.`);
  } else {
    lines.push("ICP 필수 조건 5개가 모두 확인됐습니다. 이제 고객 증거로 넘어갑니다.");
  }
  return lines;
}

/**
 * The next action when the product customer is still generic. Forces the first
 * rung of the specificity ladder (name a real person) instead of repeating the
 * "아직 좁히는 중인 고객 후보" placeholder.
 */
export function buildNamedCustomerNextAction(problemLabel) {
  const problem = String(problemLabel || "이번 주 검증할 핵심 문제").trim();
  return [
    `오늘은 먼저 실명·역할이 있는 고객 후보 1명을 정하세요(예: 같은 도구를 쓰는 1인 개발자 1명).`,
    `그 사람에게 "${problem}"와 관련된 최근 2주 실제 행동을 묻고 답변 원문을 저장하세요.`,
    `"아직 좁히는 중"이면 후보 이름을 정하는 것 자체가 오늘의 첫 행동입니다.`,
  ].join(" ");
}
