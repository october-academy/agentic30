const DAY_COUNT = 30;

export const IDD_CURRICULUM_SCHEMA_VERSION = 1;

export const AGENTIC30_THREE_LAYERS = Object.freeze({
  founder: Object.freeze({
    name: "Founder",
    subject: "나, Founder/CEO/첫 사용자",
    question: "오늘 카드가 내 실제 행동을 바꿨나?",
    successSignal: "daily dogfood, interviews, journal, BIP, DM/ask execution",
  }),
  company: Object.freeze({
    name: "October Academy",
    subject: "교육회사",
    question: "이 실행이 지혜/판단 훈련 자산으로 남나?",
    successSignal: "repeatable education asset, scalable revenue engine, Agentic Engineer rubric evidence",
  }),
  product: Object.freeze({
    name: "Agentic30",
    subject: "제품",
    question: "30일/100명/첫 매출 가설을 강화하나?",
    successSignal: "IDD loop, adaptive curriculum, 100 users, first revenue",
  }),
});

export const IDD_BASE_CURRICULUM = Object.freeze([
  day(1, "foundation", "Vault와 첫 인터뷰 증거를 연결한다", "Vault", "Obsidian/로컬 폴더를 연결하고 L2 인터뷰 1건을 IDD Engine의 첫 입력으로 만든다.", ["vault path 지정", "interviews/journal/bip 폴더 규약 확인", "첫 L2 transcript 또는 인터뷰 후보 1명 기록"], "vault 연결 로그, 첫 L2 evidence"),
  day(2, "foundation", "고객의 과거 행동을 한 문장으로 압축한다", "Pain", "첫 L2 발화에서 실제 과거 행동과 status quo를 분리한다.", ["L2 인용 1개 고르기", "현재 대안/status quo 적기", "Mom Test 후속 질문 3개 작성"], "pain quote, status quo, 질문 3개"),
  day(3, "foundation", "반증 가능한 가설을 만든다", "Hypothesis", "통증을 제품 아이디어가 아니라 검증 가능한 가설로 바꾼다.", ["가설 ID 1개 만들기", "강화 증거와 반증 증거 기준 쓰기", "다음 인터뷰 대상 1명 정하기"], "검증 가설 v0"),
  day(4, "foundation", "두 번째 L2 증거를 확보한다", "Second L2", "한 명의 발화를 일반화하지 않도록 두 번째 고객 증거를 모은다.", ["후속 인터뷰 또는 DM 보내기", "새 인용을 첫 인용과 비교", "반복 표현 표시"], "L2 quote comparison"),
  day(5, "foundation", "가장 작은 유료/사용 가능 wedge를 정한다", "Wedge", "풀 비전 대신 이번 주 한 사람이 쓸 수 있는 가장 작은 버전을 고른다.", ["narrowest wedge 1개 선택", "제외할 범위 3개 쓰기", "첫 CTA 문장 작성"], "wedge, non-goals, CTA"),
  day(6, "foundation", "돈/시간 ask를 한다", "Ask", "칭찬이 아니라 시간, 돈, 다음 일정 약속을 요청한다.", ["ask 대상 1명 선택", "가격 또는 시간 약속 문장 작성", "yes/no/no-reply 기록"], "monetization/time ask result"),
  day(7, "foundation", "Foundation Go/No-Go를 결정한다", "Go/No-Go", "7일 기록으로 계속/재시작/피벗 중 하나를 고른다.", ["인터뷰/일지/BIP 수량 세기", "가장 강한 증거와 반증 쓰기", "다음 7일 결론 선택"], "go-no-go.md, foundation-summary"),
  day(8, "build", "MVP를 IDD loop 하나로 자른다", "MVP Cut", "기능 목록이 아니라 매일 카드 loop를 완성 대상으로 고정한다.", ["P0 loop 경로 그리기", "부차 기능 deferred 표시", "첫 happy path 테스트 작성"], "P0 loop spec"),
  day(9, "build", "폴더 watch와 색인 상태를 보이게 만든다", "Ingest", "복붙 마찰 0이라는 차별화의 못을 구현한다.", ["watch 대상 폴더 확인", "md/txt 변경 감지 로그 남기기", "qmd 색인 성공/실패 상태 표시"], "ingest status"),
  day(10, "build", "아침 카드 JSON을 고정한다", "Card JSON", "인사이트/질문/행동의 출력 스키마를 안정화한다.", ["card JSON schema 작성", "L2 인용 필수 rule 추가", "0건 폴백 rule 추가"], "morning card schema"),
  day(11, "build", "어제 응답을 오늘 카드에 반영한다", "Memory", "완료/스킵/다시 묻기가 다음 날 prompt에 들어가게 한다.", ["응답 저장 위치 정하기", "다음 카드 context에 주입", "스킵 시 축소 미션 생성"], "response memory loop"),
  day(12, "build", "첫 end-to-end dogfood를 돈다", "E2E", "실제 vault에서 색인부터 카드까지 한 번 지나간다.", ["실제 인터뷰 파일 넣기", "카드 생성 실행", "추천 행동 수행 여부 기록"], "dogfood E2E log"),
  day(13, "build", "온보딩 마찰을 줄인다", "Onboarding", "qmd/권한/폴더 규약에서 멈추는 지점을 제거한다.", ["첫 실행을 새 환경에서 반복", "qmd 다운로드/실패 문구 확인", "필수 설명 5줄 이하로 줄이기"], "time-to-first-card note"),
  day(14, "build", "출처 UI와 신뢰도를 붙인다", "Evidence UI", "왜 이 행동을 추천하는지 사용자가 확인할 수 있게 한다.", ["인용 출처 표시", "최근 날짜/빈도 표시", "근거 부족 badge 추가"], "evidence card UI"),
  day(15, "build", "품질 회귀 테스트를 만든다", "Quality", "일반론 카드와 무근거 조언을 테스트로 막는다.", ["fixture transcript 작성", "카드 rule-check 추가", "인용 없는 insight 실패 처리"], "card quality tests"),
  day(16, "build", "실패 복구 흐름을 닫는다", "Recovery", "qmd/provider/권한 실패가 침묵으로 끝나지 않게 한다.", ["qmd unavailable fallback", "provider failure message", "다음 행동 fallback 카드"], "recovery matrix"),
  day(17, "build", "Build phase를 줄일지 결정한다", "Build Retro", "기능 추가가 아니라 daily use 기준으로 남길 것을 고른다.", ["7일 사용 로그 확인", "가장 자주 열린 화면 확인", "삭제/유지/다음 phase 결정"], "build decision memo"),
  day(18, "launch", "고객 언어로 launch story를 쓴다", "Story", "제품 설명보다 반복된 L2 표현으로 공개한다.", ["반복 인용 3개 선택", "launch hook 3개 작성", "가장 강한 status quo로 시작"], "launch story draft"),
  day(19, "launch", "첫 공개 proof를 만든다", "Public Proof", "불완전한 앱 상태보다 배운 고객 증거를 공개한다.", ["아침 카드 스크린샷/요약 선택", "실행 결과 1개 쓰기", "Threads/BIP 게시"], "public proof post"),
  day(20, "launch", "warm outreach를 보낸다", "Outreach", "가장 절박한 사람에게 직접 확인한다.", ["20명 후보 목록", "개인화 DM 10개", "응답/무응답 Sheet 기록"], "outreach tracker"),
  day(21, "launch", "첫 설치/사용 관찰을 한다", "Observe", "시연이 아니라 옆에서 사용자가 막히는 장면을 본다.", ["테스터 1명 설치 관찰", "막힌 단계 기록", "수정 3개 이하 선택"], "observation note"),
  day(22, "launch", "60초 demo를 만든다", "Demo", "아침 카드 가치가 60초 안에 보이게 한다.", ["한 transcript에서 카드까지 녹화", "인용/질문/행동이 보이게 자르기", "caption 작성"], "60s demo"),
  day(23, "launch", "반대 이유를 분류한다", "Objections", "설치/신뢰/가치/가격 중 어디서 막히는지 나눈다.", ["거절 이유 수집", "상위 blocker 1개 선택", "다음 실험으로 변환"], "objection map"),
  day(24, "launch", "Launch 결정을 숫자로 한다", "Launch Decision", "조회수가 아니라 DM/설치/사용/ask 결과로 다음 7일을 고른다.", ["유입/설치/카드 생성/ask 숫자 정리", "가장 강한 채널 선택", "다음 실험 1개 결정"], "launch decision"),
  day(25, "grow", "activation을 정의한다", "Activation", "가입이 아니라 첫 가치 경험을 측정한다.", ["첫 가치 행동 정의", "도달/이탈 수 계산", "가장 큰 이탈 지점 선택"], "activation baseline"),
  day(26, "grow", "retention 신호를 본다", "Retention", "다시 돌아와 기록을 넣는 사람이 있는지 확인한다.", ["재방문 기준 정하기", "반복 사용 발화 찾기", "돌아온 이유 한 문장 작성"], "retention note"),
  day(27, "grow", "가격 ask를 반복한다", "Pricing", "첫 매출은 큰 금액보다 지불 행동 증명이다.", ["유료 제안 1개 작성", "관심 사용자에게 제안", "가격 반응 기록"], "pricing ask result"),
  day(28, "grow", "support loop를 만든다", "Support", "질문과 실패를 제품 개선 입력으로 돌린다.", ["반복 질문 5개 수집", "앱/문서/온보딩 중 처리 위치 선택", "하나 바로 수정"], "support insight log"),
  day(29, "grow", "PMF evidence memo를 쓴다", "PMF Memo", "100명/첫 매출과 반증을 같은 문서에 둔다.", ["100명 진행률", "첫 매출 진행률", "가장 강한 신호와 반증 작성"], "PMF evidence memo"),
  day(30, "grow", "계속/전환/중단을 결정한다", "Final Decision", "완주가 아니라 다음 선택을 공개한다.", ["30일 숫자 요약", "가장 큰 배움 3개", "continue/pivot/stop 결정"], "Day 30 public retro"),
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
    source: "docs/MAC_APP_DIRECTION.md",
    strategy: {
      northStar: "IDD Engine dogfood loop",
      p0: "folder watch + qmd index + 09:00 card + response memory + Day 7 Go/No-Go",
      antiValidation: "Creator product reaches 100 users and first revenue by Day 30",
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
  const hasRevenueSignal = /(매출|결제|paid|payment|price|가격|돈\s*내|구매|revenue)/i.test(haystack);
  const hasNoReply = /(no[-_\s]?reply|무응답|답\s*못|응답\s*없)/i.test(haystack);
  const hasUserCountSignal = /(100명|가입|사용자|active user|download|설치)/i.test(haystack);
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
    `Founder: ${AGENTIC30_THREE_LAYERS.founder.question}`,
    `Company: ${AGENTIC30_THREE_LAYERS.company.question}`,
    `Product/Agentic30: ${AGENTIC30_THREE_LAYERS.product.question}`,
  ];
  if (signals.currentMissionCompleted) {
    checks[0] = "Founder: 어제 완료한 미션이 오늘의 첫 근거로 들어갔나?";
  }
  if (base.phase === "launch") {
    checks[1] = "Company: 이 공개 기록이 October Academy의 교육/커뮤니티 flywheel 증거로 남나?";
  }
  if (base.phase === "grow") {
    checks[2] = "Product/Agentic30: 100명/첫 매출 기준에서 계속/전환/중단 판단이 가능해졌나?";
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
  if (base.phase === "grow") return "100명/첫 매출 기준에서 오늘 가장 비싼 전제는 무엇이고 왜 아직 믿어?";
  return "이번 주 한 명에게 유용한 가장 작은 버전은 뭐야?";
}

function stopOrPivotCheckFor(base) {
  if (base.day === 7) return "5-7건 인터뷰, 7건 일지, 2-3건 BIP가 없으면 Go가 아니라 재시작 후보로 본다.";
  if (base.day === 30) return "Creator 제품 100명 미달 또는 첫 매출 0원이면 IDD Engine hard stop.";
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
