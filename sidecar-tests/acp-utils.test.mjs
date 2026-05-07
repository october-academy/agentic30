import test from "node:test";
import assert from "node:assert/strict";
import { ensureAbsolutePathWithinCwd, extractPromptContext, parseAgentJsonResponse } from "../sidecar/acp-utils.mjs";

test("ensureAbsolutePathWithinCwd blocks traversal outside cwd", () => {
  assert.throws(
    () => ensureAbsolutePathWithinCwd("/tmp/workspace", "/tmp/other/file.txt"),
    /outside the session cwd/,
  );
});

test("extractPromptContext collects text and file resources", () => {
  const result = extractPromptContext([
    { type: "text", text: "Please fix this file." },
    {
      type: "resource",
      resource: {
        uri: "file:///tmp/workspace/demo.md",
        mimeType: "text/markdown",
        text: "# Demo",
      },
    },
  ]);

  assert.equal(result.promptText, "Please fix this file.");
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].path, "/tmp/workspace/demo.md");
  assert.equal(result.resources[0].text, "# Demo");
});

test("parseAgentJsonResponse accepts fenced JSON and normalizes edits", () => {
  const parsed = parseAgentJsonResponse(`\`\`\`json
{"message":"done","edits":[{"path":"/tmp/workspace/demo.md","content":"# Updated"}]}
\`\`\``);

  assert.equal(parsed.message, "done");
  assert.deepEqual(parsed.edits, [
    {
      fileId: null,
      path: "/tmp/workspace/demo.md",
      content: "# Updated",
    },
  ]);
});
