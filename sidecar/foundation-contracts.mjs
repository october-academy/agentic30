import { projectDocPath } from "./project-doc-paths.mjs";

export const FOUNDATION_RESOURCE_OBSERVATION_PROMPT =
  "이 순간 어떤 자료 / 예시 / 템플릿 / 외부 글이 왔으면 행동이 빨라졌나?";

export const FOUNDATION_ANTI_DISPLACEMENT_GATE = buildFoundationAntiDisplacementGate();

export function buildFoundationAntiDisplacementGate({
  evidenceRoot = "",
  weekStartDate = "",
} = {}) {
  const evidencePath = evidenceRoot
    ? `${evidenceRoot.replace(/\/$/, "")}/baseline-head.txt`
    : "<dogfood-evidence-root>/baseline-head.txt";
  const sinceDate = weekStartDate || "<week-start-date>";
  return Object.freeze({
    label: "anti-displacement",
    rule: "이번 주는 제품 개선 주가 아니라 creator dogfood 주다. Friction은 먼저 기록하고 hotfix는 주 전체 3 commits / 10 lines / 신규 파일 0개 한도 안에서만 허용한다.",
    baselineCommand: `git rev-parse HEAD > ${evidencePath}`,
    weeklyCheck: `git log --since='${sinceDate}' --oneline && git diff --stat $(cat ${evidencePath})..HEAD`,
  });
}

