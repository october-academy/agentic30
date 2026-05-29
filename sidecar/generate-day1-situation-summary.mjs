// Day-1 project situation summary v3.
//
// v3 intentionally drops the old domain/template surface. User-visible values
// must come from a candidate that carries workspace evidence or be explicitly
// marked evidence-limited. No vendor/channel/action is emitted just because it
// is generally useful.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

import { isNoisePath, isSecretPath, redactSecrets } from "./workspace-safety.mjs";
import { detectReadmeDrift } from "./readme-drift.mjs";
import { extractWorkspaceEvidence } from "./workspace-signal-extractor.mjs";

export const DAY1_SITUATION_SUMMARY_SCHEMA_VERSION = 3;

const README_MAX_CHARS = 6_000;
const SUMMARY_FIELD_MAX = 180;
const EVIDENCE_REF_MAX = 8;
const DISCOVERY_MAX_ENTRIES = 2_000;
const DISCOVERY_MAX_DEPTH = 5;
const EVIDENCE_FILE_MAX_CHARS = 4_000;
const MAX_CANDIDATES_PER_KIND = 8;

const TEXT_EXT_RE = /\.(?:md|mdx|txt|rst|adoc|json|yaml|yml|swift|ts|tsx|js|mjs|jsx|py)$/i;
const EVIDENCE_DOC_EXT_RE = /\.(?:md|mdx|txt|rst|adoc|json|yaml|yml)$/i;
const CUSTOMER_PATH_RE = /(interview|transcript|customer|feedback|monetization|payment|bip|work[-_ ]?log|journal|diary|research|인터뷰|고객|피드백|결제|업무|일지|리서치)/i;
const MARKET_PATH_RE = /(landing|marketing|ads?|campaign|growth|acquisition|reels?|instagram|threads|channel|마케팅|광고|랜딩|릴스|채널|유입)/i;
const GENERIC_DRIFT_TERMS = new Set([
  "agentic30",
  "alignment",
  "design",
  "handoff",
  "news",
  "opendesign",
  "readme",
]);
const ACTION_KIND_PRIORITY = new Map([
  ["conversion", 0],
  ["customer_action", 1],
  ["outcome", 2],
  ["event", 3],
  ["channel", 4],
  ["metric", 5],
  ["workflow", 6],
  ["alternative", 7],
  ["analytics", 8],
]);

const KIND_LABELS = {
  mac_app: "macOS 앱",
  web_app: "웹 앱",
  developer_tool: "개발자 도구",
  node_app: "Node.js 프로젝트",
  strategy_docs: "전략 문서 프로젝트",
};

const STAGE_LABELS = {
  idea: "아이디어 정리",
  prototype: "프로토타입 검증",
  building: "빌드 중",
  first_users: "초기 사용자 검증",
  pre_revenue: "매출 전 검증",
  post_revenue: "매출 후 확장",
  unknown: "상태 확인 필요",
};

const SignalRefSchema = z.string().min(1);

const ProjectSchema = z.object({
  name: z.string().min(1),
  oneLine: z.string().min(1),
  customer: z.string(),
  problem: z.string(),
  evidenceRefs: z.array(SignalRefSchema).max(EVIDENCE_REF_MAX),
}).passthrough();

const DiagnosisSchema = z.object({
  stage: z.string().min(1),
  bottleneck: z.string().min(1),
  whyNow: z.string().min(1),
  missingSignal: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(SignalRefSchema).max(EVIDENCE_REF_MAX),
}).passthrough();

const RealityGapSchema = z.object({
  docClaim: z.string().min(1),
  observedReality: z.string().min(1),
  recommendation: z.string().min(1),
  evidenceRefs: z.array(SignalRefSchema).max(EVIDENCE_REF_MAX),
}).passthrough();

const BaselineSchema = z.object({
  target: z.string().min(1),
  current: z.string().min(1),
  day30Question: z.string().min(1),
  metrics: z.array(z.string()).max(6),
}).passthrough();

const PathNodeSchema = z.object({
  label: z.string().min(1),
  kind: z.string().min(1),
  status: z.string().min(1),
  why: z.string().min(1),
  evidenceRefs: z.array(SignalRefSchema).max(EVIDENCE_REF_MAX),
}).passthrough();

const ActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1),
  kind: z.string().min(1),
  promptSeed: z.string().min(1),
  evidenceRefs: z.array(SignalRefSchema).max(EVIDENCE_REF_MAX),
  evidenceLimited: z.boolean(),
}).passthrough();

const QualityGateSchema = z.object({
  score: z.number().min(0).max(10),
  passed: z.boolean(),
  reasons: z.array(z.string()).min(1),
}).passthrough();

const TrustSchema = z.object({
  readOnly: z.boolean(),
  secretsExcluded: z.boolean(),
  sourcesUsed: z.array(z.string()),
}).passthrough();

export const Day1SituationSummarySchema = z.object({
  schemaVersion: z.literal(DAY1_SITUATION_SUMMARY_SCHEMA_VERSION),
  source: z.enum(["local_evidence", "agent_refined"]),
  generatedAt: z.string().min(1),
  project: ProjectSchema,
  diagnosis: DiagnosisSchema,
  realityGap: RealityGapSchema.nullable().optional(),
  baseline: BaselineSchema,
  path: z.array(PathNodeSchema).max(6),
  actions: z.array(ActionSchema).max(3),
  qualityGate: QualityGateSchema,
  trust: TrustSchema,
}).passthrough();

function clamp(text, max = SUMMARY_FIELD_MAX) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function cleanText(text, max = SUMMARY_FIELD_MAX) {
  return clamp(text, max);
}

function cleanToken(text) {
  return String(text || "").trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "_").replace(/^_+|_+$/g, "");
}

function hasKoreanFinalConsonant(text) {
  const chars = Array.from(String(text || "").trim());
  const char = chars[chars.length - 1];
  if (!char) return false;
  const code = char.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return ((code - 0xac00) % 28) !== 0;
}

function objectForm(text) {
  const value = cleanText(text, 100);
  if (!value) return "";
  return `${value}${hasKoreanFinalConsonant(value) ? "을" : "를"}`;
}

function userFacingName(hypothesis) {
  const name = cleanText(hypothesis?.productName || "", 80);
  if (!name || /workspace-[a-z0-9]{4,}$/i.test(name) || /^(tmp|temp|test)[-_]/i.test(name)) {
    return "이 프로젝트";
  }
  return name;
}

function sentence(text) {
  const value = cleanText(text, SUMMARY_FIELD_MAX);
  if (!value) return "";
  return /[.!?。다요]$/.test(value) ? value : `${value}.`;
}

function evidenceRef(value) {
  if (!value) return "";
  if (typeof value === "string") return cleanText(value, 120);
  const pathLabel = cleanText(value.path || value.evidencePath || value.source || "", 90);
  const reason = cleanText(value.reason || value.kind || value.field || "", 40);
  if (pathLabel && reason) return `${pathLabel} (${reason})`;
  return pathLabel || reason;
}

function evidenceRefsFromCandidates(candidates = [], max = EVIDENCE_REF_MAX) {
  return uniqueStrings(candidates.flatMap((candidate) => candidate.evidenceRefs || [])).slice(0, max);
}

function uniqueStrings(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const text = cleanText(value, 180);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function candidate({
  kind,
  value,
  sourceRef = "",
  quote = "",
  score = 1,
  evidenceLimited = false,
} = {}) {
  const cleanValue = cleanText(value, SUMMARY_FIELD_MAX);
  if (!kind || !cleanValue) return null;
  const ref = evidenceRef(sourceRef);
  return {
    kind,
    value: cleanValue,
    sourceRef: ref,
    quote: cleanText(quote, 220),
    score: Number.isFinite(score) ? score : 1,
    evidenceLimited: Boolean(evidenceLimited || !ref),
    evidenceRefs: ref ? [ref] : [],
  };
}

function addCandidate(map, item) {
  if (!item?.value) return;
  const list = map.get(item.kind) || [];
  const key = item.value.toLowerCase();
  const existing = list.find((value) => value.value.toLowerCase() === key);
  if (existing) {
    existing.score = Math.max(existing.score, item.score);
    existing.evidenceRefs = uniqueStrings([...existing.evidenceRefs, ...item.evidenceRefs]);
    if (!existing.quote && item.quote) existing.quote = item.quote;
    existing.evidenceLimited = existing.evidenceLimited && item.evidenceLimited;
  } else {
    list.push(item);
  }
  list.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
  map.set(item.kind, list.slice(0, MAX_CANDIDATES_PER_KIND));
}

function candidatesOf(evidence, kind) {
  return evidence.candidates.get(kind) || [];
}

function bestCandidate(evidence, kinds = []) {
  const values = kinds.flatMap((kind) => candidatesOf(evidence, kind));
  return values.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))[0] || null;
}

