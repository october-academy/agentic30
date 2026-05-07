import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { extractGoogleDocPlainText } from "./bip-coach-state.mjs";
import { resolveQmdBinary } from "./qmd-support.mjs";

const collectionName = "agentic30-gws-memory";

export async function persistGwsReadToMemory({
  appSupportPath,
  kind,
  id,
  range = "",
  payload,
  sidecarRoot = null,
  env = process.env,
  runner = spawnSync,
  now = () => new Date(),
} = {}) {
  if (!appSupportPath || !kind || !id || payload == null) {
    return { saved: false, changed: false, reason: "missing-input" };
  }

  const memoryRoot = path.join(appSupportPath, "qmd-memory", "google-workspace");
  const targetDir = path.join(memoryRoot, kind === "doc" ? "docs" : "sheets");
  const markdown = formatGwsMarkdown({ kind, id, range, payload, now });
  const hash = sha256(markdown);
  const basename = buildSnapshotBasename({ kind, id, range });
  const filePath = path.join(targetDir, basename);

  await fs.mkdir(targetDir, { recursive: true });

  const previous = await fs.readFile(filePath, "utf8").catch(() => "");
  const previousHash = extractHash(previous);
  if (previousHash === hash) {
    return {
      saved: true,
      changed: false,
      filePath,
      hash,
      qmd: await ensureQmdGoogleMemoryIndexed({ memoryRoot, sidecarRoot, env, runner }),
    };
  }

  await fs.writeFile(filePath, injectHash(markdown, hash), "utf8");
  return {
    saved: true,
    changed: true,
    filePath,
    hash,
    qmd: await ensureQmdGoogleMemoryIndexed({ memoryRoot, sidecarRoot, env, runner }),
  };
}

export async function ensureQmdGoogleMemoryIndexed({
  memoryRoot,
  sidecarRoot = null,
  env = process.env,
  runner = spawnSync,
} = {}) {
  const qmd = resolveQmdBinary(env, undefined, { sidecarRoot });
  if (!qmd || !memoryRoot) {
    return { attempted: false, updated: false, reason: "qmd-unavailable" };
  }

  const collection = runner(qmd, [
    "collection",
    "add",
    memoryRoot,
    "--name",
    collectionName,
    "--mask",
    "**/*.md",
  ], {
    env,
    encoding: "utf8",
    timeout: 15_000,
  });

  const collectionOutput = `${collection.stdout || ""}\n${collection.stderr || ""}`;
  const collectionOk = collection.status === 0 || /already|exists|duplicate/i.test(collectionOutput);

  const update = runner(qmd, ["update"], {
    env,
    encoding: "utf8",
    timeout: 60_000,
  });

  return {
    attempted: true,
    updated: update.status === 0,
    collectionOk,
    collectionStatus: collection.status,
    updateStatus: update.status,
    collectionName,
  };
}

export function formatGwsMarkdown({ kind, id, range = "", payload, now = () => new Date() }) {
  const timestamp = now().toISOString();
  if (kind === "doc") {
    const title = payload?.title || "Google Doc";
    const text = extractGoogleDocPlainText(payload);
    return [
      "---",
      "source: google-docs",
      `document_id: ${JSON.stringify(id)}`,
      `title: ${JSON.stringify(title)}`,
      `synced_at: ${JSON.stringify(timestamp)}`,
      "---",
      "",
      `# ${title}`,
      "",
      text || "(empty document)",
      "",
    ].join("\n");
  }

  const title = payload?.spreadsheetId === id
    ? payload?.properties?.title || "Google Sheet"
    : payload?.range || "Google Sheet Range";
  const values = Array.isArray(payload?.values) ? payload.values : [];
  return [
    "---",
    "source: google-sheets",
    `spreadsheet_id: ${JSON.stringify(id)}`,
    range ? `range: ${JSON.stringify(range)}` : null,
    `title: ${JSON.stringify(title)}`,
    `synced_at: ${JSON.stringify(timestamp)}`,
    "---",
    "",
    `# ${title}`,
    "",
    values.length > 0 ? formatMarkdownTable(values) : formatSheetMetadata(payload),
    "",
  ].filter((line) => line != null).join("\n");
}

function formatMarkdownTable(values) {
  const rows = values.map((row) => Array.isArray(row) ? row : [row]);
  const width = Math.max(...rows.map((row) => row.length), 1);
  const normalized = rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next.map((cell) => escapeTableCell(cell));
  });
  const [header = []] = normalized;
  const body = normalized.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function formatSheetMetadata(payload) {
  const sheets = Array.isArray(payload?.sheets) ? payload.sheets : [];
  if (sheets.length === 0) return "(no sheet values were returned)";
  return [
    "## Sheets",
    "",
    ...sheets.map((sheet) => {
      const props = sheet?.properties ?? {};
      return `- ${props.title || "Untitled"}${props.sheetId != null ? ` (gid: ${props.sheetId})` : ""}`;
    }),
  ].join("\n");
}

function buildSnapshotBasename({ kind, id, range = "" }) {
  const idPart = sanitizeFilePart(id);
  if (kind === "doc" || !range) return `${idPart}.md`;
  return `${idPart}__${sha256(range).slice(0, 12)}.md`;
}

function sanitizeFilePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

function escapeTableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function extractHash(content) {
  return String(content || "").match(/<!-- agentic30:gws-memory sha256=([a-f0-9]+) -->/)?.[1] ?? "";
}

function injectHash(markdown, hash) {
  return `<!-- agentic30:gws-memory sha256=${hash} -->\n${markdown}`;
}
