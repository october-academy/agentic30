import test from "node:test";
import assert from "node:assert/strict";
import {
  describeVendor,
  getVendorVersion,
  listVendoredSkills,
  specialistVendorPath,
  vendorAvailable,
} from "../sidecar/vendor-skill-loader.mjs";

test("vendor tree is available after sync:gstack run", () => {
  assert.equal(vendorAvailable(), true, "vendor missing — run `bun run sync:gstack`");
  const version = getVendorVersion();
  assert.ok(version);
  assert.equal(typeof version.gstackCommit, "string");
  assert.ok(version.gstackCommit.length >= 7);
  assert.ok(Array.isArray(version.skills) && version.skills.length === 9);
});

test("specialistVendorPath returns absolute paths for both providers", () => {
  for (const id of ["office-hours", "plan-ceo-review", "design-shotgun"]) {
    const claude = specialistVendorPath(id, { provider: "claude" });
    assert.equal(claude.exists, true, `claude variant missing for ${id}`);
    assert.equal(claude.skillName, id);
    assert.match(claude.skillDir, /vendor\/gstack\/claude\/skills\//);
    assert.match(claude.pluginRoot, /vendor\/gstack\/claude$/);

    const codex = specialistVendorPath(id, { provider: "codex" });
    assert.equal(codex.exists, true, `codex variant missing for ${id}`);
    assert.equal(codex.skillName, id);
    assert.match(codex.skillDir, /vendor\/gstack\/codex\//);
  }
});

test("specialistVendorPath returns exists:false for unknown skill or provider", () => {
  assert.equal(specialistVendorPath("ghost-skill", { provider: "claude" }).exists, false);
  assert.equal(specialistVendorPath("office-hours", { provider: "gemini" }).exists, false);
  assert.equal(specialistVendorPath("", { provider: "claude" }).exists, false);
  assert.equal(specialistVendorPath("office-hours").exists, false);
});

test("listVendoredSkills returns 9 skills for both providers", () => {
  const claude = listVendoredSkills("claude");
  const codex = listVendoredSkills("codex");
  assert.equal(claude.length, 9);
  assert.equal(codex.length, 9);
  assert.deepEqual(claude.sort(), codex.sort());
  assert.ok(claude.includes("office-hours"));
  assert.ok(claude.includes("design-consultation"));
});

test("describeVendor returns a human-readable status string when available", () => {
  const desc = describeVendor();
  assert.equal(desc.available, true);
  assert.match(desc.message, /gstack vendor:/);
  assert.match(desc.message, /claude=9/);
  assert.match(desc.message, /codex=9/);
  assert.equal(desc.claudeSkillCount, 9);
  assert.equal(desc.codexSkillCount, 9);
  assert.ok(desc.shortCommit && desc.shortCommit.length === 12);
});
