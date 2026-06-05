// Deterministic, redacted digest of recent agent work on a workspace, mined
// from the user's local Claude Code (`~/.claude`) and Codex (`~/.codex`) session
// transcripts. Feeds the Day-1 "project situation" understanding so advice is
// grounded in what the user actually did — not just a stale README.
//
// Contract:
//   - READ-ONLY: only reads session JSONL; never writes, never touches
//     auth.json / .credentials.
//   - REDACTED: every prompt/command/path passes through redactSecrets before
//     it leaves this module.
//   - BOUNDED: streams line-by-line, caps files/events; never loads multi-GB
//     Codex history into memory.
//   - cli-FIRST: by default only the user's own Claude Code sessions
//     (entrypoint === "cli") are counted; Agentic30's own SDK runs
//     (entrypoint === "sdk-ts") are excluded to avoid a feedback loop.
//
// Pure helpers (record→events, digest assembly, time) are exported for tests;
// I/O wrappers stream from disk.

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

import { redactSecrets } from "./workspace-safety.mjs";

const DEFAULT_SINCE_DAYS = 14;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_CLAUDE_FILES = 60;
const MAX_CODEX_FILES = 40;
const MAX_RECORDS_PER_FILE = 20_000;
const MAX_EVENTS_PER_SESSION = 4_000;
const MAX_INTENTS_OUT = 12;
const MAX_FILES_OUT = 25;
const MAX_COMMANDS_OUT = 20;
const PROMPT_MAX_CHARS = 280;

const CODEX_EXEC_NAMES = new Set([
  "exec_command",
  "exec",
  "execute",
  "shell",
  "local_shell",
  "run_command",
]);

// ---------------------------------------------------------------------------
// Time helpers (pure)
// ---------------------------------------------------------------------------

export function parseSinceMs(since, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || 0;
  const raw = String(since ?? `${DEFAULT_SINCE_DAYS}d`).trim().toLowerCase();
  if (raw === "all") return 0;
  let m = raw.match(/^(\d+)d$/);
  if (m) return nowMs - Number(m[1]) * 86_400_000;
  m = raw.match(/^(\d+)w$/);
  if (m) return nowMs - Number(m[1]) * 7 * 86_400_000;
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_OFFSET_MS;
  return nowMs - DEFAULT_SINCE_DAYS * 86_400_000;
}