export const FOUNDATION_VALUE_CONTRACTS = Object.freeze({
  1: contract({
    value: "프로젝트 목표를 ICP, Pain Point, Outcome이 담긴 핵심 가설로 압축해 Day 2 시장 검증 기준점을 만든다.",
    evidenceArtifact: `${projectDocPath("goal")}, ${projectDocPath("icp")}, ${projectDocPath("spec")} v0, day-1-alignment-statement.md`,
    canonicalDocs: [
      doc(projectDocPath("goal"), "Day 1 project goal이 첫 고객 검증 목표로 한 문장에 고정됐는지"),
      doc(projectDocPath("icp"), "ICP/Pain Point/Outcome이 담긴 핵심 가설과 anti-ICP 경계가 실제 행동 근거로 좁혀졌는지"),
      doc(projectDocPath("spec"), "핵심 가설이 SPEC v0 baseline과 Day 2 시장 신호 확인 기준으로 들어갔는지"),
    ],
    passGate: "Project Goal + ICP + Pain Point + Outcome이 담긴 핵심 가설이 7.0/10 이상이고 Day 2에서 검증할 시장 신호 기준이 있다.",
    failGate: "목표, 고객, 통증, 결과 중 하나가 비어 있거나 founder 추측만 있고 Day 2로 넘길 검증 기준이 없다.",
  }),
  2: contract({
    value: "이미 돈이 흐르는 기준 시장을 찾아 이 문제가 지불 행동과 닿아 있는지 확인한다.",
    evidenceArtifact: `${projectDocPath("icp")}, ${projectDocPath("spec")}, day-2-evidence-log.md`,
    canonicalDocs: [
      doc(projectDocPath("icp"), "현재 대안/status quo와 이미 돈이 흐르는 adjacent market이 연결됐는지"),
      doc(projectDocPath("spec"), "대체재 5개, 가격/리뷰/광고 흔적, 반증 1개가 제품 가설 근거로 반영됐는지"),
    ],
    passGate: "유료/광고/구독 대체재 5개 + 반증 1개가 기록됐다.",
    failGate: "경쟁/대체재가 없거나 '좋아 보임' 수준의 해석만 있다.",
  }),
  3: contract({
    value: "약한 가설을 검증/반증할 Mom Test 질문으로 바꿔 실제 사람 앞에 가져갈 수 있게 한다.",
    evidenceArtifact: `${projectDocPath("icp")}, ${projectDocPath("goal")}, ${projectDocPath("spec")} v1, day-3-interview-script.md`,
    canonicalDocs: [
      doc(projectDocPath("icp"), "인터뷰 대상과 validation signals가 실제 ICP 조건에 맞게 좁혀졌는지"),
      doc(projectDocPath("goal"), "이번 주 고객 대화/DM lock-in이 KR 또는 weekly milestone으로 들어갔는지"),
      doc(projectDocPath("spec"), "약한 가설과 그 가설을 검증/반증할 질문 5개가 SPEC v1 기준에 반영됐는지"),
    ],
    passGate: "질문 5개 중 과거 행동 질문이 3개 이상이고 미래 의향 질문은 0개다.",
    failGate: "'쓸래요?', '괜찮아 보여요?' 같은 미래 의향/칭찬 유도 질문이 남아 있다.",
    externalLockIn:
      "이름이 확인된 ICP 후보 최소 1명에게 보낼 DM 초안과 발송/인터뷰 후보 시간을 캘린더에 고정한다.",
  }),
  4: contract({
    value: "24시간 신호로 SPEC의 약한 섹션을 더 좁은 wedge로 다시 써서 차별점을 만든다.",
    evidenceArtifact: `${projectDocPath("values")}, ${projectDocPath("spec")}, day-4-rewrite-decision.md`,
    canonicalDocs: [
      doc(projectDocPath("values"), "Narrow beats wide / 고객이 먼저다 같은 결정 원칙이 오늘 tradeoff에 적용됐는지"),
      doc(projectDocPath("spec"), "약한 섹션이 더 좁은 페르소나, 더 빠른 결과, 더 적은 클릭, 더 낮은 가격 중 하나로 재작성됐는지"),
    ],
    passGate: "더 좁은 페르소나, 더 빠른 결과, 더 적은 클릭, 더 낮은 가격 중 10배 wedge 1개가 선택됐다.",
    failGate: "기능 추가나 넓은 포지셔닝으로 도망가고 어떤 점이 10배인지 설명하지 못한다.",
  }),
  5: contract({
    value: "허수 지표와 진짜 수요 신호를 분리해 계속 만들 근거가 있는지 숫자로 판단한다.",
    evidenceArtifact: `${projectDocPath("goal")}, ${projectDocPath("icp")}, ${projectDocPath("spec")} v2, day-5-demand-signal.md`,
    canonicalDocs: [
      doc(projectDocPath("goal"), "Product Signals 표에 reply/install/price signal 같은 행동 지표가 들어갔는지"),
      doc(projectDocPath("icp"), "긍정/경고 신호가 실제 수요 신호와 허수 지표를 구분하도록 갱신됐는지"),
      doc(projectDocPath("spec"), "demand signal 판단과 반증이 SPEC v2에 반영됐는지"),
    ],
    passGate: "reply/install/price signal 중 최소 1개가 돈 낼 후보 1명으로 이어지는지 평가됐다.",
    failGate: "CTR, waitlist, 조회수만 보고 수요가 있다고 해석한다.",
  }),
  6: contract({
    value: "칭찬이 아니라 돈/시간/약속을 요구해 지불 의향의 원문 증거를 만든다.",
    evidenceArtifact: `${projectDocPath("values")}, ${projectDocPath("goal")}, ${projectDocPath("spec")}, monetization-ask-result.md`,
    canonicalDocs: [
      doc(projectDocPath("values"), "고객이 먼저다 / 숫자로 결정하라 / 책임감 원칙이 실제 ask 행동으로 검증됐는지"),
      doc(projectDocPath("goal"), "ask 대상, 가격/시간 약속, 응답 기한, 결과가 Dogfood Evidence로 기록됐는지"),
      doc(projectDocPath("spec"), "monetization/ask evidence가 MVP success metric 또는 go/no-go 기준에 연결됐는지"),
    ],
    passGate: "이름 + 가격/받을 약속 + 응답 기한 + yes/no/no-reply 원문이 있다.",
    failGate: "대상자 이름이 없거나 가격/기한 없이 일반 관심만 물었다.",
  }),
  7: contract({
    value: "7일 증거로 계속 / 재시작 / 피벗 중 하나를 고르고 다음 7일의 방향을 닫는다.",
    evidenceArtifact: `${projectDocPath("icp")}, ${projectDocPath("values")}, ${projectDocPath("goal")}, ${projectDocPath("spec")} v3, go-no-go.md, foundation-summary.md`,
    canonicalDocs: [
      doc(projectDocPath("icp"), "7일 증거로 ICP/anti-ICP/validation signals가 더 좁아졌는지"),
      doc(projectDocPath("values"), "이번 주 실제 tradeoff가 가치 원칙을 강화했는지, 틀렸다면 어떤 원칙을 고쳐야 하는지"),
      doc(projectDocPath("goal"), "weekly check-in, product signals, next week commitments가 evidence 기반으로 갱신됐는지"),
      doc(projectDocPath("spec"), "SPEC v3가 계속/재시작/피벗 결정과 다음 proof target을 반영하는지"),
    ],
    passGate: "가장 강한 증거와 가장 강한 반증을 모두 적고 한 결정을 선택했다.",
    failGate: "증거 없이 계속하거나, 결정을 다음 주로 미룬다.",
  }),
});

