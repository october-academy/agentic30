#!/usr/bin/env node
// Bundle sidecar entry points with bun, copy native-bearing packages, strip non-darwin binaries.
// Output: sidecar-dist/ (consumed by Xcode Copy Files build phase).

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SIDECAR_DIR = path.join(PACKAGE_ROOT, "sidecar");
const SIDECAR_SKILLS_DIR = path.join(SIDECAR_DIR, "skills");
const BUILD_DIR = path.join(PACKAGE_ROOT, "sidecar-build");
const DIST_DIR = path.join(BUILD_DIR, "sidecar");
const DIST_SKILLS_DIR = path.join(DIST_DIR, "skills");
const BUILD_STAMP = path.join(BUILD_DIR, ".build-stamp.json");
const SOURCE_NODE_MODULES = path.join(PACKAGE_ROOT, "node_modules");
const DIST_NODE_MODULES = path.join(DIST_DIR, "node_modules");
const LOCAL_BUN_BIN = path.join(PACKAGE_ROOT, "node_modules", ".bin", "bun");
const NODE_RUNTIME_CACHE_DIR =
  process.env.AGENTIC30_NODE_RUNTIME_CACHE_DIR ||
  path.join(PACKAGE_ROOT, ".omx", "node-runtime");
const NODE_RUNTIME_VERSION = "24.15.0";
const BUNDLE_ARCH = normalizeBundleArch(process.env.AGENTIC30_BUNDLE_ARCH || process.arch);
const TARGET_ARCHES = BUNDLE_ARCH === "universal" ? ["arm64", "x64"] : [BUNDLE_ARCH];

const NODE_RUNTIME_ARCHIVES = [
  {
    arch: "arm64",
    archive: `node-v${NODE_RUNTIME_VERSION}-darwin-arm64.tar.gz`,
    sha256: "372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4",
  },
  {
    arch: "x64",
    archive: `node-v${NODE_RUNTIME_VERSION}-darwin-x64.tar.gz`,
    sha256: "ffd5ee293467927f3ee731a553eb88fd1f48cf74eebc2d74a6babe4af228673b",
  },
];

const ENTRY_POINTS = [
  "index.mjs",
  "qmd-bootstrap-worker.mjs",
  "mcp-server.mjs",
  "onboarding-helper.mjs",
  "acp-adapter.mjs",
  "preflight-cli.mjs",
];

// External packages kept unbundled because they ship native binaries or
// load resources via __dirname-relative paths that bundling would break.
const BASE_EXTERNAL_PACKAGES = [
  "@anthropic-ai/claude-agent-sdk",
  "@openai/codex-sdk",
  "@openai/codex",
  // Bun-inlined zod can break @modelcontextprotocol/sdk import-time schemas
  // under the bundled Node runtime; keep one normal runtime copy instead.
  "zod",
  // Ships sqlite3 (native addon) in its dependency closure — must stay
  // unbundled and be copied with that closure intact (see
  // EXTERNAL_CLOSURE_PACKAGES).
  "@cursor/sdk",
];
// External packages whose runtime dependency closure must also be copied —
// they import siblings (e.g. @cursor/sdk → sqlite3, @connectrpc/*) that the
// bundle no longer provides once the package itself is external.
const EXTERNAL_CLOSURE_PACKAGES = [
  "@cursor/sdk",
];
const ARCH_EXTERNAL_PACKAGES = [
  "@anthropic-ai/claude-agent-sdk-darwin-arm64",
  "@anthropic-ai/claude-agent-sdk-darwin-x64",
  "@openai/codex-darwin-arm64",
  "@openai/codex-darwin-x64",
  "@cursor/sdk-darwin-arm64",
  "@cursor/sdk-darwin-x64",
  "@img/sharp-darwin-arm64",
  "@img/sharp-darwin-x64",
  "@img/sharp-libvips-darwin-arm64",
  "@img/sharp-libvips-darwin-x64",
];
const EXTERNAL_PACKAGES = [
  ...BASE_EXTERNAL_PACKAGES,
  ...ARCH_EXTERNAL_PACKAGES.filter((pkg) =>
    TARGET_ARCHES.some((arch) => pkg.endsWith(`-${arch}`))
  ),
];
const EXTERNAL_PACKAGE_SET = new Set(EXTERNAL_PACKAGES);
const ARCH_EXTERNAL_PACKAGE_SET = new Set(ARCH_EXTERNAL_PACKAGES);

