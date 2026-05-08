#!/usr/bin/env node
// Alignment leak detector.
//
// Scans public files for keywords loaded from a gitignored config:
//   docs/private/alignment/leak-config.json
//
// Setup + schema + behavior reference:
//   docs/private/alignment/LEAK-CONFIG.md (gitignored).
//
// Output never echoes the matched text. Each hit is reported as
//   `<path>:<line> keyword_len=<NN> class=<redaction_class>`
// so the lint itself cannot become a leak surface (Codex review note).
//
// Exit codes:
//   0 — clean (or config missing → silent skip so public CI does not break)
//   1 — at least one keyword hit
//   2 — internal error (config invalid, IO error)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(
  REPO_ROOT,
  "docs",
  "private",
  "alignment",
  "leak-config.json",
);

const DEFAULT_SCAN_DIRS = ["docs", "sidecar", "scripts", "agentic30"];

const EXCLUDED_PREFIXES = [
  "docs/private/",
  "docs/_private/",
  "docs/october-academy/",
  "node_modules/",
  ".git/",
  "sidecar/vendor/",
  "sidecar-build/",
  "sidecar-tests/fixtures/",
];

const EXCLUDED_FILE_NAMES = new Set([
  "SOUL.md",
  "mandal-art.md",
  "leak-config.json",
]);

const ALLOWED_EXT = new Set([".md", ".mjs", ".js", ".ts", ".json", ".swift"]);

// Cap on file size for the multiline regex pass. The trusted-config posture
// still leaves room for catastrophic backtracking on a giant file (Codex LOW
// review). Per-line scanning is unaffected because each line is short.
const MULTILINE_MAX_BYTES = 1024 * 1024;

// Distinguishes config-not-present (silent skip → return null) from config
// present but unusable (parse error / shape error / bad regex). The latter
// must throw so the script exits 2 and CI fails closed (Codex MEDIUM review:
// silent skip on malformed config defeats the leak gate).
async function loadConfig(configPath) {
  let raw;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `alignment-leak: config at ${configPath} is not valid JSON: ${err.message}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`alignment-leak: config at ${configPath} is not an object`);
  }
  if (!Array.isArray(parsed.keywords)) {
    // Treated as missing (matches existing test contract): a config file with
    // no `keywords` array is indistinguishable from "scan not configured."
    return null;
  }
  // Pre-validate every keyword entry. Each must be either a literal string
  // or a compilable regex. Throw on the first malformed entry — failing
  // closed beats silently skipping.
  for (let i = 0; i < parsed.keywords.length; i++) {
    const kw = parsed.keywords[i];
    if (!kw || typeof kw !== "object") {
      throw new Error(
        `alignment-leak: keywords[${i}] at ${configPath} is not an object`,
      );
    }
    const hasLiteral = typeof kw.literal === "string" && kw.literal.length > 0;
    const hasPattern = typeof kw.pattern === "string" && kw.pattern.length > 0;
    if (!hasLiteral && !hasPattern) {
      throw new Error(
        `alignment-leak: keywords[${i}] at ${configPath} needs literal or pattern`,
      );
    }
    if (hasPattern) {
      try {
        kw._compiledRegex = new RegExp(kw.pattern, kw.flags || "");
      } catch (err) {
        throw new Error(
          `alignment-leak: keywords[${i}].pattern at ${configPath} is not a valid regex: ${err.message}`,
        );
      }
    }
    // Pre-normalize literals once so the per-line scan stays cheap and the
    // file content can also be compared NFC-normalized below.
    if (hasLiteral) {
      kw._normalizedLiteral = kw.literal.normalize("NFC");
    }
  }
  return parsed;
}

async function* walk(dir, repoRoot) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full);
    if (EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    if (EXCLUDED_FILE_NAMES.has(entry.name)) continue;
    if (entry.isDirectory()) {
      yield* walk(full, repoRoot);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ALLOWED_EXT.has(ext)) yield full;
    }
  }
}

function findHitsInLine(line, keywords) {
  const hits = [];
  for (const kw of keywords) {
    if (kw.multiline === true) continue; // multiline scan handled at file scope
    const klass = kw.class || "other";
    if (kw._normalizedLiteral) {
      const idx = line.indexOf(kw._normalizedLiteral);
      if (idx >= 0) {
        hits.push({ keyword_len: kw._normalizedLiteral.length, class: klass });
        continue;
      }
    }
    if (kw._compiledRegex) {
      const match = line.match(kw._compiledRegex);
      if (match && match[0]) {
        hits.push({ keyword_len: match[0].length, class: klass });
      }
    }
  }
  return hits;
}

function findMultilineHits(content, keywords) {
  // Multiline keywords scan the entire normalized content. Line numbers are
  // recovered from the match index for the operator-facing report.
  const hits = [];
  for (const kw of keywords) {
    if (kw.multiline !== true || !kw._compiledRegex) continue;
    const klass = kw.class || "other";
    const match = content.match(kw._compiledRegex);
    if (match && match[0]) {
      const line = content.slice(0, match.index ?? 0).split("\n").length;
      hits.push({ keyword_len: match[0].length, class: klass, line });
    }
  }
  return hits;
}

export async function runCheckAlignmentLeak({
  repoRoot = REPO_ROOT,
  configPath = CONFIG_PATH,
  scanDirs = DEFAULT_SCAN_DIRS,
  log = (msg) => console.log(msg),
  warn = (msg) => console.warn(msg),
} = {}) {
  const config = await loadConfig(configPath);
  if (!config) {
    log(
      `alignment-leak: config not present at ${path.relative(repoRoot, configPath)}, skipping`,
    );
    return { exitCode: 0, hits: [] };
  }
  const allHits = [];
  for (const dirName of scanDirs) {
    const dirPath = path.join(repoRoot, dirName);
    for await (const filePath of walk(dirPath, repoRoot)) {
      let content;
      try {
        content = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }
      // NFC-normalize once so canonically-equivalent Unicode sequences (e.g.
      // precomposed vs decomposed Hangul or Latin diacritics) compare equal
      // against the pre-normalized literals.
      const normalized = content.normalize("NFC");
      const lines = normalized.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const lineHits = findHitsInLine(lines[i], config.keywords);
        for (const hit of lineHits) {
          allHits.push({
            path: path.relative(repoRoot, filePath),
            line: i + 1,
            keyword_len: hit.keyword_len,
            class: hit.class,
          });
        }
      }
      if (Buffer.byteLength(normalized, "utf8") <= MULTILINE_MAX_BYTES) {
        const multilineHits = findMultilineHits(normalized, config.keywords);
        for (const hit of multilineHits) {
          allHits.push({
            path: path.relative(repoRoot, filePath),
            line: hit.line,
            keyword_len: hit.keyword_len,
            class: hit.class,
          });
        }
      } else {
        warn(
          `alignment-leak: skipping multiline scan for ${path.relative(repoRoot, filePath)} (size > ${MULTILINE_MAX_BYTES} bytes)`,
        );
      }
    }
  }
  if (allHits.length === 0) {
    return { exitCode: 0, hits: [] };
  }
  warn(`alignment-leak: ${allHits.length} potential leak hit(s)`);
  for (const hit of allHits) {
    warn(`  ${hit.path}:${hit.line} keyword_len=${hit.keyword_len} class=${hit.class}`);
  }
  return { exitCode: 1, hits: allHits };
}

const invokedAsScript =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedAsScript) {
  try {
    const result = await runCheckAlignmentLeak();
    process.exit(result.exitCode);
  } catch (err) {
    console.error("alignment-leak: fatal:", err?.message || err);
    process.exit(2);
  }
}
