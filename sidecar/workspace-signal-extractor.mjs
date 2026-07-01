import fs from "node:fs/promises";
import path from "node:path";
import { extractPdfText } from "./pdf-text.mjs";
import { PROJECT_DOCS_DIR, projectDocPath } from "./project-doc-paths.mjs";

const MAX_DISCOVERY_ENTRIES = 8000;
const MAX_DISCOVERY_DEPTH = 6;
const MAX_DOC_CHARS = 9000;
const MAX_SOURCE_CHARS = 4000;
const MAX_PDF_CHARS = 12000;
const MAX_PDF_BYTES = 20_000_000;
const MAX_PDF_DEPTH = 2;
const MAX_PDF_FILES = 4;
const MAX_GENERIC_FIELD_DOCS = 80;
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
    initialPaths: ["docs/ICP.md"],
    heading: /\b(?:icp|ideal customer|persona|target user|target customer|customer profile|타깃|타겟|고객|사용자|페르소나|대상)\b/i,
    body: /\b(?:target user|target customer|ideal customer|persona|audience|customer segment|타깃\s*사용자|타겟\s*사용자|고객\s*세그먼트|대상\s*고객|사용자)\b/i,
    field: "targetUser",
  },
  spec: {
    names: ["spec.md", "product_spec.md", "product-spec.md", "prd.md", "requirements.md"],
    path: /^\.agentic30\/docs\/SPEC\.md$/i,
    initialPaths: ["docs/SPEC.md"],
    heading: /\b(?:spec|prd|requirements|problem|pain|scope|제품|명세|문제|통증|요구사항)\b/i,
    body: /\b(?:problem|pain|friction|scope|requirement|핵심\s*문제|문제는|통증|요구사항|범위)\b/i,
    field: "problem",
  },
  values: {
    names: ["values.md", "principles.md", "product_values.md", "product-values.md"],
    path: /^\.agentic30\/docs\/VALUES\.md$/i,
    initialPaths: ["docs/VALUES.md"],
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
    initialPaths: ["docs/GOAL.md"],
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
const PDF_SIGNAL_PATTERN = /(활용처|사용자|고객|타깃|타겟|대상|목적|필요성|문제|프로젝트\s*소개|주요\s*기능|명상|감정기록|불경|마음챙김|행동|활성|검증|호감|일상적\s*신행|디지털\s*접점)/i;

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
    if (!item?.path) return;
    const key = evidenceKey(item);
    if (evidence.some((existing) => evidenceKey(existing) === key)) return;
    evidence.push(item);
  };
  for (const role of ["goal", "icp", "spec", "values", "docs", "sheet", "designSystem", "adr"]) {
    const candidate = candidates[role][0];
    if (candidate) {
      addEvidence(candidateToEvidence(candidate));
      for (const ref of collectExplicitFieldEvidence(candidate)) addEvidence(ref);
    }
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
    for (const ref of collectExplicitFieldEvidence({
      role: "docs",
      field: "",
      path: readme.relativePath,
      source: "readme",
      quote: evidenceQuote(readme.content, "docs"),
      content: readme.content,
      score: 65,
    })) addEvidence(ref);
  }

  const genericDocEvidence = await collectGenericDocumentFieldEvidence({
    root,
    fsImpl,
    fileCache,
    docFiles: files.docFiles,
    excludedPaths: [
      ...selectedCandidates.map((candidate) => candidate.path),
      readme?.relativePath,
    ].filter(Boolean),
  });
  for (const ref of genericDocEvidence) addEvidence(ref);

  const packageJson = await readPackageJsonEvidence({ root, fsImpl, fileCache });
  if (packageJson) addEvidence(packageJson);

  if (includeSource) {
    const sourceRefs = await collectSourceEvidence({ root, fsImpl, fileCache, sourceFiles: files.sourceFiles });
    for (const ref of sourceRefs) addEvidence(ref);
  }

  const pdfRefs = await collectPdfEvidence({ root, fsImpl, pdfFiles: files.pdfFiles });
  for (const ref of pdfRefs) addEvidence(ref);

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
  const pdfFiles = [];
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
      if (isPdfCandidatePath(relativePath, current.depth)) pdfFiles.push(relativePath);
    }
  }

  return {
    docFiles: uniqueBy(docFiles, (item) => item.toLowerCase()).slice(0, 600),
    sourceFiles: uniqueBy(sourceFiles, (item) => item.toLowerCase()).slice(0, 120),
    pdfFiles: uniqueBy(pdfFiles, (item) => item.toLowerCase()).slice(0, MAX_PDF_FILES),
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
  if (isInitialRolePath(lowerPath, role)) score += 30;
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
  if (isAnyInitialRolePath(pathText)) return 1;
  if (/^readme\./.test(pathText)) return 2;
  return 3;
}