function allEvidenceCandidates(evidence) {
  return [...evidence.candidates.values()].flat();
}

function sourceLabelForRole(role, fallback = "workspace evidence") {
  switch (role) {
    case "icp": return "ICP";
    case "spec": return "SPEC";
    case "goal": return "GOAL";
    case "docs": return "README";
    case "values": return "VALUES";
    case "source": return "source";
    case "customer": return "customer evidence";
    case "market": return "market evidence";
    case "agent": return "agent signal";
    default: return fallback;
  }
}

function sourceRefFromWorkspaceRef(ref) {
  return {
    path: ref?.path || "",
    reason: sourceLabelForRole(ref?.role || ref?.field || ""),
  };
}

function addHypothesisCandidates(evidence, h) {
  const hypothesisRef = (role = "onboarding hypothesis") => ({
    path: Array.isArray(h.evidence) && h.evidence.length ? h.evidence[0] : "onboarding hypothesis",
    reason: role,
  });
  addCandidate(evidence.candidates, candidate({ kind: "product", value: userFacingName(h), sourceRef: hypothesisRef("product"), score: 6, evidenceLimited: !h.productName }));
  addCandidate(evidence.candidates, candidate({ kind: "customer", value: h.targetUser || h.likelyUsers?.[0], sourceRef: hypothesisRef("customer"), score: 6 }));
  addCandidate(evidence.candidates, candidate({ kind: "problem", value: h.problem, sourceRef: hypothesisRef("problem"), score: 6 }));
  addCandidate(evidence.candidates, candidate({ kind: "purpose", value: h.purpose, sourceRef: hypothesisRef("purpose"), score: 5 }));
  addCandidate(evidence.candidates, candidate({ kind: "goal", value: h.goal, sourceRef: hypothesisRef("goal"), score: 7 }));
  addCandidate(evidence.candidates, candidate({ kind: "values", value: h.values, sourceRef: hypothesisRef("values"), score: 3 }));
  for (const user of h.likelyUsers || []) {
    addCandidate(evidence.candidates, candidate({ kind: "customer", value: user, sourceRef: hypothesisRef("likely user"), score: 4 }));
  }
  if (h.stage) {
    addCandidate(evidence.candidates, candidate({ kind: "stage", value: h.stage, sourceRef: hypothesisRef("stage"), score: 4 }));
  }
}

function addWorkspaceEvidenceCandidates(evidence, workspaceEvidence) {
  const signals = workspaceEvidence?.signals || {};
  const refs = Array.isArray(workspaceEvidence?.evidence) ? workspaceEvidence.evidence : [];
  const roleRef = (role) => refs.find((ref) => ref.role === role || ref.field === role) || refs[0] || null;

  addCandidate(evidence.candidates, candidate({ kind: "product", value: signals.productName, sourceRef: sourceRefFromWorkspaceRef(roleRef("docs")), quote: roleRef("docs")?.quote, score: 8 }));
  addCandidate(evidence.candidates, candidate({ kind: "customer", value: signals.targetUser, sourceRef: sourceRefFromWorkspaceRef(roleRef("icp")), quote: roleRef("icp")?.quote, score: 9 }));
  addCandidate(evidence.candidates, candidate({ kind: "problem", value: signals.problem, sourceRef: sourceRefFromWorkspaceRef(roleRef("spec")), quote: roleRef("spec")?.quote, score: 9 }));
  addCandidate(evidence.candidates, candidate({ kind: "purpose", value: signals.purpose, sourceRef: sourceRefFromWorkspaceRef(roleRef("docs")), quote: roleRef("docs")?.quote, score: 8 }));
  addCandidate(evidence.candidates, candidate({ kind: "goal", value: signals.goal, sourceRef: sourceRefFromWorkspaceRef(roleRef("goal")), quote: roleRef("goal")?.quote, score: 9 }));
  addCandidate(evidence.candidates, candidate({ kind: "outcome", value: signals.outcome, sourceRef: sourceRefFromWorkspaceRef(roleRef("goal") || roleRef("spec")), quote: roleRef("goal")?.quote || roleRef("spec")?.quote, score: 8 }));
  for (const user of signals.likelyUsers || []) {
    addCandidate(evidence.candidates, candidate({ kind: "customer", value: user, sourceRef: sourceRefFromWorkspaceRef(roleRef("icp")), score: 6 }));
  }

  for (const ref of refs) {
    const refSource = sourceRefFromWorkspaceRef(ref);
    evidence.refs.push(evidenceRef(refSource));
    const quote = cleanText(ref.quote, 240);
    const allowDetectorSignals = ref.role !== "source" || hasExplicitSignalLabel(quote);
    for (const term of extractNamedSignals(quote, { allowDetectorSignals })) {
      addCandidate(evidence.candidates, candidate({ ...term, sourceRef: refSource, quote, score: term.score + Math.min(4, ref.score / 20 || 0) }));
    }
    for (const metric of extractMetricPhrases(quote)) {
      addCandidate(evidence.candidates, candidate({ kind: "metric", value: metric, sourceRef: refSource, quote, score: 5 }));
    }
    for (const action of extractCustomerActions(quote)) {
      addCandidate(evidence.candidates, candidate({ kind: "customer_action", value: action, sourceRef: refSource, quote, score: 5 }));
    }
  }
}

function addAgentSituationSignals(evidence, agentSituationSignals = []) {
  const signalSets = Array.isArray(agentSituationSignals) ? agentSituationSignals : [agentSituationSignals];
  const fieldKind = {
    channels: "channel",
    analyticsTools: "analytics",
    events: "event",
    customerActions: "customer_action",
    currentAlternatives: "alternative",
    conversionSignals: "conversion",
  };
  for (const set of signalSets) {
    if (!set || typeof set !== "object") continue;
    for (const [field, kind] of Object.entries(fieldKind)) {
      const items = Array.isArray(set[field]) ? set[field] : [];
      for (const item of items) {
        addCandidate(evidence.candidates, candidate({
          kind,
          value: item.label,
          sourceRef: { path: item.evidencePath, reason: sourceLabelForRole("agent") },
          quote: item.shortQuote,
          score: 8,
        }));
      }
    }
    for (const missing of set.missingAssumptions || []) {
      addCandidate(evidence.candidates, candidate({
        kind: "missing_assumption",
        value: missing,
        sourceRef: { path: "agent signal", reason: "missing assumption" },
        score: 4,
      }));
    }
  }
}

function addRecentWorkCandidates(evidence, { agentHistory, recentCommitSubjects }) {
  for (const intent of agentHistory?.recentIntents || []) {
    const quote = cleanText(intent.text, 180);
    for (const term of extractNamedSignals(quote, { allowDetectorSignals: hasExplicitSignalLabel(quote) })) {
      addCandidate(evidence.candidates, candidate({ ...term, sourceRef: { path: "~/.agent history", reason: "recent agent work" }, quote, score: term.score + 1 }));
    }
  }
  for (const subject of recentCommitSubjects || []) {
    const quote = cleanText(subject, 180);
    for (const term of extractNamedSignals(quote, { allowDetectorSignals: hasExplicitSignalLabel(quote) })) {
      addCandidate(evidence.candidates, candidate({ ...term, sourceRef: { path: "git log", reason: "recent commit" }, quote, score: term.score }));
    }
  }
}

function addEvidenceFileCandidates(evidence, buckets) {
  const addSnippets = (kind, paths = [], snippets = [], score = 5) => {
    snippets.forEach((snippet, index) => {
      const sourceRef = { path: paths[index] || paths[0] || kind, reason: kind };
      for (const term of extractNamedSignals(snippet)) {
        addCandidate(evidence.candidates, candidate({ ...term, sourceRef, quote: snippet, score: term.score + score }));
      }
      for (const metric of extractMetricPhrases(snippet)) {
        addCandidate(evidence.candidates, candidate({ kind: "metric", value: metric, sourceRef, quote: snippet, score: score + 1 }));
      }
      for (const action of extractCustomerActions(snippet)) {
        addCandidate(evidence.candidates, candidate({ kind: "customer_action", value: action, sourceRef, quote: snippet, score: score + 2 }));
      }
      for (const alternative of extractAlternatives(snippet)) {
        addCandidate(evidence.candidates, candidate({ kind: "alternative", value: alternative, sourceRef, quote: snippet, score: score + 2 }));
      }
    });
  };
  addSnippets("customer evidence", buckets?.customerEvidence?.paths, buckets?.customerEvidence?.snippets, 6);
  addSnippets("market evidence", buckets?.marketEvidence?.paths, buckets?.marketEvidence?.snippets, 6);
}

