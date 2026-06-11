import assert from "node:assert/strict";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "r2-upload-object.mjs");
const { resolveS3Credentials, sha256Hex } = await import(`file://${script}`);

function runDryUpload(args) {
  const result = spawnSync(process.execPath, [script, "--dry-run", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/\{.*\}/s);
  assert.ok(match, result.stdout);
  return JSON.parse(match[0]);
}

test("r2 upload dry-run selects multipart for large DMGs and preserves metadata", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agentic30-r2-upload-test-"));
  try {
    const file = path.join(dir, "agentic30-18-arm64.dmg");
    writeFileSync(file, "");
    truncateSync(file, 314 * 1024 * 1024);
    const summary = runDryUpload([
      "--file",
      file,
      "--bucket",
      "agentic30-sparkle",
      "--key",
      "agentic30-18-arm64.dmg",
      "--content-type",
      "application/x-apple-diskimage",
      "--cache-control",
      "public, max-age=31536000, immutable",
    ]);

    assert.equal(summary.mode, "multipart");
    assert.equal(summary.bucket, "agentic30-sparkle");
    assert.equal(summary.key, "agentic30-18-arm64.dmg");
    assert.equal(summary.contentType, "application/x-apple-diskimage");
    assert.equal(summary.cacheControl, "public, max-age=31536000, immutable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("r2 upload dry-run leaves small appcast objects on single put", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "agentic30-r2-upload-test-"));
  try {
    const file = path.join(dir, "appcast.xml");
    writeFileSync(file, "<rss></rss>\n");
    const summary = runDryUpload([
      "--file",
      file,
      "--bucket",
      "agentic30-sparkle",
      "--key",
      "appcast.xml",
      "--content-type",
      "application/xml",
      "--cache-control",
      "public, max-age=0, must-revalidate",
    ]);

    assert.equal(summary.mode, "single-put");
    assert.equal(summary.contentType, "application/xml");
    assert.equal(summary.cacheControl, "public, max-age=0, must-revalidate");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("r2 credentials prefer explicit S3 keys", async () => {
  let fetched = false;
  const credentials = await resolveS3Credentials({
    env: {
      R2_ACCESS_KEY_ID: "explicit-id",
      R2_SECRET_ACCESS_KEY: "explicit-secret",
      CLOUDFLARE_API_TOKEN: "cf-token",
    },
    fetchImpl: async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    },
  });

  assert.deepEqual(credentials, {
    accessKeyId: "explicit-id",
    secretAccessKey: "explicit-secret",
  });
  assert.equal(fetched, false);
});

test("r2 credentials derive S3 keys from Cloudflare API token", async () => {
  const credentials = await resolveS3Credentials({
    env: {
      CLOUDFLARE_API_TOKEN: "cf-token-value",
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/user/tokens/verify");
      assert.equal(options.headers.Authorization, "Bearer cf-token-value");
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: { id: "token-id" },
        }),
      };
    },
  });

  assert.deepEqual(credentials, {
    accessKeyId: "token-id",
    secretAccessKey: sha256Hex("cf-token-value"),
  });
});

test("r2 credentials fail closed without S3 keys or Cloudflare API token", async () => {
  await assert.rejects(
    () =>
      resolveS3Credentials({
        env: {},
        fetchImpl: async () => {
          throw new Error("unexpected fetch");
        },
      }),
    /R2_ACCESS_KEY_ID\/R2_SECRET_ACCESS_KEY or CLOUDFLARE_API_TOKEN is required/
  );
});