function candidateToEvidence(candidate) {
  return {
    role: candidate.role,
    field: "",
    path: candidate.path,
    reason: `${candidate.role} ${candidate.source}`,
    quote: candidate.quote,
    score: candidate.score,
  };
}

function collectExplicitFieldEvidence(candidate = {}) {
  const content = String(candidate.content || "");
  if (!content.trim()) return [];
  const refs = [];
  const pushRef = ({ field, reason, quote, scoreOffset = 2 }) => {
    const cleanQuote = cleanLongText(quote);
    if (!field || !cleanQuote) return;
    refs.push({
      role: candidate.role,
      field,
      path: candidate.path,
      reason,
      quote: cleanQuote,
      score: (candidate.score || 0) + scoreOffset,
    });
  };

  const targetUser = firstSemanticMatch([content], [
    /^[ \t]*(?:[-*][ \t]*)?(?:활용처[·ㆍ\-/\s]*사용자|핵심\s*사용자|대상\s*사용자)[ \t]*[:：]\s*([^\n]+)/im,
    /^[ \t]*(?:[-*][ \t]*)?\*\*(?:타깃 유저|타깃 사용자|타겟 사용자|target user|targetUser|target_customer|target customer)[ \t]*[:：]\*\*[ \t]*([^\n]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:[-*][ \t]*)?(?:타깃 유저|타깃 사용자|타겟 사용자|target user|targetUser|target_customer|target customer|customer segment|audience)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^#{1,6}[ \t]+(?:Our[ \t]+ICP|ICP|고객|핵심[ \t]*고객|타깃[ \t]*사용자|타겟[ \t]*사용자)[ \t]*[:：][ \t]*([^\n]+)/im,
  ], looksLikeExplicitCustomerSegment);
  if (targetUser) {
    pushRef({
      field: "targetUser",
      reason: "explicit_target_user",
      quote: `고객: ${targetUser}`,
    });
  }

  const problem = firstSemanticMatch([content], [
    /^[ \t]*핵심 가설:[ \t]*이 유저는[ \t]*"([^"]+)"/im,
    /^[ \t]*핵심 문제는[ \t]*[“"]([^”"]+)[”"]/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:problem|pain|friction)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /(?:^|\/\s*)(?:problem|pain|friction)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
  ], isReadableProblemSentence);
  if (problem) {
    pushRef({
      field: "problem",
      reason: "explicit_problem",
      quote: `문제: ${problem}`,
    });
  }

  const outcome = firstSemanticMatch([content], [
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:활성\s*행동|활성\s*신호|검증\s*행동)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:validation action|activation action|outcome|result|success signal)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^#{1,5}[^\n]*(?:Validation Signals?|검증\s*신호|행동\s*증거)[^\n]*[\s\S]{0,500}?(?:^#{1,6}[^\n]*(?:Positive|긍정)[^\n]*\n+)?(?:[ \t]*\n)*^[ \t]*[-*][ \t]*([^\n]{8,220})/im,
  ], isOutcomeSemanticText);
  if (outcome) {
    pushRef({
      field: "outcome",
      reason: "explicit_validation_action",
      quote: `활성 행동: ${outcome}`,
    });
  }

  return refs;
}

async function collectGenericDocumentFieldEvidence({
  root,
  fsImpl,
  fileCache,
  docFiles = [],
  excludedPaths = [],
} = {}) {
  const excluded = new Set(excludedPaths.map((item) => cleanPath(item).toLowerCase()).filter(Boolean));
  const candidates = uniqueBy(docFiles, (item) => cleanPath(item).toLowerCase())
    .filter((relativePath) => {
      const normalized = cleanPath(relativePath);
      if (!normalized || excluded.has(normalized.toLowerCase())) return false;
      return DOC_EXTENSIONS.has(path.extname(normalized).toLowerCase());
    })
    .sort(compareGenericDocPaths)
    .slice(0, MAX_GENERIC_FIELD_DOCS);

  const refs = [];
  for (const relativePath of candidates) {
    const loaded = await loadWorkspaceText({ root, relativePath, fsImpl, fileCache, maxChars: MAX_DOC_CHARS });
    if (!loaded || !SOURCE_SIGNAL_PATTERN.test(loaded.content)) continue;
    const quote = evidenceQuote(loaded.content, "docs");
    const genericRefs = collectExplicitFieldEvidence({
      role: "docs",
      field: "",
      path: loaded.relativePath,
      source: "generic_doc",
      quote,
      content: loaded.content,
      score: genericDocScore(loaded.relativePath),
    });
    for (const ref of genericRefs) refs.push(ref);
  }
  return refs;
}