function addDriftCandidates(evidence, driftFindings) {
  if (!driftFindings?.driftScore) return;
  const sourceRef = { path: "git/agent recent work", reason: "README drift" };
  for (const item of driftFindings.missingFromReadme || []) {
    const value = cleanText(item?.term, 80);
    if (!isUsefulDriftTerm(value) || !isDay1DecisionDriftText(value)) continue;
    const quote = `최근 작업에서 ${value} 근거가 보이지만 README에는 약합니다.`;
    for (const signal of extractNamedSignals(value)) {
      addCandidate(evidence.candidates, candidate({ ...signal, sourceRef, quote, score: signal.score + 2 }));
    }
    if (/(인터뷰|대화|conversation|interview)/i.test(value)) {
      addCandidate(evidence.candidates, candidate({ kind: "customer_action", value, sourceRef, quote, score: 6 }));
    } else if (/(파일럿|결제|구매|매출|유료|conversion|paid|payment|revenue|purchase)/i.test(value)) {
      addCandidate(evidence.candidates, candidate({ kind: "conversion", value, sourceRef, quote, score: 6 }));
    } else if (/(채널|접점|유입|channel|acquisition)/i.test(value)) {
      addCandidate(evidence.candidates, candidate({ kind: "channel", value, sourceRef, quote, score: 5 }));
    }
  }
}

function createSituationEvidence({
  onboardingHypothesis = {},
  agentHistory = null,
  recentCommitSubjects = [],
  driftFindings = null,
  evidenceBuckets = null,
  agentSituationSignals = [],
  localDiscovery = null,
} = {}) {
  const evidence = {
    candidates: new Map(),
    refs: [],
    drift: driftFindings || detectReadmeDrift({}),
    localDiscovery,
  };
  addHypothesisCandidates(evidence, onboardingHypothesis || {});
  if (evidenceBuckets?.workspaceEvidence) {
    addWorkspaceEvidenceCandidates(evidence, evidenceBuckets.workspaceEvidence);
  }
  addEvidenceFileCandidates(evidence, evidenceBuckets);
  addDriftCandidates(evidence, driftFindings);
  addAgentSituationSignals(evidence, agentSituationSignals);
  addRecentWorkCandidates(evidence, { agentHistory, recentCommitSubjects });
  evidence.refs = uniqueStrings([...evidence.refs, ...evidenceRefsFromCandidates(allEvidenceCandidates(evidence), 20)]).slice(0, 20);
  return evidence;
}

// Named extractor is allowed to know common tool/channel names, but it may only
// emit a value when that exact signal is present in evidence text.
const NAMED_SIGNAL_DETECTORS = Object.freeze([
  { value: "PostHog", kind: "analytics", re: /\bposthog\b/i, score: 6 },
  { value: "UTM", kind: "metric", re: /\butm\b|utm_/i, score: 5 },
  { value: "릴스", kind: "channel", re: /\breels?\b|릴스|쇼츠|\bshorts?\b/i, score: 5 },
  { value: "Meta Ads", kind: "channel", re: /meta\s+ads|facebook\s+ads|instagram\s+ads|paid\s+ads|유료\s*광고/i, score: 5 },
  { value: "Search Console", kind: "analytics", re: /search\s+console|검색\s*콘솔/i, score: 5 },
  { value: "App Store Ads", kind: "channel", re: /app\s+store\s+ads?|apple\s+search\s+ads?|앱스토어\s*광고|애플\s*광고/i, score: 5 },
  { value: "Slack", kind: "workflow", re: /\bslack\b/i, score: 4 },
  { value: "Zendesk", kind: "workflow", re: /\bzendesk\b/i, score: 4 },
  { value: "GitHub", kind: "workflow", re: /\bgithub\b/i, score: 4 },
  { value: "Notion", kind: "alternative", re: /\bnotion\b|노션/i, score: 4 },
  { value: "Airtable", kind: "alternative", re: /\bairtable\b/i, score: 4 },
  { value: "스프레드시트", kind: "alternative", re: /spreadsheet|google\s+sheets?|스프레드시트|시트/i, score: 4 },
  { value: "이메일", kind: "workflow", re: /\bemail\b|\bgmail\b|메일|이메일/i, score: 3 },
  { value: "고객 인터뷰", kind: "customer_action", re: /interview|customer conversation|고객\s*인터뷰|인터뷰|대화/i, score: 4 },
  { value: "결제 의사", kind: "conversion", re: /willingness\s*to\s*pay|payment intent|결제\s*의사|지불\s*의향|유료\s*의향/i, score: 5 },
  { value: "파일럿", kind: "conversion", re: /pilot|파일럿/i, score: 5 },
]);

function hasExplicitSignalLabel(text) {
  return /\b(channels?|acquisition|analytics|metrics?|events?|conversion|signup|payment|customer|goal|outcome)\b\s*[:：=-]|(유입\s*채널|채널|계측|이벤트|지표|전환|구매|결제|고객|목표|성과)\s*[:：=-]/i.test(String(text || ""));
}

function extractNamedSignals(text, { allowDetectorSignals = true } = {}) {
  const source = String(text || "");
  const out = [];
  if (allowDetectorSignals) {
    for (const detector of NAMED_SIGNAL_DETECTORS) {
      if (detector.re.test(source)) {
        out.push({ kind: detector.kind, value: detector.value, score: detector.score });
      }
    }
  }
  for (const value of extractLabeledList(source, /(channels?|acquisition|유입\s*채널|채널)\s*[:：=-]\s*([^/|\n]+)/i)) {
    out.push({ kind: "channel", value, score: 6 });
  }
  for (const value of extractLabeledList(source, /(analytics|계측)\s*[:：=-]\s*([^/|\n]+)/i)) {
    out.push({ kind: "analytics", value, score: 6 });
  }
  for (const value of extractLabeledList(source, /(events?|이벤트)\s*[:：=-]\s*([^/|\n]+)/i)) {
    out.push({ kind: "event", value, score: 6 });
  }
  for (const value of extractLabeledList(source, /(metrics?|지표)\s*[:：=-]\s*([^/|\n]+)/i)) {
    out.push({ kind: "metric", value, score: 6 });
  }
  for (const value of extractLabeledList(source, /(conversion|signup|payment|구매|결제|전환)\s*[:：=-]\s*([^/|\n]+)/i)) {
    out.push({ kind: "conversion", value, score: 6 });
  }
  return out;
}

function extractLabeledList(text, pattern) {
  const match = String(text || "").match(pattern);
  if (!match?.[2]) return [];
  return match[2]
    .split(/[,，、/|•·]+|->|→/)
    .map((item) => cleanText(
      String(item || "").replace(/\s+(?:channels?|analytics|metrics?|events?|conversion|customer|goal|outcome|계측|이벤트|지표|전환|고객|목표|성과)\s*[:：=-].*$/i, ""),
      40,
    ))
    .filter((item) => item.length >= 2)
    .slice(0, 8);
}

function extractMetricPhrases(text) {
  const source = cleanText(text, 400);
  const out = [];
  const re = /(?:[가-힣A-Za-z][가-힣A-Za-z0-9_-]*\s*){0,3}\d+(?:\.\d+)?\s*(?:명|팀|곳|개|건|회|원|만원|달러|%|percent|users?|teams?|calls?|events?|건수)/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    const value = normalizeMetricPhrase(match[0]);
    if (isUsefulMetricPhrase(value)) out.push(value);
  }
  return uniqueStrings(out).slice(0, 6);
}

function normalizeMetricPhrase(value) {
  return cleanText(value, 60)
    .replace(/^(?:이번|다음|지난)\s+주\s+/i, "")
    .replace(/^(?:\d+\s*)?일\s+안에\s+/i, "")
    .replace(/^(?:목표는|목표|안에|동안|뒤)\s+/i, "")
    .replace(/^(?:에게|에서|으로|이|가|은|는|을|를|또는|및|와|과)\s+/i, "")
    .replace(/(?:을|를)\s+(\d)/g, " $1")
    .trim();
}

function isUsefulMetricPhrase(value) {
  const text = cleanText(value, 60);
  if (!text || !/\d/.test(text)) return false;
  if (/^(?:목표는?|안에|동안|뒤)\s*\d/i.test(text)) return false;
  if (/(?:위한|전업|개발자|부트캠프)\s*\d/i.test(text)) return false;
  return /(?:명|팀|곳|개|건|회|원|만원|달러|%|percent|users?|teams?|calls?|events?|건수)/i.test(text);
}

function isBaselineMetricValue(value) {
  const text = cleanText(value, 80);
  if (!text) return false;
  if (isUsefulMetricPhrase(text)) return true;
  return /\b[a-z][a-z0-9_]*_(?:created|completed|submitted|applied|converted|paid|signup|purchased)\b/i.test(text)
    || /(첫\s*매출|유료\s*(?:고객|전환|출판|요청|신호)|결제|구매|가입|전환|revenue|payment|signup|conversion)/i.test(text);
}

