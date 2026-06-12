import { spawn } from "node:child_process";

import { extractGoogleDocPlainText } from "./bip-coach-state.mjs";
import {
  BROWSER_TOOL_VERIFICATION_STATUS,
  verifyBrowserActionExpectedState,
} from "./browser-tool-verification.mjs";
import {
  ACTION_VERIFICATION_METHOD,
  ACTION_VERIFICATION_STATUS,
  failActionVerification,
  passActionVerification,
  retryActionVerification,
  startActionVerification,
} from "./action-day-verification-state.mjs";
import { recordActionEvidenceOutcome } from "./proof-ledger-write-through.mjs";

export const ACTION_AUTO_VERIFICATION_TYPE = Object.freeze({
  mcp: "mcp",
  cli: "cli",
  browser: "browser",
  googleDocs: "google_docs",
  googleSheets: "google_sheets",
});

export const ACTION_CLI_VERIFICATION_OUTCOME = Object.freeze({
  verified: "verified",
  failed: "failed",
  inconclusive: "inconclusive",
});

export const ACTION_AUTO_VERIFICATION_SOURCE_STATUS = Object.freeze({
  successful: "successful",
  failed: "failed",
  unavailable: "unavailable",
});

export const ACTION_MCP_VERIFICATION_TOOL_CATALOG = Object.freeze({
  google_docs: Object.freeze({
    id: "google_docs",
    method: ACTION_VERIFICATION_METHOD.googleDocs,
    server: "agentic30_sidecar",
    tool: "gws_docs_read",
  }),
  google_sheets: Object.freeze({
    id: "google_sheets",
    method: ACTION_VERIFICATION_METHOD.googleSheets,
    server: "agentic30_sidecar",
    tool: "gws_sheets_read",
  }),
  gws_docs_read: Object.freeze({
    id: "gws_docs_read",
    method: ACTION_VERIFICATION_METHOD.googleDocs,
    server: "agentic30_sidecar",
    tool: "gws_docs_read",
  }),
  gws_sheets_read: Object.freeze({
    id: "gws_sheets_read",
    method: ACTION_VERIFICATION_METHOD.googleSheets,
    server: "agentic30_sidecar",
    tool: "gws_sheets_read",
  }),
});

const METHOD_BY_TYPE = Object.freeze({
  [ACTION_AUTO_VERIFICATION_TYPE.mcp]: ACTION_VERIFICATION_METHOD.mcp,
  [ACTION_AUTO_VERIFICATION_TYPE.cli]: ACTION_VERIFICATION_METHOD.cli,
  [ACTION_AUTO_VERIFICATION_TYPE.browser]: ACTION_VERIFICATION_METHOD.browser,
  [ACTION_AUTO_VERIFICATION_TYPE.googleDocs]: ACTION_VERIFICATION_METHOD.googleDocs,
  [ACTION_AUTO_VERIFICATION_TYPE.googleSheets]: ACTION_VERIFICATION_METHOD.googleSheets,
});

export function resolveActionAutoVerificationPlan({
  actionSpec = {},
  configuredMcpServers = {},
  configuredMcpTools = null,
  configuredCliCommands = null,
  toolCatalog = ACTION_MCP_VERIFICATION_TOOL_CATALOG,
} = {}) {
  const requested = normalizeVerificationRequests(actionSpec);
  const resolved = [];
  const skipped = [];

  for (const request of requested) {
    if (request.enabled === false) {
      skipped.push(buildDisabledVerificationSourceSkip(request));
      continue;
    }

    if (request.type === ACTION_AUTO_VERIFICATION_TYPE.mcp) {
      const result = resolveMcpRequest(request, {
        configuredMcpServers,
        configuredMcpTools,
        toolCatalog,
      });
      if (result.resolved) {
        resolved.push(result.resolved);
      } else {
        skipped.push(result.skipped);
      }
      continue;
    }

    if (request.type === ACTION_AUTO_VERIFICATION_TYPE.cli) {
      const result = resolveCliRequest(request, { configuredCliCommands });
      if (result.resolved) {
        resolved.push(result.resolved);
      } else if (result.skipped) {
        skipped.push(result.skipped);
      }
      continue;
    }

    const method = METHOD_BY_TYPE[request.type];
    if (method) {
      resolved.push({
        id: request.id || request.type,
        type: request.type,
        method,
        verifier: request.verifier || request.type,
        metadata: request.metadata,
      });
    } else {
      skipped.push({
        id: request.id || request.type || "unknown",
        type: request.type || "unknown",
        reason: "unsupported_verification_method",
      });
    }
  }

  return {
    preferredMethods: unique(resolved.map((item) => item.method)),
    resolved,
    skipped,
  };
}

export async function runActionAutoVerification(inputState, {
  actionSpec = {},
  configuredMcpServers = {},
  configuredMcpTools = null,
  configuredCliCommands = null,
  toolCatalog = ACTION_MCP_VERIFICATION_TOOL_CATALOG,
  mcpClient = null,
  callMcpTool = null,
  runCliCommand = executeConfiguredCliVerificationCommand,
  runBrowserVerification = null,
  browserTool = null,
  fetchBrowserPageState = null,
  // Optional proof-ledger write-through target (spec §15.1). When set and a
  // verifier passes, the terminal result is persisted as a verified/strong
  // action_evidence event. Failures are not written — they only open the
  // evidence-submission fallback.
  proofLedger = null,
  now = () => new Date(),
} = {}) {
  const plan = resolveActionAutoVerificationPlan({
    actionSpec,
    configuredMcpServers,
    configuredMcpTools,
    configuredCliCommands,
    toolCatalog,
  });
  const executionPlan = ensureBrowserVerificationBeforeEvidenceFallback(
    ensureGoogleWorkspaceVerificationBeforeEvidenceFallback(plan, {
      configuredMcpServers,
      configuredMcpTools,
      toolCatalog,
    }),
  );
  const attempts = [];
  let state = inputState;

  for (const verifier of executionPlan.resolved) {
    if (
      verifier.type !== ACTION_AUTO_VERIFICATION_TYPE.mcp
      && verifier.type !== ACTION_AUTO_VERIFICATION_TYPE.cli
      && verifier.type !== ACTION_AUTO_VERIFICATION_TYPE.browser
    ) {
      attempts.push({
        verifier,
        status: "skipped",
        reason: "auto_verifier_executor_not_configured",
      });
      continue;
    }

    if (
      verifier.type === ACTION_AUTO_VERIFICATION_TYPE.browser
      && typeof runBrowserVerification !== "function"
      && typeof browserTool !== "function"
      && typeof fetchBrowserPageState !== "function"
    ) {
      const raw = await verifyBrowserActionExpectedState({ actionSpec });
      const normalized = normalizeConfiguredAutoVerificationResult(raw, verifier, { actionSpec });
      attempts.push({
        verifier,
        status: BROWSER_TOOL_VERIFICATION_STATUS.unsupported,
        reason: normalized.reason || "browser_tool_not_configured",
        result: normalized,
      });
      continue;
    }

    if (verifier.type === ACTION_AUTO_VERIFICATION_TYPE.cli && !verifier.command) {
      attempts.push({
        verifier,
        status: "skipped",
        reason: "cli_command_not_configured",
      });
      continue;
    }

    const startState = state?.status === ACTION_VERIFICATION_STATUS.failed
      ? retryActionVerification(state, {
          reason: "Trying the next configured auto-verification tool.",
          nextMethod: verifier.method,
          now,
        })
      : state;

    const running = startActionVerification(startState, {
      method: verifier.method,
      verifier: verifier.verifier,
      metadata: verifier.metadata,
      now,
    });

    try {
      const raw = await runConfiguredAutoVerifier({
        verifier,
        actionSpec,
        mcpClient,
        callMcpTool,
        runCliCommand,
        runBrowserVerification,
        browserTool,
        fetchBrowserPageState,
      });
      const normalized = normalizeConfiguredAutoVerificationResult(raw, verifier, { actionSpec });
      if (normalized.unsupported) {
        attempts.push({
          verifier,
          status: BROWSER_TOOL_VERIFICATION_STATUS.unsupported,
          reason: normalized.reason,
          result: normalized,
        });
        state = startState;
        continue;
      }
      state = normalized.passed
        ? passActionVerification(running, {
            method: normalized.method,
            confidence: normalized.confidence,
            agentAssessment: normalized.agentAssessment,
            raw: normalized.raw,
            now,
          })
        : failActionVerification(running, {
            method: normalized.method,
            reason: normalized.reason,
            agentAssessment: normalized.agentAssessment,
            raw: normalized.raw,
            now,
          });
      attempts.push({
        verifier,
        status: state.status,
        result: state.verificationResult,
      });
      if (state.status === ACTION_VERIFICATION_STATUS.passed) {
        break;
      }
    } catch (error) {
      const normalized = normalizeActionVerificationEvidenceResult({
        passed: false,
        reason: error?.message || "Auto-verification failed.",
        errorName: error?.name || "Error",
      }, {
        method: verifier.method,
        verifier: verifier.verifier,
      });
      state = failActionVerification(running, {
        method: normalized.method,
        reason: normalized.reason,
        agentAssessment: normalized.agentAssessment,
        raw: normalized.raw,
        now,
      });
      attempts.push({
        verifier,
        status: state.status,
        result: state.verificationResult,
      });
    }
  }

  const aggregate = aggregateActionAutoVerificationResults({
    plan: executionPlan,
    attempts,
    state,
  });

  let proofLedgerEvent = null;
  if (proofLedger?.workspaceRoot && state?.status === ACTION_VERIFICATION_STATUS.passed) {
    try {
      const recorded = await recordActionEvidenceOutcome({
        workspaceRoot: proofLedger.workspaceRoot,
        day: proofLedger.day ?? state?.dayId ?? null,
        actionId: proofLedger.actionId ?? state?.actionId ?? "",
        verificationState: state,
        now: now(),
        ...(proofLedger.append ? { append: proofLedger.append } : {}),
      });
      proofLedgerEvent = recorded?.event ?? null;
    } catch {
      // Write-through failure must not lose the verification result.
      proofLedgerEvent = null;
    }
  }

  return {
    state,
    plan: executionPlan,
    attempts,
    aggregate,
    proofLedgerEvent,
    verificationResultAggregation: aggregate,
    sourceResults: aggregate.sources,
    passed: state?.status === ACTION_VERIFICATION_STATUS.passed,
    anyEnabledSourceSucceeded: aggregate.anyEnabledSourceSucceeded,
    any_enabled_source_succeeded: aggregate.anyEnabledSourceSucceeded,
    shouldRequestUserEvidence: shouldRequestEvidenceAfterAutoVerification({
      attempts,
      state,
      aggregate,
    }),
  };
}

