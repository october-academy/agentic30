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
  "## Skill routing",
  "## AskUserQuestion Format",
  "## Artifacts Sync (skill start)",
  "## Artifacts Sync",
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
  /gstack-artifacts-init/,
  /ARTIFACTS_SYNC/,
  /## GBrain Sync/,
  /Privacy stop-gate/,
  /## Telemetry/,
  /## Skill routing/,
  /Then commit the change/,
  /git rm -r \.claude\/skills\/gstack/,
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
  const startIndex = findSectionHeadingIndex(body, heading);
  if (startIndex === -1) return body;
  const afterHeadingIndex = lineEndIndex(body, startIndex);
  const nextHeadingIndex = findNextSecondLevelHeadingIndex(body, afterHeadingIndex);
  const endIndex = nextHeadingIndex === -1 ? body.length : nextHeadingIndex;
  return `${body.slice(0, startIndex)}${body.slice(endIndex)}`;
}

function findSectionHeadingIndex(markdown, heading, fromIndex = 0) {
  return findLineIndexOutsideFences(markdown, fromIndex, (line) =>
    isSectionHeadingLine(line, heading),
  );
}

function findNextSecondLevelHeadingIndex(markdown, fromIndex = 0) {
  return findLineIndexOutsideFences(markdown, fromIndex, (line) =>
    /^## [^\n]/.test(line),
  );
}

function findLineIndexOutsideFences(markdown, fromIndex, predicate) {
  let inFence = false;
  let fenceMarker = "";
  let offset = 0;

  while (offset < markdown.length) {
    const nextNewline = markdown.indexOf("\n", offset);
    const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
    const line = markdown.slice(offset, lineEnd);
    const fence = fenceLineMarker(line);

    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence;
      } else if (fence === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
    } else if (!inFence && offset >= fromIndex && predicate(line)) {
      return offset;
    }

    if (nextNewline === -1) break;
    offset = lineEnd + 1;
  }

  return -1;
}

function isSectionHeadingLine(line, heading) {
  if (!line.startsWith(heading)) return false;
  const rest = line.slice(heading.length);
  return rest === "" || /^[\s(#]/.test(rest);
}

function fenceLineMarker(line) {
  const match = line.trimStart().match(/^(```+|~~~+)/);
  return match ? match[1][0] : "";
}

function lineEndIndex(text, lineStart) {
  const newlineIndex = text.indexOf("\n", lineStart);
  return newlineIndex === -1 ? text.length : newlineIndex + 1;
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