function extractCustomerActions(text) {
  const source = String(text || "");
  const fragments = source
    .split(/\r?\n|[.!?。]\s+|[|/]/)
    .map((line) => cleanText(line, 120))
    .filter(Boolean);
  return uniqueStrings(
    fragments.filter((line) =>
      /(인터뷰|대화|파일럿|결제|지불|구매|가입|등록|소개|도입|반복|검증|인증|응답|후속|남긴|남긴다|call|pilot|pay|buy|signup|adopt|refer|reply|follow.?up|check.?in|conversation|interview)/i.test(line)
      && !/^#{1,6}\s/.test(line)
      && !/^[-*]\s/.test(line)
      && !/^(?:metric|metrics?|event|events?|analytics|지표|이벤트|계측)\s*[:：=-]/i.test(line)
      && !/[`{}]/.test(line)
      && !/(schema|enum|function|const|import|export|README\.md|docs\/)/i.test(line)
    )
  ).slice(0, 6);
}

function extractAlternatives(text) {
  const source = String(text || "");
  const out = [];
  for (const value of extractLabeledList(source, /(current alternatives?|alternatives?|현재\s*대안|대안)\s*[:：=-]\s*([^\n]+)/i)) {
    out.push(value);
  }
  if (/slack|email|gmail|zendesk|thread|메일|이메일/i.test(source)) out.push("Slack/메일 thread 수동 확인");
  if (/spreadsheet|notion|airtable|excel|스프레드시트|노션|엑셀/i.test(source)) out.push("스프레드시트/문서로 수동 관리");
  return uniqueStrings(out).slice(0, 4);
}

function inferStage(evidence, h) {
  const explicit = cleanToken(h.stage);
  if (explicit && explicit !== "unknown") return explicit;
  const text = allEvidenceCandidates(evidence).map((item) => `${item.value} ${item.quote}`).join("\n").toLowerCase();
  if (/post[_\s-]?revenue|paying customer|paid user|매출 발생|유료 고객/.test(text)) return "post_revenue";
  if (/revenue|paid|payment|billing|stripe|매출|결제|유료|가격/.test(text)) return "pre_revenue";
  if (/users|customer|interview|feedback|사용자|고객|인터뷰|피드백|파일럿/.test(text)) return "first_users";
  if (evidence.refs.length > 0) return "prototype";
  return "unknown";
}

function stageLabel(stage) {
  return STAGE_LABELS[stage] || STAGE_LABELS.unknown;
}

function buildProject(evidence, h) {
  const name = bestCandidate(evidence, ["product"])?.value || userFacingName(h);
  const customer = bestCandidate(evidence, ["customer"])?.value || "고객 근거 확인 필요";
  const problem = bestCandidate(evidence, ["problem"])?.value || "문제 근거 확인 필요";
  const purpose = bestCandidate(evidence, ["purpose"])?.value;
  const kindLabel = KIND_LABELS[h.projectKind] || "프로젝트";
  const hasSpecificIdentity = name !== "이 프로젝트" || purpose || bestCandidate(evidence, ["customer"]) || bestCandidate(evidence, ["problem"]);
  const oneLine = !hasSpecificIdentity
    ? "고객·문제 근거가 아직 없어 Day 1 기준선부터 채워야 합니다."
    : purpose
    ? cleanText(sentence(`${name}: ${stripProductNamePrefix(purpose, name)}`), 160)
    : sentence(`${name}: ${kindLabel}`);
  const refs = evidenceRefsFromCandidates([
    bestCandidate(evidence, ["product"]),
    bestCandidate(evidence, ["customer"]),
    bestCandidate(evidence, ["problem"]),
    bestCandidate(evidence, ["purpose"]),
  ].filter(Boolean));
  return { name, oneLine, customer, problem, evidenceRefs: refs };
}

function stripProductNamePrefix(text, name) {
  const value = cleanText(text, 160);
  const rawProduct = cleanText(name, 80);
  const aliases = uniqueStrings([
    rawProduct,
    rawProduct.split(/\s+/)[0],
  ]).filter((alias) => alias.length >= 3);
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = value.replace(new RegExp(`^${escaped}\\s*(?:은\\(는\\)|은|는|is|:|-)?\\s*`, "i"), "").trim();
    if (stripped && stripped !== value) return stripped;
  }
  return value;
}

function missingSignalFor(evidence, h) {
  if (!bestCandidate(evidence, ["customer"]) || !bestCandidate(evidence, ["problem"])) return "고객·문제 근거";
  if (!hasOutcomeSignal(evidence)) return "확인할 행동";
  if (!hasCustomerTouchpoint(evidence)) return "고객에게 닿는 경로";
  if (candidatesOf(evidence, "metric").length === 0 && candidatesOf(evidence, "event").length === 0 && candidatesOf(evidence, "analytics").length === 0) return "측정 기준";
  if (evidence.drift?.driftScore > 0) return "문서 최신성";
  if (!h.goal && candidatesOf(evidence, "goal").length === 0) return "30일 목표";
  return "오늘 실행 행동";
}

function hasCustomerTouchpoint(evidence) {
  return candidatesOf(evidence, "channel").length > 0 || candidatesOf(evidence, "workflow").length > 0;
}

function hasOutcomeSignal(evidence) {
  return Boolean(bestCandidate(evidence, ["outcome", "customer_action", "conversion", "event"]));
}

function buildQualityGate(evidence, h) {
  const hasCustomer = Boolean(bestCandidate(evidence, ["customer"]));
  const hasProblem = Boolean(bestCandidate(evidence, ["problem"]));
  const hasGoal = Boolean(bestCandidate(evidence, ["goal"]));
  const hasOutcome = hasOutcomeSignal(evidence);
  const hasPath = hasCustomerTouchpoint(evidence);
  const hasMetric = candidatesOf(evidence, "metric").length + candidatesOf(evidence, "event").length > 0;
  const refCount = evidence.refs.length;
  let score = 0;
  if (hasCustomer) score += 1.8;
  if (hasProblem) score += 1.8;
  if (hasGoal) score += 1.5;
  if (hasOutcome) score += 1.5;
  if (hasPath) score += 1.0;
  if (hasMetric) score += 0.8;
  score += Math.min(1.6, refCount * 0.3);
  if (h.confidence === "high") score += 0.4;
  else if (h.confidence === "medium") score += 0.2;
  if (!hasCustomer || !hasProblem) score = Math.min(score, 6.4);
  else if (!hasOutcome) score = Math.min(score, 6.8);
  else if (!hasPath) score = Math.min(score, 7.4);
  else if (!hasMetric) score = Math.min(score, 8.2);
  score = Number(Math.max(0, Math.min(10, score)).toFixed(1));
  const reasons = [];
  if (hasCustomer && hasProblem) reasons.push("고객과 문제가 근거에서 확인됨");
  if (hasGoal) reasons.push("목표/비교 기준 후보가 있음");
  if (hasOutcome) reasons.push("관찰할 행동 신호 후보가 있음");
  if (hasPath) reasons.push("채널/워크플로 흔적이 있음");
  if (hasMetric) reasons.push("숫자/이벤트/측정 기준 후보가 있음");
  if (reasons.length === 0) reasons.push("근거가 부족해 최소 진단만 표시");
  if (!hasCustomer || !hasProblem) reasons.push("고객·문제 근거가 부족함");
  if (!hasOutcome) reasons.push("확인할 행동 근거가 부족함");
  return { score, passed: score >= 7, reasons: uniqueStrings(reasons).slice(0, 5) };
}

function buildDiagnosis(evidence, h, qualityGate) {
  const stage = inferStage(evidence, h);
  const missingSignal = missingSignalFor(evidence, h);
  let bottleneck;
  let whyNow;
  if (!bestCandidate(evidence, ["customer"]) || !bestCandidate(evidence, ["problem"])) {
    bottleneck = "고객·문제 근거가 부족함";
    whyNow = "Day 1은 제품 설명보다 먼저 누구의 어떤 비용을 검증할지 고정해야 합니다.";
  } else if (!hasOutcomeSignal(evidence)) {
    bottleneck = "검증 행동이 비어 있음";
    whyNow = "고객과 문제 후보는 있지만 실제 행동으로 확인할 기준이 아직 약합니다.";
  } else if (!hasCustomerTouchpoint(evidence)) {
    bottleneck = "고객 접점이 비어 있음";
    whyNow = "검증할 대상은 보이지만 어디서 접촉하고 반복할지 근거가 없습니다.";
  } else if (candidatesOf(evidence, "metric").length === 0 && candidatesOf(evidence, "event").length === 0 && candidatesOf(evidence, "analytics").length === 0) {
    bottleneck = "성공 기준이 비어 있음";
    whyNow = "실행 후 무엇이 달라졌는지 비교할 숫자나 이벤트가 필요합니다.";
  } else if (evidence.drift?.driftScore > 0) {
    bottleneck = "문서와 최근 작업이 어긋남";
    whyNow = "낡은 설명을 기준으로 Day 1 판단을 하면 다음 행동이 흔들립니다.";
  } else {
    const verification = dominantVerificationLabel(evidence);
    const touchpoint = bestCandidate(evidence, ["channel", "workflow"]);
    const metric = bestCandidate(evidence, ["metric", "event", "conversion"]);
    bottleneck = `${verification} 검증에 집중`;
    whyNow = touchpoint || metric
      ? `${humanList([displaySignalLabel(touchpoint), displaySignalLabel(metric)].filter(Boolean))} 신호가 있으니 오늘 남길 증거를 하나로 줄입니다.`
      : "고객 행동 신호가 있으니 오늘 남길 증거를 하나로 줄입니다.";
  }
  if (!qualityGate.passed) {
    bottleneck = `근거 부족: ${missingSignal}`;
    whyNow = "충분히 뒷받침되지 않은 채널·툴·액션을 만들지 않고 먼저 기준선을 채웁니다.";
  }
  return {
    stage: stageLabel(stage),
    bottleneck,
    whyNow,
    missingSignal,
    confidence: Number((qualityGate.score / 10).toFixed(2)),
    evidenceRefs: evidence.refs.slice(0, EVIDENCE_REF_MAX),
  };
}

function displaySignalLabel(item) {
  if (!item?.value) return "";
  if (item.kind === "event") return compactEventLabel(item.value, "");
  return cleanText(item.value, 24);
}

function dominantVerificationLabel(evidence) {
  const candidate = bestCandidate(evidence, ["conversion", "outcome", "customer_action", "event", "metric"]);
  if (!candidate?.value) return "오늘 행동";
  if (candidate.kind === "conversion" || /(첫\s*매출|매출|유료|결제|구매|payment|revenue|paid)/i.test(candidate.value)) return "유료 신호";
  if (/파일럿|pilot/i.test(candidate.value)) return "파일럿";
  if (/고객\s*인터뷰|인터뷰|interview|conversation|대화/i.test(candidate.value)) return "고객 인터뷰";
  if (candidate.kind === "event") return compactEventLabel(candidate.value, "");
  return cleanText(candidate.value, 16);
}

function buildRealityGap(evidence, h) {
  const drift = evidence.drift;
  if (!drift?.driftScore) return null;
  const missing = (drift.missingFromReadme || [])
    .filter((item) => isUsefulDriftTerm(item?.term) && isDay1DecisionDriftText(item?.term));
  const stale = (drift.staleInReadme || [])
    .filter((item) => isReadableDriftClaim(item?.claim) && isDay1DecisionDriftText(item?.claim));
  if (!missing.length && !stale.length) return null;
  const docClaim = stale[0]?.claim || bestCandidate(evidence, ["purpose", "goal"])?.value || h.purpose || h.goal || "README/문서의 기존 설명";
  const observedReality = missing.length
    ? `최근 작업은 ${humanList(missing.map((item) => item.term).slice(0, 3))} 쪽으로 움직였지만 문서 반영은 약합니다.`
    : "최근 작업 기록에서 이 고객·매출 판단을 뒷받침하는 흔적이 약합니다.";
  if (!observedReality) return null;
  return {
    docClaim: cleanText(docClaim, 130),
    observedReality: cleanText(observedReality, 120),
    recommendation: "고객·매출 판단에 영향을 주는 차이만 맞춘 뒤 Day 1 기준으로 쓰세요.",
    evidenceRefs: uniqueStrings(["README.md", "git/agent recent work", ...evidence.refs]).slice(0, EVIDENCE_REF_MAX),
  };
}

function isDay1DecisionDriftText(text) {
  const value = cleanText(text, 180);
  if (!value) return false;
  return /(고객|사용자|전업|개발자|문제|pain|인터뷰|대화|파일럿|채널|접점|유입|매출|유료|결제|구매|가격|전환|리텐션|가입|활성|customer|user|persona|problem|interview|pilot|channel|acquisition|revenue|paid|payment|pricing|conversion|retention|signup|activation)/i.test(value);
}

function isUsefulDriftTerm(term) {
  const value = cleanToken(term);
  if (!value || value.length < 4) return false;
  if (GENERIC_DRIFT_TERMS.has(value)) return false;
  return !/^\d+$/.test(value);
}

function isReadableDriftClaim(claim) {
  const value = cleanText(claim, 160);
  if (value.length < 18) return false;
  if (/[`{}]|npm\s+run|failed checks|doctor/i.test(value)) return false;
  return true;
}

function humanList(values = []) {
  return uniqueStrings(values).slice(0, 3).join(", ");
}

function buildBaseline(evidence, diagnosis, h = {}) {
  const goal = selectBaselineTarget(evidence, h);
  const target = goal || "30일 목표 근거 확인 필요";
  const targetMetrics = extractBaselineMetricsFromTarget(target);
  const candidateMetrics = [
    ...candidatesOf(evidence, "metric").filter(isGoalScopedCandidate).map((item) => item.value),
    ...candidatesOf(evidence, "event").filter(isGoalScopedCandidate).map((item) => item.value),
    ...candidatesOf(evidence, "conversion").filter(isGoalScopedCandidate).map((item) => item.value),
  ].filter(isBaselineMetricValue);
  const metrics = uniqueStrings(targetMetrics.length ? targetMetrics : candidateMetrics).slice(0, 6);
  const day30Question = metrics.length
    ? `30일 뒤 ${metrics.slice(0, 3).join(", ")} 확인됐나요?`
    : `30일 뒤 ${missingSignalEvidenceLabel(diagnosis.missingSignal)}가 채워졌나요?`;
  return {
    target: cleanText(target, 140),
    current: `${diagnosis.stage}: ${diagnosis.bottleneck}`,
    day30Question: cleanText(day30Question, 140),
    metrics,
  };
}

function missingSignalEvidenceLabel(signal) {
  const value = cleanText(signal, 60) || "핵심 근거";
  return /근거$/.test(value) ? value : `${value} 근거`;
}

function extractBaselineMetricsFromTarget(target) {
  return uniqueStrings([
    ...extractMetricPhrases(target),
    /(첫\s*매출|first\s+revenue)/i.test(target) ? "첫 매출" : "",
    /(첫\s*유료|first\s+paid)/i.test(target) ? "첫 유료 신호" : "",
  ].filter(Boolean));
}

function isGoalScopedCandidate(item) {
  const ref = `${item?.sourceRef || ""} ${(item?.evidenceRefs || []).join(" ")}`;
  return /(GOAL|goal|agent signal|onboarding hypothesis)/i.test(ref);
}

function selectBaselineTarget(evidence, h = {}) {
  const explicitGoal = cleanText(h.goal, 140);
  if (explicitGoal) return explicitGoal;
  const candidates = [
    ...candidatesOf(evidence, "goal"),
    ...candidatesOf(evidence, "outcome"),
  ];
  if (h.goal) {
    candidates.push(candidate({
      kind: "goal",
      value: h.goal,
      sourceRef: { path: Array.isArray(h.evidence) && h.evidence.length ? h.evidence[0] : "onboarding hypothesis", reason: "goal" },
      score: 8,
    }));
  }
  const ranked = candidates
    .filter((item) => item?.value)
    .map((item) => {
      const metricStrength = extractMetricPhrases(item.value).length
        + (/(첫\s*매출|매출|revenue|유료|결제|구매|payment)/i.test(item.value) ? 1 : 0);
      const lengthPenalty = Math.max(0, item.value.length - 70) / 25;
      return { item, rank: item.score + metricStrength * 2 - lengthPenalty };
    })
    .sort((a, b) => b.rank - a.rank || a.item.value.length - b.item.value.length);
  return ranked[0]?.item?.value || "";
}

function buildPath(evidence, qualityGate) {
  if (!qualityGate.passed) return [];
  const touchpointCandidates = [
    ...candidatesOf(evidence, "channel"),
    ...candidatesOf(evidence, "workflow"),
  ].filter((item) => !item.evidenceLimited);
  if (!touchpointCandidates.length) return [];
  const supportCandidates = [
    ...candidatesOf(evidence, "analytics"),
    ...candidatesOf(evidence, "event"),
    ...candidatesOf(evidence, "metric"),
  ].filter((item) => !item.evidenceLimited && isPathSupportSignal(item));
  const pathCandidates = [
    ...dedupeVisibleCandidates(touchpointCandidates),
    ...dedupeVisibleCandidates(supportCandidates),
  ];
  return dedupePreservingOrder(pathCandidates)
    .slice(0, 6)
    .map((item) => ({
      label: pathLabelForCandidate(item),
      kind: item.kind,
      status: "found",
      why: pathWhyForCandidate(item),
      evidenceRefs: item.evidenceRefs.slice(0, EVIDENCE_REF_MAX),
    }));
}

function pathLabelForCandidate(item) {
  if (item?.kind === "event") return compactEventLabel(item.value, "");
  return cleanText(item?.value, 28);
}

function pathWhyForCandidate(item) {
  const label = pathLabelForCandidate(item);
  if (item?.kind === "channel") return `${label}에서 고객 반응을 확인할 수 있습니다.`;
  if (item?.kind === "workflow") return `${label}에서 고객의 현재 흐름이 확인됩니다.`;
  if (item?.kind === "analytics") return `${label}에서 검증 결과를 볼 수 있습니다.`;
  if (item?.kind === "event") return `${label} 신호를 측정 기준으로 쓸 수 있습니다.`;
  if (item?.kind === "metric") return `${objectForm(label)} 30일 비교 기준으로 쓸 수 있습니다.`;
  return `${label} 신호가 확인됩니다.`;
}

function dedupePreservingOrder(candidates = []) {
  const out = [];
  for (const item of candidates) {
    const value = cleanText(item?.value, 80);
    if (!value) continue;
    const key = value.toLowerCase();
    const isCovered = out.some((existing) => {
      const existingKey = existing.value.toLowerCase();
      return existingKey === key || (existingKey.length > key.length && existingKey.includes(key));
    });
    if (!isCovered) out.push(item);
  }
  return out;
}

function dedupeVisibleCandidates(candidates = []) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || b.value.length - a.value.length || a.value.localeCompare(b.value));
  const out = [];
  for (const item of sorted) {
    const value = cleanText(item?.value, 80);
    if (!value) continue;
    const key = value.toLowerCase();
    const isCovered = out.some((existing) => {
      const existingKey = existing.value.toLowerCase();
      return existingKey === key || (existingKey.length > key.length && existingKey.includes(key));
    });
    if (!isCovered) out.push(item);
  }
  return out;
}

