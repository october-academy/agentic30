import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SESSION_STORE_SCHEMA_VERSION = 2;
export const LEGACY_DEFAULT_CODEX_MODEL = "gpt-5.4";
export const PREVIOUS_DEFAULT_CODEX_MODEL = "gpt-5.2-codex";
export const REMOVED_CODEX_MINI_MODEL = "gpt-5.1-codex-mini";
export const CURRENT_DEFAULT_CODEX_MODEL = "gpt-5.5";
const LEGACY_DEFAULT_CODEX_MODELS = new Set([
  LEGACY_DEFAULT_CODEX_MODEL,
  PREVIOUS_DEFAULT_CODEX_MODEL,
  REMOVED_CODEX_MINI_MODEL,
]);

export function normalizePersistedSessionsPayload(parsed) {
  const rawSessions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sessions)
      ? parsed.sessions
      : [];

  return rawSessions
    .filter((session) => session && typeof session.id === "string")
    .map(normalizeSessionForStartup);
}

export function normalizeSessionForStartup(session) {
  const next = { ...session };
  const wasRunning = next.status === "running" || next.status === "awaiting_input";
  if (next.status === "running" || next.status === "awaiting_input") {
    next.status = "idle";
  }
  if (next.status === "error") {
    next.status = "idle";
    next.error = null;
  }
  if (next.provider === "codex" && LEGACY_DEFAULT_CODEX_MODELS.has(next.model)) {
    next.model = CURRENT_DEFAULT_CODEX_MODEL;
  }
  if (next.runtime?.codexThreadId) {
    next.runtime = {
      ...next.runtime,
      codexThreadId: null,
      codexThreadMeta: null,
    };
  }
  next.pendingUserInput = null;
  next.runtime = normalizeOfficeHoursRuntimeShapeForStartup(next.runtime);
  if (Array.isArray(next.messages)) {
    next.messages = next.messages
      .filter((message) => !isDiscardableRuntimeFailureMessage(message))
      .map((message) => normalizeMessageForStartup(message));
    if (wasRunning) {
      next.messages = closeOrphanedRun(next.messages, next.provider);
    }
  }
  return next;
}

// Runtime-only completion/readiness stamps are recomputed from durable turn memory
// on startup. Keep the persisted context/source metadata, but drop transient
// completion fields so a restart does not mistake stale UI runtime for an active
// pending card.
function normalizeOfficeHoursRuntimeShapeForStartup(runtime) {
  if (!runtime || typeof runtime !== "object") return runtime;
  const officeHours = runtime.officeHours;
  if (!officeHours || typeof officeHours !== "object") return runtime;
  const {
    completedByExpectedCount,
    completedQuestionCount,
    documentReadinessFollowupCount,
    terminalAnswered,
    documentReadiness,
    ...rest
  } = officeHours;
  return { ...runtime, officeHours: rest };
}

function normalizeMessageForStartup(message) {
  if (!message || typeof message !== "object") return message;
  if (message.role === "assistant" && message.state === "streaming") {
    const content = String(message.content || "").trim()
      || "이전 실행이 완료되기 전에 사이드카가 종료됐어요. 이 턴은 다시 시도할 수 있습니다.";
    return {
      ...message,
      content,
      state: "error",
      error: message.error || "Sidecar stopped before this response completed.",
      recoverable: true,
    };
  }
  return message;
}

function closeOrphanedRun(messages, provider) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return messages;
  return [
    ...messages,
    {
      id: `orphaned-assistant-${randomUUID()}`,
      role: "assistant",
      provider: provider || last.provider || "codex",
      content: "이전 실행이 완료되기 전에 사이드카가 종료됐어요. 다시 시도할 수 있습니다.",
      state: "error",
      createdAt: new Date().toISOString(),
      error: "Sidecar stopped before producing a response.",
      recoverable: true,
    },
  ];
}

function isDiscardableRuntimeFailureMessage(message) {
  if (!message || message.role !== "assistant") return false;
  const content = String(message.content || "");
  if (String(message.error || "") === "replaceAssistantText is not defined") return true;
  if (/spawn .*codex.* ENOENT/.test(content)) return true;
  if (content.trim() === "structured input unavailable") return true;
  if (/ran out of room in the model'?s context window/i.test(content)) return true;
  if (/thread\/resume failed: no rollout found for thread id/i.test(content)) return true;
  if (/thread\/resume failed:[\s\S]*rollout at [^\n]+ is empty/i.test(content)) return true;
  return false;
}

export async function loadSessionsFromFile(
  filePath,
  { onRecoverableError = null, now = () => new Date() } = {},
) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  try {
    return normalizePersistedSessionsPayload(JSON.parse(raw));
  } catch (error) {
    const quarantinePath = await quarantineCorruptSessionStore(filePath, raw, now);
    onRecoverableError?.({
      type: "session_store_corrupt",
      filePath,
      quarantinePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function persistSessionsToFile(
  filePath,
  sessions,
  { now = () => new Date() } = {},
) {
  const payload = {
    schemaVersion: SESSION_STORE_SCHEMA_VERSION,
    savedAt: now().toISOString(),
    sessions,
  };
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
    await fs.chmod(tempPath, 0o600).catch(() => {});
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function quarantineCorruptSessionStore(filePath, raw, now) {
  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${filePath}.corrupt-${timestamp}`;
  try {
    await fs.rename(filePath, quarantinePath);
  } catch {
    await fs.writeFile(quarantinePath, raw, { mode: 0o600 });
    await fs.unlink(filePath).catch(() => {});
  }
  await fs.chmod(quarantinePath, 0o600).catch(() => {});
  return quarantinePath;
}