export function aggregateActionAutoVerificationResults({
  plan = {},
  attempts = [],
  state = {},
} = {}) {
  const sourcesByKey = new Map();
  const addSource = (source, defaults = {}) => {
    if (!source || source.excludedFromEvidenceGatingDecision || source.excluded_from_evidence_gating_decision) {
      return null;
    }
    const key = buildVerificationSourceKey(source);
    const current = sourcesByKey.get(key) || {};
    const next = {
      id: source.id || current.id || defaults.id || source.tool || source.target || source.type || "unknown",
      type: source.type || current.type || defaults.type || "unknown",
      method: source.method || current.method || defaults.method || "",
      verifier: source.verifier || current.verifier || defaults.verifier || "",
      server: source.server || current.server || defaults.server,
      tool: source.tool || current.tool || defaults.tool,
      target: source.target || current.target || defaults.target || "",
      status: defaults.status || current.status || ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable,
      reason: Object.hasOwn(defaults, "reason") ? defaults.reason : current.reason || "",
      result: defaults.result || current.result || null,
    };
    sourcesByKey.set(key, next);
    return next;
  };

  for (const verifier of Array.isArray(plan.resolved) ? plan.resolved : []) {
    addSource(verifier, {
      status: ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable,
      reason: "not_attempted",
    });
  }

  for (const skipped of Array.isArray(plan.skipped) ? plan.skipped : []) {
    addSource(skipped, {
      status: ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable,
      reason: skipped.reason || "verification_source_unavailable",
    });
  }

  for (const attempt of Array.isArray(attempts) ? attempts : []) {
    const verifier = attempt?.verifier || {};
    const status = normalizeAggregateVerificationSourceStatus(attempt);
    addSource(verifier, {
      status,
      reason: attempt?.reason || attempt?.result?.reason || "",
      result: attempt?.result || null,
    });
  }

  const sources = [...sourcesByKey.values()];
  const counts = {
    successful: sources.filter((source) => source.status === ACTION_AUTO_VERIFICATION_SOURCE_STATUS.successful).length,
    failed: sources.filter((source) => source.status === ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed).length,
    unavailable: sources.filter((source) => source.status === ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable).length,
  };
  const everyEnabledSourceFailedOrUnavailable = sources.length > 0
    && sources.every((source) =>
      source.status === ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed
      || source.status === ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable
    );

  return {
    sources,
    sourceResults: sources,
    source_results: sources,
    counts,
    enabledSourceCount: sources.length,
    enabled_source_count: sources.length,
    anyEnabledSourceSucceeded: counts.successful > 0,
    any_enabled_source_succeeded: counts.successful > 0,
    everyEnabledSourceFailedOrUnavailable,
    every_enabled_source_failed_or_unavailable: everyEnabledSourceFailedOrUnavailable,
    allEnabledSourcesExhausted: everyEnabledSourceFailedOrUnavailable,
    all_enabled_sources_exhausted: everyEnabledSourceFailedOrUnavailable,
  };
}

function normalizeAggregateVerificationSourceStatus(attempt = {}) {
  if (
    attempt.status === BROWSER_TOOL_VERIFICATION_STATUS.unsupported
    || attempt.status === "skipped"
    || attempt.result?.unsupported
  ) {
    return ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable;
  }
  if (
    attempt.status === ACTION_VERIFICATION_STATUS.passed
    || attempt.result?.passed === true
  ) {
    return ACTION_AUTO_VERIFICATION_SOURCE_STATUS.successful;
  }
  if (
    attempt.status === ACTION_VERIFICATION_STATUS.failed
    || attempt.result?.passed === false
  ) {
    return ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed;
  }
  return ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable;
}

function buildVerificationSourceKey(source = {}) {
  return [
    source.type || "unknown",
    source.server || "",
    source.tool || "",
    source.target || "",
    source.id || "",
    source.verifier || "",
  ].join(":");
}

export function shouldRequestEvidenceAfterConfiguredMcpAttempt(attempts = [], state = {}) {
  return shouldRequestEvidenceAfterCliAutoVerification(attempts, state);
}

export function shouldRequestEvidenceAfterAutoVerification({
  attempts = [],
  state = {},
  aggregate = {},
} = {}) {
  if (aggregate?.anyEnabledSourceSucceeded || aggregate?.any_enabled_source_succeeded) {
    return false;
  }
  const enabledSourceCount = Number(
    aggregate?.enabledSourceCount ?? aggregate?.enabled_source_count ?? 0,
  );
  const allEnabledSourcesExhausted = Boolean(
    aggregate?.allEnabledSourcesExhausted
      ?? aggregate?.all_enabled_sources_exhausted
      ?? aggregate?.everyEnabledSourceFailedOrUnavailable
      ?? aggregate?.every_enabled_source_failed_or_unavailable
  );
  if (enabledSourceCount <= 0 || !allEnabledSourcesExhausted) {
    return false;
  }
  return state?.status !== ACTION_VERIFICATION_STATUS.passed
    && attempts.length > 0;
}

export function shouldRequestEvidenceAfterCliAutoVerification(attempts = [], state = {}) {
  if (state?.status === ACTION_VERIFICATION_STATUS.passed) return false;
  return attempts.some((attempt) =>
    attempt?.verifier?.type === ACTION_AUTO_VERIFICATION_TYPE.browser
    && [ACTION_VERIFICATION_STATUS.failed, BROWSER_TOOL_VERIFICATION_STATUS.unsupported].includes(attempt.status)
    && attempt.result?.passed !== true
  );
}

export function ensureBrowserVerificationBeforeEvidenceFallback(plan = {}) {
  const resolved = Array.isArray(plan.resolved) ? plan.resolved : [];
  const hasCli = resolved.some((item) => item?.type === ACTION_AUTO_VERIFICATION_TYPE.cli);
  const hasBrowser = resolved.some((item) => item?.type === ACTION_AUTO_VERIFICATION_TYPE.browser);
  if (!hasCli || hasBrowser) {
    return {
      ...plan,
      preferredMethods: unique(Array.isArray(plan.preferredMethods) ? plan.preferredMethods : []),
      resolved,
    };
  }

  const browserVerifier = {
    id: "browser-before-evidence",
    type: ACTION_AUTO_VERIFICATION_TYPE.browser,
    method: ACTION_VERIFICATION_METHOD.browser,
    verifier: "browser-harness",
    metadata: {
      injected: true,
      reason: "browser_tool_before_user_evidence_request",
    },
  };

  return {
    ...plan,
    preferredMethods: unique([
      ...(Array.isArray(plan.preferredMethods) ? plan.preferredMethods : []),
      ACTION_VERIFICATION_METHOD.browser,
    ]),
    resolved: [
      ...resolved,
      browserVerifier,
    ],
  };
}

export function ensureGoogleWorkspaceVerificationBeforeEvidenceFallback(plan = {}, {
  configuredMcpServers = {},
  configuredMcpTools = null,
  toolCatalog = ACTION_MCP_VERIFICATION_TOOL_CATALOG,
} = {}) {
  const resolved = Array.isArray(plan.resolved) ? plan.resolved : [];
  const hasFallbackPath = resolved.some((item) =>
    item?.type === ACTION_AUTO_VERIFICATION_TYPE.cli
    || item?.type === ACTION_AUTO_VERIFICATION_TYPE.browser
  );
  if (!hasFallbackPath) {
    return {
      ...plan,
      preferredMethods: unique(Array.isArray(plan.preferredMethods) ? plan.preferredMethods : []),
      resolved,
    };
  }

  const existingMethods = new Set(resolved.map((item) => item?.method).filter(Boolean));
  const additions = [];
  const skipped = Array.isArray(plan.skipped) ? plan.skipped.slice() : [];
  for (const tool of ["google_docs", "google_sheets"]) {
    const method = toolCatalog[tool]?.method;
    if (method && existingMethods.has(method)) continue;
    const result = resolveMcpRequest({
      type: ACTION_AUTO_VERIFICATION_TYPE.mcp,
      id: tool,
      tool,
      verifier: "mcp",
      metadata: {
        injected: true,
        reason: "google_workspace_before_user_evidence_request",
      },
    }, {
      configuredMcpServers,
      configuredMcpTools,
      toolCatalog,
    });
    if (result.resolved) {
      additions.push(result.resolved);
      existingMethods.add(result.resolved.method);
    } else if (result.skipped && !hasSkippedVerifier(skipped, result.skipped)) {
      skipped.push({
        ...result.skipped,
        metadata: {
          injected: true,
          reason: "google_workspace_before_user_evidence_request",
        },
      });
    }
  }

  if (additions.length === 0 && skipped.length === (Array.isArray(plan.skipped) ? plan.skipped.length : 0)) {
    return {
      ...plan,
      preferredMethods: unique(Array.isArray(plan.preferredMethods) ? plan.preferredMethods : []),
      resolved,
    };
  }

  const firstBrowserIndex = resolved.findIndex((item) => item?.type === ACTION_AUTO_VERIFICATION_TYPE.browser);
  const nextResolved = firstBrowserIndex === -1
    ? resolved.concat(additions)
    : [
        ...resolved.slice(0, firstBrowserIndex),
        ...additions,
        ...resolved.slice(firstBrowserIndex),
      ];

  return {
    ...plan,
    preferredMethods: unique([
      ...(Array.isArray(plan.preferredMethods) ? plan.preferredMethods : []),
      ...additions.map((item) => item.method),
    ]),
    resolved: nextResolved,
    skipped,
  };
}

