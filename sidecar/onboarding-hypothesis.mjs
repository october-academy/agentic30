import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { extractWorkspaceEvidence } from "./workspace-signal-extractor.mjs";

const MAX_CONTEXT_CHARS = 24_000;
const MAX_EVIDENCE = 5;
const MAX_USERS = 4;
const MAX_SOURCE_FILES = 10;
const MAX_SOURCE_FILE_CHARS = 4_000;

const SOURCE_EXTENSIONS = new Set([
  ".swift",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".jsx",
  ".py",
  ".rs",
  ".go",
]);

const SOURCE_SIGNAL_PATTERN = /(customer|user|problem|mission|goal|value|pricing|onboarding|landing|persona|audience|pain|purpose|고객|사용자|문제|목표|가치|미션|가격|온보딩|랜딩|페르소나)/i;
const SOURCE_DENY_SEGMENTS = new Set([
  ".git",
  ".build",
  ".next",
  ".turbo",
  "build",
  "dist",
  "DerivedData",
  "node_modules",
  "sidecar-build",
  "vendor",
  "coverage",
]);

const confidenceRank = {
  low: 0,
  medium: 1,
  high: 2,
};

export async function deriveWorkspaceOnboardingHypothesisLocally(scanRoot, { docPaths = {} } = {}) {
  const root = path.resolve(scanRoot || ".");
  const workspaceEvidence = await extractWorkspaceEvidence(root, {
    scanPaths: docPaths,
    includeSource: true,
  }).catch(() => null);
  const extractedSignals = workspaceEvidence?.signals || {};
  const evidence = [];
  const contextParts = [];
  const documentContextParts = [];
  const sourceContextParts = [];

  const rootReadme = await readFirstExisting(root, ["README.md", "readme.md", "Readme.md"]);
  if (rootReadme?.content) {
    const heading = firstMarkdownHeading(rootReadme.content);
    evidence.push(heading ? `README: ${heading}` : `README: ${rootReadme.relativePath}`);
    contextParts.push(rootReadme.content);
    documentContextParts.push(rootReadme.content);
  }

  const packageJson = await readJson(path.join(root, "package.json"));
  if (packageJson) {
    const name = stringValue(packageJson.name);
    const description = stringValue(packageJson.description);
    evidence.push(`package.json: ${[name, description].filter(Boolean).join(" - ") || "Node project"}`);
    contextParts.push(JSON.stringify({
      name,
      description,
      dependencies: Object.keys(packageJson.dependencies || {}).slice(0, 40),
      devDependencies: Object.keys(packageJson.devDependencies || {}).slice(0, 40),
    }));
    documentContextParts.push(JSON.stringify({ name, description }));
  }

  for (const [role, relativePath] of Object.entries(docPaths || {})) {
    if (!relativePath || role === "onboardingHypothesis") continue;
    const normalizedPath = cleanWorkspaceRelativePath(relativePath);
    if (!normalizedPath || hasDeniedWorkspacePathSegment(normalizedPath)) continue;
    const loaded = await readWorkspaceFile(root, normalizedPath, 4000);
    if (!loaded) continue;
    evidence.push(`${docTitle(role)}: ${normalizedPath}`);
    contextParts.push(loaded.content);
    documentContextParts.push(loaded.content);
  }

  const manifestEvidence = await collectManifestEvidence(root);
  evidence.push(...manifestEvidence.evidence);
  contextParts.push(...manifestEvidence.contextParts);
  documentContextParts.push(...manifestEvidence.contextParts);

  const recentFiles = await readRecentGitFiles(root);
  if (recentFiles.length > 0) {
    evidence.push(`최근 변경: ${recentFiles.slice(0, 3).join(", ")}`);
    contextParts.push(recentFiles.join("\n"));
  }

  const sourceEvidence = await collectSourceCodeEvidence(root, recentFiles);
  evidence.push(...sourceEvidence.evidence);
  contextParts.push(...sourceEvidence.contextParts);
  sourceContextParts.push(...sourceEvidence.contextParts);

  const context = contextParts.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  const documentContext = documentContextParts.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  const sourceContext = sourceContextParts.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  const projectKind = inferProjectKind({ root, packageJson, context, recentFiles });
  const productName = extractedSignals.productName || inferProductName({ rootReadme, packageJson, root });
  const productBrief = mergeProductBriefs(
    extractedSignals,
    mergeProductBriefs(
      inferProductBrief({ context: documentContext, productName }),
      inferProductBrief({ context: sourceContext, productName }),
    ),
  );
  const likelyUsers = uniqueCompact([
    ...(Array.isArray(extractedSignals.likelyUsers) ? extractedSignals.likelyUsers : []),
    ...inferLikelyUsers(context, packageJson),
  ]);
  const stage = extractedSignals.stage && extractedSignals.stage !== "unknown"
    ? extractedSignals.stage
    : inferProjectStage({ context, docPaths, recentFiles, packageJson });
  const compactEvidence = uniqueCompact([
    ...evidenceFromWorkspaceEvidence(workspaceEvidence),
    ...evidence,
  ]).slice(0, MAX_EVIDENCE);
  const confidence = strongerConfidence(
    workspaceEvidence?.confidence,
    inferConfidence({ likelyUsers, evidence: compactEvidence, stage, projectKind }),
  );
  const hypothesis = {
    productName,
    projectKind,
    targetUser: productBrief.targetUser,
    problem: productBrief.problem,
    purpose: productBrief.purpose,
    goal: productBrief.goal,
    values: productBrief.values,
    likelyUsers: likelyUsers.slice(0, MAX_USERS),
    stage,
    evidence: compactEvidence,
    confidence,
    suggestedFirstQuestion: suggestedFirstQuestion({
      confidence,
      productName,
      projectKind,
      targetUser: productBrief.targetUser,
      problem: productBrief.problem,
      likelyUsers,
      evidence: compactEvidence,
    }),
  };

  return normalizeWorkspaceOnboardingHypothesis(hypothesis);
}