function isPathSupportSignal(item) {
  if (!item?.value) return false;
  if (item.kind === "metric" && !isBaselineMetricValue(item.value) && !/\butm\b|utm_/i.test(item.value)) return false;
  return /(market evidence|agent signal|GOAL|ICP|SPEC|README|docs\/|marketing|landing|campaign|channel)/i.test(item.sourceRef || item.evidenceRefs?.join(" ") || "");
}

function shortActionLabel(value, suffix = "") {
  const base = cleanText(value, 18);
  if (!base) return suffix || "근거 확인";
  if (!suffix) return base;
  const label = `${base} ${suffix}`.trim();
  return cleanText(label, 18);
}

function compactEventLabel(value, suffix = "측정") {
  const raw = cleanText(value, 80);
  if (!raw) return suffix;
  if (!/^[a-z][a-z0-9_]*$/i.test(raw)) return shortActionLabel(raw, suffix);
  const verbLabels = {
    created: "생성",
    completed: "완료",
    submitted: "제출",
    applied: "적용",
    converted: "전환",
    paid: "결제",
    signup: "가입",
    purchased: "구매",
    sent: "발송",
  };
  const tokens = raw.split("_").filter(Boolean);
  const last = tokens[tokens.length - 1];
  const verb = verbLabels[last] || suffix;
  const subject = tokens.slice(0, verbLabels[last] ? -1 : tokens.length).slice(-2).join(" ");
  return cleanText(`${subject || raw} ${verb}`.trim(), 18);
}

