import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const humanizeSkillRoot = path.join(repoRoot, "sidecar", "skills", "humanize-korean");

test("sidecar bundles the upstream humanize-korean skill as real files", async () => {
  const skill = await fs.readFile(path.join(humanizeSkillRoot, "SKILL.md"), "utf8");
  const quickRules = await fs.readFile(path.join(humanizeSkillRoot, "references", "quick-rules.md"), "utf8");
  const playbook = await fs.readFile(path.join(humanizeSkillRoot, "references", "rewriting-playbook.md"), "utf8");
  const referencesStat = await fs.lstat(path.join(humanizeSkillRoot, "references"));

  assert.match(skill, /name:\s*humanize-korean/);
  assert.match(skill, /references\/quick-rules\.md/);
  assert.match(quickRules, /Quick Rules/);
  assert.match(playbook, /윤문/);
  assert.equal(referencesStat.isSymbolicLink(), false);
});