export function normalizeProductName(value) {
  const text = cleanProductNameText(value);
  if (!text) return "";
  return cleanText(text);
}

export function normalizeWorkspaceOnboardingHypothesis(value) {
  if (!value || typeof value !== "object") return fallbackHypothesis();
  const likelyUsersSource = value.likelyUsers || value.likely_users;
  const evidenceSource = value.evidence;
  const likelyUsers = Array.isArray(likelyUsersSource)
    ? likelyUsersSource.map(cleanText).filter(Boolean)
    : [];
  const evidence = Array.isArray(evidenceSource)
    ? evidenceSource.map(cleanText).filter(Boolean)
    : [];
  const confidence = normalizeConfidence(value.confidence);
  const productName = normalizeProductName(value.productName || value.product_name);
  const projectKind = cleanToken(value.projectKind || value.project_kind) || "unknown";
  const targetUser = cleanSemanticText(value.targetUser || value.target_user);
  const problem = cleanSemanticText(value.problem);
  const purpose = cleanSemanticText(value.purpose);
  const goal = cleanSemanticText(value.goal);
  const values = cleanSemanticText(value.values);
  const stage = cleanToken(value.stage) || "unknown";
  const normalized = {
    productName,
    projectKind,
    targetUser,
    problem,
    purpose,
    goal,
    values,
    likelyUsers: uniqueCompact(likelyUsers).slice(0, MAX_USERS),
    stage,
    evidence: uniqueCompact(evidence).slice(0, MAX_EVIDENCE),
    confidence,
    suggestedFirstQuestion: cleanSuggestedFirstQuestion(value.suggestedFirstQuestion || value.suggested_first_question),
  };
  if (!normalized.suggestedFirstQuestion) {
    normalized.suggestedFirstQuestion = suggestedFirstQuestion(normalized);
  }
  return normalized;
}

