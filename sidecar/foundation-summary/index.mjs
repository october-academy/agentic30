/**
 * Foundation-summary sub-workflow — entry point + Agent SDK `query()` scaffold.
 *
 * This module is the Sub-AC 1 scaffold for the Day 7 "foundation-summary"
 * sub-workflow. It owns:
 *   1. Directory entry (re-export surface for the rest of the sidecar).
 *   2. The Agent SDK `query()` invocation skeleton with READ-ONLY tools.
 *   3. The `allowedTools` allowlist (Read / Glob / Grep + AskUserQuestion).
 *   4. A `canUseTool` callback that fail-closed denies any non-allowlisted
 *      tool — enforcing the Day 7 "agent reads, user writes" contract.
 *
 * Subsequent sub-ACs will:
 *   - Wire `runFoundationSummary()` into `runUnifiedFoundationChat()` in
 *     foundation-chat.mjs (Sub-AC 2+).
 *   - Fill in the SPEC v3 / go-no-go.md / foundation-summary.md content
 *     contracts and inline-decision plumbing.
 *   - Add evidence_refs cross-check + monetization-yes counting.
 *   - Add Codex provider parity (Codex CLI does not expose Read/Glob/Grep
 *     by default — Sub-AC handles MCP tool surfacing through mcp-server.mjs).
 *
 * The scaffold is intentionally minimal so subsequent ACs compose without
 * having to refactor the entry signature.
 */

import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  buildFoundationSummaryInitialPrompt,
  buildFoundationSummarySystemPrompt,
  FOUNDATION_SUMMARY_PERSONA,
} from "./prompt.mjs";
import {
  collectFoundationEvidence,
  buildFoundationSummaryDraftV1,
  formatEvidenceContextBlock,
} from "./evidence-collector.mjs";

/**
 * Tools the Day 7 summary agent is allowed to call.
 *
 * - Read / Glob / Grep — workspace introspection (built-ins from the
 *   `claude_code` system-prompt preset). These let the agent walk
 *   `workspace/.agentic30/foundation/` artifacts and existing SPEC.md
 *   versions without any write capability.
 * - AskUserQuestion — inline decision surface for the unified chat channel
 *   (matches the rest of the Foundation phase contract).
 *
 * Anything else is denied by `buildFoundationSummaryCanUseTool()`.
 */
export const FOUNDATION_SUMMARY_ALLOWED_TOOLS = Object.freeze([
  "Read",
  "Glob",
  "Grep",
  "AskUserQuestion",
]);

/**
 * Tools the Day 7 summary agent must never invoke. The list is also enforced
 * by the canUseTool callback (fail-closed). It is exported so tests can pin
 * the contract.
 */
export const FOUNDATION_SUMMARY_DENIED_TOOLS = Object.freeze([
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Task",
  "WebFetch",
  "WebSearch",
]);

/**
 * Build the canUseTool callback that enforces the read-only contract.
 *
 * The Agent SDK calls this for every tool invocation. We:
 *   - Allow tools in FOUNDATION_SUMMARY_ALLOWED_TOOLS verbatim.
 *   - Deny any tool in FOUNDATION_SUMMARY_DENIED_TOOLS with an explicit
 *     human-readable reason (the SDK surfaces this back to the model).
 *   - Default-deny anything else so a future SDK update that adds new
 *     mutating tools (e.g. a new shell variant) cannot accidentally bypass
 *     the Day 7 contract.
 *
 * @param {object} [hooks]
 * @param {(event: object) => void} [hooks.onToolDecision] - Optional probe
 *   used by foundation-chat.mjs / tests to observe allow/deny events.
 */
export function buildFoundationSummaryCanUseTool(hooks = {}) {
  const onToolDecision = typeof hooks.onToolDecision === "function" ? hooks.onToolDecision : null;
  const allowed = new Set(FOUNDATION_SUMMARY_ALLOWED_TOOLS);
  const denied = new Set(FOUNDATION_SUMMARY_DENIED_TOOLS);

  return async function foundationSummaryCanUseTool(toolName, input /* , context */) {
    const name = String(toolName || "");
    if (allowed.has(name)) {
      onToolDecision?.({ phase: "allow", toolName: name });
      return { behavior: "allow", updatedInput: input };
    }
    const reason = denied.has(name)
      ? `Foundation Day 7 summary는 read-only야. ${name}는 사용 금지.`
      : `Foundation Day 7 summary 도구 화이트리스트 외 도구 (${name}) 거부.`;
    onToolDecision?.({ phase: "deny", toolName: name, reason });
    return { behavior: "deny", message: reason };
  };
}

