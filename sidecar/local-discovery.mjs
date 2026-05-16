import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Stage 3 of the day1-discovery plan: deterministic local signals from a
 * project folder, computed without any LLM call. Output is a flat object the
 * Mac-side WorkspaceDay1Mapper folds into Day 1 first_prompt variables and
 * the LLM composer (stage 4) treats as ground truth.
 *
 * No write side effects. No network. Read-only git CLI commands plus a
 * one-shot stat/read of well-known manifest files. All errors are absorbed
 * into the result so callers get a stable shape regardless of git state.
 */

export const LOCAL_DISCOVERY_SCHEMA_VERSION = 1;

const SEVEN_DAYS_MS = 7 * 86_400_000;

const PROJECT_MANIFEST_FILES = Object.freeze([
  { file: "package.json",         stack: "node",    role: "manifest" },
  { file: "Cargo.toml",           stack: "rust",    role: "manifest" },
  { file: "pyproject.toml",       stack: "python",  role: "manifest" },
  { file: "requirements.txt",     stack: "python",  role: "manifest" },
  { file: "go.mod",               stack: "go",      role: "manifest" },
  { file: "Gemfile",              stack: "ruby",    role: "manifest" },
  { file: "pom.xml",              stack: "java",    role: "manifest" },
  { file: "build.gradle",         stack: "kotlin",  role: "manifest" },
  { file: "Package.swift",        stack: "swift",   role: "manifest" },
  { file: "deno.json",            stack: "deno",    role: "manifest" },
  { file: "bun.lockb",            stack: "bun",     role: "manifest" },
  // PR4: cover php/elixir/.net/scala so non-JS stacks get the same
  // signal richness as Node projects.
  { file: "composer.json",        stack: "php",     role: "manifest" },
  { file: "mix.exs",              stack: "elixir",  role: "manifest" },
  { file: "build.sbt",            stack: "scala",   role: "manifest" },
  { file: "Directory.Build.props", stack: "dotnet", role: "manifest" },
]);

// Glob-detected manifests — file name varies per project so we can't pin a
// single literal. summarizeProjectShape does a single readdir to scan these.
const PROJECT_MANIFEST_GLOBS = Object.freeze([
  { suffix: ".csproj",  stack: "dotnet" },
  { suffix: ".fsproj",  stack: "dotnet" },
  { suffix: ".sln",     stack: "dotnet" },
]);

const README_CANDIDATES = Object.freeze(["README.md", "readme.md", "README", "README.rst"]);

/**
 * Run a single read-only git command. Returns trimmed stdout on success or
 * null on any failure (non-git folder, missing CLI, permission error, etc.).
 * 5-second hard timeout — git commands on huge repos must not block scan.
 */
function runGit(workspaceRoot, args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let child;
    try {
      child = spawn("git", args, { cwd: workspaceRoot, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    const settle = (value) => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => { clearTimeout(timer); settle(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) settle(stdout.trim());
      else settle(null);
    });
  });
}

export async function summarizeGitActivity(workspaceRoot, { now = new Date() } = {}) {
  if (!workspaceRoot) {
    return { isGitRepo: false, head: null, firstCommitAt: null, last7DaysCommitCount: 0, dirty: null, branch: null };
  }
  const insideWorkTree = await runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree !== "true") {
    return { isGitRepo: false, head: null, firstCommitAt: null, last7DaysCommitCount: 0, dirty: null, branch: null };
  }
  const firstCommitRaw = await runGit(workspaceRoot, [
    "log", "--reverse", "--format=%cI", "--max-count=1",
  ]);
  const firstCommitAt = firstCommitRaw && firstCommitRaw.length > 0 ? firstCommitRaw : null;
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
  const commitCountRaw = await runGit(workspaceRoot, [
    "rev-list", "--count", `--since=${sevenDaysAgo}`, "HEAD",
  ]);
  const last7DaysCommitCount = commitCountRaw ? Number.parseInt(commitCountRaw, 10) || 0 : 0;
  const dirtyRaw = await runGit(workspaceRoot, ["status", "--porcelain"]);
  const dirty = dirtyRaw === null ? null : dirtyRaw.length > 0;
  const branch = await runGit(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // PR3 (P1b): expose current HEAD sha so compose-day1-opening's cacheKey
  // invalidates when HEAD advances (the legacy firstCommitAt only changes
  // when the project birth date moves, which is essentially never).
  const head = await runGit(workspaceRoot, ["rev-parse", "HEAD"]);
  return {
    isGitRepo: true,
    head: head && head.length > 0 ? head : null,
    firstCommitAt,
    last7DaysCommitCount,
    dirty,
    branch: branch && branch !== "HEAD" ? branch : null,
  };
}

