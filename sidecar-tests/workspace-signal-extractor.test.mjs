import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractWorkspaceEvidence } from "../sidecar/workspace-signal-extractor.mjs";
import { projectDocPath } from "../sidecar/project-doc-paths.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-workspace-signals-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeFile(root, relativePath, content) {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

test("canonical project docs ignore non-canonical and noisy root ICP docs", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(root, "icp.md", "# ICP\n\nTODO: write this later.\n");
    await writeFile(root, "archive/ICP.md", "# ICP\n\nTarget user: archived ecommerce operator.");
    await writeFile(root, "README.md", "# SupportLens\n\nCustomer support escalation assistant.");
    await writeFile(
      root,
      projectDocPath("icp"),
      [
        "# Ideal Customer Profile",
        "",
        "Target user: customer success lead handling B2B Slack escalations.",
        "Problem: escalation requests fall through Slack before SLA breach.",
      ].join("\n"),
    );

    const extracted = await extractWorkspaceEvidence(root, {
      scanPaths: { icp: ["icp.md", "archive/ICP.md", projectDocPath("icp")] },
      includeSource: false,
    });

    assert.equal(extracted.docs.icp, projectDocPath("icp"));
    assert.match(extracted.signals.targetUser, /customer success lead/i);
    assert.equal(extracted.candidates.icp.some((item) => item.path === "icp.md"), false);
    assert.equal(extracted.candidates.icp.some((item) => item.path === "archive/ICP.md"), false);
    assert.ok(extracted.rejectedCandidates.some((item) => item.path === "icp.md"));
    assert.ok(extracted.rejectedCandidates.some((item) => item.path === "archive/ICP.md"));
  });
});

test("initial scan accepts root docs as pre-canonical field evidence", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(
      root,
      "docs/ICP.md",
      [
        "# ICP",
        "",
        "## Our ICP: 전업 1인 개발자 (수익 0원, macOS)",
        "",
        "## Validation Signals",
        "### Positive",
        "- 첫 외부 ICP 인터뷰에서 반복 가능한 pain point와 현재 대안이 확인됨",
      ].join("\n"),
    );
    await writeFile(
      root,
      "docs/SPEC.md",
      "# SPEC\n\n핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지 모른다”는 것이다.\n",
    );
    await writeFile(
      root,
      "docs/GOAL.md",
      "# Goal\n\nGoal: 30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.\n",
    );
    await writeFile(
      root,
      "docs/VALUES.md",
      "# Values\n\n쉽게 만든다. 오늘 바로 실행할 수 있는 좁은 행동을 우선한다.\n",
    );

    const extracted = await extractWorkspaceEvidence(root, { includeSource: false });

    assert.equal(extracted.docs.icp, "docs/ICP.md");
    assert.equal(extracted.docs.spec, "docs/SPEC.md");
    assert.equal(extracted.docs.goal, "docs/GOAL.md");
    assert.match(extracted.signals.targetUser, /전업 1인 개발자/);
    assert.match(extracted.signals.problem, /무엇을 팔아야 하는지/);
    assert.ok(extracted.evidence.some((item) => item.path === "docs/ICP.md" && item.field === "targetUser"));
    assert.ok(extracted.evidence.some((item) => item.path === "docs/SPEC.md" && item.field === "problem"));
    assert.ok(extracted.evidence.some((item) => item.path === "docs/ICP.md" && item.reason === "explicit_validation_action"));
  });
});

test("initial scan extracts quote-backed fields from generic markdown without promoting doc path", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(
      root,
      "PRODUCT_NOTES.md",
      [
        "# LaunchDesk notes",
        "",
        "Target user: solo founders preparing a paid launch.",
        "Problem: they do not know which buyer signal to test before publishing.",
        "Outcome: solo founders confirm a buyer signal in customer calls before launch.",
      ].join("\n"),
    );

    const extracted = await extractWorkspaceEvidence(root, { includeSource: false });

    assert.equal(extracted.docs.icp, null);
    assert.equal(extracted.docs.spec, null);
    assert.equal(extracted.docs.goal, null);
    assert.match(extracted.signals.targetUser, /solo founders/i);
    assert.match(extracted.signals.problem, /buyer signal/i);
    assert.match(extracted.signals.outcome, /customer calls/i);
    assert.ok(extracted.evidence.some((item) => item.path === "PRODUCT_NOTES.md" && item.field === "targetUser"));
    assert.ok(extracted.evidence.some((item) => item.path === "PRODUCT_NOTES.md" && item.field === "problem"));
    assert.ok(extracted.evidence.some((item) => item.path === "PRODUCT_NOTES.md" && item.reason === "explicit_validation_action"));
  });
});

