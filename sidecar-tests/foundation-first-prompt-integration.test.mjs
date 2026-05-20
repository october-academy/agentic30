/**
 * Sub-AC 4 (AC 1.4) — Foundation first-prompt integration test.
 *
 * Existing peers cover narrower contracts:
 *   • sidecar-tests/foundation-first-prompt.test.mjs
 *     → unit tests on the pure builder `buildFirstPromptForDay()`.
 *   • agentic30Tests/FoundationFirstPromptHandlerTests.swift
 *     → Swift-side decoder + idempotency keys for the seeded chat message.
 *
 * What was missing — and what this file pins down — is the end-to-end glue:
 * for every remaining chat-opener day (Day 0/2-7) the Mac host can request
 * `foundation_first_prompt` over the actual sidecar WebSocket transport and
 * receive a fully-formed envelope that the Swift decoder + chat surface can
 * render WITHOUT additional work. Day 1 now rejects this route because its
 * normal surface is the OpenDesign Day page.
 *
 * Verification surface:
 *   1. The sidecar boots in a hermetic temp workspace + app-support dir
 *      (no real Library writes, no network).
 *   2. A WebSocket client mimicking AgenticViewModel.requestFoundationFirstPrompt
 *      sends `{type: "foundation_first_prompt", sessionId, day}` for each
 *      Day 0/2-7.
 *   3. The response envelope passes the SAME contract the Swift handler in
 *      `handleFoundationFirstPromptEvent` reads:
 *        - type === "foundation_first_prompt"
 *        - sessionId echoed back
 *        - day matches the request and is in [0, 7]
 *        - firstPrompt is the 3-section minimal object the chat surface
 *          will inject as a seeded assistant opener.
 *   4. The `firstPrompt.text` field — the field the chat surface displays —
 *      is the canonical "어제: …\n오늘: …\nQ: …" 3-line layout.
 *   5. Day → sub_workflow / spec_version mapping matches the Foundation
 *      contract (Day 0 bip-channel-register, Day 3 office-hours-docs/v1,
 *      Day 5 analyze-ads/v2, Day 6
 *      monetization-ask, Day 7 foundation-summary/v3).
 *   6. YC partner tone preserved over the wire — no 정서 sugar, at least
 *      one 반말 token, no 문어체/존대 어미. (Same forbidden sets as the
 *      pure-builder test so a transport-layer regression is visible.)
 *   7. Out-of-range days and Day 1 fail closed (no firstPrompt, sidecar emits
 *      an `error` envelope).
 *   8. dynamicVariables flow through transport for the remaining opener days.
 *
 * Note on test scope: we DO spawn the real `sidecar/index.mjs` process so
 * the WebSocket router, telemetry capture, and JSON envelope serialization
 * are all exercised — this is what makes it an integration test rather
 * than another unit test on the builder.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

import {
  FOUNDATION_DAYS,
  buildFirstPromptForDay,
  formatFirstPromptText,
} from "../sidecar/foundation-chat.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Forbidden 정서 sugar — must not appear in any response across all 8 days.
// Same set the pure-builder test uses; mirroring keeps the contract single
// sourced — if either layer drifts, both tests catch it.
const FORBIDDEN_SUGAR = [
  "괜찮아",
  "괜찮습니다",
  "잘하고 있어",
  "잘하고 있습니다",
  "수고했어",
  "고생했어",
  "고생했습니다",
  "감사합니다",
  "감사해요",
  "응원",
  "화이팅",
  "파이팅",
  "힘내",
  "걱정 마",
];

// At least one of these 반말 tokens must appear so the YC tone cannot
// silently flatten into noun-only telegram on the wire.
const PANMAL_TOKENS = [
  "어?",
  "야?",
  "야.",
  "야 ",
  "어.",
  "어 ",
  "해?",
  "해.",
  "해 ",
  "아.",
  "아 ",
  "거야",
  "어야",
  "건데",
];

// Day → expected sub_workflow / spec_version. Pinned here as well as in
// the unit test so a transport-layer regression that swaps the mapping
// on the wire is visible.
const EXPECTED_DAY_CONTRACT = {
  0: { sub_workflow: "bip-channel-register", spec_version: null },
  1: { sub_workflow: "office-hours-docs", spec_version: "v0" },
  2: { sub_workflow: null, spec_version: null },
  3: { sub_workflow: "office-hours-docs", spec_version: "v1" },
  4: { sub_workflow: null, spec_version: null },
  5: { sub_workflow: "analyze-ads", spec_version: "v2" },
  6: { sub_workflow: "monetization-ask", spec_version: null },
  7: { sub_workflow: "foundation-summary", spec_version: "v3" },
};

const PERSONA = "YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)";
const FIRST_PROMPT_DAYS = Object.freeze([0, 2, 3, 4, 5, 6, 7]);

test("Sub-AC 4 :: Day 0/2-7 round-trip valid foundation_first_prompt envelopes over WebSocket", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndAwaitReady(harness);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));

    for (const day of FIRST_PROMPT_DAYS) {
      const sessionId = `integ-foundation-day-${day}`;
      ws.send(
        JSON.stringify({
          type: "foundation_first_prompt",
          sessionId,
          day,
        }),
      );

      const response = await waitForEvent(
        events,
        (event) =>
          event.type === "foundation_first_prompt"
          && event.sessionId === sessionId
          && event.day === day,
      );

      // ─────── Envelope contract (the Swift handler reads these fields) ───────
      assert.equal(response.type, "foundation_first_prompt", `Day ${day} type`);
      assert.equal(response.sessionId, sessionId, `Day ${day} sessionId echoes`);
      assert.equal(response.day, day, `Day ${day} day echoes`);
      assert.ok(
        response.firstPrompt && typeof response.firstPrompt === "object",
        `Day ${day} firstPrompt object present`,
      );

      const fp = response.firstPrompt;
      assert.equal(fp.day, day, `Day ${day} firstPrompt.day matches`);
      assert.equal(fp.persona, PERSONA, `Day ${day} firstPrompt.persona`);
      assert.equal(
        fp.template,
        "3-section minimal",
        `Day ${day} firstPrompt.template`,
      );

      // ─────── 3-section minimal — what the chat surface DISPLAYS ───────
      assert.equal(typeof fp.yesterday, "string", `Day ${day} yesterday string`);
      assert.equal(typeof fp.today, "string", `Day ${day} today string`);
      assert.equal(typeof fp.question, "string", `Day ${day} question string`);
      assert.ok(fp.yesterday.length > 0, `Day ${day} yesterday non-empty`);
      assert.ok(fp.today.length > 0, `Day ${day} today non-empty`);
      assert.ok(fp.question.length > 0, `Day ${day} question non-empty`);
      assert.ok(!fp.yesterday.includes("\n"), `Day ${day} yesterday is 1 line`);
      assert.ok(!fp.today.includes("\n"), `Day ${day} today is 1 line`);
      assert.ok(!fp.question.includes("\n"), `Day ${day} question is 1 line`);

      // The pre-rendered `text` field the Swift decoder prefers when present.
      assert.equal(typeof fp.text, "string", `Day ${day} firstPrompt.text string`);
      const lines = fp.text.split("\n");
      assert.equal(lines.length, 3, `Day ${day} text has exactly 3 lines`);
      assert.ok(lines[0].startsWith("어제: "), `Day ${day} line 1 prefix`);
      assert.ok(lines[1].startsWith("오늘: "), `Day ${day} line 2 prefix`);
      assert.ok(lines[2].startsWith("Q: "), `Day ${day} line 3 prefix`);
      // The wire `text` must be byte-identical to what the local builder
      // would produce — i.e. the chat surface and a fresh local rebuild
      // agree on the deduplication fingerprint.
      assert.equal(
        fp.text,
        formatFirstPromptText(fp),
        `Day ${day} text == formatFirstPromptText(fp) (stable fingerprint)`,
      );

      // ─────── Day → sub_workflow / spec_version mapping ───────
      const expected = EXPECTED_DAY_CONTRACT[day];
      assert.equal(
        fp.sub_workflow,
        expected.sub_workflow,
        `Day ${day} sub_workflow on the wire`,
      );
      assert.equal(
        fp.spec_version,
        expected.spec_version,
        `Day ${day} spec_version on the wire`,
      );
      assert.ok(Array.isArray(fp.artifacts), `Day ${day} artifacts is array`);
      assert.deepEqual(
        fp.artifacts,
        FOUNDATION_DAYS[day].artifacts,
        `Day ${day} artifacts list matches descriptor`,
      );

      // ─────── YC tone preserved over the wire ───────
      const haystack = `${fp.yesterday}\n${fp.today}\n${fp.question}`;
      for (const phrase of FORBIDDEN_SUGAR) {
        assert.ok(
          !haystack.includes(phrase),
          `Day ${day} response must not contain 정서 sugar "${phrase}"`,
        );
      }
      for (const section of ["yesterday", "today", "question"]) {
        assert.ok(
          !/(습니다|입니다|해요|예요|에요)([.?!\s]|$)/.test(fp[section]),
          `Day ${day} ${section} must not use 문어체/존대. Got: "${fp[section]}"`,
        );
      }
      assert.ok(
        PANMAL_TOKENS.some((tok) => haystack.includes(tok)),
        `Day ${day} response must contain at least one 반말 token`,
      );

      // ─────── Wire output deep-equals a local rebuild ───────
      // This is the strongest invariant: the transport must not mutate or
      // re-serialize the prompt. If a future refactor adds a wrapping layer
      // (e.g. a richer envelope, lossy JSON serialization for performance),
      // this assertion catches it before the Swift decoder does.
      const localRebuild = buildFirstPromptForDay({ day });
      assert.deepEqual(
        fp,
        localRebuild,
        `Day ${day} wire firstPrompt deep-equals local builder output`,
      );
    }
  } finally {
    await closeWebSocket(ws);
    await harness.dispose();
  }
});

test("Foundation chat trivial greeting runs through provider", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndAwaitReady(harness);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: created.session.id,
      requestId: created.session.pendingUserInput.requestId,
      responses: [{
        question: "무엇부터 시작할까요?",
        selectedOptions: ["프로젝트 전략 문서 만들기"],
        freeText: "",
      }],
    }));
    await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === created.session.id
      && event.session.status === "idle"
      && event.session.pendingUserInput == null,
    );
    events.length = 0;

    ws.send(JSON.stringify({
      type: "foundation_chat",
      sessionId: created.session.id,
      prompt: "하이",
      day: 7,
    }));

    const completed = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === created.session.id
      && event.session.status === "idle"
      && latestAssistantMessage(event.session)?.state === "final"
    );
    const answer = latestAssistantMessage(completed.session);
    assert.equal(typeof answer.content, "string");
    assert.ok(answer.content.length > 0);
    assert.ok(
      answer.performance?.marks?.some((mark) => mark.phase === "foundation.provider_call_start"),
      `Expected foundation.provider_call_start timing mark, got ${JSON.stringify(answer.performance)}`,
    );
    assert.equal(
      answer.performance?.marks?.some((mark) => mark.phase === "foundation.instant_greeting_response_ready"),
      false,
      "trivial foundation greetings must not use the local instant greeting path",
    );
  } finally {
    await closeWebSocket(ws);
    await harness.dispose();
  }
});

test("Sub-AC 4 :: out-of-range days fail closed with an error envelope (no firstPrompt)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndAwaitReady(harness);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));

    const badDays = [-1, 8, 30, "abc"];
    for (const badDay of badDays) {
      const sessionId = `integ-bad-day-${String(badDay)}`;
      ws.send(
        JSON.stringify({
          type: "foundation_first_prompt",
          sessionId,
          day: badDay,
        }),
      );

      const error = await waitForEvent(
        events,
        (event) => event.type === "error" && event.sessionId === sessionId,
      );
      assert.match(
        String(error.message || ""),
        /Foundation day must be in range 0-7/,
        `Day ${badDay} error message`,
      );

      // Critical: the sidecar must NOT also emit a foundation_first_prompt
      // event for the same sessionId — that would let an out-of-range day
      // sneak past the Swift handler's (0...7) guard.
      const leak = events.find(
        (event) =>
          event.type === "foundation_first_prompt"
          && event.sessionId === sessionId,
      );
      assert.equal(leak, undefined, `Day ${badDay} must not leak a firstPrompt event`);
    }
  } finally {
    await closeWebSocket(ws);
    await harness.dispose();
  }
});

test("Sub-AC 4 :: Day 1 foundation_first_prompt requests are rejected", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndAwaitReady(harness);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));

    const sessionId = "integ-day-1-rejected";
    ws.send(
      JSON.stringify({
        type: "foundation_first_prompt",
        sessionId,
        day: 1,
      }),
    );
    const response = await waitForEvent(
      events,
      (event) =>
        event.type === "error"
        && event.sessionId === sessionId,
    );
    assert.match(response.message, /OpenDesign Day page/);
    assert.equal(
      events.some((event) => event.type === "foundation_first_prompt" && event.sessionId === sessionId),
      false,
    );
  } finally {
    await closeWebSocket(ws);
    await harness.dispose();
  }
});

test("Sub-AC 4 :: dynamicVariables flow through transport for remaining first_prompt days", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndAwaitReady(harness);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));

    // ── Day 5 ad-metric variables flow through to `today` line ──
    const adsSessionId = "integ-vars-day-5";
    ws.send(
      JSON.stringify({
        type: "foundation_first_prompt",
        sessionId: adsSessionId,
        day: 5,
        dynamicVariables: {
          weak_section: "오퍼",
          impressions: 4200,
          clicks: 86,
          signups: 4,
          signal_strength: "약함",
        },
      }),
    );
    const adsResp = await waitForEvent(
      events,
      (event) =>
        event.type === "foundation_first_prompt"
        && event.sessionId === adsSessionId,
    );
    assert.ok(adsResp.firstPrompt.today.includes("4200"), "Day 5 impressions");
    assert.ok(adsResp.firstPrompt.today.includes("86"), "Day 5 clicks");
    assert.ok(adsResp.firstPrompt.today.includes("4"), "Day 5 signups");
    assert.ok(adsResp.firstPrompt.today.includes("약함"), "Day 5 signal_strength");
  } finally {
    await closeWebSocket(ws);
    await harness.dispose();
  }
});

/* ────────────────────── harness helpers ────────────────────── */

