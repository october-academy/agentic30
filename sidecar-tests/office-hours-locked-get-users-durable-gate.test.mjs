import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { isOfficeHoursLockedDay1GoalContext } from "../sidecar/office-hours-chat-prompt.mjs";
import { saveDay1GoalSelection, loadDay1GoalSelection } from "../sidecar/day1-goal-state.mjs";
import { startAttempt, loadAttemptLog, projectAttempt } from "../sidecar/office-hours-attempt-store.mjs";
import { nextAttemptAction } from "../sidecar/office-hours-contract.mjs";

// REGRESSION (defense-in-depth for the user-facing get_users degradation):
// index.mjs's R2 doc-readiness leak gate (`submitIsLockedGetUsers`, index.mjs
// ~2290) decides whether a locked Day-1 get_users turn may issue a
// day1_document_readiness_followup. The original gate keyed ONLY on the runtime
// context regex (`isLockedDay1GetUsersContext`), so a single clamp that evicted
// the `Goal lane: get_users` / DAY1_LOCKED_GOAL markers re-leaked doc-readiness
// and broke attempt stamping. The fix (`isDurableLockedGetUsersLane`) ALSO
// honors two DURABLE signals that no clamp can touch:
//   (a) an open (non-terminal) get_users ValidationAttempt for the workspace, and
//   (b) day1-goal.json goalType === "get_users".
// index.mjs has boot side effects and is not test-importable, so this pins the
// exact predicates the helper composes — replicated inline below.

const CONTEXT_WITHOUT_MARKERS = [
  "[Office Hours 인터뷰 이어하기 — RESUME]",
  "이 인터뷰는 진행 중이었다.",
  "## Source-Derived Project Context",
  "Product: dongdong",
].join("\n");

// Replicates index.mjs `workspaceHasOpenGetUsersAttempt`: true when any
// non-terminal get_users attempt exists in the workspace.
async function workspaceHasOpenGetUsersAttempt(workspaceRoot) {
  const log = await loadAttemptLog({ workspaceRoot });
  for (const record of Object.values(log.attempts || {})) {
    if (String(record?.goalLane || "get_users") !== "get_users") continue;
    const snapshot = await projectAttempt({ workspaceRoot, attemptId: record.attemptId });
    if (!snapshot) continue;
    const action = nextAttemptAction(snapshot.projection);
    if (action && action.kind !== "terminal") return true;
  }
  return false;
}

// Replicates index.mjs `isDurableLockedGetUsersLane`.
async function isDurableLockedGetUsersLane(context, workspaceRoot) {
  if (
    isOfficeHoursLockedDay1GoalContext(context)
    && /Goal lane:\s*get_users\b/i.test(String(context || ""))
  ) {
    return true;
  }
  if (await workspaceHasOpenGetUsersAttempt(workspaceRoot)) return true;
  const day1Goal = await loadDay1GoalSelection({ workspaceRoot }).catch(() => null);
  return String(day1Goal?.goalType || "") === "get_users";
}

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "oh-durable-gate-"));
}

test("doc-readiness gate stays closed for get_users via an open attempt even when the context lost the marker", async () => {
  const root = await makeWorkspace();
  try {
    // The runtime context has NO Goal lane / DAY1_LOCKED_GOAL marker (clamped out).
    assert.equal(isOfficeHoursLockedDay1GoalContext(CONTEXT_WITHOUT_MARKERS), false);
    // Context-only discrimination FAILS (this is the regression that leaked doc-readiness).
    const contextOnly = isOfficeHoursLockedDay1GoalContext(CONTEXT_WITHOUT_MARKERS)
      && /Goal lane:\s*get_users\b/i.test(CONTEXT_WITHOUT_MARKERS);
    assert.equal(contextOnly, false);

    // An open get_users ValidationAttempt is the durable signal.
    await startAttempt({ workspaceRoot: root, goalLane: "get_users", day: 1, attemptId: "att-durable-1", sessionId: "s1" });
    assert.equal(await workspaceHasOpenGetUsersAttempt(root), true);

    // The durable gate recognizes the lane and keeps doc-readiness CLOSED.
    assert.equal(await isDurableLockedGetUsersLane(CONTEXT_WITHOUT_MARKERS, root), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("doc-readiness gate stays closed for get_users via day1-goal.json goalType even when the context lost the marker", async () => {
  const root = await makeWorkspace();
  try {
    await saveDay1GoalSelection({
      workspaceRoot: root,
      selection: {
        goalType: "get_users",
        goalText: "30일 안에 가입자 100명을 모은다.",
        customer: "B2B SaaS founder",
        problem: "온보딩에서 이탈한다",
        validationAction: "첫 핵심 행동 완료를 측정한다.",
        proofSink: "local",
      },
    });
    const loaded = await loadDay1GoalSelection({ workspaceRoot: root });
    assert.equal(loaded?.goalType, "get_users");

    // No open attempt, no context markers — only day1-goal.json carries the lane.
    assert.equal(await workspaceHasOpenGetUsersAttempt(root), false);
    assert.equal(await isDurableLockedGetUsersLane(CONTEXT_WITHOUT_MARKERS, root), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("doc-readiness gate stays OPEN (durable lane false) for a non-get_users workspace with no markers", async () => {
  const root = await makeWorkspace();
  try {
    await saveDay1GoalSelection({
      workspaceRoot: root,
      selection: {
        goalType: "make_money",
        goalText: "첫 유료 결제를 만든다.",
        customer: "B2B support lead",
        problem: "Slack escalation을 놓친다",
        validationAction: "유료 파일럿을 제안한다.",
        proofSink: "local",
      },
    });
    assert.equal(await workspaceHasOpenGetUsersAttempt(root), false);
    // make_money lane with no get_users attempt and no markers → NOT a get_users lane,
    // so the doc-readiness gate is allowed to run (it must not over-trigger).
    assert.equal(await isDurableLockedGetUsersLane(CONTEXT_WITHOUT_MARKERS, root), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("durable lane still recognizes get_users from an intact context marker", async () => {
  const root = await makeWorkspace();
  try {
    const intactContext = [
      "DAY1_LOCKED_GOAL",
      "Flow contract: locked Day 1 goal interview.",
      "Goal lane: get_users / 활성 사용자 100명 모으기",
    ].join("\n");
    // No attempt, no day1-goal.json — the context alone is sufficient.
    assert.equal(await isDurableLockedGetUsersLane(intactContext, root), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
