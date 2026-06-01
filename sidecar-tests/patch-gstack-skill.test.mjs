import test from "node:test";
import assert from "node:assert/strict";
import {
  patchSkill,
  splitFrontmatter,
  stripSections,
  augmentFrontmatter,
  applyCodexToolRename,
} from "../scripts/patch-gstack-skill.mjs";

const MIN_SKILL = `---
name: office-hours
preamble-tier: 3
version: 2.0.0
description: |
  YC Office Hours skill for testing.
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - WebSearch
triggers:
  - office hours
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

## Preamble (run first)

\`\`\`bash
~/.claude/skills/gstack/bin/gstack-update-check 2>/dev/null
~/.claude/skills/gstack/bin/gstack-telemetry-log --skill office-hours
\`\`\`

## Plan Mode Safe Operations

Some plan mode notes that should be stripped.

## Skill Invocation During Plan Mode

If user invokes a skill in plan mode...

## Skill routing

Use AskUserQuestion to handle routing.

## AskUserQuestion Format

Format reference for AskUserQuestion calls — strip me.

## GBrain Sync (skill start)

\`\`\`bash
~/.claude/skills/gstack/bin/gstack-brain-sync --once
\`\`\`

## Artifacts Sync (skill start)

\`\`\`bash
echo "ARTIFACTS_SYNC: off"
~/.claude/skills/gstack/bin/gstack-brain-sync --once
~/.claude/skills/gstack/bin/gstack-artifacts-init
\`\`\`

Privacy stop-gate: ask once.

## Phase 1: Context Gathering

Real workflow content. Call AskUserQuestion to ask the user about their idea.
Use AskUserQuestionTool when in plan mode. Pad pad pad pad pad pad pad pad pad
pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad
pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad
pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad.

## Phase 2: Forcing Questions

Demand reality, status quo, narrowest wedge — keep this section.
Lots of body text so we exceed 1KB. Pad pad pad pad pad pad pad pad pad pad pad
pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad
pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad
pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad.

## Voice

Voice section to strip.

## Telemetry (run last)

\`\`\`bash
~/.claude/skills/gstack/bin/gstack-telemetry-log --skill office-hours --duration 30
\`\`\`
`;

test("Claude variant: strips preamble + telemetry, preserves AskUserQuestion in body", () => {
  const result = patchSkill(MIN_SKILL, { provider: "claude", vendorVersion: "abcdef123456" });

  assert.match(result, /## Phase 1: Context Gathering/);
  assert.match(result, /## Phase 2: Forcing Questions/);
  assert.match(result, /Demand reality, status quo, narrowest wedge/);
  assert.match(result, /SPAWNED_SESSION: true/);
  assert.match(result, /AskUserQuestion/);

  assert.doesNotMatch(result, /## GBrain Sync/);
  assert.doesNotMatch(result, /## Artifacts Sync/);
  assert.doesNotMatch(result, /gstack-brain-sync/);
  assert.doesNotMatch(result, /gstack-artifacts-init/);
  assert.doesNotMatch(result, /ARTIFACTS_SYNC/);
  assert.doesNotMatch(result, /Privacy stop-gate/);
  assert.doesNotMatch(result, /gstack-telemetry-log/);
  assert.doesNotMatch(result, /gstack-update-check/);
  assert.doesNotMatch(result, /## Telemetry/);
  assert.doesNotMatch(result, /## AskUserQuestion Format/);
  assert.doesNotMatch(result, /## Voice/);
  assert.doesNotMatch(result, /AUTO-GENERATED from SKILL\.md\.tmpl/);

  assert.match(result, /agentic30-vendor-version: abcdef123456/);
  assert.match(result, /agentic30-vendor-provider: claude/);
});

test("Codex variant: substitutes AskUserQuestion -> agentic30_request_user_input in body and frontmatter", () => {
  const result = patchSkill(MIN_SKILL, { provider: "codex", vendorVersion: "abcdef123456" });

  assert.doesNotMatch(result, /\bAskUserQuestion\b/);
  assert.doesNotMatch(result, /\bAskUserQuestionTool\b/);
  assert.match(result, /agentic30_request_user_input/);
  assert.match(result, /agentic30-vendor-provider: codex/);
});

test("Both variants strip WebSearch from allowed-tools and add vendor metadata", () => {
  const claude = patchSkill(MIN_SKILL, { provider: "claude", vendorVersion: "v1" });
  const codex = patchSkill(MIN_SKILL, { provider: "codex", vendorVersion: "v1" });
  for (const out of [claude, codex]) {
    assert.doesNotMatch(out, /-\s+WebSearch\b/);
    assert.match(out, /agentic30-vendor-version: v1/);
  }
});

test("patchSkill rejects unknown provider", () => {
  assert.throws(
    () => patchSkill(MIN_SKILL, { provider: "gemini" }),
    /unknown provider gemini/,
  );
});

test("patchSkill throws on empty input", () => {
  assert.throws(() => patchSkill("", { provider: "claude" }), /non-empty markdown/);
});

test("patchSkill throws if patched skill becomes too small (over-stripped)", () => {
  const tiny = `---\nname: test\n---\n## Preamble (run first)\n\`\`\`bash\necho hi\n\`\`\`\n## Telemetry\n\`\`\`bash\necho bye\n\`\`\`\n`;
  assert.throws(() => patchSkill(tiny, { provider: "claude" }), /too small/);
});

test("splitFrontmatter handles missing frontmatter gracefully", () => {
  const { frontmatter, body } = splitFrontmatter("# just a body\n");
  assert.equal(frontmatter, "");
  assert.match(body, /just a body/);
});

test("stripSections is a no-op when heading is absent", () => {
  const input = "## Real\nbody\n## Other\nmore\n";
  const out = stripSections(input, ["## Missing"]);
  assert.equal(out, input);
});

test("stripSections ignores headings inside fenced code while finding section end", () => {
  const input = [
    "## Skill Invocation During Plan Mode",
    "If A: Append this section to the end of CLAUDE.md:",
    "```markdown",
    "",
    "## Skill routing",
    "",
    "When the user's request matches an available skill, invoke it.",
    "```",
    "Then commit the change: `git add CLAUDE.md && git commit -m \"chore\"`",
    "",
    "## Phase 1: Context Gathering",
    "Real workflow content.",
    "",
  ].join("\n");
  const out = stripSections(input, ["## Skill Invocation During Plan Mode"]);

  assert.doesNotMatch(out, /## Skill routing/);
  assert.doesNotMatch(out, /Then commit the change/);
  assert.match(out, /## Phase 1: Context Gathering/);
  assert.match(out, /Real workflow content/);
});

test("augmentFrontmatter inserts vendor keys without disturbing existing ones", () => {
  const fm = `---\nname: x\nallowed-tools:\n  - Bash\n  - WebSearch\n---`;
  const out = augmentFrontmatter(fm, { provider: "claude", vendorVersion: "v9" });
  assert.match(out, /agentic30-vendor-version: v9/);
  assert.match(out, /agentic30-vendor-provider: claude/);
  assert.doesNotMatch(out, /-\s+WebSearch\b/);
  assert.match(out, /-\s+Bash\b/);
});

test("applyCodexToolRename leaves unrelated tokens alone", () => {
  const text = "Call AskUserQuestion. Also AskUserQuestionTool. But NotAskUserQuestionThing stays.";
  const out = applyCodexToolRename(text);
  assert.match(out, /Call agentic30_request_user_input\./);
  assert.match(out, /Also agentic30_request_user_input\./);
  assert.match(out, /NotAskUserQuestionThing stays/);
});