export function mergeWorkspaceOnboardingHypotheses(...hypotheses) {
  const normalized = hypotheses
    .filter(Boolean)
    .map(normalizeWorkspaceOnboardingHypothesis);
  if (normalized.length === 0) return fallbackHypothesis();

  const best = normalized.reduce((winner, item) =>
    confidenceRank[item.confidence] > confidenceRank[winner.confidence] ? item : winner
  );
  const likelyUsers = uniqueCompact(normalized.flatMap((item) => item.likelyUsers)).slice(0, MAX_USERS);
  const evidence = uniqueCompact(normalized.flatMap((item) => item.evidence)).slice(0, MAX_EVIDENCE);
  const confidence = normalizeConfidence(best.confidence);
  const productName = best.productName || normalized.find((item) => item.productName)?.productName || "";
  const projectKind = best.projectKind !== "unknown"
    ? best.projectKind
    : normalized.find((item) => item.projectKind !== "unknown")?.projectKind || "unknown";
  const targetUser = best.targetUser || normalized.find((item) => item.targetUser)?.targetUser || "";
  const problem = best.problem || normalized.find((item) => item.problem)?.problem || "";
  const purpose = best.purpose || normalized.find((item) => item.purpose)?.purpose || "";
  const goal = best.goal || normalized.find((item) => item.goal)?.goal || "";
  const values = best.values || normalized.find((item) => item.values)?.values || "";
  const stage = best.stage !== "unknown"
    ? best.stage
    : normalized.find((item) => item.stage !== "unknown")?.stage || "unknown";

  return normalizeWorkspaceOnboardingHypothesis({
    productName,
    projectKind,
    targetUser,
    problem,
    purpose,
    goal,
    values,
    likelyUsers,
    stage,
    evidence,
    confidence: adjustMergedConfidence({ confidence, likelyUsers, evidence }),
    suggestedFirstQuestion: "",
  });
}

function fallbackHypothesis() {
  return {
    productName: "",
    projectKind: "unknown",
    targetUser: "",
    problem: "",
    purpose: "",
    goal: "",
    values: "",
    likelyUsers: [],
    stage: "unknown",
    evidence: [],
    confidence: "low",
    suggestedFirstQuestion: "이번 주 가장 먼저 인터뷰할 고객 유형은 누구인가요?",
  };
}

function suggestedFirstQuestion({ confidence, productName, targetUser, problem, likelyUsers, evidence }) {
  const product = cleanSentenceFragment(userFacingProductName(productName));
  const user = cleanSentenceFragment(likelyUsers?.[0]);
  const currentIcp = cleanSentenceFragment(targetUser || user);
  if (confidence === "high" && currentIcp) {
    return `이번 주 가장 먼저 인터뷰할 ${targetSegmentFragment(currentIcp)} 유형은 누구인가요?`;
  }
  if (confidence === "medium" && (product || currentIcp)) {
    return `이번 주 먼저 만날 ${targetSegmentFragment(currentIcp || "잠재 고객")} 유형은 누구인가요?`;
  }
  return "이번 주 가장 먼저 인터뷰할 고객 유형은 누구인가요?";
}

function problemFocusFragment(value) {
  const text = cleanSentenceFragment(value);
  const firstClause = text.split(/[.,，、。]/)[0]?.trim() || text;
  return shortenText(firstClause, 46);
}

function targetSegmentFragment(value) {
  const text = cleanSentenceFragment(value);
  const parts = text
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return shortenText(parts.slice(0, 2).join(", "), 46);
  return shortenText(text, 46);
}

function userFacingProductName(value) {
  const name = cleanText(value);
  if (!name) return "";
  if (/workspace-[a-z0-9]{4,}$/i.test(name)) return "";
  if (/^(tmp|temp|test)[-_]/i.test(name)) return "";
  return name;
}

