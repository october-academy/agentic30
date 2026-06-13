import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { getFoundationValueContract } from "./foundation-contracts.mjs";
import { evaluateCurriculumProgressionGate } from "./curriculum-progression-gate.mjs";
import { projectDocPath } from "./project-doc-paths.mjs";

const DAY_COUNT = 30;
const WEEK_LENGTH_DAYS = 7;
const FINAL_WEEK_COMPLETION_DAY = 28;
const FINAL_COMPACTED_WEEK = FINAL_WEEK_COMPLETION_DAY / WEEK_LENGTH_DAYS;
const FINAL_CURRICULUM_WEEK = Math.ceil(DAY_COUNT / WEEK_LENGTH_DAYS);

export const IDD_CURRICULUM_SCHEMA_VERSION = 1;
export const CURRICULUM_PROGRESS_SCHEMA_VERSION = 1;
export const CURRICULUM_PROVIDER_CONTEXT_SCHEMA_VERSION = 1;
export const CURRICULUM_DAY_TYPE_COACH_MARK_SCHEMA_VERSION = 1;
export const CURRICULUM_DAY_TRANSITION_ACTION_SCHEMA_VERSION = 1;
export const CURRICULUM_CARRY_OVER_COACHING_SCHEMA_VERSION = 1;
export const CURRICULUM_COACHING_FEEDBACK_SURFACE_SCHEMA_VERSION = 1;
export const CURRICULUM_PREREQUISITE_REQUIREMENT_SCHEMA_VERSION = 1;
export const CURRICULUM_GRADUATION_STATE_SCHEMA_VERSION = 1;
export const CURRICULUM_TOO_FAST_PROGRESSION_SCHEMA_VERSION = 1;
export const CURRICULUM_LOW_QUALITY_PROGRESSION_SCHEMA_VERSION = 1;
export const CURRICULUM_RUSHING_RISK_SCHEMA_VERSION = 1;
export const CURRICULUM_STATUSES = Object.freeze({
  active: "active",
  graduated: "graduated",
});
export const CURRICULUM_DAY_TYPES = Object.freeze({
  interview: "interview",
  action: "action",
  review: "review",
  education: "education",
});
export const CURRICULUM_REVIEW_DAY_IDS = Object.freeze([7, 14, 21, 28]);
export const CURRICULUM_DAY_TYPE_FIRST_ENCOUNTER_TYPES = Object.freeze([
  CURRICULUM_DAY_TYPES.interview,
  CURRICULUM_DAY_TYPES.action,
  CURRICULUM_DAY_TYPES.review,
  CURRICULUM_DAY_TYPES.education,
]);
export const CURRICULUM_PROGRESS_EVENT_TYPES = Object.freeze({
  day1DraftAnswerSaved: "day1_draft_answer_saved",
  day1IncompleteActionRecorded: "day1_incomplete_action_recorded",
  day1VerificationFailed: "day1_verification_failed",
  dayQuestionProgressSaved: "day_question_progress_saved",
  dayCompletionConfirmed: "day_completion_confirmed",
});
export const CURRICULUM_WEEK_TYPE_DISTRIBUTIONS = Object.freeze({
  1: Object.freeze({
    weekNumber: 1,
    week_number: 1,
    label: "Week 1",
    method: "weighted_target_percent",
    targetPercentages: Object.freeze({
      interview: 50,
      action: 20,
      review: 20,
      education: 10,
    }),
    target_percentages: Object.freeze({
      interview: 50,
      action: 20,
      review: 20,
      education: 10,
    }),
    daySlots: Object.freeze([
      Object.freeze({ day: 1, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 12.5 }),
      Object.freeze({ day: 2, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 20 }),
      Object.freeze({ day: 3, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 12.5 }),
      Object.freeze({ day: 4, dayType: CURRICULUM_DAY_TYPES.education, distributionWeight: 10 }),
      Object.freeze({ day: 5, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 12.5 }),
      Object.freeze({ day: 6, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 12.5 }),
      Object.freeze({ day: 7, dayType: CURRICULUM_DAY_TYPES.review, distributionWeight: 20 }),
    ]),
  }),
  2: Object.freeze({
    weekNumber: 2,
    week_number: 2,
    label: "Week 2",
    method: "weighted_target_percent",
    targetPercentages: Object.freeze({
      interview: 40,
      action: 35,
      review: 15,
      education: 10,
    }),
    target_percentages: Object.freeze({
      interview: 40,
      action: 35,
      review: 15,
      education: 10,
    }),
    daySlots: Object.freeze([
      Object.freeze({ day: 8, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 9, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 17.5 }),
      Object.freeze({ day: 10, dayType: CURRICULUM_DAY_TYPES.education, distributionWeight: 10 }),
      Object.freeze({ day: 11, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 12, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 17.5 }),
      Object.freeze({ day: 13, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 14, dayType: CURRICULUM_DAY_TYPES.review, distributionWeight: 15 }),
    ]),
  }),
  3: Object.freeze({
    weekNumber: 3,
    week_number: 3,
    label: "Week 3",
    method: "weighted_target_percent",
    targetPercentages: Object.freeze({
      interview: 40,
      action: 35,
      review: 15,
      education: 10,
    }),
    target_percentages: Object.freeze({
      interview: 40,
      action: 35,
      review: 15,
      education: 10,
    }),
    daySlots: Object.freeze([
      Object.freeze({ day: 15, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 16, dayType: CURRICULUM_DAY_TYPES.education, distributionWeight: 10 }),
      Object.freeze({ day: 17, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 18, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 19, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 17.5 }),
      Object.freeze({ day: 20, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 17.5 }),
      Object.freeze({ day: 21, dayType: CURRICULUM_DAY_TYPES.review, distributionWeight: 15 }),
    ]),
  }),
  4: Object.freeze({
    weekNumber: 4,
    week_number: 4,
    label: "Week 4",
    method: "weighted_target_percent",
    targetPercentages: Object.freeze({
      interview: 30,
      action: 40,
      review: 20,
      education: 10,
    }),
    target_percentages: Object.freeze({
      interview: 30,
      action: 40,
      review: 20,
      education: 10,
    }),
    daySlots: Object.freeze([
      Object.freeze({ day: 22, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 23, dayType: CURRICULUM_DAY_TYPES.education, distributionWeight: 10 }),
      Object.freeze({ day: 24, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 15 }),
      Object.freeze({ day: 25, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 26, dayType: CURRICULUM_DAY_TYPES.interview, distributionWeight: 15 }),
      Object.freeze({ day: 27, dayType: CURRICULUM_DAY_TYPES.action, distributionWeight: 40 / 3 }),
      Object.freeze({ day: 28, dayType: CURRICULUM_DAY_TYPES.review, distributionWeight: 20 }),
    ]),
  }),
});

export const AGENTIC30_THREE_LAYERS = Object.freeze({
  founder: Object.freeze({
    name: "Builder",
    subject: "사용자/첫 운영자",
    question: "오늘 카드가 내 실제 행동을 바꿨나?",
    successSignal: "daily dogfood, interviews, journal, BIP, DM/ask execution",
  }),
  company: Object.freeze({
    name: "Program",
    subject: "반복 가능한 교육/코칭 시스템",
    question: "이 실행이 반복 가능한 훈련 자산으로 남나?",
    successSignal: "repeatable education asset, rubric evidence, reusable coaching loop",
  }),
  product: Object.freeze({
    name: "Agentic30",
    subject: "제품",
    question: "30일 PMF 검증 판단을 강화하나?",
    successSignal: "IDD loop, adaptive curriculum, evidence-backed continue/pivot/stop decision",
  }),
});

export const IDD_BASE_CURRICULUM = Object.freeze([
  day(1, "foundation", "목표와 고객 핵심 가설을 만든다", "Alignment", "프로젝트 목표를 ICP, Pain Point, Outcome 세 문장으로 압축하고 Day 2 시장 신호 검증 기준으로 둔다.", ["프로젝트 목표 한 문장 고정하기", "ICP / Pain Point / Outcome 세 컴포넌트 작성하기", "품질 게이트 7.0/10 이상인지 확인하고 다음 검증 기준 기록"], `day-1-alignment-statement.md, ${projectDocPath("goal")}, ${projectDocPath("icp")}, ${projectDocPath("spec")} v0`),
  day(2, "foundation", "돈이 흐르는 기준 시장을 고른다", "Market", "어제 통증과 가까운 iOS/Android/Web/Mac 앱·도구 시장에서 이미 지불 행동이 있는지 확인한다.", ["카테고리 1-2개 고르기", "작은 팀/개인이 만든 유료 앱·광고 앱 5개 찾기", "가격·리뷰·ASO·광고/콘텐츠 흔적을 day-2-evidence-log.md에 기록"], "day-2-evidence-log.md"),
  day(3, "foundation", "Mom Test 인터뷰 질문을 만든다", "Mom Test", "약한 가설을 검증/반증할 5문장 인터뷰 질문을 만들고 미래 의향 질문을 제거한다.", ["과거 행동 질문 3개 이상 쓰기", "미래 의향/칭찬 유도 질문 제거", "다음 인터뷰 대상 1명과 질문 5개 확정"], "day-3-interview-script.md"),
  day(4, "foundation", "10배 wedge로 약한 섹션을 다시 쓴다", "10x Wedge", `경쟁 앱을 베끼지 않고 더 좁은 페르소나나 더 빠른 결과로 ${projectDocPath("spec")}의 약한 섹션을 다시 쓴다.`, ["원조/대체재의 핵심 흐름 1개 고르기", "가격·속도·UX·페르소나 중 10배 wedge 1개 선택", `${projectDocPath("spec")} 같은 파일에서 약한 섹션 다시 쓰기`], "day-4-rewrite-decision.md"),
  day(5, "foundation", "수요 시그널을 숫자로 평가한다", "Demand Signal", "경쟁앱/광고/노출/스토어/랜딩/DM 데이터를 진짜 수요 신호와 허수로 분리한다.", ["impressions/clicks/signups/replies/CPI/store conversion 중 있는 숫자 정리", "waitlist/CTR이 아닌 돈 낼 후보 1명 고르기", `${projectDocPath("spec")} v2에 demand signal 판단 기록`], `${projectDocPath("spec")} v2, day-5-demand-signal.md`),
  day(6, "foundation", "돈/시간 ask를 실행한다", "Ask", "칭찬이 아니라 특정 1명에게 가격, 받을 약속, 응답 기한이 있는 ask를 보낸다.", ["ask 대상 1명 선택", "가격·받을 약속·응답 기한이 있는 문장 작성", "yes/no/no-reply를 원문으로 기록"], "monetization-ask-result.md"),
  day(7, "foundation", "Foundation Go/No-Go를 결정한다", "Go/No-Go", "7일 기록으로 계속/재시작/피벗 중 하나를 고른다.", ["인터뷰/일지/BIP 수량 세기", "가장 강한 증거와 반증 쓰기", "다음 7일 결론 선택"], "go-no-go.md, foundation-summary"),
  day(8, "build", "MVP를 핵심 기능 1개로 자른다", "Core Action", "기능 목록이 아니라 사용자가 30초 안에 첫 가치를 보는 핵심 행동 1개를 완성 대상으로 고정한다.", ["핵심 행동 1개와 성공 화면 정의", "로그인/동기화/자동화/설정 확장은 deferred 표시", "첫 happy path 테스트 작성"], "core action spec + deferred list"),
  day(9, "build", "입력→처리→출력 흐름을 고정한다", "Input Flow", "사용자가 바로 써볼 수 있게 입력, 처리, 결과 화면을 한 번에 지나가게 만든다.", ["첫 입력 포맷 1개만 선택", "처리 실패와 빈 입력 폴백 작성", "결과 화면까지 30초 이내인지 재기"], "input-process-output flow"),
  day(10, "build", "핵심 결과의 10배 품질을 만든다", "10x Result", "기능 수가 아니라 같은 문제를 더 빠르게, 적은 클릭으로, 더 좁은 페르소나에 맞게 해결한다.", ["경쟁/대체재 대비 10배 기준 1개 선택", "핵심 결과 화면에만 품질 투자", "부차 기능 추가 요청은 다음 폴더로 이동"], "10x core result note"),
  day(11, "build", "마찰 없는 첫 사용을 만든다", "No Login", "검증 전 로그인, 계정, 복잡한 온보딩으로 이탈을 만들지 않는다.", ["설치 후 첫 가치까지 클릭 수 세기", "필수 설명 5줄 이하로 줄이기", "로그인/회원가입 없이 가능한 경로 확인"], "time-to-first-value note"),
  day(12, "build", "첫 end-to-end dogfood를 돈다", "E2E", "실제 입력에서 핵심 기능 1개와 결과 기록까지 한 번 지나간다.", ["실제 인터뷰/일지 파일 넣기", "핵심 결과 생성 실행", "추천 행동 수행 여부 기록"], "dogfood E2E log"),
  day(13, "build", "스토어/랜딩 약속을 미리 쓴다", "Promise", "제품 설명을 나중에 붙이지 말고 iOS/Android/Web/Mac 어디서 팔든 통하는 약속 한 문장으로 범위를 제한한다.", ["타겟 페르소나 한 줄 작성", "결과 약속 한 문장 작성", "스크린샷/데모/스토어 첫 화면에 보여야 할 장면 1개 선택"], "store or landing promise draft"),
  day(14, "build", "측정을 심는다", "Measurement", "설치보다 첫 가치 경험과 이탈 지점을 알 수 있게 이벤트를 남긴다.", ["first_value 이벤트 정의", "개인정보 없는 payload 확인", "activation baseline 기록 위치 만들기"], "event list + activation check"),
  day(15, "build", "수익모델 dry run을 한다", "Revenue Dry Run", "광고든 구독이든 결제를 나중 문제로 밀지 말고 가격, 노출 위치, 받을 약속의 막힘을 확인한다.", ["광고/구독/일회성 결제 중 현재 실험 모델 1개 선택", "페이월/결제 mock 또는 광고 노출 sandbox 경로 확인", "waitlist와 무료 가입은 proof가 아님을 기록"], "revenue dry-run note"),
  day(16, "build", "출시 체크리스트를 닫는다", "Release Gate", "출시를 미루는 플랫폼 계정, 권한, 세금/정산, 빌드 리스크를 확인 목록으로 줄인다.", ["App Store/Google Play/Web/Mac 중 현재 채널 계정 상태 확인", "정산·세금·회사 사규 리스크 체크", "첫 테스터에게 보낼 설치/접속 안내 5줄 작성"], "release readiness checklist"),
  day(17, "build", "Build phase를 줄일지 결정한다", "Build Retro", "기능 추가가 아니라 첫 가치 경험과 유료 ask 가능 여부로 남길 것을 고른다.", ["7일 사용 로그 확인", "첫 가치까지 막힌 단계 확인", "삭제/유지/다음 phase 결정"], "build decision memo"),
  day(18, "launch", "고객 언어로 launch story를 쓴다", "Story", "제품 설명보다 반복된 L2 표현과 10배 wedge로 공개한다.", ["반복 인용 3개 선택", "hook-demo-CTA 구조로 launch hook 3개 작성", "가장 강한 status quo로 시작"], "launch story draft"),
  day(19, "launch", "첫 공개 proof를 만든다", "Public Proof", "불완전한 앱 상태보다 배운 고객 증거와 핵심 결과 장면을 공개한다.", ["핵심 결과 스크린샷/요약 선택", "실행 결과 1개 쓰기", "Threads/BIP 게시"], "public proof post"),
  day(20, "launch", "warm outreach를 보낸다", "Outreach", "가장 절박한 사람에게 직접 확인하고 응답/무응답을 숫자로 남긴다.", ["20명 후보 목록", "개인화 DM 10개", "응답/무응답 Sheet 기록"], "outreach tracker"),
  day(21, "launch", "첫 설치/사용 관찰을 한다", "Observe", "시연이 아니라 사용자가 iOS/Android/Web/Mac 실제 환경에서 막히는 장면과 첫 가치 도달 시간을 본다.", ["테스터 1명 설치/접속 관찰", "막힌 단계와 first_value 도달 여부 기록", "수정 3개 이하 선택"], "observation note"),
  day(22, "launch", "60초 demo를 만든다", "Demo", "핵심 기능 1개와 10배 결과가 60초 안에 보이게 한다.", ["한 입력에서 결과까지 녹화", "hook-demo-CTA 캡션 작성", "BIP/랜딩/광고 소재로 재사용"], "60s demo asset"),
  day(23, "launch", "paid learning 실험을 설계한다", "Paid Learning", "광고비를 성장 욕심이 아니라 iOS/Android/Web/Mac 시장/메시지 학습 비용으로 작게 쓴다.", ["테스트 예산과 중단 기준 정하기", "소재 hook 3개와 타겟 1개 선택", "CPI/CTR/store conversion/first_value 측정 준비"], "paid learning plan"),
  day(24, "launch", "Launch 결정을 숫자로 한다", "Launch Decision", "조회수가 아니라 DM/설치/first_value/ask 결과로 다음 7일을 고른다.", ["유입/설치/첫 가치/ask 숫자 정리", "가장 강한 채널 선택", "다음 실험 1개 결정"], "launch decision"),
  day(25, "grow", "activation을 정의한다", "Activation", "가입이 아니라 설치 후 30초 이내 첫 가치 경험에 도달했는지를 측정한다.", ["첫 가치 행동 정의", "도달/이탈 수 계산", "가장 큰 이탈 지점 선택"], "activation baseline"),
  day(26, "grow", "retention 신호를 본다", "Retention", "다시 돌아와 핵심 기능을 반복하는 사람이 있는지 확인한다.", ["재방문 기준 정하기", "반복 사용 발화 찾기", "돌아온 이유 한 문장 작성"], "retention note"),
  day(27, "grow", "가격 ask와 페이월을 반복한다", "Pricing", "첫 매출은 큰 금액보다 지불 행동 또는 명시적 가격 거절의 증명이다.", ["유료 제안 1개 작성", "관심 사용자에게 가격·약속·기한 포함 제안", "가격 반응과 결제/거절 원문 기록"], "pricing ask result"),
  day(28, "grow", "ASO/소재 loop를 만든다", "Acquisition Loop", "앱스토어 검색 키워드, 상세 페이지, 랜딩, 광고 소재를 감이 아니라 전환 데이터로 고친다.", ["App Store/Google Play/랜딩의 hook 점검", "키워드·스크린샷·소재 1개 수정", "CPI/설치/store conversion/first_value 변화 기록"], "acquisition loop log"),
  day(29, "grow", "PMF evidence memo를 쓴다", "PMF Memo", "실제 사용자 증거, 유입 지표, ask 결과, 반증을 같은 문서에 둔다.", ["사용자 증거와 ask 결과 정리", "CPI/activation/retention/가격 반응 요약", "계속/전환/중단 판단 기준 쓰기"], "PMF evidence memo"),
  day(30, "grow", "계속/전환/중단을 결정한다", "Final Decision", "완주가 아니라 첫 가치, 유입, 지불 행동 근거로 다음 선택을 공개한다.", ["30일 숫자 요약", "가장 큰 배움 3개", "continue/pivot/stop 결정"], "Day 30 public retro"),
]);

export function buildAdaptiveCurriculum({
  selectedDay = null,
  state = {},
  now = new Date(),
} = {}) {
  const signals = deriveCurriculumSignals(state, { now });
  const plan = IDD_BASE_CURRICULUM.map((base) => personalizeDay(base, signals));
  const wantedDay = normalizeDayNumber(selectedDay?.day ?? selectedDay ?? signals.suggestedDay ?? 1);
  const selected = plan.find((item) => item.day === wantedDay) || plan[0];
  const dayContext = assembleCurriculumDayContext({
    day: wantedDay,
    progressState: state.curriculumProgress ?? state.progress ?? state,
    projectContext: selectProjectContextSource(state),
    currentWeekRawAnswers: selectRawAnswerSource(state),
    dayRecords: state.dayRecords ?? state.days ?? [],
    now,
  });
  const providerContextPayload = buildCurriculumProviderContextPayload({
    day: wantedDay,
    curriculumDay: selected,
    context: dayContext,
    generatedAt: now,
  });
  const selectedDayWithOverrides = mergeSelectedOverride(selected, selectedDay);
  const selectedDayWithPrerequisites = mergeCarriedOverPrerequisiteRequirementsIntoCurriculumDay({
    curriculumDay: selectedDayWithOverrides,
    prerequisiteRequirements: dayContext.prerequisiteRequirements,
    generatedAt: now,
  });
  return {
    schemaVersion: IDD_CURRICULUM_SCHEMA_VERSION,
    generatedAt: toIso(now),
    source: projectDocPath("spec"),
    strategy: {
      northStar: "IDD Engine dogfood loop",
      p0: "folder watch + qmd index + 09:00 card + response memory + Day 7 Go/No-Go",
      antiValidation: "Day 30 decision has no real-user evidence or explicit ask outcome",
      layers: AGENTIC30_THREE_LAYERS,
      weekTypeDistributions: CURRICULUM_WEEK_TYPE_DISTRIBUTIONS,
    },
    signals,
    curriculumContext: dayContext,
    providerContextPayload,
    selectedDay: {
      ...selectedDayWithPrerequisites,
      curriculumContext: dayContext,
      providerContextPayload,
    },
    days: plan,
  };
}

export function adaptCurriculumDay({
  curriculumDay = null,
  state = {},
  now = new Date(),
} = {}) {
  const plan = buildAdaptiveCurriculum({
    selectedDay: curriculumDay,
    state,
    now,
  });
  return plan.selectedDay;
}

export function makeDefaultCurriculumProgressState(now = new Date()) {
  const coachMarkRegistry = makeDefaultCoachMarkRegistry();
  const notificationConfig = makeDefaultCurriculumNotificationConfig();
  return {
    schemaVersion: CURRICULUM_PROGRESS_SCHEMA_VERSION,
    updatedAt: toIso(now),
    curriculumStatus: CURRICULUM_STATUSES.active,
    curriculum_status: CURRICULUM_STATUSES.active,
    terminalState: false,
    terminal_state: false,
    graduationState: null,
    graduation_state: null,
    notificationConfig,
    notification_config: notificationConfig,
    weeklySummaryStack: [],
    coachMarkRegistry,
    coach_mark_registry: coachMarkRegistry,
  };
}

export async function loadCurriculumProgressState(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeCurriculumProgressState(JSON.parse(raw));
  } catch {
    return makeDefaultCurriculumProgressState();
  }
}

export async function restoreNextUnansweredDayQuestionFromPersistedProgress(
  filePath,
  options = {},
) {
  const progressState = await loadCurriculumProgressState(filePath);
  return restoreNextUnansweredDayQuestionFromProgressState({
    ...options,
    progressState,
  });
}

export async function resolveCurriculumLaunchRouteFromPersistedProgress(
  filePath,
  options = {},
) {
  const progressState = await loadCurriculumProgressState(filePath);
  return resolveCurriculumLaunchRouteFromRestoredState({
    ...options,
    progressState,
  });
}

export function resolveCurriculumLaunchRouteFromRestoredState({
  progressState = {},
  curriculumDays = IDD_BASE_CURRICULUM,
  day = null,
} = {}) {
  const normalizedProgressState = normalizeCurriculumProgressState(progressState);
  if (isCurriculumGraduated(normalizedProgressState)) {
    const graduationState = normalizedProgressState.graduationState;
    const destination = {
      surface: "workspace_curriculum_graduation",
      route: "curriculum_graduation",
      dayId: DAY_COUNT,
      day_id: DAY_COUNT,
      componentType: "graduation_terminal_screen",
      component_type: "graduation_terminal_screen",
      graduationState,
      graduation_state: graduationState,
    };
    return {
      schema: "agentic30.curriculum.launch_route.v1",
      restoration: {
        schema: "agentic30.curriculum.restored_next_unanswered_question.v1",
        progressState: normalizedProgressState,
        progress_state: normalizedProgressState,
        didRestore: true,
        did_restore: true,
        didResolve: true,
        did_resolve: true,
        reason: "curriculum_graduated_terminal_state",
        dayId: DAY_COUNT,
        day_id: DAY_COUNT,
        nextQuestion: null,
        next_question: null,
        allQuestionsAnswered: true,
        all_questions_answered: true,
        progressionBlocked: false,
        progression_blocked: false,
      },
      restoredState: normalizedProgressState,
      restored_state: normalizedProgressState,
      didRoute: true,
      did_route: true,
      routeKind: "curriculum_graduation",
      route_kind: "curriculum_graduation",
      reason: "curriculum_graduated_terminal_state",
      destination,
      progressionBlocked: false,
      progression_blocked: false,
    };
  }

  const restoration = restoreNextUnansweredDayQuestionFromProgressState({
    progressState: normalizedProgressState,
    curriculumDays,
    day,
  });
  if (restoration.progressionBlocked === true || restoration.progression_blocked === true) {
    const blockedStateMetadata = restoration.blockedStateMetadata
      ?? restoration.blocked_state_metadata
      ?? restoration.progressionGate?.blockedStateMetadata
      ?? restoration.progressionGate?.blocked_state_metadata
      ?? restoration.progression_gate?.blockedStateMetadata
      ?? restoration.progression_gate?.blocked_state_metadata
      ?? null;
    return {
      schema: "agentic30.curriculum.launch_route.v1",
      restoration,
      restoredState: restoration.progressState ?? restoration.progress_state,
      restored_state: restoration.progressState ?? restoration.progress_state,
      didRoute: false,
      did_route: false,
      routeKind: "progression_gate_blocked",
      route_kind: "progression_gate_blocked",
      reason: restoration.reason,
      destination: null,
      progressionGate: restoration.progressionGate ?? restoration.progression_gate ?? null,
      progression_gate: restoration.progressionGate ?? restoration.progression_gate ?? null,
      blockedStateMetadata,
      blocked_state_metadata: blockedStateMetadata,
      progressionBlocked: true,
      progression_blocked: true,
    };
  }
  const nextQuestion = restoration.nextQuestion ?? restoration.next_question;
  const dayId = normalizeOptionalDayNumber(restoration.dayId ?? restoration.day_id);
  const questionId = nextQuestion?.id ?? nextQuestion?.questionId ?? nextQuestion?.question_id ?? null;

  if (!restoration.didRestore || !restoration.didResolve || !nextQuestion || !dayId || dayId < 2) {
    return {
      schema: "agentic30.curriculum.launch_route.v1",
      restoration,
      restoredState: restoration.progressState ?? restoration.progress_state,
      restored_state: restoration.progressState ?? restoration.progress_state,
      didRoute: false,
      did_route: false,
      routeKind: "none",
      route_kind: "none",
      reason: restoration.reason,
      destination: null,
      progressionBlocked: false,
      progression_blocked: false,
    };
  }

  const dayType = normalizeCurriculumDayType(restoration.dayType ?? restoration.day_type)
    || defaultDayTypeForDay(dayId);
  const questionIndex = restoration.questionIndex ?? restoration.question_index;
  const componentType = launchComponentTypeForDayType(dayType);
  const focusElementId = `workspace.curriculum.day.${dayId}.question.${questionId}`;
  const destination = {
    surface: "workspace_curriculum_day",
    route: "curriculum_day_question",
    dayId,
    day_id: dayId,
    dayType,
    day_type: dayType,
    questionId,
    question_id: questionId,
    questionIndex,
    question_index: questionIndex,
    componentType,
    component_type: componentType,
    focusElementId,
    focus_element_id: focusElementId,
    nextQuestion,
    next_question: nextQuestion,
  };

  return {
    schema: "agentic30.curriculum.launch_route.v1",
    restoration,
    restoredState: restoration.progressState ?? restoration.progress_state,
    restored_state: restoration.progressState ?? restoration.progress_state,
    didRoute: true,
    did_route: true,
    routeKind: "curriculum_day_question",
    route_kind: "curriculum_day_question",
    reason: "restored_next_unanswered_question_destination",
    destination,
    progressionBlocked: false,
    progression_blocked: false,
  };
}

