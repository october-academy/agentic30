import test from "node:test";
import assert from "node:assert/strict";

import {
  buildComposeDay1CanUseTool,
  isPrivateOrMetadataUrl,
  sanitizeWebSearchQuery,
} from "../sidecar/compose-day1-opening.mjs";

const ROOT = "/Users/test/myapp";

// Stage-5 opt-in web tools. Default is OFF (stage 4 contract). When enabled,
// SSRF guards must still block private/metadata URLs and WebSearch query must
// be scrubbed of secret-shaped tokens before it leaves the host.

test("WebFetch / WebSearch are denied when enableWeb is false (default)", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT });
  const fetch = await cb("WebFetch", { url: "https://example.com" });
  const search = await cb("WebSearch", { query: "anything" });
  assert.equal(fetch.behavior, "deny");
  assert.equal(search.behavior, "deny");
  assert.match(fetch.message, /tool_not_allowed/);
});

test("WebFetch is allowed for a public URL only when enableWeb is true", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT, enableWeb: true });
  const ok = await cb("WebFetch", { url: "https://example.com" });
  assert.equal(ok.behavior, "allow");
});

test("WebFetch is denied for localhost / 127.0.0.1 / private CIDR even when enabled", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT, enableWeb: true });
  for (const url of [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://192.168.1.1/x",
    "http://10.0.0.1/x",
    "http://172.16.0.1/x",
    "http://169.254.169.254/latest/meta-data/", // EC2 metadata
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://my-host.internal/x",
  ]) {
    const verdict = await cb("WebFetch", { url });
    assert.equal(verdict.behavior, "deny", `expected ${url} to be denied`);
    assert.match(verdict.message, /url_private_or_metadata/);
  }
});

test("WebFetch is denied for non-http(s) protocols", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT, enableWeb: true });
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com",
    "gopher://example.com",
    "data:text/html,hello",
  ]) {
    const verdict = await cb("WebFetch", { url });
    assert.equal(verdict.behavior, "deny", `expected ${url} to be denied`);
  }
});

test("isPrivateOrMetadataUrl returns true for invalid URLs (fail closed)", () => {
  assert.equal(isPrivateOrMetadataUrl(""), true);
  assert.equal(isPrivateOrMetadataUrl(null), true);
  assert.equal(isPrivateOrMetadataUrl("not a url"), true);
});

test("WebSearch query is sanitized before reaching the tool", async () => {
  const seen = [];
  const cb = buildComposeDay1CanUseTool({
    workspaceRoot: ROOT,
    enableWeb: true,
    onDecision: (d) => seen.push(d),
  });
  await cb("WebSearch", {
    query: "find docs sk-ABCDEFGHIJKLMNOPQRSTUVWX about onboarding",
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].decision.allowed, true);
  // Original token must be redacted in the input the tool actually receives.
  assert.ok(!seen[0].input.query.includes("sk-ABCDEFGHIJKLMNOPQRSTUVWX"));
  assert.ok(seen[0].input.query.includes("[REDACTED_TOKEN]"));
});

test("sanitizeWebSearchQuery scrubs common secret shapes", () => {
  const cleaned = sanitizeWebSearchQuery("AKIAIOSFODNN7EXAMPLE plus AIzaSy_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.ok(!cleaned.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(!cleaned.includes("AIzaSy_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
});

test("sanitizeWebSearchQuery caps query length at 256 chars", () => {
  const cleaned = sanitizeWebSearchQuery("x".repeat(1000));
  assert.equal(cleaned.length, 256);
});

// PR3 (P1b): IPv6 / trailing-dot SSRF gaps closed.
test("WebFetch denies IPv4-mapped IPv6 localhost ([::ffff:127.0.0.1])", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT, enableWeb: true });
  const verdict = await cb("WebFetch", { url: "http://[::ffff:127.0.0.1]/x" });
  assert.equal(verdict.behavior, "deny");
  assert.match(verdict.message, /url_private_or_metadata/);
});

test("WebFetch denies trailing-dot localhost (localhost.)", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT, enableWeb: true });
  const verdict = await cb("WebFetch", { url: "http://localhost./x" });
  assert.equal(verdict.behavior, "deny");
});

test("isPrivateOrMetadataUrl handles IPv4-mapped IPv6 in raw helper", () => {
  assert.equal(isPrivateOrMetadataUrl("http://[::ffff:10.0.0.5]/api"), true);
  assert.equal(isPrivateOrMetadataUrl("http://[::ffff:192.168.0.10]:8080/"), true);
});

test("Bash / Edit / Write stay denied even with enableWeb=true", async () => {
  const cb = buildComposeDay1CanUseTool({ workspaceRoot: ROOT, enableWeb: true });
  for (const tool of ["Bash", "Edit", "Write", "Task"]) {
    const verdict = await cb(tool, { file_path: ROOT + "/x.ts" });
    assert.equal(verdict.behavior, "deny", `${tool} must be denied even with web enabled`);
  }
});