function shortenText(value, max) {
  const text = cleanSentenceFragment(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function inferProjectKind({ root, packageJson, context, recentFiles }) {
  const lower = context.toLowerCase();
  const deps = new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {}),
  ]);
  if (recentFiles.some((file) => file.endsWith(".xcodeproj/project.pbxproj")) || fileExists(root, "Info.plist")) {
    return "mac_app";
  }
  if (deps.has("next") || lower.includes("next.js")) return "web_app";
  if (deps.has("react") || lower.includes("react")) return "web_app";
  if (lower.includes("cli") || lower.includes("command line")) return "developer_tool";
  if (packageJson) return "node_app";
  if (lower.includes("docs/") || lower.includes("# spec") || lower.includes("# icp")) return "strategy_docs";
  return "unknown";
}

function inferLikelyUsers(context, packageJson) {
  const lower = context.toLowerCase();
  const users = [];
  const add = (condition, label) => {
    if (condition) users.push(label);
  };

  add(/codex|claude|agentic|coding agent|developer|개발자|sdk|cli/.test(lower), "AI 코딩 도구를 쓰는 개발자");
  add(/founder|startup|indie|saas|bip|build in public|창업|1인/.test(lower), "초기 창업자나 1인 SaaS 운영자");
  add(/customer support|support|cs|ticket|고객지원|상담/.test(lower), "고객 지원/CS 담당자");
  add(/recruit|hiring|candidate|채용|면접/.test(lower), "채용 담당자");
  add(/ad|ads|marketing|meta|campaign|마케팅|광고/.test(lower), "마케팅/광고 운영자");
  add(/student|teacher|classroom|course|교육|학생|선생/.test(lower), "교육자나 학생");
  add(/notion|google sheet|spreadsheet|workflow|ops|운영/.test(lower), "반복 업무를 스프레드시트로 처리하는 운영자");

  const description = stringValue(packageJson?.description).toLowerCase();
  add(/developer|cli|agent/.test(description), "개발자 도구 파워 유저");

  return uniqueCompact(users);
}

function inferProductName({ rootReadme, packageJson, root }) {
  const heading = firstMarkdownHeading(rootReadme?.content || "");
  if (heading) return normalizeProductName(heading);
  const packageName = stringValue(packageJson?.name);
  if (packageName) return normalizeProductName(packageName);
  return normalizeProductName(path.basename(root || ""));
}

