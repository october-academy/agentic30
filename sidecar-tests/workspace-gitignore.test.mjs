import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  ensureAgentic30Gitignored,
  inspectAgentic30Gitignore,
  AGENTIC30_GITIGNORE_ENTRY,
} from "../sidecar/workspace-gitignore.mjs";

async function tempWorkspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gitignore-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function gitIgnores(root, target) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    await run("git", ["-C", root, "check-ignore", "-q", target]);
    return true;
  } catch {
    return false;
  }
}

test("appends .agentic30/ to an existing .gitignore that lacks it", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "added");
  const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  assert.ok(content.startsWith("node_modules/\n"), "preserves existing entries");
  assert.ok(content.includes(`\n${AGENTIC30_GITIGNORE_ENTRY}\n`), "appends the entry on its own line");
});

test("read-only inspection reports needs-consent without modifying .gitignore", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
  const result = await inspectAgentic30Gitignore({ workspaceRoot: root });
  assert.equal(result.status, "needs-consent");
  assert.equal(result.entry, AGENTIC30_GITIGNORE_ENTRY);
  assert.equal(await fs.readFile(path.join(root, ".gitignore"), "utf8"), "node_modules/\n");
});

test("read-only inspection preserves explicit user opt-in", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".gitignore"), "!.agentic30/\n", "utf8");
  const result = await inspectAgentic30Gitignore({ workspaceRoot: root });
  assert.equal(result.status, "user-opted-in");
  assert.equal(await fs.readFile(path.join(root, ".gitignore"), "utf8"), "!.agentic30/\n");
});

test("read-only inspection asks for consent before creating a missing gitignore", async (t) => {
  const root = await tempWorkspace(t);
  await fs.mkdir(path.join(root, ".git"));
  const result = await inspectAgentic30Gitignore({ workspaceRoot: root });
  assert.equal(result.status, "needs-consent");
  await assert.rejects(fs.stat(path.join(root, ".gitignore")), /ENOENT/);
});

test("appended entry is honored by real git", async (t) => {
  const root = await tempWorkspace(t);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("git", ["-C", root, "init", "-q"]);
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/", "utf8");
  await fs.mkdir(path.join(root, ".agentic30"), { recursive: true });
  await fs.writeFile(path.join(root, ".agentic30", "memory"), "secret", "utf8");

  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "added");
  assert.equal(await gitIgnores(root, ".agentic30/memory"), true);
});

test("inserts a newline before appending when the file lacks a trailing newline", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".gitignore"), "dist", "utf8");
  await ensureAgentic30Gitignored({ workspaceRoot: root });
  const lines = (await fs.readFile(path.join(root, ".gitignore"), "utf8")).split("\n");
  assert.equal(lines[0], "dist", "must not glue onto the previous entry");
  assert.ok(lines.includes(AGENTIC30_GITIGNORE_ENTRY));
});

test("is a no-op when .agentic30 is already ignored, in any anchored variant", async (t) => {
  for (const variant of [".agentic30", ".agentic30/", "/.agentic30", "/.agentic30/", "**/.agentic30/", "  .agentic30/  "]) {
    const root = await tempWorkspace(t);
    await fs.writeFile(path.join(root, ".gitignore"), `node_modules/\n${variant}\n`, "utf8");
    const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
    assert.equal(result.status, "already-ignored", `variant: ${JSON.stringify(variant)}`);
    const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    assert.equal(content, `node_modules/\n${variant}\n`, "file untouched");
  }
});

test("re-running after an add is idempotent", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
  assert.equal((await ensureAgentic30Gitignored({ workspaceRoot: root })).status, "added");
  const afterFirst = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  assert.equal((await ensureAgentic30Gitignored({ workspaceRoot: root })).status, "already-ignored");
  assert.equal(await fs.readFile(path.join(root, ".gitignore"), "utf8"), afterFirst);
});

