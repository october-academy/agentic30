// Deterministic README ↔ reality drift detector.
//
// The Day-1 interview insight: users rarely keep README.md current, so advice
// anchored on it drifts from the real project. This compares the README's
// vocabulary against *recent reality* — git commit subjects, agent intents
// (~/.claude / ~/.codex), and touched files — and surfaces two honest signals:
//
//   missingFromReadme : topics the user is actively working on that the README
//                       never mentions  → "README is behind the code"
//   staleInReadme     : prominent README topics with no recent footprint
//                       anywhere        → "README may describe removed/idle work"
//
// Pure + deterministic (no embeddings, no LLM): same inputs → same findings.
// Phase 5 may hand these findings to an LLM to phrase a concrete update, but the
// detection itself is testable in isolation.

const STOPWORDS = new Set([
  // en
  "the", "and", "for", "with", "this", "that", "from", "you", "your", "are", "was",
  "but", "not", "all", "can", "has", "have", "will", "use", "using", "used", "via",
  "app", "apps", "new", "add", "added", "fix", "fixed", "update", "updated", "set",
  "run", "runs", "get", "gets", "now", "out", "into", "per", "see", "how", "why",
  // conventional-commit prefixes / generic dev verbs (noise as "topics")
  "feat", "chore", "refactor", "refactored", "perf", "wip", "bump", "merge", "ci",
  "lint", "build", "release", "init", "setup", "wire", "wired", "tweak", "flow",
  "what", "when", "who", "それ", "code", "file", "files", "based", "make", "made",
  // ko (frequent non-topical)
  "그리고", "하지만", "그러나", "또는", "위해", "통해", "관련", "기반", "사용", "추가",
  "수정", "변경", "업데이트", "구현", "작업", "기능", "프로젝트", "지원", "처리", "적용",
  "이것", "저것", "그것", "오늘", "이번", "다음", "현재",
]);

/// Tokenize into significant latin (>=3) and hangul (>=2) terms, lowercased.
export function tokenize(text) {
  const out = [];
  const re = /[a-z][a-z0-9]{2,}|[가-힣]{2,}/g;
  let m;
  const lower = String(text || "").toLowerCase();
  while ((m = re.exec(lower)) !== null) {
    const term = m[0];
    if (!STOPWORDS.has(term)) out.push(term);
  }
  return out;
}

/// Split a file path into meaningful identifier terms (basename minus ext,
/// camelCase / kebab / snake segments + directory names).
export function fileTerms(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  const segments = norm.split("/").filter(Boolean);
  const base = segments.pop() || "";
  const stem = base.replace(/\.[^.]+$/, "");
  const parts = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9가-힣]+/)
    .filter(Boolean);
  return [...segments, ...parts]
    .map((t) => t.toLowerCase())
    .filter((t) => (/[가-힣]/.test(t) ? t.length >= 2 : t.length >= 3) && !STOPWORDS.has(t));
}

function countInto(map, terms) {
  for (const term of terms) map.set(term, (map.get(term) || 0) + 1);
}

/// Lines that look like README feature claims: headings and bullet items.
function readmeClaimLines(readme) {
  return String(readme || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^#{1,4}\s+\S/.test(l) || /^[-*]\s+\S/.test(l))
    .map((l) => l.replace(/^#{1,4}\s+/, "").replace(/^[-*]\s+/, "").trim());
}

export function detectReadmeDrift({
  readme = "",
  recentCommitSubjects = [],
  agentIntents = [],
  filesTouched = [],
  maxFindings = 5,
} = {}) {
  const hasReadme = Boolean(String(readme || "").trim());
  const readmeTerms = new Set(tokenize(readme));

  // Activity term frequencies, plus a representative evidence string per term.
  const activityCounts = new Map();
  const evidenceFor = new Map();
  const noteActivity = (text, source) => {
    const terms = new Set(tokenize(text));
    for (const term of terms) {
      activityCounts.set(term, (activityCounts.get(term) || 0) + 1);
      if (!evidenceFor.has(term)) evidenceFor.set(term, { text: String(text).slice(0, 120), source });
    }
  };
  for (const subject of recentCommitSubjects) noteActivity(subject, "commit");
  for (const intent of agentIntents) noteActivity(intent, "agent");

  const fileTermCounts = new Map();
  for (const entry of filesTouched) {
    const file = typeof entry === "string" ? entry : entry?.file;
    if (!file) continue;
    countInto(fileTermCounts, new Set(fileTerms(file)));
  }

  // (a) missing from README: prominent recent topics the README never mentions.
  const missingFromReadme = [];
  const rankedActivity = [...activityCounts.entries()]
    .map(([term, count]) => ({ term, count: count + (fileTermCounts.get(term) || 0) }))
    .filter((x) => x.count >= 2 && !readmeTerms.has(x.term))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  for (const { term, count } of rankedActivity) {
    if (missingFromReadme.length >= maxFindings) break;
    missingFromReadme.push({
      term,
      count,
      evidence: evidenceFor.get(term)?.text || `touched in ${fileTermCounts.get(term) || 0} files`,
      source: evidenceFor.get(term)?.source || "files",
    });
  }

  // (b) stale in README: claim-line topics absent from all recent activity.
  const activityTermSet = new Set([...activityCounts.keys(), ...fileTermCounts.keys()]);
  const staleInReadme = [];
  if (hasReadme) {
    const seenClaim = new Set();
    for (const line of readmeClaimLines(readme)) {
      const terms = tokenize(line).filter((t) => !activityTermSet.has(t));
      // a claim is "stale" only if NONE of its salient terms show recent footprint
      const salient = tokenize(line);
      if (salient.length >= 2 && terms.length === salient.length) {
        const key = line.toLowerCase();
        if (seenClaim.has(key)) continue;
        seenClaim.add(key);
        staleInReadme.push({ claim: line.slice(0, 120), terms: salient.slice(0, 4) });
        if (staleInReadme.length >= Math.max(2, Math.floor(maxFindings / 2))) break;
      }
    }
  }

  const driftScore = missingFromReadme.length * 2 + staleInReadme.length;
  return {
    hasReadme,
    driftScore,
    missingFromReadme,
    staleInReadme,
    suggestion: buildSuggestion({ hasReadme, missingFromReadme, staleInReadme }),
  };
}

function buildSuggestion({ hasReadme, missingFromReadme, staleInReadme }) {
  if (!hasReadme) return "README.md가 없어요. 최근 작업 기준으로 한 줄 소개 + 핵심 기능부터 시작해 보세요.";
  const parts = [];
  if (missingFromReadme.length) {
    parts.push(`README에 없는 최근 작업: ${missingFromReadme.map((f) => f.term).slice(0, 4).join(", ")}`);
  }
  if (staleInReadme.length) {
    parts.push(`최근 흔적이 없는 README 항목: ${staleInReadme.map((f) => f.claim).slice(0, 2).join(" / ")}`);
  }
  return parts.length ? parts.join(" · ") : "README가 최근 작업과 대체로 일치해요.";
}