export function normalizeCliVerificationResult(rawResult = {}, {
  method = ACTION_VERIFICATION_METHOD.cli,
  verifier = "",
} = {}) {
  const raw = rawResult && typeof rawResult === "object" ? rawResult : {};
  const exitCode = Number.isInteger(raw.exitCode) ? raw.exitCode : null;
  const timedOut = Boolean(raw.timedOut);
  const error = trimText(raw.error || raw.errorMessage || "");
  const stdout = trimText(raw.stdout || "");
  const stderr = trimText(raw.stderr || "");
  const parsedStdout = parseJsonObject(stdout);
  const outcome = interpretCliVerificationOutcome(raw, parsedStdout);
  const passed = outcome === ACTION_CLI_VERIFICATION_OUTCOME.verified;
  const reason = trimText(
    parsedStdout?.reason
      || raw.reason
      || (timedOut ? "CLI verification timed out." : "")
      || error
      || (passed ? "" : stderr || stdout || defaultCliVerificationReason(outcome)),
  );
  const agentAssessment = trimText(
    parsedStdout?.agentAssessment
      || parsedStdout?.agent_assessment
      || parsedStdout?.assessment
      || raw.agentAssessment
      || (passed
        ? "Configured CLI verification command exited successfully."
        : outcome === ACTION_CLI_VERIFICATION_OUTCOME.inconclusive
          ? "Configured CLI verification ran but did not produce a conclusive verification result."
        : "Configured CLI verification command did not confirm the action completion signal."),
  );

  return {
    method,
    verifier: trimText(verifier),
    outcome,
    passed,
    confidence: clampNumber(parsedStdout?.confidence ?? raw.confidence ?? (passed ? 0.8 : 0), 0, 1),
    reason,
    agentAssessment,
    evidenceItems: normalizeEvidenceItems(parsedStdout?.evidenceItems ?? parsedStdout?.evidence ?? []),
    raw: {
      command: trimText(raw.command || ""),
      args: Array.isArray(raw.args) ? raw.args.map(trimText) : [],
      cwd: trimText(raw.cwd || ""),
      exitCode,
      signal: trimText(raw.signal || ""),
      stdout,
      stderr,
      timedOut,
      error,
      outcome,
      verifier,
    },
  };
}

export function interpretCliVerificationOutcome(rawResult = {}, parsedResult = null) {
  const raw = rawResult && typeof rawResult === "object" ? rawResult : {};
  const parsed = parsedResult && typeof parsedResult === "object" && !Array.isArray(parsedResult)
    ? parsedResult
    : parseJsonObject(trimText(raw.stdout || ""));
  const exitCode = Number.isInteger(raw.exitCode) ? raw.exitCode : null;
  const timedOut = Boolean(raw.timedOut);
  const error = trimText(raw.error || raw.errorMessage || "");
  const signal = trimText(raw.signal || "");
  const statusText = normalizeText(
    firstDefined(
      parsed?.outcome,
      parsed?.verificationOutcome,
      parsed?.verification_outcome,
      parsed?.status,
      parsed?.result,
      raw.outcome,
      raw.status,
      raw.result,
    ) || "",
  );
  const explicitPassed = parsed
    ? firstDefined(
        parsed.passed,
        parsed.pass,
        parsed.verified,
        parsed.success,
        parsed.ok,
      )
    : undefined;

  if (isVerifiedCliStatus(statusText)) {
    return exitCode === 0 && !timedOut && !error
      ? ACTION_CLI_VERIFICATION_OUTCOME.verified
      : ACTION_CLI_VERIFICATION_OUTCOME.inconclusive;
  }
  if (isFailedCliStatus(statusText)) {
    return ACTION_CLI_VERIFICATION_OUTCOME.failed;
  }
  if (isInconclusiveCliStatus(statusText)) {
    return ACTION_CLI_VERIFICATION_OUTCOME.inconclusive;
  }
  if (typeof explicitPassed === "boolean") {
    if (explicitPassed) {
      return exitCode === 0 && !timedOut && !error
        ? ACTION_CLI_VERIFICATION_OUTCOME.verified
        : ACTION_CLI_VERIFICATION_OUTCOME.inconclusive;
    }
    return ACTION_CLI_VERIFICATION_OUTCOME.failed;
  }
  if (timedOut || error || signal || exitCode === null) {
    return ACTION_CLI_VERIFICATION_OUTCOME.inconclusive;
  }
  return exitCode === 0
    ? ACTION_CLI_VERIFICATION_OUTCOME.verified
    : ACTION_CLI_VERIFICATION_OUTCOME.failed;
}

export function normalizeActionVerificationEvidenceResult(rawResult = {}, {
  method = ACTION_VERIFICATION_METHOD.mcp,
  verifier = "",
  actionSpec = {},
} = {}) {
  const raw = normalizeMcpToolResult(rawResult);
  if (method === ACTION_VERIFICATION_METHOD.googleDocs && isGoogleDocsDocumentPayload(raw)) {
    return verifyGoogleDocsEvidenceSource(raw, { actionSpec, verifier });
  }
  if (method === ACTION_VERIFICATION_METHOD.googleSheets && isGoogleSheetsValuesPayload(raw)) {
    return verifyGoogleSheetsEvidenceSource(raw, { actionSpec, verifier });
  }
  const evidenceItems = normalizeEvidenceItems(raw.evidenceItems ?? raw.evidence ?? raw.items ?? raw.matches);
  const explicitPassed = firstDefined(
    raw.passed,
    raw.pass,
    raw.verified,
    raw.success,
    raw.ok,
  );
  const statusText = normalizeText(raw.status || raw.outcome || raw.result);
  const unsupported = Boolean(raw.unsupported) || statusText === BROWSER_TOOL_VERIFICATION_STATUS.unsupported;
  const passed = typeof explicitPassed === "boolean"
    ? explicitPassed
    : ["passed", "pass", "verified", "success", "ok"].includes(statusText);
  const reason = trimText(raw.reason || raw.error || raw.message || (passed ? "" : "Verification did not find enough evidence."));
  const agentAssessment = trimText(
    raw.agentAssessment
      || raw.agent_assessment
      || raw.assessment
      || raw.summary
      || (passed
        ? "Configured MCP verification found evidence matching the action completion signal."
        : "Configured MCP verification could not confirm the action completion signal."),
  );

  return {
    method,
    verifier: trimText(verifier),
    unsupported,
    outcome: raw.outcome || raw.status || (unsupported ? BROWSER_TOOL_VERIFICATION_STATUS.unsupported : ""),
    passed,
    confidence: clampNumber(raw.confidence ?? raw.score ?? (passed ? 0.8 : 0), 0, 1),
    reason,
    agentAssessment,
    evidenceItems,
    raw: {
      ...raw,
      verifier,
      evidenceItems,
      runnableScript: raw.runnableScript ?? raw.raw?.runnableScript ?? "",
      runnableCommand: raw.runnableCommand ?? raw.raw?.runnableCommand ?? "",
    },
  };
}

export function verifyGoogleDocsEvidenceSource(documentPayload = {}, {
  actionSpec = {},
  verifier = "",
} = {}) {
  const payload = normalizeGoogleDocsPayload(documentPayload);
  const text = extractGoogleDocPlainText(payload, 64_000).replace(/\s+/g, " ").trim();
  const args = normalizePlainObject(
    actionSpec?.verification_arguments
      ?? actionSpec?.verificationArguments
      ?? actionSpec?.arguments
      ?? {},
  );
  const expectedDocumentId = trimText(args.documentId || args.document_id || "");
  const actualDocumentId = trimText(payload.documentId || payload.document_id || "");
  const documentIdMatches = !expectedDocumentId || !actualDocumentId || expectedDocumentId === actualDocumentId;
  const criteriaDecision = buildActionSufficiencyCriteriaDecision(actionSpec);
  const requiredPhrases = collectGoogleDocsRequiredPhrases({ actionSpec, args, criteriaDecision });
  const anyPhrases = collectStringList(args.anyOf ?? args.any_of ?? args.anyPhrases ?? args.any_phrases);
  const minCharacters = normalizePositiveInteger(args.minCharacters ?? args.min_characters, 1);
  const textMatches = evaluateGoogleDocsTextEvidence(text, {
    requiredPhrases,
    anyPhrases,
    minCharacters,
  });
  const passed = Boolean(text && documentIdMatches && textMatches.passed);
  const title = trimText(payload.title || "");
  const evidenceItems = passed
    ? [{
        type: "google_doc_text",
        content: text.slice(0, 4000),
        source: actualDocumentId || expectedDocumentId || title,
      }]
    : [];
  const reason = passed
    ? ""
    : buildGoogleDocsVerificationFailureReason({
        hasText: Boolean(text),
        documentIdMatches,
        expectedDocumentId,
        actualDocumentId,
        textMatches,
      });

  return {
    method: ACTION_VERIFICATION_METHOD.googleDocs,
    verifier: trimText(verifier),
    outcome: passed ? "verified" : "insufficient",
    passed,
    confidence: passed ? computeGoogleDocsEvidenceConfidence(textMatches, { title }) : 0,
    reason,
    agentAssessment: passed
      ? "Google Docs verification read the source document and found text matching the action completion signal."
      : "Google Docs verification read the source document but could not confirm the action completion signal.",
    evidenceItems,
    raw: {
      documentId: actualDocumentId,
      expectedDocumentId,
      title,
      textExcerpt: text.slice(0, 4000),
      requiredPhrases,
      anyPhrases,
      criteriaDecision,
      missingPhrases: textMatches.missingPhrases,
      matchedPhrases: textMatches.matchedPhrases,
      evidenceItems,
      documentIdMatches,
      verifier,
    },
  };
}