function inferProductBrief({ context, productName = "" }) {
  const targetUser = firstSemanticMatch(context, [
    /^[ \t]*(?:[-*][ \t]*)?\*\*(?:타깃 유저|타깃 사용자|타겟 사용자|target user)[ \t]*[:：]\*\*[ \t]*([^\n]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:[-*][ \t]*)?(?:타깃 유저|타깃 사용자|타겟 사용자|target user)[ \t]*[:：-][ \t]*([^\n]+)/im,
    /^##[ \t]+Our ICP:[ \t]*([^\n]+)/im,
    /^##[ \t]+(?:타깃|타겟)[ \t]*사용자[^\n]*\n(?:[ \t]*\n|[^\n]*ICP[^\n]*\n){0,3}[ \t]*[-*][ \t]+([^\n]+)/im,
    /요약하면[ \t]*([^\n.]+?)(?:\.|\n)/,
    /^###[ \t]+Primary[^\n]*\n+[ \t]*[-*]?[ \t]*\*\*프로필:\*\*[ \t]*([^\n]+)/im,
  ]);
  const problem = firstSemanticMatch(context, [
    /^[ \t]*핵심 가설:[ \t]*이 유저는[ \t]*"([^"]+)"/im,
    /^[ \t]*핵심 문제는[ \t]*[“"]([^”"]+)[”"]/im,
    /^[ \t]*\*\*핵심 고민:\*\*[ \t]*"([^"]+)"/im,
    /^[ \t]*\*\*설명\*\*[ \t]*\|[ \t]*([^|\n]*?모른다[^|\n]*)/im,
    /^##[ \t]+제품 한 문장[^\n]*\n+\*\*([^*\n]+)\*\*/im,
    /^###[ \t]+설명[^\n]*\n+([^\n]*?(?:모른다|막혀 있다)[^\n]*)/im,
    /^[ \t]*([^#\n]*?(?:무엇을\s*(?:팔아야|만들어야|검증해야)|누구에게\s*팔아야|첫\s*사용자를\s*데려올지|막혀 있다|모른다)[^\n]*)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:problem|pain)[ \t]*[:：-][ \t]*([^\n]+)/im,
  ]);
  const purpose = firstSemanticMatch(context, [
    /^>\s*([^\n]*?돕는[^\n]*?(?:assistant|어시스턴트|앱|도구)[^\n]*)/mi,
    /^[ \t]*\*\*미션:\*\*[ \t]*([^\n]+)/im,
    /^##[ \t]+프로젝트 미션[^\n]*\n+[ \t]*([^\n]+)/im,
    /^[ \t]*\*\*핵심 가치:\*\*[ \t]*([^\n]+)/im,
  ]);
  const goal = firstSemanticMatch(context, [
    /^[ \t]*\*\*(?:목표|goal)[ \t]*[:：]\*\*[ \t]*([^\n]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:목표|goal)[ \t]*[:：-][ \t]*([^\n]+)/im,
    /^##[ \t]+(?:목표|Goal)[^\n]*\n+[ \t]*([^\n]+)/im,
    /^##[ \t]+프로젝트 미션[^\n]*\n+(?:[ \t]*\n)*([^\n]*목표로 한다[^\n]*)/im,
    /^#{1,3}[ \t]+[^\n]*(?:목표|Goal|North Star)[^\n]*\n+(?:[ \t]*\n|>[^\n]*\n|---[^\n]*\n)*([^\n]*(?:목표로 한다|검증한다|달성한다|만든다)[^\n]*)/im,
    /^#{1,4}[ \t]+North Star[^\n]*\n+(?:[ \t]*\n)*[-*]?[ \t]*([^\n]+)/im,
    /^[ \t]*([^\n]{8,220}?목표로 한다[^\n]*)/im,
    /^[ \t]*목표는[ \t]*([^\n]{8,220})/im,
  ]);
  const values = firstSemanticMatch(context, [
    /^[ \t]*\*\*(?:가치|values?)[ \t]*[:：]\*\*[ \t]*([^\n]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:핵심 가치|values?)[ \t]*[:：-][ \t]*([^\n]+)/im,
    /^##[ \t]+(?:가치|Values?)[^\n]*\n+[ \t]*([^\n]+)/im,
    /^# [^\n]*(?:Values|가치)[^\n]*\n+(?:[ \t]*\n|>[^\n]*\n|---[^\n]*\n)*([^\n]*(?:가치|판단 기준|우선|거절)[^\n]*)/im,
    /^##[ \t]+\d+\.[ \t]*([^\n]+)/im,
  ]);
  return {
    targetUser,
    problem,
    purpose: purpose || cleanSemanticText(productPurposeFallback({ productName, targetUser, problem })),
    goal,
    values,
  };
}

function mergeProductBriefs(primary = {}, fallback = {}) {
  return {
    targetUser: primary.targetUser || fallback.targetUser || "",
    problem: primary.problem || fallback.problem || "",
    purpose: primary.purpose || fallback.purpose || "",
    goal: primary.goal || fallback.goal || "",
    values: primary.values || fallback.values || "",
  };
}

function evidenceFromWorkspaceEvidence(workspaceEvidence) {
  const refs = Array.isArray(workspaceEvidence?.evidence) ? workspaceEvidence.evidence : [];
  return refs.map((ref) => {
    const pathLabel = cleanText(ref.path);
    if (!pathLabel) return "";
    if (ref.role === "source") return `source:${pathLabel}`;
    if (ref.role === "docs" && /^readme\./i.test(pathLabel)) return `README: ${pathLabel}`;
    return `${docTitle(ref.role || ref.field || "evidence")}: ${pathLabel}`;
  });
}

function strongerConfidence(...values) {
  return values
    .map(normalizeConfidence)
    .sort((a, b) => confidenceRank[b] - confidenceRank[a])[0] || "low";
}

