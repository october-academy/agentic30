import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { ensureQmdMemoryCollections } from "./qmd-support.mjs";

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

try {
  const appSupportPath = String(workerData?.appSupportPath || "");
  const workspaceRoot = String(workerData?.workspaceRoot || "");
  const sidecarRoot = String(workerData?.sidecarRoot || "");
  const bipConfig = appSupportPath ? readJsonFile(path.join(appSupportPath, "bip-config.json")) : null;
  const qmdWorkspaceRoot = String(bipConfig?.workspace?.root || "").trim() || workspaceRoot;
  const result = ensureQmdMemoryCollections({
    workspaceRoot: qmdWorkspaceRoot,
    appSupportPath,
    sidecarRoot,
  });

  parentPort?.postMessage({
    ok: true,
    result: {
      attempted: result.attempted,
      updated: result.updated,
      reason: result.reason || "",
      qmd: {
        source: result.qmd?.source || "",
      },
      collections: Array.isArray(result.collections)
        ? result.collections.map((collection) => ({
            name: collection.name,
            ok: collection.ok,
            status: collection.status,
          }))
        : [],
    },
  });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error || ""),
      stack: error instanceof Error ? error.stack : "",
    },
  });
}