function metricActionLabel(value) {
  if (/(첫\s*매출|매출|유료|결제|구매|payment|revenue|paid|purchase)/i.test(value)) return "유료 신호 확인";
  return shortActionLabel(value, "비교");
}

function actionLabelForCandidate(item, kind, suffix = "") {
  const value = item?.value || "";
  if (/고객\s*인터뷰|인터뷰|interview|conversation|대화/i.test(value)) return "고객 인터뷰";
  if (/파일럿|pilot/i.test(value)) return "파일럿 확인";
  if (/첫\s*매출|매출|유료|결제|구매|payment|revenue|paid/i.test(value)) return "유료 신호 확인";
  if (kind === "event") return compactEventLabel(value, "측정");
  if (kind === "metric") return metricActionLabel(value);
  if (kind === "analytics") return shortActionLabel(value, "점검");
  if (kind === "alternative") return "현재 대안 확인";
  return shortActionLabel(value, suffix);
}

function actionRationaleForCandidate(item, label) {
  const value = cleanText(item?.value, 100);
  switch (item?.kind) {
    case "conversion":
      return `${value || label} 기준을 오늘 성공 신호로 인정할 조건까지 정합니다.`;
    case "event":
      return `${compactEventLabel(value, "측정")} 신호가 실제 고객 행동으로 찍히는지 확인합니다.`;
    case "metric":
      return `${value || label}의 시작값과 30일 뒤 비교 위치를 정합니다.`;
    case "channel":
      return `${value || label}에서 만난 고객 반응을 오늘 기록합니다.`;
    case "workflow":
      return `${value || label}에서 고객의 현재 흐름을 확인합니다.`;
    case "alternative":
      return `${objectForm(value || "현재 대안")} 고객이 왜 쓰는지 한 문장으로 기록합니다.`;
    case "analytics":
      return `${value || label}에서 오늘 행동을 확인할 위치를 정합니다.`;
    case "customer_action":
      if (/고객\s*인터뷰|인터뷰|interview|conversation|대화/i.test(value)) {
        return "고객 1명과 대화해 문제 반복 여부를 한 문장으로 남깁니다.";
      }
      return `${label}이 실제 고객 행동으로 남는지 확인합니다.`;
    case "outcome":
      return `${objectForm(value || label)} 오늘 확인할 완료 기준으로 좁힙니다.`;
    default:
      return `${label}의 완료 근거를 오늘 한 줄로 남깁니다.`;
  }
}

function segmentLabel(value) {
  const raw = cleanText(value, 120).replace(/\([^)]*\)/g, "").trim();
  const withoutLabel = raw
    .replace(/^(target\s*user|target\s*customer|customer|persona|primary\s*persona|icp|대상\s*고객|타깃\s*고객|고객)\s*(?:[:：=\-]|는|은)?\s*/i, "")
    .trim();
  const toolUser = withoutLabel.match(/(?:쓰는|사용하는|운영하는|다루는)\s+([^,.;\n]+)$/u);
  if (toolUser?.[1]) {
    return cleanText(toolUser[1].replace(/\s*(?:에게|에게는|가|은|는|을|를|에서|에게서)\s*$/u, "").trim(), 18) || "고객";
  }
  const firstClause = withoutLabel
    .split(/\s*(?:이며|이고|이고요|이고,|이다\.|입니다\.|이며,|,|;|\/|\||\n)\s*/)[0]
    .replace(/\s*(?:에게|에게는|가|은|는|을|를|에서|에게서)\s*$/u, "")
    .trim();
  return cleanText(firstClause || withoutLabel || raw, 18) || "고객";
}

function contextualAction({ id, label, rationale, kind, promptSeed, evidenceRefs, evidenceLimited = false }) {
  const refs = actionEvidenceRefs(evidenceRefs || []);
  return {
    id,
    label: cleanText(label, 22),
    rationale: cleanText(rationale, 100),
    kind,
    promptSeed: cleanText(promptSeed, 140),
    evidenceRefs: refs,
    evidenceLimited,
  };
}

function actionEvidenceRefs(refs = []) {
  return uniqueStrings(refs)
    .filter((ref) => !/\.(?:swift|ts|tsx|js|mjs|jsx|py)\b/i.test(ref) && !/\(source\)/i.test(ref))
    .slice(0, EVIDENCE_REF_MAX);
}

