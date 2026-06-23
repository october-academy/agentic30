import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import {
  resolveAgentic30MemoryDir,
  resolveNewsMarketRadarCachePath,
} from "./news-market-radar.mjs";

export const DAY1_SURFACE_REVIEW_SCHEMA_VERSION = 1;
export const DAY1_SURFACE_REVIEW_SCHEMA = "agentic30.memory.surface_review.v1";

const MAX_TEXT = 2_000;
const MAX_LONG_TEXT = 40_000;
const DECISION_STATUSES = new Set(["pending", "approved", "rejected"]);
const MODES = new Set(["no_landing", "existing_url"]);

export function resolveDay1SurfaceReviewPath(workspaceRoot) {
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "surface-review.json");
}

export async function loadDay1SurfaceReview({
  workspaceRoot,
  fsImpl = fs,
  now = new Date(),
} = {}) {
  if (!workspaceRoot) return null;
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveDay1SurfaceReviewPath(workspaceRoot), "utf8"));
    return normalizeDay1SurfaceReview(raw, { workspaceRoot, now });
  } catch {
    return null;
  }
}

export async function saveDay1SurfaceReview({
  workspaceRoot,
  review,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "day1_surface_review_save");
  const filePath = resolveDay1SurfaceReviewPath(workspaceRoot);
  const normalized = normalizeDay1SurfaceReview(review, { workspaceRoot, now });
  return withFileLock(filePath, async () => {
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

export async function generateDay1SurfaceReview({
  workspaceRoot,
  mode = "no_landing",
  landingUrl = "",
  scanResult = null,
  onboardingHypothesis = null,
  day1AlignmentPlan = null,
  day1IcpPlan = null,
  day1SituationSummary = null,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "day1_surface_review_generate");
  const resolvedMode = normalizeMode(mode);
  const docs = await readSurfaceInputs(workspaceRoot);
  const facts = deriveSurfaceFacts({
    workspaceRoot,
    docs,
    scanResult,
    onboardingHypothesis,
    day1AlignmentPlan,
    day1IcpPlan,
    day1SituationSummary,
  });
  assertMinimumSurfaceFacts(facts);

  if (resolvedMode === "existing_url") {
    const url = normalizeAllowedLandingUrl(landingUrl);
    const fetched = await fetchLandingPage(url, { fetchImpl });
    const diagnosis = diagnoseLandingPage({ url, fetched, facts });
    return normalizeDay1SurfaceReview({
      workspaceRoot,
      mode: resolvedMode,
      landingUrl: url,
      status: "preview_ready",
      generatedAt: now.toISOString(),
      facts,
      customerSurface: diagnosis.improvedSurface,
      diagnosis,
      proposals: [
        {
          path: url,
          action: "copy_update",
          title: "첫 화면 개선 문구",
          content: formatExistingLandingCopyProposal(diagnosis),
          rationale: diagnosis.issues.map((issue) => issue.summary),
          isWritten: false,
        },
      ],
      reasons: buildReasons(diagnosis.improvedSurface, facts),
      decision: { status: "pending", decidedAt: null, appliedFiles: [] },
    }, { workspaceRoot, now });
  }

  const landingHtml = buildLandingHtml(facts);
  const readmeRewrite = buildReadmeRewrite({ facts, docs });
  return normalizeDay1SurfaceReview({
    workspaceRoot,
    mode: resolvedMode,
    landingUrl: "",
    status: "preview_ready",
    generatedAt: now.toISOString(),
    facts,
    customerSurface: {
      headline: facts.headline,
      subheadline: facts.subheadline,
      audience: facts.customer,
      problem: facts.problem,
      currentAlternative: facts.currentAlternative,
      firstValue: facts.firstValue,
      cta: facts.cta,
    },
    diagnosis: null,
    proposals: [
      {
        path: "landing.html",
        action: "create",
        title: "첫 고객 랜딩 초안",
        content: landingHtml,
        rationale: [
          "랜딩 파일이 없을 때 루트에 바로 둘 수 있는 단일 HTML입니다.",
          "첫 화면에서 고객, 문제, 현재 대안, 첫 가치, 파일럿 CTA를 모두 노출합니다.",
        ],
        isWritten: false,
      },
      {
        path: "README.md",
        action: "rewrite",
        title: "고객 언어 중심 README 재작성",
        content: readmeRewrite,
        rationale: [
          "기술/설치 사실은 하단에 보존하고 첫 문단을 고객 문제 중심으로 바꿉니다.",
          "사용자가 오늘 보낼 수 있는 파일럿 CTA를 README에도 남깁니다.",
        ],
        isWritten: false,
      },
    ],
    reasons: buildReasons({
      headline: facts.headline,
      subheadline: facts.subheadline,
      audience: facts.customer,
      problem: facts.problem,
      currentAlternative: facts.currentAlternative,
      firstValue: facts.firstValue,
      cta: facts.cta,
    }, facts),
    decision: { status: "pending", decidedAt: null, appliedFiles: [] },
  }, { workspaceRoot, now });
}

export async function applyDay1SurfaceReviewDecision({
  workspaceRoot,
  decision,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "day1_surface_review_decide");
  const status = normalizeDecisionStatus(decision);
  if (status === "pending") {
    throw new Error("day1_surface_review_decide requires approved or rejected.");
  }
  const current = await loadDay1SurfaceReview({ workspaceRoot, now });
  if (!current) {
    throw new Error("day1_surface_review_decide requires an existing surface review.");
  }

  const appliedFiles = [];
  const proposals = current.proposals.map((proposal) => ({ ...proposal }));
  if (status === "approved") {
    for (const proposal of proposals) {
      if (!isWritableProposal(proposal)) continue;
      const targetPath = resolveWorkspaceProposalPath(workspaceRoot, proposal.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, proposal.content, "utf8");
      proposal.isWritten = true;
      appliedFiles.push(proposal.path);
    }
  }

  const next = normalizeDay1SurfaceReview({
    ...current,
    status,
    proposals,
    decision: {
      status,
      decidedAt: now.toISOString(),
      appliedFiles,
    },
    decidedAt: now.toISOString(),
    appliedFiles,
  }, { workspaceRoot, now });
  return saveDay1SurfaceReview({ workspaceRoot, review: next, now });
}

export function summarizeDay1SurfaceReviewForMemory(review = null) {
  const normalized = normalizeDay1SurfaceReview(review, { workspaceRoot: review?.workspaceRoot || "" });
  const status = normalized.decision.status;
  if (!["approved", "rejected"].includes(status)) return null;
  const cta = cleanString(normalized.customerSurface.cta, 180) || "파일럿 신청 CTA";
  const appliedFiles = normalized.decision.appliedFiles;
  const filesText = appliedFiles.length ? appliedFiles.join(", ") : "없음";
  return {
    decisionStatus: status,
    cta,
    appliedFiles,
    summary: `처음 보여줄 문장 ${status} · CTA ${cta} · 반영 파일 ${filesText}`,
  };
}

export function normalizeDay1SurfaceReview(value = {}, { workspaceRoot = "", now = new Date() } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = normalizeMode(source.mode ?? source.flow ?? source.surfaceMode);
  const decision = normalizeDecision(source.decision, source);
  const proposals = normalizeProposals(source.proposals);
  const surface = normalizeCustomerSurface(source.customerSurface ?? source.customer_surface, source.facts);
  return {
    schemaVersion: DAY1_SURFACE_REVIEW_SCHEMA_VERSION,
    schema: DAY1_SURFACE_REVIEW_SCHEMA,
    workspaceRoot: cleanString(source.workspaceRoot ?? source.workspace_root ?? workspaceRoot, MAX_TEXT),
    mode,
    landingUrl: cleanString(source.landingUrl ?? source.landing_url, MAX_TEXT),
    status: normalizeStatus(source.status, decision.status),
    generatedAt: normalizeIsoDate(source.generatedAt ?? source.generated_at, now),
    decidedAt: decision.decidedAt,
    customerSurface: surface,
    diagnosis: normalizeDiagnosis(source.diagnosis, surface),
    proposals,
    reasons: normalizeReasons(source.reasons),
    decision,
    appliedFiles: decision.appliedFiles,
  };
}

function normalizeMode(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "none" || token === "no" || token === "missing") return "no_landing";
  if (token === "url" || token === "existing" || token === "has_landing") return "existing_url";
  return MODES.has(token) ? token : "no_landing";
}

function normalizeStatus(value, fallback = "pending") {
  const token = String(value || "").trim().toLowerCase();
  if (token === "preview_ready" || token === "error") return token;
  if (DECISION_STATUSES.has(token)) return token;
  return fallback || "pending";
}

function normalizeDecisionStatus(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "approve") return "approved";
  if (token === "reject") return "rejected";
  return DECISION_STATUSES.has(token) ? token : "pending";
}

function normalizeDecision(value = {}, source = {}) {
  const decision = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = normalizeDecisionStatus(decision.status ?? source.decisionStatus ?? source.status);
  return {
    status,
    decidedAt: status === "pending" ? null : nullableIsoDate(decision.decidedAt ?? decision.decided_at ?? source.decidedAt ?? source.decided_at),
    appliedFiles: normalizeStringArray(decision.appliedFiles ?? decision.applied_files ?? source.appliedFiles ?? source.applied_files, 20, 240),
  };
}

function normalizeCustomerSurface(value = {}, facts = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    headline: cleanString(source.headline ?? facts.headline, 180),
    subheadline: cleanString(source.subheadline ?? facts.subheadline, 320),
    audience: cleanString(source.audience ?? source.customer ?? facts.customer, 240),
    problem: cleanString(source.problem ?? facts.problem, 320),
    currentAlternative: cleanString(source.currentAlternative ?? source.current_alternative ?? facts.currentAlternative, 240),
    firstValue: cleanString(source.firstValue ?? source.first_value ?? facts.firstValue, 320),
    cta: cleanString(source.cta ?? facts.cta, 160),
  };
}