// CLI packages invoked as standalone sidecars need their runtime dependency
// closure copied because they are not bundled into the main entry points.
const SIDECAR_CLI_PACKAGES = [
  "@tobilu/qmd",
];
const REQUIRED_BUNDLE_PACKAGES = [
  "@modelcontextprotocol/sdk",
  "ws",
  "zod",
];

// Platform suffixes to strip from any copied package that bundles
// multi-platform native binaries under vendor/<arch>-<os>/.
const NON_DARWIN_PLATFORMS = [
  "aarch64-pc-windows-msvc",
  "aarch64-unknown-linux-musl",
  "arm64-win32",
  "x64-win32",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-musl",
  "arm64-linux",
  "x64-linux",
];

const PREBUILD_PLATFORM_RE = /^(darwin|linux|win32)-(arm64|x64)$/;

const NATIVE_BUILD_ARTIFACT_DIRS = new Set([
  ".deps",
  "obj.target",
]);

const NATIVE_BUILD_ARTIFACT_EXTENSIONS = new Set([
  ".a",
  ".o",
]);

const PRUNED_FILE_EXTENSIONS = new Set([
  ".map",
]);

const PRUNED_DIR_NAMES = new Set([
  ".github",
  "__tests__",
  "docs",
  "doc",
  "examples",
  "example",
  "test",
  "tests",
]);

function normalizeBundleArch(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "arm64" || normalized === "x64" || normalized === "universal") {
    return normalized;
  }
  throw new Error(
    `AGENTIC30_BUNDLE_ARCH must be arm64, x64, or universal; received ${JSON.stringify(value)}`
  );
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))
    );
  });
}

function resolveBunBinary() {
  const explicit = process.env.BUN_BINARY;
  if (explicit && existsSync(explicit)) return explicit;
  if (existsSync(LOCAL_BUN_BIN)) return LOCAL_BUN_BIN;
  return "bun";
}

async function clean() {
  if (existsSync(BUILD_DIR)) {
    const staleDir = path.join(
      process.env.TMPDIR || "/tmp",
      `agentic30-sidecar-build.stale-${process.pid}-${Date.now()}`
    );
    await rename(BUILD_DIR, staleDir);
    console.warn(`[build-sidecar] moved previous build aside: ${path.basename(staleDir)}`);
  }
  await mkdir(DIST_DIR, { recursive: true });
}

async function bundle() {
  const entries = ENTRY_POINTS.map((name) => path.join(SIDECAR_DIR, name));
  const externals = EXTERNAL_PACKAGES.flatMap((p) => ["--external", p]);
  const args = [
    "build",
    ...entries,
    "--target=node",
    "--format=esm",
    "--outdir",
    DIST_DIR,
    ...externals,
  ];
  await run(resolveBunBinary(), args, PACKAGE_ROOT);
  // Bun emits .js; SidecarBridge looks for .mjs, so normalize extensions.
  for (const entry of ENTRY_POINTS) {
    const base = entry.replace(/\.mjs$/, "");
    const from = path.join(DIST_DIR, `${base}.js`);
    const to = path.join(DIST_DIR, `${base}.mjs`);
    if (existsSync(from)) await rename(from, to);
  }
}

