import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_DOCS_DIR, projectDocPath } from "./project-doc-paths.mjs";

const MAX_DISCOVERY_ENTRIES = 8000;
const MAX_DISCOVERY_DEPTH = 6;
const MAX_DOC_CHARS = 9000;
const MAX_SOURCE_CHARS = 4000;
const MAX_EVIDENCE_REFS = 10;

const ROLES = Object.freeze([
  "icp",
  "spec",
  "values",
  "designSystem",
  "adr",
  "goal",
  "docs",
  "sheet",
]);

const ROLE_CONFIG = Object.freeze({
  icp: {
    names: ["icp.md", "ideal-customer-profile.md", "ideal_customer_profile.md", "persona.md", "personas.md", "customer.md", "customers.md"],
    path: /^\.agentic30\/docs\/ICP\.md$/i,
    heading: /\b(?:icp|ideal customer|persona|target user|target customer|customer profile|타깃|타겟|고객|사용자|페르소나|대상)\b/i,
    body: /\b(?:target user|target customer|ideal customer|persona|audience|customer segment|타깃\s*사용자|타겟\s*사용자|고객\s*세그먼트|대상\s*고객|사용자)\b/i,
    field: "targetUser",
  },
  spec: {
    names: ["spec.md", "product_spec.md", "product-spec.md", "prd.md", "requirements.md"],
    path: /^\.agentic30\/docs\/SPEC\.md$/i,
    heading: /\b(?:spec|prd|requirements|problem|pain|scope|제품|명세|문제|통증|요구사항)\b/i,
    body: /\b(?:problem|pain|friction|scope|requirement|핵심\s*문제|문제는|통증|요구사항|범위)\b/i,
    field: "problem",
  },
  values: {
    names: ["values.md", "principles.md", "product_values.md", "product-values.md"],
    path: /^\.agentic30\/docs\/VALUES\.md$/i,
    heading: /\b(?:values|principles|tradeoff|value|가치|원칙|판단\s*기준|거절)\b/i,
    body: /\b(?:values|principles|tradeoff|decision rule|가치|원칙|판단\s*기준|우선|거절)\b/i,
    field: "values",
  },
  designSystem: {
    names: ["design.md", "design_system.md", "design-system.md", "design_systems.md", "design-systems.md"],
    path: /^\.agentic30\/docs\/DESIGN_SYSTEM\.md$/i,
    heading: /\b(?:design|ui|ux|brand|visual|디자인|브랜드)\b/i,
    body: /\b(?:design system|component|palette|typography|디자인\s*시스템|컴포넌트|색상|타이포)\b/i,
    field: "",
  },
  adr: {
    names: ["adr.md", "architecture.md", "decisions.md"],
    path: /^\.agentic30\/docs\/ADR\.md$/i,
    heading: /\b(?:adr|architecture|decision|아키텍처|결정)\b/i,
    body: /\b(?:architecture decision|technical decision|adr|아키텍처|기술\s*결정)\b/i,
    field: "",
  },
  goal: {
    names: ["goal.md", "goals.md", "okr.md", "north-star.md", "north_star.md"],
    path: /^\.agentic30\/docs\/GOAL\.md$/i,
    heading: /\b(?:goal|goals|okr|north\s*star|mission|objective|목표|미션|핵심\s*결과|성공\s*기준)\b/i,
    body: /\b(?:goal|north\s*star|proof target|objective|목표|목표로\s*한다|달성|검증\s*목표|성공\s*기준)\b/i,
    field: "goal",
  },
  docs: {
    names: ["docs.md"],
    path: /^\.agentic30\/docs\/DOCS\.md$/i,
    heading: /\b(?:readme|docs|documentation|overview|소개|문서|개요)\b/i,
    body: /\b(?:overview|documentation|product|purpose|mission|소개|제품|목적|미션)\b/i,
    field: "purpose",
  },
  sheet: {
    names: ["sheet.md", "sheets.md", "bip_sheet.md", "bip-sheet.md"],
    path: /^\.agentic30\/docs\/SHEET\.md$/i,
    heading: /\b(?:sheet|spreadsheet|tracker|스프레드시트|시트|트래커)\b/i,
    body: /\b(?:sheet|spreadsheet|tracker|google sheets|스프레드시트|시트|트래커)\b/i,
    field: "",
  },
});

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const SHEET_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".yaml", ".yml"]);
const MANIFEST_EXTENSIONS = new Set([".json", ".toml", ".yaml", ".yml"]);
const SOURCE_EXTENSIONS = new Set([".swift", ".ts", ".tsx", ".js", ".mjs", ".jsx", ".py", ".rs", ".go", ".kt", ".kts"]);
const DENY_SEGMENTS = new Set([
  ".git",
  ".build",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "DerivedData",
  "node_modules",
  "Pods",
  "sidecar-build",
  "vendor",
]);