function buildMissingPathActions(evidence, diagnosis) {
  const customer = bestCandidate(evidence, ["customer"]);
  const problem = bestCandidate(evidence, ["problem"]);
  const goal = bestCandidate(evidence, ["goal", "outcome"]);
  const conversion = bestCandidate(evidence, ["conversion"]);
  const event = bestCandidate(evidence, ["event"]);
  const metric = bestCandidate(evidence, ["metric"]);
  const customerName = segmentLabel(customer?.value || "");
  const sharedRefs = evidenceRefsFromCandidates([customer, problem, goal].filter(Boolean));
  const actions = [
    contextualAction({
      id: "customer_touchpoint",
      label: `${customerName} 접점`,
      rationale: `${customerName}를 만날 실제 장소 1곳을 정하고 접촉 기록을 남깁니다.`,
      kind: "channel_gap",
      promptSeed: `${customerName}를 오늘 어디서 만날 수 있고, 그 근거는 무엇인가요?`,
      evidenceRefs: sharedRefs,
    }),
  ];
  const conversionValue = `${conversion?.value || ""} ${goal?.value || ""}`;
  if (/파일럿|pilot/i.test(conversionValue)) {
    actions.push(contextualAction({
      id: "pilot_candidate",
      label: "파일럿 후보 1명",
      rationale: "파일럿 목표가 있으니 오늘 대화 가능한 후보 1명을 특정합니다.",
      kind: "conversion",
      promptSeed: "오늘 파일럿 후보 1명을 특정했다는 근거는 무엇인가요?",
      evidenceRefs: evidenceRefsFromCandidates([conversion, goal].filter(Boolean)),
    }));
  }
  if (/첫\s*매출|매출|유료|결제|구매|payment|revenue|paid/i.test(conversionValue)) {
    actions.push(contextualAction({
      id: "paid_signal_standard",
      label: "유료 신호 기준",
      rationale: "첫 매출 목표를 판단할 고객 행동 1개와 기록 위치를 정합니다.",
      kind: "conversion",
      promptSeed: "오늘 유료 신호로 인정할 고객 행동 1개와 기록 위치는 무엇인가요?",
      evidenceRefs: evidenceRefsFromCandidates([conversion, goal].filter(Boolean)),
    }));
  }
  if (actions.length < 3 && event) {
    const eventLabel = compactEventLabel(event.value, "측정");
    actions.push(contextualAction({
      id: "event_measurement",
      label: eventLabel,
      rationale: `${eventLabel} 신호가 실제 고객 행동인지 기록 위치를 정합니다.`,
      kind: "event",
      promptSeed: `오늘 ${event.value}을 어떤 근거로 기록할까요?`,
      evidenceRefs: evidenceRefsFromCandidates([event, goal].filter(Boolean)),
    }));
  } else if (actions.length < 3 && metric) {
    actions.push(contextualAction({
      id: "metric_baseline",
      label: metricActionLabel(metric.value),
      rationale: `${metric.value}를 30일 비교 기준으로 기록합니다.`,
      kind: "metric",
      promptSeed: `오늘 ${metric.value}의 시작 기준은 무엇인가요?`,
      evidenceRefs: evidenceRefsFromCandidates([metric, goal].filter(Boolean)),
    }));
  }
  const customerAction = bestCandidate(evidence, ["customer_action"]);
  if (actions.length < 3 && customerAction) {
    const actionLabel = actionLabelForCandidate(customerAction, "customer_action");
    actions.push(contextualAction({
      id: "customer_behavior",
      label: actionLabel,
      rationale: actionLabel === "고객 인터뷰"
        ? `${customerName} 1명과 대화해 문제 반복 여부를 남깁니다.`
        : "접점을 늘리기 전에 실제 고객 행동 근거를 좁힙니다.",
      kind: "customer_action",
      promptSeed: "오늘 확인할 고객 행동 근거는 무엇인가요?",
      evidenceRefs: evidenceRefsFromCandidates([customerAction, customer].filter(Boolean)),
    }));
  }
  return uniqueBy(actions.filter((action) => action.evidenceRefs.length > 0), (action) => action.id).slice(0, 3);
}

function isUserVisibleActionCandidate(item) {
  const value = cleanText(item?.value, 140);
  if (!value) return false;
  if (/^#{1,6}\s/.test(value) || /^[-*]\s/.test(value) || /[`{}]|\*\*/.test(value)) return false;
  if (value.length > 90 && !/(인터뷰|대화|파일럿|결제|구매|가입|전환|매출|pilot|interview|conversation|payment|revenue|signup)/i.test(value)) return false;
  return true;
}

function actionFromCandidate(item, { label, kind, rationale, promptSeed }) {
  return {
    id: cleanToken(`${kind}_${label}_${item.value}`) || `action_${kind}`,
    label: cleanText(label, 22),
    rationale: cleanText(rationale || item.quote || `${item.value} 근거를 오늘 검증합니다.`, 100),
    kind,
    promptSeed: cleanText(promptSeed || item.value, 140),
    evidenceRefs: item.evidenceRefs.slice(0, EVIDENCE_REF_MAX),
    evidenceLimited: Boolean(item.evidenceLimited),
  };
}

function buildActions(evidence, diagnosis, qualityGate) {
  if (!qualityGate.passed) {
    const missingEvidence = missingSignalEvidenceLabel(diagnosis.missingSignal);
    return [{
      id: "fill_missing_signal",
      label: "근거 채우기",
      rationale: `${missingEvidence}를 뒷받침할 한 줄 증거부터 고정합니다.`,
      kind: "evidence_gap",
      promptSeed: `${missingEvidence}를 어디에서 확인할 수 있나요?`,
      evidenceRefs: diagnosis.evidenceRefs,
      evidenceLimited: true,
    }];
  }
  const hasTouchpoint = hasCustomerTouchpoint(evidence);
  if (!hasTouchpoint && diagnosis.missingSignal === "고객에게 닿는 경로") {
    const missingPathActions = buildMissingPathActions(evidence, diagnosis);
    if (missingPathActions.length) return missingPathActions;
  }
  const ranked = [
    ...candidatesOf(evidence, "outcome").map((item) => ({ item, label: actionLabelForCandidate(item, "outcome"), kind: "outcome", suffix: "" })),
    ...candidatesOf(evidence, "customer_action").map((item) => ({ item, label: actionLabelForCandidate(item, "customer_action"), kind: "customer_action", suffix: "" })),
    ...candidatesOf(evidence, "conversion").map((item) => ({ item, label: actionLabelForCandidate(item, "conversion", "확인"), kind: "conversion", suffix: "확인" })),
    ...candidatesOf(evidence, "event").map((item) => ({ item, label: actionLabelForCandidate(item, "event", "측정"), kind: "event", suffix: "측정" })),
    ...candidatesOf(evidence, "channel").map((item) => ({ item, label: shortActionLabel(item.value, "검증"), kind: "channel", suffix: "검증" })),
    ...(hasTouchpoint ? candidatesOf(evidence, "metric").map((item) => ({ item, label: actionLabelForCandidate(item, "metric", "비교"), kind: "metric", suffix: "비교" })) : []),
    ...candidatesOf(evidence, "workflow").map((item) => ({ item, label: shortActionLabel(item.value, "확인"), kind: "workflow", suffix: "확인" })),
    ...candidatesOf(evidence, "alternative").map((item) => ({ item, label: actionLabelForCandidate(item, "alternative"), kind: "alternative", suffix: "" })),
    ...(hasTouchpoint ? candidatesOf(evidence, "analytics").map((item) => ({ item, label: actionLabelForCandidate(item, "analytics", "점검"), kind: "analytics", suffix: "점검" })) : []),
  ]
    .filter(({ item }) => item && !item.evidenceLimited && isUserVisibleActionCandidate(item))
    .sort((a, b) => {
      const priority = (ACTION_KIND_PRIORITY.get(a.kind) ?? 99) - (ACTION_KIND_PRIORITY.get(b.kind) ?? 99);
      return priority || b.item.score - a.item.score || a.label.localeCompare(b.label);
    });

  return selectVisibleActionEntries(ranked)
    .map(({ item, label, kind }) => actionFromCandidate(item, {
      label,
      kind,
      rationale: actionRationaleForCandidate(item, label),
      promptSeed: `오늘 ${label}의 완료 근거는 무엇인가요?`,
    }));
}

function selectVisibleActionEntries(entries = []) {
  const out = [];
  const seenLabels = new Set();
  const seenKinds = new Set();
  for (const entry of entries) {
    const label = cleanText(entry?.label, 40);
    if (!label) continue;
    const key = label.toLowerCase().replace(/[0-9]+(?:\.\d+)?/g, "#").replace(/\s+/g, " ");
    if (seenLabels.has(key)) continue;
    const isNearDuplicate = out.some((existing) => labelsOverlap(existing.label, label));
    if (isNearDuplicate) continue;
    if (out.length >= 2 && ["workflow", "analytics", "alternative"].includes(entry.kind)) continue;
    if (["metric", "channel", "analytics", "alternative", "workflow"].includes(entry.kind) && seenKinds.has(entry.kind)) continue;
    out.push(entry);
    seenLabels.add(key);
    seenKinds.add(entry.kind);
    if (out.length >= 3) break;
  }
  return out;
}

function labelsOverlap(a, b) {
  const left = cleanText(a, 50).toLowerCase();
  const right = cleanText(b, 50).toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 5 && longer.includes(shorter);
}

function buildTrust(evidence) {
  const sourcesUsed = uniqueStrings([
    "onboarding hypothesis",
    evidence.refs.some((ref) => /README|ICP|SPEC|GOAL|VALUES|source|docs\//i.test(ref)) ? "docs/source" : "",
    evidence.refs.some((ref) => /customer|interview|research|고객|인터뷰/i.test(ref)) ? "customer evidence" : "",
    evidence.refs.some((ref) => /market|marketing|channel|agent signal|git|recent/i.test(ref)) ? "market/recent evidence" : "",
  ]).filter(Boolean);
  return {
    readOnly: true,
    secretsExcluded: true,
    sourcesUsed: sourcesUsed.length ? sourcesUsed : ["onboarding hypothesis"],
  };
}

export function generateDay1SituationSummary({
  onboardingHypothesis = {},
  agentHistory = null,
  recentCommitSubjects = [],
  driftFindings = null,
  evidenceBuckets = null,
  situationEvidence = null,
  agentSituationSignals = [],
  localDiscovery = null,
  now = new Date(),
} = {}) {
  const evidence = situationEvidence || createSituationEvidence({
    onboardingHypothesis,
    agentHistory,
    recentCommitSubjects,
    driftFindings,
    evidenceBuckets: normalizeEvidenceBuckets(evidenceBuckets),
    agentSituationSignals,
    localDiscovery,
  });
  const qualityGate = buildQualityGate(evidence, onboardingHypothesis || {});
  const project = buildProject(evidence, onboardingHypothesis || {});
  const diagnosis = buildDiagnosis(evidence, onboardingHypothesis || {}, qualityGate);
  const realityGap = buildRealityGap(evidence, onboardingHypothesis || {});
  const baseline = buildBaseline(evidence, diagnosis, onboardingHypothesis || {});
  const pathNodes = buildPath(evidence, qualityGate);
  const actions = buildActions(evidence, diagnosis, qualityGate);
  const trust = buildTrust(evidence);
  const summary = {
    schemaVersion: DAY1_SITUATION_SUMMARY_SCHEMA_VERSION,
    source: agentSituationSignals?.length ? "agent_refined" : "local_evidence",
    generatedAt: now.toISOString(),
    project,
    diagnosis,
    realityGap,
    baseline,
    path: pathNodes,
    actions,
    qualityGate,
    trust,
  };
  const parsed = Day1SituationSummarySchema.safeParse(summary);
  return parsed.success ? parsed.data : summary;
}

export async function buildDay1SituationSummary({
  workspaceRoot,
  scanResult = {},
  onboardingHypothesis = {},
  agentHistory = null,
  agentSituationSignals = [],
  localDiscovery = null,
  now = new Date(),
  fsImpl = fs,
  gitSubjectsImpl = readRecentGitSubjects,
} = {}) {
  const readme = await readReadme(workspaceRoot, fsImpl);
  const recentCommitSubjects = workspaceRoot
    ? await gitSubjectsImpl(workspaceRoot).catch(() => [])
    : [];
  const workspaceEvidence = workspaceRoot
    ? await extractWorkspaceEvidence(workspaceRoot, { scanPaths: scanResult, includeSource: true, fsImpl }).catch(() => null)
    : null;
  const evidenceBuckets = await collectEvidenceBuckets({
    workspaceRoot,
    fsImpl,
    workspaceEvidence,
  }).catch(() => normalizeEvidenceBuckets({ workspaceEvidence }));
  const agentIntents = (agentHistory?.recentIntents || []).map((item) => item.text);
  const filesTouched = agentHistory?.filesTouched || [];
  const driftFindings = detectReadmeDrift({ readme, recentCommitSubjects, agentIntents, filesTouched });
  const situationEvidence = createSituationEvidence({
    onboardingHypothesis,
    agentHistory,
    recentCommitSubjects,
    driftFindings,
    evidenceBuckets,
    agentSituationSignals,
    localDiscovery,
  });
  return generateDay1SituationSummary({
    onboardingHypothesis,
    agentHistory,
    recentCommitSubjects,
    driftFindings,
    evidenceBuckets,
    situationEvidence,
    agentSituationSignals,
    localDiscovery,
    now,
  });
}

async function readReadme(workspaceRoot, fsImpl) {
  if (!workspaceRoot) return "";
  for (const name of ["README.md", "readme.md", "Readme.md", "README"]) {
    try {
      const content = await fsImpl.readFile(path.join(workspaceRoot, name), "utf8");
      return redactSecrets(content.slice(0, README_MAX_CHARS));
    } catch {
      /* try next */
    }
  }
  return "";
}

function readRecentGitSubjects(root, { sinceDays = 30, limit = 60, timeoutMs = 2_000 } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(
        "git",
        ["-C", root, "log", `--since=${sinceDays}.days`, "--pretty=%s", "-n", String(limit)],
        { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      resolve(splitLines(out));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 16_000) { try { child.kill("SIGKILL"); } catch { /* noop */ } }
    });
    child.on("error", () => { clearTimeout(timer); resolve([]); });
    child.on("close", () => { clearTimeout(timer); resolve(splitLines(out)); });
  });
}

