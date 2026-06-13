import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseSinceMs,
  toKstDayKey,
  encodeClaudeProjectDir,
  isGenuineClaudePrompt,
  claudeRecordToEvents,
  codexRecordToEvents,
  buildAgentHistoryDigest,
  collectAgentWorkHistory,
  looksLikeBoilerplatePrompt,
  confineWorkspacePath,
} from "../sidecar/agent-work-history.mjs";

// token-shaped strings via concatenation (keeps this source clean for
// scripts/check-public-safety.mjs — see public-safety.test.mjs).
const githubToken = `ghp_${"a".repeat(40)}`;

test("parseSinceMs handles relative, ISO (KST), and all", () => {
  const now = new Date("2026-05-29T00:00:00Z");
  assert.equal(parseSinceMs("all", now), 0);
  assert.equal(parseSinceMs("7d", now), now.getTime() - 7 * 86_400_000);
  assert.equal(parseSinceMs("2w", now), now.getTime() - 14 * 86_400_000);
  // 2026-05-15 KST midnight = 2026-05-14T15:00:00Z
  assert.equal(parseSinceMs("2026-05-15", now), Date.parse("2026-05-14T15:00:00Z"));
});

test("toKstDayKey crosses UTC midnight correctly", () => {
  // 16:00Z is 01:00 KST next day
  assert.equal(toKstDayKey(Date.parse("2026-05-15T16:00:00Z")), "2026-05-16");
  assert.equal(toKstDayKey(Date.parse("2026-05-15T05:00:00Z")), "2026-05-15");
});

test("encodeClaudeProjectDir replaces slashes", () => {
  assert.equal(
    encodeClaudeProjectDir("/Users/october/prj/agentic30-public"),
    "-Users-october-prj-agentic30-public",
  );
});

test("isGenuineClaudePrompt accepts real prompts, rejects noise", () => {
  assert.equal(
    isGenuineClaudePrompt({ type: "user", message: { role: "user", content: [{ type: "text", text: "커밋해줘" }] } }),
    true,
  );
  // tool_result turn
  assert.equal(
    isGenuineClaudePrompt({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "x" }] } }),
    false,
  );
  // system-reminder injection
  assert.equal(
    isGenuineClaudePrompt({ type: "user", message: { role: "user", content: [{ type: "text", text: "<system-reminder>hi" }] } }),
    false,
  );
  // other harness-injected kebab-tag wrappers
  for (const injected of ["<local-command-caveat>Caveat: ...", "<task-notification> <task-id>x", "<command-name>/foo"]) {
    assert.equal(
      isGenuineClaudePrompt({ type: "user", message: { role: "user", content: [{ type: "text", text: injected }] } }),
      false,
      `should reject: ${injected}`,
    );
  }
  // sidechain
  assert.equal(
    isGenuineClaudePrompt({ type: "user", isSidechain: true, message: { role: "user", content: [{ type: "text", text: "x" }] } }),
    false,
  );
});

test("claudeRecordToEvents extracts prompt/command/edit and redacts", () => {
  const prompt = claudeRecordToEvents({
    type: "user",
    timestamp: "2026-05-28T01:00:00.000Z",
    sessionId: "s1",
    entrypoint: "cli",
    message: { role: "user", content: [{ type: "text", text: `deploy ${githubToken} now` }] },
  });
  assert.equal(prompt[0].kind, "prompt");
  assert.match(prompt[0].text, /‹redacted:github-token›/);
  assert.doesNotMatch(prompt[0].text, new RegExp(githubToken));

  const cmd = claudeRecordToEvents({
    type: "assistant",
    timestamp: "2026-05-28T01:01:00.000Z",
    message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
  });
  assert.equal(cmd[0].kind, "command");
  assert.equal(cmd[0].cmd, "npm test");

  const snap = claudeRecordToEvents({
    type: "file-history-snapshot",
    timestamp: "2026-05-28T01:02:00.000Z",
    snapshot: { trackedFileBackups: { "sidecar/index.mjs": {}, ".agentic30/docs/GOAL.md": {} } },
  });
  assert.deepEqual(snap.map((e) => e.path).sort(), [".agentic30/docs/GOAL.md", "sidecar/index.mjs"]);
});

