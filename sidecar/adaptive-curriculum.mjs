const DAY_COUNT = 30;

export const IDD_CURRICULUM_SCHEMA_VERSION = 1;

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
  day(1, "foundation", "고객의 어제 행동에서 통증 1개를 압축한다", "Pain", "4종 인풋에서 가장 압축된 고객 통증 1개를 뽑고 SPEC.md v0의 기준으로 둔다.", ["고객 발화 또는 문제 메모에서 과거 행동 1개 고르기", "status quo와 비용/시간/실수 단위로 적기", "SPEC.md v0에 통증 1개와 근거 1개 기록"], "SPEC.md v0, pain quote, status quo"),
  day(2, "foundation", "돈이 흐르는 기준 시장을 고른다", "Market", "어제 통증과 가까운 iOS/Android/Web/Mac 앱·도구 시장에서 이미 지불 행동이 있는지 확인한다.", ["카테고리 1-2개 고르기", "작은 팀/개인이 만든 유료 앱·광고 앱 5개 찾기", "가격·리뷰·ASO·광고/콘텐츠 흔적을 day-2-evidence-log.md에 기록"], "day-2-evidence-log.md"),
  day(3, "foundation", "Mom Test 인터뷰 질문을 만든다", "Mom Test", "약한 가설을 검증/반증할 5문장 인터뷰 질문을 만들고 미래 의향 질문을 제거한다.", ["과거 행동 질문 3개 이상 쓰기", "미래 의향/칭찬 유도 질문 제거", "다음 인터뷰 대상 1명과 질문 5개 확정"], "day-3-interview-script.md"),
  day(4, "foundation", "10배 wedge로 약한 섹션을 다시 쓴다", "10x Wedge", "경쟁 앱을 베끼지 않고 더 좁은 페르소나나 더 빠른 결과로 SPEC.md의 약한 섹션을 다시 쓴다.", ["원조/대체재의 핵심 흐름 1개 고르기", "가격·속도·UX·페르소나 중 10배 wedge 1개 선택", "SPEC.md 같은 파일에서 약한 섹션 다시 쓰기"], "day-4-rewrite-decision.md"),
  day(5, "foundation", "수요 시그널을 숫자로 평가한다", "Demand Signal", "경쟁앱/광고/노출/스토어/랜딩/DM 데이터를 진짜 수요 신호와 허수로 분리한다.", ["impressions/clicks/signups/replies/CPI/store conversion 중 있는 숫자 정리", "waitlist/CTR이 아닌 돈 낼 후보 1명 고르기", "SPEC.md v2에 demand signal 판단 기록"], "SPEC.md v2, day-5-demand-signal.md"),
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
  return {
    schemaVersion: IDD_CURRICULUM_SCHEMA_VERSION,
    generatedAt: toIso(now),
    source: "docs/AGENTIC30-DIRECTION.md",
    strategy: {
      northStar: "IDD Engine dogfood loop",
      p0: "folder watch + qmd index + 09:00 card + response memory + Day 7 Go/No-Go",
      antiValidation: "Day 30 decision has no real-user evidence or explicit ask outcome",
      layers: AGENTIC30_THREE_LAYERS,
    },
    signals,
    selectedDay: mergeSelectedOverride(selected, selectedDay),
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
  return {
    ...generated,
    phase: stringOrDefault(selected.phase, generated.phase),
    phaseTitle: stringOrDefault(selected.phaseTitle, generated.phaseTitle || phaseTitle(generated.phase)),
    title: stringOrDefault(selected.title, generated.title),
    shortTitle: stringOrDefault(selected.shortTitle, generated.shortTitle),
    summary: generated.summary,
    tasks: generated.tasks,
    output: generated.output,
    staticDay: {
      title: stringOrDefault(selected.title, ""),
      tasks: normalizeStringArray(selected.tasks),
      output: stringOrDefault(selected.output, ""),
    },
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

function suggestDay({ interviewCount, bipCount, hasRevenueSignal, hasUserCountSignal }) {
  if (interviewCount === 0) return 1;
  if (interviewCount < 2) return 4;
  if (!hasRevenueSignal) return 6;
  if (bipCount < 7) return 7;
  if (!hasUserCountSignal) return 20;
  return 29;
}

function day(dayNumber, phase, title, shortTitle, summary, tasks, output) {
  return Object.freeze({
    day: dayNumber,
    phase,
    phaseTitle: phaseTitle(phase),
    title,
    shortTitle,
    summary,
    tasks,
    output,
  });
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