function splitLines(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 60);
}

async function collectEvidenceBuckets({
  workspaceRoot,
  fsImpl = fs,
  workspaceEvidence = null,
} = {}) {
  if (!workspaceRoot) return normalizeEvidenceBuckets({ workspaceEvidence });
  const root = path.resolve(workspaceRoot);
  const files = await discoverEvidenceFiles({ root, fsImpl });
  const customerEvidence = emptyBucket();
  const marketEvidence = emptyBucket();

  for (const relativePath of files) {
    if (!EVIDENCE_DOC_EXT_RE.test(relativePath)) continue;
    const isCustomer = CUSTOMER_PATH_RE.test(relativePath);
    const isMarket = MARKET_PATH_RE.test(relativePath);
    if (!isCustomer && !isMarket) continue;
    const content = await readEvidenceFile({ root, relativePath, fsImpl });
    if (!content) continue;
    const snippet = extractSnippet(content);
    if (isCustomer) {
      customerEvidence.paths.push(relativePath);
      customerEvidence.snippets.push(snippet);
    }
    if (isMarket) {
      marketEvidence.paths.push(relativePath);
      marketEvidence.snippets.push(snippet);
    }
  }

  return normalizeEvidenceBuckets({
    workspaceEvidence,
    customerEvidence,
    marketEvidence,
  });
}

async function discoverEvidenceFiles({ root, fsImpl }) {
  const files = [];
  const queue = [{ absolute: root, relative: "", depth: 0 }];
  let visited = 0;
  while (queue.length && visited < DISCOVERY_MAX_ENTRIES) {
    const current = queue.shift();
    visited += 1;
    let entries = [];
    try {
      entries = await fsImpl.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const relativePath = current.relative ? path.posix.join(current.relative, entry.name) : entry.name;
      if (isSecretPath(relativePath) || isNoisePath(relativePath)) continue;
      const absolute = path.join(root, relativePath);
      if (entry.isDirectory()) {
        if (current.depth < DISCOVERY_MAX_DEPTH) {
          queue.push({ absolute, relative: relativePath, depth: current.depth + 1 });
        }
      } else if (entry.isFile() && TEXT_EXT_RE.test(entry.name)) {
        files.push(relativePath);
      }
    }
  }
  return files;
}

async function readEvidenceFile({ root, relativePath, fsImpl }) {
  try {
    const content = await fsImpl.readFile(path.join(root, relativePath), "utf8");
    return redactSecrets(content.slice(0, EVIDENCE_FILE_MAX_CHARS));
  } catch {
    return "";
  }
}

function extractSnippet(content) {
  return splitLines(content)
    .filter((line) => !line.startsWith("<!--"))
    .slice(0, 12)
    .join(" ");
}

function emptyBucket() {
  return {
    paths: [],
    snippets: [],
  };
}

function normalizeEvidenceBuckets(value = {}) {
  const workspaceEvidence = value?.workspaceEvidence || null;
  const customerEvidence = {
    ...emptyBucket(),
    ...(value?.customerEvidence || {}),
  };
  const marketEvidence = {
    ...emptyBucket(),
    ...(value?.marketEvidence || value?.gtmEvidence || {}),
  };
  customerEvidence.paths = uniqueStrings(customerEvidence.paths || []).slice(0, 12);
  customerEvidence.snippets = uniqueStrings(customerEvidence.snippets || []).slice(0, 10);
  marketEvidence.paths = uniqueStrings(marketEvidence.paths || []).slice(0, 12);
  marketEvidence.snippets = uniqueStrings(marketEvidence.snippets || []).slice(0, 10);
  return { workspaceEvidence, customerEvidence, marketEvidence };
}

function uniqueBy(values = [], keyFn = (value) => value) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export async function composeDay1SituationSummary({
  deterministic,
  queryImpl = null,
  parseImpl = null,
} = {}) {
  if (typeof queryImpl !== "function" || typeof parseImpl !== "function") {
    return { ...deterministic, source: deterministic.source || "local_evidence" };
  }
  try {
    const refined = await parseImpl(await queryImpl(deterministic));
    const validated = Day1SituationSummarySchema.safeParse(refined);
    if (validated.success) {
      return { ...validated.data, source: "agent_refined" };
    }
  } catch {
    /* fall through */
  }
  return { ...deterministic, source: deterministic.source || "local_evidence" };
}