async function copyExternals() {
  for (const pkg of EXTERNAL_PACKAGES) {
    const src = packagePath(SOURCE_NODE_MODULES, pkg);
    if (!existsSync(src)) continue;
    await copyPackage(pkg, src);
  }

  const seen = new Set();
  for (const pkg of [...SIDECAR_CLI_PACKAGES, ...EXTERNAL_CLOSURE_PACKAGES]) {
    await copyPackageClosure(pkg, seen);
  }
}

async function copyBundledSkills() {
  if (!existsSync(SIDECAR_SKILLS_DIR)) return;
  await rm(DIST_SKILLS_DIR, { recursive: true, force: true });
  await cp(SIDECAR_SKILLS_DIR, DIST_SKILLS_DIR, { recursive: true, dereference: true });
}

async function copyPackageClosure(pkg, seen) {
  if (seen.has(pkg)) return;
  if (!shouldCopyPackage(pkg)) return;

  const src = packagePath(SOURCE_NODE_MODULES, pkg);
  if (!existsSync(src)) return;

  seen.add(pkg);
  await copyPackage(pkg, src);

  const pkgJson = await readPackageJson(src);
  const deps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.optionalDependencies ?? {}),
  };
  for (const dep of Object.keys(deps)) {
    await copyPackageClosure(dep, seen);
  }
}

function shouldCopyPackage(pkg) {
  return !ARCH_EXTERNAL_PACKAGE_SET.has(pkg) || EXTERNAL_PACKAGE_SET.has(pkg);
}

async function copyPackage(pkg, src) {
  const dest = packagePath(DIST_NODE_MODULES, pkg);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, dereference: false });
}

async function ensureBundledNodeRuntime() {
  const runtimeRoot = path.join(DIST_DIR, "runtime");
  await mkdir(runtimeRoot, { recursive: true });

  for (const runtime of NODE_RUNTIME_ARCHIVES.filter((entry) => TARGET_ARCHES.includes(entry.arch))) {
    const archivePath = await cachedNodeRuntimeArchive(runtime);
    const extractRoot = path.join(BUILD_DIR, `node-runtime-${runtime.arch}`);
    const extractedDir = path.join(
      extractRoot,
      runtime.archive.replace(/\.tar\.gz$/, "")
    );
    const sourceNode = path.join(extractedDir, "bin", "node");
    const destinationNode = path.join(
      runtimeRoot,
      `node-darwin-${runtime.arch}`,
      "bin",
      "node"
    );

    await rm(extractRoot, { recursive: true, force: true });
    await mkdir(extractRoot, { recursive: true });
    await run("/usr/bin/tar", ["-xzf", archivePath, "-C", extractRoot], PACKAGE_ROOT);
    await mkdir(path.dirname(destinationNode), { recursive: true });
    await cp(sourceNode, destinationNode, { dereference: true });
    await chmod(destinationNode, 0o755);
  }
}

async function cachedNodeRuntimeArchive(runtime) {
  const cacheDir = path.join(NODE_RUNTIME_CACHE_DIR, `v${NODE_RUNTIME_VERSION}`);
  const archivePath = path.join(cacheDir, runtime.archive);
  const partialPath = `${archivePath}.tmp-${process.pid}`;
  await mkdir(cacheDir, { recursive: true });

  if (existsSync(archivePath) && await fileMatchesSha256(archivePath, runtime.sha256)) {
    return archivePath;
  }

  const url = `https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/${runtime.archive}`;
  console.log(`[build-sidecar] downloading ${runtime.archive}`);
  await rm(partialPath, { force: true });
  await downloadRuntimeArchive(url, partialPath);
  await rename(partialPath, archivePath);

  if (!await fileMatchesSha256(archivePath, runtime.sha256)) {
    await rm(archivePath, { force: true });
    throw new Error(`checksum mismatch for ${runtime.archive}`);
  }

  return archivePath;
}

