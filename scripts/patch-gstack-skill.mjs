/**
 * Pure SKILL.md transformer used at vendor sync time.
 *
 * Strips gstack runtime affordances we don't want inside the Mac app
 * (telemetry, GBrain sync, interactive consent prompts) and rewrites the
 * preamble so every conditional in the skill body takes the silent
 * "spawned session" path. Codex variant additionally swaps
 * AskUserQuestion -> agentic30_request_user_input.
 */

import { CODEX_STRUCTURED_INPUT_TOOL } from "../sidecar/structured-input-tools.mjs";

const HEADER_COMMENT_PATTERN = /^<!-- AUTO-GENERATED [^\n]*\n(?:<!-- Regenerate[^\n]*\n)?/;

const STRIP_SECTIONS = [
  "## Preamble (run first)",
  "## Plan Mode Safe Operations",
  "## Skill Invocation During Plan Mode",
  "## AskUserQuestion Format",
  "## GBrain Sync (skill start)",
  "## GBrain Sync",
  "## Model-Specific Behavioral Patch (claude)",
  "## Model-Specific Behavioral Patch",
  "## Voice",
  "## Context Recovery",
  "## Writing Style",
  "## Operational Self-Improvement",
  "## Telemetry (run last)",
  "## Telemetry",
];

const FORBIDDEN_PATTERNS = [
  /gstack-brain-sync/,
  /gstack-telemetry-log/,
  /gstack-update-check/,
  /## GBrain Sync/,
  /## Privacy stop-gate/,
  /## Telemetry/,
];

const LEAN_PREAMBLE = `## Preamble (run first)

\`\`\`bash
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
echo "REPO_MODE: project"
echo "PROACTIVE: false"
echo "PROACTIVE_PROMPTED: yes"
echo "TELEMETRY: off"
echo "TEL_PROMPTED: yes"
echo "BRAIN_SYNC: off"
echo "LAKE_INTRO: yes"
echo "WRITING_STYLE_PENDING: no"
echo "EXPLAIN_LEVEL: default"
echo "HAS_ROUTING: yes"
echo "ROUTING_DECLINED: false"
echo "VENDORED_GSTACK: yes"
echo "MODEL_OVERLAY: \${MODEL_OVERLAY:-claude}"
echo "CHECKPOINT_MODE: explicit"
echo "CHECKPOINT_PUSH: false"
echo "LEARNINGS: 0"
echo "SPAWNED_SESSION: true"
\`\`\`
`;

export function patchSkill(originalMarkdown, { provider = "claude", vendorVersion = "" } = {}) {
  if (typeof originalMarkdown !== "string" || originalMarkdown.length === 0) {
    throw new Error("patchSkill requires a non-empty markdown string");
  }
  if (provider !== "claude" && provider !== "codex") {
    throw new Error(`patchSkill: unknown provider ${provider}`);
  }

  const { frontmatter, body } = splitFrontmatter(originalMarkdown);
  let nextBody = body.replace(HEADER_COMMENT_PATTERN, "");
  nextBody = stripSections(nextBody, STRIP_SECTIONS);
  nextBody = `${LEAN_PREAMBLE}\n${nextBody.trimStart()}`;

  let workingFrontmatter = frontmatter;
  if (provider === "codex") {
    nextBody = applyCodexToolRename(nextBody);
    workingFrontmatter = applyCodexToolRename(workingFrontmatter);
  }

  const nextFrontmatter = augmentFrontmatter(workingFrontmatter, { provider, vendorVersion });

  const result = `${nextFrontmatter}\n${nextBody.trimEnd()}\n`;
  assertNoForbiddenPatterns(result, provider);
  if (result.length < 1024) {
    throw new Error(`patched SKILL too small (${result.length} bytes) — likely over-stripped`);
  }
  return result;
}

export function applyCodexToolRename(text) {
  return String(text || "")
    .replace(/\bAskUserQuestionTool\b/g, CODEX_STRUCTURED_INPUT_TOOL)
    .replace(/\bAskUserQuestion\b/g, CODEX_STRUCTURED_INPUT_TOOL);
}

export function splitFrontmatter(markdown) {
  if (!markdown.startsWith("---")) {
    return { frontmatter: "", body: markdown };
  }
  const closingIndex = markdown.indexOf("\n---", 3);
  if (closingIndex === -1) {
    return { frontmatter: "", body: markdown };
  }
  const endOfFrontmatter = markdown.indexOf("\n", closingIndex + 4);
  const frontmatter = markdown.slice(0, endOfFrontmatter === -1 ? markdown.length : endOfFrontmatter);
  const body = endOfFrontmatter === -1 ? "" : markdown.slice(endOfFrontmatter + 1);
  return { frontmatter, body };
}

export function stripSections(body, sectionHeadings) {
  let nextBody = body;
  for (const heading of sectionHeadings) {
    nextBody = stripOneSection(nextBody, heading);
  }
  return nextBody;
}

function stripOneSection(body, heading) {
  const escaped = escapeRegExp(heading);
  const startRe = new RegExp(`(^|\\n)${escaped}[^\\n]*\\n`);
  const startMatch = startRe.exec(body);
  if (!startMatch) return body;
  const startIndex = startMatch.index + (startMatch[1] === "" ? 0 : 1);
  const afterHeadingIndex = startIndex + (startMatch[0].length - (startMatch[1] === "" ? 0 : 1));
  const nextHeadingRe = /\n## [^\n]+\n/g;
  nextHeadingRe.lastIndex = afterHeadingIndex;
  const nextMatch = nextHeadingRe.exec(body);
  const endIndex = nextMatch ? nextMatch.index + 1 : body.length;
  return `${body.slice(0, startIndex)}${body.slice(endIndex)}`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function augmentFrontmatter(frontmatter, { provider, vendorVersion }) {
  if (!frontmatter || !frontmatter.startsWith("---")) {
    return [
      "---",
      `agentic30-vendor-version: ${vendorVersion || "unknown"}`,
      `agentic30-vendor-provider: ${provider}`,
      "---",
    ].join("\n");
  }
  const lines = frontmatter.split("\n");
  const closingIndex = lines.lastIndexOf("---");
  if (closingIndex === -1) return frontmatter;
  const inner = lines.slice(1, closingIndex);
  const filtered = stripWebSearchTool(inner);
  const enriched = [
    ...filtered,
    `agentic30-vendor-version: ${vendorVersion || "unknown"}`,
    `agentic30-vendor-provider: ${provider}`,
  ];
  return ["---", ...enriched, "---"].join("\n");
}

function stripWebSearchTool(lines) {
  const result = [];
  let inAllowedTools = false;
  for (const line of lines) {
    if (/^allowed-tools:\s*$/.test(line)) {
      inAllowedTools = true;
      result.push(line);
      continue;
    }
    if (inAllowedTools) {
      if (/^\s+-\s+/.test(line)) {
        if (/-\s+WebSearch\b/.test(line)) continue;
        result.push(line);
        continue;
      }
      inAllowedTools = false;
    }
    result.push(line);
  }
  return result;
}

function assertNoForbiddenPatterns(markdown, provider) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(markdown)) {
      throw new Error(`patched SKILL still contains forbidden pattern ${pattern}`);
    }
  }
  if (provider === "codex" && /\bAskUserQuestion\b/.test(markdown)) {
    throw new Error("Codex variant must not contain AskUserQuestion after substitution");
  }
}