/**
 * Run the Day 7 foundation-summary sub-workflow against the Claude Agent SDK.
 *
 * This is the SDK-level entry point. The host (foundation-chat.mjs) is
 * expected to call this as part of `runUnifiedFoundationChat()` when the
 * resolved Foundation context's `sub_workflow === "foundation-summary"`,
 * NOT as a direct WS endpoint — the unified chat surface remains a single
 * channel from the user's perspective.
 *
 * The function returns the async iterator produced by Agent SDK `query()`
 * so the caller can stream events into the existing emit pipeline.
 *
 * @param {object} args
 * @param {string} args.prompt - The user-facing prompt body. Should already
 *   include any composed Foundation context if the caller wants it visible
 *   to the user-message turn. Otherwise pass just the user message and let
 *   the system prompt do the framing.
 * @param {string} args.workspaceRoot - Absolute workspace root.
 * @param {object} [args.foundationContext] - Resolved Foundation context.
 *   `day` should equal 7.
 * @param {string} [args.model] - Optional Claude model override.
 * @param {string} [args.cliPath] - Path to the bundled `cli.js` from
 *   `@anthropic-ai/claude-agent-sdk`. The host already resolves this; we
 *   accept it as an arg to avoid duplicating the resolver logic.
 * @param {AbortController} [args.abortController] - Cancellation signal.
 * @param {object} [args.env] - Sanitized child env (host applies the same
 *   ANTHROPIC_API_KEY / OAuth precedence rules used by provider-runner.mjs).
 * @param {string} [args.bipManifest] - Optional workspace manifest text.
 * @param {(event: object) => void} [args.onToolDecision] - Optional probe
 *   for tool allow/deny events.
 * @returns {AsyncIterable<object>} The Agent SDK event stream.
 */
export async function runFoundationSummary({
  prompt = "",
  workspaceRoot = "",
  foundationContext = null,
  model = "",
  cliPath = "",
  abortController,
  env,
  bipManifest = "",
  onToolDecision,
  precollectedEvidence = null,
  collectEvidence = collectFoundationEvidence,
} = {}) {
  if (foundationContext && foundationContext.day !== 7 && foundationContext.day !== null) {
    throw new Error(
      `foundation-summary sub-workflow expects Foundation day=7, got ${foundationContext.day}.`,
    );
  }

  // Sub-AC 2: pre-collect Day 0-7 evidence so the agent prompt embeds a
  // deterministic draft.v1 instead of starting from a blank workspace.
  // Callers may inject `precollectedEvidence` (tests / cached host data)
  // OR override `collectEvidence` for full mock control.
  let evidence = precollectedEvidence;
  if (!evidence && workspaceRoot) {
    try {
      evidence = await collectEvidence({ workspaceRoot });
    } catch {
      evidence = null; // fail-open: agent still has Read/Glob/Grep at runtime
    }
  }
  const evidenceBlock = evidence ? formatEvidenceContextBlock(evidence) : "";
  const draft = evidence ? buildFoundationSummaryDraftV1(evidence) : null;

  const baseSystemPromptText = buildFoundationSummarySystemPrompt({
    workspaceRoot,
    foundationContext,
    bipManifest,
  });
  const systemPromptText = evidenceBlock
    ? `${baseSystemPromptText}\n\n${evidenceBlock}`
    : baseSystemPromptText;
  const initialPrompt = prompt || buildFoundationSummaryInitialPrompt({
    foundationContext,
    userMessage: "",
    draftV1Text: draft?.text || "",
  });

  const options = {
    model: model || undefined,
    cwd: workspaceRoot ? path.resolve(workspaceRoot) : undefined,
    env,
    abortController,
    maxTurns: 16,
    includePartialMessages: true,
    // Read-only by design. The host already runs this lane in the sidecar's
    // foundation_unified executionMode, so no Apply/Run gating is needed
    // here — the canUseTool callback below is the second line of defense.
    allowedTools: [...FOUNDATION_SUMMARY_ALLOWED_TOOLS],
    canUseTool: buildFoundationSummaryCanUseTool({ onToolDecision }),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPromptText,
    },
    toolConfig: {
      askUserQuestion: { previewFormat: "markdown" },
    },
  };
  if (cliPath) {
    options.pathToClaudeCodeExecutable = cliPath;
    options.executable = process.execPath;
  }

  return query({ prompt: initialPrompt, options });
}

export { FOUNDATION_SUMMARY_PERSONA };
export {
  buildFoundationSummarySystemPrompt,
  buildFoundationSummaryInitialPrompt,
} from "./prompt.mjs";
export {
  collectFoundationEvidence,
  buildFoundationSummaryDraftV1,
  formatEvidenceContextBlock,
} from "./evidence-collector.mjs";
export {
  ALLOWED_EVIDENCE_REF_TYPES,
  REQUIRED_EVIDENCE_REF_FIELDS,
  RULE_CHECK_THRESHOLDS,
  checkThreeSectionMinimal,
  checkEvidenceRefsRequired,
  checkKR41Rating,
  checkKR42CrossCheck,
  runFoundationSummaryRuleCheck,
} from "./rule-check.mjs";
export {
  FOUNDATION_REVIEW_LOOP_DEFAULTS,
  FOUNDATION_REVIEW_LOOP_STATUSES,
  buildRegenerationFeedback,
  fingerprintIssues,
  runFoundationSummaryReviewLoop,
} from "./review-loop.mjs";
export {
  DRAFT_V2_SCHEMA_VERSION,
  FOUNDATION_DRAFT_V2_FILES,
  parseDraftV2Sections,
  writeFoundationSummaryDraftV2,
} from "./draft-writer.mjs";