export function restoreNextUnansweredDayQuestionFromProgressState({
  progressState = {},
  curriculumDays = IDD_BASE_CURRICULUM,
  day = null,
} = {}) {
  const normalizedProgress = normalizeCurriculumProgressState(progressState);
  if (isCurriculumGraduated(normalizedProgress)) {
    return {
      schema: "agentic30.curriculum.restored_next_unanswered_question.v1",
      progressState: normalizedProgress,
      progress_state: normalizedProgress,
      didRestore: true,
      did_restore: true,
      restoredFromPersistedProgress: true,
      restored_from_persisted_progress: true,
      didResolve: true,
      did_resolve: true,
      reason: "curriculum_graduated_terminal_state",
      dayId: DAY_COUNT,
      day_id: DAY_COUNT,
      questionIndex: null,
      question_index: null,
      nextQuestion: null,
      next_question: null,
      allQuestionsAnswered: true,
      all_questions_answered: true,
      progressionBlocked: false,
      progression_blocked: false,
    };
  }

  const targetDay = normalizeOptionalDayNumber(day);
  const daySpecs = normalizeCurriculumDaySpecs(curriculumDays)
    .filter((entry) => entry.day >= 2)
    .filter((entry) => !targetDay || entry.day === targetDay)
    .sort((a, b) => a.day - b.day);

  if (!daySpecs.length) {
    return {
      schema: "agentic30.curriculum.restored_next_unanswered_question.v1",
      progressState: normalizedProgress,
      progress_state: normalizedProgress,
      didRestore: false,
      did_restore: false,
      reason: targetDay && targetDay < 2
        ? "day1_progress_resets_before_completion"
        : "no_day2_plus_questions_available",
      dayId: targetDay,
      day_id: targetDay,
      nextQuestion: null,
      next_question: null,
      progressionBlocked: false,
      progression_blocked: false,
    };
  }

  const dayRecords = normalizeDayProgressRecords(normalizedProgress.dayRecords);
  for (const daySpec of daySpecs) {
    const dayRecord = dayRecords.find((record) => record.day === daySpec.day) ?? null;
    if (!targetDay && dayRecord?.completionConfirmed === true) continue;
    const progressionGate = evaluateProgressionGateForDay({
      progressState: normalizedProgress,
      curriculumDay: daySpec,
      dayRecord,
      day: daySpec.day,
    });
    if (progressionGate.blocked === true) {
      const blockedStateMetadata = progressionGate.blockedStateMetadata
        ?? progressionGate.blocked_state_metadata
        ?? null;
      return {
        schema: "agentic30.curriculum.restored_next_unanswered_question.v1",
        progressState: normalizedProgress,
        progress_state: normalizedProgress,
        didRestore: false,
        did_restore: false,
        restoredFromPersistedProgress: true,
        restored_from_persisted_progress: true,
        didResolve: true,
        did_resolve: true,
        reason: "curriculum_progression_gate_blocked",
        dayId: daySpec.day,
        day_id: daySpec.day,
        dayType: daySpec.dayType,
        day_type: daySpec.day_type,
        questionIndex: null,
        question_index: null,
        nextQuestion: null,
        next_question: null,
        allQuestionsAnswered: false,
        all_questions_answered: false,
        progressionGate,
        progression_gate: progressionGate,
        blockedStateMetadata,
        blocked_state_metadata: blockedStateMetadata,
        progressionBlocked: true,
        progression_blocked: true,
      };
    }

    const resolution = identifyNextUnansweredDayQuestion({
      progressState: normalizedProgress,
      curriculumDay: daySpec,
      day: daySpec.day,
    });
    if (resolution.didResolve && !resolution.allQuestionsAnswered) {
      return {
        ...resolution,
        schema: "agentic30.curriculum.restored_next_unanswered_question.v1",
        progressState: normalizedProgress,
        progress_state: normalizedProgress,
        didRestore: true,
        did_restore: true,
        restoredFromPersistedProgress: true,
        restored_from_persisted_progress: true,
      };
    }
  }

  return {
    schema: "agentic30.curriculum.restored_next_unanswered_question.v1",
    progressState: normalizedProgress,
    progress_state: normalizedProgress,
    didRestore: true,
    did_restore: true,
    restoredFromPersistedProgress: true,
    restored_from_persisted_progress: true,
    didResolve: true,
    did_resolve: true,
    reason: targetDay ? "all_day_questions_answered" : "all_day2_plus_questions_answered",
    dayId: targetDay,
    day_id: targetDay,
    questionIndex: null,
    question_index: null,
    nextQuestion: null,
    next_question: null,
    allQuestionsAnswered: true,
    all_questions_answered: true,
    progressionBlocked: false,
    progression_blocked: false,
  };
}

export async function persistCurriculumProgressState(
  filePath,
  state,
  { now = () => new Date() } = {},
) {
  const payload = normalizeCurriculumProgressState({
    ...state,
    updatedAt: toIso(now()),
  });
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    await fs.chmod(tempPath, 0o600).catch(() => {});
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
  return payload;
}

export function finalizeWeeklySummaryForCompletedDay(state, {
  completedDay,
  dayRecords = [],
  summaryText = "",
  keyInsights = [],
  unresolvedActions = [],
  finalizedAt = new Date(),
} = {}) {
  const normalized = normalizeCurriculumProgressState(state);
  const day = normalizeDayNumber(completedDay);
  if (!isWeeklyCompactionCompletionDay(day)) {
    return {
      state: normalized,
      finalizedSummary: null,
      didFinalize: false,
    };
  }

  const weekNumber = day / WEEK_LENGTH_DAYS;
  const existing = normalized.weeklySummaryStack.find((entry) => entry.weekNumber === weekNumber);
  if (existing?.status === "finalized") {
    return {
      state: normalized,
      finalizedSummary: existing,
      didFinalize: false,
    };
  }

  const finalizedSummary = buildFinalizedWeeklySummaryRecord({
    weekNumber,
    dayRecords,
    summaryText,
    keyInsights,
    unresolvedActions,
    finalizedAt,
  });
  const weeklySummaryStack = normalized.weeklySummaryStack
    .filter((entry) => entry.weekNumber !== weekNumber)
    .concat(finalizedSummary)
    .sort((a, b) => a.weekNumber - b.weekNumber);

  return {
    state: normalizeCurriculumProgressState({
      ...normalized,
      updatedAt: finalizedSummary.finalizedAt,
      weeklySummaryStack,
    }),
    finalizedSummary,
    didFinalize: true,
  };
}

export function normalizeCurriculumProgressState(payload = {}) {
  const base = makeDefaultCurriculumProgressState();
  const normalized = objectOrEmpty(payload);
  const dayRecords = normalizeDayProgressRecords(normalized.dayRecords ?? normalized.day_records);
  const carryOverQueue = normalizeCarryOverQueue(normalized.carryOverQueue ?? normalized.carry_over_queue);
  const coachMarkRegistry = normalizeCoachMarkRegistry(
    normalized.coachMarkRegistry ?? normalized.coach_mark_registry ?? base.coachMarkRegistry,
  );
  const rawCurriculumStatus = normalizeCurriculumStatus(normalized.curriculumStatus ?? normalized.curriculum_status);
  const graduationState = normalizeCurriculumGraduationState(
    normalized.graduationState ?? normalized.graduation_state,
    {
      dayRecords,
      forceGraduated: rawCurriculumStatus === CURRICULUM_STATUSES.graduated
        || normalized.terminalState === true
        || normalized.terminal_state === true,
    },
  );
  const curriculumStatus = graduationState
    ? CURRICULUM_STATUSES.graduated
    : rawCurriculumStatus;
  const terminalState = curriculumStatus === CURRICULUM_STATUSES.graduated;
  const notificationConfig = normalizeCurriculumNotificationConfig(
    normalized.notificationConfig ?? normalized.notification_config ?? base.notificationConfig,
    { terminalState },
  );

  return {
    ...base,
    ...normalized,
    schemaVersion: CURRICULUM_PROGRESS_SCHEMA_VERSION,
    updatedAt: stringOrDefault(normalized.updatedAt, base.updatedAt),
    curriculumStatus,
    curriculum_status: curriculumStatus,
    terminalState,
    terminal_state: terminalState,
    graduationState,
    graduation_state: graduationState,
    notificationConfig,
    notification_config: notificationConfig,
    weeklySummaryStack: normalizeWeeklySummaryStack(normalized.weeklySummaryStack),
    carryOverQueue,
    carry_over_queue: carryOverQueue,
    dayRecords,
    day_records: dayRecords,
    coachMarkRegistry,
    coach_mark_registry: coachMarkRegistry,
  };
}

export function isCurriculumGraduated(state = {}) {
  const raw = objectOrEmpty(state);
  return raw.curriculumStatus === CURRICULUM_STATUSES.graduated
    || raw.curriculum_status === CURRICULUM_STATUSES.graduated
    || raw.terminalState === true
    || raw.terminal_state === true
    || objectOrEmpty(raw.graduationState ?? raw.graduation_state).status === CURRICULUM_STATUSES.graduated;
}

export function isCurriculumNotificationEligible({
  progressState = {},
  day = null,
  currentDay = null,
  notificationConfig = null,
  now = new Date(),
} = {}) {
  return resolveCurriculumNotificationEligibility({
    progressState,
    day,
    currentDay,
    notificationConfig,
    now,
  }).eligible;
}

export function resolveCurriculumNotificationEligibility({
  progressState = {},
  day = null,
  currentDay = null,
  notificationConfig = null,
  now = new Date(),
} = {}) {
  const normalized = normalizeCurriculumProgressState(progressState);
  if (isCurriculumGraduated(normalized)) {
    return buildCurriculumNotificationEligibilityResult({
      eligible: false,
      reason: "curriculum_graduated",
    });
  }

  const config = normalizeCurriculumNotificationConfig(
    notificationConfig ?? normalized.notificationConfig ?? normalized.notification_config,
  );
  if (config.enabled !== true) {
    return buildCurriculumNotificationEligibilityResult({
      eligible: false,
      reason: "notifications_disabled",
      notificationConfig: config,
    });
  }
  if (config.permanentlyStopped === true) {
    return buildCurriculumNotificationEligibilityResult({
      eligible: false,
      reason: "notifications_permanently_stopped",
      notificationConfig: config,
    });
  }

  if (isSameUtcDate(config.lastSent ?? config.last_sent, now)) {
    return buildCurriculumNotificationEligibilityResult({
      eligible: false,
      reason: "notification_already_sent_today",
      notificationConfig: config,
    });
  }

  const targetDay = normalizeStrictOptionalDayNumber(
    day
      ?? currentDay
      ?? normalized.currentDay
      ?? normalized.current_day
      ?? normalized.selectedDay
      ?? normalized.selected_day,
  );
  if (!targetDay) {
    return buildCurriculumNotificationEligibilityResult({
      eligible: false,
      reason: "invalid_day",
      notificationConfig: config,
    });
  }

  const activeDay = normalizeStrictOptionalDayNumber(
    normalized.currentDay
      ?? normalized.current_day
      ?? normalized.selectedDay
      ?? normalized.selected_day
      ?? currentDay,
  ) ?? targetDay;
  if (targetDay > activeDay) {
    return buildCurriculumNotificationEligibilityResult({
      eligible: false,
      reason: "day_not_unlocked",
      day: targetDay,
      currentDay: activeDay,
      notificationConfig: config,
    });
  }

  const dayRecord = normalizeDayProgressRecords(normalized.dayRecords ?? normalized.day_records)
    .find((record) => record.day === targetDay);
  if (dayRecord?.completionConfirmed === true || dayRecord?.completed === true) {
    return buildCurriculumNotificationEligibilityResult({
      eligible: false,
      reason: "day_already_complete",
      day: targetDay,
      currentDay: activeDay,
      dayRecord,
      notificationConfig: config,
    });
  }

  return buildCurriculumNotificationEligibilityResult({
    eligible: true,
    reason: "day_incomplete_notifications_enabled",
    day: targetDay,
    currentDay: activeDay,
    dayRecord,
    notificationConfig: config,
  });
}

export function recordDayTypeFirstEncounter(
  state = {},
  {
    dayType = "",
    curriculumDay = null,
    day = null,
    encounteredAt = new Date(),
  } = {},
) {
  const normalized = normalizeCurriculumProgressState(state);
  const targetDayType = normalizeCurriculumDayType(
    dayType
      || curriculumDay?.dayType
      || curriculumDay?.day_type
      || (day ? defaultDayTypeForDay(day) : ""),
  );
  if (!targetDayType) {
    return {
      state: normalized,
      dayType: "",
      day_type: "",
      firstEncounter: false,
      first_encounter: false,
      isFirstEncounter: false,
      is_first_encounter: false,
      shouldShowCoachMark: false,
      should_show_coach_mark: false,
    };
  }

  const timestamp = toIso(encounteredAt);
  const registry = normalizeCoachMarkRegistry(normalized.coachMarkRegistry);
  const existing = registry.dayTypeFirstEncounters[targetDayType];
  const firstEncounter = existing?.encountered !== true;
  const encounterRecord = firstEncounter
    ? {
        dayType: targetDayType,
        day_type: targetDayType,
        encountered: true,
        firstEncounteredAt: timestamp,
        first_encountered_at: timestamp,
      }
    : existing;
  const coachMarkRegistry = normalizeCoachMarkRegistry({
    ...registry,
    dayTypeFirstEncounters: {
      ...registry.dayTypeFirstEncounters,
      [targetDayType]: encounterRecord,
    },
  });
  const nextState = normalizeCurriculumProgressState({
    ...normalized,
    updatedAt: firstEncounter ? timestamp : normalized.updatedAt,
    coachMarkRegistry,
    coach_mark_registry: coachMarkRegistry,
  });
  const coachMarkContent = firstEncounter
    ? resolveCurriculumDayTypeCoachMarkContent({
        dayType: targetDayType,
        curriculumDay,
        day,
        shouldShowCoachMark: true,
        resolvedAt: timestamp,
      })
    : null;

  return {
    state: nextState,
    dayType: targetDayType,
    day_type: targetDayType,
    firstEncounter,
    first_encounter: firstEncounter,
    isFirstEncounter: firstEncounter,
    is_first_encounter: firstEncounter,
    shouldShowCoachMark: firstEncounter,
    should_show_coach_mark: firstEncounter,
    coachMarkContent,
    coach_mark_content: coachMarkContent,
  };
}

export function resolveCurriculumDayTypeCoachMarkPresentation(
  state = {},
  {
    dayType = "",
    curriculumDay = null,
    day = null,
    presentedAt = new Date(),
  } = {},
) {
  const encounter = recordDayTypeFirstEncounter(state, {
    dayType,
    curriculumDay,
    day,
    encounteredAt: presentedAt,
  });
  const content = encounter.coachMarkContent;
  if (!encounter.shouldShowCoachMark || !content?.didResolve || !content.coachMark) {
    return {
      state: encounter.state,
      dayType: encounter.dayType,
      day_type: encounter.dayType,
      didPresent: false,
      did_present: false,
      shouldShowCoachMark: false,
      should_show_coach_mark: false,
      reason: encounter.dayType ? "day_type_already_encountered" : "unsupported_day_type",
      presentation: null,
    };
  }

  const coachMark = content.coachMark;
  const presentation = {
    schemaVersion: coachMark.schemaVersion,
    presentationId: `${coachMark.coachMarkId}:${encounter.dayType}`,
    presentation_id: `${coachMark.coachMarkId}:${encounter.dayType}`,
    dayType: encounter.dayType,
    day_type: encounter.dayType,
    dayId: coachMark.dayId,
    day_id: coachMark.dayId,
    mode: "just_in_time_first_encounter",
    active: true,
    coachMark,
    coach_mark: coachMark,
    overlay: {
      ...coachMark.overlay,
      active: true,
      presentationMode: "just_in_time",
      presentation_mode: "just_in_time",
    },
    assistantMessage: coachMark.assistantMessage,
    assistant_message: coachMark.assistantMessage,
    targetElementId: coachMark.targetElementId,
    target_element_id: coachMark.targetElementId,
    presentedAt: toIso(presentedAt),
    presented_at: toIso(presentedAt),
  };

  return {
    state: encounter.state,
    dayType: encounter.dayType,
    day_type: encounter.dayType,
    didPresent: true,
    did_present: true,
    shouldShowCoachMark: true,
    should_show_coach_mark: true,
    reason: "first_day_type_encounter",
    presentation,
  };
}

export function resolveCurriculumDayTypeCoachMarkContent({
  dayType = "",
  curriculumDay = null,
  day = null,
  shouldShowCoachMark = true,
  resolvedAt = new Date(),
} = {}) {
  const normalizedDay = normalizeCurriculumCoachMarkDay(curriculumDay, day);
  const targetDayType = normalizeCurriculumDayType(
    dayType
      || normalizedDay.dayType
      || (normalizedDay.dayId ? defaultDayTypeForDay(normalizedDay.dayId) : ""),
  );

  if (!targetDayType || shouldShowCoachMark === false) {
    return {
      didResolve: false,
      did_resolve: false,
      reason: shouldShowCoachMark === false ? "coach_mark_not_requested" : "unsupported_day_type",
      dayType: targetDayType,
      day_type: targetDayType,
      coachMark: null,
      coach_mark: null,
    };
  }

  if (![
    CURRICULUM_DAY_TYPES.interview,
    CURRICULUM_DAY_TYPES.action,
    CURRICULUM_DAY_TYPES.review,
    CURRICULUM_DAY_TYPES.education,
  ].includes(targetDayType)) {
    return {
      didResolve: false,
      did_resolve: false,
      reason: "content_not_authored_for_day_type",
      dayType: targetDayType,
      day_type: targetDayType,
      coachMark: null,
      coach_mark: null,
    };
  }

  const authoredContent = targetDayType === CURRICULUM_DAY_TYPES.action
    ? {
        coachMarkId: "day-type-action-auto-verify-evidence",
        targetElementId: "workspace.action.autoVerification",
        title: "Action Day",
        headline: "자동 확인으로 실행 증거를 남겨요",
        body: [
          "먼저 MCP, CLI, Browser Tool, Google Docs/Sheets로 오늘 실행 결과를 자동 확인해보세요.",
          "확인이 안 되면 링크나 파일 증거를 붙이면 되고, 미완료여도 다음 Day 진행은 막지 않습니다.",
        ].join(" "),
        actionLabel: "자동 확인 시작하기",
        layout: "action_auto_verify_evidence",
        configurationExtra: {
          autoVerificationFirst: true,
          auto_verification_first: true,
          preferredVerificationOrder: ["mcp", "cli", "browser", "google_docs", "google_sheets"],
          preferred_verification_order: ["mcp", "cli", "browser", "google_docs", "google_sheets"],
          evidenceFallbackEnabled: true,
          evidence_fallback_enabled: true,
          evidenceFallbackTypes: ["link", "file"],
          evidence_fallback_types: ["link", "file"],
          carryOverOnInsufficient: true,
          carry_over_on_insufficient: true,
        },
      }
    : targetDayType === CURRICULUM_DAY_TYPES.review
      ? {
          coachMarkId: "day-type-review-summary-dashboard",
          targetElementId: "workspace.review.summaryDashboard",
          title: "Review Day",
          headline: "요약과 대시보드로 다음 7일을 고릅니다",
          body: [
            "Agent Summary에서 지난 7일의 답변, 실행 증거, 미완료 carry-over를 먼저 확인해보세요.",
            "Dashboard는 속도와 완료 상태에 맞춰 성취 요약 또는 감속 코칭으로 다음 행동을 정리합니다.",
          ].join(" "),
          actionLabel: "Review 확인하기",
          layout: "review_agent_summary_dashboard",
          configurationExtra: {
            summaryFirst: true,
            summary_first: true,
            dashboardVisible: true,
            dashboard_visible: true,
            paceAdjustedTone: true,
            pace_adjusted_tone: true,
            reviewDayIds: [7, 14, 21, 28],
            review_day_ids: [7, 14, 21, 28],
            weeklySummaryStackRequired: true,
            weekly_summary_stack_required: true,
            actionItemsVisible: true,
            action_items_visible: true,
          },
        }
      : targetDayType === CURRICULUM_DAY_TYPES.education
        ? {
            coachMarkId: "day-type-education-interactive-worksheet",
            targetElementId: "workspace.education.interactiveWorksheet",
            title: "Education Day",
            headline: "프레임워크를 내 문장으로 바꿔요",
            body: [
              "짧은 개념을 읽고 빈칸 워크시트에 내 제품 상황을 바로 넣어보세요.",
              "모든 필수 칸을 채우면 적용 피드백이 나오고, 다음 Action Day에서 쓸 실행 기준으로 이어집니다.",
            ].join(" "),
            actionLabel: "워크시트 시작하기",
            layout: "education_interactive_worksheet",
            configurationExtra: {
              worksheetFirst: true,
              worksheet_first: true,
              fillInTheBlankEnabled: true,
              fill_in_the_blank_enabled: true,
              frameworkFeedbackEnabled: true,
              framework_feedback_enabled: true,
              completionRequiresRequiredBlanks: true,
              completion_requires_required_blanks: true,
              nextActionApplicationVisible: true,
              next_action_application_visible: true,
            },
          }
        : {
            coachMarkId: "day-type-interview-card-conversation",
            targetElementId: "workspace.chat.structuredPrompt",
            title: "Interview Day",
            headline: "카드 대화로 실제 행동을 좁혀요",
            body: [
              "질문마다 한 사람의 어제 행동, 현재 대안, 막힌 지점을 짧게 답해보세요.",
              "이 답변은 연습이 아니라 다음 Review와 적응형 코칭에 그대로 쓰입니다.",
            ].join(" "),
            actionLabel: "답변 시작하기",
            layout: "interview_card_conversation",
            configurationExtra: {
              autoDismissOnAnswer: true,
              auto_dismiss_on_answer: true,
            },
          };
  const {
    coachMarkId,
    targetElementId,
    title,
    headline,
    body,
    actionLabel,
    layout,
    configurationExtra,
  } = authoredContent;
  const coachMark = {
    schemaVersion: CURRICULUM_DAY_TYPE_COACH_MARK_SCHEMA_VERSION,
    coachMarkId,
    coach_mark_id: coachMarkId,
    dayType: targetDayType,
    day_type: targetDayType,
    dayId: normalizedDay.dayId,
    day_id: normalizedDay.dayId,
    title,
    headline,
    body,
    actionLabel,
    action_label: actionLabel,
    targetElementId,
    target_element_id: targetElementId,
    assistantMessage: {
      role: "assistant",
      tone: "friendly_senior",
      content: `${headline}\n${body}`,
    },
    assistant_message: {
      role: "assistant",
      tone: "friendly_senior",
      content: `${headline}\n${body}`,
    },
    overlay: {
      mode: "first_encounter",
      blocking: false,
      dimNonTargetAreas: false,
      dim_non_target_areas: false,
      highlightTarget: true,
      highlight_target: true,
      dismissible: true,
      skipAvailable: true,
      skip_available: true,
      skipEffect: "dismiss_coach_mark_only",
      skip_effect: "dismiss_coach_mark_only",
      targetElementId,
      target_element_id: targetElementId,
    },
    configuration: {
      layout,
      placement: "near_target",
      targetElementId,
      target_element_id: targetElementId,
      showOncePerDayType: true,
      show_once_per_day_type: true,
      blocksProgression: false,
      blocks_progression: false,
      progressionGuardActive: false,
      progression_guard_active: false,
      ...configurationExtra,
    },
  };

  return {
    didResolve: true,
    did_resolve: true,
    reason: "resolved",
    dayType: targetDayType,
    day_type: targetDayType,
    resolvedAt: toIso(resolvedAt),
    resolved_at: toIso(resolvedAt),
    coachMark,
    coach_mark: coachMark,
  };
}

export function applyCurriculumProgressEvent(
  state = {},
  event = {},
  { now = new Date() } = {},
) {
  const normalized = normalizeCurriculumProgressState(state);
  const progressEvent = objectOrEmpty(event);
  const eventType = normalizeProgressEventType(
    progressEvent.eventType
      ?? progressEvent.event_type
      ?? progressEvent.type,
  );
  const dayId = normalizeOptionalDayNumber(
    progressEvent.day
      ?? progressEvent.dayId
      ?? progressEvent.day_id,
  );
  if (!dayId || !eventType) {
    return normalized;
  }

  const timestamp = toIso(progressEvent.occurredAt ?? progressEvent.occurred_at ?? now);
  const records = normalizeDayProgressRecords(normalized.dayRecords);
  const existing = records.find((record) => record.day === dayId) ?? null;
  const existingCompletionConfirmed = existing?.completionConfirmed === true;
  const partialDay1TaskProgressEvent = isPartialDay1TaskProgressEvent({
    dayId,
    eventType,
    event: progressEvent,
  });
  const completionEvent = isDayCompletionConfirmationEvent({ dayId, eventType }) && !partialDay1TaskProgressEvent;
  const progressionGate = completionEvent
    ? evaluateProgressionGateForDay({
        progressState: normalized,
        dayRecord: existing,
        event: progressEvent,
        day: dayId,
      })
    : null;
  const completionBlockedByGate = progressionGate?.blocked === true;
  const lifecycleOnlyEvent = partialDay1TaskProgressEvent;
  const completionConfirmed = lifecycleOnlyEvent
    ? existingCompletionConfirmed
    : existingCompletionConfirmed || (completionEvent && !completionBlockedByGate);
  const questionProgressPatches = buildDayQuestionProgressPatches({
    dayId,
    eventType,
    event: progressEvent,
    timestamp,
    existingQuestionProgress: existing?.questionProgress ?? existing?.question_progress,
  });
  const questionProgress = questionProgressPatches.length
    ? mergeDayQuestionProgress(
        existing?.questionProgress ?? existing?.question_progress,
        questionProgressPatches,
      )
    : normalizeDayQuestionProgress(existing?.questionProgress ?? existing?.question_progress);
  const nextRecord = normalizeDayProgressRecord({
    ...existing,
    day: dayId,
    dayId,
    day_id: dayId,
    dayType: stringOrDefault(
      progressEvent.dayType
        ?? progressEvent.day_type
        ?? existing?.dayType
        ?? existing?.day_type,
      "",
    ),
    updatedAt: timestamp,
    updated_at: timestamp,
    startedAt: stringOrDefault(
      existing?.startedAt
        ?? existing?.started_at
        ?? (isDayStartEvent(eventType) ? timestamp : ""),
      "",
    ),
    started_at: stringOrDefault(
      existing?.startedAt
        ?? existing?.started_at
        ?? (isDayStartEvent(eventType) ? timestamp : ""),
      "",
    ),
    completionConfirmed,
    completion_confirmed: completionConfirmed,
    completed: completionConfirmed,
    completedAt: completionConfirmed
      ? stringOrDefault(existing?.completedAt ?? existing?.completed_at, timestamp)
      : "",
    completed_at: completionConfirmed
      ? stringOrDefault(existing?.completedAt ?? existing?.completed_at, timestamp)
      : "",
    lifecycleEvents: appendDayLifecycleEvent(existing?.lifecycleEvents ?? existing?.lifecycle_events, {
      type: eventType,
      occurredAt: timestamp,
      completionDriver: completionEvent && !lifecycleOnlyEvent && !completionBlockedByGate,
    }),
    ...(progressionGate
      ? {
          progressionGate,
          progression_gate: progressionGate,
          progressionBlocked: completionBlockedByGate,
          progression_blocked: completionBlockedByGate,
          blocked: completionBlockedByGate,
          currentDayBlocked: completionBlockedByGate,
          current_day_blocked: completionBlockedByGate,
          blockedReason: completionBlockedByGate ? "curriculum_progression_gate_blocked" : "",
          blocked_reason: completionBlockedByGate ? "curriculum_progression_gate_blocked" : "",
        }
      : {}),
    ...(questionProgress.length
      ? {
          questionProgress,
          question_progress: questionProgress,
        }
      : {}),
  });
  const dayRecords = records
    .filter((record) => record.day !== dayId)
    .concat(nextRecord)
    .sort((a, b) => a.day - b.day);
  const graduationPatch = dayId === DAY_COUNT && completionConfirmed
    ? buildCurriculumGraduationPatch({
        dayRecord: nextRecord,
        graduatedAt: nextRecord.completedAt || timestamp,
      })
    : {};

  return normalizeCurriculumProgressState({
    ...normalized,
    updatedAt: timestamp,
    dayRecords,
    day_records: dayRecords,
    ...graduationPatch,
  });
}

