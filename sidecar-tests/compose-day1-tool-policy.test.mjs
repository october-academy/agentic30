import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildComposeDay1CanUseTool,
  COMPOSE_DAY1_ALLOWED_TOOLS,
  COMPOSE_DAY1_DEFAULT_TOOL_CAPS,
} from "../sidecar/compose-day1-opening.mjs";

const ROOT = "/Users/test/myapp";

async function decision(canUseTool, toolName, input) {
  return canUseTool(toolName, input);
}

test("Read inside the workspace is allowed", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Read", { file_path: path.join(ROOT, "src", "a.ts") });
  assert.equal(verdict.behavior, "allow");
});

test("Read outside the workspace is denied", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Read", { file_path: "/etc/passwd" });
  assert.equal(verdict.behavior, "deny");
  assert.match(verdict.message, /path_outside_workspace/);
});

test("Read .env is denied even inside the workspace", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Read", { file_path: path.join(ROOT, ".env") });
  assert.equal(verdict.behavior, "deny");
  assert.match(verdict.message, /denied_segment/);
});

test("Read inside .git is denied", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Read", { file_path: path.join(ROOT, ".git", "HEAD") });
  assert.equal(verdict.behavior, "deny");
  assert.match(verdict.message, /denied_segment:\.git/);
});

test("Read inside node_modules is denied", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Read", { file_path: path.join(ROOT, "node_modules", "lodash", "index.js") });
  assert.equal(verdict.behavior, "deny");
});

test("Bash / Edit / Write / Task / WebFetch / WebSearch are all denied", async () => {
  for (const tool of ["Bash", "Edit", "Write", "Task", "WebFetch", "WebSearch", "AskUserQuestion"]) {
    const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
    const verdict = await decision(cb, tool, { file_path: path.join(ROOT, "x.ts") });
    assert.equal(verdict.behavior, "deny", `${tool} must be denied`);
    assert.match(verdict.message, /tool_not_allowed/);
  }
});

test("path traversal via .. is normalized then denied if it escapes", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Read", { file_path: path.join(ROOT, "..", "..", "etc", "shadow") });
  assert.equal(verdict.behavior, "deny");
  assert.match(verdict.message, /path_outside_workspace/);
});

test("Glob within the workspace is allowed", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Glob", { pattern: path.join(ROOT, "src", "**/*.ts") });
  assert.equal(verdict.behavior, "allow");
});

test("Glob whose literal prefix escapes the workspace is denied", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const verdict = await decision(cb, "Glob", { pattern: "/tmp/**/*" });
  assert.equal(verdict.behavior, "deny");
  assert.match(verdict.message, /path_outside_workspace/);
});

test("per-tool caps stop further calls once exceeded", async () => {
  const cb = buildComposeDay1CanUseTool({
    workspaceRoot: ROOT,
    toolCaps: { ...COMPOSE_DAY1_DEFAULT_TOOL_CAPS, Read: 2 },
  });
  await decision(cb, "Read", { file_path: path.join(ROOT, "a.ts") });
  await decision(cb, "Read", { file_path: path.join(ROOT, "b.ts") });
  const third = await decision(cb, "Read", { file_path: path.join(ROOT, "c.ts") });
  assert.equal(third.behavior, "deny");
  assert.match(third.message, /cap_reached:Read/);
});

test("only the documented allowlist is allowed", () => {
  assert.deepEqual(COMPOSE_DAY1_ALLOWED_TOOLS, ["Read", "Glob", "Grep"]);
});

test("decisions are logged via onDecision hook for audit/test inspection", async () => {
  const log = [];
  const cb = buildComposeDay1CanUseTool({
    workspaceRoot: ROOT,
    onDecision: (d) => log.push(d),
  });
  await decision(cb, "Read", { file_path: path.join(ROOT, "src", "a.ts") });
  await decision(cb, "Edit", { file_path: path.join(ROOT, "src", "a.ts") });
  assert.equal(log.length, 2);
  assert.equal(log[0].decision.allowed, true);
  assert.equal(log[1].decision.allowed, false);
});

// PR1: realpath/symlink + glob traversal hardening.
// Each test builds a real tmp workspace so the policy actually walks
// realpath on the filesystem, not just on string paths.

async function withTmpWorkspace(setup) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-policy-")));
  try {
    return await setup(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("symlink inside workspace pointing outside (e.g. /etc) is denied", async () => {
  await withTmpWorkspace(async (root) => {
    const linkPath = path.join(root, "secrets-link");
    await fs.symlink("/etc", linkPath);
    const cb = buildComposeDay1CanUseTool({ workspaceRoot: root });
    const verdict = await decision(cb, "Read", { file_path: path.join(linkPath, "passwd") });
    assert.equal(verdict.behavior, "deny");
    assert.match(verdict.message, /path_outside_workspace|denied_segment/);
  });
});

test("valid symlink that points inside the workspace stays allowed", async () => {
  await withTmpWorkspace(async (root) => {
    const realDir = path.join(root, "src");
    await fs.mkdir(realDir, { recursive: true });
    await fs.writeFile(path.join(realDir, "a.ts"), "// hi");
    const linkPath = path.join(root, "alias");
    await fs.symlink(realDir, linkPath);
    const cb = buildComposeDay1CanUseTool({ workspaceRoot: root });
    const verdict = await decision(cb, "Read", { file_path: path.join(linkPath, "a.ts") });
    assert.equal(verdict.behavior, "allow");
  });
});

test("Glob with embedded .. traversal is denied even if literal prefix looks safe", async () => {
  await withTmpWorkspace(async (root) => {
    const cb = buildComposeDay1CanUseTool({ workspaceRoot: root });
    // Build the pattern manually so path.join doesn't normalize `..` away
    // before the policy ever sees it — Claude's Glob input arrives as a raw
    // string with the `..` segments still intact.
    const verdict = await decision(cb, "Glob", {
      pattern: `${root}/src/**/../../etc/passwd`,
    });
    assert.equal(verdict.behavior, "deny");
    assert.match(verdict.message, /glob_traversal_segment|path_outside_workspace/);
  });
});

test("Glob with leading .. escape is denied", async () => {
  await withTmpWorkspace(async (root) => {
    const cb = buildComposeDay1CanUseTool({ workspaceRoot: root });
    const verdict = await decision(cb, "Glob", { pattern: "../**/secret" });
    assert.equal(verdict.behavior, "deny");
  });
});

test("deeply nested .. that normalizes outside the root is denied", async () => {
  await withTmpWorkspace(async (root) => {
    const cb = buildComposeDay1CanUseTool({ workspaceRoot: root });
    const verdict = await decision(cb, "Grep", {
      pattern: `${root}/a/b/../../../etc/shadow`,
    });
    assert.equal(verdict.behavior, "deny");
  });
});
