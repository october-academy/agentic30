import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  appendProofLedgerEvent,
  captureExecutionOsTelemetryEvents,
  composeExecutionOsSnapshot,
  loadProofLedger,
} from "./execution-os.mjs";
import {
  buildOfficeHoursDocsPrompt,
  buildOfficeHoursDocsSystemPrompt,
} from "./office-hours-docs-prompt.mjs";
import {
  buildOfficeHoursChatPrompt,
  buildOfficeHoursChatSystemPrompt,
  clampOfficeHoursContext,
  isOfficeHoursLockedDay1GoalContext,
  isOfficeHoursWriteDesignDocContext,
} from "./office-hours-chat-prompt.mjs";
import {
  OfficeHoursSourceGateError,
  buildExternalOfficeHoursDigestPrompt,
  collectLocalDailyOfficeHoursSignals,
  evaluateOfficeHoursSourceGate,
  finalizeDailyOfficeHoursDigest,
  formatDailyOfficeHoursDigestForPrompt,
  normalizeExternalOfficeHoursDigest,
  normalizeOfficeHoursSelectedSources,
  persistDailyOfficeHoursDigest,
  selectedExternalOfficeHoursSources,
} from "./daily-office-hours-digest.mjs";
import {
  applyMorningBriefingLiveSync,
  buildMorningBriefing,
  labelMorningBriefingAnomaly,
  loadMorningBriefingStore,
  persistMorningBriefing,
  updatePersistedMorningBriefing,
} from "./morning-briefing.mjs";
import {
  buildMorningBriefingExternalDigestPrompt,
  collectGithubDrilldown,
  normalizeMorningBriefingExternalDigest,
  salvageMorningBriefingExternalDigest,
} from "./morning-briefing-drilldown.mjs";
import { createMorningBriefingProgressTracker } from "./morning-briefing-progress.mjs";
import {
  cloudflareSourceSignalFromDrilldown,
  collectCloudflareDirectDrilldown,
  collectPosthogDirectDrilldown,
  mergeMorningBriefingDrilldownMaps,
} from "./morning-briefing-direct-sources.mjs";
import {
  collectIntegrationStatus,
  mergeMcpOauthConnectResultIntoIntegrationStatus,
} from "./integration-status.mjs";
import {
  isProviderUsageLimitMessage,
  normalizeMcpOauthPrewarmServer,
  parseMcpOauthConnectResult,
  parseMcpOauthConnectStatus,
  prewarmMcpOauth,
  resolveMcpOauthConnectProvider,
} from "./mcp-oauth-prewarm.mjs";
import { persistMcpOauthConnectResult } from "./mcp-oauth-state.mjs";
import {
  appendMcpOauthTrace,
  createMcpOauthTraceId,
  readRecentMcpOauthTraces,
} from "./mcp-oauth-trace.mjs";
import {
  buildQmdGuidance,
  buildQmdMcpConfig,
  getQmdState,
} from "./qmd-support.mjs";
import {
  buildPostHogClaudeMcpConfigFromSources,
  resolvePostHogMcpSettings,
} from "./posthog-mcp-config.mjs";
import { resolveCloudflareMcpSettings } from "./cloudflare-mcp-config.mjs";
import {
  collectActiveUserSnapshot,
  latestFirstValueSignal,
} from "./active-users-snapshot.mjs";
import { createTelemetryClient } from "./telemetry.mjs";
import { reportError, setTelemetryClient as setSharedTelemetryClient, swallow } from "./error-telemetry.mjs";
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
import {
  WORK_HISTORY_REFRESH_INTERVAL_MS,
  loadWorkHistorySnapshot,
  refreshWorkHistory,
  computeWorkHistoryFingerprint,
} from "./work-history.mjs";
import { buildDay1SituationSummary } from "./generate-day1-situation-summary.mjs";
import { extractWorkspaceEvidence } from "./workspace-signal-extractor.mjs";
import {
  buildWorkspaceScanAgentPrompt,
  buildWorkspaceScanEvidenceBundle,
  normalizeWorkspaceScanSemanticOutput,
  summarizeWorkspaceScanLocalFindings,
} from "./workspace-scan-evidence-bundle.mjs";
import { isSecretPath, redactSecrets } from "./workspace-safety.mjs";
import { ensureAgentic30Gitignored } from "./workspace-gitignore.mjs";
import {
  formatProjectContextForPrompt,
  loadProjectContextCache,
  refreshProjectContextCache,
} from "./project-context-cache.mjs";
import { projectDocCandidatePaths, projectDocPath } from "./project-doc-paths.mjs";
import {
  buildDay1GoalProjectContext,
  loadDay1GoalSelection,
  saveDay1GoalSelection,
} from "./day1-goal-state.mjs";
import {
  computeDayNumber,
  ensureChallengeStart,
  loadDayProgress,
  patchDayStep,
  setDayActiveStep,
} from "./day-progress-state.mjs";
import {
  buildGateBlockedMessage,
  evaluateDayProgressPatchGate,
  loadGateLedger,
  recordMissionSubstitution,
  resolveActiveGate,
  resolveDueSubstitutions,
  resolveProgramPhase,
} from "./program-gate-engine.mjs";
import { judgeActionEvidence } from "./action-evidence-judge.mjs";
import { buildMissionCardEvent } from "./mission-card.mjs";
import {
  buildInterventionContextBlock,
  buildInterventionRequiredEvent,
  interventionTriggerForGate,
  issueInterventionTokenForCommitment,
} from "./oh-intervention.mjs";
import { resolveInterventionPrompt } from "./oh-intervention-prompts.mjs";
import {
  isNewCommitmentBlockedByAr17,
  labelAdaptiveRuleEvent,
  runAdaptiveRulesCycle,
} from "./adaptive-rules.mjs";