export function verifyGoogleSheetsEvidenceSource(sheetPayload = {}, {
  actionSpec = {},
  verifier = "",
} = {}) {
  const payload = normalizeGoogleSheetsPayload(sheetPayload);
  const args = normalizePlainObject(
    actionSpec?.verification_arguments
      ?? actionSpec?.verificationArguments
      ?? actionSpec?.arguments
      ?? {},
  );
  const expectedSpreadsheetId = trimText(args.spreadsheetId || args.spreadsheet_id || "");
  const actualSpreadsheetId = trimText(payload.spreadsheetId || payload.spreadsheet_id || "");
  const spreadsheetIdMatches = !expectedSpreadsheetId || !actualSpreadsheetId || expectedSpreadsheetId === actualSpreadsheetId;
  const values = Array.isArray(payload.values) ? payload.values : [];
  const headerRow = args.headerRow ?? args.header_row;
  const hasHeader = typeof headerRow === "boolean" ? headerRow : values.length > 1;
  const dataRows = normalizeSheetDataRows(values, { hasHeader });
  const sheetText = buildGoogleSheetsEvidenceText(values);
  const criteriaDecision = buildActionSufficiencyCriteriaDecision(actionSpec);
  const minRows = normalizePositiveInteger(
    args.minRows ?? args.min_rows ?? args.minimumRows ?? args.minimum_rows,
    criteriaDecision.quantityRule?.minCount
      ?? criteriaDecision.quantityRule?.exactCount
      ?? deriveMinimumRowsFromCompletionSignal(actionSpec?.completionSignal ?? actionSpec?.completion_signal ?? ""),
  );
  const requiredPhrases = collectGoogleSheetsRequiredPhrases({ actionSpec, args, criteriaDecision });
  const anyPhrases = collectStringList(args.anyOf ?? args.any_of ?? args.anyPhrases ?? args.any_phrases);
  const textMatches = evaluateGoogleDocsTextEvidence(sheetText, {
    requiredPhrases,
    anyPhrases,
    minCharacters: normalizePositiveInteger(args.minCharacters ?? args.min_characters, 1),
  });
  const rowMatches = evaluateGoogleSheetsRowEvidence(dataRows, {
    minRows,
    maxRows: criteriaDecision.quantityRule?.exactCount ?? null,
    requiredStatus: args.requiredStatus ?? args.required_status ?? args.statusValue ?? args.status_value,
    statusColumn: args.statusColumn ?? args.status_column,
  });
  const passed = Boolean(spreadsheetIdMatches && values.length > 0 && textMatches.passed && rowMatches.passed);
  const range = trimText(payload.range || args.range || "");
  const evidenceItems = passed
    ? [{
        type: "google_sheet_rows",
        content: sheetText.slice(0, 4000),
        source: [actualSpreadsheetId || expectedSpreadsheetId, range].filter(Boolean).join(":"),
      }]
    : [];
  const reason = passed
    ? ""
    : buildGoogleSheetsVerificationFailureReason({
        hasValues: values.length > 0,
        spreadsheetIdMatches,
        expectedSpreadsheetId,
        actualSpreadsheetId,
        textMatches,
        rowMatches,
      });

  return {
    method: ACTION_VERIFICATION_METHOD.googleSheets,
    verifier: trimText(verifier),
    outcome: passed ? "verified" : "insufficient",
    passed,
    confidence: passed ? computeGoogleSheetsEvidenceConfidence(textMatches, rowMatches, { range }) : 0,
    reason,
    agentAssessment: passed
      ? "Google Sheets verification read the source spreadsheet and found rows matching the action completion signal."
      : "Google Sheets verification read the source spreadsheet but could not confirm the action completion signal.",
    evidenceItems,
    raw: {
      spreadsheetId: actualSpreadsheetId,
      expectedSpreadsheetId,
      range,
      rowCount: dataRows.length,
      requiredRows: minRows,
      requiredPhrases,
      anyPhrases,
      criteriaDecision,
      missingPhrases: textMatches.missingPhrases,
      matchedPhrases: textMatches.matchedPhrases,
      matchedRows: rowMatches.matchedRows,
      missingStatus: rowMatches.missingStatus,
      evidenceItems,
      spreadsheetIdMatches,
      textExcerpt: sheetText.slice(0, 4000),
      verifier,
    },
  };
}

export function normalizeVerificationRequests(actionSpec = {}) {
  const source = actionSpec?.verification_method
    ?? actionSpec?.verificationMethod
    ?? actionSpec?.verification
    ?? actionSpec?.verification_methods
    ?? actionSpec?.verificationMethods
    ?? [];
  const items = Array.isArray(source) ? source : [source];
  const normalized = items.flatMap(normalizeVerificationRequest).filter(Boolean);
  return normalized.length > 0 ? normalized : [];
}

export function loadConfiguredCliVerificationCommands(configuredCliCommands = null, {
  target = "",
} = {}) {
  const targetId = normalizeText(target);
  const rawEntries = flattenCliCommandEntries(configuredCliCommands, targetId);
  const commands = [];
  const skipped = [];

  for (const entry of rawEntries) {
    const normalized = normalizeConfiguredCliCommand(entry);
    if (normalized.command) {
      commands.push(normalized.command);
    } else {
      skipped.push(normalized.skipped);
    }
  }

  return { commands, skipped };
}

function normalizeVerificationRequest(input) {
  if (!input) return [];
  if (typeof input === "string") {
    return normalizeVerificationString(input);
  }
  if (Array.isArray(input)) {
    return input.flatMap(normalizeVerificationRequest);
  }
  if (typeof input !== "object") return [];

  const type = normalizeType(input.type || input.method || input.kind || "");
  if (type === ACTION_AUTO_VERIFICATION_TYPE.mcp) {
    const tools = normalizeToolList(input.tools ?? input.tool ?? input.toolId ?? input.name);
    const enabled = input.enabled !== false;
    return tools.length > 0
      ? tools.map((tool) => ({
          type,
          id: tool,
          tool,
          verifier: input.verifier || "mcp",
          enabled,
          metadata: normalizePlainObject(input.metadata),
        }))
      : [{
          type,
          id: normalizeText(input.id) || "mcp",
          tool: normalizeText(input.tool || input.name),
          verifier: input.verifier || "mcp",
          enabled,
          metadata: normalizePlainObject(input.metadata),
        }];
  }

  const target = normalizeText(input.target || input.commandId || input.command_id || input.name);
  return [{
    type,
    id: normalizeText(input.id) || target || type,
    verifier: normalizeText(input.verifier),
    target,
    enabled: input.enabled !== false,
    metadata: normalizePlainObject(input.metadata),
  }];
}

function normalizeVerificationString(value) {
  const text = normalizeText(value);
  if (!text) return [];
  const type = normalizeType(text);
  if (type === ACTION_AUTO_VERIFICATION_TYPE.googleDocs) {
    return [{ type: ACTION_AUTO_VERIFICATION_TYPE.mcp, id: "google_docs", tool: "google_docs", verifier: "mcp", metadata: {} }];
  }
  if (type === ACTION_AUTO_VERIFICATION_TYPE.googleSheets) {
    return [{ type: ACTION_AUTO_VERIFICATION_TYPE.mcp, id: "google_sheets", tool: "google_sheets", verifier: "mcp", metadata: {} }];
  }
  if (text in ACTION_MCP_VERIFICATION_TOOL_CATALOG || /^gws_/.test(text)) {
    return [{ type: ACTION_AUTO_VERIFICATION_TYPE.mcp, id: text, tool: text, verifier: "mcp", metadata: {} }];
  }
  return [{ type, id: text, verifier: text, metadata: {} }];
}

function resolveMcpRequest(request, {
  configuredMcpServers,
  configuredMcpTools,
  toolCatalog,
}) {
  const catalogEntry = toolCatalog[request.tool] || toolCatalog[request.id];
  if (!catalogEntry) {
    return {
      skipped: {
        id: request.id || request.tool || "mcp",
        type: ACTION_AUTO_VERIFICATION_TYPE.mcp,
        reason: "unknown_mcp_verification_tool",
      },
    };
  }

  if (isMcpServerDisabled(configuredMcpServers, catalogEntry.server)) {
    return {
      skipped: buildDisabledVerificationSourceSkip({
        id: catalogEntry.id,
        type: ACTION_AUTO_VERIFICATION_TYPE.mcp,
        server: catalogEntry.server,
        tool: catalogEntry.tool,
        method: catalogEntry.method || ACTION_VERIFICATION_METHOD.mcp,
      }, {
        reason: "mcp_server_disabled",
      }),
    };
  }

  const serverConfigured = isMcpServerConfigured(configuredMcpServers, catalogEntry.server);
  if (!serverConfigured) {
    return {
      skipped: {
        id: catalogEntry.id,
        type: ACTION_AUTO_VERIFICATION_TYPE.mcp,
        server: catalogEntry.server,
        tool: catalogEntry.tool,
        reason: "mcp_server_not_configured",
      },
    };
  }

  if (isMcpToolDisabled(catalogEntry, configuredMcpTools)) {
    return {
      skipped: buildDisabledVerificationSourceSkip({
        id: catalogEntry.id,
        type: ACTION_AUTO_VERIFICATION_TYPE.mcp,
        server: catalogEntry.server,
        tool: catalogEntry.tool,
        method: catalogEntry.method || ACTION_VERIFICATION_METHOD.mcp,
      }, {
        reason: "mcp_tool_disabled",
      }),
    };
  }

  if (!isMcpToolConfigured(catalogEntry, configuredMcpTools)) {
    return {
      skipped: {
        id: catalogEntry.id,
        type: ACTION_AUTO_VERIFICATION_TYPE.mcp,
        server: catalogEntry.server,
        tool: catalogEntry.tool,
        reason: "mcp_tool_not_configured",
      },
    };
  }

  return {
    resolved: {
      id: catalogEntry.id,
      type: ACTION_AUTO_VERIFICATION_TYPE.mcp,
      method: catalogEntry.method || ACTION_VERIFICATION_METHOD.mcp,
      verifier: `${catalogEntry.server}.${catalogEntry.tool}`,
      server: catalogEntry.server,
      tool: catalogEntry.tool,
      metadata: {
        ...request.metadata,
        server: catalogEntry.server,
        tool: catalogEntry.tool,
      },
    },
  };
}