export async function summarizeProjectShape(workspaceRoot, { fsImpl = fs } = {}) {
  if (!workspaceRoot) {
    return { stacks: [], hasReadme: false, manifestPaths: [] };
  }
  const stacks = [];
  const manifestPaths = [];
  await Promise.all(PROJECT_MANIFEST_FILES.map(async ({ file, stack }) => {
    try {
      const stat = await fsImpl.stat(path.join(workspaceRoot, file));
      if (stat.isFile()) {
        manifestPaths.push(file);
        if (!stacks.includes(stack)) stacks.push(stack);
      }
    } catch { /* missing manifest is the common case — ignore */ }
  }));
  // PR4: scan once for glob-style manifests (.csproj/.fsproj/.sln etc) so
  // .NET solutions with varying project filenames are still recognised.
  try {
    const entries = await fsImpl.readdir(workspaceRoot);
    for (const entry of entries) {
      for (const { suffix, stack } of PROJECT_MANIFEST_GLOBS) {
        if (entry.endsWith(suffix)) {
          if (!manifestPaths.includes(entry)) manifestPaths.push(entry);
          if (!stacks.includes(stack)) stacks.push(stack);
          break;
        }
      }
    }
  } catch { /* unreadable root — ignore, manifestPaths already captures fixed names */ }
  let hasReadme = false;
  for (const candidate of README_CANDIDATES) {
    try {
      const stat = await fsImpl.stat(path.join(workspaceRoot, candidate));
      if (stat.isFile()) { hasReadme = true; break; }
    } catch { /* continue */ }
  }
  return { stacks, hasReadme, manifestPaths };
}

export function inferRunwayHints(gitSummary, { now = new Date() } = {}) {
  if (!gitSummary || !gitSummary.isGitRepo || !gitSummary.firstCommitAt) {
    return { projectAgeDays: null, recentlyActive: null };
  }
  const firstMs = Date.parse(gitSummary.firstCommitAt);
  if (!Number.isFinite(firstMs)) {
    return { projectAgeDays: null, recentlyActive: null };
  }
  const elapsedMs = Math.max(0, now.getTime() - firstMs);
  const projectAgeDays = Math.floor(elapsedMs / 86_400_000);
  const recentlyActive = (gitSummary.last7DaysCommitCount || 0) > 0;
  return { projectAgeDays, recentlyActive };
}

/**
 * One-shot collector that bundles git + manifest signals into the shape the
 * day1Context payload mixes in. Pure data — no side effects on the
 * workspace or sidecar state.
 */
export async function collectLocalDiscovery(workspaceRoot, options = {}) {
  if (!workspaceRoot) {
    return {
      schemaVersion: LOCAL_DISCOVERY_SCHEMA_VERSION,
      git: { isGitRepo: false, firstCommitAt: null, last7DaysCommitCount: 0, dirty: null, branch: null },
      project: { stacks: [], hasReadme: false, manifestPaths: [] },
      runway: { projectAgeDays: null, recentlyActive: null },
    };
  }
  const [git, project] = await Promise.all([
    summarizeGitActivity(workspaceRoot, options),
    summarizeProjectShape(workspaceRoot, options),
  ]);
  const runway = inferRunwayHints(git, options);
  return {
    schemaVersion: LOCAL_DISCOVERY_SCHEMA_VERSION,
    git,
    project,
    runway,
  };
}