export function assembleCurriculumDayContext({
  day = 1,
  progressState = {},
  projectContext = null,
  currentWeekRawAnswers = null,
  dayRecords = [],
  now = new Date(),
} = {}) {
  const targetDay = normalizeDayNumber(day);
  const weekNumber = weekNumberForDay(targetDay);
  const previousCompletedWeekCount = Math.min(weekNumber - 1, FINAL_COMPACTED_WEEK);
  const progress = normalizeCurriculumProgressState(progressState);
  const priorWeeklySummaries = progress.weeklySummaryStack
    .filter((entry) =>
      entry.status === "finalized"
      && entry.weekNumber >= 1
      && entry.weekNumber <= previousCompletedWeekCount
    )
    .sort((a, b) => a.weekNumber - b.weekNumber);
  const includedWeeks = priorWeeklySummaries.map((entry) => entry.weekNumber);
  const missingFinalizedWeeks = Array.from(
    { length: previousCompletedWeekCount },
    (_, index) => index + 1,
  ).filter((week) => !includedWeeks.includes(week));
  const currentWeekRange = dayRangeForWeek(weekNumber);
  const effectiveRawAnswers = currentWeekRawAnswers ?? selectRawAnswerSource(progress);
  const rawAnswers = normalizeCurrentWeekRawAnswers({
    currentWeekRawAnswers: effectiveRawAnswers,
    dayRecords,
    currentWeekRange,
  });
  const effectiveProjectContext = projectContext ?? selectProjectContextSource(progress);
  const carryOverCoaching = identifyCarriedOverIncompleteActionsForCoaching({
    progressState: progress,
    currentDay: targetDay,
    now,
  });
  const coachingFeedbackSurface = surfaceCurriculumCoachingFeedback({
    coachingFeedback: carryOverCoaching,
    currentDay: targetDay,
    generatedAt: now,
  });
  const prerequisiteRequirements = buildPrerequisiteRequirementsFromCarryOver({
    carryOverCoaching,
    currentDay: targetDay,
    generatedAt: now,
  });
  const tooFastProgression = detectTooFastProgression({
    progressState: progress,
    dayRecords: dayRecords.length ? dayRecords : progress.dayRecords,
    currentDay: targetDay,
    now,
  });
  const lowQualityProgression = detectLowQualityProgression({
    progressState: progress,
    dayRecords: dayRecords.length ? dayRecords : progress.dayRecords,
    currentDay: targetDay,
    now,
  });
  const rushingRisk = classifyRushingRisk({
    tooFastProgression,
    lowQualityProgression,
    currentDay: targetDay,
    now,
  });
  const rushingPrerequisiteRequirements = buildPrerequisiteRequirementsFromTooFastProgression({
    tooFastProgression: rushingRisk.rushing_risk_detected ? rushingRisk : tooFastProgression,
    progressState: progress,
    dayRecords: dayRecords.length ? dayRecords : progress.dayRecords,
    currentDay: targetDay,
    generatedAt: now,
  });
  const adaptivePrerequisiteRequirements = mergePrerequisiteRequirementPayloads(
    prerequisiteRequirements,
    rushingPrerequisiteRequirements,
    { currentDay: targetDay, generatedAt: now },
  );

  return {
    day: targetDay,
    weekNumber,
    currentWeekRange,
    priorWeeklySummaries,
    weeklySummaryStack: priorWeeklySummaries,
    includedWeeks,
    missingFinalizedWeeks,
    projectContext: normalizeProjectContext(effectiveProjectContext),
    currentWeekRawAnswers: rawAnswers,
    currentWeekRawInterviewAnswers: rawAnswers,
    carryOverCoaching,
    carry_over_coaching: carryOverCoaching,
    coachingFeedbackSurface,
    coaching_feedback_surface: coachingFeedbackSurface,
    tooFastProgression,
    too_fast_progression: tooFastProgression,
    lowQualityProgression,
    low_quality_progression: lowQualityProgression,
    rushingRisk,
    rushing_risk: rushingRisk,
    adaptiveDifficultyState: rushingRisk.rushingRiskDetected
      ? rushingRisk.adaptiveDifficultyState
      : lowQualityProgression.adaptiveDifficultyState,
    adaptive_difficulty_state: rushingRisk.rushing_risk_detected
      ? rushingRisk.adaptive_difficulty_state
      : lowQualityProgression.adaptive_difficulty_state,
    prerequisiteRequirements: adaptivePrerequisiteRequirements,
    prerequisite_requirements: adaptivePrerequisiteRequirements,
    contextOrder: [
      ...priorWeeklySummaries.map((entry) => `week_${entry.weekNumber}_summary`),
      "project_context",
      "carry_over_coaching",
      "rushing_risk",
      "adaptive_difficulty_state",
      "prerequisite_requirements",
      "coaching_feedback_surface",
      "current_week_raw_answers",
    ],
  };
}

export function buildCurriculumProviderContextPayload({
  day = 1,
  curriculumDay = null,
  context = null,
  progressState = {},
  projectContext = null,
  currentWeekRawAnswers = null,
  dayRecords = [],
  generatedAt = new Date(),
} = {}) {
  const targetDay = normalizeDayNumber(day ?? curriculumDay?.day ?? curriculumDay?.dayId ?? curriculumDay?.day_id);
  const assembled = context ?? assembleCurriculumDayContext({
    day: targetDay,
    progressState,
    projectContext,
    currentWeekRawAnswers,
    dayRecords,
    now: generatedAt,
  });
  const selectedWeeklySummaries = assembled.priorWeeklySummaries.map(normalizeProviderWeeklySummary);
  const rawAnswers = assembled.currentWeekRawAnswers.map(normalizeProviderRawAnswer);
  const normalizedProjectContext = normalizeProjectContext(assembled.projectContext ?? projectContext);
  const contextBlocks = [
    ...selectedWeeklySummaries.map((summary) => ({
      id: `week_${summary.week_number}_summary`,
      type: "weekly_summary",
      week_number: summary.week_number,
      day_range: summary.day_range,
      content: summary.summary_text,
      key_insights: summary.key_insights,
      unresolved_actions: summary.unresolved_actions,
    })),
    {
      id: "project_context",
      type: "project_context",
      content: normalizedProjectContext,
    },
    {
      id: "carry_over_coaching",
      type: "carry_over_coaching",
      content: assembled.carryOverCoaching ?? assembled.carry_over_coaching ?? identifyCarriedOverIncompleteActionsForCoaching({
        progressState,
        currentDay: targetDay,
        now: generatedAt,
      }),
    },
    {
      id: "rushing_risk",
      type: "rushing_risk",
      content: assembled.rushingRisk ?? assembled.rushing_risk ?? classifyRushingRisk({
        tooFastProgression: assembled.tooFastProgression ?? assembled.too_fast_progression,
        lowQualityProgression: assembled.lowQualityProgression ?? assembled.low_quality_progression,
        currentDay: targetDay,
        now: generatedAt,
      }),
    },
    {
      id: "adaptive_difficulty_state",
      type: "adaptive_difficulty_state",
      content: assembled.adaptiveDifficultyState
        ?? assembled.adaptive_difficulty_state
        ?? detectTooFastProgression({
          progressState,
          dayRecords,
          currentDay: targetDay,
          now: generatedAt,
        }).adaptiveDifficultyState,
    },
    {
      id: "prerequisite_requirements",
      type: "prerequisite_requirements",
      content: assembled.prerequisiteRequirements ?? assembled.prerequisite_requirements ?? buildPrerequisiteRequirementsFromCarryOver({
        carryOverCoaching: assembled.carryOverCoaching ?? assembled.carry_over_coaching,
        progressState,
        currentDay: targetDay,
        generatedAt,
      }),
    },
    {
      id: "coaching_feedback_surface",
      type: "non_blocking_coaching_feedback",
      content: assembled.coachingFeedbackSurface ?? assembled.coaching_feedback_surface ?? surfaceCurriculumCoachingFeedback({
        coachingFeedback: assembled.carryOverCoaching ?? assembled.carry_over_coaching,
        currentDay: targetDay,
        generatedAt,
      }),
    },
    {
      id: "current_week_raw_answers",
      type: "current_week_raw_answers",
      day_range: normalizeProviderDayRange(assembled.currentWeekRange),
      answers: rawAnswers,
    },
  ];

  return {
    schemaVersion: CURRICULUM_PROVIDER_CONTEXT_SCHEMA_VERSION,
    schema: "agentic30.curriculum.provider_context.v1",
    generatedAt: toIso(generatedAt),
    dayId: targetDay,
    day_id: targetDay,
    dayType: stringOrDefault(curriculumDay?.dayType ?? curriculumDay?.day_type ?? curriculumDay?.phase, ""),
    day_type: stringOrDefault(curriculumDay?.dayType ?? curriculumDay?.day_type ?? curriculumDay?.phase, ""),
    dayGoal: stringOrDefault(curriculumDay?.goal ?? curriculumDay?.title, ""),
    day_goal: stringOrDefault(curriculumDay?.goal ?? curriculumDay?.title, ""),
    curriculumWeek: assembled.weekNumber,
    curriculum_week: assembled.weekNumber,
    currentWeekRange: assembled.currentWeekRange,
    current_week_range: normalizeProviderDayRange(assembled.currentWeekRange),
    selectedWeeklySummaries,
    selected_weekly_summaries: selectedWeeklySummaries,
    currentWeekRawAnswers: rawAnswers,
    current_week_raw_answers: rawAnswers,
    currentWeekRawInterviewAnswers: rawAnswers,
    current_week_raw_interview_answers: rawAnswers,
    projectContext: normalizedProjectContext,
    project_context: normalizedProjectContext,
    carryOverCoaching: assembled.carryOverCoaching ?? assembled.carry_over_coaching ?? null,
    carry_over_coaching: assembled.carryOverCoaching ?? assembled.carry_over_coaching ?? null,
    adaptiveDifficultyState: assembled.adaptiveDifficultyState ?? assembled.adaptive_difficulty_state ?? null,
    adaptive_difficulty_state: assembled.adaptiveDifficultyState ?? assembled.adaptive_difficulty_state ?? null,
    tooFastProgression: assembled.tooFastProgression ?? assembled.too_fast_progression ?? null,
    too_fast_progression: assembled.tooFastProgression ?? assembled.too_fast_progression ?? null,
    lowQualityProgression: assembled.lowQualityProgression ?? assembled.low_quality_progression ?? null,
    low_quality_progression: assembled.lowQualityProgression ?? assembled.low_quality_progression ?? null,
    rushingRisk: assembled.rushingRisk ?? assembled.rushing_risk ?? null,
    rushing_risk: assembled.rushingRisk ?? assembled.rushing_risk ?? null,
    coachingFeedbackSurface: assembled.coachingFeedbackSurface ?? assembled.coaching_feedback_surface ?? null,
    coaching_feedback_surface: assembled.coachingFeedbackSurface ?? assembled.coaching_feedback_surface ?? null,
    prerequisiteRequirements: assembled.prerequisiteRequirements ?? assembled.prerequisite_requirements ?? null,
    prerequisite_requirements: assembled.prerequisiteRequirements ?? assembled.prerequisite_requirements ?? null,
    missingFinalizedWeeks: assembled.missingFinalizedWeeks,
    missing_finalized_weeks: assembled.missingFinalizedWeeks,
    contextOrder: assembled.contextOrder,
    context_order: assembled.contextOrder,
    contextBlocks,
    context_blocks: contextBlocks,
  };
}

export function buildCurriculumCoachingFeedbackSurface(options = {}) {
  return surfaceCurriculumCoachingFeedback(options);
}

export function resolveReviewDayEligibleDayRange(options = {}) {
  const source = objectOrEmpty(options);
  const targetDay = normalizeOptionalDayNumber(
    source.reviewDay
      ?? source.review_day
      ?? source.day
      ?? (typeof options === "number" || typeof options === "string" ? options : null),
  );
  const configuredReviewDays = normalizeConfiguredReviewDayIds(
    source.reviewDayIds
      ?? source.review_day_ids
      ?? source.configuredReviewDays
      ?? source.configured_review_days
      ?? source.curriculumDays
      ?? source.curriculum_days
      ?? source.curriculum,
  );
  const matchedIndex = configuredReviewDays.indexOf(targetDay);
  const isReviewDay = matchedIndex >= 0;
  const previousReviewDay = isReviewDay && matchedIndex > 0
    ? configuredReviewDays[matchedIndex - 1]
    : null;
  const nextReviewDay = isReviewDay && matchedIndex < configuredReviewDays.length - 1
    ? configuredReviewDays[matchedIndex + 1]
    : null;
  const dayRange = isReviewDay
    ? {
        start: previousReviewDay ? previousReviewDay + 1 : 1,
        end: targetDay,
      }
    : null;

  return {
    reviewDay: targetDay,
    review_day: targetDay,
    isReviewDay,
    is_review_day: isReviewDay,
    eligible: isReviewDay,
    configuredReviewDayIds: configuredReviewDays,
    configured_review_day_ids: configuredReviewDays,
    previousReviewDay,
    previous_review_day: previousReviewDay,
    nextReviewDay,
    next_review_day: nextReviewDay,
    dayRange,
    day_range: dayRange,
    basis: "configured_review_day_sequence",
  };
}

export function buildPrerequisiteRequirementsFromCarryOver({
  progressState = {},
  carryOverCoaching = null,
  carryOverItems = null,
  currentDay = null,
  generatedAt = new Date(),
} = {}) {
  const targetDay = normalizeOptionalDayNumber(currentDay);
  const generatedAtIso = toIso(generatedAt);
  const coaching = carryOverCoaching ?? identifyCarriedOverIncompleteActionsForCoaching({
    progressState,
    currentDay: targetDay,
    now: generatedAt,
  });
  const rawItems = Array.isArray(carryOverItems)
    ? carryOverItems
    : Array.isArray(coaching?.eligibleActions)
      ? coaching.eligibleActions
      : Array.isArray(coaching?.eligible_actions)
        ? coaching.eligible_actions
        : [];
  const requirements = rawItems
    .map((item, index) => normalizePrerequisiteRequirementFromCarryOver(item, {
      index,
      currentDay: targetDay,
      generatedAt: generatedAtIso,
    }))
    .filter(Boolean);

  return {
    schemaVersion: CURRICULUM_PREREQUISITE_REQUIREMENT_SCHEMA_VERSION,
    schema: "agentic30.curriculum.prerequisite_requirements.v1",
    currentDay: targetDay,
    current_day: targetDay,
    generatedAt: generatedAtIso,
    generated_at: generatedAtIso,
    requirementMode: "non_blocking_prerequisite",
    requirement_mode: "non_blocking_prerequisite",
    progressionBlocked: false,
    progression_blocked: false,
    blocking: false,
    hasRequirements: requirements.length > 0,
    has_requirements: requirements.length > 0,
    requirements,
    prerequisiteRequirements: requirements,
    prerequisite_requirements: requirements,
  };
}

export function detectTooFastProgression({
  progressState = {},
  dayRecords = null,
  currentDay = null,
  now = new Date(),
  thresholds = {},
} = {}) {
  const targetDay = normalizeOptionalDayNumber(currentDay);
  const progress = normalizeCurriculumProgressState(progressState);
  const records = normalizeDayProgressRecords(
    Array.isArray(dayRecords) ? dayRecords : progress.dayRecords,
  )
    .filter((record) => !targetDay || record.day < targetDay)
    .sort((a, b) => a.day - b.day);
  const completedRecords = records.filter((record) => record.completionConfirmed || record.completed);
  const config = normalizeTooFastProgressionThresholds(thresholds);
  const timing = summarizeCompletionTimingForTooFastDetection(completedRecords, config);
  const skippedSteps = summarizeSkippedStepsForTooFastDetection(records);
  const engagement = summarizeMinimumEngagementForTooFastDetection(completedRecords, config);
  const riskFactors = [
    timing.timingTooFast ? "completion_timing_too_fast" : "",
    skippedSteps.hasSkippedSteps ? "skipped_curriculum_steps" : "",
    !engagement.minimumEngagementMet ? "below_minimum_engagement_threshold" : "",
  ].filter(Boolean);
  const detected = timing.timingTooFast
    && (skippedSteps.hasSkippedSteps || !engagement.minimumEngagementMet);
  const generatedAt = toIso(now);
  const adjustmentsApplied = detected
    ? [
        "increase_prerequisite_evidence_required",
        "ask_for_one_verified_prior_action_before_quality_completion",
      ]
    : [];
  const adaptiveDifficultyState = {
    schema: "agentic30.curriculum.adaptive_difficulty_state.v1",
    direction: detected ? "up" : "none",
    trigger: detected ? "rushing" : "none",
    adjustmentsApplied,
    adjustments_applied: adjustmentsApplied,
    progressionBlocked: false,
    progression_blocked: false,
    canAdvanceDay: true,
    can_advance_day: true,
    generatedAt,
    generated_at: generatedAt,
  };

  return {
    schemaVersion: CURRICULUM_TOO_FAST_PROGRESSION_SCHEMA_VERSION,
    schema_version: CURRICULUM_TOO_FAST_PROGRESSION_SCHEMA_VERSION,
    schema: "agentic30.curriculum.too_fast_progression_detection.v1",
    generatedAt,
    generated_at: generatedAt,
    currentDay: targetDay,
    current_day: targetDay,
    detected,
    tooFastProgressionDetected: detected,
    too_fast_progression_detected: detected,
    progressionBlocked: false,
    progression_blocked: false,
    completionTiming: timing,
    completion_timing: timing,
    skippedSteps,
    skipped_steps: skippedSteps,
    engagement,
    minimumEngagement: engagement,
    minimum_engagement: engagement,
    riskFactors,
    risk_factors: riskFactors,
    adaptiveDifficultyState,
    adaptive_difficulty_state: adaptiveDifficultyState,
  };
}

export function detectLowQualityProgression({
  progressState = {},
  dayRecords = null,
  currentDay = null,
  now = new Date(),
  thresholds = {},
} = {}) {
  const targetDay = normalizeOptionalDayNumber(currentDay);
  const progress = normalizeCurriculumProgressState(progressState);
  const records = normalizeDayProgressRecords(
    Array.isArray(dayRecords) ? dayRecords : progress.dayRecords,
  )
    .filter((record) => !targetDay || record.day < targetDay)
    .sort((a, b) => a.day - b.day);
  const completedRecords = records.filter((record) => record.completionConfirmed || record.completed);
  const config = normalizeLowQualityProgressionThresholds(thresholds);
  const verificationQuality = summarizeVerificationQualityForProgression(completedRecords, config);
  const responseQuality = summarizeResponseQualityForProgression(completedRecords, config);
  const requiredArtifacts = summarizeRequiredArtifactsForProgression(completedRecords);
  const riskFactors = [
    verificationQuality.hasWeakVerificationSignals ? "failed_or_weak_verification_signal" : "",
    responseQuality.hasShallowResponses ? "shallow_response_detail" : "",
    requiredArtifacts.hasMissingRequiredArtifacts ? "missing_required_artifact" : "",
  ].filter(Boolean);
  const riskSignalCount = verificationQuality.weakVerificationSignalCount
    + responseQuality.shallowResponseCount
    + requiredArtifacts.missingRequiredArtifactCount;
  const detected = riskSignalCount >= config.minRiskSignalCount || riskFactors.length >= 2;
  const generatedAt = toIso(now);
  const adjustmentsApplied = detected
    ? [
        "reduce_next_action_scope",
        "prefer_mini_action_with_template",
        "carry_missing_artifacts_forward_non_blockingly",
      ]
    : [];
  const adaptiveDifficultyState = {
    schema: "agentic30.curriculum.adaptive_difficulty_state.v1",
    direction: detected ? "down" : "none",
    trigger: detected ? "low_quality_progression" : "none",
    adjustmentsApplied,
    adjustments_applied: adjustmentsApplied,
    progressionBlocked: false,
    progression_blocked: false,
    canAdvanceDay: true,
    can_advance_day: true,
    generatedAt,
    generated_at: generatedAt,
  };

  return {
    schemaVersion: CURRICULUM_LOW_QUALITY_PROGRESSION_SCHEMA_VERSION,
    schema_version: CURRICULUM_LOW_QUALITY_PROGRESSION_SCHEMA_VERSION,
    schema: "agentic30.curriculum.low_quality_progression_detection.v1",
    generatedAt,
    generated_at: generatedAt,
    currentDay: targetDay,
    current_day: targetDay,
    detected,
    lowQualityProgressionDetected: detected,
    low_quality_progression_detected: detected,
    progressionBlocked: false,
    progression_blocked: false,
    verificationQuality,
    verification_quality: verificationQuality,
    responseQuality,
    response_quality: responseQuality,
    requiredArtifacts,
    required_artifacts: requiredArtifacts,
    riskSignalCount,
    risk_signal_count: riskSignalCount,
    riskFactors,
    risk_factors: riskFactors,
    adaptiveDifficultyState,
    adaptive_difficulty_state: adaptiveDifficultyState,
  };
}

export function classifyRushingRisk({
  tooFastProgression = null,
  lowQualityProgression = null,
  currentDay = null,
  now = new Date(),
  thresholds = {},
} = {}) {
  const targetDay = normalizeOptionalDayNumber(
    currentDay
      ?? tooFastProgression?.currentDay
      ?? tooFastProgression?.current_day
      ?? lowQualityProgression?.currentDay
      ?? lowQualityProgression?.current_day,
  );
  const generatedAt = toIso(now);
  const config = normalizeRushingRiskThresholds(thresholds);
  const tooFast = normalizeTooFastSignalForRushing(tooFastProgression);
  const lowQuality = normalizeLowQualitySignalForRushing(lowQualityProgression);
  const combinedScore = roundNumber(
    (tooFast.score * config.tooFastWeight) + (lowQuality.score * config.lowQualityWeight),
    3,
  );
  const reasonCodes = [...tooFast.reasonCodes, ...lowQuality.reasonCodes];
  const reasons = [
    ...tooFast.reasons.map((reason) => ({ ...reason, signal: "too_fast" })),
    ...lowQuality.reasons.map((reason) => ({ ...reason, signal: "low_quality" })),
  ];
  const rushingRiskDetected = tooFast.score >= config.minTooFastScore
    && combinedScore >= config.minCombinedScore;
  const riskLevel = rushingRiskDetected
    ? combinedScore >= config.highRiskScore ? "high" : "moderate"
    : combinedScore > 0 ? "low" : "none";
  const adjustmentsApplied = rushingRiskDetected
    ? [
        "increase_prerequisite_evidence_required",
        "ask_for_one_verified_prior_action_before_quality_completion",
      ]
    : [];
  const adaptiveDifficultyState = {
    schema: "agentic30.curriculum.adaptive_difficulty_state.v1",
    direction: rushingRiskDetected ? "up" : "none",
    trigger: rushingRiskDetected ? "rushing" : "none",
    adjustmentsApplied,
    adjustments_applied: adjustmentsApplied,
    progressionBlocked: false,
    progression_blocked: false,
    canAdvanceDay: true,
    can_advance_day: true,
    generatedAt,
    generated_at: generatedAt,
  };

  return {
    schemaVersion: CURRICULUM_RUSHING_RISK_SCHEMA_VERSION,
    schema_version: CURRICULUM_RUSHING_RISK_SCHEMA_VERSION,
    schema: "agentic30.curriculum.rushing_risk.v1",
    generatedAt,
    generated_at: generatedAt,
    currentDay: targetDay,
    current_day: targetDay,
    detected: rushingRiskDetected,
    rushingRiskDetected,
    rushing_risk_detected: rushingRiskDetected,
    riskLevel,
    risk_level: riskLevel,
    riskScore: combinedScore,
    risk_score: combinedScore,
    progressionBlocked: false,
    progression_blocked: false,
    componentScores: {
      tooFast: tooFast.score,
      too_fast: tooFast.score,
      lowQuality: lowQuality.score,
      low_quality: lowQuality.score,
    },
    component_scores: {
      too_fast: tooFast.score,
      low_quality: lowQuality.score,
    },
    normalizedSignals: {
      tooFast,
      too_fast: tooFast,
      lowQuality,
      low_quality: lowQuality,
    },
    normalized_signals: {
      too_fast: tooFast,
      low_quality: lowQuality,
    },
    reasonCodes,
    reason_codes: reasonCodes,
    reasons,
    thresholds: config,
    completionTiming: tooFastProgression?.completionTiming ?? tooFastProgression?.completion_timing ?? null,
    completion_timing: tooFastProgression?.completionTiming ?? tooFastProgression?.completion_timing ?? null,
    tooFastProgression,
    too_fast_progression: tooFastProgression,
    lowQualityProgression,
    low_quality_progression: lowQualityProgression,
    adaptiveDifficultyState,
    adaptive_difficulty_state: adaptiveDifficultyState,
  };
}

export function buildPrerequisiteRequirementsFromTooFastProgression({
  tooFastProgression = null,
  progressState = {},
  dayRecords = null,
  currentDay = null,
  generatedAt = new Date(),
} = {}) {
  const detection = objectOrEmpty(tooFastProgression);
  const adaptiveState = objectOrEmpty(detection.adaptiveDifficultyState ?? detection.adaptive_difficulty_state);
  const targetDay = normalizeOptionalDayNumber(currentDay ?? detection.currentDay ?? detection.current_day);
  const generatedAtIso = toIso(generatedAt);
  const shouldRequire = detection.detected === true
    || detection.tooFastProgressionDetected === true
    || adaptiveState.trigger === "rushing";
  const latestCompletedDay = normalizeOptionalDayNumber(
    detection.completionTiming?.latestCompletedDay
      ?? detection.completion_timing?.latest_completed_day,
  );
  const prerequisiteAction = findRushingPrerequisiteActionCandidate({
    detection,
    progressState,
    dayRecords,
    targetDay,
  });
  const sourceDay = prerequisiteAction?.sourceDay ?? latestCompletedDay;
  const sourceActionId = prerequisiteAction?.actionId ?? `rushing-quality-check-day-${latestCompletedDay || targetDay - 1}`;
  const actionDescription = prerequisiteAction?.actionDescription
    ?? "Before treating this Day as high quality, verify one prerequisite action or expand one thin answer from the rushed block.";
  const completionSignal = prerequisiteAction?.completionSignal
    ?? "One prior action has accepted evidence, or one rushed answer is expanded with concrete customer/action detail.";
  const requirements = shouldRequire && targetDay
    ? [
        normalizeCurriculumPrerequisiteRequirement({
          requirementId: `day-${targetDay}-rushing-prerequisite-evidence`,
          requirement_id: `day-${targetDay}-rushing-prerequisite-evidence`,
          requirementType: "rushing_minimum_engagement",
          requirement_type: "rushing_minimum_engagement",
          requirementMode: "non_blocking_prerequisite",
          requirement_mode: "non_blocking_prerequisite",
          sourceDay,
          source_day: sourceDay,
          sourceActionId,
          source_action_id: sourceActionId,
          actionId: sourceActionId,
          action_id: sourceActionId,
          targetDay,
          target_day: targetDay,
          currentDay: targetDay,
          current_day: targetDay,
          actionDescription,
          action_description: actionDescription,
          completionSignal,
          completion_signal: completionSignal,
          ...(prerequisiteAction?.verificationMethod ? {
            verificationMethod: prerequisiteAction.verificationMethod,
            verification_method: prerequisiteAction.verificationMethod,
          } : {}),
          ...(prerequisiteAction?.evidenceType ? {
            evidenceType: prerequisiteAction.evidenceType,
            evidence_type: prerequisiteAction.evidenceType,
          } : {}),
          requiredBefore: "day_quality_completion",
          required_before: "day_quality_completion",
          requiredForQualityGate: true,
          required_for_quality_gate: true,
          progressionBlocked: false,
          progression_blocked: false,
          blocking: false,
          canAdvanceDay: true,
          can_advance_day: true,
          source: "too_fast_progression",
          prerequisiteActionGenerated: Boolean(prerequisiteAction),
          prerequisite_action_generated: Boolean(prerequisiteAction),
          actionSpec: prerequisiteAction?.actionSpec ?? null,
          action_spec: prerequisiteAction?.actionSpec ?? null,
          rushingDetection: detection,
          rushing_detection: detection,
          generatedAt: generatedAtIso,
          generated_at: generatedAtIso,
        }, {
          currentDay: targetDay,
          generatedAt: generatedAtIso,
          source: "too_fast_progression",
        }),
      ].filter(Boolean)
    : [];

  return {
    schemaVersion: CURRICULUM_PREREQUISITE_REQUIREMENT_SCHEMA_VERSION,
    schema: "agentic30.curriculum.prerequisite_requirements.v1",
    currentDay: targetDay,
    current_day: targetDay,
    generatedAt: generatedAtIso,
    generated_at: generatedAtIso,
    requirementMode: "non_blocking_prerequisite",
    requirement_mode: "non_blocking_prerequisite",
    progressionBlocked: false,
    progression_blocked: false,
    blocking: false,
    hasRequirements: requirements.length > 0,
    has_requirements: requirements.length > 0,
    requirements,
    prerequisiteRequirements: requirements,
    prerequisite_requirements: requirements,
  };
}

function findRushingPrerequisiteActionCandidate({
  detection = {},
  progressState = {},
  dayRecords = null,
  targetDay = null,
} = {}) {
  const progress = normalizeCurriculumProgressState(progressState);
  const records = normalizeDayProgressRecords(
    Array.isArray(dayRecords) ? dayRecords : progress.dayRecords,
  )
    .filter((record) => {
      if (targetDay && record.day >= targetDay) return false;
      const dayType = normalizeCurriculumDayType(record.dayType ?? record.day_type)
        || defaultDayTypeForDay(record.day);
      return dayType === CURRICULUM_DAY_TYPES.action;
    });
  const scoredCandidates = records.flatMap((record) =>
    extractLowQualityActionEntries(record).map((entry, index) =>
      normalizeRushingPrerequisiteActionCandidate(entry, {
        record,
        index,
        detection,
      }),
    ).filter(Boolean)
  );

  return scoredCandidates.sort((a, b) =>
    b.priority - a.priority
    || b.sourceDay - a.sourceDay
    || String(a.actionId).localeCompare(String(b.actionId))
  )[0] ?? null;
}

