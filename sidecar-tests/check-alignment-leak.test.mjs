import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { runCheckAlignmentLeak } from "../scripts/check-alignment-leak.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_DIR = path.join(__dirname, "fixtures/leak");

async function setupFakeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-leak-test-"));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
  return root;
}

test("config absent → exit 0 with skip message", async () => {
  const root = await setupFakeRepo();
  const messages = [];
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath: path.join(root, "leak-config.json"),
    scanDirs: ["docs"],
    log: (msg) => messages.push(msg),
    warn: (msg) => messages.push(msg),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.hits, []);
  assert.match(messages.join("\n"), /config not present/);
});

test("clean files with config present → exit 0", async () => {
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.copyFile(path.join(FIXTURE_DIR, "leak-config.json"), configPath);
  await fs.copyFile(
    path.join(FIXTURE_DIR, "sample-clean.md"),
    path.join(root, "docs/sample-clean.md"),
  );
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath,
    scanDirs: ["docs"],
    log: () => {},
    warn: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.hits, []);
});

test("hit detected → exit 1, output never echoes matched text", async () => {
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.copyFile(path.join(FIXTURE_DIR, "leak-config.json"), configPath);
  await fs.copyFile(
    path.join(FIXTURE_DIR, "sample-leak.md"),
    path.join(root, "docs/sample-leak.md"),
  );
  const messages = [];
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath,
    scanDirs: ["docs"],
    log: (msg) => messages.push(msg),
    warn: (msg) => messages.push(msg),
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.hits.length >= 2, "expected literal + regex hit");
  const combined = messages.join("\n");
  assert.equal(
    combined.includes("unit-test-secret-marker"),
    false,
    "output echoed the matched literal keyword!",
  );
  assert.equal(
    combined.includes("INVENTED_FIXTURE_PATTERN_42"),
    false,
    "output echoed the regex match!",
  );
  assert.match(combined, /docs\/sample-leak\.md:\d+ keyword_len=\d+ class=test-fixture/);
});

test("invalid config (no keywords array) → treated as missing, exit 0", async () => {
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1 }));
  const messages = [];
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath,
    scanDirs: ["docs"],
    log: (msg) => messages.push(msg),
    warn: (msg) => messages.push(msg),
  });
  assert.equal(result.exitCode, 0);
});

test("malformed JSON config → throws so script exits 2 (fail-closed)", async () => {
  // Codex MEDIUM review: silently skipping on parse error defeats the gate.
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.writeFile(configPath, "{not-valid-json", { mode: 0o600 });
  await assert.rejects(
    runCheckAlignmentLeak({
      repoRoot: root,
      configPath,
      scanDirs: ["docs"],
      log: () => {},
      warn: () => {},
    }),
    /not valid JSON/,
  );
});

test("config with invalid regex pattern → throws (fail-closed)", async () => {
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      keywords: [{ pattern: "(unbalanced", class: "test-fixture" }],
    }),
    { mode: 0o600 },
  );
  await assert.rejects(
    runCheckAlignmentLeak({
      repoRoot: root,
      configPath,
      scanDirs: ["docs"],
      log: () => {},
      warn: () => {},
    }),
    /not a valid regex/,
  );
});

test("multiline pattern crossing two lines is detected", async () => {
  // The legacy line-by-line scan would miss this.
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      keywords: [
        {
          pattern: "marker-start[\\s\\S]*?marker-end",
          flags: "",
          multiline: true,
          class: "test-fixture-multiline",
        },
      ],
    }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(root, "docs/sample-multiline.md"),
    "# Doc\n\nintro line\nmarker-start\nbody\nmarker-end\nrest\n",
  );
  const messages = [];
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath,
    scanDirs: ["docs"],
    log: (m) => messages.push(m),
    warn: (m) => messages.push(m),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].class, "test-fixture-multiline");
  // Reported line is the first line of the match (where marker-start sits).
  assert.equal(result.hits[0].line, 4);
  // Matched text must not be echoed.
  const combined = messages.join("\n");
  assert.equal(combined.includes("marker-start"), false);
  assert.equal(combined.includes("marker-end"), false);
});

test("NFC normalization makes canonically equivalent Unicode match", async () => {
  // The literal in config is precomposed Hangul; the file content uses the
  // NFD (decomposed) form. Without NFC normalization on either side the line
  // scan would miss it.
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  const literal = "비밀-마커".normalize("NFC");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      keywords: [{ literal, class: "test-fixture-nfc" }],
    }),
    { mode: 0o600 },
  );
  const decomposed = "비밀-마커".normalize("NFD");
  await fs.writeFile(
    path.join(root, "docs/sample-nfd.md"),
    `# Doc\n\nThis line has ${decomposed} embedded.\n`,
  );
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath,
    scanDirs: ["docs"],
    log: () => {},
    warn: () => {},
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].class, "test-fixture-nfc");
});

test("multiline scan is skipped for files larger than the size cap (line scan still runs)", async () => {
  // R5 / Codex LOW: a >1MB file with a backtracking-prone multiline pattern
  // could hang CI even with trusted config. The multiline pass must skip such
  // files; per-line scanning still runs.
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      keywords: [
        // Per-line literal that should still match.
        { literal: "line-marker-XYZ", class: "test-fixture-line" },
        // Multiline pattern that should be SKIPPED on the big file.
        {
          pattern: "marker-start[\\s\\S]*?marker-end",
          flags: "",
          multiline: true,
          class: "test-fixture-multiline",
        },
      ],
    }),
    { mode: 0o600 },
  );
  // Build a >1MB file that contains both the line literal and a multiline
  // marker pair. Without the cap, multiline scan would try to match across
  // the whole file; with the cap, only the line scan reports the literal.
  const filler = "x".repeat(2 * 1024 * 1024); // 2MB of filler ⇒ over cap
  const body = `# Big doc\n\nfiller ${filler}\nline-marker-XYZ\nmarker-start\nbody\nmarker-end\n`;
  await fs.writeFile(path.join(root, "docs/big.md"), body);
  const messages = [];
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath,
    scanDirs: ["docs"],
    log: (m) => messages.push(m),
    warn: (m) => messages.push(m),
  });
  assert.equal(result.exitCode, 1);
  // Only the line literal hit is reported; the multiline pattern is skipped.
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].class, "test-fixture-line");
  // A skip notice is emitted so the operator can see why the multiline
  // pattern was bypassed.
  assert.match(messages.join("\n"), /skipping multiline scan/);
});

test("excluded directories are not scanned", async () => {
  const root = await setupFakeRepo();
  const configPath = path.join(root, "leak-config.json");
  await fs.copyFile(path.join(FIXTURE_DIR, "leak-config.json"), configPath);
  // Place a leak in an excluded path; it must not be flagged.
  await fs.mkdir(path.join(root, "docs/private"), { recursive: true });
  await fs.copyFile(
    path.join(FIXTURE_DIR, "sample-leak.md"),
    path.join(root, "docs/private/should-be-ignored.md"),
  );
  const result = await runCheckAlignmentLeak({
    repoRoot: root,
    configPath,
    scanDirs: ["docs"],
    log: () => {},
    warn: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.hits, []);
});