function resolveCliRequest(request, {
  configuredCliCommands,
}) {
  if (!configuredCliCommands) {
    return {
      resolved: {
        id: request.id || request.type,
        type: ACTION_AUTO_VERIFICATION_TYPE.cli,
        method: ACTION_VERIFICATION_METHOD.cli,
        verifier: request.verifier || request.id || ACTION_AUTO_VERIFICATION_TYPE.cli,
        metadata: request.metadata,
      },
    };
  }

  const target = request.target || request.id || request.verifier || "";
  const loaded = loadConfiguredCliVerificationCommands(configuredCliCommands, { target });
  const command = loaded.commands[0] || null;
  if (!command) {
    const disabled = loaded.skipped.find((item) => item?.excludedFromEvidenceGatingDecision);
    return {
      skipped: disabled || {
        id: request.id || target || ACTION_AUTO_VERIFICATION_TYPE.cli,
        type: ACTION_AUTO_VERIFICATION_TYPE.cli,
        target: target || "",
        reason: loaded.skipped[0]?.reason || "cli_command_not_configured",
        validationErrors: loaded.skipped.map((item) => item.reason),
      },
    };
  }

  return {
    resolved: {
      id: command.id || request.id || target || ACTION_AUTO_VERIFICATION_TYPE.cli,
      type: ACTION_AUTO_VERIFICATION_TYPE.cli,
      method: ACTION_VERIFICATION_METHOD.cli,
      verifier: command.verifier,
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      env: command.env,
      metadata: {
        ...request.metadata,
        ...command.metadata,
        target: command.target,
      },
    },
  };
}

export async function executeConfiguredCliVerificationCommand({
  verifier,
  actionSpec = {},
} = {}) {
  const invocation = buildCliVerificationInvocation(verifier, actionSpec);
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let timeout = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        exitCode: null,
        signal: "",
        stdout,
        stderr,
        timedOut,
        error: "",
        ...result,
      });
    };

    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd || undefined,
        env: {
          ...process.env,
          ...invocation.env,
        },
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      settle({
        error: error?.message || "Failed to start CLI verification command.",
      });
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, invocation.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout = appendCapturedText(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendCapturedText(stderr, chunk);
    });
    child.on("error", (error) => {
      settle({
        error: error?.message || "CLI verification command failed to start.",
      });
    });
    child.on("close", (code, signal) => {
      settle({
        exitCode: Number.isInteger(code) ? code : null,
        signal: signal || "",
        timedOut,
      });
    });
  });
}

function buildCliVerificationInvocation(verifier = {}, actionSpec = {}) {
  return {
    command: verifier.command,
    args: (verifier.args || []).map((arg) => interpolateCliArgument(arg, actionSpec)),
    cwd: interpolateCliArgument(verifier.cwd || "", actionSpec),
    timeoutMs: verifier.timeoutMs || 30_000,
    env: Object.fromEntries(
      Object.entries(verifier.env || {}).map(([key, value]) => [
        key,
        interpolateCliArgument(value, actionSpec),
      ]),
    ),
  };
}

function interpolateCliArgument(value, actionSpec = {}) {
  const text = String(value || "");
  if (!text.includes("{{")) return text;
  const variables = buildCliTemplateVariables(actionSpec);
  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const replacement = variables.get(String(key).toLowerCase());
    return replacement === undefined || replacement === null ? "" : String(replacement);
  });
}

function buildCliTemplateVariables(actionSpec = {}) {
  const variables = new Map();
  const addObject = (prefix, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || item === null || typeof item === "object") continue;
      variables.set(String(key).toLowerCase(), item);
      if (prefix) variables.set(`${prefix}.${String(key).toLowerCase()}`, item);
    }
  };

  addObject("", actionSpec);
  addObject("verification_arguments", actionSpec?.verification_arguments);
  addObject("verificationarguments", actionSpec?.verificationArguments);
  variables.set("completion_signal", actionSpec?.completion_signal ?? actionSpec?.completionSignal ?? "");
  variables.set("completionsignal", actionSpec?.completionSignal ?? actionSpec?.completion_signal ?? "");
  variables.set("action_id", actionSpec?.action_id ?? actionSpec?.actionId ?? "");
  variables.set("actionid", actionSpec?.actionId ?? actionSpec?.action_id ?? "");
  variables.set("day_id", actionSpec?.day_id ?? actionSpec?.dayId ?? "");
  variables.set("dayid", actionSpec?.dayId ?? actionSpec?.day_id ?? "");
  return variables;
}

function appendCapturedText(current, chunk) {
  const next = `${current}${String(chunk || "")}`;
  return next.length > 64_000 ? next.slice(-64_000) : next;
}

function flattenCliCommandEntries(configuredCliCommands, targetId) {
  if (!configuredCliCommands) return [];
  if (configuredCliCommands instanceof Map) {
    if (targetId && configuredCliCommands.has(targetId)) {
      return asArray(configuredCliCommands.get(targetId)).map((entry) => attachCliEntryId(entry, targetId));
    }
    if (targetId) return [];
    return [...configuredCliCommands.entries()].flatMap(([id, value]) =>
      asArray(value).map((entry) => attachCliEntryId(entry, id)));
  }
  if (Array.isArray(configuredCliCommands)) {
    return configuredCliCommands.filter((entry) => {
      if (!targetId) return true;
      const entryTarget = normalizeText(entry?.target || entry?.id || entry?.name || entry?.verifier);
      return entryTarget === targetId;
    });
  }
  if (typeof configuredCliCommands === "object") {
    if (targetId && Object.hasOwn(configuredCliCommands, targetId)) {
      return asArray(configuredCliCommands[targetId]).map((entry) => attachCliEntryId(entry, targetId));
    }
    if (targetId) return [];
    return Object.entries(configuredCliCommands).flatMap(([id, value]) =>
      asArray(value).map((entry) => attachCliEntryId(entry, id)));
  }
  return [];
}

function attachCliEntryId(entry, id) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return { id, target: id, ...entry };
  }
  return { id, target: id, command: entry };
}

function normalizeConfiguredCliCommand(entry) {
  const raw = entry && typeof entry === "object" && !Array.isArray(entry)
    ? entry
    : { command: entry };
  const id = normalizeText(raw.id || raw.target || raw.name || raw.verifier || "cli");
  const command = trimText(raw.command || raw.bin || raw.executable || "");
  const args = raw.args ?? raw.arguments ?? [];
  const timeoutMs = raw.timeoutMs ?? raw.timeout_ms ?? raw.timeout;
  const errors = [];

  if (raw.enabled === false) {
    return {
      skipped: buildDisabledVerificationSourceSkip({
        id,
        type: ACTION_AUTO_VERIFICATION_TYPE.cli,
        target: normalizeText(raw.target || id),
        method: ACTION_VERIFICATION_METHOD.cli,
      }, {
        reason: "cli_command_disabled",
      }),
    };
  }

  if (!command) {
    errors.push("cli_command_missing");
  } else if (/\s/.test(command)) {
    errors.push("cli_command_must_be_executable_only");
  }

  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) {
    errors.push("cli_args_must_be_string_array");
  }

  if (
    timeoutMs !== undefined
    && timeoutMs !== null
    && (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0)
  ) {
    errors.push("cli_timeout_must_be_positive");
  }

  if (errors.length > 0) {
    return {
      skipped: {
        id,
        type: ACTION_AUTO_VERIFICATION_TYPE.cli,
        target: normalizeText(raw.target || id),
        reason: errors[0],
        validationErrors: errors,
      },
    };
  }

  const normalizedArgs = args.map(trimText);
  return {
    command: {
      id,
      type: ACTION_AUTO_VERIFICATION_TYPE.cli,
      target: normalizeText(raw.target || id),
      method: ACTION_VERIFICATION_METHOD.cli,
      verifier: trimText(raw.verifier || [command, ...normalizedArgs].join(" ")),
      command,
      args: normalizedArgs,
      cwd: trimText(raw.cwd || raw.workingDirectory || raw.working_directory || ""),
      timeoutMs: Number(timeoutMs || 30_000),
      env: normalizeStringMap(raw.env),
      metadata: normalizePlainObject(raw.metadata),
    },
  };
}

function isMcpToolConfigured(catalogEntry, configuredMcpTools) {
  if (!configuredMcpTools) return true;
  if (configuredMcpTools instanceof Map) {
    const serverTools = configuredMcpTools.get(catalogEntry.server);
    if (Array.isArray(serverTools)) {
      return serverTools.includes(catalogEntry.tool)
        || serverTools.includes(`${catalogEntry.server}.${catalogEntry.tool}`);
    }
    if (serverTools instanceof Set) {
      return serverTools.has(catalogEntry.tool)
        || serverTools.has(`${catalogEntry.server}.${catalogEntry.tool}`);
    }
    if (serverTools && typeof serverTools === "object") {
      return Boolean(serverTools[catalogEntry.tool]);
    }
  }
  if (Array.isArray(configuredMcpTools)) {
    return configuredMcpTools.includes(catalogEntry.tool)
      || configuredMcpTools.includes(`${catalogEntry.server}.${catalogEntry.tool}`);
  }
  if (typeof configuredMcpTools === "object") {
    const serverTools = configuredMcpTools[catalogEntry.server];
    if (Array.isArray(serverTools)) {
      return serverTools.includes(catalogEntry.tool);
    }
    if (serverTools && typeof serverTools === "object") {
      return Boolean(serverTools[catalogEntry.tool]);
    }
  }
  return false;
}

