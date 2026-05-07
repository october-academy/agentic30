import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";
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
  ensureQmdMemoryCollections,
  getQmdState,
} from "./qmd-support.mjs";
import { createTelemetryClient } from "./telemetry.mjs";
import { createPetHooks } from "./pet-hooks.mjs";
import { getCachedBipContext } from "./context-cache.mjs";
import { classifyChatExecutionRoute as classifyChatExecutionRouteWithState } from "./chat-route.mjs";
import {
  deriveWorkspaceOnboardingHypothesisLocally,
  mergeWorkspaceOnboardingHypotheses,
  normalizeWorkspaceOnboardingHypothesis,
} from "./onboarding-hypothesis.mjs";
import {
  buildAuthEnv,
  clearAuthContext,
  getAuthContextSummary,
  setAuthContext,
} from "./auth-context.mjs";
import { initiateNotionOAuth, exchangeOAuthCode, refreshAccessToken } from "./notion-oauth.mjs";
import { buildPreflightReport } from "./preflight.mjs";
import { getProviderAuthState, runProviderStream } from "./provider-runner.mjs";
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
  persistBipCoachState,
  pickSheetTab,
  summarizeSheetValues,
  todayKey,
} from "./bip-coach-state.mjs";
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
  buildIddContinuationPrompt,
  buildIddDocumentPrompt,
  deriveLocalDocReadinessRows,
  docTypeFromLocalRowId,
  getBipSetupGateStatus,
  initialIddStructuredInputForDoc,
  requiredDocByType,
  summarizeBipSetupGate,
} from "./idd-doc-gate.mjs";
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
const BIP_TEMPLATE_DOC_ID = process.env.AGENTIC30_BIP_TEMPLATE_DOC_ID || "1EoQIaByJd5Aq8ENbgEfxHKKJsZsup7d5gJxcT7uqNeA";
const BIP_TEMPLATE_SHEET_ID = process.env.AGENTIC30_BIP_TEMPLATE_SHEET_ID || "16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA";
const WORKSPACE_SCAN_CLAUDE_MODEL = "claude-haiku-4-5";
const WORKSPACE_SCAN_CODEX_MODEL = "gpt-5.4-mini";
const CHAT_BIP_CONTEXT_MAX_CHARS = 60000;
const CHAT_BIP_LOCAL_DOC_MAX_CHARS = 12000;
const CHAT_BIP_EXTERNAL_DOC_MAX_CHARS = 12000;
const CHAT_BIP_SHEET_MAX_ROWS = 25;
const CHAT_BIP_EXTERNAL_CACHE_TTL_MS = 5 * 60 * 1000;
const INSTANT_CHAT_COMPLETE_SLO_MS = 1_000;

const state = {
  sessions: new Map(),
  activeRuns: new Map(),
  warmRuns: new Map(),
  promptQueues: new Map(),
  clients: new Set(),
  resolvedUserInputIds: new Set(),
  bipCoach: null,
  bipCoachRunning: false,
  providerAuthRuns: new Map(),
  workspaceOnboardingHypothesis: null,
};
const chatBipExternalContextCache = new Map();

function currentBipConfig() {
  return readJsonFile(path.join(appSupportPath, "bip-config.json"));
}