/**
 * Spawn `node sidecar/index.mjs` in a hermetic temp workspace + app-support
 * dir. Mirrors the pattern in `day1-icp-conversation.test.mjs` so the test
 * suite's startup envelope behaves the same. Returns a `dispose()` helper
 * that tears the child + temp dirs down even on failure.
 */
async function spawnSidecar() {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "agentic30-foundation-fp-integ-ws-"),
  );
  const appSupportPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "agentic30-foundation-fp-integ-app-"),
  );

  const child = spawn(
    process.execPath,
    ["sidecar/index.mjs", "--workspace", workspaceRoot],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
        AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
        // Stub provider keeps the sidecar from trying to call out to the
        // real Claude / Codex CLIs on boot. We never actually trigger a
        // provider stream in this test (foundation_first_prompt is a pure
        // build), but the warmup path still runs without it.
        AGENTIC30_TEST_STUB_PROVIDER: "1",
        AGENTIC30_DISABLE_CODEX_WARMUP: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  let ready;
  try {
    ready = await readSidecarReady(child);
  } catch (error) {
    await terminateChild(child);
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
    throw new Error(
      `Sidecar boot failed: ${error?.message || error}. stderr: ${stderr}`,
    );
  }

  return {
    port: ready.port,
    authToken: ready.authToken,
    child,
    async dispose() {
      await terminateChild(child);
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(appSupportPath, { recursive: true, force: true });
    },
  };
}

function readSidecarReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for sidecar ready")),
      15_000,
    );
    const onData = (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (
          parsed?.type === "sidecar-ready"
          && Number.isFinite(parsed.port)
          && typeof parsed.authToken === "string"
          && parsed.authToken.length > 0
        ) {
          clearTimeout(timer);
          child.stdout.off("data", onData);
          resolve(parsed);
          return;
        }
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Sidecar exited before ready: code=${code}`));
    });
  });
}

async function connectAndAwaitReady(harness) {
  const ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "authenticate", authToken: harness.authToken }));
  // Drain the initial `ready` envelope the sidecar emits on connection so
  // it does not pollute the event log we walk through below.
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Sidecar did not emit ready frame in 5s")),
      5_000,
    );
    const onMessage = (raw) => {
      let event;
      try {
        event = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (event.type === "ready") {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve();
      }
    };
    ws.on("message", onMessage);
  });
  return ws;
}

async function closeWebSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate();
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    ws.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.close();
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function waitForEvent(events, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for matching sidecar event");
}

function latestAssistantMessage(session) {
  return [...(session?.messages || [])].reverse().find((message) => message.role === "assistant");
}