function productPurposeFallback({ productName, targetUser, problem }) {
  if (targetUser && problem) {
    return `${targetUser}가 ${problem} 문제를 더 빨리 검증하도록 돕는다.`;
  }
  if (productName) return `${productName}의 제품 목적을 README/docs 근거로 더 확인해야 한다.`;
  return "";
}

function firstMatch(text, patterns) {
  const source = String(text || "");
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const candidate = cleanBriefMatch(match?.[1]);
    if (candidate) return candidate;
  }
  return "";
}

function firstSemanticMatch(text, patterns) {
  return firstMatch(text, patterns);
}

function cleanSemanticText(value) {
  return cleanBriefMatch(value);
}

function cleanBriefMatch(value) {
  let text = cleanText(value)
    .replace(/^[-*]\s*/, "")
    .replace(/^["“]+|["”]+$/g, "")
    .replace(/[,;]+$/g, "")
    .replace(/^["“]+|["”]+$/g, "")
    .replace(/\s+[—–-]\s*$/, "")
    .trim();
  if (!text || looksLikeBriefDocumentPointer(text)) return "";
  if (looksLikeCodeSemanticSnippet(text)) return "";
  if (/^(상세는|참고|관련 문서)\b/.test(text)) return "";
  return text;
}

function looksLikeCodeSemanticSnippet(value) {
  const text = cleanText(value);
  if (!text) return true;
  if (/^[\d\s,./:;+-]+$/.test(text)) return true;
  if (/\bz\.[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text)) return true;
  if (/\b(?:zod|schema|enum|literal|object|array|optional|passthrough)\b/i.test(text) && /[().{}[\],:]/.test(text)) {
    return true;
  }
  if (/^(?:true|false|null|undefined|NaN)$/i.test(text)) return true;
  if (/^(?:const|let|var|function|return|import|export|case|if|switch)\b/.test(text)) return true;
  if (/^[A-Za-z_$][\w$]*\s*[:=]\s*[^가-힣"“']/.test(text)) return true;
  return false;
}

function looksLikeBriefDocumentPointer(value) {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  return /\.md\b/.test(lower)
    || /\[[^\]]+\]\([^)]+\)/.test(text)
    || /(?:docs\/|참고 문서|제품 명세와 타겟 사용자|제품 명세와 타깃 사용자|회사 미션|제품 매핑|루브릭|mapping|alignment)/i.test(text);
}

function cleanSuggestedFirstQuestion(value) {
  const question = cleanLongText(value);
  if (!question) return "";
  if (/(제가 보기엔|같아요|가설이 맞|맞나요|confirm|correct)/i.test(question)) return "";
  if (!/(ICP|고객|사용자|user|customer|하위|세그먼트|segment)/i.test(question)) return "";
  return question;
}

function inferProjectStage({ context, docPaths, recentFiles, packageJson }) {
  const lower = context.toLowerCase();
  if (/post[_\s-]?revenue|paying customer|paid user|매출 발생|유료 고객/.test(lower)) return "post_revenue";
  if (/revenue|paid|payment|billing|stripe|매출|결제|유료/.test(lower)) return "pre_revenue";
  if (/users|customer|interview|feedback|사용자|고객|인터뷰|피드백/.test(lower)) return "first_users";
  if (recentFiles.length > 0 || packageJson || Object.values(docPaths || {}).some(Boolean)) return "prototype";
  if (lower.trim()) return "idea";
  return "unknown";
}

function inferConfidence({ likelyUsers, evidence, stage, projectKind }) {
  if (likelyUsers.length > 0 && evidence.length >= 3 && projectKind !== "unknown") return "high";
  if (likelyUsers.length > 0 || evidence.length >= 2 || stage !== "unknown") return "medium";
  return "low";
}

function adjustMergedConfidence({ confidence, likelyUsers, evidence }) {
  if (confidence === "high") return "high";
  if (likelyUsers.length > 0 && evidence.length >= 3) return "high";
  if (confidence === "medium" || likelyUsers.length > 0 || evidence.length >= 2) return "medium";
  return "low";
}

