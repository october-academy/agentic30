#!/usr/bin/env node
import crypto from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const API_BASE = "https://api.appstoreconnect.apple.com/v1";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";

main().catch((err) => {
  console.error(`[asc-xcode-cloud-release] ${err.message}`);
  process.exit(1);
});

async function main() {
  if (command === "help" || args.help) {
    usage();
    return;
  }

  if (command === "wait-and-download") {
    const run = await waitForBuildRun();
    await downloadArtifacts(run.id);
    return;
  }
  if (command === "wait") {
    const run = await waitForBuildRun();
    printJson({ buildRunId: run.id, attributes: run.attributes });
    return;
  }
  if (command === "download") {
    const buildRunId = stringArg("build-run-id");
    await downloadArtifacts(buildRunId);
    return;
  }
  if (command === "start") {
    const run = await startBuildRun();
    printJson({ buildRunId: run.id, attributes: run.attributes });
    return;
  }
  if (command === "list-workflows") {
    await listWorkflows();
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

async function waitForBuildRun() {
  const workflowId = stringArg("workflow-id", process.env.XCODE_CLOUD_WORKFLOW_ID);
  const commit = args.commit || process.env.GITHUB_SHA || "";
  const refName = args["ref-name"] || process.env.GITHUB_REF_NAME || "";
  const gitRef = args["git-ref"] || process.env.GITHUB_REF || "";
  const timeoutSeconds = Number(args.timeout || process.env.XCODE_CLOUD_TIMEOUT_SECONDS || 7200);
  const pollSeconds = Number(args.poll || process.env.XCODE_CLOUD_POLL_SECONDS || 30);
  const deadline = Date.now() + timeoutSeconds * 1000;

  let lastSeen = null;
  while (Date.now() < deadline) {
    const runs = await listWorkflowBuildRuns(workflowId);
    const match = runs.find((run) => matchesRun(run, { commit, refName, gitRef }));
    if (match) {
      lastSeen = match;
      const attrs = match.attributes || {};
      const completion = attrs.completionStatus || "";
      const progress = attrs.executionProgress || "";
      console.log(`Xcode Cloud build ${match.id}: progress=${progress || "-"} completion=${completion || "-"}`);
      if (completion === "SUCCEEDED") {
        return match;
      }
      if (["FAILED", "ERRORED", "CANCELED", "SKIPPED"].includes(completion)) {
        throw new Error(`Xcode Cloud build ${match.id} completed with ${completion}`);
      }
    } else {
      console.log(`Waiting for Xcode Cloud build: workflow=${workflowId} ref=${gitRef || refName || "-"} commit=${commit || "-"}`);
    }
    await sleep(pollSeconds * 1000);
  }

  throw new Error(
    `timed out waiting for Xcode Cloud build; last seen=${lastSeen?.id || "none"}`
  );
}

async function listWorkflowBuildRuns(workflowId) {
  const json = await ascRequest(
    `/ciWorkflows/${encodeURIComponent(workflowId)}/buildRuns?` +
      new URLSearchParams({
        limit: "20",
        sort: "-number",
        include: "sourceBranchOrTag",
        "fields[ciBuildRuns]": "number,createdDate,startedDate,finishedDate,sourceCommit,executionProgress,completionStatus,sourceBranchOrTag",
        "fields[scmGitReferences]": "name,canonicalName,kind",
      })
  );
  return json.data || [];
}

function matchesRun(run, expected) {
  const attrs = run.attributes || {};
  const sourceCommit = attrs.sourceCommit?.commitSha || "";
  if (expected.commit && sourceCommit && sourceCommit !== expected.commit) {
    return false;
  }

  const ref = attrs.sourceBranchOrTag || {};
  const refName = ref.name || "";
  const canonicalName = ref.canonicalName || "";
  if (expected.gitRef && canonicalName && canonicalName !== expected.gitRef) {
    return false;
  }
  if (expected.refName && refName && refName !== expected.refName) {
    return false;
  }

  return Boolean(expected.commit || expected.refName || expected.gitRef);
}

async function startBuildRun() {
  const workflowId = stringArg("workflow-id", process.env.XCODE_CLOUD_WORKFLOW_ID);
  const body = {
    data: {
      type: "ciBuildRuns",
      relationships: {
        workflow: {
          data: {
            type: "ciWorkflows",
            id: workflowId,
          },
        },
      },
    },
  };
  return (await ascRequest("/ciBuildRuns", { method: "POST", body })).data;
}

async function listWorkflows() {
  const productName = args["product-name"] || process.env.XCODE_CLOUD_PRODUCT_NAME || "";
  const workflowName = args["workflow-name"] || process.env.XCODE_CLOUD_WORKFLOW_NAME || "";
  const products = await ascRequest(
    `/ciProducts?${new URLSearchParams({
      limit: "100",
      "fields[ciProducts]": "name,productType,createdDate,workflows",
    })}`
  );
  const rows = [];
  for (const product of products.data || []) {
    const name = product.attributes?.name || "";
    if (productName && !name.toLowerCase().includes(productName.toLowerCase())) {
      continue;
    }
    const workflows = await ascRequest(
      `/ciProducts/${encodeURIComponent(product.id)}/workflows?${new URLSearchParams({
        limit: "100",
        "fields[ciWorkflows]": "name,description,isEnabled,lastModifiedDate",
      })}`
    );
    for (const workflow of workflows.data || []) {
      const wfName = workflow.attributes?.name || "";
      if (workflowName && !wfName.toLowerCase().includes(workflowName.toLowerCase())) {
        continue;
      }
      rows.push({
        productId: product.id,
        productName: name,
        workflowId: workflow.id,
        workflowName: wfName,
        isEnabled: workflow.attributes?.isEnabled ?? null,
        lastModifiedDate: workflow.attributes?.lastModifiedDate || "",
      });
    }
  }
  printJson({ workflows: rows });
}

async function downloadArtifacts(buildRunId) {
  const outDir = args["download-dir"] || process.env.XCODE_CLOUD_ARTIFACT_DIR || "build/xcode-cloud-artifacts";
  const artifactNameRegex = args["artifact-name-regex"] ? new RegExp(args["artifact-name-regex"]) : null;
  mkdirSync(outDir, { recursive: true });

  const actions = await ascRequest(`/ciBuildRuns/${encodeURIComponent(buildRunId)}/actions?limit=100`);
  const downloaded = [];
  for (const action of actions.data || []) {
    const artifacts = await ascRequest(`/ciBuildActions/${encodeURIComponent(action.id)}/artifacts?limit=100`);
    for (const artifactRef of artifacts.data || []) {
      const artifact = await readArtifact(artifactRef.id);
      const attrs = artifact.attributes || {};
      const fileName = attrs.fileName || `${artifact.id}.artifact`;
      if (artifactNameRegex && !artifactNameRegex.test(fileName)) {
        continue;
      }
      if (!attrs.downloadUrl) {
        continue;
      }
      const target = uniquePath(path.join(outDir, fileName));
      await downloadFile(attrs.downloadUrl, target);
      downloaded.push({
        id: artifact.id,
        fileName,
        fileType: attrs.fileType || "",
        fileSize: attrs.fileSize || 0,
        path: target,
      });
      console.log(`Downloaded ${fileName} -> ${target}`);
    }
  }

  if (downloaded.length === 0) {
    throw new Error("no Xcode Cloud artifacts matched the requested filters");
  }

  const summaryPath = args["summary-json"] || path.join(outDir, "xcode-cloud-artifacts.json");
  writeFileSync(summaryPath, JSON.stringify({ buildRunId, downloaded }, null, 2));
  console.log(`Artifact summary: ${summaryPath}`);
}

async function readArtifact(id) {
  const params = new URLSearchParams({
    "fields[ciArtifacts]": "fileName,fileType,fileSize,downloadUrl",
  });
  return (await ascRequest(`/ciArtifacts/${encodeURIComponent(id)}?${params}`)).data;
}

async function ascRequest(apiPath, options = {}) {
  const token = signJwt();
  const res = await fetch(`${API_BASE}${apiPath}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    json = JSON.parse(text);
  }
  if (!res.ok) {
    throw new Error(`App Store Connect API ${res.status}: ${text.slice(0, 1000)}`);
  }
  return json;
}

function signJwt() {
  const keyId = stringArg("key-id", process.env.ASC_KEY_ID);
  const issuerId = stringArg("issuer-id", process.env.ASC_ISSUER_ID);
  const key = ascPrivateKey();
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1",
  };
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const privateKey = crypto.createPrivateKey({ key, format: "pem" });
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(signature)}`;
}

function ascPrivateKey() {
  if (process.env.ASC_API_KEY_P8) {
    return process.env.ASC_API_KEY_P8.replace(/\\n/g, "\n");
  }
  if (process.env.ASC_API_KEY_BASE64) {
    return Buffer.from(process.env.ASC_API_KEY_BASE64, "base64").toString("utf8");
  }
  const keyPath = args["key-path"] || process.env.ASC_API_KEY_PATH;
  if (keyPath && existsSync(keyPath)) {
    return readFileSync(keyPath, "utf8");
  }
  throw new Error("ASC_API_KEY_P8, ASC_API_KEY_BASE64, or ASC_API_KEY_PATH is required");
}

async function downloadFile(url, target) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status}: ${url}`);
  }
  await pipeline(res.body, createWriteStream(target));
}

function uniquePath(candidate) {
  if (!existsSync(candidate)) return candidate;
  const parsed = path.parse(candidate);
  for (let i = 2; ; i++) {
    const next = path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`);
    if (!existsSync(next)) return next;
  }
}

function stringArg(name, fallback = "") {
  const value = args[name] || fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing required --${name}`);
  }
  return value;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = value;
      i++;
    }
  }
  return out;
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function usage() {
  console.log(`Usage:
  node scripts/asc-xcode-cloud-release.mjs wait-and-download --workflow-id <id> --ref-name <tag> --commit <sha>
  node scripts/asc-xcode-cloud-release.mjs wait --workflow-id <id> --ref-name <tag> --commit <sha>
  node scripts/asc-xcode-cloud-release.mjs download --build-run-id <id>
  node scripts/asc-xcode-cloud-release.mjs start --workflow-id <id>
  node scripts/asc-xcode-cloud-release.mjs list-workflows [--product-name agentic30] [--workflow-name Release]

Environment:
  ASC_KEY_ID, ASC_ISSUER_ID, and one of ASC_API_KEY_P8, ASC_API_KEY_BASE64, ASC_API_KEY_PATH
  XCODE_CLOUD_WORKFLOW_ID, XCODE_CLOUD_TIMEOUT_SECONDS, XCODE_CLOUD_POLL_SECONDS
`);
}
