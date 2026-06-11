#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const DEFAULT_PART_SIZE_MB = 64;
const DEFAULT_QUEUE_SIZE = 4;
const DEFAULT_MULTIPART_THRESHOLD_MB = 100;

function usage() {
  return `usage: scripts/r2-upload-object.mjs --file <path> --bucket <bucket> --key <object-key> --content-type <type> --cache-control <value> [--dry-run]

Environment:
  CLOUDFLARE_ACCOUNT_ID       Cloudflare account id for the default R2 S3 endpoint.
  R2_ACCESS_KEY_ID            R2 S3 access key id (falls back to AWS_ACCESS_KEY_ID).
  R2_SECRET_ACCESS_KEY        R2 S3 secret access key (falls back to AWS_SECRET_ACCESS_KEY).
  R2_S3_ENDPOINT              Optional endpoint override.
  R2_UPLOAD_PART_SIZE_MB      Multipart part size, default ${DEFAULT_PART_SIZE_MB}.
  R2_UPLOAD_QUEUE_SIZE        Multipart queue size, default ${DEFAULT_QUEUE_SIZE}.
  R2_MULTIPART_THRESHOLD_MB   Multipart threshold, default ${DEFAULT_MULTIPART_THRESHOLD_MB}.
`;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function numericEnv(name, fallback, minimum) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a number >= ${minimum}; got ${JSON.stringify(raw)}`);
  }
  return value;
}

function mib(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function r2Endpoint() {
  if (process.env.R2_S3_ENDPOINT) return process.env.R2_S3_ENDPOINT;
  return `https://${requireValue(process.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
}

function s3Client(endpoint) {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: requireValue(accessKeyId, "R2_ACCESS_KEY_ID"),
      secretAccessKey: requireValue(secretAccessKey, "R2_SECRET_ACCESS_KEY"),
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const file = requireValue(args.file, "--file");
  const bucket = requireValue(args.bucket, "--bucket");
  const key = requireValue(args.key, "--key");
  const contentType = requireValue(args.contentType, "--content-type");
  const cacheControl = requireValue(args.cacheControl, "--cache-control");
  const info = await stat(file);
  if (!info.isFile()) {
    throw new Error(`not a file: ${file}`);
  }

  const partSizeMb = numericEnv("R2_UPLOAD_PART_SIZE_MB", DEFAULT_PART_SIZE_MB, 5);
  const queueSize = numericEnv("R2_UPLOAD_QUEUE_SIZE", DEFAULT_QUEUE_SIZE, 1);
  const thresholdMb = numericEnv(
    "R2_MULTIPART_THRESHOLD_MB",
    DEFAULT_MULTIPART_THRESHOLD_MB,
    5
  );
  const partSize = partSizeMb * 1024 * 1024;
  const threshold = thresholdMb * 1024 * 1024;
  const mode = info.size >= threshold ? "multipart" : "single-put";
  const endpoint = args.endpoint || (args.dryRun ? process.env.R2_S3_ENDPOINT || "dry-run" : r2Endpoint());

  const summary = {
    file: basename(file),
    bucket,
    key,
    bytes: info.size,
    mib: mib(info.size),
    mode,
    contentType,
    cacheControl,
    endpoint,
    partSizeMb,
    queueSize,
  };

  if (args.dryRun || process.env.R2_UPLOAD_DRY_RUN === "1") {
    console.log(`[r2-upload] dry-run ${JSON.stringify(summary)}`);
    return;
  }

  console.log(`[r2-upload] uploading ${key} (${summary.mib} MiB) via ${mode}`);
  const client = s3Client(endpoint);
  const input = {
    Bucket: bucket,
    Key: key,
    Body: createReadStream(file),
    ContentLength: info.size,
    ContentType: contentType,
    CacheControl: cacheControl,
  };

  if (mode === "multipart") {
    const upload = new Upload({
      client,
      params: input,
      queueSize,
      partSize,
      leavePartsOnError: false,
    });
    await upload.done();
  } else {
    await client.send(new PutObjectCommand(input));
  }
  console.log(`[r2-upload] uploaded ${key}`);
}

main().catch((error) => {
  console.error(`[r2-upload] ERROR: ${error.message}`);
  console.error("");
  console.error(usage());
  process.exit(1);
});