test("provider-returned bad paths are rejected before docs are exposed", async () => {
  await withTempWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "archive"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await writeFile(root, ".agentic30/docs/ICP.md", "# ICP\n\nTarget user: ecommerce operator.");
    await writeFile(root, "data.json", JSON.stringify({ targetUser: "not a document role" }));
    await writeFile(root, "image.bin", "\u0000\u0001\u0002");

    const extracted = await extractWorkspaceEvidence(root, {
      scanPaths: {
        icp: ["archive", "/tmp/outside.md", "missing.md", "data.json", "image.bin", ".agentic30/docs/ICP.md"],
      },
      includeSource: false,
    });

    assert.equal(extracted.docs.icp, ".agentic30/docs/ICP.md");
    assert.ok(extracted.rejectedCandidates.some((item) => item.path === "archive"));
    assert.ok(extracted.rejectedCandidates.some((item) => item.path === "/tmp/outside.md"));
    assert.ok(extracted.rejectedCandidates.some((item) => item.path === "missing.md"));
    assert.ok(extracted.rejectedCandidates.some((item) => item.path === "data.json"));
    assert.ok(!Object.values(extracted.docs).includes("data.json"));
  });
});

test("bundled sidecar Node runtime README is ignored for docs and product name", async () => {
  await withTempWorkspace(async (root) => {
    const runtimeReadme = "sidecar-build/node-runtime-arm64/node-v24.15.0-darwin-arm64/README.md";
    await writeFile(
      root,
      "README.md",
      [
        "# agentic30 Mac",
        "",
        "Native macOS menu bar assistant for founders using AI coding agents.",
      ].join("\n"),
    );
    await writeFile(
      root,
      runtimeReadme,
      [
        "# Node.js",
        "",
        "Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine.",
      ].join("\n"),
    );
    await writeFile(
      root,
      ".agentic30/docs/ICP.md",
      "# ICP\n\nTarget user: 전업 1인 개발자 using AI coding agents.",
    );

    const extracted = await extractWorkspaceEvidence(root, {
      scanPaths: { docs: runtimeReadme, icp: ".agentic30/docs/ICP.md" },
      includeSource: true,
    });

    assert.equal(extracted.docs.docs, null);
    assert.equal(extracted.signals.productName, "agentic30 Mac");
    assert.ok(extracted.rejectedCandidates.some((item) => item.path === runtimeReadme));
    assert.ok(!extracted.evidence.some((item) => item.path.includes("sidecar-build")));
    assert.notEqual(extracted.signals.productName, "Node.js");
  });
});

test("late document sections still produce Goal ICP Pain and Outcome signals", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(
      root,
      "README.md",
      [
        "# RevenuePilot",
        "",
        "Intro",
        "",
        "## References",
        "- [SPEC.md](./.agentic30/docs/SPEC.md)",
        "",
        "## Target User",
        "Target user: B2B SaaS founder preparing first sales calls.",
        "",
        "## Problem",
        "Problem: founders do not know which sales message is painful enough to buy.",
        "",
        "## North Star",
        "Goal: book three qualified sales calls this week.",
        "",
        "## Outcome",
        "Outcome: founder confirms one buyer message in a customer conversation.",
      ].join("\n"),
    );

    const extracted = await extractWorkspaceEvidence(root, { includeSource: false });

    assert.equal(extracted.docs.docs, null);
    assert.match(extracted.signals.productName, /RevenuePilot/);
    assert.match(extracted.signals.targetUser, /B2B SaaS founder/i);
    assert.match(extracted.signals.problem, /sales message/i);
    assert.match(extracted.signals.goal, /three qualified sales calls/i);
    assert.match(extracted.signals.outcome, /buyer message/i);
    assert.doesNotMatch(JSON.stringify(extracted.signals), /SPEC\.md/);
  });
});

