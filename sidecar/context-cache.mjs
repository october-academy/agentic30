import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const LOCAL_DOC_MAX_CHARS = 12_000;
const DEFAULT_CONTEXT_MAX_CHARS = 28_000;
const cache = new Map();

export async function getCachedBipContext({
  appSupportPath,
  workspaceRoot,
  maxChars = DEFAULT_CONTEXT_MAX_CHARS,
} = {}) {
  const config = await readJson(path.join(appSupportPath, "bip-config.json"));
  const configuredRoot = String(config?.workspace?.root || workspaceRoot || "").trim();
  if (!configuredRoot) {
    return { text: "", cacheHit: false, files: [] };
  }

  const root = path.resolve(configuredRoot);
  const workspace = config?.workspace || {};
  const configuredDocs = [
    ["ICP", workspace.icp],
    ["SPEC", workspace.spec],
    ["VALUES", workspace.values],
    ["Goal", workspace.goal],
    ["ADR", workspace.adr],
    ["Design System", workspace.designSystem],
  ];

  const sections = [
    "## Cached Agentic30 Context",
    `Workspace root: ${root}`,
  ];
  const files = [];
  let allCacheHit = true;
  let remaining = maxChars - sections.join("\n").length;

  for (const [role, configuredPath] of configuredDocs) {
    const value = String(configuredPath || "").trim();
    if (!value || remaining <= 0) continue;
    const filePath = resolveWorkspacePath(root, value);
    if (!filePath) continue;
    const loaded = await readCachedFile(filePath, root);
    if (!loaded) continue;
    allCacheHit &&= loaded.cacheHit;
    files.push({
      role,
      path: loaded.relativePath,
      sha256: loaded.sha256,
      mtimeMs: loaded.mtimeMs,
    });
    const section = [
      `### ${role}: ${loaded.relativePath}`,
      truncate(loaded.content, Math.min(LOCAL_DOC_MAX_CHARS, remaining)),
    ].join("\n");
    sections.push(section);
    remaining -= section.length;
  }

  return {
    text: sections.length > 2 ? sections.join("\n\n") : "",
    cacheHit: files.length > 0 && allCacheHit,
    files,
  };
}

async function readCachedFile(filePath, root) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return null;
  const key = path.resolve(filePath);
  const cached = cache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { ...cached, cacheHit: true };
  }

  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw) return null;
  const next = {
    relativePath: path.relative(root, filePath) || path.basename(filePath),
    content: truncate(raw, LOCAL_DOC_MAX_CHARS),
    sha256: createHash("sha256").update(raw).digest("hex"),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    cacheHit: false,
  };
  cache.set(key, next);
  return next;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function resolveWorkspacePath(root, value) {
  const resolved = path.resolve(root, value);
  return isPathInside(resolved, root) ? resolved : null;
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function truncate(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