function normalizeRushingPrerequisiteActionCandidate(entry = {}, {
  record = {},
  index = 0,
  detection = {},
} = {}) {
  const sourceDay = normalizeOptionalDayNumber(record.day);
  const actionId = actionIdForLowQualityEntry(entry, record, index);
  const completionSignal = stringOrDefault(
    entry.completionSignal
      ?? entry.completion_signal
      ?? requiredArtifactLabelForAction(entry, record),
    "",
  );
  const actionDescription = stringOrDefault(
    entry.actionDescription
      ?? entry.action_description
      ?? entry.description
      ?? entry.task
      ?? entry.template,
    completionSignal
      ? `Complete the Day ${sourceDay} action with proof: ${completionSignal}`
      : `Complete one concrete Day ${sourceDay} action with acceptable evidence.`,
  );
  const verificationState = objectOrEmpty(entry.verificationState ?? entry.verification_state);
  const verificationResult = objectOrEmpty(
    entry.verificationResult
      ?? entry.verification_result
      ?? verificationState.verificationResult
      ?? verificationState.verification_result,
  );
  const verificationMethod = stringOrDefault(
    entry.verificationMethod
      ?? entry.verification_method
      ?? verificationResult.method
      ?? verificationState.method,
    "",
  );
  const evidenceType = stringOrDefault(
    entry.evidenceType
      ?? entry.evidence_type
      ?? evidenceTypeForVerificationMethod(verificationMethod),
    "",
  );
  const priority = rushingPrerequisiteActionPriority({
    detection,
    sourceDay,
    actionId,
    verificationResult,
    entry,
    record,
  });

  return {
    sourceDay,
    actionId,
    actionDescription,
    completionSignal,
    verificationMethod,
    evidenceType,
    actionSpec: Object.keys(objectOrEmpty(entry)).length ? entry : null,
    priority,
  };
}

function rushingPrerequisiteActionPriority({
  detection = {},
  sourceDay = null,
  actionId = "",
  verificationResult = {},
  entry = {},
  record = {},
} = {}) {
  const lowQuality = objectOrEmpty(detection.lowQualityProgression ?? detection.low_quality_progression);
  const weakSignals = lowQuality.verificationQuality?.weakSignals
    ?? lowQuality.verification_quality?.weak_signals
    ?? [];
  const missingArtifacts = lowQuality.requiredArtifacts?.missingArtifacts
    ?? lowQuality.required_artifacts?.missing_artifacts
    ?? [];
  const matchesWeakSignal = weakSignals.some((signal) =>
    normalizeOptionalDayNumber(signal.day) === sourceDay
    && stringOrDefault(signal.actionId ?? signal.action_id, "") === actionId
  );
  const matchesMissingArtifact = missingArtifacts.some((artifact) =>
    normalizeOptionalDayNumber(artifact.day) === sourceDay
    && stringOrDefault(artifact.actionId ?? artifact.action_id, "") === actionId
  );
  const evidenceSubmission = objectOrEmpty(
    entry.evidenceSubmission
      ?? entry.evidence_submission
      ?? record.evidenceSubmission
      ?? record.evidence_submission,
  );
  const hasAcceptedProof = verificationResult.passed === true
    || normalizeProgressEventType(evidenceSubmission.validationStatus ?? evidenceSubmission.validation_status) === "accepted";

  return [
    matchesWeakSignal ? 100 : 0,
    matchesMissingArtifact ? 50 : 0,
    hasAcceptedProof ? -25 : 0,
    sourceDay ?? 0,
  ].reduce((sum, value) => sum + value, 0);
}

function evidenceTypeForVerificationMethod(method = "") {
  const normalized = normalizeProgressEventType(method);
  if (!normalized) return "";
  if (["browser", "google_docs", "google_sheets", "mcp"].includes(normalized)) return "link";
  if (["cli", "file", "local_file"].includes(normalized)) return "file";
  return "link";
}

export function mergeCarriedOverPrerequisiteRequirementsIntoCurriculumDay({
  curriculumDay = null,
  prerequisiteRequirements = null,
  generatedAt = new Date(),
} = {}) {
  const day = objectOrEmpty(curriculumDay);
  const carriedPayload = objectOrEmpty(prerequisiteRequirements);
  const targetDay = normalizeOptionalDayNumber(
    day.day
      ?? day.dayId
      ?? day.day_id
      ?? carriedPayload.currentDay
      ?? carriedPayload.current_day,
  );
  const existingPayload = extractCurriculumDayPrerequisitePayload(day);
  const existingRequirements = extractPrerequisiteRequirementList(existingPayload)
    .map((requirement, index) => normalizeCurriculumPrerequisiteRequirement(requirement, {
      index,
      currentDay: targetDay,
      generatedAt,
      source: "authored",
    }))
    .filter(Boolean);
  const carriedRequirements = extractPrerequisiteRequirementList(carriedPayload)
    .map((requirement, index) => normalizeCurriculumPrerequisiteRequirement(requirement, {
      index,
      currentDay: targetDay,
      generatedAt,
      source: "carry_over",
    }))
    .filter(Boolean);
  const requirements = mergePrerequisiteRequirementLists(existingRequirements, carriedRequirements);
  const prerequisitePayload = buildMergedPrerequisiteRequirementPayload({
    existingPayload,
    carriedPayload,
    requirements,
    currentDay: targetDay,
    generatedAt,
  });

  return {
    ...day,
    prerequisiteRequirements: prerequisitePayload,
    prerequisite_requirements: prerequisitePayload,
    prerequisites: requirements,
    dependencyRefs: mergeStringArraysPreservingOrder(
      day.dependencyRefs ?? day.dependency_refs ?? day.dependencies,
      requirements.map((requirement) =>
        requirement.dependencyRef
          ?? requirement.dependency_ref
          ?? requirement.sourceActionId
          ?? requirement.source_action_id
          ?? requirement.actionId
          ?? requirement.action_id
          ?? requirement.requirementId
          ?? requirement.requirement_id,
      ),
    ),
    dependency_refs: mergeStringArraysPreservingOrder(
      day.dependencyRefs ?? day.dependency_refs ?? day.dependencies,
      requirements.map((requirement) =>
        requirement.dependencyRef
          ?? requirement.dependency_ref
          ?? requirement.sourceActionId
          ?? requirement.source_action_id
          ?? requirement.actionId
          ?? requirement.action_id
          ?? requirement.requirementId
          ?? requirement.requirement_id,
      ),
    ),
  };
}

export function surfaceCurriculumCoachingFeedback({
  coachingFeedback = null,
  feedbackItems = null,
  currentDay = null,
  generatedAt = new Date(),
} = {}) {
  const source = objectOrEmpty(coachingFeedback);
  const rawItems = Array.isArray(feedbackItems)
    ? feedbackItems
    : Array.isArray(source.feedbackItems)
      ? source.feedbackItems
      : Array.isArray(source.feedback_items)
        ? source.feedback_items
        : [];
  const targetDay = normalizeOptionalDayNumber(currentDay ?? source.currentDay ?? source.current_day);
  const surfacedItems = rawItems
    .map((item, index) => normalizeCoachingFeedbackSurfaceItem(item, {
      index,
      currentDay: targetDay,
      generatedAt,
    }))
    .filter(Boolean);

  return {
    schemaVersion: CURRICULUM_COACHING_FEEDBACK_SURFACE_SCHEMA_VERSION,
    schema: "agentic30.curriculum.coaching_feedback_surface.v1",
    currentDay: targetDay,
    current_day: targetDay,
    generatedAt: toIso(generatedAt),
    generated_at: toIso(generatedAt),
    presentation: "inline_assistant_coaching",
    displayMode: "non_modal",
    display_mode: "non_modal",
    coachingMode: source.coachingMode ?? source.coaching_mode ?? "non_blocking_carry_over",
    coaching_mode: source.coachingMode ?? source.coaching_mode ?? "non_blocking_carry_over",
    progressionBlocked: false,
    progression_blocked: false,
    blocking: false,
    dismissible: true,
    dismissalBehavior: "dismiss_hint_only",
    dismissal_behavior: "dismiss_hint_only",
    canAdvanceDay: true,
    can_advance_day: true,
    canContinueWorkflow: true,
    can_continue_workflow: true,
    hasVisibleFeedback: surfacedItems.length > 0,
    has_visible_feedback: surfacedItems.length > 0,
    feedbackItems: surfacedItems,
    feedback_items: surfacedItems,
  };
}

export function identifyCarriedOverIncompleteActionsForCoaching({
  progressState = {},
  currentDay = null,
  now = new Date(),
} = {}) {
  const normalized = normalizeCurriculumProgressState(progressState);
  const targetDay = normalizeOptionalDayNumber(currentDay);
  const detectedAt = toIso(now);
  const priorDayCarryOver = identifyPriorIncompleteActionsEligibleForCarryOver({
    progressState: normalized,
    currentDay: targetDay,
    now,
  });
  const sourceQueues = [
    ...normalized.carryOverQueue,
    ...priorDayCarryOver.eligibleActions,
    ...normalizeDayProgressRecords(normalized.dayRecords)
      .filter((record) => !targetDay || record.day === targetDay)
      .flatMap((record) => record.carryOverQueue ?? record.carry_over_queue ?? []),
  ];
  const eligibleActions = normalizeCarryOverQueue(sourceQueues)
    .filter((item) => isCarryOverItemEligibleForCoaching(item, targetDay))
    .map((item) => normalizeCarryOverCoachingCandidate(item, { currentDay: targetDay, detectedAt }));
  const feedbackItems = eligibleActions.map((item) => buildCarryOverCoachingFeedbackContent(item, {
    currentDay: targetDay,
    generatedAt: detectedAt,
  }));

  return {
    schemaVersion: CURRICULUM_CARRY_OVER_COACHING_SCHEMA_VERSION,
    schema: "agentic30.curriculum.carry_over_coaching.v1",
    currentDay: targetDay,
    current_day: targetDay,
    detectedAt,
    detected_at: detectedAt,
    progressionBlocked: false,
    progression_blocked: false,
    coachingMode: "non_blocking_carry_over",
    coaching_mode: "non_blocking_carry_over",
    hasEligibleActions: eligibleActions.length > 0,
    has_eligible_actions: eligibleActions.length > 0,
    eligibleActions,
    eligible_actions: eligibleActions,
    hasFeedbackContent: feedbackItems.length > 0,
    has_feedback_content: feedbackItems.length > 0,
    feedbackItems,
    feedback_items: feedbackItems,
  };
}

export function identifyPriorIncompleteActionsEligibleForCarryOver({
  progressState = {},
  currentDay = null,
  now = new Date(),
} = {}) {
  const normalized = normalizeCurriculumProgressState(progressState);
  const targetDay = normalizeOptionalDayNumber(currentDay);
  const detectedAt = toIso(now);
  const priorActionRecords = normalizeDayProgressRecords(normalized.dayRecords)
    .filter((record) => {
      if (targetDay && record.day >= targetDay) return false;
      const dayType = normalizeCurriculumDayType(record.dayType ?? record.day_type)
        || defaultDayTypeForDay(record.day);
      return dayType === CURRICULUM_DAY_TYPES.action;
    });
  const eligibleActions = priorActionRecords
    .flatMap((record) => {
      const transition = identifyIncompleteDayActionsForTransition({
        currentDayState: record,
        currentDay: record.day,
        progressState: normalized,
        now,
      });
      const candidates = transition.carryOverCandidates ?? transition.carry_over_candidates ?? [];
      return candidates.map((candidate, index) =>
        normalizePriorDayCarryOverCandidate(candidate, {
          index,
          targetDay,
          detectedAt,
        }),
      );
    })
    .filter((item) => item && isCarryOverItemEligibleForCoaching(item, targetDay));

  return {
    schemaVersion: CURRICULUM_CARRY_OVER_COACHING_SCHEMA_VERSION,
    schema: "agentic30.curriculum.prior_incomplete_actions_carry_over.v1",
    currentDay: targetDay,
    current_day: targetDay,
    detectedAt,
    detected_at: detectedAt,
    progressionBlocked: false,
    progression_blocked: false,
    hasEligibleActions: eligibleActions.length > 0,
    has_eligible_actions: eligibleActions.length > 0,
    eligibleActions,
    eligible_actions: eligibleActions,
  };
}

export function buildCarryOverCoachingFeedbackContent(item = {}, {
  currentDay = null,
  generatedAt = new Date(),
} = {}) {
  const source = objectOrEmpty(item);
  const actionId = stringOrDefault(source.actionId ?? source.action_id ?? source.id, "");
  const sourceDay = normalizeOptionalDayNumber(source.sourceDay ?? source.source_day);
  const targetDay = normalizeOptionalDayNumber(source.targetDay ?? source.target_day ?? currentDay);
  const actionDescription = stringOrDefault(source.actionDescription ?? source.action_description, "미완료 실행");
  const completionSignal = stringOrDefault(source.completionSignal ?? source.completion_signal, "");
  const status = normalizeProgressEventType(source.status) || "queued";
  const carryOverStatus = normalizeProgressEventType(source.carryOverStatus ?? source.carry_over_status) || "active";
  const timesCarried = normalizeCarryCount(source.timesCarried ?? source.times_carried);
  const verificationResult = objectOrEmpty(source.verificationResult ?? source.verification_result);
  const evidenceSubmission = objectOrEmpty(source.evidenceSubmission ?? source.evidence_submission);
  const statusGuidance = carryOverFeedbackStatusGuidance({
    status,
    verificationResult,
    evidenceSubmission,
    timesCarried,
  });
  const primaryLine = `${actionDescription}은 아직 열린 실행입니다. 오늘 Day 진행은 막지 않고, 가능한 최소 버전으로 이어서 해보세요.`;
  const evidenceLine = completionSignal
    ? `완료 신호는 "${completionSignal}"입니다. 그 신호에 가장 가까운 증거 1개만 먼저 남겨보세요.`
    : "완료 신호가 애매하면 링크, 파일, 로그 중 지금 남길 수 있는 증거 1개만 먼저 붙여보세요.";
  const microActionPrompt = timesCarried >= 2
    ? "범위를 더 줄여 5분 안에 확인 가능한 한 줄 증거부터 만들어보세요."
    : "10분 안에 실행, 기록, 증거 첨부 중 하나만 끝내보세요.";
  const assistantMessage = [
    primaryLine,
    statusGuidance,
    evidenceLine,
    microActionPrompt,
  ].filter(Boolean).join(" ");

  return {
    schemaVersion: CURRICULUM_CARRY_OVER_COACHING_SCHEMA_VERSION,
    schema: "agentic30.curriculum.carry_over_feedback_content.v1",
    actionId,
    action_id: actionId,
    sourceDay,
    source_day: sourceDay,
    targetDay,
    target_day: targetDay,
    currentDay: normalizeOptionalDayNumber(currentDay),
    current_day: normalizeOptionalDayNumber(currentDay),
    generatedAt: toIso(generatedAt),
    generated_at: toIso(generatedAt),
    tone: "friendly_senior",
    coachingMode: "non_blocking_carry_over",
    coaching_mode: "non_blocking_carry_over",
    progressionBlocked: false,
    progression_blocked: false,
    blocking: false,
    eligibleForCoaching: true,
    eligible_for_coaching: true,
    status,
    carryOverStatus,
    carry_over_status: carryOverStatus,
    timesCarried,
    times_carried: timesCarried,
    title: sourceDay ? `Day ${sourceDay} 실행 이어가기` : "미완료 실행 이어가기",
    body: assistantMessage,
    assistantMessage,
    assistant_message: assistantMessage,
    actionDescription,
    action_description: actionDescription,
    completionSignal,
    completion_signal: completionSignal,
    microActionPrompt,
    micro_action_prompt: microActionPrompt,
    ctaText: timesCarried >= 2 ? "5분 증거 만들기" : "10분 버전으로 해보세요",
    cta_text: timesCarried >= 2 ? "5분 증거 만들기" : "10분 버전으로 해보세요",
    dismissalBehavior: "dismiss_hint_only",
    dismissal_behavior: "dismiss_hint_only",
  };
}

export function identifyIncompleteDayActionsForTransition({
  currentDayState = null,
  currentDay = null,
  curriculumDay = null,
  progressState = {},
  now = new Date(),
} = {}) {
  const normalizedProgress = normalizeCurriculumProgressState(progressState);
  const sourceRecord = resolveCurrentDayTransitionRecord({
    currentDayState,
    currentDay,
    curriculumDay,
    progressState: normalizedProgress,
  });
  const sourceDay = normalizeOptionalDayNumber(
    sourceRecord.day
      ?? sourceRecord.dayId
      ?? sourceRecord.day_id
      ?? currentDay
      ?? curriculumDay?.day
      ?? curriculumDay?.dayId
      ?? curriculumDay?.day_id,
  );
  const sourceDayType = normalizeCurriculumDayType(
    sourceRecord.dayType
      ?? sourceRecord.day_type
      ?? curriculumDay?.dayType
      ?? curriculumDay?.day_type,
  ) || (sourceDay ? defaultDayTypeForDay(sourceDay) : "");
  const detectedAt = toIso(now);
  const actionEntries = collectTransitionActionEntries(sourceRecord, curriculumDay);
  const incompleteActions = actionEntries
    .map((entry, index) => normalizeTransitionActionCandidate(entry, {
      index,
      sourceDay,
      sourceDayType,
      detectedAt,
    }))
    .filter((entry) => entry && entry.incomplete)
    .map(({ incomplete, ...entry }) => entry);

  return {
    schemaVersion: CURRICULUM_DAY_TRANSITION_ACTION_SCHEMA_VERSION,
    schema: "agentic30.curriculum.day_transition_incomplete_actions.v1",
    sourceDay,
    source_day: sourceDay,
    sourceDayType,
    source_day_type: sourceDayType,
    targetDay: sourceDay ? Math.min(DAY_COUNT, sourceDay + 1) : null,
    target_day: sourceDay ? Math.min(DAY_COUNT, sourceDay + 1) : null,
    detectedAt,
    detected_at: detectedAt,
    progressionBlocked: false,
    progression_blocked: false,
    hasIncompleteActions: incompleteActions.length > 0,
    has_incomplete_actions: incompleteActions.length > 0,
    incompleteActions,
    incomplete_actions: incompleteActions,
    carryOverCandidates: incompleteActions,
    carry_over_candidates: incompleteActions,
  };
}

export function identifyNextUnansweredDayQuestion({
  progressState = {},
  curriculumDay = null,
  daySpec = null,
  day = null,
} = {}) {
  const normalizedProgress = normalizeCurriculumProgressState(progressState);
  const sourceDay = objectOrEmpty(daySpec ?? curriculumDay);
  const targetDay = normalizeOptionalDayNumber(
    day
      ?? sourceDay.day
      ?? sourceDay.dayId
      ?? sourceDay.day_id,
  );
  const targetDayType = normalizeCurriculumDayType(
    sourceDay.dayType
      ?? sourceDay.day_type,
  ) || (targetDay ? defaultDayTypeForDay(targetDay) : "");
  const dayRecord = normalizeDayProgressRecords(normalizedProgress.dayRecords)
    .find((record) => record.day === targetDay) ?? null;
  const authoredQuestions = normalizeDayKeyQuestions(sourceDay);

  if (!targetDay || targetDay < 2 || authoredQuestions.length === 0) {
    return {
      schema: "agentic30.curriculum.next_unanswered_question.v1",
      dayId: targetDay,
      day_id: targetDay,
      dayType: targetDayType,
      day_type: targetDayType,
      didResolve: false,
      did_resolve: false,
      reason: targetDay && targetDay < 2 ? "day1_progress_resets_before_completion" : "no_day2_plus_questions_available",
      questionIndex: null,
      question_index: null,
      nextQuestion: null,
      next_question: null,
      allQuestionsAnswered: false,
      all_questions_answered: false,
      progressionBlocked: false,
      progression_blocked: false,
    };
  }

  const answeredQuestionIds = new Set(
    normalizeDayQuestionProgress(dayRecord?.questionProgress ?? dayRecord?.question_progress)
      .filter(isAnsweredQuestionProgressRecord)
      .map((record) => record.questionId),
  );
  const answeredAuthoredQuestionIds = authoredQuestions
    .filter((question) => answeredQuestionIds.has(question.id))
    .map((question) => question.id);
  const nextIndex = authoredQuestions.findIndex((question) => !answeredQuestionIds.has(question.id));
  const allQuestionsAnswered = nextIndex === -1;
  const nextQuestion = allQuestionsAnswered ? null : authoredQuestions[nextIndex];

  return {
    schema: "agentic30.curriculum.next_unanswered_question.v1",
    dayId: targetDay,
    day_id: targetDay,
    dayType: targetDayType,
    day_type: targetDayType,
    didResolve: true,
    did_resolve: true,
    reason: allQuestionsAnswered ? "all_day_questions_answered" : "next_unanswered_question_resolved",
    questionIndex: allQuestionsAnswered ? null : nextIndex,
    question_index: allQuestionsAnswered ? null : nextIndex,
    totalQuestions: authoredQuestions.length,
    total_questions: authoredQuestions.length,
    answeredQuestionIds: answeredAuthoredQuestionIds,
    answered_question_ids: answeredAuthoredQuestionIds,
    nextQuestion,
    next_question: nextQuestion,
    allQuestionsAnswered,
    all_questions_answered: allQuestionsAnswered,
    progressionBlocked: false,
    progression_blocked: false,
  };
}

export function persistIncompleteDayActionsForNextDay({
  progressState = {},
  currentDayState = null,
  currentDay = null,
  curriculumDay = null,
  transition = null,
  now = new Date(),
} = {}) {
  const normalized = normalizeCurriculumProgressState(progressState);
  const transitionResult = transition ?? identifyIncompleteDayActionsForTransition({
    currentDayState,
    currentDay,
    curriculumDay,
    progressState: normalized,
    now,
  });
  const queuedAt = toIso(now);
  const targetDay = normalizeOptionalDayNumber(
    transitionResult.targetDay ?? transitionResult.target_day,
  );
  const candidates = Array.isArray(transitionResult.carryOverCandidates)
    ? transitionResult.carryOverCandidates
    : Array.isArray(transitionResult.carry_over_candidates)
      ? transitionResult.carry_over_candidates
      : [];
  const carryOverItems = candidates
    .map((candidate, index) => normalizeCarryOverQueueItem(candidate, {
      index,
      targetDay,
      queuedAt,
    }))
    .filter(Boolean);

  if (!targetDay || carryOverItems.length === 0) {
    return {
      state: normalized,
      transition: transitionResult,
      persistedItems: [],
      persisted_items: [],
      didPersist: false,
      did_persist: false,
    };
  }

  const carryOverQueue = mergeCarryOverQueues(normalized.carryOverQueue, carryOverItems);
  const sourceDay = normalizeOptionalDayNumber(
    transitionResult.sourceDay ?? transitionResult.source_day,
  );
  const unblockedDayRecords = clearTransitionBlockedStateForSourceDay(normalized.dayRecords, {
    sourceDay,
    updatedAt: queuedAt,
  });
  const dayRecords = upsertTargetDayCarryOverRecord(unblockedDayRecords, {
    targetDay,
    carryOverItems,
    queuedAt,
  });
  const state = normalizeCurriculumProgressState({
    ...normalized,
    updatedAt: queuedAt,
    carryOverQueue,
    carry_over_queue: carryOverQueue,
    currentDayBlocked: false,
    current_day_blocked: false,
    progressionBlocked: false,
    progression_blocked: false,
    dayRecords,
    day_records: dayRecords,
  });

  return {
    state,
    transition: transitionResult,
    persistedItems: carryOverItems,
    persisted_items: carryOverItems,
    didPersist: true,
    did_persist: true,
    currentDayBlocked: false,
    current_day_blocked: false,
    progressionBlocked: false,
    progression_blocked: false,
  };
}

export function deriveCurriculumSignals(state = {}, { now = new Date() } = {}) {
  const normalized = objectOrEmpty(state);
  const evidence = objectOrEmpty(normalized.evidence);
  const rows = Array.isArray(evidence.allRows) ? evidence.allRows.filter(Boolean) : [];
  const recentRows = Array.isArray(evidence.recentRows) && evidence.recentRows.length
    ? evidence.recentRows.filter(Boolean)
    : rows.slice(-7);
  const docText = String(evidence.docText || evidence.docExcerpt || "").trim();
  const latest = [...recentRows].reverse().find((row) =>
    row?.date || row?.insights || row?.notes || (Array.isArray(row?.posts) && row.posts.length)
  ) || {};
  const haystack = [
    docText,
    ...rows.flatMap((row) => [row?.insights, row?.notes, ...(Array.isArray(row?.posts) ? row.posts : [])]),
    normalized.currentMission?.mission,
    normalized.currentMission?.sheetRowNote,
  ].filter(Boolean).join("\n").toLowerCase();
  const interviewCount = countMatches(haystack, [
    /interview/g,
    /인터뷰/g,
    /transcript/g,
    /고객\s*발화/g,
    /l2/g,
  ]);
  const bipCount = rows.length;
  const hasRevenueSignal = /(매출|결제|paid|payment|price|가격|돈\s*내|구매|revenue|구독|subscription|paywall|페이월|in[-_\s]?app|iap|인앱결제|admob|eCPM|광고\s*수익)/i.test(haystack);
  const hasNoReply = /(no[-_\s]?reply|무응답|답\s*못|응답\s*없)/i.test(haystack);
  const hasUserCountSignal = /(100명|가입|사용자|active user|download|설치|store conversion|cpi|ctr|activation|first[_\s-]?value|첫\s*가치)/i.test(haystack);
  const currentMissionCompleted = normalized.currentMission?.status === "completed";
  const latestInsight = String(latest.insights || latest.notes || "").trim();
  const inputHealth = [
    evidence.fullRead ? "google_memory_full_read" : "",
    rows.length ? "bip_rows_present" : "",
    docText ? "journal_present" : "",
    interviewCount > 0 ? "l2_signal_present" : "l2_signal_missing",
  ].filter(Boolean);
  const evidenceGaps = [
    interviewCount === 0 ? "interview_transcript" : "",
    !docText ? "journal" : "",
    rows.length === 0 ? "bip" : "",
    !hasRevenueSignal ? "revenue_or_time_ask" : "",
  ].filter(Boolean);
  return {
    asOf: toIso(now),
    interviewCount,
    bipRows: rows.length,
    recentRows: recentRows.length,
    hasJournal: Boolean(docText),
    hasRevenueSignal,
    hasNoReply,
    hasUserCountSignal,
    currentMissionCompleted,
    latestInsight,
    inputHealth,
    evidenceGaps,
    suggestedDay: suggestDay({ interviewCount, bipCount, hasRevenueSignal, hasUserCountSignal }),
  };
}

export function detectHaventDoneItResponse(message = {}) {
  const text = extractInteractionMessageText(message);
  const normalized = normalizeInteractionText(text);
  const role = typeof message === "object" && message !== null
    ? String(message.role ?? message.sender ?? "").toLowerCase()
    : "";

  if (!normalized || (role && role !== "user")) {
    return buildHaventDoneDetection({ text, detected: false });
  }

  const directMatch = HAVENT_DONE_PATTERNS.find((pattern) => pattern.test(normalized));
  if (!directMatch || isExplicitCompletionResponse(normalized)) {
    return buildHaventDoneDetection({ text, detected: false });
  }

  return buildHaventDoneDetection({
    text,
    detected: true,
    confidence: 0.93,
    reason: "user_reports_action_not_done",
    matchedPattern: String(directMatch),
  });
}

export const detectHaventDoneResponse = detectHaventDoneItResponse;

export function buildMiniActionSessionTriggerEvent({
  sessionId = "",
  message = {},
  curriculumDay = null,
  day = null,
} = {}) {
  const detection = detectHaventDoneItResponse(message);
  if (!detection.shouldStartMiniAction) return null;
  const checkpointPolicy = {
    requiredUserInputCheckpoint: false,
    required_user_input_checkpoint: false,
    userInputCheckpointRequired: false,
    user_input_checkpoint_required: false,
    reason: "execution_only_mini_action_sessions_do_not_require_user_input_checkpoints",
  };
  return {
    type: "curriculum_mini_action_session_triggered",
    schemaVersion: 1,
    sessionId: stringOrDefault(sessionId, ""),
    day: normalizeOptionalDayNumber(
      day
        ?? curriculumDay?.day
        ?? curriculumDay?.dayId
        ?? curriculumDay?.day_id
        ?? message?.day
        ?? message?.dayId
        ?? message?.day_id,
    ),
    message: "User reported the in-Day action is not done; start a non-blocking mini-action session.",
    componentType: "curriculum_mini_action_session",
    interactive: false,
    nonInteractive: true,
    non_interactive: true,
    interactionMode: "non_interactive_execution",
    interaction_mode: "non_interactive_execution",
    currentStep: "execution",
    current_step: "execution",
    startStep: "execution",
    start_step: "execution",
    autoProceedToExecution: true,
    auto_proceed_to_execution: true,
    emitUserResponsePrompt: false,
    emit_user_response_prompt: false,
    awaitUserResponsePrompt: false,
    await_user_response_prompt: false,
    requiresUserInput: false,
    requires_user_input: false,
    requiresUserInputCheckpoint: false,
    requires_user_input_checkpoint: false,
    requiredUserInputCheckpoint: false,
    required_user_input_checkpoint: false,
    userInputCheckpointRequired: false,
    user_input_checkpoint_required: false,
    checkpointPolicy,
    checkpoint_policy: checkpointPolicy,
    trigger: {
      reason: detection.reason,
      confidence: detection.confidence,
      coachingMode: detection.coachingMode,
      actionSufficiency: detection.actionSufficiency,
      normalizedText: detection.normalizedText,
    },
  };
}