const SOURCE_SIGNAL_PATTERN = /(customer|user|problem|mission|goal|value|pricing|onboarding|landing|persona|audience|target|pain|friction|stuck|success|outcome|proof|고객|사용자|문제|목표|가치|미션|가격|온보딩|랜딩|페르소나|타깃|타겟|대상|통증|막힘|성공|결과|검증)/i;

export async function extractWorkspaceEvidence(workspaceRoot, {
  scanPaths = {},
  includeSource = true,
  fsImpl = fs,
} = {}) {
  const root = path.resolve(workspaceRoot || ".");
  const candidates = Object.fromEntries(ROLES.map((role) => [role, []]));
  const rejectedCandidates = [];
  const fileCache = new Map();

  const files = await discoverWorkspaceFiles({ root, includeSource, fsImpl });

  for (const entry of expandScanPathEntries(scanPaths)) {
    const candidate = await scoreRoleCandidate({
      root,
      role: entry.role,
      relativePath: entry.relativePath,
      source: "scan_path",
      fileCache,
      fsImpl,
    });
    if (candidate) {
      candidates[entry.role].push(candidate);
    } else {
      rejectedCandidates.push({
        role: entry.role,
        path: cleanPath(entry.relativePath),
        reason: "invalid_or_role_mismatch",
      });
    }
  }

  for (const relativePath of files.docFiles) {
    for (const role of ROLES) {
      const candidate = await scoreRoleCandidate({
        root,
        role,
        relativePath,
        source: "local_discovery",
        fileCache,
        fsImpl,
      });
      if (candidate) candidates[role].push(candidate);
    }
  }

  for (const role of ROLES) {
    candidates[role] = uniqueBy(candidates[role], (item) => item.path)
      .sort(compareCandidates)
      .slice(0, 8);
  }

  const docs = emptyDocs();
  const selectedCandidates = [];
  for (const role of ROLES) {
    const selected = candidates[role][0] || null;
    docs[role] = selected?.path || null;
    if (selected) selectedCandidates.push(selected);
  }

  const evidence = [];
  const addEvidence = (item) => {
    if (!item?.path || evidence.some((existing) => existing.path.toLowerCase() === item.path.toLowerCase())) return;
    evidence.push(item);
  };
  for (const role of ["goal", "icp", "spec", "values", "docs", "sheet", "designSystem", "adr"]) {
    const candidate = candidates[role][0];
    if (candidate) addEvidence(candidateToEvidence(candidate));
  }

  const readme = await loadWorkspaceText({ root, relativePath: "README.md", fsImpl, fileCache, maxChars: MAX_DOC_CHARS })
    || await loadWorkspaceText({ root, relativePath: "readme.md", fsImpl, fileCache, maxChars: MAX_DOC_CHARS });
  const readmeContent = readme?.content || "";
  if (readme) {
    addEvidence({
      role: "docs",
      field: "purpose",
      path: readme.relativePath,
      reason: "readme",
      quote: evidenceQuote(readme.content, "docs"),
      score: 65,
    });
  }

  const packageJson = await readPackageJsonEvidence({ root, fsImpl, fileCache });
  if (packageJson) addEvidence(packageJson);

  if (includeSource) {
    const sourceRefs = await collectSourceEvidence({ root, fsImpl, fileCache, sourceFiles: files.sourceFiles });
    for (const ref of sourceRefs) addEvidence(ref);
  }

  const boundedEvidence = evidence
    .filter((item) => item.quote)
    .sort((a, b) => evidenceDisplayRank(a) - evidenceDisplayRank(b) || b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_EVIDENCE_REFS);

  const signals = extractSignals({
    docs,
    candidates,
    selectedCandidates,
    evidence: boundedEvidence,
    packageEvidence: packageJson,
    readmeContent,
  });

  return {
    docs,
    candidates,
    signals,
    evidence: boundedEvidence,
    confidence: inferConfidence({ docs, signals, evidence: boundedEvidence }),
    rejectedCandidates,
  };
}

