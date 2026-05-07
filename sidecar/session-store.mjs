import fs from "node:fs/promises";
import path from "node:path";

export const SESSION_STORE_SCHEMA_VERSION = 1;
export const LEGACY_DEFAULT_CODEX_MODEL = "gpt-5.4";
export const CURRENT_DEFAULT_CODEX_MODEL = "gpt-5.5";

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
  if (next.status === "running" || next.status === "awaiting_input") {
    next.status = "idle";
  }
  if (next.status === "error") {
    next.status = "idle";
    next.error = null;
  }
  if (next.provider === "codex" && next.model === LEGACY_DEFAULT_CODEX_MODEL) {
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
  if (Array.isArray(next.messages)) {
    next.messages = next.messages
      .filter((message) => !isStaleRuntimeFailureMessage(message))
      .map((message) =>
        message?.state === "error"
          ? { ...message, state: "final", error: null }
          : message,
      );
  }
  return next;
}

function isStaleRuntimeFailureMessage(message) {
  if (!message || message.role !== "assistant") return false;
  const content = String(message.content || "");
  if (message.state === "streaming" && content.trim() === "") return true;
  if (String(message.error || "") === "replaceAssistantText is not defined") return true;
  if (/spawn .*codex.* ENOENT/.test(content)) return true;
  if (content.trim() === "structured input unavailable") return true;
  if (/ran out of room in the model'?s context window/i.test(content)) return true;
  if (/thread\/resume failed: no rollout found for thread id/i.test(content)) return true;
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
    `.${base}.${process.pid}.${Date.now()}.tmp`,
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
