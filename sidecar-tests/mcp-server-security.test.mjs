import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { writeUserInputResponse } from "../sidecar/user-input.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MCP workspace file tools reject symlink escapes", async () => {
  const harness = await startMcpHarness();
  try {
    await fs.writeFile(path.join(harness.workspaceRoot, "safe.txt"), "inside workspace");
    await fs.writeFile(path.join(harness.tempRoot, "outside.txt"), "outside secret");
    await fs.symlink(
      path.join(harness.tempRoot, "outside.txt"),
      path.join(harness.workspaceRoot, "outside-link.txt"),
    );

    const safe = await harness.client.callTool({
      name: "read_workspace_file",
      arguments: { relativePath: "safe.txt", maxChars: 1000 },
    });
    assert.match(safe.content[0].text, /inside workspace/);

    const escaped = await harness.client.callTool({
      name: "read_workspace_file",
      arguments: { relativePath: "outside-link.txt", maxChars: 1000 },
    });
    assert.equal(escaped.isError, true);
    assert.match(escaped.content[0].text, /Path must stay inside the workspace root/);
    assert.doesNotMatch(escaped.content[0].text, /outside secret/);
  } finally {
    await harness.close();
  }
});

test("MCP read_project_doc rejects configured document symlink escapes", async () => {
  const harness = await startMcpHarness();
  try {
    await fs.mkdir(path.join(harness.workspaceRoot, "docs"), { recursive: true });
    await fs.mkdir(path.join(harness.workspaceRoot, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(harness.tempRoot, "outside-icp.md"), "# outside");
    await fs.symlink(
      path.join(harness.tempRoot, "outside-icp.md"),
      path.join(harness.workspaceRoot, ".agentic30", "docs", "ICP.md"),
    );
    await fs.writeFile(
      path.join(harness.appSupportPath, "bip-config.json"),
      JSON.stringify({
        workspace: {
          root: harness.workspaceRoot,
          icp: ".agentic30/docs/ICP.md",
        },
      }),
    );

    const result = await harness.client.callTool({
      name: "read_project_doc",
      arguments: { role: "icp", maxChars: 1000 },
    });
    assert.match(result.content[0].text, /Path must stay inside the BIP workspace root/);
    assert.doesNotMatch(result.content[0].text, /# outside/);
  } finally {
    await harness.close();
  }
});

test("MCP GWS tools do not expose gws_exec and require approval for Gmail send", async () => {
  const harness = await startMcpHarness({ gws: true, approvedToolExecution: true });
  try {
    const tools = await harness.client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("gws_exec"), false);
    assert.equal(toolNames.includes("gws_gmail_send"), true);

    const denied = await harness.client.callTool({
      name: "gws_gmail_send",
      arguments: {
        to: "user@example.com",
        subject: "No approval",
        body: "This should not send.",
      },
    });
    const deniedPayload = JSON.parse(denied.content[0].text);
    assert.equal(deniedPayload.ok, false);
    assert.equal(deniedPayload.cancelled, true);
    await assert.rejects(fs.stat(harness.gwsLogPath), /ENOENT/);

    const send = harness.client.callTool({
      name: "gws_gmail_send",
      arguments: {
        to: "user@example.com\r\nBcc: injected@example.com",
        cc: "copy@example.com\r\nTo: injected@example.com",
        subject: "Approved\r\nTo: injected@example.com",
        body: "Send after approval.",
      },
    });
    const request = await waitForUserInputRequest(harness.appSupportPath);
    assert.equal(request.toolName, "gws_gmail_send");
    assert.match(request.questions[0].question, /user@example\.com/);
    assert.match(request.questions[0].question, /Approved To: injected@example\.com/);
    assert.doesNotMatch(request.questions[0].question, /\nBcc: injected@example\.com/);
    assert.doesNotMatch(request.questions[0].question, /\nTo: injected@example\.com/);
    await writeUserInputResponse(harness.appSupportPath, {
      sessionId: request.sessionId,
      requestId: request.requestId,
      response: {
        responses: [
          {
            question: request.questions[0].question,
            selectedOptions: ["Approve send"],
            freeText: "",
          },
        ],
      },
    });

    const sent = await send;
    assert.match(sent.content[0].text, /fake gws ok/);
    const invocations = JSON.parse(await fs.readFile(harness.gwsLogPath, "utf8"));
    assert.deepEqual(invocations[0], [
      "gmail",
      "+send",
      "--to",
      "user@example.com Bcc: injected@example.com",
      "--subject",
      "Approved To: injected@example.com",
      "--body",
      "Send after approval.",
      "--cc",
      "copy@example.com To: injected@example.com",
    ]);
  } finally {
    await harness.close();
  }
});

test("MCP read_workspace_file refuses secret files and redacts token content", async () => {
  const harness = await startMcpHarness();
  try {
    // token-shaped strings built via concatenation so this source file does not
    // trip scripts/check-public-safety.mjs (see public-safety.test.mjs).
    const githubToken = `ghp_${"a".repeat(40)}`;
    await fs.writeFile(path.join(harness.workspaceRoot, ".env"), `SECRET=${"x".repeat(20)}\n`);
    await fs.mkdir(path.join(harness.workspaceRoot, "secrets"), { recursive: true });
    await fs.writeFile(path.join(harness.workspaceRoot, "secrets", "dev.pem"), "private\n");
    await fs.writeFile(
      path.join(harness.workspaceRoot, "notes.md"),
      `deploy token: ${githubToken}\nplain text line\n`,
    );

    const envRead = await harness.client.callTool({
      name: "read_workspace_file",
      arguments: { relativePath: ".env" },
    });
    assert.match(envRead.content[0].text, /Refused/);
    assert.doesNotMatch(envRead.content[0].text, /SECRET=/);

    const pemRead = await harness.client.callTool({
      name: "read_workspace_file",
      arguments: { relativePath: "secrets/dev.pem" },
    });
    assert.match(pemRead.content[0].text, /Refused/);

    const noteRead = await harness.client.callTool({
      name: "read_workspace_file",
      arguments: { relativePath: "notes.md" },
    });
    assert.match(noteRead.content[0].text, /plain text line/);
    assert.match(noteRead.content[0].text, /‹redacted:github-token›/);
    assert.doesNotMatch(noteRead.content[0].text, new RegExp(githubToken));
  } finally {
    await harness.close();
  }
});

test("MCP list_workspace_files hides secret entries", async () => {
  const harness = await startMcpHarness();
  try {
    await fs.writeFile(path.join(harness.workspaceRoot, ".env"), "X=1\n");
    await fs.writeFile(path.join(harness.workspaceRoot, ".env.local"), "Y=2\n");
    await fs.writeFile(path.join(harness.workspaceRoot, "auth.json"), "{}\n");
    await fs.writeFile(path.join(harness.workspaceRoot, "README.md"), "# hi\n");
    await fs.mkdir(path.join(harness.workspaceRoot, "secrets"), { recursive: true });

    const listed = await harness.client.callTool({
      name: "list_workspace_files",
      arguments: { relativePath: "." },
    });
    const payload = JSON.parse(listed.content[0].text);
    const names = payload.items.map((item) => item.name);
    assert.ok(names.includes("README.md"));
    assert.ok(!names.includes(".env"));
    assert.ok(!names.includes(".env.local"));
    assert.ok(!names.includes("auth.json"));
    assert.ok(!names.includes("secrets"));
  } finally {
    await harness.close();
  }
});

test("MCP search_workspace excludes secret files and redacts matches", async () => {
  const harness = await startMcpHarness();
  try {
    const githubToken = `ghp_${"z".repeat(40)}`;
    await fs.writeFile(path.join(harness.workspaceRoot, ".env"), `APIKEY=${githubToken}\n`);
    await fs.writeFile(
      path.join(harness.workspaceRoot, "app.ts"),
      `const t = "${githubToken}"; // findme\n`,
    );

    const result = await harness.client.callTool({
      name: "search_workspace",
      arguments: { query: "findme" },
    });
    const text = result.content[0].text;
    assert.match(text, /app\.ts/);
    assert.doesNotMatch(text, /\.env/);
    // the matched line still contains the token literal in app.ts → must be redacted
    assert.doesNotMatch(text, new RegExp(githubToken));
  } finally {
    await harness.close();
  }
});

async function startMcpHarness({ gws = false, approvedToolExecution = false } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-mcp-security-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });

  let gwsBinPath = "";
  let gwsLogPath = "";
  if (gws) {
    gwsLogPath = path.join(tempRoot, "gws-log.json");
    gwsBinPath = path.join(tempRoot, "gws");
    await fs.writeFile(
      gwsBinPath,
      [
        "#!/usr/bin/env node",
        "import fs from 'node:fs';",
        "const logPath = process.env.AGENTIC30_TEST_GWS_LOG;",
        "const previous = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];",
        "previous.push(process.argv.slice(2));",
        "fs.writeFileSync(logPath, JSON.stringify(previous));",
        "console.log('fake gws ok');",
        "",
      ].join("\n"),
    );
    await fs.chmod(gwsBinPath, 0o755);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["sidecar/mcp-server.mjs", "--session", "mcp-test-session", "--workspace", workspaceRoot],
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_APPROVED_TOOL_EXECUTION: approvedToolExecution ? "1" : "0",
      AGENTIC30_GWS_WRITE_APPROVAL_TIMEOUT_MS: "1000",
      ...(gws
        ? {
            AGENTIC30_GWS_BIN: gwsBinPath,
            AGENTIC30_TEST_GWS_LOG: gwsLogPath,
          }
        : {}),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "agentic30-test", version: "1.0.0" });
  await client.connect(transport);

  return {
    tempRoot,
    workspaceRoot,
    appSupportPath,
    gwsLogPath,
    client,
    async close() {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function waitForUserInputRequest(appSupportPath, timeoutMs = 2_000) {
  const requestsDir = path.join(appSupportPath, "user-input-requests");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const entries = await fs.readdir(requestsDir).catch(() => []);
    const json = entries.find((entry) => entry.endsWith(".json"));
    if (json) {
      return JSON.parse(await fs.readFile(path.join(requestsDir, json), "utf8"));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for user input request");
}
