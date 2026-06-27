import fs from "node:fs/promises";
import path from "node:path";

import { normalizeWorkspaceOnboardingHypothesis } from "./onboarding-hypothesis.mjs";
import { projectDocDefinitions } from "./project-doc-paths.mjs";
import { redactSecrets } from "./workspace-safety.mjs";
import { extractWorkspaceEvidence } from "./workspace-signal-extractor.mjs";

export const WORKSPACE_SCAN_EVIDENCE_BUNDLE_SCHEMA_VERSION = 1;

const SCAN_DOC_TYPES = Object.freeze(["icp", "spec", "values", "designSystem", "adr", "goal", "docs", "sheet"]);
const FOUNDATION_DOC_TYPES = Object.freeze(["icp", "goal", "values", "spec"]);
const MAX_EVIDENCE_REFS = 14;
const MAX_QUOTE_CHARS = 420;
const MAX_SIGNAL_CHARS = 600;
const SUPPORTING_DOC_CANDIDATES = Object.freeze([
  ["docs/ICP.md", "icp supporting_doc_noncanonical"],
  ["docs/GOAL.md", "goal supporting_doc_noncanonical"],
  ["docs/VALUES.md", "values supporting_doc_noncanonical"],
  ["docs/SPEC.md", "spec supporting_doc_noncanonical"],
]);

export async function buildWorkspaceScanEvidenceBundle({
  workspaceRoot,
  scanResult = {},
  workspaceEvidence = null,
  fsImpl = fs,
} = {}) {
  const root = path.resolve(workspaceRoot || ".");
  const evidence = workspaceEvidence || await extractWorkspaceEvidence(root, {
    scanPaths: scanResult,
    includeSource: true,
    fsImpl,
  }).catch(() => null);

  const canonicalDocs = canonicalDocSummary(scanResult);
  const supportingRefs = await collectSupportingDocRefs({ root, fsImpl });
  const evidenceRefs = uniqueEvidenceRefs([
    ...(Array.isArray(evidence?.evidence) ? evidence.evidence : []),
    ...supportingRefs,
  ]).slice(0, MAX_EVIDENCE_REFS);
  const canonicalFoundCount = Object.values(canonicalDocs).filter((doc) => doc.found).length;
  const discoveredEvidenceCount = evidenceRefs.length;

  return {
    schemaVersion: WORKSPACE_SCAN_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    canonicalDocs,
    canonicalFoundCount,
    discoveredEvidenceCount,
    localFoundCount: discoveredEvidenceCount,
    missingCanonicalDocs: Object.entries(canonicalDocs)
      .filter(([, doc]) => !doc.found)
      .map(([role, doc]) => ({ role, canonicalPath: doc.canonicalPath })),
    signals: sanitizeSignals(evidence?.signals || {}),
    evidenceRefs,
    rejectedCandidateCount: Array.isArray(evidence?.rejectedCandidates) ? evidence.rejectedCandidates.length : 0,
  };
}

export function summarizeWorkspaceScanLocalFindings(bundle = {}) {
  const canonicalDocs = {};
  for (const [role, doc] of Object.entries(bundle?.canonicalDocs || {})) {
    canonicalDocs[role] = {
      found: doc?.found === true,
      path: doc?.found && doc?.path ? cleanPath(doc.path) : null,
      canonicalPath: cleanPath(doc?.canonicalPath),
    };
  }
  return {
    schemaVersion: WORKSPACE_SCAN_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    localFoundCount: Number.isFinite(bundle?.localFoundCount) ? bundle.localFoundCount : 0,
    canonicalFoundCount: Number.isFinite(bundle?.canonicalFoundCount) ? bundle.canonicalFoundCount : 0,
    discoveredEvidenceCount: Number.isFinite(bundle?.discoveredEvidenceCount)
      ? bundle.discoveredEvidenceCount
      : Number.isFinite(bundle?.localFoundCount)
        ? bundle.localFoundCount
        : 0,
    canonicalDocs,
    missingCanonicalDocs: Array.isArray(bundle?.missingCanonicalDocs) ? bundle.missingCanonicalDocs : [],
    evidencePaths: Array.isArray(bundle?.evidenceRefs)
      ? bundle.evidenceRefs.map((ref) => ref.path).filter(Boolean).slice(0, 8)
      : [],
  };
}

export function formatWorkspaceScanEvidenceBundleForPrompt(bundle = {}) {
  return JSON.stringify({
    schemaVersion: bundle.schemaVersion,
    canonicalDocs: bundle.canonicalDocs,
    canonicalFoundCount: bundle.canonicalFoundCount,
    discoveredEvidenceCount: bundle.discoveredEvidenceCount,
    localFoundCount: bundle.localFoundCount,
    missingCanonicalDocs: bundle.missingCanonicalDocs,
    signals: bundle.signals,
    evidenceRefs: bundle.evidenceRefs,
  }, null, 2);
}