// §13.4: intervention 세션이 열렸을 때 어느 gate의 통과 토큰을 기다리는지
// 워크스페이스별로 기억한다(in-memory — 재시작 시 founder가 intervention을
// 다시 트리거하면 된다; 영속 산출물은 gate-ledger의 토큰뿐).
const pendingInterventionGates = new Map();
import {
  abandonCommitment,
  appendCommitment,
  appendCycle,
  appendPrediction,
  appendTimeline,
  buildEvidenceOS,
  buildPriorCycle,
  buildDayReviews,
  carryForwardCommitment,
  classifyInterviewGate,
  formatPriorCycleOpening,
  gradeCommitment,
  gradePrediction,
  latestUnresolvedPrediction,
  loadOfficeHoursMemory,
  recompileCompiledTruth,
  summarizeOfficeHoursMemory,
} from "./office-hours-memory.mjs";
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
  resolveClaudeCodeEntrypoint,
  resolveCodexBinaryPath,
  resolveCodexModel,
  resolveGeminiModel,
  getProviderAuthState,
  getProviderConnectionState,
  getProviderScanReadiness,
  isProviderAuthRequiredError,
  isProviderUsageLimitError,
  OFFICE_HOURS_QUESTION_EXECUTION_MODE,
  runProviderStream,
  updateProviderSettings,
} from "./provider-runner.mjs";
import { runWithSoftTimeout } from "./frontier-soft-timeout.mjs";
import { PROVIDER_FALLBACK_CYCLE, selectNextScanProvider, selectScanProviderTargets } from "./scan-provider-select.mjs";
import { workspaceScanBlockedLogLevel } from "./workspace-scan-telemetry.mjs";
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
import {
  buildOfficeHoursEvidenceState,
  officeHoursEvidenceHasHardEvidence,
} from "./office-hours-evidence-state.mjs";
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
  discoverExaMcpRoutes,
  redactExaResearchRoute,
  resolveExaResearchRoutes,
} from "./exa-mcp-discovery.mjs";
import {
  appendOfficeHoursTurn,
  buildOfficeHoursHistorySummary,
  formatOfficeHoursHistoryForPrompt,
  loadOfficeHoursTurnLog,
  loadOnboardingMemory,
  refreshDayMemory,
  reviseOfficeHoursTurn,
  saveOnboardingMemory,
} from "./workspace-memory.mjs";
import { emitInlineHintTriggerForFeatureAppearance } from "./curriculum-hint-eligibility.mjs";
import {
  CODEX_STRUCTURED_INPUT_TOOL,
} from "./structured-input-tools.mjs";
import {
  buildOfficeHoursInterviewAnswerLogAttributes,
  buildOfficeHoursIncompleteInterviewMessage,
  buildOfficeHoursInlineStructuredPromptPayload,
  buildOfficeHoursStructuredQuestionTranscriptText,
  buildOfficeHoursStructuredInputContinuationPrompt,
  countOfficeHoursTurnsForSession,
  extractOfficeHoursChatEmphasis,
  formatSelectedOptionEvidenceHint,
  hasOfficeHoursTerminalTurnForSession,
  isOfficeHoursStructuredInputMode,
  isOfficeHoursStructuredInputToolEvent,
  isOfficeHoursTerminalAlternativesRequest,
  parseExpectedOfficeHoursQuestionCount,
  prepareOfficeHoursStructuredInputRequest,
  OFFICE_HOURS_EMPHASIS_SENTINEL_END,
  OFFICE_HOURS_EMPHASIS_SENTINEL_START,
  shouldAppendOfficeHoursStructuredQuestionMessage,
  stripTrailingRubricFocusMetadata,
} from "./office-hours-structured-input.mjs";
import {
  OFFICE_HOURS_STATUS_COPY,
  selectOfficeHoursStatusCopy,
} from "./office-hours-status.mjs";
import {
  buildOfficeHoursResumePreamble,
  countOfficeHoursResumeTurnsFromOtherSessions,
  dedupeOfficeHoursTurnsKeepLast,
  hasOfficeHoursTerminalResumeTurn,
  isCompletedOfficeHoursSnapshotDay,
  isPastOfficeHoursSnapshotDay,
  selectOfficeHoursResumeTurns,
  selectOfficeHoursSnapshotTurns,
  shouldSeedOfficeHoursResumeTranscript,
  stripOfficeHoursResumePreambleBlocks,
} from "./office-hours-resume.mjs";
import {
  buildOfficeHoursCommitmentCandidatesPrompt,
  mergeCommitmentCandidates,
  parseOfficeHoursCommitmentCandidates,
} from "./office-hours-commitment-suggest.mjs";
import {
  clearUserInputArtifacts,
  createUserInputRequest,
  deleteUserInputArtifacts,
  ensureUserInputDirs,
  getUserInputPaths,
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
// gpt-5.1-codex-mini는 ChatGPT 인증 Codex 서버 카탈로그에서 제거돼 400 거부됨.
// 동급 저비용 모델인 gpt-5.4-mini로 대체 (2026-06-10 `codex debug models` 기준).
const WORKSPACE_SCAN_CODEX_MODEL = "gpt-5.4-mini";
const WORKSPACE_SCAN_GEMINI_MODEL = "gemini-3.5-flash";
const DAY1_CHOICE_CLAUDE_MODEL = process.env.AGENTIC30_DAY1_CHOICE_CLAUDE_MODEL || "claude-opus-4-8";
const DAY1_CHOICE_CODEX_MODEL = process.env.AGENTIC30_DAY1_CHOICE_CODEX_MODEL || "gpt-5.5";
const DAY1_CHOICE_GEMINI_MODEL = process.env.AGENTIC30_DAY1_CHOICE_GEMINI_MODEL || "gemini-3.5-flash";
const DAY1_CHOICE_CURSOR_MODEL = process.env.AGENTIC30_DAY1_CHOICE_CURSOR_MODEL || "composer-2.5";
const DAY1_CHOICE_PROVIDER_TIMEOUT_MS = 45_000;
// Provider→model maps for the agent-backed workspace scan and Day 1 alignment
// synthesis. selectScanProviderTargets() narrows these to the single provider
// the user picked in settings (preferredProvider), falling back to the full set
// only when no settings provider is supplied.
const WORKSPACE_SCAN_MODEL_BY_PROVIDER = {
  claude: WORKSPACE_SCAN_CLAUDE_MODEL,
  codex: WORKSPACE_SCAN_CODEX_MODEL,
  gemini: WORKSPACE_SCAN_GEMINI_MODEL,
};
// Workspace scan agent wall-clock bounds. ABORT asks the provider SDK to stop;
// HARD_DEADLINE force-returns the scan even if the SDK ignores the abort, so a
// stuck provider run can never hang the Day-1 scan UI for several minutes.
// The defaults still need enough room for real Codex CLI scans on this repo;
// override via env for unusually slow machines / very large repos.
const WORKSPACE_SCAN_AGENT_ABORT_MS = Number.parseInt(
  process.env.AGENTIC30_WORKSPACE_SCAN_ABORT_MS || "",
  10,
) || 120_000;
const WORKSPACE_SCAN_AGENT_HARD_DEADLINE_MS = Number.parseInt(
  process.env.AGENTIC30_WORKSPACE_SCAN_HARD_DEADLINE_MS || "",
  10,
) || 150_000;
const DAY1_CHOICE_MODEL_BY_PROVIDER = {
  claude: DAY1_CHOICE_CLAUDE_MODEL,
  codex: DAY1_CHOICE_CODEX_MODEL,
  gemini: DAY1_CHOICE_GEMINI_MODEL,
  cursor: DAY1_CHOICE_CURSOR_MODEL,
};
const CHAT_BIP_CONTEXT_MAX_CHARS = 60000;
const CHAT_BIP_LOCAL_DOC_MAX_CHARS = 12000;
const CHAT_BIP_EXTERNAL_DOC_MAX_CHARS = 12000;
const CHAT_BIP_SHEET_MAX_ROWS = 25;
const CHAT_BIP_EXTERNAL_CACHE_TTL_MS = 5 * 60 * 1000;
const INSTANT_CHAT_COMPLETE_SLO_MS = 1_000;
const NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS = normalizeNewsMarketRadarProviderTimeout(
  process.env.AGENTIC30_NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS,
);
const MARKET_RESEARCH_PROVIDER_MCP_CONCURRENCY = boundedIntegerEnv(
  process.env.AGENTIC30_MARKET_RESEARCH_PROVIDER_MCP_CONCURRENCY,
  2,
  1,
  8,
);
const CODEX_EXA_MCP_TOOL_TIMEOUT_SEC = boundedIntegerEnv(
  process.env.AGENTIC30_CODEX_EXA_MCP_TOOL_TIMEOUT_SEC,
  90,
  15,
  Math.max(15, Math.min(210, Math.floor(NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS / 1000) - 5)),
);
const runWithMarketResearchProviderBudget = createAsyncSemaphore(MARKET_RESEARCH_PROVIDER_MCP_CONCURRENCY);
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
  mcpOauthConnectRuns: new Map(),
  integrationStatusSnapshot: null,
  promptQueues: new Map(),
  clients: new Set(),
  resolvedUserInputIds: new Set(),
  sessionStoreWarnings: [],
  bipCoach: null,
  iddSetup: null,
  bipCoachRunning: false,
  day1GoalSelection: null,
  dayProgress: null,
  providerAuthRuns: new Map(),
  workspaceOnboardingHypothesis: null,
  curriculumInlineHintState: {},
  newsMarketRadarRefreshPromise: null,
  newsMarketRadarProgress: null,
  newsMarketRadarProgressStartedAt: null,
  bipResearchRefreshPromise: null,
  bipResearchProgress: null,
  bipResearchProgressStartedAt: null,
  workHistoryRefreshPromise: null,
  workHistoryProgress: null,
  workHistoryProgressStartedAt: null,
  morningBriefingRefreshPromise: null,
  userInputRequestWatcher: null,
  // 수집 중 카드별 라이브 진행(스피너+에이전트 로그). 서빙 전용, persist 금지.
  morningBriefingProgressTracker: null,
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

const telemetry = createTelemetryClient({ appSupportPath, workspaceRoot });
setSharedTelemetryClient(telemetry);
let fatalSidecarWriteInProgress = false;
let fatalSidecarHandlersInstalled = false;
installFatalSidecarErrorHandlers();

try {
  await fs.mkdir(appSupportPath, { recursive: true });
  if (process.env.AGENTIC30_TEST_BOOTSTRAP_FAILURE === "1") {
    throw new Error("Synthetic bootstrap failure for sidecar resilience test");
  }
  await ensureUserInputDirs(appSupportPath);
  await clearUserInputArtifacts(appSupportPath);
  await loadSessions();
  state.bipCoach = mergeBipConfigIntoCoachState(
    await loadBipCoachState(bipCoachFilePath),
    currentBipConfig(),
  );
  state.bipCoach = syncBipCoachSessionState();
  state.iddSetup = await loadIddSetupState(workspaceRoot);
  state.day1GoalSelection = await loadDay1GoalSelection({ workspaceRoot });
  state.dayProgress = await loadDayProgress({ workspaceRoot });
  await persistBipCoachState(bipCoachFilePath, state.bipCoach);
} catch (error) {
  const properties = {
    operation: "sidecar_bootstrap",
    ...errorTelemetryProperties(error),
  };
  captureSidecarLog("sidecar bootstrap failed", "error", properties);
  try {
    telemetry.captureException(error, { operation: "sidecar_bootstrap" }, false);
  } catch {
    // Telemetry must never mask the bootstrap failure itself.
  }
  writeSidecarCrashRecord("sidecar_bootstrap", error, properties);
  await new Promise((resolve) => setTimeout(resolve, 25));
  process.exit(1);
}

function fireAndForget(operation, promise, properties = {}) {
  Promise.resolve(promise).catch((error) => {
    const logProperties = {
      operation,
      ...properties,
      ...errorTelemetryProperties(error),
    };
    try {
      telemetry.captureException(error, {
        operation,
        ...properties,
      });
    } catch {
      // Telemetry must never prevent local crash breadcrumbs.
    }
    captureSidecarLog("sidecar background task failed", "error", logProperties);
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

function installFatalSidecarErrorHandlers() {
  if (fatalSidecarHandlersInstalled) return;
  fatalSidecarHandlersInstalled = true;
  process.on("uncaughtException", (error) => {
    handleFatalSidecarError("uncaughtException", error);
  });
  process.on("unhandledRejection", (reason) => {
    handleFatalSidecarError("unhandledRejection", reason);
  });
}
// Replay pending ritual after telemetry client exists. broadcast() may run
// even before any client connects — that's fine, the persisted pendingRitual
// stays until ack so reconnects also see it.
queueMicrotask(() => {
  try { replayPendingRitualOnBoot(); } catch { /* boot best-effort */ }
});

async function handleWeeklyRitualAck(payload) {
  const day = typeof payload?.day === "number" ? payload.day : undefined;
  state.bipCoach = acknowledgePendingRitual(state.bipCoach, { day });
  await persistBipCoachState(bipCoachFilePath, state.bipCoach);
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

let userInputSyncScheduled = false;
function schedulePendingUserInputSync(reason = "requested") {
  if (userInputSyncScheduled) return;
  userInputSyncScheduled = true;
  const timeout = setTimeout(() => {
    userInputSyncScheduled = false;
    fireAndForget(`syncPendingUserInputRequests:${reason}`, syncPendingUserInputRequests());
  }, 10);
  timeout.unref?.();
}

function startUserInputRequestWatcher() {
  const { requestsDir } = getUserInputPaths(appSupportPath);
  try {
    const watcher = fsSync.watch(requestsDir, { persistent: false }, () => {
      schedulePendingUserInputSync("fs_watch");
    });
    watcher.on?.("error", (error) => {
      telemetry.captureException(error, { operation: "user_input_request_watch" });
    });
    return watcher;
  } catch (error) {
    telemetry.captureException(error, { operation: "user_input_request_watch_start" });
    return null;
  }
}
telemetry.captureEvent("mac_sidecar_booted", {
  session_count: state.sessions.size,
});
fireAndForget("refreshPersistedBipCoachReadinessOnBoot", refreshPersistedBipCoachReadinessOnBoot());
const userInputPoll = setInterval(() => {
  fireAndForget("syncPendingUserInputRequests", syncPendingUserInputRequests());
}, 250);
state.userInputRequestWatcher = startUserInputRequestWatcher();
// History tab: hourly low-frequency background reindex (interview round 32).
// Tab-entry catch-up and the manual button arrive via work_history_get/refresh.
const workHistoryPoll = setInterval(() => {
  fireAndForget(
    "workHistoryHourlyRefresh",
    Promise.resolve(scheduleWorkHistoryRefresh({
      reason: "background",
      preferredProvider: state.bipCoach?.config?.provider || "",
    })),
  );
}, WORK_HISTORY_REFRESH_INTERVAL_MS);
workHistoryPoll.unref?.();

// Mid-challenge workspaces never re-scan, but day-progress/memory writers keep
// touching `.agentic30/` — backfill the gitignore guard once per daemon start.
// `onlyIfAgentic30Exists` keeps untouched workspaces' `.gitignore` unmodified.
fireAndForget(
  "workspace_gitignore_startup",
  ensureAgentic30Gitignored({ workspaceRoot, onlyIfAgentic30Exists: true }).then((result) => {
    if (result.status === "added") {
      telemetry.captureEvent("mac_sidecar_workspace_gitignore_added", { scan_root: workspaceRoot });
    } else if (result.status === "error") {
      telemetry.captureException(new Error(result.error), {
        operation: "workspace_gitignore_startup",
      });
    }
  }),
);

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
    day1GoalSelection: state.day1GoalSelection,
    dayProgress: state.dayProgress,
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
      const provider = providerForClientPayload(payload);
      const captureProps = {
        operation: "handleClientMessage",
        session_id: payload?.sessionId || "",
        message_type: payload?.type || "unknown",
        ...(provider ? { provider } : {}),
      };
      const errorKind = providerRecoverableErrorKind(error);
      if (errorKind) {
        reportProviderRunError(error, captureProps);
      } else {
        telemetry.captureException(error, captureProps);
      }
      send(socket, {
        type: "error",
        sessionId: payload?.sessionId,
        ...(provider ? { provider } : {}),
        message: formatError(error),
        ...providerRecoverableErrorEnvelope(errorKind),
      });
    }
  });
}

function providerForClientPayload(payload = {}) {
  const direct = String(payload?.provider || payload?.preferredProvider || "").trim();
  if (direct) return direct;
  const sessionId = String(payload?.sessionId || "").trim();
  if (!sessionId) return "";
  return String(state.sessions.get(sessionId)?.provider || "").trim();
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
  clearInterval(workHistoryPoll);
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

async function broadcastOfficeHoursStartNoop(session) {
  await syncPendingUserInputRequests();
  broadcast({ type: "session_updated", session: state.sessions.get(session.id) || session });
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
    case "update_session_provider": {
      const session = getSession(payload.sessionId);
      const nextProvider = normalizeSessionProvider(payload.provider);
      if (session.provider !== nextProvider) {
        await stopSession(session.id);
        cancelWarmSession(session.id);
        session.provider = nextProvider;
        // Provider changed: drop the now-invalid model so the runner resolves
        // the new provider's default (mirrors index.mjs provider!==resolved -> "").
        session.model = "";
        session.status = "idle";
        session.error = null;
        touch(session);
        await persistSessions();
        telemetry.captureEvent("mac_sidecar_session_provider_changed", {
          session_id: session.id,
          provider: nextProvider,
        });
        broadcast({ type: "session_updated", session });
      }
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
      fireAndForget("warmSession", warmSession(session, payload), {
        session_id: session.id,
        provider: session.provider,
        purpose: normalizeWarmSessionPurpose(payload.purpose) || "",
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
    case "office_hours_start": {
      const session = getSession(payload.sessionId);
      if (state.activeRuns.has(session.id)) {
        await broadcastOfficeHoursStartNoop(session);
        return;
      }
      if (session.pendingUserInput) {
        if (isOfficeHoursStructuredInputMode(session.pendingUserInput?.generation?.mode)) {
          await broadcastOfficeHoursStartNoop(session);
          return;
        }
        throw new Error("This session is waiting for structured input.");
      }
      if (session.runtime?.officeHours?.active === true && !session.error) {
        await broadcastOfficeHoursStartNoop(session);
        return;
      }
      const context = String(payload.context || "").trim();
      const visiblePrompt = String(payload.visiblePrompt || "Office Hours").trim() || "Office Hours";
      const day = normalizeOfficeHoursDay(payload.day ?? payload.officeHoursDay ?? session.runtime?.officeHours?.day);
      // §13.1 (additive): an intervention-framed start carries payload.trigger.
      // Unregistered triggers are ignored (fail-closed §13.3 — the session runs
      // as a normal Office Hours without the intervention contract).
      const interventionTriggerId = String(payload.trigger || "").trim();
      const interventionPack = interventionTriggerId
        ? resolveInterventionPrompt(interventionTriggerId)
        : null;
      const interventionContext = interventionPack
        ? buildInterventionContextBlock(interventionTriggerId, { abbreviated: interventionPack.abbreviated })
        : "";
      if (interventionPack?.gateId) {
        // §13.4: remember which gate this session is expected to unlock — the
        // commitment confirm patch issues the pass-through token from this.
        pendingInterventionGates.set(path.resolve(workspaceRoot), {
          gateId: interventionPack.gateId,
          triggerId: interventionPack.triggerId,
          sessionId: session.id,
          createdAt: new Date().toISOString(),
        });
      }
      markWorkspaceSetupFirstInput("office_hours_start");
      if (state.activeRuns.has(session.id)) {
        await broadcastOfficeHoursStartNoop(session);
        return;
      }
      cancelWarmSession(session.id);
      await runOfficeHours(session, {
        context: [context, interventionContext].filter(Boolean).join("\n\n"),
        originalPrompt: visiblePrompt,
        source: payload.source || "manual",
        day,
        selectedSources: payload.selectedSources,
      });
      return;
    }
    case "office_hours_revise_answer": {
      const session = getSession(payload.sessionId);
      const requestId = String(payload.requestId || "").trim();
      if (!requestId) {
        throw new Error("Office Hours answer revision requires requestId.");
      }
      if (session.runtime?.officeHours?.active !== true) {
        throw new Error("This session is not an active Office Hours interview.");
      }
      const promptRequest = prepareOfficeHoursStructuredInputRequest(payload.prompt || {});
      if (!promptRequest?.requestId || !Array.isArray(promptRequest.questions)) {
        throw new Error("Office Hours answer revision requires the original prompt snapshot.");
      }
      if (promptRequest.requestId !== requestId) {
        throw new Error("Office Hours answer revision requestId does not match the prompt snapshot.");
      }
      if (session.pendingUserInput?.requestId) {
        await deleteUserInputArtifacts(appSupportPath, session.id, session.pendingUserInput.requestId).catch(() => {});
        state.resolvedUserInputIds.add(session.pendingUserInput.requestId);
      }
      if (state.activeRuns.has(session.id)) {
        await stopSession(session.id);
      }
      state.promptQueues.delete(session.id);
      cancelWarmSession(session.id);

      const response = normalizeUserInputResponse(promptRequest, payload);
      const userResponseText = formatStructuredPromptResponse(response);
      if (!userResponseText) {
        throw new Error("Office Hours answer revision requires a non-empty answer.");
      }
      const userResponseDescription = collectSelectedOptionDescriptions(promptRequest, response);
      const officeHoursStructuredQuestionText = buildOfficeHoursStructuredQuestionTranscriptText(promptRequest);
      const officeHoursTerminalAnswered = isOfficeHoursTerminalAlternativesRequest(promptRequest);
      const answeredGeneration = promptRequest.generation || null;
      const runtimeDay = normalizeOfficeHoursDay(session.runtime?.officeHours?.day);
      const source = String(session.runtime?.officeHours?.source || "office_hours_revision");
      const context = activeOfficeHoursContext(session);

      const revision = await reviseOfficeHoursTurn({
        workspaceRoot,
        requestId,
        replacementTurn: {
          day: runtimeDay,
          sessionId: session.id,
          requestId,
          mode: answeredGeneration?.mode || "office_hours_structured_input",
          signalId: answeredGeneration?.signalId || "",
          signalLabel: answeredGeneration?.signalLabel || "",
          questionText: officeHoursStructuredQuestionText,
          responseText: userResponseText,
          responseDescription: userResponseDescription,
          promptSnapshot: promptRequest,
          submissions: response.responses,
          ...(officeHoursTerminalAnswered ? { terminal: true } : {}),
        },
      });

      session.messages = [];
      session.pendingUserInput = null;
      if (session.runtime?.officeHours) {
        const {
          terminalAnswered,
          completedByExpectedCount,
          completedQuestionCount,
          ...officeHours
        } = session.runtime.officeHours;
        session.runtime.officeHours = {
          ...officeHours,
          active: true,
        };
      }
      refreshOfficeHoursRuntimePromptSnapshotsFromTurns(session, revision.payload.turns);
      session.status = "idle";
      session.error = null;
      touch(session);
      await persistSessions();
      broadcast({ type: "session_updated", session });
      emitOfficeHoursStatus(session, {
        stage: "provider_thinking",
        progressText: "수정한 답변 기준으로 다음 질문을 다시 준비 중",
        requestId,
      });
      telemetry.captureEvent("mac_sidecar_office_hours_answer_revised", {
        session_id: session.id,
        provider: session.provider,
        request_id: requestId,
        day: runtimeDay || 0,
        removed_turns: revision.removedTurns.length,
      });
      await runOfficeHours(session, {
        context,
        originalPrompt: "Office Hours",
        source,
        day: runtimeDay,
      });
      return;
    }
    case "office_hours_source_gate_get": {
      const session = payload.sessionId ? getSession(payload.sessionId) : null;
      const day = normalizeOfficeHoursDay(payload.day ?? payload.officeHoursDay ?? session?.runtime?.officeHours?.day);
      const provider = String(session?.provider || payload.provider || "").trim();
      const gate = await evaluateOfficeHoursSourceGate({
        workspaceRoot,
        day,
        selectedSources: payload.selectedSources,
        provider,
        appSupportPath,
      });
      sendOfficeHoursSourceGate(socket, {
        sessionId: session?.id || payload.sessionId || null,
        gate,
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
      const pendingUserInput = session.pendingUserInput;
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
      const response = normalizeUserInputResponse(pendingUserInput, payload);
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
        pendingUserInput,
        response,
      );
      // Capture signalId/signalLabel from the structured input the user is
      // answering so the transcript entry can carry rubric-dimension lineage
      // for the next follow-up's dimension-transition stamp (F6).
      const answeredGeneration = pendingUserInput?.generation || null;
      const answeredSignalId = answeredGeneration?.signalId ? String(answeredGeneration.signalId) : null;
      const answeredSignalLabel = answeredGeneration?.signalLabel ? String(answeredGeneration.signalLabel) : null;
      const isOfficeHoursStructuredInputResponse = isOfficeHoursStructuredInputMode(
        answeredGeneration?.mode,
      );
      const officeHoursStructuredQuestionText = isOfficeHoursStructuredInputResponse
        ? buildOfficeHoursStructuredQuestionTranscriptText(pendingUserInput)
        : "";
      broadcastIddSubmitProgress("accepted", "답변 저장됨");
      if (userResponseText) {
        markWorkspaceSetupFirstInput("structured_input");
    }
      if (userResponseText) {
        if (isOfficeHoursStructuredInputResponse
            && shouldAppendOfficeHoursStructuredQuestionMessage(
              session.messages,
              officeHoursStructuredQuestionText,
            )) {
          session.messages.push(
            makeMessage({
              role: "assistant",
              provider: session.provider,
              content: officeHoursStructuredQuestionText,
              state: "final",
            }),
          );
        }
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
      const hasNonBlockingOfficeHoursCardRun = hasActiveRun
        && isCodexOfficeHoursNonBlockingPendingInput(session, pendingUserInput);
      const hasBlockingActiveRun = hasActiveRun && !hasNonBlockingOfficeHoursCardRun;
      // Record the turn BEFORE writing the response file: that write resumes a
      // blocked Claude run, and detectIncompleteOfficeHoursInterview counts
      // these turns when that run concludes — the final answer must be durable
      // before the run can race ahead to its conclusion.
      let officeHoursProgressAfterAnswer = null;
      if (isOfficeHoursStructuredInputResponse && userResponseText) {
        // Answering the 대안 비교 closing card IS interview completion: the
        // prompt smart-skips routed questions, so a finished interview can
        // hold fewer answers than the Mac client's expected count. Stamp the
        // signal on the turn (durable, retry-safe) and on the live session
        // runtime (broadcast to the Mac client, which gates the commitment
        // bar on it) so the incomplete-interview detector and the UI both
        // treat this as a conclusion, not an early stop.
        const officeHoursTerminalAnswered = isOfficeHoursTerminalAlternativesRequest(pendingUserInput);
        if (officeHoursTerminalAnswered && session.runtime?.officeHours) {
          session.runtime.officeHours.terminalAnswered = true;
        }
        captureSidecarLog(
          "office_hours_interview_answer_submitted",
          "info",
          buildOfficeHoursInterviewAnswerLogAttributes({
            session,
            pendingUserInput,
            response,
            responseText: userResponseText,
            responseDescription: userResponseDescription,
            terminal: officeHoursTerminalAnswered,
          }),
        );
        await appendOfficeHoursTurn({
          workspaceRoot,
          turn: {
            day: normalizeOfficeHoursDay(session.runtime?.officeHours?.day),
            sessionId: session.id,
            requestId,
            mode: answeredGeneration?.mode || "office_hours_structured_input",
            signalId: answeredGeneration?.signalId || "",
            signalLabel: answeredGeneration?.signalLabel || "",
            questionText: officeHoursStructuredQuestionText,
            responseText: userResponseText,
            responseDescription: userResponseDescription,
            promptSnapshot: pendingUserInput,
            submissions: response.responses,
            ...(officeHoursTerminalAnswered ? { terminal: true } : {}),
          },
        }).catch((error) => {
          telemetry.captureException(error, {
            operation: "office_hours_turn_append",
            session_id: session.id,
          });
        });
        await refreshOfficeHoursRuntimePromptSnapshots(session).catch((error) => {
          reportError(error, {
            operation: "office_hours_prompt_snapshot_refresh",
            session_id: session.id,
            provider: session.provider,
            request_id: requestId,
            day: normalizeOfficeHoursDay(session.runtime?.officeHours?.day) || 0,
          });
        });
        officeHoursProgressAfterAnswer = await getOfficeHoursQuestionProgress(session, {
          currentRequestId: requestId,
        });
        stampOfficeHoursExpectedCountCompletion(session, officeHoursProgressAfterAnswer);
      }
      await writeUserInputResponse(appSupportPath, {
        sessionId: session.id,
        requestId,
        response,
      });
      if (!hasBlockingActiveRun) {
        await deleteUserInputArtifacts(appSupportPath, session.id, requestId);
      }

      state.resolvedUserInputIds.add(requestId);
      session.pendingUserInput = null;
      const officeHoursQuestionCapReached = Boolean(officeHoursProgressAfterAnswer?.capReached);
      session.status = officeHoursQuestionCapReached
        ? "idle"
        : hasBlockingActiveRun || Boolean(iddContinuationPromptForRun) ? "running" : "idle";
      if (officeHoursQuestionCapReached) {
        session.error = null;
        await abortActiveOfficeHoursRunAtQuestionCap(session);
      }
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

          // GATE-02: the single-doc path must honor the same hard-evidence bar
          // as the bulk write_all path. Without this, the two entry points that
          // write the same canonical docs have different safety guarantees.
          const perDocEvidence = await buildOfficeHoursEvidenceState({
            workspaceRoot,
            day1Handoff: session.runtime?.day1Handoff || {},
          }).catch(() => null);
          // Fail closed: a build failure (null) or missing hard evidence both
          // block the save, matching the bulk write_all path's safety bar.
          if (!perDocEvidence || !officeHoursEvidenceHasHardEvidence(perDocEvidence)) {
            broadcastIddSubmitProgress("blocked", "하드 증거가 없어 단일 문서 저장을 보류", completedDoc.type);
            session.messages.push(makeMessage({
              role: "assistant",
              provider: session.provider,
              content: `${completedDoc.title} 저장을 보류했습니다. 결제·계약·완료 행동 같은 하드 증거가 evidence에 있어야 정식 문서로 승격됩니다.`,
              state: "final",
            }));
            session.status = "idle";
            session.error = null;
            session.runtime = { ...(session.runtime || {}), day1HandoffFollowupCount: 0 };
            await persistSessions();
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
              content: "초기 설정 미리보기가 준비됐습니다. 문서 4개를 확인하고 승인하면 Day 1 미션을 열 수 있습니다.",
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
      const hasSelectedStructuredOption = response.responses?.some((entry) => entry.selectedOptions?.length);
      if (officeHoursQuestionCapReached) {
        emitOfficeHoursQuestionCapCompleted(session, officeHoursProgressAfterAnswer, requestId);
        broadcast({ type: "session_updated", session });
        return;
      }
      const shouldRunOfficeHoursContinuation = !hasActiveRun
        && isOfficeHoursStructuredInputResponse
        && Boolean(userResponseText);
      const shouldQueueOfficeHoursContinuation = hasNonBlockingOfficeHoursCardRun
        && isOfficeHoursStructuredInputResponse
        && Boolean(userResponseText);
      if (shouldQueueOfficeHoursContinuation) {
        enqueueSilentPrompt(
          session,
          buildOfficeHoursStructuredInputContinuationPrompt({
            responseText: userResponseText,
            responseDescription: userResponseDescription,
          }),
          { executionIntent: "chat" },
        );
        session.status = "running";
        await persistSessions();
        broadcast({ type: "session_updated", session });
        return;
      }
      if (!shouldRunOfficeHoursContinuation) {
        broadcast({ type: "session_updated", session });
      }
      if (shouldRunOfficeHoursContinuation) {
        await runPrompt(
          session,
          buildOfficeHoursStructuredInputContinuationPrompt({
            responseText: userResponseText,
            responseDescription: userResponseDescription,
          }),
          {
            displayUserMessage: false,
            defaultTitle: session.title,
          },
        );
        return;
      }
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
        const savedDay = Number.parseInt(payload.day ?? payload.dayNumber ?? 0, 10) || 0;
        if (savedDay >= 1 && savedDay <= 30) {
          await refreshDayMemory({ workspaceRoot, day: savedDay }).catch((error) => {
            telemetry.captureException(error, {
              operation: "day_memory_refresh_after_curriculum_answer",
              day: savedDay,
            });
          });
        }
        send(socket, {
          type: "curriculum_answer_saved_result",
          success: true,
          day: savedDay || null,
          answerCount: log.records.length,
        });
        telemetry.captureEvent("mac_sidecar_curriculum_answer_saved", {
          day: savedDay,
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
    case "day1_goal_get": {
      await handleDay1GoalGet(socket, payload);
      return;
    }
    case "day1_goal_save": {
      await handleDay1GoalSave(socket, payload);
      return;
    }
    case "day_progress_get": {
      await handleDayProgressGet(socket, payload);
      return;
    }
    case "submit_revenue_evidence": {
      // §17.1/§24-7: revenue evidence path — submit_action_evidence와 동형,
      // paymentRecord 계열 proof 이벤트로 기록. §3.2: LLM judge가 sufficiency
      // 판정(캡처/URL + 발송·수신 시각, §9.3-4). judge error는 §21 보류 —
      // 아무것도 기록하지 않는다.
      const root = resolveDay1GoalWorkspaceRoot(payload);
      const kindToken = String(payload.kind || "").trim().toLowerCase();
      const REVENUE_KIND_TO_EVENT_TYPE = {
        payment_record: "payment_record",
        payment_failure: "payment_failure",
        refund: "refund",
        refusal: "payment_failure",
      };
      const eventType = REVENUE_KIND_TO_EVENT_TYPE[kindToken];
      if (!eventType) {
        throw new Error("submit_revenue_evidence requires kind: payment_record|payment_failure|refund|refusal.");
      }
      const content = String(payload.content || "").trim();
      if (!content) {
        throw new Error("submit_revenue_evidence requires content (capture URL or local file path).");
      }
      const note = String(payload.note || "").trim();
      const revenueDay = Number.parseInt(payload.day, 10) || null;
      const evidenceType = /^https?:\/\//i.test(content) ? "link" : "file";
      // §17.1 UX guard: re-submitting the SAME capture (same kind + evidence
      // locator) should not re-run the judge and append a duplicate. Match on
      // the stable locator — NOT (day,kind) alone, which would wrongly block a
      // legitimate second sale on the same day. appendProofLedgerEvent's
      // fingerprint is the safety net; this skips the wasted judge call and
      // tells the founder it was already recorded.
      const existingLedger = await loadProofLedger({ workspaceRoot: root });
      const alreadyRecorded = existingLedger.events.find((ev) =>
        ev.type === eventType
        && ((ev.sourceUrl && ev.sourceUrl === content)
          || (ev.artifactPath && ev.artifactPath === content)));
      if (alreadyRecorded) {
        telemetry.captureEvent("mac_sidecar_revenue_evidence_recorded", {
          kind: kindToken,
          amount_band: bandRevenueAmount(payload.amount),
          accepted: alreadyRecorded.status === "accepted",
          deduped: true,
        });
        send(socket, {
          type: "submit_revenue_evidence_result",
          workspaceRoot: root,
          success: alreadyRecorded.status === "accepted",
          status: "already_recorded",
          message: "이미 같은 캡처를 기록했어 — 중복 저장은 건너뛰었어.",
        });
        return;
      }
      const judgment = await judgeActionEvidence({
        guideline: {
          dayId: revenueDay,
          actionId: `revenue-${kindToken}`,
          actionType: "revenue_evidence",
          goal: "첫 매출(결제 완료/예약판매 입금) 또는 명시적 거절을 증거로 기록한다",
          completionSignal: "결제 provider 기록·입금 캡처·거절 원문에서 시각과 상대를 식별할 수 있다",
          sufficiencyCriteria: [
            {
              type: "evidence",
              label: "원문/캡처",
              description: "결제 provider 대시보드 URL, 입금/결제 화면 캡처, 또는 거절 원문",
              required: true,
            },
            {
              type: "quality",
              label: "시각·발신 식별",
              description: "발송·수신 시각과 상대(고객)를 식별할 수 있어야 한다",
              required: true,
            },
          ],
        },
        evidence: { type: evidenceType, content, note },
        workspaceRoot: root,
      });
      if (judgment.status !== "accepted" && judgment.status !== "insufficient") {
        send(socket, {
          type: "submit_revenue_evidence_result",
          workspaceRoot: root,
          success: false,
          status: "error",
          message: "판정기를 사용할 수 없어 보류했어. 잠시 후 다시 제출해줘.",
        });
        return;
      }
      const accepted = judgment.status === "accepted";
      await appendProofLedgerEvent({
        workspaceRoot: root,
        event: {
          type: eventType,
          day: revenueDay,
          status: accepted ? "accepted" : "insufficient",
          strength: accepted ? "strong" : "weak",
          evidenceType,
          sourceUrl: evidenceType === "link" ? content : "",
          artifactPath: evidenceType === "file" ? content : "",
          summary: note || judgment.agentAssessment,
          amount: payload.amount,
          metadata: {
            kind: kindToken,
            verifiedBy: "judge",
            judgeConfidence: judgment.confidence,
          },
        },
      });
      telemetry.captureEvent("mac_sidecar_revenue_evidence_recorded", {
        kind: kindToken,
        amount_band: bandRevenueAmount(payload.amount),
        accepted,
      });
      send(socket, {
        type: "submit_revenue_evidence_result",
        workspaceRoot: root,
        success: accepted,
        status: judgment.status,
        message: judgment.miniActionSuggestion || judgment.agentAssessment,
      });
      return;
    }
    case "adaptive_rule_label": {
      // §12 오탐 대응 ②: user-origin label — the founder disputes a firing.
      // Marks the latest unlabeled event for the rule (48h cooldown follows).
      const root = resolveDay1GoalWorkspaceRoot(payload);
      const ruleId = String(payload.ruleId ?? payload.rule_id ?? "").trim();
      const label = String(payload.label ?? "").trim() || "false_positive";
      if (!ruleId) {
        throw new Error("adaptive_rule_label requires ruleId.");
      }
      const { labeled } = await labelAdaptiveRuleEvent({ workspaceRoot: root, ruleId, label });
      telemetry.captureEvent("mac_sidecar_adaptive_rule_labeled", {
        rule_id: ruleId,
        confidence: "",
        user_label: label,
      });
      send(socket, {
        type: "adaptive_rule_label_result",
        workspaceRoot: root,
        success: Boolean(labeled),
      });
      return;
    }
    case "day_progress_patch": {
      await handleDayProgressPatch(socket, payload);
      return;
    }
    case "office_hours_commitment_evidence": {
      await handleOfficeHoursCommitmentEvidence(socket, payload);
      return;
    }
    case "office_hours_commitment_carry_forward": {
      await handleOfficeHoursCommitmentCarryForward(socket, payload);
      return;
    }
    case "office_hours_commitment_abandon": {
      await handleOfficeHoursCommitmentAbandon(socket, payload);
      return;
    }
    case "office_hours_commitment_candidates_request": {
      await handleOfficeHoursCommitmentCandidatesRequest(socket, payload);
      return;
    }
    case "execution_os_get": {
      await handleExecutionOsGet(socket, payload);
      return;
    }
    case "proof_ledger_append": {
      await handleProofLedgerAppend(socket, payload);
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
    case "work_history_get": {
      const snapshot = await loadWorkHistorySnapshot({ workspaceRoot });
      send(socket, { type: "work_history_result", workHistory: snapshot });
      if (state.workHistoryRefreshPromise && state.workHistoryProgress) {
        send(socket, { type: "work_history_status", status: state.workHistoryProgress });
        return;
      }
      // Tab-entry reindex policy: stale by age/week → refresh now; otherwise a
      // cheap head-sha fingerprint detects new commits since the last index.
      if (snapshot.status?.stale) {
        scheduleWorkHistoryRefresh({ reason: "tab_enter", preferredProvider: payload.preferredProvider });
        return;
      }
      fireAndForget(
        "work_history_fingerprint",
        computeWorkHistoryFingerprint({ workspaceRoot }).then((fingerprint) => {
          if (fingerprint.headHash && fingerprint.headHash !== snapshot.fingerprint?.headHash) {
            scheduleWorkHistoryRefresh({ reason: "tab_enter", preferredProvider: payload.preferredProvider });
          }
        }),
      );
      return;
    }
    case "work_history_refresh": {
      scheduleWorkHistoryRefresh({
        reason: payload.reason || "manual",
        targetSocket: socket,
        preferredProvider: payload.preferredProvider,
      });
      return;
    }
    case "morning_briefing_get": {
      const store = await loadMorningBriefingStore({ workspaceRoot });
      const refreshInFlight = Boolean(state.morningBriefingRefreshPromise);
      // Tab-entry refresh policy: the briefing is a daily artifact, so anything
      // generated on a previous local date is stale and re-collects on entry.
      const staleDate = !store.current || !isSameLocalDate(store.current.generatedAt, new Date());
      if (store.current) {
        if (refreshInFlight || staleDate) {
          // 곧 fresh 결과가 라이브 연결 상태를 들고 브로드캐스트된다 — 스냅샷만
          // 즉시 서빙. 오버레이 재전송은 금지: Swift가 morning_briefing_result를
          // 받으면 collecting=false라 수집 중 스피너를 꺼버린다.
          send(socket, {
            type: "morning_briefing_result",
            morningBriefing: store.current,
            morningBriefingPrevious: store.previous,
          });
        } else {
          // 같은 날짜 재방문: 디스크 스냅샷의 연결 행은 생성 이후 Settings의
          // MCP OAuth 연결/해제를 모른다 — 라이브 오버레이로 서빙한다.
          // await하지 않는다(probe ~1s가 첫 응답을 막지 않게).
          void emitMorningBriefingWithLiveSync({
            briefing: store.current,
            previous: store.previous,
            preferredProvider: payload.preferredProvider,
            emit: (morningBriefing, morningBriefingPrevious) => send(socket, {
              type: "morning_briefing_result",
              morningBriefing,
              morningBriefingPrevious,
            }),
          });
        }
      }
      if (refreshInFlight) {
        send(socket, { type: "morning_briefing_status", status: { state: "collecting" } });
        // 수집 중 탭 재진입: 카드별 진행(스피너+로그)을 즉시 복원한다.
        const progressSnapshot = state.morningBriefingProgressTracker?.snapshot?.();
        if (progressSnapshot) {
          send(socket, { type: "morning_briefing_progress", morningBriefingProgress: progressSnapshot });
        }
        return;
      }
      if (staleDate) {
        scheduleMorningBriefingRefresh({
          reason: "tab_enter",
          preferredProvider: payload.preferredProvider,
          targetSocket: socket,
        });
      }
      return;
    }
    case "morning_briefing_refresh": {
      scheduleMorningBriefingRefresh({
        reason: payload.reason || "manual",
        force: Boolean(payload.force),
        preferredProvider: payload.preferredProvider,
        targetSocket: socket,
      });
      return;
    }
    case "morning_briefing_anomaly_label": {
      const label = String(payload.label || "").trim();
      const updated = await updatePersistedMorningBriefing({
        workspaceRoot,
        update: (current) => labelMorningBriefingAnomaly(current, label),
      });
      if (updated) {
        const labeledStore = await loadMorningBriefingStore({ workspaceRoot });
        await emitMorningBriefingWithLiveSync({
          briefing: updated,
          previous: labeledStore.previous,
          preferredProvider: payload.preferredProvider,
          emit: (morningBriefing, morningBriefingPrevious) => broadcast({
            type: "morning_briefing_result",
            morningBriefing,
            morningBriefingPrevious,
          }),
        });
        telemetry.captureEvent("mac_sidecar_morning_briefing_anomaly_labeled", {
          anomaly: updated.anomaly?.id || "",
          label,
        });
      }
      return;
    }
    case "integration_status_check": {
      // Settings > 연동 "상태 확인": live-verify gh CLI/GitHub MCP, PostHog key,
      // and Cloudflare token against the real services.
      // MCP OAuth 배지는 프로바이더 토큰 캐시 단위 — 현재 선택한 프로바이더
      // 기준으로 판정한다(claude/codex 외 선택은 가용 프로바이더로 폴백).
      const integrationStatus = await collectIntegrationStatus({
        appSupportPath,
        provider: resolveIntegrationStatusProvider(payload.preferredProvider),
      });
      state.integrationStatusSnapshot = integrationStatus;
      send(socket, { type: "integration_status_result", integrationStatus });
      telemetry.captureEvent("mac_sidecar_integration_status_checked", {
        github: integrationStatus.github?.state || "",
        github_mcp: integrationStatus.githubMcp?.state || "",
        posthog: integrationStatus.posthog?.state || "",
        cloudflare: integrationStatus.cloudflare?.state || "",
        vercel: integrationStatus.vercel?.state || "",
      });
      reportIntegrationStatusFailures(integrationStatus);
      return;
    }
    case "mcp_oauth_connect_cancel": {
      const server = normalizeMcpOauthPrewarmServer(payload.server);
      const runKey = server || String(payload.server || "").trim().toLowerCase();
      const activeRun = state.mcpOauthConnectRuns.get(runKey);
      const provider = activeRun?.provider || String(payload.preferredProvider || "").trim().toLowerCase();
      if (activeRun) {
        activeRun.abortController.abort();
        telemetry.captureEvent("mac_sidecar_mcp_oauth_connect", {
          server: runKey,
          provider,
          state: "cancel_requested",
        });
        return;
      }
      const cancelledResult = parseMcpOauthConnectResult({
        server: runKey,
        provider,
        state: "cancelled",
        detail: "MCP 연결 확인을 중지했습니다. 다시 시도하세요.",
        checkedAt: new Date().toISOString(),
      });
      send(socket, { type: "mcp_oauth_connect_result", mcpOauthConnect: cancelledResult });
      telemetry.captureEvent("mac_sidecar_mcp_oauth_connect", {
        server: cancelledResult.server,
        provider: cancelledResult.provider,
        state: "cancelled_no_active_run",
      });
      reportMcpOauthConnectOutcome(cancelledResult);
      return;
    }
    case "mcp_oauth_connect": {
      // Settings > 연동 "MCP 연결": OAuth-first MCP(PostHog/Cloudflare)는 설정
      // 화면에서 검증할 수 없으므로(토큰이 프로바이더 캐시에 있음), 대상 MCP
      // 도구를 호출하는 최소 프로바이더 쿼리로 OAuth를 트리거하고 도구 응답으로
      // 연결을 실증한다. 미인증 서버는 authenticate 플레이스홀더가 로그인 URL을
      // 반환 → 진행상황 이벤트로 중계하면 Mac 쪽이 브라우저를 연다.
      const server = normalizeMcpOauthPrewarmServer(payload.server);
      // 연결은 "현재 선택한 프로바이더"의 토큰 캐시에 고정 — 선택(claude/codex)이
      // 로그인돼 있지 않으면 다른 프로바이더로 조용히 폴백하지 않고 명확히
      // 실패한다. 폴백 검증은 선택 프로바이더의 AI 실행에서 여전히 미인증이라
      // "연결됨" 배지가 거짓이 되기 때문. gemini 등 prewarm 미지원 선택만 폴백.
      const resolvedProvider = resolveMcpOauthConnectProvider({
        requested: payload.preferredProvider,
        isProviderAvailable: (candidate) => getProviderAuthState(candidate).available,
        fallbackProvider: pickMorningBriefingProvider(""),
      });
      if (!resolvedProvider.provider) {
        const failedResult = parseMcpOauthConnectResult({
          server: server || String(payload.server || ""),
          provider: String(payload.preferredProvider || "").trim().toLowerCase(),
          state: "failed",
          detail: resolvedProvider.error,
          checkedAt: new Date().toISOString(),
        });
        send(socket, { type: "mcp_oauth_connect_result", mcpOauthConnect: failedResult });
        telemetry.captureEvent("mac_sidecar_mcp_oauth_connect", {
          server: failedResult.server,
          provider: failedResult.provider,
          state: "failed_provider_unavailable",
        });
        reportMcpOauthConnectOutcome(failedResult);
        return;
      }
      const provider = resolvedProvider.provider;
      const runKey = server || String(payload.server || "").trim().toLowerCase();
      const existingRun = state.mcpOauthConnectRuns.get(runKey);
      if (existingRun) {
        const statusPayload = parseMcpOauthConnectStatus({
          server: runKey,
          provider: existingRun.provider || provider,
          state: "progress",
          detail: "이미 MCP 연결 확인이 진행 중입니다.",
        });
        send(socket, {
          type: "mcp_oauth_connect_status",
          mcpOauthConnect: statusPayload,
        });
        return;
      }
      const abortController = new AbortController();
      state.mcpOauthConnectRuns.set(runKey, { abortController, provider });
      const traceId = createMcpOauthTraceId();
      const traceStartedPerf = performance.now();
      const traceStats = {
        commandCount: 0,
        providerRunCount: 0,
        hasLoginUrl: false,
      };
      let traceWriteChain = Promise.resolve();
      const recordMcpOauthTrace = (phase, stateName = "progress", extra = {}) => {
        traceWriteChain = traceWriteChain.then(() => appendMcpOauthTrace({
          appSupportPath,
          entry: {
            traceId,
            server: runKey,
            provider,
            phase,
            durationMs: Math.round(performance.now() - traceStartedPerf),
            state: stateName,
            hasLoginUrl: traceStats.hasLoginUrl || Boolean(extra.hasLoginUrl),
            commandCount: traceStats.commandCount,
            providerRunCount: traceStats.providerRunCount,
          },
        })).catch((error) => {
          telemetry.captureException(error, {
            operation: "mcp_oauth_trace_write",
            server: runKey,
            provider,
          });
        });
        return traceWriteChain;
      };
      let mcpOauthConnect;
      try {
        recordMcpOauthTrace("started", "progress");
        mcpOauthConnect = await prewarmMcpOauth({
          server: server || payload.server,
          provider,
          workspaceRoot,
          signal: abortController.signal,
          runProviderStreamImpl: runProviderStream,
          buildCodexEnvImpl: buildCodexEnv,
          resolveCodexBinaryPathImpl: resolveCodexBinaryPath,
          onProgress: (update) => {
            try {
              const statusPayload = parseMcpOauthConnectStatus({
                server: update.server,
                provider,
                state: "progress",
                detail: update.detail || "",
                ...(update.loginUrl ? { loginUrl: update.loginUrl } : {}),
                ...(typeof update.openBrowser === "boolean" ? { openBrowser: update.openBrowser } : {}),
              });
              if (update.loginUrl) traceStats.hasLoginUrl = true;
              recordMcpOauthTrace(update.phase || "progress", "progress", {
                hasLoginUrl: Boolean(update.loginUrl),
              });
              send(socket, {
                type: "mcp_oauth_connect_status",
                mcpOauthConnect: statusPayload,
              });
            } catch (error) {
              telemetry.captureException(error, {
                operation: "mcp_oauth_connect_status_contract",
                server: update?.server || server || String(payload.server || ""),
                provider,
              });
              captureSidecarLog("mcp oauth progress event ignored", "warn", {
                operation: "mcp_oauth_connect_status_contract",
                server: update?.server || server || String(payload.server || ""),
                provider,
                detail: truncateTelemetryString(error?.message || error),
              });
            }
          },
          onTraceEvent: (event = {}) => {
            if (event.type === "command") {
              traceStats.commandCount += 1;
            } else if (event.type === "provider_run") {
              traceStats.providerRunCount += 1;
            }
            recordMcpOauthTrace(event.phase || event.type || "trace", "progress");
          },
        });
      } catch (error) {
        const message = String(error?.message || error);
        telemetry.captureException(error, {
          operation: "mcp_oauth_connect",
          server: server || String(payload.server || ""),
          provider,
        });
        mcpOauthConnect = parseMcpOauthConnectResult({
          server: server || String(payload.server || ""),
          provider,
          state: "failed",
          detail: `MCP 연결 확인 중 예기치 않은 오류가 발생했어요 — 다시 시도해 주세요. ${message}`,
          checkedAt: new Date().toISOString(),
        },
        );
      } finally {
        const activeRun = state.mcpOauthConnectRuns.get(runKey);
        if (activeRun?.abortController === abortController) {
          state.mcpOauthConnectRuns.delete(runKey);
        }
      }
      const durationMs = Math.round(performance.now() - traceStartedPerf);
      mcpOauthConnect = parseMcpOauthConnectResult({
        ...mcpOauthConnect,
        traceId,
        durationMs,
      });
      await recordMcpOauthTrace("completed", mcpOauthConnect.state, {
        hasLoginUrl: Boolean(mcpOauthConnect.loginUrl),
      });
      // 검증 결과 영속: 브리핑 소스 게이트와 Settings 상태 배지가 "OAuth로
      // 연결됨"을 인정하는 유일한 근거. 토큰이 아니라 검증 사실만 저장.
      if (mcpOauthConnect.state !== "cancelled") {
        await persistMcpOauthConnectResult({ appSupportPath, result: mcpOauthConnect }).catch((error) => {
          telemetry.captureException(error, { operation: "mcp_oauth_state_persist" });
        });
      }
      let integrationStatus = null;
      if (mcpOauthConnect.state !== "cancelled") {
        integrationStatus = mergeMcpOauthConnectResultIntoIntegrationStatus({
          current: state.integrationStatusSnapshot,
          result: mcpOauthConnect,
          provider,
        });
        if (integrationStatus) state.integrationStatusSnapshot = integrationStatus;
      }
      send(socket, {
        type: "mcp_oauth_connect_result",
        mcpOauthConnect,
        ...(integrationStatus ? { integrationStatus } : {}),
      });
      telemetry.captureEvent("mac_sidecar_mcp_oauth_connect", {
        server: mcpOauthConnect.server,
        provider: mcpOauthConnect.provider,
        state: mcpOauthConnect.state,
        provider_limited: mcpOauthConnect.providerLimited === true,
      });
      reportMcpOauthConnectOutcome(mcpOauthConnect);
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
      const root = normalizeWorkspaceRootInput(payload.root);
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
        captureSidecarLog("workspace scan rejected", "warn", {
          operation: "scan_workspace",
          reason: "invalid_root",
          scan_root: root,
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
        preferredProvider: payload.preferredProvider,
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
      runCreateDoc(root, docType, { preferredProvider: payload.preferredProvider });
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
      if (payload?.anonymousDistinctId) {
        telemetry.setAnonymousDistinctId(payload.anonymousDistinctId);
      }
      const auth = setAuthContext(payload);
      send(socket, { type: "auth_context_updated", auth });
      return;
    }
    case "onboarding_memory_save": {
      const root = resolveDay1GoalWorkspaceRoot(payload);
      try {
        const onboardingMemory = await saveOnboardingMemory({
          workspaceRoot: root,
          memory: payload.memory || payload.onboardingMemory || payload,
        });
        const event = {
          type: "onboarding_memory_state",
          workspaceRoot: root,
          onboardingMemory,
          success: true,
        };
        send(socket, event);
        broadcast(event);
      } catch (error) {
        telemetry.captureException(error, { operation: "onboarding_memory_save" });
        send(socket, {
          type: "onboarding_memory_state",
          workspaceRoot: root,
          success: false,
          error: formatError(error),
        });
      }
      return;
    }
    case "onboarding_memory_request": {
      const root = resolveDay1GoalWorkspaceRoot(payload);
      const onboardingMemory = await loadOnboardingMemory({ workspaceRoot: root });
      send(socket, {
        type: "onboarding_memory_state",
        workspaceRoot: root,
        onboardingMemory,
        success: true,
      });
      return;
    }
    case "clear_auth_context": {
      if (payload?.anonymousDistinctId) {
        telemetry.setAnonymousDistinctId(payload.anonymousDistinctId);
      }
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
      const executionOs = await buildExecutionOsSnapshotForWorkspace(workspaceRoot);
      send(socket, {
        type: "diagnostics_snapshot",
        diagnostics: buildSidecarDiagnostics(environment, preflight, executionOs),
    });
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

function resolveDay1GoalWorkspaceRoot(payload = {}) {
  const requestedRoot = String(payload.workspaceRoot || payload.workspace_root || workspaceRoot || "").trim();
  return requestedRoot ? path.resolve(requestedRoot) : workspaceRoot;
}

async function handleExecutionOsGet(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  try {
    const snapshot = await buildExecutionOsSnapshotForWorkspace(root, {
      day: payload.day ?? payload.dayNumber ?? payload.day_number,
    });
    captureExecutionOsTelemetryEvents(telemetry, snapshot);
    sendExecutionOsState(socket, root, snapshot);
  } catch (error) {
    telemetry.captureException(error, {
      operation: "execution_os_get",
      workspace_root: root,
    });
    send(socket, {
      type: "execution_os_state",
      workspaceRoot: root,
      success: false,
      error: formatError(error),
    });
  }
}

async function handleProofLedgerAppend(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  try {
    const eventPayload = payload.event || payload.proofEvent || payload.proof_event || payload;
    const result = await appendProofLedgerEvent({
      workspaceRoot: root,
      event: eventPayload,
    });
    const snapshot = await buildExecutionOsSnapshotForWorkspace(root, {
      day: payload.day ?? payload.dayNumber ?? payload.day_number,
      proofLedger: result.ledger,
    });
    telemetry.captureEvent("mac_sidecar_execution_os_proof_event_appended", {
      event_type: result.event.type,
      status: result.event.status,
      day: result.event.day,
      workspace_basename: path.basename(root),
    });
    captureExecutionOsTelemetryEvents(telemetry, snapshot);
    sendExecutionOsState(socket, root, snapshot, {
      appendedProofEvent: result.event,
      appended_proof_event: result.event,
    });
  } catch (error) {
    telemetry.captureException(error, {
      operation: "proof_ledger_append",
      workspace_root: root,
    });
    send(socket, {
      type: "execution_os_state",
      workspaceRoot: root,
      success: false,
      error: formatError(error),
    });
  }
}

async function buildExecutionOsSnapshotForWorkspace(root = workspaceRoot, {
  day = null,
  proofLedger = null,
} = {}) {
  const resolvedRoot = root ? path.resolve(root) : workspaceRoot;
  const [ledger, selection, progress, projectContext] = await Promise.all([
    proofLedger ? Promise.resolve(proofLedger) : loadProofLedger({ workspaceRoot: resolvedRoot }),
    loadDay1GoalSelection({ workspaceRoot: resolvedRoot }),
    loadDayProgress({ workspaceRoot: resolvedRoot }),
    loadProjectContextCache({ workspaceRoot: resolvedRoot }).catch(() => null),
  ]);
  const environment = getEnvironmentSummary();
  const preflight = buildSidecarPreflight(environment);
  const currentDay = Number.parseInt(String(day ?? ""), 10)
    || (progress ? computeDayNumber({ challengeStartedAt: progress.challengeStartedAt }) : null)
    || 1;
  return composeExecutionOsSnapshot({
    workspaceRoot: resolvedRoot,
    day: currentDay,
    day1GoalSelection: selection,
    projectContext,
    proofLedger: ledger,
    progressState: progress,
    diagnostics: { redactionSafe: true, preflight },
    preflight,
    telemetryState: {
      configured: Boolean(process.env.POSTHOG_PROJECT_API_KEY || process.env.POSTHOG_PROJECT_TOKEN),
      optOutAvailable: true,
    },
    crashState: {
      nativeCrashReportingAvailable: process.env.AGENTIC30_NATIVE_CRASH_REPORTING === "1",
    },
  });
}

function sendExecutionOsState(socket, root, snapshot, extra = {}) {
  send(socket, {
    type: "execution_os_state",
    workspaceRoot: root,
    success: true,
    executionOs: snapshot,
    execution_os: snapshot,
    proofLedger: snapshot.proofLedger,
    proof_ledger: snapshot.proofLedger,
    missionCard: snapshot.missionCard,
    mission_card: snapshot.missionCard,
    pilotReadiness: snapshot.pilotReadiness,
    pilot_readiness: snapshot.pilotReadiness,
    ...extra,
  });
}

async function handleDay1GoalGet(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  const selection = await loadDay1GoalSelection({ workspaceRoot: root });
  if (path.resolve(root) === path.resolve(workspaceRoot)) {
    state.day1GoalSelection = selection;
  }
  send(socket, {
    type: "day1_goal_state",
    workspaceRoot: root,
    day1GoalSelection: selection,
  });
}

async function handleDay1GoalSave(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  try {
    const selectionPayload = payload.selection || payload.day1GoalSelection || payload.day1_goal_selection || payload;
    const selection = await saveDay1GoalSelection({
      workspaceRoot: root,
      selection: selectionPayload,
    });
    if (path.resolve(root) === path.resolve(workspaceRoot)) {
      state.day1GoalSelection = selection;
    }
    const goalContext = buildDay1GoalProjectContext(selection);
    const projectContext = await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "day1_goal_save",
      onboardingHypothesis: {
        ...(state.workspaceOnboardingHypothesis || {}),
        ...(goalContext || {}),
      },
    });
    telemetry.captureEvent("mac_sidecar_day1_goal_saved", {
      goal_type: selection.goalType,
      proof_sink: selection.proofSink,
      workspace_basename: path.basename(root),
    });
    broadcast({
      type: "day1_goal_state",
      workspaceRoot: root,
      day1GoalSelection: selection,
      projectContext,
    });
    // Goal confirmed → advance the day loop to the interview step.
    try {
      // Anchor unconditionally (idempotent) so a missing/legacy null start can't silently
      // skip the interview advance — mirrors the scan paths.
      const dp = await ensureChallengeStart({ workspaceRoot: root });
      const currentDay = computeDayNumber({ challengeStartedAt: dp.challengeStartedAt });
      if (currentDay) {
        const updated = await setDayActiveStep({
          workspaceRoot: root,
          day: 1,
          stepId: "first_interview",
          goalText: selection.goalText,
        });
        if (path.resolve(root) === path.resolve(workspaceRoot)) {
          state.dayProgress = updated;
        }
        broadcast({
          type: "day_progress_state",
          workspaceRoot: root,
          dayProgress: updated,
          currentDay,
          officeHoursMemory: await loadOfficeHoursMemorySummary(root, currentDay),
          officeHoursHistory: await loadOfficeHoursHistorySummary(root, currentDay),
          dayReviews: await loadOfficeHoursDayReviews(root, updated, currentDay),
          evidenceOS: await loadOfficeHoursEvidenceOS(root, updated, currentDay),
        });
      }
    } catch (progressError) {
      telemetry.captureException(progressError, {
        operation: "day1_goal_save_day_progress",
        workspace_root: root,
      });
    }
  } catch (error) {
    telemetry.captureException(error, {
      operation: "day1_goal_save",
      workspace_root: root,
    });
    send(socket, {
      type: "day1_goal_state",
      workspaceRoot: root,
      success: false,
      error: formatError(error),
    });
  }
}

async function handleDayProgressGet(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  const dayProgress = await loadDayProgress({ workspaceRoot: root });
  if (path.resolve(root) === path.resolve(workspaceRoot)) {
    state.dayProgress = dayProgress;
  }
  const currentDay = dayProgress
    ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt })
    : null;
  send(socket, {
    type: "day_progress_state",
    workspaceRoot: root,
    dayProgress,
    currentDay,
    officeHoursMemory: await loadOfficeHoursMemorySummary(root, currentDay),
    officeHoursHistory: await loadOfficeHoursHistorySummary(root, currentDay),
    dayReviews: await loadOfficeHoursDayReviews(root, dayProgress, currentDay),
    evidenceOS: await loadOfficeHoursEvidenceOS(root, dayProgress, currentDay),
  });
}

// Compact office-hours memory summary for the additive `officeHoursMemory` field on the
// day_progress_state broadcast (Swift OfficeHoursMemorySummary). Fail-open to null.
async function loadOfficeHoursMemorySummary(root, currentDay) {
  try {
    const memory = await loadOfficeHoursMemory({ workspaceRoot: root });
    return summarizeOfficeHoursMemory(memory, { currentCycle: currentDay ?? undefined });
  } catch {
    return null;
  }
}

async function loadOfficeHoursHistorySummary(root, currentDay) {
  try {
    return await buildOfficeHoursHistorySummary({ workspaceRoot: root, day: currentDay ?? null });
  } catch {
    return null;
  }
}

async function loadOfficeHoursDayReviews(root, dayProgress, currentDay = null) {
  if (!dayProgress) return null;
  try {
    const [memory, workHistory, day1GoalSelection] = await Promise.all([
      loadOfficeHoursMemory({ workspaceRoot: root }),
      loadWorkHistorySnapshot({ workspaceRoot: root }),
      loadDay1GoalSelection({ workspaceRoot: root }),
    ]);
    return buildDayReviews({ dayProgress, memory, workHistory, day1GoalSelection, currentDay });
  } catch {
    return null;
  }
}

async function loadOfficeHoursEvidenceOS(root, dayProgress, currentDay = null) {
  if (!dayProgress) return null;
  try {
    const [memory, workHistory, day1GoalSelection] = await Promise.all([
      loadOfficeHoursMemory({ workspaceRoot: root }),
      loadWorkHistorySnapshot({ workspaceRoot: root }),
      loadDay1GoalSelection({ workspaceRoot: root }),
    ]);
    return buildEvidenceOS({ dayProgress, memory, workHistory, day1GoalSelection, currentDay });
  } catch {
    return null;
  }
}

async function sendOfficeHoursEvidenceState(socket, root, { broadcastToAll = true } = {}) {
  const dayProgress = await loadDayProgress({ workspaceRoot: root });
  if (path.resolve(root) === path.resolve(workspaceRoot)) {
    state.dayProgress = dayProgress;
  }
  const currentDay = dayProgress ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt }) : null;
  const payload = {
    type: "day_progress_state",
    workspaceRoot: root,
    dayProgress,
    currentDay,
    officeHoursMemory: await loadOfficeHoursMemorySummary(root, currentDay),
    officeHoursHistory: await loadOfficeHoursHistorySummary(root, currentDay),
    dayReviews: await loadOfficeHoursDayReviews(root, dayProgress, currentDay),
    evidenceOS: await loadOfficeHoursEvidenceOS(root, dayProgress, currentDay),
  };
  if (broadcastToAll) {
    broadcast(payload);
  } else {
    send(socket, payload);
  }
}

async function handleOfficeHoursCommitmentEvidence(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  const commitmentId = String(payload.commitmentId ?? payload.commitment_id ?? "").trim();
  const evidence = normalizeCommitmentEvidencePayload(payload.evidence ?? payload);
  try {
    if (!commitmentId) throw new Error("commitmentId is required.");
    await gradeCommitment({
      workspaceRoot: root,
      commitmentId,
      evidence,
      gradedCycle: Number.parseInt(payload.gradedCycle ?? payload.graded_cycle ?? payload.day ?? 0, 10) || undefined,
    });
    await recompileCompiledTruth({ workspaceRoot: root });
    const dayProgress = await loadDayProgress({ workspaceRoot: root }).catch(() => null);
    const currentDay = dayProgress ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt }) : null;
    if (currentDay) {
      await refreshDayMemory({ workspaceRoot: root, day: currentDay }).catch((error) => {
        telemetry.captureException(error, { operation: "day_memory_refresh_after_commitment_evidence" });
      });
    }
    telemetry.captureEvent("mac_sidecar_office_hours_commitment_evidence", {
      workspace_basename: path.basename(root),
      evidence_kind: evidence.kind || "",
    });
    await sendOfficeHoursEvidenceState(socket, root);
  } catch (error) {
    telemetry.captureException(error, { operation: "office_hours_commitment_evidence" });
    send(socket, { type: "day_progress_state", workspaceRoot: root, success: false, error: formatError(error) });
  }
}

async function handleOfficeHoursCommitmentCarryForward(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  const commitmentId = String(payload.commitmentId ?? payload.commitment_id ?? "").trim();
  try {
    const dayProgress = await loadDayProgress({ workspaceRoot: root });
    const currentDay = dayProgress ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt }) : null;
    const nextDay = Number.parseInt(payload.day ?? payload.dayNumber ?? payload.day_number ?? currentDay ?? 1, 10) || 1;
    const result = await carryForwardCommitment({
      workspaceRoot: root,
      day: nextDay,
      commitmentId,
    });
    if (result.created) {
      const text = result.commitment?.text || result.commitment?.message || "고객 행동 약속";
      await appendTimeline({
        workspaceRoot: root,
        cycle: nextDay,
        source: "retro",
        origin: "user",
        summary: `이월: ${text}`,
        detail: "Evidence OS에서 오늘 약속으로 다시 열었습니다.",
      });
    }
    await recompileCompiledTruth({ workspaceRoot: root });
    await refreshDayMemory({ workspaceRoot: root, day: nextDay }).catch((error) => {
      telemetry.captureException(error, { operation: "day_memory_refresh_after_commitment_carry_forward" });
    });
    telemetry.captureEvent("mac_sidecar_office_hours_commitment_carry_forward", {
      workspace_basename: path.basename(root),
    });
    await sendOfficeHoursEvidenceState(socket, root);
  } catch (error) {
    telemetry.captureException(error, { operation: "office_hours_commitment_carry_forward" });
    send(socket, { type: "day_progress_state", workspaceRoot: root, success: false, error: formatError(error) });
  }
}

async function handleOfficeHoursCommitmentAbandon(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  const commitmentId = String(payload.commitmentId ?? payload.commitment_id ?? "").trim();
  const reason = String(payload.reason ?? payload.note ?? "").replace(/\s+/g, " ").trim();
  try {
    if (!commitmentId) throw new Error("commitmentId is required.");
    const dayProgress = await loadDayProgress({ workspaceRoot: root });
    const currentDay = dayProgress ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt }) : null;
    const result = await abandonCommitment({ workspaceRoot: root, commitmentId });
    if (result.abandoned) {
      await appendTimeline({
        workspaceRoot: root,
        cycle: currentDay ?? 1,
        source: "retro",
        origin: "user",
        summary: "약속 포기",
        detail: reason || "사용자가 Evidence OS에서 미해결 약속을 포기 처리했습니다.",
      });
    }
    await recompileCompiledTruth({ workspaceRoot: root });
    if (currentDay) {
      await refreshDayMemory({ workspaceRoot: root, day: currentDay }).catch((error) => {
        telemetry.captureException(error, { operation: "day_memory_refresh_after_commitment_abandon" });
      });
    }
    telemetry.captureEvent("mac_sidecar_office_hours_commitment_abandon", {
      workspace_basename: path.basename(root),
      has_reason: Boolean(reason),
    });
    await sendOfficeHoursEvidenceState(socket, root);
  } catch (error) {
    telemetry.captureException(error, { operation: "office_hours_commitment_abandon" });
    send(socket, { type: "day_progress_state", workspaceRoot: root, success: false, error: formatError(error) });
  }
}

const OFFICE_HOURS_COMMITMENT_CANDIDATES_TIMEOUT_MS = 30_000;

// Stage 2 of the interview-close redesign: when the founder finishes the last
// forcing question, the Mac requests context-aware candidates for the commitment
// close so it mirrors the interview (clickable options) instead of opening on a
// bare text field. Candidates are derived from THIS interview's own answers (the
// turn log) plus still-open memory threads, generated read-only by the provider.
//
// PROPOSALS only — the user-origin gate in handleDayProgressPatch still governs the
// actual commitment write. Fail-open at every step: a missing provider, a timeout,
// junk output, or any error all resolve to `status: "ready"` with whatever local
// fallback exists, so the close never blocks on this and the Mac falls back to its
// own memory-derived suggestions (and always to "직접 적기").
async function handleOfficeHoursCommitmentCandidatesRequest(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  const sessionId = String(payload.sessionId ?? payload.session_id ?? "").trim();
  const requestedDay = normalizeOfficeHoursDay(payload.day ?? payload.dayNumber ?? payload.day_number);
  const preferredProvider = String(payload.provider ?? payload.preferredProvider ?? "").trim();

  const emit = (status, candidates) => {
    broadcast({
      type: "office_hours_commitment_candidates",
      sessionId,
      day: requestedDay ?? null,
      status,
      candidates: Array.isArray(candidates) ? candidates : [],
    });
  };

  // Local fallback first, so even a total generation failure still yields whatever
  // memory-derived threads exist (mirrors the Mac's own local suggestion source).
  let fallbackThreads = [];
  try {
    const dayProgress = await loadDayProgress({ workspaceRoot: root }).catch(() => null);
    const currentDay = requestedDay
      ?? (dayProgress ? normalizeOfficeHoursDay(computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt })) : null);
    const memorySummary = await loadOfficeHoursMemorySummary(root, currentDay);
    fallbackThreads = Array.isArray(memorySummary?.openThreads) ? memorySummary.openThreads : [];

    emit("generating", []);

    const turnLog = await loadOfficeHoursTurnLog({ workspaceRoot: root }).catch(() => null);
    const allTurns = Array.isArray(turnLog?.turns) ? turnLog.turns : [];
    // Prefer this session's turns; fall back to the requested day, then the tail.
    const sessionTurns = sessionId ? allTurns.filter((turn) => turn.sessionId === sessionId) : [];
    const dayTurns = currentDay ? allTurns.filter((turn) => turn.day === currentDay) : [];
    const interviewTurns = (sessionTurns.length ? sessionTurns : dayTurns.length ? dayTurns : allTurns).slice(-8);

    const provider = pickMorningBriefingProvider(preferredProvider);
    if (!provider) {
      emit("ready", mergeCommitmentCandidates([], fallbackThreads));
      return;
    }

    const abortController = new AbortController();
    let generatedText = "";
    let timedOut = false;
    await runWithSoftTimeout({
      timeoutMs: OFFICE_HOURS_COMMITMENT_CANDIDATES_TIMEOUT_MS,
      abortController,
      onTimeout: () => {
        timedOut = true;
        telemetry.captureEvent("mac_sidecar_office_hours_commitment_candidates_timeout", {
          provider,
          workspace_basename: path.basename(root),
        });
      },
      onLateError: (error) => {
        telemetry.captureException(error, { operation: "office_hours_commitment_candidates_late", provider });
      },
      operation: async () => {
        await runProviderStream({
          provider,
          prompt: buildOfficeHoursCommitmentCandidatesPrompt({
            turns: interviewTurns,
            openThreads: fallbackThreads,
            day: currentDay,
          }),
          workspaceRoot: root,
          abortController,
          sessionIdForMcp: null,
          executionMode: "office_hours_digest_read_only",
          approvedToolExecution: false,
          onTextDelta: (text) => {
            if (!timedOut) generatedText += String(text || "");
          },
          onTextReplace: (text) => {
            if (!timedOut) generatedText = String(text || "");
          },
        });
      },
    });

    const generated = timedOut ? [] : parseOfficeHoursCommitmentCandidates(generatedText);
    const candidates = mergeCommitmentCandidates(generated, fallbackThreads);
    telemetry.captureEvent("mac_sidecar_office_hours_commitment_candidates", {
      provider,
      generated_count: generated.length,
      merged_count: candidates.length,
      workspace_basename: path.basename(root),
    });
    emit("ready", candidates);
  } catch (error) {
    telemetry.captureException(error, { operation: "office_hours_commitment_candidates" });
    // Fail-open: still hand back the local fallback so the close is never blocked.
    emit("ready", mergeCommitmentCandidates([], fallbackThreads));
  }
}

function normalizeCommitmentEvidencePayload(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    kind: String(input.kind || input.evidenceKind || input.evidence_kind || "").trim(),
    url: String(input.url || input.locator || "").trim(),
    note: String(input.note || "").trim(),
  };
}

function formatStructuredCommitmentText(commitment) {
  if (!commitment || typeof commitment !== "object" || Array.isArray(commitment)) return "";
  const customer = String(commitment.customer || "").replace(/\s+/g, " ").trim();
  const channel = String(commitment.channel || "").replace(/\s+/g, " ").trim();
  const message = String(commitment.message || "").replace(/\s+/g, " ").trim();
  const evidence = String(commitment.expectedEvidenceKind || commitment.expected_evidence_kind || "").replace(/\s+/g, " ").trim();
  if (!customer || !message) return "";
  const channelPart = channel ? `${channel}로 ` : "";
  const evidencePart = evidence ? ` · 증거: ${evidence}` : "";
  return `${customer}에게 ${channelPart}${message}${evidencePart}`.slice(0, 500);
}

// calibration-lite write path, invoked from the interview-close commit branch. Grades the
// PRIOR unresolved forecast (founder's retrospective verdict) BEFORE capturing this cycle's
// forecast, so "latest unresolved" never targets the one we are about to add. Both inputs
// are optional — absent = no-op (additive/non-breaking). A bad verdict string is swallowed
// so it can never break the interview close.
async function applyPredictionPatch({ workspaceRoot, cycle, predictionText, predictionVerdict }) {
  const verdict = typeof predictionVerdict === "string" ? predictionVerdict.trim() : "";
  if (verdict) {
    const memory = await loadOfficeHoursMemory({ workspaceRoot });
    const target = latestUnresolvedPrediction(memory);
    if (target) {
      try {
        await gradePrediction({ workspaceRoot, predictionId: target.id, verdict, gradedCycle: cycle });
      } catch (error) {
        telemetry.captureException(error, { operation: "office_hours_grade_prediction" });
      }
    }
  }
  const claim = typeof predictionText === "string" ? predictionText.trim() : "";
  if (claim) {
    await appendPrediction({ workspaceRoot, claim, cycle, originText: claim });
  }
}

// §16.2 privacy: 금액 원값은 전송 금지 — KRW 기준 구간만 보낸다.
function bandRevenueAmount(amount) {
  const number = Number(amount);
  if (!Number.isFinite(number) || number < 0) return "unknown";
  if (number < 10_000) return "lt_10k";
  if (number < 100_000) return "10k_100k";
  if (number < 1_000_000) return "100k_1m";
  return "gte_1m";
}

async function handleDayProgressPatch(socket, payload = {}) {
  const root = resolveDay1GoalWorkspaceRoot(payload);
  const stepId = payload.stepId ?? payload.step ?? payload.step_id;
  const status = payload.status;
  const day = payload.day ?? payload.dayNumber ?? payload.day_number;
  const commitmentText = payload.commitmentText ?? payload.commitment_text;
  const structuredCommitment = payload.commitment && typeof payload.commitment === "object" && !Array.isArray(payload.commitment)
    ? payload.commitment
    : null;
  const confession = payload.confession;
  // calibration-lite (optional, additive): a one-line forecast for this cycle, and/or a
  // retrospective verdict on the prior cycle's still-open forecast. Absent = no-op.
  const predictionText = payload.predictionText ?? payload.prediction_text;
  const predictionVerdict = payload.predictionVerdict ?? payload.prediction_verdict;
  try {
    // Interview/first_interview completion gate (founder decision: block-once-then-
    // confession). The single anti-displacement chokepoint identified by the
    // first_interview-evidence-gate trace.
    const gate = classifyInterviewGate({ stepId, status, commitmentText, commitment: structuredCommitment, confession });
    if (gate.mode === "block") {
      // Do NOT mark the step done — the founder must name one next customer action,
      // or confess they're holding the gate. Return current (unchanged) progress.
      const current = await loadDayProgress({ workspaceRoot: root });
      const currentDay = current ? computeDayNumber({ challengeStartedAt: current.challengeStartedAt }) : null;
      send(socket, {
        type: "day_progress_state",
        workspaceRoot: root,
        dayProgress: current,
        currentDay,
        needsCommitment: true,
        gatedStep: String(stepId || ""),
        message: "이 인터뷰를 닫기 전에 다음 한 가지 고객 행동을 약속해줘. 정 못 하면 그 이유를 남겨도 통과돼.",
        officeHoursMemory: await loadOfficeHoursMemorySummary(root, currentDay),
        officeHoursHistory: await loadOfficeHoursHistorySummary(root, currentDay),
        dayReviews: await loadOfficeHoursDayReviews(root, current, currentDay),
        evidenceOS: await loadOfficeHoursEvidenceOS(root, current, currentDay),
      });
      telemetry.captureEvent("mac_sidecar_interview_gate_blocked", {
        step_id: String(stepId || ""),
        workspace_basename: path.basename(root),
      });
      return;
    }
    // §13.4: a commitment closing an intervention session issues the gate's
    // pass-through token BEFORE the milestone evaluation, so the confirming
    // patch itself passes via the token instead of deadlocking on the still-
    // blocked gate. Once-per-gate + program-wide cap live in the engine.
    // Armed interventions go stale after 24h: an abandoned intervention
    // session must not let an unrelated later commitment mint the gate token
    // (§13.4 "참여+커밋먼트 확정" — participation and confirmation belong to
    // the same intervention, fail-closed).
    let pendingIntervention = pendingInterventionGates.get(path.resolve(root)) ?? null;
    if (pendingIntervention && Date.now() - Date.parse(pendingIntervention.createdAt) >= 24 * 60 * 60 * 1000) {
      pendingInterventionGates.delete(path.resolve(root));
      pendingIntervention = null;
    }
    if (pendingIntervention) {
      const patchSessionId = String(payload.sessionId ?? payload.session_id ?? "").trim();
      if (!patchSessionId || patchSessionId !== pendingIntervention.sessionId) {
        pendingInterventionGates.delete(path.resolve(root));
        telemetry.captureEvent("mac_sidecar_oh_intervention_token_refused", {
          trigger_id: pendingIntervention.triggerId,
          gate_id: pendingIntervention.gateId,
          reason: "session_mismatch",
        });
        pendingIntervention = null;
      }
    }
    // §12 AR-17 진행 효과: 증거 0인 약속 위에 새 약속을 쌓는 중이면 신규
    // 커밋먼트를 보류한다. intervention-armed 커밋은 예외(§13.4 토큰 경로),
    // 오탐 라벨(adaptive_rule_label)이 사용자 해제 수단이다.
    if (
      gate.mode === "commit"
      && !pendingIntervention
      && await isNewCommitmentBlockedByAr17({ workspaceRoot: root })
    ) {
      const current = await loadDayProgress({ workspaceRoot: root });
      const ar17CurrentDay = current
        ? computeDayNumber({ challengeStartedAt: current.challengeStartedAt })
        : null;
      send(socket, {
        type: "day_progress_state",
        workspaceRoot: root,
        dayProgress: current,
        currentDay: ar17CurrentDay,
        needsCommitment: true,
        gatedStep: String(stepId || ""),
        message: "증거 없이 열려 있는 약속이 있어. 새 약속을 쌓기 전에 기존 약속 1개를 먼저 닫거나(증거 제출), 이 판정이 오탐이면 그렇게 표시해줘.",
        officeHoursMemory: await loadOfficeHoursMemorySummary(root, ar17CurrentDay),
        officeHoursHistory: await loadOfficeHoursHistorySummary(root, ar17CurrentDay),
        dayReviews: await loadOfficeHoursDayReviews(root, current, ar17CurrentDay),
        evidenceOS: await loadOfficeHoursEvidenceOS(root, current, ar17CurrentDay),
      });
      return;
    }
    if (gate.mode === "commit" && pendingIntervention) {
      try {
        const issuance = await issueInterventionTokenForCommitment({
          workspaceRoot: root,
          gateId: pendingIntervention.gateId,
          commitment: structuredCommitment,
          day: Number.parseInt(day, 10) || null,
        });
        pendingInterventionGates.delete(path.resolve(root));
        telemetry.captureEvent("mac_sidecar_oh_intervention_completed", {
          trigger_id: pendingIntervention.triggerId,
          gate_id: pendingIntervention.gateId,
          commitment_confirmed: true,
          token_issued: issuance.issued,
          token_refused_reason: issuance.issued ? "" : issuance.reason,
        });
      } catch (error) {
        telemetry.captureException(error, {
          operation: "oh_intervention_token_issue",
          workspace_root: root,
        });
      }
    }
    // Milestone gate (spec §10.1): evaluated against the proof ledger right before
    // the authoritative patch. A blocked milestone gate (G1 Day4 goal-step, G2 Day8+,
    // G4 Day15+) withholds the patch — fail-closed; release paths are strong evidence
    // or a confession-issued intervention token (§13.4). Confess-mode patches are
    // exempt: confession is the §10.2 safety valve and records outcome=blocked, so
    // withholding it would deadlock the release path itself.
    const gateTargetDay = Number.parseInt(day, 10) || null;
    let gateCheck = null;
    let gateLedgerAfterSubstitution = null;
    if (gateTargetDay && gate.mode !== "confess") {
      // G4② input (spec §15.4/§21): latest persisted first_value snapshot plus
      // PostHog source availability — both local reads, no network on this path.
      gateCheck = await evaluateDayProgressPatchGate({
        workspaceRoot: root,
        day: gateTargetDay,
        stepId,
        firstValue: await latestFirstValueSignal({ workspaceRoot: root }),
        sources: {
          posthogAvailable: resolvePostHogMcpSettings({
            env: process.env,
            appSupportPath,
          })?.tokenValid === true,
          cloudflareAvailable: resolveCloudflareMcpSettings({
            env: process.env,
            appSupportPath,
          })?.tokenValid === true,
        },
      });
      // §16.1: refresh the program context attached to every telemetry event.
      const activeGate = resolveActiveGate(gateCheck.evaluation);
      telemetry.setProgramContext({
        programDay: gateTargetDay,
        programPhase: resolveProgramPhase(gateCheck.evaluation),
        activeGate: activeGate?.gateId ?? "",
        gateState: activeGate?.state ?? "",
      });
      // §16.2: per-gate state transitions — gate_evaluated on every change,
      // gate_unblocked when a previously blocked gate opens or passes.
      for (const [gateId, gateState] of Object.entries(gateCheck.evaluation?.gates ?? {})) {
        const previousState = gateCheck.previousStates?.[gateId];
        if (previousState === gateState.state) continue;
        telemetry.captureEvent("mac_sidecar_gate_evaluated", {
          gate_id: gateId,
          state: gateState.state,
          blocked_reason: gateState.blockedReason || "",
          evidence_count: (gateState.conditions ?? []).filter((condition) => condition.satisfied).length,
        });
        if (previousState === "blocked" && gateState.state !== "blocked") {
          telemetry.captureEvent("mac_sidecar_gate_unblocked", {
            gate_id: gateId,
            resolution_path: gateState.resolutionPath || "",
          });
        }
      }
      // §15.3/§11.1: record due recovery-mission substitutions (once per
      // failed gate — idempotent). Mission cards consume the rows; failures
      // never break the patch.
      try {
        const substitutionLedger = await loadGateLedger({ workspaceRoot: root });
        const due = resolveDueSubstitutions({
          evaluation: gateCheck.evaluation,
          ledger: substitutionLedger,
        });
        for (const substitution of due) {
          const recorded = await recordMissionSubstitution({ workspaceRoot: root, substitution });
          gateLedgerAfterSubstitution = recorded.ledger;
          telemetry.captureEvent("mac_sidecar_mission_substituted", {
            day: substitution.day,
            reason: substitution.reason,
          });
        }
      } catch (substitutionError) {
        telemetry.captureException(substitutionError, {
          operation: "mission_substitution_record",
          workspace_root: root,
        });
      }
      // §13.4 token expiry surfaced by this evaluation: dueDay passed without
      // strong post-session evidence — the gate re-blocks (handled below).
      // Emitted BEFORE the blocked branch so an expiring-and-blocking gate
      // still reports the miss (escalation-queue data source, §16.2/§20-④).
      const expiredGateIds = gateCheck?.evaluation?.expiredTokenGateIds ?? [];
      if (expiredGateIds.length) {
        const gateLedgerSnapshot = await loadGateLedger({ workspaceRoot: root });
        const expiredTotal = Object.values(gateLedgerSnapshot.gates)
          .filter((entry) => entry?.interventionToken?.expired === true)
          .length;
        for (const expiredGateId of expiredGateIds) {
          telemetry.captureEvent("mac_sidecar_oh_intervention_evidence_missed", {
            gate_id: expiredGateId,
            trigger_id: interventionTriggerForGate(expiredGateId) || "interview_confession",
            consecutive_count: expiredTotal,
          });
        }
      }
      if (gateCheck.blocked) {
        const current = await loadDayProgress({ workspaceRoot: root });
        const blockedCurrentDay = current
          ? computeDayNumber({ challengeStartedAt: current.challengeStartedAt })
          : null;
        send(socket, {
          type: "day_progress_state",
          workspaceRoot: root,
          dayProgress: current,
          currentDay: blockedCurrentDay,
          gateBlocked: {
            gateId: gateCheck.gate.gateId,
            title: gateCheck.gate.title,
            blockedReason: gateCheck.gate.blockedReason,
            blockedStep: gateCheck.gate.blockedStep,
            requiredEvidence: gateCheck.gate.requiredEvidence,
          },
          message: buildGateBlockedMessage(gateCheck.gate),
        });
        if (gateCheck.stateChanged) {
          telemetry.captureEvent("mac_sidecar_gate_blocked", {
            gate_id: gateCheck.gate.gateId,
            blocked_reason: gateCheck.gate.blockedReason,
            day: gateTargetDay,
            workspace_basename: path.basename(root),
          });
          // §13.1: milestone gate 실패(G2/G4/G5/G7)는 즉시·강제 표면화되는
          // intervention 트리거다. G1은 confession 경로로만 표면화된다.
          const interventionTrigger = interventionTriggerForGate(gateCheck.gate.gateId);
          const interventionEvent = interventionTrigger
            ? buildInterventionRequiredEvent({
                workspaceRoot: root,
                triggerId: interventionTrigger,
                day: gateTargetDay,
              })
            : null;
          if (interventionEvent) {
            broadcast(interventionEvent);
            telemetry.captureEvent("mac_sidecar_oh_intervention_triggered", {
              trigger_id: interventionTrigger,
              severity: "immediate",
            });
          }
        }
        return;
      }
    }
    // Patch the step FIRST: patchDayStep validates day/step and throws on a day-kind
    // mismatch or out-of-range day BEFORE any memory write, so a rejected patch never
    // orphans a commitment/cycle that would read back as a real closed cycle.
    const dayProgress = await patchDayStep({
      workspaceRoot: root,
      day,
      stepId,
      status,
      goalText: payload.goalText ?? payload.goal_text,
      kind: payload.kind,
    });
    if (path.resolve(root) === path.resolve(workspaceRoot)) {
      state.dayProgress = dayProgress;
    }
    // The step is now validly completed — record the memory side-effects.
    // user-origin: commitmentText is the founder's own typed next customer action.
    const cycleNo = Number.parseInt(day, 10) || null;
    if (gate.mode === "commit" && cycleNo) {
      const resolvedCommitmentText = formatStructuredCommitmentText(structuredCommitment) || String(commitmentText || "").trim();
      await appendCommitment({
        workspaceRoot: root,
        text: resolvedCommitmentText,
        cycle: cycleNo,
        day: cycleNo,
        originText: resolvedCommitmentText,
        commitment: structuredCommitment ?? undefined,
      });
      await appendCycle({ workspaceRoot: root, cycle: cycleNo, day: cycleNo, step: stepId, outcome: "success", lastAssignment: resolvedCommitmentText });
      await applyPredictionPatch({ workspaceRoot: root, cycle: cycleNo, predictionText, predictionVerdict });
      await recompileCompiledTruth({ workspaceRoot: root });
      await refreshDayMemory({ workspaceRoot: root, day: cycleNo }).catch((error) => {
        telemetry.captureException(error, { operation: "day_memory_refresh_after_interview_commit" });
      });
    } else if (gate.mode === "confess" && cycleNo) {
      // gate-held-as-win: outcome `blocked` mirrors gstack's abort/blocked ledger. The
      // confession is the note, NOT the next assignment — don't label the excuse a commitment.
      await appendCycle({ workspaceRoot: root, cycle: cycleNo, day: cycleNo, step: stepId, outcome: "blocked", note: confession, lastAssignment: "" });
      // calibration-lite: still grade the prior forecast on a confess-close (grade-only — a
      // confession opens no new commitment, so no new prediction is captured here).
      await applyPredictionPatch({ workspaceRoot: root, cycle: cycleNo, predictionText: undefined, predictionVerdict });
      await recompileCompiledTruth({ workspaceRoot: root });
      await refreshDayMemory({ workspaceRoot: root, day: cycleNo }).catch((error) => {
        telemetry.captureException(error, { operation: "day_memory_refresh_after_interview_confess" });
      });
      // §13.1: confession은 즉시 축약형(§13.3a) intervention을 표면화한다 —
      // G1 포함 모든 interview 스텝 동일. 카드의 OH 시작이 office_hours_start
      // payload.trigger로 이어져 같은 계약(§13.3)을 주입받는다.
      const confessionEvent = buildInterventionRequiredEvent({
        workspaceRoot: root,
        triggerId: "interview_confession",
        abbreviated: true,
        day: cycleNo,
      });
      if (confessionEvent) {
        broadcast(confessionEvent);
        telemetry.captureEvent("mac_sidecar_oh_intervention_triggered", {
          trigger_id: "interview_confession",
          severity: "immediate",
        });
      }
    }
    telemetry.captureEvent("mac_sidecar_day_progress_updated", {
      day: Number(day) || null,
      step_id: String(stepId ?? ""),
      status: String(status ?? ""),
      gate_mode: gate.mode,
      workspace_basename: path.basename(root),
    });
    const currentDay = dayProgress
      ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt })
      : null;
    broadcast({
      type: "day_progress_state",
      workspaceRoot: root,
      dayProgress,
      currentDay,
      officeHoursMemory: await loadOfficeHoursMemorySummary(root, currentDay),
      officeHoursHistory: await loadOfficeHoursHistorySummary(root, currentDay),
      dayReviews: await loadOfficeHoursDayReviews(root, dayProgress, currentDay),
      evidenceOS: await loadOfficeHoursEvidenceOS(root, dayProgress, currentDay),
    });
    // §11.0/§17.2: entering the execution step loads the day's IDD mission as a
    // mission_card. Emission points: a Day 2+ interview close (execution becomes
    // the active surface) or an explicit non-done execution-step patch. Emission
    // failures never break the patch (additive surface).
    const missionDay = Number.parseInt(day, 10) || null;
    const executionEntered = missionDay && missionDay >= 2 && (
      (String(stepId) === "interview" && String(status) === "done")
      || (String(stepId) === "execution" && String(status) !== "done")
    );
    if (executionEntered) {
      try {
        const gateLedger = gateLedgerAfterSubstitution ?? await loadGateLedger({ workspaceRoot: root });
        const missionCard = buildMissionCardEvent({
          workspaceRoot: root,
          day: missionDay,
          gateEvaluation: gateCheck?.evaluation ?? null,
          substitutions: gateLedger.substitutions,
        });
        if (missionCard) broadcast(missionCard);
      } catch (missionError) {
        telemetry.captureException(missionError, {
          operation: "mission_card_emit",
          workspace_root: root,
        });
      }
    }
    // §12: adaptive rules evaluate on the day loop's authoritative write —
    // fire-and-forget, persisted to gate-ledger adaptiveEvents, one firing
    // per rule per day. Immediate-grade firings surface the registered
    // intervention card (§13.1); evaluation failures never break the patch.
    if (missionDay) {
      void runAdaptiveRulesCycle({ workspaceRoot: root, day: missionDay })
        .then(({ fired }) => {
          for (const rule of fired) {
            telemetry.captureEvent("mac_sidecar_adaptive_rule_fired", {
              rule_id: rule.ruleId,
              confidence: rule.confidence,
              user_label: "",
            });
            const triggerId = `rule_${rule.ruleId.replace(/-/g, "")}`;
            const interventionEvent = rule.ohEscalation !== "none" && rule.ohEscalation !== "joins_G5"
              ? buildInterventionRequiredEvent({
                  workspaceRoot: root,
                  triggerId,
                  day: missionDay,
                })
              : null;
            if (interventionEvent) {
              broadcast(interventionEvent);
              telemetry.captureEvent("mac_sidecar_oh_intervention_triggered", {
                trigger_id: triggerId,
                severity: interventionEvent.intervention.severity,
              });
            }
          }
        })
        .catch((ruleError) => {
          telemetry.captureException(ruleError, {
            operation: "adaptive_rules_cycle",
            workspace_root: root,
          });
        });
    }
  } catch (error) {
    telemetry.captureException(error, {
      operation: "day_progress_patch",
      workspace_root: root,
    });
    send(socket, {
      type: "day_progress_state",
      workspaceRoot: root,
      success: false,
      error: formatError(error),
    });
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
          : prompt.startsWith("/office-hours")
            ? "office_hours"
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

  const officeHoursMatch = prompt.match(/^\/office-hours(?:\s+([\s\S]*))?$/i);
  if (officeHoursMatch) {
    const context = (officeHoursMatch[1] || "").trim() || activeOfficeHoursContext(session);
    await runOfficeHours(session, {
      context,
      originalPrompt: prompt,
      source: "slash_command",
    });
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

  let officeHoursContext = "";
  let officeHoursRuntimeForRun = null;

  try {
    state.activeRuns.get(session.id).stop = async () => {
      abortController.abort();
    };

    let route = classifyChatExecutionRoute(prompt, { executionIntent });
    officeHoursContext = activeOfficeHoursContext(session);
    officeHoursRuntimeForRun = session.runtime?.officeHours?.active === true
      ? { ...session.runtime.officeHours, context: officeHoursContext }
      : null;
    let officeHoursStructuredInputAsked = false;
    let officeHoursStructuredInputAnswered = false;
    let routedSpecialist = specialist;
    let systemPromptOverride = "";
    if (officeHoursContext) {
      emitOfficeHoursStatus(session, {
        stage: "context_loaded",
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
    }
    if (officeHoursContext && !routedSpecialist) {
      route = {
        ...route,
        executionMode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
        reason: "office_hours_question_continuation",
        contextSummary: "context=office_hours_question",
        inlineBipContext: false,
        approvedToolExecution: false,
      };
      routedSpecialist = selectOfficeHoursSpecialist({
        context: officeHoursContext,
        lastAnswer: prompt,
      });
      emitOfficeHoursStatus(session, {
        stage: "specialist_routed",
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
      const officeHoursSpecialistInjection = buildSpecialistInjection(routedSpecialist, {
        provider: session.provider,
      });
      systemPromptOverride = buildOfficeHoursChatSystemPrompt(workspaceRoot, {
        specialistInjection: officeHoursSpecialistInjection,
        context: officeHoursContext,
        provider: session.provider,
      });
      telemetry.captureEvent("mac_sidecar_specialist_routed", {
        session_id: session.id,
        stage: "office_hours_continuation",
        specialist_id: routedSpecialist.id,
        phase: routedSpecialist.phase,
        decision_kind: routedSpecialist.decisionKind,
        vendor_used: Boolean(
          routedSpecialist?.vendor?.claude?.exists
            && routedSpecialist?.vendor?.codex?.exists,
        ),
      });
    }
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
    if (officeHoursContext) {
      const warmSpec = buildOfficeHoursWarmSpec(session, {
        context: officeHoursContext,
        source: officeHoursRuntimeForRun?.source,
        day: officeHoursRuntimeForRun?.day,
        selectedSources: officeHoursRuntimeForRun?.selectedSources,
      });
      assertOfficeHoursWarmIsNotStale(session, warmSpec);
      telemetry.captureEvent("mac_sidecar_office_hours_question_provider_starting", {
        session_id: session.id,
        provider: session.provider,
        execution_mode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
        warmup_used: isOfficeHoursWarmRuntimeReady(session.runtime, warmSpec),
        continuation: true,
      });
      emitOfficeHoursStatus(session, {
        stage: "provider_starting",
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
    }
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
      specialist: route.executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE ? null : routedSpecialist,
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
        if (officeHoursContext && isOfficeHoursStructuredInputToolEvent(event)) {
          telemetry.captureEvent("mac_sidecar_office_hours_request_user_input_called", {
            session_id: session.id,
            provider: session.provider,
            execution_mode: route.executionMode,
            phase: event.phase || "",
            elapsed_ms: Math.max(0, Math.round(performance.now() - runStartedAt)),
            continuation: true,
          });
          officeHoursStructuredInputAsked = true;
          if (isSuccessfulStructuredInputToolEvent(event)) {
            officeHoursStructuredInputAnswered = true;
          }
        }
        if (officeHoursContext) {
          const status = mapOfficeHoursToolEventToStatus(event);
          if (status) {
            if (status.stage === "tool_running" || status.stage === "structured_input_requested") {
              officeHoursStructuredInputAsked = true;
            }
            emitOfficeHoursStatus(session, {
              ...status,
              messageId: assistantMessage.id,
              elapsedMs: performance.now() - runStartedAt,
            });
          }
        }
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
        session.runtime = attachOfficeHoursRuntime(nextRuntime, officeHoursRuntimeForRun);
        recordMessageTiming(session, assistantMessage, runStartedAt, "runtime.updated", {
          hasCodexThread: Boolean(nextRuntime?.codexThreadId),
          hasClaudeSession: Boolean(nextRuntime?.claudeSessionId),
        }, { once: true, seen: seenRunPhases });
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
      },
      onRunEvent: (event) => {
        if (officeHoursContext && isStructuredInputResponseRunEvent(event)) {
          officeHoursStructuredInputAsked = true;
          officeHoursStructuredInputAnswered = true;
        }
        if (officeHoursContext) {
          const status = mapOfficeHoursRunEventToStatus(event);
          if (status) {
            if (status.stage === "structured_input_requested") {
              officeHoursStructuredInputAsked = true;
            }
            emitOfficeHoursStatus(session, {
              ...status,
              messageId: assistantMessage.id,
              elapsedMs: performance.now() - runStartedAt,
            });
          }
        }
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
      systemPromptOverride,
    });

    session.runtime = attachOfficeHoursRuntime(
      mergeProviderRuntime(session.runtime, runtime),
      officeHoursRuntimeForRun,
    );
    setAssistantText(session, assistantMessage.id, assistantMessage.content);
    recordMessageTiming(session, assistantMessage, runStartedAt, "provider.call_finished");

    if (officeHoursContext) {
      await syncPendingUserInputRequests();
    }
    assistantMessage.state = "final";
    session.status = session.pendingUserInput ? "awaiting_input" : "idle";
    session.error = null;
    if (officeHoursContext) {
      if (!officeHoursStructuredInputAnswered && assistantMessage.inlineDecision) {
        emitOfficeHoursStatus(session, {
          stage: "structured_input_requested",
          messageId: assistantMessage.id,
          elapsedMs: performance.now() - runStartedAt,
        });
      }
      const request = officeHoursStructuredInputAnswered
        ? null
        : await promoteOfficeHoursInlineDecisionPromptCard(session, assistantMessage, {
            context: officeHoursContext,
            source: "office_hours_continuation",
          });
      const officeHoursCurrentRunCreatedPendingQuestion = officeHoursStructuredInputAsked
        && !officeHoursStructuredInputAnswered;
      const incompleteInterview = !request
        && !session.pendingUserInput
        && !officeHoursCurrentRunCreatedPendingQuestion
        ? await detectIncompleteOfficeHoursInterview(session, officeHoursContext)
        : null;
      if (incompleteInterview) {
        failOfficeHoursIncompleteInterview(session, assistantMessage, {
          incomplete: incompleteInterview,
          runStartedAt,
          source: "office_hours_continuation",
        });
        emitAgentEvent(session, assistantMessage.id, {
          eventType: "run.failed",
          error: session.error,
          recoverable: false,
        });
        return;
      }
      emitOfficeHoursStatus(session, {
        stage: session.pendingUserInput ? "question_ready" : "completed",
        messageId: assistantMessage.id,
        requestId: request?.requestId || session.pendingUserInput?.requestId || null,
        elapsedMs: performance.now() - runStartedAt,
      });
    }
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
      if (officeHoursContext) {
        emitOfficeHoursStatus(session, {
          stage: session.runtime?.officeHours?.completedByExpectedCount === true
            ? "completed"
            : "aborted",
          messageId: assistantMessage.id,
          elapsedMs: performance.now() - runStartedAt,
        });
      }
    } else {
      const errorKind = reportProviderRunError(error, {
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
      if (officeHoursContext) {
        emitOfficeHoursStatus(session, {
          stage: "failed",
          detail: assistantMessage.error,
          progressText: assistantMessage.error,
          messageId: assistantMessage.id,
          elapsedMs: performance.now() - runStartedAt,
        });
      }
      emitAgentEvent(session, assistantMessage.id, {
        eventType: "run.failed",
        error: assistantMessage.error,
        recoverable: Boolean(errorKind),
    });
      broadcast({
        type: "error",
        sessionId: session.id,
        provider: session.provider,
        message: assistantMessage.error,
        ...providerRecoverableErrorEnvelope(errorKind),
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
 *  - No instant_chat / agentic / memory_chat split.
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
    // Single channel — no fast lane split.
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
      const errorKind = reportProviderRunError(error, {
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
        recoverable: Boolean(errorKind),
    });
      broadcast({
        type: "error",
        sessionId: session.id,
        provider: session.provider,
        message: assistantMessage.error,
        ...providerRecoverableErrorEnvelope(errorKind),
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

function normalizeWarmSessionPurpose(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === OFFICE_HOURS_QUESTION_EXECUTION_MODE || normalized === "office_hours") {
    return OFFICE_HOURS_QUESTION_EXECUTION_MODE;
  }
  return "";
}

function sha256Short(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

function buildOfficeHoursWarmSpec(session, payload = {}) {
  const officeHours = session?.runtime?.officeHours || {};
  const context = clampOfficeHoursContext(
    payload.context ?? officeHours.context ?? "",
  );
  const selectedSources = normalizeOfficeHoursSelectedSources(payload.selectedSources ?? officeHours.selectedSources ?? []);
  const day = normalizeOfficeHoursDay(payload.day ?? payload.officeHoursDay ?? officeHours.day);
  const source = String(payload.source ?? officeHours.source ?? "office_hours_screen").trim() || "office_hours_screen";
  return {
    purpose: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
    executionMode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
    model: session?.model || "",
    workspaceRoot,
    day,
    source,
    selectedSources,
    selectedSourcesFingerprint: sha256Short(JSON.stringify(selectedSources)),
    contextFingerprint: context ? sha256Short(context) : null,
    context,
  };
}

function warmSpecMatches(warm = {}, spec = {}) {
  if (!warm || !spec) return false;
  return warm.state === "ready"
    && warm.purpose === spec.purpose
    && warm.executionMode === spec.executionMode
    && warm.workspaceRoot === spec.workspaceRoot
    && (warm.model || "") === (spec.model || "")
    && (warm.day || null) === (spec.day || null)
    && (warm.source || "") === (spec.source || "")
    && (warm.selectedSourcesFingerprint || "") === (spec.selectedSourcesFingerprint || "")
    && (warm.contextFingerprint || null) === (spec.contextFingerprint || null);
}

function isOfficeHoursWarmRuntimeReady(runtime = {}, spec = {}) {
  const warm = runtime?.codexWarm;
  const meta = runtime?.codexThreadMeta || {};
  return Boolean(
    runtime?.codexThreadId
      && warmSpecMatches(warm, spec)
      && meta.workspaceRoot === spec.workspaceRoot
      && meta.executionMode === spec.executionMode,
  );
}

function assertOfficeHoursWarmIsNotStale(session, spec = {}) {
  const warm = session?.runtime?.codexWarm;
  if (!warm || warm.purpose !== OFFICE_HOURS_QUESTION_EXECUTION_MODE) return;
  if (warm.state === "warming") {
    throw new Error("Office Hours question warm-up is still running; refusing to fall back to a cold run.");
  }
  if (
    (warm.state === "failed" || warm.state === "cancelled")
    && warm.contextFingerprint
    && warm.contextFingerprint === spec.contextFingerprint
  ) {
    throw new Error(`Office Hours question warm-up ${warm.state}; refusing to fall back to a cold run.`);
  }
  if (warm.state === "ready" && !isOfficeHoursWarmRuntimeReady(session.runtime, spec)) {
    throw new Error("Office Hours question warm-up metadata is stale or mismatched; refusing to fall back to a cold run.");
  }
}

async function warmSession(session, payload = {}) {
  if (!session || session.provider !== "codex") return;
  if (process.env.AGENTIC30_DISABLE_CODEX_WARMUP === "1") return;
  if (state.activeRuns.has(session.id) || state.warmRuns.has(session.id)) return;

  const purpose = normalizeWarmSessionPurpose(payload.purpose)
    || (session.runtime?.officeHours ? OFFICE_HOURS_QUESTION_EXECUTION_MODE : "");
  if (purpose !== OFFICE_HOURS_QUESTION_EXECUTION_MODE) return;

  const warmSpec = buildOfficeHoursWarmSpec(session, payload);
  if (!warmSpec.contextFingerprint) {
    setCodexWarmRuntime(session, {
      ...warmSpec,
      state: "failed",
      error: "Office Hours question warm-up requires an explicit context fingerprint.",
      failedAt: new Date().toISOString(),
    });
    await persistSessions();
    broadcast({ type: "session_updated", session });
    return;
  }

  if (isOfficeHoursWarmRuntimeReady(session.runtime, warmSpec)) return;

  const authState = getProviderAuthState(session.provider);
  if (!authState.available) {
    setCodexWarmRuntime(session, {
      ...warmSpec,
      state: "failed",
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
    ...warmSpec,
    state: "warming",
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
        "Prepare this Agentic30 Office Hours question session.",
        "Start the provider thread for the Office Hours question-generation mode.",
        "Do not answer the user yet.",
        "Do not inspect files, call tools, or generate the first question.",
      ].join("\n"),
      model: session.model,
    workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      executionMode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
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
        ...warmSpec,
        state: "ready",
        startedAt: session.runtime?.codexWarm?.startedAt,
        completedAt: new Date().toISOString(),
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        timings,
    });
      telemetry.captureEvent("mac_sidecar_office_hours_warmup_completed", {
        session_id: session.id,
        provider: session.provider,
        execution_mode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
        elapsed_ms: session.runtime.codexWarm.elapsedMs,
      });
    }
  } catch (error) {
    if (abortController.signal.aborted || error?.name === "AbortError") {
      setCodexWarmRuntime(session, {
        ...warmSpec,
        state: "cancelled",
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    } else {
      setCodexWarmRuntime(session, {
        ...warmSpec,
        state: "failed",
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

function enqueueSilentPrompt(session, prompt, { executionIntent = "chat" } = {}) {
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
    silent: true,
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

function isCodexOfficeHoursNonBlockingPendingInput(session = null, pendingUserInput = null) {
  return String(session?.provider || "") === "codex"
    && String(pendingUserInput?.toolName || "") === CODEX_STRUCTURED_INPUT_TOOL
    && isOfficeHoursStructuredInputMode(pendingUserInput?.generation?.mode);
}

function normalizeOfficeHoursDay(value) {
  const number = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function isDay2PlusOfficeHoursDay(day = null) {
  const normalized = normalizeOfficeHoursDay(day);
  return Number.isFinite(normalized) && normalized >= 2;
}

function officeHoursSourceGateEventPayload({ sessionId = null, gate } = {}) {
  return {
    type: "office_hours_source_gate",
    ...(sessionId ? { sessionId } : {}),
    day: gate?.day ?? null,
    success: gate?.ok !== false,
    status: gate?.ok === false ? "blocked" : "ready",
    detail: gate?.message || "",
    officeHoursSourceGate: gate,
  };
}

function sendOfficeHoursSourceGate(socket, { sessionId = null, gate } = {}) {
  const payload = officeHoursSourceGateEventPayload({ sessionId, gate });
  if (socket) {
    send(socket, payload);
  } else {
    broadcast(payload);
  }
}

function buildOfficeHoursRuntime(context = "", source = "manual", day = null, selectedSources = []) {
  const normalizedDay = normalizeOfficeHoursDay(day);
  const runtime = {
    active: true,
    source: String(source || "manual"),
    startedAt: new Date().toISOString(),
    context: clampOfficeHoursContext(stripOfficeHoursResumePreambleBlocks(context)),
  };
  if (normalizedDay) runtime.day = normalizedDay;
  const normalizedSelectedSources = normalizeOfficeHoursSelectedSources(selectedSources);
  if (normalizedSelectedSources.length) runtime.selectedSources = normalizedSelectedSources;
  return runtime;
}

async function buildExternalOfficeHoursDigestSignals(session, {
  context = "",
  gate,
  abortController,
} = {}) {
  const externalSources = selectedExternalOfficeHoursSources(gate);
  if (!externalSources.length) return [];
  let externalText = "";
  let failureDetail = "";
  try {
    await runProviderStream({
      provider: session.provider,
      sessionRuntime: session.runtime,
      prompt: buildExternalOfficeHoursDigestPrompt({
        sources: externalSources,
        window: gate.window,
        context,
      }),
      model: session.model,
      workspaceRoot,
      abortController,
      sessionIdForMcp: null,
      executionMode: "office_hours_digest_read_only",
      approvedToolExecution: false,
      onTextDelta: (text) => {
        externalText += String(text || "");
      },
      onTextReplace: (text) => {
        externalText = String(text || "");
      },
    });
  } catch (error) {
    // A provider/MCP outage must not surface as a raw run failure. Aborts keep
    // propagating; everything else falls through with empty text so the selected
    // sources resolve to "failed" and finalize throws the structured
    // OfficeHoursSourceGateError (connect actions + retry, not a crash).
    if (abortController?.signal?.aborted || error?.name === "AbortError") {
      throw error;
    }
    telemetry.captureException(error, {
      operation: "office_hours_external_digest",
      sources: externalSources.join(","),
    });
    externalText = "";
    const message = String(error?.message || error || "");
    failureDetail = isProviderUsageLimitMessage(message)
      ? `AI 프로바이더 사용량 한도로 수집하지 못했어요 — 한도 리셋 후 다시 시도해 주세요. MCP 연결은 정상이에요. (${message.slice(0, 140)})`
      : `외부 MCP digest 실행이 실패했어요 — 잠시 후 다시 시도해 주세요. (${message.slice(0, 140)})`;
  }
  return normalizeExternalOfficeHoursDigest(externalText, externalSources, { failureDetail });
}

async function prepareDailyOfficeHoursDigest(session, {
  context = "",
  day = null,
  selectedSources = [],
  abortController = null,
} = {}) {
  const gate = await evaluateOfficeHoursSourceGate({
    workspaceRoot,
    day,
    selectedSources,
    provider: session.provider,
    appSupportPath,
  });
  sendOfficeHoursSourceGate(null, {
    sessionId: session.id,
    gate,
  });
  if (!gate.ok) {
    throw new OfficeHoursSourceGateError(gate);
  }

  // Collection can take seconds (gh CLI + external MCP digest); without this the
  // Mac client sits silent between "gate passed" and the first question.
  broadcast({
    type: "office_hours_daily_digest_result",
    sessionId: session.id,
    day: gate.day ?? null,
    status: "collecting",
    detail: "Day 2+ Office Hours digest collecting.",
  });

  const localSignals = await collectLocalDailyOfficeHoursSignals({
    workspaceRoot,
    gate,
  });
  const externalSignals = await buildExternalOfficeHoursDigestSignals(session, {
    context,
    gate,
    abortController,
  });
  const digest = finalizeDailyOfficeHoursDigest({
    gate,
    localSignals,
    externalSignals,
    context,
  });
  await persistDailyOfficeHoursDigest({ workspaceRoot, digest });
  broadcast({
    type: "office_hours_daily_digest_result",
    sessionId: session.id,
    day: digest.day,
    officeHoursDailyDigest: digest,
    status: "ready",
    detail: "Day 2+ Office Hours digest ready.",
  });
  return digest;
}

function isGetUsersOfficeHoursContext(context = "") {
  return /^Goal lane:\s*get_users\b/im.test(String(context || ""));
}

function latestGetUsersActiveUserDefinitionTurn(turnLog = {}) {
  const turns = Array.isArray(turnLog?.turns) ? turnLog.turns : [];
  return turns
    .filter((turn) =>
      String(turn?.signalId || turn?.signal_id || "").trim() === "get_users_active_user_definition"
        || /활성 사용자 기준|active user definition/i.test(`${turn?.signalLabel || ""}\n${turn?.questionText || ""}`),
    )
    .at(-1) || null;
}

async function buildGetUsersActiveUserDefinitionPreamble({ workspaceRoot, context } = {}) {
  if (!isGetUsersOfficeHoursContext(context)) return "";
  let turn = null;
  try {
    turn = latestGetUsersActiveUserDefinitionTurn(await loadOfficeHoursTurnLog({ workspaceRoot }));
  } catch {
    turn = null;
  }
  const response = String(turn?.responseText || "").replace(/\s+/g, " ").trim();
  const description = String(turn?.responseDescription || "").replace(/\s+/g, " ").trim();
  if (response) {
    return [
      "GET_USERS_ACTIVE_USER_DEFINITION",
      "signalId: get_users_active_user_definition",
      `Active user definition: ${response}`,
      description ? `Active user definition detail: ${description}` : "",
      "Counting rule: only unique people/accounts in the selected ICP that complete this chosen activation action count toward the 100 active users.",
      "Anti-counts: signup, waitlist, pageview, like, follower, or polite interest alone do not count.",
    ].filter(Boolean).join("\n");
  }
  return [
    "GET_USERS_ACTIVE_USER_DEFINITION_MISSING: true",
    "Before any acquisition/channel execution, ask the active-user-definition card with signalId get_users_active_user_definition.",
    "Active user definition question: 이 목표에서 활성 사용자 1명으로 세려면 ICP가 어떤 핵심 행동을 끝내야 하나요?",
    "Anti-counts: signup, waitlist, pageview, like, follower, or polite interest alone do not count.",
  ].join("\n");
}

// ── Morning briefing ─────────────────────────────────────────────────────────
// Reuses the Day 2+ Office Hours digest collectors (git / gh CLI / PostHog /
// Cloudflare) but runs session-less: sources are auto-selected from whatever is
// actually connected, external sources are best-effort (required=false, so a
// failed MCP digest renders as a disconnected card instead of blocking), and the
// result is shaped by morning-briefing.mjs into the briefing screen payload.

// 실측(2026-06-10~11): MCP 도구 탐색(ToolSearch)+집계 쿼리+JSON 작성에 90초는
// 부족했고(69초 시점 abort), 두 소스를 묶은 한 실행은 180초도 상습 초과했다.
// 소스당 실행 분리 후 posthog ~50초, cloudflare 헤비 케이스 ~175초 실측 —
// 소스당 타임아웃은 여유분 포함 240초. 브리핑은 "collecting" 상태를 띄우는
// 백그라운드 수집이고 소스들이 병렬이라 체감 대기는 가장 느린 소스 하나다.
const MORNING_BRIEFING_PROVIDER_TIMEOUT_MS = 240_000;
const MORNING_BRIEFING_ALL_SOURCES = Object.freeze(["git", "gh_cli", "posthog", "cloudflare"]);

function isSameLocalDate(iso, now = new Date()) {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return false;
  const a = new Date(ts);
  return a.getFullYear() === now.getFullYear()
    && a.getMonth() === now.getMonth()
    && a.getDate() === now.getDate();
}

function pickMorningBriefingProvider(preferredProvider = "") {
  const preferred = String(preferredProvider || "").trim().toLowerCase();
  const candidates = ["claude", "codex"];
  const ordered = candidates.includes(preferred)
    ? [preferred, ...candidates.filter((provider) => provider !== preferred)]
    : candidates;
  for (const provider of ordered) {
    if (getProviderAuthState(provider).available) return provider;
  }
  return "";
}

// Settings 상태 배지의 MCP OAuth 판정 기준 프로바이더. "상태 확인"은 연결을
// 만들지 않으므로 가용성 폴백 없이 선택값(claude/codex)을 그대로 존중한다 —
// 선택 프로바이더가 미로그인이어도 "그 프로바이더 기준 미검증"이 진실이다.
// claude/codex 외 선택(gemini 등)만 가용 프로바이더로 폴백한다.
function resolveIntegrationStatusProvider(preferredProvider = "") {
  const requested = String(preferredProvider || "").trim().toLowerCase();
  if (["claude", "codex"].includes(requested)) return requested;
  return pickMorningBriefingProvider("");
}

function evaluateMorningBriefingSourceGate({ day = 2, preferredProvider = "" } = {}) {
  return evaluateOfficeHoursSourceGate({
    workspaceRoot,
    day,
    selectedSources: MORNING_BRIEFING_ALL_SOURCES,
    provider: pickMorningBriefingProvider(preferredProvider),
    appSupportPath,
    allowLocalDevFastDays: false,
  });
}

// 브리핑 서빙 직전 연결 상태 라이브 오버레이. 디스크 스냅샷의 sync.sources는
// 생성 시점 연결 상태라, 이후 Settings의 MCP OAuth 연결/해제·프로바이더 전환을
// 모른다(설정 "MCP 연결됨" vs 브리핑 "미연결" 모순의 근본 원인). 연결 상태의
// 진실은 refresh와 같은 라이브 게이트다 — 스냅샷을 즉시 emit해 첫 페인트를
// 지키고, probe(gh auth 등 ~1s) 완료 후 행이 실제로 바뀐 경우에만 한 번 더
// emit한다. 오버레이 결과는 persist하지 않는다.
async function emitMorningBriefingWithLiveSync({ briefing, previous = null, preferredProvider = "", emit }) {
  emit(briefing ?? null, previous);
  if (!briefing) return;
  try {
    const gate = await evaluateMorningBriefingSourceGate({
      // Day 1 고정 인터뷰 short-circuit(빈 sources) 우회 — 연결 상태는 Day와
      // 무관하게 항상 probe한다. refresh의 Math.max(2, day) 클램프와 같은 이유.
      day: 2,
      preferredProvider,
    });
    const { briefing: live, changed } = applyMorningBriefingLiveSync(briefing, gate.sources || []);
    if (changed) emit(live, previous);
  } catch (error) {
    // fail-open: probe가 죽어도 스냅샷 서빙은 이미 끝났다.
    telemetry.captureException(error, { operation: "morning_briefing_live_sync" });
  }
}

function scheduleMorningBriefingRefresh({
  reason = "manual",
  force = false,
  preferredProvider = "",
  targetSocket = null,
} = {}) {
  if (state.morningBriefingRefreshPromise) {
    send(targetSocket, { type: "morning_briefing_status", status: { state: "collecting", reason } });
    return state.morningBriefingRefreshPromise;
  }
  const promise = runMorningBriefingRefresh({ reason, force, preferredProvider }).finally(() => {
    state.morningBriefingRefreshPromise = null;
    state.morningBriefingProgressTracker = null;
  });
  state.morningBriefingRefreshPromise = promise;
  return promise;
}

async function runMorningBriefingRefresh({ reason = "manual", force = false, preferredProvider = "" } = {}) {
  const startedAt = Date.now();
  broadcast({ type: "morning_briefing_status", status: { state: "collecting", reason } });
  try {
    const store = await loadMorningBriefingStore({ workspaceRoot });
    // A persisted "locked" briefing predates Day-1 support — never serve it from
    // the same-date cache; fall through and collect a real one.
    const cachedIsLocked = store.current?.status?.state === "locked";
    if (!force && !cachedIsLocked && store.current && isSameLocalDate(store.current.generatedAt, new Date())) {
      await emitMorningBriefingWithLiveSync({
        briefing: store.current,
        previous: store.previous,
        preferredProvider,
        emit: (morningBriefing, morningBriefingPrevious) => broadcast({
          type: "morning_briefing_result",
          morningBriefing,
          morningBriefingPrevious,
        }),
      });
      return store.current;
    }

    const day = await challengeElapsedOfficeHoursDay();
    // Day 1 gets a real briefing from git/gh CLI (plus PostHog/Cloudflare when
    // already connected). The gate probe is clamped to >= 2 because the Office
    // Hours gate short-circuits Day 1 (fixed interview) with zero sources —
    // the briefing must still probe what is actually connected.
    // 게이트의 MCP OAuth 판정은 브리핑을 실제로 실행할 프로바이더 기준이어야
    // 한다 — collectMorningBriefingExternalSignals의 primary와 같은 계산.
    const probeGate = await evaluateMorningBriefingSourceGate({
      day: Math.max(2, Number.isFinite(day) ? day : 2),
      preferredProvider,
    });
    const readySources = (probeGate.sources || [])
      .filter((source) => source.state === "ready")
      .map((source) => source.id);
    // Briefing gate: selected = whatever is connected, required = none. The
    // briefing renders disconnected sources as connect pills instead of blocking
    // the whole screen the way the Office Hours interview gate does.
    const gate = {
      ...probeGate,
      ok: true,
      blocking: false,
      selectedSources: readySources,
      sources: (probeGate.sources || []).map((source) => ({
        ...source,
        selected: readySources.includes(source.id),
        required: false,
      })),
    };

    // 카드별 라이브 진행: 수집이 분 단위로 걸리는 동안 각 카드에 스피너와
    // 에이전트 로그를 스트리밍한다. ready인 카드만 begin — 미연결 카드에
    // 유령 스피너를 만들지 않는다.
    const progress = createMorningBriefingProgressTracker({
      emit: (snapshot) => broadcast({ type: "morning_briefing_progress", morningBriefingProgress: snapshot }),
    });
    state.morningBriefingProgressTracker = progress;
    const githubTracked = readySources.includes("git") || readySources.includes("gh_cli");
    if (githubTracked) progress.begin("github", "git · gh CLI 신호 수집 중");
    if (readySources.includes("cloudflare")) progress.begin("cloudflare", "Cloudflare MCP digest 수집 중");
    if (readySources.includes("posthog")) progress.begin("posthog", "PostHog MCP digest 수집 중");

    const localSignals = await collectLocalDailyOfficeHoursSignals({ workspaceRoot, gate });
    if (githubTracked) progress.log("github", "git 커밋 · gh CLI 신호 집계 완료");
    const external = await collectMorningBriefingExternalSignals({ gate, preferredProvider, progress });
    // §15.4: 활성 사용자 스냅샷은 브리핑 수집 사이클에 편승한다(일 1회 — 같은
    // 날짜 스냅샷은 모듈이 교체). 미연동/실패는 아무것도 기록하지 않는다
    // (fail-closed — G4②는 §21 provisional 경로로 처리). 브리핑을 막지 않는다.
    void collectActiveUserSnapshot({
      workspaceRoot,
      day: Number.isFinite(day) ? day : null,
      env: process.env,
      appSupportPath,
    }).then((result) => {
      if (result.status === "ok") {
        telemetry.captureEvent("mac_sidecar_active_user_snapshot", {
          active_user_count: result.snapshot.activeUserCount,
          day: result.snapshot.day,
        });
      }
    }).catch((error) => {
      telemetry.captureException(error, { operation: "active_user_snapshot" });
    });
    const [cloudflareDirect, posthogDirect] = await Promise.all([
      readySources.includes("cloudflare")
        ? collectCloudflareDirectDrilldown({ window: gate.window, appSupportPath }).catch((error) => {
            telemetry.captureException(error, { operation: "morning_briefing_cloudflare_direct" });
            return null;
          })
        : Promise.resolve(null),
      readySources.includes("posthog")
        ? collectPosthogDirectDrilldown({ window: gate.window, appSupportPath }).catch((error) => {
            telemetry.captureException(error, { operation: "morning_briefing_posthog_direct" });
            return null;
          })
        : Promise.resolve(null),
    ]);
    const cloudflareDirectSource = cloudflareSourceSignalFromDrilldown(
      cloudflareDirect,
      external.sources.find((source) => source.id === "cloudflare") || {},
    );
    const externalSourcesForDigest = cloudflareDirectSource
      ? external.sources.map((source) => source.id === "cloudflare"
          ? {
              ...source,
              ...cloudflareDirectSource,
              selected: source.selected,
              required: source.required,
              checkedAt: source.checkedAt,
            }
          : source)
      : external.sources;
    const digest = finalizeDailyOfficeHoursDigest({
      gate,
      localSignals,
      externalSignals: externalSourcesForDigest,
      context: "",
    });
    const previousMetrics = store.current?.metrics
      || store.history[store.history.length - 1]?.metrics
      || {};
    // Direct collectors carry the numbers: git/gh CLI for GitHub, vendor HTTP
    // APIs for Cloudflare (GraphQL Analytics) and PostHog (Query API/HogQL).
    // The provider digest's drilldown only fills narrative sections the APIs
    // cannot produce (action drafts, app-specific funnels).
    if (githubTracked) progress.log("github", "GitHub 드릴다운 집계 중");
    const githubDrilldown = await collectGithubDrilldown({
      workspaceRoot,
      window: gate.window,
      gitSource: localSignals.find((source) => source.id === "git"),
      ghSource: localSignals.find((source) => source.id === "gh_cli"),
      previousCommitCount: previousMetrics.github ?? null,
    }).catch((error) => {
      telemetry.captureException(error, { operation: "morning_briefing_github_drilldown" });
      return null;
    });
    if (githubTracked) progress.finish("github", { detail: "수집 완료" });
    const briefing = buildMorningBriefing({
      digest,
      day,
      previous: store.current ? { metrics: store.current.metrics } : null,
      history: store.history,
      drilldowns: mergeMorningBriefingDrilldownMaps(
        {
          ...(githubDrilldown ? { github: githubDrilldown } : {}),
          ...(cloudflareDirect ? { cloudflare: cloudflareDirect } : {}),
          ...(posthogDirect ? { posthog: posthogDirect } : {}),
        },
        external.drilldowns || {},
      ),
    });
    const persistedStore = await persistMorningBriefing({ workspaceRoot, briefing });
    broadcast({
      type: "morning_briefing_result",
      morningBriefing: briefing,
      morningBriefingPrevious: persistedStore.previous,
    });
    telemetry.captureEvent("mac_sidecar_morning_briefing_refresh_completed", {
      reason,
      duration_ms: Date.now() - startedAt,
      day: briefing.day ?? 0,
      ready_sources: readySources.join(","),
      anomaly: briefing.anomaly?.id || "",
      status: briefing.status?.state || "",
    });
    return briefing;
  } catch (error) {
    telemetry.captureException(error, { operation: "morning_briefing_refresh", reason });
    state.morningBriefingProgressTracker?.failAll("브리핑 수집이 실패했어요 — 다시 동기화를 눌러 주세요.");
    const store = await loadMorningBriefingStore({ workspaceRoot });
    await emitMorningBriefingWithLiveSync({
      briefing: store.current,
      preferredProvider,
      emit: (morningBriefing) => broadcast({
        type: "morning_briefing_result",
        morningBriefing,
        status: { state: "failed", detail: "브리핑 수집에 실패했어요. 다시 동기화를 눌러 주세요." },
      }),
    });
    return store.current;
  }
}

async function collectMorningBriefingExternalSignals({ gate, preferredProvider = "", progress = null } = {}) {
  const externalSources = selectedExternalOfficeHoursSources(gate);
  if (!externalSources.length) return { sources: [], drilldowns: {} };
  const primaryProvider = pickMorningBriefingProvider(preferredProvider);
  if (!primaryProvider) {
    return normalizeMorningBriefingExternalDigest("", externalSources, {
      failureDetail: "AI 프로바이더(Claude/Codex) 로그인이 필요해요 — 로그인 후 '다시 동기화'를 눌러 주세요.",
    });
  }
  // 1차 프로바이더가 사용량 한도 등으로 실패하면 로그인돼 있는 다른 프로바이더로
  // 한 번 더 시도한다 — MCP OAuth 토큰은 프로바이더별 캐시라 폴백 쪽도 연결돼
  // 있을 때만 의미가 있지만, 시도 자체는 읽기 전용이라 비용이 없다.
  const fallbackProvider = ["claude", "codex"].find(
    (candidate) => candidate !== primaryProvider && getProviderAuthState(candidate).available,
  );
  const providers = [primaryProvider, ...(fallbackProvider ? [fallbackProvider] : [])];
  // 실측(2026-06-11 아침): 두 소스를 한 실행에 묶으면 ToolSearch+집계 쿼리가
  // 9~14회 왕복으로 늘어나 180초 예산을 상습 초과한다(170초 성공/180초 abort
  // 반복). 소스당 1실행으로 쪼개 병렬 수집 — 왕복이 절반으로 줄어 예산 안에
  // 들고, 한 소스가 느리거나 죽어도 다른 소스 숫자는 산다.
  const perSource = await Promise.all(externalSources.map(async (source) => {
    const label = source === "posthog" ? "PostHog" : "Cloudflare";
    let failureDetail = "";
    for (const provider of providers) {
      progress?.log(source, `${label} MCP digest 수집 시작 (${provider})`);
      const attempt = await runMorningBriefingExternalDigestAttempt({
        gate,
        provider,
        externalSources: [source],
        onToolEvent: (event) => progress?.tool(source, event),
      });
      if (attempt.ok) {
        progress?.finish(source, { detail: "수집 완료" });
        return normalizeMorningBriefingExternalDigest(attempt.text, [source], {
          failureDetail: "외부 MCP digest 응답을 해석하지 못했어요 — '다시 동기화'로 다시 시도해 주세요.",
        });
      }
      if (attempt.timedOut) {
        // 소프트 타임아웃: 집계는 끝났는데 마지막 출력 직전에 예산이 끊기는
        // 케이스가 상습(실측 170초 성공/타임아웃 반복) — 그때까지 스트리밍된
        // 부분 출력에서 완성 JSON을 구제한다.
        const salvaged = salvageMorningBriefingExternalDigest(attempt.text, [source], {
          failureDetail: attempt.failureDetail,
        });
        if (salvaged) {
          progress?.finish(source, { detail: "시간 초과 직전 결과를 구제했어요" });
          return salvaged;
        }
        failureDetail = attempt.failureDetail;
        // 소프트 타임아웃 이후의 폴백 재시도는 브리핑 전체를 분 단위로 늦춘다 — 중단.
        break;
      }
      failureDetail = attempt.failureDetail;
    }
    progress?.finish(source, { state: "failed", detail: failureDetail || `${label} 수집에 실패했어요` });
    return normalizeMorningBriefingExternalDigest("", [source], { failureDetail });
  }));
  return {
    sources: perSource.flatMap((result) => result.sources),
    drilldowns: Object.assign({}, ...perSource.map((result) => result.drilldowns)),
  };
}

async function runMorningBriefingExternalDigestAttempt({ gate, provider, externalSources, onToolEvent = null }) {
  const abortController = new AbortController();
  let externalText = "";
  let timedOut = false;
  try {
    await runWithSoftTimeout({
      timeoutMs: MORNING_BRIEFING_PROVIDER_TIMEOUT_MS,
      abortController,
      onTimeout: () => {
        timedOut = true;
        telemetry.captureEvent("mac_sidecar_morning_briefing_external_timeout", {
          provider,
          sources: externalSources.join(","),
          timeout_ms: MORNING_BRIEFING_PROVIDER_TIMEOUT_MS,
        });
      },
      onLateError: (error) => {
        telemetry.captureException(error, {
          operation: "morning_briefing_external_digest_late",
          provider,
        });
      },
      operation: async () => {
        await runProviderStream({
          provider,
          prompt: buildMorningBriefingExternalDigestPrompt({
            sources: externalSources,
            window: gate.window,
            context: "Morning briefing: aggregate overnight product/traffic evidence only.",
          }),
          workspaceRoot,
          abortController,
          sessionIdForMcp: null,
          executionMode: "office_hours_digest_read_only",
          approvedToolExecution: false,
          onToolEvent,
          onTextDelta: (text) => {
            if (!timedOut) externalText += String(text || "");
          },
          onTextReplace: (text) => {
            if (!timedOut) externalText = String(text || "");
          },
        });
      },
    });
  } catch (error) {
    telemetry.captureException(error, {
      operation: "morning_briefing_external_digest",
      provider,
      sources: externalSources.join(","),
    });
    // 실패 사유를 소스 카드 detail까지 끌고 간다 — "usable summary" 일반 문구는
    // 연결 문제로 오해되기 쉽다(실측: Claude session limit이 '연결 필요'로 표시됨).
    const message = String(error?.message || error || "");
    return {
      ok: false,
      timedOut: false,
      failureDetail: isProviderUsageLimitMessage(message)
        ? `AI 프로바이더 사용량 한도로 수집하지 못했어요 — 한도 리셋 후 '다시 동기화'를 눌러 주세요. MCP 연결은 정상이에요. (${message.slice(0, 140)})`
        : `외부 MCP digest 실행이 실패했어요 — 잠시 후 '다시 동기화'를 눌러 주세요. (${message.slice(0, 140)})`,
    };
  }
  if (timedOut) {
    return {
      ok: false,
      timedOut: true,
      // 타임아웃까지 모인 부분 출력 — 호출자가 완성 JSON 구제를 시도한다.
      text: externalText,
      failureDetail: "외부 MCP digest가 시간 초과됐어요 — MCP 연결은 정상이에요. '다시 동기화'로 다시 시도해 주세요.",
    };
  }
  return { ok: true, timedOut: false, text: externalText, failureDetail: "" };
}

// Day-less Office Hours starts (fresh slash-command or button sessions) must not
// silently skip the Day 2+ source gate and daily digest: fall back to the
// challenge-elapsed day. Fail-open: null keeps the legacy day-less behavior.
async function challengeElapsedOfficeHoursDay() {
  try {
    const dayProgress = state.dayProgress ?? (await loadDayProgress({ workspaceRoot }));
    if (!dayProgress) return null;
    return normalizeOfficeHoursDay(computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt }));
  } catch {
    return null;
  }
}

// Cycle#N read-back: the prior interview's assignment + hard-evidence demand + costume
// detector, injected into the office-hours CONTEXT (survives vendor SKILL.md routing).
// Empty on a cold brain. Reads office-hours-memory, never writes. Fail-open: any error
// yields "" so the interview always proceeds.
async function buildOfficeHoursCyclePreamble(day = null) {
  try {
    const dp = state.dayProgress ?? (await loadDayProgress({ workspaceRoot }));
    const currentDay = normalizeOfficeHoursDay(day) || (dp ? computeDayNumber({ challengeStartedAt: dp.challengeStartedAt }) : null);
    if (!currentDay) return "";
    const [memory, history] = await Promise.all([
      loadOfficeHoursMemory({ workspaceRoot }),
      buildOfficeHoursHistorySummary({ workspaceRoot, day: currentDay }),
    ]);
    return [
      formatPriorCycleOpening(buildPriorCycle(memory, { currentCycle: currentDay })),
      formatOfficeHoursHistoryForPrompt(history),
    ].filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}

function attachOfficeHoursRuntime(runtime = {}, officeHours = null) {
  if (!officeHours) return runtime || {};
  const prior = runtime?.officeHours;
  return {
    ...(runtime || {}),
    officeHours: {
      // The submit handler stamps terminalAnswered on the LIVE session
      // runtime mid-run (when the 대안 비교 closing card is answered); the
      // run-end re-attach passes the run-START officeHours object, so the
      // stamp must be carried forward or the completion signal dies between
      // the closing answer and the run's incomplete-interview check.
      ...(prior?.terminalAnswered === true ? { terminalAnswered: true } : {}),
      ...officeHours,
      active: true,
    },
  };
}

function activeOfficeHoursContext(session = null) {
  const officeHours = session?.runtime?.officeHours;
  if (officeHours?.active !== true) return "";
  return clampOfficeHoursContext(officeHours.context || "");
}

function seedOfficeHoursTranscriptFromTurns(session, turns = []) {
  if (!Array.isArray(turns) || turns.length === 0) return false;
  if (!shouldSeedOfficeHoursResumeTranscript(session)) return false;
  for (const turn of turns) {
    const seededQuestion = makeMessage({ role: "assistant", provider: session.provider, content: turn.questionText, state: "final" });
    const seededAnswer = makeMessage({ role: "user", provider: session.provider, content: turn.responseText, state: "final" });
    seededQuestion.officeHoursSeededTurn = true;
    seededAnswer.officeHoursSeededTurn = true;
    session.messages.push(seededQuestion, seededAnswer);
  }
  return true;
}

function buildOfficeHoursRuntimePromptSnapshots(session, turns = [], day = null) {
  const runtimeDay = normalizeOfficeHoursDay(day)
    || normalizeOfficeHoursDay(session?.runtime?.officeHours?.day);
  const snapshots = dedupeOfficeHoursTurnsKeepLast(Array.isArray(turns) ? turns : [])
    .filter((turn) =>
      turn?.promptSnapshot
        && Array.isArray(turn?.submissions)
        && turn.submissions.length > 0
        && (!runtimeDay || normalizeOfficeHoursDay(turn.day) === runtimeDay))
    .map((turn) => ({
      sessionId: session.id,
      requestId: String(turn.requestId || turn.promptSnapshot?.requestId || ""),
      prompt: {
        ...turn.promptSnapshot,
        sessionId: session.id,
      },
      submissions: turn.submissions,
      submittedAt: turn.revisedAt || turn.occurredAt || new Date().toISOString(),
      editable: true,
      turnSessionId: turn.sessionId || "",
    }))
    .filter((snapshot) => snapshot.requestId && snapshot.prompt?.questions?.length);
  return snapshots;
}

function refreshOfficeHoursRuntimePromptSnapshotsFromTurns(session, turns = []) {
  if (!session?.runtime?.officeHours) return [];
  const snapshots = buildOfficeHoursRuntimePromptSnapshots(
    session,
    turns,
    session.runtime.officeHours.day,
  );
  session.runtime.officeHours.promptSnapshots = snapshots;
  return snapshots;
}

async function refreshOfficeHoursRuntimePromptSnapshots(session) {
  if (!session?.runtime?.officeHours) return [];
  const turnLog = await loadOfficeHoursTurnLog({ workspaceRoot });
  const sessionTurns = (turnLog.turns || []).filter((turn) =>
    String(turn?.sessionId || "") === String(session.id || ""));
  return refreshOfficeHoursRuntimePromptSnapshotsFromTurns(session, sessionTurns);
}

function isLockedDay1GoalOfficeHoursRuntime(officeHours = {}) {
  return String(officeHours?.source || "") === "day1_interview_goal_locked"
    || isOfficeHoursLockedDay1GoalContext(officeHours?.context || "");
}

function resolveOfficeHoursExpectedQuestionCount(session, context = "") {
  const stampedExpected = Number.parseInt(String(session?.runtime?.officeHours?.expectedQuestionCount ?? ""), 10);
  if (Number.isFinite(stampedExpected) && stampedExpected > 0) {
    return stampedExpected;
  }
  return parseExpectedOfficeHoursQuestionCount(
    context || session?.runtime?.officeHours?.context || "",
  );
}

function officeHoursResumeOffset(session) {
  const resumedTurns = Number.parseInt(String(session?.runtime?.officeHours?.resumedTurns ?? ""), 10);
  return Number.isFinite(resumedTurns) ? Math.max(0, resumedTurns) : 0;
}

async function getOfficeHoursQuestionProgress(session, {
  context = "",
  currentRequestId = "",
} = {}) {
  const expected = resolveOfficeHoursExpectedQuestionCount(session, context);
  const currentId = String(currentRequestId || "").trim();
  let answered = officeHoursResumeOffset(session);
  let currentRequestAlreadyRecorded = false;
  let terminalAnswered = session?.runtime?.officeHours?.terminalAnswered === true;

  const turnLog = await loadOfficeHoursTurnLog({ workspaceRoot }).catch((error) => {
    telemetry.captureException(error, {
      operation: "office_hours_question_progress_load",
      session_id: session?.id || "",
    });
    return null;
  });
  if (turnLog) {
    answered += countOfficeHoursTurnsForSession(turnLog, session?.id);
    terminalAnswered = terminalAnswered || hasOfficeHoursTerminalTurnForSession(turnLog, session?.id);
    if (currentId) {
      const turns = Array.isArray(turnLog?.turns) ? turnLog.turns : [];
      currentRequestAlreadyRecorded = turns.some((turn) =>
        String(turn?.sessionId || "") === String(session?.id || "")
          && String(turn?.requestId || "") === currentId
      );
    }
  }

  if (currentId && !currentRequestAlreadyRecorded) {
    answered += 1;
  }

  return {
    expected,
    answered,
    terminalAnswered,
    capReached: Boolean(expected && answered >= expected),
    complete: terminalAnswered || Boolean(expected && answered >= expected),
  };
}

function stampOfficeHoursExpectedCountCompletion(session, progress = {}) {
  if (!session?.runtime?.officeHours || !progress?.capReached) return;
  session.runtime.officeHours = {
    ...session.runtime.officeHours,
    completedByExpectedCount: true,
    completedQuestionCount: progress.answered,
    expectedQuestionCount: progress.expected || session.runtime.officeHours.expectedQuestionCount,
  };
}

function emitOfficeHoursQuestionCapCompleted(session, progress = {}, requestId = null) {
  if (!session?.id || !progress?.capReached) return;
  emitOfficeHoursStatus(session, {
    stage: "completed",
    requestId,
  });
  telemetry.captureEvent("mac_sidecar_office_hours_question_cap_reached", {
    session_id: session.id,
    provider: session.provider,
    expected: progress.expected || 0,
    answered: progress.answered || 0,
    source: session.runtime?.officeHours?.source || "",
  });
}

async function abortActiveOfficeHoursRunAtQuestionCap(session) {
  const activeRun = session?.id ? state.activeRuns.get(session.id) : null;
  if (!activeRun) return;
  try {
    activeRun.abortController?.abort?.();
    await activeRun.stop?.();
  } catch (error) {
    telemetry.captureException(error, {
      operation: "office_hours_question_cap_abort",
      session_id: session?.id || "",
    });
  }
}

// Office Hours loading-card status copy tables (OFFICE_HOURS_STATUS_COPY for
// follow-up questions, OFFICE_HOURS_FIRST_QUESTION_STATUS_COPY for the first one)
// live in ./office-hours-status.mjs (imported above) so the superset invariant
// can be unit-tested. emitOfficeHoursStatus resolves against whichever table the
// caller passes as `copy` — there is no cross-table fallback.

function clampOfficeHoursStatusText(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function emitOfficeHoursStatus(session, {
  stage,
  copy = OFFICE_HOURS_STATUS_COPY,
  title = "",
  detail = "",
  progressText = "",
  messageId = null,
  requestId = null,
  elapsedMs = null,
} = {}) {
  if (!session?.id || !stage) return;
  // Resolve against the caller-selected table only — no cross-table fallback.
  // The first-question table is a superset of the regular one (pinned by test),
  // so a first-question emit never silently falls back to follow-up phrasing.
  const stageCopy = copy[stage] || {};
  const resolvedTitle = clampOfficeHoursStatusText(title || stageCopy.title || "", 120);
  const resolvedDetail = clampOfficeHoursStatusText(detail || stageCopy.detail || "", 240);
  const resolvedProgressText = clampOfficeHoursStatusText(progressText || stageCopy.progressText || resolvedDetail || resolvedTitle, 240);
  if (!resolvedTitle && !resolvedDetail && !resolvedProgressText) return;
  broadcast({
    type: "office_hours_status",
    sessionId: session.id,
    stage,
    title: resolvedTitle,
    detail: resolvedDetail,
    progressText: resolvedProgressText,
    ...(messageId ? { messageId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(Number.isFinite(elapsedMs) ? { elapsedMs: Math.max(0, Math.round(elapsedMs)) } : {}),
  });
}

// Detects an interview run that ended with no question card on deck while the
// session is still short of the expected question count the Mac client embeds
// in the office-hours context ("Expected question count: N"). Expected count is
// a hard upper bound: hitting it is completion, while stopping before it without
// a pending card is a failure.
async function detectIncompleteOfficeHoursInterview(session, context) {
  const progress = await getOfficeHoursQuestionProgress(session, { context });
  if (!progress.expected || progress.complete) return null;
  return { expected: progress.expected, answered: progress.answered };
}

// An interview that stops early is an explicit failure, not a completion: the
// Mac client has no free-chat fallback for an idle office-hours session, so an
// early stop must land in the error state (failure block + retry) instead of
// reading as "completed".
function failOfficeHoursIncompleteInterview(session, assistantMessage, {
  incomplete,
  runStartedAt,
  source,
}) {
  const message = buildOfficeHoursIncompleteInterviewMessage(incomplete);
  assistantMessage.state = "error";
  assistantMessage.error = message;
  if (!assistantMessage.content) {
    assistantMessage.content = message;
  }
  session.status = "error";
  session.error = message;
  telemetry.captureEvent("mac_sidecar_office_hours_incomplete_interview", {
    session_id: session.id,
    provider: session.provider,
    expected_questions: incomplete.expected,
    answered_questions: incomplete.answered,
    source,
  });
  emitOfficeHoursStatus(session, {
    stage: "failed",
    detail: message,
    progressText: message,
    messageId: assistantMessage.id,
    elapsedMs: performance.now() - runStartedAt,
  });
  broadcast({
    type: "error",
    sessionId: session.id,
    message,
  });
}

function mapOfficeHoursRunEventToStatus(event = {}) {
  const phase = String(event?.phase || "");
  if (!phase) return null;
  if (
    phase === "provider.claude.awaiting_user_input"
    || phase === "provider.stub_user_input_request"
  ) {
    return {
      stage: "structured_input_requested",
      requestId: event.requestId || null,
    };
  }
  if (
    phase.endsWith(".stream_opened")
    || phase.endsWith(".run_streamed_call_start")
  ) {
    return { stage: "provider_starting" };
  }
  if (
    phase.endsWith(".first_event")
    || phase.endsWith(".event.turn_started")
    || phase.endsWith(".turn_started")
    || phase.endsWith(".prepare_start")
    || phase.endsWith(".config_built")
  ) {
    return { stage: "provider_thinking" };
  }
  return null;
}

function mapOfficeHoursToolEventToStatus(event = {}) {
  if (isOfficeHoursStructuredInputToolEvent(event)) {
    return {
      stage: event.phase === "result" ? "structured_input_requested" : "tool_running",
    };
  }
  if (event?.phase === "thinking") {
    return { stage: "provider_thinking" };
  }
  if (event?.phase === "use" || event?.phase === "input_delta" || event?.phase === "progress") {
    return { stage: "tool_running" };
  }
  return null;
}

function isOfficeHoursStructuredRequest(request = null) {
  if (!request || typeof request !== "object") return false;
  if (isOfficeHoursStructuredInputMode(request.generation?.mode)) return true;
  return String(request.title || "").trim().toLowerCase() === "office hours";
}

async function promoteOfficeHoursInlineDecisionPromptCard(session, assistantMessage, {
  context = "",
  source = "provider_result",
} = {}) {
  if (!session || !assistantMessage) return null;
  if (session.pendingUserInput) return null;
  if (isOfficeHoursWriteDesignDocContext(context)
    && /generated_by:\s*office-hours|handoff_for:\s*plan-ceo-review|CEO Review Handoff/i.test(String(assistantMessage.content || ""))) {
    return null;
  }
  const payload = buildOfficeHoursInlineStructuredPromptPayload({
    sessionId: session.id,
    provider: session.provider,
    assistantMessage,
    context,
  });
  if (!payload) return null;

  const request = await createUserInputRequest(
    appSupportPath,
    prepareOfficeHoursStructuredInputRequest(payload),
  );
  session.pendingUserInput = request;
  session.status = "awaiting_input";
  session.error = null;
  if (assistantMessage.inlineDecision) {
    delete assistantMessage.inlineDecision;
  }
  telemetry.captureEvent("mac_sidecar_office_hours_inline_structured_card", {
    session_id: session.id,
    provider: session.provider,
    mode: payload.generation?.mode || "",
    source,
  });
  return request;
}

function isSuccessfulStructuredInputToolEvent(event = {}) {
  if (!event || event.phase !== "result") return false;
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const status = String(payload.status || "").toLowerCase();
  if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
    return false;
  }
  const resultText = [
    payload.output,
    payload.result,
    payload.text,
    payload.content,
  ].map((value) => typeof value === "string" ? value : JSON.stringify(value ?? ""))
    .join("\n")
    .toLowerCase();
  if (status === "pending_user_input" || resultText.includes("pending_user_input")) {
    return false;
  }
  const errorMessage = String(payload.errorMessage || payload.error || "").trim();
  if (errorMessage) return false;
  return true;
}

function isStructuredInputResponseRunEvent(event = {}) {
  const phase = String(event?.phase || "");
  if (phase !== "provider.claude.user_input_received") return false;
  return isOfficeHoursStructuredInputToolEvent({
    toolName: event.toolName,
    payload: {
      requestedToolName: event.toolName,
    },
  });
}

function selectOfficeHoursSpecialist({ context = "", lastAnswer = "" } = {}) {
  return selectSpecialist({
    bipSetupGate: currentBipSetupGate(),
    doc: null,
    lastAnswer,
    promptText: "/office-hours",
    observations: context,
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

async function runOfficeHours(session, {
  context = "",
  originalPrompt = "Office Hours",
  source = "manual",
  day = null,
  selectedSources = [],
} = {}) {
  if (state.activeRuns.has(session.id)) {
    throw new Error("This session is already running.");
  }

  const authState = getProviderAuthState(session.provider);
  if (!authState.available) {
    throw new Error(authState.message);
  }

  const abortController = new AbortController();
  const runKey = randomUUID();
  state.activeRuns.set(session.id, {
    runKey,
    abortController,
    stop: async () => {
      abortController.abort();
    },
  });

  const runtimeDay = normalizeOfficeHoursDay(day)
    || normalizeOfficeHoursDay(session.runtime?.officeHours?.day)
    || (await challengeElapsedOfficeHoursDay());
  const normalizedSelectedSources = normalizeOfficeHoursSelectedSources(selectedSources);
  // Past-day starts are timeline snapshot views, not interviews. The Day
  // timeline scopes the live Office Hours screen by day and the Mac auto-start
  // fires for whichever day-scoped session it lands on, so without this gate a
  // Day-2+ launch viewing Day 1 RESUMED the unfinished Day-1 interview — a
  // provider run generating a brand-new question on a closed day. Rebuild the
  // read-only transcript from that day's turn log and settle idle instead.
  // Placed BEFORE the Day 2+ source gate so viewing a past Day 2+ never
  // surfaces a source-gate error. Fail-open: an unknown elapsed day keeps the
  // legacy behavior, and current-day relaunches keep the resume path below.
  let officeHoursPastDaySnapshot = false;
  try {
    if (process.env.AGENTIC30_TEST_OFFICE_HOURS_PAST_DAY_SNAPSHOT_CHECK_FAILURE === "1") {
      throw new Error("Synthetic Office Hours past-day snapshot check failure");
    }
    officeHoursPastDaySnapshot = isPastOfficeHoursSnapshotDay({
      day: runtimeDay,
      elapsedDay: await challengeElapsedOfficeHoursDay(),
    });
  } catch (error) {
    reportError(error, {
      operation: "office_hours_past_day_snapshot_check",
      session_id: session.id,
      provider: session.provider,
      day: runtimeDay || 0,
    });
    officeHoursPastDaySnapshot = false;
  }
  if (officeHoursPastDaySnapshot) {
    let snapshotTurns = [];
    try {
      if (process.env.AGENTIC30_TEST_OFFICE_HOURS_PAST_DAY_SNAPSHOT_TURNS_LOAD_FAILURE === "1") {
        throw new Error("Synthetic Office Hours past-day snapshot turns load failure");
      }
      snapshotTurns = selectOfficeHoursSnapshotTurns({
        turnLog: await loadOfficeHoursTurnLog({ workspaceRoot }),
        day: runtimeDay,
      });
    } catch (error) {
      reportError(error, {
        operation: "office_hours_past_day_snapshot_turns_load",
        session_id: session.id,
        provider: session.provider,
        day: runtimeDay || 0,
      });
      snapshotTurns = [];
    }
    // Same seeded-row shape as the Day-1 resume path: the Mac client derives
    // the 답변 N/M counter and the visible Q&A history from transcript rows,
    // and officeHoursSeededTurn exempts restored rows from snapshot-based
    // hiding/dedup. Skipped when the session already carries real answer rows
    // (same-daemon re-tap) so turns are never duplicated.
    const snapshotSeeded = seedOfficeHoursTranscriptFromTurns(session, snapshotTurns);
    const snapshotRuntime = buildOfficeHoursRuntime(context, source, runtimeDay);
    const snapshotExpectedCount = parseExpectedOfficeHoursQuestionCount(snapshotRuntime.context);
    if (snapshotExpectedCount > 0) {
      snapshotRuntime.expectedQuestionCount = snapshotExpectedCount;
    }
    snapshotRuntime.resumedTurns = countOfficeHoursResumeTurnsFromOtherSessions(
      snapshotTurns,
      session.id,
    );
    session.runtime = attachOfficeHoursRuntime(session.runtime, snapshotRuntime);
    if (!session.title || session.title === "New Session") {
      session.title = "Office Hours";
    }
    // Settle idle with no provider run and no visiblePrompt/assistant rows —
    // the auto-start policy marks this session started for the launch, so it
    // will not refire, and OfficeHoursLoadingPolicy hides the question loader
    // once the session leaves "running".
    session.status = "idle";
    session.error = null;
    session.pendingUserInput = null;
    touch(session);
    await persistSessions();
    broadcast({ type: "session_updated", session });
    emitOfficeHoursStatus(session, {
      stage: "completed",
      copy: selectOfficeHoursStatusCopy({ firstQuestionAnswered: snapshotTurns.length > 0 }),
    });
    telemetry.captureEvent("mac_sidecar_office_hours_past_day_snapshot", {
      session_id: session.id,
      provider: session.provider,
      day: runtimeDay || 0,
      day_turns: snapshotTurns.length,
      seeded: snapshotSeeded,
      source: String(source || ""),
    });
    const snapshotRun = state.activeRuns.get(session.id);
    if (snapshotRun?.runKey === runKey) {
      state.activeRuns.delete(session.id);
    }
    return;
  }
  // Completed current-day (or otherwise day-scoped) interviews are snapshots
  // too. The Mac auto-start uses office_hours_start as the hydration trigger,
  // but once day-progress says the interview step is done, starting a provider
  // run would create a confusing new Q1 instead of showing the completed Q/A.
  // Only hydrate when the durable turn log has completed Q/A; an empty/broken
  // memory file falls through to the legacy fresh-start behavior.
  let completedSnapshotDay = false;
  let completedSnapshotProgress = null;
  try {
    completedSnapshotProgress = state.dayProgress ?? (await loadDayProgress({ workspaceRoot }));
    completedSnapshotDay = isCompletedOfficeHoursSnapshotDay({
      day: runtimeDay,
      dayProgress: completedSnapshotProgress,
      source,
    });
  } catch (error) {
    reportError(error, {
      operation: "office_hours_completed_snapshot_check",
      session_id: session.id,
      provider: session.provider,
      day: runtimeDay || 0,
    });
    completedSnapshotDay = false;
  }
  if (completedSnapshotDay) {
    let completedSnapshotTurns = [];
    try {
      completedSnapshotTurns = selectOfficeHoursSnapshotTurns({
        turnLog: await loadOfficeHoursTurnLog({ workspaceRoot }),
        day: runtimeDay,
      });
    } catch (error) {
      reportError(error, {
        operation: "office_hours_completed_snapshot_turns_load",
        session_id: session.id,
        provider: session.provider,
        day: runtimeDay || 0,
      });
      completedSnapshotTurns = [];
    }
    if (completedSnapshotTurns.length) {
      const completedSnapshotSeeded = seedOfficeHoursTranscriptFromTurns(session, completedSnapshotTurns);
      const completedRuntime = buildOfficeHoursRuntime(context, source, runtimeDay, normalizedSelectedSources);
      const completedExpectedCount = parseExpectedOfficeHoursQuestionCount(completedRuntime.context);
      if (completedExpectedCount > 0) {
        completedRuntime.expectedQuestionCount = completedExpectedCount;
      }
      completedRuntime.resumedTurns = countOfficeHoursResumeTurnsFromOtherSessions(
        completedSnapshotTurns,
        session.id,
      );
      completedRuntime.promptSnapshots = buildOfficeHoursRuntimePromptSnapshots(
        session,
        completedSnapshotTurns,
        runtimeDay,
      );
      if (hasOfficeHoursTerminalResumeTurn(completedSnapshotTurns)) {
        completedRuntime.terminalAnswered = true;
      } else if (completedExpectedCount > 0 && completedSnapshotTurns.length >= completedExpectedCount) {
        completedRuntime.completedByExpectedCount = true;
        completedRuntime.completedQuestionCount = completedSnapshotTurns.length;
      }
      session.runtime = attachOfficeHoursRuntime(session.runtime, completedRuntime);
      if (!session.title || session.title === "New Session") {
        session.title = "Office Hours";
      }
      session.status = "idle";
      session.error = null;
      session.pendingUserInput = null;
      touch(session);
      await persistSessions();
      broadcast({ type: "session_updated", session });
      emitOfficeHoursStatus(session, {
        stage: "completed",
        copy: selectOfficeHoursStatusCopy({ firstQuestionAnswered: true }),
      });
      telemetry.captureEvent("mac_sidecar_office_hours_completed_snapshot", {
        session_id: session.id,
        provider: session.provider,
        day: runtimeDay || 0,
        day_turns: completedSnapshotTurns.length,
        prompt_snapshots: completedRuntime.promptSnapshots?.length || 0,
        seeded: completedSnapshotSeeded,
        source: String(source || ""),
      });
      const completedRun = state.activeRuns.get(session.id);
      if (completedRun?.runKey === runKey) {
        state.activeRuns.delete(session.id);
      }
      return;
    }
  }
  try {
    if (isDay2PlusOfficeHoursDay(runtimeDay)) {
      const gate = await evaluateOfficeHoursSourceGate({
        workspaceRoot,
        day: runtimeDay,
        selectedSources: normalizedSelectedSources,
        provider: session.provider,
        appSupportPath,
      });
      sendOfficeHoursSourceGate(null, {
        sessionId: session.id,
        gate,
      });
      if (!gate.ok) {
        telemetry.captureEvent("mac_sidecar_office_hours_source_gate_blocked", {
          session_id: session.id,
          provider: session.provider,
          day: runtimeDay,
          reason: gate.reason || "",
          selected_sources: normalizedSelectedSources.join(","),
        });
        logOfficeHoursSourceGateBlocked({
          session,
          day: runtimeDay,
          gate,
          selectedSources: normalizedSelectedSources,
        });
        session.status = "idle";
        session.error = null;
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
        const activeRun = state.activeRuns.get(session.id);
        if (activeRun?.runKey === runKey) {
          state.activeRuns.delete(session.id);
        }
        broadcast({
          type: "error",
          sessionId: session.id,
          message: gate.message || "Day 2+ Office Hours source gate blocked.",
        });
        return;
      }
    }
  } catch (error) {
    const activeRun = state.activeRuns.get(session.id);
    if (activeRun?.runKey === runKey) {
      state.activeRuns.delete(session.id);
    }
    throw error;
  }
  const officeHoursRuntime = buildOfficeHoursRuntime(context, source, runtimeDay, normalizedSelectedSources);
  const visiblePrompt = String(originalPrompt || "Office Hours").trim() || "Office Hours";
  const runStartedAt = performance.now();
  const assistantMessage = makeMessage({
    role: "assistant",
    provider: session.provider,
    content: "",
    state: "streaming",
  });

  state.activeRuns.set(session.id, {
    runKey,
    abortController,
    stop: null,
  });

  try {
    const activeRun = state.activeRuns.get(session.id);
    if (activeRun?.runKey === runKey) {
      activeRun.stop = async () => {
        abortController.abort();
      };
    }

    // Interview resume (Day 1 first_interview + Day 2+ standard interview): a
    // relaunch kills the in-flight provider conversation and boot wipes
    // sessions.json, but the answered turns survive in
    // .agentic30/memory/office-hours-turns.json and day-progress.json still
    // holds the day's interview step active. Rebuild from that pair instead of
    // starting over at question 1. Fail-open: any error means a normal fresh
    // start.
    let officeHoursResumeTurns = [];
    try {
      officeHoursResumeTurns = selectOfficeHoursResumeTurns({
        turnLog: await loadOfficeHoursTurnLog({ workspaceRoot }),
        day: runtimeDay,
        dayProgress: state.dayProgress ?? (await loadDayProgress({ workspaceRoot })),
        source,
      });
    } catch {
      officeHoursResumeTurns = [];
    }
    const officeHoursExpectedQuestionCount = parseExpectedOfficeHoursQuestionCount(officeHoursRuntime.context);
    if (officeHoursExpectedQuestionCount > 0) {
      // Parsed from the BASE context before any preamble prepend, then stamped
      // on the runtime so detectIncompleteOfficeHoursInterview never depends on
      // the "Expected question count" line surviving the head-keeping 16k clamp
      // after the cycle/resume preambles are prepended.
      officeHoursRuntime.expectedQuestionCount = officeHoursExpectedQuestionCount;
    }
    // All questions already answered — the founder quit between the last answer
    // and the commitment close. The interview's only remaining work is the
    // commitment close (PB-1 bar -> day_progress_patch gate), which the Mac
    // client renders from the transcript count plus day-progress alone, so the
    // wrap-up path below skips the provider run entirely. A terminal (대안
    // 비교 closing card) turn is the same completion signal even below the
    // expected count: the system prompt smart-skips routed questions, so a
    // concluded interview can legitimately hold fewer answers — without the
    // terminal route a relaunch would re-run the provider on a finished
    // interview.
    const officeHoursResumeTerminal = hasOfficeHoursTerminalResumeTurn(officeHoursResumeTurns);
    const officeHoursResumeWrapUp = officeHoursResumeTerminal
      || (officeHoursExpectedQuestionCount > 0
        && officeHoursResumeTurns.length >= officeHoursExpectedQuestionCount);
    if (officeHoursResumeTurns.length) {
      // The Mac client derives the 답변 N/M counter and the visible Q&A history
      // from transcript rows, so seeding the prior turns restores both with no
      // client change. Same shape as the post-answer transcript writes in the
      // submit_user_input handler, plus the officeHoursSeededTurn wire marker
      // (decoded by ChatMessage on the Mac side) that exempts restored rows
      // from snapshot-based hiding/dedup — their submitted-card snapshots died
      // with the prior session. Skipped when the session already carries real
      // answer rows (same-daemon retry) so turns are never duplicated.
      const officeHoursResumeSeeded = seedOfficeHoursTranscriptFromTurns(session, officeHoursResumeTurns);
      // Carried on the session runtime so detectIncompleteOfficeHoursInterview
      // (run end + chat continuations) counts prior-session answers too. Only
      // turns from OTHER sessions: the Mac retry path re-enters runOfficeHours
      // on the SAME failed session, whose own turns the detector already counts
      // via countOfficeHoursTurnsForSession — including them here would
      // double-count and let an incomplete interview read as completed.
      officeHoursRuntime.resumedTurns = countOfficeHoursResumeTurnsFromOtherSessions(
        officeHoursResumeTurns,
        session.id,
      );
      officeHoursRuntime.promptSnapshots = buildOfficeHoursRuntimePromptSnapshots(
        session,
        officeHoursResumeTurns,
        runtimeDay,
      );
      telemetry.captureEvent("mac_sidecar_office_hours_resumed", {
        session_id: session.id,
        provider: session.provider,
        day: runtimeDay || 0,
        resumed_turns: officeHoursRuntime.resumedTurns,
        day_turns: officeHoursResumeTurns.length,
        seeded: officeHoursResumeSeeded,
        wrap_up: officeHoursResumeWrapUp,
        terminal: officeHoursResumeTerminal,
      });
      if (officeHoursResumeWrapUp) {
        // Skip the provider run: a wrap-up prompt would re-bill on every
        // relaunch until the interview step closes, and its summary is already
        // covered by the client-side doc-ready block. Settle the session idle
        // with the seeded transcript; the commitment bar (gated on the
        // day-progress step + answered count) carries the close from here.
        // No visiblePrompt/assistant rows are pushed — the auto-start policy
        // marks this session started for the launch, so it will not refire.
        if (officeHoursResumeTerminal) {
          // The prior session's live terminalAnswered stamp died with the
          // daemon; restore it from the durable turn flag so the Mac client's
          // interview-complete gate (commitment bar + N/M counter) and
          // detectIncompleteOfficeHoursInterview on later continuations treat
          // a smart-skip conclusion (fewer answers than expected) as done.
          officeHoursRuntime.terminalAnswered = true;
        } else if (officeHoursExpectedQuestionCount > 0
          && officeHoursResumeTurns.length >= officeHoursExpectedQuestionCount) {
          officeHoursRuntime.completedByExpectedCount = true;
          officeHoursRuntime.completedQuestionCount = officeHoursResumeTurns.length;
          officeHoursRuntime.expectedQuestionCount = officeHoursExpectedQuestionCount;
        }
        session.runtime = attachOfficeHoursRuntime(session.runtime, officeHoursRuntime);
        if (!session.title || session.title === "New Session") {
          session.title = "Office Hours";
        }
        session.status = "idle";
        session.error = null;
        session.pendingUserInput = null;
        touch(session);
        await persistSessions();
        broadcast({ type: "session_updated", session });
        emitOfficeHoursStatus(session, {
          stage: "completed",
          copy: selectOfficeHoursStatusCopy({ firstQuestionAnswered: true }),
        });
        const wrapUpRun = state.activeRuns.get(session.id);
        if (wrapUpRun?.runKey === runKey) {
          state.activeRuns.delete(session.id);
        }
        return;
      }
    }

    session.messages.push(
      makeMessage({ role: "user", provider: session.provider, content: visiblePrompt, state: "final" }),
      assistantMessage,
    );
    if (!session.title || session.title === "New Session") {
      session.title = "Office Hours";
    }
    session.status = "running";
    session.error = null;
    session.pendingUserInput = null;
    // Cycle#N read-back, injected into the office-hours context AFTER the dedup slot is
    // reserved (state.activeRuns.set above) so the concurrent-start guard window stays
    // synchronous. Fail-open: empty preamble (cold brain / any error) leaves context as-is.
    const cyclePreamble = await buildOfficeHoursCyclePreamble(runtimeDay);
    if (cyclePreamble) {
      officeHoursRuntime.context = clampOfficeHoursContext(`${cyclePreamble}\n\n${officeHoursRuntime.context}`);
    }
    // Resume preamble goes ABOVE everything else: the provider must treat the
    // already-answered questions as settled and continue at question k+1 (or
    // wrap up when all are answered) instead of re-running the interview.
    const officeHoursResumePreamble = buildOfficeHoursResumePreamble({
      turns: officeHoursResumeTurns,
      expected: officeHoursExpectedQuestionCount,
    });
    if (officeHoursResumePreamble) {
      officeHoursRuntime.context = clampOfficeHoursContext(`${officeHoursResumePreamble}\n\n${officeHoursRuntime.context}`);
    }
    const getUsersActiveDefinitionPreamble = await buildGetUsersActiveUserDefinitionPreamble({
      workspaceRoot,
      context: officeHoursRuntime.context,
    });
    if (getUsersActiveDefinitionPreamble) {
      officeHoursRuntime.context = clampOfficeHoursContext(`${officeHoursRuntime.context}\n\n${getUsersActiveDefinitionPreamble}`);
    }
    if (isDay2PlusOfficeHoursDay(runtimeDay)) {
      const digest = await prepareDailyOfficeHoursDigest(session, {
        context: officeHoursRuntime.context,
        day: runtimeDay,
        selectedSources: normalizedSelectedSources,
        abortController,
      });
      officeHoursRuntime.context = clampOfficeHoursContext(
        `${officeHoursRuntime.context}\n\n${formatDailyOfficeHoursDigestForPrompt(digest)}`,
      );
      officeHoursRuntime.dailyDigest = {
        generatedAt: digest.generatedAt,
        window: digest.window,
        sources: digest.sources.map((source) => ({
          id: source.id,
          state: source.state,
          selected: Boolean(source.selected),
          required: Boolean(source.required),
          summary: source.summary,
        })),
      };
    }
    session.runtime = attachOfficeHoursRuntime(session.runtime, officeHoursRuntime);
    touch(session);
    await persistSessions();
    broadcast({ type: "session_updated", session });
    let officeHoursStructuredInputAnswered = false;
    // True once ANY structured-input question was asked during this run — tool
    // channel (Claude AskUserQuestion / the MCP request_user_input), a
    // structured-input run/tool stage, or an inline_decision. Distinguishes a
    // genuine "no question was produced" failure from a normal interview that
    // asked (and possibly answered) at least one question and then ended its
    // turn without a trailing card. With Claude's blocking-continue run model
    // the whole interview runs inside this single runOfficeHours call, so on
    // natural conclusion request and pendingUserInput are both null even though
    // the interview succeeded — without this guard the locked-Day1 failure
    // branch below would misfire.
    let officeHoursStructuredInputAsked = false;
    // Claude's blocking-continue model also means the status copy table cannot
    // be pinned for the whole run: questions 2..N are generated inside this
    // same call and would keep reading "첫 질문 …". Select the table per emit —
    // first-question copy until the first structured answer arrives, follow-up
    // copy afterwards. (Codex never hits this: its run ends per question and
    // continuations go through the chat path with the follow-up table.)
    // A resumed interview already answered question 1 in a prior session, so it
    // starts on the follow-up table outright.
    const emitInterviewOfficeHoursStatus = (status) => {
      emitOfficeHoursStatus(session, {
        ...status,
        copy: selectOfficeHoursStatusCopy({
          firstQuestionAnswered: officeHoursStructuredInputAnswered || officeHoursResumeTurns.length > 0,
        }),
      });
    };
    emitInterviewOfficeHoursStatus({
      stage: "context_loaded",
      messageId: assistantMessage.id,
      elapsedMs: performance.now() - runStartedAt,
    });

    telemetry.captureEvent("mac_sidecar_office_hours_started", {
      session_id: session.id,
      provider: session.provider,
      source: officeHoursRuntime.source,
      context_length: officeHoursRuntime.context.length,
    });

    const officeHoursSelection = selectOfficeHoursSpecialist({
      context: officeHoursRuntime.context,
      lastAnswer: visiblePrompt,
    });
    emitInterviewOfficeHoursStatus({
      stage: "specialist_routed",
      messageId: assistantMessage.id,
      elapsedMs: performance.now() - runStartedAt,
    });
    telemetry.captureEvent("mac_sidecar_specialist_routed", {
      session_id: session.id,
      stage: "office_hours",
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
    emitInterviewOfficeHoursStatus({
      stage: "provider_starting",
      messageId: assistantMessage.id,
      elapsedMs: performance.now() - runStartedAt,
    });
    const warmSpec = buildOfficeHoursWarmSpec(session, {
      context: officeHoursRuntime.context,
      source: officeHoursRuntime.source,
      day: officeHoursRuntime.day,
      selectedSources: officeHoursRuntime.selectedSources,
    });
    assertOfficeHoursWarmIsNotStale(session, warmSpec);
    const officeHoursWarmUsed = isOfficeHoursWarmRuntimeReady(session.runtime, warmSpec);
    telemetry.captureEvent("mac_sidecar_office_hours_question_provider_starting", {
      session_id: session.id,
      provider: session.provider,
      execution_mode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
      warmup_used: officeHoursWarmUsed,
    });
    const result = await runProviderStream({
      provider: session.provider,
      sessionRuntime: session.runtime,
      prompt: buildOfficeHoursChatPrompt({ context: officeHoursRuntime.context }),
      model: session.model,
      workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      executionMode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
      approvedToolExecution: false,
      specialist: null,
      onTextDelta: (text) => appendAssistantText(session, assistantMessage.id, text),
      onTextReplace: (text) => setAssistantText(session, assistantMessage.id, text),
      onToolEvent: (toolEvent) => {
        if (isOfficeHoursStructuredInputToolEvent(toolEvent)) {
          telemetry.captureEvent("mac_sidecar_office_hours_request_user_input_called", {
            session_id: session.id,
            provider: session.provider,
            execution_mode: OFFICE_HOURS_QUESTION_EXECUTION_MODE,
            phase: toolEvent.phase || "",
            elapsed_ms: Math.max(0, Math.round(performance.now() - runStartedAt)),
            continuation: false,
          });
          officeHoursStructuredInputAsked = true;
          if (isSuccessfulStructuredInputToolEvent(toolEvent)) {
            officeHoursStructuredInputAnswered = true;
          }
        }
        const status = mapOfficeHoursToolEventToStatus(toolEvent);
        if (status) {
          if (status.stage === "tool_running" || status.stage === "structured_input_requested") {
            officeHoursStructuredInputAsked = true;
          }
          emitInterviewOfficeHoursStatus({
            ...status,
            messageId: assistantMessage.id,
            elapsedMs: performance.now() - runStartedAt,
          });
        }
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
        session.runtime = attachOfficeHoursRuntime(runtime, officeHoursRuntime);
        touch(session);
        fireAndForget("persist_sessions_office_hours_runtime", persistSessions());
        broadcast({ type: "session_updated", session });
      },
      systemPromptOverride: buildOfficeHoursChatSystemPrompt(workspaceRoot, {
        specialistInjection: officeHoursSpecialistInjection,
        context: officeHoursRuntime.context,
        provider: session.provider,
      }),
      onRunEvent: (event) => {
        if (isStructuredInputResponseRunEvent(event)) {
          officeHoursStructuredInputAnswered = true;
          officeHoursStructuredInputAsked = true;
        }
        const status = mapOfficeHoursRunEventToStatus(event);
        if (status) {
          if (status.stage === "structured_input_requested") {
            officeHoursStructuredInputAsked = true;
          }
          emitInterviewOfficeHoursStatus({
            ...status,
            messageId: assistantMessage.id,
            elapsedMs: performance.now() - runStartedAt,
          });
        }
      },
    });

    session.runtime = attachOfficeHoursRuntime(
      mergeProviderRuntime(session.runtime, result.runtime),
      officeHoursRuntime,
    );
    await syncPendingUserInputRequests();
    assistantMessage.state = "final";
    session.status = session.pendingUserInput ? "awaiting_input" : "idle";
    session.error = null;
    if (!officeHoursStructuredInputAnswered && assistantMessage.inlineDecision) {
      emitInterviewOfficeHoursStatus({
        stage: "structured_input_requested",
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
    }
    const request = officeHoursStructuredInputAnswered
      ? null
      : await promoteOfficeHoursInlineDecisionPromptCard(session, assistantMessage, {
          context: officeHoursRuntime.context,
          source: "office_hours_start",
        });
    // Only a run that produced NO question in ANY channel is a real failure.
    // A run that asked/answered ≥1 structured question (Claude blocking-continue
    // interviews the whole session in one runOfficeHours call) or parsed an
    // inline_decision legitimately ends with request and pendingUserInput null —
    // that is a successful conclusion, not a question-generation failure.
    const officeHoursProducedQuestion = officeHoursStructuredInputAnswered
      || officeHoursStructuredInputAsked
      || Boolean(assistantMessage.inlineDecision);
    if (isLockedDay1GoalOfficeHoursRuntime(officeHoursRuntime)
      && !request
      && !session.pendingUserInput
      && !officeHoursProducedQuestion) {
      const message = "Day 1 인터뷰 질문을 만들지 못했습니다.";
      assistantMessage.state = "error";
      assistantMessage.error = message;
      if (!assistantMessage.content) {
        assistantMessage.content = message;
      }
      session.status = "error";
      session.error = message;
      emitOfficeHoursStatus(session, {
        stage: "failed",
        detail: message,
        progressText: message,
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
      broadcast({
        type: "error",
        sessionId: session.id,
        message,
      });
      return;
    }
    const officeHoursCurrentRunCreatedPendingQuestion = officeHoursStructuredInputAsked
      && !officeHoursStructuredInputAnswered;
    const incompleteInterview = !request
      && !session.pendingUserInput
      && !officeHoursCurrentRunCreatedPendingQuestion
      ? await detectIncompleteOfficeHoursInterview(session, officeHoursRuntime.context)
      : null;
    if (incompleteInterview) {
      failOfficeHoursIncompleteInterview(session, assistantMessage, {
        incomplete: incompleteInterview,
        runStartedAt,
        source: "office_hours_start",
      });
      return;
    }
    emitInterviewOfficeHoursStatus({
      stage: session.pendingUserInput ? "question_ready" : "completed",
      messageId: assistantMessage.id,
      requestId: request?.requestId || session.pendingUserInput?.requestId || null,
      elapsedMs: performance.now() - runStartedAt,
    });
  } catch (error) {
    if (abortController.signal.aborted || isAbortLikeError(error)) {
      telemetry.captureEvent("mac_sidecar_office_hours_aborted", {
        session_id: session.id,
        provider: session.provider,
      });
      assistantMessage.state = "final";
      session.status = "idle";
      session.error = null;
      emitOfficeHoursStatus(session, {
        stage: session.runtime?.officeHours?.completedByExpectedCount === true
          ? "completed"
          : "aborted",
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
    } else if (error instanceof OfficeHoursSourceGateError) {
      sendOfficeHoursSourceGate(null, {
        sessionId: session.id,
        gate: error.gate,
      });
      telemetry.captureEvent("mac_sidecar_office_hours_source_gate_blocked", {
        session_id: session.id,
        provider: session.provider,
        day: runtimeDay || 0,
        reason: error.gate?.reason || "",
        selected_sources: normalizedSelectedSources.join(","),
      });
      logOfficeHoursSourceGateBlocked({
        session,
        day: runtimeDay || 0,
        gate: error.gate,
        selectedSources: normalizedSelectedSources,
      });
      const lastAssistant = session.messages.at(-1);
      const lastUser = session.messages.at(-2);
      if (
        lastAssistant?.id === assistantMessage.id
        && !String(lastAssistant.content || "").trim()
        && lastUser?.role === "user"
        && lastUser?.content === visiblePrompt
      ) {
        session.messages.splice(-2, 2);
      } else {
        assistantMessage.state = "error";
        assistantMessage.error = formatError(error);
        if (!assistantMessage.content) {
          assistantMessage.content = formatError(error);
        }
      }
      session.status = "idle";
      session.error = null;
      broadcast({
        type: "error",
        sessionId: session.id,
        message: formatError(error),
      });
    } else {
      const errorKind = reportProviderRunError(error, {
        operation: "runOfficeHours",
        session_id: session.id,
        provider: session.provider,
      });
      assistantMessage.state = "error";
      assistantMessage.error = formatError(error);
      if (!assistantMessage.content) {
        assistantMessage.content = `Office Hours failed: ${formatError(error)}`;
      }
      session.status = "error";
      session.error = formatError(error);
      emitOfficeHoursStatus(session, {
        stage: "failed",
        detail: formatError(error),
        progressText: formatError(error),
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
      broadcast({
        type: "error",
        sessionId: session.id,
        provider: session.provider,
        message: formatError(error),
        ...providerRecoverableErrorEnvelope(errorKind),
      });
    }
  } finally {
    if (session.status === "idle" && assistantMessage.state === "final") {
      telemetry.captureEvent("mac_sidecar_office_hours_completed", {
        session_id: session.id,
        provider: session.provider,
      });
    }
    const activeRun = state.activeRuns.get(session.id);
    const stillCurrentRun = activeRun?.runKey === runKey;
    if (stillCurrentRun) {
      state.activeRuns.delete(session.id);
    }
    touch(session);
    await persistSessions();
    broadcast({ type: "session_updated", session });
    if (stillCurrentRun || !state.activeRuns.has(session.id)) {
      scheduleQueuedPromptRun(session);
    }
  }
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
        fireAndForget("persist_sessions_office_hours_runtime", persistSessions());
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
      emitOfficeHoursStatus(session, {
        stage: "failed",
        detail: formatError(error),
        progressText: formatError(error),
        messageId: assistantMessage.id,
        elapsedMs: performance.now() - runStartedAt,
      });
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
    const cliPath = resolveClaudeCodeEntrypoint();
    const env = buildClaudeAgentEnv();

    const options = {
      model: session.model || undefined,
      pathToClaudeCodeExecutable: cliPath ?? undefined,
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
  if (!route.inlineBipContext || !shouldInlineBipContext(prompt)) {
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
  const mappings = [
    ["ICP.md", projectDocPath("icp")],
    ["SPEC.md", projectDocPath("spec")],
    ["VALUES.md", projectDocPath("values")],
    ["GOAL.md", projectDocPath("goal")],
    ["ADR.md", projectDocPath("adr")],
  ];
  const match = mappings.find(([label, docPath]) =>
    docPath && new RegExp(`\\b${label.replace(".", "\\.")}\\b`, "i").test(value)
  );
  if (!match) return "";
  const [label, docPath] = match;
  const absoluteDocPath = path.join(workspaceRoot, docPath);
  const docStat = await fs.stat(absoluteDocPath).catch(() => null);
  const workspaceEvidence = await extractWorkspaceEvidence(workspaceRoot, {
    includeSource: true,
  }).catch(() => null);
  const summaryLines = workspaceEvidenceSummaryLines(workspaceEvidence);
  if (!docStat?.isFile()) {
    return [
      `\`${label}\`의 canonical 위치는 \`${docPath}\`이지만 파일이 없습니다.`,
      "Only canonical `.agentic30/docs/*` project docs are used. Create the document there and run again.",
      ...summaryLines,
    ].join("\n");
  }
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
    docs.icp ? projectDocPath("icp") : "",
    docs.goal ? projectDocPath("goal") : "",
    docs.spec ? projectDocPath("spec") : "",
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
    domainLine = "Builder retro: 끝난 demo loop는 회고로 닫고 가장 선명한 artifact를 다음 공개 증거로 이어갑니다.";
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
        ? `Evidence: ${projectDocPath("icp")}와 관련 문서는 "${goalLabel}" 판단 기준입니다.`
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
  const root = path.resolve(String(config?.workspace?.root || workspaceRoot || "."));
  const exists = (role) => {
    const canonical = projectDocPath(role);
    return Boolean(canonical && fsSync.existsSync(path.join(root, canonical)));
  };
  return {
    icp: exists("icp"),
    values: exists("values"),
    goal: exists("goal"),
    spec: exists("spec"),
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

  const lines = [
    "## Settings BIP Manifest",
    "This deterministic manifest comes from Settings > Build In Public.",
    "For questions asking where a canonical project document is, answer from this manifest before using retrieval.",
    "Use QMD for broad search and the BIP MCP tools for canonical `.agentic30/docs/*` project documents.",
    `Workspace root: ${path.resolve(configuredRoot)}`,
  ];
  lines.push(`ICP doc: ${projectDocPath("icp")}`);
  lines.push(`SPEC doc: ${projectDocPath("spec")}`);
  lines.push(`VALUES doc: ${projectDocPath("values")}`);
  lines.push(`Design System docs: ${projectDocPath("designSystem")}`);
  lines.push(`ADR docs: ${projectDocPath("adr")}`);
  lines.push(`Goal doc: ${projectDocPath("goal")}`);
  lines.push(`Docs map: ${projectDocPath("docs")}`);
  lines.push(`Sheet schema: ${projectDocPath("sheet")}`);

  const externalDocs = bipConfig.externalDocs || {};
  const googleDocs = normalizeStringList(externalDocs.googleDocs);
  const googleSheets = normalizeStringList(externalDocs.googleSheets);
  if (googleDocs.length) lines.push(`Google Docs: ${googleDocs.join(", ")}`);
  if (googleSheets.length) lines.push(`Google Sheets: ${googleSheets.join(", ")}`);

  return lines.join("\n");
}

async function collectChatBipLocalDocs(bipConfig, root) {
  const canonicalDocs = [
    ["ICP", projectDocPath("icp")],
    ["SPEC", projectDocPath("spec")],
    ["VALUES", projectDocPath("values")],
    ["Design System", projectDocPath("designSystem")],
    ["ADR", projectDocPath("adr")],
    ["Goal", projectDocPath("goal")],
    ["Docs", projectDocPath("docs")],
    ["Sheet", projectDocPath("sheet")],
  ];
  const seen = new Set();
  const docs = [];
  for (const [role, canonicalPath] of canonicalDocs) {
    const value = String(canonicalPath || "").trim();
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
        content: `Missing canonical project doc at ${value}. Only .agentic30/docs/* project docs are used.`,
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

    const cliPath = resolveClaudeCodeEntrypoint();
    const env = buildClaudeAgentEnv();

    const options = {
      model: session.model || undefined,
      pathToClaudeCodeExecutable: cliPath ?? undefined,
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
      telemetry.captureEvent("mac_sidecar_bip_token_expired", { during_action: "evidence_refresh" });
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
  await swallow(
    "persist_gws_sheet_memory",
    persistGwsReadToMemory({
      appSupportPath,
      sidecarRoot,
      kind: "sheet",
      id: config.sheetId,
      range: sheetRange,
      payload: sheetValues,
    }),
  );
  const sheetSummary = summarizeSheetValues(sheetValues);
  onProgress?.("reading_doc", "업무일지 Doc을 읽는 중", {
    sheetRowsRead: sheetSummary.allRows.length,
  });
  const docPayload = await readGoogleDoc(config.docId, { cwd: workspaceRoot });
  await swallow(
    "persist_gws_doc_memory",
    persistGwsReadToMemory({
      appSupportPath,
      sidecarRoot,
      kind: "doc",
      id: config.docId,
      payload: docPayload,
    }),
  );
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
      "초기 설정을 먼저 승인해야 Day 1 Mission 후보를 만들 수 있습니다.",
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
    // Single explicit provider — no provider fallback. If this provider is
    // unavailable or generation fails, the error is surfaced (no alternate
    // provider attempt and no local deterministic fallback).
    const providers = [preferredProvider];
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
            summary: state.bipCoach.evidence?.summary || "실행 보조 앱이 Google Sheet 전체 범위와 업무일지 Doc 전체 내용을 한 번 읽고 미션 생성에 사용했습니다.",
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
    "1. 아래 초안 중 하나를 고르고 사실과 숫자만 네 상황에 맞게 바꾸세요.",
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
        fireAndForget("persist_sessions_bip_coach_runtime", persistSessions());
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
  titlePrefix = iddMode === "day1_handoff" ? "Day 1 인계" : "초기 설정",
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
          "You synthesize one structured customer-discovery question for agentic30 initial setup.",
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
        placeholder: "예: 퇴사 후 3개월째, AI로 첫 버전은 만들었지만 유료 고객이 없는 개발자",
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
    `Task: create the ${stageLabel} initial setup ${doc.title} question card for the app builder.`,
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
  const candidates = [
    ...["icp", "spec", "goal", "values"].flatMap((role) => projectDocCandidatePaths(role)),
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
  const baseRequest = {
    ...allowOtherTextForIddQuestions(request),
    generation: {
      ...(request.generation && typeof request.generation === "object" ? request.generation : {}),
      mode: "provider_adaptive",
      docType: pending.docType,
    },
  };
  // Parity with the host_structured (initialIddStructuredInputForDoc) and
  // sidecar_agent_synthesized (parseIddAgentSynthesis) paths: an ICP card must
  // carry the canonical intro + recommended resources. Without this,
  // isMissingIcpContextIntro() flags the provider_adaptive card as incomplete and
  // shouldRestartIddQuestionRequest() restarts it — back into the same undecorated
  // state — an infinite regenerate loop. decorateIcpStructuredInput is idempotent
  // and only fills intro/resources when absent, so it is safe on a provider-built
  // request.
  const nextRequest = pending.docType === "icp"
    ? decorateIcpStructuredInput(baseRequest)
    : baseRequest;
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
  session.title = `초기 설정: ${nextDoc.title}`;
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
      || String(session?.title || "").startsWith("Foundation Setup:")
      || String(session?.title || "").startsWith("초기 설정:"),
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
  const cleanList = (key, maxItems = 8, maxChars = 300) => {
    const raw = source[key];
    const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return values
      .map((item) => String(item || "").trim().slice(0, maxChars))
      .filter(Boolean)
      .slice(0, maxItems);
  };
  return {
    goal: clean("goal", 1000),
    icp: clean("icp", 1000),
    pain: clean("pain", 1000),
    outcome: clean("outcome", 1000),
    northStarGoal: clean("northStarGoal", 1000),
    weeklyProof: clean("weeklyProof", 1000),
    targetUser: clean("targetUser", 1000),
    problem: clean("problem", 1000),
    currentAlternative: clean("currentAlternative", 1000),
    entryPoint: clean("entryPoint", 1000),
    nextAction: clean("nextAction", 1000),
    nonGoals: cleanList("nonGoals"),
    assumptions: cleanList("assumptions"),
    sourceQuotes: cleanList("sourceQuotes"),
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
    runEvidenceJudge: true,
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

  if (result.blocked) {
    progress("judge_blocked", "Office Hours 증거 judge가 문서 저장을 보류했습니다.", "all");
    telemetry.captureEvent("mac_sidecar_day1_doc_handoff_write_all_blocked", {
      session_id: session?.id ?? "",
      provider: seed.provider,
      judge_score: result.judgeResult?.score ?? 0,
      judge_status: result.judgeResult?.status || "failed",
    });
    if (session) {
      const followUps = Array.isArray(result.judgeResult?.followUpQuestions)
        ? result.judgeResult.followUpQuestions
        : [];
      const content = [
        `GOAL/ICP/VALUES/SPEC 저장을 보류했습니다. Office Hours 문서 judge 점수는 ${result.judgeResult?.score ?? 0}/10이고, 기준은 8/10입니다.`,
        result.evidenceDebtCard || "",
        followUps.length ? "다음 질문:" : "",
        ...followUps.slice(0, 2).map((question, index) => `${index + 1}. ${question}`),
      ].filter(Boolean).join("\n\n");
      session.runtime = {
        ...(session.runtime || {}),
        iddMode: null,
        pendingIddContinuation: null,
        iddPendingAdaptiveContinuation: null,
      };
      session.pendingUserInput = null;
      session.status = "idle";
      session.error = result.judgeResult?.summary || "Office Hours evidence judge blocked document save.";
      session.messages.push(makeMessage({
        role: "assistant",
        provider: session.provider,
        content,
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
      content: [
        "Day 1 확정 가설로 GOAL/ICP/VALUES/SPEC 문서를 저장했습니다.",
        result.evidenceDebtCard || "",
      ].filter(Boolean).join("\n\n"),
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
  const preferredProvider = payload.preferredProvider ?? payload.preferred_provider ?? "";
  let scanResult = await findWorkspaceDocsLocally(root).catch(() => null);
  let onboardingHypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
    docPaths: scanResult || currentBipConfig()?.workspace || {},
  }).catch(() => null);

  if (reason === "day_completed") {
    const workspaceScanEvidenceBundle = await buildWorkspaceScanEvidenceBundle({
      workspaceRoot: root,
      scanResult: scanResult || {},
    }).catch(() => null);
    const agentResults = await Promise.allSettled(
      selectScanProviderTargets(preferredProvider, WORKSPACE_SCAN_MODEL_BY_PROVIDER).map(
        ({ provider, model }) => runWorkspaceScanAgent({
          provider,
          model,
          scanRoot: root,
          evidenceBundle: workspaceScanEvidenceBundle,
        }),
      ),
    );
    // Background context refresh: a failed agent outcome just skips the merge
    // (no blocking) — the Day 1 gate only applies to the foreground scan.
    const parsedAgentResults = agentResults
      .filter((result) => result.status === "fulfilled" && result.value?.ok)
      .map((result) => result.value.result);
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
  session.title = `초기 설정: ${nextDoc.title}`;
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
      message: error?.message || "초기 설정 질문 카드를 준비하지 못했어요.",
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

async function runWorkspaceScan(scanRoot, { sessionId = "", prompt = "", preferredProvider = "" } = {}) {
  try {
    broadcastWorkspaceScanProgress(scanRoot, "scan.local · 로컬 문서 후보를 읽는 중", {
      stage: "local",
      stepIndex: 1,
      totalSteps: 3,
      etaSeconds: 45,
    });
    // The scan seeds `<scanRoot>/.agentic30/` (memory, day progress) — make
    // sure git never picks it up, even when a later scan stage fails.
    const gitignoreResult = await ensureAgentic30Gitignored({ workspaceRoot: scanRoot });
    if (gitignoreResult.status === "added") {
      telemetry.captureEvent("mac_sidecar_workspace_gitignore_added", { scan_root: scanRoot });
    } else if (gitignoreResult.status === "error") {
      telemetry.captureException(new Error(gitignoreResult.error), {
        operation: "workspace_gitignore",
        scan_root: scanRoot,
      });
    }
    const localResult = await findWorkspaceDocsLocally(scanRoot);
    const workspaceScanEvidenceBundle = await buildWorkspaceScanEvidenceBundle({
      workspaceRoot: scanRoot,
      scanResult: localResult,
    });
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
        scan_provider: normalizeProviderName(preferredProvider) || "frontier",
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
      const day1GoalSelection = await loadDay1GoalSelection({ workspaceRoot: scanRoot });
      if (path.resolve(scanRoot) === path.resolve(workspaceRoot)) {
        state.day1GoalSelection = day1GoalSelection;
      }
      // Scan complete: anchor challenge start, then advance the day loop to `goal`.
      let dayProgress = null;
      try {
        if (path.resolve(scanRoot) === path.resolve(workspaceRoot)) {
          const seeded = await ensureChallengeStart({ workspaceRoot: scanRoot });
          const currentDay = computeDayNumber({ challengeStartedAt: seeded.challengeStartedAt });
          dayProgress = currentDay
            ? await setDayActiveStep({
                workspaceRoot: scanRoot,
                day: currentDay,
                stepId: "goal",
                goalText: currentDay === 1 ? day1GoalSelection?.goalText : undefined,
              })
            : seeded;
        } else {
          dayProgress = await loadDayProgress({ workspaceRoot: scanRoot });
        }
      } catch {
        dayProgress = await loadDayProgress({ workspaceRoot: scanRoot }).catch(() => null);
      }
      if (path.resolve(scanRoot) === path.resolve(workspaceRoot)) {
        state.dayProgress = dayProgress;
      }
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
      const scanCurrentDay = dayProgress ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt }) : null;
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
        day1GoalSelection,
        dayProgress,
        dayReviews: await loadOfficeHoursDayReviews(scanRoot, dayProgress, scanCurrentDay),
        evidenceOS: await loadOfficeHoursEvidenceOS(scanRoot, dayProgress, scanCurrentDay),
      });
      triggerDay1AlignmentPlanBroadcast({
        scanRoot,
        deterministicPlan: day1AlignmentPlan,
        compatibilityIcpPlan: day1IcpPlan,
        preferredProvider,
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
    const scanTargets = selectScanProviderTargets(preferredProvider, WORKSPACE_SCAN_MODEL_BY_PROVIDER);
    const agentResults = await Promise.allSettled(
      scanTargets.map(
        ({ provider, model }) => runWorkspaceScanAgent({
          provider,
          model,
          scanRoot,
          evidenceBundle: workspaceScanEvidenceBundle,
        }),
      ),
    );
    const agentOutcomes = agentResults
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    const parsedAgentResults = agentOutcomes
      .filter((outcome) => outcome.ok)
      .map((outcome) => outcome.result);
    if (!parsedAgentResults.length) {
      // Agent verification failed (usage limit / no auth / run error). The
      // scan must NOT pass on local-only signals — broadcast a blocked state
      // with the next scan-ready provider in the consent chain instead of a
      // workspace_scan_result. With no available
      // provider at all, Agentic30 cannot proceed: fail closed.
      const failure = agentOutcomes.find((outcome) => !outcome.ok) || {
        provider: scanTargets[0]?.provider || "codex",
        model: scanTargets[0]?.model || "",
        reason: "error",
        message: "",
      };
      broadcastWorkspaceScanBlocked(scanRoot, failure, {
        evidenceBundle: workspaceScanEvidenceBundle,
      });
      return;
    }
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
      scan_provider: normalizeProviderName(preferredProvider) || "frontier",
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
    const day1GoalSelection = await loadDay1GoalSelection({ workspaceRoot: scanRoot });
    if (path.resolve(scanRoot) === path.resolve(workspaceRoot)) {
      state.day1GoalSelection = day1GoalSelection;
    }
    // Scan complete: anchor challenge start, then advance the day loop to `goal`.
    let dayProgress = null;
    try {
      if (path.resolve(scanRoot) === path.resolve(workspaceRoot)) {
        const seeded = await ensureChallengeStart({ workspaceRoot: scanRoot });
        const currentDay = computeDayNumber({ challengeStartedAt: seeded.challengeStartedAt });
        dayProgress = currentDay
          ? await setDayActiveStep({
              workspaceRoot: scanRoot,
              day: currentDay,
              stepId: "goal",
              goalText: currentDay === 1 ? day1GoalSelection?.goalText : undefined,
            })
          : seeded;
      } else {
        dayProgress = await loadDayProgress({ workspaceRoot: scanRoot });
      }
    } catch {
      dayProgress = await loadDayProgress({ workspaceRoot: scanRoot }).catch(() => null);
    }
    if (path.resolve(scanRoot) === path.resolve(workspaceRoot)) {
      state.dayProgress = dayProgress;
    }
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
    const scanCurrentDay = dayProgress ? computeDayNumber({ challengeStartedAt: dayProgress.challengeStartedAt }) : null;
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
      day1GoalSelection,
      dayProgress,
      dayReviews: await loadOfficeHoursDayReviews(scanRoot, dayProgress, scanCurrentDay),
      evidenceOS: await loadOfficeHoursEvidenceOS(scanRoot, dayProgress, scanCurrentDay),
    });
    triggerDay1AlignmentPlanBroadcast({
      scanRoot,
      deterministicPlan: day1AlignmentPlan,
      compatibilityIcpPlan: day1IcpPlan,
      preferredProvider,
    });
  } catch (error) {
    captureSidecarLog("workspace scan failed", "error", {
      operation: "runWorkspaceScan",
      scan_root: scanRoot,
      ...errorTelemetryProperties(error),
    });
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

function normalizeWorkspaceRootInput(value, { cwd = process.cwd(), env = process.env } = {}) {
  let text = String(value || "").trim();
  if (!text) return "";
  if (text === "@") text = ".";
  if (text === "@." || text.startsWith("@./")) text = text.slice(1);
  if (text.startsWith("@/") || text.startsWith("@~/")) text = text.slice(1);
  if (text === "~") text = env.HOME || os.homedir();
  if (text.startsWith("~/")) text = path.join(env.HOME || os.homedir(), text.slice(2));
  return path.resolve(cwd, text);
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
        `다음 액션: \`${projectDocPath("icp")}\` 하나부터 만들고 Day 1 판단 기준을 적으세요.`,
      ];
  await appendVisibleAssistantMessage(sessionId, lines.join("\n"));
}

/**
 * Runs the single agent-backed verification pass of the workspace scan.
 * Always resolves to a structured outcome — never throws, never silently
 * swallows a failure into "use local signals instead":
 * - `{ ok: true, provider, model, result }` on success
 * - `{ ok: false, provider, model, reason, message }` with reason
 *   "unavailable" (no auth), "usage_limit" (quota), or "error" (run fault).
 * The foreground scan path turns a failed outcome into workspace_scan_blocked;
 * background refreshes simply skip the merge.
 */
async function runWorkspaceScanAgent({ provider, model, scanRoot, evidenceBundle = null }) {
  const authState = getProviderAuthState(provider);
  if (!authState.available) {
    telemetry.captureEvent("mac_sidecar_workspace_scan_provider_skipped", {
      provider,
      model,
      reason: authState.source,
    });
    captureSidecarLog("workspace scan provider unavailable", "warn", {
      operation: "runWorkspaceScanAgent",
      provider,
      model,
      reason: "unavailable",
      auth_source: authState.source || "",
      auth_message: authState.message || "",
      scan_root: scanRoot,
    });
    return {
      ok: false,
      provider,
      model,
      reason: "unavailable",
      message: authState.message || "",
    };
  }

  const abortController = new AbortController();
  // Two-stage wall-clock bound. At ABORT_MS we ask the provider SDK to stop via
  // the abort signal; at HARD_DEADLINE_MS we force this function to return even
  // if the SDK never honors the signal (e.g. blocked on MCP startup or tool
  // I/O). Without the hard deadline a stuck codex/claude run can hang the Day-1
  // scan indefinitely instead of failing over to the blocked/switch-provider UI.
  const abortTimer = setTimeout(() => abortController.abort(), WORKSPACE_SCAN_AGENT_ABORT_MS);
  let hardDeadlineTimer = null;
  const hardDeadline = new Promise((_, reject) => {
    hardDeadlineTimer = setTimeout(() => {
      try { abortController.abort(); } catch { /* already aborted */ }
      reject(new Error("workspace scan provider exceeded hard deadline"));
    }, WORKSPACE_SCAN_AGENT_HARD_DEADLINE_MS);
  });
  let responseText = "";
  const providerLabel = workspaceScanProviderLabel(provider, model);
  const scanEvidenceBundle = evidenceBundle || await buildWorkspaceScanEvidenceBundle({
    workspaceRoot: scanRoot,
    scanResult: {},
  });
  broadcastWorkspaceScanProgress(scanRoot, `scan.agent · ${providerLabel}가 질문 근거를 확인 중`, {
    stage: "verifying",
    stepIndex: 2,
    totalSteps: 3,
  });
  const scanPrompt = buildWorkspaceScanAgentPrompt(scanEvidenceBundle);
  const systemPromptOverride = [
    "You are a fast semantic verifier for a local workspace scan.",
    "Do not modify files. Do not run network commands.",
    "Do not discover or report document paths. Local deterministic scanning is authoritative for paths.",
    "Return only one JSON object with keys: onboardingHypothesis, situationSignals, confidence, evidencePathsUsed.",
  ].join("\n");

  try {
    await Promise.race([
      runProviderStream({
        provider,
        prompt: scanPrompt,
        model,
        workspaceRoot: scanRoot,
        abortController,
        // Lightweight read-only scan lane: no QMD/PostHog/Cloudflare/GitHub/
        // internal MCP boot, low codex reasoning effort, low claude turn
        // ceiling. This is the bulk of the latency win — the heavy "agentic"
        // mode booted four external MCP servers a doc scanner never needs.
        executionMode: "workspace_scan_read_only",
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
      }),
      hardDeadline,
    ]);
    const parsed = parseWorkspaceScanText(responseText);
    const semantic = normalizeWorkspaceScanSemanticOutput(parsed, scanEvidenceBundle);
    const result = {
      onboardingHypothesis: semantic.onboardingHypothesis,
      situationSignals: normalizeWorkspaceSituationSignals(semantic.situationSignals, scanRoot),
      confidence: semantic.confidence,
      evidencePathsUsed: semantic.evidencePathsUsed,
    };
    const evidenceCount = result.evidencePathsUsed.length;
    broadcastWorkspaceScanProgress(
      scanRoot,
      `scan.agent · ${providerLabel} 완료 (${evidenceCount}개 의미 근거)`,
      {
        stage: "verifying",
        stepIndex: 2,
        totalSteps: 3,
        foundCount: evidenceCount,
      },
    );
    return { ok: true, provider, model, result };
  } catch (error) {
    const errorKind = reportProviderRunError(error, {
      operation: "runWorkspaceScanAgent",
      provider,
      model,
      scan_root: scanRoot,
    });
    if (errorKind === PROVIDER_USAGE_LIMIT_ERROR_KIND) {
      broadcastWorkspaceScanProgress(
        scanRoot,
        `scan.agent · ${providerLabel} 사용 한도 도달`,
        {
          stage: "verifying",
          stepIndex: 2,
          totalSteps: 3,
        },
      );
    }
    return {
      ok: false,
      provider,
      model,
      reason: errorKind === PROVIDER_USAGE_LIMIT_ERROR_KIND
        ? "usage_limit"
        : errorKind === PROVIDER_AUTH_REQUIRED_ERROR_KIND
          ? "unavailable"
          : "error",
      message: formatError(error),
    };
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(hardDeadlineTimer);
  }
}

/**
 * Tells the Mac side a Day 1 synthesis provider hit its usage limit (quota) so
 * the UI can surface an explicit "switch provider and re-verify" button. No
 * automatic fallback happens on this side — provider switching requires the
 * user's consent via that button (see IntakeV2ShowcaseViews). The scan stage
 * itself no longer uses this: a failed scan verification broadcasts
 * workspace_scan_blocked instead (the scan must not pass on local signals).
 */
function broadcastWorkspaceScanProviderLimited(scanRoot, { provider, model, stage }) {
  broadcast({
    type: "workspace_scan_provider_limited",
    scanRoot,
    provider,
    model,
    stage,
    errorKind: PROVIDER_USAGE_LIMIT_ERROR_KIND,
  });
}

/**
 * The scan's agent verification failed (usage limit, missing provider auth, or
 * a run error). Day 1 must not proceed on local-only signals, so instead of a
 * successful workspace_scan_result the Mac side gets this blocking notice with
 * the next scan-ready provider in the consent chain.
 * Switching still requires the user's click; when no provider is available at
 * all (`nextProvider: null`) the UI says Agentic30 cannot proceed.
 */
function broadcastWorkspaceScanBlocked(scanRoot, { provider, model, reason, message }, { evidenceBundle = null } = {}) {
  const failedProviderAuthState = getProviderAuthState(provider);
  const { nextProvider, availableProviders } = selectNextScanProvider(
    provider,
    (candidate) => getProviderScanReadiness(candidate).scanReady,
  );
  const providerReadiness = PROVIDER_FALLBACK_CYCLE.map((candidate) => getProviderScanReadiness(candidate));
  const localFindings = summarizeWorkspaceScanLocalFindings(evidenceBundle);
  const installedProviders = providerReadiness
    .filter((item) => item.sdkInstalled)
    .map((item) => item.provider);
  const scanReadyProviders = providerReadiness
    .filter((item) => item.scanReady)
    .map((item) => item.provider);
  const authRequiredProviders = providerReadiness
    .filter((item) => item.sdkInstalled && !item.authenticated)
    .map((item) => item.provider);
  telemetry.captureEvent("mac_sidecar_workspace_scan_blocked", {
    scan_root: scanRoot,
    selected_provider: provider,
    failed_provider: provider,
    provider,
    model,
    reason,
    next_provider: nextProvider || "none",
    available_provider_count: availableProviders.length,
    installed_providers: installedProviders,
    scan_ready_providers: scanReadyProviders,
    auth_required_providers: authRequiredProviders,
    provider_readiness: providerReadiness,
    auth_source: failedProviderAuthState.source || "",
    auth_available: failedProviderAuthState.available === true,
    local_found_count: localFindings.localFoundCount,
  });
  captureSidecarLog("workspace scan blocked", workspaceScanBlockedLogLevel(reason), {
    operation: "runWorkspaceScan",
    scan_root: scanRoot,
    selected_provider: provider,
    failed_provider: provider,
    provider,
    model,
    reason,
    next_provider: nextProvider || "none",
    available_provider_count: availableProviders.length,
    installed_providers: installedProviders,
    scan_ready_providers: scanReadyProviders,
    auth_required_providers: authRequiredProviders,
    provider_readiness: providerReadiness,
    auth_source: failedProviderAuthState.source || "",
    auth_available: failedProviderAuthState.available === true,
    local_found_count: localFindings.localFoundCount,
    failure_detail: truncateTelemetryString(message || ""),
  });
  markWorkspaceSetupFailed(
    scanRoot,
    Object.assign(new Error(`workspace scan blocked: ${provider} ${reason}`), {
      code: "workspace_scan_blocked",
    }),
  );
  const providerLabel = workspaceScanProviderLabel(provider, model);
  broadcastWorkspaceScanProgress(
    scanRoot,
    nextProvider
      ? `scan.blocked · ${providerLabel} 검증 불가 — 다른 에이전트로 전환이 필요합니다`
      : "scan.blocked · 사용 가능한 에이전트가 없어 진행할 수 없습니다",
    {
      stage: "blocked",
      stepIndex: 2,
      totalSteps: 3,
    },
  );
  broadcast({
    type: "workspace_scan_blocked",
    scanRoot,
    provider,
    model,
    reason,
    message: String(message || ""),
    stage: "blocked",
    stepIndex: 2,
    totalSteps: 3,
    nextProvider,
    availableProviders,
    providerReadiness,
    localFoundCount: localFindings.localFoundCount,
    localFindings,
    ...(reason === "usage_limit" ? { errorKind: PROVIDER_USAGE_LIMIT_ERROR_KIND } : {}),
    ...(reason === "unavailable" ? { errorKind: PROVIDER_AUTH_REQUIRED_ERROR_KIND } : {}),
  });
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
  if (provider === "codex") return `Codex (${model})`;
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
    const value = typeof docs?.[key] === "string" && docs[key].trim() ? docs[key].trim() : null;
    result[key] = isCanonicalProjectDocPath(value, key) ? value : null;
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
  if (!isCanonicalProjectDocPath(trimmed, role)) return null;
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

function isCanonicalProjectDocPath(relativePath, role = "") {
  const canonical = projectDocPath(role);
  if (!canonical) return false;
  return String(relativePath || "").trim().replace(/\\/g, "/").toLowerCase() === canonical.toLowerCase();
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
      .map((value) => String(value).trim())
      .filter((value) => isCanonicalProjectDocPath(value, key));
    candidates.sort((a, b) => workspaceScanPathScore(b, key) - workspaceScanPathScore(a, key) || a.localeCompare(b));
    merged[key] = candidates[0] || null;
  }
  return merged;
}

function workspaceScanPathScore(relativePath, role) {
  const normalized = String(relativePath || "").toLowerCase();
  let score = 0;
  const canonical = projectDocPath(role).toLowerCase();
  if (canonical && normalized === canonical) score += 90;
  if (normalized.startsWith(".agentic30/docs/")) score += 35;
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
function triggerDay1AlignmentPlanBroadcast({ scanRoot, deterministicPlan, compatibilityIcpPlan = null, preferredProvider = "" }) {
  if (!scanRoot || !deterministicPlan) return;
  if (process.env.AGENTIC30_TEST_STUB_PROVIDER === "1") return;
  Promise.resolve()
    .then(async () => {
      const frontierResults = await runDay1ChoiceFrontierSynthesis({
        scanRoot,
        deterministicPlan,
        preferredProvider,
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

async function runDay1ChoiceFrontierSynthesis({ scanRoot, deterministicPlan, preferredProvider = "" }) {
  const providers = selectScanProviderTargets(preferredProvider, DAY1_CHOICE_MODEL_BY_PROVIDER);
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
      providers: providers.map(({ provider }) => provider).join(","),
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
  let responseText = "";
  let providerTimedOut = false;
  try {
    return await runWithSoftTimeout({
      timeoutMs: DAY1_CHOICE_PROVIDER_TIMEOUT_MS,
      abortController,
      onTimeout: () => {
        providerTimedOut = true;
        telemetry.captureEvent("mac_sidecar_day1_choice_frontier_provider_timeout", {
          provider,
          model,
          scan_root: scanRoot,
          timeout_ms: DAY1_CHOICE_PROVIDER_TIMEOUT_MS,
        });
      },
      onLateError: (error) => {
        telemetry.captureException(error, {
          operation: "runDay1ChoiceFrontierProviderLateError",
          provider,
          model,
          scan_root: scanRoot,
        });
      },
      operation: async () => {
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
            if (providerTimedOut) return;
            responseText += text;
          },
          onTextReplace: (text) => {
            if (providerTimedOut) return;
            responseText = text;
          },
          onRunEvent: (event) => {
            if (providerTimedOut || event.once) return;
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
      },
    });
  } catch (error) {
    const errorKind = reportProviderRunError(error, {
      operation: "runDay1ChoiceFrontierProvider",
      provider,
      model,
      scan_root: scanRoot,
    });
    if (errorKind === PROVIDER_USAGE_LIMIT_ERROR_KIND) {
      broadcastWorkspaceScanProviderLimited(scanRoot, { provider, model, stage: "day1_synthesis" });
    }
    return null;
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

function boundedIntegerEnv(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  const normalizedMin = Number.isFinite(min) ? Math.trunc(min) : 1;
  const normalizedMax = Number.isFinite(max) ? Math.trunc(max) : normalizedMin;
  const normalizedFallback = Number.isFinite(fallback) ? Math.trunc(fallback) : normalizedMin;
  const candidate = Number.isFinite(parsed) ? parsed : normalizedFallback;
  return Math.max(normalizedMin, Math.min(normalizedMax, candidate));
}

function createAsyncSemaphore(limit = 1) {
  const maxActive = Math.max(1, Math.trunc(limit));
  const queue = [];
  let active = 0;

  function drain() {
    while (active < maxActive && queue.length > 0) {
      const resolve = queue.shift();
      active += 1;
      resolve();
    }
  }

  return async function runWithSemaphore(task) {
    if (typeof task !== "function") {
      throw new TypeError("Semaphore task must be a function.");
    }
    await new Promise((resolve) => {
      queue.push(resolve);
      drain();
    });
    try {
      return await task();
    } finally {
      active = Math.max(0, active - 1);
      drain();
    }
  };
}

function resolveNewsMarketRadarExaRoutes({
  preferredProvider = "",
} = {}) {
  return resolveExaResearchRoutes({
    discoveredRoutes: discoverExaMcpRoutes(),
    apiKey: currentExaApiKey(),
    preferredProvider,
  });
}

function normalizeProviderName(value = "") {
  const provider = String(value || "").trim().toLowerCase();
  return ["claude", "codex", "gemini", "cursor"].includes(provider) ? provider : "";
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

const WORK_HISTORY_PROVIDER_TIMEOUT_MS = 180_000;

function buildWorkHistoryProgressStatus(progress = {}, { reason, startedAt, stale = false } = {}) {
  return {
    state: "refreshing",
    lastSuccessAt: null,
    stale,
    error: null,
    reason: reason || null,
    stage: progress.stage || null,
    progressText: progress.progressText || null,
    elapsedMs: startedAt ? Date.now() - startedAt : null,
  };
}

function scheduleWorkHistoryRefresh({ reason = "manual", targetSocket = null, preferredProvider = "" } = {}) {
  const normalizedReason = ["manual", "tab_enter", "background"].includes(reason)
    ? reason
    : "manual";
  if (state.workHistoryRefreshPromise) {
    const status = buildWorkHistoryProgressStatus(state.workHistoryProgress || {}, {
      reason: normalizedReason,
      startedAt: state.workHistoryProgressStartedAt,
      stale: true,
    });
    state.workHistoryProgress = status;
    send(targetSocket, { type: "work_history_status", status });
    return state.workHistoryRefreshPromise;
  }
  const promise = runWorkHistoryRefresh({ reason: normalizedReason, targetSocket, preferredProvider }).finally(() => {
    state.workHistoryRefreshPromise = null;
    state.workHistoryProgress = null;
    state.workHistoryProgressStartedAt = null;
  });
  state.workHistoryRefreshPromise = promise;
  return promise;
}

/// One-shot Claude pass that refines the deterministic weekly snapshot (area
/// names + coach summaries). No tools/MCP; strict-JSON contract; any failure
/// falls back to the deterministic snapshot inside composeWorkHistorySnapshot.
async function runWorkHistoryClaudeRefinement(prompt) {
  const cliPath = resolveClaudeCodeEntrypoint();
  const env = buildClaudeAgentEnv();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), WORK_HISTORY_PROVIDER_TIMEOUT_MS);
  const options = {
    pathToClaudeCodeExecutable: cliPath ?? undefined,
    executable: process.execPath,
    env,
    cwd: workspaceRoot,
    maxTurns: 1,
    includePartialMessages: false,
    abortController,
    systemPrompt: [
      "You refine a weekly work retrospective for Agentic30's History tab.",
      "Korean coach tone. Never invent data; never change numbers.",
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
  } finally {
    clearTimeout(timeout);
  }
}

/// Provider-aware one-shot refinement for non-Claude providers. Text-only
/// (isolated_read_only → no tools/MCP); strict-JSON contract is embedded in the
/// prompt because the text-only path does not forward a separate system prompt.
/// Any failure falls back to the deterministic snapshot in composeWorkHistorySnapshot.
async function runWorkHistoryProviderRefinement(prompt, { provider, model = "" } = {}) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), WORK_HISTORY_PROVIDER_TIMEOUT_MS);
  let text = "";
  try {
    const guardedPrompt = [
      "You refine a weekly work retrospective for Agentic30's History tab.",
      "Korean coach tone. Never invent data; never change numbers.",
      "Return strict JSON only.",
      "",
      prompt,
    ].join("\n");
    await runProviderStream({
      provider,
      prompt: guardedPrompt,
      model,
      workspaceRoot,
      abortController,
      executionMode: "isolated_read_only",
      onTextDelta: (chunk) => { text += String(chunk || ""); },
      onTextReplace: (replacement) => { text = String(replacement || ""); },
    });
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWorkHistoryRefresh({ reason = "manual", targetSocket = null, preferredProvider = "" } = {}) {
  const startedAt = Date.now();
  state.workHistoryProgressStartedAt = startedAt;
  // Honor the user's settings-selected provider; default to codex when none is
  // supplied. No provider fallback.
  const provider = normalizeProviderName(preferredProvider) || "codex";
  const emitProgress = (progress = {}) => {
    const status = buildWorkHistoryProgressStatus(progress, { reason, startedAt });
    state.workHistoryProgress = status;
    broadcast({ type: "work_history_status", status });
    return status;
  };
  emitProgress({ stage: "start", progressText: "이번 주 작업 기록을 인덱싱하는 중" });
  try {
    const snapshot = await refreshWorkHistory({
      workspaceRoot,
      reason,
      queryImpl: (prompt) => provider === "claude"
        ? runWorkHistoryClaudeRefinement(prompt)
        : runWorkHistoryProviderRefinement(prompt, { provider }),
      onProgress: emitProgress,
    });
    broadcast({ type: "work_history_result", workHistory: snapshot });
    telemetry.captureEvent("mac_sidecar_work_history_refresh_completed", {
      reason,
      duration_ms: Date.now() - startedAt,
      ai_minutes: snapshot.totals?.aiMinutes || 0,
      my_commit_count: snapshot.totals?.myCommitCount || 0,
      session_count: snapshot.totals?.sessionCount || 0,
      unclassified_count: snapshot.unclassified?.length || 0,
      github_connected: Boolean(snapshot.github?.connected),
      status: snapshot.status?.state || "",
    });
    return snapshot;
  } catch (error) {
    telemetry.captureException(error, { operation: "work_history_refresh", reason });
    const cached = await loadWorkHistorySnapshot({ workspaceRoot });
    const failed = {
      ...cached,
      status: {
        ...cached.status,
        state: "failed",
        stale: true,
        error: formatError(error),
        reason,
      },
    };
    const payload = { type: "work_history_result", workHistory: failed };
    if (targetSocket) send(targetSocket, payload);
    else broadcast(payload);
    return failed;
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
  // Single explicit provider route (or codex default). No multi-route/provider
  // fallback: if the chosen route's provider is unavailable or fails, surface
  // the error directly.
  const routes = normalizeNewsMarketRadarProviderRoutes({
    exaMcpConfig,
    exaResearchRoute,
    exaResearchRoutes,
  });
  const route = routes[0];
  if (!route) {
    throw new Error("웹 검색 도구가 설정되지 않았습니다");
  }
  const provider = normalizeProviderName(route.provider);
  if (!provider) {
    throw new Error(`${route.label || "웹 검색 도구"} 사용 불가: AI 연결이 설정되지 않았습니다`);
  }
  const authState = getProviderAuthState(provider);
  if (!authState.available) {
    throw new Error(`${providerLabel(provider)} 사용 불가: ${authState.message || authState.source || "설정되지 않음"}`);
  }
  const routeLabel = route.label || `${providerLabel(provider)} 웹 검색 도구`;
  if (typeof onProgress === "function") {
    onProgress({
      stage: "running_provider_research",
      progressText: `${routeLabel}로 공개 근거를 검색하는 중`,
      researchSource: routeLabel,
    });
  }
  const text = await runWithMarketResearchProviderBudget(async () => (
    provider === "claude"
      ? await runNewsMarketRadarClaudeResearch({ prompt, exaMcpConfig: route.mcpConfig })
      : provider === "gemini"
        ? await runNewsMarketRadarGeminiResearch({ prompt, exaMcpConfig: route.mcpConfig })
        : await runNewsMarketRadarCodexResearch({ prompt, exaMcpConfig: route.mcpConfig })
  ));
  return {
    text,
    provider,
    researchSource: route.label || `${providerLabel(provider)} 웹 검색 도구`,
    exaResearchRoute: redactExaResearchRoute(route),
  };
}

async function runNewsMarketRadarProviderSynthesis({
  prompt,
  provider = "",
  preferredProvider = "",
} = {}) {
  // Single explicit provider (or codex default). No precedence fallback: if the
  // chosen provider is unavailable or fails, surface the error directly.
  const candidate = normalizeProviderName(provider) || normalizeProviderName(preferredProvider) || "codex";
  const authState = getProviderAuthState(candidate);
  if (!authState.available) {
    throw new Error(`${providerLabel(candidate)} 합성 사용 불가: ${authState.message || authState.source || "설정되지 않음"}`);
  }
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

function withCodexExaMcpToolTimeout(mcpConfig) {
  if (!mcpConfig || typeof mcpConfig !== "object") return mcpConfig;
  if (Number.isFinite(mcpConfig.tool_timeout_sec)) return mcpConfig;
  return {
    ...mcpConfig,
    tool_timeout_sec: CODEX_EXA_MCP_TOOL_TIMEOUT_SEC,
  };
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
  const cliPath = resolveClaudeCodeEntrypoint();
  const env = buildClaudeAgentEnv();
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  const options = {
    pathToClaudeCodeExecutable: cliPath ?? undefined,
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
  const cliPath = resolveClaudeCodeEntrypoint();
  const env = buildClaudeAgentEnv();
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, NEWS_MARKET_RADAR_PROVIDER_TIMEOUT_MS);
  const options = {
    pathToClaudeCodeExecutable: cliPath ?? undefined,
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
        exa: withCodexExaMcpToolTimeout(exaMcpConfig || buildExaMcpConfig(currentExaApiKey())),
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
  throw new Error("웹 검색 도구 연결에 URL 또는 실행 명령이 없습니다.");
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

async function runCreateDoc(docRoot, docType, { preferredProvider = "" } = {}) {
  // Honor the user's settings-selected provider; default to codex when none is
  // supplied. No provider fallback.
  const provider = normalizeProviderName(preferredProvider) || "codex";
  const authState = getProviderAuthState(provider);
  if (!authState.available) {
  broadcast({
      type: "doc_creation_result",
      docType,
      error: `${provider} is not available. ` + authState.message,
    });
    return;
  }

  const templates = {
    icp: {
      filename: projectDocPath("icp"),
      guide: [
        "Create an Ideal Customer Profile (ICP) document for this project.",
        "Include: target persona, demographics, pain points, Jobs To Be Done (JTBD),",
        "current alternatives, and why this product is a better fit.",
      ].join(" "),
    },
    spec: {
      filename: projectDocPath("spec"),
      guide: [
        "Create a Product Specification (SPEC) document for this project.",
        "Include: product vision, core features, user stories, success metrics,",
        "technical constraints, and MVP scope.",
      ].join(" "),
    },
    values: {
      filename: projectDocPath("values"),
      guide: [
        "Create a VALUES document for this project.",
        "Include: decision principles, tradeoff rules, things this project refuses to do,",
        "and concrete behavioral examples grounded in the current project context.",
      ].join(" "),
    },
    designSystem: {
      filename: projectDocPath("designSystem"),
      guide: [
        "Create a Design System document for this project.",
        "Include: color palette, typography, spacing system, key UI components,",
        "interaction patterns, and accessibility guidelines.",
      ].join(" "),
    },
    adr: {
      filename: projectDocPath("adr"),
      guide: [
        "Create an Architecture Decision Records (ADR) document for this project.",
        "Include: ADR template format (Title, Status, Context, Decision, Consequences),",
        "and write 2-3 initial ADRs based on the actual tech stack and architecture choices visible in the codebase.",
      ].join(" "),
    },
    goal: {
      filename: projectDocPath("goal"),
      guide: [
        "Create a Goal / OKR document for this project.",
        "Include: quarterly objectives with key results, weekly milestone targets,",
        "personal development goals related to the project, and a progress tracking format.",
      ].join(" "),
    },
    docs: {
      filename: projectDocPath("docs"),
      guide: [
        "Create a documentation map for this project.",
        "Include: canonical sources of truth, onboarding path, document ownership,",
        "update cadence, and maintenance rules.",
      ].join(" "),
    },
    sheet: {
      filename: projectDocPath("sheet"),
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
    const systemPrompt = [
      "You are a project document generator. Your job is to explore the given workspace,",
      "understand the project's purpose, tech stack, and current state, then create a specific document.",
      "",
      "Strategy:",
      "1. List root directory and key files (README, package.json, Cargo.toml, etc.)",
      "2. Read the README and existing canonical `.agentic30/docs/*` files to understand the project",
      "3. Check the source code structure to understand the architecture",
      "4. Write the document based on REAL project data — not generic templates",
      "",
      "IMPORTANT:",
      "- Write all document content in Korean (한국어)",
      "- Use markdown format",
      "- Base everything on actual project analysis — be specific, reference real files and features",
      "- Use only `.agentic30/docs/*` product-shape files as seed context.",
      `- Save the file to: ${template.filename}`,
      "- Create the parent directory if needed",
    ].join("\n");

    const abortController = new AbortController();

  const prompt = [
      `${template.guide}`,
      "",
      `Explore this workspace first, then write the document and save it to "${template.filename}".`,
    ].join("\n");

    await runProviderStream({
      provider,
      prompt,
      workspaceRoot: docRoot,
      abortController,
      executionMode: "agentic",
      approvedToolExecution: true,
      systemPromptOverride: systemPrompt,
      onToolEvent: (toolEvent) => {
        const summary = formatChatToolEvent(toolEvent);
        if (summary) {
          broadcast({ type: "doc_creation_progress", docType, progressText: summary });
        }
      },
    });

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
    cursor: getProviderConnectionState("cursor"),
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
  executionOs = null,
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
    executionOs,
    mcpOauthTraces: readRecentMcpOauthTraces({ appSupportPath, limit: 10 }),
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
    lines.push(`ICP doc: ${projectDocPath("icp")}`);
    lines.push(`SPEC doc: ${projectDocPath("spec")}`);
    lines.push(`VALUES doc: ${projectDocPath("values")}`);
    lines.push(`Design System docs: ${projectDocPath("designSystem")}`);
    lines.push(`ADR docs: ${projectDocPath("adr")}`);
    lines.push(`Goal doc: ${projectDocPath("goal")}`);
    lines.push(`Docs map: ${projectDocPath("docs")}`);
    lines.push(`Sheet schema: ${projectDocPath("sheet")}`);

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
  resolvedContent = stripTrailingRubricFocusMetadata(resolvedContent);
  if (
    typeof resolvedContent === "string"
    && !extractedDecision
    && !message.inlineDecision
    && !session.pendingUserInput
    && !activeOfficeHoursContext(session)
  ) {
    const inferred = inferInlineDecisionFromPlainText(resolvedContent);
    if (inferred.decision) {
      resolvedContent = inferred.text;
      extractedDecision = inferred.decision;
    }
  }
  resolvedContent = stripTrailingRubricFocusMetadata(resolvedContent);

  // Wire-level emphasis extraction for free-response chat replies. Like the
  // inline_decision sentinel above, the LLM emits an ===EMPHASIS=== block; the
  // host strips it from the visible body and attaches the normalized spans to
  // `message.emphasis` so the SwiftUI client renders style-aware inline
  // emphasis. Mutually exclusive with inline_decision: when this turn produced
  // a decision card the free-text body is just the question, so we skip.
  let extractedEmphasis = null;
  if (
    typeof resolvedContent === "string"
    && !extractedDecision
    && !message.inlineDecision
    && resolvedContent.includes(OFFICE_HOURS_EMPHASIS_SENTINEL_START)
    && resolvedContent.includes(OFFICE_HOURS_EMPHASIS_SENTINEL_END)
  ) {
    const extracted = extractOfficeHoursChatEmphasis(resolvedContent);
    resolvedContent = extracted.text;
    if (extracted.emphasis.length) {
      extractedEmphasis = extracted.emphasis;
    }
  }

  message.content = resolvedContent;
  if (extractedDecision) {
    message.inlineDecision = extractedDecision;
  }
  if (extractedEmphasis) {
    message.emphasis = extractedEmphasis;
  }
  touch(session);
  broadcast({
    type: "message_replaced",
    sessionId: session.id,
    messageId,
    content: resolvedContent,
    state: message.state,
  });
  // `message_replaced` only carries content; the SwiftUI client needs a full
  // session refresh when inlineDecision or emphasis metadata changes.
  if (extractedDecision || extractedEmphasis) {
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
  const officeHoursDay = normalizeOfficeHoursDay(payload.officeHoursDay ?? payload.office_hours_day);
  const runtime = {};
  if (officeHoursDay) {
    runtime.officeHours = {
      active: false,
      source: String(payload.source || "office_hours_screen"),
      day: officeHoursDay,
    };
  }
  return {
    id: randomUUID(),
    title: officeHoursDay ? `Office Hours · Day ${officeHoursDay}` : "New Session",
    provider,
    model,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    error: null,
    messages: [],
    pendingUserInput: null,
    runtime,
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
    } else if (!activeOfficeHoursContext(session)) {
      const inferred = inferInlineDecisionFromPlainText(resolvedContent);
      if (inferred.decision) {
        resolvedDecision = inferred.decision;
        resolvedContent = inferred.text;
      }
    }
  }
  if (role === "assistant" || role === "system") {
    resolvedContent = stripTrailingRubricFocusMetadata(resolvedContent);
  }

  // Wire-level emphasis extraction for free-response chat replies (see
  // setAssistantText for the streaming-finalize twin). Only runs for assistant/
  // system free text that did not produce an inline_decision card.
  let resolvedEmphasis = null;
  if (
    (role === "assistant" || role === "system")
    && resolvedDecision == null
    && typeof resolvedContent === "string"
    && resolvedContent.includes(OFFICE_HOURS_EMPHASIS_SENTINEL_START)
    && resolvedContent.includes(OFFICE_HOURS_EMPHASIS_SENTINEL_END)
  ) {
    const extracted = extractOfficeHoursChatEmphasis(resolvedContent);
    resolvedContent = extracted.text;
    if (extracted.emphasis.length) {
      resolvedEmphasis = extracted.emphasis;
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
  if (Array.isArray(resolvedEmphasis) && resolvedEmphasis.length) {
    message.emphasis = resolvedEmphasis;
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

async function suppressOfficeHoursRequestAfterQuestionCap(session, request, activeRequestIds) {
  if (session?.runtime?.officeHours?.active !== true || !request?.requestId) {
    return false;
  }
  const progress = await getOfficeHoursQuestionProgress(session);
  if (!progress.capReached) return false;

  await deleteUserInputArtifacts(appSupportPath, request.sessionId || session.id, request.requestId);
  state.resolvedUserInputIds.add(request.requestId);
  activeRequestIds?.delete?.(request.requestId);
  session.pendingUserInput = null;
  session.status = "idle";
  session.error = null;
  stampOfficeHoursExpectedCountCompletion(session, progress);
  await abortActiveOfficeHoursRunAtQuestionCap(session);
  touch(session);
  emitOfficeHoursQuestionCapCompleted(session, progress, request.requestId);
  return true;
}

async function syncPendingUserInputRequests() {
  const requests = await listUserInputRequests(appSupportPath);
  const activeRequestIds = new Set(requests.map((request) => request.requestId));
  const changedSessions = new Set();

  for (const request of requests) {
    if (state.resolvedUserInputIds.has(request.requestId)) continue;
    const session = state.sessions.get(request.sessionId);
    if (!session) continue;
    if (await suppressOfficeHoursRequestAfterQuestionCap(session, request, activeRequestIds)) {
      changedSessions.add(session.id);
      continue;
    }
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

    let nextRequest = request;
    if (session.runtime?.officeHours?.active === true) {
      try {
        nextRequest = prepareOfficeHoursStructuredInputRequest(request);
      } catch (error) {
        const message = formatError(error);
        await deleteUserInputArtifacts(appSupportPath, request.sessionId, request.requestId).catch(() => {});
        state.resolvedUserInputIds.add(request.requestId);
        activeRequestIds.delete(request.requestId);
        if (session.pendingUserInput?.requestId === request.requestId) {
          session.pendingUserInput = null;
        }
        session.status = "error";
        session.error = message;
        touch(session);
        changedSessions.add(session.id);
        emitOfficeHoursStatus(session, {
          stage: "failed",
          detail: message,
          progressText: message,
          requestId: request.requestId,
        });
        broadcast({
          type: "error",
          sessionId: session.id,
          message,
        });
        continue;
      }
    }
    session.pendingUserInput = attachIddAdaptiveContinuationToRequest(session, nextRequest);
    session.status = "awaiting_input";
    touch(session);
    changedSessions.add(session.id);
    if (isOfficeHoursStructuredRequest(session.pendingUserInput)) {
      const requestCreatedAtMs = Date.parse(request.createdAt || "");
      const requestReadyLatencyMs = Number.isFinite(requestCreatedAtMs)
        ? Math.max(0, Date.now() - requestCreatedAtMs)
        : null;
      telemetry.captureEvent("mac_sidecar_office_hours_question_ready", {
        session_id: session.id,
        provider: session.provider,
        request_id: request.requestId,
        request_ready_latency_ms: requestReadyLatencyMs,
      });
      emitOfficeHoursStatus(session, {
        stage: "question_ready",
        requestId: request.requestId,
      });
    }
  }

  for (const session of state.sessions.values()) {
    const pending = session.pendingUserInput;
    if (
      pending
      && await suppressOfficeHoursRequestAfterQuestionCap(session, pending, activeRequestIds)
    ) {
      changedSessions.add(session.id);
      continue;
    }
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
      // Keep the full option so the hint can fold in the risk / evidence /
      // failure-mode reasoning the card UI no longer shows the user.
      if (!lookup.has(label)) lookup.set(label, option);
    }
  }
  if (lookup.size === 0) return "";
  const descriptions = [];
  for (const entry of response.responses || []) {
    const selectedOptions = Array.isArray(entry?.selectedOptions) ? entry.selectedOptions : [];
    for (const option of selectedOptions) {
      const label = typeof option === "string" ? option.trim() : "";
      if (!label || isOtherTextOptionLabel(label)) continue;
      const matched = lookup.get(label);
      if (!matched) continue;
      const hint = formatSelectedOptionEvidenceHint(matched);
      if (hint) descriptions.push(hint);
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

function truncateTelemetryString(value, maxLength = 500) {
  return String(value || "").slice(0, maxLength);
}

function errorTelemetryProperties(error) {
  return {
    error_type: error instanceof Error ? (error.name || "Error") : typeof error,
    error_message: truncateTelemetryString(formatError(error)),
  };
}

function captureSidecarLog(message, level = "info", properties = {}) {
  try {
    telemetry.captureLog?.(message, level, properties);
  } catch {
    // Telemetry must never affect product flow.
  }
}

function logOfficeHoursSourceGateBlocked({
  session = null,
  day = 0,
  gate = null,
  selectedSources = [],
} = {}) {
  captureSidecarLog("office_hours_source_gate_blocked", "warn", {
    operation: "office_hours_source_gate_blocked",
    session_id: session?.id || "",
    provider: session?.provider || "",
    day: normalizeOfficeHoursDay(day) || 0,
    reason: gate?.reason || "",
    selected_sources: Array.isArray(selectedSources) ? selectedSources : [],
    missing_required_sources: Array.isArray(gate?.missingRequiredSources)
      ? gate.missingRequiredSources
      : [],
    connect_action_count: Array.isArray(gate?.connectActions)
      ? gate.connectActions.length
      : 0,
  });
}

function reportIntegrationStatusFailures(integrationStatus = {}) {
  const probes = [
    ["github", integrationStatus.github],
    ["github_mcp", integrationStatus.githubMcp],
    ["posthog", integrationStatus.posthog],
    ["cloudflare", integrationStatus.cloudflare],
    ["vercel", integrationStatus.vercel],
  ];
  for (const [integration, probe] of probes) {
    const stateName = String(probe?.state || "");
    if (!["failed", "missing"].includes(stateName)) continue;
    const properties = {
      operation: "integration_status_check",
      integration,
      state: stateName,
      detail: truncateTelemetryString(probe?.detail || ""),
      provider: integrationStatus.provider || "",
    };
    telemetry.captureEvent("mac_sidecar_integration_probe_unhealthy", properties);
    captureSidecarLog("integration probe unhealthy", stateName === "failed" ? "error" : "warn", properties);
  }
}

function reportMcpOauthConnectOutcome(result = {}) {
  const stateName = String(result.state || "");
  if (!stateName || stateName === "ready" || stateName === "progress") return;
  const properties = {
    operation: "mcp_oauth_connect",
    server: result.server || "",
    provider: result.provider || "",
    state: stateName,
    provider_limited: result.providerLimited === true,
    has_login_url: Boolean(result.loginUrl),
    detail: truncateTelemetryString(result.detail || ""),
  };
  const level = stateName === "failed" && result.providerLimited !== true ? "error" : "warn";
  captureSidecarLog("mcp oauth connect did not complete", level, properties);
  if (stateName === "failed" && result.providerLimited !== true) {
    telemetry.captureException(
      new Error(`MCP OAuth connect failed: ${properties.server || "unknown"} (${properties.provider || "unknown"})`),
      properties,
    );
  }
}

/**
 * Marks the `type: "error"` envelope so the Mac side can tell an expected
 * upstream provider usage-limit (quota) condition apart from a real fault. The
 * Swift bridge keys on `errorKind` to surface a "retry later / switch provider"
 * message instead of capturing a generic exception (see AgenticViewModel).
 */
const PROVIDER_USAGE_LIMIT_ERROR_KIND = "provider_usage_limit";
const PROVIDER_AUTH_REQUIRED_ERROR_KIND = "provider_auth_required";

/**
 * True for an expected, recoverable upstream provider quota condition
 * (Codex/ChatGPT usage limits, Cursor RateLimitError, HTTP 429). Such errors
 * are tracked as a benign telemetry event rather than a captured exception on
 * either side of the bridge.
 */
function isRecoverableProviderQuotaError(error) {
  return isProviderUsageLimitError(error);
}

function providerRecoverableErrorKind(error) {
  if (isRecoverableProviderQuotaError(error)) return PROVIDER_USAGE_LIMIT_ERROR_KIND;
  if (isProviderAuthRequiredError(error)) return PROVIDER_AUTH_REQUIRED_ERROR_KIND;
  return null;
}

/**
 * Routes a failed provider-run error to telemetry: a benign event for expected
 * recoverable provider states, a captured exception otherwise. Returns the
 * recoverable error kind so the caller can tag the broadcast envelope.
 * `captureProps` is shared between both lanes.
 */
function reportProviderRunError(error, captureProps) {
  const errorKind = providerRecoverableErrorKind(error);
  const logProps = {
    ...captureProps,
    ...errorTelemetryProperties(error),
  };
  if (errorKind === PROVIDER_USAGE_LIMIT_ERROR_KIND) {
    telemetry.captureEvent("mac_sidecar_provider_usage_limit", captureProps);
    captureSidecarLog("provider usage limit", "warn", logProps);
    return errorKind;
  }
  if (errorKind === PROVIDER_AUTH_REQUIRED_ERROR_KIND) {
    telemetry.captureEvent("mac_sidecar_provider_auth_required", captureProps);
    captureSidecarLog("provider auth required", "warn", logProps);
    return errorKind;
  }
  captureSidecarLog("provider run failed", "error", logProps);
  telemetry.captureException(error, captureProps);
  return null;
}

/**
 * Extra fields added to a `type: "error"` broadcast when the failure was a
 * recoverable provider quota cap, so the Mac side can surface a "retry later /
 * switch provider" message instead of capturing a generic exception.
 */
function providerRecoverableErrorEnvelope(errorKind) {
  return errorKind
    ? { errorKind, recoverable: true }
    : {};
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

  const claudeEntrypoint = provider === "claude" ? resolveClaudeCodeEntrypoint() : null;
  if (provider === "claude" && !claudeEntrypoint) {
    broadcast({
      type: "provider_auth_result",
      provider,
      success: false,
      error: "Claude Agent SDK CLI is missing. Reinstall sidecar dependencies and retry.",
    });
    return;
  }
  const command = provider === "claude"
    ? (claudeEntrypoint.endsWith(".js")
      ? {
          // Legacy (<0.3) Agent SDK layout: Node script run via the current runtime.
          executable: process.execPath,
          args: [claudeEntrypoint, "auth", "login", "--claudeai"],
          env: buildClaudeLoginEnv(),
      }
      : {
          executable: claudeEntrypoint,
          args: ["auth", "login", "--claudeai"],
          env: buildClaudeLoginEnv(),
      })
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
      telemetry.captureEvent("mac_sidecar_bip_readiness_row_completed", { row_id: id });

      // all_complete fires when all user-facing BIP setup rows are done
      if (bipReadinessCompletedRows.size === bipReadinessUserFacingRows.size && bipReadinessViewedAt != null) {
        const total_duration_ms_from_view = Date.now() - bipReadinessViewedAt;
        telemetry.captureEvent("mac_sidecar_bip_readiness_all_complete", { total_duration_ms_from_view });
        bipReadinessViewedAt = null;
        bipReadinessCompletedRows.clear();
    }
    }

    // Telemetry: row_failed
    if (status === "blocked" && error) {
      telemetry.captureEvent("mac_sidecar_bip_readiness_row_failed", {
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
    await persistAndBroadcastBipCoach("mac_sidecar_bip_readiness_resource_connected", {
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
  telemetry.captureEvent("mac_sidecar_bip_readiness_card_viewed", { initial_completion });
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
  telemetry.captureEvent("mac_sidecar_bip_readiness_row_completed", {
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

  telemetry.captureEvent("mac_sidecar_bip_readiness_row_started", { row_id: "gwsAuth" });
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
  telemetry.captureEvent("mac_sidecar_bip_readiness_row_started", { row_id: "gwsInstall" });
    const installStartedAt = Date.now();
    installGws({
      env: process.env,
      onLog(line) {
        broadcast({ type: "bip_readiness_event", rowId: "gwsInstall", status: "in-progress", log: line });
      },
      onComplete({ success, error }) {
        if (success) {
          telemetry.captureEvent("mac_sidecar_bip_readiness_row_completed", {
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
  telemetry.captureEvent("mac_sidecar_bip_readiness_row_started", { row_id: rowId, action: "copy_template" });
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
      telemetry.captureEvent("mac_sidecar_bip_readiness_row_completed", {
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
  telemetry.captureEvent("mac_sidecar_bip_readiness_row_started", { row_id: rowId });
    const validateStartedAt = Date.now();
    validateUrl({ env: process.env, url, kind }).then((result) => {
      if (result.ok) {
        persistConnectedBipResource(rowId, kind, {
          ...result,
          url,
        }).then(() => {
          telemetry.captureEvent("mac_sidecar_bip_readiness_row_completed", {
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
    fireAndForget(
      "check_gws_auth_status_recheck",
      checkGwsAuthStatus({ env: process.env }).then(({ done, error }) => {
        emitRow("gwsAuth", done ? "done" : "blocked", undefined, done ? undefined : error);
        if (done) {
          emitRow("docUrl", "pending");
          emitRow("sheetUrl", "pending");
        }
      }),
    );
    return;
  }
}