function normalizeProposals(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((proposal) => {
      if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return null;
      const pathValue = cleanString(proposal.path, MAX_TEXT);
      const content = cleanContent(proposal.content, MAX_LONG_TEXT);
      if (!pathValue || !content) return null;
      return {
        path: pathValue,
        action: cleanString(proposal.action, 80) || "update",
        title: cleanString(proposal.title, 160) || pathValue,
        content,
        rationale: normalizeStringArray(proposal.rationale, 8, 320),
        isWritten: proposal.isWritten === true || proposal.is_written === true,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeDiagnosis(value = null, surface = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    url: cleanString(value.url, MAX_TEXT),
    statusCode: Number.isFinite(Number(value.statusCode ?? value.status_code))
      ? Number(value.statusCode ?? value.status_code)
      : null,
    firstViewText: cleanString(value.firstViewText ?? value.first_view_text, MAX_TEXT),
    issues: (Array.isArray(value.issues) ? value.issues : [])
      .map((issue) => ({
        id: cleanString(issue?.id, 80),
        summary: cleanString(issue?.summary, 240),
      }))
      .filter((issue) => issue.id && issue.summary)
      .slice(0, 8),
    improvedSurface: normalizeCustomerSurface(value.improvedSurface ?? value.improved_surface, surface),
  };
}

function normalizeReasons(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((reason) => {
      if (!reason || typeof reason !== "object" || Array.isArray(reason)) return null;
      const sentence = cleanString(reason.sentence, 260);
      const why = cleanString(reason.reason ?? reason.why, 360);
      if (!sentence || !why) return null;
      return { sentence, reason: why };
    })
    .filter(Boolean)
    .slice(0, 12);
}

async function readSurfaceInputs(workspaceRoot) {
  const files = [
    "README.md",
    ".agentic30/docs/ICP.md",
    ".agentic30/docs/GOAL.md",
    ".agentic30/docs/SPEC.md",
    ".agentic30/day1-goal.json",
    ".agentic30/memory/day-rollup.json",
    ".agentic30/memory/days/day-1.json",
  ];
  const entries = await Promise.all(files.map(async (relativePath) => {
    try {
      const content = await fs.readFile(path.join(workspaceRoot, relativePath), "utf8");
      return [relativePath, cleanString(content, 12_000)];
    } catch {
      return [relativePath, ""];
    }
  }));
  const [packageJson, onboardingMemory, marketRadar] = await Promise.all([
    readJsonFile(path.join(workspaceRoot, "package.json")),
    readJsonFile(path.join(resolveAgentic30MemoryDir(workspaceRoot), "onboarding.json")),
    readJsonFile(resolveNewsMarketRadarCachePath(workspaceRoot)),
  ]);
  return Object.fromEntries([
    ...entries,
    ["package.json", packageJson],
    ["onboardingMemory", onboardingMemory],
    ["marketRadar", marketRadar],
  ]);
}

async function readJsonFile(filePath) {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

function deriveSurfaceFacts({
  workspaceRoot,
  docs,
  scanResult,
  onboardingHypothesis,
  day1AlignmentPlan,
  day1IcpPlan,
  day1SituationSummary,
} = {}) {
  const basename = path.basename(path.resolve(workspaceRoot || "."));
  const onboardingMemory = docs?.onboardingMemory || null;
  const marketRadar = docs?.marketRadar || null;
  const onboardingCustomer = findFirstStringByKey(onboardingMemory, [
    /target.*user/i,
    /customer/i,
    /audience/i,
    /persona/i,
    /primary[_-]?focus/i,
    /focus[_-]?area/i,
  ]);
  const onboardingProblem = findFirstStringByKey(onboardingMemory, [
    /problem/i,
    /pain/i,
    /bottleneck/i,
    /primary[_-]?bottleneck/i,
    /product[_-]?bottleneck/i,
  ]);
  const marketCustomer = findFirstStringByKey(marketRadar, [
    /target.*user/i,
    /customer/i,
    /audience/i,
    /persona/i,
    /segment/i,
  ]);
  const marketProblem = findFirstStringByKey(marketRadar, [
    /problem/i,
    /pain/i,
    /friction/i,
    /issue/i,
  ]);
  const marketAlternative = findFirstStringByKey(marketRadar, [
    /alternative/i,
    /competitor/i,
    /current.*tool/i,
    /current.*workflow/i,
  ]);
  const projectName = firstNonEmpty([
    day1SituationSummary?.project?.name,
    day1IcpPlan?.signals?.productName,
    onboardingHypothesis?.projectName,
    findFirstStringByKey(onboardingMemory, [/project[_-]?name/i, /product[_-]?name/i, /business[_-]?description/i]),
    titleFromMarkdown(docs?.["README.md"]),
    basename,
  ]);
  const customer = firstNonEmpty([
    day1AlignmentPlan?.alignmentStatement?.icp,
    day1AlignmentPlan?.components?.icp?.statement,
    day1SituationSummary?.project?.customer,
    day1IcpPlan?.signals?.currentIcpGuess,
    onboardingHypothesis?.targetUser,
    onboardingCustomer,
    marketCustomer,
    extractLineAfterLabel(docs?.[".agentic30/docs/ICP.md"], ["ICP", "고객", "Customer"]),
  ]);
  const problem = firstNonEmpty([
    day1AlignmentPlan?.alignmentStatement?.painPoint,
    day1AlignmentPlan?.components?.painPoint?.statement,
    day1SituationSummary?.project?.problem,
    day1IcpPlan?.signals?.problem,
    onboardingHypothesis?.problem,
    onboardingProblem,
    marketProblem,
    extractLineAfterLabel(docs?.[".agentic30/docs/SPEC.md"], ["Problem", "문제", "Pain"]),
  ]);
  const outcome = firstNonEmpty([
    day1AlignmentPlan?.alignmentStatement?.outcome,
    day1AlignmentPlan?.components?.outcome?.statement,
    day1SituationSummary?.actions?.[0]?.label,
    day1IcpPlan?.mission,
    "오늘 파일럿 대화를 예약하고 실제 반응을 기록합니다.",
  ]);
  const goal = firstNonEmpty([
    day1AlignmentPlan?.projectGoal,
    extractLineAfterLabel(docs?.[".agentic30/docs/GOAL.md"], ["Goal", "목표"]),
    `${projectName}의 첫 고객 검증 표면을 만든다.`,
  ]);
  const currentAlternative = firstNonEmpty([
    extractLineAfterLabel(docs?.[".agentic30/docs/ICP.md"], ["대안", "Alternative", "현재"]),
    marketAlternative,
    "수작업, 스프레드시트, 기존 운영 루틴",
  ]);
  const firstValue = firstNonEmpty([
    outcome,
    `${projectName}이 고객의 현재 대안을 더 짧은 행동으로 바꿉니다.`,
  ]);
  const headline = `${customer}가 ${shortenProblem(problem)} 바로 확인하게 하세요`;
  const subheadline = `${projectName}은 ${customer}가 겪는 "${problem}"을 오늘 파일럿 신청 CTA까지 이어지게 정리합니다.`;
  const cta = firstNonEmpty([
    day1AlignmentPlan?.day2Handoff?.primaryAction,
    day1SituationSummary?.actions?.[0]?.promptSeed,
    "파일럿 신청하기",
  ]);
  return {
    projectName: cleanString(projectName, 160),
    goal: cleanString(goal, 260),
    customer: cleanString(customer, 260),
    problem: cleanString(problem, 320),
    currentAlternative: cleanString(currentAlternative, 220),
    firstValue: cleanString(firstValue, 320),
    headline: cleanString(headline, 180),
    subheadline: cleanString(subheadline, 320),
    cta: cleanString(cta, 120),
    evidenceRefs: normalizeStringArray([
      docs?.["README.md"] ? "README.md" : "",
      docs?.[".agentic30/docs/ICP.md"] ? ".agentic30/docs/ICP.md" : "",
      docs?.[".agentic30/docs/GOAL.md"] ? ".agentic30/docs/GOAL.md" : "",
      docs?.[".agentic30/docs/SPEC.md"] ? ".agentic30/docs/SPEC.md" : "",
      onboardingMemory ? ".agentic30/memory/onboarding.json" : "",
      marketRadar ? ".agentic30/news/market-radar-cache.json" : "",
      scanResult ? "workspace_scan_result" : "",
    ]),
  };
}

function assertMinimumSurfaceFacts(facts = {}) {
  const missing = [];
  if (!cleanString(facts.customer, 260)) missing.push("customer");
  if (!cleanString(facts.problem, 320)) missing.push("problem");
  if (!missing.length) return;
  throw new Error(
    `day1_surface_review_generate requires ${missing.join(" and ")} evidence from README, .agentic30 docs, onboarding memory, or external search results.`,
  );
}

function buildLandingHtml(facts) {
  const title = escapeHtml(facts.projectName);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - 파일럿 신청</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; color: #151515; background: #f7f7f2; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 48px 20px; }
    section { width: min(920px, 100%); }
    .eyebrow { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #326b4f; }
    h1 { margin: 16px 0 18px; font-size: clamp(38px, 7vw, 78px); line-height: .96; letter-spacing: 0; max-width: 900px; }
    p { font-size: 19px; line-height: 1.55; max-width: 760px; color: #3b3b37; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 34px 0; }
    .panel { border: 1px solid #d9dacb; background: #fff; border-radius: 8px; padding: 18px; }
    .panel strong { display: block; font-size: 13px; color: #326b4f; margin-bottom: 8px; }
    .panel span { font-size: 15px; line-height: 1.45; color: #2f302d; }
    .cta { display: inline-flex; align-items: center; justify-content: center; height: 52px; padding: 0 22px; border-radius: 8px; background: #1d6b4f; color: #fff; text-decoration: none; font-weight: 800; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } h1 { font-size: 42px; } }
  </style>
</head>
<body>
  <main>
    <section>
      <div class="eyebrow">${escapeHtml(facts.projectName)} 파일럿</div>
      <h1>${escapeHtml(facts.headline)}</h1>
      <p>${escapeHtml(facts.subheadline)}</p>
      <div class="grid" aria-label="처음 보여줄 문장">
        <div class="panel"><strong>누구를 위한가</strong><span>${escapeHtml(facts.customer)}</span></div>
        <div class="panel"><strong>현재 문제</strong><span>${escapeHtml(facts.problem)}</span></div>
        <div class="panel"><strong>현재 대안</strong><span>${escapeHtml(facts.currentAlternative)}</span></div>
      </div>
      <p><strong>첫 가치:</strong> ${escapeHtml(facts.firstValue)}</p>
      <a class="cta" href="mailto:pilot@example.com?subject=${encodeURIComponent(`${facts.projectName} 파일럿 신청`)}">${escapeHtml(facts.cta)}</a>
    </section>
  </main>
</body>
</html>
`;
}

function buildReadmeRewrite({ facts, docs }) {
  const packageJson = docs?.["package.json"] || null;
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object"
    ? Object.keys(packageJson.scripts).slice(0, 8)
    : [];
  const techNotes = collectTechnicalNotes(docs?.["README.md"], scripts);
  return `# ${facts.projectName}

${facts.headline}

${facts.subheadline}

## 누구를 위한 제품인가

${facts.customer}

## 고객의 현재 문제

${facts.problem}

## 현재 대안

${facts.currentAlternative}

## Agentic30이 줄 첫 가치

${facts.firstValue}

## 파일럿 신청

${facts.cta}

## 기술/설치 사실

${techNotes}
`;
}

function collectTechnicalNotes(readme = "", scripts = []) {
  const fenced = [...String(readme || "").matchAll(/```[\s\S]*?```/g)]
    .map((match) => match[0])
    .slice(0, 3);
  const scriptLines = scripts.length
    ? scripts.map((script) => `- \`npm run ${script}\``)
    : [];
  const lines = [];
  if (scriptLines.length) {
    lines.push("현재 package.json에서 확인한 명령:");
    lines.push(...scriptLines);
  }
  if (fenced.length) {
    lines.push("");
    lines.push("기존 README에서 보존한 명령/예시:");
    lines.push(...fenced);
  }
  return lines.join("\n") || "기존 README에 명확한 설치 명령이 없어서 제품 설명만 재작성했습니다.";
}

function normalizeAllowedLandingUrl(value) {
  const raw = cleanString(value, MAX_TEXT);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("day1_surface_review_generate: landingUrl must be a valid http or https URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("day1_surface_review_generate: landingUrl must use http or https.");
  }
  return url.toString();
}

async function fetchLandingPage(url, { fetchImpl } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("day1_surface_review_generate: fetch is unavailable for landing URL review.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Agentic30 surface review" },
    });
    if ([401, 403].includes(response.status)) {
      throw new Error(`landing URL requires login or permission (HTTP ${response.status}).`);
    }
    const contentType = response.headers?.get?.("content-type") || "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      throw new Error(`landing URL did not return readable HTML/text (${contentType || "unknown content-type"}).`);
    }
    const text = await response.text();
    if (looksLikeLoginWall(text, response.url || url)) {
      throw new Error("landing URL appears to require login.");
    }
    return {
      url: response.url || url,
      statusCode: response.status,
      html: cleanString(text, 80_000),
    };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "request timed out" : error?.message || String(error);
    throw new Error(`day1_surface_review_generate: landing URL read failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

function diagnoseLandingPage({ url, fetched, facts }) {
  const firstViewText = extractFirstViewText(fetched.html);
  const issues = [];
  if (!firstViewText) {
    issues.push({ id: "blank", summary: "첫 화면에서 읽을 수 있는 문장이 거의 없습니다." });
  }
  if (!containsAny(firstViewText, [facts.customer, facts.problem])) {
    issues.push({ id: "customer_problem_missing", summary: "첫 화면이 고객과 문제를 직접 말하지 않습니다." });
  }
  if (!containsAny(firstViewText, ["신청", "문의", "demo", "pilot", "join", "contact", facts.cta])) {
    issues.push({ id: "cta_missing", summary: "첫 고객이 바로 누를 파일럿 CTA가 약합니다." });
  }
  if (!issues.length) {
    issues.push({ id: "copy_sharpening", summary: "현재 첫 화면을 유지하되 고객/문제/CTA를 더 앞에 배치할 수 있습니다." });
  }
  const improvedSurface = {
    headline: facts.headline,
    subheadline: facts.subheadline,
    audience: facts.customer,
    problem: facts.problem,
    currentAlternative: facts.currentAlternative,
    firstValue: facts.firstValue,
    cta: facts.cta,
  };
  return {
    url,
    statusCode: fetched.statusCode,
    firstViewText: cleanString(firstViewText, MAX_TEXT),
    issues,
    improvedSurface,
  };
}

function formatExistingLandingCopyProposal(diagnosis) {
  const surface = diagnosis.improvedSurface;
  return [
    `URL: ${diagnosis.url}`,
    "",
    "## 첫 화면 진단",
    ...diagnosis.issues.map((issue) => `- ${issue.summary}`),
    "",
    "## 개선 문구",
    `Headline: ${surface.headline}`,
    `Subheadline: ${surface.subheadline}`,
    `Audience: ${surface.audience}`,
    `Problem: ${surface.problem}`,
    `Current alternative: ${surface.currentAlternative}`,
    `First value: ${surface.firstValue}`,
    `CTA: ${surface.cta}`,
  ].join("\n");
}

function buildReasons(surface, facts) {
  return [
    { sentence: surface.headline, reason: `고객(${facts.customer})과 문제(${facts.problem})를 첫 문장에 둡니다.` },
    { sentence: surface.subheadline, reason: "제품 설명보다 오늘 확인할 고객 반응을 먼저 보이게 합니다." },
    { sentence: surface.cta, reason: "Day 1 완료 행동이 다음 고객 접촉으로 이어지도록 파일럿 신청 CTA를 둡니다." },
  ].filter((entry) => entry.sentence && entry.reason);
}

function isWritableProposal(proposal) {
  if (!["create", "rewrite", "update"].includes(proposal.action)) return false;
  if (/^https?:\/\//i.test(proposal.path)) return false;
  return proposal.path === "landing.html" || proposal.path === "README.md";
}

function resolveWorkspaceProposalPath(workspaceRoot, relativePath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
    throw new Error(`day1_surface_review_decide: proposal path escapes workspace: ${relativePath}`);
  }
  return target;
}

function extractFirstViewText(html = "") {
  return cleanString(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&"),
    1_500,
  );
}

function looksLikeLoginWall(html = "", url = "") {
  const text = `${url}\n${extractFirstViewText(html)}`.toLowerCase();
  return /login|sign in|signin|password|로그인|비밀번호|권한이 필요/.test(text)
    && !/pilot|demo|landing|pricing|waitlist/.test(text);
}

function containsAny(text = "", needles = []) {
  const haystack = String(text || "").toLowerCase();
  return needles
    .map((needle) => cleanString(needle, 120).toLowerCase())
    .filter(Boolean)
    .some((needle) => haystack.includes(needle) || needle.includes(haystack.slice(0, 40)));
}

function titleFromMarkdown(markdown = "") {
  const match = String(markdown || "").match(/^#\s+(.+)$/m);
  return match?.[1] || "";
}

function extractLineAfterLabel(text = "", labels = []) {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const cleaned = cleanString(line.replace(/^#+\s*/, ""), 400);
    if (!cleaned) continue;
    for (const label of labels) {
      const pattern = new RegExp(`^${escapeRegExp(label)}\\s*[:：-]\\s*(.+)$`, "iu");
      const match = cleaned.match(pattern);
      if (match?.[1]) return match[1];
    }
  }
  return "";
}

function findFirstStringByKey(value, keyPatterns = [], depth = 0, seen = new Set()) {
  if (!value || depth > 6) return "";
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKey(item, keyPatterns, depth + 1, seen);
      if (found) return found;
    }
    return "";
  }
  for (const [key, raw] of Object.entries(value)) {
    if (keyPatterns.some((pattern) => pattern.test(key))) {
      const direct = firstStringInValue(raw);
      if (direct) return direct;
    }
    const nested = findFirstStringByKey(raw, keyPatterns, depth + 1, seen);
    if (nested) return nested;
  }
  return "";
}

function firstStringInValue(value, depth = 0, seen = new Set()) {
  if (value == null || depth > 4) return "";
  if (typeof value === "string" || typeof value === "number") {
    return cleanString(value, 500);
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringInValue(item, depth + 1, seen);
      if (found) return found;
    }
    return "";
  }
  for (const preferredKey of ["answer", "value", "title", "label", "summary", "description", "body", "text"]) {
    const found = firstStringInValue(value[preferredKey], depth + 1, seen);
    if (found) return found;
  }
  for (const raw of Object.values(value)) {
    const found = firstStringInValue(raw, depth + 1, seen);
    if (found) return found;
  }
  return "";
}

function shortenProblem(problem = "") {
  const cleaned = cleanString(problem, 120);
  if (cleaned.length <= 44) return cleaned;
  return `${cleaned.slice(0, 43)}…`;
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const cleaned = cleanString(value, MAX_TEXT);
    if (cleaned) return cleaned;
  }
  return "";
}

function normalizeStringArray(value = [], maxItems = 20, maxLength = MAX_TEXT) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return raw
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function nullableIsoDate(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeIsoDate(value, now = new Date()) {
  return nullableIsoDate(value) || now.toISOString();
}

function cleanString(value = "", maxLength = MAX_TEXT) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanContent(value = "", maxLength = MAX_LONG_TEXT) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertWorkspace(workspaceRoot, operation) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error(`${operation}: workspaceRoot is required.`);
  }
}
