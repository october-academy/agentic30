import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  formatGwsMarkdown,
  persistGwsReadToMemory,
} from "../sidecar/gws-memory.mjs";

test("formats Google Doc payload as markdown memory", () => {
  const markdown = formatGwsMarkdown({
    kind: "doc",
    id: "doc123",
    now: () => new Date("2026-04-25T00:00:00Z"),
    payload: {
      title: "업무일지",
      body: {
        content: [
          {
            paragraph: {
              elements: [
                { textRun: { content: "오늘은 QMD MEMORY를 붙였다.\n" } },
              ],
            },
          },
        ],
      },
    },
  });

  assert.match(markdown, /source: google-docs/);
  assert.match(markdown, /document_id: "doc123"/);
  assert.match(markdown, /# 업무일지/);
  assert.match(markdown, /오늘은 QMD MEMORY를 붙였다/);
});

test("formats Google Sheet values as a markdown table", () => {
  const markdown = formatGwsMarkdown({
    kind: "sheet",
    id: "sheet123",
    range: "'@october.ai'!A:I",
    now: () => new Date("2026-04-25T00:00:00Z"),
    payload: {
      range: "'@october.ai'!A:I",
      values: [
        ["날짜", "게시물"],
        ["2026-04-25", "QMD 저장"],
      ],
    },
  });

  assert.match(markdown, /source: google-sheets/);
  assert.match(markdown, /spreadsheet_id: "sheet123"/);
  assert.match(markdown, /range: "'@october.ai'!A:I"/);
  assert.match(markdown, /\| 날짜 \| 게시물 \|/);
  assert.match(markdown, /\| 2026-04-25 \| QMD 저장 \|/);
});

test("persists GWS memory only when content hash changes and updates QMD", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gws-memory-"));
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: "ok", stderr: "" };
  };
  const env = {
    PATH: "/usr/bin",
    AGENTIC30_QMD_BIN: process.execPath,
  };
  const payload = {
    title: "업무일지",
    body: {
      content: [
        {
          paragraph: {
            elements: [{ textRun: { content: "첫 내용" } }],
          },
        },
      ],
    },
  };

  const first = await persistGwsReadToMemory({
    appSupportPath,
    kind: "doc",
    id: "doc123",
    payload,
    env,
    runner,
    now: () => new Date("2026-04-25T00:00:00Z"),
  });
  const second = await persistGwsReadToMemory({
    appSupportPath,
    kind: "doc",
    id: "doc123",
    payload,
    env,
    runner,
    now: () => new Date("2026-04-25T00:00:00Z"),
  });
  const changed = await persistGwsReadToMemory({
    appSupportPath,
    kind: "doc",
    id: "doc123",
    payload: {
      ...payload,
      body: {
        content: [
          {
            paragraph: {
              elements: [{ textRun: { content: "바뀐 내용" } }],
            },
          },
        ],
      },
    },
    env,
    runner,
    now: () => new Date("2026-04-25T00:00:00Z"),
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(changed.changed, true);
  const saved = await fs.readFile(first.filePath, "utf8");
  assert.match(saved, /agentic30:gws-memory sha256=/);
  assert.match(saved, /바뀐 내용/);
  assert.ok(calls.some(([, args]) => args.includes("collection")));
  assert.ok(calls.some(([, args]) => args.includes("update")));
  assert.ok(calls.some(([, args]) =>
    args[0] === "--index" && args[1] === "agentic30" && args.includes("collection")
  ));
  assert.ok(calls.some(([, args]) =>
    args[0] === "--index" && args[1] === "agentic30" && args.includes("update")
  ));
});
