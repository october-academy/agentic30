import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_CONTEXT_CHARS = 24_000;
const MAX_EVIDENCE = 5;
const MAX_USERS = 4;

const confidenceRank = {
  low: 0,
  medium: 1,
  high: 2,
};

export async function deriveWorkspaceOnboardingHypothesisLocally(scanRoot, { docPaths = {} } = {}) {
  const root = path.resolve(scanRoot || ".");
  const evidence = [];
  const contextParts = [];

  const rootReadme = await readFirstExisting(root, ["README.md", "readme.md", "Readme.md"]);
  if (rootReadme?.content) {
    const heading = firstMarkdownHeading(rootReadme.content);
    evidence.push(heading ? `README: ${heading}` : `README: ${rootReadme.relativePath}`);
    contextParts.push(rootReadme.content);
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
  }

  for (const [role, relativePath] of Object.entries(docPaths || {})) {
    if (!relativePath || role === "onboardingHypothesis") continue;
    const loaded = await readWorkspaceFile(root, relativePath, 4000);
    if (!loaded) continue;
    evidence.push(`${docTitle(role)}: ${relativePath}`);
    contextParts.push(loaded.content);
  }

  const manifestEvidence = await collectManifestEvidence(root);
  evidence.push(...manifestEvidence.evidence);
  contextParts.push(...manifestEvidence.contextParts);

  const recentFiles = await readRecentGitFiles(root);
  if (recentFiles.length > 0) {
    evidence.push(`최근 변경: ${recentFiles.slice(0, 3).join(", ")}`);
    contextParts.push(recentFiles.join("\n"));
  }

  const context = contextParts.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  const projectKind = inferProjectKind({ root, packageJson, context, recentFiles });
  const likelyUsers = inferLikelyUsers(context, packageJson);
  const stage = inferProjectStage({ context, docPaths, recentFiles, packageJson });
  const compactEvidence = uniqueCompact(evidence).slice(0, MAX_EVIDENCE);
  const confidence = inferConfidence({ likelyUsers, evidence: compactEvidence, stage, projectKind });
  const hypothesis = {
    projectKind,
    likelyUsers: likelyUsers.slice(0, MAX_USERS),
    stage,
    evidence: compactEvidence,
    confidence,
    suggestedFirstQuestion: suggestedFirstQuestion({
      confidence,
      projectKind,
      likelyUsers,
      evidence: compactEvidence,
    }),
  };

  return normalizeWorkspaceOnboardingHypothesis(hypothesis);
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
  const projectKind = cleanToken(value.projectKind || value.project_kind) || "unknown";
  const stage = cleanToken(value.stage) || "unknown";
  const normalized = {
    projectKind,
    likelyUsers: uniqueCompact(likelyUsers).slice(0, MAX_USERS),
    stage,
    evidence: uniqueCompact(evidence).slice(0, MAX_EVIDENCE),
    confidence,
    suggestedFirstQuestion: cleanText(value.suggestedFirstQuestion || value.suggested_first_question),
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
  const projectKind = best.projectKind !== "unknown"
    ? best.projectKind
    : normalized.find((item) => item.projectKind !== "unknown")?.projectKind || "unknown";
  const stage = best.stage !== "unknown"
    ? best.stage
    : normalized.find((item) => item.stage !== "unknown")?.stage || "unknown";

  return normalizeWorkspaceOnboardingHypothesis({
    projectKind,
    likelyUsers,
    stage,
    evidence,
    confidence: adjustMergedConfidence({ confidence, likelyUsers, evidence }),
    suggestedFirstQuestion: best.suggestedFirstQuestion,
  });
}

function fallbackHypothesis() {
  return {
    projectKind: "unknown",
    likelyUsers: [],
    stage: "unknown",
    evidence: [],
    confidence: "low",
    suggestedFirstQuestion: "이걸 만들게 된 계기가 된 사람이나 상황이 있었나요? 이번 주에 확인해볼 사람을 하나 골라주세요.",
  };
}

function suggestedFirstQuestion({ confidence, projectKind, likelyUsers, evidence }) {
  const user = likelyUsers?.[0];
  const kind = projectKindLabel(projectKind);
  if (confidence === "high" && user) {
    return `제가 보기엔 이 프로젝트는 ${user}가 겪는 문제를 풀려는 ${kind} 같아요. 이번 주에 가장 먼저 만나서 확인해볼 사람은 누구인가요?`;
  }
  if (confidence === "medium") {
    const lead = naturalEvidenceLead(evidence);
    return `${lead} 아직 첫 사용자를 단정하긴 어려워요. 이번 주에 만나서 "이게 진짜 문제인지" 확인해볼 사람은 누구인가요?`;
  }
  return "이걸 만들게 된 계기가 된 사람이나 상황이 있었나요? 이번 주에 확인해볼 사람을 하나 골라주세요.";
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

async function readFirstExisting(root, candidates) {
  for (const relativePath of candidates) {
    const loaded = await readWorkspaceFile(root, relativePath, 6000);
    if (loaded) return loaded;
  }
  return null;
}

async function readWorkspaceFile(root, relativePath, maxChars) {
  const resolved = path.resolve(root, relativePath);
  if (!isPathInside(resolved, root)) return null;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    const content = await fs.readFile(resolved, "utf8");
    return {
      relativePath,
      content: content.slice(0, maxChars),
    };
  } catch {
    return null;
  }
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
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
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