async function downloadRuntimeArchive(url, outputPath) {
  if (existsSync("/usr/bin/curl")) {
    try {
      await run(
        "/usr/bin/curl",
        [
          "--fail",
          "--location",
          "--show-error",
          "--silent",
          "--retry",
          "5",
          "--retry-all-errors",
          "--retry-delay",
          "2",
          "--connect-timeout",
          "30",
          "--max-time",
          "300",
          "--output",
          outputPath,
          url,
        ],
        PACKAGE_ROOT
      );
      return;
    } catch (error) {
      await rm(outputPath, { force: true });
      throw error;
    }
  }

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(`download failed for ${url}: ${response.status} ${response.statusText}`);
      }
      await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      lastError = error;
      await rm(outputPath, { force: true });
      if (attempt < 5) {
        const delayMs = 2_000 * attempt;
        console.warn(`[build-sidecar] download retry ${attempt}/5 after ${delayMs}ms: ${error.message}`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileMatchesSha256(file, expected) {
  try {
    const hash = createHash("sha256");
    hash.update(await readFile(file));
    return hash.digest("hex") === expected;
  } catch {
    return false;
  }
}

async function readPackageJson(packageRoot) {
  try {
    return JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function packagePath(nodeModulesRoot, pkg) {
  return path.join(nodeModulesRoot, ...pkg.split("/"));
}

async function ensureDependencies() {
  const missing = [...REQUIRED_BUNDLE_PACKAGES, ...EXTERNAL_PACKAGES, ...SIDECAR_CLI_PACKAGES]
    .filter((pkg) => !existsSync(packagePath(SOURCE_NODE_MODULES, pkg)));
  if (!existsSync(LOCAL_BUN_BIN)) missing.push("bun");
  if (missing.length === 0) return;

  const npmArgs = existsSync(path.join(PACKAGE_ROOT, "package-lock.json"))
    ? ["ci", "--include=optional"]
    : ["install"];
  console.log(`[build-sidecar] installing missing dependencies: ${missing.join(", ")}`);
  await run("npm", npmArgs, PACKAGE_ROOT);
}

async function computeBuildFingerprint() {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      version: 1,
      entryPoints: ENTRY_POINTS,
      externalPackages: EXTERNAL_PACKAGES,
      bundleArch: BUNDLE_ARCH,
      targetArchs: TARGET_ARCHES,
      sidecarCliPackages: SIDECAR_CLI_PACKAGES,
      nonDarwinPlatforms: NON_DARWIN_PLATFORMS,
      targetPrebuildPlatforms: TARGET_ARCHES.map((arch) => `darwin-${arch}`),
      nativeBuildArtifactDirs: [...NATIVE_BUILD_ARTIFACT_DIRS],
      nativeBuildArtifactExtensions: [...NATIVE_BUILD_ARTIFACT_EXTENSIONS],
      nodeRuntimeVersion: NODE_RUNTIME_VERSION,
      nodeRuntimeArchives: NODE_RUNTIME_ARCHIVES.filter((entry) => TARGET_ARCHES.includes(entry.arch)),
    })
  );

  for (const file of [
    path.join(PACKAGE_ROOT, "package.json"),
    path.join(PACKAGE_ROOT, "package-lock.json"),
    fileURLToPath(import.meta.url),
  ]) {
    await hashFile(hash, file);
  }
  await hashDirectory(hash, SIDECAR_DIR);
  return hash.digest("hex");
}

async function hashDirectory(hash, dir) {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hash.update(`dir:${path.relative(PACKAGE_ROOT, full)}\0`);
      await hashDirectory(hash, full);
    } else if (entry.isFile()) {
      await hashFile(hash, full);
    }
  }
}

async function hashFile(hash, file) {
  hash.update(`file:${path.relative(PACKAGE_ROOT, file)}\0`);
  hash.update(await readFile(file));
  hash.update("\0");
}

