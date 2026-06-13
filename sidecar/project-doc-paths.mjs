import path from "node:path";

export const PROJECT_DOCS_DIR = path.posix.join(".agentic30", "docs");

const DEFINITIONS = Object.freeze([
  doc({
    type: "icp",
    title: "Ideal Customer Profile",
    filename: "ICP.md",
    focus: "ideal customer profile, anti-ICP, current alternatives, buying trigger, validation signals",
  }),
  doc({
    type: "goal",
    title: "GOAL",
    filename: "GOAL.md",
    focus: "mission, measurable objectives, key results, weekly milestones, operating cadence",
  }),
  doc({
    type: "values",
    title: "VALUES",
    filename: "VALUES.md",
    focus: "decision principles, tradeoff rules, what the project refuses to do, behavioral examples",
  }),
  doc({
    type: "spec",
    title: "SPEC",
    filename: "SPEC.md",
    focus: "problem definition, core value, MVP scope, user journey, constraints, success metrics, UX, risks, tradeoffs",
  }),
  doc({
    type: "designSystem",
    title: "Design System",
    filename: "DESIGN_SYSTEM.md",
    focus: "visual principles, tokens, components, interaction patterns, accessibility, UI tradeoffs",
  }),
  doc({
    type: "adr",
    title: "ADR",
    filename: "ADR.md",
    focus: "decision record format, current architecture choices, rejected alternatives, consequences",
  }),
  doc({
    type: "docs",
    title: "Docs",
    filename: "DOCS.md",
    focus: "documentation map, canonical sources of truth, onboarding path, maintenance rules",
  }),
  doc({
    type: "sheet",
    title: "Sheet",
    filename: "SHEET.md",
    focus: "Google Sheet schema, BIP posting log columns, evidence recording workflow, quality checks",
  }),
]);

export const PROJECT_DOCS = DEFINITIONS;
export const PROJECT_DOC_TYPES = Object.freeze(DEFINITIONS.map((entry) => entry.type));
export const FOUNDATION_PROJECT_DOC_TYPES = Object.freeze(["icp", "goal", "values", "spec"]);

const BY_TYPE = new Map(DEFINITIONS.map((entry) => [entry.type, entry]));

function doc({ type, title, filename, focus = "" }) {
  const canonicalPath = path.posix.join(PROJECT_DOCS_DIR, filename);
  return Object.freeze({
    type,
    title,
    filename,
    canonicalPath,
    aliases: Object.freeze([canonicalPath]),
    focus,
  });
}

export function projectDocByType(type) {
  return BY_TYPE.get(String(type || "")) || null;
}

export function projectDocPath(type) {
  return projectDocByType(type)?.canonicalPath || "";
}

export function projectDocDefinitions(types = PROJECT_DOC_TYPES) {
  return Object.freeze(
    types
      .map((type) => projectDocByType(type))
      .filter(Boolean)
      .map((entry) => Object.freeze({ ...entry })),
  );
}

export function projectDocCandidatePaths(type) {
  const docDef = projectDocByType(type);
  return uniqueStrings(docDef ? [docDef.canonicalPath] : []);
}

export function normalizeRelativeDocPath(value = "") {
  const text = String(value || "").trim().replace(/\\/g, "/");
  if (!text || text.includes("\0") || path.posix.isAbsolute(text)) return "";
  return text.replace(/^\.\//, "");
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = normalizeRelativeDocPath(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