test("a negation line (!.agentic30/) is a user opt-in: no write, distinct status", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".gitignore"), "!.agentic30/\n", "utf8");
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "user-opted-in");
  const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  assert.equal(content, "!.agentic30/\n", "opt-in must never be overridden by an append");
});

test("negation after a positive entry still counts as opt-in (last-match-wins)", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".gitignore"), ".agentic30/\n!.agentic30/\n", "utf8");
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "user-opted-in");
});

test("comments and lookalike entries do not count as ignored", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(
    path.join(root, ".gitignore"),
    "# .agentic30/\n.agentic30-backup/\nfoo/.agentic30/\n",
    "utf8",
  );
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "added");
});

test("creates .gitignore when missing but the workspace is a git repo", async (t) => {
  const root = await tempWorkspace(t);
  await fs.mkdir(path.join(root, ".git"));
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "added");
  const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  assert.ok(content.includes(`${AGENTIC30_GITIGNORE_ENTRY}\n`));
});

test("treats a .git file (worktree/submodule) as a git repo", async (t) => {
  const root = await tempWorkspace(t);
  await fs.writeFile(path.join(root, ".git"), "gitdir: /somewhere/else\n", "utf8");
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "added");
});

test("workspace nested inside a parent git repo gets a nested .gitignore", async (t) => {
  const repo = await tempWorkspace(t);
  await fs.mkdir(path.join(repo, ".git"));
  const workspace = path.join(repo, "packages", "app");
  await fs.mkdir(workspace, { recursive: true });
  const result = await ensureAgentic30Gitignored({ workspaceRoot: workspace });
  assert.equal(result.status, "added");
  const content = await fs.readFile(path.join(workspace, ".gitignore"), "utf8");
  assert.ok(content.includes(`${AGENTIC30_GITIGNORE_ENTRY}\n`));
});

test("nested .gitignore created for a subdir workspace is honored by real git", async (t) => {
  const repo = await tempWorkspace(t);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("git", ["-C", repo, "init", "-q"]);
  const workspace = path.join(repo, "packages", "app");
  await fs.mkdir(path.join(workspace, ".agentic30"), { recursive: true });
  await fs.writeFile(path.join(workspace, ".agentic30", "memory"), "secret", "utf8");

  const result = await ensureAgentic30Gitignored({ workspaceRoot: workspace });
  assert.equal(result.status, "added");
  assert.equal(await gitIgnores(repo, "packages/app/.agentic30/memory"), true);
});

test("skips creating .gitignore in a non-git folder", async (t) => {
  const root = await tempWorkspace(t);
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "skipped-not-git");
  await assert.rejects(fs.stat(path.join(root, ".gitignore")), /ENOENT/);
});

test("onlyIfAgentic30Exists skips workspaces the app has not touched yet", async (t) => {
  const root = await tempWorkspace(t);
  await fs.mkdir(path.join(root, ".git"));
  const skipped = await ensureAgentic30Gitignored({ workspaceRoot: root, onlyIfAgentic30Exists: true });
  assert.equal(skipped.status, "skipped-no-agentic30");
  await assert.rejects(fs.stat(path.join(root, ".gitignore")), /ENOENT/);

  await fs.mkdir(path.join(root, ".agentic30"));
  const added = await ensureAgentic30Gitignored({ workspaceRoot: root, onlyIfAgentic30Exists: true });
  assert.equal(added.status, "added");
});

test("returns an error status instead of throwing on filesystem failure", async (t) => {
  const root = await tempWorkspace(t);
  // A directory named .gitignore makes both read and append fail.
  await fs.mkdir(path.join(root, ".gitignore"));
  const result = await ensureAgentic30Gitignored({ workspaceRoot: root });
  assert.equal(result.status, "error");
  assert.ok(result.error);
});

test("returns an error status when workspaceRoot is missing", async () => {
  const result = await ensureAgentic30Gitignored({});
  assert.equal(result.status, "error");
});