function personalizeDay(base, signals) {
  const tasks = [...base.tasks];
  const evidenceNeeds = [];
  const nextQuestions = [];
  const layerChecks = buildLayerChecks(base, signals);
  let summary = base.summary;
  let output = base.output;
  let evolutionRule = "오늘 실행 결과를 다음 카드의 evidenceRefs와 tasks에 반영한다.";

  if (base.phase === "foundation") {
    if (signals.interviewCount === 0) {
      tasks[0] = "L2 인터뷰 transcript 1건을 확보하거나 오늘 확인할 실제 사람 1명을 정한다";
      summary = "고객 발화가 없으면 IDD Engine은 조언하지 말고 인터뷰 확보 행동으로 축소한다.";
      evidenceNeeds.push("L2 quote required before insight claims");
    }
    if (base.day >= 5 && !signals.hasRevenueSignal) {
      tasks[1] = "칭찬 대신 시간/돈/다음 일정 ask를 명시적으로 보낸다";
      evidenceNeeds.push("time_or_money_ask");
    }
  }

  if (base.phase === "build" && signals.evidenceGaps.includes("interview_transcript")) {
    tasks[0] = "기능 추가 전에 L2 transcript가 없다는 폴백 카드부터 구현/검증한다";
    summary = `${summary} 현재 L2 입력 공백 때문에 build 범위는 fallback-first로 줄인다.`;
  }

  if (base.phase === "launch" && !signals.hasUserCountSignal) {
    tasks[0] = "조회수보다 DM 응답/설치/카드 생성 같은 행동 지표를 하나 만든다";
    evidenceNeeds.push("behavior_metric");
  }

  if (base.phase === "grow" && !signals.hasRevenueSignal) {
    tasks[0] = "첫 매출 또는 명시적 가격 거절을 얻는 ask를 먼저 실행한다";
    evidenceNeeds.push("first_revenue_or_price_rejection");
  }

  if (signals.currentMissionCompleted) {
    tasks.push("어제 완료한 미션 결과를 오늘 카드의 첫 근거로 반영한다");
  }

  if (signals.latestInsight) {
    output = `${output} + 최근 배움 반영: ${signals.latestInsight.slice(0, 80)}`;
  }

  nextQuestions.push(
    `/office-hours: ${officeHoursQuestionFor(base, signals)}`,
    `/plan-ceo-review: ${ceoQuestionFor(base, signals)}`,
  );

  return {
    ...base,
    summary,
    tasks: tasks.slice(0, 4),
    output,
    personalization: {
      inputHealth: signals.inputHealth,
      evidenceGaps: signals.evidenceGaps,
      latestInsight: signals.latestInsight,
      revenueSignal: signals.hasRevenueSignal,
    },
    evidenceNeeds,
    valueContract: base.valueContract ?? null,
    nextQuestions,
    layerFocus: layerFocusFor(base),
    layerChecks,
    evolutionRule,
    stopOrPivotCheck: stopOrPivotCheckFor(base),
  };
}

function buildLayerChecks(base, signals) {
  const checks = [
    `Builder: ${AGENTIC30_THREE_LAYERS.founder.question}`,
    `Program: ${AGENTIC30_THREE_LAYERS.company.question}`,
    `Product/Agentic30: ${AGENTIC30_THREE_LAYERS.product.question}`,
  ];
  if (signals.currentMissionCompleted) {
    checks[0] = "Builder: 어제 완료한 미션이 오늘의 첫 근거로 들어갔나?";
  }
  if (base.phase === "launch") {
    checks[1] = "Program: 이 공개 기록이 반복 가능한 코칭/커리큘럼 자산으로 남나?";
  }
  if (base.phase === "grow") {
    checks[2] = "Product/Agentic30: 실제 사용자 증거와 ask 결과로 계속/전환/중단 판단이 가능해졌나?";
  }
  return checks;
}

function layerFocusFor(base) {
  if (base.phase === "foundation") return ["founder", "product"];
  if (base.phase === "build") return ["product", "founder"];
  if (base.phase === "launch") return ["company", "product"];
  if (base.phase === "grow") return ["founder", "company", "product"];
  return ["product"];
}

function mergeSelectedOverride(generated, selectedDay) {
  const selected = objectOrEmpty(selectedDay);
  if (!Object.keys(selected).length) return generated;
  const selectedPrerequisiteRequirements = selected.prerequisiteRequirements ?? selected.prerequisite_requirements;
  const selectedPrerequisites = selected.prerequisites;
  const selectedDependencyRefs = selected.dependencyRefs ?? selected.dependency_refs ?? selected.dependencies;
  return {
    ...generated,
    phase: stringOrDefault(selected.phase, generated.phase),
    phaseTitle: stringOrDefault(selected.phaseTitle, generated.phaseTitle || phaseTitle(generated.phase)),
    title: stringOrDefault(selected.title, generated.title),
    shortTitle: stringOrDefault(selected.shortTitle, generated.shortTitle),
    summary: generated.summary,
    tasks: generated.tasks,
    output: generated.output,
    valueContract: generated.valueContract ?? null,
    staticDay: {
      title: stringOrDefault(selected.title, ""),
      tasks: normalizeStringArray(selected.tasks),
      output: stringOrDefault(selected.output, ""),
    },
    ...(selectedPrerequisiteRequirements
      ? {
          prerequisiteRequirements: selectedPrerequisiteRequirements,
          prerequisite_requirements: selectedPrerequisiteRequirements,
        }
      : {}),
    ...(Array.isArray(selectedPrerequisites) ? { prerequisites: selectedPrerequisites } : {}),
    ...(Array.isArray(selectedDependencyRefs)
      ? {
          dependencyRefs: selectedDependencyRefs,
          dependency_refs: selectedDependencyRefs,
        }
      : {}),
  };
}

function officeHoursQuestionFor(base, signals) {
  if (signals.interviewCount === 0) return "누가 이 문제를 어제 실제로 겪었다는 가장 강한 증거는 뭐야?";
  if (!signals.hasRevenueSignal && base.day >= 5) return "칭찬 말고 돈/시간/우회 수단으로 확인된 수요 증거는 뭐야?";
  if (base.phase === "launch") return "지금 사용자가 쓰는 status quo는 무엇이고, 그 우회가 어떤 비용을 만들고 있어?";
  return "이번 주에 한 사람이 실제로 쓸 가장 작은 wedge는 뭐야?";
}

function ceoQuestionFor(base, signals) {
  if (signals.evidenceGaps.length >= 3) return "지금 범위가 너무 큰가, 아니면 증거 수집이 너무 작은가? 오늘 깨질 전제 하나만 골라.";
  if (base.phase === "build") return "10점짜리 경험은 기능 수가 아니라 어떤 아침 행동 변화로 드러나?";
  if (base.phase === "grow") return "PMF 판단에서 오늘 가장 비싼 전제는 무엇이고 왜 아직 믿어?";
  return "이번 주 한 명에게 유용한 가장 작은 버전은 뭐야?";
}

function stopOrPivotCheckFor(base) {
  if (base.day === 7) return "5-7건 인터뷰, 7건 일지, 2-3건 BIP가 없으면 Go가 아니라 재시작 후보로 본다.";
  if (base.day === 30) return "실제 사용자 증거 또는 명시적 ask 결과가 없으면 IDD Engine hard stop.";
  return "L2 인용 없이 조언이 나오면 다음 날은 기능 추가가 아니라 입력 확보로 되돌린다.";
}

function resolveCurrentDayTransitionRecord({
  currentDayState = null,
  currentDay = null,
  curriculumDay = null,
  progressState = {},
} = {}) {
  const explicit = objectOrEmpty(currentDayState);
  if (Object.keys(explicit).length) return explicit;
  const targetDay = normalizeOptionalDayNumber(
    currentDay
      ?? curriculumDay?.day
      ?? curriculumDay?.dayId
      ?? curriculumDay?.day_id,
  );
  if (!targetDay) return {};
  return normalizeDayProgressRecords(progressState.dayRecords ?? progressState.day_records)
    .find((record) => record.day === targetDay) ?? {};
}

function collectTransitionActionEntries(currentDayState = {}, curriculumDay = null) {
  const record = objectOrEmpty(currentDayState);
  const entries = [];
  const appendList = (value) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (item && typeof item === "object") entries.push(item);
    }
  };

  appendList(record.actions);
  appendList(record.action_items);
  appendList(record.actionItems);
  appendList(record.dayActions);
  appendList(record.day_actions);
  appendList(record.incompleteActions);
  appendList(record.incomplete_actions);

  const singleActionSpec = record.actionSpec ?? record.action_spec;
  if (singleActionSpec && typeof singleActionSpec === "object") {
    entries.push({
      actionSpec: singleActionSpec,
      action_spec: singleActionSpec,
      verificationState: record.verificationState
        ?? record.verification_state
        ?? record.actionVerificationState
        ?? record.action_verification_state
        ?? null,
      verificationResult: record.verificationResult ?? record.verification_result ?? null,
      evidenceSubmission: record.evidenceSubmission ?? record.evidence_submission ?? null,
      status: record.actionStatus ?? record.action_status ?? record.status,
    });
  }

  appendList(record.actionSpecs);
  appendList(record.action_specs);
  appendList(record.verificationStates);
  appendList(record.verification_states);
  appendList(record.actionVerifications);
  appendList(record.action_verifications);

  const singleVerification = record.verificationState
    ?? record.verification_state
    ?? record.actionVerificationState
    ?? record.action_verification_state;
  if (singleVerification && typeof singleVerification === "object" && !singleActionSpec) {
    entries.push({
      verificationState: singleVerification,
      verification_state: singleVerification,
      verificationResult: record.verificationResult ?? record.verification_result ?? null,
      evidenceSubmission: record.evidenceSubmission ?? record.evidence_submission ?? null,
    });
  }

  const authored = objectOrEmpty(curriculumDay);
  const authoredActionSpec = authored.actionSpec ?? authored.action_spec;
  const hasActionEntry = entries.length > 0;
  if (!hasActionEntry && authoredActionSpec && typeof authoredActionSpec === "object") {
    entries.push({
      actionSpec: authoredActionSpec,
      action_spec: authoredActionSpec,
      status: "pending",
    });
  }

  return entries;
}

function normalizeTransitionActionCandidate(entry, {
  index = 0,
  sourceDay = null,
  sourceDayType = "",
  detectedAt = "",
} = {}) {
  const raw = objectOrEmpty(entry);
  if (!Object.keys(raw).length) return null;
  const actionSpec = normalizeTransitionActionSpec(raw.actionSpec ?? raw.action_spec ?? raw);
  const verificationState = objectOrEmpty(
    raw.verificationState
      ?? raw.verification_state
      ?? raw.actionVerificationState
      ?? raw.action_verification_state
      ?? actionSpec.verificationState
      ?? actionSpec.verification_state,
  );
  const verificationResult = objectOrEmpty(
    raw.verificationResult
      ?? raw.verification_result
      ?? verificationState.verificationResult
      ?? verificationState.verification_result,
  );
  const evidenceSubmission = objectOrEmpty(
    raw.evidenceSubmission
      ?? raw.evidence_submission
      ?? verificationState.evidenceSubmission
      ?? verificationState.evidence_submission,
  );
  const status = normalizeProgressEventType(
    raw.actionStatus
      ?? raw.action_status
      ?? raw.progressStatus
      ?? raw.progress_status
      ?? raw.completionStatus
      ?? raw.completion_status
      ?? raw.status
      ?? verificationState.status
      ?? verificationResult.status
      ?? verificationResult.outcome,
  );
  const completion = resolveTransitionActionCompletion({
    raw,
    actionSpec,
    verificationState,
    verificationResult,
    evidenceSubmission,
    status,
  });
  if (!completion.incomplete) return null;

  const actionId = stringOrDefault(
    raw.actionId
      ?? raw.action_id
      ?? raw.id
      ?? actionSpec.id
      ?? actionSpec.actionId
      ?? actionSpec.action_id,
    `day-${sourceDay || "unknown"}-action-${index + 1}`,
  );
  const actionDescription = stringOrDefault(
    raw.actionDescription
      ?? raw.action_description
      ?? raw.description
      ?? raw.task
      ?? actionSpec.actionDescription
      ?? actionSpec.action_description
      ?? actionSpec.description
      ?? actionSpec.task
      ?? actionSpec.template,
    "",
  );
  const completionSignal = stringOrDefault(
    raw.completionSignal
      ?? raw.completion_signal
      ?? actionSpec.completionSignal
      ?? actionSpec.completion_signal
      ?? actionSpec.signal
      ?? actionSpec.completion,
    "",
  );

  return {
    incomplete: true,
    id: actionId,
    actionId,
    action_id: actionId,
    sourceDay,
    source_day: sourceDay,
    dayType: sourceDayType,
    day_type: sourceDayType,
    actionDescription,
    action_description: actionDescription,
    completionSignal,
    completion_signal: completionSignal,
    status: completion.status,
    reason: completion.reason,
    verificationStatus: stringOrDefault(verificationState.status, ""),
    verification_status: stringOrDefault(verificationState.status, ""),
    verificationResult: Object.keys(verificationResult).length ? verificationResult : null,
    verification_result: Object.keys(verificationResult).length ? verificationResult : null,
    evidenceSubmission: Object.keys(evidenceSubmission).length ? evidenceSubmission : null,
    evidence_submission: Object.keys(evidenceSubmission).length ? evidenceSubmission : null,
    actionSpec,
    action_spec: actionSpec,
    timesCarried: normalizeCarryCount(raw.timesCarried ?? raw.times_carried),
    times_carried: normalizeCarryCount(raw.timesCarried ?? raw.times_carried),
    coachingFeedback: "미완료 실행은 다음 Day로 넘기되 진행은 막지 않습니다. 짧은 mini-action으로 이어서 해보세요.",
    coaching_feedback: "미완료 실행은 다음 Day로 넘기되 진행은 막지 않습니다. 짧은 mini-action으로 이어서 해보세요.",
    detectedAt,
    detected_at: detectedAt,
  };
}

function normalizeCarryOverQueue(value) {
  if (!Array.isArray(value)) return [];
  return mergeCarryOverQueues([], value.map((entry, index) =>
    normalizeCarryOverQueueItem(entry, { index }),
  ).filter(Boolean));
}

function mergePrerequisiteRequirementPayloads(left = {}, right = {}, {
  currentDay = null,
  generatedAt = new Date(),
} = {}) {
  const leftPayload = objectOrEmpty(left);
  const rightPayload = objectOrEmpty(right);
  const leftRequirements = extractPrerequisiteRequirementList(leftPayload)
    .map((requirement, index) => normalizeCurriculumPrerequisiteRequirement(requirement, {
      index,
      currentDay,
      generatedAt,
      source: stringOrDefault(requirement?.source, "carry_over"),
    }))
    .filter(Boolean);
  const rightRequirements = extractPrerequisiteRequirementList(rightPayload)
    .map((requirement, index) => normalizeCurriculumPrerequisiteRequirement(requirement, {
      index,
      currentDay,
      generatedAt,
      source: stringOrDefault(requirement?.source, "too_fast_progression"),
    }))
    .filter(Boolean);
  return buildMergedPrerequisiteRequirementPayload({
    existingPayload: leftPayload,
    carriedPayload: rightPayload,
    requirements: mergePrerequisiteRequirementLists(leftRequirements, rightRequirements),
    currentDay,
    generatedAt,
  });
}

function normalizeTooFastProgressionThresholds(thresholds = {}) {
  const raw = objectOrEmpty(thresholds);
  return {
    minCompletedDaysForTiming: normalizePositiveNumber(raw.minCompletedDaysForTiming ?? raw.min_completed_days_for_timing, 2),
    minElapsedMinutesPerCompletedDay: normalizePositiveNumber(raw.minElapsedMinutesPerCompletedDay ?? raw.min_elapsed_minutes_per_completed_day, 20),
    minSingleDayEngagementMinutes: normalizePositiveNumber(raw.minSingleDayEngagementMinutes ?? raw.min_single_day_engagement_minutes, 4),
    minAnsweredQuestionCount: normalizePositiveNumber(raw.minAnsweredQuestionCount ?? raw.min_answered_question_count, 1),
    minAnswerCharacters: normalizePositiveNumber(raw.minAnswerCharacters ?? raw.min_answer_characters, 12),
  };
}

function normalizeLowQualityProgressionThresholds(thresholds = {}) {
  const raw = objectOrEmpty(thresholds);
  return {
    minAnswerCharacters: normalizePositiveNumber(raw.minAnswerCharacters ?? raw.min_answer_characters, 24),
    minRiskSignalCount: normalizePositiveNumber(raw.minRiskSignalCount ?? raw.min_risk_signal_count, 2),
    minAcceptedVerificationConfidence: normalizePositiveNumber(
      raw.minAcceptedVerificationConfidence ?? raw.min_accepted_verification_confidence,
      0.7,
    ),
  };
}

function normalizeRushingRiskThresholds(thresholds = {}) {
  const raw = objectOrEmpty(thresholds);
  const tooFastWeight = normalizePositiveNumber(raw.tooFastWeight ?? raw.too_fast_weight, 0.6);
  const lowQualityWeight = normalizePositiveNumber(raw.lowQualityWeight ?? raw.low_quality_weight, 0.4);
  const totalWeight = tooFastWeight + lowQualityWeight;
  return {
    tooFastWeight: roundNumber(tooFastWeight / totalWeight, 3),
    too_fast_weight: roundNumber(tooFastWeight / totalWeight, 3),
    lowQualityWeight: roundNumber(lowQualityWeight / totalWeight, 3),
    low_quality_weight: roundNumber(lowQualityWeight / totalWeight, 3),
    minTooFastScore: normalizePositiveNumber(raw.minTooFastScore ?? raw.min_too_fast_score, 0.5),
    min_too_fast_score: normalizePositiveNumber(raw.minTooFastScore ?? raw.min_too_fast_score, 0.5),
    minCombinedScore: normalizePositiveNumber(raw.minCombinedScore ?? raw.min_combined_score, 0.5),
    min_combined_score: normalizePositiveNumber(raw.minCombinedScore ?? raw.min_combined_score, 0.5),
    highRiskScore: normalizePositiveNumber(raw.highRiskScore ?? raw.high_risk_score, 0.75),
    high_risk_score: normalizePositiveNumber(raw.highRiskScore ?? raw.high_risk_score, 0.75),
  };
}

function normalizeTooFastSignalForRushing(signal = null) {
  const source = objectOrEmpty(signal);
  const timing = objectOrEmpty(source.completionTiming ?? source.completion_timing);
  const skippedSteps = objectOrEmpty(source.skippedSteps ?? source.skipped_steps);
  const engagement = objectOrEmpty(source.minimumEngagement ?? source.minimum_engagement ?? source.engagement);
  const detected = source.detected === true || source.tooFastProgressionDetected === true || source.too_fast_progression_detected === true;
  const reasonCodes = [
    timing.timingTooFast === true || timing.timing_too_fast === true ? "completion_timing_too_fast" : "",
    skippedSteps.hasSkippedSteps === true || skippedSteps.has_skipped_steps === true ? "skipped_curriculum_steps" : "",
    engagement.minimumEngagementMet === false || engagement.minimum_engagement_met === false ? "below_minimum_engagement_threshold" : "",
  ].filter(Boolean);
  const score = clamp01(roundNumber(
    (timing.timingTooFast === true || timing.timing_too_fast === true ? 0.45 : 0)
      + (skippedSteps.hasSkippedSteps === true || skippedSteps.has_skipped_steps === true ? 0.25 : 0)
      + (engagement.minimumEngagementMet === false || engagement.minimum_engagement_met === false ? 0.3 : 0)
      + (detected && reasonCodes.length === 0 ? 0.5 : 0),
    3,
  ));
  return {
    detected,
    score,
    normalizedScore: score,
    normalized_score: score,
    reasonCodes,
    reason_codes: reasonCodes,
    reasons: reasonCodes.map((code) => rushingReasonForCode(code)),
    sourceSchema: stringOrDefault(source.schema, ""),
    source_schema: stringOrDefault(source.schema, ""),
  };
}

function normalizeLowQualitySignalForRushing(signal = null) {
  const source = objectOrEmpty(signal);
  const verification = objectOrEmpty(source.verificationQuality ?? source.verification_quality);
  const response = objectOrEmpty(source.responseQuality ?? source.response_quality);
  const artifacts = objectOrEmpty(source.requiredArtifacts ?? source.required_artifacts);
  const detected = source.detected === true || source.lowQualityProgressionDetected === true || source.low_quality_progression_detected === true;
  const reasonCodes = [
    verification.hasWeakVerificationSignals === true || verification.has_weak_verification_signals === true ? "failed_or_weak_verification_signal" : "",
    response.hasShallowResponses === true || response.has_shallow_responses === true ? "shallow_response_detail" : "",
    artifacts.hasMissingRequiredArtifacts === true || artifacts.has_missing_required_artifacts === true ? "missing_required_artifact" : "",
  ].filter(Boolean);
  const score = clamp01(roundNumber(
    (verification.hasWeakVerificationSignals === true || verification.has_weak_verification_signals === true ? 0.4 : 0)
      + (response.hasShallowResponses === true || response.has_shallow_responses === true ? 0.3 : 0)
      + (artifacts.hasMissingRequiredArtifacts === true || artifacts.has_missing_required_artifacts === true ? 0.3 : 0)
      + (detected && reasonCodes.length === 0 ? 0.35 : 0),
    3,
  ));
  return {
    detected,
    score,
    normalizedScore: score,
    normalized_score: score,
    reasonCodes,
    reason_codes: reasonCodes,
    reasons: reasonCodes.map((code) => rushingReasonForCode(code)),
    sourceSchema: stringOrDefault(source.schema, ""),
    source_schema: stringOrDefault(source.schema, ""),
  };
}

function rushingReasonForCode(code) {
  const labels = {
    completion_timing_too_fast: "Multiple Days were completed faster than the minimum engagement pace.",
    skipped_curriculum_steps: "One or more guided curriculum steps were skipped.",
    below_minimum_engagement_threshold: "At least one completed Day is below the minimum engagement threshold.",
    failed_or_weak_verification_signal: "Action evidence is failed, insufficient, or too weak for high-confidence execution.",
    shallow_response_detail: "One or more answers are too shallow to support high-quality progression.",
    missing_required_artifact: "A required action artifact is missing.",
  };
  return {
    code,
    reason: labels[code] ?? code,
  };
}

function summarizeVerificationQualityForProgression(records = [], thresholds = {}) {
  const weakSignals = [];
  records.forEach((record) => {
    extractLowQualityActionEntries(record).forEach((entry, index) => {
      const signal = lowQualityVerificationSignalForAction(entry, {
        day: record.day,
        index,
        thresholds,
      });
      if (signal) weakSignals.push(signal);
    });
  });
  return {
    hasWeakVerificationSignals: weakSignals.length > 0,
    has_weak_verification_signals: weakSignals.length > 0,
    weakVerificationSignalCount: weakSignals.length,
    weak_verification_signal_count: weakSignals.length,
    weakSignals,
    weak_signals: weakSignals,
    thresholds,
  };
}

function summarizeResponseQualityForProgression(records = [], thresholds = {}) {
  const shallowResponses = [];
  records.forEach((record) => {
    normalizeDayQuestionProgress(record.questionProgress ?? record.question_progress).forEach((question) => {
      const status = normalizeProgressEventType(question.status ?? question.answerStatus ?? question.answer_status);
      const answer = String(question.answer ?? "").trim();
      const answered = isAnsweredQuestionProgressRecord(question);
      const reasons = [
        !answered || ["skipped", "skip", "dismissed"].includes(status) ? "answer_missing_or_skipped" : "",
        answered && answer.length < thresholds.minAnswerCharacters ? "answer_below_detail_threshold" : "",
        answered && isGenericLowQualityAnswer(answer) ? "generic_low_information_answer" : "",
      ].filter(Boolean);
      if (!reasons.length) return;
      shallowResponses.push({
        day: record.day,
        questionId: question.questionId,
        question_id: question.question_id,
        answerCharacters: answer.length,
        answer_characters: answer.length,
        status,
        reasons,
      });
    });
  });
  return {
    hasShallowResponses: shallowResponses.length > 0,
    has_shallow_responses: shallowResponses.length > 0,
    shallowResponseCount: shallowResponses.length,
    shallow_response_count: shallowResponses.length,
    shallowResponses,
    shallow_responses: shallowResponses,
    thresholds,
  };
}

function summarizeRequiredArtifactsForProgression(records = []) {
  const missingArtifacts = [];
  records.forEach((record) => {
    extractLowQualityActionEntries(record).forEach((entry, index) => {
      const requiredArtifact = requiredArtifactLabelForAction(entry, record);
      if (!requiredArtifact || hasSatisfiedActionArtifact(entry, record)) return;
      missingArtifacts.push({
        day: record.day,
        actionId: actionIdForLowQualityEntry(entry, record, index),
        action_id: actionIdForLowQualityEntry(entry, record, index),
        requiredArtifact,
        required_artifact: requiredArtifact,
        reason: "required_artifact_missing",
      });
    });
  });
  return {
    hasMissingRequiredArtifacts: missingArtifacts.length > 0,
    has_missing_required_artifacts: missingArtifacts.length > 0,
    missingRequiredArtifactCount: missingArtifacts.length,
    missing_required_artifact_count: missingArtifacts.length,
    missingArtifacts,
    missing_artifacts: missingArtifacts,
  };
}

function summarizeCompletionTimingForTooFastDetection(records = [], thresholds = {}) {
  const completed = records
    .map((record) => {
      const startedAt = firstIsoFromValues(
        record.startedAt,
        record.started_at,
        firstLifecycleTimestamp(record.lifecycleEvents ?? record.lifecycle_events),
        record.updatedAt,
        record.updated_at,
        record.completedAt,
        record.completed_at,
      );
      const completedAt = firstIsoFromValues(record.completedAt, record.completed_at, record.updatedAt, record.updated_at);
      if (!completedAt) return null;
      return {
        day: record.day,
        startedAt,
        started_at: startedAt,
        completedAt,
        completed_at: completedAt,
        elapsedMinutes: startedAt
          ? roundNumber(Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60_000, 2)
          : null,
        elapsed_minutes: startedAt
          ? roundNumber(Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60_000, 2)
          : null,
      };
    })
    .filter(Boolean);
  const starts = completed.map((entry) => parseDate(entry.startedAt)).filter(Boolean).sort((a, b) => a - b);
  const ends = completed.map((entry) => parseDate(entry.completedAt)).filter(Boolean).sort((a, b) => a - b);
  const firstStartedAt = starts[0] ?? null;
  const lastCompletedAt = ends.at(-1) ?? null;
  const elapsedMinutes = firstStartedAt && lastCompletedAt
    ? roundNumber(Math.max(0, lastCompletedAt.getTime() - firstStartedAt.getTime()) / 60_000, 2)
    : null;
  const averageMinutesPerCompletedDay = elapsedMinutes !== null && completed.length
    ? roundNumber(elapsedMinutes / completed.length, 2)
    : null;
  const timingTooFast = completed.length >= thresholds.minCompletedDaysForTiming
    && averageMinutesPerCompletedDay !== null
    && averageMinutesPerCompletedDay < thresholds.minElapsedMinutesPerCompletedDay;

  return {
    completedDayCount: completed.length,
    completed_day_count: completed.length,
    latestCompletedDay: completed.at(-1)?.day ?? null,
    latest_completed_day: completed.at(-1)?.day ?? null,
    firstStartedAt: firstStartedAt ? toIso(firstStartedAt) : null,
    first_started_at: firstStartedAt ? toIso(firstStartedAt) : null,
    lastCompletedAt: lastCompletedAt ? toIso(lastCompletedAt) : null,
    last_completed_at: lastCompletedAt ? toIso(lastCompletedAt) : null,
    elapsedMinutes,
    elapsed_minutes: elapsedMinutes,
    averageMinutesPerCompletedDay,
    average_minutes_per_completed_day: averageMinutesPerCompletedDay,
    minimumExpectedMinutes: completed.length * thresholds.minElapsedMinutesPerCompletedDay,
    minimum_expected_minutes: completed.length * thresholds.minElapsedMinutesPerCompletedDay,
    timingTooFast,
    timing_too_fast: timingTooFast,
    dayTimings: completed,
    day_timings: completed,
  };
}

