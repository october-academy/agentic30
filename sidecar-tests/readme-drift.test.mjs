import test from "node:test";
import assert from "node:assert/strict";

import { tokenize, fileTerms, detectReadmeDrift } from "../sidecar/readme-drift.mjs";

test("tokenize keeps significant latin/hangul terms, drops stopwords", () => {
  const tokens = tokenize("This adds Notion onboarding for 결제 시스템");
  assert.ok(tokens.includes("notion"));
  assert.ok(tokens.includes("onboarding"));
  assert.ok(tokens.includes("결제"));
  assert.ok(tokens.includes("시스템"));
  assert.ok(!tokens.includes("this"));
  assert.ok(!tokens.includes("for"));
});

test("fileTerms splits paths and camel/kebab/snake identifiers", () => {
  const terms = fileTerms("sidecar/agent-work-history.mjs");
  assert.ok(terms.includes("sidecar"));
  assert.ok(terms.includes("agent"));
  assert.ok(terms.includes("work"));
  assert.ok(terms.includes("history"));
  const camel = fileTerms("agentic30/OnboardingWorkspaceRequestStore.swift");
  assert.ok(camel.includes("onboarding"));
  assert.ok(camel.includes("workspace"));
  assert.ok(camel.includes("request"));
});

test("detectReadmeDrift flags recent work missing from README", () => {
  const result = detectReadmeDrift({
    readme: "# Demo\nA simple todo list app.\n",
    recentCommitSubjects: [
      "Add Notion OAuth integration",
      "Wire Notion sync into onboarding",
      "Fix Notion token refresh",
    ],
    agentIntents: ["Notion 연동 마무리해줘"],
    filesTouched: [{ file: "sidecar/notion-client.mjs", count: 4 }],
  });
  const missingTerms = result.missingFromReadme.map((f) => f.term);
  assert.ok(missingTerms.includes("notion"), "notion is prominent recent work missing from README");
  assert.ok(result.missingFromReadme[0].evidence.length > 0);
  assert.ok(result.driftScore > 0);
  assert.match(result.suggestion, /notion/i);
});

test("detectReadmeDrift flags stale README claims with no recent footprint", () => {
  const result = detectReadmeDrift({
    readme: [
      "# Demo",
      "## 레거시 프린터 드라이버 모듈",
      "- 팩스 게이트웨이 브리지 지원",
    ].join("\n"),
    recentCommitSubjects: ["Add billing dashboard", "Improve billing charts"],
    agentIntents: ["billing 대시보드 개선"],
    filesTouched: [{ file: "src/billing.ts", count: 3 }],
  });
  assert.ok(result.staleInReadme.length >= 1, "legacy README claim flagged as stale");
  assert.match(result.suggestion, /흔적이 없는|레거시|팩스/);
});

test("detectReadmeDrift is deterministic and quiet when README matches reality", () => {
  const input = {
    readme: "# Billing Tool\n## Billing dashboard\n- charts for revenue\n",
    recentCommitSubjects: ["Improve billing dashboard charts"],
    agentIntents: ["billing 차트 개선"],
    filesTouched: [{ file: "src/billing-dashboard.ts", count: 2 }],
  };
  const a = detectReadmeDrift(input);
  const b = detectReadmeDrift(input);
  assert.deepEqual(a, b, "same input → identical output");
  assert.equal(a.missingFromReadme.length, 0);
});

test("detectReadmeDrift handles missing README", () => {
  const result = detectReadmeDrift({ readme: "", recentCommitSubjects: ["init"] });
  assert.equal(result.hasReadme, false);
  assert.match(result.suggestion, /README\.md가 없어요/);
});
