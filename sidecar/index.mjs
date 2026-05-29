import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { WebSocket, WebSocketServer } from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { GoogleGenAI, mcpToTool } from "@google/genai";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MetaAdsClient } from "./meta-ads.mjs";
import { buildAdStrategyPrompt } from "./ad-strategy-prompt.mjs";
import { buildBipPrompt } from "./bip-prompt.mjs";
import { buildDiagnosticsSnapshot } from "./diagnostics.mjs";
import {
  buildOfficeHoursDocsPrompt,
  buildOfficeHoursDocsSystemPrompt,
} from "./office-hours-docs-prompt.mjs";
import {
  buildQmdGuidance,
  buildQmdMcpConfig,
  getQmdState,
} from "./qmd-support.mjs";
import { buildPostHogClaudeMcpConfigFromSources } from "./posthog-mcp-config.mjs";
import { createTelemetryClient } from "./telemetry.mjs";
import { getCachedBipContext } from "./context-cache.mjs";
import { collectLocalDiscovery } from "./local-discovery.mjs";
import {
  buildDay1AlignmentComposerPrompt,
  composeDay1AlignmentPlan,
  generateDay1AlignmentPlan,
  generateDay1IcpPlan,
} from "./generate-day1-icp-plan.mjs";
import {
  MINI_ACTION_EXECUTION_ONLY_INTENT,
  classifyChatExecutionRoute as classifyChatExecutionRouteWithState,
} from "./chat-route.mjs";
import {
  deriveWorkspaceOnboardingHypothesisLocally,
  mergeWorkspaceOnboardingHypotheses,
  normalizeWorkspaceOnboardingHypothesis,
} from "./onboarding-hypothesis.mjs";
import { collectAgentWorkHistory } from "./agent-work-history.mjs";
import { buildDay1SituationSummary } from "./generate-day1-situation-summary.mjs";
import { extractWorkspaceEvidence } from "./workspace-signal-extractor.mjs";
import { isSecretPath, redactSecrets } from "./workspace-safety.mjs";
import {
  formatProjectContextForPrompt,
  loadProjectContextCache,
  refreshProjectContextCache,
} from "./project-context-cache.mjs";
import {
  buildAuthEnv,
  clearAuthContext,
  getAuthContextSummary,
  setAuthContext,
} from "./auth-context.mjs";
import { initiateNotionOAuth, exchangeOAuthCode, refreshAccessToken } from "./notion-oauth.mjs";
import { buildPreflightReport } from "./preflight.mjs";
import {
  buildCodexEnv,
  buildGeminiEnv,
  resolveCodexModel,
  resolveGeminiModel,
  getProviderAuthState,
  getProviderConnectionState,
  runProviderStream,
  updateProviderSettings,
} from "./provider-runner.mjs";
import {
  extractInlineDecision,
  inferInlineDecisionFromPlainText,
  INLINE_DECISION_SENTINEL_END,
  INLINE_DECISION_SENTINEL_START,
  validateInlineDecision,
} from "./inline-decision.mjs";
import {
  loadSessionsFromFile,
  persistSessionsToFile,
  SESSION_STORE_SCHEMA_VERSION,
} from "./session-store.mjs";
import {
  BIP_COACH_SCHEMA_VERSION,
  buildFallbackBipMissionChoices,
  buildBipCoachMissionPromptFromEvidence,
  buildSheetRange,
  completeBipCoachMission,
  extractGoogleDocPlainText,
  formatBipCoachGwsError,
  isBipCoachConfigured,
  loadBipCoachState,
  mergeBipConfigIntoCoachState,
  normalizeBipCoachConfig,
  normalizeBipCoachState,
  parseGoogleDocUrl,
  parseGoogleSheetUrl,
  parseMissionChoicesResponse,
  acknowledgePendingRitual,
  applyCurriculumDayUpdate,
  persistBipCoachState,
  pickSheetTab,
  summarizeSheetValues,
  todayKey,
} from "./bip-coach-state.mjs";
import { buildRitualPrompt } from "./weekly-ritual.mjs";
import {
  listQuarantinedFiles,
  proposeFixForEntry,
  readQuarantineDump,
  restoreQuarantinedRecord,
} from "./quarantine-recovery.mjs";
import {
  readGoogleDoc,
  readSheetMetadata,
  readSheetValues,
  resolveGwsBin,
} from "./gws-client.mjs";
import { persistGwsReadToMemory } from "./gws-memory.mjs";
import {
  clearValidationCache,
  checkGwsAuthStatus,
  copyTemplateToDrive,
  deriveReadinessState,
  formatReadinessError,
  installGws,
  startGwsAuth,
  validateUrl,
} from "./bip-readiness.mjs";
import {
  BIP_REQUIRED_LOCAL_DOCS,
  DAY1_HANDOFF_DOC_TYPES,
  IDD_FOUNDATION_DOCS,
  agentSynthesisTargetsCorrectSignal,
  approveIddSetupDocuments,
  buildIddApprovalSummary,
  buildIddFollowupStructuredInputForDoc,
  buildIddContinuationPrompt,
  buildIddDocumentPrompt,
  buildIddSetupGateStatus,
  decorateIcpStructuredInput,
  dedupeIddAgentOptions,
  deriveLocalDocReadinessRows,
  docTypeFromLocalRowId,
  canStartDay1HandoffDoc,
  day1HandoffDocByType,
  genericIddUserFacingTitle,
  initialIddStructuredInputForDoc,
  isMissingIcpContextIntro,
  isStaleAwkwardIcpUserInputRequest,
  isLegacyStaticIddUserInputRequest,
  isStaleGenericHostIddUserInputRequest,
  loadIddSetupState,
  nextIddFoundationDoc,
  normalizeIddSetupState,
  persistIddSetupState,
  recordIddStructuredResponse,
  requiredDocByType,
  serializeIddSetupFields,
  setIddSetupError,
  setIddProviderRecovery,
  summarizeBipSetupGate,
  writeAllDay1HandoffDocuments,
  writeDay1HandoffDocument,
} from "./idd-doc-gate.mjs";
import { buildMiniActionSessionTriggerEvent } from "./adaptive-curriculum.mjs";
import {
  appendCurriculumAnswer,
  buildExaMcpConfig,
  buildNewsMarketRadarProgressStatus,
  formatNewsMarketRadarProviderTimeout,
  loadNewsMarketRadarSnapshot,
  normalizeNewsMarketRadarProviderTimeout,
  refreshNewsMarketRadar,
} from "./news-market-radar.mjs";
import {
  buildBipResearchProgressStatus,
  loadBipResearchSnapshot,
  refreshBipResearch,
} from "./bip-research-radar.mjs";
import {
  buildExaApiKeyRoute,
  discoverExaMcpRoutes,
  orderExaMcpRoutes,
  redactExaResearchRoute,
} from "./exa-mcp-discovery.mjs";
import { emitInlineHintTriggerForFeatureAppearance } from "./curriculum-hint-eligibility.mjs";
import {
  CODEX_STRUCTURED_INPUT_TOOL,
} from "./structured-input-tools.mjs";
import {
  clearUserInputArtifacts,
  createUserInputRequest,
  deleteUserInputArtifacts,
  ensureUserInputDirs,
  listUserInputRequests,
  writeUserInputResponse,
} from "./user-input.mjs";
import {
  buildSpecialistInjection,
  selectSpecialist,
} from "./specialist-router.mjs";
import { describeVendor as describeGstackVendor } from "./vendor-skill-loader.mjs";
import {
  buildFirstPromptForDay,
  buildFoundationSystemContext,
  composeUnifiedFoundationPrompt,
  computeFoundationDayFromStartedAt,
  FOUNDATION_DAY_MS,
  FOUNDATION_MAX_DAY_INDEX,
  FOUNDATION_TOTAL_DAYS,
  formatFirstPromptText,
  FOUNDATION_DAYS,
  getFoundationDay,
  persistEvidenceRefsSidecar,
  resolveFoundationContext,
  resolveFoundationDayFromPayload,
} from "./foundation-chat.mjs";
import {
  applyMonetizationAskOutcome,
  attachMonetizationAskState,
  buildMonetizationAskContextBlock,
  loadMonetizationAskState,
  shouldRunMonetizationAsk,
} from "./monetization-ask-integration.mjs";
import {
  applyFoundationSummaryOutcome,
  attachFoundationSummaryState,
  buildFoundationSummaryCompletedEvent,
  shouldRunFoundationSummary,
} from "./foundation-summary-integration.mjs";

const sidecarProcessStartedAt = performance.now();
const sidecarProcessStartedAtIso = new Date().toISOString();
const sidecarBootTiming = {
  sidecarReadyAt: null,
  sidecarReadyPerf: null,
  processToSidecarReadyMs: null,
  lastClientAuthenticatedAt: null,
  lastClientAuthenticatedPerf: null,
  processToLastClientAuthenticatedMs: null,
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const workspaceArg = readArg("--workspace");
const workspaceRoot = path.resolve(workspaceArg ?? process.cwd());
const hasExplicitWorkspace = Boolean(workspaceArg && workspaceArg.trim());
const sidecarRoot = path.resolve(__dirname);
process.env.AGENTIC30_SIDECAR_ROOT ??= sidecarRoot;
const appSupportPath = process.env.AGENTIC30_APP_SUPPORT_PATH
  ? path.resolve(process.env.AGENTIC30_APP_SUPPORT_PATH)
  : path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "agentic30",
    );
const sessionsFilePath = path.join(appSupportPath, "sessions.json");
const bipCoachFilePath = path.join(appSupportPath, "bip-coach-state.json");
const internalMcpServerName = "agentic30_sidecar";
const sidecarAuthToken = randomBytes(32).toString("base64url");
const BIP_TEMPLATE_DOC_ID = process.env.AGENTIC30_BIP_TEMPLATE_DOC_ID || "1EoQIaByJd5Aq8ENbgEfxHKKJsZsup7d5gJxcT7uqNeA";
const BIP_TEMPLATE_SHEET_ID = process.env.AGENTIC30_BIP_TEMPLATE_SHEET_ID || "16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA";
const WORKSPACE_SCAN_CLAUDE_MODEL = "claude-sonnet-4-6";
const WORKSPACE_SCAN_CODEX_MODEL = "gpt-5.4-mini";
const WORKSPACE_SCAN_GEMINI_MODEL = "gemini-3.5-flash";
const DAY1_CHOICE_CLAUDE_MODEL = process.env.AGENTIC30_DAY1_CHOICE_CLAUDE_MODEL || "claude-opus-4-7";
const DAY1_CHOICE_CODEX_MODEL = process.env.AGENTIC30_DAY1_CHOICE_CODEX_MODEL || "gpt-5.5";
const DAY1_CHOICE_GEMINI_MODEL = process.env.AGENTIC30_DAY1_CHOICE_GEMINI_MODEL || "gemini-3.5-flash";
const DAY1_CHOICE_PROVIDER_TIMEOUT_MS = 45_000;
const CHAT_BIP_CONTEXT_MAX_CHARS = 60000;
const CHAT_BIP_LOCAL_DOC_MAX_CHARS = 12000;
const CHAT_BIP_EXTERNAL_DOC_MAX_CHARS = 12000;
const CHAT_BIP_SHEET_MAX_ROWS = 25;
const CHAT_BIP_EXTERNAL_CACHE_TTL_MS = 5 * 60 * 1000;
const INSTANT_CHAT_COMPLETE_SLO_MS = 1_000;
const NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS = normalizeNewsMarketRadarProviderTimeout(
  process.env.AGENTIC30_NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS,
);
const REQUEST_EMIT_SCHEMA_VERSION = 1;
const ALLOWED_REQUEST_EMIT_EVENTS = new Set([
  "workspace_setup_started",
  "workspace_setup_failed",
  "workspace_setup_completed",
]);

const state = {
  sessions: new Map(),
  activeRuns: new Map(),
  warmRuns: new Map(),
  promptQueues: new Map(),
  clients: new Set(),
  resolvedUserInputIds: new Set(),
  sessionStoreWarnings: [],
  bipCoach: null,
  iddSetup: null,
  bipCoachRunning: false,
  providerAuthRuns: new Map(),
  workspaceOnboardingHypothesis: null,
  curriculumInlineHintState: {},
  newsMarketRadarRefreshPromise: null,
  newsMarketRadarProgress: null,
  newsMarketRadarProgressStartedAt: null,
  bipResearchRefreshPromise: null,
  bipResearchProgress: null,
  bipResearchProgressStartedAt: null,
  integrationSettings: {
    exaApiKey: "",
  },
  workspaceSetupTelemetry: {
    root: "",
    started: false,
    failed: false,
    scanSucceeded: false,
    firstInput: false,
    firstInputSource: "",
    completed: false,
    startedAtMs: 0,
    foundCount: 0,
  },
};

let workspaceOnboardingHypothesisWarmup = null;
const iddDocumentQueueInFlight = new Map();
const chatBipExternalContextCache = new Map();

// Foundation Phase day-derivation utilities live in `foundation-chat.mjs`
// (FOUNDATION_DAY_MS, FOUNDATION_TOTAL_DAYS, FOUNDATION_MAX_DAY_INDEX,
// computeFoundationDayFromStartedAt, resolveFoundationDayFromPayload) —
// imported above. Co-locating with FOUNDATION_DAYS keeps the day index
// contract single-sourced and lets `sidecar-tests/foundation-day.test.mjs`
// exercise the boundary cases without dragging in `index.mjs` side effects.

function currentBipConfig() {
  return readJsonFile(path.join(appSupportPath, "bip-config.json"));
}

function currentBipSetupGate() {
  return buildIddSetupGateStatus({
    workspaceRoot,
    iddSetupState: state.iddSetup,
    bipCoachState: state.bipCoach,
    bipConfig: currentBipConfig(),
  });
}

await fs.mkdir(appSupportPath, { recursive: true });
await ensureUserInputDirs(appSupportPath);
await clearUserInputArtifacts(appSupportPath);
await loadSessions();
state.bipCoach = mergeBipConfigIntoCoachState(
  await loadBipCoachState(bipCoachFilePath),
  currentBipConfig(),
);
state.bipCoach = syncBipCoachSessionState();
state.iddSetup = await loadIddSetupState(workspaceRoot);
await persistBipCoachState(bipCoachFilePath, state.bipCoach);
const telemetry = createTelemetryClient({ appSupportPath, workspaceRoot });
let fatalSidecarWriteInProgress = false;

function fireAndForget(operation, promise, properties = {}) {
  Promise.resolve(promise).catch((error) => {
    telemetry.captureException(error, {
      operation,
      ...properties,
    });
    writeSidecarCrashRecord("background_rejection", error, {
      operation,
      ...properties,
    });
  });
}

if (process.env.AGENTIC30_TEST_BACKGROUND_REJECTION === "1") {
  fireAndForget(
    "testBackgroundRejection",
    Promise.reject(new Error("Synthetic background rejection for sidecar resilience test")),
  );
}

function writeSidecarCrashRecord(phase, error, properties = {}) {
  const normalized = normalizeFatalError(error);
  const record = {
    at: new Date().toISOString(),
    phase,
    pid: process.pid,
    activeRunCount: state.activeRuns.size,
    activeSessionIds: [...state.activeRuns.keys()],
    error: normalized.message,
    stack: redactCrashText(normalized.stack),
    properties: sanitizeCrashProperties(properties),
  };
  try {
    fsSync.mkdirSync(appSupportPath, { recursive: true });
    fsSync.appendFileSync(
      path.join(appSupportPath, "sidecar-crashes.jsonl"),
      `${JSON.stringify(record)}\n`,
      { mode: 0o600 },
    );
  } catch {}
}

function normalizeFatalError(error) {
  if (error instanceof Error) {
    return {
      message: redactCrashText(error.message),
      stack: error.stack || "",
    };
  }
  return {
    message: redactCrashText(String(error)),
    stack: "",
  };
}

function sanitizeCrashProperties(properties = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (/token|secret|password|api[_-]?key|authorization/i.test(key)) {
      safe[key] = "[redacted]";
    } else if (typeof value === "string") {
      safe[key] = redactCrashText(value);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

function redactCrashText(text = "") {
  return String(text)
    .replace(/(token|secret|password|api[_-]?key|authorization)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 12_000);
}

function handleFatalSidecarError(phase, error) {
  if (fatalSidecarWriteInProgress) {
    process.exit(1);
  }
  fatalSidecarWriteInProgress = true;
  writeSidecarCrashRecord(phase, error);
  telemetry.captureException(error, { operation: phase }, false);
  setTimeout(() => process.exit(1), 25).unref?.();
}

process.on("uncaughtException", (error) => {
  handleFatalSidecarError("uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  handleFatalSidecarError("unhandledRejection", reason);
});
// Replay pending ritual after telemetry client exists. broadcast() may run
// even before any client connects — that's fine, the persisted pendingRitual
// stays until ack so reconnects also see it.
queueMicrotask(() => {
  try { replayPendingRitualOnBoot(); } catch { /* boot best-effort */ }
});

// R4 quarantine recovery — Mac client surface. Both helpers translate the
// pure domain in `quarantine-recovery.mjs` into WebSocket events. The Mac
// app receives them in AgenticViewModel.handleSidecarEvent().
async function broadcastQuarantineList(socket) {
  try {
    const files = await listQuarantinedFiles({ workspaceRoot });
    const items = [];
    for (const file of files) {
      const dump = await readQuarantineDump({ workspaceRoot, quarantinePath: file.path });
      items.push({
        file,
        dump: {
          ...dump,
          // The Mac client only needs a label per record, not the raw original
          // payload. Keep arbitrary user-shape JSON out of the wire.
          records: dump.records.map((entry) => ({
            index: entry.index,
            issues: entry.issues,
            proposal: entry.proposal,
            originalSummary: summarizeOriginalRecord(entry.original),
          })),
        },
    });
    }
    send(socket, { type: "rubric_quarantine_list", items });
  } catch (err) {
    send(socket, {
      type: "rubric_quarantine_error",
    stage: "list",
      message: err?.message || String(err),
    });
  }
}

// Round 6 / CCG-UX: Mac client passes only `honestModeReason` and the entry
// pointer; sidecar reads the quarantine dump, builds a fixedRecord that
// preserves original axis scores, and re-uses the existing restore path.
// This stops the Mac side from owning schema-shape decisions.
async function handleWeeklyRitualAck(payload) {
  const day = typeof payload?.day === "number" ? payload.day : undefined;
  state.bipCoach = acknowledgePendingRitual(state.bipCoach, { day });
  await persistBipCoachState(bipCoachFilePath, state.bipCoach);
}

async function handleQuarantineRestoreWithReason(socket, payload) {
  try {
    const dump = await readQuarantineDump({
    workspaceRoot,
      quarantinePath: payload?.quarantinePath,
    });
    const entry = dump.records.find((r) => r.index === payload?.recordIndex);
    if (!entry) throw new Error("recordIndex not found in quarantine dump");
    // The sanitized entry from MCP/Mac path drops `original` for privacy. We
    // need the raw original to preserve scores — read directly here.
    const rawDump = JSON.parse(
      await (await import("node:fs/promises")).readFile(dump.quarantinePath, "utf8"),
    );
    const rawEntry = rawDump.records?.[payload.recordIndex];
    if (!rawEntry) throw new Error("raw quarantine entry missing");
    const fixedRecord = proposeFixForEntry(
      { ...entry, original: rawEntry.original },
      payload?.honestModeReason ?? "",
    );
    const result = await restoreQuarantinedRecord({
    workspaceRoot,
      quarantinePath: dump.quarantinePath,
      recordIndex: payload?.recordIndex,
      fixedRecord,
      expectedMtimeMs: payload?.expectedMtimeMs,
    });
  telemetry.captureEvent("mac_sidecar_rubric_quarantine_restored_with_reason", {
      remaining: result.remainingInvalidCount,
      duplicateAvoided: result.duplicateAvoided ?? false,
    });
    send(socket, { type: "rubric_quarantine_restored", result });
    await broadcastQuarantineList(socket);
  } catch (err) {
    send(socket, {
      type: "rubric_quarantine_error",
    stage: "restore_with_reason",
      message: err?.message || String(err),
    });
  }
}

async function handleQuarantineRestore(socket, payload) {
  try {
    const result = await restoreQuarantinedRecord({
    workspaceRoot,
      quarantinePath: payload?.quarantinePath,
      recordIndex: payload?.recordIndex,
      fixedRecord: payload?.fixedRecord,
      expectedMtimeMs: payload?.expectedMtimeMs,
    });
  telemetry.captureEvent("mac_sidecar_rubric_quarantine_restored", {
      remaining: result.remainingInvalidCount,
    });
    send(socket, { type: "rubric_quarantine_restored", result });
    // Re-broadcast list so the Mac UI refreshes without a separate roundtrip.
    await broadcastQuarantineList(socket);
  } catch (err) {
    send(socket, {
      type: "rubric_quarantine_error",
    stage: "restore",
      message: err?.message || String(err),
    });
  }
}

function summarizeOriginalRecord(original) {
  if (!original || typeof original !== "object") return null;
  const sessionId = typeof original.sessionId === "string" ? original.sessionId : null;
  const day = typeof original.day === "number" ? original.day : null;
  if (sessionId && day != null) return `${sessionId} · Day ${day}`;
  if (sessionId) return sessionId;
  if (day != null) return `Day ${day}`;
  return null;
}

// Weekly ritual fold-in: applyCurriculumDayUpdate atomically updates
// `lastRitualDayObserved` so multi-session races on the same day cannot fire
// a ritual twice (Codex MEDIUM, see weekly-ritual.test.mjs). Telemetry emits
// once per crossed boundary; the user-facing prompt surface is wired in a
// follow-up PR — for now the boundary is observable via telemetry + state.
async function maybeFireWeeklyRitual(curriculumDay) {
  if (typeof curriculumDay !== "number" || !Number.isFinite(curriculumDay)) return;
  const next = applyCurriculumDayUpdate(state.bipCoach, { curriculumDay });
  if (!next.pendingRitual) return;
  const { pendingRitual, ...persistable } = next;
  state.bipCoach = persistable;
  await persistBipCoachState(bipCoachFilePath, state.bipCoach);
  telemetry.captureEvent("mac_sidecar_weekly_ritual_triggered", {
    day: pendingRitual.day,
  });
  // Round 6 / CCG-Codex: state persisted with pendingRitualKey, so a failed
  // broadcast leaves the prompt recoverable on next boot. Persist FIRST,
  // broadcast SECOND.
  broadcastPendingRitual(pendingRitual.day);
}

// Broadcasts a weekly_ritual_prompt event to every connected client. Idempotent
// — if no client is connected the prompt remains in `pendingRitualKey` and
// is replayed by `replayPendingRitualOnBoot()` (and any future re-connect).
function broadcastPendingRitual(day) {
  const prompt = buildRitualPrompt(day);
  if (!prompt) return;
  broadcast({
    type: "weekly_ritual_prompt",
    day,
    prompt,
  });
}

function maybeEmitCurriculumMiniActionTrigger({ session, prompt, payload = {} } = {}) {
  const event = buildMiniActionSessionTriggerEvent({
    sessionId: session?.id || "",
    day: resolveMiniActionDay(payload),
    curriculumDay: payload.curriculumDay,
    message: {
      role: "user",
      content: prompt,
      day: payload.foundationDay ?? payload.day,
      curriculumDay: payload.curriculumDay,
    },
  });
  if (!event) return null;

  broadcast(event);
  telemetry.captureEvent("mac_sidecar_curriculum_mini_action_triggered", {
    session_id: session?.id || "",
    day: event.day ?? -1,
    reason: event.trigger?.reason || "",
    coaching_mode: event.trigger?.coachingMode || "",
  });
  return event;
}

function resolveMiniActionDay(payload = {}) {
  return normalizeMiniActionDay(
    payload.curriculumDay?.day
      ?? payload.curriculumDay?.dayId
      ?? payload.curriculumDay?.day_id
      ?? payload.foundationDay
      ?? payload.day
      ?? state.bipCoach?.currentMission?.curriculumDay?.day
      ?? state.bipCoach?.currentMission?.curriculumDay?.dayId
      ?? state.bipCoach?.currentMission?.curriculumDay?.day_id,
  );
}

function normalizeMiniActionDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 1 && day <= 30 ? day : null;
}

// On sidecar boot, if state has a pending ritual that was never acknowledged,
// re-broadcast it. Codex flagged that the original "persist before emit"
// ordering meant a crash between persist and emit lost the prompt forever.
function replayPendingRitualOnBoot() {
  const day = state.bipCoach?.pendingRitualDay;
  if (typeof day !== "number" || !state.bipCoach?.pendingRitualKey) return;
  broadcastPendingRitual(day);
}
telemetry.captureEvent("mac_sidecar_booted", {
  session_count: state.sessions.size,
});
fireAndForget("refreshPersistedBipCoachReadinessOnBoot", refreshPersistedBipCoachReadinessOnBoot());
const userInputPoll = setInterval(() => {
  fireAndForget("syncPendingUserInputRequests", syncPendingUserInputRequests());
}, 250);

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
let shutdownStarted = false;
let clientDisconnectTimer = null;
let qmdBootstrapScheduled = false;
const parentProcessPoll = startParentProcessPoll();

wss.on("error", (error) => {
  telemetry.captureException(error, { operation: "websocket_server" });
  writeSidecarCrashRecord("websocket_server_error", error);
});

wss.on("connection", (socket, request) => {
  if (!isAllowedWebSocketOrigin(request?.headers?.origin)) {
    socket.close(1008, "Origin not allowed.");
    return;
  }

  let authenticated = false;
  const authTimer = setTimeout(() => {
    if (!authenticated) {
      socket.close(1008, "Authentication required.");
    }
  }, 5_000);
  authTimer.unref?.();

  socket.once("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch {
      socket.close(1008, "Invalid authentication payload.");
      return;
    }

    if (payload?.type !== "authenticate" || payload?.authToken !== sidecarAuthToken) {
      socket.close(1008, "Authentication failed.");
      return;
    }

    authenticated = true;
    clearTimeout(authTimer);
    registerAuthenticatedClient(socket);
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    if (authenticated) {
      state.clients.delete(socket);
      scheduleShutdownWhenClientless();
    }
  });
  socket.on("error", (error) => {
    clearTimeout(authTimer);
    state.clients.delete(socket);
    telemetry.captureException(error, { operation: "websocket_client" });
    scheduleShutdownWhenClientless();
  });
});

function registerAuthenticatedClient(socket) {
  clearClientDisconnectTimer();
  const authenticatedPerf = performance.now();
  socket.agentic30AuthenticatedAt = authenticatedPerf;
  socket.agentic30AuthenticatedAtIso = new Date().toISOString();
  sidecarBootTiming.lastClientAuthenticatedAt = socket.agentic30AuthenticatedAtIso;
  sidecarBootTiming.lastClientAuthenticatedPerf = authenticatedPerf;
  sidecarBootTiming.processToLastClientAuthenticatedMs = Math.max(
    0,
    Math.round(authenticatedPerf - sidecarProcessStartedAt),
  );
  state.clients.add(socket);
  const environment = getEnvironmentSummary();
  const preflight = buildSidecarPreflight(environment);
  send(socket, {
    type: "ready",
    sessions: serializeSessions(),
    environment,
    workspaceRoot,
    notionConnected: isNotionConnected(),
    diagnostics: buildSidecarDiagnostics(environment, preflight),
    bipCoach: state.bipCoach,
  });
  scheduleQmdMemoryBootstrap();

  socket.on("message", async (raw) => {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch {
      telemetry.captureException(new Error("Invalid JSON payload"), {
        operation: "handleClientMessage",
        message_type: "invalid_json",
    });
      send(socket, { type: "error", message: "Invalid JSON payload." });
      return;
    }

    try {
      await handleClientMessage(socket, payload);
    } catch (error) {
      telemetry.captureException(error, {
        operation: "handleClientMessage",
        session_id: payload?.sessionId || "",
        message_type: payload?.type || "unknown",
    });
      send(socket, {
        type: "error",
        sessionId: payload?.sessionId,
        message: formatError(error),
    });
    }
  });
}

wss.on("listening", () => {
  const address = wss.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const readyPerf = performance.now();
  sidecarBootTiming.sidecarReadyAt = new Date().toISOString();
  sidecarBootTiming.sidecarReadyPerf = readyPerf;
  sidecarBootTiming.processToSidecarReadyMs = Math.max(
    0,
    Math.round(readyPerf - sidecarProcessStartedAt),
  );
  process.stdout.write(
    `${JSON.stringify({ type: "sidecar-ready", port, pid: process.pid, authToken: sidecarAuthToken })}\n`,
  );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  clearClientDisconnectTimer();
  clearInterval(parentProcessPoll);
  clearInterval(userInputPoll);
  for (const run of state.activeRuns.values()) {
    run.abortController.abort();
    await run.stop?.();
  }
  for (const run of state.warmRuns.values()) {
    run.abortController.abort();
  }
  for (const run of state.providerAuthRuns.values()) {
    try { run.child.kill("SIGTERM"); } catch {}
  }
  wss.close();
  process.exit(0);
}

function startParentProcessPoll() {
  const parentPid = Number.parseInt(process.env.AGENTIC30_PARENT_PID || "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 1) {
    return null;
  }

  return setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") {
        fireAndForget("shutdown.parent_process_missing", shutdown());
    }
    }
  }, 1_000);
}

function scheduleShutdownWhenClientless() {
  if (state.clients.size > 0 || clientDisconnectTimer) {
    return;
  }

  clientDisconnectTimer = setTimeout(() => {
    clientDisconnectTimer = null;
    if (state.clients.size === 0) {
      fireAndForget("shutdown.clientless", shutdown());
    }
  }, 1_500);
}

function clearClientDisconnectTimer() {
  if (!clientDisconnectTimer) {
    return;
  }
  clearTimeout(clientDisconnectTimer);
  clientDisconnectTimer = null;
}

function isAllowedWebSocketOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(String(origin));
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function handleClientMessage(socket, payload) {
  switch (payload.type) {
    case "list_sessions":
      send(socket, { type: "sessions_snapshot", sessions: serializeSessions() });
      return;
    case "curriculum_feature_surface": {
      const result = emitInlineHintTriggerForFeatureAppearance({
        state: state.curriculumInlineHintState,
        featureId: payload.featureId ?? payload.feature_id,
        surface: payload.surface,
        metadata: payload.metadata,
        emit: (event) => broadcast(event),
      });
      state.curriculumInlineHintState = result.state;
      if (result.emitted) {
        telemetry.captureEvent("mac_sidecar_curriculum_inline_hint_triggered", {
          feature_id: result.featureId,
          surface: payload.surface || "",
        });
      }
      send(socket, {
        type: "curriculum_feature_surface_recorded",
        featureId: result.featureId,
        feature_id: result.featureId,
        emitted: result.emitted,
        reason: result.reason,
      });
      return;
    }
    case "create_session": {
      const createStartedAt = performance.now();
      const session = createSession(payload);
      const bootstrapStartedAt = performance.now();
      if (payload.suppressBootstrapIntake !== true) {
        await attachBootstrapIntake(session);
      }
      const bootstrapElapsedMs = Math.max(0, Math.round(performance.now() - bootstrapStartedAt));
      state.sessions.set(session.id, session);
      setSessionStartupTiming(session, {
        createStartedAt,
        bootstrapElapsedMs,
        clientSocket: socket,
    });
      const persistStartedAt = performance.now();
      await persistSessions();
      const persistElapsedMs = Math.max(0, Math.round(performance.now() - persistStartedAt));
      const syncStartedAt = performance.now();
      await syncAndBroadcastBipCoachSessionState({ preferredSessionId: session.id });
      setSessionStartupTiming(session, {
        createStartedAt,
        bootstrapElapsedMs,
        persistElapsedMs,
        bipCoachSyncElapsedMs: Math.max(0, Math.round(performance.now() - syncStartedAt)),
        clientSocket: socket,
    });
      await persistSessions();
      telemetry.captureEvent("mac_sidecar_session_created", {
        session_id: session.id,
        provider: session.provider,
        process_to_session_created_ms: session.runtime?.startupTiming?.processToSessionCreatedMs,
        create_session_elapsed_ms: session.runtime?.startupTiming?.createSessionElapsedMs,
    });
      broadcast({ type: "session_created", session });
      return;
    }
    case "delete_session": {
      const session = getSession(payload.sessionId);
      await stopSession(session.id);
      cancelWarmSession(session.id);
      state.sessions.delete(session.id);
      await persistSessions();
      await syncAndBroadcastBipCoachSessionState();
      telemetry.captureEvent("mac_sidecar_session_deleted", {
        session_id: session.id,
        provider: session.provider,
    });
      broadcast({ type: "session_deleted", sessionId: session.id });
      return;
    }
    case "archive_session": {
      const session = getSession(payload.sessionId);
      await stopSession(session.id);
      cancelWarmSession(session.id);
      session.archivedAt = typeof payload.archivedAt === "string"
        ? payload.archivedAt
        : new Date().toISOString();
    session.status = "idle";
      session.error = null;
    touch(session);
      await persistSessions();
      await syncAndBroadcastBipCoachSessionState();
      telemetry.captureEvent("mac_sidecar_session_archived", {
        session_id: session.id,
        provider: session.provider,
    });
    broadcast({ type: "session_updated", session });
      return;
    }
    case "rename_session": {
      const session = getSession(payload.sessionId);
      session.title = String(payload.title || "Untitled Session").trim() || "Untitled Session";
    touch(session);
      await persistSessions();
    broadcast({ type: "session_updated", session });
      return;
    }
    case "stop_session": {
      const session = getSession(payload.sessionId);
      await stopSession(session.id);
      cancelWarmSession(session.id);
    session.status = "idle";
      session.error = null;
    touch(session);
      await persistSessions();
      telemetry.captureEvent("mac_sidecar_session_stopped", {
        session_id: session.id,
        provider: session.provider,
    });
    broadcast({ type: "session_updated", session });
      return;
    }
    case "warm_session": {
      const session = getSession(payload.sessionId);
      fireAndForget("warmSession", warmSession(session), {
        session_id: session.id,
        provider: session.provider,
    });
      return;
    }
    case "send_prompt": {
      const session = getSession(payload.sessionId);
      if (session.pendingUserInput) {
        throw new Error("This session is waiting for structured input.");
    }
      const prompt = String(payload.prompt || "").trim();
      if (!prompt) {
        telemetry.captureEvent("mac_sidecar_prompt_rejected", {
          session_id: session.id,
          provider: session.provider,
          reason: "empty_prompt",
        });
        send(socket, {
          type: "error",
          sessionId: session.id,
          message: "Prompt is empty.",
        });
        return;
      }
      markWorkspaceSetupFirstInput("prompt");
      const miniActionEvent = maybeEmitCurriculumMiniActionTrigger({ session, prompt, payload });
      const executionIntent = miniActionEvent
        ? MINI_ACTION_EXECUTION_ONLY_INTENT
        : payload.executionIntent;
      // Sub-AC 2.3 IPC reconciliation: when the Swift host classifies a
      // message as Foundation Day daily-task (`mode: "daily_task"`), funnel
      // it through the unified Foundation chat handler so the single chat
      // surface contract (AC 3) holds even though the wire-level type tag
      // is still "send_prompt". This keeps backward compat with older host
      // builds while letting newer hosts emit `foundation_chat` directly.
      const declaredMode = typeof payload.mode === "string" ? payload.mode.trim() : "";
      const isDailyTask = declaredMode === "daily_task";
      if (isDailyTask) {
        const resolvedDay = resolveFoundationDayFromPayload({
          ...payload,
          day: payload.foundationDay ?? payload.day,
        });
        const dayDescriptor = resolvedDay !== null ? getFoundationDay(resolvedDay) : null;
        if (!dayDescriptor) {
          telemetry.captureEvent("mac_sidecar_foundation_chat_rejected", {
            session_id: session.id,
            provider: session.provider,
            reason: "invalid_day",
            transport: "send_prompt_bridge",
            day: payload.foundationDay ?? payload.day ?? null,
            started_at: payload.foundationStartedAt || payload.startedAt || null,
          });
          emitFoundationChatEvent({
            sessionId: session.id,
            day: null,
            phase: "rejected",
            reason: "invalid_day",
            transport: "send_prompt_bridge",
          });
          send(socket, {
            type: "error",
            sessionId: session.id,
            message: "Foundation day must be in range 0-7.",
          });
          return;
        }
        if (state.activeRuns.has(session.id)) {
          await enqueuePrompt(session, prompt, {
            executionIntent: "foundation_chat",
          });
          return;
        }
        cancelWarmSession(session.id);
        await runUnifiedFoundationChat(session, prompt, {
          day: dayDescriptor.day,
          dynamicVariables: payload.dynamicVariables,
          evidenceRefs: payload.evidenceRefs,
          workspace: payload.workspace,
          transport: "send_prompt_bridge",
        });
        return;
    }
      if (state.activeRuns.has(session.id)) {
        await enqueuePrompt(session, prompt, {
          executionIntent,
        });
        return;
    }
      cancelWarmSession(session.id);
      await runPrompt(session, prompt, {
        executionIntent,
    });
      return;
    }
    case "foundation_first_prompt": {
      // AI-driven daily first prompt generator (Foundation Day 0/2-7).
      // Returns the 3-section minimal opener (yesterday / today / question)
      // for the requested day, with dynamic variables substituted.
      // No session mutation, no provider call — pure read.
      const dayDescriptor = getFoundationDay(payload.day);
      if (!dayDescriptor) {
        telemetry.captureEvent("mac_sidecar_foundation_first_prompt_rejected", {
          reason: "invalid_day",
          day: payload.day ?? null,
          session_id: payload.sessionId || "",
        });
        send(socket, {
          type: "error",
          sessionId: payload.sessionId,
          message: "Foundation day must be in range 0-7.",
        });
        return;
    }
      const firstPrompt = buildFirstPromptForDay({
        day: dayDescriptor.day,
        dynamicVariables: payload.dynamicVariables,
    });
      if (!firstPrompt) {
        telemetry.captureEvent("mac_sidecar_foundation_first_prompt_rejected", {
          reason: "unsupported_day",
          day: dayDescriptor.day,
          session_id: payload.sessionId || "",
        });
        send(socket, {
          type: "error",
          sessionId: payload.sessionId,
          message: "Foundation Day 1 uses the OpenDesign Day page and does not create a chat opener.",
        });
        return;
    }
      telemetry.captureEvent("mac_sidecar_foundation_first_prompt_built", {
        session_id: payload.sessionId || "",
        day: dayDescriptor.day,
        sub_workflow: dayDescriptor.sub_workflow || "",
        spec_version: dayDescriptor.spec_version || "",
    });
      send(socket, {
        type: "foundation_first_prompt",
        sessionId: payload.sessionId,
        day: dayDescriptor.day,
        firstPrompt,
    });
      return;
    }
    case "foundation_chat": {
      // Unified Foundation Phase Day 0-7 chat endpoint.
      // No mode-based branching is exposed to the caller — the same single
      // AI interaction channel handles every Day and every sub-workflow.
      // Sub-workflow selection happens internally via Foundation context.
      const session = getSession(payload.sessionId);
      if (session.pendingUserInput) {
        throw new Error("This session is waiting for structured input.");
    }
      const prompt = String(payload.prompt || "").trim();
      if (!prompt) {
        telemetry.captureEvent("mac_sidecar_foundation_chat_rejected", {
          session_id: session.id,
          provider: session.provider,
          reason: "empty_prompt",
          transport: "foundation_chat",
        });
        emitFoundationChatEvent({
          sessionId: session.id,
          day: null,
          phase: "rejected",
          reason: "empty_prompt",
          transport: "foundation_chat",
        });
        send(socket, {
          type: "error",
          sessionId: session.id,
          message: "Prompt is empty.",
        });
        return;
    }
      // Resolve the Foundation day with the wall-clock anchor as fallback.
      // The host normally sends an explicit `day`, but sidecar-driven
      // re-entry (queued prompts, warmstart) may carry only the
      // `foundationStartedAt` ISO. `resolveFoundationDayFromPayload` keeps
      // both paths in sync and clamps clock-skew to Day 0.
      const resolvedDay = resolveFoundationDayFromPayload(payload);
      const dayDescriptor = resolvedDay !== null ? getFoundationDay(resolvedDay) : null;
      if (!dayDescriptor) {
        telemetry.captureEvent("mac_sidecar_foundation_chat_rejected", {
          session_id: session.id,
          provider: session.provider,
          reason: "invalid_day",
          transport: "foundation_chat",
          day: payload.day ?? null,
          started_at: payload.foundationStartedAt || payload.startedAt || null,
        });
        emitFoundationChatEvent({
          sessionId: session.id,
          day: null,
          phase: "rejected",
          reason: "invalid_day",
          transport: "foundation_chat",
        });
        send(socket, {
          type: "error",
          sessionId: session.id,
          message: "Foundation day must be in range 0-7.",
        });
        return;
    }
      if (state.activeRuns.has(session.id)) {
        await enqueuePrompt(session, prompt, {
          executionIntent: "foundation_chat",
        });
        return;
    }
      cancelWarmSession(session.id);
      await runUnifiedFoundationChat(session, prompt, {
        day: dayDescriptor.day,
        dynamicVariables: payload.dynamicVariables,
        evidenceRefs: payload.evidenceRefs,
        workspace: payload.workspace,
        transport: "foundation_chat",
    });
      return;
    }
    case "submit_user_input": {
      const session = getSession(payload.sessionId);
      const requestId = String(payload.requestId || "").trim();
      if (!requestId || session.pendingUserInput?.requestId !== requestId) {
        throw new Error("No matching structured input request is waiting for this session.");
    }
      const pendingIddContinuation = session.runtime?.pendingIddContinuation;
      const pendingIddContinuationDocType = pendingIddContinuation?.requestId === requestId
        ? String(pendingIddContinuation.docType || "")
        : "";
      const iddProgressStartedAt = Date.now();
      const broadcastIddSubmitProgress = (stage, progressText, docType = pendingIddContinuationDocType) => {
        if (!docType) return;
        broadcast({
          type: "idd_setup_progress",
          sessionId: session.id,
          requestId,
          docType: docType || "",
          stage,
          progressText,
          elapsedMs: Date.now() - iddProgressStartedAt,
        });
      };
      const response = normalizeUserInputResponse(session.pendingUserInput, payload);
      const missingRequiredFreeText = findMissingRequiredFreeTextQuestion(response);
      if (missingRequiredFreeText) {
        broadcastIddSubmitProgress(
          "validation_error",
          "선택지를 고르거나 기타를 입력해야 다음 질문으로 넘어갑니다.",
        );
        session.status = "awaiting_input";
        session.error = null;
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
        return;
      }
      const {
        prompt: iddContinuationPrompt,
        docType: iddContinuationDocType,
        hostGenerated: iddContinuationHostGenerated,
      } = takePendingIddContinuationPrompt(session, requestId);
      let iddContinuationPromptForRun = iddContinuationHostGenerated ? "" : iddContinuationPrompt;
      let iddContinuationDocTypeForRun = iddContinuationDocType;
      let iddContinuationTerminal = false;
      const userResponseText = formatStructuredPromptResponse(response);
      // Resolve the picked option(s) back to their description text so the IDD
      // gate sees label + description in calculateIddAmbiguityRubric. Labels
      // alone almost never carry the rubric keywords; descriptions reliably
      // do, so this lets a single click advance the signal instead of always
      // needing the repeated-answer auto-pass fallback.
      const userResponseDescription = collectSelectedOptionDescriptions(
        session.pendingUserInput,
        response,
      );
      // Capture signalId/signalLabel from the structured input the user is
      // answering so the transcript entry can carry rubric-dimension lineage
      // for the next follow-up's dimension-transition stamp (F6).
      const answeredGeneration = session.pendingUserInput?.generation || null;
      const answeredSignalId = answeredGeneration?.signalId ? String(answeredGeneration.signalId) : null;
      const answeredSignalLabel = answeredGeneration?.signalLabel ? String(answeredGeneration.signalLabel) : null;
      broadcastIddSubmitProgress("accepted", "답변 저장됨");
      if (userResponseText) {
        markWorkspaceSetupFirstInput("structured_input");
    }
      if (userResponseText) {
        session.messages.push(
          makeMessage({
            role: "user",
            provider: session.provider,
            content: userResponseText,
            state: "final",
          }),
        );
    }
      const hasActiveRun = state.activeRuns.has(session.id);
      await writeUserInputResponse(appSupportPath, {
        sessionId: session.id,
      requestId,
        response,
    });
      if (!hasActiveRun) {
        await deleteUserInputArtifacts(appSupportPath, session.id, requestId);
    }

      state.resolvedUserInputIds.add(requestId);
      session.pendingUserInput = null;
      session.status = hasActiveRun || Boolean(iddContinuationPromptForRun) ? "running" : "idle";
      touch(session);

      if (iddContinuationDocType) {
        const completedDoc = IDD_FOUNDATION_DOCS.find((doc) => doc.type === iddContinuationDocType)
          || requiredDocByType(iddContinuationDocType);
        broadcastIddSubmitProgress(
          "recording_response",
          `${completedDoc.title} 문서에 반영 중`,
          completedDoc.type,
        );
        state.iddSetup = await persistIddSetupState(
          workspaceRoot,
          recordIddStructuredResponse(state.iddSetup, {
            doc: completedDoc,
            provider: session.provider,
            responseText: userResponseText,
            responseDescription: userResponseDescription,
            signalId: answeredSignalId,
            signalLabel: answeredSignalLabel,
          }),
        );
        if (session.runtime?.iddMode === "day1_handoff") {
          const normalizedIdd = normalizeIddSetupState(state.iddSetup);
          const docRubric = normalizedIdd.ambiguityRubric?.docs?.find((entry) => entry.type === completedDoc.type);
          const followupCount = Number.parseInt(session.runtime?.day1HandoffFollowupCount ?? 0, 10) || 0;
          const shouldAskFollowup = docRubric?.blocked && followupCount < 2;
          if (shouldAskFollowup) {
            session.runtime = {
              ...(session.runtime || {}),
              iddMode: "day1_handoff",
              day1HandoffFollowupCount: followupCount + 1,
            };
            broadcastIddSubmitProgress("routing_followup", "문서 저장 전 빠진 근거를 한 번 더 묻는 중", completedDoc.type);
            await createHostIddQuestionRequest(session, completedDoc, {
              previousRequestId: requestId,
              progressText: "Day 1 문서 보완 질문 준비 완료",
              iddMode: "day1_handoff",
              titlePrefix: "Day 1 Handoff",
            });
            await persistSessions();
            broadcast({
              type: "idd_setup_state",
              ...serializeIddSetupFields(state.iddSetup),
              ...serializeBipSetupGate(currentBipSetupGate()),
            });
            broadcast({ type: "session_updated", session });
            return;
          }

          broadcastIddSubmitProgress("writing_file", `${completedDoc.canonicalPath} 저장 중`, completedDoc.type);
          state.iddSetup = await writeDay1HandoffDocument(workspaceRoot, state.iddSetup, completedDoc, {
            day1Handoff: session.runtime?.day1Handoff || {},
          });
          const writtenPreview = serializeIddSetupFields(state.iddSetup).iddDocPreviews
            ?.find((preview) => preview.type === completedDoc.type);
          const writtenStatus = writtenPreview?.status || "written";
          broadcastIddSubmitProgress("file_written", `${completedDoc.canonicalPath} 저장 완료`, completedDoc.type);
          session.runtime = {
            ...(session.runtime || {}),
            pendingIddContinuation: null,
            iddPendingAdaptiveContinuation: null,
            day1HandoffFollowupCount: 0,
          };
          session.messages.push(makeMessage({
            role: "assistant",
            provider: session.provider,
            content: `${completedDoc.title} 문서를 ${completedDoc.canonicalPath}에 저장했습니다. 상태: ${writtenStatus}.`,
            state: "final",
          }));
          session.status = "idle";
          session.error = null;
          touch(session);
          telemetry.captureEvent("mac_sidecar_day1_doc_handoff_written", {
            session_id: session.id,
            provider: session.provider,
            doc_type: completedDoc.type,
            doc_path: completedDoc.canonicalPath,
            status: writtenStatus,
          });
          broadcast({
            type: "idd_setup_state",
            ...serializeIddSetupFields(state.iddSetup),
            ...serializeBipSetupGate(currentBipSetupGate()),
          });
          broadcastBipSetupGateState(currentBipSetupGate());
          await persistSessions();
          broadcast({ type: "session_updated", session });
          return;
        }
        const nextDoc = selectNextIddAdaptiveDoc(state.iddSetup, completedDoc);
        broadcastIddSubmitProgress("routing_followup", "다음 질문 카드를 준비 중", nextDoc?.type || completedDoc.type);
        if (nextDoc) {
          await createHostIddQuestionRequest(session, nextDoc, {
            previousRequestId: requestId,
            progressText: "다음 질문 카드 준비 완료",
          });
          iddContinuationPromptForRun = "";
          iddContinuationDocTypeForRun = nextDoc.type;
        } else {
          broadcastIddSubmitProgress("preview_ready", "문서 미리보기 준비 완료", completedDoc.type);
          session.runtime = {
            ...(session.runtime || {}),
            pendingIddContinuation: null,
            iddPendingAdaptiveContinuation: null,
          };
          if (!hasActiveRun) {
            session.messages.push(makeMessage({
              role: "assistant",
              provider: session.provider,
              content: "Foundation Setup preview is ready. Review the four documents and approve them before Day 1 Mission unlocks.",
              state: "final",
            }));
          }
          session.status = hasActiveRun ? "running" : "idle";
          iddContinuationTerminal = true;
          touch(session);
        }
        telemetry.captureEvent("mac_sidecar_idd_setup_answer_recorded", {
          session_id: session.id,
          provider: session.provider,
          doc_type: iddContinuationDocType,
          status: state.iddSetup.status,
          ambiguity_score: state.iddSetup.ambiguityScore,
        });
        broadcast({
          type: "idd_setup_state",
          ...serializeIddSetupFields(state.iddSetup),
          ...serializeBipSetupGate(currentBipSetupGate()),
        });
        if (iddContinuationTerminal) {
          await persistSessions();
          broadcast({ type: "session_updated", session });
          return;
        }
        if (nextDoc) {
          await persistSessions();
          broadcast({ type: "session_updated", session });
          return;
        }
    }

      await persistSessions();
      telemetry.captureEvent("mac_sidecar_structured_input_received", {
        session_id: session.id,
        provider: session.provider,
        request_id: requestId,
        response_count: Array.isArray(payload.responses) ? payload.responses.length : 0,
    });
    broadcast({ type: "session_updated", session });
      const hasSelectedStructuredOption = response.responses?.some((entry) => entry.selectedOptions?.length);
      if (!hasActiveRun && !iddContinuationPromptForRun && hasSelectedStructuredOption) {
        await appendVisibleAssistantMessage(
          session.id,
          buildStructuredInputConfirmation(response),
        );
        return;
    }
      if (!hasActiveRun && (userResponseText || iddContinuationPromptForRun)) {
        let continuationSpecialistInjection = "";
        let continuationSelection = null;
        if (iddContinuationPromptForRun) {
          const continuationDoc = iddContinuationDocTypeForRun
            ? requiredDocByType(iddContinuationDocTypeForRun)
            : null;
          continuationSelection = selectSpecialist({
            bipSetupGate: currentBipSetupGate(),
            doc: continuationDoc,
            lastAnswer: userResponseText,
          });
          continuationSpecialistInjection = buildSpecialistInjection(continuationSelection, {
            provider: session.provider,
          });
          telemetry.captureEvent("mac_sidecar_specialist_routed", {
            session_id: session.id,
            stage: "idd_continuation",
            specialist_id: continuationSelection.id,
            phase: continuationSelection.phase,
            decision_kind: continuationSelection.decisionKind,
            doc_type: iddContinuationDocTypeForRun || "",
            vendor_used: Boolean(
              continuationSelection?.vendor?.claude?.exists
                && continuationSelection?.vendor?.codex?.exists,
            ),
          });
        }
        await runPrompt(
          session,
          iddContinuationPromptForRun
            ? buildIddContinuationPrompt({
                iddPrompt: iddContinuationPromptForRun,
                structuredResponseText: userResponseText,
                specialistInjection: continuationSpecialistInjection,
              })
            : userResponseText,
          {
            displayUserMessage: false,
            defaultTitle: session.title,
            specialist: continuationSelection,
          },
        );
      }
      return;
    }
    case "curriculum_answer_saved": {
      try {
        const log = await appendCurriculumAnswer({
          workspaceRoot,
          answer: payload,
        });
        send(socket, {
          type: "curriculum_answer_saved_result",
          success: true,
          day: payload.day ?? payload.dayNumber ?? null,
          answerCount: log.records.length,
        });
        telemetry.captureEvent("mac_sidecar_curriculum_answer_saved", {
          day: Number.parseInt(payload.day ?? payload.dayNumber ?? 0, 10) || 0,
          has_freeform: Boolean(payload.freeformAnswer || payload.freeform),
          dimension: String(payload.dimension || "").slice(0, 80),
        });
      } catch (error) {
        telemetry.captureException(error, {
          operation: "curriculum_answer_saved",
        });
        send(socket, {
          type: "curriculum_answer_saved_result",
          success: false,
          error: formatError(error),
        });
      }
      return;
    }
    case "project_context_refresh": {
      fireAndForget(
        "project_context_refresh",
        refreshProjectContextFromRequest(payload),
        {
          reason: payload.reason || "",
          completed_day: payload.completedDay ?? payload.completed_day ?? null,
        },
      );
      return;
    }
    case "news_market_radar_get": {
      const exaRoutes = resolveNewsMarketRadarExaRoutes({
        preferredProvider: payload.preferredProvider,
      });
      const snapshot = await loadNewsMarketRadarSnapshot({
        workspaceRoot,
        exaApiKey: currentExaApiKey(),
        exaConfigured: exaRoutes.length > 0,
        exaResearchSource: exaRoutes[0]?.label || null,
      });
      send(socket, {
        type: "news_market_radar_result",
        newsMarketRadar: snapshot,
      });
      if (state.newsMarketRadarRefreshPromise && state.newsMarketRadarProgress) {
        send(socket, {
          type: "news_market_radar_status",
          status: state.newsMarketRadarProgress,
        });
      }
      return;
    }
    case "news_market_radar_refresh": {
      scheduleNewsMarketRadarRefresh({
        reason: payload.reason || "manual",
        force: Boolean(payload.force),
        preferredProvider: payload.preferredProvider,
        targetSocket: socket,
      });
      return;
    }
    case "bip_research_get": {
      const dayNumber = Number.parseInt(payload.dayNumber ?? payload.day ?? 1, 10) || 1;
      const exaRoutes = resolveNewsMarketRadarExaRoutes({
        preferredProvider: payload.preferredProvider,
      });
      const snapshot = await loadBipResearchSnapshot({
        workspaceRoot,
        dayNumber,
        curriculumDay: payload.curriculumDay,
        bipConfig: currentBipConfig(),
        onboardingHypothesis: state.workspaceOnboardingHypothesis,
        exaApiKey: currentExaApiKey(),
        exaConfigured: exaRoutes.length > 0,
        exaResearchSource: exaRoutes[0]?.label || null,
      });
      send(socket, {
        type: "bip_research_result",
        bipResearch: snapshot,
      });
      if (state.bipResearchRefreshPromise && state.bipResearchProgress) {
        send(socket, {
          type: "bip_research_status",
          status: state.bipResearchProgress,
        });
      }
      return;
    }
    case "bip_research_refresh": {
      scheduleBipResearchRefresh({
        reason: payload.reason || "manual",
        force: Boolean(payload.force),
        preferredProvider: payload.preferredProvider,
        dayNumber: payload.dayNumber ?? payload.day ?? 1,
        curriculumDay: payload.curriculumDay,
        targetSocket: socket,
      });
      return;
    }
    case "scan_workspace": {
      const root = String(payload.root || "").trim();
      if (!root) {
        telemetry.captureEvent("mac_sidecar_workspace_scan_rejected", {
          reason: "missing_root",
        });
        send(socket, { type: "error", message: "Workspace root is required for scan." });
        return;
    }
      markWorkspaceSetupStarted(root);
      const rootStat = await fs.stat(root).catch(() => null);
      if (!rootStat?.isDirectory()) {
        const error = Object.assign(new Error("Workspace root is not a directory."), {
          code: "invalid_workspace_root",
        });
        telemetry.captureEvent("mac_sidecar_workspace_scan_rejected", {
          reason: "invalid_root",
        });
        markWorkspaceSetupFailed(root, error);
        broadcast({
          type: "workspace_scan_result",
          scanRoot: root,
          error: error.message,
          stage: "failed",
          stepIndex: 1,
          totalSteps: 3,
          foundCount: 0,
        });
        return;
    }
      broadcast({
        type: "workspace_scan_started",
        scanRoot: root,
        progressText: "scan.local · Day 1 ICP 질문 신호를 읽는 중",
        stage: "local",
        stepIndex: 1,
        totalSteps: 3,
        etaSeconds: 45,
    });
      runWorkspaceScan(root, {
        sessionId: payload.sessionId,
        prompt: payload.prompt,
    });
      return;
    }
    case "create_doc": {
      const docType = String(payload.docType || "").trim();
      const root = String(payload.root || "").trim();
      if (!docType || !root) {
        telemetry.captureEvent("mac_sidecar_doc_creation_rejected", {
          reason: "missing_arguments",
          doc_type: docType || "",
        });
        send(socket, { type: "error", message: "docType and root are required for create_doc." });
        return;
    }
      broadcast({ type: "doc_creation_started", docType });
      runCreateDoc(root, docType);
      return;
    }
    case "bip_coach_get_state": {
      send(socket, { type: "bip_coach_state", bipCoach: state.bipCoach });
      return;
    }
    case "bip_coach_configure": {
      clearValidationCache();
      await configureBipCoach(payload);
      return;
    }
    case "bip_coach_refresh_evidence": {
      await refreshBipCoachEvidence();
      return;
    }
    case "bip_coach_generate_mission": {
      await maybeFireWeeklyRitual(payload.curriculumDay);
      await generateBipCoachMission({
        sessionId: payload.sessionId,
        provider: payload.provider,
        compact: Boolean(payload.compact),
        curriculumDay: payload.curriculumDay,
        localEvidence: payload.localEvidence,
    });
      return;
    }
    case "bip_setup_gate_check": {
      const gate = currentBipSetupGate();
      broadcastBipSetupGateState(gate);
      if (payload.autoStart === true && shouldAutoStartIddDocumentQueue(gate)) {
        await startIddDocumentQueue({
          gate,
          sessionId: payload.sessionId,
          provider: payload.provider,
          localEvidence: payload.localEvidence,
        });
    }
      return;
    }
    case "bip_idd_start_queue": {
      const gate = currentBipSetupGate();
      await startIddDocumentQueue({
        gate,
        sessionId: payload.sessionId,
        provider: payload.provider,
        requestedDocType: payload.docType,
    });
      return;
    }
    case "day1_doc_handoff_start": {
      await startDay1DocHandoff({
        sessionId: payload.sessionId,
        provider: payload.provider,
        requestedDocType: payload.docType,
        localEvidence: payload.localEvidence,
        day1Handoff: payload.day1Handoff,
      });
      return;
    }
    case "day1_doc_handoff_write_all": {
      await writeAllDay1DocHandoff({
        sessionId: payload.sessionId,
        provider: payload.provider,
        day1Handoff: payload.day1Handoff,
      });
      return;
    }
    case "idd_setup_approve": {
      state.iddSetup = await approveIddSetupDocuments(workspaceRoot, state.iddSetup);
      const session = payload.sessionId ? resolveBipCoachSession(payload.sessionId) : null;
      if (session) {
        session.messages.push(makeMessage({
          role: "assistant",
          provider: session.provider,
          content: buildIddApprovalSummary(state.iddSetup),
          state: "final",
        }));
        session.status = "idle";
        session.error = null;
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
    }
      broadcast({
        type: "idd_setup_approved",
        ...serializeIddSetupFields(state.iddSetup),
        ...serializeBipSetupGate(currentBipSetupGate()),
    });
      broadcastBipSetupGateState(currentBipSetupGate());
      return;
    }
    case "bip_coach_select_mission": {
      await selectBipCoachMission({
        sessionId: payload.sessionId,
        missionId: payload.missionId,
    });
      return;
    }
    case "bip_coach_complete_mission": {
      await completeCurrentBipCoachMission(payload);
      return;
    }
    case "notion_start_oauth": {
      runNotionOAuth();
      return;
    }
    case "notion_oauth_callback": {
      const code = String(payload.code || "").trim();
      if (!code) {
        telemetry.captureEvent("mac_sidecar_notion_oauth_rejected", {
          reason: "missing_code",
        });
        send(socket, { type: "error", message: "OAuth callback missing authorization code." });
        return;
    }
      completeNotionOAuth(code);
      return;
    }
    case "notion_disconnect": {
      disconnectNotion();
      return;
    }
    case "set_auth_context": {
      const auth = setAuthContext(payload);
      send(socket, { type: "auth_context_updated", auth });
      return;
    }
    case "clear_auth_context": {
      clearAuthContext();
      send(socket, {
        type: "auth_context_updated",
        auth: getAuthContextSummary(),
    });
      return;
    }
    case "bip_readiness_action": {
      await handleBipReadinessAction(payload);
      return;
    }
    case "provider_auth_login_start": {
      await startProviderAuthLogin(payload);
      return;
    }
    case "provider_settings_update": {
      updateProviderSettings(payload.providers || {});
      updateIntegrationSettings(payload.integrations || {});
      const environment = getEnvironmentSummary();
      const preflight = buildSidecarPreflight(environment);
      send(socket, {
        type: "diagnostics_snapshot",
        diagnostics: buildSidecarDiagnostics(environment, preflight),
      });
      return;
    }
    case "get_diagnostics": {
      const environment = getEnvironmentSummary();
      const preflight = buildSidecarPreflight(environment);
      send(socket, {
        type: "diagnostics_snapshot",
        diagnostics: buildSidecarDiagnostics(environment, preflight),
    });
      return;
    }
    case "rubric_quarantine_list_request": {
      await broadcastQuarantineList(socket);
      return;
    }
    case "rubric_quarantine_restore": {
      await handleQuarantineRestore(socket, payload);
      return;
    }
    case "rubric_quarantine_restore_with_reason": {
      await handleQuarantineRestoreWithReason(socket, payload);
      return;
    }
    case "weekly_ritual_acknowledged": {
      await handleWeeklyRitualAck(payload);
      return;
    }
    default:
      telemetry.captureException(new Error(`Unknown message type: ${payload.type}`), {
        operation: "handleClientMessage",
        message_type: payload.type || "unknown",
    });
      send(socket, { type: "error", message: `Unknown message type: ${payload.type}` });
  }
}

async function runPrompt(
  session,
  prompt,
  {
    displayUserMessage = true,
    defaultTitle = null,
    specialist = null,
    executionIntent = "chat",
  } = {},
) {
  if (state.activeRuns.has(session.id)) {
    throw new Error("This session is already running.");
  }

  telemetry.captureEvent("mac_sidecar_prompt_started", {
    session_id: session.id,
    provider: session.provider,
    command_kind: prompt.startsWith("/analyze-ads")
      ? "analyze_ads"
      : prompt.startsWith("/bip-draft")
        ? "bip_draft"
        : prompt.startsWith("/office-hours-docs")
          ? "office_hours_docs"
        : "chat",
    prompt_length: prompt.length,
  });
  const runStartedAt = performance.now();
  const seenRunPhases = new Set();

  // Check for /bip-draft command
  const bipDraftMatch = prompt.match(/^\/bip-draft(?:\s+(.*))?$/i);
  if (bipDraftMatch) {
    const topic = (bipDraftMatch[1] || "").trim();
    if (session.provider !== "claude") {
      throw new Error("/bip-draft requires a Claude session. Please switch to Claude.");
    }
    await runBipDraft(session, topic, prompt);
    return;
  }

  const officeHoursDocsMatch = prompt.match(/^\/office-hours-docs(?:\s+([\s\S]*))?$/i);
  if (officeHoursDocsMatch) {
    const topic = (officeHoursDocsMatch[1] || "").trim();
    await runOfficeHoursDocs(session, topic, prompt);
    return;
  }

  // Check for /analyze-ads command
  const analyzeAdsMatch = prompt.match(/^\/analyze-ads\s+(.+)$/i);
  if (analyzeAdsMatch) {
    const targetUrl = analyzeAdsMatch[1].trim();
    if (session.provider !== "claude") {
      throw new Error("/analyze-ads requires a Claude session. Please switch to Claude.");
    }
    try {
      new URL(targetUrl);
    } catch {
      throw new Error(`Invalid URL: "${targetUrl}". Usage: /analyze-ads https://example.com/landing`);
    }
    await runAnalyzeAds(session, targetUrl, prompt);
    return;
  }

  const assistantMessage = makeMessage({
    role: "assistant",
    provider: session.provider,
    content: "",
    state: "streaming",
  });
  recordMessageTiming(session, assistantMessage, runStartedAt, "prompt.accepted", {
    provider: session.provider,
    model: session.model || "",
    promptLength: prompt.length,
  });

  if (displayUserMessage) {
    const userMessage = makeMessage({
      role: "user",
      provider: session.provider,
      content: prompt,
      state: "final",
    });
  session.messages.push(userMessage);
  }

  if (defaultTitle && (!session.title || session.title === "New Session")) {
  session.title = defaultTitle;
  } else if (displayUserMessage && shouldDeriveTitle(session)) {
  session.title = deriveTitle(prompt);
  }

  session.messages.push(assistantMessage);
  session.status = "running";
  session.error = null;
  session.pendingUserInput = null;
  touch(session);
  await persistSessions();
  recordMessageTiming(session, assistantMessage, runStartedAt, "session.persisted_before_provider", {
    messageCount: session.messages.length,
  });
  broadcast({ type: "session_updated", session });

  const abortController = new AbortController();
  state.activeRuns.set(session.id, {
    abortController,
    stop: null,
  });

  try {
    state.activeRuns.get(session.id).stop = async () => {
      abortController.abort();
    };

    const route = classifyChatExecutionRoute(prompt, { executionIntent });
    recordMessageTiming(session, assistantMessage, runStartedAt, "route.classified", route);
    emitChatRunPhase(session, assistantMessage.id, `route=${route.executionMode} reason=${route.reason}`);
    if (route.executionMode === "instant_chat") {
      const instant = await buildInstantChatResponse(prompt);
      recordMessageTiming(session, assistantMessage, runStartedAt, "context.built", {
        promptChars: prompt.length,
        contextAddedChars: instant.contextChars,
        cacheHit: instant.cacheHit,
        fileCount: instant.files.length,
    });
      emitChatRunPhase(session, assistantMessage.id, instant.cacheHit ? "context=cache_hit" : "context=cache_miss");
      emitAgentEvent(session, assistantMessage.id, {
        eventType: "run.started",
        provider: session.provider,
        executionMode: route.executionMode,
    });
      setAssistantText(session, assistantMessage.id, instant.text);
      emitAgentEvent(session, assistantMessage.id, {
        eventType: "message.replace",
        textLength: instant.text.length,
    });
      recordMessageTiming(session, assistantMessage, runStartedAt, "instant.response_ready", {
        targetMs: INSTANT_CHAT_COMPLETE_SLO_MS,
        cacheHit: instant.cacheHit,
    });
      session.runtime = {
        ...(session.runtime || {}),
        lastInstantChatAt: new Date().toISOString(),
    };
      assistantMessage.state = "final";
    session.status = "idle";
      session.error = null;
      emitAgentEvent(session, assistantMessage.id, {
        eventType: "run.completed",
        provider: session.provider,
        executionMode: route.executionMode,
    });
      return;
    }
    const authState = getProviderAuthState(session.provider);
    if (!authState.available) {
      throw new Error(authState.message);
    }

  const promptForProvider = await buildPromptWithBipContext(prompt, route);
    recordMessageTiming(session, assistantMessage, runStartedAt, "context.built", {
      promptChars: promptForProvider.length,
      originalPromptChars: prompt.length,
      contextAddedChars: Math.max(0, promptForProvider.length - prompt.length),
    });
    emitChatRunPhase(session, assistantMessage.id, route.contextSummary);
    emitChatRunPhase(session, assistantMessage.id, `provider=${session.provider} model=${session.model || "default"} starting_stream`);
    recordMessageTiming(session, assistantMessage, runStartedAt, "provider.call_start", {
      provider: session.provider,
      executionMode: route.executionMode,
    });

    const { runtime } = await runProviderStream({
      provider: session.provider,
      sessionRuntime: session.runtime,
      prompt: promptForProvider,
      model: session.model,
      workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      executionMode: route.executionMode,
      approvedToolExecution: route.approvedToolExecution === true,
      specialist,
      onTextDelta: (chunk) => {
        emitAgentEvent(session, assistantMessage.id, {
          eventType: "message.delta",
          textLength: chunk.length,
        });
        appendAssistantText(session, assistantMessage.id, chunk);
      },
      onTextReplace: (content) => {
        emitAgentEvent(session, assistantMessage.id, {
          eventType: "message.replace",
          textLength: content.length,
        });
        setAssistantText(session, assistantMessage.id, content);
      },
      onToolEvent: (event) => {
        const { phase, toolName, payload, toolCallKey } = event;
        emitAgentEvent(session, assistantMessage.id, canonicalToolEvent(event));
        broadcast({
          type: "tool_event",
          sessionId: session.id,
          messageId: assistantMessage.id,
          phase,
          toolName,
          toolCallKey,
          payload,
          summary: formatChatToolEvent(event),
        });
      },
      onRuntimeUpdate: async (nextRuntime) => {
        session.runtime = nextRuntime;
        recordMessageTiming(session, assistantMessage, runStartedAt, "runtime.updated", {
          hasCodexThread: Boolean(nextRuntime?.codexThreadId),
          hasClaudeSession: Boolean(nextRuntime?.claudeSessionId),
        }, { once: true, seen: seenRunPhases });
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
      },
      onRunEvent: (event) => {
        emitAgentEvent(session, assistantMessage.id, {
          eventType: "run.timing",
          phase: event.phase,
          details: Object.fromEntries(
            Object.entries(event).filter(([key]) => key !== "phase" && key !== "once"),
          ),
        });
        recordMessageTiming(
          session,
          assistantMessage,
          runStartedAt,
          event.phase,
          Object.fromEntries(
            Object.entries(event).filter(([key]) => key !== "phase" && key !== "once"),
          ),
          event.once ? { once: true, seen: seenRunPhases } : {},
        );
      },
    });

    session.runtime = mergeProviderRuntime(session.runtime, runtime);
    setAssistantText(session, assistantMessage.id, assistantMessage.content);
    recordMessageTiming(session, assistantMessage, runStartedAt, "provider.call_finished");

    assistantMessage.state = "final";
  session.status = "idle";
  session.error = null;
    emitAgentEvent(session, assistantMessage.id, {
      eventType: "run.completed",
      provider: session.provider,
      executionMode: route.executionMode,
    });
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError") {
      telemetry.captureEvent("mac_sidecar_prompt_aborted", {
        session_id: session.id,
        provider: session.provider,
    });
      assistantMessage.state = "final";
    session.status = "idle";
      session.error = null;
    } else {
      telemetry.captureException(error, {
        operation: "runPrompt",
        session_id: session.id,
        provider: session.provider,
    });
      assistantMessage.state = "error";
      assistantMessage.error = formatError(error);
      const authActions = buildProviderAuthActionsForError(session.provider, assistantMessage.error);
      if (authActions.length) {
        assistantMessage.providerAuthActions = authActions;
    }
      recordMessageTiming(session, assistantMessage, runStartedAt, "prompt.error", {
        message: assistantMessage.error,
    });
      if (!assistantMessage.content) {
        assistantMessage.content = assistantMessage.error;
    }
    session.status = "error";
      session.error = assistantMessage.error;
      emitAgentEvent(session, assistantMessage.id, {
        eventType: "run.failed",
        error: assistantMessage.error,
        recoverable: false,
    });
      broadcast({
        type: "error",
        sessionId: session.id,
        message: assistantMessage.error,
    });
    }
  } finally {
    if (session.status === "idle" && assistantMessage.state === "final") {
      recordMessageTiming(session, assistantMessage, runStartedAt, "prompt.completed", {
        totalMs: Math.round(performance.now() - runStartedAt),
    });
      telemetry.captureEvent("mac_sidecar_prompt_completed", {
        session_id: session.id,
        provider: session.provider,
        message_count: session.messages.length,
    });
    }
    state.activeRuns.delete(session.id);
    touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
    scheduleQueuedPromptRun(session);
  }
}

/**
 * Unified Foundation Phase Day 0-7 chat handler.
 *
 * Single AI interaction channel — every Day, every sub-workflow, every prompt
 * flows through THIS function. There is no mode-based branching:
 *  - No `/bip-draft`, `/office-hours-docs`, `/analyze-ads` command parsing.
 *  - No instant_chat / agentic / memory_chat / fast_chat split.
 *  - Sub-workflow selection lives inside the Foundation context object and
 *    is rendered as system context only — the caller never sees it.
 *
 * The function:
 *  1. Resolves Foundation Day context (core_question, sub_workflow hint,
 *     dynamic_variables, evidence_refs, missing_inputs).
 *  2. Composes the unified prompt by gluing Foundation system context with
 *     the user's raw message and any cached BIP context.
 *  3. Streams the response through the SAME `runProviderStream()` call used
 *     elsewhere in the sidecar — same provider, same streaming events, same
 *     assistant message lifecycle.
 *  4. Persists evidence_refs as a JSON sidecar so KR4.1/4.2 can audit
 *     the trace later.
 */
async function runUnifiedFoundationChat(
  session,
  prompt,
  {
    day,
    dynamicVariables = {},
    evidenceRefs = [],
    workspace = {},
    transport = "foundation_chat",
  } = {},
) {
  if (state.activeRuns.has(session.id)) {
    throw new Error("This session is already running.");
  }

  const dayDescriptor = getFoundationDay(day);
  if (!dayDescriptor) {
    throw new Error("Foundation day must be in range 0-7.");
  }

  telemetry.captureEvent("mac_sidecar_foundation_chat_started", {
    session_id: session.id,
    provider: session.provider,
    day: dayDescriptor.day,
    sub_workflow: dayDescriptor.sub_workflow || "",
    spec_version: dayDescriptor.spec_version || "",
    prompt_length: prompt.length,
    transport,
  });

  emitFoundationChatEvent({
    sessionId: session.id,
    day: dayDescriptor.day,
    phase: "started",
    subWorkflow: dayDescriptor.sub_workflow || null,
    specVersion: dayDescriptor.spec_version || null,
    transport,
  });

  const runStartedAt = performance.now();
  const seenRunPhases = new Set();

  const foundationContext = resolveFoundationContext({
    day: dayDescriptor.day,
    prompt,
    workspace: { root: workspaceRoot, ...(workspace || {}) },
    dynamicVariables,
    evidenceRefs,
  });

  const assistantMessage = makeMessage({
    role: "assistant",
    provider: session.provider,
    content: "",
    state: "streaming",
  });
  // Tag the message with Foundation metadata so the UI can render Day badges
  // and evidence chips without needing to know about sub-workflows.
  assistantMessage.foundation = {
    day: foundationContext.day,
    core_question: foundationContext.core_question,
    spec_version: foundationContext.spec_version,
    sub_workflow: foundationContext.sub_workflow,
    overall_confidence: foundationContext.overall_confidence,
    artifacts: foundationContext.artifacts,
    persona: foundationContext.persona,
  };

  recordMessageTiming(session, assistantMessage, runStartedAt, "foundation.prompt_accepted", {
    provider: session.provider,
    model: session.model || "",
    day: foundationContext.day,
    sub_workflow: foundationContext.sub_workflow || "",
    promptLength: prompt.length,
  });

  const userMessage = makeMessage({
    role: "user",
    provider: session.provider,
    content: prompt,
    state: "final",
  });
  userMessage.foundation = {
    day: foundationContext.day,
    core_question: foundationContext.core_question,
  };
  session.messages.push(userMessage);

  if (!session.title || session.title === "New Session") {
  session.title = `Day ${foundationContext.day} — ${foundationContext.core_question?.slice(0, 32) || "Foundation"}`;
  }

  session.messages.push(assistantMessage);
  session.status = "running";
  session.error = null;
  session.pendingUserInput = null;
  session.runtime = {
    ...(session.runtime || {}),
    foundation: {
      day: foundationContext.day,
      sub_workflow: foundationContext.sub_workflow,
      spec_version: foundationContext.spec_version,
      lastFoundationChatAt: new Date().toISOString(),
    },
  };
  touch(session);
  await persistSessions();
  recordMessageTiming(session, assistantMessage, runStartedAt, "foundation.session_persisted", {
    messageCount: session.messages.length,
  });
  broadcast({ type: "session_updated", session });

  const abortController = new AbortController();
  state.activeRuns.set(session.id, {
    abortController,
    stop: async () => abortController.abort(),
  });

  try {
    const authState = getProviderAuthState(session.provider);
    if (!authState.available) {
      throw new Error(authState.message);
    }

    emitChatRunPhase(
      session,
      assistantMessage.id,
      `foundation_day=${foundationContext.day} sub_workflow=${foundationContext.sub_workflow || "none"}`,
    );

    // Pull cached BIP context exactly the same way the existing flow does.
    // Single channel — no instant_chat / fast_chat split.
    const bipContextBlock = await buildChatBipContext().catch((error) => {
      telemetry.captureException(error, {
        operation: "buildChatBipContext.foundation",
        session_id: session.id,
    });
      return "";
    });
    const bipManifest = buildChatBipManifest();

    // Day 6 monetization-ask sub-workflow: hide turn-specific systemBlock
    // inside bipContextBlock so the provider sees it as system context (no
    // routing flag, single AI surface preserved). State is pulled from
    // session.runtime.foundation.monetizationAsk; the outcome path below
    // closes the loop by writing result.md + emitting an evidence_ref.
    const isMonetizationAskRun = shouldRunMonetizationAsk({
      day: foundationContext.day,
      subWorkflow: foundationContext.sub_workflow,
    });
    let monetizationAskStateBefore = null;
    let monetizationAskContextBlock = "";
    if (isMonetizationAskRun) {
      monetizationAskStateBefore = loadMonetizationAskState(session.runtime);
      monetizationAskContextBlock = buildMonetizationAskContextBlock(
        monetizationAskStateBefore,
      );
    }
    const composedBipContextBlock = [bipContextBlock, monetizationAskContextBlock]
      .filter((block) => typeof block === "string" && block.length > 0)
      .join("\n\n");

  const promptForProvider = composeUnifiedFoundationPrompt({
      context: foundationContext,
      bipContextBlock: composedBipContextBlock,
      workspaceManifest: bipManifest,
    });
    recordMessageTiming(session, assistantMessage, runStartedAt, "foundation.context_built", {
      promptChars: promptForProvider.length,
      originalPromptChars: prompt.length,
      contextAddedChars: Math.max(0, promptForProvider.length - prompt.length),
      evidenceRefCount: foundationContext.evidence_refs.length,
      missingInputCount: foundationContext.missing_inputs.length,
    });

    emitFoundationChatEvent({
    sessionId: session.id,
      messageId: assistantMessage.id,
      day: foundationContext.day,
    phase: "context_built",
      subWorkflow: foundationContext.sub_workflow || null,
      specVersion: foundationContext.spec_version || null,
      evidenceRefCount: foundationContext.evidence_refs.length,
      missingInputCount: foundationContext.missing_inputs.length,
      overallConfidence: foundationContext.overall_confidence ?? null,
      transport,
    });

    emitChatRunPhase(
      session,
      assistantMessage.id,
      `provider=${session.provider} model=${session.model || "default"} channel=foundation_unified`,
    );
    recordMessageTiming(session, assistantMessage, runStartedAt, "foundation.provider_call_start", {
      provider: session.provider,
    });

    emitAgentEvent(session, assistantMessage.id, {
      eventType: "run.started",
      provider: session.provider,
      executionMode: "foundation_unified",
      day: foundationContext.day,
    });

    emitFoundationChatEvent({
    sessionId: session.id,
      messageId: assistantMessage.id,
      day: foundationContext.day,
    phase: "streaming",
      subWorkflow: foundationContext.sub_workflow || null,
      specVersion: foundationContext.spec_version || null,
      transport,
    });

    const { runtime } = await runProviderStream({
      provider: session.provider,
      sessionRuntime: session.runtime,
      prompt: promptForProvider,
      model: session.model,
    workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      // The provider always sees the same execution mode. Internal sub-workflow
      // hints stay in the Foundation system context block, never as a flag.
      executionMode: "foundation_unified",
      approvedToolExecution: false,
      specialist: null,
      onTextDelta: (chunk) => {
        emitAgentEvent(session, assistantMessage.id, {
          eventType: "message.delta",
          textLength: chunk.length,
        });
        appendAssistantText(session, assistantMessage.id, chunk);
      },
      onTextReplace: (content) => {
        emitAgentEvent(session, assistantMessage.id, {
          eventType: "message.replace",
          textLength: content.length,
        });
        setAssistantText(session, assistantMessage.id, content);
      },
      onToolEvent: (event) => {
        const { phase, toolName, payload, toolCallKey } = event;
        emitAgentEvent(session, assistantMessage.id, canonicalToolEvent(event));
        broadcast({
          type: "tool_event",
          sessionId: session.id,
          messageId: assistantMessage.id,
          phase,
          toolName,
          toolCallKey,
          payload,
          summary: formatChatToolEvent(event),
        });
      },
      onRuntimeUpdate: async (nextRuntime) => {
        session.runtime = {
          ...nextRuntime,
          foundation: session.runtime?.foundation ?? null,
        };
        recordMessageTiming(
          session,
          assistantMessage,
          runStartedAt,
          "foundation.runtime_updated",
          {
            hasCodexThread: Boolean(nextRuntime?.codexThreadId),
            hasClaudeSession: Boolean(nextRuntime?.claudeSessionId),
          },
          { once: true, seen: seenRunPhases },
        );
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
      },
      onRunEvent: (event) => {
        emitAgentEvent(session, assistantMessage.id, {
          eventType: "run.timing",
          phase: event.phase,
          details: Object.fromEntries(
            Object.entries(event).filter(([key]) => key !== "phase" && key !== "once"),
          ),
        });
        recordMessageTiming(
          session,
          assistantMessage,
          runStartedAt,
          event.phase,
          Object.fromEntries(
            Object.entries(event).filter(([key]) => key !== "phase" && key !== "once"),
          ),
          event.once ? { once: true, seen: seenRunPhases } : {},
        );
      },
    });

  session.runtime = {
      ...runtime,
      foundation: session.runtime?.foundation ?? null,
    };
    setAssistantText(session, assistantMessage.id, assistantMessage.content);
    recordMessageTiming(session, assistantMessage, runStartedAt, "foundation.provider_call_finished");

    // Sub-AC 4: monetization-ask sub-workflow outcome.
    // Apply the user's response to the 4-turn state machine; on terminal turn
    // close, write monetization-ask-result.md to the workspace and append an
    // evidence_ref so persistEvidenceRefsSidecar() carries the artifact lineage.
    if (isMonetizationAskRun) {
      try {
        const outcome = await applyMonetizationAskOutcome({
          state: monetizationAskStateBefore,
          userResponse: prompt,
          captures: {},
          workspaceRoot,
        });
        session.runtime = attachMonetizationAskState(
          session.runtime,
          outcome.stateAfter,
        );
        if (outcome.evidenceRef) {
          // Mutate foundationContext.evidence_refs in-place so the sidecar
          // persistence below sees the new artifact pointer (the context
          // object is the source of truth for the JSON sidecar).
          foundationContext.evidence_refs = [
            ...(foundationContext.evidence_refs || []),
            outcome.evidenceRef,
          ];
        }
        const monetizationMeta = {
          turn_before: monetizationAskStateBefore?.turn ?? null,
          turn_after: outcome.stateAfter?.turn ?? null,
          advanced: outcome.advanced,
          is_terminal: outcome.isTerminal,
          reason: outcome.reason,
          pushback: outcome.pushback,
          result_path: outcome.resultArtifact?.path ?? null,
          classification:
            outcome.stateAfter?.capturesAggregate?.response_classification ?? null,
        };
        assistantMessage.foundation.monetization_ask = monetizationMeta;
        recordMessageTiming(
          session,
          assistantMessage,
          runStartedAt,
          "foundation.monetization_ask_evaluated",
          monetizationMeta,
        );
        telemetry.captureEvent("mac_sidecar_monetization_ask_evaluated", {
          session_id: session.id,
          day: foundationContext.day,
          advanced: outcome.advanced,
          is_terminal: outcome.isTerminal,
          reason: outcome.reason || "",
          turn_after: outcome.stateAfter?.turn || "",
          has_result_path: Boolean(outcome.resultArtifact?.path),
        });
        if (outcome.isTerminal && outcome.resultArtifact?.path) {
          broadcast({
            type: "monetization_ask_completed",
            sessionId: session.id,
            messageId: assistantMessage.id,
            resultPath: outcome.resultArtifact.path,
            classification:
              outcome.stateAfter?.capturesAggregate?.response_classification ?? null,
          });
        }
        if (outcome.resultArtifact?.error) {
          telemetry.captureException(outcome.resultArtifact.error, {
            operation: "writeMonetizationAskResult",
            session_id: session.id,
          });
        }
      } catch (error) {
        telemetry.captureException(error, {
          operation: "applyMonetizationAskOutcome",
          session_id: session.id,
        });
    }
    }

    // Sub-AC 5: foundation-summary sub-workflow outcome (Day 7).
    // Parse the assistant text into draft.v2 sections (SPEC v3 / go-no-go /
    // foundation-summary), persist them under workspace/.agentic30/foundation/,
    // emit evidence_refs pointing at each artifact (so the JSON sidecar below
    // carries the lineage), and broadcast `foundation_summary_completed` for
    // the chat surface to render the Day 7 wrap banner.
    //
    // Single-channel guarantee: this runs AFTER the provider stream finished
    // — the user already saw the AI response. The outcome path is a pure
    // post-processor that closes the Foundation loop deterministically.
    const isFoundationSummaryRun = shouldRunFoundationSummary({
      day: foundationContext.day,
      subWorkflow: foundationContext.sub_workflow,
    });
    if (isFoundationSummaryRun) {
      try {
        const outcome = await applyFoundationSummaryOutcome({
          assistantText: assistantMessage.content || "",
          workspaceRoot,
          // Day 7 retrospective rating may arrive in dynamic_variables
          // (Sub-AC 1 of AC 14) — forward it so the rule-check's KR4.1
          // axis sees the latest value when the audit JSON is built.
          userFeedback:
            foundationContext.dynamic_variables?.user_feedback ?? null,
          reviewLoop: null, // Sub-AC 4 review-loop not yet wired into hot path
        });
        session.runtime = attachFoundationSummaryState(
          session.runtime,
          outcome.stateAfter,
        );
        // Mutate foundationContext.evidence_refs in-place so the sidecar
        // persistence below sees the new artifact pointers (the context
        // object is the source of truth for the JSON sidecar).
        if (Array.isArray(outcome.evidenceRefs) && outcome.evidenceRefs.length) {
          foundationContext.evidence_refs = [
            ...(foundationContext.evidence_refs || []),
            ...outcome.evidenceRefs,
          ];
        }
        const summaryMeta = {
          status: outcome.summary?.status ?? null,
          reason: outcome.summary?.reason ?? null,
          sections_present: outcome.summary?.sections_present ?? [],
          sections_skipped: outcome.summary?.sections_skipped ?? [],
          artifacts: outcome.summary?.artifacts ?? {},
          monetization_yes_count: outcome.summary?.monetization_yes_count ?? 0,
          go_no_go_recommendation: outcome.summary?.go_no_go_recommendation ?? null,
          verdict_pass: outcome.summary?.verdict_pass ?? null,
          verdict_score: outcome.summary?.verdict_score ?? null,
        };
        assistantMessage.foundation.foundation_summary = summaryMeta;
        recordMessageTiming(
          session,
          assistantMessage,
          runStartedAt,
          "foundation.foundation_summary_evaluated",
          summaryMeta,
        );
        telemetry.captureEvent("mac_sidecar_foundation_summary_evaluated", {
          session_id: session.id,
          day: foundationContext.day,
          status: summaryMeta.status || "",
          sections_present_count: summaryMeta.sections_present.length,
          sections_skipped_count: summaryMeta.sections_skipped.length,
          monetization_yes_count: summaryMeta.monetization_yes_count,
          go_no_go_recommendation: summaryMeta.go_no_go_recommendation || "",
          verdict_pass: summaryMeta.verdict_pass === null ? "" : String(summaryMeta.verdict_pass),
          has_error: Boolean(outcome.error),
        });
        if (outcome.isTerminal) {
          const event = buildFoundationSummaryCompletedEvent({
            sessionId: session.id,
            messageId: assistantMessage.id,
            outcome,
          });
          if (event) broadcast(event);
        }
        if (outcome.error) {
          telemetry.captureException(outcome.error, {
            operation: "writeFoundationSummaryDraftV2",
            session_id: session.id,
          });
        }
      } catch (error) {
        telemetry.captureException(error, {
          operation: "applyFoundationSummaryOutcome",
          session_id: session.id,
        });
    }
    }

    // Persist evidence_refs JSON sidecar (KR4.1/4.2 measurement infra).
    try {
      const sidecarPath = await persistEvidenceRefsSidecar({
        workspaceRoot,
        sessionId: session.id,
        messageId: assistantMessage.id,
        day: foundationContext.day,
        context: foundationContext,
    });
      if (sidecarPath) {
        assistantMessage.foundation.evidence_sidecar = sidecarPath;
    }
    } catch (error) {
      telemetry.captureException(error, {
        operation: "persistEvidenceRefsSidecar",
        session_id: session.id,
    });
    }

    assistantMessage.state = "final";
  session.status = "idle";
  session.error = null;
    emitAgentEvent(session, assistantMessage.id, {
      eventType: "run.completed",
      provider: session.provider,
      executionMode: "foundation_unified",
      day: foundationContext.day,
    });
    emitFoundationChatEvent({
    sessionId: session.id,
      messageId: assistantMessage.id,
      day: foundationContext.day,
    phase: "completed",
      subWorkflow: foundationContext.sub_workflow || null,
      specVersion: foundationContext.spec_version || null,
      evidenceRefCount: foundationContext.evidence_refs.length,
      missingInputCount: foundationContext.missing_inputs.length,
      overallConfidence: foundationContext.overall_confidence ?? null,
      evidenceSidecarPath: assistantMessage.foundation?.evidence_sidecar ?? null,
      elapsedMs: Math.round(performance.now() - runStartedAt),
      transport,
    });
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError") {
      telemetry.captureEvent("mac_sidecar_foundation_chat_aborted", {
        session_id: session.id,
        provider: session.provider,
        day: foundationContext.day,
    });
      assistantMessage.state = "final";
    session.status = "idle";
      session.error = null;
      emitFoundationChatEvent({
        sessionId: session.id,
        messageId: assistantMessage.id,
        day: foundationContext.day,
        phase: "aborted",
        subWorkflow: foundationContext.sub_workflow || null,
        specVersion: foundationContext.spec_version || null,
        elapsedMs: Math.round(performance.now() - runStartedAt),
        transport,
    });
    } else {
      telemetry.captureException(error, {
        operation: "runUnifiedFoundationChat",
        session_id: session.id,
        provider: session.provider,
        day: foundationContext.day,
    });
      assistantMessage.state = "error";
      assistantMessage.error = formatError(error);
      const authActions = buildProviderAuthActionsForError(session.provider, assistantMessage.error);
      if (authActions.length) {
        assistantMessage.providerAuthActions = authActions;
    }
      recordMessageTiming(session, assistantMessage, runStartedAt, "foundation.prompt_error", {
        message: assistantMessage.error,
    });
      if (!assistantMessage.content) {
        assistantMessage.content = assistantMessage.error;
    }
    session.status = "error";
      session.error = assistantMessage.error;
      emitAgentEvent(session, assistantMessage.id, {
        eventType: "run.failed",
        error: assistantMessage.error,
        recoverable: false,
    });
      broadcast({
        type: "error",
        sessionId: session.id,
        message: assistantMessage.error,
    });
    }
  } finally {
    if (session.status === "idle" && assistantMessage.state === "final") {
      recordMessageTiming(session, assistantMessage, runStartedAt, "foundation.prompt_completed", {
        totalMs: Math.round(performance.now() - runStartedAt),
    });
      telemetry.captureEvent("mac_sidecar_foundation_chat_completed", {
        session_id: session.id,
        provider: session.provider,
        day: foundationContext.day,
        sub_workflow: foundationContext.sub_workflow || "",
        message_count: session.messages.length,
    });
    }
    state.activeRuns.delete(session.id);
    touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
    scheduleQueuedPromptRun(session);
  }
}

async function warmSession(session) {
  if (!session || session.provider !== "codex") return;
  if (process.env.AGENTIC30_DISABLE_CODEX_WARMUP === "1") return;
  if (state.activeRuns.has(session.id) || state.warmRuns.has(session.id)) return;

  const model = session.model || "";
  if (isCodexWarmRuntimeReady(session.runtime, { model, workspaceRoot })) return;

  const authState = getProviderAuthState(session.provider);
  if (!authState.available) {
    setCodexWarmRuntime(session, {
      state: "failed",
      model,
    workspaceRoot,
      executionMode: "fast_chat",
      error: authState.message,
    });
  await persistSessions();
  broadcast({ type: "session_updated", session });
    return;
  }

  const abortController = new AbortController();
  const startedAt = performance.now();
  state.warmRuns.set(session.id, { abortController, startedAt });
  setCodexWarmRuntime(session, {
    state: "warming",
    model,
    workspaceRoot,
    executionMode: "fast_chat",
    startedAt: new Date().toISOString(),
  });
  touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });

  const timings = [];
  try {
    const result = await runProviderStream({
      provider: session.provider,
      sessionRuntime: session.runtime,
      prompt: [
        "Prepare this Agentic30 fast chat session.",
        "Load the current developer instructions and workspace context.",
        "Do not answer the user yet.",
      ].join("\n"),
      model: session.model,
    workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      executionMode: "fast_chat",
      stopAfterCodexThreadStarted: true,
      onTextDelta: () => {},
      onTextReplace: () => {},
      onToolEvent: () => {},
      onRuntimeUpdate: async (nextRuntime) => {
        session.runtime = {
          ...(session.runtime || {}),
          ...(nextRuntime || {}),
          codexWarm: session.runtime?.codexWarm,
        };
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
      },
      onRunEvent: (event) => {
        timings.push({
          phase: event.phase,
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
          details: Object.fromEntries(
            Object.entries(event).filter(([key]) => key !== "phase" && key !== "once"),
          ),
        });
      },
    });

    if (result.runtime?.codexThreadId) {
      session.runtime = {
        ...(session.runtime || {}),
        ...(result.runtime || {}),
      };
      setCodexWarmRuntime(session, {
        state: "ready",
        model,
        workspaceRoot,
        executionMode: "fast_chat",
        startedAt: session.runtime?.codexWarm?.startedAt,
        completedAt: new Date().toISOString(),
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        timings,
    });
      telemetry.captureEvent("mac_sidecar_codex_warmup_completed", {
        session_id: session.id,
        provider: session.provider,
        elapsed_ms: session.runtime.codexWarm.elapsedMs,
      });
    }
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError") {
      setCodexWarmRuntime(session, {
        state: "cancelled",
        model,
        workspaceRoot,
        executionMode: "fast_chat",
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    } else {
      setCodexWarmRuntime(session, {
        state: "failed",
        model,
        workspaceRoot,
        executionMode: "fast_chat",
        failedAt: new Date().toISOString(),
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        error: formatError(error),
        timings,
      });
      telemetry.captureException(error, {
        operation: "warmSession",
        session_id: session.id,
        provider: session.provider,
      });
    }
  } finally {
    state.warmRuns.delete(session.id);
    touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
  }
}

function cancelWarmSession(sessionId) {
  const run = state.warmRuns.get(sessionId);
  if (!run) return;
  run.abortController.abort();
  state.warmRuns.delete(sessionId);
}

function isCodexWarmRuntimeReady(runtime = {}, { model = "", workspaceRoot: root = "" } = {}) {
  const warm = runtime?.codexWarm;
  const meta = runtime?.codexThreadMeta || {};
  return Boolean(
    runtime?.codexThreadId
      && warm?.state === "ready"
      && warm.executionMode === "fast_chat"
      && warm.workspaceRoot === root
      && (warm.model || "") === (model || "")
      && meta.workspaceRoot === root
      && meta.executionMode === "fast_chat",
  );
}

function setCodexWarmRuntime(session, warm) {
  session.runtime = {
    ...(session.runtime || {}),
    codexWarm: {
      ...(session.runtime?.codexWarm || {}),
      ...warm,
    },
  };
}

async function enqueuePrompt(session, prompt, { executionIntent = "chat" } = {}) {
  const userMessage = makeMessage({
    role: "user",
    provider: session.provider,
    content: prompt,
    state: "final",
  });
  session.messages.push(userMessage);
  session.error = null;
  touch(session);
  await persistSessions();

  const queue = state.promptQueues.get(session.id) || [];
  queue.push({
    prompt,
    queuedAt: new Date().toISOString(),
    executionIntent,
  });
  state.promptQueues.set(session.id, queue);

  telemetry.captureEvent("mac_sidecar_prompt_queued", {
    session_id: session.id,
    provider: session.provider,
    queue_depth: queue.length,
    prompt_length: prompt.length,
  });
  broadcast({ type: "session_updated", session });
  emitAgentEvent(session, userMessage.id, {
    eventType: "prompt.queued",
    queueDepth: queue.length,
  });
}

async function runNextQueuedPrompt(sessionId) {
  if (state.activeRuns.has(sessionId)) {
    return;
  }
  const queue = state.promptQueues.get(sessionId);
  if (!queue?.length) {
    state.promptQueues.delete(sessionId);
    return;
  }
  const session = state.sessions.get(sessionId);
  if (!session) {
    state.promptQueues.delete(sessionId);
    return;
  }
  const next = queue.shift();
  if (queue.length) {
    state.promptQueues.set(sessionId, queue);
  } else {
    state.promptQueues.delete(sessionId);
  }
  await runPrompt(session, next.prompt, {
    displayUserMessage: false,
    executionIntent: next.executionIntent || "chat",
  });
}

function scheduleQueuedPromptRun(session) {
  queueMicrotask(() => {
    fireAndForget("runNextQueuedPrompt", runNextQueuedPrompt(session.id), {
      session_id: session.id,
      provider: session.provider,
    });
  });
}

async function runOfficeHoursDocs(session, topic, originalPrompt) {
  const abortController = new AbortController();
  const runKey = randomUUID();
  const assistantMessage = makeMessage({
    role: "assistant",
    provider: session.provider,
    content: "Starting Office Hours doc interview...\n\n",
    state: "streaming",
  });
  session.messages.push(
    makeMessage({ role: "user", provider: session.provider, content: originalPrompt, state: "final" }),
    assistantMessage,
  );
  session.status = "running";
  session.error = null;
  touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });

  state.activeRuns.set(session.id, {
    runKey,
    abortController,
    stop: null,
  });

  telemetry.captureEvent("mac_sidecar_office_hours_docs_started", {
    session_id: session.id,
    provider: session.provider,
    has_topic: Boolean(topic),
  });

  try {
    const userPrompt = buildOfficeHoursDocsPrompt(topic);
    const officeHoursSelection = selectSpecialist({
    bipSetupGate: currentBipSetupGate(),
      doc: null,
      lastAnswer: topic || "",
    });
  telemetry.captureEvent("mac_sidecar_specialist_routed", {
    session_id: session.id,
    stage: "office_hours_docs",
    specialist_id: officeHoursSelection.id,
    phase: officeHoursSelection.phase,
    decision_kind: officeHoursSelection.decisionKind,
    vendor_used: Boolean(
        officeHoursSelection?.vendor?.claude?.exists
          && officeHoursSelection?.vendor?.codex?.exists,
    ),
    });
    const officeHoursSpecialistInjection = buildSpecialistInjection(officeHoursSelection, {
      provider: session.provider,
    });
    const result = await runProviderStream({
      provider: session.provider,
      sessionRuntime: session.runtime,
      prompt: userPrompt,
    workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      executionMode: "agentic",
      approvedToolExecution: true,
      specialist: officeHoursSelection,
      onTextDelta: (text) => appendAssistantText(session, assistantMessage.id, text),
      onTextReplace: (text) => setAssistantText(session, assistantMessage.id, text),
      onToolEvent: (toolEvent) => {
        broadcast({
          type: "tool_event",
          sessionId: session.id,
          messageId: assistantMessage.id,
          phase: toolEvent.phase,
          toolName: toolEvent.toolName,
          toolCallKey: toolEvent.toolCallKey,
          payload: toolEvent.payload,
          summary: formatChatToolEvent(toolEvent),
        });
      },
      onRuntimeUpdate: (runtime) => {
        session.runtime = runtime;
        touch(session);
        persistSessions().catch(() => {});
      },
      systemPromptOverride: buildOfficeHoursDocsSystemPrompt(workspaceRoot, {
        provider: session.provider,
        specialistInjection: officeHoursSpecialistInjection,
      }),
    });

  session.runtime = result.runtime;
    assistantMessage.state = "final";
  session.status = "idle";
  session.error = null;
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError") {
      telemetry.captureEvent("mac_sidecar_office_hours_docs_aborted", {
        session_id: session.id,
        provider: session.provider,
    });
      assistantMessage.state = "final";
    session.status = "idle";
      session.error = null;
    } else {
      telemetry.captureException(error, {
        operation: "runOfficeHoursDocs",
        session_id: session.id,
        provider: session.provider,
    });
      assistantMessage.state = "error";
      assistantMessage.error = formatError(error);
      if (!assistantMessage.content) {
        assistantMessage.content = `Office Hours docs failed: ${formatError(error)}`;
    }
    session.status = "error";
      session.error = formatError(error);
      broadcast({
        type: "error",
        sessionId: session.id,
        message: formatError(error),
    });
    }
  } finally {
    if (session.status === "idle" && assistantMessage.state === "final") {
      telemetry.captureEvent("mac_sidecar_office_hours_docs_completed", {
        session_id: session.id,
        provider: session.provider,
    });
    }
    state.activeRuns.delete(session.id);
    touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
    scheduleQueuedPromptRun(session);
  }
}

async function consumeClaudeStream(stream, session, assistantMessage) {
  for await (const event of stream) {
    if (event.type === "system" && event.subtype === "init") {
      session.runtime = {
        ...session.runtime,
        claudeSessionId: event.session_id,
    };
    touch(session);
      await persistSessions();
    broadcast({ type: "session_updated", session });
      continue;
    }

    if (event.type === "assistant" && event.message?.content) {
      for (const content of event.message.content) {
        if (content.type === "text" && content.text) {
          appendAssistantText(session, assistantMessage.id, content.text);
        } else if (content.type === "tool_use") {
          broadcast({
            type: "tool_event",
            sessionId: session.id,
            phase: "use",
            toolName: content.name,
            payload: content.input ?? {},
          });
        } else if (content.type === "thinking") {
          broadcast({
            type: "tool_event",
            sessionId: session.id,
            phase: "thinking",
            toolName: "reasoning",
            payload: { text: content.thinking },
          });
        }
    }
    }

    if (event.type === "user" && event.message?.content && typeof event.message.content !== "string") {
      for (const content of event.message.content) {
        if (content.type === "tool_result") {
          broadcast({
            type: "tool_event",
            sessionId: session.id,
            phase: "result",
            toolName: content.tool_use_id,
            payload: content.content,
          });
        }
    }
    }
  }
}

async function runAnalyzeAds(session, targetUrl, originalPrompt) {
  if (state.activeRuns.has(session.id)) {
    throw new Error("This session is already running.");
  }

  const authState = getProviderAuthState("claude");
  if (!authState.available) {
    throw new Error(authState.message);
  }

  // Read ad config from file and env vars (env takes priority)
  const adConfig = readJsonFile(path.join(appSupportPath, "ad-config.json"));
  const metaToken = process.env.META_ACCESS_TOKEN || adConfig?.meta?.accessToken;
  const metaAccountId = process.env.META_AD_ACCOUNT_ID || adConfig?.meta?.adAccountId;
  const posthogMcpServers = buildPostHogClaudeMcpConfigFromSources({
    appSupportPath,
    config: adConfig,
  });
  const posthogAvailable = Boolean(posthogMcpServers.posthog);

  if (!metaToken || !metaAccountId) {
    throw new Error(
      "Meta credentials not configured. Open Settings (Cmd+,) to add your Meta Access Token and Ad Account ID, or set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID environment variables.",
    );
  }

  // Set up messages following existing pattern
  const userMessage = makeMessage({
    role: "user",
    provider: session.provider,
    content: originalPrompt,
    state: "final",
  });
  const assistantMessage = makeMessage({
    role: "assistant",
    provider: session.provider,
    content: "",
    state: "streaming",
  });

  if (!session.title || session.title === "New Session") {
    try {
      session.title = `Ad Analysis: ${new URL(targetUrl).hostname}`;
    } catch {
      session.title = `Ad Analysis: ${targetUrl.slice(0, 30)}`;
    }
  }

  session.messages.push(userMessage, assistantMessage);
  session.status = "running";
  session.error = null;
  touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });

  const abortController = new AbortController();
  state.activeRuns.set(session.id, {
    abortController,
    stop: null,
  });

  telemetry.captureEvent("mac_sidecar_analyze_ads_started", {
    session_id: session.id,
    provider: session.provider,
    target_host: (() => {
      try { return new URL(targetUrl).host; } catch { return targetUrl; }
    })(),
  });

  try {
    // 1. Fetch Meta Ads data
    appendAssistantText(session, assistantMessage.id, "Fetching Meta Ads data...\n\n");

    const metaClient = new MetaAdsClient({
      accessToken: metaToken,
      adAccountId: metaAccountId,
      signal: abortController.signal,
    });
    const metaReport = await metaClient.fetchFullReport(targetUrl);

    if (metaReport.errors.length > 0) {
      appendAssistantText(
        session,
        assistantMessage.id,
        `Note: Some Meta API calls had issues:\n${metaReport.errors.map((e) => `- ${e}`).join("\n")}\n\n`,
      );
    }

    appendAssistantText(session, assistantMessage.id, "Running AI analysis...\n\n");

    // 2. Build MCP servers config (internal + PostHog when configured + optional Notion)
    const mcpServers = {
      [internalMcpServerName]: buildMcpConfig(session.id, {
        executionMode: "agentic",
        approvedToolExecution: true,
      }),
      ...posthogMcpServers,
      ...buildNotionMcpConfig(),
      ...buildQmdMcpConfig({ sidecarRoot }),
    };

    // 3. Build specialized system prompt
    const strategyPrompt = [
      buildAdStrategyPrompt(targetUrl, metaReport, posthogAvailable),
      buildQmdGuidance(workspaceRoot, { appSupportPath, sidecarRoot }),
    ].filter(Boolean).join("\n\n");

    // 4. Run Claude with the strategy prompt
    const packagePath = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
    const cliPath = path.join(packagePath, "cli.js");
    const env = buildClaudeAgentEnv();

    const options = {
      model: session.model || undefined,
      pathToClaudeCodeExecutable: cliPath,
      executable: process.execPath,
      env,
      cwd: workspaceRoot,
      mcpServers,
      maxTurns: 30,
      includePartialMessages: true,
      systemPrompt: strategyPrompt,
      allowDangerouslySkipPermissions: true,
      permissionMode: "bypassPermissions",
      abortController,
    };

    // Clear progress text before streaming actual analysis
    setAssistantText(session, assistantMessage.id, "");

    const analysisPrompt = [
      `Analyze the ad performance for ${targetUrl}.`,
      "The Meta Ads data has been provided in your system context.",
      posthogAvailable
        ? "Use the PostHog MCP tools to query UTM data, scroll depth, and conversion funnels for this URL before writing your analysis."
        : "",
      "Provide a comprehensive ad performance improvement strategy in Korean (한국어).",
    ]
      .filter(Boolean)
      .join(" ");

    const stream = query({
      prompt: analysisPrompt,
      options,
    });

    state.activeRuns.get(session.id).stop = async () => {
      abortController.abort();
    };

    await consumeClaudeStream(stream, session, assistantMessage);

    assistantMessage.state = "final";
  session.status = "idle";
  session.error = null;
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError") {
      telemetry.captureEvent("mac_sidecar_analyze_ads_aborted", {
        session_id: session.id,
        provider: session.provider,
    });
      assistantMessage.state = "final";
    session.status = "idle";
      session.error = null;
    } else {
      telemetry.captureException(error, {
        operation: "runAnalyzeAds",
        session_id: session.id,
        provider: session.provider,
        target_url: targetUrl,
    });
      assistantMessage.state = "error";
      assistantMessage.error = formatError(error);
      if (!assistantMessage.content) {
        assistantMessage.content = assistantMessage.error;
    }
    session.status = "error";
      session.error = assistantMessage.error;
      broadcast({
        type: "error",
        sessionId: session.id,
        message: assistantMessage.error,
    });
    }
  } finally {
    if (session.status === "idle" && assistantMessage.state === "final") {
      telemetry.captureEvent("mac_sidecar_analyze_ads_completed", {
        session_id: session.id,
        provider: session.provider,
        target_url: targetUrl,
    });
    }
    state.activeRuns.delete(session.id);
    touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
    scheduleQueuedPromptRun(session);
  }
}

async function buildPromptWithBipContext(prompt, route = classifyChatExecutionRoute(prompt)) {
  if ((!route.inlineBipContext && route.executionMode === "fast_chat") || !shouldInlineBipContext(prompt)) {
    return prompt;
  }
  const bipManifest = buildChatBipManifest();
  const qmdState = getQmdState({ sidecarRoot });
  if (qmdState.available) {
    const projectContextBlock = await buildChatProjectContextBlock().catch((error) => {
      telemetry.captureException(error, { operation: "buildChatProjectContextBlock" });
      return "";
    });
    return bipManifest || projectContextBlock
      ? [
          bipManifest,
          projectContextBlock,
          "## User Message",
          prompt,
        ].filter(Boolean).join("\n\n")
      : prompt;
  }
  const bipContext = await buildChatBipContext().catch((error) => {
  telemetry.captureException(error, { operation: "buildChatBipContext" });
    return "";
  });
  if (!bipContext) {
    return bipManifest
      ? [
          bipManifest,
          "## User Message",
          prompt,
        ].join("\n\n")
      : prompt;
  }
  return [
    bipManifest,
    bipContext,
    "## User Message",
    prompt,
  ].filter(Boolean).join("\n\n");
}

function classifyChatExecutionRoute(prompt, options = {}) {
  return classifyChatExecutionRouteWithState(prompt, {
    qmdAvailable: getQmdState({ sidecarRoot }).available,
    executionIntent: options.executionIntent || "chat",
  });
}

function mergeProviderRuntime(currentRuntime = {}, providerRuntime = {}) {
  const merged = {
    ...(currentRuntime || {}),
    ...(providerRuntime || {}),
  };
  for (const key of ["iddDocumentType", "pendingIddContinuation", "iddPendingAdaptiveContinuation"]) {
    if (Object.prototype.hasOwnProperty.call(currentRuntime || {}, key)) {
      merged[key] = currentRuntime[key];
    }
  }
  return merged;
}

async function buildInstantChatResponse(prompt) {
  const context = await getCachedBipContext({
    appSupportPath,
    workspaceRoot,
  });
  const configuredDocAnswer = await buildConfiguredDocPathAnswer(prompt);
  if (configuredDocAnswer) {
    return {
      text: configuredDocAnswer,
      contextChars: context.text.length,
      cacheHit: context.cacheHit,
      files: context.files,
    };
  }
  const plan = buildStageAwareActionPlan({
    prompt,
    context,
  });
  return {
    text: plan.visible_message,
    contextChars: context.text.length,
    cacheHit: context.cacheHit,
    files: context.files,
  };
}

async function buildConfiguredDocPathAnswer(prompt) {
  const value = String(prompt || "");
  if (!isWorkspacePathLookupPrompt(value)) return "";
  const workspace = currentBipConfig()?.workspace || {};
  const mappings = [
    ["ICP.md", workspace.icp],
    ["SPEC.md", workspace.spec],
    ["VALUES.md", workspace.values],
    ["GOAL.md", workspace.goal],
    ["ADR.md", workspace.adr],
  ];
  const match = mappings.find(([label, docPath]) =>
    docPath && new RegExp(`\\b${label.replace(".", "\\.")}\\b`, "i").test(value)
  );
  if (!match) return "";
  const [label, docPath] = match;
  const workspaceEvidence = await extractWorkspaceEvidence(workspaceRoot, {
    scanPaths: workspace,
    includeSource: true,
  }).catch(() => null);
  const summaryLines = workspaceEvidenceSummaryLines(workspaceEvidence);
  return [
    `\`${label}\`는 현재 BIP 설정 기준으로 \`${docPath}\`에 있습니다.`,
    ...summaryLines,
    "다음 액션: 이 문서와 확인된 근거를 기준으로 Day 1 판단을 이어가면 됩니다.",
  ].join("\n");
}

function workspaceEvidenceSummaryLines(workspaceEvidence) {
  const signals = workspaceEvidence?.signals || {};
  const lines = [];
  const target = cleanFastPathFragment(signals.targetUser || signals.likelyUsers?.[0]);
  const problem = cleanFastPathFragment(signals.problem);
  const goal = cleanFastPathFragment(signals.goal || signals.purpose);
  const outcome = cleanFastPathFragment(signals.outcome);
  if (target || problem) {
    lines.push(`ICP 기준 요약: ${[target, problem].filter(Boolean).join(" — ")}`);
  }
  if (goal) {
    lines.push(`Goal 기준: ${goal}`);
  }
  if (outcome) {
    lines.push(`Outcome 기준: ${outcome}`);
  } else if (target || problem || goal) {
    lines.push("Day 1 판단 기준: 위 근거에서 고객, 통증, 검증 행동을 한 문장으로 좁힙니다.");
  }
  const evidencePaths = (workspaceEvidence?.evidence || [])
    .map((item) => String(item?.path || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (evidencePaths.length) {
    lines.push(`근거: ${evidencePaths.join(", ")}`);
  }
  return lines.length ? lines : ["workspace 문서에서 고객/문제/목표 근거를 더 확인해야 합니다."];
}

function cleanFastPathFragment(value) {
  return cleanShortText(value, 140)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[.。．]+$/u, "")
    .trim();
}

function buildStageAwareActionPlan({ prompt = "", context = {}, selectedOption = "", forcedIntentMode = "" } = {}) {
  const config = currentBipConfig() || {};
  const hypothesis = normalizeWorkspaceOnboardingHypothesis(state.workspaceOnboardingHypothesis || {});
  const targetUser = cleanFastPathFragment(hypothesis.targetUser || hypothesis.likelyUsers?.[0]);
  const problem = cleanFastPathFragment(hypothesis.problem);
  const goal = cleanFastPathFragment(hypothesis.goal || hypothesis.purpose);
  const customerLabel = targetUser || "아직 좁히는 중인 고객 후보";
  const problemLabel = problem || "이번 주 검증할 핵심 문제";
  const goalLabel = goal || "고객 답변 원문 1개와 검증 근거 1개";
  const stageState = readWorkspaceStageState(config);
  const repoStage = inferRepoStage({ prompt, config, context, stageState });
  const intentMode = forcedIntentMode || inferIntentMode({ prompt, selectedOption, stageState });
  const docs = configuredDocsPresence(config);
  const proofRefs = normalizeStringList(stageState.proofs);
  const evidenceRefs = [
    docs.icp ? "docs/ICP.md" : "",
    docs.goal ? "docs/GOAL.md" : "",
    docs.spec ? "docs/SPEC.md" : "",
    proofRefs[0] ? `prior proof: ${proofRefs[0]}` : "",
  ].filter(Boolean);
  const selected = String(selectedOption || "").trim();
  const isBuilder = intentMode === "builder";
  const isComplete = repoStage === "complete";

  let verdict;
  let nextAction;
  let proofTarget;
  let domainLine;
  let stageLine;

  if (isBuilder && isComplete) {
    verdict = "keep";
    domainLine = "Builder retro: 끝난 demo loop는 회고로 닫고, 가장 선명한 artifact를 다음 공개 증거로 이어갑니다.";
    stageLine = `근거: ${proofRefs.length ? proofRefs.join(", ") : "완료된 demo loop와 현재 BIP 기록"}`;
    nextAction = "오늘 demo에서 가장 선명했던 화면 1개를 골라 retro와 함께 공개 proof로 남기세요.";
    proofTarget = "retro 공개 proof 1개, 다음 artifact proof target 1개, demo를 이해한 사람 1명/막힌 지점 1개를 오늘 기록에 남깁니다.";
  } else if (isComplete) {
    verdict = proofRefs.length >= 2 ? "change" : "inconclusive";
    domainLine = `Startup verdict: ${verdict}. 이번 루프는 감이 아니라 공개 proof와 고객 반응 숫자로 다음 방향을 정합니다.`;
    stageLine = `근거: ${proofRefs.length ? proofRefs.join(", ") : "완료 상태지만 충분한 proof 숫자는 아직 부족함"}`;
    nextAction = "가장 반응이 있었던 proof 1개를 골라 같은 고객군 1명에게 후속 질문을 보내고 답변 원문을 저장하세요.";
    proofTarget = "retro 공개 proof 1개, 같은 고객군의 답변 원문 1개, 계속/전환/중단 기준 숫자 1개를 오늘 기록에 남깁니다.";
  } else if (isBuilder) {
    verdict = repoStage === "empty" ? "builder-first-demo" : "builder-proof-loop";
    domainLine = "Builder verdict: 오늘은 전략 문서보다 공유 산출물/artifact 1개와 5분 demo/wow moment를 먼저 만들고 BIP 공개 증거로 남깁니다.";
    stageLine = targetUser
      ? `ICP 확인: ${targetUser}`
      : "ICP 확인: workspace 문서에서 고객 조건을 더 좁혀야 합니다.";
    nextAction = selected
      ? `${selected}에서 사용자가 처음 보는 화면 1개를 녹화하거나 캡처해 공개 proof로 남기세요.`
      : "demo에서 사용자가 처음 보는 화면 1개를 녹화하거나 캡처해 공개 proof로 남기세요.";
    proofTarget = "공개 proof URL 1개와 'demo를 보고 이해한 사람 1명/막힌 지점 1개'를 오늘 기록에 남깁니다.";
  } else {
    verdict = repoStage === "empty" ? "conditional-icp-fit" : "day1-start";
    domainLine = `진단: Startup verdict는 조건부 ICP fit입니다. ${customerLabel}에게 "${problemLabel}"를 오늘 확인할 수 있으면 시작해도 됩니다.`;
    stageLine = repoStage === "running"
      ? `Evidence: ${evidenceRefs.length ? evidenceRefs.join(", ") : "workspace 근거"}를 기준으로 다음 고객증거 loop, 기준 숫자, proof target을 오늘 갱신합니다.`
      : (docs.icp
        ? `Evidence: docs/ICP.md와 관련 문서는 "${goalLabel}" 판단 기준입니다.`
        : "Evidence: 아직 전략 문서가 비어 있어도 시작 조건은 고객 대화 1개와 공개 proof 1개입니다.");
    nextAction = `오늘 ${customerLabel} 1명에게 "${problemLabel}"와 관련된 최근 상황을 묻고 답변 원문을 저장하세요.`;
    proofTarget = "응답 1개를 확보한 뒤 그 응답 원문과 다음 판단 기준을 공개 proof URL 또는 오늘 기록에 남깁니다.";
  }

  const message = [
    "짧게 보면, 이건 Agent 실행보다 Day 1 코칭 fast path로 처리할 수 있습니다.",
    `Repo stage: ${repoStage}. Intent mode: ${intentMode}.`,
    `Verdict: ${verdict}.`,
    domainLine,
    stageLine,
    `Customer/status quo: ${customerLabel}가 현재 "${problemLabel}"를 어떻게 처리하는지 확인합니다.`,
    `Narrow wedge: ${customerLabel} 중 이번 주 바로 대화 가능한 사람 1명.`,
    "Numeric threshold: 오늘 고객 답변 원문 1개와 공개 proof/기록 1개. 반응이 없으면 질문을 바꿉니다.",
    `다음 액션: ${nextAction}`,
    `증거 목표: ${proofTarget}`,
  ];

  return {
    verdict,
    evidence_refs: evidenceRefs,
    next_action: nextAction,
    proof_target: proofTarget,
    visible_message: message.join("\n"),
    confidence: evidenceRefs.length >= 2 ? "medium" : "low",
  };
}

function readWorkspaceStageState(config = {}) {
  const root = String(config?.workspace?.root || workspaceRoot || "").trim();
  if (!root) return {};
  const parsed = readJsonFile(path.join(path.resolve(root), "agentic30", "stage-state.json"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function configuredDocsPresence(config = {}) {
  const workspace = config?.workspace || {};
  return {
    icp: Boolean(workspace.icp),
    values: Boolean(workspace.values),
    goal: Boolean(workspace.goal),
    spec: Boolean(workspace.spec),
  };
}

function inferRepoStage({ prompt = "", config = {}, context = {}, stageState = {} } = {}) {
  const explicit = String(stageState.repo_stage || "").trim();
  if (["empty", "strategy_seeded", "partial_setup", "running", "complete"].includes(explicit)) {
    return explicit;
  }
  const text = `${prompt}\n${context?.text || ""}`.toLowerCase();
  if (/complete|완료|retro|회고|계속|전환|중단/.test(text)) return "complete";
  if (/running|proof|bip|실행 중|공개 기록/.test(text)) return "running";
  const docs = configuredDocsPresence(config);
  const docCount = Object.values(docs).filter(Boolean).length;
  if (docCount >= 4) return "strategy_seeded";
  if (docCount > 0) return "partial_setup";
  return "empty";
}

function inferIntentMode({ prompt = "", selectedOption = "", stageState = {} } = {}) {
  const explicit = String(stageState.intent_mode || "").trim();
  if (["startup", "builder"].includes(explicit)) {
    return explicit;
  }
  const text = `${prompt}\n${selectedOption}`.toLowerCase();
  return /builder|demo|artifact|빌더|산출물|공유 가능한|프로젝트 전략 문서/.test(text)
    ? "builder"
    : "startup";
}

function shouldInlineBipContext(prompt) {
  const value = String(prompt || "").trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (value.length <= 24 && !/[?#?]/.test(value)) {
    return false;
  }
  return [
    "bip",
    "icp",
    "spec",
    "adr",
    "goal",
    "design",
    "문서",
    "docs",
    "sheet",
    "전략",
    "고객",
    "프로젝트",
    "기획",
    "로드맵",
    "목표",
    "디자인",
    "결정",
  ].some((keyword) => lower.includes(keyword));
}

function emitChatRunPhase(session, messageId, summary) {
  if (!summary) return;
  broadcast({
    type: "tool_event",
    sessionId: session.id,
    messageId,
    phase: "sidecar",
    toolName: "sidecar",
    payload: { summary },
    summary,
  });
}

function emitAgentEvent(session, messageId, event) {
  if (!event?.eventType) return;
  const summary = formatAgentEventSummary(event);
  broadcast({
    type: "agent_event",
    sessionId: session.id,
    messageId,
    event,
    summary,
  });
}

function canonicalToolEvent(event) {
  const phase = String(event?.phase || "");
  const base = {
    toolName: event?.toolName || "tool",
    callId: event?.toolCallKey || event?.toolName || "tool",
    payload: event?.payload,
  };
  if (phase === "thinking") {
    return { eventType: "thinking", text: String(event?.payload?.text || "") };
  }
  if (phase === "result") {
    return { eventType: "tool.completed", ...base, result: event?.payload };
  }
  if (phase === "error") {
    return { eventType: "tool.failed", ...base, error: String(event?.payload || "") };
  }
  if (phase === "progress" || phase === "input_delta") {
    return { eventType: "tool.progress", ...base };
  }
  return { eventType: "tool.started", ...base, input: event?.payload };
}

function formatAgentEventSummary(event) {
  switch (event.eventType) {
    case "run.started":
      return `${event.executionMode || "agent"} started`;
    case "message.delta":
      return `answer streaming +${event.textLength || 0} chars`;
    case "message.replace":
      return `answer updated ${event.textLength || 0} chars`;
    case "thinking":
      return event.text ? `thinking: ${truncateChatToolOutput(event.text, 160)}` : "thinking";
    case "tool.started":
      return `tool started: ${event.toolName}`;
    case "tool.progress":
      return `tool progress: ${event.toolName}`;
    case "tool.completed":
      return `tool completed: ${event.toolName}`;
    case "tool.failed":
      return `tool failed: ${event.toolName}`;
    case "run.timing":
      return `timing: ${event.phase}`;
    case "run.completed":
      return `${event.executionMode || "agent"} completed`;
    case "run.failed":
      return `run failed: ${truncateChatToolOutput(event.error || "", 160)}`;
    default:
      return "";
  }
}

async function buildChatBipContext() {
  const bipConfig = readJsonFile(path.join(appSupportPath, "bip-config.json"));
  const configuredRoot = String(bipConfig?.workspace?.root || "").trim();
  if (!configuredRoot) {
    return "";
  }

  const root = path.resolve(configuredRoot);
  const sections = [
    "## Settings BIP Context",
    "The following content comes from Settings > Build In Public and should be treated as project context for this chat.",
    `Workspace root: ${root}`,
  ];
  let remainingChars = CHAT_BIP_CONTEXT_MAX_CHARS - sections.join("\n").length;

  const appendSection = (section) => {
    const trimmed = String(section || "").trim();
    if (!trimmed || remainingChars <= 0) return;
    const next = truncateChatBipText(trimmed, remainingChars);
    sections.push(next);
    remainingChars -= next.length;
  };

  appendSection(await buildChatProjectContextBlock(root));

  for (const item of await collectChatBipLocalDocs(bipConfig, root)) {
    appendSection(formatChatBipDocumentSection(item));
  }

  const externalContext = await collectChatBipExternalDocs(bipConfig, root);
  for (const section of externalContext) {
    appendSection(section);
  }

  const social = bipConfig.social || {};
  const socialLines = [];
  if (social.threads) socialLines.push(`Threads: @${social.threads}`);
  if (social.x) socialLines.push(`X/Twitter: @${social.x}`);
  if (socialLines.length) {
    appendSection(["### Social", ...socialLines].join("\n"));
  }

  return sections.length > 3 ? sections.join("\n\n") : "";
}

async function buildChatProjectContextBlock(root = "") {
  const configuredRoot = String(root || readJsonFile(path.join(appSupportPath, "bip-config.json"))?.workspace?.root || "").trim();
  if (!configuredRoot) return "";
  const projectContext = await loadProjectContextCache({ workspaceRoot: path.resolve(configuredRoot) });
  return formatProjectContextForPrompt(projectContext, {
    missing: "## Source-Derived Project Context\nProject context cache is missing. Use configured docs and Google BIP evidence; do not scan source code during this BIP request.",
  });
}

function buildChatBipManifest() {
  const bipConfig = readJsonFile(path.join(appSupportPath, "bip-config.json"));
  const configuredRoot = String(bipConfig?.workspace?.root || "").trim();
  if (!configuredRoot) {
    return "";
  }

  const workspace = bipConfig.workspace || {};
  const lines = [
    "## Settings BIP Manifest",
    "This deterministic manifest comes from Settings > Build In Public.",
    "For questions asking where a canonical project document is, answer from this manifest before using retrieval.",
    "Use QMD for broad search and the BIP MCP tools as the canonical fallback for configured project documents.",
    `Workspace root: ${path.resolve(configuredRoot)}`,
  ];
  if (workspace.icp) lines.push(`ICP doc: ${workspace.icp}`);
  if (workspace.spec) lines.push(`SPEC doc: ${workspace.spec}`);
  if (workspace.values) lines.push(`VALUES doc: ${workspace.values}`);
  if (workspace.designSystem) lines.push(`Design System docs: ${workspace.designSystem}`);
  if (workspace.adr) lines.push(`ADR docs: ${workspace.adr}`);
  if (workspace.goal) lines.push(`Goal doc: ${workspace.goal}`);
  if (workspace.docs) lines.push(`Docs map: ${workspace.docs}`);
  if (workspace.sheet) lines.push(`Sheet schema: ${workspace.sheet}`);

  const externalDocs = bipConfig.externalDocs || {};
  const googleDocs = normalizeStringList(externalDocs.googleDocs);
  const googleSheets = normalizeStringList(externalDocs.googleSheets);
  if (googleDocs.length) lines.push(`Google Docs: ${googleDocs.join(", ")}`);
  if (googleSheets.length) lines.push(`Google Sheets: ${googleSheets.join(", ")}`);

  return lines.join("\n");
}

async function collectChatBipLocalDocs(bipConfig, root) {
  const workspace = bipConfig?.workspace || {};
  const configuredDocs = [
    ["ICP", workspace.icp],
    ["SPEC", workspace.spec],
    ["VALUES", workspace.values],
    ["Design System", workspace.designSystem],
    ["ADR", workspace.adr],
    ["Goal", workspace.goal],
    ["Docs", workspace.docs],
    ["Sheet", workspace.sheet],
  ];
  const seen = new Set();
  const docs = [];
  for (const [role, configuredPath] of configuredDocs) {
    const value = String(configuredPath || "").trim();
    if (!value) continue;
    const resolvedPath = resolveChatBipWorkspacePath(root, value);
    if (!resolvedPath) {
      docs.push({
        role,
        relativePath: value,
        content: "Skipped: configured path is outside the workspace root.",
    });
      continue;
    }
    const matches = await listChatBipMarkdownDocs(resolvedPath, root);
    if (!matches.length) {
      docs.push({
        role,
        relativePath: path.relative(root, resolvedPath) || ".",
        content: "No readable Markdown document found at this configured path.",
    });
      continue;
    }
    for (const filePath of matches) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      const relativePath = path.relative(root, filePath);
      const content = await fs.readFile(filePath, "utf8").catch((error) => `Failed to read: ${formatError(error)}`);
      docs.push({
        role,
        relativePath,
        content: truncateChatBipText(content, CHAT_BIP_LOCAL_DOC_MAX_CHARS),
    });
    }
  }
  return docs;
}

async function listChatBipMarkdownDocs(targetPath, root) {
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) {
    return isChatBipMarkdownFile(targetPath) ? [targetPath] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const results = [];
  await collectChatBipMarkdownDocsInDir(targetPath, root, results, 0);
  return results.sort((a, b) => a.localeCompare(b));
}

async function collectChatBipMarkdownDocsInDir(dirPath, root, results, depth) {
  if (depth > 4 || results.length >= 40) return;
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (["node_modules", "build", "dist", "DerivedData"].includes(entry.name)) continue;
    const entryPath = path.join(dirPath, entry.name);
    if (!isPathInside(entryPath, root)) continue;
    if (entry.isDirectory()) {
      await collectChatBipMarkdownDocsInDir(entryPath, root, results, depth + 1);
    } else if (entry.isFile() && isChatBipMarkdownFile(entry.name)) {
      results.push(entryPath);
      if (results.length >= 40) return;
    }
  }
}

async function collectChatBipExternalDocs(bipConfig, root) {
  const externalDocs = bipConfig?.externalDocs || {};
  const sections = [];
  for (const url of normalizeStringList(externalDocs.googleDocs)) {
    const docId = parseGoogleDocUrl(url).documentId;
    if (!docId) {
      sections.push(`### Google Doc\n${url}\nSkipped: Google Docs document ID was not recognized.`);
      continue;
    }
    const section = await cachedChatBipExternalContext(`doc:${docId}`, async () => {
      const payload = await readGoogleDoc(docId, { cwd: root });
      const title = payload?.title ? `: ${payload.title}` : "";
      const text = extractGoogleDocPlainText(payload, CHAT_BIP_EXTERNAL_DOC_MAX_CHARS);
      return [`### Google Doc${title}`, `URL: ${url}`, text || "Document is empty or unreadable."].join("\n");
    });
    sections.push(section);
  }

  for (const url of normalizeStringList(externalDocs.googleSheets)) {
    const spreadsheetId = parseGoogleSheetUrl(url).spreadsheetId;
    if (!spreadsheetId) {
      sections.push(`### Google Sheet\n${url}\nSkipped: Google Sheets spreadsheet ID was not recognized.`);
      continue;
    }
    const section = await cachedChatBipExternalContext(`sheet:${spreadsheetId}`, async () => {
      const metadata = await readSheetMetadata(spreadsheetId, { cwd: root });
      const tabName = pickSheetTab(metadata);
      const range = buildSheetRange(tabName);
      const values = await readSheetValues(spreadsheetId, range, { cwd: root });
      const summary = summarizeSheetValues(values, { maxRecentRows: CHAT_BIP_SHEET_MAX_ROWS });
      const rows = summary.allRows.length <= CHAT_BIP_SHEET_MAX_ROWS
        ? summary.allRows
        : summary.allRows.slice(-CHAT_BIP_SHEET_MAX_ROWS);
      return [
        `### Google Sheet: ${tabName}`,
        `URL: ${url}`,
        summary.summary,
        truncateChatBipText(JSON.stringify(rows, null, 2), CHAT_BIP_EXTERNAL_DOC_MAX_CHARS),
      ].filter(Boolean).join("\n");
    });
    sections.push(section);
  }

  for (const url of normalizeStringList(externalDocs.notion)) {
    sections.push(`### Notion\n${url}\nOnly the configured Notion URL is available in Settings BIP context.`);
  }

  return sections;
}

async function cachedChatBipExternalContext(key, loader) {
  const now = Date.now();
  const cached = chatBipExternalContextCache.get(key);
  if (cached && now - cached.createdAt < CHAT_BIP_EXTERNAL_CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const value = await loader();
    chatBipExternalContextCache.set(key, { createdAt: now, value });
    return value;
  } catch (error) {
    return `### External BIP Document\n${key}\nFailed to read: ${formatError(error)}`;
  }
}

function formatChatBipDocumentSection({ role, relativePath, content }) {
  return [
    `### ${role}: ${relativePath}`,
    content || "Document is empty.",
  ].join("\n");
}

function resolveChatBipWorkspacePath(root, configuredPath) {
  const resolvedPath = path.resolve(root, configuredPath);
  return isPathInside(resolvedPath, root) ? resolvedPath : null;
}

function isPathInside(candidatePath, root) {
  const relative = path.relative(root, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isChatBipMarkdownFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".mdx" || ext === ".markdown";
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function truncateChatBipText(text, maxChars) {
  const value = String(text || "").trim();
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[truncated ${value.length - maxChars} chars]`;
}

async function runBipDraft(session, topic, originalPrompt) {
  if (state.activeRuns.has(session.id)) {
    throw new Error("This session is already running.");
  }

  const authState = getProviderAuthState("claude");
  if (!authState.available) {
    throw new Error(authState.message);
  }

  const bipConfig = readJsonFile(path.join(appSupportPath, "bip-config.json"));
  if (!bipConfig?.workspace?.root) {
    throw new Error(
      "BIP workspace not configured. Open Settings (Cmd+,) > Build In Public to set your project workspace root.",
    );
  }

  const userMessage = makeMessage({
    role: "user",
    provider: session.provider,
    content: originalPrompt,
    state: "final",
  });
  const assistantMessage = makeMessage({
    role: "assistant",
    provider: session.provider,
    content: "",
    state: "streaming",
  });

  if (!session.title || session.title === "New Session") {
  session.title = topic
      ? `BIP: ${topic.slice(0, 36)}${topic.length > 36 ? "..." : ""}`
      : "BIP Draft";
  }

  session.messages.push(userMessage, assistantMessage);
  session.status = "running";
  session.error = null;
  touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });

  const abortController = new AbortController();
  state.activeRuns.set(session.id, {
    abortController,
    stop: null,
  });

  telemetry.captureEvent("mac_sidecar_bip_draft_started", {
    session_id: session.id,
    provider: session.provider,
    has_topic: Boolean(topic),
  });

  try {
    appendAssistantText(session, assistantMessage.id, "Reading project context...\n\n");

    const projectContext = await loadProjectContextCache({
      workspaceRoot: bipConfig.workspace.root || workspaceRoot,
    });
    const bipPrompt = [
      buildBipPrompt(bipConfig, topic),
      formatProjectContextForPrompt(projectContext, {
        missing: "## Source-Derived Project Context\nProject context cache is missing. Do not scan source code during this BIP draft run; rely on configured docs, external docs, and recent activity tools.",
      }),
      buildQmdGuidance(bipConfig.workspace.root || workspaceRoot, { appSupportPath, sidecarRoot }),
    ].filter(Boolean).join("\n\n");

    const mcpServers = {
      [internalMcpServerName]: buildMcpConfig(session.id, {
        executionMode: "agentic",
        approvedToolExecution: true,
      }),
      ...buildPostHogClaudeMcpConfigFromSources({ appSupportPath }),
      ...buildNotionMcpConfig(),
      ...buildQmdMcpConfig({ sidecarRoot }),
    };

    const packagePath = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
    const cliPath = path.join(packagePath, "cli.js");
    const env = buildClaudeAgentEnv();

    const options = {
      model: session.model || undefined,
      pathToClaudeCodeExecutable: cliPath,
      executable: process.execPath,
      env,
      cwd: bipConfig.workspace.root,
      mcpServers,
      maxTurns: 24,
      includePartialMessages: true,
      systemPrompt: bipPrompt,
      allowDangerouslySkipPermissions: true,
      permissionMode: "bypassPermissions",
      abortController,
    };

    setAssistantText(session, assistantMessage.id, "");

    const draftPrompt = [
      topic
        ? `Create Build In Public content about: ${topic}`
        : "Create a Build In Public update based on recent project activity.",
      "Read the ICP, SPEC, and Goal documents first using the MCP tools to understand the product and current objectives.",
      "Then check recent workspace activity for concrete details to include.",
      "Generate all three formats (thread, single post, dev log) in Korean (한국어).",
    ].join(" ");

    const stream = query({
      prompt: draftPrompt,
      options,
    });

    state.activeRuns.get(session.id).stop = async () => {
      abortController.abort();
    };

    await consumeClaudeStream(stream, session, assistantMessage);

    assistantMessage.state = "final";
  session.status = "idle";
  session.error = null;
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError") {
      telemetry.captureEvent("mac_sidecar_bip_draft_aborted", {
        session_id: session.id,
        provider: session.provider,
    });
      assistantMessage.state = "final";
    session.status = "idle";
      session.error = null;
    } else {
      telemetry.captureException(error, {
        operation: "runBipDraft",
        session_id: session.id,
        provider: session.provider,
    });
      assistantMessage.state = "error";
      assistantMessage.error = formatError(error);
      if (!assistantMessage.content) {
        assistantMessage.content = assistantMessage.error;
    }
    session.status = "error";
      session.error = assistantMessage.error;
      broadcast({
        type: "error",
        sessionId: session.id,
        message: assistantMessage.error,
    });
    }
  } finally {
    if (session.status === "idle" && assistantMessage.state === "final") {
      telemetry.captureEvent("mac_sidecar_bip_draft_completed", {
        session_id: session.id,
        provider: session.provider,
    });
    }
    state.activeRuns.delete(session.id);
    touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
    scheduleQueuedPromptRun(session);
  }
}

async function configureBipCoach(payload) {
  const previousConfig = state.bipCoach?.config ?? {};
  const session = resolveBipCoachSession(payload.sessionId);
  const config = normalizeBipCoachConfig({
    ...previousConfig,
    provider: session?.provider || payload.provider,
    threadsHandle: payload.threadsHandle,
    sheetUrl: payload.sheetUrl,
    sheetId: payload.sheetId,
    sheetTabName: payload.sheetTabName,
    docUrl: payload.docUrl,
    docId: payload.docId,
    morningHour: payload.morningHour,
    eveningHour: payload.eveningHour,
  });
  const evidenceChanged =
    previousConfig.sheetId !== config.sheetId ||
    previousConfig.docId !== config.docId ||
    previousConfig.sheetTabName !== config.sheetTabName;

  state.bipCoach = normalizeBipCoachState({
    ...state.bipCoach,
    updatedAt: new Date().toISOString(),
    sessionId: session?.id ?? state.bipCoach?.sessionId ?? null,
    config,
    evidence: evidenceChanged ? null : state.bipCoach?.evidence ?? null,
    currentMission: evidenceChanged ? null : state.bipCoach?.currentMission ?? null,
    lastError: null,
  });
  await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_configured", {
    configured: isBipCoachConfigured(state.bipCoach),
    provider: config.provider,
    has_threads: Boolean(config.threadsHandle),
    has_sheet: Boolean(config.sheetId),
    has_doc: Boolean(config.docId),
  });
}

async function refreshBipCoachEvidence() {
  if (state.bipCoachRunning) {
  await setBipCoachError("공개 실행 코치가 이미 작업 중입니다.", "mac_sidecar_bip_coach_busy");
    return;
  }
  if (!isBipCoachConfigured(state.bipCoach)) {
  await setBipCoachError(
      "공개 실행 코치에는 Google Docs 업무일지 1개와 Google Sheets 공개 기록 표 1개가 필요합니다.",
    "mac_sidecar_bip_coach_not_configured",
    );
    return;
  }

  state.bipCoachRunning = true;
  broadcast({ type: "bip_coach_refresh_started", bipCoach: state.bipCoach });
  const startedAt = Date.now();

  function emitMissionProgress(stage, detail, extra = {}) {
  broadcast({
      type: "bip_coach_generation_progress",
    stage,
      detail,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    });
  }

  try {
    const evidenceBundle = await readBipCoachEvidenceBundle({
      onProgress: emitMissionProgress,
    });
    const { config, tabName, evidence } = evidenceBundle;

    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      updatedAt: new Date().toISOString(),
      config: normalizeBipCoachConfig({
        ...config,
        sheetTabName: tabName,
      }),
      evidence,
      lastError: null,
    });

    await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_evidence_refreshed", {
      row_count: evidence.sheetRowsRead,
      has_doc_text: Boolean(evidence.docText),
      doc_chars_read: evidence.docCharsRead,
      doc_was_truncated: evidence.docWasTruncated,
      duration_ms: Date.now() - startedAt,
    });
  broadcast({ type: "bip_coach_refresh_completed", bipCoach: state.bipCoach });
  } catch (error) {
    const rawError = formatError(error);
    const userError = formatBipCoachGwsError(error);
    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      updatedAt: new Date().toISOString(),
      evidence: state.bipCoach?.evidence
        ? {
            ...state.bipCoach.evidence,
            error: userError,
          }
        : null,
      lastError: userError,
    });
    await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_evidence_failed", {
      error: rawError,
      user_error: userError,
    });
  broadcast({
      type: "bip_coach_error",
      message: state.bipCoach.lastError,
      bipCoach: state.bipCoach,
    });
    // Emit token expiry event so the app can show a re-auth banner
    if (isInvalidRapt(error)) {
      broadcast({ type: "bip_token_expired", message: userError });
      telemetry.captureEvent("mac_bip_token_expired", { during_action: "evidence_refresh" });
    }
  } finally {
    state.bipCoachRunning = false;
  }
}

async function readBipCoachEvidenceBundle({ onProgress } = {}) {
  const config = state.bipCoach.config;
  onProgress?.("reading_sheet", "Google Sheet 전체 기록을 읽는 중");
  const sheetMetadata = await readSheetMetadata(config.sheetId, { cwd: workspaceRoot });
  const tabName = pickSheetTab(sheetMetadata, config.sheetTabName);
  const sheetRange = buildSheetRange(tabName);
  const sheetValues = await readSheetValues(config.sheetId, sheetRange, { cwd: workspaceRoot });
  await persistGwsReadToMemory({
    appSupportPath,
    sidecarRoot,
    kind: "sheet",
    id: config.sheetId,
    range: sheetRange,
    payload: sheetValues,
  }).catch(() => {});
  const sheetSummary = summarizeSheetValues(sheetValues);
  onProgress?.("reading_doc", "업무일지 Doc을 읽는 중", {
    sheetRowsRead: sheetSummary.allRows.length,
  });
  const docPayload = await readGoogleDoc(config.docId, { cwd: workspaceRoot });
  await persistGwsReadToMemory({
    appSupportPath,
    sidecarRoot,
    kind: "doc",
    id: config.docId,
    payload: docPayload,
  }).catch(() => {});
  const docFullText = extractGoogleDocPlainText(docPayload);
  const projectContext = await loadProjectContextCache({ workspaceRoot });
  const now = new Date().toISOString();
  return {
    config,
    tabName,
    evidence: {
      fullRead: true,
      source: "sidecar_gws",
      refreshedAt: now,
      sheetTitle: sheetMetadata?.properties?.title ?? "",
      sheetTabName: tabName,
      allRows: sheetSummary.allRows,
      recentRows: sheetSummary.recentRows,
      docTitle: docPayload?.title ?? "",
      docText: docFullText,
      docExcerpt: docFullText.slice(0, 1200),
      summary: sheetSummary.summary,
      sheetRowsRead: sheetSummary.allRows.length,
      sheetRowsTotal: sheetSummary.allRows.length,
      docCharsRead: docFullText.length,
      docCharsTotal: docFullText.length,
      docWasTruncated: false,
      projectContext: projectContext || null,
      projectContextCache: projectContext ? "ready" : "missing",
      error: null,
    },
  };
}

async function generateBipCoachMission({ sessionId, provider, compact = false, curriculumDay = null, localEvidence = null } = {}) {
  if (state.bipCoachRunning) {
  await setBipCoachError("공개 실행 코치가 이미 작업 중입니다.", "mac_sidecar_bip_coach_busy");
    return;
  }

  const gate = currentBipSetupGate();
  if (!gate.iddSetupComplete) {
    await startIddDocumentQueue({ gate, sessionId, provider });
  await setBipCoachError(
      "Foundation Setup을 먼저 승인해야 Day 1 Mission 후보를 만들 수 있습니다.",
    "mac_sidecar_idd_setup_required",
    );
    return;
  }

  if (!isBipCoachConfigured(state.bipCoach)) {
    await generateBasicBipCoachMission({ gate, sessionId, provider, compact, curriculumDay, localEvidence });
    return;
  }

  state.bipCoachRunning = true;
  broadcast({ type: "bip_coach_generation_started", bipCoach: state.bipCoach });
  const startedAt = Date.now();

  function emitMissionProgress(stage, detail, extra = {}) {
  broadcast({
      type: "bip_coach_generation_progress",
    stage,
      detail,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    });
  }

  try {
    const coachSession = resolveBipCoachSession(sessionId);
    await clearInitialIntakeIfNeeded(coachSession);
    const preferredProvider = coachSession?.provider
      || (normalizeSessionProvider(provider) === provider ? provider : state.bipCoach.config.provider);
    const providers = [
      preferredProvider,
      preferredProvider === "claude" ? "codex" : "claude",
    ];
    const failures = [];
    const today = todayKey();

    emitMissionProgress("reading_sheet", "Google Sheet와 업무일지 Doc을 한 번만 읽는 중");
    const evidenceBundle = await readBipCoachEvidenceBundle({
      onProgress: emitMissionProgress,
    });
    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      updatedAt: new Date().toISOString(),
      config: normalizeBipCoachConfig({
      ...state.bipCoach.config,
        sheetTabName: evidenceBundle.tabName,
      }),
      evidence: evidenceBundle.evidence,
      lastError: null,
    });

    for (const candidate of providers) {
      const authState = getProviderAuthState(candidate);
      if (!authState.available) {
        failures.push(`${candidate}: ${authState.message}`);
        continue;
    }

      try {
        emitMissionProgress("generating", "확인한 공개 기록 근거로 실행 후보를 생성하는 중", {
          provider: candidate,
        });
        const missionChoices = await generateBipMissionChoicesFromEvidence({
          provider: candidate,
          coachSession,
          compact,
          curriculumDay,
          today,
          onProgress: emitMissionProgress,
        });
        emitMissionProgress("finalizing", "근거를 정리하는 중", {
          provider: candidate,
        });
        const now = new Date();
        state.bipCoach = normalizeBipCoachState({
          ...state.bipCoach,
          updatedAt: now.toISOString(),
          config: normalizeBipCoachConfig({
            ...state.bipCoach.config,
            provider: candidate,
          }),
          evidence: {
            ...state.bipCoach.evidence,
            source: "sidecar_gws",
            summary: state.bipCoach.evidence?.summary || "Sidecar가 Google Sheet 전체 범위와 업무일지 Doc 전체 payload를 한 번 읽고 미션 생성에 사용했습니다.",
            provider: candidate,
            fallbackUsed: candidate !== preferredProvider,
            elapsedMs: Date.now() - startedAt,
            curriculumDay,
          },
          missionChoices,
          currentMission: null,
          lastError: null,
        });
        if (coachSession) {
          coachSession.messages.push(makeMessage({
            role: "assistant",
            provider: candidate,
            content: buildMissionChoicesVisibleMessage(
              missionChoices,
              "공개 기록과 선택한 Day 커리큘럼을 기준으로 오늘 수행할 실행 후보 3개를 만들었어요.",
            ),
            state: "final",
            bipMissionChoices: missionChoices,
          }));
          coachSession.status = "idle";
          coachSession.error = null;
          touch(coachSession);
          await persistSessions();
          broadcast({ type: "session_updated", session: coachSession });
        }
        await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_mission_generated", {
          provider: candidate,
          compact,
          fallback_used: candidate !== preferredProvider,
          duration_ms: Date.now() - startedAt,
        });
        broadcast({ type: "bip_coach_generation_completed", bipCoach: state.bipCoach });
        return;
      } catch (error) {
        failures.push(`${candidate}: ${formatError(error)}`);
    }
    }

    if (state.bipCoach?.evidence?.fullRead) {
      emitMissionProgress("finalizing", "생성 provider 연결이 불안정해 로컬 fallback 미션을 정리하는 중", {
        provider: "local",
    });
      const now = new Date();
      const missionChoices = buildFallbackBipMissionChoices({
        state: state.bipCoach,
        compact,
        curriculumDay,
        localEvidence: null,
        today,
        now,
    });
      state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
        updatedAt: now.toISOString(),
        evidence: {
          ...state.bipCoach.evidence,
          source: "sidecar_gws",
          provider: "local",
          fallbackUsed: true,
          providerFailures: failures,
          elapsedMs: Date.now() - startedAt,
          curriculumDay,
        },
        missionChoices,
        currentMission: null,
        lastError: null,
    });
      if (coachSession) {
        coachSession.messages.push(makeMessage({
          role: "assistant",
          provider: coachSession.provider,
          content: buildMissionChoicesVisibleMessage(
            missionChoices,
            "Codex/Claude 생성 연결이 불안정해서, 방금 읽은 공개 기록과 선택한 Day 커리큘럼만으로 바로 실행 가능한 후보 3개를 만들었어요.",
          ),
          state: "final",
          bipMissionChoices: missionChoices,
          providerAuthActions: buildProviderAuthActionsForFailures(failures),
        }));
        coachSession.status = "idle";
        coachSession.error = null;
        touch(coachSession);
        await persistSessions();
        broadcast({ type: "session_updated", session: coachSession });
    }
      await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_mission_generated", {
        provider: "local",
        compact,
        fallback_used: true,
        provider_failures: failures,
        duration_ms: Date.now() - startedAt,
    });
      broadcast({ type: "bip_coach_generation_completed", bipCoach: state.bipCoach });
      return;
    }

    throw new Error(`Mission generation failed. ${failures.join(" | ")}`);
  } catch (error) {
    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      updatedAt: new Date().toISOString(),
      lastError: formatError(error),
    });
    await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_generation_failed", {
      error: formatError(error),
    });
  broadcast({
      type: "bip_coach_error",
      message: state.bipCoach.lastError,
      bipCoach: state.bipCoach,
    });
  } finally {
    state.bipCoachRunning = false;
  }
}

async function generateBasicBipCoachMission({
  gate = null,
  sessionId = "",
  provider = "",
  compact = false,
  curriculumDay = null,
  localEvidence = null,
} = {}) {
  state.bipCoachRunning = true;
  broadcastBipSetupGateState(gate);
  broadcast({ type: "bip_coach_generation_started", bipCoach: state.bipCoach });
  const startedAt = Date.now();
  const today = todayKey();

  function emitMissionProgress(stage, detail, extra = {}) {
  broadcast({
      type: "bip_coach_generation_progress",
    stage,
      detail,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    });
  }

  try {
    const coachSession = resolveBipCoachSession(sessionId);
    await clearInitialIntakeIfNeeded(coachSession);
    emitMissionProgress(
      "generating",
      "프로젝트 기준이 아직 비어 있어도 오늘 커리큘럼만으로 실행 후보를 먼저 만드는 중",
      { provider: "local" },
    );

    const missingLocalDocs = (gate?.missingLocalDocs || []).map((doc) => doc.title || doc.type).filter(Boolean);
    const missingExternal = (gate?.missingExternalRequirements || []).map((item) => item.title || item.id).filter(Boolean);
    const projectContext = await loadProjectContextCache({ workspaceRoot });
    const missionState = normalizeBipCoachState({
      ...state.bipCoach,
      evidence: {
        ...(state.bipCoach?.evidence || {}),
        projectContext: projectContext || null,
        projectContextCache: projectContext ? "ready" : "missing",
      },
    });
    const missionChoices = buildFallbackBipMissionChoices({
      state: missionState,
      compact,
      curriculumDay,
      today,
      provider: "local",
      localEvidence: null,
    });
    const now = new Date();
    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      updatedAt: now.toISOString(),
      evidence: {
        fullRead: true,
        source: "partial_workspace",
        provider: "local",
        fallbackUsed: true,
        summary: projectContext
          ? "캐시된 프로젝트 맥락과 선택한 Day 커리큘럼을 기준으로 오늘 실행 후보를 만들었습니다."
          : "프로젝트 문서나 Google 기록이 아직 준비되지 않아 캐시된 프로젝트 맥락과 선택한 Day 커리큘럼만으로 오늘 실행 후보를 만들었습니다.",
        localEvidence: null,
        projectContext: projectContext || null,
        projectContextCache: projectContext ? "ready" : "missing",
        sheetTitle: "",
        sheetTabName: "",
        allRows: [],
        recentRows: [],
        sheetRowsRead: 0,
        docTitle: "",
        docText: "",
        docExcerpt: "",
        missingLocalDocs,
        missingExternalRequirements: missingExternal,
        elapsedMs: Date.now() - startedAt,
        curriculumDay,
      },
      missionChoices,
      currentMission: null,
      lastError: null,
    });

    if (coachSession) {
      coachSession.messages.push(makeMessage({
        role: "assistant",
        provider: normalizeSessionProvider(provider) === provider ? provider : coachSession.provider,
        content: buildMissionChoicesVisibleMessage(
          missionChoices,
          "문서 준비가 아직 끝나지 않아도 오늘 실행은 바로 시작할 수 있어요. 선택한 Day 커리큘럼만으로 15분 안에 끝낼 후보 3개를 먼저 만들었어요.",
    ),
        state: "final",
        bipMissionChoices: missionChoices,
      }));
      coachSession.status = "idle";
      coachSession.error = null;
      touch(coachSession);
      await persistSessions();
    broadcast({ type: "session_updated", session: coachSession });
    }

    await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_basic_mission_generated", {
      compact,
      missing_local_docs: missingLocalDocs.length,
      missing_external_requirements: missingExternal.length,
      duration_ms: Date.now() - startedAt,
    });
  broadcast({ type: "bip_coach_generation_completed", bipCoach: state.bipCoach });
  } catch (error) {
    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      updatedAt: new Date().toISOString(),
      lastError: formatError(error),
    });
    await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_basic_mission_failed", {
      error: formatError(error),
    });
  broadcast({
      type: "bip_coach_error",
      message: state.bipCoach.lastError,
      bipCoach: state.bipCoach,
    });
  } finally {
    state.bipCoachRunning = false;
  }
}

async function generateBipMissionChoicesFromEvidence({
  provider,
  coachSession,
  compact,
  curriculumDay,
  today,
  onProgress,
}) {
  if (process.env.AGENTIC30_BIP_MISSION_PARALLEL === "1") {
    const lanes = ["customer_evidence", "product_progress", "learning_retro"];
    const results = await Promise.all(lanes.map(async (lane) => {
      const prompt = buildBipCoachMissionPromptFromEvidence({
        state: state.bipCoach,
        compact,
        curriculumDay,
        today,
        lane,
    });
      const { text } = await runBipCoachProvider(provider, prompt, coachSession, {
        onEvidenceProgress: onProgress,
        requireGwsToolRead: false,
    });
      return parseMissionChoicesResponse(text, {
        provider,
        compact,
        today,
        curriculumDay,
      })[0];
    }));
    return parseMissionChoicesResponse(JSON.stringify({ missions: results }), {
      provider,
      compact,
      today,
      curriculumDay,
    });
  }

  const prompt = buildBipCoachMissionPromptFromEvidence({
    state: state.bipCoach,
    compact,
    curriculumDay,
    today,
  });
  const { text } = await runBipCoachProvider(provider, prompt, coachSession, {
    onEvidenceProgress: onProgress,
    requireGwsToolRead: false,
  });
  return parseMissionChoicesResponse(text, {
    provider,
    compact,
    today,
    curriculumDay,
  });
}

async function selectBipCoachMission({ sessionId, missionId } = {}) {
  const id = String(missionId || "").trim();
  const mission = (state.bipCoach?.missionChoices || []).find((candidate) => candidate.id === id);
  if (!mission) {
  await setBipCoachError("선택한 미션 후보를 찾지 못했어요. 미션을 다시 생성해 주세요.", "mac_sidecar_bip_coach_selection_missing");
    return;
  }

  const session = resolveBipCoachSession(sessionId);
  const now = new Date();
  state.bipCoach = normalizeBipCoachState({
    ...state.bipCoach,
    updatedAt: now.toISOString(),
    currentMission: {
      ...mission,
      status: "drafted",
    },
    lastError: null,
  });

  if (session) {
  session.messages.push(
      makeMessage({
        role: "user",
        provider: session.provider,
        content: `이 미션으로 진행할게: ${mission.title || "오늘 미션"}`,
        state: "final",
      }),
      makeMessage({
        role: "assistant",
        provider: session.provider,
        content: buildSelectedMissionCoachMessage(mission, state.bipCoach),
        state: "final",
      }),
    );
  session.status = "idle";
  session.error = null;
    touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
  }

  await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_mission_selected", {
    mission_id: mission.id,
    provider: mission.provider || state.bipCoach?.config?.provider || "",
  });
}

function buildSelectedMissionCoachMessage(mission, coachState) {
  const drafts = normalizeListForChat(mission.drafts);
  const checklist = normalizeListForChat(mission.eveningChecklist);
  const evidence = normalizeListForChat(mission.evidenceRefs);
  const lines = [
    `좋아요. 지금부터 이 미션만 작게 끝내면 됩니다: ${mission.title || "오늘 미션"}`,
    "",
    mission.angle ? `관점: ${mission.angle}` : "",
    mission.mission ? `수행: ${mission.mission}` : "",
    "",
    "진행 순서:",
    "1. 아래 초안 중 하나를 고르고, 사실과 숫자만 네 상황에 맞게 바꾸세요.",
    "2. Threads에 올린 뒤 URL을 복사하세요.",
    "3. Sheet 오늘 행에 URL, 반응, 배운 점을 남기세요.",
    "4. 여기 채팅에 URL이나 막힌 지점을 보내면 다음 문장까지 같이 줄이겠습니다.",
    "",
    drafts.length ? `초안 후보:\n${drafts.map((draft, index) => `${index + 1}. ${draft}`).join("\n")}` : "",
    checklist.length ? `완료 기준:\n${checklist.map((item) => `- ${item}`).join("\n")}` : "",
    evidence.length ? `반영한 근거:\n${evidence.slice(0, 4).map((item) => `- ${item}`).join("\n")}` : "",
  ].filter((line) => line !== "");

  const streak = coachState?.streak?.current;
  if (Number.isFinite(streak) && streak > 0) {
    lines.push("", `현재 연속 기록은 ${streak}일입니다. 오늘은 범위를 키우지 말고 완료 기록을 남기는 쪽으로 갑니다.`);
  }
  return lines.join("\n");
}

function buildMissionChoicesVisibleMessage(missionChoices = [], prefix = "오늘 수행할 실행 후보 3개를 만들었어요.") {
  const choices = Array.isArray(missionChoices) ? missionChoices : [];
  const recommended = choices[0];
  const lines = [
    prefix,
    "",
    "추천 1개:",
    recommended
      ? `- ${recommended.title || "오늘 미션"}: ${recommended.mission || recommended.angle || "오늘 공개 실행을 15분 안에 끝냅니다."}`
      : "- 오늘 공개 실행 후보를 하나 고르세요.",
    recommended?.proofTarget ? `증거 목표: ${recommended.proofTarget}` : "",
    "",
    "후보 3개:",
    ...choices.slice(0, 3).map((choice, index) =>
      `${index + 1}. ${choice.title || "오늘 미션"} - proof target: ${choice.proofTarget || "Threads URL과 Sheet 오늘 행 기록"}`,
    ),
    "",
    "다음 액션: 추천 1개를 선택하고 Threads URL + Sheet 기록으로 완료 처리하세요.",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function buildMissionCompletionVisibleMessage(coachState = {}) {
  const mission = coachState.currentMission || {};
  const nextProofTarget = mission.proofTarget
    || "다음 공개 실행도 Threads URL과 Sheet 오늘 행 기록으로 증거를 남긴다.";
  return [
    `완료 확인: ${mission.title || "오늘 공개 실행"}을 완료 처리했습니다.`,
    mission.threadsUrl ? `Threads: ${mission.threadsUrl}` : "",
    mission.sheetRowNote ? `Sheet note: ${mission.sheetRowNote}` : "",
    `현재 streak: ${coachState.streak?.current || 1}일`,
    `다음 증거 목표: ${nextProofTarget}`,
    "다음 액션: 오늘 반응 1개를 Sheet에 추가하고 내일 미션 후보를 다시 생성하세요.",
  ].filter(Boolean).join("\n");
}

function inferBipCompletionProofFromEvidence(evidence = {}) {
  const rows = Array.isArray(evidence.allRows) ? evidence.allRows : [];
  const latest = [...rows].reverse().find((row) =>
    Array.isArray(row?.posts) && row.posts.length > 0,
  ) || rows[rows.length - 1] || null;
  const latestPost = Array.isArray(latest?.posts)
    ? latest.posts.find((post) => /threads\.net|https?:\/\//i.test(String(post || ""))) || latest.posts[0]
    : "";
  const sheetLabel = [
    evidence.sheetTitle || "Google Sheet",
    evidence.sheetTabName ? `${evidence.sheetTabName}` : "",
  ].filter(Boolean).join(" / ");
  const rowLabel = latest?.rowNumber
    ? `${latest.rowNumber}행`
    : `전체 ${rows.length}행`;
  const dateLabel = latest?.date ? ` (${latest.date})` : "";
  return {
    threadsUrl: String(latestPost || "").trim(),
    sheetRowNote: `GWS 확인: ${sheetLabel} ${rowLabel}${dateLabel}`.trim(),
  };
}

async function resolveBipCompletionProof({ threadsUrl = "", sheetRowNote = "" } = {}) {
  let resolvedThreadsUrl = String(threadsUrl || "").trim();
  let resolvedSheetRowNote = String(sheetRowNote || "").trim();
  if (resolvedThreadsUrl && resolvedSheetRowNote) {
    return { threadsUrl: resolvedThreadsUrl, sheetRowNote: resolvedSheetRowNote };
  }

  const cached = inferBipCompletionProofFromEvidence(state.bipCoach?.evidence);
  resolvedThreadsUrl ||= cached.threadsUrl;
  resolvedSheetRowNote ||= cached.sheetRowNote;
  if (resolvedThreadsUrl && resolvedSheetRowNote) {
    return { threadsUrl: resolvedThreadsUrl, sheetRowNote: resolvedSheetRowNote };
  }

  const config = state.bipCoach?.config || {};
  if (config.sheetId && config.docId) {
    const bundle = await readBipCoachEvidenceBundle();
    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      evidence: bundle.evidence,
      updatedAt: new Date().toISOString(),
    });
    const inferred = inferBipCompletionProofFromEvidence(bundle.evidence);
    resolvedThreadsUrl ||= inferred.threadsUrl;
    resolvedSheetRowNote ||= inferred.sheetRowNote;
  }

  resolvedSheetRowNote ||= "자동 확인: 연결된 공개 기록 소스를 기준으로 완료 처리됨";
  return { threadsUrl: resolvedThreadsUrl, sheetRowNote: resolvedSheetRowNote };
}

function normalizeListForChat(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

async function runBipCoachProvider(provider, prompt, coachSession = null, {
  onEvidenceProgress,
  requireGwsToolRead = true,
} = {}) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 180_000);
  let text = "";
  const toolUsage = {
    sheetMetadataRequested: false,
    sheetValuesRequested: false,
    sheetValuesRead: false,
    docRequested: false,
    docRead: false,
  };
  const toolNamesByKey = new Map();
  let generationProgressEmitted = false;

  try {
    await runProviderStream({
      provider,
      model: coachSession?.provider === provider ? coachSession?.model ?? "" : "",
      sessionRuntime: coachSession?.runtime ?? {},
      prompt,
    workspaceRoot,
      abortController,
      sessionIdForMcp: coachSession?.id ?? "bip-coach",
      executionMode: "bip_coach_read_only",
      systemPromptOverride: buildBipCoachProviderSystemPrompt({ requireGwsToolRead }),
      onTextDelta: (chunk) => {
        if (!generationProgressEmitted && String(chunk || "").trim()) {
          generationProgressEmitted = true;
          onEvidenceProgress?.("generating", "Agent가 확인한 근거로 미션 후보를 생성하는 중", {
            provider,
          });
        }
        text += chunk;
      },
      onTextReplace: (content) => {
        if (!generationProgressEmitted && String(content || "").trim()) {
          generationProgressEmitted = true;
          onEvidenceProgress?.("generating", "Agent가 확인한 근거로 미션 후보를 생성하는 중", {
            provider,
          });
        }
        text = content;
      },
      onRuntimeUpdate: (runtime) => {
        if (!coachSession) return;
        coachSession.runtime = runtime;
        touch(coachSession);
        persistSessions().catch(() => {});
      },
      onToolEvent: (event) => {
        observeBipCoachToolEvent(event, {
          toolUsage,
          toolNamesByKey,
          onEvidenceProgress,
          provider,
        });
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (requireGwsToolRead && process.env.AGENTIC30_TEST_STUB_PROVIDER !== "1") {
    if (!toolUsage.sheetValuesRead || !toolUsage.docRead) {
      throw new Error("Agent가 gws 도구로 Google Sheet 전체 범위와 업무일지 Doc 전체 payload를 확인하지 못했어요.");
    }
  }

  if (!text.trim()) {
    throw new Error("Provider returned an empty mission.");
  }
  return { text, toolUsage };
}

function buildBipCoachProviderSystemPrompt({ requireGwsToolRead }) {
  const lines = [
    "You are generating structured missions for the Agentic30 public execution card.",
    "Return only the requested JSON object in Korean.",
  ];
  if (requireGwsToolRead) {
    lines.push(
      "Before writing the JSON, use agentic30_sidecar.gws_sheets_read to read spreadsheet metadata and the selected tab's full A:I range.",
      "Before writing the JSON, use agentic30_sidecar.gws_docs_read to read the full Google Doc payload.",
      "Use read-only gws CLI only as a fallback if the MCP tools are unavailable.",
      "Never write to Google Docs/Sheets and never use stale app evidence instead of reading the source documents.",
    );
  } else {
    lines.push(
      "The sidecar already read Google Sheet and Google Doc evidence and embedded it in the prompt.",
      "Do not call Google Workspace tools. Use only the provided evidence JSON.",
      "Never write to Google Docs/Sheets.",
    );
  }
  return lines.join("\n");
}

function observeBipCoachToolEvent(event, {
  toolUsage,
  toolNamesByKey,
  onEvidenceProgress,
  provider,
}) {
  const originalName = String(event?.toolName || "");
  if (event?.phase === "use" && event?.toolCallKey) {
    toolNamesByKey.set(event.toolCallKey, originalName);
  }
  const toolName = String(toolNamesByKey.get(event?.toolCallKey) || originalName);
  const normalizedName = toolName.toLowerCase();
  const payload = event?.payload ?? {};
  const payloadText = typeof payload === "string" ? payload : JSON.stringify(payload);

  if (normalizedName.includes("gws_sheets_read")) {
    if (event?.phase === "use") {
      if (payloadHasFullSheetRange(payload)) {
        toolUsage.sheetValuesRequested = true;
        onEvidenceProgress?.("reading_sheet", "Agent가 gws로 SNS 기록 Sheet 전체 범위를 읽는 중", {
          provider,
        });
      } else if (payloadHasSheetRange(payload)) {
        toolUsage.sheetBoundedRangeRejected = true;
        onEvidenceProgress?.("reading_sheet", "Agent가 제한 범위 대신 Sheet 전체 범위를 다시 확인해야 합니다", {
          provider,
        });
      } else {
        toolUsage.sheetMetadataRequested = true;
        onEvidenceProgress?.("reading_sheet", "Agent가 gws로 Sheet 탭을 확인하는 중", {
          provider,
        });
    }
      return;
    }
    if (event?.phase === "result") {
      if (toolUsage.sheetValuesRequested || payloadText.includes("\"values\"")) {
        toolUsage.sheetValuesRead = true;
    }
      return;
    }
  }

  if (normalizedName.includes("gws_docs_read")) {
    if (event?.phase === "use") {
      toolUsage.docRequested = true;
      onEvidenceProgress?.("reading_doc", "Agent가 gws로 업무일지 Doc 전체 payload를 읽는 중", {
        provider,
    });
      return;
    }
    if (event?.phase === "result") {
      toolUsage.docRead = true;
    }
  }

}

function payloadHasSheetRange(payload) {
  return Boolean(extractSheetRange(payload));
}

function payloadHasFullSheetRange(payload) {
  const range = extractSheetRange(payload);
  if (!range) {
    return false;
  }
  const normalized = range.replaceAll("$", "").replaceAll("\\'", "'").trim();
  return /(^|!)A:I$/i.test(normalized);
}

function extractSheetRange(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (typeof payload.range === "string") {
      return payload.range;
    }
    if (typeof payload.arguments === "object" && typeof payload.arguments?.range === "string") {
      return payload.arguments.range;
    }
  }
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  const jsonMatch = text.match(/"range"\s*:\s*"([^"]+)"/);
  if (jsonMatch) {
    return jsonMatch[1];
  }
  const escapedJsonMatch = text.match(/\\"range\\"\s*:\s*\\"([^"]+?)\\"/);
  if (escapedJsonMatch) {
    return escapedJsonMatch[1];
  }
  const flagMatch = text.match(/--range(?:=|\s+)([^,\]\s]+)/);
  return flagMatch?.[1] ?? "";
}

async function completeCurrentBipCoachMission(payload) {
  try {
    const { threadsUrl, sheetRowNote } = await resolveBipCompletionProof({
      threadsUrl: payload.threadsUrl,
      sheetRowNote: payload.sheetRowNote,
    });
    state.bipCoach = completeBipCoachMission(state.bipCoach, {
      threadsUrl,
      sheetRowNote,
    });
    await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_mission_completed", {
      streak_current: state.bipCoach.streak.current,
      streak_longest: state.bipCoach.streak.longest,
    });
    await appendVisibleAssistantMessage(
      payload.sessionId,
      buildMissionCompletionVisibleMessage(state.bipCoach),
    );
  broadcast({ type: "bip_coach_completion_completed", bipCoach: state.bipCoach });
  } catch (error) {
    const rawError = formatError(error);
    const userError = /gws|google|sheet|doc|oauth|rapt/i.test(rawError)
      ? formatBipCoachGwsError(error)
      : rawError;
  await setBipCoachError(userError, "mac_sidecar_bip_coach_completion_failed");
  }
}

async function persistAndBroadcastBipCoach(eventName, properties = {}) {
  await persistBipCoachState(bipCoachFilePath, state.bipCoach);
  telemetry.captureEvent(eventName, {
    schema_version: BIP_COACH_SCHEMA_VERSION,
    ...properties,
  });
  broadcast({ type: "bip_coach_state", bipCoach: state.bipCoach });
}

async function refreshPersistedBipCoachReadinessOnBoot() {
  if (!isBipCoachConfigured(state.bipCoach)) {
    return;
  }

  const config = state.bipCoach.config;
  try {
    const auth = await checkGwsAuthStatus({ env: process.env });
    if (!auth.done) {
      broadcast({
        type: "bip_readiness_event",
        rowId: "gwsAuth",
        status: "blocked",
        readinessError: auth.error,
        error: auth.error?.user_message || auth.error?.raw || "Google Workspace 연결을 다시 확인해야 해요.",
    });
      return;
    }

  broadcast({ type: "bip_readiness_event", rowId: "gwsAuth", status: "done" });

    await refreshPersistedBipResourceReadiness("docUrl", "doc", config.docUrl || config.docId);
    await refreshPersistedBipResourceReadiness("sheetUrl", "sheet", config.sheetUrl || config.sheetId);
  } catch (error) {
    const readinessError = formatReadinessError(error);
  broadcast({
      type: "bip_readiness_event",
      rowId: "gwsAuth",
      status: "blocked",
      readinessError,
      error: readinessError.user_message,
    });
  }
}

async function refreshPersistedBipResourceReadiness(rowId, kind, urlOrId) {
  const result = await validateUrl({ env: process.env, url: urlOrId, kind });
  if (result.ok) {
  broadcast({ type: "bip_readiness_event", rowId, status: "done" });
    return;
  }

  broadcast({
    type: "bip_readiness_event",
    rowId,
    status: "blocked",
    readinessError: result.error,
    error: result.error?.user_message || result.error?.raw || "Google 리소스 권한을 확인하지 못했어요.",
  });
  if (result.error?.kind === "auth_expired") {
  broadcast({ type: "bip_readiness_event", rowId: "gwsAuth", status: "pending" });
  }
}

function resolveBipCoachSession(sessionId = "") {
  const requestedSessionId = String(sessionId || "").trim();
  if (requestedSessionId && state.sessions.has(requestedSessionId)) {
    const requestedSession = state.sessions.get(requestedSessionId);
    if (!isArchivedSession(requestedSession)) {
      return requestedSession;
    }
  }
  const currentSessionId = state.bipCoach?.sessionId;
  if (currentSessionId && state.sessions.has(currentSessionId)) {
    const currentSession = state.sessions.get(currentSessionId);
    if (!isArchivedSession(currentSession)) {
      return currentSession;
    }
  }
  return serializeSessions().find((session) => !isArchivedSession(session)) ?? null;
}

function isArchivedSession(session) {
  return Boolean(session?.archivedAt);
}

async function appendVisibleAssistantMessage(sessionId, content, extra = {}) {
  const session = String(sessionId || "").trim()
    ? state.sessions.get(String(sessionId).trim())
    : null;
  if (!session || !String(content || "").trim()) {
    return null;
  }
  session.messages.push(makeMessage({
    role: "assistant",
    provider: session.provider,
    content,
    state: "final",
    ...extra,
  }));
  session.status = "idle";
  session.error = null;
  touch(session);
  await persistSessions();
  broadcast({ type: "session_updated", session });
  return session;
}

function buildStructuredInputConfirmation(response = {}) {
  const selected = (response.responses || [])
    .flatMap((entry) => entry.selectedOptions || [])
    .map((item) => String(item || "").trim())
    .find(Boolean)
    || "선택한 항목";
  const plan = buildStageAwareActionPlan({
    prompt: selected,
    selectedOption: selected,
    forcedIntentMode: "builder",
  });
  const evidence = plan.evidence_refs.length
    ? plan.evidence_refs.map(formatStructuredEvidenceRef).join(", ")
    : "선택 내용과 현재 BIP 설정";
  return [
    `선택 확인: ${selected}`,
    `Verdict: ${plan.verdict}.`,
    `Evidence: ${evidence}`,
    `다음 액션: ${plan.next_action}`,
    `증거 목표: ${plan.proof_target}`,
  ].join("\n");
}

function formatStructuredEvidenceRef(ref) {
  const value = String(ref || "").trim();
  if (/^docs\/ICP\.md$/i.test(value)) return "ICP 기준 문서";
  if (/^docs\/GOAL\.md$/i.test(value)) return "GOAL 기준 문서";
  if (/^docs\/SPEC\.md$/i.test(value)) return "SPEC 기준 문서";
  return value;
}

function syncBipCoachSessionState({ preferredSessionId = "" } = {}) {
  const session = resolveBipCoachSession(preferredSessionId);
  return normalizeBipCoachState({
    ...state.bipCoach,
    sessionId: session?.id ?? null,
    config: normalizeBipCoachConfig({
      ...state.bipCoach?.config,
      provider: session?.provider || state.bipCoach?.config?.provider,
    }),
  });
}

async function syncAndBroadcastBipCoachSessionState({ preferredSessionId = "" } = {}) {
  const nextState = syncBipCoachSessionState({ preferredSessionId });
  if (
    nextState.sessionId === state.bipCoach?.sessionId
    && nextState.config.provider === state.bipCoach?.config?.provider
  ) {
    return;
  }
  state.bipCoach = nextState;
  await persistBipCoachState(bipCoachFilePath, state.bipCoach);
  broadcast({ type: "bip_coach_state", bipCoach: state.bipCoach });
}

async function setBipCoachError(message, eventName) {
  state.bipCoach = normalizeBipCoachState({
    ...state.bipCoach,
    updatedAt: new Date().toISOString(),
    lastError: message,
  });
  await persistAndBroadcastBipCoach(eventName, { error: message });
  broadcast({
    type: "bip_coach_error",
    message,
    bipCoach: state.bipCoach,
  });
}

async function clearInitialIntakeIfNeeded(session) {
  if (!session?.pendingUserInput || session.pendingUserInput.toolName !== "initial_intake") {
    return;
  }
  const requestId = session.pendingUserInput.requestId;
  session.pendingUserInput = null;
  if (session.status === "awaiting_input") {
  session.status = "idle";
  }
  touch(session);
  state.resolvedUserInputIds.add(requestId);
  await deleteUserInputArtifacts(appSupportPath, session.id, requestId).catch(() => {});
  await persistSessions();
  broadcast({ type: "session_updated", session });
}

function serializeBipSetupGate(gate) {
  return {
    bipSetupReady: Boolean(gate?.ready),
    iddSetupComplete: Boolean(gate?.iddSetupComplete),
    iddSetupStatus: gate?.iddSetupStatus ?? "not_started",
    iddCurrentDocType: gate?.iddCurrentDocType ?? null,
    iddAmbiguityScore: gate?.iddAmbiguityScore ?? null,
    iddUnresolvedAssumptions: gate?.iddUnresolvedAssumptions ?? [],
    iddDocOrder: gate?.iddDocOrder ?? [],
    iddDocPreviews: gate?.iddDocPreviews ?? [],
    iddProviderRecovery: gate?.iddProviderRecovery ?? null,
    iddSetupError: gate?.iddSetupError ?? null,
    missingLocalDocs: (gate?.missingLocalDocs ?? []).map((doc) => doc.type),
    missingExternalRequirements: (gate?.missingExternalRequirements ?? []).map((item) => item.id),
    nextIddDocumentType: gate?.nextLocalDoc?.type ?? null,
    nextIddDocumentTitle: gate?.nextLocalDoc?.title ?? null,
    bipSetupGateMessage: summarizeBipSetupGate(gate),
  };
}

function broadcastBipSetupGateState(gate) {
  broadcast({
    type: "bip_setup_gate_state",
    ...serializeBipSetupGate(gate),
  });
}

function hasActiveIddQuestionSession(docType) {
  return [...state.sessions.values()].some((session) =>
    (session.runtime?.iddDocumentType === docType || session.title?.includes(`[IDD:${docType}]`))
      && (
        session.status === "running"
        || session.status === "awaiting_input"
        || Boolean(session.pendingUserInput)
      )
  );
}

function shouldAutoStartIddDocumentQueue(gate) {
  if (!gate || gate.iddSetupComplete) return false;
  if (!gate.nextLocalDoc?.type) return false;
  if (gate.iddSetupStatus === "error" && isRecoverableLegacyStaleIddSetupError(gate)) {
    return !hasActiveIddQuestionSession(gate.nextLocalDoc.type);
  }
  if (["error", "provider_recovery", "preview_ready", "approved"].includes(gate.iddSetupStatus)) {
    return false;
  }
  return !hasActiveIddQuestionSession(gate.nextLocalDoc.type);
}

function isRecoverableLegacyStaleIddSetupError(gate) {
  const error = gate?.iddSetupError;
  if (!error || error.recoverable === false) return false;
  const errorDocType = error.docType || gate?.nextLocalDoc?.type || "";
  if (errorDocType && gate?.nextLocalDoc?.type && errorDocType !== gate.nextLocalDoc.type) {
    return false;
  }
  return /완료 이벤트 없이 중단/.test(String(error.message || ""));
}

function resolveIddSessionSeed({ sessionId = "", provider = "" } = {}) {
  const requestedSession = resolveBipCoachSession(sessionId);
  const resolvedProvider = normalizeSessionProvider(provider) === provider
    ? provider
    : requestedSession?.provider || state.bipCoach?.config?.provider || "codex";
  return {
    provider: resolvedProvider,
    model: requestedSession?.provider === resolvedProvider ? requestedSession.model : "",
  };
}

function findExistingIddSession(docType, { includeRecoverableError = false } = {}) {
  const marker = `[IDD:${docType}]`;
  return [...state.sessions.values()].find((session) =>
    (session.runtime?.iddDocumentType === docType || session.title?.includes(marker))
    && (
      session.status === "running"
      || session.status === "awaiting_input"
      || session.status === "idle"
      || (includeRecoverableError && session.status === "error")
    )
  ) || null;
}

function takePendingIddContinuationPrompt(session, requestId) {
  const pending = session.runtime?.pendingIddContinuation;
  if (!pending || pending.requestId !== requestId || !pending.prompt) {
    return { prompt: "", docType: "" };
  }

  session.runtime = {
    ...(session.runtime || {}),
    pendingIddContinuation: null,
  };
  return {
    prompt: String(pending.prompt),
    docType: String(pending.docType || ""),
    hostGenerated: pending.hostGenerated === true,
  };
}

async function createHostIddQuestionRequest(session, doc, {
  localEvidence = null,
  previousRequestId = null,
  progressText = "질문 카드 준비 완료",
  iddMode = session?.runtime?.iddMode || null,
  titlePrefix = iddMode === "day1_handoff" ? "Day 1 Handoff" : "Foundation Setup",
} = {}) {
  if (!session?.id || !doc?.type) {
    throw new Error("Host IDD question requires a session and document type.");
  }

  if (session.pendingUserInput?.requestId) {
    await deleteUserInputArtifacts(appSupportPath, session.id, session.pendingUserInput.requestId).catch(() => {});
    state.resolvedUserInputIds.add(session.pendingUserInput.requestId);
  }

  const hasDraftForDoc = Boolean(state.iddSetup?.drafts?.[doc.type]?.trim());
  const fallbackInput = hasDraftForDoc
    ? buildIddFollowupStructuredInputForDoc(doc, state.iddSetup)
    : initialIddStructuredInputForDoc(doc, {
        provider: session.provider,
        onboardingHypothesis: doc.type === "icp" ? await currentWorkspaceOnboardingHypothesis() : null,
        onboardingContext: doc.type === "icp" ? localEvidence?.onboardingContext : null,
        forceHostStructuredInput: true,
      });
  const structuredInput = await synthesizeIddQuestionWithSidecarAgent(session, doc, fallbackInput, {
    iddSetup: state.iddSetup,
    followup: hasDraftForDoc,
  }) || fallbackInput;
  if (!structuredInput?.toolName || !Array.isArray(structuredInput.questions)) {
    throw new Error(`Unable to build host IDD question for ${doc.type}.`);
  }

  const request = await createUserInputRequest(appSupportPath, {
    sessionId: session.id,
    toolName: structuredInput.toolName,
    title: structuredInput.title || `${doc.title} 질문`,
    intro: structuredInput.intro || null,
    resources: structuredInput.resources || null,
    questions: structuredInput.questions,
    generation: {
      ...(structuredInput.generation && typeof structuredInput.generation === "object"
        ? structuredInput.generation
        : {}),
      mode: iddMode === "day1_handoff"
        ? "day1_handoff"
        : (structuredInput.generation?.mode || "host_structured"),
      docType: doc.type,
    },
  });

  session.pendingUserInput = request;
  session.status = "awaiting_input";
  session.error = null;
  session.title = `${titlePrefix}: ${doc.title}`;
  session.runtime = {
    ...(session.runtime || {}),
    iddDocumentType: doc.type,
    ...(iddMode ? { iddMode } : {}),
    pendingIddContinuation: {
      requestId: request.requestId,
      docType: doc.type,
      prompt: "host_structured_idd_question",
      hostGenerated: true,
    },
    iddPendingAdaptiveContinuation: null,
    iddAdaptiveRegenerationInFlight: false,
  };
  touch(session);

  broadcast({
    type: "idd_setup_progress",
    sessionId: session.id,
    requestId: previousRequestId || request.requestId,
    docType: doc.type,
    stage: "preparing_question",
    progressText,
    elapsedMs: 0,
  });
  telemetry.captureEvent("mac_sidecar_idd_host_question_created", {
    session_id: session.id,
    doc_type: doc.type,
    request_id: request.requestId,
    question_count: request.questions.length,
    has_existing_draft: hasDraftForDoc,
    generation_mode: request.generation?.mode || "host_structured",
  });
  return request;
}

async function synthesizeIddQuestionWithSidecarAgent(session, doc, fallbackInput, {
  iddSetup = null,
  followup = false,
} = {}) {
  if (process.env.AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS === "1") return null;
  if (!session?.provider || !doc?.type || !fallbackInput?.questions?.length) return null;
  const authState = getProviderAuthState(session.provider);
  if (!authState.available) {
    telemetry.captureEvent("mac_sidecar_idd_agent_synthesis_skipped", {
      session_id: session.id,
      doc_type: doc.type,
      provider: session.provider,
      reason: authState.source,
    });
    return null;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let responseText = "";

  try {
    broadcast({
      type: "idd_setup_progress",
      sessionId: session.id,
      docType: doc.type,
      stage: "agent_question_synthesis",
      progressText: "sidecar agent가 프로젝트 맥락으로 질문 카드를 합성 중",
      elapsedMs: 0,
    });

    if (process.env.AGENTIC30_TEST_IDD_AGENT_SYNTHESIS_JSON) {
      responseText = process.env.AGENTIC30_TEST_IDD_AGENT_SYNTHESIS_JSON;
    } else {
      await runProviderStream({
        provider: session.provider,
        sessionRuntime: {},
        prompt: await buildIddAgentSynthesisPrompt(doc, fallbackInput, { iddSetup, followup }),
        model: session.model,
        workspaceRoot,
        abortController: controller,
        executionMode: "idd_question_synthesis",
        systemPromptOverride: [
          "You synthesize one structured customer-discovery question for agentic30 Foundation Setup.",
          "You do not use tools. Work only from the workspace facts embedded in the prompt.",
          "Return only valid JSON matching the requested schema.",
        ].join("\n"),
        onTextDelta: (text) => {
          responseText += text;
        },
        onTextReplace: (text) => {
          responseText = text;
        },
        onRunEvent: (event) => {
          if (event.once) return;
          telemetry.captureEvent("mac_sidecar_idd_agent_synthesis_phase", {
            session_id: session.id,
            doc_type: doc.type,
            provider: session.provider,
            phase: event.phase,
          });
        },
      });
    }

    const structuredInput = parseIddAgentSynthesis(responseText, doc, fallbackInput);
    if (!structuredInput) {
      throw new Error("Agent synthesis returned no valid structured question.");
    }
    // F1: reject agent-synthesized cards that drifted off the rubric signal
    // the follow-up was supposed to address. The HARD TARGETING prompt rule
    // is instruction-only; a runtime keyword check guarantees the user never
    // sees another narrow_segment card when the rubric wants reachability or
    // pressure-cost. On reject we throw — the parent catch returns null and
    // the caller automatically falls back to the host_structured card.
    const expectedSignalId = fallbackInput?.generation?.signalId || null;
    if (expectedSignalId && !agentSynthesisTargetsCorrectSignal({
      question: structuredInput.questions?.[0]?.question,
      options: structuredInput.questions?.[0]?.options,
      expectedSignalId,
    })) {
      telemetry.captureEvent("mac_sidecar_idd_agent_dimension_drift_rejected", {
        session_id: session.id,
        doc_type: doc.type,
        provider: session.provider,
        expected_signal_id: expectedSignalId,
      });
      throw new Error(`Agent synthesis drifted off expected signal ${expectedSignalId}.`);
    }
    telemetry.captureEvent("mac_sidecar_idd_agent_synthesis_completed", {
      session_id: session.id,
      doc_type: doc.type,
      provider: session.provider,
      duration_ms: Date.now() - startedAt,
    });
    return structuredInput;
  } catch (error) {
    telemetry.captureException(error, {
      operation: "idd_agent_question_synthesis",
      session_id: session.id,
      doc_type: doc.type,
      provider: session.provider,
      duration_ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function iddAgentSynthesisBrief(doc) {
  switch (doc?.type) {
    case "goal":
      return {
        taskLine: "The user is the Agentic30 builder/founder. Ask which measurable proof target they will pursue first.",
        evidenceLine: "Use the workspace facts below to choose the sharpest GOAL question about proof target, metric, threshold, or failure condition.",
        audienceRule: "- Do not ask the end customer a research question. Ask the builder to choose a measurable goal for this week.",
        questionShapeRule: "- The question should be one clear sentence ending in 요/까요, usually asking what proof target or metric will define progress this week.",
        optionRule: "- Every option label must be a possible proof target or measurable progress criterion.",
        header: "이번 주 GOAL",
        schemaQuestion: "이번 주 가장 먼저 증명할 목표와 판단 지표는 무엇인가요?",
        options: [
          { label: "첫 고객 반응", description: "응답, 미팅, 사용 시도처럼 ICP가 실제 반응하는지 봅니다.", nextIntent: "goal_customer_response" },
          { label: "문제 강도", description: "현재 대안의 시간, 돈, 평판 비용이 충분히 큰지 봅니다.", nextIntent: "goal_problem_intensity" },
          { label: "완료 행동", description: "사용자가 핵심 workflow를 끝까지 완료하는지 봅니다.", nextIntent: "goal_completion_behavior" },
        ],
        placeholder: "예: 이번 주 5명에게 인터뷰 요청하고 3명 이상 답하면 GOAL 기준을 통과로 본다",
      };
    case "values":
      return {
        taskLine: "The user is the Agentic30 builder/founder. Ask which tradeoff or refusal rule should guide this week.",
        evidenceLine: "Use the workspace facts below to choose the sharpest VALUES question about tradeoffs, rejected options, triggers, or violations.",
        audienceRule: "- Do not ask for brand values or aspirational words. Ask for a decision rule that changes what the builder will do or refuse.",
        questionShapeRule: "- The question should be one clear sentence ending in 요/까요, usually asking what tradeoff or refusal trigger matters this week.",
        optionRule: "- Every option label must be a possible decision principle, tradeoff, or refusal rule.",
        header: "결정 원칙",
        schemaQuestion: "이번 주 어떤 상황에서 반드시 지킬 tradeoff나 거절 기준은 무엇인가요?",
        options: [
          { label: "증거 우선", description: "새 기능보다 사용자 행동 증거를 먼저 봅니다.", nextIntent: "values_evidence_first" },
          { label: "좁은 성공", description: "넓은 기능보다 한 workflow 완료를 우선합니다.", nextIntent: "values_narrow_success" },
          { label: "직접 관찰", description: "자동화보다 사용자가 막히는 장면을 먼저 봅니다.", nextIntent: "values_observe_first" },
        ],
        placeholder: "예: 첫 실행에서는 멋진 채팅보다 질문이 바뀌지 않는 신뢰를 우선한다",
      };
    case "spec":
      return {
        taskLine: "The user is the Agentic30 builder/founder. Ask which MVP workflow and non-goal should define the first build.",
        evidenceLine: "Use the workspace facts below to choose the sharpest SPEC question about user workflow, MVP wedge, non-goal, success signal, or core risk.",
        audienceRule: "- Do not ask for a full product requirements document. Ask for the smallest workflow that must work for one user.",
        questionShapeRule: "- The question should be one clear sentence ending in 요/까요, usually asking what core workflow the first version must complete.",
        optionRule: "- Every option label must be a possible workflow, MVP wedge, non-goal, or success criterion.",
        header: "MVP 흐름",
        schemaQuestion: "이번 주 첫 버전에서 사용자가 반드시 끝내야 하는 핵심 workflow는 무엇인가요?",
        options: [
          { label: "첫 질문 답변", description: "맞춤 질문이 안정적으로 나타나고 사용자가 답변합니다.", nextIntent: "spec_first_question" },
          { label: "4문서 승인", description: "Foundation 문서를 검토하고 Day 1 Mission을 엽니다.", nextIntent: "spec_approve_docs" },
          { label: "첫 미션 저장", description: "Day 1 미션을 선택하거나 생성해 실행 상태로 둡니다.", nextIntent: "spec_save_mission" },
        ],
        placeholder: "예: 사용자가 첫 질문에 답하고 4문서 미리보기를 승인하면 Day 1 미션이 열린다",
      };
    default:
      return {
        taskLine: "The user is the Agentic30 builder/founder. Ask the builder which customer segment they will interview first.",
        evidenceLine: "Use the workspace facts below to choose the sharpest ICP/customer segment question.",
        audienceRule: "- Do not ask the end customer a research question. Ask the builder to choose the first ICP/customer segment.",
        questionShapeRule: "- The question should be one clear sentence ending in 요/까요, usually '이번 주 가장 먼저 인터뷰할 ... 누구인가요?'",
        optionRule: "- Every option label must be a possible Agentic30 customer segment.",
        header: "첫 고객",
        schemaQuestion: "이번 주 가장 먼저 인터뷰할 1인 개발자 유형은 누구인가요?",
        options: [
          { label: "퇴사 후 첫 매출이 없는 개발자", description: "why this segment is a strong first interview target", nextIntent: "first_revenue_zero" },
          { label: "AI로 제품은 만들었지만 고객이 없는 개발자", description: "why this segment is a strong first interview target", nextIntent: "agent_built_no_customers" },
          { label: "여러 번 출시했지만 반응이 약했던 개발자", description: "why this segment is a strong first interview target", nextIntent: "weak_launch_response" },
        ],
        placeholder: "예: 퇴사 후 3개월째, AI로 MVP는 만들었지만 유료 고객이 없는 개발자",
      };
  }
}

async function buildIddAgentSynthesisPrompt(doc, fallbackInput, {
  iddSetup = null,
  followup = false,
} = {}) {
  const brief = iddAgentSynthesisBrief(doc);
  const onboardingHypothesis = await currentWorkspaceOnboardingHypothesis();
  const contextFiles = await collectIddSynthesisContextFiles();
  const fallbackQuestion = fallbackInput?.questions?.[0] || {};
  const normalizedIdd = iddSetup ? normalizeIddSetupState(iddSetup) : null;
  const docRubric = normalizedIdd?.ambiguityRubric?.docs?.find((entry) => entry.type === doc.type) || null;
  const missingSignals = Array.isArray(docRubric?.missingSignals) ? docRubric.missingSignals : [];
  const docAnswers = Array.isArray(normalizedIdd?.transcript)
    ? normalizedIdd.transcript
        .filter((entry) => entry?.docType === doc.type)
        .map((entry) => String(entry?.responseText || "").trim())
        .filter(Boolean)
        .slice(-4)
    : [];
  const stageLabel = followup ? "next" : "first";
  return [
    "Return exactly one JSON object. No markdown. No prose.",
    "",
    `Task: create the ${stageLabel} Foundation Setup ${doc.title} question card for the app builder.`,
    brief.taskLine,
    "The question must be dynamic and project-adaptive, not a template with variables filled in.",
    brief.evidenceLine,
    "",
    "Hard rules:",
    "- Do not call tools or ask to inspect files.",
    "- Do not ask whether the project summary is correct.",
    brief.audienceRule,
    followup
      ? "- This is a follow-up. Use the user's previous answer and the missing rubric signals below to ask the next necessary decision. Do not repeat the previous question or option labels."
      : "- This is the first card for this document. Use workspace evidence to make the first decision concrete.",
    followup
      ? "- HARD TARGETING: your question MUST address the FIRST entry in currentDocRubric.missingSignals (id and label). Do NOT keep narrowing a signal that already appears in passedSignals. If missingSignals[0].id is reachable_person, ask about reachability (이름·계정·DM 가능성). If current_alternative, ask how the segment currently works around the problem. If pressure_cost, ask about time/money/reputation cost. Switching dimension is the goal — repeating the same dimension wastes the user's interview turn."
      : "",
    "- Do not ask about onboarding, workspace permissions, local file access, provider execution, implementation, or setup trust.",
    "- Do not ask generic questions like '이번 주 바로 인터뷰할 첫 고객은 누구인가요?' unless the Agentic30 ICP context is explicitly embedded in the same sentence.",
    "- Keep the question under 130 Korean characters when possible.",
    "- Prefer concise, natural Korean. Write like product UI, not like copied documentation.",
    "- Do not force product name, Mac, macOS, provider names, or file/workspace terms into the question or option labels unless they are essential to choosing the customer segment.",
    "- If platform fit matters, put it in helperText or option descriptions, not in every label.",
    brief.questionShapeRule,
    "- Provide 2-4 project-specific options. Free text is provided by the host UI, so do not add a direct-input option.",
    "- Options must be SEMANTICALLY DISTINCT scenarios. Two options that share more than two content keywords (e.g., both about 'AI로 만든 / 고객 없는' or both about '출시 후 반응 약함') are duplicates — merge them into one or replace one with a different angle.",
    "- Options must name concrete choices, not abstract criteria.",
    "- For follow-ups, every option must be derived from the previous answer, workspace evidence, or the named missing signal. Do not use generic labels like 새 기능 보류, 자동화 보류, 숫자/기준, 실제 사람/상황, 리스크/실패 조건 unless the previous answer itself used that exact concrete choice.",
    brief.optionRule,
    "- Option labels should be short and natural, ideally under 22 Korean characters.",
    "- Avoid awkward literal phrases like 'N번째 제품 실패한', 'macOS 개발자', or '세그먼트부터 시작'. Rewrite them as natural customer language.",
    "- freeTextPlaceholder must invite a concrete behavioral example (one person + one observed action + one specific number/place) rather than a paraphrase of the option labels. Bad: '예: Threads에 랜딩을 올렸지만 방문만 있고 가입이 없는 1인 개발자' (just rewrites the segment). Good: '예: A씨가 어제 Threads에 랜딩을 올렸는데 3시간 동안 방문 240명, 가입 0명' (concrete person + verb + numbers). Korean creators reach the indie/maker audience on Threads, not X — prefer Threads in any platform example.",
    "- Return Korean UI copy.",
    "- Return exactly the compact schema below. Do not create multiple questions.",
    "",
    "JSON schema:",
    JSON.stringify({
      title: `${doc.title} 정하기`,
      header: brief.header,
      helperText: "one short natural sentence with the project-specific context",
      question: brief.schemaQuestion,
      options: brief.options,
      freeTextPlaceholder: brief.placeholder,
    }, null, 2),
    "",
    "Document:",
    JSON.stringify({
      type: doc.type,
      title: doc.title,
      canonicalPath: doc.canonicalPath,
    }, null, 2),
    "",
    "Workspace hypothesis:",
    JSON.stringify(onboardingHypothesis, null, 2),
    "",
    "Current IDD state:",
    JSON.stringify(normalizedIdd ? {
      status: normalizedIdd.status,
      ambiguityScore: normalizedIdd.ambiguityScore,
      currentDocType: normalizedIdd.currentDocType,
      currentDocRubric: docRubric ? {
        score: docRubric.score,
        missingSignals,
        passedSignals: docRubric.passedSignals,
      } : null,
      previousAnswersForThisDocument: docAnswers,
      unresolvedAssumptions: normalizedIdd.unresolvedAssumptions?.slice(0, 8) || [],
    } : null, null, 2),
    "",
    "Local evidence excerpts:",
    JSON.stringify(contextFiles, null, 2),
    "",
    "Fallback card for reference only. Improve it; do not copy it blindly:",
    JSON.stringify(fallbackInput, null, 2),
    "",
    "Return JSON now.",
  ].join("\n");
}

async function collectIddSynthesisContextFiles() {
  const configPaths = currentBipConfig()?.workspace || {};
  const candidates = [
    "docs/ICP.md",
    "docs/SPEC.md",
    "docs/GOAL.md",
    "docs/VALUES.md",
    ...Object.values(configPaths || {}).filter(Boolean),
  ];
  const seen = new Set();
  const excerpts = [];
  for (const relativePath of candidates) {
    const normalized = String(relativePath || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const excerpt = await readWorkspaceTextExcerpt(normalized, 2200);
    if (excerpt) excerpts.push(excerpt);
    if (excerpts.length >= 8) break;
  }
  return excerpts;
}

async function readWorkspaceTextExcerpt(relativePath, maxChars) {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const root = path.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    const content = await fs.readFile(resolved, "utf8");
    return {
      path: path.relative(root, resolved).split(path.sep).join(path.posix.sep),
      excerpt: content.slice(0, maxChars),
    };
  } catch {
    return null;
  }
}

function parseIddAgentSynthesis(text, doc, fallbackInput = null) {
  const parsed = parseFirstJsonObject(text);
  const question = parsed?.questions?.[0] || salvageIddAgentQuestionObject(parsed, fallbackInput);
  if (!question || typeof question !== "object") return null;
  const normalizedQuestion = normalizeIddAgentQuestion(question);
  if (!normalizedQuestion) return null;
  // PR1: when an LLM-synthesized card replaces the host fallback, keep the
  // dimension/transition metadata so the Mac UI still renders the chip,
  // breadcrumb, and "n/total · signalLabel" status.
  const fallbackGen = fallbackInput?.generation && typeof fallbackInput.generation === "object"
    ? fallbackInput.generation
    : null;
  const structuredInput = {
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: cleanShortText(parsed.title, 80) || `${doc.title} 1/4`,
    generation: {
      mode: "sidecar_agent_synthesized",
      docType: doc.type,
      ...(fallbackGen
        ? {
            signalId: fallbackGen.signalId ?? undefined,
            signalLabel: fallbackGen.signalLabel ?? undefined,
            isLastSignalForDoc: fallbackGen.isLastSignalForDoc ?? undefined,
            dimensionTransitioned: fallbackGen.dimensionTransitioned ?? undefined,
            previousSignalLabel: fallbackGen.previousSignalLabel ?? undefined,
            previousAnswerLabel: fallbackGen.previousAnswerLabel ?? undefined,
            dimensionStepIndex: fallbackGen.dimensionStepIndex ?? undefined,
            dimensionTotal: fallbackGen.dimensionTotal ?? undefined,
          }
        : {}),
    },
    questions: [normalizedQuestion],
  };
  return doc.type === "icp" ? decorateIcpStructuredInput(structuredInput) : structuredInput;
}

function normalizeIddAgentQuestion(question) {
  const questionText = cleanShortText(question.question, 220);
  const options = Array.isArray(question.options)
    ? dedupeIddAgentOptions(
        question.options
          .map((option) => ({
            label: cleanShortText(option?.label, 64),
            description: cleanShortText(option?.description, 110),
            nextIntent: cleanToken(option?.nextIntent) || "project_specific_icp",
          }))
          .filter((option) => option.label && option.description && !isOtherTextOptionLabel(option.label)),
      ).slice(0, 4)
    : [];
  if (!questionText || options.length < 2) return null;
  return {
    header: cleanShortText(question.header, 40) || "첫 고객",
    helperText: cleanShortText(question.helperText, 180) || "프로젝트 맥락에서 첫 고객 후보 하나만 고릅니다.",
    question: questionText,
    options: options.slice(0, 4),
    multiSelect: false,
    allowFreeText: true,
    requiresFreeText: false,
    freeTextPlaceholder: cleanShortText(question.freeTextPlaceholder, 140) || "예: 이번 주 실제로 연락 가능한 고객 후보",
    textMode: question.textMode === "long" ? "long" : "short",
  };
}

function salvageIddAgentQuestionObject(parsed, fallbackInput) {
  if (!parsed || typeof parsed !== "object") return null;
  const questionText = cleanShortText(parsed.question, 220);
  if (!questionText) return null;
  const fallbackQuestion = fallbackInput?.questions?.[0] || {};
  const fallbackOptions = Array.isArray(fallbackQuestion.options) ? fallbackQuestion.options : [];
  const options = Array.isArray(parsed.options)
    ? parsed.options
        .map((option) => ({
          label: cleanShortText(option?.label, 64),
          description: cleanShortText(option?.description, 110),
          nextIntent: cleanToken(option?.nextIntent) || "project_specific_icp",
        }))
        .filter((option) => option.label && option.description && !isOtherTextOptionLabel(option.label))
        .slice(0, 4)
    : [];
  const targetCustomer = cleanShortText(parsed.target_customer || parsed.targetCustomer, 64);
  if (targetCustomer && !options.some((option) => option.label === targetCustomer)) {
    options.push({
      label: targetCustomer,
      description: cleanShortText(parsed.why_it_matters || parsed.whyItMatters, 110)
        || "프로젝트 문서에서 가장 직접적인 첫 인터뷰 후보로 추론됐습니다.",
      nextIntent: "agent_suggested_icp",
    });
  }
  for (const option of fallbackOptions) {
    if (!option?.label || options.some((existing) => existing.label === option.label)) continue;
    if (isOtherTextOptionLabel(option.label)) continue;
    options.push(option);
    if (options.length >= 4) break;
  }
  const dedupedOptions = dedupeIddAgentOptions(options).slice(0, 4);
  return {
    header: cleanShortText(parsed.header, 40) || fallbackQuestion.header || "첫 고객",
    helperText: cleanShortText(parsed.helperText || parsed.learning_goal || parsed.learningGoal || parsed.why_it_matters || parsed.whyItMatters, 180)
      || fallbackQuestion.helperText
      || "프로젝트 맥락에서 첫 고객 후보 하나만 고릅니다.",
    question: questionText,
    options: dedupedOptions,
    multiSelect: false,
    allowFreeText: true,
    requiresFreeText: false,
    freeTextPlaceholder: cleanShortText(parsed.freeTextPlaceholder, 140)
      || fallbackQuestion.freeTextPlaceholder
      || "예: 이번 주 실제로 연락 가능한 고객 후보",
    textMode: parsed.textMode === "long" ? "long" : "short",
  };
}

function parseFirstJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = fenceMatch?.[1]?.trim() ?? raw;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanShortText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function cleanToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function selectNextIddAdaptiveDoc(iddSetup, completedDoc) {
  const completedType = String(completedDoc?.type || "");
  const currentDocRubric = iddSetup?.ambiguityRubric?.docs?.find((entry) => entry.type === completedType);
  if (currentDocRubric?.blocked && iddSetup?.drafts?.[completedType]?.trim()) {
    return completedDoc;
  }

  const blockedDocRubric = iddSetup?.ambiguityRubric?.docs?.find((entry) =>
    entry.blocked && iddSetup?.drafts?.[entry.type]?.trim()
  );
  if (blockedDocRubric) {
    return IDD_FOUNDATION_DOCS.find((doc) => doc.type === blockedDocRubric.type) || null;
  }

  return nextIddFoundationDoc(iddSetup);
}

function isStructuredInputToolName(toolName) {
  const normalized = String(toolName || "");
  return normalized === CODEX_STRUCTURED_INPUT_TOOL
    || normalized === "AskUserQuestion"
    || normalized === "ask_user_question";
}

function allowOtherTextForIddQuestions(request) {
  if (!Array.isArray(request?.questions)) {
    return request;
  }
  return {
    ...request,
    questions: request.questions.map((question) => ({
      ...question,
      allowFreeText: true,
      requiresFreeText: false,
      freeTextPlaceholder: question?.freeTextPlaceholder || "예: 이번 주 확인 가능한 사람/행동/숫자/실패 조건",
      textMode: question?.textMode || "short",
    })),
  };
}

function isOtherTextOptionLabel(label) {
  const normalized = String(label || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[()（）]/g, " ")
    .toLowerCase()
    .trim();
  return /(?:^|[\s:：\-_/])직접\s*입력(?:$|[\s:：\-_/])/.test(normalized)
    || /^기타(?:$|[\s:：\-_/])/.test(normalized)
    || /^other(?:$|[\s:：\-_/])/.test(normalized);
}

function attachIddAdaptiveContinuationToRequest(session, request) {
  const pending = session.runtime?.iddPendingAdaptiveContinuation;
  if (!pending?.docType || !pending?.prompt || !isStructuredInputToolName(request?.toolName)) {
    return request;
  }

  const nextDoc = IDD_FOUNDATION_DOCS.find((doc) => doc.type === pending.docType)
    || requiredDocByType(pending.docType);
  const nextRequest = {
    ...allowOtherTextForIddQuestions(request),
    generation: {
      ...(request.generation && typeof request.generation === "object" ? request.generation : {}),
      mode: "provider_adaptive",
      docType: pending.docType,
    },
  };
  session.runtime = {
    ...(session.runtime || {}),
    iddDocumentType: pending.docType,
    pendingIddContinuation: {
      requestId: request.requestId,
      docType: pending.docType,
      prompt: pending.prompt,
    },
    iddPendingAdaptiveContinuation: null,
    iddAdaptiveRegenerationInFlight: false,
  };
  session.title = `Foundation Setup: ${nextDoc.title}`;
  broadcast({
    type: "idd_setup_progress",
    sessionId: session.id,
    requestId: pending.previousRequestId || request.requestId,
    docType: pending.docType,
    stage: "preparing_question",
    progressText: "adaptive 질문 준비 완료",
    elapsedMs: 0,
  });
  return nextRequest;
}

function isIddInterviewSession(session) {
  return Boolean(
    session?.runtime?.iddDocumentType
      || session?.runtime?.pendingIddContinuation?.docType
      || session?.runtime?.iddPendingAdaptiveContinuation?.docType
      || String(session?.title || "").startsWith("Foundation Setup:"),
  );
}

async function restartIddAdaptiveQuestionGeneration(session, {
  previousRequestId = null,
  reason = "legacy_static_blocked",
} = {}) {
  if (!isIddInterviewSession(session)) return false;
  if (state.activeRuns.has(session.id)) {
    session.status = "running";
    touch(session);
    return true;
  }
  if (session.runtime?.iddAdaptiveRegenerationInFlight) {
    session.status = "running";
    touch(session);
    return true;
  }

  const pending = session.runtime?.pendingIddContinuation
    || session.runtime?.iddPendingAdaptiveContinuation
    || {};
  const docType = pending.docType || session.runtime?.iddDocumentType;
  if (!docType) return false;
  const doc = IDD_FOUNDATION_DOCS.find((candidate) => candidate.type === docType)
    || requiredDocByType(docType);
  if (!doc) return false;

  session.pendingUserInput = null;
  session.status = "awaiting_input";
  session.runtime = {
    ...(session.runtime || {}),
    iddDocumentType: doc.type,
    pendingIddContinuation: null,
    iddAdaptiveRegenerationInFlight: false,
    iddPendingAdaptiveContinuation: null,
  };
  await createHostIddQuestionRequest(session, doc, {
    previousRequestId,
    progressText: "static 질문을 폐기하고 질문 카드를 다시 준비했습니다.",
  });
  touch(session);
  state.sessions.set(session.id, session);
  await persistSessions();
  broadcast({
    type: "idd_setup_progress",
    sessionId: session.id,
    requestId: previousRequestId,
    docType: doc.type,
    stage: reason,
    progressText: "static 질문을 폐기하고 질문 카드를 다시 준비했습니다.",
    elapsedMs: 0,
  });
  broadcast({ type: "session_updated", session });
  return true;
}

async function currentWorkspaceOnboardingHypothesis() {
  if (state.workspaceOnboardingHypothesis) {
    return state.workspaceOnboardingHypothesis;
  }
  state.workspaceOnboardingHypothesis = await deriveWorkspaceOnboardingHypothesisLocally(workspaceRoot, {
    docPaths: currentBipConfig()?.workspace || {},
  });
  return state.workspaceOnboardingHypothesis;
}

function scheduleWorkspaceOnboardingHypothesisWarmup() {
  if (state.workspaceOnboardingHypothesis || workspaceOnboardingHypothesisWarmup) {
    return;
  }
  workspaceOnboardingHypothesisWarmup = currentWorkspaceOnboardingHypothesis()
    .catch((error) => {
      telemetry.captureException(error, {
        operation: "workspaceOnboardingHypothesisWarmup",
    });
      return null;
    })
    .finally(() => {
      workspaceOnboardingHypothesisWarmup = null;
    });
}

function normalizeDay1HandoffPayload(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const clean = (key, max = 4000) => String(source[key] || "").trim().slice(0, max);
  return {
    goal: clean("goal", 1000),
    icp: clean("icp", 1000),
    pain: clean("pain", 1000),
    outcome: clean("outcome", 1000),
    qualityScore: clean("qualityScore", 80),
    markdown: clean("markdown", 5000),
  };
}

function findExistingDay1HandoffSession(docType) {
  return [...state.sessions.values()].find((session) =>
    session.runtime?.iddMode === "day1_handoff"
      && session.runtime?.iddDocumentType === docType
      && session.archivedAt == null
      && ["running", "awaiting_input", "idle", "error"].includes(session.status)
  ) || null;
}

async function startDay1DocHandoff({
  sessionId = "",
  provider = "",
  requestedDocType = "",
  localEvidence = null,
  day1Handoff = null,
} = {}) {
  const doc = day1HandoffDocByType(requestedDocType);
  if (!doc || !DAY1_HANDOFF_DOC_TYPES.includes(doc.type)) {
    throw new Error(`Unknown Day 1 handoff document type: ${requestedDocType}`);
  }
  if (!canStartDay1HandoffDoc(state.iddSetup, doc.type)) {
    const nextType = DAY1_HANDOFF_DOC_TYPES.find((type) => !canStartDay1HandoffDoc(state.iddSetup, type) || !state.iddSetup?.docWriteStatuses?.[type]?.status)
      || DAY1_HANDOFF_DOC_TYPES[0];
    throw new Error(`Day 1 handoff must write documents in order. Next expected document: ${nextType}.`);
  }

  const seed = resolveIddSessionSeed({ sessionId, provider });
  const handoffSnapshot = normalizeDay1HandoffPayload(day1Handoff);
  let session = findExistingDay1HandoffSession(doc.type);
  const isNewSession = !session;
  if (!session) {
    session = createSession(seed);
  }
  session.title = `Day 1 Handoff: ${doc.title}`;
  session.runtime = {
    ...(session.runtime || {}),
    iddDocumentType: doc.type,
    iddMode: "day1_handoff",
    day1Handoff: handoffSnapshot,
    day1HandoffFollowupCount: 0,
    pendingIddContinuation: null,
    iddPendingAdaptiveContinuation: null,
    iddAdaptiveRegenerationInFlight: false,
  };
  state.iddSetup = await persistIddSetupState(workspaceRoot, {
    ...state.iddSetup,
    status: "interviewing",
    currentDocType: doc.type,
    lastProvider: seed.provider,
    providerRecovery: null,
    setupError: null,
  });
  telemetry.captureEvent("mac_sidecar_day1_doc_handoff_started", {
    session_id: session.id,
    doc_type: doc.type,
    provider: seed.provider,
  });
  await createHostIddQuestionRequest(session, doc, {
    localEvidence,
    progressText: `${doc.title} 문서 질문 카드 준비 완료`,
    iddMode: "day1_handoff",
    titlePrefix: "Day 1 Handoff",
  });
  touch(session);
  state.sessions.set(session.id, session);
  await persistSessions();
  if (isNewSession) {
    await syncAndBroadcastBipCoachSessionState({ preferredSessionId: session.id });
    broadcast({ type: "session_created", session });
  } else {
    broadcast({ type: "session_updated", session });
  }
  broadcast({
    type: "bip_idd_session_ready",
    sessionId: session.id,
    iddDocumentType: doc.type,
    iddDocumentTitle: genericIddUserFacingTitle(doc),
    ...serializeBipSetupGate(currentBipSetupGate()),
  });
  broadcast({
    type: "idd_setup_state",
    ...serializeIddSetupFields(state.iddSetup),
    ...serializeBipSetupGate(currentBipSetupGate()),
  });
  return session;
}

async function writeAllDay1DocHandoff({
  sessionId = "",
  provider = "",
  day1Handoff = null,
} = {}) {
  const seed = resolveIddSessionSeed({ sessionId, provider });
  const handoffSnapshot = normalizeDay1HandoffPayload(day1Handoff);
  const session = resolveBipCoachSession(sessionId);
  const startedAt = Date.now();

  state.iddSetup = await persistIddSetupState(workspaceRoot, {
    ...state.iddSetup,
    status: "interviewing",
    currentDocType: DAY1_HANDOFF_DOC_TYPES[0],
    lastProvider: seed.provider,
    providerRecovery: null,
    setupError: null,
  });

  telemetry.captureEvent("mac_sidecar_day1_doc_handoff_write_all_started", {
    session_id: session?.id ?? "",
    provider: seed.provider,
  });

  const progress = (stage, progressText, docType = "") => {
    broadcast({
      type: "idd_setup_progress",
      sessionId: session?.id ?? null,
      requestId: "day1-handoff-write-all",
      docType,
      stage,
      progressText,
      elapsedMs: Date.now() - startedAt,
    });
  };

  progress("bulk_started", "GOAL/ICP/VALUES/SPEC 문서 저장 시작", "all");
  const result = await writeAllDay1HandoffDocuments(workspaceRoot, state.iddSetup, {
    day1Handoff: handoffSnapshot,
    provider: seed.provider,
    onProgress: ({ stage, doc }) => {
      if (stage === "recorded") {
        progress("recording_response", `${doc.title} 문서 초안 구성 중`, doc.type);
      } else if (stage === "written") {
        progress("file_written", `${doc.canonicalPath} 저장 완료`, doc.type);
      } else if (stage === "skipped") {
        progress("file_written", `${doc.canonicalPath} 이미 저장됨`, doc.type);
      }
    },
  });
  state.iddSetup = await persistIddSetupState(workspaceRoot, result.state);

  progress("bulk_written", "GOAL/ICP/VALUES/SPEC 문서 저장 완료", "all");
  telemetry.captureEvent("mac_sidecar_day1_doc_handoff_write_all_completed", {
    session_id: session?.id ?? "",
    provider: seed.provider,
    doc_count: result.written.length,
    status: state.iddSetup.status,
  });

  if (session) {
    session.runtime = {
      ...(session.runtime || {}),
      iddMode: null,
      pendingIddContinuation: null,
      iddPendingAdaptiveContinuation: null,
      day1HandoffFollowupCount: 0,
    };
    session.pendingUserInput = null;
    session.status = "idle";
    session.error = null;
    session.messages.push(makeMessage({
      role: "assistant",
      provider: session.provider,
      content: "Day 1 확정 가설로 GOAL/ICP/VALUES/SPEC 문서를 저장했습니다.",
      state: "final",
    }));
    touch(session);
  }

  broadcast({
    type: "idd_setup_state",
    ...serializeIddSetupFields(state.iddSetup),
    ...serializeBipSetupGate(currentBipSetupGate()),
  });
  broadcastBipSetupGateState(currentBipSetupGate());
  if (session) {
    await persistSessions();
    broadcast({ type: "session_updated", session });
  }
  return state.iddSetup;
}

async function refreshProjectContextFromRequest(payload = {}) {
  const requestedRoot = String(payload.workspaceRoot || payload.workspace_root || workspaceRoot || "").trim();
  const root = requestedRoot ? path.resolve(requestedRoot) : workspaceRoot;
  const reason = String(payload.reason || "manual").trim() || "manual";
  const completedDay = payload.completedDay ?? payload.completed_day ?? null;
  let scanResult = await findWorkspaceDocsLocally(root).catch(() => null);
  let onboardingHypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
    docPaths: scanResult || currentBipConfig()?.workspace || {},
  }).catch(() => null);

  if (reason === "day_completed") {
    const agentResults = await Promise.allSettled([
      runWorkspaceScanAgent({ provider: "claude", model: WORKSPACE_SCAN_CLAUDE_MODEL, scanRoot: root }),
      runWorkspaceScanAgent({ provider: "codex", model: WORKSPACE_SCAN_CODEX_MODEL, scanRoot: root }),
      runWorkspaceScanAgent({ provider: "gemini", model: WORKSPACE_SCAN_GEMINI_MODEL, scanRoot: root }),
    ]);
    const parsedAgentResults = agentResults
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    if (parsedAgentResults.length) {
      scanResult = await mergeWorkspaceScanResultsForRoot(root, scanResult, ...parsedAgentResults);
      onboardingHypothesis = mergeWorkspaceOnboardingHypotheses(
        onboardingHypothesis,
        ...parsedAgentResults.map((result) => result.onboardingHypothesis),
      );
    }
  }

  const projectContext = await refreshProjectContextCache({
    workspaceRoot: root,
    reason,
    scanResult,
    onboardingHypothesis,
    completedDay,
    docPaths: currentBipConfig()?.workspace || {},
  });
  state.workspaceOnboardingHypothesis = normalizeWorkspaceOnboardingHypothesis(projectContext);
  broadcast({
    type: "project_context_updated",
    workspaceRoot: root,
    reason,
    completedDay: projectContext.lastCompletedDay,
    projectContext,
  });
  telemetry.captureEvent("mac_sidecar_project_context_updated", {
    reason,
    completed_day: projectContext.lastCompletedDay || 0,
    confidence: projectContext.confidence,
  });
  return projectContext;
}

function cachedWorkspaceOnboardingHypothesisForIddDoc(doc) {
  if (doc?.type !== "icp") {
    return null;
  }
  scheduleWorkspaceOnboardingHypothesisWarmup();
  return state.workspaceOnboardingHypothesis ?? null;
}

async function startIddDocumentQueue(options = {}) {
  const queueKey = String(
    options.requestedDocType
      || options.gate?.nextLocalDoc?.type
      || state.iddSetup?.currentDocType
      || "unknown",
  );
  const inFlight = iddDocumentQueueInFlight.get(queueKey);
  if (inFlight) return inFlight;

  const run = startIddDocumentQueueOnce(options)
    .finally(() => {
      if (iddDocumentQueueInFlight.get(queueKey) === run) {
        iddDocumentQueueInFlight.delete(queueKey);
      }
    });
  iddDocumentQueueInFlight.set(queueKey, run);
  return run;
}

async function startIddDocumentQueueOnce({
  gate = null,
  sessionId = "",
  provider = "",
  requestedDocType = "",
  localEvidence = null,
} = {}) {
  const resolvedGate = gate ?? currentBipSetupGate();
  if (resolvedGate.iddSetupComplete) {
  broadcast({
    type: "idd_setup_state",
    ...serializeBipSetupGate(resolvedGate),
    });
    return null;
  }

  const requestedDoc = requestedDocType
    ? IDD_FOUNDATION_DOCS.find((doc) => doc.type === String(requestedDocType))
    : null;
  const currentInterviewDoc = !requestedDoc
    && state.iddSetup?.status === "interviewing"
    && state.iddSetup?.currentDocType
    ? IDD_FOUNDATION_DOCS.find((doc) => doc.type === state.iddSetup.currentDocType)
    : null;
  const foundationNextDoc = nextIddFoundationDoc(state.iddSetup);
  const nextDoc = requestedDoc && resolvedGate.missingLocalDocs.some((doc) => doc.type === requestedDoc.type)
    ? requestedDoc
    : currentInterviewDoc || foundationNextDoc;
  const message = summarizeBipSetupGate(resolvedGate);

  broadcast({
    type: "bip_idd_queue_started",
    ...serializeBipSetupGate(resolvedGate),
  });

  if (!nextDoc) {
  await setBipCoachError(
      message,
    "mac_sidecar_bip_coach_idd_required",
    );
    return null;
  }

  const seed = resolveIddSessionSeed({ sessionId, provider });
  const existing = findExistingIddSession(nextDoc.type, { includeRecoverableError: true });
  if (existing) {
    const userFacingTitle = genericIddUserFacingTitle(nextDoc);
    state.iddSetup = await persistIddSetupState(workspaceRoot, {
      ...state.iddSetup,
      status: "interviewing",
      currentDocType: nextDoc.type,
      lastProvider: seed.provider,
      providerRecovery: null,
      setupError: null,
    });
    await createHostIddQuestionRequest(existing, nextDoc, {
      localEvidence,
      progressText: "질문 카드 준비 완료",
    });
    state.sessions.set(existing.id, existing);
    await persistSessions();
    broadcast({
      type: "bip_idd_session_ready",
      sessionId: existing.id,
      iddDocumentType: nextDoc.type,
      iddDocumentTitle: userFacingTitle,
      ...serializeBipSetupGate(resolvedGate),
    });
    await setBipCoachError(
      `${message} ${userFacingTitle} 질문 카드를 다시 준비했어요.`,
      "mac_sidecar_bip_coach_idd_required",
    );
    broadcast({
      type: "idd_setup_state",
      ...serializeIddSetupFields(state.iddSetup),
      ...serializeBipSetupGate(currentBipSetupGate()),
    });
    broadcast({ type: "session_updated", session: existing });
    return existing;
  }

  const session = createSession(seed);
  const userFacingTitle = genericIddUserFacingTitle(nextDoc);
  session.title = `Foundation Setup: ${nextDoc.title}`;
  session.runtime = {
    ...(session.runtime || {}),
    iddDocumentType: nextDoc.type,
  };
  telemetry.captureEvent("mac_sidecar_idd_host_question_started", {
    session_id: session.id,
    doc_type: nextDoc.type,
    provider: seed.provider,
  });
  state.iddSetup = await persistIddSetupState(workspaceRoot, {
    ...state.iddSetup,
    status: "interviewing",
    currentDocType: nextDoc.type,
    lastProvider: seed.provider,
    providerRecovery: null,
    setupError: null,
  });
  try {
    await createHostIddQuestionRequest(session, nextDoc, {
      localEvidence,
      progressText: "구조화 질문 카드 준비 완료",
    });
  } catch (error) {
    state.sessions.delete(session.id);
    await persistSessions();
    state.iddSetup = await persistIddSetupState(workspaceRoot, setIddSetupError(state.iddSetup, {
      provider: seed.provider,
      docType: nextDoc.type,
      message: error?.message || "Foundation Setup 질문 카드를 준비하지 못했어요.",
    }));
    await setBipCoachError(
      `${message} ${userFacingTitle} 질문 카드 준비가 멈췄어요. 다시 시도할 수 있어요.`,
      "mac_sidecar_bip_coach_idd_required",
    );
    broadcast({
      type: "idd_setup_state",
      ...serializeIddSetupFields(state.iddSetup),
      ...serializeBipSetupGate(currentBipSetupGate()),
    });
    return null;
  }
  touch(session);

  state.sessions.set(session.id, session);
  await persistSessions();
  await syncAndBroadcastBipCoachSessionState({ preferredSessionId: session.id });
  broadcast({ type: "session_created", session });
  broadcast({
    type: "bip_idd_session_ready",
    sessionId: session.id,
    iddDocumentType: nextDoc.type,
    iddDocumentTitle: userFacingTitle,
    ...serializeBipSetupGate(resolvedGate),
  });

  await setBipCoachError(
    `${message} ${userFacingTitle}부터 별도 기준 정리 세션을 시작했어요.`,
    "mac_sidecar_bip_coach_idd_required",
  );

  broadcast({
    type: "idd_setup_state",
    ...serializeIddSetupFields(state.iddSetup),
    ...serializeBipSetupGate(currentBipSetupGate()),
  });
  broadcast({ type: "session_updated", session });
  return session;
}

async function recoverStalledIddInterviewIfNeeded(sessionId, { provider = "codex", docType = null } = {}) {
  const session = state.sessions.get(sessionId);
  if (!session?.runtime?.iddDocumentType) return false;
  if (session.pendingUserInput) return false;
  if (docType && state.iddSetup?.drafts?.[docType]?.trim()) return false;

  const lastAssistant = [...(session.messages || [])]
    .reverse()
    .find((message) => message?.role === "assistant");
  const lastContent = String(lastAssistant?.content || "").trim();
  const message = lastContent
    ? `인터뷰 질문 카드 준비가 중단됐습니다: ${lastContent}`
    : "인터뷰 질문 카드 준비가 중단됐습니다. 다시 시작해 주세요.";

  state.iddSetup = await persistIddSetupState(
    workspaceRoot,
    setIddSetupError(state.iddSetup, {
      provider,
      docType,
      message,
    }),
  );

  if (lastAssistant && lastAssistant.state !== "error") {
    lastAssistant.state = "error";
    lastAssistant.error = message;
  } else if (!lastAssistant) {
    session.messages.push(makeMessage({
      role: "assistant",
      provider: session.provider,
      content: message,
      state: "error",
    }));
  }
  session.status = "error";
  session.error = message;
  session.runtime = {
    ...(session.runtime || {}),
    iddPendingAdaptiveContinuation: null,
  };
  touch(session);
  state.sessions.set(session.id, session);
  await persistSessions();

  broadcast({
    type: "idd_setup_state",
    ...serializeIddSetupFields(state.iddSetup),
    ...serializeBipSetupGate(currentBipSetupGate()),
  });
  broadcast({ type: "session_updated", session });
  return true;
}

async function runWorkspaceScan(scanRoot, { sessionId = "", prompt = "" } = {}) {
  try {
    broadcastWorkspaceScanProgress(scanRoot, "scan.local · 로컬 문서 후보를 읽는 중", {
      stage: "local",
      stepIndex: 1,
      totalSteps: 3,
      etaSeconds: 45,
    });
    const localResult = await findWorkspaceDocsLocally(scanRoot);
    // Stage-3 deterministic local signals — git activity, project shape,
    // runway hints. Pure read; absorbs all errors so a non-git folder still
    // produces a stable shape.
    const localDiscovery = await collectLocalDiscovery(scanRoot);
    // Recent agent work (~/.claude + ~/.codex). Kicked off concurrently and
    // awaited only at hypothesis time so it never delays the first visible
    // answer (the <500ms first-visible-value budget). Redacted + bounded.
    const agentHistoryPromise = collectAgentWorkHistory({
      workspaceRoot: scanRoot,
      enabled: process.env.AGENTIC30_DISABLE_AGENT_HISTORY !== "1",
    }).catch(() => null);
    await appendWorkspaceScanVisibleAnswer({
      sessionId,
      prompt,
      scanRoot,
      result: localResult,
    });
    const agentHistory = await agentHistoryPromise;
    const localOnboardingHypothesis = await deriveWorkspaceOnboardingHypothesisLocally(scanRoot, {
      docPaths: localResult,
      agentHistory,
    });
    const localFoundCount = countWorkspaceScanResults(localResult);
    if (isWorkspacePathLookupPrompt(prompt) && localFoundCount > 0) {
      state.workspaceOnboardingHypothesis = localOnboardingHypothesis;
      telemetry.captureEvent("mac_sidecar_workspace_scan_completed", {
        scan_root: scanRoot,
        found_count: localFoundCount,
        onboarding_hypothesis_confidence: localOnboardingHypothesis.confidence,
        claude_model: WORKSPACE_SCAN_CLAUDE_MODEL,
        codex_model: WORKSPACE_SCAN_CODEX_MODEL,
        gemini_model: WORKSPACE_SCAN_GEMINI_MODEL,
        agent_result_count: 0,
        provider_verification_skipped: true,
      });
      markWorkspaceSetupScanSucceeded(scanRoot, {
        found_count: localFoundCount,
        onboarding_hypothesis_confidence: localOnboardingHypothesis.confidence,
        agent_result_count: 0,
        provider_verification_skipped: true,
      });
      broadcastWorkspaceScanProgress(
        scanRoot,
        `scan.verify · 로컬 후보 ${localFoundCount}개를 Day 1 ICP 근거로 확인 중`,
        {
          stage: "verifying",
          stepIndex: 2,
          totalSteps: 3,
          etaSeconds: 20,
          foundCount: localFoundCount,
        },
      );
      broadcastWorkspaceScanProgress(scanRoot, "scan.compose · Day 1 질문 세트를 구성 중", {
        stage: "composing",
        stepIndex: 3,
        totalSteps: 3,
        etaSeconds: 10,
        foundCount: localFoundCount,
      });
      const day1AlignmentPlan = await generateDay1AlignmentPlan({
        workspaceRoot: scanRoot,
        scanResult: localResult,
        onboardingHypothesis: localOnboardingHypothesis,
        localDiscovery,
      });
      const day1IcpPlan = await generateDay1IcpPlan({
        workspaceRoot: scanRoot,
        scanResult: localResult,
        onboardingHypothesis: localOnboardingHypothesis,
        localDiscovery,
      });
      const day1SituationSummary = await buildDay1SituationSummary({
        workspaceRoot: scanRoot,
        scanResult: localResult,
        onboardingHypothesis: localOnboardingHypothesis,
        agentHistory,
        localDiscovery,
      }).catch(() => null);
      const projectContext = await refreshProjectContextCache({
        workspaceRoot: scanRoot,
        reason: "workspace_scan",
        scanResult: localResult,
        onboardingHypothesis: localOnboardingHypothesis,
      });
      broadcastWorkspaceScanProgress(scanRoot, "scan.merged · 폴더 신호를 Day 1 질문 세트에 붙였습니다", {
        stage: "merged",
        stepIndex: 3,
        totalSteps: 3,
        foundCount: localFoundCount,
      });
      broadcast({
        type: "project_context_updated",
        workspaceRoot: scanRoot,
        reason: "workspace_scan",
        completedDay: projectContext.lastCompletedDay,
        projectContext,
      });
      broadcast({
        type: "workspace_scan_result",
        scanRoot,
        icp: localResult.icp || null,
        spec: localResult.spec || null,
        values: localResult.values || null,
        designSystem: localResult.designSystem || null,
        adr: localResult.adr || null,
        goal: localResult.goal || null,
        docs: localResult.docs || null,
        sheet: localResult.sheet || null,
        onboardingHypothesis: localOnboardingHypothesis,
        day1AlignmentPlan,
        day1IcpPlan,
        day1SituationSummary,
      });
      triggerDay1AlignmentPlanBroadcast({
        scanRoot,
        deterministicPlan: day1AlignmentPlan,
        compatibilityIcpPlan: day1IcpPlan,
      });
      return;
    }
    broadcastWorkspaceScanProgress(
      scanRoot,
      localFoundCount > 0
        ? `scan.verify · 로컬 후보 ${localFoundCount}개를 Day 1 ICP 근거로 검증 중`
        : "scan.agent · 로컬 후보가 부족해 workspace 맥락을 확인 중",
      {
        stage: "verifying",
        stepIndex: 2,
        totalSteps: 3,
        etaSeconds: 30,
        foundCount: localFoundCount,
      },
    );
    const agentResults = await Promise.allSettled([
      runWorkspaceScanAgent({
        provider: "claude",
        model: WORKSPACE_SCAN_CLAUDE_MODEL,
        scanRoot,
      }),
      runWorkspaceScanAgent({
        provider: "codex",
        model: WORKSPACE_SCAN_CODEX_MODEL,
        scanRoot,
      }),
      runWorkspaceScanAgent({
        provider: "gemini",
        model: WORKSPACE_SCAN_GEMINI_MODEL,
        scanRoot,
      }),
    ]);
    const parsedAgentResults = agentResults
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    const agentSituationSignals = parsedAgentResults
      .map((result) => result.situationSignals)
      .filter(Boolean);
    const merged = await mergeWorkspaceScanResultsForRoot(scanRoot, localResult, ...parsedAgentResults);
    const onboardingHypothesis = mergeWorkspaceOnboardingHypotheses(
      localOnboardingHypothesis,
      ...parsedAgentResults.map((result) => result.onboardingHypothesis),
    );
    // merge normalizes a fresh object → re-attach the recent-work digest.
    if (localOnboardingHypothesis.recentWork) {
      onboardingHypothesis.recentWork = localOnboardingHypothesis.recentWork;
    }
    state.workspaceOnboardingHypothesis = onboardingHypothesis;
    const foundCount = countWorkspaceScanResults(merged);

    telemetry.captureEvent("mac_sidecar_workspace_scan_completed", {
      scan_root: scanRoot,
      found_count: foundCount,
      onboarding_hypothesis_confidence: onboardingHypothesis.confidence,
      claude_model: WORKSPACE_SCAN_CLAUDE_MODEL,
      codex_model: WORKSPACE_SCAN_CODEX_MODEL,
      gemini_model: WORKSPACE_SCAN_GEMINI_MODEL,
      agent_result_count: parsedAgentResults.length,
    });
    markWorkspaceSetupScanSucceeded(scanRoot, {
      found_count: foundCount,
      onboarding_hypothesis_confidence: onboardingHypothesis.confidence,
      agent_result_count: parsedAgentResults.length,
    });
    broadcastWorkspaceScanProgress(scanRoot, "scan.compose · Day 1 질문 세트를 구성 중", {
      stage: "composing",
      stepIndex: 3,
      totalSteps: 3,
      etaSeconds: 10,
      foundCount,
    });
    const day1AlignmentPlan = await generateDay1AlignmentPlan({
      workspaceRoot: scanRoot,
      scanResult: merged,
      onboardingHypothesis,
      localDiscovery,
    });
    const day1IcpPlan = await generateDay1IcpPlan({
      workspaceRoot: scanRoot,
      scanResult: merged,
      onboardingHypothesis,
      localDiscovery,
    });
    const day1SituationSummary = await buildDay1SituationSummary({
      workspaceRoot: scanRoot,
      scanResult: merged,
      onboardingHypothesis,
      agentHistory,
      agentSituationSignals,
      localDiscovery,
    }).catch(() => null);
    const projectContext = await refreshProjectContextCache({
      workspaceRoot: scanRoot,
      reason: "workspace_scan",
      scanResult: merged,
      onboardingHypothesis,
    });
    broadcastWorkspaceScanProgress(scanRoot, "scan.merged · 폴더 신호를 Day 1 질문 세트에 붙였습니다", {
      stage: "merged",
      stepIndex: 3,
      totalSteps: 3,
      foundCount,
    });
    broadcast({
      type: "project_context_updated",
      workspaceRoot: scanRoot,
      reason: "workspace_scan",
      completedDay: projectContext.lastCompletedDay,
      projectContext,
    });
    broadcast({
      type: "workspace_scan_result",
      scanRoot,
      icp: merged.icp || null,
      spec: merged.spec || null,
      values: merged.values || null,
      designSystem: merged.designSystem || null,
      adr: merged.adr || null,
      goal: merged.goal || null,
      docs: merged.docs || null,
      sheet: merged.sheet || null,
      onboardingHypothesis,
      day1AlignmentPlan,
      day1IcpPlan,
      day1SituationSummary,
    });
    triggerDay1AlignmentPlanBroadcast({
      scanRoot,
      deterministicPlan: day1AlignmentPlan,
      compatibilityIcpPlan: day1IcpPlan,
    });
  } catch (error) {
    telemetry.captureException(error, {
      operation: "runWorkspaceScan",
      scan_root: scanRoot,
    });
    markWorkspaceSetupFailed(scanRoot, error);
    broadcast({
      type: "workspace_scan_result",
      scanRoot,
      error: formatError(error),
      stage: "failed",
      stepIndex: 3,
      totalSteps: 3,
      foundCount: 0,
    });
  }
}

function isWorkspacePathLookupPrompt(prompt) {
  const value = String(prompt || "");
  const asksPath = /(어디|위치|경로|path|where|location|file|문서)/i.test(value);
  const asksDeepScan = /(전체|모든|스캔|scan|search|inspect|검증|분석|review)/i.test(value);
  return asksPath && !asksDeepScan;
}

async function appendWorkspaceScanVisibleAnswer({ sessionId = "", prompt = "", scanRoot = "", result = {} } = {}) {
  if (!sessionId) return;
  const wantsPath = /(어디|위치|경로|path|where|location|file|문서)/i.test(String(prompt || ""));
  const found = [
    ["ICP.md", result.icp],
    ["VALUES.md", result.values],
    ["GOAL.md", result.goal],
    ["SPEC.md", result.spec],
  ].filter(([, docPath]) => docPath);
  if (!wantsPath && found.length === 0) return;
  const workspaceEvidence = await extractWorkspaceEvidence(scanRoot, {
    scanPaths: result,
    includeSource: true,
  }).catch(() => null);
  const summaryLines = workspaceEvidenceSummaryLines(workspaceEvidence);

  const lines = found.length
    ? [
        "로컬 workspace에서 바로 찾은 문서 경로입니다.",
        ...found.map(([label, docPath]) => `- ${label}: ${docPath}`),
        ...summaryLines,
        "다음 액션: 이 경로들을 BIP 설정에 반영하고 Day 1 판단은 확인된 근거 기준으로 이어가면 됩니다.",
      ]
    : [
        "로컬 workspace에서 ICP/VALUES/GOAL/SPEC 문서를 아직 찾지 못했습니다.",
        "다음 액션: `docs/ICP.md` 하나부터 만들고 Day 1 판단 기준을 적으세요.",
      ];
  await appendVisibleAssistantMessage(sessionId, lines.join("\n"));
}

async function runWorkspaceScanAgent({ provider, model, scanRoot }) {
  const authState = getProviderAuthState(provider);
  if (!authState.available) {
  telemetry.captureEvent("mac_sidecar_workspace_scan_provider_skipped", {
      provider,
      model,
      reason: authState.source,
    });
    return null;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 45_000);
  let responseText = "";
  const providerLabel = workspaceScanProviderLabel(provider, model);
  broadcastWorkspaceScanProgress(scanRoot, `scan.agent · ${providerLabel}가 질문 근거를 확인 중`, {
    stage: "verifying",
    stepIndex: 2,
    totalSteps: 3,
  });
  const scanPrompt = [
    "Scan the current workspace for these project documents and return only JSON.",
    "Find the best relative path for each role:",
    "- icp: ICP.md",
    "- spec: SPEC.md",
    "- values: VALUES.md, PRINCIPLES.md, or product values docs",
    "- designSystem: DESIGN_SYSTEM.md, DESIGN.md, design-system.md, or design docs",
    "- adr: ADR.md or architecture decision records",
    "- goal: GOAL.md",
    "- docs: DOCS.md, README.md, INDEX.md, or documentation map",
    "- sheet: SHEET.md, SHEETS.md, or BIP_SHEET.md",
    "",
    "Also infer an onboardingHypothesis for the first user-facing question:",
    '- productName: display product/project name exactly as shown by README/docs/package after generic cleanup; for example README "# agentic30 Mac" should return "agentic30 Mac"',
    "- projectKind: short snake_case product type such as mac_app, web_app, developer_tool, node_app, strategy_docs, or unknown",
    "- targetUser: the current customer/ICP definition visible from docs, in Korean when possible",
    "- problem: the concrete user pain/problem the product claims to solve; do not infer from tech stack alone",
    "- purpose: the product's stated purpose/outcome; prefer README/docs mission/spec wording",
    "- goal: the concrete business/product goal or proof target visible in docs/source signals",
    "- values: compact product values, principles, or tradeoff rules visible in docs/source signals",
    "- likelyUsers: 1-4 concrete Korean user segments visible from repository evidence",
    "- stage: idea, prototype, first_users, pre_revenue, post_revenue, or unknown",
    "- evidence: 1-5 short facts from README/docs/package/config/recent files",
    "- confidence: low, medium, or high",
    "- suggestedFirstQuestion: one Korean question that diagnoses the current ICP and asks the user to narrow it into a more specific customer segment; do not ask whether your guess is right",
    "",
    "Also return situationSignals for the Day 1 project situation card. Only include a signal when you can cite a real workspace file and a short quote from that file.",
    "- channels: customer acquisition, distribution, or community paths explicitly visible in workspace evidence",
    "- analyticsTools: analytics, dashboard, instrumentation, or measurement tools explicitly visible in workspace evidence",
    "- events: event names or metric names explicitly visible in workspace evidence",
    "- customerActions: observable customer behaviors or validation actions explicitly visible in workspace evidence",
    "- currentAlternatives: current manual tools/workflows/alternatives explicitly visible in workspace evidence",
    "- conversionSignals: payment, pilot, signup, adoption, referral, or buying signals explicitly visible in workspace evidence",
    "- missingAssumptions: concise labels for important missing signals, only when the absence is clear from the scanned docs",
    "Every item in channels/analyticsTools/events/customerActions/currentAlternatives/conversionSignals must have: label, evidencePath, shortQuote. The quote must be copied from that file, short, and non-secret.",
    "",
    "Prefer exact filenames under docs/. If exact files are absent, use the closest matching project document.",
    "Return paths relative to the workspace root. Use null when not found.",
    '{"icp": null, "spec": null, "values": null, "designSystem": null, "adr": null, "goal": null, "docs": null, "sheet": null, "onboardingHypothesis": {"productName": "", "projectKind": "unknown", "targetUser": "", "problem": "", "purpose": "", "goal": "", "values": "", "likelyUsers": [], "stage": "unknown", "evidence": [], "confidence": "low", "suggestedFirstQuestion": ""}, "situationSignals": {"channels": [], "analyticsTools": [], "events": [], "customerActions": [], "currentAlternatives": [], "conversionSignals": [], "missingAssumptions": []}}',
  ].join("\n");
  const systemPromptOverride = [
    "You are a fast read-only workspace document scanner.",
    "Do not modify files. Do not run network commands.",
    "Use the smallest number of read-only filesystem inspections needed.",
    "Return only one JSON object with keys: icp, spec, values, designSystem, adr, goal, docs, sheet, onboardingHypothesis, situationSignals.",
  ].join("\n");

  try {
    await runProviderStream({
      provider,
      prompt: scanPrompt,
      model,
    workspaceRoot: scanRoot,
      abortController,
      executionMode: "agentic",
      systemPromptOverride,
      onTextDelta: (text) => {
        responseText += text;
        broadcastWorkspaceScanAgentOutput(scanRoot, providerLabel, text);
      },
      onTextReplace: (text) => {
        responseText = text;
        broadcastWorkspaceScanAgentOutput(scanRoot, providerLabel, text);
      },
      onToolEvent: (event) => {
        const summary = formatWorkspaceScanToolEvent(event);
        if (summary) {
          broadcastWorkspaceScanProgress(scanRoot, `${providerLabel}: ${summary}`, {
            stage: "verifying",
            stepIndex: 2,
            totalSteps: 3,
          });
        }
      },
    });
    const parsed = parseWorkspaceScanText(responseText);
    const result = {
      ...normalizeWorkspaceScanResult(parsed, scanRoot),
      onboardingHypothesis: normalizeWorkspaceOnboardingHypothesis(parsed?.onboardingHypothesis),
      situationSignals: normalizeWorkspaceSituationSignals(parsed?.situationSignals, scanRoot),
    };
    const foundCount = countWorkspaceScanResults(result);
    broadcastWorkspaceScanProgress(
      scanRoot,
      `scan.agent · ${providerLabel} 완료 (${foundCount}개 근거)`,
      {
        stage: "verifying",
        stepIndex: 2,
        totalSteps: 3,
        foundCount,
      },
    );
    return result;
  } catch (error) {
  telemetry.captureException(error, {
      operation: "runWorkspaceScanAgent",
      provider,
      model,
      scan_root: scanRoot,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function broadcastWorkspaceScanAgentOutput(scanRoot, providerLabel, text) {
  const summary = formatWorkspaceScanAgentText(text);
  if (!summary) return;
  broadcastWorkspaceScanProgress(scanRoot, `${providerLabel}: ${summary}`, {
    stage: "verifying",
    stepIndex: 2,
    totalSteps: 3,
  });
}

function broadcastWorkspaceScanProgress(scanRoot, progressText, progress = {}) {
  broadcast({
    type: "workspace_scan_progress",
    scanRoot,
    progressText,
    stage: progress.stage || undefined,
    stepIndex: Number.isFinite(progress.stepIndex) ? progress.stepIndex : undefined,
    totalSteps: Number.isFinite(progress.totalSteps) ? progress.totalSteps : undefined,
    etaSeconds: Number.isFinite(progress.etaSeconds) ? progress.etaSeconds : undefined,
    foundCount: Number.isFinite(progress.foundCount) ? progress.foundCount : undefined,
  });
}

function workspaceScanProviderLabel(provider, model) {
  if (provider === "claude") return `Claude Sonnet 4.6 (${model})`;
  if (provider === "codex") return `GPT 5.4 Mini (${model})`;
  if (provider === "gemini") return `Gemini 3.5 Flash (${model})`;
  return `${provider} (${model})`;
}

function formatWorkspaceScanAgentText(text) {
  const cleaned = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return truncateWorkspaceScanProgress(cleaned);
}

function formatWorkspaceScanToolEvent(event) {
  if (!event || typeof event !== "object") return "";
  const phase = event.phase || "tool";
  const toolName = event.toolName || "tool";
  if (phase === "thinking") {
    return formatWorkspaceScanAgentText(event.payload?.text || "");
  }
  if (phase === "use") {
    const payload = summarizeWorkspaceScanPayload(event.payload);
    return payload ? `using ${toolName}: ${payload}` : `using ${toolName}`;
  }
  if (phase === "result") {
    const payload = summarizeWorkspaceScanPayload(event.payload);
    return payload ? `${toolName} result: ${payload}` : `${toolName} finished`;
  }
  if (phase === "error") {
    const payload = summarizeWorkspaceScanPayload(event.payload);
    return payload ? `${toolName} error: ${payload}` : `${toolName} error`;
  }
  return "";
}

function formatChatToolEvent(event) {
  if (!event || typeof event !== "object") return "";
  const phase = event.phase || "tool";
  const toolName = event.toolName || "tool";
  if (phase === "thinking") {
    const text = summarizeChatToolPayload(event.payload?.text || "");
    return text ? `thinking: ${text}` : "thinking";
  }
  if (phase === "use") {
    const payload = summarizeChatToolPayload(event.payload);
    return payload ? `using ${toolName}: ${payload}` : `using ${toolName}`;
  }
  if (phase === "result") {
    const payload = summarizeChatToolPayload(event.payload);
    return payload ? `${toolName} result: ${payload}` : `${toolName} finished`;
  }
  if (phase === "error") {
    const payload = summarizeChatToolPayload(event.payload);
    return payload ? `${toolName} error: ${payload}` : `${toolName} error`;
  }
  const payload = summarizeChatToolPayload(event.payload);
  return payload ? `${toolName}: ${payload}` : String(toolName);
}

function summarizeChatToolPayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") {
    return truncateChatToolOutput(payload.replace(/\s+/g, " ").trim());
  }
  try {
    return truncateChatToolOutput(JSON.stringify(payload));
  } catch {
    return truncateChatToolOutput(String(payload));
  }
}

function truncateChatToolOutput(text, maxLength = 800) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function summarizeWorkspaceScanPayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return truncateWorkspaceScanProgress(payload.replace(/\s+/g, " ").trim());
  try {
    return truncateWorkspaceScanProgress(JSON.stringify(payload));
  } catch {
    return truncateWorkspaceScanProgress(String(payload));
  }
}

function truncateWorkspaceScanProgress(text, maxLength = 220) {
  const cleaned = String(text || "").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

async function findWorkspaceDocsLocally(scanRoot) {
  const workspaceEvidence = await extractWorkspaceEvidence(scanRoot, {
    includeSource: false,
  });
  return normalizeWorkspaceScanDocs(workspaceEvidence.docs);
}

function parseWorkspaceScanText(text) {
  const jsonMatch = String(text || "").match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const candidate = jsonMatch ? jsonMatch[1] : String(text || "").trim();
  if (!candidate) return null;
  return JSON.parse(candidate);
}

function emptyWorkspaceScanResult() {
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

function normalizeWorkspaceScanDocs(docs = {}) {
  const result = emptyWorkspaceScanResult();
  for (const key of Object.keys(result)) {
    result[key] = typeof docs?.[key] === "string" && docs[key].trim() ? docs[key].trim() : null;
  }
  return result;
}

function normalizeWorkspaceScanResult(input, scanRoot) {
  const result = emptyWorkspaceScanResult();
  if (!input || typeof input !== "object") return result;
  for (const key of Object.keys(result)) {
    result[key] = normalizeWorkspaceScanPath(input[key], scanRoot, key);
  }
  return result;
}

function normalizeWorkspaceSituationSignals(input, scanRoot) {
  const fields = [
    "channels",
    "analyticsTools",
    "events",
    "customerActions",
    "currentAlternatives",
    "conversionSignals",
  ];
  const output = Object.fromEntries(fields.map((field) => [field, []]));
  output.missingAssumptions = Array.isArray(input?.missingAssumptions)
    ? input.missingAssumptions.map((value) => cleanWorkspaceSituationSignalText(value, 80)).filter(Boolean).slice(0, 8)
    : [];
  if (!input || typeof input !== "object") return output;
  for (const field of fields) {
    const values = Array.isArray(input[field]) ? input[field] : [];
    output[field] = values
      .map((item) => normalizeWorkspaceSituationSignalItem(item, scanRoot))
      .filter(Boolean)
      .slice(0, 8);
  }
  return output;
}

function normalizeWorkspaceSituationSignalItem(item, scanRoot) {
  if (!item || typeof item !== "object") return null;
  const label = cleanWorkspaceSituationSignalText(item.label, 80);
  const evidencePath = normalizeSituationEvidencePath(item.evidencePath || item.path, scanRoot);
  const shortQuote = cleanWorkspaceSituationSignalText(item.shortQuote || item.quote, 220);
  if (!label || !evidencePath || !shortQuote) return null;
  const content = readWorkspaceSituationEvidence(scanRoot, evidencePath);
  if (!content) return null;
  const normalizedContent = normalizeSignalNeedle(content);
  const quoteNeedle = normalizeSignalNeedle(shortQuote);
  const labelNeedle = normalizeSignalNeedle(label);
  if (!normalizedContent.includes(quoteNeedle) && !normalizedContent.includes(labelNeedle)) {
    return null;
  }
  return { label, evidencePath, shortQuote };
}

function cleanWorkspaceSituationSignalText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`;
}

function normalizeSituationEvidencePath(value, scanRoot) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  if (path.isAbsolute(trimmed) || trimmed.includes("\0") || isSecretPath(trimmed)) return null;
  if (!/\.(?:md|mdx|txt|rst|adoc|json|yaml|yml|swift|ts|tsx|js|mjs|jsx|py)$/i.test(trimmed)) return null;
  const resolved = path.resolve(scanRoot, trimmed);
  const root = path.resolve(scanRoot);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) return null;
  try {
    const stat = fsSync.statSync(resolved);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
  } catch {
    return null;
  }
  return path.relative(scanRoot, resolved).split(path.sep).join(path.posix.sep);
}

function readWorkspaceSituationEvidence(scanRoot, relativePath) {
  try {
    return redactSecrets(fsSync.readFileSync(path.join(scanRoot, relativePath), "utf8").slice(0, 24_000));
  } catch {
    return "";
  }
}

function normalizeSignalNeedle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeWorkspaceScanPath(value, scanRoot, role = "") {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  if (path.isAbsolute(trimmed) || trimmed.includes("\0")) return null;
  const resolved = path.resolve(scanRoot, trimmed);
  if (!resolved.startsWith(`${path.resolve(scanRoot)}${path.sep}`) && resolved !== path.resolve(scanRoot)) {
    return null;
  }
  try {
    const stat = fsSync.statSync(resolved);
    if (!stat.isFile() || !isWorkspaceScanTextPath(trimmed, role)) return null;
  } catch {
    return null;
  }
  return path.relative(scanRoot, resolved).split(path.sep).join(path.posix.sep);
}

function isWorkspaceScanTextPath(relativePath, role = "") {
  const value = String(relativePath || "");
  if (role === "sheet") return /\.(?:md|mdx|txt|rst|adoc|json|yaml|yml)$/i.test(value);
  return /\.(?:md|mdx|txt|rst|adoc)$/i.test(value);
}

async function mergeWorkspaceScanResultsForRoot(scanRoot, ...results) {
  const scanPaths = Object.fromEntries(Object.keys(emptyWorkspaceScanResult()).map((key) => [
    key,
    results
      .map((result) => result?.[key])
      .filter((value) => typeof value === "string" && value.trim()),
  ]));
  const workspaceEvidence = await extractWorkspaceEvidence(scanRoot, {
    scanPaths,
    includeSource: false,
  }).catch(() => null);
  if (workspaceEvidence?.docs) return normalizeWorkspaceScanDocs(workspaceEvidence.docs);
  return mergeWorkspaceScanResults(...results);
}

function mergeWorkspaceScanResults(...results) {
  const merged = emptyWorkspaceScanResult();
  for (const key of Object.keys(merged)) {
    const candidates = results
      .map((result) => result?.[key])
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => String(value).trim());
    candidates.sort((a, b) => workspaceScanPathScore(b, key) - workspaceScanPathScore(a, key) || a.localeCompare(b));
    merged[key] = candidates[0] || null;
  }
  return merged;
}

function workspaceScanPathScore(relativePath, role) {
  const normalized = String(relativePath || "").toLowerCase();
  let score = 0;
  if (normalized.startsWith("docs/")) score += 20;
  if (normalized === `docs/${role.toLowerCase()}.md`) score += 60;
  if (path.posix.basename(normalized) === `${role.toLowerCase()}.md`) score += 35;
  if (role === "docs" && /^readme\.(md|mdx|txt|rst)$/i.test(path.posix.basename(normalized))) score += 60;
  return score;
}

function countWorkspaceScanResults(result) {
  return [
    result.icp,
    result.spec,
    result.values,
    result.designSystem,
    result.adr,
    result.goal,
    result.docs,
    result.sheet,
  ].filter(Boolean).length;
}

/**
 * Frontier-enhanced alignment plan follows the same non-blocking pattern as the
 * Day 1 deterministic plan already included in workspace_scan_result. This
 * event only refreshes the UI if a richer valid plan arrives; the legacy
 * day1IcpPlan remains attached as a compatibility fallback.
 */
function triggerDay1AlignmentPlanBroadcast({ scanRoot, deterministicPlan, compatibilityIcpPlan = null }) {
  if (!scanRoot || !deterministicPlan) return;
  if (process.env.AGENTIC30_TEST_STUB_PROVIDER === "1") return;
  Promise.resolve()
    .then(async () => {
      const frontierResults = await runDay1ChoiceFrontierSynthesis({
        scanRoot,
        deterministicPlan,
      });
      return composeDay1AlignmentPlan({
        workspaceRoot: scanRoot,
        deterministicPlan,
        frontierResults,
      });
    })
    .then((plan) => {
      if (!plan || plan.source === "deterministic") return;
      broadcast({
        type: "workspace_day1_alignment_plan_result",
        scanRoot,
        day1AlignmentPlan: plan,
        day1IcpPlan: compatibilityIcpPlan,
      });
    })
    .catch((error) => {
      telemetry.captureException(error, {
        operation: "triggerDay1AlignmentPlanBroadcast",
        scan_root: scanRoot,
      });
    });
}

async function runDay1ChoiceFrontierSynthesis({ scanRoot, deterministicPlan }) {
  const providers = [
    { provider: "claude", model: DAY1_CHOICE_CLAUDE_MODEL },
    { provider: "codex", model: DAY1_CHOICE_CODEX_MODEL },
    { provider: "gemini", model: DAY1_CHOICE_GEMINI_MODEL },
  ];
  broadcastWorkspaceScanProgress(scanRoot, "frontier 선택지 생성 중");
  const prompt = buildDay1AlignmentComposerPrompt(deterministicPlan);
  const results = await Promise.allSettled(
    providers.map(({ provider, model }) =>
      runDay1ChoiceFrontierProvider({
        provider,
        model,
        scanRoot,
        prompt,
      })
    ),
  );
  const fulfilled = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
  if (fulfilled.length) {
    telemetry.captureEvent("mac_sidecar_day1_choice_frontier_completed", {
      scan_root: scanRoot,
      provider_count: fulfilled.length,
      claude_model: DAY1_CHOICE_CLAUDE_MODEL,
      codex_model: DAY1_CHOICE_CODEX_MODEL,
      gemini_model: DAY1_CHOICE_GEMINI_MODEL,
    });
  }
  return fulfilled;
}

async function runDay1ChoiceFrontierProvider({ provider, model, scanRoot, prompt }) {
  const authState = getProviderAuthState(provider);
  if (!authState.available) {
    telemetry.captureEvent("mac_sidecar_day1_choice_frontier_provider_skipped", {
      provider,
      model,
      reason: authState.source,
    });
    return null;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), DAY1_CHOICE_PROVIDER_TIMEOUT_MS);
  let responseText = "";
  try {
    await runProviderStream({
      provider,
      prompt,
      model,
      workspaceRoot: scanRoot,
      abortController,
      executionMode: "idd_question_synthesis",
      systemPromptOverride: [
        "You synthesize high-quality Day 1 customer-discovery choices for agentic30.",
        "Work only from the deterministic plan and evidence embedded in the prompt.",
        "Do not use tools, inspect files, browse the web, or ask follow-up questions.",
        "Return only valid JSON matching the requested schema.",
      ].join("\n"),
      onTextDelta: (text) => {
        responseText += text;
      },
      onTextReplace: (text) => {
        responseText = text;
      },
      onRunEvent: (event) => {
        if (event.once) return;
        telemetry.captureEvent("mac_sidecar_day1_choice_frontier_phase", {
          provider,
          model,
          phase: event.phase,
        });
      },
    });
    return {
      provider,
      model,
      text: responseText,
    };
  } catch (error) {
    telemetry.captureException(error, {
      operation: "runDay1ChoiceFrontierProvider",
      provider,
      model,
      scan_root: scanRoot,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function updateIntegrationSettings(integrations = {}) {
  const exa = integrations?.exa && typeof integrations.exa === "object" ? integrations.exa : {};
  state.integrationSettings = {
    ...state.integrationSettings,
    exaApiKey: String(exa.apiKey || exa.exaApiKey || state.integrationSettings.exaApiKey || ""),
  };
}

function currentExaApiKey() {
  return String(state.integrationSettings?.exaApiKey || process.env.EXA_API_KEY || "").trim();
}

function resolveNewsMarketRadarExaRoutes({
  preferredProvider = "",
} = {}) {
  const discovered = orderExaMcpRoutes(discoverExaMcpRoutes(), { preferredProvider });
  const routes = [...discovered];
  const apiKey = currentExaApiKey();
  if (apiKey) {
    const provider = firstAvailableProvider(preferredProvider) || normalizeProviderName(preferredProvider) || "claude";
    const apiKeyRoute = buildExaApiKeyRoute({ apiKey, provider });
    if (apiKeyRoute) routes.push(apiKeyRoute);
  }
  return routes;
}

function firstAvailableProvider(preferredProvider = "") {
  return providerPriority(preferredProvider).find((provider) => getProviderAuthState(provider).available) || "";
}

function providerPriority(preferredProvider = "") {
  const preferred = normalizeProviderName(preferredProvider);
  return [
    ...(preferred ? [preferred] : []),
    ...["codex", "claude", "gemini"].filter((provider) => provider !== preferred),
  ];
}

function normalizeProviderName(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  return ["claude", "codex", "gemini"].includes(provider) ? provider : "";
}

function newsMarketRadarProviderTimeoutError() {
  return new Error(
    `공개 근거 검색이 ${formatNewsMarketRadarProviderTimeout(NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS)} 안에 끝나지 않았습니다`,
  );
}

function isAbortLikeError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.name === "AbortError" || message.includes("aborted") || message.includes("abort");
}

function scheduleNewsMarketRadarRefresh({
  reason = "manual",
  force = false,
  preferredProvider = "",
  targetSocket = null,
} = {}) {
  const normalizedReason = ["daily", "manual", "day_answer", "workspace_scan"].includes(reason)
    ? reason
    : "manual";
  if (state.newsMarketRadarRefreshPromise) {
    const status = buildNewsMarketRadarProgressStatus(
      state.newsMarketRadarProgress || { stale: true },
      {
        reason: normalizedReason,
        stale: true,
        startedAt: state.newsMarketRadarProgressStartedAt,
        researchSource: state.newsMarketRadarProgress?.researchSource || null,
      },
    );
    state.newsMarketRadarProgress = status;
    send(targetSocket, { type: "news_market_radar_status", status });
    return state.newsMarketRadarRefreshPromise;
  }
  const promise = runNewsMarketRadarRefresh({
    reason: normalizedReason,
    force,
    preferredProvider,
    targetSocket,
  }).finally(() => {
    state.newsMarketRadarRefreshPromise = null;
    state.newsMarketRadarProgress = null;
    state.newsMarketRadarProgressStartedAt = null;
  });
  state.newsMarketRadarRefreshPromise = promise;
  return promise;
}

async function runNewsMarketRadarRefresh({
  reason = "manual",
  force = false,
  preferredProvider = "",
  targetSocket = null,
} = {}) {
  const startedAt = Date.now();
  state.newsMarketRadarProgressStartedAt = startedAt;
  const exaApiKey = currentExaApiKey();
  const exaResearchRoutes = resolveNewsMarketRadarExaRoutes({ preferredProvider });
  const emitProgress = (progress = {}) => {
    const status = buildNewsMarketRadarProgressStatus(progress, {
      reason,
      startedAt,
      researchSource: exaResearchRoutes[0]?.label || null,
    });
    state.newsMarketRadarProgress = status;
    broadcast({
      type: "news_market_radar_status",
      status,
    });
    return status;
  };
  const progressHeartbeat = setInterval(() => {
    if (!state.newsMarketRadarProgress) return;
    const status = buildNewsMarketRadarProgressStatus(state.newsMarketRadarProgress, {
      reason,
      startedAt,
      researchSource: exaResearchRoutes[0]?.label || null,
    });
    state.newsMarketRadarProgress = status;
    broadcast({
      type: "news_market_radar_status",
      status,
    });
  }, 1_000);
  progressHeartbeat.unref?.();
  try {
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot,
      exaApiKey,
      exaResearchRoutes,
      reason,
      force,
      onboardingHypothesis: state.workspaceOnboardingHypothesis,
      providerResearcher: (args) => runNewsMarketRadarProviderResearch({
        ...args,
        onProgress: emitProgress,
      }),
      providerSynthesizer: (args) => runNewsMarketRadarProviderSynthesis({
        ...args,
        preferredProvider,
      }),
      onProgress: emitProgress,
    });
    broadcast({
      type: "news_market_radar_result",
      newsMarketRadar: snapshot,
    });
    telemetry.captureEvent("mac_sidecar_news_market_radar_refresh_completed", {
      reason,
      duration_ms: Date.now() - startedAt,
      lane_count: snapshot.lanes?.length || 0,
      card_count: (snapshot.lanes || []).reduce((sum, lane) => sum + (lane.cards?.length || 0), 0),
      exa_configured: exaResearchRoutes.length > 0,
      exa_research_source: snapshot.status?.researchSource || exaResearchRoutes[0]?.label || "",
      status: snapshot.status?.state || "",
    });
    return snapshot;
  } catch (error) {
    telemetry.captureException(error, {
      operation: "news_market_radar_refresh",
      reason,
      exa_configured: exaResearchRoutes.length > 0,
    });
    const cached = await loadNewsMarketRadarSnapshot({
      workspaceRoot,
      exaApiKey,
      exaConfigured: exaResearchRoutes.length > 0,
      exaResearchSource: exaResearchRoutes[0]?.label || null,
    });
    const progress = state.newsMarketRadarProgress || {};
    const failed = {
      ...cached,
      status: {
        state: "failed",
        lastSuccessAt: cached.status?.lastSuccessAt || null,
        stale: Boolean(cached.generatedAt),
        error: formatError(error),
        reason,
        researchSource: cached.status?.researchSource || exaResearchRoutes[0]?.label || null,
        stage: progress.stage || null,
        progressText: progress.progressText || null,
        elapsedMs: Math.max(progress.elapsedMs || 0, Date.now() - startedAt),
        stepIndex: progress.stepIndex || null,
        stepCount: progress.stepCount || null,
      },
    };
    const payload = {
      type: "news_market_radar_result",
      newsMarketRadar: failed,
    };
    if (targetSocket) send(targetSocket, payload);
    else broadcast(payload);
    return failed;
  } finally {
    clearInterval(progressHeartbeat);
  }
}

function scheduleBipResearchRefresh({
  reason = "manual",
  force = false,
  preferredProvider = "",
  dayNumber = 1,
  curriculumDay = null,
  targetSocket = null,
} = {}) {
  const normalizedReason = ["daily", "manual", "day_answer", "workspace_scan"].includes(reason)
    ? reason
    : "manual";
  if (state.bipResearchRefreshPromise) {
    const status = buildBipResearchProgressStatus(
      state.bipResearchProgress || { stale: true },
      {
        reason: normalizedReason,
        stale: true,
        startedAt: state.bipResearchProgressStartedAt,
        researchSource: state.bipResearchProgress?.researchSource || null,
      },
    );
    state.bipResearchProgress = status;
    send(targetSocket, { type: "bip_research_status", status });
    return state.bipResearchRefreshPromise;
  }
  const promise = runBipResearchRefresh({
    reason: normalizedReason,
    force,
    preferredProvider,
    dayNumber,
    curriculumDay,
    targetSocket,
  }).finally(() => {
    state.bipResearchRefreshPromise = null;
    state.bipResearchProgress = null;
    state.bipResearchProgressStartedAt = null;
  });
  state.bipResearchRefreshPromise = promise;
  return promise;
}

async function runBipResearchRefresh({
  reason = "manual",
  force = false,
  preferredProvider = "",
  dayNumber = 1,
  curriculumDay = null,
  targetSocket = null,
} = {}) {
  const startedAt = Date.now();
  state.bipResearchProgressStartedAt = startedAt;
  const exaApiKey = currentExaApiKey();
  const exaResearchRoutes = resolveNewsMarketRadarExaRoutes({ preferredProvider });
  const emitProgress = (progress = {}) => {
    const status = buildBipResearchProgressStatus(progress, {
      reason,
      startedAt,
      researchSource: exaResearchRoutes[0]?.label || null,
    });
    state.bipResearchProgress = status;
    broadcast({
      type: "bip_research_status",
      status,
    });
    return status;
  };
  const progressHeartbeat = setInterval(() => {
    if (!state.bipResearchProgress) return;
    const status = buildBipResearchProgressStatus(state.bipResearchProgress, {
      reason,
      startedAt,
      researchSource: exaResearchRoutes[0]?.label || null,
    });
    state.bipResearchProgress = status;
    broadcast({
      type: "bip_research_status",
      status,
    });
  }, 1_000);
  progressHeartbeat.unref?.();
  try {
    const snapshot = await refreshBipResearch({
      workspaceRoot,
      dayNumber,
      curriculumDay,
      bipConfig: currentBipConfig(),
      onboardingHypothesis: state.workspaceOnboardingHypothesis,
      exaApiKey,
      exaResearchRoutes,
      reason,
      force,
      providerResearcher: (args) => runNewsMarketRadarProviderResearch({
        ...args,
        onProgress: emitProgress,
      }),
      onProgress: emitProgress,
    });
    broadcast({
      type: "bip_research_result",
      bipResearch: snapshot,
    });
    telemetry.captureEvent("mac_sidecar_bip_research_refresh_completed", {
      reason,
      day_number: snapshot.dayNumber || Number.parseInt(dayNumber, 10) || 1,
      duration_ms: Date.now() - startedAt,
      candidate_count: snapshot.candidates?.length || 0,
      exa_configured: exaResearchRoutes.length > 0,
      exa_research_source: snapshot.status?.researchSource || exaResearchRoutes[0]?.label || "",
    });
    return snapshot;
  } catch (error) {
    telemetry.captureException(error, {
      operation: "bip_research_refresh",
      reason,
      exa_configured: exaResearchRoutes.length > 0,
    });
    const cached = await loadBipResearchSnapshot({
      workspaceRoot,
      dayNumber,
      curriculumDay,
      bipConfig: currentBipConfig(),
      onboardingHypothesis: state.workspaceOnboardingHypothesis,
      exaApiKey,
      exaConfigured: exaResearchRoutes.length > 0,
      exaResearchSource: exaResearchRoutes[0]?.label || null,
    });
    const failedSnapshot = {
      ...cached,
      status: {
        state: "failed",
        lastSuccessAt: cached.status?.lastSuccessAt || null,
        stale: cached.candidates?.length > 0,
        error: formatError(error),
        reason,
        researchSource: cached.status?.researchSource || exaResearchRoutes[0]?.label || null,
      },
    };
    broadcast({
      type: "bip_research_result",
      bipResearch: failedSnapshot,
    });
    send(targetSocket, {
      type: "bip_research_status",
      status: failedSnapshot.status,
    });
    return failedSnapshot;
  } finally {
    clearInterval(progressHeartbeat);
  }
}

async function runNewsMarketRadarProviderResearch({
  prompt,
  exaMcpConfig,
  exaResearchRoute,
  exaResearchRoutes = [],
  onProgress = null,
} = {}) {
  const providerErrors = [];
  const routes = normalizeNewsMarketRadarProviderRoutes({
    exaMcpConfig,
    exaResearchRoute,
    exaResearchRoutes,
  });
  for (const [routeIndex, route] of routes.entries()) {
    const provider = normalizeProviderName(route.provider);
    if (!provider) {
      providerErrors.push(`${route.label || "Exa MCP"} 사용 불가: provider가 설정되지 않았습니다`);
      continue;
    }
    const authState = getProviderAuthState(provider);
    if (!authState.available) {
      providerErrors.push(`${providerLabel(provider)} 사용 불가: ${authState.message || authState.source || "설정되지 않음"}`);
      continue;
    }
    const routeLabel = route.label || `${providerLabel(provider)} Exa MCP`;
    if (typeof onProgress === "function") {
      onProgress({
        stage: "running_provider_research",
        progressText: `${routeLabel}로 공개 근거를 검색하는 중`,
        researchSource: routeLabel,
      });
    }
    try {
      const text = provider === "claude"
        ? await runNewsMarketRadarClaudeResearch({ prompt, exaMcpConfig: route.mcpConfig })
        : provider === "gemini"
          ? await runNewsMarketRadarGeminiResearch({ prompt, exaMcpConfig: route.mcpConfig })
          : await runNewsMarketRadarCodexResearch({ prompt, exaMcpConfig: route.mcpConfig });
      return {
        text,
        provider,
        researchSource: route.label || `${providerLabel(provider)} Exa MCP`,
        exaResearchRoute: redactExaResearchRoute(route),
      };
    } catch (error) {
      const formattedError = formatError(error);
      providerErrors.push(`${routeLabel}: ${formattedError}`);
      if (typeof onProgress === "function") {
        const hasNextRoute = routeIndex < routes.length - 1;
        onProgress({
          stage: "running_provider_research",
          progressText: hasNextRoute
            ? `${routeLabel} 실패: ${formattedError}. 다음 Exa MCP 제공자를 확인하는 중`
            : `${routeLabel} 실패: ${formattedError}`,
          researchSource: routeLabel,
        });
      }
    }
  }

  throw new Error(`Exa MCP 리서치를 완료한 provider가 없습니다. ${providerErrors.join(" | ")}`);
}

async function runNewsMarketRadarProviderSynthesis({
  prompt,
  provider = "",
  preferredProvider = "",
} = {}) {
  const preferred = normalizeProviderName(provider) || normalizeProviderName(preferredProvider);
  const providerErrors = [];
  for (const candidate of providerPriority(preferred)) {
    const authState = getProviderAuthState(candidate);
    if (!authState.available) {
      providerErrors.push(`${providerLabel(candidate)} 합성 사용 불가: ${authState.message || authState.source || "설정되지 않음"}`);
      continue;
    }
    try {
      const text = candidate === "claude"
        ? await runNewsMarketRadarClaudeSynthesis({ prompt })
        : candidate === "gemini"
          ? await runNewsMarketRadarGeminiSynthesis({ prompt })
          : await runNewsMarketRadarCodexSynthesis({ prompt });
      return {
        text,
        provider: candidate,
        researchSource: `${providerLabel(candidate)} synthesis`,
      };
    } catch (error) {
      providerErrors.push(`${providerLabel(candidate)} 합성 실패: ${formatError(error)}`);
    }
  }
  throw new Error(`Market Radar 최종 합성을 완료한 provider가 없습니다. ${providerErrors.join(" | ")}`);
}

function normalizeNewsMarketRadarProviderRoutes({
  exaMcpConfig,
  exaResearchRoute,
  exaResearchRoutes = [],
} = {}) {
  const routes = Array.isArray(exaResearchRoutes) && exaResearchRoutes.length
    ? exaResearchRoutes
    : [{
        ...(exaResearchRoute || {}),
        mcpConfig: exaMcpConfig || buildExaMcpConfig(currentExaApiKey()),
      }];
  return routes
    .filter((route) => route?.mcpConfig)
    .map((route) => ({
      provider: normalizeProviderName(route.provider),
      source: String(route.source || ""),
      label: String(route.label || ""),
      serverName: String(route.serverName || ""),
      configPath: route.configPath || null,
      mcpConfig: route.mcpConfig,
    }));
}

function providerLabel(provider) {
  switch (provider) {
  case "claude": return "Claude";
  case "gemini": return "Gemini";
  case "codex": return "Codex";
  default: return "Provider";
  }
}

async function runNewsMarketRadarClaudeResearch({
  prompt,
  exaMcpConfig,
} = {}) {
  const packagePath = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
  const cliPath = path.join(packagePath, "cli.js");
  const env = buildClaudeAgentEnv();
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  const options = {
    pathToClaudeCodeExecutable: cliPath,
    executable: process.execPath,
    env,
    cwd: workspaceRoot,
    maxTurns: 10,
    includePartialMessages: false,
    mcpServers: {
      exa: exaMcpConfig || buildExaMcpConfig(currentExaApiKey()),
    },
    abortController,
    systemPrompt: [
      "You are a market research JSON generator for Agentic30.",
      "Use Exa MCP tools only for web research. Do not mutate files.",
      "Write every user-facing JSON string in Korean unless it is a fixed enum/id/key, URL, domain, product name, plan name, or official source title.",
      "Return strict JSON only.",
    ].join("\n"),
  };
  let text = "";
  try {
    const stream = query({ prompt, options });
    for await (const event of stream) {
      if (event.type === "assistant" && event.message?.content) {
        for (const content of event.message.content) {
          if (content.type === "text" && content.text) {
            text += content.text;
          }
        }
      }
      if (event.type === "result" && event.result) {
        text += `\n${event.result}`;
      }
    }
    return text;
  } catch (error) {
    if (timedOut && isAbortLikeError(error)) {
      throw newsMarketRadarProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runNewsMarketRadarClaudeSynthesis({
  prompt,
} = {}) {
  const packagePath = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
  const cliPath = path.join(packagePath, "cli.js");
  const env = buildClaudeAgentEnv();
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  const options = {
    pathToClaudeCodeExecutable: cliPath,
    executable: process.execPath,
    env,
    cwd: workspaceRoot,
    maxTurns: 4,
    includePartialMessages: false,
    abortController,
    systemPrompt: [
      "You are a market research synthesis JSON generator for Agentic30.",
      "Do not browse, search, fetch, call web tools, or mutate files.",
      "Write every user-facing JSON string in Korean unless it is a fixed enum/id/key, URL, domain, product name, plan name, or official source title.",
      "Return strict JSON only.",
    ].join("\n"),
  };
  let text = "";
  try {
    const stream = query({ prompt, options });
    for await (const event of stream) {
      if (event.type === "assistant" && event.message?.content) {
        for (const content of event.message.content) {
          if (content.type === "text" && content.text) {
            text += content.text;
          }
        }
      }
      if (event.type === "result" && event.result) {
        text += `\n${event.result}`;
      }
    }
    return text;
  } catch (error) {
    if (timedOut && isAbortLikeError(error)) {
      throw newsMarketRadarProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runNewsMarketRadarCodexResearch({
  prompt,
  exaMcpConfig,
} = {}) {
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  const codexEnv = buildCodexEnv();
  const apiKey = codexEnv.CODEX_API_KEY || codexEnv.OPENAI_API_KEY || "";
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex({
    codexPathOverride: resolveCodexBinaryPath(),
    env: codexEnv,
    ...(apiKey ? { apiKey } : {}),
    config: {
      developer_instructions: [
        "You are a market research JSON generator for Agentic30.",
        "Use Exa MCP tools only for web research. Do not mutate files.",
        "Write every user-facing JSON string in Korean unless it is a fixed enum/id/key, URL, domain, product name, plan name, or official source title.",
        "Return strict JSON only.",
      ].join("\n"),
      notify: [],
      features: {
        computer_use: false,
      },
      mcp_servers: {
        exa: exaMcpConfig || buildExaMcpConfig(currentExaApiKey()),
      },
    },
  });
  const thread = codex.startThread({
    model: resolveCodexModel(),
    skipGitRepoCheck: true,
    workingDirectory: workspaceRoot,
    webSearchEnabled: false,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    modelReasoningEffort: "medium",
  });
  let text = "";
  try {
    const { events } = await thread.runStreamed(prompt, {
      signal: abortController.signal,
    });
    for await (const event of events) {
      if (
        (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed")
        && event.item?.type === "agent_message"
        && typeof event.item.text === "string"
      ) {
        text = event.item.text;
      } else if (event.type === "turn.failed") {
        throw new Error(event.error?.message || "Codex SDK turn failed.");
      } else if (event.type === "error") {
        throw new Error(event.message || "Codex SDK emitted an error.");
      }
    }
    return text;
  } catch (error) {
    if (timedOut && isAbortLikeError(error)) {
      throw newsMarketRadarProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runNewsMarketRadarCodexSynthesis({
  prompt,
} = {}) {
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  const codexEnv = buildCodexEnv();
  const apiKey = codexEnv.CODEX_API_KEY || codexEnv.OPENAI_API_KEY || "";
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex({
    codexPathOverride: resolveCodexBinaryPath(),
    env: codexEnv,
    ...(apiKey ? { apiKey } : {}),
    config: {
      developer_instructions: [
        "You are a market research synthesis JSON generator for Agentic30.",
        "Do not browse, search, fetch, call web tools, or mutate files.",
        "Write every user-facing JSON string in Korean unless it is a fixed enum/id/key, URL, domain, product name, plan name, or official source title.",
        "Return strict JSON only.",
      ].join("\n"),
      notify: [],
      features: {
        computer_use: false,
      },
    },
  });
  const thread = codex.startThread({
    model: resolveCodexModel(),
    skipGitRepoCheck: true,
    workingDirectory: workspaceRoot,
    webSearchEnabled: false,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    modelReasoningEffort: "medium",
  });
  let text = "";
  try {
    const { events } = await thread.runStreamed(prompt, {
      signal: abortController.signal,
    });
    for await (const event of events) {
      if (
        (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed")
        && event.item?.type === "agent_message"
        && typeof event.item.text === "string"
      ) {
        text = event.item.text;
      } else if (event.type === "turn.failed") {
        throw new Error(event.error?.message || "Codex SDK synthesis turn failed.");
      } else if (event.type === "error") {
        throw new Error(event.message || "Codex SDK emitted an error.");
      }
    }
    return text;
  } catch (error) {
    if (timedOut && isAbortLikeError(error)) {
      throw newsMarketRadarProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runNewsMarketRadarGeminiResearch({
  prompt,
  exaMcpConfig,
} = {}) {
  const env = buildGeminiEnv();
  const useVertex = env.GOOGLE_GENAI_USE_VERTEXAI === "true" || env.GOOGLE_GENAI_USE_VERTEXAI === "1";
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  if (!useVertex && !apiKey) {
    throw new Error("Gemini provider requires GOOGLE_API_KEY or GEMINI_API_KEY (or Vertex AI configuration).");
  }
  const client = new McpClient({
    name: "agentic30-market-radar",
    version: "1.0.0",
  });
  const transport = buildMcpClientTransport(exaMcpConfig);
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  try {
    await client.connect(transport);
    const ai = useVertex
      ? new GoogleGenAI({
          vertexai: true,
          project: env.GOOGLE_CLOUD_PROJECT,
          location: env.GOOGLE_CLOUD_LOCATION,
        })
      : new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: resolveGeminiModel(WORKSPACE_SCAN_GEMINI_MODEL),
      contents: prompt,
      config: {
        systemInstruction: [
          "You are a market research JSON generator for Agentic30.",
          "Use Exa MCP tools only for web research. Do not mutate files.",
          "Write every user-facing JSON string in Korean unless it is a fixed enum/id/key, URL, domain, product name, plan name, or official source title.",
          "Return strict JSON only.",
        ].join("\n"),
        tools: [mcpToTool(client)],
      },
      abortSignal: abortController.signal,
    });
    return extractGeminiResponseText(response);
  } catch (error) {
    if (timedOut && isAbortLikeError(error)) {
      throw newsMarketRadarProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => {});
  }
}

async function runNewsMarketRadarGeminiSynthesis({
  prompt,
} = {}) {
  const env = buildGeminiEnv();
  const useVertex = env.GOOGLE_GENAI_USE_VERTEXAI === "true" || env.GOOGLE_GENAI_USE_VERTEXAI === "1";
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";
  if (!useVertex && !apiKey) {
    throw new Error("Gemini provider requires GOOGLE_API_KEY or GEMINI_API_KEY (or Vertex AI configuration).");
  }
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  try {
    const ai = useVertex
      ? new GoogleGenAI({
          vertexai: true,
          project: env.GOOGLE_CLOUD_PROJECT,
          location: env.GOOGLE_CLOUD_LOCATION,
        })
      : new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: resolveGeminiModel(WORKSPACE_SCAN_GEMINI_MODEL),
      contents: prompt,
      config: {
        systemInstruction: [
          "You are a market research synthesis JSON generator for Agentic30.",
          "Do not browse, search, fetch, call web tools, or mutate files.",
          "Write every user-facing JSON string in Korean unless it is a fixed enum/id/key, URL, domain, product name, plan name, or official source title.",
          "Return strict JSON only.",
        ].join("\n"),
      },
      abortSignal: abortController.signal,
    });
    return extractGeminiResponseText(response);
  } catch (error) {
    if (timedOut && isAbortLikeError(error)) {
      throw newsMarketRadarProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildMcpClientTransport(config = {}) {
  if (config?.url) {
    const headers = config.headers && typeof config.headers === "object"
      ? Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, String(value)]))
      : {};
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: Object.keys(headers).length ? { headers } : undefined,
    });
  }
  if (config?.command) {
    return new StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      env: {
        ...process.env,
        ...(config.env && typeof config.env === "object" ? config.env : {}),
      },
    });
  }
  throw new Error("Exa MCP route is missing url or command.");
}

function extractGeminiResponseText(response) {
  if (!response) return "";
  if (typeof response.text === "string") return response.text;
  if (typeof response.text === "function") {
    const text = response.text();
    if (typeof text === "string") return text;
  }
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  let text = "";
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      if (typeof part?.text === "string") text += part.text;
    }
  }
  return text;
}

async function runCreateDoc(docRoot, docType) {
  const authState = getProviderAuthState("claude");
  if (!authState.available) {
  broadcast({
      type: "doc_creation_result",
      docType,
      error: "Claude is not available. " + authState.message,
    });
    return;
  }

  const templates = {
    icp: {
      filename: "docs/ICP.md",
      guide: [
        "Create an Ideal Customer Profile (ICP) document for this project.",
        "Include: target persona, demographics, pain points, Jobs To Be Done (JTBD),",
        "current alternatives, and why this product is a better fit.",
      ].join(" "),
    },
    spec: {
      filename: "docs/SPEC.md",
      guide: [
        "Create a Product Specification (SPEC) document for this project.",
        "Include: product vision, core features, user stories, success metrics,",
        "technical constraints, and MVP scope.",
      ].join(" "),
    },
    values: {
      filename: "docs/VALUES.md",
      guide: [
        "Create a VALUES document for this project.",
        "Include: decision principles, tradeoff rules, things this project refuses to do,",
        "and concrete behavioral examples grounded in the current project context.",
      ].join(" "),
    },
    designSystem: {
      filename: "docs/DESIGN_SYSTEM.md",
      guide: [
        "Create a Design System document for this project.",
        "Include: color palette, typography, spacing system, key UI components,",
        "interaction patterns, and accessibility guidelines.",
      ].join(" "),
    },
    adr: {
      filename: "docs/ADR.md",
      guide: [
        "Create an Architecture Decision Records (ADR) document for this project.",
        "Include: ADR template format (Title, Status, Context, Decision, Consequences),",
        "and write 2-3 initial ADRs based on the actual tech stack and architecture choices visible in the codebase.",
      ].join(" "),
    },
    goal: {
      filename: "docs/GOAL.md",
      guide: [
        "Create a Goal / OKR document for this project.",
        "Include: quarterly objectives with key results, weekly milestone targets,",
        "personal development goals related to the project, and a progress tracking format.",
      ].join(" "),
    },
    docs: {
      filename: "docs/DOCS.md",
      guide: [
        "Create a documentation map for this project.",
        "Include: canonical sources of truth, onboarding path, document ownership,",
        "update cadence, and maintenance rules.",
      ].join(" "),
    },
    sheet: {
      filename: "docs/SHEET.md",
      guide: [
        "Create a Google Sheet schema document for BIP posting evidence.",
        "Include: columns, required fields, example rows, validation rules,",
        "and how the Sheet supports daily Build In Public missions.",
      ].join(" "),
    },
  };

  const template = templates[docType];
  if (!template) {
  broadcast({
      type: "doc_creation_result",
      docType,
      error: `Unknown document type: ${docType}`,
    });
    return;
  }

  try {
    const packagePath = resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk");
    const cliPath = path.join(packagePath, "cli.js");
    const env = buildClaudeAgentEnv();

    const systemPrompt = [
      "You are a project document generator. Your job is to explore the given workspace,",
      "understand the project's purpose, tech stack, and current state, then create a specific document.",
      "",
      "Strategy:",
      "1. List root directory and key files (README, package.json, Cargo.toml, etc.)",
      "2. Read the README and any existing docs to understand the project",
      "3. Check the source code structure to understand the architecture",
      "4. Write the document based on REAL project data — not generic templates",
      "",
      "IMPORTANT:",
      "- Write all document content in Korean (한국어)",
      "- Use markdown format",
      "- Base everything on actual project analysis — be specific, reference real files and features",
      `- Save the file to: ${template.filename}`,
      "- Create the parent directory if needed",
    ].join("\n");

    const abortController = new AbortController();
    const options = {
      pathToClaudeCodeExecutable: cliPath,
      executable: process.execPath,
      env,
      cwd: docRoot,
      maxTurns: 12,
      systemPrompt,
      allowDangerouslySkipPermissions: true,
      permissionMode: "bypassPermissions",
      abortController,
    };

  const prompt = [
      `${template.guide}`,
      "",
      `Explore this workspace first, then write the document and save it to "${template.filename}".`,
    ].join("\n");

    const stream = query({
      prompt,
      options,
    });
    for await (const event of stream) {
      if (event.type === "assistant" && event.message?.content) {
        for (const content of event.message.content) {
          if (content.type === "tool_use") {
            const name = content.name || "tool";
            const input = content.input || {};
            let detail = "";
            if (name === "Read" || name === "Glob") {
              detail = input.file_path || input.pattern || "";
            } else if (name === "Bash") {
              const cmd = String(input.command || "");
              detail = cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
            } else if (name === "Write" || name === "Edit") {
              detail = input.file_path || "";
            } else if (name === "Grep") {
              detail = input.pattern || "";
            }
            const text = detail ? `${name}: ${detail}` : name;
            broadcast({ type: "doc_creation_progress", docType, progressText: text });
          }
        }
    }
    }

    // Verify the file was created
    const createdPath = path.resolve(docRoot, template.filename);
    try {
      await fs.access(createdPath);
      telemetry.captureEvent("mac_sidecar_doc_created", {
        doc_type: docType,
        doc_path: template.filename,
    });
      broadcast({
        type: "doc_creation_result",
        docType,
        docPath: template.filename,
    });
    } catch {
      telemetry.captureException(
        new Error(`Agent finished but the file was not found at ${template.filename}`),
        {
          operation: "runCreateDoc",
          doc_type: docType,
          doc_path: template.filename,
        },
      );
      broadcast({
        type: "doc_creation_result",
        docType,
        error: `Agent finished but the file was not found at ${template.filename}`,
    });
    }
  } catch (error) {
  telemetry.captureException(error, {
      operation: "runCreateDoc",
    doc_type: docType,
    });
  broadcast({
      type: "doc_creation_result",
      docType,
      error: formatError(error),
    });
  }
}

function resolveCodexBinaryPath() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const platform =
    process.platform === "darwin"
      ? "apple-darwin"
      : process.platform === "win32"
        ? "pc-windows-msvc"
        : "unknown-linux-musl";
  const binary = process.platform === "win32" ? "codex.exe" : "codex";
  const targetTriple = `${arch}-${platform}`;
  const platformPackage = resolveCodexPlatformPackageName(targetTriple);
  const packageRoots = [
    platformPackage ? resolveInstalledPackageRoot("@openai", platformPackage) : null,
    resolveInstalledPackageRoot("@openai", "codex"),
    resolveInstalledPackageRoot("@openai", "codex-sdk"),
  ].filter(Boolean);

  for (const packageRoot of packageRoots) {
    const candidate = path.join(packageRoot, "vendor", targetTriple, "codex", binary);
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(packageRoots[0], "vendor", targetTriple, "codex", binary);
}

function resolveCodexPlatformPackageName(targetTriple) {
  switch (targetTriple) {
    case "aarch64-apple-darwin":
      return "codex-darwin-arm64";
    case "x86_64-apple-darwin":
      return "codex-darwin-x64";
    case "aarch64-unknown-linux-musl":
      return "codex-linux-arm64";
    case "x86_64-unknown-linux-musl":
      return "codex-linux-x64";
    case "aarch64-pc-windows-msvc":
      return "codex-win32-arm64";
    case "x86_64-pc-windows-msvc":
      return "codex-win32-x64";
    default:
      return null;
  }
}

function resolveInstalledPackageRoot(...segments) {
  const bundledPath = path.resolve(sidecarRoot, "node_modules", ...segments);
  if (fsSync.existsSync(bundledPath)) {
    return bundledPath;
  }
  return path.resolve(sidecarRoot, "..", "node_modules", ...segments);
}

function buildMcpConfig(
  sessionId,
  {
    executionMode = "",
    approvedToolExecution = false,
  } = {},
) {
  return {
    command: process.execPath,
    args: [path.join(sidecarRoot, "mcp-server.mjs"), "--session", sessionId, "--workspace", workspaceRoot],
    env: {
      ...buildAuthEnv(),
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_EXECUTION_MODE: executionMode,
      AGENTIC30_APPROVED_TOOL_EXECUTION: approvedToolExecution ? "1" : "0",
    },
  };
}

const notionConfigPath = path.join(appSupportPath, "notion-config.json");

function isNotionConnected() {
  const config = readJsonFile(notionConfigPath);
  return Boolean(config?.enabled && config?.oauth?.accessToken);
}

function readNotionConfig() {
  return readJsonFile(notionConfigPath) || {};
}

function writeNotionConfig(config) {
  fsSync.writeFileSync(notionConfigPath, JSON.stringify(config, null, 2));
  try {
    fsSync.chmodSync(notionConfigPath, 0o600);
  } catch { /* ignore */ }
}

async function ensureNotionToken() {
  const config = readNotionConfig();
  if (!config?.oauth?.accessToken) return null;

  // Check if token is expired (with 60s buffer)
  if (config.oauth.expiresAt) {
    const expiresAt = new Date(config.oauth.expiresAt).getTime();
    if (Date.now() > expiresAt - 60_000) {
      // Try refresh
      if (config.oauth.refreshToken && config.oauth.tokenEndpoint && config.oauth.clientId) {
        try {
          const tokens = await refreshAccessToken(
            config.oauth.tokenEndpoint,
            config.oauth.clientId,
            config.oauth.refreshToken,
          );
          config.oauth.accessToken = tokens.access_token;
          config.oauth.refreshToken = tokens.refresh_token || config.oauth.refreshToken;
          config.oauth.expiresAt = tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null;
          writeNotionConfig(config);
        } catch {
          // Refresh failed — clear tokens
          config.enabled = false;
          config.oauth = {};
          writeNotionConfig(config);
          broadcast({ type: "notion_oauth_result", success: false, error: "Token refresh failed. Please reconnect." });
          return null;
        }
    }
    }
  }

  return config.oauth.accessToken;
}

function buildNotionMcpConfig() {
  const config = readNotionConfig();
  if (!config?.enabled || !config?.oauth?.accessToken) return {};
  return {
    notion: {
      type: "http",
      url: "https://mcp.notion.com/mcp",
      headers: {
        Authorization: `Bearer ${config.oauth.accessToken}`,
      },
    },
  };
}

async function runNotionOAuth() {
  broadcast({ type: "notion_oauth_started" });

  try {
    const { alreadyAuthorized } = await initiateNotionOAuth({
      onAuthUrl: (url) => {
        broadcast({ type: "notion_oauth_browser_opened", authUrl: url });
      },
    });

    if (alreadyAuthorized) {
      broadcast({ type: "notion_oauth_result", success: true });
    }
    // Otherwise, wait for notion_oauth_callback message from the app
  } catch (error) {
  broadcast({
      type: "notion_oauth_result",
      success: false,
      error: formatError(error),
    });
  }
}

async function completeNotionOAuth(code) {
  try {
    const result = await exchangeOAuthCode(code);

    const config = {
      enabled: true,
      oauth: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
        tokenEndpoint: result.tokenEndpoint,
      },
    };
    writeNotionConfig(config);
  broadcast({ type: "notion_oauth_result", success: true });
  } catch (error) {
  broadcast({
      type: "notion_oauth_result",
      success: false,
      error: formatError(error),
    });
  }
}

function disconnectNotion() {
  writeNotionConfig({ enabled: false, oauth: {} });
  broadcast({ type: "notion_oauth_result", success: false, disconnected: true });
}

function getEnvironmentSummary() {
  return {
    claude: getProviderConnectionState("claude"),
    codex: getProviderConnectionState("codex"),
    gemini: getProviderConnectionState("gemini"),
    acp: getAcpAdapterState(),
    qmd: getQmdState({ sidecarRoot }),
  };
}

function scheduleQmdMemoryBootstrap() {
  if (qmdBootstrapScheduled || process.env.AGENTIC30_DISABLE_QMD_BOOTSTRAP === "1") {
    return;
  }
  qmdBootstrapScheduled = true;
  setTimeout(bootstrapQmdMemoryCollections, 1_500).unref?.();
}

function bootstrapQmdMemoryCollections() {
  const worker = new Worker(new URL("./qmd-bootstrap-worker.mjs", import.meta.url), {
    workerData: {
      appSupportPath,
      sidecarRoot,
    workspaceRoot,
    },
  });
  worker.unref?.();

  worker.once("message", (message) => {
    if (!message?.ok) {
      qmdBootstrapScheduled = false;
      const error = new Error(message?.error?.message || "QMD memory bootstrap failed.");
      if (message?.error?.stack) error.stack = message.error.stack;
      telemetry.captureException(error, {
        operation: "qmd_memory_bootstrap",
    });
      return;
    }

    const result = message.result || {};
  telemetry.captureEvent("mac_sidecar_qmd_memory_bootstrap", {
      attempted: result.attempted,
      updated: result.updated,
      reason: result.reason || "",
      collection_count: Array.isArray(result.collections) ? result.collections.length : 0,
      qmd_source: result.qmd?.source || "",
    });
  });

  worker.once("error", (error) => {
    qmdBootstrapScheduled = false;
  telemetry.captureException(error, {
      operation: "qmd_memory_bootstrap",
    });
  });

  worker.once("exit", (code) => {
    if (code !== 0) {
      qmdBootstrapScheduled = false;
      telemetry.captureException(new Error(`QMD memory bootstrap worker exited with code ${code}.`), {
        operation: "qmd_memory_bootstrap",
    });
    }
  });
}

function buildSidecarPreflight(environment = getEnvironmentSummary()) {
  return buildPreflightReport({
    appSupportPath,
    workspaceRoot,
    sidecarRoot,
    environment,
  });
}

function buildSidecarDiagnostics(
  environment = getEnvironmentSummary(),
  preflight = buildSidecarPreflight(environment),
) {
  const snapshot = buildDiagnosticsSnapshot({
    appSupportPath,
    workspaceRoot,
    environment,
    preflight,
    sessions: serializeSessions(),
    activeRuns: state.activeRuns,
    sessionStoreSchemaVersion: SESSION_STORE_SCHEMA_VERSION,
    sessionStoreWarnings: state.sessionStoreWarnings,
  });
  snapshot.gstackVendor = describeGstackVendor();
  return snapshot;
}

function getAcpAdapterState() {
  const adapterPath = path.join(sidecarRoot, "acp-adapter.mjs");
  const claudeApiReady = Boolean(process.env.ANTHROPIC_API_KEY);
  const codexApiReady = Boolean(
    process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY,
  );
  if (fsSync.existsSync(adapterPath)) {
    return {
      available: claudeApiReady || codexApiReady,
      message:
        claudeApiReady || codexApiReady
          ? `ACP adapter ready (${[
              claudeApiReady ? "Claude API" : null,
              codexApiReady ? "OpenAI API" : null,
            ]
              .filter(Boolean)
              .join(", ")})`
          : "ACP adapter is installed, but isolated ACP mode requires ANTHROPIC_API_KEY and/or CODEX_API_KEY / OPENAI_API_KEY",
      adapterPath,
      command: `${process.execPath} ${adapterPath} --workspace ${workspaceRoot}`,
    };
  }

  return {
    available: false,
    message: "ACP adapter script is missing",
    adapterPath,
    command: null,
  };
}

function baseSystemPrompt(provider) {
  const lines = [
    "You are the sidecar reasoning engine for agentic30.",
    "Reply in concise conversational prose suitable for a floating glass chat bubble UI.",
    "Default to Korean (한국어) for all assistant prose unless the user explicitly asks for another language.",
    `Current workspace: ${workspaceRoot}`,
    `Provider mode: ${provider}`,
    "Use the agentic30 MCP server when you need app context or safe workspace inspection.",
    provider === "codex"
      ? `When you need the user's input, call the ${CODEX_STRUCTURED_INPUT_TOOL} MCP tool instead of asking in plain text.`
      : "When you need the user's input, call the AskUserQuestion tool instead of asking in plain text.",
    "Use 1-2 focused questions at a time, keep choices concrete, and enable free text only when necessary.",
  ];

  const bipConfig = readJsonFile(path.join(appSupportPath, "bip-config.json"));
  if (bipConfig?.workspace?.root) {
    lines.push("");
    lines.push("## BIP (Build In Public) Context");
    lines.push(`Project workspace: ${bipConfig.workspace.root}`);
    if (bipConfig.workspace.icp) lines.push(`ICP doc: ${bipConfig.workspace.icp}`);
    if (bipConfig.workspace.spec) lines.push(`SPEC doc: ${bipConfig.workspace.spec}`);
    if (bipConfig.workspace.values) lines.push(`VALUES doc: ${bipConfig.workspace.values}`);
    if (bipConfig.workspace.designSystem) lines.push(`Design System docs: ${bipConfig.workspace.designSystem}`);
    if (bipConfig.workspace.adr) lines.push(`ADR docs: ${bipConfig.workspace.adr}`);
    if (bipConfig.workspace.goal) lines.push(`Goal doc: ${bipConfig.workspace.goal}`);
    if (bipConfig.workspace.docs) lines.push(`Docs map: ${bipConfig.workspace.docs}`);
    if (bipConfig.workspace.sheet) lines.push(`Sheet schema: ${bipConfig.workspace.sheet}`);

    const docs = bipConfig.externalDocs || {};
    const allUrls = [...(docs.googleDocs || []), ...(docs.googleSheets || []), ...(docs.notion || [])];
    if (allUrls.length > 0) {
      lines.push(`External docs: ${allUrls.join(", ")}`);
    }

    const social = bipConfig.social || {};
    if (social.threads) lines.push(`Threads: @${social.threads}`);
    if (social.x) lines.push(`X/Twitter: @${social.x}`);

    lines.push("Settings BIP document contents are injected into each chat prompt when configured.");
    lines.push("Use the BIP MCP tools (get_bip_context, read_project_doc, gws_docs_read, gws_sheets_read) to refresh or inspect project documents when needed.");
  }

  const notionConfig = readJsonFile(path.join(appSupportPath, "notion-config.json"));
  if (notionConfig?.enabled) {
    lines.push("");
    lines.push("## Notion Integration");
    lines.push("The official Notion MCP server is connected. Use its tools to search, read, create, and update pages and databases in the user's Notion workspace.");
  }

  const qmdGuidance = buildQmdGuidance(workspaceRoot, { appSupportPath, sidecarRoot });
  if (qmdGuidance) {
    lines.push("");
    lines.push(qmdGuidance);
  }

  return lines.join("\n");
}

function appendAssistantText(session, messageId, chunk) {
  if (!chunk) {
    return;
  }
  const message = session.messages.find((item) => item.id === messageId);
  if (!message) {
    return;
  }
  message.content += chunk;
  touch(session);
  broadcast({
    type: "message_delta",
    sessionId: session.id,
    messageId,
    delta: chunk,
  });
}

function setAssistantText(session, messageId, content) {
  const message = session.messages.find((item) => item.id === messageId);
  if (!message) {
    return;
  }

  // Wire-level inline_decision extraction. Provider SDKs (Anthropic agent,
  // OpenAI codex) do not expose a metadata side-channel for arbitrary JSON,
  // so we ride the text channel: LLMs follow INLINE_DECISION_CONTRACT and
  // emit a sentinel block somewhere in their response. We strip it here so
  // the user only sees the visible body, and attach the parsed payload to
  // `message.inlineDecision` so the SwiftUI client renders a Decision Card
  // Stack inline below the bubble.
  //
  // We only attempt extraction when BOTH delimiters are present in the
  // current text snapshot. While streaming, the start delimiter may arrive
  // before the end; in that interim window the user briefly sees the raw
  // start tag, then the next chunk closes the block and we collapse it.
  // Once extraction succeeds the result is cached on `message.inlineDecision`
  // and won't be reparsed on subsequent setAssistantText calls.
  let resolvedContent = content;
  let extractedDecision = null;
  if (
    typeof content === "string"
    && content.includes(INLINE_DECISION_SENTINEL_START)
    && content.includes(INLINE_DECISION_SENTINEL_END)
    && !message.inlineDecision
  ) {
    const extracted = extractInlineDecision(content);
    if (extracted.decision) {
      resolvedContent = extracted.text;
      // Mutual exclusion (P1 from codex review): if a form-style intake is
      // active on this session, drop the inline decision but keep the text
      // cleaned of the sentinel so the user doesn't see raw delimiters.
      if (session.pendingUserInput) {
        console.warn(
          "[inline-decision] dropped at finalize: session.pendingUserInput is active",
        );
      } else {
        extractedDecision = extracted.decision;
    }
    }
  }
  if (
    typeof resolvedContent === "string"
    && !extractedDecision
    && !message.inlineDecision
    && !session.pendingUserInput
  ) {
    const inferred = inferInlineDecisionFromPlainText(resolvedContent);
    if (inferred.decision) {
      resolvedContent = inferred.text;
      extractedDecision = inferred.decision;
    }
  }

  message.content = resolvedContent;
  if (extractedDecision) {
    message.inlineDecision = extractedDecision;
  }
  touch(session);
  broadcast({
    type: "message_replaced",
    sessionId: session.id,
    messageId,
    content: resolvedContent,
  });
  // `message_replaced` only carries content; the SwiftUI client needs a full
  // session refresh when inlineDecision metadata changes.
  if (extractedDecision) {
  broadcast({ type: "session_updated", session });
  }
}

async function stopSession(sessionId) {
  state.promptQueues.delete(sessionId);
  const run = state.activeRuns.get(sessionId);
  if (!run) {
    return;
  }
  run.abortController.abort();
  await run.stop?.();
  state.activeRuns.delete(sessionId);
}

function createSession(payload) {
  const provider = normalizeSessionProvider(payload.provider);
  const model = String(payload.model || "").trim();
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: "New Session",
    provider,
    model,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    error: null,
    messages: [],
    pendingUserInput: null,
    runtime: {},
  };
}

function setSessionStartupTiming(
  session,
  {
    createStartedAt,
    bootstrapElapsedMs = null,
    persistElapsedMs = null,
    bipCoachSyncElapsedMs = null,
    clientSocket = null,
  } = {},
) {
  const now = performance.now();
  const sidecarReadyPerf = sidecarBootTiming.sidecarReadyPerf;
  const clientAuthenticatedPerf = clientSocket?.agentic30AuthenticatedAt;
  const existingCreatedAt = typeof session.runtime?.startupTiming?.sessionCreatedAt === "string"
    ? session.runtime.startupTiming.sessionCreatedAt
    : null;
  const sessionCreatedAt = existingCreatedAt || new Date().toISOString();
  const processStartedEpochMs = Date.parse(sidecarProcessStartedAtIso);
  const sessionCreatedEpochMs = Date.parse(sessionCreatedAt);
  const sessionCreatedPerf = existingCreatedAt
    && Number.isFinite(processStartedEpochMs)
    && Number.isFinite(sessionCreatedEpochMs)
    ? sidecarProcessStartedAt + (sessionCreatedEpochMs - processStartedEpochMs)
    : now;
  const timing = {
    processStartedAt: sidecarProcessStartedAtIso,
    sidecarReadyAt: sidecarBootTiming.sidecarReadyAt,
    clientAuthenticatedAt: clientSocket?.agentic30AuthenticatedAtIso
      || sidecarBootTiming.lastClientAuthenticatedAt,
    sessionCreatedAt,
    processToSidecarReadyMs: sidecarBootTiming.processToSidecarReadyMs,
    processToClientAuthenticatedMs: Number.isFinite(clientAuthenticatedPerf)
      ? Math.max(0, Math.round(clientAuthenticatedPerf - sidecarProcessStartedAt))
      : sidecarBootTiming.processToLastClientAuthenticatedMs,
    processToCreateSessionReceivedMs: Number.isFinite(createStartedAt)
      ? Math.max(0, Math.round(createStartedAt - sidecarProcessStartedAt))
      : null,
    processToSessionCreatedMs: Math.max(0, Math.round(sessionCreatedPerf - sidecarProcessStartedAt)),
    sidecarReadyToCreateSessionReceivedMs: Number.isFinite(createStartedAt) && Number.isFinite(sidecarReadyPerf)
      ? Math.max(0, Math.round(createStartedAt - sidecarReadyPerf))
      : null,
    clientAuthenticatedToCreateSessionReceivedMs: Number.isFinite(createStartedAt)
      && Number.isFinite(clientAuthenticatedPerf)
      ? Math.max(0, Math.round(createStartedAt - clientAuthenticatedPerf))
      : null,
    createSessionElapsedMs: Number.isFinite(createStartedAt)
      ? Math.max(0, Math.round(sessionCreatedPerf - createStartedAt))
      : null,
    bootstrapIntakeElapsedMs: bootstrapElapsedMs,
    persistElapsedMs,
    bipCoachSyncElapsedMs,
    clientCountAtCreate: state.clients.size,
  };
  session.runtime = {
    ...(session.runtime || {}),
    startupTiming: timing,
  };
}

async function attachBootstrapIntake(session) {
  session.title = session.provider === "claude"
    ? "Claude Assistant"
    : session.provider === "gemini"
      ? "Gemini Assistant"
      : "Codex Assistant";
  session.pendingUserInput = await createUserInputRequest(appSupportPath, {
    sessionId: session.id,
    toolName: "initial_intake",
    title: "시작하기",
    questions: buildBootstrapQuestions(),
  });
  session.status = "awaiting_input";
  touch(session);
}

function normalizeSessionProvider(provider) {
  return provider === "claude" || provider === "codex" || provider === "gemini"
    ? provider
    : "codex";
}

function buildBootstrapQuestions() {
  return [
    {
      header: "시작",
      question: "무엇부터 시작할까요?",
      options: [
        {
          label: "프로젝트 전략 문서 만들기",
          description:
            "프로젝트를 인터뷰하고 ICP, GOAL, VALUES, SPEC 초안을 만듭니다.",
        },
        {
          label: "아이디어 압박 검증하기",
          description:
            "핵심 가정과 진입 전략을 공격적으로 점검해 방향을 좁힙니다.",
        },
        {
          label: "공개 글 초안 작성하기",
          description:
            "공개 실행 맥락을 불러와 게시글이나 개발 로그 초안을 다듬습니다.",
        },
        {
          label: "워크스페이스 살펴보기",
          description: "변경 전에 저장소 구조와 현재 작업 맥락을 먼저 파악합니다.",
        },
      ],
      multiSelect: false,
      allowFreeText: false,
      textMode: "short",
    },
  ];
}

function makeMessage({
  role,
  provider,
  content,
  state,
  bipMissionChoices = null,
  providerAuthActions = null,
  inlineDecision = null,
  session = null,
}) {
  // Auto-extract inline_decision sentinel from text content. LLMs emit the
  // payload via the wire contract defined in inline-decision.mjs. Explicit
  // `inlineDecision` arg takes precedence (system messages bypass the wire
  // and pass the structured payload directly, e.g. bootstrap intake).
  let resolvedContent = content;
  let resolvedDecision = inlineDecision;
  if (resolvedDecision == null && typeof resolvedContent === "string") {
    const extracted = extractInlineDecision(resolvedContent);
    if (extracted.decision) {
      resolvedDecision = extracted.decision;
      resolvedContent = extracted.text;
    } else {
      const inferred = inferInlineDecisionFromPlainText(resolvedContent);
      if (inferred.decision) {
        resolvedDecision = inferred.decision;
        resolvedContent = inferred.text;
    }
    }
  }

  // Mutual exclusion enforcement (P1 from plan-eng-review codex pass).
  // When a form-style intake is active on the session, drop any inline
  // decision payload to keep the two channels disjoint. The user only
  // sees one decision UI per turn. Sentinel block already stripped above
  // so the user never sees the raw JSON either way.
  if (session?.pendingUserInput && resolvedDecision != null) {
    console.warn(
      "[inline-decision] dropped: session.pendingUserInput is active",
    );
    resolvedDecision = null;
  }

  const message = {
    id: randomUUID(),
    role,
    provider,
    content: resolvedContent,
    state,
    createdAt: new Date().toISOString(),
    error: null,
    performance: null,
  };
  if (Array.isArray(bipMissionChoices) && bipMissionChoices.length) {
    message.bipMissionChoices = bipMissionChoices;
  }
  if (Array.isArray(providerAuthActions) && providerAuthActions.length) {
    message.providerAuthActions = providerAuthActions;
  }
  const validatedDecision = validateInlineDecision(resolvedDecision);
  if (validatedDecision) {
    message.inlineDecision = validatedDecision;
  }
  return message;
}

function buildProviderAuthActionsForFailures(failures = []) {
  const text = failures.join("\n").toLowerCase();
  const providers = [];
  if (text.includes("claude") && looksLikeProviderAuthError(text)) providers.push("claude");
  if (text.includes("codex") && looksLikeProviderAuthError(text)) providers.push("codex");
  if (text.includes("gemini") && looksLikeProviderAuthError(text)) providers.push("gemini");
  return buildProviderAuthActions(providers);
}

function buildProviderAuthActionsForError(provider, error) {
  const text = String(error || "").toLowerCase();
  if (!looksLikeProviderAuthError(text)) return [];
  return buildProviderAuthActions([provider]);
}

function looksLikeProviderAuthError(text) {
  const lower = String(text || "").toLowerCase();
  return lower.includes("auth")
    || lower.includes("login")
    || lower.includes("401")
    || lower.includes("invalid authentication credentials")
    || lower.includes("sign in");
}

function buildProviderAuthActions(providers = []) {
  return [...new Set(providers)]
    .filter((provider) => provider === "claude" || provider === "codex" || provider === "gemini")
    .map((provider) => ({
      id: `${provider}_login`,
      provider,
      title: provider === "claude"
        ? "Claude 로그인"
        : provider === "gemini"
          ? "Gemini 로그인"
          : "Codex 로그인",
      detail: provider === "claude"
        ? "Claude Agent SDK의 claude auth login을 실행합니다."
        : provider === "gemini"
          ? "Terminal에서 Gemini CLI 인증 흐름을 엽니다."
          : "Codex CLI의 codex login을 실행합니다.",
    }));
}

function recordMessageTiming(
  session,
  message,
  startedAt,
  phase,
  details = {},
  { once = false, seen = null } = {},
) {
  if (!message || !phase) return;
  if (once && seen) {
    const key = `${message.id}:${phase}`;
    if (seen.has(key)) return;
    seen.add(key);
  }
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  const mark = {
    phase,
    elapsedMs,
    at: new Date().toISOString(),
    ...(details && Object.keys(details).length ? { details } : {}),
  };
  const current = message.performance && typeof message.performance === "object"
    ? message.performance
    : {};
  const marks = Array.isArray(current.marks) ? current.marks : [];
  message.performance = {
    ...current,
    startedAt: current.startedAt || new Date(Date.now() - elapsedMs).toISOString(),
    updatedAt: mark.at,
    totalMs: elapsedMs,
    marks: [...marks, mark],
  };
  broadcast({
    type: "tool_event",
    sessionId: session.id,
    messageId: message.id,
    phase: "performance",
    toolName: "response_timing",
    payload: mark,
    summary: `timing ${phase} ${elapsedMs}ms`,
  });
}

function deriveTitle(prompt) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact;
}

function shouldDeriveTitle(session) {
  return (
    !session.title
    || session.title === "New Session"
    || session.title === "Codex Assistant"
    || session.title === "Claude Assistant"
  );
}

function touch(session) {
  session.updatedAt = new Date().toISOString();
}

function shouldRestartIddQuestionRequest(session, request) {
  if (isLegacyStaticIddUserInputRequest(request)) {
    return true;
  }
  if (isStaleAwkwardIcpUserInputRequest(request)) {
    return getProviderAuthState(session?.provider).available;
  }
  if (isMissingIcpContextIntro(request)) {
    return true;
  }
  if (!isStaleGenericHostIddUserInputRequest(request)) {
    return false;
  }
  if (process.env.AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS === "1") {
    return false;
  }
  return getProviderAuthState(session?.provider).available;
}

async function syncPendingUserInputRequests() {
  const requests = await listUserInputRequests(appSupportPath);
  const activeRequestIds = new Set(requests.map((request) => request.requestId));
  const changedSessions = new Set();

  for (const request of requests) {
    if (state.resolvedUserInputIds.has(request.requestId)) continue;
    const session = state.sessions.get(request.sessionId);
    if (!session) continue;
    if (
      isIddInterviewSession(session)
      && shouldRestartIddQuestionRequest(session, request)
    ) {
      await deleteUserInputArtifacts(appSupportPath, request.sessionId, request.requestId);
      state.resolvedUserInputIds.add(request.requestId);
      activeRequestIds.delete(request.requestId);
      if (session.pendingUserInput?.requestId === request.requestId) {
        session.pendingUserInput = null;
      }
      await restartIddAdaptiveQuestionGeneration(session, {
        previousRequestId: request.requestId,
        reason: "legacy_static_blocked",
      });
      changedSessions.add(session.id);
      continue;
    }
    if (session.pendingUserInput?.requestId === request.requestId) continue;

    session.pendingUserInput = attachIddAdaptiveContinuationToRequest(session, request);
    session.status = "awaiting_input";
    touch(session);
    changedSessions.add(session.id);
  }

  for (const session of state.sessions.values()) {
    const pending = session.pendingUserInput;
    if (
      pending
      && isIddInterviewSession(session)
      && shouldRestartIddQuestionRequest(session, pending)
    ) {
      await deleteUserInputArtifacts(appSupportPath, session.id, pending.requestId);
      state.resolvedUserInputIds.add(pending.requestId);
      activeRequestIds.delete(pending.requestId);
      session.pendingUserInput = null;
      await restartIddAdaptiveQuestionGeneration(session, {
        previousRequestId: pending.requestId,
        reason: "legacy_static_blocked",
      });
      changedSessions.add(session.id);
      continue;
    }
    if (!pending || activeRequestIds.has(pending.requestId)) continue;

    session.pendingUserInput = null;
    if (session.status === "awaiting_input") {
      session.status = state.activeRuns.has(session.id) ? "running" : "idle";
    }
    touch(session);
    changedSessions.add(session.id);
  }

  for (const requestId of [...state.resolvedUserInputIds]) {
    if (!activeRequestIds.has(requestId)) {
      state.resolvedUserInputIds.delete(requestId);
    }
  }

  if (changedSessions.size === 0) return;

  await persistSessions();
  for (const sessionId of changedSessions) {
  broadcast({ type: "session_updated", session: state.sessions.get(sessionId) });
  }
}

function normalizeUserInputResponse(promptRequest, payload) {
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  const answers = {};
  const annotations = {};

  for (const question of promptRequest.questions) {
    const match = responses.find((entry) => entry?.question === question.question);
    const selectedOptions = Array.isArray(match?.selectedOptions)
      ? match.selectedOptions
          .map((value) => String(value).trim())
          .filter(Boolean)
      : [];
    const freeText = typeof match?.freeText === "string" ? match.freeText.trim() : "";
    const selectedAsOther = selectedOptions.some((value) => isOtherTextOptionLabel(value));
    const answerValue = freeText && selectedAsOther
      ? freeText
      : selectedOptions.length > 0
      ? selectedOptions.join(", ")
      : freeText;

    answers[question.question] = answerValue;

    if (freeText || match?.notes || match?.preview) {
      annotations[question.question] = {
        ...(match?.preview ? { preview: String(match.preview) } : {}),
        ...(freeText ? { notes: freeText } : match?.notes ? { notes: String(match.notes) } : {}),
    };
    }
  }

  return {
    questions: promptRequest.questions,
    answers,
    annotations,
    responses: responses.map((entry) => ({
      question: String(entry?.question || ""),
      selectedOptions: Array.isArray(entry?.selectedOptions)
        ? entry.selectedOptions.map((value) => String(value))
        : [],
      freeText: typeof entry?.freeText === "string" ? entry.freeText : "",
    })),
  };
}

function findMissingRequiredFreeTextQuestion(response) {
  const responsesByQuestion = new Map(
    (response.responses || []).map((entry) => [entry.question, entry]),
  );
  return (response.questions || []).find((question) => {
    if (question?.requiresFreeText !== true) return false;
    const entry = responsesByQuestion.get(question.question);
    return !String(entry?.freeText || "").trim();
  }) || null;
}

function formatStructuredPromptResponse(response) {
  const lines = [];
  for (const entry of response.responses || []) {
    const parts = [];
    const selectedOptions = Array.isArray(entry.selectedOptions)
      ? entry.selectedOptions.filter((option) => !isOtherTextOptionLabel(option))
      : [];
    if (selectedOptions.length > 0) {
      parts.push(selectedOptions.join(", "));
    }
    if (typeof entry.freeText === "string" && entry.freeText.trim()) {
      parts.push(entry.freeText.trim());
    }
    if (parts.length === 0) continue;
    lines.push(parts.join(" — "));
  }
  return lines.join("\n");
}

// Resolve descriptions for whichever options the user clicked. The sidecar
// keeps the prompt object (with full option label+description pairs) on the
// session up until submit, but the client only sends back labels. Looking the
// descriptions up here lets the IDD rubric gate see the keyword-rich text
// instead of the bare label, so a single deliberate click can advance the
// signal without falling back to the repeated-answer auto-pass.
function collectSelectedOptionDescriptions(pendingUserInput, response) {
  if (!pendingUserInput || !response) return "";
  const questions = Array.isArray(pendingUserInput.questions) ? pendingUserInput.questions : [];
  const lookup = new Map();
  for (const question of questions) {
    const options = Array.isArray(question?.options) ? question.options : [];
    for (const option of options) {
      const label = typeof option?.label === "string" ? option.label.trim() : "";
      const description = typeof option?.description === "string" ? option.description.trim() : "";
      if (!label || !description) continue;
      if (!lookup.has(label)) lookup.set(label, description);
    }
  }
  if (lookup.size === 0) return "";
  const descriptions = [];
  for (const entry of response.responses || []) {
    const selectedOptions = Array.isArray(entry?.selectedOptions) ? entry.selectedOptions : [];
    for (const option of selectedOptions) {
      const label = typeof option === "string" ? option.trim() : "";
      if (!label || isOtherTextOptionLabel(label)) continue;
      const description = lookup.get(label);
      if (description) descriptions.push(description);
    }
  }
  return descriptions.join(" ");
}

async function loadSessions() {
  if (process.env.AGENTIC30_RESTORE_SESSIONS_ON_BOOT !== "1") {
  await persistSessionsToFile(sessionsFilePath, []);
    return;
  }

  const sessions = await loadSessionsFromFile(sessionsFilePath, {
    onRecoverableError: (warning) => {
      state.sessionStoreWarnings.push({
        ...warning,
        occurredAt: new Date().toISOString(),
    });
      if (state.sessionStoreWarnings.length > 5) {
        state.sessionStoreWarnings = state.sessionStoreWarnings.slice(-5);
    }
    },
  });
  for (const session of sessions) {
  state.sessions.set(session.id, session);
  }
  if (sessions.length > 0) {
  await persistSessions();
  }
}

async function persistSessions() {
  await persistSessionsToFile(sessionsFilePath, serializeSessions());
}

function serializeSessions() {
  return [...state.sessions.values()].sort((lhs, rhs) =>
    rhs.updatedAt.localeCompare(lhs.updatedAt),
  );
}

function getSession(sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return session;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function send(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    state.clients.delete(socket);
    return false;
  }
  try {
    socket.send(JSON.stringify(payload), (error) => {
      if (!error) return;
      state.clients.delete(socket);
      telemetry.captureException(error, {
        operation: "websocket_send",
        message_type: payload?.type || "unknown",
      });
    });
    return true;
  } catch (error) {
    state.clients.delete(socket);
    telemetry.captureException(error, {
      operation: "websocket_send",
      message_type: payload?.type || "unknown",
    });
    return false;
  }
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of state.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      state.clients.delete(client);
      continue;
    }
    try {
      client.send(message, (error) => {
        if (!error) return;
        state.clients.delete(client);
        telemetry.captureException(error, {
          operation: "websocket_broadcast",
          message_type: payload?.type || "unknown",
        });
      });
    } catch (error) {
      state.clients.delete(client);
      telemetry.captureException(error, {
        operation: "websocket_broadcast",
        message_type: payload?.type || "unknown",
      });
    }
  }
}

function buildRequestEmitEnvelope(event, properties = {}) {
  if (!ALLOWED_REQUEST_EMIT_EVENTS.has(event)) {
    throw new Error(`Unsupported request_emit event: ${event}`);
  }
  return {
    type: "request_emit",
    event,
    event_schema_version: REQUEST_EMIT_SCHEMA_VERSION,
    properties: sanitizeRequestEmitProperties(properties),
  };
}

function requestHostTelemetry(event, properties = {}) {
  broadcast(buildRequestEmitEnvelope(event, properties));
}

function sanitizeRequestEmitProperties(value) {
  if (value == null) return {};
  if (Array.isArray(value)) return {};
  if (typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, sanitizeRequestEmitValue(entry)]),
  );
}

function sanitizeRequestEmitValue(value) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((entry) => sanitizeRequestEmitValue(entry));
  if (typeof value === "object") return sanitizeRequestEmitProperties(value);
  return String(value);
}

function resetWorkspaceSetupTelemetry(root) {
  state.workspaceSetupTelemetry = {
    root: path.resolve(String(root || workspaceRoot)),
    started: false,
    failed: false,
    scanSucceeded: false,
    firstInput: state.workspaceSetupTelemetry.firstInput,
    firstInputSource: state.workspaceSetupTelemetry.firstInputSource,
    completed: false,
    startedAtMs: 0,
    foundCount: 0,
  };
}

function workspaceSetupBaseProperties(root) {
  const resolvedRoot = path.resolve(String(root || workspaceRoot));
  return {
    workspace_basename: path.basename(resolvedRoot),
    has_explicit_workspace: hasExplicitWorkspace,
  };
}

function markWorkspaceSetupStarted(root) {
  const resolvedRoot = path.resolve(String(root || workspaceRoot));
  const telemetryState = state.workspaceSetupTelemetry;
  if (
  telemetryState.root !== resolvedRoot
    || telemetryState.failed
    || telemetryState.completed
  ) {
    resetWorkspaceSetupTelemetry(resolvedRoot);
  }
  if (state.workspaceSetupTelemetry.started) return;

  state.workspaceSetupTelemetry.started = true;
  state.workspaceSetupTelemetry.startedAtMs = Date.now();
  requestHostTelemetry("workspace_setup_started", workspaceSetupBaseProperties(resolvedRoot));
}

function markWorkspaceSetupScanSucceeded(root, properties = {}) {
  const resolvedRoot = path.resolve(String(root || workspaceRoot));
  if (state.workspaceSetupTelemetry.root !== resolvedRoot) {
    resetWorkspaceSetupTelemetry(resolvedRoot);
  }
  state.workspaceSetupTelemetry.scanSucceeded = true;
  state.workspaceSetupTelemetry.foundCount = Number.isFinite(properties.found_count)
    ? properties.found_count
    : 0;
  maybeEmitWorkspaceSetupCompleted(properties);
}

function markWorkspaceSetupFailed(root, error) {
  const resolvedRoot = path.resolve(String(root || workspaceRoot));
  if (state.workspaceSetupTelemetry.root !== resolvedRoot) {
    resetWorkspaceSetupTelemetry(resolvedRoot);
  }
  if (state.workspaceSetupTelemetry.failed) return;

  state.workspaceSetupTelemetry.failed = true;
  requestHostTelemetry("workspace_setup_failed", {
    ...workspaceSetupBaseProperties(resolvedRoot),
    error_name: error?.code || error?.name || "Error",
  });
}

function markWorkspaceSetupFirstInput(source) {
  if (!state.workspaceSetupTelemetry.firstInput) {
    state.workspaceSetupTelemetry.firstInput = true;
    state.workspaceSetupTelemetry.firstInputSource = source;
  }
  maybeEmitWorkspaceSetupCompleted({ input_source: state.workspaceSetupTelemetry.firstInputSource });
}

function maybeEmitWorkspaceSetupCompleted(extra = {}) {
  const telemetryState = state.workspaceSetupTelemetry;
  if (
  telemetryState.completed
    || !telemetryState.started
    || !telemetryState.scanSucceeded
    || !telemetryState.firstInput
  ) {
    return;
  }

  telemetryState.completed = true;
  const elapsedMs = telemetryState.startedAtMs > 0
    ? Math.max(0, Date.now() - telemetryState.startedAtMs)
    : 0;
  requestHostTelemetry("workspace_setup_completed", {
    ...workspaceSetupBaseProperties(telemetryState.root),
    found_count: telemetryState.foundCount,
    elapsed_ms: elapsedMs,
    input_source: telemetryState.firstInputSource,
    ...extra,
  });
}

/**
 * Sub-AC 2.3 IPC down-channel: typed Foundation Phase chat lifecycle event.
 *
 * Single message envelope shared across the Day 0-7 unified channel — the
 * Swift host decodes this into a `SidecarEvent.foundation` payload to drive
 * Day badges, evidence chips, and KR4.1/4.2 telemetry without re-parsing
 * untyped `agent_event` blobs.
 *
 * Emitted phases (stable enum):
 *   - "started"        : runUnifiedFoundationChat accepted the prompt
 *   - "context_built"  : foundation system context composed (post resolveFoundationContext)
 *   - "streaming"      : provider call begun, deltas about to flow
 *   - "completed"      : final assistant message + evidence sidecar written
 *   - "aborted"        : user/abort-controller cancelled mid-stream
 *   - "rejected"       : pre-flight gate failed (empty prompt / invalid day)
 *   - "error"          : provider/run failure (`error` field carries reason)
 *
 * All numeric fields default to `null` when not yet known so the Swift
 * decoder stays total.
 */
function emitFoundationChatEvent({
  sessionId = null,
  messageId = null,
  day = null,
  phase,
  subWorkflow = null,
  specVersion = null,
  evidenceRefCount = null,
  missingInputCount = null,
  overallConfidence = null,
  evidenceSidecarPath = null,
  elapsedMs = null,
  reason = null,
  transport = "foundation_chat",
  error = null,
} = {}) {
  if (!phase) return;
  broadcast({
    type: "foundation_chat_event",
    sessionId,
    messageId,
    day,
    phase,
    subWorkflow,
    specVersion,
    evidenceRefCount,
    missingInputCount,
    overallConfidence,
    evidenceSidecarPath,
    elapsedMs,
    reason,
    transport,
    error,
  });
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readApiKey(provider) {
  if (provider === "claude") {
    return process.env.ANTHROPIC_API_KEY || "";
  }
  return process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || "";
}

async function startProviderAuthLogin(payload = {}) {
  const provider = payload.provider === "claude"
    ? "claude"
    : payload.provider === "gemini"
      ? "gemini"
      : "codex";
  if (provider === "gemini") {
    broadcast({
      type: "provider_auth_result",
      provider,
      success: false,
      error: "Open Gemini Auth from Settings so Terminal can run the interactive Gemini CLI flow.",
    });
    return;
  }
  const existing = state.providerAuthRuns.get(provider);
  if (existing) {
  broadcast({
      type: "provider_auth_progress",
      provider,
      detail: `${provider} login is already running.`,
    });
    return;
  }

  const command = provider === "claude"
    ? {
        executable: process.execPath,
        args: [
          path.join(resolveInstalledPackageRoot("@anthropic-ai", "claude-agent-sdk"), "cli.js"),
          "auth",
          "login",
          "--claudeai",
        ],
        env: buildClaudeLoginEnv(),
    }
    : {
        executable: process.execPath,
        args: [
          path.join(resolveInstalledPackageRoot("@openai", "codex"), "bin", "codex.js"),
          "login",
        ],
        env: buildCodexLoginEnv(),
    };

  broadcast({
    type: "provider_auth_started",
    provider,
    detail: provider === "claude"
      ? "Claude OAuth 로그인을 시작합니다."
      : "Codex OAuth 로그인을 시작합니다.",
  });

  const child = spawn(command.executable, command.args, {
    cwd: workspaceRoot,
    env: command.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startedAt = Date.now();
  const run = { child, output: "" };
  state.providerAuthRuns.set(provider, run);

  function handleChunk(chunk, stream) {
    const text = String(chunk || "");
    run.output += text;
    const trimmed = text.trim();
    if (trimmed) {
      broadcast({
        type: "provider_auth_progress",
        provider,
        detail: trimmed.slice(-1000),
        stream,
    });
    }
    const authUrl = extractFirstUrl(text);
    if (authUrl) {
      broadcast({
        type: "provider_auth_browser_opened",
        provider,
        authUrl,
    });
    }
  }

  child.stdout.on("data", (chunk) => handleChunk(chunk, "stdout"));
  child.stderr.on("data", (chunk) => handleChunk(chunk, "stderr"));
  child.on("error", (error) => {
    state.providerAuthRuns.delete(provider);
  broadcast({
      type: "provider_auth_result",
      provider,
      success: false,
      error: formatError(error),
      durationMs: Date.now() - startedAt,
    });
  });
  child.on("close", (code) => {
    state.providerAuthRuns.delete(provider);
    const authState = getProviderAuthState(provider);
    const success = code === 0 && authState.available;
  broadcast({
      type: "provider_auth_result",
      provider,
      success,
      error: success ? null : (run.output.trim().slice(-1500) || `${provider} login exited with code ${code}`),
      authState,
      durationMs: Date.now() - startedAt,
    });
  telemetry.captureEvent("mac_sidecar_provider_auth_login_finished", {
      provider,
      success,
      duration_ms: Date.now() - startedAt,
      source: authState.source,
    });
  });
}

function buildClaudeLoginEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function buildCodexLoginEnv() {
  const env = { ...process.env };
  delete env.CODEX_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_HOME;
  return env;
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+/);
  return match?.[0] || "";
}

function buildClaudeAgentEnv() {
  const env = { ...process.env };
  if (hasClaudeLocalSession()) {
    delete env.ANTHROPIC_API_KEY;
    return env;
  }
  const apiKey = readApiKey("claude");
  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }
  return env;
}

function hasClaudeLocalSession() {
  const payload = readJsonFile(path.join(os.homedir(), ".claude.json"));
  return Boolean(payload?.oauthAccount);
}

function readJsonFile(filePath) {
  try {
    if (!fsSync.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isInvalidRapt(error) {
  const msg = error instanceof Error ? error.message : String(error || "");
  const lower = msg.toLowerCase();
  return lower.includes("invalid_rapt") || lower.includes("invalid_grant");
}

// Active gws auth cancel handles keyed by rowId (only "gwsAuth" for now)
const activeAuthCancels = new Map();

const bipReadinessLocalDocRows = new Set(BIP_REQUIRED_LOCAL_DOCS.map((doc) => `local${doc.type.slice(0, 1).toUpperCase()}${doc.type.slice(1)}`));
const bipReadinessUserFacingRows = new Set([
  ...bipReadinessLocalDocRows,
  "gwsInstall",
  "gwsAuth",
  "docUrl",
  "sheetUrl",
]);

// Readiness card telemetry state (module-level, not persisted)
let bipReadinessViewedAt = null;
// Track which rows have already fired row_completed to avoid double-emit
const bipReadinessCompletedRows = new Set();

function bipReadinessTotalDoneCount(rows) {
  return rows.filter((r) => bipReadinessUserFacingRows.has(r.id) && r.status === "done").length;
}

async function handleBipReadinessAction(request) {
  const rowId = String(request.rowId || "");
  const action = String(request.action || "");
  const actionPayload = request.payload ?? {};

  function normalizeReadinessEventError(msg, error) {
    if (error == null) return msg;
    if (typeof error === "string") {
      msg.error = error;
      return msg;
    }
    msg.readinessError = error;
    msg.error = error.user_message || error.raw || "BIP 준비 상태를 확인하지 못했어요.";
    return msg;
  }

  function emitRow(id, status, detail, error, extra = {}) {
    const msg = { type: "bip_readiness_event", rowId: id, status, ...extra };
    if (detail != null) msg.detail = detail;
    normalizeReadinessEventError(msg, error);
    broadcast(msg);

    // Telemetry: row_completed (once per transition to done)
    if (status === "done" && bipReadinessUserFacingRows.has(id) && !bipReadinessCompletedRows.has(id)) {
      bipReadinessCompletedRows.add(id);
      telemetry.captureEvent("mac_bip_readiness_row_completed", { row_id: id });

      // all_complete fires when all user-facing BIP setup rows are done
      if (bipReadinessCompletedRows.size === bipReadinessUserFacingRows.size && bipReadinessViewedAt != null) {
        const total_duration_ms_from_view = Date.now() - bipReadinessViewedAt;
        telemetry.captureEvent("mac_bip_readiness_all_complete", { total_duration_ms_from_view });
        bipReadinessViewedAt = null;
        bipReadinessCompletedRows.clear();
    }
    }

    // Telemetry: row_failed
    if (status === "blocked" && error) {
      telemetry.captureEvent("mac_bip_readiness_row_failed", {
        row_id: id,
        error_kind: error.kind || "unknown",
    });
    }
  }

  async function persistConnectedBipResource(id, kind, result) {
    const previousConfig = state.bipCoach?.config ?? {};
    const resourcePatch = kind === "doc"
      ? {
          docId: result.docId,
          docUrl: result.url || (result.docId ? `https://docs.google.com/document/d/${result.docId}/edit` : ""),
        }
      : {
          sheetId: result.sheetId,
          sheetUrl: result.url || (result.sheetId ? `https://docs.google.com/spreadsheets/d/${result.sheetId}/edit` : ""),
        };
    const config = normalizeBipCoachConfig({
      ...previousConfig,
      ...resourcePatch,
    });
    state.bipCoach = normalizeBipCoachState({
      ...state.bipCoach,
      updatedAt: new Date().toISOString(),
      config,
      evidence: null,
      currentMission: null,
      lastError: null,
    });
    await persistAndBroadcastBipCoach("mac_bip_readiness_resource_connected", {
      row_id: id,
      kind,
      has_doc: Boolean(config.docId),
      has_sheet: Boolean(config.sheetId),
    });
  }

  // "*" recheck: derive and emit all 6 rows + card_viewed telemetry
  if (rowId === "*" && action === "recheck") {
    const keychainSettings = getAuthContextSummary().authenticated
      ? { macAuth: { accessToken: "present", expiresAt: null } }
      : {};
    const workspaceSettings = { hasExplicitWorkspace };
    const bipCoachConfig = state.bipCoach?.config ?? {};
    const result = deriveReadinessState({ keychainSettings, workspaceSettings, bipCoachConfig, env: process.env });
    result.rows = [
      ...deriveLocalDocReadinessRows(workspaceRoot, { bipConfig: currentBipConfig(), iddSetupState: state.iddSetup }),
      ...result.rows,
    ];
    for (const row of result.rows) {
      const msg = { type: "bip_readiness_event", ...row };
      normalizeReadinessEventError(msg, row.error);
      broadcast(msg);
    }
  const initial_completion = bipReadinessTotalDoneCount(result.rows);
    // Track view time for all_complete duration measurement
    if (bipReadinessViewedAt == null) {
      bipReadinessViewedAt = Date.now();
    }
    // Pre-populate already-done rows so we don't re-emit row_completed for them
    for (const row of result.rows) {
      if (row.status === "done" && bipReadinessUserFacingRows.has(row.id)) {
        bipReadinessCompletedRows.add(row.id);
    }
    }
  telemetry.captureEvent("mac_bip_readiness_card_viewed", { initial_completion });
    return;
  }

  // Individual row recheck
  if (action === "recheck") {
    const keychainSettings = getAuthContextSummary().authenticated
      ? { macAuth: { accessToken: "present", expiresAt: null } }
      : {};
    const workspaceSettings = { hasExplicitWorkspace };
    const bipCoachConfig = state.bipCoach?.config ?? {};
    const result = deriveReadinessState({ keychainSettings, workspaceSettings, bipCoachConfig, env: process.env });
    result.rows = [
      ...deriveLocalDocReadinessRows(workspaceRoot, { bipConfig: currentBipConfig(), iddSetupState: state.iddSetup }),
      ...result.rows,
    ];
    const row = result.rows.find((r) => r.id === rowId);
    if (row) {
      const msg = { type: "bip_readiness_event", ...row };
      normalizeReadinessEventError(msg, row.error);
      broadcast(msg);
    }
    return;
  }

  // local* document rows: start the IDD queue at this missing document.
  const localDocType = docTypeFromLocalRowId(rowId);
  if (localDocType && action === "start_idd") {
    const gate = currentBipSetupGate();
    await startIddDocumentQueue({
      gate,
      sessionId: request.sessionId,
      provider: request.provider,
      requestedDocType: localDocType,
    });
    return;
  }

  function completeGwsAuth(authStartedAt) {
    activeAuthCancels.delete("gwsAuth");
  telemetry.captureEvent("mac_bip_readiness_row_completed", {
      row_id: "gwsAuth",
      duration_ms: Date.now() - authStartedAt,
    });
    bipReadinessCompletedRows.add("gwsAuth");
    emitRow("gwsAuth", "done");
    emitRow("docUrl", "pending");
    emitRow("sheetUrl", "pending");
  }

  async function startGwsLoginFlow() {
    const existing = activeAuthCancels.get("gwsAuth");
    if (existing) existing();

  telemetry.captureEvent("mac_bip_readiness_row_started", { row_id: "gwsAuth" });
    const authStartedAt = Date.now();

    emitRow("gwsAuth", "in-progress", "저장된 Google Workspace 연결을 확인하는 중...");
    const existingAuth = await checkGwsAuthStatus({ env: process.env });
    if (existingAuth.done) {
      completeGwsAuth(authStartedAt);
      return;
    }

    const handle = startGwsAuth({
      env: process.env,
      onLog(line) {
        broadcast({
          type: "bip_readiness_event",
          rowId: "gwsAuth",
          status: "in-progress",
          detail: "브라우저 창에서 Google 로그인을 완료해주세요. 완료되면 앱이 자동으로 확인합니다.",
          log: line,
        });
      },
      onStatusChange({ status, detail, error }) {
        emitRow("gwsAuth", status, detail, error);
        if (status === "done") {
          completeGwsAuth(authStartedAt);
        } else if (status === "blocked" || status === "pending") {
          activeAuthCancels.delete("gwsAuth");
        }
      },
    });
    activeAuthCancels.set("gwsAuth", handle.cancel);
  }

  function startGwsLoginFlowSafely() {
    fireAndForget("startGwsLoginFlow", startGwsLoginFlow().catch((error) => {
      activeAuthCancels.delete("gwsAuth");
      emitRow("gwsAuth", "blocked", undefined, formatReadinessError(error));
      throw error;
    }));
  }

  // gwsInstall: install via npm
  if (rowId === "gwsInstall" && action === "install") {
    emitRow("gwsInstall", "in-progress", "이 Mac에서 gws CLI를 확인하는 중...");
    const existingGwsBin = resolveGwsBin({ env: process.env });
    if (existingGwsBin) {
      emitRow("gwsInstall", "done", `gws CLI 확인됨: ${existingGwsBin}`);
      setTimeout(() => {
        startGwsLoginFlowSafely();
      }, 900);
      return;
    }

    emitRow("gwsInstall", "in-progress", "gws CLI가 없어 npm으로 설치하는 중...");
  broadcast({
      type: "bip_readiness_event",
      rowId: "gwsInstall",
      status: "in-progress",
      detail: "npm 설치 중",
      log: "npm install -g @googleworkspace/cli",
    });
  telemetry.captureEvent("mac_bip_readiness_row_started", { row_id: "gwsInstall" });
    const installStartedAt = Date.now();
    installGws({
      env: process.env,
      onLog(line) {
        broadcast({ type: "bip_readiness_event", rowId: "gwsInstall", status: "in-progress", log: line });
      },
      onComplete({ success, error }) {
        if (success) {
          telemetry.captureEvent("mac_bip_readiness_row_completed", {
            row_id: "gwsInstall",
            duration_ms: Date.now() - installStartedAt,
          });
          bipReadinessCompletedRows.add("gwsInstall");
          const installedGwsBin = resolveGwsBin({ env: process.env });
          emitRow("gwsInstall", "done", installedGwsBin ? `설치 완료: ${installedGwsBin}` : "설치 완료. 이제 Google 연결을 확인합니다.");
          setTimeout(() => {
            startGwsLoginFlowSafely();
          }, 900);
        } else {
          emitRow("gwsInstall", "blocked", undefined, {
            user_message: error || "설치 중 오류가 발생했어요.",
            kind: "unknown",
            raw: error,
          });
        }
      },
    });
    return;
  }

  // gwsInstall: manual path override
  if (rowId === "gwsInstall" && action === "set_path") {
    const binPath = String(actionPayload.binPath || "").trim();
    if (binPath) {
      process.env.AGENTIC30_GWS_BIN = binPath;
      emitRow("gwsInstall", "done");
      emitRow("gwsAuth", "pending");
    } else {
      emitRow("gwsInstall", "blocked", undefined, { user_message: "경로가 비어 있어요.", kind: "unknown" });
    }
    return;
  }

  // gwsAuth: check existing auth first, then start login only when needed.
  if (rowId === "gwsAuth" && action === "start") {
    startGwsLoginFlowSafely();
    return;
  }

  // gwsAuth: cancel
  if (rowId === "gwsAuth" && action === "cancel") {
    const cancel = activeAuthCancels.get("gwsAuth");
    if (cancel) {
      cancel();
      activeAuthCancels.delete("gwsAuth");
    }
    return;
  }

  // docUrl / sheetUrl: validate
  if ((rowId === "docUrl" || rowId === "sheetUrl") && action === "copy_template") {
    const kind = rowId === "docUrl" ? "doc" : "sheet";
    const sourceId = kind === "doc" ? BIP_TEMPLATE_DOC_ID : BIP_TEMPLATE_SHEET_ID;
    const title = kind === "doc" ? "Agentic30 업무일지" : "Agentic30 게시글 일지";
    emitRow(rowId, "in-progress", "템플릿을 내 Drive에 복사 중");
  telemetry.captureEvent("mac_bip_readiness_row_started", { row_id: rowId, action: "copy_template" });
    const copyStartedAt = Date.now();
    const result = await copyTemplateToDrive({
      env: process.env,
      kind,
      sourceId,
    title,
      onLog(line) {
        broadcast({
          type: "bip_readiness_event",
          rowId,
          status: "in-progress",
          detail: "템플릿을 내 Drive에 복사하고 자동으로 연결합니다.",
          log: line,
        });
      },
    });
    if (result.ok) {
      await persistConnectedBipResource(rowId, kind, result);
      telemetry.captureEvent("mac_bip_readiness_row_completed", {
        row_id: rowId,
        duration_ms: Date.now() - copyStartedAt,
    });
      bipReadinessCompletedRows.add(rowId);
      emitRow(
        rowId,
        "done",
        `${result.name || title} 복사 완료 · 내 Google Drive · 공개 실행 코치에 연결됨`,
        undefined,
        {
          resourceName: result.name || title,
          resourceUrl: result.url || (kind === "doc"
            ? `https://docs.google.com/document/d/${result.docId}/edit`
            : `https://docs.google.com/spreadsheets/d/${result.sheetId}/edit`),
        },
      );
    } else {
      emitRow(rowId, "blocked", undefined, result.error);
      if (result.error?.kind === "auth_expired") {
        emitRow("gwsAuth", "pending");
    }
    }
    return;
  }

  // docUrl / sheetUrl: validate manual URL (advanced/backward-compatible path)
  if ((rowId === "docUrl" || rowId === "sheetUrl") && action === "validate") {
    const url = String(actionPayload.url || "").trim();
    const kind = rowId === "docUrl" ? "doc" : "sheet";
    emitRow(rowId, "in-progress", "권한 확인 중");
  telemetry.captureEvent("mac_bip_readiness_row_started", { row_id: rowId });
    const validateStartedAt = Date.now();
    validateUrl({ env: process.env, url, kind }).then((result) => {
      if (result.ok) {
        persistConnectedBipResource(rowId, kind, {
          ...result,
          url,
        }).then(() => {
          telemetry.captureEvent("mac_bip_readiness_row_completed", {
            row_id: rowId,
            duration_ms: Date.now() - validateStartedAt,
          });
          bipReadinessCompletedRows.add(rowId);
          emitRow(rowId, "done");
        }).catch((err) => {
          emitRow(rowId, "blocked", undefined, { user_message: formatBipCoachGwsError(err), kind: "unknown" });
        });
      } else {
        emitRow(rowId, "blocked", undefined, result.error);
        if (result.error?.kind === "auth_expired") {
          emitRow("gwsAuth", "pending");
        }
    }
    }).catch((err) => {
      emitRow(rowId, "blocked", undefined, { user_message: formatBipCoachGwsError(err), kind: "unknown" });
    });
    return;
  }

  // workspace: change (app already opened NSOpenPanel, just update local tracking)
  if (rowId === "workspace" && action === "change") {
    const newPath = String(actionPayload.path || "").trim();
    if (newPath) {
      emitRow("workspace", "done", newPath);
    }
    return;
  }

  // gwsAuth: recheck without starting login
  if (rowId === "gwsAuth" && action === "recheck") {
    checkGwsAuthStatus({ env: process.env }).then(({ done, error }) => {
      emitRow("gwsAuth", done ? "done" : "blocked", undefined, done ? undefined : error);
      if (done) {
        emitRow("docUrl", "pending");
        emitRow("sheetUrl", "pending");
    }
    }).catch(() => {});
    return;
  }
}