function isMcpToolDisabled(catalogEntry, configuredMcpTools) {
  const toolConfig = resolveMcpToolConfig(catalogEntry, configuredMcpTools);
  return toolConfig && typeof toolConfig === "object" && toolConfig.enabled === false;
}

function resolveMcpToolConfig(catalogEntry, configuredMcpTools) {
  if (!configuredMcpTools) return null;
  if (configuredMcpTools instanceof Map) {
    const serverTools = configuredMcpTools.get(catalogEntry.server);
    if (serverTools && typeof serverTools === "object" && !(serverTools instanceof Set) && !Array.isArray(serverTools)) {
      return serverTools[catalogEntry.tool] ?? serverTools[`${catalogEntry.server}.${catalogEntry.tool}`] ?? null;
    }
    return null;
  }
  if (typeof configuredMcpTools === "object" && !Array.isArray(configuredMcpTools)) {
    const serverTools = configuredMcpTools[catalogEntry.server];
    if (serverTools && typeof serverTools === "object" && !Array.isArray(serverTools)) {
      return serverTools[catalogEntry.tool] ?? serverTools[`${catalogEntry.server}.${catalogEntry.tool}`] ?? null;
    }
  }
  return null;
}

function isMcpServerDisabled(configuredMcpServers, serverName) {
  const config = resolveMcpServerConfig(configuredMcpServers, serverName);
  return config && typeof config === "object" && config.enabled === false;
}

function isMcpServerConfigured(configuredMcpServers, serverName) {
  if (!configuredMcpServers) return false;
  if (configuredMcpServers instanceof Map) return configuredMcpServers.has(serverName);
  if (Array.isArray(configuredMcpServers)) return configuredMcpServers.includes(serverName);
  if (typeof configuredMcpServers === "object") return Boolean(configuredMcpServers[serverName]);
  return false;
}

function resolveMcpServerConfig(configuredMcpServers, serverName) {
  if (!configuredMcpServers || !serverName) return null;
  if (configuredMcpServers instanceof Map) return configuredMcpServers.get(serverName) ?? null;
  if (typeof configuredMcpServers === "object" && !Array.isArray(configuredMcpServers)) {
    return configuredMcpServers[serverName] ?? null;
  }
  return null;
}

function buildDisabledVerificationSourceSkip(source = {}, {
  reason = "verification_source_disabled",
} = {}) {
  return {
    id: source.id || source.tool || source.target || source.type || "unknown",
    type: source.type || "unknown",
    method: source.method || METHOD_BY_TYPE[source.type] || "",
    server: source.server,
    tool: source.tool,
    target: source.target || "",
    reason,
    evidenceGatingDecision: "excluded",
    evidence_gating_decision: "excluded",
    excludedFromEvidenceGatingDecision: true,
    excluded_from_evidence_gating_decision: true,
  };
}

function hasSkippedVerifier(skipped = [], candidate = {}) {
  return skipped.some((item) =>
    item?.id === candidate.id
    && item?.type === candidate.type
    && item?.server === candidate.server
    && item?.tool === candidate.tool
    && item?.reason === candidate.reason
  );
}

async function invokeConfiguredMcpTool({
  verifier,
  actionSpec,
  mcpClient,
  callMcpTool,
}) {
  const args = buildMcpVerificationArguments(actionSpec, verifier);
  if (typeof callMcpTool === "function") {
    return callMcpTool({
      server: verifier.server,
      tool: verifier.tool,
      name: verifier.tool,
      arguments: args,
      metadata: verifier.metadata,
    });
  }
  const serverClient = resolveServerMcpClient(mcpClient, verifier.server);
  if (serverClient && typeof serverClient.callTool === "function") {
    return serverClient.callTool({
      name: verifier.tool,
      arguments: args,
      args,
      metadata: verifier.metadata,
    });
  }
  if (mcpClient && typeof mcpClient.callTool === "function") {
    return mcpClient.callTool({
      server: verifier.server,
      tool: verifier.tool,
      name: verifier.tool,
      arguments: args,
      args,
      metadata: verifier.metadata,
    });
  }
  throw new Error("No MCP tool caller configured for action auto-verification.");
}

async function runConfiguredAutoVerifier({
  verifier,
  actionSpec,
  mcpClient,
  callMcpTool,
  runCliCommand,
  runBrowserVerification,
  browserTool,
  fetchBrowserPageState,
}) {
  if (verifier.type === ACTION_AUTO_VERIFICATION_TYPE.cli) {
    return runCliCommand({ verifier, actionSpec });
  }
  if (verifier.type === ACTION_AUTO_VERIFICATION_TYPE.browser) {
    if (typeof runBrowserVerification === "function") {
      return runBrowserVerification({
        verifier,
        actionSpec,
        browserTool,
        fetchPageState: fetchBrowserPageState,
      });
    }
    return verifyBrowserActionExpectedState({
      actionSpec,
      browserTool,
      fetchPageState: fetchBrowserPageState,
    });
  }
  return invokeConfiguredMcpTool({
    verifier,
    actionSpec,
    mcpClient,
    callMcpTool,
  });
}

function normalizeConfiguredAutoVerificationResult(raw, verifier, {
  actionSpec = {},
} = {}) {
  if (verifier.type === ACTION_AUTO_VERIFICATION_TYPE.cli) {
    return normalizeCliVerificationResult(raw, {
      method: verifier.method,
      verifier: verifier.verifier,
    });
  }
  return normalizeActionVerificationEvidenceResult(raw, {
    method: verifier.method,
    verifier: verifier.verifier,
    actionSpec,
  });
}

function resolveServerMcpClient(mcpClient, serverName) {
  if (!mcpClient || !serverName) return null;
  if (mcpClient instanceof Map) return mcpClient.get(serverName) || null;
  if (mcpClient.clients instanceof Map) return mcpClient.clients.get(serverName) || null;
  if (mcpClient.servers instanceof Map) return mcpClient.servers.get(serverName) || null;
  if (mcpClient.clients && typeof mcpClient.clients === "object") {
    return mcpClient.clients[serverName] || null;
  }
  if (mcpClient.servers && typeof mcpClient.servers === "object") {
    return mcpClient.servers[serverName] || null;
  }
  if (typeof mcpClient === "object") return mcpClient[serverName] || null;
  return null;
}

function buildMcpVerificationArguments(actionSpec, verifier) {
  const explicit = actionSpec?.verification_arguments
    ?? actionSpec?.verificationArguments
    ?? actionSpec?.mcp_arguments
    ?? actionSpec?.mcpArguments
    ?? actionSpec?.arguments
    ?? null;
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    return {
      ...explicit,
      actionSpec: normalizeActionSpecForTool(actionSpec),
      verification: {
        server: verifier.server,
        tool: verifier.tool,
        method: verifier.method,
      },
    };
  }

  return {
    query: trimText(
      actionSpec?.verification_query
        ?? actionSpec?.verificationQuery
        ?? actionSpec?.completion_signal
        ?? actionSpec?.completionSignal
        ?? actionSpec?.completion
        ?? "",
    ),
    actionSpec: normalizeActionSpecForTool(actionSpec),
    verification: {
      server: verifier.server,
      tool: verifier.tool,
      method: verifier.method,
    },
  };
}

function normalizeActionSpecForTool(actionSpec = {}) {
  if (!actionSpec || typeof actionSpec !== "object" || Array.isArray(actionSpec)) return {};
  return {
    dayId: actionSpec.dayId ?? actionSpec.day_id ?? null,
    actionId: actionSpec.actionId ?? actionSpec.action_id ?? null,
    actionType: actionSpec.actionType ?? actionSpec.action_type ?? actionSpec.type ?? "",
    description: trimText(actionSpec.description ?? actionSpec.action_description ?? actionSpec.action ?? actionSpec.task ?? ""),
    completionSignal: trimText(actionSpec.completionSignal ?? actionSpec.completion_signal ?? actionSpec.completion ?? ""),
    dependencies: Array.isArray(actionSpec.dependencies ?? actionSpec.dependency_refs)
      ? (actionSpec.dependencies ?? actionSpec.dependency_refs).map((item) => trimText(item)).filter(Boolean)
      : [],
  };
}

function normalizeMcpToolResult(result) {
  if (!result || typeof result !== "object") return {};
  if (result.isError) {
    return {
      passed: false,
      reason: extractMcpContentText(result) || "MCP tool returned an error.",
      mcp: result,
    };
  }
  const structured = result.structuredContent ?? result.structured_content;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    return { ...structured, mcp: result };
  }
  if (
    Object.hasOwn(result, "passed")
    || Object.hasOwn(result, "verified")
    || Object.hasOwn(result, "status")
    || Object.hasOwn(result, "outcome")
    || Object.hasOwn(result, "unsupported")
  ) {
    return { ...result };
  }
  const contentText = extractMcpContentText(result);
  const parsed = parseJsonObject(contentText);
  if (parsed) {
    return { ...parsed, mcp: result };
  }
  return {
    passed: Boolean(contentText),
    evidenceItems: contentText ? [{ type: "text", content: contentText }] : [],
    summary: contentText,
    mcp: result,
  };
}

