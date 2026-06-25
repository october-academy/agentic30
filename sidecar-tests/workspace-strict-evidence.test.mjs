import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import zlib from "node:zlib";

import { extractWorkspaceEvidence } from "../sidecar/workspace-signal-extractor.mjs";
import { deriveWorkspaceOnboardingHypothesisLocally } from "../sidecar/onboarding-hypothesis.mjs";
import { generateDay1AlignmentPlan } from "../sidecar/generate-day1-icp-plan.mjs";
import {
  buildWorkspaceScanEvidenceBundle,
  normalizeWorkspaceScanSemanticOutput,
} from "../sidecar/workspace-scan-evidence-bundle.mjs";

function makeCidTextPdf(text) {
  const chars = Array.from(text);
  const mappings = chars.map((ch, index) => [
    (0x2800 + index).toString(16).padStart(4, "0"),
    ch,
  ]);
  const bf = mappings
    .map(([glyph, ch]) => `<${glyph}> <${ch.codePointAt(0).toString(16).padStart(4, "0")}>`)
    .join("\n");
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n${mappings.length} beginbfchar\n${bf}\nendbfchar\nendcmap end`;
  const cmapDeflated = zlib.deflateSync(Buffer.from(cmap, "latin1"));
  const content = `BT /F1 12 Tf 72 720 Td <${mappings.map(([glyph]) => glyph).join("")}> Tj ET`;
  const contentDeflated = zlib.deflateSync(Buffer.from(content, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.5\n", "latin1"),
    Buffer.from(`1 0 obj\n<</Filter /FlateDecode /Length ${cmapDeflated.length}>>\nstream\n`, "latin1"),
    cmapDeflated,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
    Buffer.from(`2 0 obj\n<</Filter /FlateDecode /Length ${contentDeflated.length}>>\nstream\n`, "latin1"),
    contentDeflated,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
}

async function withTempWorkspace(fn) {
  const root = await mkdtemp(join(tmpdir(), "agentic30-strict-evidence-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const DONGDONG_CUSTOMER = "불교 문화에 호감을 가지고 있으나 종교 활동에는 부담을 느끼는 2030 비신자 및 라이트 관심층, 명상·감정기록·힐링 서비스를 선호하는 디지털 웰니스 수요층";
const DONGDONG_PROBLEM = "불교 호감도는 높지만 일상적 신행이나 마음챙김 루틴으로 이어지는 디지털 접점이 부족하다";
const DONGDONG_ACTION = "명상·감정기록·불경 듣기 등 첫 마음챙김 활동을 완료하고 반복 사용 의사를 보이는 것";

test("PDF-only dongdong scan uses explicit PDF customer instead of 상담 keyword CS fallback", async () => {
  await withTempWorkspace(async (root) => {
    const pdfText = [
      "프로젝트 소개 - 불교를 일상 속에서 가볍게 경험하며 마음챙김 습관을 돕는 AI 기반 디지털 플랫폼",
      "목적 및 필요성 - 시장 기회: 2030세대의 불교 호감도는 역대 최고 수준이나, 일상적 신행으로 이어지는 디지털 전환 도구가 부재함",
      "해결 과제: 무거운 교리 학습이 아닌 마음챙김 경험과 일상적 루틴을 통해, 불교에 호감을 가진 사용자에게 부담 없는 첫 접점을 제공",
      "프로젝트 개요 - 주요 기능: 캐릭터 육성, AI 명상 가이드, 불경 콘텐츠, AI 스님 상담-화두 문답",
      "주요 용어 정의 공덕: 명상·감정기록·불경 듣기 등 마음챙김 활동 수행 시 적립되는 포인트",
      `결과물 활용방안 활용처·사용자 - ${DONGDONG_CUSTOMER}을 핵심 사용자로 설정 사업화 및 제휴 전략`,
    ].join("\n");
    await writeFile(join(root, "project_proposal.pdf"), makeCidTextPdf(pdfText));

    const evidence = await extractWorkspaceEvidence(root, { includeSource: false });
    assert.equal(evidence.signals.targetUser, DONGDONG_CUSTOMER);
    assert.equal(evidence.signals.problem, DONGDONG_PROBLEM);
    assert.equal(evidence.signals.outcome, DONGDONG_ACTION);
    assert.deepEqual(evidence.signals.likelyUsers, [DONGDONG_CUSTOMER]);
    assert.equal(evidence.signals.likelyUsers.includes("고객 지원/CS 담당자"), false);

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root);
    assert.equal(hypothesis.targetUser, DONGDONG_CUSTOMER);
    assert.equal(hypothesis.problem, DONGDONG_PROBLEM);
    assert.equal(hypothesis.likelyUsers.includes("고객 지원/CS 담당자"), false);

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      onboardingHypothesis: hypothesis,
    });
    assert.equal(plan.readiness.status, "ready");
    assert.equal(plan.qualityGate.passed, true);
    assert.match(plan.components.outcome.statement, /명상·감정기록·불경 듣기/);
  });
});

test("missing customer/problem/action quote blocks Day 1 alignment readiness", async () => {
  await withTempWorkspace(async (root) => {
    const pdfText = [
      `활용처·사용자 - ${DONGDONG_CUSTOMER}을 핵심 사용자로 설정 사업화 및 제휴 전략`,
      "목적 및 필요성 - 시장 기회: 2030세대의 불교 호감도는 역대 최고 수준이나, 일상적 신행으로 이어지는 디지털 전환 도구가 부재함",
    ].join("\n");
    await writeFile(join(root, "project_proposal.pdf"), makeCidTextPdf(pdfText));

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root);
    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      onboardingHypothesis: hypothesis,
    });
    assert.equal(plan.readiness.status, "blocked");
    assert.deepEqual(plan.readiness.missingFields, ["validationAction"]);
    assert.match(plan.readiness.rootCause, /활성\/검증 행동 quote 근거가 부족/);
  });
});

test("semantic scan output rejects OCR-contaminated problem and unsupported CS customer", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "project_proposal.pdf"), makeCidTextPdf([
      `활용처·사용자 - ${DONGDONG_CUSTOMER}을 핵심 사용자로 설정 사업화 및 제휴 전략`,
      `문제: ${DONGDONG_PROBLEM}`,
      `활성 행동: ${DONGDONG_ACTION}`,
    ].join("\n")));

    const bundle = await buildWorkspaceScanEvidenceBundle({
      workspaceRoot: root,
      scanResult: {},
    });
    const normalized = normalizeWorkspaceScanSemanticOutput({
      onboardingHypothesis: {
        targetUser: "고객 지원/CS 담당자",
        problem: "시장 기회8 0010세대의 불교 호감도는 역대 최고 수준이나, 일상적 신행으로 이어지는 디지털 전환 도구가 부재함",
        likelyUsers: ["고객 지원/CS 담당자"],
        confidence: "high",
        evidence: ["project_proposal.pdf"],
      },
      evidencePathsUsed: ["project_proposal.pdf"],
    }, bundle);

    assert.equal(normalized.onboardingHypothesis.targetUser, "");
    assert.equal(normalized.onboardingHypothesis.problem, "");
    assert.deepEqual(normalized.onboardingHypothesis.likelyUsers, []);
  });
});
