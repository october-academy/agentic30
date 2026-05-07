import fsSync from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const qmdServerName = "qmd";
const qmdPackageBinSegments = ["node_modules", "@tobilu", "qmd", "bin", "qmd"];
const QMD_STATE_CACHE_TTL_MS = 5 * 60 * 1000;
const canonicalMemoryDocs = [
  ["ICP", "docs/ICP.md"],
  ["VALUES", "docs/VALUES.md"],
  ["GOAL", "docs/GOAL.md"],
  ["SPEC", "docs/SPEC.md"],
  ["DESIGN_SYSTEM", "docs/DESIGN_SYSTEM.md"],
  ["ADR", "docs/ADR.md"],
  ["DOCS", "docs/DOCS.md"],
  ["SHEET", "docs/SHEET.md"],
];
const qmdStateCache = new Map();

export function resolveQmdBinary(env = process.env, fsImpl = fsSync, options = {}) {
  return resolveQmdBinaryInfo(env, fsImpl, options)?.binaryPath ?? null;
}

export function resolveQmdBinaryInfo(env = process.env, fsImpl = fsSync, { sidecarRoot = null } = {}) {
  const override = env.AGENTIC30_QMD_BIN;
  if (override && isExecutable(fsImpl, override)) {
    return { binaryPath: override, source: "env" };
  }

  const bundled = resolveBundledQmdBinary(env, fsImpl, { sidecarRoot });
  if (bundled) {
    return { binaryPath: bundled, source: "bundled" };
  }

  const pathEntries = (env.PATH || "/usr/bin:/bin").split(path.delimiter);
  for (const dir of pathEntries) {
    if (!dir) continue;
    const candidate = path.join(dir, "qmd");
    if (isExecutable(fsImpl, candidate)) {
      return { binaryPath: candidate, source: "path" };
    }
  }

  return null;
}

export function getQmdState({
  env = process.env,
  fsImpl = fsSync,
  runner = spawnSync,
  sidecarRoot = null,
  useCache = true,
} = {}) {
  const effectiveUseCache = useCache && runner === spawnSync && fsImpl === fsSync;
  const cacheKey = [
    env.AGENTIC30_QMD_BIN || "",
    env.AGENTIC30_QMD_INDEX || "",
    env.PATH || "",
    sidecarRoot || "",
  ].join("|");
  const cached = qmdStateCache.get(cacheKey);
  if (effectiveUseCache && cached && Date.now() - cached.createdAt < QMD_STATE_CACHE_TTL_MS) {
    return cached.value;
  }

  const binaryInfo = resolveQmdBinaryInfo(env, fsImpl, { sidecarRoot });
  const binaryPath = binaryInfo?.binaryPath ?? null;
  const mcpSupported = binaryPath ? supportsQmdMcp(binaryPath, { env, runner }) : false;
  const args = buildQmdMcpArgs(env);
  const value = {
    available: Boolean(binaryPath && mcpSupported),
    message: !binaryPath
      ? "QMD CLI not found. Rebuild the Mac sidecar bundle or set AGENTIC30_QMD_BIN to enable transcript/doc retrieval."
      : mcpSupported
        ? binaryInfo?.source === "bundled"
          ? "Bundled QMD MCP is available for local knowledge retrieval"
          : "QMD MCP is available for local knowledge retrieval"
        : "QMD CLI is installed but does not support `qmd mcp`. Install a newer @tobilu/qmd or set AGENTIC30_QMD_BIN to a QMD build with MCP support.",
    binaryPath,
    command: binaryPath && mcpSupported ? `${binaryPath} ${args.join(" ")}` : null,
    index: env.AGENTIC30_QMD_INDEX || null,
    mcpSupported,
    source: binaryInfo?.source ?? null,
  };
  if (effectiveUseCache) {
    qmdStateCache.set(cacheKey, { createdAt: Date.now(), value });
  }
  return value;
}

export function buildQmdMcpConfig({
  env = process.env,
  fsImpl = fsSync,
  runner = spawnSync,
  sidecarRoot = null,
} = {}) {
  const state = getQmdState({ env, fsImpl, runner, sidecarRoot });
  const binaryPath = state.binaryPath;
  if (!binaryPath || !state.mcpSupported) return {};

  return {
    [qmdServerName]: {
      command: binaryPath,
      args: buildQmdMcpArgs(env),
    },
  };
}