function compareGenericDocPaths(a, b) {
  return genericDocRank(a) - genericDocRank(b)
    || cleanPath(a).localeCompare(cleanPath(b));
}

function genericDocRank(relativePath) {
  const normalized = cleanPath(relativePath).toLowerCase();
  if (isAnyInitialRolePath(normalized)) return 0;
  if (/^readme\.(?:md|mdx|txt|rst)$/i.test(normalized)) return 1;
  const depth = normalized.split("/").filter(Boolean).length - 1;
  if (depth <= 0) return 10;
  if (normalized.startsWith("docs/")) return 20;
  return 30 + depth;
}

function genericDocScore(relativePath) {
  const rank = genericDocRank(relativePath);
  if (rank <= 1) return 64;
  if (rank < 20) return 58;
  if (rank < 30) return 54;
  return 50;
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

async function collectPdfEvidence({ root, fsImpl, pdfFiles }) {
  const refs = [];
  for (const relativePath of pdfFiles || []) {
    const resolved = path.resolve(root, relativePath);
    if (!isPathInside(root, resolved)) continue;
    let stat = null;
    try {
      stat = await fsImpl.stat(resolved);
    } catch {
      continue;
    }
    if (!stat?.isFile?.() || stat.size > MAX_PDF_BYTES) continue;
    let bytes = null;
    try {
      bytes = await fsImpl.readFile(resolved);
    } catch {
      continue;
    }
    let extracted = "";
    try {
      extracted = await extractPdfText(bytes, { maxChars: MAX_PDF_CHARS });
    } catch {
      continue;
    }
    const text = cleanPdfText(extracted).slice(0, MAX_PDF_CHARS);
    if (!PDF_SIGNAL_PATTERN.test(text)) continue;
    const targetUser = explicitPdfTargetUser(text);
    const problem = explicitPdfProblem(text);
    const outcome = explicitPdfOutcome(text);
    if (targetUser) {
      refs.push({
        role: "pdf",
        field: "targetUser",
        path: cleanPath(relativePath),
        reason: "pdf explicit 활용처 사용자",
        quote: `활용처·사용자: ${targetUser}`,
        score: 82,
      });
    }
    if (problem) {
      refs.push({
        role: "pdf",
        field: "problem",
        path: cleanPath(relativePath),
        reason: "pdf explicit 목적 필요성",
        quote: `문제: ${problem}`,
        score: 80,
      });
    }
    if (outcome) {
      refs.push({
        role: "pdf",
        field: "outcome",
        path: cleanPath(relativePath),
        reason: "pdf explicit 주요 기능 활성 행동",
        quote: `활성 행동: ${outcome}`,
        score: 78,
      });
    }
  }
  return refs;
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
  const targetUser = evidenceFieldValue(evidence, "targetUser") || firstSemanticMatch([contentFor("icp"), allContent], [
    /^[ \t]*(?:[-*][ \t]*)?(?:활용처[·ㆍ\-/\s]*사용자|핵심\s*사용자|대상\s*사용자)[ \t]*[:：]\s*([^\n]+)/im,
    /^[ \t]*(?:[-*][ \t]*)?\*\*(?:타깃 유저|타깃 사용자|타겟 사용자|target user|targetUser|target_customer|target customer)[ \t]*[:：]\*\*[ \t]*([^\n]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:[-*][ \t]*)?(?:타깃 유저|타깃 사용자|타겟 사용자|target user|targetUser|target_customer|target customer|customer segment|audience)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^##[ \t]+Our ICP:[ \t]*([^\n]+)/im,
    /^#{1,4}[^\n]*(?:ICP|고객|사용자|페르소나|타깃|타겟|대상)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
  ], looksLikeExplicitCustomerSegment);
  const problem = evidenceFieldValue(evidence, "problem") || firstSemanticMatch([contentFor("spec"), contentFor("icp"), allContent], [
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
  const outcome = evidenceFieldValue(evidence, "outcome") || firstSemanticMatch([allContent], [
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:활성\s*행동|활성\s*신호|검증\s*행동)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^[ \t]*(?:(?:\/\/|#)[ \t]*)?(?:outcome|result|success signal|결과|성공 신호)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /(?:^|\/\s*)(?:outcome|result|success signal|결과|성공 신호)[ \t]*[:：=-][ \t]*["“]?([^"”\n/]+)/im,
    /^#{1,4}[^\n]*(?:Outcome|결과|성공)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
    /^#{1,5}[^\n]*(?:Validation Signals?|검증\s*신호|행동\s*증거)[^\n]*[\s\S]{0,500}?(?:^#{1,6}[^\n]*(?:Positive|긍정)[^\n]*\n+)?(?:[ \t]*\n)*^[ \t]*[-*][ \t]*([^\n]{8,220})/im,
    /^#{1,5}[^\n]*(?:Positive|긍정)[^\n]*\n+(?:[ \t]*\n|[-*][ \t]*)*([^\n]{8,220})/im,
  ], isOutcomeSemanticText);
  const likelyUsers = uniqueCompact([
    targetUser,
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

function evidenceFieldValue(evidence = [], field) {
  const ref = evidence.find((item) => cleanToken(item?.field) === cleanToken(field) && item?.quote);
  if (!ref) return "";
  const value = String(ref.quote || "").replace(/^[^:：]{1,40}[:：]\s*/u, "");
  return cleanSemanticText(value);
}

function cleanPdfText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function explicitPdfTargetUser(text) {
  const section = String(text || "").match(/활용처[·ㆍ\-/\s]*사용자\s*[-:：]?\s*([\s\S]{12,420}?)(?:사업화\s*및\s*제휴|ㅇ\s*기대효과|기대효과|비즈니스\s*측면|기타|□|$)/i)?.[1]
    || String(text || "").match(/(?:타깃|타겟|대상)\s*(?:사용자|고객|유저)\s*[-:：]?\s*([\s\S]{12,260}?)(?:사업화|기대효과|□|$)/i)?.[1]
    || "";
  const candidate = cleanSemanticText(section)
    .replace(/\s*을?\s*핵심\s*사용자로\s*설정.*$/u, "")
    .trim();
  return looksLikeCustomerSegment(candidate) ? candidate : "";
}

function explicitPdfProblem(text) {
  const market = firstSemanticMatch([text], [
    /시장\s*기회\s*[:：]\s*([^-–\n]{16,220}?부재함)/i,
  ], isReadableProblemSentence);
  const task = firstSemanticMatch([text], [
    /해결\s*과제\s*[:：]\s*([^-–\n]{16,220}?첫\s*접점을\s*제공)/i,
  ]);
  if (
    /불교\s*호감도/.test(market)
    && /일상적\s*신행/.test(market)
    && /디지털\s*전환\s*도구가\s*부재함/.test(market)
    && /마음챙김.*일상적\s*루틴/.test(task)
  ) {
    return "불교 호감도는 높지만 일상적 신행이나 마음챙김 루틴으로 이어지는 디지털 접점이 부족하다";
  }
  if (market) return market;
  const direct = firstSemanticMatch([text], [
    /(?:문제|해결\s*과제)\s*[:：]\s*([^\n]{16,220})/i,
  ], isReadableProblemSentence);
  if (direct) return direct;
  const purpose = sectionSnippet(text, /목적\s*및\s*필요성/i, /(?:프로젝트\s*소개|주요\s*기능|활용처|기대\s*효과)/i);
  const candidate = firstSemanticMatch([purpose], [
    /([^\n.。]*?(?:부족|부재|어려움|이어지는|이어지지|접점|루틴)[^\n.。]*[.。]?)/i,
  ], isReadableProblemSentence);
  return candidate;
}

function explicitPdfOutcome(text) {
  const direct = firstSemanticMatch([text], [
    /(?:활성\s*행동|활성\s*신호|검증\s*행동)\s*[:：]\s*([^\n]{12,240})/i,
  ], isOutcomeSemanticText);
  if (direct) return direct;
  const feature = sectionSnippet(text, /(?:프로젝트\s*소개|주요\s*기능)/i, /(?:활용처|기대\s*효과|일정|예산)/i);
  const hasMeditation = /명상/.test(feature);
  const hasEmotion = /감정\s*기록|감정기록/.test(feature);
  const hasSutra = /불경|듣기/.test(feature);
  if (hasMeditation && hasEmotion && hasSutra) {
    return "명상·감정기록·불경 듣기 등 첫 마음챙김 활동을 완료하고 반복 사용 의사를 보이는 것";
  }
  return firstSemanticMatch([feature], [
    /([^\n.。]*?(?:완료|반복|사용\s*의사|피드백|검증|활성)[^\n.。]*[.。]?)/i,
  ], isOutcomeSemanticText);
}

function sectionSnippet(text, startPattern, endPattern) {
  const source = String(text || "");
  const start = source.search(startPattern);
  if (start < 0) return "";
  const rest = source.slice(start);
  const end = rest.slice(1).search(endPattern);
  return (end >= 0 ? rest.slice(0, end + 1) : rest).slice(0, 1400);
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
  if (!canonical) return false;
  const lower = normalized.toLowerCase();
  const allowed = lower === canonical.toLowerCase() || isInitialRolePath(lower, role);
  if (!allowed) return false;
  const ext = path.extname(normalized).toLowerCase();
  if (role === "sheet") return SHEET_EXTENSIONS.has(ext);
  return DOC_EXTENSIONS.has(ext);
}

function isInitialRolePath(relativePath, role) {
  const lower = cleanPath(relativePath).toLowerCase();
  const config = ROLE_CONFIG[role];
  return Array.isArray(config?.initialPaths)
    && config.initialPaths.some((candidate) => lower === candidate.toLowerCase());
}

function isAnyInitialRolePath(relativePath) {
  const lower = cleanPath(relativePath).toLowerCase();
  return ROLES.some((role) => isInitialRolePath(lower, role));
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

function isPdfCandidatePath(relativePath, directoryDepth) {
  const normalized = cleanPath(relativePath);
  if (!normalized || hasDeniedSegment(normalized)) return false;
  if ((directoryDepth || 0) > MAX_PDF_DEPTH) return false;
  return path.extname(normalized).toLowerCase() === ".pdf";
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

function isReadableProblemSentence(value) {
  const text = cleanText(value);
  if (!text || text.length < 16 || text.length > 170) return false;
  if (looksLikeOcrContaminatedText(text)) return false;
  return /(문제|부족|부재|어려움|불편|막힘|이어지지|모른다|못|pain|friction|problem|missed|missing|cannot|can't|do\s+not\s+know|does\s+not\s+know|don't\s+know|doesn't\s+know|unclear|unsure|unable|lack|lacks)/i.test(text);
}

function looksLikeOcrContaminatedText(value) {
  const text = cleanText(value);
  if (!text) return true;
  if (/(시장\s*기회\s*\d|00\d{2}|과제\s*\d|[가-힣][0-9]{2,}[가-힣])/u.test(text)) return true;
  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount >= 5 && digitCount / Math.max(text.length, 1) > 0.08) return true;
  const sectionMarkers = text.match(/(?:시장\s*기회|프로젝트\s*소개|주요\s*기능|목적\s*및\s*필요성|활용처)/g) || [];
  return sectionMarkers.length >= 2;
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
  return /(확인|검증|신호|대화|인터뷰|반응|피드백|지불|의향|의사|대안|도입|결정|소개|시장|최근\s*사건|완료|반복|사용\s*의사|요청|기록|유료|파일럿|워크플로|confirm|validate|signal|interview|conversation|feedback|alternative|willingness|ask|record|complete|repeat|use\s*intent|paid\s*pilot|workflow)/i.test(text);
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
  return /(고객|사용자|사람|팀|개발자|창업자|운영자|담당자|대표|리드|수요층|관심층|비신자|입문자|세대|층|lead|manager|founder|developer|customer|user|team|persona|operator|owner)/i.test(String(value || ""));
}

function looksLikeExplicitCustomerSegment(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^#{1,6}\s+/.test(text)) return false;
  if (/^(?:ideal\s+customer\s+profile|customer\s+profile|icp)$/i.test(text)) return false;
  if (/^(?:이상적\s+고객|고객\s*프로필)$/i.test(text)) return false;
  return looksLikeCustomerSegment(text);
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
  if (isAnyInitialRolePath(normalized)) return 5;
  if (/^readme\./i.test(normalized)) return 6;
  if (normalized === "package.json") return 7;
  if (item.role === "source") return 13;
  return 12;
}

function evidenceKey(item = {}) {
  return [
    cleanPath(item.path).toLowerCase(),
    String(item.field || "").toLowerCase(),
    String(item.reason || "").toLowerCase(),
    cleanLongText(item.quote).toLowerCase(),
  ].join("::");
}

function cleanPath(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function cleanToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "");
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