export function buildWorkspaceScanAgentPrompt(evidenceBundle = {}) {
  return [
    "Verify the provided local workspace evidence bundle and return only JSON.",
    "Local scanning is authoritative for project document paths. Do not return, override, or invent canonical document paths.",
    "Do not inspect the filesystem, run commands, browse the web, or use external tools. Work only from LOCAL_EVIDENCE_BUNDLE_JSON below.",
    "Infer only semantic onboarding fields that are directly supported by bundle evidence. If evidence is insufficient, use empty strings, empty arrays, unknown, and low confidence.",
    "",
    "Return exactly this JSON shape:",
    '{"onboardingHypothesis": {"productName": "", "projectKind": "unknown", "targetUser": "", "problem": "", "purpose": "", "goal": "", "values": "", "likelyUsers": [], "stage": "unknown", "evidence": [], "confidence": "low", "suggestedFirstQuestion": ""}, "situationSignals": {"channels": [], "analyticsTools": [], "events": [], "customerActions": [], "currentAlternatives": [], "conversionSignals": [], "missingAssumptions": []}, "confidence": "low", "evidencePathsUsed": []}',
    "",
    "Rules:",
    "- evidencePathsUsed must contain only paths from LOCAL_EVIDENCE_BUNDLE_JSON.evidenceRefs[].path or found canonicalDocs paths.",
    "- Set onboardingHypothesis.evidence to the same evidence paths used for the semantic claims.",
    "- High confidence is only allowed when multiple concrete claims cite valid bundle evidence paths.",
    "- situationSignals items must cite evidencePath and shortQuote copied from bundle evidence.",
    "",
    "LOCAL_EVIDENCE_BUNDLE_JSON:",
    formatWorkspaceScanEvidenceBundleForPrompt(evidenceBundle),
  ].join("\n");
}

export function normalizeWorkspaceScanSemanticOutput(input = {}, evidenceBundle = {}) {
  const validPaths = bundleEvidencePathSet(evidenceBundle);
  const evidencePathsUsed = normalizeEvidencePathsUsed([
    input?.evidencePathsUsed,
    input?.evidence_paths_used,
    input?.onboardingHypothesis?.evidence,
    input?.onboarding_hypothesis?.evidence,
    situationSignalEvidencePaths(input?.situationSignals || input?.situation_signals),
  ], validPaths);
  const supported = evidencePathsUsed.length > 0;
  const rawHypothesis = input?.onboardingHypothesis || input?.onboarding_hypothesis || {};
  const requestedConfidence = normalizeConfidence(input?.confidence || rawHypothesis?.confidence);

  if (!supported) {
    return {
      onboardingHypothesis: normalizeWorkspaceOnboardingHypothesis({
        confidence: "low",
        evidence: [],
      }),
      situationSignals: filterSemanticSituationSignals(input?.situationSignals || input?.situation_signals, validPaths),
      confidence: "low",
      evidencePathsUsed: [],
    };
  }

  const filteredHypothesis = filterUnsupportedOnboardingClaims(rawHypothesis, evidencePathsUsed, evidenceBundle);
  const onboardingHypothesis = normalizeWorkspaceOnboardingHypothesis({
    ...filteredHypothesis,
    evidence: evidencePathsUsed,
    confidence: confidenceWithBundleSupport(requestedConfidence, evidencePathsUsed, evidenceBundle),
  });
  onboardingHypothesis.evidence = evidencePathsUsed.slice(0, 5);

  return {
    onboardingHypothesis,
    situationSignals: filterSemanticSituationSignals(input?.situationSignals || input?.situation_signals, validPaths),
    confidence: onboardingHypothesis.confidence,
    evidencePathsUsed,
  };
}

function canonicalDocSummary(scanResult = {}) {
  const definitions = projectDocDefinitions(SCAN_DOC_TYPES);
  return Object.fromEntries(definitions.map((doc) => {
    const pathValue = cleanPath(scanResult?.[doc.type]);
    return [doc.type, {
      title: doc.title,
      canonicalPath: doc.canonicalPath,
      found: Boolean(pathValue && pathValue === doc.canonicalPath),
      path: pathValue && pathValue === doc.canonicalPath ? pathValue : null,
      foundation: FOUNDATION_DOC_TYPES.includes(doc.type),
    }];
  }));
}

async function collectSupportingDocRefs({ root, fsImpl }) {
  const refs = [];
  for (const [relativePath, reason] of SUPPORTING_DOC_CANDIDATES) {
    const ref = await readSupportingDocRef({ root, relativePath, reason, fsImpl });
    if (ref) refs.push(ref);
  }
  return refs;
}