export function buildQmdGuidance(
  workspaceRoot,
  {
    appSupportPath = null,
    env = process.env,
    fsImpl = fsSync,
    runner = spawnSync,
    sidecarRoot = null,
  } = {},
) {
  const state = getQmdState({ env, fsImpl, runner, sidecarRoot });
  const memorySourceSummary = buildQmdMemorySourceSummary(workspaceRoot, {
    appSupportPath,
    fsImpl,
  });

  const qmdInstructions = state.available
    ? [
        "The QMD MCP server is connected. Use QMD retrieval first when relevant.",
        "Use QMD tools in this order when relevant:",
        "1. `status` to confirm the index and collections are healthy.",
        "2. `multi_get` or `get` for known canonical memory documents.",
        "3. `query` for the user's current topic across strategy docs, project context, notes, transcripts, Google Docs, and Sheets. For quick MEMORY lookups, set `rerank: false` unless semantic reranking is explicitly needed.",
        "If QMD has no relevant result, fall back to the internal MCP tools before asking the user.",
      ]
    : [
        `QMD MCP is not connected: ${state.message}`,
        "Still build working MEMORY before giving project advice. Use the internal MCP tools in this order when relevant:",
        "1. `read_project_doc` for known local strategy/project documents.",
        "2. `gws_docs_read` for configured or user-provided Google Docs.",
        "3. `gws_sheets_read` for configured or user-provided Google Sheets.",
        "4. Workspace search for local markdown, notes, transcripts, and project docs.",
        "Do not ask the user to paste context until these fallback tools have been considered.",
      ];

  return [
    "## MEMORY Retrieval",
    "Before giving advice that depends on the user's project, ICP, values, goals, prior notes, Google Docs, Google Sheets, or mentoring history, build a short working MEMORY from the available sources.",
    ...qmdInstructions,
    "Treat retrieved `ICP`, `VALUES`, `GOAL`, and `SPEC` documents as canonical. Treat transcripts, sheets, and working notes as evidence; prefer repeated patterns over a single noisy line.",
    "Synthesize the working MEMORY silently with these fields: user/project, ICP, values, current goal, recent evidence, constraints, likely next action, and what to avoid.",
    "When answering, ground the advice in retrieved context, then give a short diagnosis, the next 1-3 actions, and one thing to stop or defer.",
    memorySourceSummary,
    `Workspace expected for these sources: ${workspaceRoot}`,
  ].filter(Boolean).join("\n");
}

