export const DAY1_HANDOFF_CLARITY_DOC_TYPE = "day1_handoff_clarity";
export const DAY1_HANDOFF_CLARITY_SIGNAL_PREFIX = "day1_clarity_";

export const DAY1_HANDOFF_CLARITY_SLOTS = [
  "candidate_or_channel",
  "current_alternative_or_cost",
  "request_or_paid_entry",
  "success_threshold",
  "evidence_location_deadline",
];

export const DAY1_HANDOFF_CLARITY_UNBLOCK_SLOT = "unblock_action";

const LOW_INFORMATION_PATTERN = /(?:확인\s*필요|아직\s*없|없음|모름|몰라|보류|미정|나중|나중에|나중으로|later|tbd|unknown|not\s*sure|no\s*candidate|no\s+evidence)/i;
const PLACEHOLDER_PATTERN = /(?:확인\s*필요|아직\s*없|없음|모름|보류|미정|나중|later|tbd|unknown|첫\s*인터뷰\s*카드|첫\s*고객\s*반응|고객\s*반응\s*검증|이번\s*주\s*3명\s*인터뷰|인터뷰\s*완료|가설\s*검증)/i;
const CHANNEL_OR_PERSON_PATTERN = /(?:@[a-z0-9_.-]+|https?:\/\/|\b(?:threads|twitter|x|linkedin|github|discord|slack|kakao|카톡|오픈채팅|디스코드|슬랙|깃허브|링크드인|스레드|쓰레드|네이버\s*카페|카페|커뮤니티|모임|채널|DM|디엠|메일|이메일|고객\s*\d+\s*명|후보\s*\d+\s*명|실명|대표|창업자|개발자\s*[A-Z가-힣0-9_]{1,20})\b)/i;
const ACTION_REQUEST_PATTERN = /(?:요청|제안|보내|발송|연락|DM|디엠|메일|결제|유료|가격|계약|파일럿|구매|예약|콜|상담|청구|invoice|paid|payment|contract|pilot|offer)/i;
const THRESHOLD_PATTERN = /(?:\d+|한\s*명|두\s*명|세\s*명|명|회|건|원|만원|달러|%|시간|분|일|주|오늘|내일|이번\s*주|시까지|까지|이내|전까지|성공|실패|거절|답변|완료)/i;
const EVIDENCE_LOCATION_PATTERN = /(?:캡처|캡쳐|스크린샷|링크|url|문서|노트|저장|기록|파일|경로|\.agentic30|posthog|github|threads|slack|카톡|디엠|DM|메일|응답|답변|시각|deadline|오늘|내일|이번\s*주|시까지|까지)/i;