test("codexRecordToEvents threads session state across records", () => {
  const state = {};
  assert.deepEqual(
    codexRecordToEvents(
      { type: "session_meta", timestamp: "2026-05-28T07:00:00.000Z", payload: { id: "cx1", cwd: "/w", git: { branch: "main" } } },
      state,
    ),
    [],
  );
  assert.equal(state.cwd, "/w");
  assert.equal(state.sessionId, "cx1");

  const promptEvents = codexRecordToEvents(
    { type: "event_msg", timestamp: "2026-05-28T07:01:00.000Z", payload: { type: "user_message", message: "푸시해줘" } },
    state,
  );
  assert.equal(promptEvents[0].kind, "prompt");
  assert.equal(promptEvents[0].sessionId, "cx1");

  const cmdEvents = codexRecordToEvents(
    { type: "response_item", timestamp: "2026-05-28T07:02:00.000Z", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "git status" }) } },
    state,
  );
  assert.equal(cmdEvents[0].cmd, "git status");

  const patchEvents = codexRecordToEvents(
    { type: "response_item", timestamp: "2026-05-28T07:03:00.000Z", payload: { type: "function_call", name: "apply_patch", arguments: JSON.stringify({ input: "*** Begin Patch\n*** Update File: sidecar/x.mjs\n+a\n*** End Patch" }) } },
    state,
  );
  assert.deepEqual(patchEvents.map((e) => e.path), ["sidecar/x.mjs"]);
});

test("looksLikeBoilerplatePrompt drops skill/greeting noise, keeps real intents", () => {
  assert.equal(looksLikeBoilerplatePrompt("Base directory for this skill: /x"), true);
  assert.equal(looksLikeBoilerplatePrompt("Hello"), true);
  assert.equal(looksLikeBoilerplatePrompt("# Update Config Skill Modify Claude Code configuration"), true);
  assert.equal(looksLikeBoilerplatePrompt("커밋하고 푸시해줘"), false);
  assert.equal(looksLikeBoilerplatePrompt("Day-1 요약 카드 구현"), false);
});

test("confineWorkspacePath keeps inside paths, drops outside-absolute", () => {
  const ws = "/Users/test/proj";
  assert.equal(confineWorkspacePath("/Users/test/proj/src/app.ts", ws), "src/app.ts");
  assert.equal(confineWorkspacePath("src/app.ts", ws), "src/app.ts");
  assert.equal(confineWorkspacePath("/Users/october/.gstack/x.md", ws), null);
  assert.equal(confineWorkspacePath("/Users/test/proj", ws), null); // root itself
});

test("buildAgentHistoryDigest dedups prompts, ranks files, buckets by KST day", () => {
  const events = [
    { provider: "claude", ts: Date.parse("2026-05-28T01:00:00Z"), kind: "prompt", text: "커밋해줘", sessionId: "s1" },
    { provider: "claude", ts: Date.parse("2026-05-28T02:00:00Z"), kind: "prompt", text: "커밋해줘", sessionId: "s1" }, // dup
    { provider: "codex", ts: Date.parse("2026-05-29T03:00:00Z"), kind: "prompt", text: "푸시해줘", sessionId: "c1" },
    { provider: "claude", ts: Date.parse("2026-05-28T01:30:00Z"), kind: "file_edit", path: "a.ts", sessionId: "s1" },
    { provider: "claude", ts: Date.parse("2026-05-28T01:40:00Z"), kind: "file_edit", path: "a.ts", sessionId: "s1" },
    { provider: "claude", ts: Date.parse("2026-05-28T01:50:00Z"), kind: "file_edit", path: "b.ts", sessionId: "s1" },
    { provider: "claude", ts: Date.parse("2026-05-28T01:55:00Z"), kind: "command", cmd: "npm test", sessionId: "s1" },
  ];
  const digest = buildAgentHistoryDigest(events, { sinceMs: 0, now: new Date("2026-05-29T10:00:00Z") });

  assert.deepEqual(digest.providers, ["claude", "codex"]);
  assert.equal(digest.sessionCount, 2);
  // recentIntents newest first, deduped
  assert.equal(digest.recentIntents.length, 2);
  assert.equal(digest.recentIntents[0].text, "푸시해줘");
  // file ranked by freq
  assert.equal(digest.filesTouched[0].file, "a.ts");
  assert.equal(digest.filesTouched[0].count, 2);
  assert.equal(digest.commandThemes[0].cmd, "npm test");
  // per-day buckets, newest first
  assert.equal(digest.perDayKst[0].day, "2026-05-29");
  assert.equal(digest.perDayKst[1].day, "2026-05-28");
});