async function readSupportingDocRef({ root, relativePath, reason, fsImpl }) {
  const resolved = path.resolve(root, relativePath);
  if (!isPathInside(root, resolved)) return null;
  try {
    const stat = await fsImpl.stat(resolved);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    const content = await fsImpl.readFile(resolved, "utf8");
    return {
      role: "supporting_doc",
      field: "",
      path: path.relative(root, resolved).split(path.sep).join(path.posix.sep),
      reason,
      quote: quoteFromContent(content),
      score: 20,
    };
  } catch {
    return null;
  }
}

function uniqueEvidenceRefs(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const pathValue = cleanPath(value?.path);
    const quote = cleanString(value?.quote, MAX_QUOTE_CHARS);
    if (!pathValue || !quote) continue;
    const key = [
      pathValue.toLowerCase(),
      cleanToken(value?.field),
      cleanString(value?.reason, 120).toLowerCase(),
      quote.toLowerCase(),
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      role: cleanToken(value?.role),
      field: cleanToken(value?.field),
      path: pathValue,
      reason: cleanString(value?.reason, 120),
      quote,
    });
  }
  return output;
}

function filterUnsupportedOnboardingClaims(rawHypothesis = {}, evidencePathsUsed = [], evidenceBundle = {}) {
  const fields = ["productName", "targetUser", "problem", "purpose", "goal", "values", "stage", "projectKind", "suggestedFirstQuestion"];
  const output = {};
  for (const field of fields) output[field] = rawHypothesis?.[field] ?? rawHypothesis?.[snakeCase(field)] ?? "";
  for (const field of ["targetUser", "problem", "purpose", "goal", "values"]) {
    if (!claimSupportedByEvidence(field, output[field], evidencePathsUsed, evidenceBundle)) {
      output[field] = "";
    }
  }
  const likelyUsers = Array.isArray(rawHypothesis?.likelyUsers || rawHypothesis?.likely_users)
    ? rawHypothesis.likelyUsers || rawHypothesis.likely_users
    : [];
  output.likelyUsers = likelyUsers
    .map((item) => cleanString(item, 180))
    .filter((item) => claimSupportedByEvidence("targetUser", item, evidencePathsUsed, evidenceBundle))
    .slice(0, 6);
  output.confidence = rawHypothesis?.confidence;
  return output;
}

function claimSupportedByEvidence(field, claim, evidencePathsUsed = [], evidenceBundle = {}) {
  const text = cleanString(claim, 260);
  if (!text) return false;
  if (field === "problem" && looksLikeOcrContaminatedSemanticClaim(text)) return false;
  const refs = evidenceRefsForClaim(field, evidencePathsUsed, evidenceBundle);
  if (!refs.length) return false;
  const claimNorm = normalizeSemanticComparisonText(text);
  const claimTokens = semanticClaimTokens(text);
  for (const ref of refs) {
    const quote = cleanString(ref.quote, MAX_QUOTE_CHARS);
    if (!quote) continue;
    const quoteNorm = normalizeSemanticComparisonText(quote);
    if (quoteNorm.includes(claimNorm) || claimNorm.includes(quoteNorm)) return true;
    const quoteTokens = new Set(semanticClaimTokens(quote));
    const overlap = claimTokens.filter((token) => quoteTokens.has(token));
    if (overlap.length >= Math.min(3, claimTokens.length)) return true;
  }
  return false;
}

function evidenceRefsForClaim(field, evidencePathsUsed = [], evidenceBundle = {}) {
  const used = new Set(evidencePathsUsed.map((item) => cleanPath(item).toLowerCase()).filter(Boolean));
  const refs = (Array.isArray(evidenceBundle?.evidenceRefs) ? evidenceBundle.evidenceRefs : [])
    .filter((ref) => used.has(cleanPath(ref?.path).toLowerCase()));
  const expectedField = field === "targetUser" ? "targetuser" : cleanToken(field);
  const fieldRefs = refs.filter((ref) => cleanToken(ref?.field) === expectedField);
  return fieldRefs.length ? fieldRefs : refs;
}

function looksLikeOcrContaminatedSemanticClaim(value) {
  const text = cleanString(value, 260);
  if (!text) return true;
  if (/(시장\s*기회\s*\d|00\d{2}|과제\s*\d|[가-힣][0-9]{2,}[가-힣])/u.test(text)) return true;
  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount >= 5 && digitCount / Math.max(text.length, 1) > 0.08) return true;
  const sectionMarkers = text.match(/(?:시장\s*기회|프로젝트\s*소개|주요\s*기능|목적\s*및\s*필요성|활용처)/g) || [];
  return sectionMarkers.length >= 2;
}

function normalizeSemanticComparisonText(value) {
  return cleanString(value, 420)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function semanticClaimTokens(value) {
  const stop = new Set(["고객", "사용자", "문제", "목표", "프로젝트", "시장", "기회", "기능", "서비스", "the", "and", "for", "with"]);
  return cleanString(value, 420)
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !stop.has(item))
    .slice(0, 24);
}