function resolveBundledQmdBinary(env, fsImpl, { sidecarRoot = null } = {}) {
  const roots = [
    sidecarRoot,
    env.AGENTIC30_SIDECAR_ROOT,
  ].filter(Boolean);

  for (const root of roots) {
    for (const candidateRoot of [root, path.join(root, "..")]) {
      const candidate = path.resolve(candidateRoot, ...qmdPackageBinSegments);
      if (isExecutable(fsImpl, candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function buildQmdMemorySourceSummary(
  workspaceRoot,
  {
    appSupportPath = null,
    fsImpl = fsSync,
  } = {},
) {
  const lines = ["### Expected MEMORY sources"];
  const localDocs = canonicalMemoryDocs
    .filter(([, relativePath]) => fileExists(fsImpl, path.join(workspaceRoot, relativePath)))
    .map(([label, relativePath]) => `- ${label}: ${relativePath}`);

  if (localDocs.length > 0) {
    lines.push("Local canonical docs:");
    lines.push(...localDocs);
  } else {
    lines.push("Local canonical docs: look for `docs/ICP.md`, `docs/VALUES.md`, `docs/GOAL.md`, and `docs/SPEC.md` if they exist.");
  }

  const bipConfig = readBipConfig(appSupportPath, fsImpl);
  if (bipConfig?.workspace?.root) {
    const workspace = bipConfig.workspace;
    lines.push("Configured project context from BIP settings:");
    lines.push(`- Project workspace: ${workspace.root}`);
    if (workspace.icp) lines.push(`- ICP: ${workspace.icp}`);
    if (workspace.spec) lines.push(`- SPEC: ${workspace.spec}`);
    if (workspace.values) lines.push(`- VALUES: ${workspace.values}`);
    if (workspace.goal) lines.push(`- GOAL: ${workspace.goal}`);
    if (workspace.designSystem) lines.push(`- Design system: ${workspace.designSystem}`);
    if (workspace.adr) lines.push(`- ADR: ${workspace.adr}`);
  }

  const externalDocs = bipConfig?.externalDocs ?? {};
  const googleDocs = externalDocs.googleDocs ?? [];
  const googleSheets = externalDocs.googleSheets ?? [];
  const notion = externalDocs.notion ?? [];
  if (googleDocs.length || googleSheets.length || notion.length) {
    lines.push("Configured external memory sources:");
    for (const url of googleDocs) lines.push(`- Google Doc: ${url}`);
    for (const url of googleSheets) lines.push(`- Google Sheet: ${url}`);
    for (const url of notion) lines.push(`- Notion: ${url}`);
  }

  if (appSupportPath) {
    lines.push(`GWS read snapshots: ${path.join(appSupportPath, "qmd-memory", "google-workspace")}`);
  }

  return lines.join("\n");
}

export function ensureQmdMemoryCollections({
  workspaceRoot,
  appSupportPath = null,
  sidecarRoot = null,
  env = process.env,
  fsImpl = fsSync,
  runner = spawnSync,
} = {}) {
  const state = getQmdState({ env, fsImpl, runner, sidecarRoot });
  if (!state.available || !state.binaryPath) {
    return {
      attempted: false,
      updated: false,
      reason: "qmd-unavailable",
      qmd: state,
      collections: [],
    };
  }

  const collections = buildQmdBootstrapCollections({
    workspaceRoot,
    appSupportPath,
    sidecarRoot,
    fsImpl,
  });
  if (collections.length === 0) {
    return {
      attempted: false,
      updated: false,
      reason: "no-memory-sources",
      qmd: state,
      collections: [],
    };
  }

  const results = collections.map((collection) => {
    const add = runner(state.binaryPath, [
      "collection",
      "add",
      collection.path,
      "--name",
      collection.name,
      "--mask",
      collection.mask,
    ], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    const output = `${add.stdout || ""}\n${add.stderr || ""}`;
    const ok = add.status === 0 || /already|exists|duplicate/i.test(output);
    if (ok && collection.context) {
      runner(state.binaryPath, [
        "context",
        "add",
        `qmd://${collection.name}`,
        collection.context,
      ], {
        env,
        encoding: "utf8",
        timeout: 15_000,
      });
    }
    return {
      ...collection,
      ok,
      status: add.status,
    };
  });

  const update = runner(state.binaryPath, ["update"], {
    env,
    encoding: "utf8",
    timeout: 60_000,
  });

  return {
    attempted: true,
    updated: update.status === 0,
    updateStatus: update.status,
    qmd: state,
    collections: results,
  };
}

export function buildQmdBootstrapCollections({
  workspaceRoot,
  appSupportPath = null,
  sidecarRoot = null,
  fsImpl = fsSync,
} = {}) {
  const collections = [];
  const seen = new Set();

  addCollection(collections, seen, {
    path: workspaceRoot ? path.join(workspaceRoot, "docs") : null,
    name: workspaceRoot
      ? collectionName("agentic30-workspace-docs", path.join(workspaceRoot, "docs"))
      : null,
    mask: "**/*.md",
    context: "Active workspace documentation. Prioritize ICP, VALUES, GOAL, SPEC, project context, decisions, and progress logs when advising.",
    fsImpl,
  });

  addCollection(collections, seen, {
    path: sidecarRoot ? path.resolve(sidecarRoot, "..", "docs") : null,
    name: sidecarRoot
      ? collectionName("agentic30-mac-docs", path.resolve(sidecarRoot, "..", "docs"))
      : null,
    mask: "**/*.md",
    context: "agentic30 Mac assistant product context, setup docs, limitations, diagnostics, BIP readiness, and QMD integration notes.",
    fsImpl,
  });

  addCollection(collections, seen, {
    path: appSupportPath ? path.join(appSupportPath, "qmd-memory", "google-workspace") : null,
    name: "agentic30-gws-memory",
    mask: "**/*.md",
    context: "Local markdown snapshots created when agentic30 reads Google Docs and Sheets through gws. Treat as user-recorded evidence and operating logs.",
    fsImpl,
  });

  return collections;
}

function supportsQmdMcp(binaryPath, { env = process.env, runner = spawnSync } = {}) {
  const result = runner(binaryPath, ["mcp", "--help"], {
    env,
    encoding: "utf8",
    timeout: 5000,
  });

  if (result.error) return false;
  if (result.status !== 0) return false;

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  return /mcp/i.test(output);
}

function buildQmdMcpArgs(env = process.env) {
  const index = env.AGENTIC30_QMD_INDEX;
  return index ? ["--index", index, "mcp"] : ["mcp"];
}

function isExecutable(fsImpl, filePath) {
  try {
    fsImpl.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fileExists(fsImpl, filePath) {
  try {
    fsImpl.accessSync(filePath, fsSync.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function addCollection(collections, seen, { path: collectionPath, name, mask, context, fsImpl }) {
  if (!collectionPath || !name || !directoryExists(fsImpl, collectionPath)) return;
  const resolvedPath = path.resolve(collectionPath);
  if (seen.has(resolvedPath)) return;
  seen.add(resolvedPath);
  collections.push({ path: resolvedPath, name, mask, context });
}

function collectionName(prefix, targetPath) {
  return `${prefix}-${sha256(path.resolve(targetPath)).slice(0, 8)}`;
}

function directoryExists(fsImpl, dirPath) {
  try {
    const info = fsImpl.statSync(dirPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function readBipConfig(appSupportPath, fsImpl) {
  if (!appSupportPath || typeof fsImpl.readFileSync !== "function") {
    return null;
  }

  try {
    const raw = fsImpl.readFileSync(path.join(appSupportPath, "bip-config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
