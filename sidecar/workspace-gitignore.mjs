// Keeps `.agentic30/` (local memory + day-progress state) out of the user's
// git history. Runs after the onboarding workspace scan and once at sidecar
// startup so the directory never reaches GitHub. Fail-soft by design: any
// filesystem error returns `{ status: "error" }` instead of throwing —
// protecting the user's repo must never break the scan or daemon startup.
import fs from "node:fs/promises";
import path from "node:path";

export const AGENTIC30_GITIGNORE_ENTRY = ".agentic30/";

const AGENTIC30_GITIGNORE_COMMENT = "# Agentic30 local memory (auto-added by onboarding scan)";

function normalizeGitignoreLine(rawLine) {
  return String(rawLine || "").trim().replace(/^\//, "").replace(/\/$/, "");
}

function namesAgentic30(normalized) {
  return normalized === ".agentic30" || normalized === "**/.agentic30";
}

// A line counts as already covering `.agentic30` when, ignoring anchoring
// slashes, it names the directory exactly.
function lineIgnoresAgentic30(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line || line.startsWith("#") || line.startsWith("!")) return false;
  return namesAgentic30(normalizeGitignoreLine(line));
}

// `!.agentic30/` anywhere in the file is a deliberate user opt-in to tracking.
// Appending our entry after it would win by gitignore last-match-wins and
// silently defeat that intent, so opt-in short-circuits to a no-write status.
// This doubles as the durable opt-out for users who want memory committed.
function lineOptsAgentic30In(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line.startsWith("!")) return false;
  return namesAgentic30(normalizeGitignoreLine(line.slice(1)));
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

// `.git` may live in an ancestor (monorepo package opened as workspace). Git
// honors nested .gitignore files, so finding any enclosing repo is enough to
// justify creating one in the workspace root.
async function insideGitRepo(root) {
  let current = root;
  for (;;) {
    if (await pathExists(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Ensure the workspace `.gitignore` covers `.agentic30/`.
 *
 * - `.gitignore` has a `!.agentic30/` negation → `{ status: "user-opted-in" }` (never overridden)
 * - `.gitignore` already lists it → `{ status: "already-ignored" }`
 * - `.gitignore` exists without it → append → `{ status: "added" }`
 * - no `.gitignore` but inside a git repo (root or ancestor `.git`) → create → `{ status: "added" }`
 * - no git repo anywhere above → `{ status: "skipped-not-git" }`
 * - `onlyIfAgentic30Exists: true` and no `.agentic30/` yet → `{ status: "skipped-no-agentic30" }`
 * - any filesystem failure → `{ status: "error", error }`
 */
export async function ensureAgentic30Gitignored({ workspaceRoot, onlyIfAgentic30Exists = false } = {}) {
  const root = path.resolve(String(workspaceRoot || ""));
  const gitignorePath = path.join(root, ".gitignore");
  try {
    if (!workspaceRoot) {
      return { status: "error", path: gitignorePath, error: "workspaceRoot is required" };
    }
    if (onlyIfAgentic30Exists && !(await pathExists(path.join(root, ".agentic30")))) {
      return { status: "skipped-no-agentic30", path: gitignorePath };
    }
    let existing = null;
    try {
      existing = await fs.readFile(gitignorePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (existing !== null) {
      const lines = existing.split(/\r?\n/);
      if (lines.some(lineOptsAgentic30In)) {
        return { status: "user-opted-in", path: gitignorePath };
      }
      if (lines.some(lineIgnoresAgentic30)) {
        return { status: "already-ignored", path: gitignorePath };
      }
      const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
      await fs.appendFile(
        gitignorePath,
        `${separator}\n${AGENTIC30_GITIGNORE_COMMENT}\n${AGENTIC30_GITIGNORE_ENTRY}\n`,
        "utf8",
      );
      return { status: "added", path: gitignorePath };
    }
    if (!(await insideGitRepo(root))) {
      return { status: "skipped-not-git", path: gitignorePath };
    }
    await fs.writeFile(
      gitignorePath,
      `${AGENTIC30_GITIGNORE_COMMENT}\n${AGENTIC30_GITIGNORE_ENTRY}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return { status: "added", path: gitignorePath };
  } catch (error) {
    return { status: "error", path: gitignorePath, error: error?.message || String(error) };
  }
}