function currentBipSetupGate() {
  return getBipSetupGateStatus({
    workspaceRoot,
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
await persistBipCoachState(bipCoachFilePath, state.bipCoach);
const telemetry = createTelemetryClient({ appSupportPath, workspaceRoot });
telemetry.captureEvent("mac_sidecar_booted", {
  session_count: state.sessions.size,
});
void refreshPersistedBipCoachReadinessOnBoot();
const userInputPoll = setInterval(() => {
  void syncPendingUserInputRequests();
}, 250);

const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
let shutdownStarted = false;
let clientDisconnectTimer = null;
const parentProcessPoll = startParentProcessPoll();

wss.on("connection", (socket) => {
  clearClientDisconnectTimer();
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

  socket.on("close", () => {
    state.clients.delete(socket);
    scheduleShutdownWhenClientless();
  });
});

wss.on("listening", () => {
  const address = wss.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(
    `${JSON.stringify({ type: "sidecar-ready", port, pid: process.pid })}\n`,
  );
  setTimeout(bootstrapQmdMemoryCollections, 0);
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
        void shutdown();
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
      void shutdown();
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

async function handleClientMessage(socket, payload) {
  switch (payload.type) {
    case "list_sessions":
      send(socket, { type: "sessions_snapshot", sessions: serializeSessions() });
      return;
    case "create_session": {
      const session = createSession(payload);
      await attachBootstrapIntake(session);
      state.sessions.set(session.id, session);
      await persistSessions();
      await syncAndBroadcastBipCoachSessionState({ preferredSessionId: session.id });
      telemetry.captureEvent("mac_sidecar_session_created", {
        session_id: session.id,
        provider: session.provider,
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
      void warmSession(session).catch((error) => {
        telemetry.captureException(error, {
          operation: "warmSession",
          session_id: session.id,
          provider: session.provider,
        });
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
      if (state.activeRuns.has(session.id)) {
        await enqueuePrompt(session, prompt);
        return;
      }
      cancelWarmSession(session.id);
      await runPrompt(session, prompt);
      return;
    }
    case "submit_user_input": {
      const session = getSession(payload.sessionId);
      const requestId = String(payload.requestId || "").trim();
      if (!requestId || session.pendingUserInput?.requestId !== requestId) {
        throw new Error("No matching structured input request is waiting for this session.");
      }

      const {
        prompt: iddContinuationPrompt,
        docType: iddContinuationDocType,
      } = takePendingIddContinuationPrompt(session, requestId);
      const response = normalizeUserInputResponse(session.pendingUserInput, payload);
      const userResponseText = formatStructuredPromptResponse(response);
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
      session.status = hasActiveRun ? "running" : "idle";
      touch(session);
      await persistSessions();
      telemetry.captureEvent("mac_sidecar_structured_input_received", {
        session_id: session.id,
        provider: session.provider,
        request_id: requestId,
        response_count: Array.isArray(payload.responses) ? payload.responses.length : 0,
      });
      broadcast({ type: "session_updated", session });
      if (!hasActiveRun && (userResponseText || iddContinuationPrompt)) {
        let continuationSpecialistInjection = "";
        if (iddContinuationPrompt) {
          const continuationDoc = iddContinuationDocType
            ? requiredDocByType(iddContinuationDocType)
            : null;
          const continuationSelection = selectSpecialist({
            bipSetupGate: currentBipSetupGate(),
            doc: continuationDoc,
            lastAnswer: userResponseText,
          });
          continuationSpecialistInjection = buildSpecialistInjection(continuationSelection);
          telemetry.captureEvent("mac_sidecar_specialist_routed", {
            session_id: session.id,
            stage: "idd_continuation",
            specialist_id: continuationSelection.id,
            phase: continuationSelection.phase,
            decision_kind: continuationSelection.decisionKind,
            doc_type: iddContinuationDocType || "",
          });
        }
        await runPrompt(
          session,
          iddContinuationPrompt
            ? buildIddContinuationPrompt({
                iddPrompt: iddContinuationPrompt,
                structuredResponseText: userResponseText,
                specialistInjection: continuationSpecialistInjection,
              })
            : userResponseText,
          { displayUserMessage: false, defaultTitle: session.title },
        );
      }
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
      broadcast({
        type: "workspace_scan_started",
        scanRoot: root,
        progressText: "Starting workspace scan...",
      });
      runWorkspaceScan(root);
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
      await generateBipCoachMission({
        sessionId: payload.sessionId,
        provider: payload.provider,
        compact: Boolean(payload.compact),
        curriculumDay: payload.curriculumDay,
      });
      return;
    }
    case "bip_setup_gate_check": {
      const gate = currentBipSetupGate();
      broadcastBipSetupGateState(gate);
      if (payload.autoStart === true && !gate.ready) {
        await startIddDocumentQueue({
          gate,
          sessionId: payload.sessionId,
          provider: payload.provider,
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
    case "get_diagnostics": {
      const environment = getEnvironmentSummary();
      const preflight = buildSidecarPreflight(environment);
      send(socket, {
        type: "diagnostics_snapshot",
        diagnostics: buildSidecarDiagnostics(environment, preflight),
      });
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

  const authState = getProviderAuthState(session.provider);
  if (!authState.available) {
    throw new Error(authState.message);
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

    const route = classifyChatExecutionRoute(prompt);
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
      onPetHookEvent: session.provider === "claude" ? broadcast : undefined,
    });

    session.runtime = runtime;
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
        "Do not answer the user yet. Reply exactly: READY",
      ].join("\n"),
      model: session.model,
      workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      executionMode: "fast_chat",
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

    if (!abortController.signal.aborted) {
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

async function enqueuePrompt(session, prompt) {
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
  await runPrompt(session, next.prompt, { displayUserMessage: false });
}

function scheduleQueuedPromptRun(session) {
  queueMicrotask(() => {
    runNextQueuedPrompt(session.id).catch((error) => {
      telemetry.captureException(error, {
        operation: "runNextQueuedPrompt",
        session_id: session.id,
        provider: session.provider,
      });
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
    const result = await runProviderStream({
      provider: session.provider,
      sessionRuntime: session.runtime,
      prompt: userPrompt,
      workspaceRoot,
      abortController,
      sessionIdForMcp: session.id,
      executionMode: "agentic",
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
      onPetHookEvent: session.provider === "claude" ? broadcast : undefined,
      systemPromptOverride: buildOfficeHoursDocsSystemPrompt(workspaceRoot, {
        specialistInjection: (() => {
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
          });
          return buildSpecialistInjection(officeHoursSelection);
        })(),
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
  const posthogKey = process.env.POSTHOG_API_KEY || adConfig?.posthog?.apiKey;
  const posthogHost = process.env.POSTHOG_HOST || adConfig?.posthog?.host || "https://us.posthog.com";

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

    // 2. Build MCP servers config (internal + optional PostHog + optional Notion)
    const mcpServers = {
      [internalMcpServerName]: buildMcpConfig(session.id),
      ...buildNotionMcpConfig(),
      ...buildQmdMcpConfig({ sidecarRoot }),
    };

    if (posthogKey) {
      mcpServers["posthog"] = {
        type: "http",
        url: `${posthogHost.replace(/\/$/, "")}/mcp`,
        headers: {
          Authorization: `Bearer ${posthogKey}`,
        },
      };
    }

    // 3. Build specialized system prompt
    const strategyPrompt = [
      buildAdStrategyPrompt(targetUrl, metaReport, !!posthogKey),
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
      posthogKey
        ? "Use the PostHog MCP tools to query UTM data, scroll depth, and conversion funnels for this URL before writing your analysis."
        : "",
      "Provide a comprehensive ad performance improvement strategy in Korean (한국어).",
    ]
      .filter(Boolean)
      .join(" ");

    const stream = query({
      prompt: analysisPrompt,
      options: { ...options, hooks: createPetHooks(broadcast, { sessionId: session.id }) },
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
    return bipManifest
      ? [
          bipManifest,
          "## User Message",
          prompt,
        ].join("\n\n")
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

function classifyChatExecutionRoute(prompt) {
  return classifyChatExecutionRouteWithState(prompt, {
    qmdAvailable: getQmdState({ sidecarRoot }).available,
  });
}

async function buildInstantChatResponse(prompt) {
  const context = await getCachedBipContext({
    appSupportPath,
    workspaceRoot,
  });
  const lower = String(prompt || "").toLowerCase();
  const hasIcp = /icp|고객|유저|user|customer/i.test(context.text);
  const hasSpec = /spec|proof|baseline|target|목표|검증/i.test(context.text);
  const lines = [
    "짧게 보면, 이건 Agent 실행보다 Day 1 코칭 fast path로 처리할 수 있습니다.",
  ];
  if (hasIcp) {
    lines.push("ICP 기준으로는 먼저 “실제로 반복해서 겪는 문제”와 “오늘 확인할 응답”을 좁히는 게 맞습니다.");
  }
  if (hasSpec || lower.includes("spec") || lower.includes("proof")) {
    lines.push("SPEC에는 현재 proof baseline, 다음 proof target, 오늘 확인할 사용자 반응을 한 줄씩 남기세요.");
  }
  if (lower.includes("fast path") || lower.includes("blank")) {
    lines.push("이미 랜딩/프로토타입이 있다면 blank-slate가 아니라 fast path입니다. 새 아이디어 발굴보다 기존 가정 검증이 먼저입니다.");
  }
  lines.push("다음 액션: 오늘 한 명에게 보여줄 질문 1개를 정하고, 답변이 오면 그 문장 그대로 SPEC에 붙이세요.");
  return {
    text: lines.join("\n"),
    contextChars: context.text.length,
    cacheHit: context.cacheHit,
    files: context.files,
  };
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

    const bipPrompt = [
      buildBipPrompt(bipConfig, topic),
      buildQmdGuidance(bipConfig.workspace.root || workspaceRoot, { appSupportPath, sidecarRoot }),
    ].filter(Boolean).join("\n\n");

    const mcpServers = {
      [internalMcpServerName]: buildMcpConfig(session.id),
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
      options: { ...options, hooks: createPetHooks(broadcast, { sessionId: session.id }) },
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
    await setBipCoachError("BIP Coach is already working.", "mac_sidecar_bip_coach_busy");
    return;
  }
  if (!isBipCoachConfigured(state.bipCoach)) {
    await setBipCoachError(
      "BIP Coach needs one Google Docs URL and one Google Sheets URL in Settings > Build In Public.",
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
      error: null,
    },
  };
}

async function generateBipCoachMission({ sessionId, provider, compact = false, curriculumDay = null } = {}) {
  if (state.bipCoachRunning) {
    await setBipCoachError("BIP Coach is already working.", "mac_sidecar_bip_coach_busy");
    return;
  }

  const gate = currentBipSetupGate();
  if (!gate.ready) {
    await startIddDocumentQueue({ gate, sessionId, provider });
    return;
  }

  if (!isBipCoachConfigured(state.bipCoach)) {
    await setBipCoachError(
      "BIP Coach needs one Google Docs URL and one Google Sheets URL in Settings > Build In Public.",
      "mac_sidecar_bip_coach_not_configured",
    );
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
      || (provider === "claude" || provider === "codex" ? provider : state.bipCoach.config.provider);
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
        emitMissionProgress("generating", "확인한 BIP 근거로 미션 후보를 생성하는 중", {
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
            content: "BIP 데이터와 선택한 Day 커리큘럼을 기준으로 오늘 수행할 미션 후보 3개를 만들었어요. 하나를 고르면 바로 실행 코치 모드로 이어갈게요.",
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
          content: "Codex/Claude 생성 연결이 불안정해서, 방금 읽은 BIP 데이터와 선택한 Day 커리큘럼만으로 바로 실행 가능한 미션 후보 3개를 만들었어요. 하나를 고르면 실행 코치 모드로 이어갈게요.",
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
      })[0];
    }));
    return parseMissionChoicesResponse(JSON.stringify({ missions: results }), {
      provider,
      compact,
      today,
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
    "You are generating structured missions for the Agentic30 BIP Coach card.",
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

  if (normalizedName.includes("gws_exec")) {
    if (event?.phase === "use") {
      if (payloadLooksLikeSheetValuesRead(payload)) {
        toolUsage.sheetValuesRequested = true;
        onEvidenceProgress?.("reading_sheet", "Agent가 gws CLI로 SNS 기록 Sheet 전체 범위를 읽는 중", {
          provider,
        });
      }
      if (payloadLooksLikeDocRead(payload)) {
        toolUsage.docRequested = true;
        onEvidenceProgress?.("reading_doc", "Agent가 gws CLI로 업무일지 Doc 전체 payload를 읽는 중", {
          provider,
        });
      }
      return;
    }
    if (event?.phase === "result") {
      if (toolUsage.sheetValuesRequested || payloadText.includes("\"values\"")) {
        toolUsage.sheetValuesRead = true;
      }
      if (toolUsage.docRequested || payloadText.includes("\"body\"")) {
        toolUsage.docRead = true;
      }
    }
  }
}

function payloadLooksLikeSheetValuesRead(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return text.includes("sheets")
    && text.includes("spreadsheets")
    && text.includes("values")
    && text.includes("get")
    && payloadHasFullSheetRange(payload);
}

function payloadLooksLikeDocRead(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return text.includes("docs")
    && text.includes("documents")
    && text.includes("get");
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
  const threadsUrl = String(payload.threadsUrl || "").trim();
  const sheetRowNote = String(payload.sheetRowNote || "").trim();
  if (!threadsUrl || !sheetRowNote) {
    await setBipCoachError(
      "Completion requires both a Threads URL and a Sheet row note.",
      "mac_sidecar_bip_coach_completion_rejected",
    );
    return;
  }

  try {
    state.bipCoach = completeBipCoachMission(state.bipCoach, {
      threadsUrl,
      sheetRowNote,
    });
    await persistAndBroadcastBipCoach("mac_sidecar_bip_coach_mission_completed", {
      streak_current: state.bipCoach.streak.current,
      streak_longest: state.bipCoach.streak.longest,
    });
    broadcast({ type: "bip_coach_completion_completed", bipCoach: state.bipCoach });
  } catch (error) {
    await setBipCoachError(formatError(error), "mac_sidecar_bip_coach_completion_failed");
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
    return state.sessions.get(requestedSessionId);
  }
  const currentSessionId = state.bipCoach?.sessionId;
  if (currentSessionId && state.sessions.has(currentSessionId)) {
    return state.sessions.get(currentSessionId);
  }
  return serializeSessions()[0] ?? null;
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

function resolveIddSessionSeed({ sessionId = "", provider = "" } = {}) {
  const requestedSession = resolveBipCoachSession(sessionId);
  const resolvedProvider = provider === "claude" || provider === "codex"
    ? provider
    : requestedSession?.provider || state.bipCoach?.config?.provider || "codex";
  return {
    provider: resolvedProvider,
    model: requestedSession?.provider === resolvedProvider ? requestedSession.model : "",
  };
}

function findExistingIddSession(docType) {
  const marker = `[IDD:${docType}]`;
  return [...state.sessions.values()].find((session) =>
    session.title?.includes(marker)
    && (session.status === "running" || session.status === "awaiting_input" || session.status === "idle")
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
  };
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

async function startIddDocumentQueue({
  gate = null,
  sessionId = "",
  provider = "",
  requestedDocType = "",
} = {}) {
  const resolvedGate = gate ?? currentBipSetupGate();
  const requestedDoc = requestedDocType ? requiredDocByType(String(requestedDocType)) : null;
  const nextDoc = requestedDoc && resolvedGate.missingLocalDocs.some((doc) => doc.type === requestedDoc.type)
    ? requestedDoc
    : resolvedGate.nextLocalDoc;
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

  const existing = findExistingIddSession(nextDoc.type);
  if (existing) {
    broadcast({
      type: "bip_idd_session_ready",
      sessionId: existing.id,
      iddDocumentType: nextDoc.type,
      iddDocumentTitle: nextDoc.title,
      ...serializeBipSetupGate(resolvedGate),
    });
    await setBipCoachError(
      `${message} 이미 열린 ${nextDoc.title} IDD 세션에서 먼저 문서를 완성해주세요.`,
      "mac_sidecar_bip_coach_idd_required",
    );
    return existing;
  }

  const seed = resolveIddSessionSeed({ sessionId, provider });
  const session = createSession(seed);
  session.title = `IDD: ${nextDoc.title} [IDD:${nextDoc.type}]`;
  state.sessions.set(session.id, session);
  await persistSessions();
  await syncAndBroadcastBipCoachSessionState({ preferredSessionId: session.id });
  broadcast({ type: "session_created", session });
  broadcast({
    type: "bip_idd_session_ready",
    sessionId: session.id,
    iddDocumentType: nextDoc.type,
    iddDocumentTitle: nextDoc.title,
    ...serializeBipSetupGate(resolvedGate),
  });

  await setBipCoachError(
    `${message} ${nextDoc.title} 문서부터 별도 IDD 세션을 시작했어요.`,
    "mac_sidecar_bip_coach_idd_required",
  );

  const initialSelection = selectSpecialist({
    bipSetupGate: resolvedGate,
    doc: nextDoc,
  });
  const initialSpecialistInjection = buildSpecialistInjection(initialSelection);
  telemetry.captureEvent("mac_sidecar_specialist_routed", {
    session_id: session.id,
    stage: "idd_document_start",
    specialist_id: initialSelection.id,
    phase: initialSelection.phase,
    decision_kind: initialSelection.decisionKind,
    doc_type: nextDoc.type,
  });
  const prompt = buildIddDocumentPrompt(nextDoc, {
    provider: seed.provider,
    workspaceRoot,
    queue: resolvedGate.missingLocalDocs,
    specialistInjection: initialSpecialistInjection,
  });
  const initialStructuredInput = initialIddStructuredInputForDoc(nextDoc, {
    provider: seed.provider,
    onboardingHypothesis: await currentWorkspaceOnboardingHypothesis(),
    onboardingContext: getAuthContextSummary().onboardingContext,
  });
  if (initialStructuredInput) {
    session.pendingUserInput = await createUserInputRequest(appSupportPath, {
      sessionId: session.id,
      toolName: initialStructuredInput.toolName,
      title: initialStructuredInput.title,
      questions: initialStructuredInput.questions,
    });
    session.runtime = {
      ...(session.runtime || {}),
      pendingIddContinuation: {
        requestId: session.pendingUserInput.requestId,
        docType: nextDoc.type,
        prompt,
      },
    };
    session.status = "awaiting_input";
    touch(session);
    await persistSessions();
    broadcast({ type: "session_updated", session });
    return session;
  }

  void (async () => {
    try {
      await runPrompt(session, prompt, {
        displayUserMessage: false,
        defaultTitle: session.title,
      });
      const nextGate = currentBipSetupGate();
      broadcastBipSetupGateState(nextGate);
      if (
        !nextGate.ready
        && nextGate.nextLocalDoc
        && nextGate.nextLocalDoc.type !== nextDoc.type
      ) {
        await startIddDocumentQueue({
          gate: nextGate,
          provider: seed.provider,
        });
      }
    } catch (error) {
      telemetry.captureException(error, {
        operation: "startIddDocumentQueue.runPrompt",
        session_id: session.id,
        doc_type: nextDoc.type,
      });
    }
  })();
  return session;
}

async function runWorkspaceScan(scanRoot) {
  try {
    broadcastWorkspaceScanProgress(scanRoot, "Checking common doc filenames locally...");
    const localResult = await findWorkspaceDocsLocally(scanRoot);
    const localOnboardingHypothesis = await deriveWorkspaceOnboardingHypothesisLocally(scanRoot, {
      docPaths: localResult,
    });
    const localFoundCount = countWorkspaceScanResults(localResult);
    broadcastWorkspaceScanProgress(
      scanRoot,
      localFoundCount > 0
        ? `Found ${localFoundCount} local candidate(s). Asking agents to verify context...`
        : "No exact local matches yet. Asking agents to inspect the workspace...",
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
    ]);
    const parsedAgentResults = agentResults
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    const merged = mergeWorkspaceScanResults(localResult, ...parsedAgentResults);
    const onboardingHypothesis = mergeWorkspaceOnboardingHypotheses(
      localOnboardingHypothesis,
      ...parsedAgentResults.map((result) => result.onboardingHypothesis),
    );
    state.workspaceOnboardingHypothesis = onboardingHypothesis;
    const foundCount = countWorkspaceScanResults(merged);

    telemetry.captureEvent("mac_sidecar_workspace_scan_completed", {
      scan_root: scanRoot,
      found_count: foundCount,
      onboarding_hypothesis_confidence: onboardingHypothesis.confidence,
      claude_model: WORKSPACE_SCAN_CLAUDE_MODEL,
      codex_model: WORKSPACE_SCAN_CODEX_MODEL,
      agent_result_count: parsedAgentResults.length,
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
    });
  } catch (error) {
    telemetry.captureException(error, {
      operation: "runWorkspaceScan",
      scan_root: scanRoot,
    });
    broadcast({
      type: "workspace_scan_result",
      scanRoot,
      error: formatError(error),
    });
  }
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
  broadcastWorkspaceScanProgress(scanRoot, `Scanning with ${providerLabel}...`);
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
    "- projectKind: short snake_case product type such as mac_app, web_app, developer_tool, node_app, strategy_docs, or unknown",
    "- likelyUsers: 1-4 concrete Korean user segments visible from repository evidence",
    "- stage: idea, prototype, first_users, pre_revenue, post_revenue, or unknown",
    "- evidence: 1-5 short facts from README/docs/package/config/recent files",
    "- confidence: low, medium, or high",
    "- suggestedFirstQuestion: one Korean question that asks the user to confirm or correct the hypothesis",
    "",
    "Prefer exact filenames under docs/. If exact files are absent, use the closest matching project document.",
    "Return paths relative to the workspace root. Use null when not found.",
    '{"icp": null, "spec": null, "values": null, "designSystem": null, "adr": null, "goal": null, "docs": null, "sheet": null, "onboardingHypothesis": {"projectKind": "unknown", "likelyUsers": [], "stage": "unknown", "evidence": [], "confidence": "low", "suggestedFirstQuestion": ""}}',
  ].join("\n");
  const systemPromptOverride = [
    "You are a fast read-only workspace document scanner.",
    "Do not modify files. Do not run network commands.",
    "Use the smallest number of read-only filesystem inspections needed.",
    "Return only one JSON object with keys: icp, spec, values, designSystem, adr, goal, docs, sheet, onboardingHypothesis.",
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
          broadcastWorkspaceScanProgress(scanRoot, `${providerLabel}: ${summary}`);
        }
      },
    });
    const parsed = parseWorkspaceScanText(responseText);
    const result = {
      ...normalizeWorkspaceScanResult(parsed, scanRoot),
      onboardingHypothesis: normalizeWorkspaceOnboardingHypothesis(parsed?.onboardingHypothesis),
    };
    const foundCount = countWorkspaceScanResults(result);
    broadcastWorkspaceScanProgress(
      scanRoot,
      `${providerLabel} finished (${foundCount} found).`,
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
  broadcastWorkspaceScanProgress(scanRoot, `${providerLabel}: ${summary}`);
}

function broadcastWorkspaceScanProgress(scanRoot, progressText) {
  broadcast({
    type: "workspace_scan_progress",
    scanRoot,
    progressText,
  });
}

function workspaceScanProviderLabel(provider, model) {
  if (provider === "claude") return `Claude Haiku 4.5 (${model})`;
  if (provider === "codex") return `GPT 5.4 Mini (${model})`;
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
  const targets = {
    icp: ["icp.md"],
    spec: ["spec.md"],
    values: ["values.md", "principles.md", "product_values.md", "product-values.md"],
    designSystem: ["design.md", "design_system.md", "design-system.md"],
    adr: ["adr.md"],
    goal: ["goal.md"],
    docs: ["docs.md", "readme.md", "index.md"],
    sheet: ["sheet.md", "sheets.md", "bip_sheet.md"],
  };
  const result = emptyWorkspaceScanResult();
  const queue = [{ absolute: scanRoot, relative: "", depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && visited < 8000) {
    const current = queue.shift();
    visited += 1;
    let entries = [];
    try {
      entries = await fs.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (shouldSkipWorkspaceScanEntry(entry.name)) continue;
      const relativePath = current.relative ? path.posix.join(current.relative, entry.name) : entry.name;
      const absolutePath = path.join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 6) {
          queue.push({ absolute: absolutePath, relative: relativePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const filename = entry.name.toLowerCase();
      for (const [key, names] of Object.entries(targets)) {
        if (!result[key] && names.includes(filename)) {
          result[key] = relativePath;
        }
      }
    }
  }

  return result;
}

function shouldSkipWorkspaceScanEntry(name) {
  return [
    ".git",
    ".next",
    ".turbo",
    ".vercel",
    "build",
    "coverage",
    "dist",
    "DerivedData",
    "node_modules",
    "Pods",
    "vendor",
  ].includes(name);
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

function normalizeWorkspaceScanResult(input, scanRoot) {
  const result = emptyWorkspaceScanResult();
  if (!input || typeof input !== "object") return result;
  for (const key of Object.keys(result)) {
    result[key] = normalizeWorkspaceScanPath(input[key], scanRoot);
  }
  return result;
}

function normalizeWorkspaceScanPath(value, scanRoot) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  if (path.isAbsolute(trimmed) || trimmed.includes("\0")) return null;
  const resolved = path.resolve(scanRoot, trimmed);
  if (!resolved.startsWith(`${path.resolve(scanRoot)}${path.sep}`) && resolved !== path.resolve(scanRoot)) {
    return null;
  }
  if (!fsSync.existsSync(resolved)) return null;
  return path.relative(scanRoot, resolved).split(path.sep).join(path.posix.sep);
}

function mergeWorkspaceScanResults(...results) {
  return results.reduce((merged, result) => {
    if (!result) return merged;
    return {
      icp: merged.icp || result.icp || null,
      spec: merged.spec || result.spec || null,
      values: merged.values || result.values || null,
      designSystem: merged.designSystem || result.designSystem || null,
      adr: merged.adr || result.adr || null,
      goal: merged.goal || result.goal || null,
      docs: merged.docs || result.docs || null,
      sheet: merged.sheet || result.sheet || null,
    };
  }, emptyWorkspaceScanResult());
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
      options: { ...options, hooks: createPetHooks(broadcast, { sessionId: session.id }) },
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
  return path.resolve(sidecarRoot, "..", "node_modules", ...segments);
}

function buildMcpConfig(sessionId) {
  return {
    command: process.execPath,
    args: [path.join(sidecarRoot, "mcp-server.mjs"), "--session", sessionId, "--workspace", workspaceRoot],
    env: buildAuthEnv(),
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
    claude: getProviderAuthState("claude"),
    codex: getProviderAuthState("codex"),
    acp: getAcpAdapterState(),
    qmd: getQmdState({ sidecarRoot }),
  };
}

function bootstrapQmdMemoryCollections() {
  try {
    const bipConfig = readJsonFile(path.join(appSupportPath, "bip-config.json"));
    const qmdWorkspaceRoot = String(bipConfig?.workspace?.root || "").trim() || workspaceRoot;
    const result = ensureQmdMemoryCollections({
      workspaceRoot: qmdWorkspaceRoot,
      appSupportPath,
      sidecarRoot,
    });
    telemetry.captureEvent("mac_sidecar_qmd_memory_bootstrap", {
      attempted: result.attempted,
      updated: result.updated,
      reason: result.reason || "",
      collection_count: result.collections.length,
      qmd_source: result.qmd?.source || "",
    });
  } catch (error) {
    telemetry.captureException(error, {
      operation: "qmd_memory_bootstrap",
    });
  }
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
  return buildDiagnosticsSnapshot({
    appSupportPath,
    workspaceRoot,
    environment,
    preflight,
    sessions: serializeSessions(),
    activeRuns: state.activeRuns,
    sessionStoreSchemaVersion: SESSION_STORE_SCHEMA_VERSION,
  });
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
    "When you need the user's input, call the request_user_input MCP tool instead of asking in plain text.",
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
  message.content = content;
  touch(session);
  broadcast({
    type: "message_replaced",
    sessionId: session.id,
    messageId,
    content,
  });
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
  const provider = payload.provider === "claude" ? "claude" : "codex";
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

async function attachBootstrapIntake(session) {
  session.title = session.provider === "claude" ? "Claude Assistant" : "Codex Assistant";
  session.messages.push(
    makeMessage({
      role: "assistant",
      provider: session.provider,
      content: "무엇부터 시작할까요? 아래에서 고르거나 직접 입력하세요.",
      state: "final",
    }),
  );
  session.pendingUserInput = await createUserInputRequest(appSupportPath, {
    sessionId: session.id,
    toolName: "initial_intake",
    title: "시작하기",
    questions: buildBootstrapQuestions(),
  });
  session.status = "awaiting_input";
  touch(session);
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
          label: "BIP 초안 작성하기",
          description:
            "Build In Public 맥락을 불러와 게시글이나 개발 로그 초안을 다듬습니다.",
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
}) {
  const message = {
    id: randomUUID(),
    role,
    provider,
    content,
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
  return message;
}

function buildProviderAuthActionsForFailures(failures = []) {
  const text = failures.join("\n").toLowerCase();
  const providers = [];
  if (text.includes("claude") && looksLikeProviderAuthError(text)) providers.push("claude");
  if (text.includes("codex") && looksLikeProviderAuthError(text)) providers.push("codex");
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
    .filter((provider) => provider === "claude" || provider === "codex")
    .map((provider) => ({
      id: `${provider}_login`,
      provider,
      title: provider === "claude" ? "Claude 로그인" : "Codex 로그인",
      detail: provider === "claude"
        ? "Claude Agent SDK의 claude auth login을 실행합니다."
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

async function syncPendingUserInputRequests() {
  const requests = await listUserInputRequests(appSupportPath);
  const activeRequestIds = new Set(requests.map((request) => request.requestId));
  const changedSessions = new Set();

  for (const request of requests) {
    if (state.resolvedUserInputIds.has(request.requestId)) continue;
    const session = state.sessions.get(request.sessionId);
    if (!session) continue;
    if (session.pendingUserInput?.requestId === request.requestId) continue;

    session.pendingUserInput = request;
    session.status = "awaiting_input";
    touch(session);
    changedSessions.add(session.id);
  }

  for (const session of state.sessions.values()) {
    const pending = session.pendingUserInput;
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
    const answerValue = selectedOptions.length > 0
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

function formatStructuredPromptResponse(response) {
  const lines = [];
  for (const entry of response.responses || []) {
    const parts = [];
    if (Array.isArray(entry.selectedOptions) && entry.selectedOptions.length > 0) {
      parts.push(entry.selectedOptions.join(", "));
    }
    if (typeof entry.freeText === "string" && entry.freeText.trim()) {
      parts.push(entry.freeText.trim());
    }
    if (parts.length === 0) continue;
    lines.push(parts.join(" — "));
  }
  return lines.join("\n");
}

async function loadSessions() {
  if (process.env.AGENTIC30_RESTORE_SESSIONS_ON_BOOT !== "1") {
    await persistSessionsToFile(sessionsFilePath, []);
    return;
  }

  const sessions = await loadSessionsFromFile(sessionsFilePath);
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
  socket.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of state.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
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
  const provider = payload.provider === "claude" ? "claude" : "codex";
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
      ...deriveLocalDocReadinessRows(workspaceRoot, { bipConfig: currentBipConfig() }),
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
      ...deriveLocalDocReadinessRows(workspaceRoot, { bipConfig: currentBipConfig() }),
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
    void startGwsLoginFlow().catch((error) => {
      activeAuthCancels.delete("gwsAuth");
      emitRow("gwsAuth", "blocked", undefined, formatReadinessError(error));
    });
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
        `${result.name || title} 복사 완료 · 내 Google Drive · BIP Coach에 연결됨`,
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
