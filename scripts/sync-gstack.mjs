#!/usr/bin/env node
/**
 * Sync gstack into sidecar/vendor/gstack at the commit pinned in
 * scripts/gstack-pin.json. Patches each SKILL.md to silence telemetry/GBrain
 * and produces both Claude (plugin tree) and Codex (skill-per-dir tree)
 * variants.
 *
 * Usage: bun run sync:gstack    (or  node scripts/sync-gstack.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { patchSkill } from "./patch-gstack-skill.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const VENDOR_ROOT = path.join(PACKAGE_ROOT, "sidecar", "vendor", "gstack");
const PIN_FILE = path.join(__dirname, "gstack-pin.json");

const SKILLS = [
  "office-hours",
  "plan-ceo-review",
  "design-shotgun",
  "design-html",
  "plan-devex-review",
  "devex-review",
  "design-review",
  "plan-design-review",
  "design-consultation",
];

async function main() {
  const pin = JSON.parse(fs.readFileSync(PIN_FILE, "utf8"));
  if (!pin.commit) {
    throw new Error("gstack-pin.json must include a commit hash");
  }
  const repoUrl = `https://github.com/${pin.repo || "garrytan/gstack"}.git`;
  const commit = pin.commit;
  const shortCommit = commit.slice(0, 12);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentic30-gstack-"));
  console.log(`[sync] cloning ${repoUrl} into ${tmpRoot}`);
  try {
    execFileSync("git", ["clone", "--quiet", repoUrl, tmpRoot], { stdio: "inherit" });
    execFileSync("git", ["checkout", "--quiet", commit], { cwd: tmpRoot, stdio: "inherit" });

    fs.rmSync(VENDOR_ROOT, { recursive: true, force: true });
    fs.mkdirSync(VENDOR_ROOT, { recursive: true });

    const claudePluginRoot = path.join(VENDOR_ROOT, "claude");
    const claudeSkillsRoot = path.join(claudePluginRoot, "skills");
    const codexRoot = path.join(VENDOR_ROOT, "codex");
    fs.mkdirSync(claudeSkillsRoot, { recursive: true });
    fs.mkdirSync(codexRoot, { recursive: true });

    const synced = [];
    for (const name of SKILLS) {
      const sourceDir = path.join(tmpRoot, name);
      const sourceSkill = path.join(sourceDir, "SKILL.md");
      if (!fs.existsSync(sourceSkill)) {
        throw new Error(`gstack source missing skill at ${sourceSkill}`);
      }
      const original = fs.readFileSync(sourceSkill, "utf8");

      const claudePatched = patchSkill(original, { provider: "claude", vendorVersion: shortCommit });
      const claudeDir = path.join(claudeSkillsRoot, name);
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, "SKILL.md"), claudePatched);

      const codexPatched = patchSkill(original, { provider: "codex", vendorVersion: shortCommit });
      const codexDir = path.join(codexRoot, name);
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(path.join(codexDir, "SKILL.md"), codexPatched);

      const sourceVendor = path.join(sourceDir, "vendor");
      if (fs.existsSync(sourceVendor)) {
        copyTree(sourceVendor, path.join(claudeDir, "vendor"));
        copyTree(sourceVendor, path.join(codexDir, "vendor"));
      }

      synced.push(name);
      console.log(`[sync] vendored ${name} (claude+codex)`);
    }

    const pluginManifest = {
      name: "agentic30-gstack",
      version: shortCommit,
      description: "Vendored gstack skills for Agentic30 Mac IDD interview flow.",
      source: pin.repo || "garrytan/gstack",
      commit,
    };
    const pluginManifestDir = path.join(claudePluginRoot, ".claude-plugin");
    fs.mkdirSync(pluginManifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginManifestDir, "plugin.json"),
      JSON.stringify(pluginManifest, null, 2) + "\n",
    );

    const version = {
      gstackCommit: commit,
      gstackTag: pin.tag || null,
      fetchedAt: new Date().toISOString(),
      skills: synced,
      patches: [
        "header-comment-strip",
        "preamble-replace-lean",
        "interactive-section-strip",
        "frontmatter-augment",
        "websearch-allowed-tools-strip",
        "tool-rename:codex (AskUserQuestion -> agentic30_request_user_input)",
      ],
    };
    fs.writeFileSync(path.join(VENDOR_ROOT, "VERSION.json"), JSON.stringify(version, null, 2) + "\n");

    console.log(`[sync] done — ${synced.length} skills × 2 variants @ ${shortCommit}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function copyTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

main().catch((error) => {
  console.error("[sync] failed:", error.message);
  process.exitCode = 1;
});