function normalizeGoogleDocsPayload(value) {
  if (typeof value === "string") {
    return parseJsonObject(value) || {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeGoogleSheetsPayload(value) {
  if (typeof value === "string") {
    return parseJsonObject(value) || {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function isGoogleDocsDocumentPayload(value) {
  const payload = normalizeGoogleDocsPayload(value);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Boolean(
    payload.body?.content
      || payload.tabs
      || payload.documentId
      || payload.document_id
  ) && !(
    Object.hasOwn(payload, "passed")
      || Object.hasOwn(payload, "verified")
      || Object.hasOwn(payload, "status")
      || Object.hasOwn(payload, "outcome")
  );
}

function isGoogleSheetsValuesPayload(value) {
  const payload = normalizeGoogleSheetsPayload(value);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Boolean(
    Array.isArray(payload.values)
      || payload.range
      || payload.spreadsheetId
      || payload.spreadsheet_id
  ) && !(
    Object.hasOwn(payload, "passed")
      || Object.hasOwn(payload, "verified")
      || Object.hasOwn(payload, "status")
      || Object.hasOwn(payload, "outcome")
  );
}

function collectGoogleDocsRequiredPhrases({ actionSpec = {}, args = {}, criteriaDecision = null } = {}) {
  const explicit = [
    ...collectStringList(args.expectedText ?? args.expected_text),
    ...collectStringList(args.requiredText ?? args.required_text),
    ...collectStringList(args.requiredPhrases ?? args.required_phrases),
    ...collectStringList(args.expectedPhrases ?? args.expected_phrases),
    ...collectStringList(args.contains),
    ...collectStringList(args.allOf ?? args.all_of),
  ];
  if (explicit.length > 0) return unique(explicit);
  const criteriaPhrases = criteriaDecision?.requiredPhrases || [];
  if (criteriaPhrases.length > 0) return criteriaPhrases;

  const query = trimText(args.query || args.verificationQuery || args.verification_query || "");
  const completionSignal = trimText(actionSpec?.completionSignal ?? actionSpec?.completion_signal ?? "");
  const derivedSource = query && query !== completionSignal ? query : completionSignal;
  return deriveEvidencePhrasesFromCompletionSignal(derivedSource);
}

function collectGoogleSheetsRequiredPhrases({ actionSpec = {}, args = {}, criteriaDecision = null } = {}) {
  const explicit = [
    ...collectStringList(args.expectedText ?? args.expected_text),
    ...collectStringList(args.requiredText ?? args.required_text),
    ...collectStringList(args.requiredPhrases ?? args.required_phrases),
    ...collectStringList(args.expectedPhrases ?? args.expected_phrases),
    ...collectStringList(args.contains),
    ...collectStringList(args.allOf ?? args.all_of),
  ];
  if (explicit.length > 0) return unique(explicit);
  const criteriaPhrases = criteriaDecision?.requiredPhrases || [];
  if (criteriaPhrases.length > 0) return criteriaPhrases;

  const query = trimText(args.query || args.verificationQuery || args.verification_query || "");
  const completionSignal = trimText(actionSpec?.completionSignal ?? actionSpec?.completion_signal ?? "");
  const derivedSource = query && query !== completionSignal ? query : completionSignal;
  return deriveSheetEvidencePhrasesFromCompletionSignal(derivedSource);
}

export function buildActionSufficiencyCriteriaDecision(actionSpec = {}) {
  const criteria = normalizeActionSufficiencyCriteria(actionSpec);
  const requiredCriteria = criteria.filter((criterion) => criterion.required !== false);
  const quantityRule = deriveQuantityRuleFromCriteria(requiredCriteria);
  const requiredPhrases = unique(
    requiredCriteria
      .filter((criterion) => criterion.type !== "quantity")
      .flatMap((criterion) => deriveCriteriaEvidencePhrases(criterion.description)),
  );

  return {
    criteria,
    requiredCriteria,
    quantityRule,
    requiredPhrases,
    source: criteria.length > 0 ? "sufficiency_criteria" : "completion_signal_fallback",
  };
}

function normalizeActionSufficiencyCriteria(actionSpec = {}) {
  const rawCriteria = actionSpec?.sufficiencyCriteria ?? actionSpec?.sufficiency_criteria ?? [];
  if (!Array.isArray(rawCriteria)) return [];
  return rawCriteria
    .map((criterion) => {
      if (typeof criterion === "string") {
        return {
          type: inferCriterionType(criterion),
          label: "",
          description: trimText(criterion),
          required: true,
        };
      }
      if (!criterion || typeof criterion !== "object") return null;
      const description = trimText(criterion.description ?? criterion.text ?? criterion.value ?? "");
      if (!description) return null;
      return {
        type: normalizeCriterionType(criterion.type || inferCriterionType(`${criterion.label || ""} ${description}`)),
        label: trimText(criterion.label || ""),
        description,
        required: criterion.required === false ? false : true,
      };
    })
    .filter(Boolean);
}

function deriveQuantityRuleFromCriteria(criteria = []) {
  const quantityCriterion = criteria.find((criterion) => criterion.type === "quantity");
  if (!quantityCriterion) return null;
  const description = quantityCriterion.description;
  const exactCount = extractExactCount(description);
  const minCount = exactCount ?? extractMinimumCount(description);
  if (!minCount) return null;
  return {
    minCount,
    exactCount,
    description,
    label: quantityCriterion.label,
  };
}

function deriveCriteriaEvidencePhrases(value) {
  const text = trimText(value);
  if (!text) return [];
  const cleaned = text
    .replace(/\bat\s+least\s+\d+\b/gi, " ")
    .replace(/\bminimum\s+of\s+\d+\b/gi, " ")
    .replace(/\bexactly\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi, " ")
    .replace(/\b\d+\s*(?:rows?|items?|entries?|people|competitors?|targets?|posts?|urls?|links?)\b/gi, " ")
    .replace(/\b(each|every|row|rows|has|have|includes?|contains?|recorded|copied|present|visible|must|should|with|and|or|the|a|an|is|are)\b/gi, " ");
  return cleaned
    .split(/[,.;]|\s+\+\s+|\s+\|\s+/)
    .map((part) => part.trim())
    .flatMap((part) => part.split(/\s+(?:and|or)\s+/i))
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && /[\p{L}\p{N}]/u.test(part))
    .slice(0, 8);
}

function extractMinimumCount(value) {
  const text = trimText(value);
  const match = text.match(/\bat\s+least\s+(\d+)\b/i)
    || text.match(/\bminimum\s+of\s+(\d+)\b/i)
    || text.match(/\b(\d+)\s+or\s+more\b/i)
    || text.match(/최소\s*(\d+)\s*(?:개|건|명|줄|행)?/i)
    || text.match(/\b(\d+)\s*(?:rows?|items?|entries?|people|competitors?|targets?|posts?|urls?|links?)\b/i)
    || text.match(/(\d+)\s*(?:개|건|명|줄|행)/i);
  return match ? normalizePositiveInteger(match[1], null) : null;
}

function extractExactCount(value) {
  const text = trimText(value);
  const match = text.match(/\bexactly\s+(\d+)\b/i)
    || text.match(/\bexactly\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/i)
    || text.match(/정확히\s*(\d+)\s*(?:개|건|명|줄|행)?/i);
  if (!match) return null;
  return normalizePositiveInteger(wordNumberToInteger(match[1]), null);
}

function wordNumberToInteger(value) {
  const text = String(value || "").toLowerCase();
  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  return words[text] ?? value;
}

function inferCriterionType(value) {
  const text = normalizeSearchText(value);
  if (/quantity|count|rows?|at least|minimum|exactly|수량|최소|정확히|\d+/.test(text)) return "quantity";
  if (/evidence|proof|link|file|screenshot|transcript|증거|근거|링크|파일|캡처/.test(text)) return "evidence";
  if (/quality|specific|named|verbatim|품질|구체|원문|실명/.test(text)) return "quality";
  if (/deadline|date|time|기한|시간/.test(text)) return "timebox";
  return "completion";
}

function normalizeCriterionType(value) {
  const text = normalizeText(value).replace(/-/g, "_");
  return text || "completion";
}

function collectStringList(value) {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) => typeof item === "string" ? item.split(/\n+/) : [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveEvidencePhrasesFromCompletionSignal(value) {
  const text = trimText(value);
  if (!text) return [];
  const withoutBoilerplate = text
    .replace(/\bgoogle\s+doc(?:ument)?\b/gi, " ")
    .replace(/\bcontains?\b/gi, " ")
    .replace(/\bat\s+least\b/gi, " ")
    .replace(/\bone\b/gi, " ")
    .replace(/\bwith\b/gi, " ")
    .replace(/\bthe\b/gi, " ")
    .replace(/\ba\b/gi, " ")
    .replace(/\ban\b/gi, " ")
    .replace(/\bis\b/gi, " ")
    .replace(/\bare\b/gi, " ")
    .replace(/\bhas\b/gi, " ")
    .replace(/\benough\b/gi, " ");
  const tokens = withoutBoilerplate
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .slice(0, 6);
  return tokens.length ? tokens : [text];
}

function deriveSheetEvidencePhrasesFromCompletionSignal(value) {
  const text = trimText(value);
  if (!text) return [];
  const withoutBoilerplate = text
    .replace(/\bgoogle\s+sheet(?:s|spreadsheet)?\b/gi, " ")
    .replace(/\bcontains?\b/gi, " ")
    .replace(/\bat\s+least\b/gi, " ")
    .replace(/\brows?\b/gi, " ")
    .replace(/\bcolumns?\b/gi, " ")
    .replace(/\bstatus(?:es)?\b/gi, " ")
    .replace(/\bwith\b/gi, " ")
    .replace(/\bthe\b/gi, " ")
    .replace(/\ba\b/gi, " ")
    .replace(/\ban\b/gi, " ")
    .replace(/\bis\b/gi, " ")
    .replace(/\bare\b/gi, " ")
    .replace(/\bhas\b/gi, " ");
  const tokens = withoutBoilerplate
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
    .slice(0, 6);
  return tokens.length ? tokens : [];
}

function deriveMinimumRowsFromCompletionSignal(value) {
  const text = trimText(value);
  const match = text.match(/\bat\s+least\s+(\d+)\s+rows?\b/i)
    || text.match(/\bminimum\s+of\s+(\d+)\s+rows?\b/i)
    || text.match(/\b(\d+)\s+or\s+more\s+rows?\b/i)
    || text.match(/\b(\d+)\s+rows?\b/i);
  return match ? normalizePositiveInteger(match[1], 1) : 1;
}

function normalizeSheetDataRows(values, { hasHeader = true } = {}) {
  const rows = Array.isArray(values) ? values : [];
  const headers = hasHeader && Array.isArray(rows[0]) ? rows[0].map((cell) => trimText(cell)) : [];
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((cells, index) => ({
      rowNumber: index + (hasHeader ? 2 : 1),
      cells: Array.isArray(cells) ? cells.map((cell) => trimText(cell)) : [],
      headers,
    }))
    .filter((row) => row.cells.some(Boolean));
}

function buildGoogleSheetsEvidenceText(values) {
  if (!Array.isArray(values)) return "";
  return values
    .map((row) => Array.isArray(row) ? row.map((cell) => trimText(cell)).filter(Boolean).join(" | ") : "")
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function evaluateGoogleSheetsRowEvidence(rows, {
  minRows = 1,
  maxRows = null,
  requiredStatus = "",
  statusColumn = "",
} = {}) {
  const normalizedStatus = normalizeSearchText(requiredStatus);
  const normalizedColumn = normalizeSearchText(statusColumn);
  const statusColumnIndex = resolveStatusColumnIndex(rows, normalizedColumn);
  const matchedRows = rows
    .filter((row) => {
      if (!normalizedStatus) return true;
      const cells = statusColumnIndex >= 0 ? [row.cells[statusColumnIndex] || ""] : row.cells;
      return cells.some((cell) => normalizeSearchText(cell).includes(normalizedStatus));
    })
    .map((row) => row.rowNumber);
  const hasEnoughRows = rows.length >= minRows && (!normalizedStatus || matchedRows.length >= minRows);
  const hasTooManyRows = Number.isInteger(maxRows)
    && maxRows > 0
    && (normalizedStatus ? matchedRows.length : rows.length) > maxRows;
  return {
    passed: hasEnoughRows && !hasTooManyRows,
    rowCount: rows.length,
    minRows,
    maxRows,
    matchedRows,
    tooManyRows: hasTooManyRows,
    missingStatus: normalizedStatus && matchedRows.length < minRows ? requiredStatus : "",
  };
}

function resolveStatusColumnIndex(rows, normalizedColumn) {
  if (!normalizedColumn || rows.length === 0) return -1;
  const headers = rows[0]?.headers || [];
  return headers.findIndex((cell) => normalizeSearchText(cell) === normalizedColumn);
}

function evaluateGoogleDocsTextEvidence(text, {
  requiredPhrases = [],
  anyPhrases = [],
  minCharacters = 1,
} = {}) {
  const normalizedText = normalizeSearchText(text);
  const matchedPhrases = [];
  const missingPhrases = [];

  for (const phrase of requiredPhrases) {
    if (phraseMatches(normalizedText, phrase)) matchedPhrases.push(phrase);
    else missingPhrases.push(phrase);
  }

  const anyMatches = anyPhrases.filter((phrase) => phraseMatches(normalizedText, phrase));
  const hasRequired = requiredPhrases.length === 0 || missingPhrases.length === 0;
  const hasAny = anyPhrases.length === 0 || anyMatches.length > 0;
  const hasMinimumLength = text.length >= minCharacters;
  return {
    passed: hasRequired && hasAny && hasMinimumLength,
    matchedPhrases: unique([...matchedPhrases, ...anyMatches]),
    missingPhrases,
    hasMinimumLength,
    minCharacters,
  };
}

function phraseMatches(normalizedText, phrase) {
  const normalizedPhrase = normalizeSearchText(phrase);
  if (!normalizedPhrase) return true;
  return normalizedText.includes(normalizedPhrase);
}

function normalizeSearchText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildGoogleDocsVerificationFailureReason({
  hasText,
  documentIdMatches,
  expectedDocumentId,
  actualDocumentId,
  textMatches,
} = {}) {
  if (!hasText) return "Google Doc did not contain readable text.";
  if (!documentIdMatches) {
    return `Google Doc ID mismatch: expected ${expectedDocumentId}, read ${actualDocumentId || "unknown"}.`;
  }
  if (textMatches?.missingPhrases?.length) {
    return `Google Doc is missing required evidence: ${textMatches.missingPhrases.join(", ")}.`;
  }
  if (textMatches?.hasMinimumLength === false) {
    return `Google Doc evidence is shorter than the required ${textMatches.minCharacters} characters.`;
  }
  return "Google Doc text did not match the completion signal.";
}

function buildGoogleSheetsVerificationFailureReason({
  hasValues,
  spreadsheetIdMatches,
  expectedSpreadsheetId,
  actualSpreadsheetId,
  textMatches,
  rowMatches,
} = {}) {
  if (!hasValues) return "Google Sheet did not contain readable rows.";
  if (!spreadsheetIdMatches) {
    return `Google Sheet ID mismatch: expected ${expectedSpreadsheetId}, read ${actualSpreadsheetId || "unknown"}.`;
  }
  if (rowMatches?.rowCount < rowMatches?.minRows) {
    return `Google Sheet has ${rowMatches.rowCount} matching data rows; ${rowMatches.minRows} required.`;
  }
  if (rowMatches?.tooManyRows) {
    return `Google Sheet has more matching rows than the exact ${rowMatches.maxRows} rows required.`;
  }
  if (rowMatches?.missingStatus) {
    return `Google Sheet is missing required status evidence: ${rowMatches.missingStatus}.`;
  }
  if (textMatches?.missingPhrases?.length) {
    return `Google Sheet is missing required evidence: ${textMatches.missingPhrases.join(", ")}.`;
  }
  if (textMatches?.hasMinimumLength === false) {
    return `Google Sheet evidence is shorter than the required ${textMatches.minCharacters} characters.`;
  }
  return "Google Sheet rows did not match the completion signal.";
}

function computeGoogleDocsEvidenceConfidence(textMatches = {}, { title = "" } = {}) {
  const matchedCount = Array.isArray(textMatches.matchedPhrases) ? textMatches.matchedPhrases.length : 0;
  const phraseBoost = Math.min(0.16, matchedCount * 0.04);
  const titleBoost = title ? 0.02 : 0;
  return clampNumber(0.78 + phraseBoost + titleBoost, 0, 0.95);
}

function computeGoogleSheetsEvidenceConfidence(textMatches = {}, rowMatches = {}, { range = "" } = {}) {
  const matchedCount = Array.isArray(textMatches.matchedPhrases) ? textMatches.matchedPhrases.length : 0;
  const phraseBoost = Math.min(0.12, matchedCount * 0.03);
  const rowBoost = Math.min(0.08, Math.max(0, (rowMatches.rowCount || 0) - (rowMatches.minRows || 1)) * 0.01);
  const rangeBoost = range ? 0.02 : 0;
  return clampNumber(0.78 + phraseBoost + rowBoost + rangeBoost, 0, 0.95);
}

function extractMcpContentText(result) {
  const content = result?.content;
  if (typeof content === "string") return trimText(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item?.type === "text" || typeof item?.text === "string") return item.text;
      if (typeof item?.content === "string") return item.content;
      return "";
    })
    .map(trimText)
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeEvidenceItems(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => {
    if (typeof item === "string") {
      return { type: "text", content: trimText(item) };
    }
    if (!item || typeof item !== "object") return null;
    return {
      type: trimText(item.type || item.kind || "text"),
      content: trimText(item.content || item.text || item.value || item.ref || ""),
      source: trimText(item.source || item.url || item.path || ""),
      matchedAt: trimText(item.matchedAt || item.matched_at || ""),
    };
  }).filter((item) => item && (item.content || item.source));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function defaultCliVerificationReason(outcome) {
  if (outcome === ACTION_CLI_VERIFICATION_OUTCOME.inconclusive) {
    return "CLI verification was inconclusive.";
  }
  return "CLI verification command exited non-zero.";
}

function isVerifiedCliStatus(statusText) {
  return [
    "pass",
    "passed",
    "success",
    "successful",
    "ok",
    "verified",
    "complete",
    "completed",
  ].includes(statusText);
}

function isFailedCliStatus(statusText) {
  return [
    "fail",
    "failed",
    "failure",
    "rejected",
    "insufficient",
    "not_verified",
    "unverified",
    "missing_evidence",
  ].includes(statusText);
}

function isInconclusiveCliStatus(statusText) {
  return [
    "blocked",
    "error",
    "inconclusive",
    "indeterminate",
    "no_result",
    "not_configured",
    "skipped",
    "timeout",
    "timed_out",
    "unauthorized",
    "unknown",
  ].includes(statusText);
}

function normalizeToolList(value) {
  const items = Array.isArray(value) ? value : [value];
  return items.map(normalizeText).filter(Boolean);
}

function normalizeType(value) {
  const text = normalizeText(value).replace(/-/g, "_");
  if (text === "google_docs" || text === "googledocs" || text === "docs") {
    return ACTION_AUTO_VERIFICATION_TYPE.googleDocs;
  }
  if (text === "google_sheets" || text === "googlesheets" || text === "sheets") {
    return ACTION_AUTO_VERIFICATION_TYPE.googleSheets;
  }
  if (text === "browser_tool" || text === "browser_harness") {
    return ACTION_AUTO_VERIFICATION_TYPE.browser;
  }
  return text;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function trimText(value) {
  return String(value || "").trim().slice(0, 4000);
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [trimText(key), item]),
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function unique(items) {
  return [...new Set(items)];
}