test("persona Job summary does not become outcome signal", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(
      root,
      ".agentic30/docs/ICP.md",
      [
        "# ICP",
        "",
        "## Primary persona",
        "- **Job summary:** AI 코딩 도구로 빠르게 만들 수 있지만, 고객 검증과 배포/획득 루프는 약하다.",
        "- **Motivation:** 제품을 빨리 만들고 싶다.",
        "- **Frustration:** 고객 인터뷰와 BIP 기록을 해도 다음 행동으로 연결하지 못한다.",
        "",
        "## Validation Signals",
        "### Positive",
        "- 첫 대화에서 지불 의향과 현재 대안을 확인한다.",
      ].join("\n"),
    );

    const extracted = await extractWorkspaceEvidence(root, { includeSource: false });

    assert.match(extracted.signals.outcome, /지불 의향|현재 대안|확인/);
    assert.doesNotMatch(
      extracted.signals.outcome,
      /Job summary|Motivation|Frustration|고객 검증과 배포\/획득 루프|다음 행동으로 연결하지 못한다/,
    );
  });
});

test("SPEC quote prefers problem section over MVP scope input artifacts", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(
      root,
      ".agentic30/docs/SPEC.md",
      [
        "# Product Spec",
        "",
        "## Problem",
        "Problem: solo founders can build but do not know what buyer pain is urgent enough to pay for.",
        "",
        "## MVP Success",
        "- problem evidence가 Mac 앱/sidecar 입력으로 들어온다.",
        "- 같은 ICP 조건에서 pain point와 행동 신호가 반복된다.",
        "",
        "## MVP Scope",
        "Q2 wedge is a private pilot loop.",
        "",
        "### In Scope",
        "- SwiftUI macOS menu bar app",
        "- problem memo 또는 인터뷰 transcript 입력",
        "- Day 0-3 맞춤 과제 생성",
      ].join("\n"),
    );

    const extracted = await extractWorkspaceEvidence(root, {
      scanPaths: { spec: ".agentic30/docs/SPEC.md" },
      includeSource: false,
    });
    const specEvidence = extracted.evidence.find((item) => item.path === ".agentic30/docs/SPEC.md");

    assert.ok(specEvidence);
    assert.match(specEvidence.quote, /buyer pain|urgent enough to pay/i);
    assert.doesNotMatch(specEvidence.quote, /problem memo|problem evidence|인터뷰 transcript|In Scope|MVP Success/i);
    assert.match(extracted.signals.problem, /buyer pain|urgent enough/i);
  });
});

test("source-only workspace extracts user-facing signals and ignores schema noise", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(root, "package.json", JSON.stringify({ name: "launchdesk", dependencies: { zod: "^3.0.0" } }));
    await writeFile(
      root,
      "src/landing-copy.ts",
      [
        "export const landingCopy = {",
        "  targetUser: \"solo founders preparing a paid launch\",",
        "  problem: \"they do not know which buyer signal to test before publishing\",",
        "  goal: \"prove one buyer signal with three founder calls this week\",",
        "  outcome: \"solo founders confirm a buyer signal in customer calls before launch\"",
        "};",
      ].join("\n"),
    );
    await writeFile(
      root,
      "src/schema.mjs",
      [
        "export const Schema = z.object({",
        "  goal: z.string().min(1),",
        "  targetUser: z.enum([\"wrong\"]),",
        "});",
      ].join("\n"),
    );

    const extracted = await extractWorkspaceEvidence(root, { includeSource: true });

    assert.equal(extracted.signals.productName, "launchdesk");
    assert.match(extracted.signals.targetUser, /solo founders/i);
    assert.match(extracted.signals.problem, /buyer signal/i);
    assert.match(extracted.signals.goal, /founder calls/i);
    assert.ok(extracted.evidence.some((item) => item.path === "src/landing-copy.ts"));
    assert.doesNotMatch(JSON.stringify(extracted.signals), /z\.string|z\.enum|wrong/);
  });
});