export function toKstDayKey(tsMs) {
  if (!Number.isFinite(tsMs)) return "";
  return new Date(tsMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Claude resolution + record extraction
// ---------------------------------------------------------------------------

export function encodeClaudeProjectDir(absPath) {
  return String(absPath || "").replace(/\//g, "-");
}

export function isGenuineClaudePrompt(record) {
  if (!record || record.type !== "user" || record.isSidechain) return false;
  const message = record.message;
  if (!message || message.role !== "user") return false;
  const content = message.content;
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  if (!Array.isArray(blocks)) return false;
  if (blocks.some((b) => b && b.type === "tool_result")) return false;
  const text = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) return false;
  // Harness-injected wrappers (system-reminder, local-command-caveat,
  // task-notification, command-name, …) arrive as user text and all open with a
  // lowercase kebab-case tag. Genuine prompts effectively never start that way.
  if (/^<[a-z][a-z0-9]*-[a-z0-9-]*[\s>]/.test(text)) return false;
  if (text.startsWith("Caveat:") && text.includes("<system-reminder>")) return false;
  return true;
}

function trimPrompt(text, redact) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim().slice(0, PROMPT_MAX_CHARS);
  return redact(cleaned);
}

// Skill loaders, slash-command boilerplate, and bare greetings arrive as plain
// "user" text but are not genuine human intents. Drop them from the digest.
export function looksLikeBoilerplatePrompt(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^Base directory for this skill/i.test(t)) return true;
  if (/^#\s+\S.*\bSkill\b/i.test(t)) return true;
  if (/^(hi|hello|hey|yo|test|테스트|안녕|ㅎㅇ|ㅎ2)$/i.test(t)) return true;
  if (/Modify Claude Code configuration/i.test(t)) return true;
  return false;
}

/// Keep a file path only if it lives inside the workspace; relativize for
/// display. Returns null for absolute paths outside the workspace (edits the
/// user made elsewhere during a session that happened to be cwd'd here).
export function confineWorkspacePath(p, absWorkspace) {
  const s = String(p || "");
  if (!s) return null;
  if (path.isAbsolute(s)) {
    const rel = path.relative(absWorkspace, s);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel;
  }
  return s;
}

/// Convert a single Claude transcript record to normalized events. Pure.
export function claudeRecordToEvents(record, { redact = redactSecrets } = {}) {
  if (!record || record.isSidechain) return [];
  const ts = Date.parse(record.timestamp);
  const base = {
    provider: "claude",
    ts: Number.isFinite(ts) ? ts : null,
    sessionId: record.sessionId || null,
    gitBranch: record.gitBranch || null,
    entrypoint: record.entrypoint || null,
  };
  const events = [];

  if (isGenuineClaudePrompt(record)) {
    const content = record.message.content;
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
    const text = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
    if (!looksLikeBoilerplatePrompt(text)) {
      events.push({ ...base, kind: "prompt", text: trimPrompt(text, redact) });
    }
  }

  if (record.type === "assistant" && Array.isArray(record.message?.content)) {
    for (const block of record.message.content) {
      if (!block || block.type !== "tool_use") continue;
      if (block.name === "Bash" && block.input?.command) {
        events.push({ ...base, kind: "command", cmd: redact(String(block.input.command).slice(0, 400)) });
      } else if (
        (block.name === "Edit" || block.name === "Write" || block.name === "NotebookEdit") &&
        block.input?.file_path
      ) {
        events.push({ ...base, kind: "file_edit", path: String(block.input.file_path) });
      }
    }
  }

  if (record.type === "file-history-snapshot") {
    const tracked = record.snapshot?.trackedFileBackups;
    if (tracked && typeof tracked === "object") {
      for (const filePath of Object.keys(tracked)) {
        events.push({ ...base, kind: "file_edit", path: String(filePath) });
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Codex record extraction
// ---------------------------------------------------------------------------

function parseCodexArguments(args) {
  if (args && typeof args === "object") return args;
  if (typeof args !== "string") return null;
  try {
    return JSON.parse(args);
  } catch {
    return null;
  }
}

/// Convert a single Codex rollout record to normalized events. `state` carries
/// cross-record session context (cwd/branch/sessionId/ts). Pure.
export function codexRecordToEvents(record, state = {}, { redact = redactSecrets } = {}) {
  if (!record || typeof record !== "object") return [];
  const recTs = Date.parse(record.timestamp);
  if (Number.isFinite(recTs)) state.ts = recTs;
  const payload = record.payload || {};

  if (record.type === "session_meta") {
    state.sessionId = payload.id || state.sessionId || null;
    state.cwd = payload.cwd || state.cwd || null;
    state.gitBranch = payload.git?.branch || state.gitBranch || null;
    const ts = Date.parse(payload.timestamp || record.timestamp);
    if (Number.isFinite(ts)) state.ts = ts;
    return [];
  }
  if (record.type === "turn_context") {
    if (payload.cwd) state.cwd = payload.cwd;
    return [];
  }

  const base = {
    provider: "codex",
    ts: Number.isFinite(state.ts) ? state.ts : null,
    sessionId: state.sessionId || null,
    gitBranch: state.gitBranch || null,
    cwd: state.cwd || null,
  };

  if (record.type === "event_msg" && payload.type === "user_message") {
    const text = typeof payload.message === "string" ? payload.message : "";
    if (text.trim() && !looksLikeBoilerplatePrompt(text)) {
      return [{ ...base, kind: "prompt", text: trimPrompt(text, redact) }];
    }
    return [];
  }

  if (record.type === "response_item" && payload.type === "function_call") {
    const name = String(payload.name || "");
    if (CODEX_EXEC_NAMES.has(name)) {
      const parsed = parseCodexArguments(payload.arguments);
      let cmd = parsed?.cmd ?? parsed?.command ?? null;
      if (Array.isArray(cmd)) cmd = cmd.join(" ");
      if (typeof cmd === "string" && cmd.trim()) {
        return [{ ...base, kind: "command", cmd: redact(cmd.slice(0, 400)) }];
      }
      return [];
    }
    if (name === "apply_patch") {
      const parsed = parseCodexArguments(payload.arguments);
      const source =
        (typeof parsed?.input === "string" && parsed.input) ||
        (typeof parsed?.patch === "string" && parsed.patch) ||
        (typeof payload.arguments === "string" ? payload.arguments : JSON.stringify(payload.arguments || {}));
      // Normalize escaped newlines so the per-line path capture stops at EOL.
      const patchText = source.replace(/\\n/g, "\n");
      const events = [];
      const re = /\*\*\* (?:Update|Add|Delete) File: (.+)/g;
      let match;
      while ((match = re.exec(patchText)) !== null) {
        events.push({ ...base, kind: "file_edit", path: match[1].trim() });
      }
      return events;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Digest assembly (pure)
// ---------------------------------------------------------------------------

function normalizeForDedup(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, PROMPT_MAX_CHARS);
}

export function buildAgentHistoryDigest(events, { sinceMs = 0, now = new Date() } = {}) {
  const inWindow = events
    .filter((e) => e && Number.isFinite(e.ts) && e.ts >= sinceMs)
    .sort((a, b) => a.ts - b.ts);

  const providers = new Set();
  const sessions = new Set();
  let lastActivityAt = 0;
  const perDay = new Map();
  const promptSeen = new Set();
  const prompts = [];
  const fileCounts = new Map();
  const commandCounts = new Map();

  for (const e of inWindow) {
    providers.add(e.provider);
    if (e.sessionId) sessions.add(`${e.provider}:${e.sessionId}`);
    if (e.ts > lastActivityAt) lastActivityAt = e.ts;
    const day = toKstDayKey(e.ts);
    if (!perDay.has(day)) perDay.set(day, { day, providers: new Set(), prompts: 0, commands: 0, files: new Set() });
    const bucket = perDay.get(day);
    bucket.providers.add(e.provider);

    if (e.kind === "prompt" && e.text) {
      bucket.prompts += 1;
      const key = `${e.provider}:${normalizeForDedup(e.text)}`;
      if (!promptSeen.has(key)) {
        promptSeen.add(key);
        prompts.push({ ts: e.ts, kstDay: day, provider: e.provider, text: e.text });
      }
    } else if (e.kind === "command" && e.cmd) {
      bucket.commands += 1;
      commandCounts.set(e.cmd, (commandCounts.get(e.cmd) || 0) + 1);
    } else if (e.kind === "file_edit" && e.path) {
      bucket.files.add(e.path);
      fileCounts.set(e.path, (fileCounts.get(e.path) || 0) + 1);
    }
  }

  const recentIntents = prompts
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_INTENTS_OUT)
    .map(({ ts, kstDay, provider, text }) => ({ kstDay, provider, text, ts }));

  const filesTouched = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_FILES_OUT)
    .map(([file, count]) => ({ file, count }));

  const commandThemes = [...commandCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_COMMANDS_OUT)
    .map(([cmd, count]) => ({ cmd, count }));

  const perDayKst = [...perDay.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map((b) => ({
      day: b.day,
      providers: [...b.providers].sort(),
      prompts: b.prompts,
      commands: b.commands,
      files: b.files.size,
    }));

  return {
    providers: [...providers].sort(),
    sessionCount: sessions.size,
    lastActivityAt: lastActivityAt ? new Date(lastActivityAt).toISOString() : null,
    recentIntents,
    filesTouched,
    commandThemes,
    perDayKst,
    warnings: [],
  };
}

export function emptyDigest() {
  return {
    providers: [],
    sessionCount: 0,
    lastActivityAt: null,
    recentIntents: [],
    filesTouched: [],
    commandThemes: [],
    perDayKst: [],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Rendering for Day-1 context injection (pure)
// ---------------------------------------------------------------------------

export function renderAgentHistoryEvidence(digest) {
  if (!digest || !digest.recentIntents?.length) return [];
  const top = digest.recentIntents[0]?.text || "";
  const providers = digest.providers.join("+") || "agent";
  return [`최근 작업(${providers}): ${top}`.slice(0, 200)];
}

export function renderAgentHistoryContext(digest) {
  if (!digest || (!digest.recentIntents?.length && !digest.filesTouched?.length)) return "";
  const lines = [];
  lines.push(
    `# Recent agent work (${digest.providers.join("+") || "none"}, ${digest.sessionCount} sessions, last ${digest.lastActivityAt || "n/a"})`,
  );
  if (digest.recentIntents.length) {
    lines.push("## Recent intents (newest first)");
    for (const intent of digest.recentIntents) {
      lines.push(`- [${intent.kstDay} ${intent.provider}] ${intent.text}`);
    }
  }
  if (digest.filesTouched.length) {
    lines.push("## Files touched (by frequency)");
    lines.push(digest.filesTouched.map((f) => `${f.file} (${f.count})`).join(", "));
  }
  if (digest.commandThemes.length) {
    lines.push("## Commands run");
    lines.push(digest.commandThemes.map((c) => c.cmd).slice(0, 12).join(" · "));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// I/O layer
// ---------------------------------------------------------------------------

async function streamRecords(file, onRecord) {
  let stream;
  try {
    stream = fsSync.createReadStream(file, { encoding: "utf8" });
  } catch {
    return;
  }
  stream.on("error", () => {});
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (onRecord(record) === false) break;
    }
  } catch {
    /* unreadable / truncated stream — best-effort */
  } finally {
    rl.close();
    stream.destroy?.();
  }
}

async function listClaudeProjectDirs(homeDir, absWorkspace) {
  const projectsRoot = path.join(homeDir, ".claude", "projects");
  const primary = path.join(projectsRoot, encodeClaudeProjectDir(absWorkspace));
  if (await isDir(primary)) return [primary];
  // Fallback: scan and match by the first record's cwd (encoding may be lossy).
  let entries = [];
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(projectsRoot, entry.name);
    const cwd = await firstRecordCwd(dir);
    if (cwd === absWorkspace) matches.push(dir);
  }
  return matches;
}

async function firstRecordCwd(dir) {
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (!files.length) return null;
  let found = null;
  await streamRecords(path.join(dir, files[0]), (rec) => {
    if (rec && typeof rec.cwd === "string") {
      found = rec.cwd;
      return false;
    }
    return true;
  });
  return found;
}

async function collectClaudeEvents({ homeDir, absWorkspace, sinceMs, includeAgentic30 }) {
  const dirs = await listClaudeProjectDirs(homeDir, absWorkspace);
  if (!dirs.length) return { events: [], warnings: [] };
  const files = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const full = path.join(dir, name);
      try {
        const stat = await fs.stat(full);
        if (sinceMs && stat.mtimeMs < sinceMs) continue;
        files.push({ full, mtimeMs: stat.mtimeMs });
      } catch {
        /* skip */
      }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const events = [];
  for (const { full } of files.slice(0, MAX_CLAUDE_FILES)) {
    let sessionEntrypoint = null;
    let count = 0;
    const sessionEvents = [];
    await streamRecords(full, (rec) => {
      if (++count > MAX_RECORDS_PER_FILE) return false;
      if (!sessionEntrypoint && rec.entrypoint) sessionEntrypoint = rec.entrypoint;
      if (sessionEvents.length > MAX_EVENTS_PER_SESSION) return false;
      for (const e of claudeRecordToEvents(rec)) sessionEvents.push(e);
      return true;
    });
    // cli-first: skip Agentic30's own SDK runs unless explicitly included.
    if (!includeAgentic30 && sessionEntrypoint && sessionEntrypoint !== "cli") continue;
    for (const e of sessionEvents) events.push(e);
  }
  return { events, warnings: [] };
}

async function collectCodexEvents({ homeDir, absWorkspace, sinceMs, now }) {
  const sessionsRoot = path.join(homeDir, ".codex", "sessions");
  if (!(await isDir(sessionsRoot))) return { events: [], warnings: [] };
  const dirs = codexPartitionDirs(sessionsRoot, sinceMs, now);
  const existing = [];
  for (const dir of dirs) {
    if (await isDir(dir)) existing.push(dir);
  }
  if (!existing.length) return { events: [], warnings: [] };

  const candidates = await grepCodexCandidates(absWorkspace, existing);
  const verified = [];
  for (const file of candidates.slice(0, MAX_CODEX_FILES * 2)) {
    if (await verifyCodexCwd(file, absWorkspace)) verified.push(file);
    if (verified.length >= MAX_CODEX_FILES) break;
  }

  const events = [];
  for (const file of verified) {
    const state = {};
    let count = 0;
    let sessionEvents = 0;
    await streamRecords(file, (rec) => {
      if (++count > MAX_RECORDS_PER_FILE) return false;
      if (sessionEvents > MAX_EVENTS_PER_SESSION) return false;
      for (const e of codexRecordToEvents(rec, state)) {
        events.push(e);
        sessionEvents += 1;
      }
      return true;
    });
  }
  return { events, warnings: [] };
}

function codexPartitionDirs(sessionsRoot, sinceMs, now) {
  if (!sinceMs) return [sessionsRoot];
  const start = sinceMs - 86_400_000;
  const end = (now instanceof Date ? now.getTime() : Date.now()) + 86_400_000;
  const dirs = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t + KST_OFFSET_MS);
    dirs.push(
      path.join(
        sessionsRoot,
        String(d.getUTCFullYear()),
        String(d.getUTCMonth() + 1).padStart(2, "0"),
        String(d.getUTCDate()).padStart(2, "0"),
      ),
    );
  }
  return [...new Set(dirs)];
}

function grepCodexCandidates(absWorkspace, dirs) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn("grep", ["-rlF", "--include=*.jsonl", "--", absWorkspace, ...dirs], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      resolve(splitLines(out));
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", () => { clearTimeout(timer); resolve([]); });
    child.on("close", () => { clearTimeout(timer); resolve(splitLines(out)); });
  });
}

function splitLines(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function verifyCodexCwd(file, absWorkspace) {
  let ok = false;
  let scanned = 0;
  await streamRecords(file, (rec) => {
    scanned += 1;
    const cwd = rec?.payload?.cwd;
    if ((rec?.type === "session_meta" || rec?.type === "turn_context") && cwd === absWorkspace) {
      ok = true;
      return false;
    }
    return scanned < 200;
  });
  return ok;
}

async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Raw normalized events (redacted, workspace-confined paths) for callers that
/// need session-level granularity — e.g. the work-history weekly indexer.
/// `sinceMs` is an absolute cutoff; pass `since` strings to the digest entry
/// point instead. Same READ-ONLY / REDACTED / BOUNDED contract as the digest.
export async function collectAgentWorkEvents({
  workspaceRoot,
  homeDir = os.homedir(),
  sinceMs = 0,
  now = new Date(),
  includeAgentic30 = false,
} = {}) {
  if (!workspaceRoot) return [];
  const absWorkspace = path.resolve(workspaceRoot);

  const [claude, codex] = await Promise.all([
    collectClaudeEvents({ homeDir, absWorkspace, sinceMs, includeAgentic30 }).catch(() => ({ events: [], warnings: ["claude-failed"] })),
    collectCodexEvents({ homeDir, absWorkspace, sinceMs, now }).catch(() => ({ events: [], warnings: ["codex-failed"] })),
  ]);

  return [...claude.events, ...codex.events]
    .map((e) => {
      if (e.kind !== "file_edit") return e;
      const rel = confineWorkspacePath(e.path, absWorkspace);
      return rel ? { ...e, path: rel } : null;
    })
    .filter(Boolean);
}

export async function collectAgentWorkHistory({
  workspaceRoot,
  homeDir = os.homedir(),
  since = `${DEFAULT_SINCE_DAYS}d`,
  now = new Date(),
  includeAgentic30 = false,
  enabled = true,
} = {}) {
  if (!enabled || !workspaceRoot) return emptyDigest();
  const sinceMs = parseSinceMs(since, now);
  const events = await collectAgentWorkEvents({
    workspaceRoot,
    homeDir,
    sinceMs,
    now,
    includeAgentic30,
  });
  const digest = buildAgentHistoryDigest(events, { sinceMs, now });
  digest.warnings = [];
  return digest;
}