export function getFoundationValueContract(dayInput, options = {}) {
  const day = Number(dayInput);
  if (!Number.isFinite(day)) return null;
  const contract = FOUNDATION_VALUE_CONTRACTS[Math.trunc(day)];
  return contract ? cloneContract(contract, options) : null;
}

export function buildFoundationFrictionLogTemplate({ day, date = "", evidenceRoot = "", weekStartDate = "" } = {}) {
  const valueContract = getFoundationValueContract(day, { evidenceRoot, weekStartDate });
  const dayLabel = Number.isFinite(Number(day)) ? `Day ${Math.trunc(Number(day))}` : "Day ?";
  return [
    `# ${dayLabel} Friction Log${date ? ` - ${date}` : ""}`,
    "",
    "## VALUE contract",
    `- Today value: ${valueContract?.todayValue || "(미정)"}`,
    `- Evidence artifact: ${valueContract?.evidenceArtifact || "(미정)"}`,
    `- Pass gate: ${valueContract?.passGate || "(미정)"}`,
    `- Fail gate: ${valueContract?.failGate || "(미정)"}`,
    "",
    "## Canonical docs evidence",
    ...(valueContract?.canonicalDocs?.length
      ? valueContract.canonicalDocs.map((entry) => `- ${entry.path}: ${entry.evidence}`)
      : ["- (미정)"]),
    "",
    "## Execution",
    "- Input used:",
    "- Task attempted:",
    "- Result:",
    "",
    "## Friction",
    "- Where I got stuck:",
    "- Workaround:",
    "- Would an external user churn here? yes/no + why:",
    "",
    "## Needed resource",
    `- ${FOUNDATION_RESOURCE_OBSERVATION_PROMPT}`,
    "",
  ].join("\n");
}

export function formatFoundationEvidenceSpineLines() {
  return [
    "## Foundation Evidence Spine",
    "Foundation Day 1-7 is not a set of detached worksheets. It is a progressive rewrite of the four canonical product docs.",
    ...Object.keys(FOUNDATION_VALUE_CONTRACTS)
      .map((day) => Number(day))
      .sort((a, b) => a - b)
      .map((day) => formatEvidenceSpineDayLine(day, FOUNDATION_VALUE_CONTRACTS[day])),
    "- Supporting `day-N-*.md` files are allowed, but they are scratch evidence. The durable curriculum evidence must land in the canonical docs.",
  ];
}

function contract({
  value,
  evidenceArtifact,
  canonicalDocs = [],
  passGate,
  failGate,
  externalLockIn = "",
}) {
  return Object.freeze({
    todayValue: value,
    evidenceArtifact,
    canonicalDocs: Object.freeze(canonicalDocs.map((entry) => Object.freeze({ ...entry }))),
    passGate,
    failGate,
    frictionLogPrompt:
      "어디서 막혔나, 어떻게 우회했나, 외부 유저라면 여기서 이탈했을지 기록한다.",
    resourceObservationPrompt: FOUNDATION_RESOURCE_OBSERVATION_PROMPT,
    frictionLogTemplateHint: "Use buildFoundationFrictionLogTemplate({ day }) for the daily log skeleton.",
    externalLockIn,
    antiDisplacementGate: FOUNDATION_ANTI_DISPLACEMENT_GATE,
  });
}

function cloneContract(value, options = {}) {
  return {
    ...value,
    canonicalDocs: value.canonicalDocs.map((entry) => ({ ...entry })),
    antiDisplacementGate: {
      ...buildFoundationAntiDisplacementGate({
        evidenceRoot: options.evidenceRoot,
        weekStartDate: options.weekStartDate,
      }),
    },
  };
}

function doc(path, evidence) {
  return { path, evidence };
}

function formatEvidenceSpineDayLine(day, valueContract) {
  const docs = formatDocPathList(valueContract.canonicalDocs.map((entry) => entry.path));
  const evidence = valueContract.canonicalDocs.map((entry) => entry.evidence).join("; ");
  return `- Day ${day} evidence updates ${docs}: ${evidence}.`;
}

function formatDocPathList(paths) {
  const formatted = paths.map((docPath) => `\`${docPath}\``);
  if (formatted.length <= 1) return formatted.join("");
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
}