async function isBuildCurrent(fingerprint) {
  if (process.env.AGENTIC30_FORCE_SIDECAR_BUILD === "1") return false;
  if (!existsSync(BUILD_STAMP)) return false;
  for (const entry of ENTRY_POINTS) {
    if (!existsSync(path.join(DIST_DIR, entry))) return false;
  }

  try {
    const stamp = JSON.parse(await readFile(BUILD_STAMP, "utf8"));
    return stamp.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

async function writeBuildStamp(fingerprint, size) {
  await writeFile(
    BUILD_STAMP,
    JSON.stringify(
      {
        fingerprint,
        builtAt: new Date().toISOString(),
        sizeBytes: size,
      },
      null,
      2
    ) + "\n"
  );
}

async function stripNonDarwinBinaries(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldStripNativePlatformDir(entry.name)) {
          await rm(full, { recursive: true, force: true });
          continue;
        }
        stack.push(full);
      }
    }
  }
}

function shouldStripNativePlatformDir(name) {
  if (NON_DARWIN_PLATFORMS.includes(name)) return true;
  const match = PREBUILD_PLATFORM_RE.exec(name);
  if (!match) return false;
  const [, platform, arch] = match;
  return platform !== "darwin" || !TARGET_ARCHES.includes(arch);
}

async function stripNativeBuildArtifacts(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (NATIVE_BUILD_ARTIFACT_DIRS.has(entry.name)) {
          await rm(full, { recursive: true, force: true });
          continue;
        }
        stack.push(full);
      } else if (entry.isFile() && NATIVE_BUILD_ARTIFACT_EXTENSIONS.has(path.extname(entry.name))) {
        await rm(full, { force: true });
      }
    }
  }
}

async function pruneBundleCruft(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (PRUNED_DIR_NAMES.has(entry.name)) {
          await rm(full, { recursive: true, force: true });
          continue;
        }
        stack.push(full);
      } else if (entry.isFile() && PRUNED_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        await rm(full, { force: true });
      }
    }
  }
}

async function logTopLevelSizes(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const sizes = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    sizes.push({
      name: entry.name,
      size: entry.isDirectory() ? await directorySize(full) : (await stat(full)).size,
    });
  }
  sizes
    .sort((a, b) => b.size - a.size)
    .slice(0, 8)
    .forEach((item) => {
      console.log(`[build-sidecar] size ${item.name}: ${(item.size / 1024 / 1024).toFixed(1)} MB`);
    });
}

async function directorySize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          const info = await stat(full);
          total += info.size;
        } catch {}
      }
    }
  }
  return total;
}

async function main() {
  const fingerprint = await computeBuildFingerprint();
  if (await isBuildCurrent(fingerprint)) {
    console.log("[build-sidecar] up to date; skipping bundle rebuild.");
    return;
  }

  console.log(`[build-sidecar] bundle arch: ${BUNDLE_ARCH} (${TARGET_ARCHES.join(", ")})`);
  await ensureDependencies();
  console.log("[build-sidecar] cleaning dist...");
  await clean();
  console.log("[build-sidecar] bundling entry points with bun...");
  await bundle();
  console.log("[build-sidecar] copying bundled skills...");
  await copyBundledSkills();
  console.log("[build-sidecar] copying external packages...");
  await copyExternals();
  console.log("[build-sidecar] bundling Node.js runtime...");
  await ensureBundledNodeRuntime();
  console.log("[build-sidecar] stripping non-darwin native binaries...");
  await stripNonDarwinBinaries(DIST_NODE_MODULES);
  console.log("[build-sidecar] stripping native build artifacts...");
  await stripNativeBuildArtifacts(DIST_NODE_MODULES);
  console.log("[build-sidecar] pruning bundle cruft...");
  await pruneBundleCruft(DIST_NODE_MODULES);
  const size = await directorySize(DIST_DIR);
  await writeBuildStamp(fingerprint, size);
  await logTopLevelSizes(DIST_DIR);
  console.log(`[build-sidecar] done. dist size: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((error) => {
  console.error("[build-sidecar] failed:", error);
  process.exit(1);
});