function summarizeSkippedStepsForTooFastDetection(records = []) {
  const skippedRecords = [];
  for (const record of records) {
    for (const event of normalizeDayLifecycleEvents(record.lifecycleEvents ?? record.lifecycle_events)) {
      const eventType = normalizeProgressEventType(event.type);
      if (eventType.includes("skipped") || eventType.includes("skip")) {
        skippedRecords.push({ day: record.day, step: event.type, reason: "skip_lifecycle_event" });
      }
    }
    for (const question of normalizeDayQuestionProgress(record.questionProgress ?? record.question_progress)) {
      const status = normalizeProgressEventType(question.status ?? question.answerStatus ?? question.answer_status);
      if (["skipped", "skip", "dismissed"].includes(status)) {
        skippedRecords.push({ day: record.day, step: question.questionId, reason: "question_skipped" });
      }
    }
  }
  return {
    skippedStepCount: skippedRecords.length,
    skipped_step_count: skippedRecords.length,
    hasSkippedSteps: skippedRecords.length > 0,
    has_skipped_steps: skippedRecords.length > 0,
    skippedRecords,
    skipped_records: skippedRecords,
  };
}

function summarizeMinimumEngagementForTooFastDetection(records = [], thresholds = {}) {
  const lowEngagementDays = records
    .map((record) => summarizeSingleDayEngagement(record, thresholds))
    .filter((entry) => entry && entry.minimumEngagementMet === false);
  return {
    minimumEngagementMet: lowEngagementDays.length === 0,
    minimum_engagement_met: lowEngagementDays.length === 0,
    lowEngagementDayCount: lowEngagementDays.length,
    low_engagement_day_count: lowEngagementDays.length,
    lowEngagementDays,
    low_engagement_days: lowEngagementDays,
    thresholds,
  };
}

function summarizeSingleDayEngagement(record = {}, thresholds = {}) {
  const questionProgress = normalizeDayQuestionProgress(record.questionProgress ?? record.question_progress);
  const answeredQuestions = questionProgress.filter(isAnsweredQuestionProgressRecord);
  const startedAt = firstIsoFromValues(
    record.startedAt,
    record.started_at,
    firstLifecycleTimestamp(record.lifecycleEvents ?? record.lifecycle_events),
  );
  const completedAt = firstIsoFromValues(record.completedAt, record.completed_at, record.updatedAt, record.updated_at);
  const elapsedMinutes = startedAt && completedAt
    ? roundNumber(Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60_000, 2)
    : null;
  const answerCharacters = answeredQuestions.reduce((sum, question) =>
    sum + String(question.answer ?? "").trim().length, 0);
  const averageAnswerCharacters = answeredQuestions.length
    ? roundNumber(answerCharacters / answeredQuestions.length, 2)
    : 0;
  const reasons = [
    elapsedMinutes !== null && elapsedMinutes < thresholds.minSingleDayEngagementMinutes ? "single_day_elapsed_below_minimum" : "",
    questionProgress.length > 0 && answeredQuestions.length < thresholds.minAnsweredQuestionCount ? "answered_questions_below_minimum" : "",
    answeredQuestions.length > 0 && averageAnswerCharacters < thresholds.minAnswerCharacters ? "answer_detail_below_minimum" : "",
  ].filter(Boolean);
  return {
    day: record.day,
    dayType: record.dayType ?? record.day_type ?? "",
    day_type: record.dayType ?? record.day_type ?? "",
    elapsedMinutes,
    elapsed_minutes: elapsedMinutes,
    answeredQuestionCount: answeredQuestions.length,
    answered_question_count: answeredQuestions.length,
    questionCount: questionProgress.length,
    question_count: questionProgress.length,
    averageAnswerCharacters,
    average_answer_characters: averageAnswerCharacters,
    minimumEngagementMet: reasons.length === 0,
    minimum_engagement_met: reasons.length === 0,
    reasons,
  };
}

function extractLowQualityActionEntries(record = {}) {
  const entries = [];
  const rawActions = [
    ...(Array.isArray(record.actions) ? record.actions : []),
    ...(Array.isArray(record.actionProgress) ? record.actionProgress : []),
    ...(Array.isArray(record.action_progress) ? record.action_progress : []),
  ];
  for (const action of rawActions) {
    const normalized = objectOrEmpty(action);
    if (Object.keys(normalized).length) entries.push(normalized);
  }
  const actionSpec = objectOrEmpty(record.actionSpec ?? record.action_spec);
  const verificationState = objectOrEmpty(record.verificationState ?? record.verification_state);
  const verificationResult = objectOrEmpty(record.verificationResult ?? record.verification_result);
  const evidenceSubmission = objectOrEmpty(record.evidenceSubmission ?? record.evidence_submission);
  const recordLevelAction = {
    ...actionSpec,
    ...(Object.keys(verificationState).length ? { verificationState } : {}),
    ...(Object.keys(verificationResult).length ? { verificationResult } : {}),
    ...(Object.keys(evidenceSubmission).length ? { evidenceSubmission } : {}),
  };
  if (Object.keys(recordLevelAction).length) entries.push(recordLevelAction);
  return entries;
}

function lowQualityVerificationSignalForAction(entry = {}, {
  day = null,
  index = 0,
  thresholds = {},
} = {}) {
  const verificationState = objectOrEmpty(
    entry.verificationState
      ?? entry.verification_state
      ?? entry.actionVerificationState
      ?? entry.action_verification_state,
  );
  const verificationResult = objectOrEmpty(
    entry.verificationResult
      ?? entry.verification_result
      ?? verificationState.verificationResult
      ?? verificationState.verification_result,
  );
  const evidenceSubmission = objectOrEmpty(
    entry.evidenceSubmission
      ?? entry.evidence_submission
      ?? verificationState.evidenceSubmission
      ?? verificationState.evidence_submission,
  );
  const verificationStatus = normalizeProgressEventType(
    verificationState.status ?? verificationResult.status ?? verificationResult.outcome ?? entry.status,
  );
  const evidenceStatus = normalizeProgressEventType(
    evidenceSubmission.validationStatus
      ?? evidenceSubmission.validation_status
      ?? evidenceSubmission.status,
  );
  const confidence = Number(verificationResult.confidence ?? verificationResult.score);
  const failed = verificationResult.passed === false
    || ["failed", "rejected", "insufficient", "invalid"].includes(verificationStatus)
    || ["rejected", "insufficient", "invalid"].includes(evidenceStatus);
  const weakConfidence = verificationResult.passed === true
    && Number.isFinite(confidence)
    && confidence < thresholds.minAcceptedVerificationConfidence;
  if (!failed && !weakConfidence) return null;
  return {
    day,
    actionId: actionIdForLowQualityEntry(entry, { day }, index),
    action_id: actionIdForLowQualityEntry(entry, { day }, index),
    method: stringOrDefault(verificationResult.method ?? entry.verificationMethod ?? entry.verification_method, ""),
    status: failed ? "failed_or_insufficient" : "weak_confidence",
    confidence: Number.isFinite(confidence) ? confidence : null,
    reason: stringOrDefault(
      verificationResult.reason
        ?? evidenceSubmission.reason
        ?? evidenceSubmission.validationReason
        ?? evidenceSubmission.validation_reason,
      weakConfidence ? "accepted_verification_confidence_below_threshold" : "verification_or_evidence_failed",
    ),
  };
}

function requiredArtifactLabelForAction(entry = {}, record = {}) {
  const valueContract = objectOrEmpty(record.valueContract ?? record.value_contract);
  return stringOrDefault(
    entry.requiredArtifact
      ?? entry.required_artifact
      ?? entry.evidenceArtifact
      ?? entry.evidence_artifact
      ?? entry.completionSignal
      ?? entry.completion_signal
      ?? valueContract.evidenceArtifact
      ?? valueContract.evidence_artifact
      ?? record.requiredArtifact
      ?? record.required_artifact
      ?? record.evidenceArtifact
      ?? record.evidence_artifact,
    "",
  );
}

function hasSatisfiedActionArtifact(entry = {}, record = {}) {
  const verificationState = objectOrEmpty(entry.verificationState ?? entry.verification_state);
  const verificationResult = objectOrEmpty(
    entry.verificationResult
      ?? entry.verification_result
      ?? verificationState.verificationResult
      ?? verificationState.verification_result
      ?? record.verificationResult
      ?? record.verification_result,
  );
  const evidenceSubmission = objectOrEmpty(
    entry.evidenceSubmission
      ?? entry.evidence_submission
      ?? verificationState.evidenceSubmission
      ?? verificationState.evidence_submission
      ?? record.evidenceSubmission
      ?? record.evidence_submission,
  );
  const evidenceStatus = normalizeProgressEventType(
    evidenceSubmission.validationStatus
      ?? evidenceSubmission.validation_status
      ?? evidenceSubmission.status,
  );
  return verificationResult.passed === true
    || evidenceStatus === "accepted"
    || Boolean(evidenceSubmission.content || evidenceSubmission.url || evidenceSubmission.filePath || evidenceSubmission.file_path)
    || nonEmptyArray(entry.artifacts)
    || nonEmptyArray(entry.evidenceArtifacts)
    || nonEmptyArray(entry.evidence_artifacts)
    || nonEmptyArray(record.artifacts);
}

function actionIdForLowQualityEntry(entry = {}, record = {}, index = 0) {
  return stringOrDefault(
    entry.actionId
      ?? entry.action_id
      ?? entry.id
      ?? record.actionId
      ?? record.action_id,
    `day-${record.day || "unknown"}-action-${index + 1}`,
  );
}

function isGenericLowQualityAnswer(answer = "") {
  const normalized = normalizeInteractionText(answer);
  return /^(ok|okay|done|yes|yep|no|maybe|n\/a|na|잘 모르겠어요|모름|완료|네|아니요|아직)$/i.test(normalized);
}

function isCarryOverItemEligibleForCoaching(item = {}, currentDay = null) {
  const status = normalizeProgressEventType(item.status);
  const carryOverStatus = normalizeProgressEventType(item.carryOverStatus ?? item.carry_over_status);
  const targetDay = normalizeOptionalDayNumber(item.targetDay ?? item.target_day);
  const verificationResult = objectOrEmpty(item.verificationResult ?? item.verification_result);
  const evidenceSubmission = objectOrEmpty(item.evidenceSubmission ?? item.evidence_submission);
  const evidenceStatus = normalizeProgressEventType(
    evidenceSubmission.validationStatus
      ?? evidenceSubmission.validation_status
      ?? evidenceSubmission.status,
  );
  const resolvedStatuses = new Set([
    "accepted",
    "cancelled",
    "canceled",
    "complete",
    "completed",
    "dismissed",
    "done",
    "passed",
    "resolved",
    "skipped",
    "verified",
  ]);
  if (!item.sourceDay && !item.source_day) return false;
  if (!item.actionDescription && !item.action_description) return false;
  if (targetDay && currentDay && targetDay > currentDay) return false;
  if (verificationResult.passed === true || evidenceStatus === "accepted") return false;
  if (resolvedStatuses.has(status) || resolvedStatuses.has(carryOverStatus)) return false;
  return carryOverStatus === "active"
    || carryOverStatus === "queued"
    || carryOverStatus === ""
    || status === "queued"
    || status === "pending"
    || status === "incomplete"
    || status === "insufficient"
    || status === "failed"
    || status === "rejected";
}

function normalizeCarryOverCoachingCandidate(item = {}, {
  currentDay = null,
  detectedAt = "",
} = {}) {
  const actionId = stringOrDefault(item.actionId ?? item.action_id ?? item.id, "");
  const sourceDay = normalizeOptionalDayNumber(item.sourceDay ?? item.source_day);
  const targetDay = normalizeOptionalDayNumber(item.targetDay ?? item.target_day);
  const actionDescription = stringOrDefault(item.actionDescription ?? item.action_description, "");
  const completionSignal = stringOrDefault(item.completionSignal ?? item.completion_signal, "");
  const coachingFeedback = stringOrDefault(
    item.coachingFeedback ?? item.coaching_feedback,
    "미완료 실행은 진행을 막지 않고 짧게 다시 이어갑니다. 지금 가능한 최소 버전으로 해보세요.",
  );
  return {
    id: `${sourceDay}:${actionId}:${targetDay || currentDay || "any"}`,
    actionId,
    action_id: actionId,
    sourceDay,
    source_day: sourceDay,
    targetDay,
    target_day: targetDay,
    currentDay,
    current_day: currentDay,
    actionDescription,
    action_description: actionDescription,
    completionSignal,
    completion_signal: completionSignal,
    status: normalizeProgressEventType(item.status) || "queued",
    carryOverStatus: normalizeProgressEventType(item.carryOverStatus ?? item.carry_over_status) || "active",
    carry_over_status: normalizeProgressEventType(item.carryOverStatus ?? item.carry_over_status) || "active",
    reason: stringOrDefault(item.reason, "carried_over_incomplete_action"),
    eligibleForCoaching: true,
    eligible_for_coaching: true,
    coachingMode: "non_blocking_carry_over",
    coaching_mode: "non_blocking_carry_over",
    coachingFeedback,
    coaching_feedback: coachingFeedback,
    timesCarried: normalizeCarryCount(item.timesCarried ?? item.times_carried),
    times_carried: normalizeCarryCount(item.timesCarried ?? item.times_carried),
    verificationResult: item.verificationResult ?? item.verification_result ?? null,
    verification_result: item.verificationResult ?? item.verification_result ?? null,
    evidenceSubmission: item.evidenceSubmission ?? item.evidence_submission ?? null,
    evidence_submission: item.evidenceSubmission ?? item.evidence_submission ?? null,
    actionSpec: item.actionSpec ?? item.action_spec ?? null,
    action_spec: item.actionSpec ?? item.action_spec ?? null,
    detectedAt,
    detected_at: detectedAt,
  };
}

