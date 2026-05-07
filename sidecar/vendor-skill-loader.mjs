/**
 * Resolves filesystem paths and metadata for vendored gstack skills.
 *
 * Layout produced by `bun run sync:gstack`:
 *   sidecar/vendor/gstack/
 *     VERSION.json
 *     claude/                <- single Claude SDK plugin (entire tree)
 *       .claude-plugin/plugin.json
 *       skills/<name>/SKILL.md
 *     codex/                 <- per-skill directories for Codex `skills.config[].path`
 *       <name>/SKILL.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_ROOT = path.join(__dirname, "vendor", "gstack");
const CLAUDE_PLUGIN_ROOT = path.join(VENDOR_ROOT, "claude");
const CLAUDE_SKILLS_ROOT = path.join(CLAUDE_PLUGIN_ROOT, "skills");
const CODEX_SKILLS_ROOT = path.join(VENDOR_ROOT, "codex");
const VERSION_FILE = path.join(VENDOR_ROOT, "VERSION.json");

let cachedVersion = null;

export function getVendorRoot() {
  return VENDOR_ROOT;
}

export function getVendorVersion() {
  if (cachedVersion !== null) return cachedVersion;
  try {
    cachedVersion = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
    return cachedVersion;
  } catch {
    cachedVersion = null;
    return null;
  }
}

export function vendorAvailable() {
  return getVendorVersion() !== null;
}

export function specialistVendorPath(specialistId, { provider } = {}) {
  if (!specialistId || typeof specialistId !== "string") return { exists: false };
  if (provider !== "claude" && provider !== "codex") return { exists: false };

  if (provider === "claude") {
    const skillDir = path.join(CLAUDE_SKILLS_ROOT, specialistId);
    if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) return { exists: false };
    return {
      exists: true,
      provider,
      pluginRoot: CLAUDE_PLUGIN_ROOT,
      skillDir,
      skillName: specialistId,
    };
  }

  const skillDir = path.join(CODEX_SKILLS_ROOT, specialistId);
  if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) return { exists: false };
  return {
    exists: true,
    provider,
    skillDir,
    skillName: specialistId,
  };
}

export function listVendoredSkills(provider = "claude") {
  const root = provider === "codex" ? CODEX_SKILLS_ROOT : CLAUDE_SKILLS_ROOT;
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

export function describeVendor() {
  const version = getVendorVersion();
  if (!version) {
    return { available: false, message: "gstack vendor missing — using inline fallback" };
  }
  const claudeCount = listVendoredSkills("claude").length;
  const codexCount = listVendoredSkills("codex").length;
  const shortCommit = String(version.gstackCommit || "").slice(0, 12) || "unknown";
  return {
    available: true,
    commit: version.gstackCommit,
    shortCommit,
    fetchedAt: version.fetchedAt,
    claudeSkillCount: claudeCount,
    codexSkillCount: codexCount,
    message: `gstack vendor: ${shortCommit} · claude=${claudeCount} codex=${codexCount} skills · synced ${version.fetchedAt}`,
  };
}

export function _resetCacheForTests() {
  cachedVersion = null;
}
