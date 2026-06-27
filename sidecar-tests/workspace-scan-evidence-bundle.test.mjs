import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { projectDocPath } from "../sidecar/project-doc-paths.mjs";
import {
  buildWorkspaceScanAgentPrompt,
  buildWorkspaceScanEvidenceBundle,
  normalizeWorkspaceScanSemanticOutput,
  summarizeWorkspaceScanLocalFindings,
} from "../sidecar/workspace-scan-evidence-bundle.mjs";

async function withWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-scan-bundle-"));
  try {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "# SupportLens\n\nCustomer support escalation assistant.\n");
    await fs.writeFile(
      path.join(root, projectDocPath("icp")),
      "# ICP\n\nTarget user: customer success lead with missed Slack escalations.\n",
    );
    await fs.writeFile(
      path.join(root, "docs", "ICP.md"),
      "# Archived ICP\n\nTarget user: legacy ecommerce operator.\n",
    );
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("evidence bundle keeps docs/ICP.md as support evidence while canonical ICP is .agentic30/docs/ICP.md", async () => {
  await withWorkspace(async (root) => {
    const bundle = await buildWorkspaceScanEvidenceBundle({
      workspaceRoot: root,
      scanResult: { icp: projectDocPath("icp") },
    });

    assert.equal(bundle.canonicalDocs.icp.path, projectDocPath("icp"));
    assert.equal(bundle.canonicalDocs.icp.found, true);
    assert.equal(bundle.canonicalFoundCount, 1);
    assert.ok(bundle.discoveredEvidenceCount >= 1);
    assert.equal(bundle.localFoundCount, bundle.discoveredEvidenceCount);
    assert.ok(bundle.evidenceRefs.some((ref) => ref.path === "docs/ICP.md"));
    assert.equal(bundle.canonicalDocs.icp.path === "docs/ICP.md", false);

    const findings = summarizeWorkspaceScanLocalFindings(bundle);
    assert.equal(findings.canonicalFoundCount, 1);
    assert.equal(findings.localFoundCount, bundle.discoveredEvidenceCount);
    assert.equal(findings.canonicalDocs.icp.path, projectDocPath("icp"));
    assert.ok(findings.evidencePaths.includes("docs/ICP.md"));
  });
});

test("provider scan prompt contains the local evidence bundle and forbids path override", async () => {
  await withWorkspace(async (root) => {
    const bundle = await buildWorkspaceScanEvidenceBundle({
      workspaceRoot: root,
      scanResult: { icp: projectDocPath("icp") },
    });
    const prompt = buildWorkspaceScanAgentPrompt(bundle);

    assert.match(prompt, /LOCAL_EVIDENCE_BUNDLE_JSON/);
    assert.match(prompt, /docs\/ICP\.md/);
    assert.match(prompt, /Do not return, override, or invent canonical document paths/);
    assert.doesNotMatch(prompt, /"icp": null, "spec": null/);
  });
});

test("semantic provider output rejects hallucinated evidence paths and high confidence", async () => {
  await withWorkspace(async (root) => {
    const bundle = await buildWorkspaceScanEvidenceBundle({
      workspaceRoot: root,
      scanResult: { icp: projectDocPath("icp") },
    });
    const normalized = normalizeWorkspaceScanSemanticOutput({
      confidence: "high",
      onboardingHypothesis: {
        productName: "MadeUp",
        targetUser: "enterprise CFO",
        confidence: "high",
        evidence: ["archive/Fake.md"],
      },
      evidencePathsUsed: ["archive/Fake.md"],
      situationSignals: {
        channels: [
          { label: "ads", evidencePath: "archive/Fake.md", shortQuote: "ads" },
        ],
      },
    }, bundle);

    assert.equal(normalized.confidence, "low");
    assert.deepEqual(normalized.evidencePathsUsed, []);
    assert.equal(normalized.situationSignals.channels.length, 0);
    assert.equal(normalized.onboardingHypothesis.confidence, "low");
  });
});

test("semantic provider output can be high confidence only with valid bundle evidence paths", async () => {
  await withWorkspace(async (root) => {
    const bundle = await buildWorkspaceScanEvidenceBundle({
      workspaceRoot: root,
      scanResult: { icp: projectDocPath("icp") },
    });
    const normalized = normalizeWorkspaceScanSemanticOutput({
      confidence: "high",
      onboardingHypothesis: {
        productName: "SupportLens",
        targetUser: "customer success lead",
        problem: "missed Slack escalations",
        confidence: "high",
      },
      evidencePathsUsed: [projectDocPath("icp"), "docs/ICP.md"],
      situationSignals: {
        customerActions: [
          {
            label: "missed Slack escalation review",
            evidencePath: projectDocPath("icp"),
            shortQuote: "missed Slack escalations",
          },
        ],
      },
    }, bundle);

    assert.equal(normalized.confidence, "high");
    assert.deepEqual(normalized.evidencePathsUsed, [projectDocPath("icp"), "docs/ICP.md"]);
    assert.equal(normalized.onboardingHypothesis.evidence[0], projectDocPath("icp"));
    assert.equal(normalized.situationSignals.customerActions.length, 1);
  });
});
