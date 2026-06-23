import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyDay1SurfaceReviewDecision,
  generateDay1SurfaceReview,
  loadDay1SurfaceReview,
  saveDay1SurfaceReview,
} from "../sidecar/day1-surface-review.mjs";
import {
  loadDayMemory,
  refreshDayMemory,
} from "../sidecar/workspace-memory.mjs";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-surface-review-"));
}

async function seedWorkspace(root) {
  await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "README.md"), "# SupportLens\n\n```bash\nnpm test\n```\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "고객: B2B SaaS support lead\n대안: Slack search and spreadsheets\n");
  await fs.writeFile(path.join(root, ".agentic30", "docs", "GOAL.md"), "목표: 첫 파일럿 후보 1명을 찾는다\n");
  await fs.writeFile(path.join(root, ".agentic30", "docs", "SPEC.md"), "문제: urgent Slack escalations are missed\n");
}

test("no-landing surface review creates landing and README proposals and approval writes them", async () => {
  const root = await tempWorkspace();
  try {
    await seedWorkspace(root);
    const generated = await generateDay1SurfaceReview({
      workspaceRoot: root,
      mode: "no_landing",
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    assert.equal(generated.mode, "no_landing");
    assert.equal(generated.status, "preview_ready");
    assert.deepEqual(generated.proposals.map((proposal) => proposal.path), ["landing.html", "README.md"]);
    assert.match(generated.customerSurface.cta, /파일럿|신청/);
    assert.match(generated.proposals[0].content, /<!doctype html>/);
    assert.match(generated.proposals[1].content, /기술\/설치 사실/);

    await saveDay1SurfaceReview({ workspaceRoot: root, review: generated });
    const decided = await applyDay1SurfaceReviewDecision({
      workspaceRoot: root,
      decision: "approved",
      now: new Date("2026-06-23T01:00:00.000Z"),
    });

    assert.equal(decided.decision.status, "approved");
    assert.deepEqual(decided.decision.appliedFiles, ["landing.html", "README.md"]);
    assert.match(await fs.readFile(path.join(root, "landing.html"), "utf8"), /SupportLens/);
    assert.match(await fs.readFile(path.join(root, "README.md"), "utf8"), /B2B SaaS support lead/);

    await refreshDayMemory({ workspaceRoot: root, day: 1, now: new Date("2026-06-23T02:00:00.000Z") });
    const memory = await loadDayMemory({ workspaceRoot: root, day: 1 });
    assert.match(memory.summary.text, /처음 보여줄 문장 approved/);
    assert.equal(memory.details.surfaceReview.decisionStatus, "approved");
    assert.deepEqual(memory.details.surfaceReview.appliedFiles, ["landing.html", "README.md"]);
    assert.equal(memory.details.surfaceReview.cta, decided.customerSurface.cta);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("surface review rejection stores decision without writing proposal files", async () => {
  const root = await tempWorkspace();
  try {
    await seedWorkspace(root);
    const generated = await generateDay1SurfaceReview({ workspaceRoot: root, mode: "no_landing" });
    await saveDay1SurfaceReview({ workspaceRoot: root, review: generated });
    const decided = await applyDay1SurfaceReviewDecision({
      workspaceRoot: root,
      decision: "rejected",
      now: new Date("2026-06-23T01:00:00.000Z"),
    });

    assert.equal(decided.decision.status, "rejected");
    assert.deepEqual(decided.decision.appliedFiles, []);
    await assert.rejects(fs.stat(path.join(root, "landing.html")), /ENOENT/);
    const loaded = await loadDay1SurfaceReview({ workspaceRoot: root });
    assert.equal(loaded.decision.status, "rejected");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("surface review uses onboarding memory and market radar when docs are sparse", async () => {
  const root = await tempWorkspace();
  try {
    await fs.mkdir(path.join(root, ".agentic30", "memory"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "news"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "# SparseLens\n");
    await fs.writeFile(path.join(root, ".agentic30", "memory", "onboarding.json"), JSON.stringify({
      schema: "agentic30.memory.onboarding.v3",
      workspaceRoot: root,
      answers: {
        primaryFocus: {
          answer: "Customer success managers chasing renewal risk",
        },
        primaryBottleneck: {
          answer: "renewal risk is hidden until too late",
        },
      },
      onboardingContext: {},
    }));
    await fs.writeFile(path.join(root, ".agentic30", "news", "market-radar-cache.json"), JSON.stringify({
      snapshot: {
        externalSearchResults: [
          {
            alternative: "spreadsheet health checks",
          },
        ],
      },
    }));

    const generated = await generateDay1SurfaceReview({
      workspaceRoot: root,
      mode: "no_landing",
      now: new Date("2026-06-23T00:00:00.000Z"),
    });

    assert.match(generated.customerSurface.audience, /Customer success managers/);
    assert.match(generated.customerSurface.problem, /renewal risk/);
    assert.match(generated.customerSurface.currentAlternative, /spreadsheet health checks/);
    assert.match(generated.proposals[0].content, /SparseLens/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("surface review fails explicitly when customer and problem evidence are missing", async () => {
  const root = await tempWorkspace();
  try {
    await fs.writeFile(path.join(root, "README.md"), "# EmptyApp\n");
    await assert.rejects(
      generateDay1SurfaceReview({
        workspaceRoot: root,
        mode: "no_landing",
      }),
      /requires customer and problem evidence/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("existing landing URL review fails explicitly on login wall", async () => {
  const root = await tempWorkspace();
  try {
    await seedWorkspace(root);
    await assert.rejects(
      generateDay1SurfaceReview({
        workspaceRoot: root,
        mode: "existing_url",
        landingUrl: "https://example.com/private",
        fetchImpl: async () => ({
          status: 401,
          url: "https://example.com/private",
          headers: { get: () => "text/html" },
          text: async () => "<html>login</html>",
        }),
      }),
      /requires login|HTTP 401/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
