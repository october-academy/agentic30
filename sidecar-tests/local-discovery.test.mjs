import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import {
  collectLocalDiscovery,
  inferRunwayHints,
  summarizeGitActivity,
  summarizeProjectShape,
  LOCAL_DISCOVERY_SCHEMA_VERSION,
} from "../sidecar/local-discovery.mjs";

// Deterministic git/manifest signals that feed Day1IcpPlan without any LLM
// call. These tests exercise the function via real git CLI in a tmp repo so
// we don't accidentally regress the spawn-based reader (timeout / error path /
// non-git folder).

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-local-discovery-"));
}

function gitInit(cwd, args, env = {}) {
  const result = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      // Pin author to keep timestamps deterministic.
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      ...env,
    },
    stdio: "ignore",
  });
  return result.status === 0;
}

test("collectLocalDiscovery returns empty stable shape for non-git folder", async () => {
  const dir = await makeTmpDir();
  try {
    const result = await collectLocalDiscovery(dir);
    assert.equal(result.schemaVersion, LOCAL_DISCOVERY_SCHEMA_VERSION);
    assert.equal(result.git.isGitRepo, false);
    assert.equal(result.git.firstCommitAt, null);
    assert.equal(result.git.last7DaysCommitCount, 0);
    assert.deepEqual(result.project.stacks, []);
    assert.equal(result.project.hasReadme, false);
    assert.equal(result.runway.projectAgeDays, null);
    assert.equal(result.runway.recentlyActive, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("collectLocalDiscovery returns null fields when workspaceRoot is empty", async () => {
  const result = await collectLocalDiscovery("");
  assert.equal(result.schemaVersion, LOCAL_DISCOVERY_SCHEMA_VERSION);
  assert.equal(result.git.isGitRepo, false);
  assert.equal(result.runway.projectAgeDays, null);
});

test("summarizeGitActivity reports first commit + 7d count + dirty + branch", async () => {
  const dir = await makeTmpDir();
  try {
    assert.ok(gitInit(dir, ["init", "-b", "main"]), "git init must succeed");
    await fs.writeFile(path.join(dir, "a.txt"), "alpha");
    assert.ok(gitInit(dir, ["add", "a.txt"]));
    assert.ok(gitInit(dir, ["commit", "-m", "first commit"], {
      GIT_AUTHOR_DATE: "2026-05-10T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-05-10T10:00:00Z",
    }));
    await fs.writeFile(path.join(dir, "a.txt"), "alpha2");
    // dirty work tree

    const summary = await summarizeGitActivity(dir, { now: new Date("2026-05-12T00:00:00Z") });
    assert.equal(summary.isGitRepo, true);
    // git's strict-ISO format varies between platforms (Z vs +00:00); pin via
    // Date.parse so the test stays portable across git versions.
    assert.equal(Date.parse(summary.firstCommitAt), Date.parse("2026-05-10T10:00:00Z"));
    assert.equal(summary.last7DaysCommitCount, 1);
    assert.equal(summary.dirty, true);
    assert.equal(summary.branch, "main");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeProjectShape detects Node + README", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(path.join(dir, "package.json"), '{"name":"x"}');
    await fs.writeFile(path.join(dir, "README.md"), "# x");
    const shape = await summarizeProjectShape(dir);
    assert.deepEqual(shape.stacks, ["node"]);
    assert.equal(shape.hasReadme, true);
    assert.deepEqual(shape.manifestPaths, ["package.json"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeProjectShape detects PHP via composer.json", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(path.join(dir, "composer.json"), '{}');
    const shape = await summarizeProjectShape(dir);
    assert.deepEqual(shape.stacks, ["php"]);
    assert.deepEqual(shape.manifestPaths, ["composer.json"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeProjectShape detects Elixir via mix.exs", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(path.join(dir, "mix.exs"), "defmodule X");
    const shape = await summarizeProjectShape(dir);
    assert.deepEqual(shape.stacks, ["elixir"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeProjectShape detects .NET via glob-style csproj filename", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(path.join(dir, "MyApp.csproj"), "<Project/>");
    const shape = await summarizeProjectShape(dir);
    assert.equal(shape.stacks.includes("dotnet"), true);
    assert.equal(shape.manifestPaths.includes("MyApp.csproj"), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeProjectShape detects multiple stacks", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(path.join(dir, "package.json"), '{}');
    await fs.writeFile(path.join(dir, "Package.swift"), "// swift-tools-version:5.9");
    const shape = await summarizeProjectShape(dir);
    assert.equal(shape.stacks.includes("node"), true);
    assert.equal(shape.stacks.includes("swift"), true);
    assert.equal(shape.hasReadme, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("inferRunwayHints returns nulls for non-git summary", () => {
  const result = inferRunwayHints({ isGitRepo: false, firstCommitAt: null, last7DaysCommitCount: 0 });
  assert.equal(result.projectAgeDays, null);
  assert.equal(result.recentlyActive, null);
});

test("inferRunwayHints computes age and activity from git summary", () => {
  const result = inferRunwayHints(
    {
      isGitRepo: true,
      firstCommitAt: "2026-05-01T00:00:00Z",
      last7DaysCommitCount: 12,
      dirty: false,
      branch: "main",
    },
    { now: new Date("2026-05-15T00:00:00Z") },
  );
  assert.equal(result.projectAgeDays, 14);
  assert.equal(result.recentlyActive, true);
});

test("inferRunwayHints flags zero-commit weeks as not recently active", () => {
  const result = inferRunwayHints(
    {
      isGitRepo: true,
      firstCommitAt: "2026-05-01T00:00:00Z",
      last7DaysCommitCount: 0,
      dirty: false,
      branch: "main",
    },
    { now: new Date("2026-05-15T00:00:00Z") },
  );
  assert.equal(result.projectAgeDays, 14);
  assert.equal(result.recentlyActive, false);
});

test("summarizeGitActivity exposes git HEAD sha", async () => {
  const dir = await makeTmpDir();
  try {
    assert.ok(gitInit(dir, ["init", "-b", "main"]));
    await fs.writeFile(path.join(dir, "a.txt"), "alpha");
    assert.ok(gitInit(dir, ["add", "a.txt"]));
    assert.ok(gitInit(dir, ["commit", "-m", "first"], {
      GIT_AUTHOR_DATE: "2026-05-10T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-05-10T10:00:00Z",
    }));
    const summary = await summarizeGitActivity(dir, { now: new Date("2026-05-12T00:00:00Z") });
    assert.equal(typeof summary.head, "string");
    assert.match(summary.head, /^[0-9a-f]{40}$/, "HEAD must be a 40-char SHA");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("collectLocalDiscovery composes git + project + runway end-to-end", async () => {
  const dir = await makeTmpDir();
  try {
    assert.ok(gitInit(dir, ["init", "-b", "main"]));
    await fs.writeFile(path.join(dir, "package.json"), '{"name":"x"}');
    await fs.writeFile(path.join(dir, "README.md"), "# x");
    assert.ok(gitInit(dir, ["add", "."]));
    assert.ok(gitInit(dir, ["commit", "-m", "initial"], {
      GIT_AUTHOR_DATE: "2026-05-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-05-01T00:00:00Z",
    }));
    const result = await collectLocalDiscovery(dir, { now: new Date("2026-05-15T00:00:00Z") });
    assert.equal(result.git.isGitRepo, true);
    assert.equal(result.git.last7DaysCommitCount, 0); // first commit was 14 days ago
    assert.equal(result.project.stacks.includes("node"), true);
    assert.equal(result.project.hasReadme, true);
    assert.equal(result.runway.projectAgeDays, 14);
    assert.equal(result.runway.recentlyActive, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
