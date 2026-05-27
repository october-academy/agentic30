import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildQmdBootstrapCollections,
  buildQmdGuidance,
  buildQmdMemorySourceSummary,
  buildQmdMcpConfig,
  ensureQmdMemoryCollections,
  getQmdState,
  resolveQmdBinary,
  resolveQmdBinaryInfo,
} from "../sidecar/qmd-support.mjs";

function fakeFs(executables = new Set(), files = new Map(), directories = new Set()) {
  return {
    accessSync(filePath) {
      if (!executables.has(filePath) && !files.has(filePath) && !directories.has(filePath)) {
        throw new Error(`missing ${filePath}`);
      }
    },
    statSync(filePath) {
      if (directories.has(filePath)) {
        return { isDirectory: () => true };
      }
      if (executables.has(filePath) || files.has(filePath)) {
        return { isDirectory: () => false };
      }
      throw new Error(`missing ${filePath}`);
    },
    readFileSync(filePath) {
      if (!files.has(filePath)) {
        throw new Error(`missing ${filePath}`);
      }
      return files.get(filePath);
    },
  };
}

function fakeRunner({ status = 0, stdout = "Usage: qmd mcp" } = {}) {
  return () => ({ status, stdout, stderr: "" });
}

function recordingRunner(calls, { status = 0, stdout = "Usage: qmd mcp" } = {}) {
  return (command, args) => {
    calls.push([command, args]);
    return { status, stdout, stderr: "" };
  };
}

test("resolveQmdBinary prefers AGENTIC30_QMD_BIN when executable", () => {
  const fsImpl = fakeFs(new Set(["/custom/qmd"]));
  const binary = resolveQmdBinary(
    { AGENTIC30_QMD_BIN: "/custom/qmd", PATH: "/usr/bin" },
    fsImpl,
  );

  assert.equal(binary, "/custom/qmd");
});

test("resolveQmdBinary searches PATH when no override is executable", () => {
  const qmdPath = path.join("/opt/homebrew/bin", "qmd");
  const fsImpl = fakeFs(new Set([qmdPath]));
  const binary = resolveQmdBinary(
    { AGENTIC30_QMD_BIN: "/missing/qmd", PATH: "/usr/bin:/opt/homebrew/bin" },
    fsImpl,
  );

  assert.equal(binary, qmdPath);
});

test("resolveQmdBinary prefers bundled qmd before stale PATH binaries", () => {
  const bundledQmd = "/app/sidecar/node_modules/@tobilu/qmd/bin/qmd";
  const stalePathQmd = "/Users/tester/.cargo/bin/qmd";
  const fsImpl = fakeFs(new Set([bundledQmd, stalePathQmd]));
  const info = resolveQmdBinaryInfo(
    { PATH: "/Users/tester/.cargo/bin" },
    fsImpl,
    { sidecarRoot: "/app/sidecar" },
  );

  assert.deepEqual(info, {
    binaryPath: bundledQmd,
    source: "bundled",
  });
  assert.equal(
    resolveQmdBinary({ PATH: "/Users/tester/.cargo/bin" }, fsImpl, { sidecarRoot: "/app/sidecar" }),
    bundledQmd,
  );
});

test("buildQmdMcpConfig returns qmd mcp server when available", () => {
  const fsImpl = fakeFs(new Set(["/usr/local/bin/qmd"]));
  const config = buildQmdMcpConfig({
    env: { PATH: "/usr/local/bin" },
    fsImpl,
    runner: fakeRunner(),
  });

  assert.deepEqual(config, {
    qmd: {
      command: "/usr/local/bin/qmd",
      args: ["--index", "agentic30", "mcp"],
    },
  });
});

test("buildQmdMcpConfig passes a named index when configured", () => {
  const fsImpl = fakeFs(new Set(["/usr/local/bin/qmd"]));
  const config = buildQmdMcpConfig({
    env: { PATH: "/usr/local/bin", AGENTIC30_QMD_INDEX: "agentic30" },
    fsImpl,
    runner: fakeRunner(),
  });
  const state = getQmdState({
    env: { PATH: "/usr/local/bin", AGENTIC30_QMD_INDEX: "agentic30" },
    fsImpl,
    runner: fakeRunner(),
  });

  assert.deepEqual(config, {
    qmd: {
      command: "/usr/local/bin/qmd",
      args: ["--index", "agentic30", "mcp"],
    },
  });
  assert.equal(state.index, "agentic30");
});

test("buildQmdMcpConfig uses bundled qmd when present", () => {
  const bundledQmd = "/app/sidecar/node_modules/@tobilu/qmd/bin/qmd";
  const fsImpl = fakeFs(new Set([bundledQmd]));
  const config = buildQmdMcpConfig({
    env: { PATH: "/usr/bin" },
    fsImpl,
    runner: fakeRunner(),
    sidecarRoot: "/app/sidecar",
  });
  const state = getQmdState({
    env: { PATH: "/usr/bin" },
    fsImpl,
    runner: fakeRunner(),
    sidecarRoot: "/app/sidecar",
  });

  assert.deepEqual(config, {
    qmd: {
      command: bundledQmd,
      args: ["--index", "agentic30", "mcp"],
    },
  });
  assert.equal(state.index, "agentic30");
  assert.equal(state.source, "bundled");
  assert.equal(state.available, true);
});