test("buildAgentHistoryDigest filters events outside window", () => {
  const sinceMs = Date.parse("2026-05-20T00:00:00Z");
  const events = [
    { provider: "claude", ts: Date.parse("2026-05-10T00:00:00Z"), kind: "prompt", text: "old", sessionId: "s1" },
    { provider: "claude", ts: Date.parse("2026-05-25T00:00:00Z"), kind: "prompt", text: "new", sessionId: "s1" },
  ];
  const digest = buildAgentHistoryDigest(events, { sinceMs, now: new Date("2026-05-29T00:00:00Z") });
  assert.equal(digest.recentIntents.length, 1);
  assert.equal(digest.recentIntents[0].text, "new");
});

test("collectAgentWorkHistory reads cli claude sessions, excludes sdk-ts, integrates codex", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-awh-home-"));
  const workspace = "/Users/test/proj-demo";
  try {
    // Claude cli session
    const claudeDir = path.join(home, ".claude", "projects", encodeClaudeProjectDir(workspace));
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(
      path.join(claudeDir, "cli.jsonl"),
      [
        JSON.stringify({ type: "user", timestamp: "2026-05-28T01:00:00Z", sessionId: "cli1", entrypoint: "cli", cwd: workspace, message: { role: "user", content: [{ type: "text", text: `release with ${githubToken}` }] } }),
        JSON.stringify({ type: "assistant", timestamp: "2026-05-28T01:01:00Z", sessionId: "cli1", entrypoint: "cli", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "sidecar/index.mjs" } }] } }),
      ].join("\n"),
    );
    // Agentic30's own SDK session — must be excluded by default
    await fs.writeFile(
      path.join(claudeDir, "sdk.jsonl"),
      JSON.stringify({ type: "user", timestamp: "2026-05-28T02:00:00Z", sessionId: "sdk1", entrypoint: "sdk-ts", cwd: workspace, message: { role: "user", content: [{ type: "text", text: "AGENTIC30_INTERNAL_PROMPT" }] } }),
    );
    // Codex session under a date partition
    const codexDir = path.join(home, ".codex", "sessions", "2026", "05", "28");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(
      path.join(codexDir, "rollout-2026-05-28T10-00-00-abc.jsonl"),
      [
        JSON.stringify({ type: "session_meta", timestamp: "2026-05-28T01:00:00Z", payload: { id: "cx1", cwd: workspace, git: { branch: "main" } } }),
        JSON.stringify({ type: "event_msg", timestamp: "2026-05-28T01:05:00Z", payload: { type: "user_message", message: "코드 x 푸시" } }),
      ].join("\n"),
    );

    const digest = await collectAgentWorkHistory({
      workspaceRoot: workspace,
      homeDir: home,
      since: "all",
      now: new Date("2026-05-29T10:00:00Z"),
    });

    const intentTexts = digest.recentIntents.map((i) => i.text);
    assert.ok(intentTexts.some((t) => /‹redacted:github-token›/.test(t)), "cli prompt redacted+included");
    assert.ok(!intentTexts.some((t) => /AGENTIC30_INTERNAL_PROMPT/.test(t)), "sdk-ts excluded");
    assert.ok(digest.filesTouched.some((f) => f.file === "sidecar/index.mjs"));
    assert.ok(digest.providers.includes("claude"));
    // codex picked up via grep+cwd verify (grep is available on test platforms)
    assert.ok(digest.providers.includes("codex"), "codex session via grep+verify");
    assert.ok(intentTexts.some((t) => /푸시/.test(t)));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