function normalizePrerequisiteRequirementFromCarryOver(item = {}, {
  index = 0,
  currentDay = null,
  generatedAt = "",
} = {}) {
  const raw = objectOrEmpty(item);
  const sourceDay = normalizeOptionalDayNumber(raw.sourceDay ?? raw.source_day);
  const targetDay = normalizeOptionalDayNumber(raw.targetDay ?? raw.target_day ?? currentDay);
  const sourceActionId = stringOrDefault(raw.actionId ?? raw.action_id ?? raw.id, "");
  const actionDescription = stringOrDefault(raw.actionDescription ?? raw.action_description, "");
  if (!sourceDay || !targetDay || !sourceActionId || !actionDescription) return null;

  const actionSpec = objectOrEmpty(raw.actionSpec ?? raw.action_spec);
  const verificationResult = objectOrEmpty(raw.verificationResult ?? raw.verification_result);
  const evidenceSubmission = objectOrEmpty(raw.evidenceSubmission ?? raw.evidence_submission);
  const completionSignal = stringOrDefault(
    raw.completionSignal
      ?? raw.completion_signal
      ?? actionSpec.completionSignal
      ?? actionSpec.completion_signal,
    "",
  );
  const verificationMethod = stringOrDefault(
    actionSpec.verificationMethod
      ?? actionSpec.verification_method
      ?? verificationResult.method
      ?? evidenceSubmission.type,
    "evidence_submission",
  );
  const evidenceType = stringOrDefault(
    actionSpec.evidenceType
      ?? actionSpec.evidence_type
      ?? evidenceSubmission.type,
    verificationMethod === "file" ? "file" : "link_or_file",
  );
  const status = normalizeProgressEventType(raw.status) || "queued";
  const carryOverStatus = normalizeProgressEventType(raw.carryOverStatus ?? raw.carry_over_status) || "active";
  const requirementId = stringOrDefault(
    raw.requirementId ?? raw.requirement_id,
    `day-${targetDay}-requires-day-${sourceDay}-${sourceActionId || index + 1}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
  );
  const requirementText = completionSignal
    ? `${actionDescription} 완료 신호 "${completionSignal}"에 맞는 증거를 먼저 보강해보세요.`
    : `${actionDescription}에 대한 실행 증거를 먼저 보강해보세요.`;

  return {
    schemaVersion: CURRICULUM_PREREQUISITE_REQUIREMENT_SCHEMA_VERSION,
    schema: "agentic30.curriculum.prerequisite_requirement.v1",
    requirementId,
    requirement_id: requirementId,
    requirementType: "carry_over_incomplete_action",
    requirement_type: "carry_over_incomplete_action",
    requirementMode: "non_blocking_prerequisite",
    requirement_mode: "non_blocking_prerequisite",
    sourceDay,
    source_day: sourceDay,
    sourceActionId,
    source_action_id: sourceActionId,
    actionId: sourceActionId,
    action_id: sourceActionId,
    targetDay,
    target_day: targetDay,
    currentDay: currentDay ?? targetDay,
    current_day: currentDay ?? targetDay,
    actionDescription,
    action_description: actionDescription,
    completionSignal,
    completion_signal: completionSignal,
    verificationMethod,
    verification_method: verificationMethod,
    evidenceType,
    evidence_type: evidenceType,
    status,
    carryOverStatus,
    carry_over_status: carryOverStatus,
    requiredBefore: "day_quality_completion",
    required_before: "day_quality_completion",
    requiredForQualityGate: true,
    required_for_quality_gate: true,
    progressionBlocked: false,
    progression_blocked: false,
    blocking: false,
    canAdvanceDay: true,
    can_advance_day: true,
    sourceCarryOverReason: stringOrDefault(raw.reason, "carried_over_incomplete_action"),
    source_carry_over_reason: stringOrDefault(raw.reason, "carried_over_incomplete_action"),
    timesCarried: normalizeCarryCount(raw.timesCarried ?? raw.times_carried),
    times_carried: normalizeCarryCount(raw.timesCarried ?? raw.times_carried),
    verificationResult: Object.keys(verificationResult).length ? verificationResult : null,
    verification_result: Object.keys(verificationResult).length ? verificationResult : null,
    evidenceSubmission: Object.keys(evidenceSubmission).length ? evidenceSubmission : null,
    evidence_submission: Object.keys(evidenceSubmission).length ? evidenceSubmission : null,
    actionSpec: Object.keys(actionSpec).length ? actionSpec : null,
    action_spec: Object.keys(actionSpec).length ? actionSpec : null,
    generatedAt,
    generated_at: generatedAt,
    requirementText,
    requirement_text: requirementText,
  };
}

function extractCurriculumDayPrerequisitePayload(day = {}) {
  const source = objectOrEmpty(day);
  const explicitPayload = source.prerequisiteRequirements
    ?? source.prerequisite_requirements
    ?? source.prerequisiteRequirementSet
    ?? source.prerequisite_requirement_set;
  if (explicitPayload && typeof explicitPayload === "object" && !Array.isArray(explicitPayload)) {
    return explicitPayload;
  }
  const explicitList = source.prerequisites
    ?? source.prerequisiteList
    ?? source.prerequisite_list
    ?? source.requirements;
  if (Array.isArray(explicitList)) {
    return {
      requirements: explicitList,
      prerequisiteRequirements: explicitList,
      prerequisite_requirements: explicitList,
    };
  }
  return {};
}

function extractPrerequisiteRequirementList(payload = {}) {
  if (Array.isArray(payload)) return payload;
  const source = objectOrEmpty(payload);
  const list = source.requirements
    ?? source.prerequisiteRequirements
    ?? source.prerequisite_requirements
    ?? source.prerequisites
    ?? [];
  return Array.isArray(list) ? list : [];
}

function normalizeCurriculumPrerequisiteRequirement(requirement = {}, {
  index = 0,
  currentDay = null,
  generatedAt = new Date(),
  source = "authored",
} = {}) {
  const raw = objectOrEmpty(requirement);
  if (!Object.keys(raw).length) return null;
  const targetDay = normalizeOptionalDayNumber(raw.targetDay ?? raw.target_day ?? currentDay);
  const sourceDay = normalizeOptionalDayNumber(raw.sourceDay ?? raw.source_day);
  const sourceActionId = stringOrDefault(
    raw.sourceActionId
      ?? raw.source_action_id
      ?? raw.actionId
      ?? raw.action_id
      ?? raw.id,
    "",
  );
  const requirementId = stringOrDefault(
    raw.requirementId ?? raw.requirement_id,
    sourceDay && sourceActionId && targetDay
      ? `day-${targetDay}-requires-day-${sourceDay}-${sourceActionId}`.replace(/[^a-zA-Z0-9_-]+/g, "-")
      : `day-${targetDay || "unknown"}-prerequisite-${index + 1}`,
  );
  const actionId = stringOrDefault(raw.actionId ?? raw.action_id, sourceActionId);
  const generatedAtIso = toIso(raw.generatedAt ?? raw.generated_at ?? generatedAt);

  return {
    ...raw,
    requirementId,
    requirement_id: requirementId,
    requirementType: stringOrDefault(
      raw.requirementType ?? raw.requirement_type,
      source === "carry_over" ? "carry_over_incomplete_action" : "authored_prerequisite",
    ),
    requirement_type: stringOrDefault(
      raw.requirementType ?? raw.requirement_type,
      source === "carry_over" ? "carry_over_incomplete_action" : "authored_prerequisite",
    ),
    requirementMode: stringOrDefault(
      raw.requirementMode ?? raw.requirement_mode,
      "non_blocking_prerequisite",
    ),
    requirement_mode: stringOrDefault(
      raw.requirementMode ?? raw.requirement_mode,
      "non_blocking_prerequisite",
    ),
    sourceDay,
    source_day: sourceDay,
    sourceActionId,
    source_action_id: sourceActionId,
    actionId,
    action_id: actionId,
    targetDay,
    target_day: targetDay,
    currentDay: normalizeOptionalDayNumber(raw.currentDay ?? raw.current_day ?? currentDay ?? targetDay),
    current_day: normalizeOptionalDayNumber(raw.currentDay ?? raw.current_day ?? currentDay ?? targetDay),
    actionDescription: stringOrDefault(raw.actionDescription ?? raw.action_description, ""),
    action_description: stringOrDefault(raw.actionDescription ?? raw.action_description, ""),
    completionSignal: stringOrDefault(raw.completionSignal ?? raw.completion_signal, ""),
    completion_signal: stringOrDefault(raw.completionSignal ?? raw.completion_signal, ""),
    progressionBlocked: raw.progressionBlocked === true || raw.progression_blocked === true,
    progression_blocked: raw.progressionBlocked === true || raw.progression_blocked === true,
    blocking: raw.blocking === true,
    canAdvanceDay: raw.canAdvanceDay === false || raw.can_advance_day === false ? false : true,
    can_advance_day: raw.canAdvanceDay === false || raw.can_advance_day === false ? false : true,
    source: stringOrDefault(raw.source, source),
    generatedAt: generatedAtIso,
    generated_at: generatedAtIso,
  };
}

function buildMergedPrerequisiteRequirementPayload({
  existingPayload = {},
  carriedPayload = {},
  requirements = [],
  currentDay = null,
  generatedAt = new Date(),
} = {}) {
  const existing = objectOrEmpty(existingPayload);
  const carried = objectOrEmpty(carriedPayload);
  const generatedAtIso = toIso(
    carried.generatedAt
      ?? carried.generated_at
      ?? existing.generatedAt
      ?? existing.generated_at
      ?? generatedAt,
  );

  return {
    ...existing,
    schemaVersion: CURRICULUM_PREREQUISITE_REQUIREMENT_SCHEMA_VERSION,
    schema: stringOrDefault(
      existing.schema ?? carried.schema,
      "agentic30.curriculum.prerequisite_requirements.v1",
    ),
    currentDay: normalizeOptionalDayNumber(currentDay ?? existing.currentDay ?? existing.current_day ?? carried.currentDay ?? carried.current_day),
    current_day: normalizeOptionalDayNumber(currentDay ?? existing.currentDay ?? existing.current_day ?? carried.currentDay ?? carried.current_day),
    generatedAt: generatedAtIso,
    generated_at: generatedAtIso,
    requirementMode: stringOrDefault(
      existing.requirementMode ?? existing.requirement_mode ?? carried.requirementMode ?? carried.requirement_mode,
      "non_blocking_prerequisite",
    ),
    requirement_mode: stringOrDefault(
      existing.requirementMode ?? existing.requirement_mode ?? carried.requirementMode ?? carried.requirement_mode,
      "non_blocking_prerequisite",
    ),
    progressionBlocked: false,
    progression_blocked: false,
    blocking: false,
    hasRequirements: requirements.length > 0,
    has_requirements: requirements.length > 0,
    requirements,
    prerequisiteRequirements: requirements,
    prerequisite_requirements: requirements,
  };
}

function mergePrerequisiteRequirementLists(existingRequirements = [], carriedRequirements = []) {
  const byKey = new Map();
  for (const requirement of [...existingRequirements, ...carriedRequirements]) {
    const normalized = normalizeCurriculumPrerequisiteRequirement(requirement);
    if (!normalized) continue;
    const key = prerequisiteRequirementKey(normalized);
    if (byKey.has(key)) {
      byKey.set(key, mergeDuplicatePrerequisiteRequirement(byKey.get(key), normalized));
      continue;
    }
    byKey.set(key, normalized);
  }
  return [...byKey.values()];
}

function mergeDuplicatePrerequisiteRequirement(existing = {}, incoming = {}) {
  const merged = { ...existing };
  if (incoming.prerequisiteActionGenerated === true || incoming.prerequisite_action_generated === true) {
    merged.prerequisiteActionGenerated = true;
    merged.prerequisite_action_generated = true;
  }
  for (const [camelKey, snakeKey] of [
    ["verificationMethod", "verification_method"],
    ["evidenceType", "evidence_type"],
    ["requiredBefore", "required_before"],
    ["requiredForQualityGate", "required_for_quality_gate"],
    ["actionSpec", "action_spec"],
  ]) {
    const incomingValue = incoming[camelKey] ?? incoming[snakeKey];
    if (incomingValue === undefined || incomingValue === null || incomingValue === "") continue;
    if (merged[camelKey] === undefined || merged[camelKey] === null || merged[camelKey] === "") {
      merged[camelKey] = incomingValue;
    }
    if (merged[snakeKey] === undefined || merged[snakeKey] === null || merged[snakeKey] === "") {
      merged[snakeKey] = incomingValue;
    }
  }
  const sources = mergeStringArraysPreservingOrder(
    existing.adaptiveRequirementSources ?? existing.adaptive_requirement_sources ?? [existing.source].filter(Boolean),
    [incoming.source].filter(Boolean),
  );
  if (sources.length) {
    merged.adaptiveRequirementSources = sources;
    merged.adaptive_requirement_sources = sources;
  }
  return merged;
}

function prerequisiteRequirementKey(requirement = {}) {
  const sourceDay = requirement.sourceDay ?? requirement.source_day ?? "";
  const sourceActionId = requirement.sourceActionId
    ?? requirement.source_action_id
    ?? requirement.actionId
    ?? requirement.action_id
    ?? "";
  const targetDay = requirement.targetDay ?? requirement.target_day ?? requirement.currentDay ?? requirement.current_day ?? "";
  if (sourceDay || sourceActionId || targetDay) {
    return [sourceDay, sourceActionId, targetDay].join(":");
  }
  return String(requirement.requirementId ?? requirement.requirement_id ?? "");
}

function normalizeCoachingFeedbackSurfaceItem(item = {}, {
  index = 0,
  currentDay = null,
  generatedAt = new Date(),
} = {}) {
  const raw = objectOrEmpty(item);
  const assistantMessage = stringOrDefault(
    raw.assistantMessage
      ?? raw.assistant_message
      ?? raw.body
      ?? raw.coachingFeedback
      ?? raw.coaching_feedback,
    "",
  );
  if (!assistantMessage) return null;
  const actionId = stringOrDefault(raw.actionId ?? raw.action_id ?? raw.id, `coaching-feedback-${index + 1}`);
  const title = stringOrDefault(raw.title, "실행 코칭");
  const ctaText = stringOrDefault(raw.ctaText ?? raw.cta_text, "가볍게 이어서 해보세요");
  const sourceDay = normalizeOptionalDayNumber(raw.sourceDay ?? raw.source_day);
  const targetDay = normalizeOptionalDayNumber(raw.targetDay ?? raw.target_day ?? currentDay);
  const resolvedCurrentDay = normalizeOptionalDayNumber(currentDay ?? raw.currentDay ?? raw.current_day);
  const microActionPrompt = stringOrDefault(raw.microActionPrompt ?? raw.micro_action_prompt, "");

  return {
    id: `surface-${actionId}`,
    actionId,
    action_id: actionId,
    sourceDay,
    source_day: sourceDay,
    targetDay,
    target_day: targetDay,
    currentDay: resolvedCurrentDay,
    current_day: resolvedCurrentDay,
    generatedAt: toIso(raw.generatedAt ?? raw.generated_at ?? generatedAt),
    generated_at: toIso(raw.generatedAt ?? raw.generated_at ?? generatedAt),
    type: "inline_coaching_card",
    presentation: "assistant_inline_hint",
    title,
    body: assistantMessage,
    assistantMessage,
    assistant_message: assistantMessage,
    ctaText,
    cta_text: ctaText,
    microActionPrompt,
    micro_action_prompt: microActionPrompt,
    tone: stringOrDefault(raw.tone, "friendly_senior"),
    coachingMode: stringOrDefault(raw.coachingMode ?? raw.coaching_mode, "non_blocking_carry_over"),
    coaching_mode: stringOrDefault(raw.coachingMode ?? raw.coaching_mode, "non_blocking_carry_over"),
    progressionBlocked: false,
    progression_blocked: false,
    blocking: false,
    dismissible: true,
    dismissalBehavior: "dismiss_hint_only",
    dismissal_behavior: "dismiss_hint_only",
    canAdvanceDay: true,
    can_advance_day: true,
    canContinueWorkflow: true,
    can_continue_workflow: true,
  };
}

function carryOverFeedbackStatusGuidance({
  status = "",
  verificationResult = {},
  evidenceSubmission = {},
  timesCarried = 0,
} = {}) {
  const normalizedStatus = normalizeProgressEventType(status);
  const evidenceStatus = normalizeProgressEventType(
    evidenceSubmission.validationStatus
      ?? evidenceSubmission.validation_status
      ?? evidenceSubmission.status,
  );
  if (timesCarried >= 2) {
    return "몇 번 밀린 실행이라 난이도를 낮춥니다. 완성보다 작게 증명하는 쪽으로 잡아보세요.";
  }
  if (verificationResult.passed === false || ["rejected", "insufficient"].includes(evidenceStatus)) {
    return "지난 증거는 충분하지 않았습니다. 같은 일을 크게 다시 하지 말고, 부족했던 확인 신호만 보강해보세요.";
  }
  if (["failed", "insufficient", "rejected"].includes(normalizedStatus)) {
    return "이전 시도는 충분히 닫히지 않았습니다. 실패 원인을 고치기보다 다음 확인 가능한 한 조각을 붙여보세요.";
  }
  if (["pending", "queued", "active"].includes(normalizedStatus)) {
    return "아직 대기 중인 실행입니다. 오늘 질문에 답하면서 옆에 작은 실행 슬롯으로 같이 처리해보세요.";
  }
  return "미완료 실행은 다음 Day의 참고 맥락으로만 다룹니다. 진행은 그대로 이어가세요.";
}

function normalizeCarryOverQueueItem(value, {
  index = 0,
  targetDay = null,
  queuedAt = "",
} = {}) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length) return null;
  const sourceDay = normalizeOptionalDayNumber(
    raw.sourceDay ?? raw.source_day ?? raw.day ?? raw.dayId ?? raw.day_id,
  );
  const normalizedTargetDay = normalizeOptionalDayNumber(
    targetDay ?? raw.targetDay ?? raw.target_day,
  );
  const actionId = stringOrDefault(
    raw.actionId ?? raw.action_id ?? raw.id,
    `day-${sourceDay || "unknown"}-carry-over-${index + 1}`,
  );
  const actionDescription = stringOrDefault(
    raw.actionDescription
      ?? raw.action_description
      ?? raw.description
      ?? raw.task,
    "",
  );
  if (!sourceDay || !actionDescription) return null;
  const firstQueuedAt = stringOrDefault(
    raw.firstQueuedAt ?? raw.first_queued_at ?? raw.queuedAt ?? raw.queued_at,
    queuedAt,
  );
  const updatedAt = stringOrDefault(raw.updatedAt ?? raw.updated_at, queuedAt || firstQueuedAt);
  const timesCarried = normalizeCarryCount(raw.timesCarried ?? raw.times_carried);
  const persistedCount = queuedAt ? Math.max(1, timesCarried + 1) : timesCarried;
  const completionSignal = stringOrDefault(raw.completionSignal ?? raw.completion_signal, "");
  const coachingFeedback = stringOrDefault(
    raw.coachingFeedback ?? raw.coaching_feedback,
    "미완료 실행은 다음 Day로 넘기되 진행은 막지 않습니다. 짧은 mini-action으로 이어서 해보세요.",
  );

  return {
    ...raw,
    id: `${sourceDay}:${actionId}:${normalizedTargetDay || "next"}`,
    actionId,
    action_id: actionId,
    sourceDay,
    source_day: sourceDay,
    targetDay: normalizedTargetDay,
    target_day: normalizedTargetDay,
    actionDescription,
    action_description: actionDescription,
    completionSignal,
    completion_signal: completionSignal,
    status: normalizeProgressEventType(raw.status) || "queued",
    carryOverStatus: normalizeProgressEventType(raw.carryOverStatus ?? raw.carry_over_status) || "active",
    carry_over_status: normalizeProgressEventType(raw.carryOverStatus ?? raw.carry_over_status) || "active",
    reason: stringOrDefault(raw.reason, "action_carried_to_next_day"),
    verificationResult: raw.verificationResult ?? raw.verification_result ?? null,
    verification_result: raw.verificationResult ?? raw.verification_result ?? null,
    evidenceSubmission: raw.evidenceSubmission ?? raw.evidence_submission ?? null,
    evidence_submission: raw.evidenceSubmission ?? raw.evidence_submission ?? null,
    actionSpec: raw.actionSpec ?? raw.action_spec ?? null,
    action_spec: raw.actionSpec ?? raw.action_spec ?? null,
    timesCarried: persistedCount,
    times_carried: persistedCount,
    coachingFeedback,
    coaching_feedback: coachingFeedback,
    firstQueuedAt: firstQueuedAt,
    first_queued_at: firstQueuedAt,
    queuedAt: stringOrDefault(raw.queuedAt ?? raw.queued_at, firstQueuedAt),
    queued_at: stringOrDefault(raw.queuedAt ?? raw.queued_at, firstQueuedAt),
    updatedAt,
    updated_at: updatedAt,
  };
}

function normalizePriorDayCarryOverCandidate(candidate = {}, {
  index = 0,
  targetDay = null,
  detectedAt = "",
} = {}) {
  const normalizedTargetDay = normalizeOptionalDayNumber(
    targetDay ?? candidate.targetDay ?? candidate.target_day,
  );
  return normalizeCarryOverQueueItem({
    ...candidate,
    targetDay: normalizedTargetDay,
    target_day: normalizedTargetDay,
    carryOverStatus: candidate.carryOverStatus ?? candidate.carry_over_status ?? "active",
    carry_over_status: candidate.carryOverStatus ?? candidate.carry_over_status ?? "active",
    reason: candidate.reason || "prior_day_incomplete_action_eligible_for_carry_over",
    detectedAt,
    detected_at: detectedAt,
  }, {
    index,
    targetDay: normalizedTargetDay,
  });
}

function mergeCarryOverQueues(existing = [], incoming = []) {
  const byKey = new Map();
  for (const item of [...existing, ...incoming]) {
    const normalized = normalizeCarryOverQueueItem(item);
    if (!normalized) continue;
    const key = carryOverQueueKey(normalized);
    const previous = byKey.get(key);
    byKey.set(key, previous ? mergeCarryOverQueueItems(previous, normalized) : normalized);
  }
  return [...byKey.values()].sort((a, b) =>
    (a.targetDay ?? DAY_COUNT + 1) - (b.targetDay ?? DAY_COUNT + 1)
    || (a.sourceDay ?? 0) - (b.sourceDay ?? 0)
    || String(a.actionId).localeCompare(String(b.actionId))
  );
}

function mergeCarryOverQueueItems(existing, incoming) {
  const firstQueuedAt = stringOrDefault(existing.firstQueuedAt ?? existing.first_queued_at, incoming.firstQueuedAt);
  const queuedAt = stringOrDefault(existing.queuedAt ?? existing.queued_at, incoming.queuedAt);
  const updatedAt = stringOrDefault(incoming.updatedAt ?? incoming.updated_at, existing.updatedAt);
  const timesCarried = Math.max(
    normalizeCarryCount(existing.timesCarried ?? existing.times_carried),
    normalizeCarryCount(incoming.timesCarried ?? incoming.times_carried),
  );
  return normalizeCarryOverQueueItem({
    ...existing,
    ...incoming,
    firstQueuedAt,
    first_queued_at: firstQueuedAt,
    queuedAt,
    queued_at: queuedAt,
    updatedAt,
    updated_at: updatedAt,
    timesCarried,
    times_carried: timesCarried,
  });
}

function carryOverQueueKey(item = {}) {
  return [
    item.sourceDay ?? item.source_day ?? "",
    item.actionId ?? item.action_id ?? item.id ?? "",
    item.targetDay ?? item.target_day ?? "",
  ].join(":");
}

function clearTransitionBlockedStateForSourceDay(dayRecords = [], {
  sourceDay = null,
  updatedAt = "",
} = {}) {
  if (!sourceDay) return normalizeDayProgressRecords(dayRecords);
  return normalizeDayProgressRecords(dayRecords)
    .map((record) => {
      if (record.day !== sourceDay) return record;
      return normalizeDayProgressRecord({
        ...record,
        blocked: false,
        isBlocked: false,
        is_blocked: false,
        currentDayBlocked: false,
        current_day_blocked: false,
        progressionBlocked: false,
        progression_blocked: false,
        blockedReason: "",
        blocked_reason: "",
        updatedAt: stringOrDefault(updatedAt, record.updatedAt ?? record.updated_at),
        updated_at: stringOrDefault(updatedAt, record.updatedAt ?? record.updated_at),
      });
    })
    .filter(Boolean);
}

function upsertTargetDayCarryOverRecord(dayRecords = [], {
  targetDay,
  carryOverItems = [],
  queuedAt = "",
} = {}) {
  const records = normalizeDayProgressRecords(dayRecords);
  const existing = records.find((record) => record.day === targetDay) ?? null;
  const carryOverQueue = mergeCarryOverQueues(existing?.carryOverQueue ?? existing?.carry_over_queue, carryOverItems);
  const nextRecord = normalizeDayProgressRecord({
    ...existing,
    day: targetDay,
    dayId: targetDay,
    day_id: targetDay,
    dayType: stringOrDefault(existing?.dayType ?? existing?.day_type, defaultDayTypeForDay(targetDay)),
    day_type: stringOrDefault(existing?.dayType ?? existing?.day_type, defaultDayTypeForDay(targetDay)),
    updatedAt: queuedAt,
    updated_at: queuedAt,
    blocked: false,
    isBlocked: false,
    is_blocked: false,
    currentDayBlocked: false,
    current_day_blocked: false,
    progressionBlocked: false,
    progression_blocked: false,
    blockedReason: "",
    blocked_reason: "",
    carryOverQueue,
    carry_over_queue: carryOverQueue,
  });
  return records
    .filter((record) => record.day !== targetDay)
    .concat(nextRecord)
    .sort((a, b) => a.day - b.day);
}

function normalizeTransitionActionSpec(value) {
  const spec = objectOrEmpty(value);
  return { ...spec };
}

function resolveTransitionActionCompletion({
  raw = {},
  actionSpec = {},
  verificationState = {},
  verificationResult = {},
  evidenceSubmission = {},
  status = "",
} = {}) {
  const normalizedStatus = normalizeProgressEventType(status);
  const evidenceStatus = normalizeProgressEventType(
    evidenceSubmission.validationStatus
      ?? evidenceSubmission.validation_status
      ?? evidenceSubmission.status,
  );
  const verificationStatus = normalizeProgressEventType(verificationState.status);
  const resultOutcome = normalizeProgressEventType(verificationResult.outcome ?? verificationResult.status);
  const explicitIncomplete = raw.incomplete === true
    || raw.isIncomplete === true
    || raw.is_incomplete === true
    || raw.completed === false
    || raw.completionConfirmed === false
    || raw.completion_confirmed === false;
  const explicitComplete = raw.completed === true
    || raw.completionConfirmed === true
    || raw.completion_confirmed === true
    || raw.done === true
    || raw.verified === true
    || verificationResult.passed === true
    || normalizedStatus === "complete"
    || normalizedStatus === "completed"
    || normalizedStatus === "done"
    || normalizedStatus === "verified"
    || normalizedStatus === "passed"
    || verificationStatus === "passed"
    || resultOutcome === "verified"
    || evidenceStatus === "accepted";
  const failedVerification = verificationResult.passed === false
    || normalizedStatus === "failed"
    || normalizedStatus === "rejected"
    || normalizedStatus === "insufficient"
    || verificationStatus === "failed"
    || resultOutcome === "failed"
    || evidenceStatus === "rejected"
    || evidenceStatus === "invalid";
  const pendingVerification = normalizedStatus === "pending"
    || normalizedStatus === "running"
    || normalizedStatus === "incomplete"
    || normalizedStatus === "not_done"
    || verificationStatus === "pending"
    || verificationStatus === "running";
  const hasActionSpec = Object.keys(actionSpec).length > 0;
  const hasVerificationState = Object.keys(verificationState).length > 0;

  if (explicitIncomplete || failedVerification) {
    return {
      incomplete: true,
      status: failedVerification ? "insufficient" : "incomplete",
      reason: failedVerification ? "action_verification_not_sufficient" : "action_marked_incomplete",
    };
  }
  if (explicitComplete) {
    return {
      incomplete: false,
      status: "completed",
      reason: "action_completed",
    };
  }
  if (pendingVerification || hasVerificationState || hasActionSpec) {
    return {
      incomplete: true,
      status: pendingVerification ? "pending" : "incomplete",
      reason: pendingVerification ? "action_verification_pending_at_transition" : "action_not_completed_at_transition",
    };
  }
  return {
    incomplete: false,
    status: normalizedStatus,
    reason: "no_action_completion_gap_detected",
  };
}

function normalizeCarryCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function suggestDay({ interviewCount, bipCount, hasRevenueSignal, hasUserCountSignal }) {
  if (interviewCount === 0) return 1;
  if (interviewCount < 2) return 4;
  if (!hasRevenueSignal) return 6;
  if (bipCount < 7) return 7;
  if (!hasUserCountSignal) return 20;
  return 29;
}

function day(dayNumber, phase, title, shortTitle, summary, tasks, output) {
  const dayTypeSlot = curriculumDayTypeSlotForDay(dayNumber);
  return Object.freeze({
    day: dayNumber,
    phase,
    phaseTitle: phaseTitle(phase),
    dayType: dayTypeSlot.dayType,
    day_type: dayTypeSlot.dayType,
    curriculumWeek: weekNumberForDay(dayNumber),
    curriculum_week: weekNumberForDay(dayNumber),
    distributionWeight: dayTypeSlot.distributionWeight,
    distribution_weight: dayTypeSlot.distributionWeight,
    targetDistribution: dayTypeSlot.targetDistribution,
    target_distribution: dayTypeSlot.targetDistribution,
    title,
    shortTitle,
    summary,
    tasks,
    output,
    valueContract: phase === "foundation" ? getFoundationValueContract(dayNumber) : null,
  });
}

function curriculumDayTypeSlotForDay(dayNumber) {
  const day = normalizeDayNumber(dayNumber);
  const weekNumber = weekNumberForDay(day);
  const distribution = CURRICULUM_WEEK_TYPE_DISTRIBUTIONS[weekNumber];
  const slot = distribution?.daySlots.find((entry) => entry.day === day);
  if (slot) {
    return {
      dayType: slot.dayType,
      distributionWeight: slot.distributionWeight,
      targetDistribution: distribution.targetPercentages,
    };
  }
  return {
    dayType: defaultDayTypeForDay(day),
    distributionWeight: null,
    targetDistribution: null,
  };
}

function normalizeCurriculumCoachMarkDay(curriculumDay, dayValue) {
  const raw = objectOrEmpty(curriculumDay);
  const rawDay = raw.day
    ?? raw.dayId
    ?? raw.day_id
    ?? dayValue;
  const dayId = rawDay === null || rawDay === undefined || rawDay === ""
    ? null
    : normalizeDayNumber(rawDay);
  return {
    dayId,
    dayType: normalizeCurriculumDayType(raw.dayType ?? raw.day_type),
  };
}

function defaultDayTypeForDay(day) {
  if ([7, 14, 21, 28].includes(day)) return CURRICULUM_DAY_TYPES.review;
  if ([2, 6, 12, 19, 20, 23, 27].includes(day)) return CURRICULUM_DAY_TYPES.action;
  if ([4, 10, 16, 22, 26].includes(day)) return CURRICULUM_DAY_TYPES.education;
  return CURRICULUM_DAY_TYPES.interview;
}

function launchComponentTypeForDayType(dayType) {
  switch (dayType) {
    case CURRICULUM_DAY_TYPES.action:
      return "action_auto_verify_evidence";
    case CURRICULUM_DAY_TYPES.review:
      return "review_agent_summary_dashboard";
    case CURRICULUM_DAY_TYPES.education:
      return "education_interactive_worksheet";
    case CURRICULUM_DAY_TYPES.interview:
    default:
      return "interview_card_conversation";
  }
}

function phaseTitle(phase) {
  switch (phase) {
    case "foundation": return "Foundation";
    case "build": return "Build";
    case "launch": return "Launch";
    case "grow": return "Grow";
    default: return "";
  }
}

function normalizeDayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(DAY_COUNT, Math.max(1, Math.trunc(n)));
}

function normalizeOptionalDayNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return normalizeDayNumber(value);
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function firstIsoFromValues(...values) {
  for (const value of values) {
    const date = parseDate(value);
    if (date) return toIso(date);
  }
  return null;
}

function firstLifecycleTimestamp(value) {
  return normalizeDayLifecycleEvents(value)
    .map((event) => event.occurredAt ?? event.occurred_at)
    .find(Boolean) ?? null;
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function roundNumber(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normalizeStrictOptionalDayNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const day = Math.trunc(n);
  return day >= 1 && day <= DAY_COUNT ? day : null;
}

function buildCurriculumNotificationEligibilityResult({
  eligible = false,
  reason = "",
  day = null,
  currentDay = null,
  dayRecord = null,
  notificationConfig = null,
} = {}) {
  return {
    eligible,
    reason,
    day,
    day_id: day,
    currentDay,
    current_day: currentDay,
    fixedTime: stringOrDefault(notificationConfig?.fixedTime ?? notificationConfig?.fixed_time, "21:00"),
    fixed_time: stringOrDefault(notificationConfig?.fixedTime ?? notificationConfig?.fixed_time, "21:00"),
    dayRecord,
    day_record: dayRecord,
  };
}

function isSameUtcDate(value, now = new Date()) {
  const lastSent = value ? new Date(value) : null;
  const current = now instanceof Date ? now : new Date(now);
  if (!lastSent || !Number.isFinite(lastSent.getTime()) || !Number.isFinite(current.getTime())) return false;
  return lastSent.toISOString().slice(0, 10) === current.toISOString().slice(0, 10);
}

function weekNumberForDay(day) {
  return Math.ceil(normalizeDayNumber(day) / WEEK_LENGTH_DAYS);
}

function dayRangeForWeek(weekNumber) {
  const week = normalizeWeekNumber(weekNumber, { max: FINAL_CURRICULUM_WEEK }) || 1;
  return {
    start: ((week - 1) * WEEK_LENGTH_DAYS) + 1,
    end: Math.min(DAY_COUNT, week * WEEK_LENGTH_DAYS),
  };
}

function isWeeklyCompactionCompletionDay(day) {
  return day % WEEK_LENGTH_DAYS === 0 && day <= FINAL_WEEK_COMPLETION_DAY;
}

function buildFinalizedWeeklySummaryRecord({
  weekNumber,
  dayRecords = [],
  summaryText = "",
  keyInsights = [],
  unresolvedActions = [],
  finalizedAt = new Date(),
}) {
  const startDay = ((weekNumber - 1) * WEEK_LENGTH_DAYS) + 1;
  const endDay = weekNumber * WEEK_LENGTH_DAYS;
  const records = Array.isArray(dayRecords) ? dayRecords.filter(Boolean) : [];
  const fallbackSummary = records
    .map((record) => {
      const day = normalizeDayNumber(record.day ?? record.dayId ?? record.day_id);
      const title = stringOrDefault(record.title ?? record.goal ?? record.dayGoal, "");
      const completion = record.completed === false || record.completionConfirmed === false
        ? "incomplete"
        : "complete";
      return title ? `Day ${day}: ${title} (${completion})` : "";
    })
    .filter(Boolean)
    .join("\n");
  return {
    id: `week-${weekNumber}`,
    status: "finalized",
    weekNumber,
    week_number: weekNumber,
    dayRange: { start: startDay, end: endDay },
    completedDays: records
      .map((record) => normalizeDayNumber(record.day ?? record.dayId ?? record.day_id))
      .filter((day) => day >= startDay && day <= endDay),
    finalizedAt: toIso(finalizedAt),
    summaryText: stringOrDefault(summaryText, fallbackSummary || `Week ${weekNumber} completed.`),
    summary_text: stringOrDefault(summaryText, fallbackSummary || `Week ${weekNumber} completed.`),
    keyInsights: normalizeStringArray(keyInsights),
    key_insights: normalizeStringArray(keyInsights),
    unresolvedActions: normalizeStringArray(unresolvedActions),
    unresolved_actions: normalizeStringArray(unresolvedActions),
  };
}

function normalizeWeeklySummaryStack(value) {
  if (!Array.isArray(value)) return [];
  const byWeek = new Map();
  for (const raw of value) {
    const entry = objectOrEmpty(raw);
    const weekNumber = normalizeWeekNumber(entry.weekNumber ?? entry.week_number);
    if (!weekNumber) continue;
    const normalizedEntry = {
      id: stringOrDefault(entry.id, `week-${weekNumber}`),
      status: entry.status === "finalized" ? "finalized" : stringOrDefault(entry.status, "draft"),
      weekNumber,
      week_number: weekNumber,
      dayRange: normalizeDayRange(entry.dayRange, weekNumber),
      completedDays: normalizeCompletedDays(entry.completedDays, weekNumber),
      finalizedAt: stringOrDefault(entry.finalizedAt ?? entry.finalized_at, ""),
      summaryText: stringOrDefault(entry.summaryText ?? entry.summary_text, ""),
      summary_text: stringOrDefault(entry.summaryText ?? entry.summary_text, ""),
      keyInsights: normalizeStringArray(entry.keyInsights ?? entry.key_insights),
      key_insights: normalizeStringArray(entry.keyInsights ?? entry.key_insights),
      unresolvedActions: normalizeStringArray(entry.unresolvedActions ?? entry.unresolved_actions),
      unresolved_actions: normalizeStringArray(entry.unresolvedActions ?? entry.unresolved_actions),
    };
    const existing = byWeek.get(weekNumber);
    if (existing?.status === "finalized") continue;
    if (!existing || normalizedEntry.status === "finalized") {
      byWeek.set(weekNumber, normalizedEntry);
    }
  }
  return [...byWeek.values()].sort((a, b) => a.weekNumber - b.weekNumber);
}

function normalizeWeekNumber(value, { max = FINAL_COMPACTED_WEEK } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const weekNumber = Math.trunc(n);
  return weekNumber >= 1 && weekNumber <= max ? weekNumber : null;
}

function normalizeConfiguredReviewDayIds(value) {
  const source = Array.isArray(value) && value.some((item) => item && typeof item === "object")
    ? value
        .filter((item) => {
          const entry = objectOrEmpty(item);
          return normalizeCurriculumDayType(entry.dayType ?? entry.day_type) === CURRICULUM_DAY_TYPES.review;
        })
        .map((item) => objectOrEmpty(item).day ?? objectOrEmpty(item).dayId ?? objectOrEmpty(item).day_id)
    : Array.isArray(value)
      ? value
      : CURRICULUM_REVIEW_DAY_IDS;
  const normalized = [...new Set(source.map(normalizeOptionalDayNumber))]
    .filter((day) => day >= 1 && day <= DAY_COUNT)
    .sort((a, b) => a - b);
  return normalized.length > 0 ? normalized : [...CURRICULUM_REVIEW_DAY_IDS];
}

function normalizeDayRange(value, weekNumber) {
  const fallback = {
    start: ((weekNumber - 1) * WEEK_LENGTH_DAYS) + 1,
    end: weekNumber * WEEK_LENGTH_DAYS,
  };
  const range = objectOrEmpty(value);
  const start = Number(range.start);
  const end = Number(range.end);
  return {
    start: Number.isFinite(start) ? Math.trunc(start) : fallback.start,
    end: Number.isFinite(end) ? Math.trunc(end) : fallback.end,
  };
}

function normalizeCompletedDays(value, weekNumber) {
  if (!Array.isArray(value)) return [];
  const { start, end } = normalizeDayRange(null, weekNumber);
  return [...new Set(value.map(normalizeDayNumber))]
    .filter((day) => day >= start && day <= end)
    .sort((a, b) => a - b);
}

function makeDefaultCurriculumNotificationConfig() {
  return {
    enabled: true,
    fixedTime: "21:00",
    fixed_time: "21:00",
    lastSent: "",
    last_sent: "",
    permanentlyStopped: false,
    permanently_stopped: false,
  };
}

function normalizeCurriculumNotificationConfig(value, { terminalState = false } = {}) {
  const raw = objectOrEmpty(value);
  const enabled = terminalState
    ? false
    : raw.enabled !== false;
  const permanentlyStopped = terminalState
    || raw.permanentlyStopped === true
    || raw.permanently_stopped === true;
  return {
    ...raw,
    enabled,
    fixedTime: stringOrDefault(raw.fixedTime ?? raw.fixed_time, "21:00"),
    fixed_time: stringOrDefault(raw.fixedTime ?? raw.fixed_time, "21:00"),
    lastSent: stringOrDefault(raw.lastSent ?? raw.last_sent, ""),
    last_sent: stringOrDefault(raw.lastSent ?? raw.last_sent, ""),
    permanentlyStopped,
    permanently_stopped: permanentlyStopped,
  };
}

function normalizeCurriculumStatus(value) {
  const status = normalizeProgressEventType(value);
  return status === CURRICULUM_STATUSES.graduated
    ? CURRICULUM_STATUSES.graduated
    : CURRICULUM_STATUSES.active;
}

function buildCurriculumGraduationPatch({ dayRecord = {}, graduatedAt = new Date() } = {}) {
  const graduationState = buildCurriculumGraduationState({ dayRecord, graduatedAt });
  const notificationConfig = normalizeCurriculumNotificationConfig(
    makeDefaultCurriculumNotificationConfig(),
    { terminalState: true },
  );
  return {
    curriculumStatus: CURRICULUM_STATUSES.graduated,
    curriculum_status: CURRICULUM_STATUSES.graduated,
    terminalState: true,
    terminal_state: true,
    graduationState,
    graduation_state: graduationState,
    notificationConfig,
    notification_config: notificationConfig,
  };
}

function buildCurriculumGraduationState({ dayRecord = {}, graduatedAt = new Date() } = {}) {
  const timestamp = toIso(graduatedAt);
  const completionEvent = normalizeDayLifecycleEvents(dayRecord.lifecycleEvents ?? dayRecord.lifecycle_events)
    .findLast?.((event) => event.completionDriver)
    ?? normalizeDayLifecycleEvents(dayRecord.lifecycleEvents ?? dayRecord.lifecycle_events)
      .filter((event) => event.completionDriver)
      .at(-1)
    ?? null;
  const graduationScreen = {
    title: "30일 완주",
    subtitle: "continue, pivot, stop 중 다음 결정을 기록했어요.",
    ctaText: "완료",
    cta_text: "완료",
  };
  return {
    schemaVersion: CURRICULUM_GRADUATION_STATE_SCHEMA_VERSION,
    status: CURRICULUM_STATUSES.graduated,
    terminal: true,
    completed: true,
    finalDay: DAY_COUNT,
    final_day: DAY_COUNT,
    graduatedAt: timestamp,
    graduated_at: timestamp,
    completedAt: timestamp,
    completed_at: timestamp,
    day30CompletedAt: stringOrDefault(dayRecord.completedAt ?? dayRecord.completed_at, timestamp),
    day30_completed_at: stringOrDefault(dayRecord.completedAt ?? dayRecord.completed_at, timestamp),
    completionEventType: completionEvent?.type ?? CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
    completion_event_type: completionEvent?.type ?? CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
    nextDay: null,
    next_day: null,
    continuationMode: false,
    continuation_mode: false,
    pushNotificationsStopped: true,
    push_notifications_stopped: true,
    graduationScreen,
    graduation_screen: graduationScreen,
  };
}

function normalizeCurriculumGraduationState(value, { dayRecords = [], forceGraduated = false } = {}) {
  const raw = objectOrEmpty(value);
  const day30Record = dayRecords.find((record) => record.day === DAY_COUNT) ?? null;
  const day30Completed = day30Record?.completionConfirmed === true || day30Record?.completed === true;
  const rawGraduated = normalizeCurriculumStatus(raw.status) === CURRICULUM_STATUSES.graduated
    || raw.terminal === true
    || raw.completed === true;

  if (!rawGraduated && !day30Completed && !forceGraduated) return null;

  const completedAt = stringOrDefault(
    raw.graduatedAt
      ?? raw.graduated_at
      ?? raw.completedAt
      ?? raw.completed_at
      ?? day30Record?.completedAt
      ?? day30Record?.completed_at,
    "",
  );
  const base = buildCurriculumGraduationState({
    dayRecord: day30Record ?? {},
    graduatedAt: completedAt || new Date(),
  });
  const graduationScreen = {
    ...base.graduationScreen,
    ...objectOrEmpty(raw.graduationScreen ?? raw.graduation_screen),
  };

  return {
    ...base,
    ...raw,
    schemaVersion: CURRICULUM_GRADUATION_STATE_SCHEMA_VERSION,
    status: CURRICULUM_STATUSES.graduated,
    terminal: true,
    completed: true,
    finalDay: DAY_COUNT,
    final_day: DAY_COUNT,
    graduatedAt: stringOrDefault(raw.graduatedAt ?? raw.graduated_at, base.graduatedAt),
    graduated_at: stringOrDefault(raw.graduatedAt ?? raw.graduated_at, base.graduatedAt),
    completedAt: stringOrDefault(raw.completedAt ?? raw.completed_at, base.completedAt),
    completed_at: stringOrDefault(raw.completedAt ?? raw.completed_at, base.completedAt),
    day30CompletedAt: stringOrDefault(raw.day30CompletedAt ?? raw.day30_completed_at, base.day30CompletedAt),
    day30_completed_at: stringOrDefault(raw.day30CompletedAt ?? raw.day30_completed_at, base.day30CompletedAt),
    nextDay: null,
    next_day: null,
    continuationMode: false,
    continuation_mode: false,
    pushNotificationsStopped: true,
    push_notifications_stopped: true,
    graduationScreen,
    graduation_screen: graduationScreen,
  };
}

function makeDefaultCoachMarkRegistry() {
  const dayTypeFirstEncounters = Object.fromEntries(
    CURRICULUM_DAY_TYPE_FIRST_ENCOUNTER_TYPES.map((dayType) => [
      dayType,
      {
        dayType,
        day_type: dayType,
        encountered: false,
        firstEncounteredAt: "",
        first_encountered_at: "",
      },
    ]),
  );
  return {
    dayTypeFirstEncounters,
    day_type_first_encounters: dayTypeFirstEncounters,
  };
}

function normalizeCoachMarkRegistry(value) {
  const raw = objectOrEmpty(value);
  const defaults = makeDefaultCoachMarkRegistry();
  const legacySeenDayTypes = normalizeStringArray(
    raw.seenDayTypes
      ?? raw.seen_day_types
      ?? raw.encounteredDayTypes
      ?? raw.encountered_day_types,
  )
    .map(normalizeCurriculumDayType)
    .filter(Boolean);
  const rawEncounters = objectOrEmpty(
    raw.dayTypeFirstEncounters
      ?? raw.day_type_first_encounters
      ?? raw.dayTypeEncounters
      ?? raw.day_type_encounters,
  );
  const dayTypeFirstEncounters = {};

  for (const dayType of CURRICULUM_DAY_TYPE_FIRST_ENCOUNTER_TYPES) {
    const entry = objectOrEmpty(rawEncounters[dayType]);
    const encountered = entry.encountered === true
      || entry.seen === true
      || entry.hasEncountered === true
      || entry.has_encountered === true
      || legacySeenDayTypes.includes(dayType);
    const firstEncounteredAt = stringOrDefault(
      entry.firstEncounteredAt
        ?? entry.first_encountered_at
        ?? entry.encounteredAt
        ?? entry.encountered_at
        ?? defaults.dayTypeFirstEncounters[dayType].firstEncounteredAt,
      "",
    );
    dayTypeFirstEncounters[dayType] = {
      ...entry,
      dayType,
      day_type: dayType,
      encountered,
      firstEncounteredAt,
      first_encountered_at: firstEncounteredAt,
    };
  }

  return {
    ...raw,
    dayTypeFirstEncounters,
    day_type_first_encounters: dayTypeFirstEncounters,
  };
}

function normalizeDayProgressRecords(value) {
  if (!Array.isArray(value)) return [];
  const byDay = new Map();
  for (const entry of value) {
    const record = normalizeDayProgressRecord(entry);
    if (!record) continue;
    byDay.set(record.day, {
      ...byDay.get(record.day),
      ...record,
    });
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}

function evaluateProgressionGateForDay({
  progressState = {},
  curriculumDay = null,
  dayRecord = null,
  event = null,
  day = null,
} = {}) {
  const targetDay = normalizeOptionalDayNumber(
    day
      ?? curriculumDay?.day
      ?? curriculumDay?.dayId
      ?? curriculumDay?.day_id
      ?? dayRecord?.day
      ?? dayRecord?.dayId
      ?? dayRecord?.day_id
      ?? event?.day
      ?? event?.dayId
      ?? event?.day_id,
  );
  const prerequisiteRequirements = resolveProgressionGateRequirements({
    progressState,
    curriculumDay,
    dayRecord,
    event,
    targetDay,
  });

  return evaluateCurriculumProgressionGate({
    currentDay: targetDay,
    prerequisiteRequirements,
    progressState,
  });
}

function resolveProgressionGateRequirements({
  progressState = {},
  curriculumDay = null,
  dayRecord = null,
  event = null,
  targetDay = null,
} = {}) {
  const candidates = [
    event?.progressionGate?.prerequisiteRequirements,
    event?.progressionGate?.prerequisite_requirements,
    event?.progression_gate?.prerequisiteRequirements,
    event?.progression_gate?.prerequisite_requirements,
    event?.prerequisiteRequirements,
    event?.prerequisite_requirements,
    dayRecord?.prerequisiteRequirements,
    dayRecord?.prerequisite_requirements,
    curriculumDay?.prerequisiteRequirements,
    curriculumDay?.prerequisite_requirements,
    progressState?.prerequisiteRequirements,
    progressState?.prerequisite_requirements,
  ];
  const payload = candidates.find(hasPrerequisiteRequirementEntries);
  if (!payload) {
    return {
      currentDay: targetDay,
      current_day: targetDay,
      requirements: [],
    };
  }
  return payload;
}

function hasPrerequisiteRequirementEntries(value) {
  if (Array.isArray(value)) return value.length > 0;
  const raw = objectOrEmpty(value);
  return (Array.isArray(raw.requirements) && raw.requirements.length > 0)
    || (Array.isArray(raw.prerequisiteRequirements) && raw.prerequisiteRequirements.length > 0)
    || (Array.isArray(raw.prerequisite_requirements) && raw.prerequisite_requirements.length > 0)
    || (Array.isArray(raw.prerequisites) && raw.prerequisites.length > 0);
}

function normalizeDayProgressRecord(value) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length) return null;
  const normalizedRaw = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !["tutorial" + "Config", "tutorial" + "_config"].includes(key)),
  );
  const day = normalizeOptionalDayNumber(raw.day ?? raw.dayId ?? raw.day_id);
  if (!day) return null;
  const completionConfirmed = raw.completionConfirmed === true || raw.completion_confirmed === true;
  const completed = completionConfirmed || raw.completed === true;
  const lifecycleEvents = normalizeDayLifecycleEvents(raw.lifecycleEvents ?? raw.lifecycle_events);
  const questionProgress = normalizeDayQuestionProgress(raw.questionProgress ?? raw.question_progress);
  const carryOverQueue = normalizeCarryOverQueue(raw.carryOverQueue ?? raw.carry_over_queue);
  return {
    ...normalizedRaw,
    day,
    dayId: day,
    day_id: day,
    dayType: stringOrDefault(raw.dayType ?? raw.day_type, ""),
    day_type: stringOrDefault(raw.dayType ?? raw.day_type, ""),
    completionConfirmed,
    completion_confirmed: completionConfirmed,
    completed,
    completedAt: completed ? stringOrDefault(raw.completedAt ?? raw.completed_at, "") : "",
    completed_at: completed ? stringOrDefault(raw.completedAt ?? raw.completed_at, "") : "",
    updatedAt: stringOrDefault(raw.updatedAt ?? raw.updated_at, ""),
    updated_at: stringOrDefault(raw.updatedAt ?? raw.updated_at, ""),
    lifecycleEvents,
    lifecycle_events: lifecycleEvents,
    questionProgress,
    question_progress: questionProgress,
    carryOverQueue,
    carry_over_queue: carryOverQueue,
  };
}

function normalizeDayQuestionProgress(value) {
  if (!Array.isArray(value)) return [];
  const byQuestion = new Map();
  for (const entry of value) {
    const record = normalizeDayQuestionProgressRecord(entry);
    if (!record) continue;
    byQuestion.set(
      record.questionId,
      mergeDayQuestionProgressRecords(byQuestion.get(record.questionId), record),
    );
  }
  return [...byQuestion.values()].sort((a, b) =>
    String(a.questionId).localeCompare(String(b.questionId))
    || String(a.updatedAt).localeCompare(String(b.updatedAt))
  );
}

function normalizeCurriculumDaySpecs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = objectOrEmpty(entry);
      const day = normalizeOptionalDayNumber(raw.day ?? raw.dayId ?? raw.day_id);
      if (!day) return null;
      return {
        ...raw,
        day,
        dayId: day,
        day_id: day,
        dayType: normalizeCurriculumDayType(raw.dayType ?? raw.day_type) || defaultDayTypeForDay(day),
        day_type: normalizeCurriculumDayType(raw.dayType ?? raw.day_type) || defaultDayTypeForDay(day),
      };
    })
    .filter(Boolean);
}

function normalizeDayKeyQuestions(sourceDay) {
  const source = sourceDay.keyQuestionsWithIntent
    ?? sourceDay.key_questions_with_intent
    ?? sourceDay.keyQuestions
    ?? sourceDay.key_questions
    ?? sourceDay.questions
    ?? sourceDay.prompts
    ?? [];
  const normalized = Array.isArray(source)
    ? source.map((entry, index) => normalizeDayKeyQuestion(entry, index)).filter(Boolean)
    : [];
  if (normalized.length > 0) return normalized;

  return normalizeStringArray(sourceDay.tasks).slice(0, 3).map((task, index) => ({
    id: `task-${index + 1}`,
    questionId: `task-${index + 1}`,
    question_id: `task-${index + 1}`,
    question: task,
    intent: index === 0
      ? "Turn the Day goal into one concrete execution step."
      : "Clarify the evidence that will prove this Day progressed.",
  }));
}

function normalizeDayKeyQuestion(entry, index) {
  if (typeof entry === "string") {
    const question = entry.trim();
    if (!question) return null;
    const id = `question-${index + 1}`;
    return {
      id,
      questionId: id,
      question_id: id,
      question,
      intent: "Use the answer as real curriculum data for adaptive coaching.",
    };
  }
  const raw = objectOrEmpty(entry);
  const question = stringOrDefault(raw.question ?? raw.text ?? raw.prompt, "");
  if (!question) return null;
  const id = stringOrDefault(
    raw.id
      ?? raw.questionId
      ?? raw.question_id,
    `question-${index + 1}`,
  );
  return {
    id,
    questionId: id,
    question_id: id,
    question,
    intent: stringOrDefault(
      raw.intent
        ?? raw.intentDescription
        ?? raw.intent_description
        ?? raw.why
        ?? raw.purpose,
      "Use the answer as real curriculum data for adaptive coaching.",
    ),
  };
}

function normalizeDayQuestionProgressRecord(value) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length) return null;
  const questionId = stringOrDefault(raw.questionId ?? raw.question_id ?? raw.id, "");
  if (!questionId) return null;
  const answer = raw.answer ?? raw.answerText ?? raw.answer_text ?? raw.response ?? raw.value ?? "";
  const answeredAt = stringOrDefault(raw.answeredAt ?? raw.answered_at, "");
  const updatedAt = stringOrDefault(raw.updatedAt ?? raw.updated_at ?? answeredAt, "");
  const status = normalizeProgressEventType(raw.status ?? raw.answerStatus ?? raw.answer_status) || "draft";
  return {
    ...raw,
    questionId,
    question_id: questionId,
    question: stringOrDefault(raw.question ?? raw.prompt ?? raw.text, ""),
    intent: stringOrDefault(raw.intent ?? raw.questionIntent ?? raw.question_intent, ""),
    answer: typeof answer === "string" ? answer.trim() : answer,
    status,
    answerStatus: status,
    answer_status: status,
    answeredAt,
    answered_at: answeredAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

function isAnsweredQuestionProgressRecord(record) {
  if (!record) return false;
  const status = normalizeProgressEventType(record.status ?? record.answerStatus ?? record.answer_status);
  return Boolean(record.answer)
    && ["answered", "answer", "complete", "completed", "done"].includes(status);
}

function mergeDayQuestionProgress(existing, patch) {
  return normalizeDayQuestionProgress([
    ...normalizeDayQuestionProgress(existing),
    ...(Array.isArray(patch) ? patch : [patch]),
  ]);
}

function mergeDayQuestionProgressRecords(existing = null, next = null) {
  if (!existing) return next;
  if (!next) return existing;
  const merged = {
    ...existing,
    ...next,
    question: stringOrDefault(next.question, existing.question),
    intent: stringOrDefault(next.intent, existing.intent),
    answeredAt: stringOrDefault(next.answeredAt, existing.answeredAt),
    answered_at: stringOrDefault(next.answered_at, existing.answered_at),
    updatedAt: stringOrDefault(next.updatedAt, existing.updatedAt),
    updated_at: stringOrDefault(next.updated_at, existing.updated_at),
  };
  return normalizeDayQuestionProgressRecord(merged);
}

function buildDayQuestionProgressPatches({
  dayId,
  eventType,
  event,
  timestamp,
} = {}) {
  const patch = buildDayQuestionProgressPatch({
    dayId,
    eventType,
    event,
    timestamp,
  });
  return patch ? [patch] : [];
}

function buildDayQuestionProgressPatch({
  dayId,
  eventType,
  event,
  timestamp,
} = {}) {
  if (dayId < 2 || !isDayQuestionProgressEvent(eventType)) return null;
  const payload = objectOrEmpty(event);
  const metadata = objectOrEmpty(payload.metadata);
  const questionId = stringOrDefault(
    payload.questionId
      ?? payload.question_id
      ?? payload.id
      ?? metadata.questionId
      ?? metadata.question_id,
    "",
  );
  if (!questionId) return null;
  const answer = payload.answer
    ?? payload.answerText
    ?? payload.answer_text
    ?? payload.response
    ?? payload.value
    ?? metadata.answer
    ?? metadata.answerText
    ?? metadata.answer_text
    ?? "";
  const status = normalizeProgressEventType(
    payload.status
      ?? payload.answerStatus
      ?? payload.answer_status
      ?? metadata.status
      ?? metadata.answerStatus
      ?? metadata.answer_status,
  ) || "draft";
  return normalizeDayQuestionProgressRecord({
    questionId,
    question: payload.question ?? payload.prompt ?? payload.text ?? metadata.question ?? metadata.prompt ?? "",
    intent: payload.intent ?? payload.questionIntent ?? payload.question_intent ?? metadata.intent ?? "",
    answer,
    status,
    answeredAt: status === "answered" || status === "complete" || status === "completed" ? timestamp : "",
    updatedAt: timestamp,
  });
}

function isDayQuestionProgressEvent(eventType) {
  return new Set([
    "question_progress_saved",
    "question_answer_saved",
    "question_draft_saved",
    "draft_answer_saved",
    "answer_draft_saved",
    "answer_saved",
    "day_question_progress_saved",
    "day_question_answer_saved",
    "day_question_draft_saved",
    CURRICULUM_PROGRESS_EVENT_TYPES.dayQuestionProgressSaved,
  ]).has(eventType);
}

function normalizeDayLifecycleEvents(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = objectOrEmpty(entry);
      const type = normalizeProgressEventType(raw.type ?? raw.eventType ?? raw.event_type);
      if (!type) return null;
      return {
        type,
        occurredAt: stringOrDefault(raw.occurredAt ?? raw.occurred_at, ""),
        occurred_at: stringOrDefault(raw.occurredAt ?? raw.occurred_at, ""),
        completionDriver: raw.completionDriver === true || raw.completion_driver === true,
        completion_driver: raw.completionDriver === true || raw.completion_driver === true,
      };
    })
    .filter(Boolean);
}

function appendDayLifecycleEvent(value, entry) {
  return normalizeDayLifecycleEvents([
    ...normalizeDayLifecycleEvents(value),
    entry,
  ]);
}

function normalizeProgressEventType(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeCurriculumDayType(value) {
  const dayType = normalizeProgressEventType(value);
  return CURRICULUM_DAY_TYPE_FIRST_ENCOUNTER_TYPES.includes(dayType) ? dayType : "";
}

function isDayStartEvent(eventType) {
  return new Set([
    "day_started",
    "day_start",
  ]).has(eventType);
}

function isDayCompletionConfirmationEvent({ dayId, eventType }) {
  if (dayId === 1) {
    return eventType === CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed;
  }
  return new Set([
    "day_completed",
    "day_complete",
    "day_completion_confirmed",
    "completion_confirmed",
    "completion_card_confirmed",
    CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
  ]).has(eventType);
}

function isPartialDay1TaskProgressEvent({ dayId, eventType, event }) {
  if (dayId !== 1) return false;
  if (isKnownPartialDay1TaskProgressEventType(eventType)) return true;

  const payload = objectOrEmpty(event);
  const metadata = objectOrEmpty(payload.metadata);
  const verificationResult = objectOrEmpty(
    payload.verificationResult
      ?? payload.verification_result
      ?? metadata.verificationResult
      ?? metadata.verification_result,
  );
  const verificationState = objectOrEmpty(
    payload.verificationState
      ?? payload.verification_state
      ?? metadata.verificationState
      ?? metadata.verification_state,
  );
  const actionStatus = normalizeProgressEventType(
    payload.actionStatus
      ?? payload.action_status
      ?? metadata.actionStatus
      ?? metadata.action_status,
  );
  const progressStatus = normalizeProgressEventType(
    payload.progressStatus
      ?? payload.progress_status
      ?? payload.status
      ?? metadata.progressStatus
      ?? metadata.progress_status
      ?? metadata.status,
  );
  const answerStatus = normalizeProgressEventType(
    payload.answerStatus
      ?? payload.answer_status
      ?? metadata.answerStatus
      ?? metadata.answer_status,
  );

  return payload.draft === true
    || payload.isDraft === true
    || payload.is_draft === true
    || metadata.draft === true
    || metadata.isDraft === true
    || metadata.is_draft === true
    || answerStatus === "draft"
    || actionStatus === "incomplete"
    || actionStatus === "not_done"
    || progressStatus === "incomplete"
    || progressStatus === "draft"
    || progressStatus === "failed"
    || verificationResult.passed === false
    || normalizeProgressEventType(verificationResult.status) === "failed"
    || normalizeProgressEventType(verificationState.status) === "failed";
}

function isKnownPartialDay1TaskProgressEventType(eventType) {
  return new Set([
    "draft_answer_saved",
    "answer_draft_saved",
    "question_draft_saved",
    "day1_draft_answer_saved",
    "day1_answer_draft_saved",
    "day1_question_draft_saved",
    "incomplete_action_recorded",
    "action_incomplete",
    "action_not_done",
    "day1_incomplete_action_recorded",
    "day1_action_incomplete",
    "day1_action_not_done",
    "verification_failed",
    "action_verification_failed",
    "failed_verification_attempt",
    "day1_verification_failed",
    "day1_action_verification_failed",
    "day1_failed_verification_attempt",
    CURRICULUM_PROGRESS_EVENT_TYPES.day1DraftAnswerSaved,
    CURRICULUM_PROGRESS_EVENT_TYPES.day1IncompleteActionRecorded,
    CURRICULUM_PROGRESS_EVENT_TYPES.day1VerificationFailed,
  ]).has(eventType);
}

function normalizeCurrentWeekRawAnswers({
  currentWeekRawAnswers = null,
  dayRecords = [],
  currentWeekRange,
} = {}) {
  const explicit = Array.isArray(currentWeekRawAnswers)
    ? currentWeekRawAnswers
    : Array.isArray(currentWeekRawAnswers?.answers)
      ? currentWeekRawAnswers.answers
      : null;
  const source = explicit || (Array.isArray(dayRecords) ? dayRecords : []);
  return source
    .map(normalizeRawAnswerRecord)
    .filter((record) =>
      record
      && record.day >= currentWeekRange.start
      && record.day <= currentWeekRange.end
    )
    .sort((a, b) =>
      a.day - b.day
      || String(a.questionId).localeCompare(String(b.questionId))
      || String(a.answeredAt).localeCompare(String(b.answeredAt))
    );
}

function selectRawAnswerSource(value) {
  const source = objectOrEmpty(value);
  return source.currentWeekRawInterviewAnswers
    ?? source.current_week_raw_interview_answers
    ?? source.rawInterviewAnswers
    ?? source.raw_interview_answers
    ?? source.interviewAnswers
    ?? source.interview_answers
    ?? source.currentWeekRawAnswers
    ?? source.current_week_raw_answers
    ?? source.onboardingAnswers
    ?? source.onboarding_answers
    ?? source.rawOnboardingAnswers
    ?? source.raw_onboarding_answers
    ?? source.rawAnswers
    ?? source.raw_answers
    ?? null;
}

function selectProjectContextSource(value) {
  const source = objectOrEmpty(value);
  if (source.currentProjectContext !== undefined) return source.currentProjectContext;
  if (source.current_project_context !== undefined) return source.current_project_context;
  if (source.projectContext !== undefined) return source.projectContext;
  if (source.project_context !== undefined) return source.project_context;
  if (source.workspaceContext !== undefined) return source.workspaceContext;
  if (source.workspace_context !== undefined) return source.workspace_context;
  if (source.projectMetadata !== undefined) {
    return { metadata: source.projectMetadata };
  }
  if (source.project_metadata !== undefined) {
    return { metadata: source.project_metadata };
  }
  if (source.onboardingContext !== undefined) return source.onboardingContext;
  if (source.onboarding_context !== undefined) return source.onboarding_context;
  return null;
}

function normalizeRawAnswerRecord(value) {
  const record = objectOrEmpty(value);
  if (!Object.keys(record).length) return null;
  const day = normalizeDayNumber(record.day ?? record.dayId ?? record.day_id);
  const answer = record.answer ?? record.answerText ?? record.response ?? record.value ?? "";
  return {
    day,
    questionId: stringOrDefault(record.questionId ?? record.question_id ?? record.id, ""),
    question: stringOrDefault(record.question ?? record.prompt ?? record.text, ""),
    answer: typeof answer === "string" ? answer.trim() : answer,
    answeredAt: stringOrDefault(record.answeredAt ?? record.answered_at ?? record.updatedAt, ""),
    dayType: stringOrDefault(record.dayType ?? record.day_type ?? record.type, ""),
  };
}

function normalizeProviderWeeklySummary(value) {
  const summary = objectOrEmpty(value);
  const weekNumber = normalizeWeekNumber(summary.weekNumber ?? summary.week_number) || 1;
  return {
    id: stringOrDefault(summary.id, `week-${weekNumber}`),
    week_number: weekNumber,
    status: summary.status === "finalized" ? "finalized" : stringOrDefault(summary.status, "draft"),
    day_range: normalizeProviderDayRange(summary.dayRange ?? summary.day_range),
    completed_days: normalizeCompletedDays(summary.completedDays ?? summary.completed_days, weekNumber),
    finalized_at: stringOrDefault(summary.finalizedAt ?? summary.finalized_at, ""),
    summary_text: stringOrDefault(summary.summaryText ?? summary.summary_text, ""),
    key_insights: normalizeStringArray(summary.keyInsights ?? summary.key_insights),
    unresolved_actions: normalizeStringArray(summary.unresolvedActions ?? summary.unresolved_actions),
  };
}

function normalizeProviderRawAnswer(value) {
  const answer = normalizeRawAnswerRecord(value);
  return {
    day_id: answer.day,
    question_id: answer.questionId,
    question: answer.question,
    answer: answer.answer,
    answered_at: answer.answeredAt,
    day_type: answer.dayType,
  };
}

function normalizeProviderDayRange(value) {
  const range = objectOrEmpty(value);
  return {
    start: normalizeDayNumber(range.start),
    end: normalizeDayNumber(range.end),
  };
}

const HAVENT_DONE_PATTERNS = Object.freeze([
  /\b(i\s+)?(have\s+not|haven't|havent)\s+(done|started|sent|posted|published|written|recorded|scheduled|created|run|tried|asked|called|emailed|dm(?:ed)?|messaged)\b/i,
  /\b(i\s+)?(did\s+not|didn't|didnt)\s+(do|start|send|post|publish|write|record|schedule|create|run|try|ask|call|email|dm|message)\b/i,
  /\b(i\s+)?(could\s+not|couldn't|couldnt|was\s+not\s+able\s+to|wasn't\s+able\s+to)\s+(do|start|send|post|publish|write|record|schedule|create|run|try|ask|call|email|dm|message)\b/i,
  /\b(not\s+yet|no\s+yet|nothing\s+yet|haven't\s+yet|havent\s+yet|not\s+done\s+yet|not\s+started\s+yet)\b/i,
  /\b(no,?\s*)?(i\s+)?(haven't|havent|have\s+not|didn't|didnt|did\s+not)\.?$/i,
  /\b(still\s+need\s+to|need\s+to\s+do\s+it|need\s+to\s+start|haven't\s+gotten\s+to\s+it|didn't\s+get\s+to\s+it|didn't\s+get\s+around\s+to\s+it)\b/i,
  /\b(i\s+)?(do\s+not|don't|dont)\s+have\s+(it|that|this|the\s+evidence|the\s+link|the\s+file)\s+yet\b/i,
  /(아직|아직은|아직도).{0,12}(안\s*했|못\s*했|하지\s*못했|시작\s*안|시작\s*못|보내지\s*못|올리지\s*못|작성\s*못|실행\s*못|물어보지\s*못|못\s*보냈|안\s*보냈|안\s*올렸|안\s*씀)/i,
  /(아니요|아뇨|ㄴㄴ)?\s*아직(이요|요|입니다)?$/i,
  /(안\s*했|못\s*했|하지\s*않았|하지\s*못했|실행\s*안|실행\s*못|시작\s*안|시작\s*못)(어요|습니다|음|다|네요)?/i,
  /(못\s*하겠|못\s*하겠어요|못\s*했습니다|못\s*했어요|못했어요|안했어요|안\s*했습니다)/i,
]);

const EXPLICIT_COMPLETION_PATTERNS = Object.freeze([
  /\b(done|completed|finished|sent|posted|published|recorded|scheduled|created|ran|asked|called|emailed|dm(?:ed)?)\b/i,
  /\b(i\s+)?(did|have\s+done|finished|completed)\s+(it|this|that|the\s+action|the\s+task)\b/i,
  /(완료|했습니다|했어요|보냈어요|올렸어요|작성했어요|실행했어요|물어봤어요|끝냈어요)/i,
]);

function buildHaventDoneDetection({
  text = "",
  detected = false,
  confidence = 0,
  reason = "",
  matchedPattern = "",
} = {}) {
  return {
    detected,
    isHaventDoneItResponse: detected,
    shouldStartMiniAction: detected,
    actionSufficiency: detected ? "insufficient" : "unknown",
    reason,
    confidence,
    matchedPattern,
    normalizedText: normalizeInteractionText(text),
    coachingMode: detected ? "non_blocking_mini_action" : "none",
  };
}

function extractInteractionMessageText(message) {
  if (typeof message === "string") return message;
  const source = objectOrEmpty(message);
  const candidate = source.text
    ?? source.content
    ?? source.message
    ?? source.answer
    ?? source.value
    ?? source.input
    ?? "";
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate)) {
    return candidate
      .map((part) => typeof part === "string" ? part : objectOrEmpty(part).text)
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function normalizeInteractionText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isExplicitCompletionResponse(normalized) {
  const hasCompletion = EXPLICIT_COMPLETION_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!hasCompletion) return false;
  return !/\b(not|no|never|haven't|havent|didn't|didnt|couldn't|couldnt)\b|아직|안\s*|못\s*/i.test(normalized);
}

function normalizeProjectContext(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim();
  return objectOrEmpty(value);
}

function countMatches(text, patterns) {
  return patterns.reduce((sum, pattern) => sum + (String(text || "").match(pattern)?.length || 0), 0);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function mergeStringArraysPreservingOrder(...values) {
  const seen = new Set();
  const merged = [];
  for (const value of values) {
    for (const item of normalizeStringArray(value)) {
      if (seen.has(item)) continue;
      seen.add(item);
      merged.push(item);
    }
  }
  return merged;
}