async function collectManifestEvidence(root) {
  const manifests = [
    ["pyproject.toml", "Python project"],
    ["Cargo.toml", "Rust project"],
    ["go.mod", "Go project"],
    ["Gemfile", "Ruby project"],
    ["composer.json", "PHP project"],
    ["mix.exs", "Elixir project"],
  ];
  const evidence = [];
  const contextParts = [];
  for (const [relativePath, label] of manifests) {
    const loaded = await readWorkspaceFile(root, relativePath, 3000);
    if (!loaded) continue;
    evidence.push(`${relativePath}: ${label}`);
    contextParts.push(loaded.content);
  }
  return { evidence, contextParts };
}

async function collectSourceCodeEvidence(root, recentFiles = []) {
  const candidates = uniqueCompact([
    ...recentFiles,
    ...await listSourceCandidates(root),
  ])
    .filter((relativePath) => isSourceEvidenceCandidate(relativePath))
    .slice(0, MAX_SOURCE_FILES * 4);
  const scored = [];
  for (const relativePath of candidates) {
    const loaded = await readWorkspaceFile(root, relativePath, MAX_SOURCE_FILE_CHARS);
    if (!loaded) continue;
    const score = scoreSourceEvidence(relativePath, loaded.content);
    if (score <= 0) continue;
    scored.push({ ...loaded, score });
  }
  scored.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
  const selected = scored.slice(0, MAX_SOURCE_FILES);
  return {
    evidence: selected.map((item) => `source:${item.relativePath}`),
    contextParts: selected.map((item) => [
      `Source file: ${item.relativePath}`,
      extractSourceSignalLines(item.content).join("\n") || item.content.slice(0, 1200),
    ].join("\n")),
  };
}

async function listSourceCandidates(root) {
  const results = [];
  await collectSourceCandidatesInDir(root, root, results, 0);
  return results;
}

async function collectSourceCandidatesInDir(root, dirPath, results, depth) {
  if (depth > 4 || results.length >= 80) return;
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".agentic30") continue;
    if (SOURCE_DENY_SEGMENTS.has(entry.name)) continue;
    const entryPath = path.join(dirPath, entry.name);
    if (!isPathInside(entryPath, root)) continue;
    if (entry.isDirectory()) {
      await collectSourceCandidatesInDir(root, entryPath, results, depth + 1);
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, entryPath).split(path.sep).join(path.posix.sep);
      if (isSourceEvidenceCandidate(relativePath)) {
        results.push(relativePath);
        if (results.length >= 80) return;
      }
    }
  }
}

function isSourceEvidenceCandidate(relativePath) {
  const normalized = String(relativePath || "");
  if (!normalized || normalized.includes("\0")) return false;
  const parts = normalized.split(/[\\/]+/);
  if (parts.some((part) => SOURCE_DENY_SEGMENTS.has(part))) return false;
  if (parts.some((part) => /(^|[._-])(secret|token|credential|password|key)([._-]|$)/i.test(part))) return false;
  if (/\.(test|spec)\.[A-Za-z0-9]+$/i.test(normalized)) return false;
  if (/(^|[\\/])(__tests__|tests?|fixtures?)([\\/]|$)/i.test(normalized)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(normalized));
}

function scoreSourceEvidence(relativePath, content) {
  const haystack = `${relativePath}\n${content}`;
  let score = 0;
  const matches = haystack.match(new RegExp(SOURCE_SIGNAL_PATTERN.source, "gi"));
  score += Math.min(matches?.length || 0, 12);
  if (/onboarding|landing|marketing|pricing|customer|user|goal|values?|mission|icp|persona/i.test(relativePath)) score += 4;
  if (/README|SPEC|ICP|GOAL|VALUES/i.test(content)) score += 2;
  return score;
}

function extractSourceSignalLines(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && SOURCE_SIGNAL_PATTERN.test(line))
    .slice(0, 30)
    .map((line) => line.slice(0, 260));
}