function cleanText(value, max = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

function joinFields(handoff = {}, keys = []) {
  return keys
    .flatMap((key) => cleanList(handoff[key]))
    .join(" \n ")
    .trim();
}

export function isLowInformationDay1HandoffClarityAnswer(value) {
  const text = cleanText(value, 600);
  if (!text) return true;
  if (LOW_INFORMATION_PATTERN.test(text)) return true;
  return text.length < 4;
}

function hasConcreteText(value) {
  const text = cleanText(value, 1200);
  if (!text) return false;
  if (PLACEHOLDER_PATTERN.test(text)) return false;
  return text.length >= 6;
}

function slotPasses(slot, handoff = {}) {
  if (slot === "candidate_or_channel") {
    const text = joinFields(handoff, ["targetUser", "nextAction", "sourceQuotes", "markdown"]);
    return hasConcreteText(text) && CHANNEL_OR_PERSON_PATTERN.test(text);
  }
  if (slot === "current_alternative_or_cost") {
    const problem = joinFields(handoff, ["problem", "pain", "outcome", "markdown"]);
    const alternative = joinFields(handoff, ["currentAlternative", "sourceQuotes", "assumptions", "markdown"]);
    return hasConcreteText(problem) && hasConcreteText(alternative);
  }
  if (slot === "request_or_paid_entry") {
    const text = joinFields(handoff, ["entryPoint", "nextAction", "weeklyProof", "sourceQuotes", "markdown"]);
    return hasConcreteText(text) && ACTION_REQUEST_PATTERN.test(text);
  }
  if (slot === "success_threshold") {
    const text = joinFields(handoff, ["northStarGoal", "weeklyProof", "nextAction", "sourceQuotes", "markdown"]);
    return hasConcreteText(text) && THRESHOLD_PATTERN.test(text);
  }
  if (slot === "evidence_location_deadline") {
    const text = joinFields(handoff, ["nextAction", "weeklyProof", "sourceQuotes", "markdown"]);
    return hasConcreteText(text) && EVIDENCE_LOCATION_PATTERN.test(text) && THRESHOLD_PATTERN.test(text);
  }
  return false;
}

function signalIdForSlot(slot) {
  return `${DAY1_HANDOFF_CLARITY_SIGNAL_PREFIX}${slot}`;
}

function slotFromSignalId(signalId) {
  const raw = cleanText(signalId, 120);
  return raw.startsWith(DAY1_HANDOFF_CLARITY_SIGNAL_PREFIX)
    ? raw.slice(DAY1_HANDOFF_CLARITY_SIGNAL_PREFIX.length)
    : raw;
}

export function assessDay1HandoffClarity(handoff = {}, {
  lastSignalId = "",
  lastAnswerState = "",
} = {}) {
  const passedSlots = DAY1_HANDOFF_CLARITY_SLOTS.filter((slot) => slotPasses(slot, handoff));
  const missingSlots = DAY1_HANDOFF_CLARITY_SLOTS.filter((slot) => !passedSlots.includes(slot));
  let nextSlot = missingSlots[0] || "";
  const previousSlot = slotFromSignalId(lastSignalId);
  const answeredPreviously = ["asked", "answered", "low_information", "blocked", "unknown"].includes(
    cleanText(lastAnswerState, 80).toLowerCase(),
  );
  if (nextSlot && previousSlot === nextSlot && answeredPreviously) {
    nextSlot = DAY1_HANDOFF_CLARITY_UNBLOCK_SLOT;
  }
  return {
    ready: missingSlots.length === 0,
    passedSlots,
    missingSlots,
    nextSlot,
    signalId: nextSlot ? signalIdForSlot(nextSlot) : "",
    reason: missingSlots.length
      ? `missing:${missingSlots.join(",")}`
      : "ready",
  };
}

const SLOT_COPY = {
  candidate_or_channel: {
    label: "후보/채널",
    header: "첫 후보",
    question: "오늘 실제로 연락할 수 있는 첫 후보의 이름·핸들·소속 채널 중 하나를 적어주세요.",
    helperText: "세그먼트 설명이 아니라 지금 접근 가능한 한 사람이나 한 채널이어야 합니다.",
    placeholder: "예: Threads @solo_maker에게 오늘 18시 DM",
  },
  current_alternative_or_cost: {
    label: "현재 대안/비용",
    header: "현재 대안",
    question: "그 후보가 지금 이 문제를 어떻게 우회하고 있고, 그 방식이 시간·돈·결정 중 무엇을 낭비하나요?",
    helperText: "막연한 불편 대신 현재 쓰는 대안과 비용을 한 문장으로 고정합니다.",
    placeholder: "예: Notion으로 요청 문구를 복사하며 매주 3시간을 잃음",
  },
  request_or_paid_entry: {
    label: "요청/유료 진입점",
    header: "요청 문장",
    question: "이번 주 그 후보에게 실제로 보낼 요청 또는 유료 제안 문장을 적어주세요.",
    helperText: "인터뷰 약속만으로는 부족합니다. 요청, 가격, 파일럿, 결제, 계약 중 하나가 들어가야 합니다.",
    placeholder: "예: 3만원 45분 파일럿을 오늘 DM으로 제안",
  },
  success_threshold: {
    label: "성공 기준",
    header: "성공 기준",
    question: "이번 주 성공과 실패를 가르는 숫자·기한·응답 조건을 적어주세요.",
    helperText: "완료했다는 느낌이 아니라 통과/실패를 판정할 기준이어야 합니다.",
    placeholder: "예: 내일 18시까지 답변 1건 또는 결제 의사 1건",
  },
  evidence_location_deadline: {
    label: "증거 위치/기한",
    header: "증거 위치",
    question: "그 행동의 증거를 어디에, 언제까지 남길 건가요?",
    helperText: "하드 증거가 없어도 저장은 가능하지만, 이후 Day에서 갚을 evidence debt로 남깁니다.",
    placeholder: "예: .agentic30/evidence/day1-dm.png에 오늘 20시까지 캡처 저장",
  },
  unblock_action: {
    label: "막힌 지점 해소",
    header: "오늘의 해소 행동",
    question: "아직 모른다면, 오늘 이 정보를 얻기 위해 어떤 사람·채널에서 무엇을 할 건가요?",
    helperText: "없음/보류를 반복하지 않습니다. 다음 한 행동으로 불명확성을 줄입니다.",
    placeholder: "예: 오늘 18시까지 Threads에서 후보 1명을 찾아 DM 요청 문장을 보냄",
  },
};

export function day1HandoffClaritySignalLabel(slot) {
  return SLOT_COPY[slot]?.label || "구체화";
}

export function buildDay1HandoffClarityStructuredInput({
  toolName,
  assessment,
  previousRequestId = "",
} = {}) {
  const slot = assessment?.nextSlot || DAY1_HANDOFF_CLARITY_SLOTS[0];
  const copy = SLOT_COPY[slot] || SLOT_COPY[DAY1_HANDOFF_CLARITY_SLOTS[0]];
  const signalId = assessment?.signalId || signalIdForSlot(slot);
  return {
    toolName,
    title: "Office Hours 구체화",
    questions: [
      {
        questionId: signalId,
        header: copy.header,
        question: copy.question,
        helperText: copy.helperText,
        options: [
          {
            label: "지금 답하기",
            description: "아래 입력칸에 오늘 실행 가능한 한 문장으로 적습니다.",
            nextIntent: `answer_${slot}`,
          },
          {
            label: "아직 없음 - 오늘 찾을 행동 정하기",
            description: "같은 질문을 반복하지 않고 오늘 확보할 사람·채널·행동으로 전환합니다.",
            nextIntent: "unblock_action",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: copy.placeholder,
        textMode: "short",
      },
    ],
    generation: {
      mode: "office_hours",
      docType: DAY1_HANDOFF_CLARITY_DOC_TYPE,
      signalId,
      signalLabel: copy.label,
      dimensionTotal: DAY1_HANDOFF_CLARITY_SLOTS.length,
      ...(previousRequestId ? { previousRequestId } : {}),
    },
  };
}

function appendUnique(list, value, maxItems = 8) {
  const next = [...cleanList(list), cleanText(value, 600)].filter(Boolean);
  return [...new Set(next)].slice(0, maxItems);
}

export function mergeDay1HandoffClarityAnswer(handoff = {}, {
  signalId = "",
  responseText = "",
  responseDescription = "",
} = {}) {
  const slot = slotFromSignalId(signalId);
  const text = cleanText([responseText, responseDescription].filter(Boolean).join(" - "), 1000);
  if (!text || isLowInformationDay1HandoffClarityAnswer(text)) {
    return { ...handoff };
  }
  if (slot === "candidate_or_channel") {
    return {
      ...handoff,
      targetUser: hasConcreteText(handoff.targetUser) ? handoff.targetUser : text,
      sourceQuotes: appendUnique(handoff.sourceQuotes, `후보/채널: ${text}`),
    };
  }
  if (slot === "current_alternative_or_cost") {
    return {
      ...handoff,
      problem: hasConcreteText(handoff.problem) ? handoff.problem : text,
      currentAlternative: text,
      sourceQuotes: appendUnique(handoff.sourceQuotes, `현재 대안/비용: ${text}`),
    };
  }
  if (slot === "request_or_paid_entry") {
    return {
      ...handoff,
      entryPoint: text,
      nextAction: text,
      sourceQuotes: appendUnique(handoff.sourceQuotes, `요청/유료 진입점: ${text}`),
    };
  }
  if (slot === "success_threshold") {
    return {
      ...handoff,
      weeklyProof: text,
      sourceQuotes: appendUnique(handoff.sourceQuotes, `성공 기준: ${text}`),
    };
  }
  if (slot === "evidence_location_deadline") {
    return {
      ...handoff,
      nextAction: hasConcreteText(handoff.nextAction) ? handoff.nextAction : text,
      sourceQuotes: appendUnique(handoff.sourceQuotes, `증거 위치/기한: ${text}`),
    };
  }
  if (slot === DAY1_HANDOFF_CLARITY_UNBLOCK_SLOT) {
    return {
      ...handoff,
      nextAction: text,
      sourceQuotes: appendUnique(handoff.sourceQuotes, `불명확성 해소 행동: ${text}`),
    };
  }
  return { ...handoff };
}