function emptyDocs() {
  return {
    icp: null,
    spec: null,
    values: null,
    designSystem: null,
    adr: null,
    goal: null,
    docs: null,
    sheet: null,
  };
}

function expandScanPathEntries(scanPaths = {}) {
  const entries = [];
  if (!scanPaths || typeof scanPaths !== "object") return entries;
  for (const role of ROLES) {
    const raw = scanPaths[role];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const relativePath = cleanPath(value);
      if (relativePath) entries.push({ role, relativePath });
    }
  }
  return entries;
}

async function discoverWorkspaceFiles({ root, includeSource, fsImpl }) {
  const docFiles = [];
  const sourceFiles = [];
  const queue = [{ absolute: root, relative: "", depth: 0 }];
  let visited = 0;

  while (queue.length && visited < MAX_DISCOVERY_ENTRIES) {
    const current = queue.shift();
    visited += 1;
    let entries = [];
    try {
      entries = await fsImpl.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldSkipEntry(entry.name)) continue;
      const relativePath = current.relative ? path.posix.join(current.relative, entry.name) : entry.name;
      const absolutePath = path.join(current.absolute, entry.name);
      if (!isPathInside(root, absolutePath)) continue;
      if (entry.isDirectory()) {
        if (current.depth < MAX_DISCOVERY_DEPTH) {
          queue.push({ absolute: absolutePath, relative: relativePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (isDocCandidatePath(relativePath)) docFiles.push(relativePath);
      if (includeSource && isSourceCandidatePath(relativePath)) sourceFiles.push(relativePath);
    }
  }

  return {
    docFiles: uniqueBy(docFiles, (item) => item.toLowerCase()).slice(0, 600),
    sourceFiles: uniqueBy(sourceFiles, (item) => item.toLowerCase()).slice(0, 120),
  };
}

function shouldSkipEntry(name) {
  return DENY_SEGMENTS.has(name);
}

async function scoreRoleCandidate({ root, role, relativePath, source, fileCache, fsImpl }) {
  const normalizedPath = cleanPath(relativePath);
  if (!normalizedPath || !isAllowedRolePath(normalizedPath, role)) return null;
  const loaded = await loadWorkspaceText({ root, relativePath: normalizedPath, fsImpl, fileCache, maxChars: MAX_DOC_CHARS });
  if (!loaded) return null;

  const config = ROLE_CONFIG[role];
  const lowerPath = loaded.relativePath.toLowerCase();
  const basename = path.posix.basename(lowerPath);
  const headingText = markdownHeadings(loaded.content).join("\n");
  const bodyText = loaded.content;
  let score = 0;

  if (source === "scan_path") score += 18;
  if (config.path.test(lowerPath)) score += 42;
  if (config.names.map((name) => name.toLowerCase()).includes(basename)) score += 34;
  if (lowerPath.startsWith(`${PROJECT_DOCS_DIR}/`)) score += 18;
  if (/^readme\.(?:md|mdx|txt|rst)$/i.test(basename) && role === "docs") score += 50;
  if (config.heading.test(headingText)) score += 24;
  if (config.body.test(bodyText)) score += 18;
  if (role === "icp" && looksLikeCustomerSegment(bodyText)) score += 10;
  if (role === "spec" && /(problem|pain|핵심\s*문제|문제는|통증|모른다|막혀)/i.test(bodyText)) score += 10;
  if (role === "goal" && /(목표로\s*한다|goal|목표|first revenue|첫\s*매출|사용자\s*\d+)/i.test(bodyText)) score += 10;

  const threshold = source === "scan_path" ? 36 : 42;
  if (score < threshold) return null;
  return {
    role,
    field: config.field,
    path: loaded.relativePath,
    source,
    quote: evidenceQuote(loaded.content, role),
    content: loaded.content,
    score,
  };
}

function compareCandidates(a, b) {
  return b.score - a.score
    || canonicalPathRank(a.path) - canonicalPathRank(b.path)
    || a.path.localeCompare(b.path);
}

function canonicalPathRank(relativePath) {
  const pathText = cleanPath(relativePath).toLowerCase();
  if (pathText.startsWith(`${PROJECT_DOCS_DIR}/`)) return 0;
  if (/^readme\./.test(pathText)) return 1;
  return 2;
}

function candidateToEvidence(candidate) {
  return {
    role: candidate.role,
    field: candidate.field,
    path: candidate.path,
    reason: `${candidate.role} ${candidate.source}`,
    quote: candidate.quote,
    score: candidate.score,
  };
}

async function readPackageJsonEvidence({ root, fsImpl, fileCache }) {
  const loaded = await loadWorkspaceText({ root, relativePath: "package.json", fsImpl, fileCache, maxChars: 3000 });
  if (!loaded) return null;
  try {
    const parsed = JSON.parse(loaded.content);
    const name = cleanText(parsed.name);
    const description = cleanText(parsed.description);
    const quote = JSON.stringify({ name, description });
    return {
      role: "manifest",
      field: "productName",
      path: loaded.relativePath,
      reason: "manifest package_config",
      quote,
      score: 35,
    };
  } catch {
    return null;
  }
}

async function collectSourceEvidence({ root, fsImpl, fileCache, sourceFiles }) {
  const scored = [];
  for (const relativePath of sourceFiles || []) {
    const loaded = await loadWorkspaceText({ root, relativePath, fsImpl, fileCache, maxChars: MAX_SOURCE_CHARS });
    if (!loaded) continue;
    const quote = sourceEvidenceQuote(loaded.content);
    if (!quote) continue;
    const matches = `${loaded.relativePath}\n${loaded.content}`.match(new RegExp(SOURCE_SIGNAL_PATTERN.source, "gi"));
    const score = Math.min(matches?.length || 0, 12)
      + (/onboarding|landing|marketing|pricing|customer|user|goal|values?|mission|icp|persona/i.test(loaded.relativePath) ? 8 : 0);
    if (score <= 0) continue;
    scored.push({
      role: "source",
      field: "",
      path: loaded.relativePath,
      reason: "source signal",
      quote,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, 4);
}

function extractSignals({ docs, candidates, selectedCandidates, evidence, packageEvidence, readmeContent = "" }) {
  const contentFor = (role) => candidates[role]?.[0]?.content || "";
  const allContent = [
    readmeContent,
    contentFor("docs"),
    contentFor("icp"),
    contentFor("spec"),
    contentFor("goal"),
    contentFor("values"),
    ...evidence.map((item) => item.quote),
  ].filter(Boolean).join("\n\n");
  const readmeHeading = markdownHeadingTitle(readmeContent) || markdownHeadingTitle(contentFor("docs"));
  const packageName = packageNameFromEvidence(packageEvidence);
  const productName = normalizeProductName(readmeHeading) || normalizeProductName(packageName);
  const targetUser = firstSemanticMatch([contentFor("icp"), allContent], [
    /^[ \t]*(?:[-*][ \t]*)?\*\*(?:타깃 유저|타깃 사용자|타겟 사용자|target user|targetUser|target_customer|target customer)[ \t]*[:：]\*\*[ \t]*([^\n]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:[-*][ \t]*)?(?:타깃 유저|타깃 사용자|타겟 사용자|target user|targetUser|target_customer|target customer|customer segment|audience)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^##[ \t]+Our ICP:[ \t]*([^\n]+)/im,
    /^#{1,4}[^\n]*(?:ICP|고객|사용자|페르소나|타깃|타겟|대상)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
  ]);
  const problem = firstSemanticMatch([contentFor("spec"), contentFor("icp"), allContent], [
    /^[ \t]*핵심 가설:[ \t]*이 유저는[ \t]*"([^"]+)"/im,
    /^[ \t]*핵심 문제는[ \t]*[“"]([^”"]+)[”"]/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:problem|pain|friction)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /(?:^|\/\s*)(?:problem|pain|friction)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^#{1,4}[^\n]*(?:문제|Problem|Pain)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
    /^[ \t]*([^#\n]*?(?:무엇을\s*(?:팔아야|만들어야|검증해야)|누구에게\s*팔아야|첫\s*사용자를\s*데려올지|막혀 있다|모른다)[^\n]*)/im,
  ]);
  const goal = firstSemanticMatch([contentFor("goal"), allContent], [
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:목표|goal|objective|proof target)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /(?:^|\/\s*)(?:목표|goal|objective|proof target)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^##[ \t]+프로젝트 미션[^\n]*\n+(?:[ \t]*\n)*([^\n]*목표로 한다[^\n]*)/im,
    /^#{1,4}[^\n]*(?:목표|Goal|North Star|OKR)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
    /^[ \t]*([^\n]{8,220}?목표로 한다[^\n]*)/im,
  ]);
  const values = firstSemanticMatch([contentFor("values"), allContent], [
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:핵심 가치|values?|principles?)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /(?:^|\/\s*)(?:핵심 가치|values?|principles?)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^#{1,4}[^\n]*(?:Values|가치|원칙)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
    /^[ \t]*([^\n]*(?:판단 기준|우선|거절|tradeoff)[^\n]*)/im,
  ]);
  const purpose = firstSemanticMatch([contentFor("docs"), contentFor("spec"), allContent], [
    /^>\s*([^\n]*?돕는[^\n]*?(?:assistant|어시스턴트|앱|도구)[^\n]*)/mi,
    /^[ \t]*(?:미션|mission|purpose)[ \t]*[:：=-][ \t]*([^\n]+)/im,
    /^#{1,4}[^\n]*(?:미션|Mission|Purpose|목적)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
  ]);
  const outcome = firstSemanticMatch([allContent], [
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:outcome|result|success signal|결과|성공 신호)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /(?:^|\/\s*)(?:outcome|result|success signal|결과|성공 신호)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^#{1,4}[^\n]*(?:Outcome|결과|성공)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
    /^#{1,5}[^\n]*(?:Validation Signals?|검증\s*신호|행동\s*증거)[^\n]*[\s\S]{0,500}?(?:^#{1,6}[^\n]*(?:Positive|긍정)[^\n]*\n+)?(?:[ \t]*\n)*^[ \t]*[-*][ \t]*([^\n]{8,220})/im,
    /^#{1,5}[^\n]*(?:Positive|긍정)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
  ], isOutcomeSemanticText);
  const likelyUsers = uniqueCompact([
    targetUser,
    ...inferLikelyUsersFromText(allContent),
  ]).slice(0, 4);
  return {
    productName,
    targetUser,
    problem,
    purpose,
    goal,
    values,
    outcome,
    stage: inferStage(allContent, docs),
    likelyUsers,
  };
}

function inferLikelyUsersFromText(value) {
  const text = cleanText(value).toLowerCase();
  const users = [];
  if (/codex|claude|coding agent|developer|개발자|sdk|cli/.test(text)) users.push("AI 코딩 도구를 쓰는 개발자");
  if (/founder|startup|indie|saas|bip|build in public|창업|1인/.test(text)) users.push("초기 창업자나 1인 SaaS 운영자");
  if (/customer support|support|cs|ticket|고객지원|상담/.test(text)) users.push("고객 지원/CS 담당자");
  if (/marketing|campaign|ads|마케팅|광고/.test(text)) users.push("마케팅/광고 운영자");
  return users;
}

function inferStage(content, docs) {
  const lower = cleanText(content).toLowerCase();
  if (/post[_\s-]?revenue|paying customer|paid user|매출 발생|유료 고객/.test(lower)) return "post_revenue";
  if (/revenue|paid|payment|billing|stripe|매출|결제|유료/.test(lower)) return "pre_revenue";
  if (/users|customer|interview|feedback|사용자|고객|인터뷰|피드백/.test(lower)) return "first_users";
  if (Object.values(docs || {}).some(Boolean)) return "prototype";
  if (lower.trim()) return "idea";
  return "unknown";
}

function inferConfidence({ docs, signals, evidence }) {
  const foundDocs = Object.values(docs || {}).filter(Boolean).length;
  const strongSignals = [signals.targetUser, signals.problem, signals.goal].filter(Boolean).length;
  if (foundDocs >= 3 && strongSignals >= 2) return "high";
  if (foundDocs >= 1 || strongSignals >= 1 || evidence.length >= 2) return "medium";
  return "low";
}

function isAllowedRolePath(relativePath, role) {
  const normalized = cleanPath(relativePath);
  if (!normalized || normalized.includes("\0") || path.isAbsolute(normalized)) return false;
  if (hasDeniedSegment(normalized)) return false;
  const canonical = projectDocPath(role);
  if (!canonical || normalized.toLowerCase() !== canonical.toLowerCase()) return false;
  const ext = path.extname(normalized).toLowerCase();
  if (role === "sheet") return SHEET_EXTENSIONS.has(ext);
  return DOC_EXTENSIONS.has(ext);
}

function isDocCandidatePath(relativePath) {
  const normalized = cleanPath(relativePath);
  if (!normalized || hasDeniedSegment(normalized)) return false;
  const ext = path.extname(normalized).toLowerCase();
  return DOC_EXTENSIONS.has(ext) || MANIFEST_EXTENSIONS.has(ext);
}

function isSourceCandidatePath(relativePath) {
  const normalized = cleanPath(relativePath);
  if (!normalized || hasDeniedSegment(normalized)) return false;
  if (/\.(test|spec)\.[A-Za-z0-9]+$/i.test(normalized)) return false;
  if (/(^|[\\/])(__tests__|tests?|fixtures?)([\\/]|$)/i.test(normalized)) return false;
  if (/(^|[\\/])[^\\/]*(?:secret|token|credential|password|key)[^\\/]*($|[\\/])/i.test(normalized)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

function hasDeniedSegment(relativePath) {
  return cleanPath(relativePath)
    .split(/[\\/]+/)
    .some((part) => DENY_SEGMENTS.has(part));
}

async function loadWorkspaceText({ root, relativePath, fsImpl, fileCache, maxChars }) {
  const normalized = cleanPath(relativePath);
  if (!normalized || normalized.includes("\0") || path.isAbsolute(normalized)) return null;
  const resolved = path.resolve(root, normalized);
  if (!isPathInside(root, resolved)) return null;
  const key = `${resolved}:${maxChars}`;
  if (fileCache?.has(key)) return fileCache.get(key);
  let loaded = null;
  try {
    const stat = await fsImpl.stat(resolved);
    if (stat.isFile() && stat.size <= 2_000_000) {
      const content = await fsImpl.readFile(resolved, "utf8");
      loaded = {
        relativePath: path.relative(root, resolved).split(path.sep).join(path.posix.sep),
        content: content.slice(0, maxChars),
      };
    }
  } catch {
    loaded = null;
  }
  if (fileCache) fileCache.set(key, loaded);
  return loaded;
}

function evidenceQuote(content, role = "docs") {
  const text = String(content || "");
  const sections = markdownSections(text);
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.docs;
  const ranked = sections.map((section, index) => {
    const score = evidenceQuoteSectionScore(section, { config, role });
    return { section, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.find((item) => item.score > 0)?.section || sections[0] || { heading: "", lines: [] };
  const signalLines = selected.lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--"))
    .filter((line) => SOURCE_SIGNAL_PATTERN.test(line) || line.length >= 20)
    .slice(0, 4);
  const parts = [selected.heading, ...signalLines].filter(Boolean);
  return cleanLongText(parts.join(" | ") || text.split(/\r?\n/).find((line) => line.trim().length >= 20) || "");
}

function evidenceQuoteSectionScore(section, { config, role }) {
  let score = 0;
  if (config.heading.test(section.heading)) score += 8;
  if (config.body.test(section.body)) score += 6;
  if (SOURCE_SIGNAL_PATTERN.test(section.body)) score += 2;
  if (role === "spec") score += specEvidenceSectionScore(section);
  return score;
}

function specEvidenceSectionScore(section) {
  const heading = cleanText(section.heading).replace(/^#+\s*/, "");
  const body = String(section.body || "");
  let score = 0;
  if (/\b(?:problem|pain|friction|문제|통증|막힘)\b/i.test(heading)) score += 28;
  if (/^[ \t]*(?:[-*][ \t]*)?(?:problem|pain|friction|핵심\s*문제|문제|통증)[ \t]*[:：=-]/im.test(body)) score += 18;
  if (/(핵심\s*문제는|core\s+problem|customer\s+pain|buyer\s+pain)/i.test(body)) score += 16;
  if (/(무엇을\s*(?:팔아야|팔지|만들어야|검증해야)|누구에게\s*팔|첫\s*사용자.*데려|모른다|막혀|어려움|불편|비용|리스크|반복|manual|stuck|struggle|friction|risk|cost)/i.test(body)) {
    score += 10;
  }
  if (looksLikeScopeSectionHeading(heading)) score -= 24;
  if (looksLikeSpecOutcomeSectionHeading(heading)) score -= 14;
  return score;
}

function looksLikeScopeSectionHeading(value) {
  const text = cleanText(value);
  return /^(?:mvp\s*)?(?:in\s+scope|out\s+of\s+scope|scope|범위|스코프)$/i.test(text);
}

function looksLikeSpecOutcomeSectionHeading(value) {
  const text = cleanText(value);
  return /^(?:mvp\s*)?(?:success|success\s+criteria|outcome|result|north\s*star|goal|성공|성공\s*기준|결과|목표)$/i.test(text);
}

function sourceEvidenceQuote(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => cleanSourceLine(line))
    .filter((line) => line && SOURCE_SIGNAL_PATTERN.test(line))
    .slice(0, 5);
  if (lines.length) return cleanLongText(lines.join(" / "));
  const quoted = [...String(content || "").matchAll(/["'“”]([^"'“”]{12,180})["'“”]/g)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean)
    .slice(0, 4);
  return cleanLongText(quoted.join(" / "));
}

function cleanSourceLine(value) {
  const text = String(value || "")
    .trim()
    .replace(/^\s*(?:\/\/|#)\s*/, "")
    .replace(/^\s*(?:let|var|const|static\s+let|private\s+let|public\s+let|export\s+const)\s+[A-Za-z0-9_]+\s*[:=]\s*/i, "")
    .replace(/[{}[\]<>;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const label = cleanText(text.match(/^([A-Za-z0-9_]+)\s*[:=]/)?.[1] || "");
  const quoted = [...text.matchAll(/["'“”]([^"'“”]{8,180})["'“”]/g)].map((match) => match[1]);
  const extractedValue = quoted.length
    ? quoted.join(" / ")
    : text.replace(/^[A-Za-z0-9_]+\s*[:=]\s*/, "").trim();
  return cleanText(label ? `${label}: ${extractedValue}` : extractedValue);
}

function markdownHeadings(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, ""));
}

function markdownHeadingTitle(content) {
  return markdownHeadings(content)[0] || "";
}

function markdownSections(content) {
  const sections = [];
  let current = { heading: "", lines: [] };
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^#{1,6}\s+/.test(line)) {
      if (current.heading || current.lines.length) sections.push(current);
      current = { heading: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.length) sections.push(current);
  return sections.map((section) => ({
    ...section,
    body: section.lines.join("\n"),
  }));
}

function firstSemanticMatch(contexts, patterns, validator = null) {
  for (const context of contexts) {
    const source = String(context || "");
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const candidate = cleanSemanticText(match?.[1]);
      if (candidate && (!validator || validator(candidate, { match, source }))) return candidate;
    }
  }
  return "";
}

function cleanSemanticText(value) {
  const text = cleanText(value)
    .replace(/^[-*]\s*/, "")
    .replace(/^["“]+|["”]+$/g, "")
    .replace(/[,;]+$/g, "")
    .trim();
  if (!text || looksLikeDocumentPointer(text) || looksLikeCodeSnippet(text)) return "";
  if (/^(상세는|참고|관련 문서)\b/.test(text)) return "";
  return text;
}

function isOutcomeSemanticText(candidate, { match } = {}) {
  const text = cleanSemanticText(candidate);
  const raw = cleanText(match?.[0] || candidate);
  if (!text) return false;
  if (looksLikePersonaSummaryText(raw) || looksLikePersonaSummaryText(text)) return false;
  if (/^#{1,6}\s*/.test(text) || /^(?:north\s*star|goal|목표|핵심\s*결과)$/i.test(text)) return false;
  if (looksLikeBusinessGoalSummary(text)) return false;
  if (/(?:약하다|두렵다|못한다|모른다|막혀\s*있다)[.。．]?$/i.test(text)) {
    return false;
  }
  return /(확인|검증|신호|대화|인터뷰|반응|피드백|지불|의향|의사|대안|도입|결정|소개|시장|최근\s*사건|confirm|validate|signal|interview|conversation|feedback|alternative|willingness)/i.test(text);
}

function looksLikePersonaSummaryText(value) {
  const text = cleanText(value);
  if (!text) return false;
  return /^\s*[-*]?\s*(?:\*\*)?(?:job\s+summary|motivation|frustration|persona|primary\s+persona)\b/i.test(text)
    || /^\s*[-*]?\s*(?:\*\*)?(?:직무\s*요약|동기|불만|페르소나)\b/i.test(text)
    || /(?:job\s+summary|motivation|frustration)\s*[:：]/i.test(text);
}

function looksLikeBusinessGoalSummary(value) {
  const text = cleanText(value);
  if (!text) return false;
  const hasValidationAction = /(대화|인터뷰|현재\s*대안|지불\s*의향|최근\s*사건|고객\s*반응|구체\s*피드백|도입\s*결정|소개|conversation|interview|feedback|alternative|willingness)/i.test(text);
  if (hasValidationAction) return false;
  return /(?:목표|목표로\s*한다|달성|30일|사용자\s*\d+\s*명|첫\s*매출|revenue|business\s*goal)/i.test(text);
}

function looksLikeCustomerSegment(value) {
  return /(고객|사용자|사람|팀|개발자|창업자|운영자|담당자|대표|리드|lead|manager|founder|developer|customer|user|team|persona|operator|owner)/i.test(String(value || ""));
}

function looksLikeDocumentPointer(value) {
  const text = String(value || "");
  return /\.md\b/i.test(text)
    || /\[[^\]]+\]\([^)]+\)/.test(text)
    || /(?:docs\/|참고 문서|제품 명세와 타겟 사용자|제품 명세와 타깃 사용자|회사 미션|제품 매핑|루브릭|mapping|alignment)/i.test(text);
}

function looksLikeCodeSnippet(value) {
  const text = cleanText(value);
  if (!text) return true;
  if (/^[\d\s,./:;+-]+$/.test(text)) return true;
  if (/\bz\.[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text)) return true;
  if (/\b(?:zod|schema|enum|literal|object|array|optional|passthrough)\b/i.test(text) && /[().{}[\],:]/.test(text)) return true;
  if (/^(?:true|false|null|undefined|NaN)$/i.test(text)) return true;
  if (/^(?:const|let|var|function|return|import|export|case|if|switch)\b/.test(text)) return true;
  return false;
}

function packageNameFromEvidence(item = null) {
  if (!item?.quote) return "";
  try {
    return JSON.parse(item.quote).name || "";
  } catch {
    const match = String(item.quote || "").match(/"name"\s*:\s*"([^"]+)"/);
    return match?.[1] || "";
  }
}

function normalizeProductName(value) {
  return cleanText(value)
    .replace(/^#+\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[.。．]+$/u, "")
    .trim();
}

function evidenceDisplayRank(item = {}) {
  const normalized = cleanPath(item.path).toLowerCase();
  if (normalized === projectDocPath("goal").toLowerCase()) return 0;
  if (normalized === projectDocPath("icp").toLowerCase()) return 1;
  if (normalized === projectDocPath("spec").toLowerCase()) return 2;
  if (normalized === projectDocPath("values").toLowerCase()) return 3;
  if (normalized.startsWith(`${PROJECT_DOCS_DIR}/`)) return 4;
  if (/^readme\./i.test(normalized)) return 5;
  if (normalized === "package.json") return 6;
  if (item.role === "source") return 13;
  return 12;
}

function cleanPath(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);
}

function cleanLongText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 520);
}

function uniqueCompact(values) {
  return uniqueBy(
    values.map(cleanText).filter(Boolean),
    (item) => item.toLowerCase(),
  );
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isPathInside(root, candidatePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}