async function readFirstExisting(root, candidates) {
  for (const relativePath of candidates) {
    const loaded = await readWorkspaceFile(root, relativePath, 6000);
    if (loaded) return loaded;
  }
  return null;
}

async function readWorkspaceFile(root, relativePath, maxChars) {
  const normalizedPath = cleanWorkspaceRelativePath(relativePath);
  if (!normalizedPath || hasDeniedWorkspacePathSegment(normalizedPath)) return null;
  const resolved = path.resolve(root, normalizedPath);
  if (!isPathInside(resolved, root)) return null;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    const content = await fs.readFile(resolved, "utf8");
    return {
      relativePath: path.relative(root, resolved).split(path.sep).join(path.posix.sep),
      content: content.slice(0, maxChars),
    };
  } catch {
    return null;
  }
}

function cleanWorkspaceRelativePath(value) {
  const text = String(value || "").trim();
  if (!text || text.includes("\0") || path.isAbsolute(text)) return "";
  return text.split(/[\\/]+/).filter(Boolean).join(path.posix.sep);
}

function hasDeniedWorkspacePathSegment(relativePath) {
  return cleanWorkspaceRelativePath(relativePath)
    .split(/[\\/]+/)
    .some((part) => SOURCE_DENY_SEGMENTS.has(part));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readRecentGitFiles(root) {
  const output = await runGit(root, ["log", "--since=30.days", "--name-only", "--format="], 1500);
  if (!output) return [];
  return uniqueCompact(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.includes("\0"))
  ).slice(0, 10);
}

function runGit(root, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", root, ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve("");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 12_000) {
        child.kill("SIGTERM");
      }
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timeout);
      resolve(output);
    });
  });
}

function firstMarkdownHeading(content) {
  const line = String(content || "")
    .split(/\r?\n/)
    .find((item) => /^#\s+/.test(item.trim()));
  return line ? line.replace(/^#\s+/, "").trim().slice(0, 80) : "";
}

function projectKindLabel(projectKind) {
  switch (projectKind) {
    case "mac_app":
      return "macOS 앱";
    case "web_app":
      return "웹 앱";
    case "developer_tool":
      return "개발자 도구";
    case "node_app":
      return "Node.js 프로젝트";
    case "strategy_docs":
      return "전략 문서 프로젝트";
    default:
      return "프로젝트";
  }
}

function naturalEvidenceLead(evidence = []) {
  const joined = evidence.join(" ").toLowerCase();
  if (joined.includes("readme") && joined.includes("최근 변경")) return "README와 최근 변경을 보면";
  if (joined.includes("readme")) return "README를 보면";
  if (joined.includes("package.json")) return "package.json을 보면";
  if (joined.includes("spec") || joined.includes("docs") || joined.includes("values")) return "프로젝트 문서를 보면";
  if (joined.includes("최근 변경")) return "최근 변경을 보면";
  return "프로젝트를 훑어보면";
}

function docTitle(role) {
  switch (role) {
    case "icp":
      return "ICP";
    case "spec":
      return "SPEC";
    case "values":
      return "VALUES";
    case "designSystem":
      return "Design System";
    case "adr":
      return "ADR";
    case "goal":
      return "GOAL";
    case "docs":
      return "Docs";
    case "sheet":
      return "Sheet";
    default:
      return role;
  }
}

function normalizeConfidence(value) {
  const normalized = cleanToken(value);
  return normalized === "high" || normalized === "medium" || normalized === "low"
    ? normalized
    : "low";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function cleanSentenceFragment(value) {
  return String(value || "")
    .replace(/[`*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。．]+$/u, "");
}

function cleanProductNameText(value) {
  return String(value || "")
    .replace(/^#+\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.。．]+$/u, "");
}

function cleanLongText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 520);
}

function cleanToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueCompact(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function fileExists(root, relativePath) {
  try {
    const resolved = path.resolve(root, relativePath);
    return isPathInside(resolved, root) && fsSync.existsSync(resolved);
  } catch {
    return false;
  }
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
