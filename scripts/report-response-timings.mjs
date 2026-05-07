#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appSupportPath = process.env.AGENTIC30_APP_SUPPORT_PATH
  ? path.resolve(process.env.AGENTIC30_APP_SUPPORT_PATH)
  : path.join(os.homedir(), "Library", "Application Support", "agentic30");
const sessionsPath = process.argv[2] || path.join(appSupportPath, "sessions.json");

const payload = JSON.parse(await fs.readFile(sessionsPath, "utf8"));
const messages = (payload.sessions || [])
  .flatMap((session) => (session.messages || []).map((message) => ({ session, message })))
  .filter(({ message }) => message.role === "assistant" && message.performance?.marks?.length);

const groups = new Map();
for (const { message } of messages) {
  const marks = message.performance.marks;
  const route = marks.find((mark) => mark.phase === "route.classified")?.details?.executionMode || "unknown";
  add(groups, `${route}.total`, message.performance.totalMs);
  for (const mark of marks) {
    add(groups, `${route}.${mark.phase}`, mark.elapsedMs);
  }
}

if (groups.size === 0) {
  console.log(`No response timing marks found in ${sessionsPath}`);
  process.exit(0);
}

console.log(`Response timing report: ${sessionsPath}`);
console.log("phase,count,p50_ms,p95_ms,max_ms");
for (const [phase, values] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  values.sort((a, b) => a - b);
  console.log([
    phase,
    values.length,
    percentile(values, 0.5),
    percentile(values, 0.95),
    values.at(-1),
  ].join(","));
}

function add(groups, key, value) {
  if (!Number.isFinite(value)) return;
  const values = groups.get(key) || [];
  values.push(value);
  groups.set(key, values);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index];
}