test("getQmdState reports missing qmd while guidance keeps fallback tools", () => {
  const fsImpl = fakeFs();
  const state = getQmdState({ env: { PATH: "/usr/bin" }, fsImpl });
  const guidance = buildQmdGuidance("/workspace", { env: { PATH: "/usr/bin" }, fsImpl });

  assert.equal(state.available, false);
  assert.equal(state.binaryPath, null);
  assert.match(guidance, /QMD MCP is not connected/);
  assert.match(guidance, /read_project_doc/);
  assert.match(guidance, /gws_docs_read/);
  assert.match(guidance, /gws_sheets_read/);
  assert.match(guidance, /working MEMORY/);
});

test("buildQmdGuidance includes Agentic30 advice sources", () => {
  const fsImpl = fakeFs(new Set(["/usr/bin/qmd"]));
  const guidance = buildQmdGuidance("/workspace", {
    env: { PATH: "/usr/bin" },
    fsImpl,
    runner: fakeRunner(),
  });

  assert.match(guidance, /docs\/ICP\.md/);
  assert.match(guidance, /docs\/VALUES\.md/);
  assert.match(guidance, /working MEMORY/);
  assert.match(guidance, /diagnosis/);
});

test("buildQmdMemorySourceSummary includes configured project docs and external memory sources", () => {
  const bipConfig = JSON.stringify({
    workspace: {
      root: "/project",
      icp: "docs/ICP.md",
      spec: "docs/SPEC.md",
      goal: "docs/GOAL.md",
    },
    externalDocs: {
      googleDocs: ["https://docs.google.com/document/d/doc-id/edit"],
      googleSheets: ["https://docs.google.com/spreadsheets/d/sheet-id/edit"],
      notion: [],
    },
  });
  const fsImpl = fakeFs(
    new Set(),
    new Map([
      ["/workspace/docs/ICP.md", "# ICP"],
      ["/workspace/docs/VALUES.md", "# VALUES"],
      ["/app-support/bip-config.json", bipConfig],
    ]),
  );
  const summary = buildQmdMemorySourceSummary("/workspace", {
    appSupportPath: "/app-support",
    fsImpl,
  });

  assert.match(summary, /ICP: docs\/ICP\.md/);
  assert.match(summary, /VALUES: docs\/VALUES\.md/);
  assert.match(summary, /Project workspace: \/project/);
  assert.match(summary, /Google Doc: https:\/\/docs\.google\.com\/document/);
  assert.match(summary, /Google Sheet: https:\/\/docs\.google\.com\/spreadsheets/);
  assert.match(summary, /qmd-memory\/google-workspace/);
});

test("buildQmdBootstrapCollections includes workspace, app docs, and GWS snapshots", () => {
  const fsImpl = fakeFs(
    new Set(),
    new Map(),
    new Set([
      "/workspace/docs",
      "/app/docs",
      "/app-support/qmd-memory/google-workspace",
    ]),
  );
  const collections = buildQmdBootstrapCollections({
    workspaceRoot: "/workspace",
    appSupportPath: "/app-support",
    sidecarRoot: "/app/sidecar",
    fsImpl,
  });

  assert.equal(collections.length, 3);
  assert.equal(collections[0].path, "/workspace/docs");
  assert.match(collections[0].name, /^agentic30-workspace-docs-/);
  assert.equal(collections[1].path, "/app/docs");
  assert.match(collections[1].name, /^agentic30-mac-docs-/);
  assert.equal(collections[2].name, "agentic30-gws-memory");
});

test("ensureQmdMemoryCollections adds sources and refreshes the QMD index", () => {
  const qmd = "/app/sidecar/node_modules/@tobilu/qmd/bin/qmd";
  const calls = [];
  const fsImpl = fakeFs(
    new Set([qmd]),
    new Map(),
    new Set(["/workspace/docs"]),
  );
  const result = ensureQmdMemoryCollections({
    workspaceRoot: "/workspace",
    sidecarRoot: "/app/sidecar",
    env: { PATH: "/usr/bin" },
    fsImpl,
    runner: recordingRunner(calls),
  });

  assert.equal(result.attempted, true);
  assert.equal(result.updated, true);
  assert.equal(result.collections.length, 1);
  assert.deepEqual(calls[0], [qmd, ["mcp", "--help"]]);
  assert.deepEqual(calls.at(-1), [qmd, ["--index", "agentic30", "update"]]);
  assert.ok(calls.some(([, args]) =>
    args[0] === "--index"
      && args[1] === "agentic30"
      && args[2] === "collection"
      && args[3] === "add"
  ));
});

test("buildQmdMcpConfig refuses qmd builds without mcp support", () => {
  const fsImpl = fakeFs(new Set(["/usr/bin/qmd"]));
  const runner = fakeRunner({
    status: 2,
    stdout: "error: unrecognized subcommand 'mcp'",
  });
  const config = buildQmdMcpConfig({
    env: { PATH: "/usr/bin" },
    fsImpl,
    runner,
  });
  const state = getQmdState({
    env: { PATH: "/usr/bin" },
    fsImpl,
    runner,
  });
  const guidance = buildQmdGuidance("/workspace", {
    env: { PATH: "/usr/bin" },
    fsImpl,
    runner,
  });

  assert.deepEqual(config, {});
  assert.equal(state.available, false);
  assert.equal(state.mcpSupported, false);
  assert.match(guidance, /does not support `qmd mcp`/);
  assert.match(guidance, /read_project_doc/);
  assert.match(guidance, /gws_docs_read/);
});