function snakeCase(value) {
  return String(value || "").replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

function sanitizeSignals(signals = {}) {
  return {
    productName: cleanString(signals.productName, 120),
    targetUser: cleanString(signals.targetUser, MAX_SIGNAL_CHARS),
    problem: cleanString(signals.problem, MAX_SIGNAL_CHARS),
    purpose: cleanString(signals.purpose, MAX_SIGNAL_CHARS),
    goal: cleanString(signals.goal, MAX_SIGNAL_CHARS),
    values: cleanString(signals.values, MAX_SIGNAL_CHARS),
    outcome: cleanString(signals.outcome, MAX_SIGNAL_CHARS),
    stage: cleanToken(signals.stage) || "unknown",
    likelyUsers: Array.isArray(signals.likelyUsers)
      ? signals.likelyUsers.map((item) => cleanString(item, 160)).filter(Boolean).slice(0, 4)
      : [],
  };
}

function bundleEvidencePathSet(bundle = {}) {
  const paths = new Set();
  for (const ref of bundle?.evidenceRefs || []) {
    const pathValue = cleanPath(ref?.path);
    if (pathValue) paths.add(pathValue.toLowerCase());
  }
  for (const doc of Object.values(bundle?.canonicalDocs || {})) {
    const pathValue = doc?.found ? cleanPath(doc.path) : "";
    if (pathValue) paths.add(pathValue.toLowerCase());
  }
  return paths;
}

function normalizeEvidencePathsUsed(values, validPaths) {
  const output = [];
  const seen = new Set();
  for (const value of flatten(values)) {
    const raw = typeof value === "string"
      ? value
      : value?.path || value?.evidencePath || value?.evidence_path || "";
    const pathValue = extractEvidencePath(raw);
    const key = pathValue.toLowerCase();
    if (!pathValue || !validPaths.has(key) || seen.has(key)) continue;
    seen.add(key);
    output.push(pathValue);
  }
  return output.slice(0, 8);
}

function situationSignalEvidencePaths(input = {}) {
  const paths = [];
  if (!input || typeof input !== "object") return paths;
  for (const value of Object.values(input)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item?.evidencePath || item?.path) paths.push(item.evidencePath || item.path);
    }
  }
  return paths;
}

function filterSemanticSituationSignals(input = {}, validPaths) {
  const fields = ["channels", "analyticsTools", "events", "customerActions", "currentAlternatives", "conversionSignals"];
  const output = Object.fromEntries(fields.map((field) => [field, []]));
  output.missingAssumptions = Array.isArray(input?.missingAssumptions)
    ? input.missingAssumptions.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 8)
    : [];
  for (const field of fields) {
    const values = Array.isArray(input?.[field]) ? input[field] : [];
    output[field] = values
      .map((item) => {
        const evidencePath = extractEvidencePath(item?.evidencePath || item?.path);
        if (!evidencePath || !validPaths.has(evidencePath.toLowerCase())) return null;
        const label = cleanString(item?.label, 80);
        const shortQuote = cleanString(item?.shortQuote || item?.quote, 220);
        if (!label || !shortQuote) return null;
        return { label, evidencePath, shortQuote };
      })
      .filter(Boolean)
      .slice(0, 8);
  }
  return output;
}

function confidenceWithBundleSupport(confidence, evidencePathsUsed, bundle) {
  const normalized = normalizeConfidence(confidence);
  if (!evidencePathsUsed.length) return "low";
  if (normalized === "high") {
    const availableEvidenceCount = Array.isArray(bundle?.evidenceRefs) ? bundle.evidenceRefs.length : 0;
    const required = Math.min(2, Math.max(1, availableEvidenceCount));
    return evidencePathsUsed.length >= required ? "high" : "medium";
  }
  return normalized;
}

function normalizeConfidence(value) {
  const text = cleanToken(value);
  return ["low", "medium", "high"].includes(text) ? text : "low";
}

function extractEvidencePath(value) {
  const text = cleanPath(value);
  if (!text) return "";
  const beforeColon = text.split(":", 1)[0];
  return cleanPath(beforeColon);
}

function quoteFromContent(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--"))
    .slice(0, 5);
  return cleanString(lines.join(" | "), MAX_QUOTE_CHARS);
}

function flatten(values) {
  const output = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value != null) output.push(value);
  };
  visit(values);
  return output;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function cleanPath(value = "") {
  const text = String(value || "").trim().replace(/\\/g, "/");
  if (!text || text.includes("\0") || path.posix.isAbsolute(text)) return "";
  return text.replace(/^\.\//, "");
}

function cleanToken(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function cleanString(value = "", maxLength = 500) {
  const text = redactSecrets(String(value ?? "").replace(/\s+/g, " ").trim());
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
