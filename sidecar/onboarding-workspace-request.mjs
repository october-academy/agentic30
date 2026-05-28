import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomic-store.mjs";

export const ONBOARDING_WORKSPACE_REQUESTS_DIRNAME = "onboarding-workspace-requests";
export const ONBOARDING_WORKSPACE_REQUEST_TTL_MS = 30 * 60 * 1000;

const SOURCES = new Set(["cursor", "codex", "claude_code", "unknown"]);

async function verifyNonce({ nonceStorePath, token, now, fsImpl }) {
  if (!nonceStorePath) return { ok: true };
  if (!token || !String(token).trim()) {
    return { ok: false, error: "Onboarding token is required." };
  }
  let raw;
  try {
    raw = await fsImpl.readFile(nonceStorePath, "utf8");
  } catch {
    return { ok: false, error: "Onboarding token mismatch." };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Onboarding token mismatch." };
  }
  const expectedToken = String(parsed?.token || "");
  const expiresAt = parsed?.expiresAt ? new Date(parsed.expiresAt).getTime() : 0;
  if (!expectedToken || expectedToken !== String(token)) {
    return { ok: false, error: "Onboarding token mismatch." };
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { ok: false, error: "Onboarding token expired." };
  }
  return { ok: true };
}

export async function registerOnboardingWorkspaceRequest({
  appSupportPath,
  workspacePath,
  source = "unknown",
  usedCwd = false,
  token,
  nonceStorePath,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const resolvedAppSupportPath = path.resolve(String(appSupportPath || "").trim() || ".");
  const candidate = String(workspacePath || "").trim();
  if (!candidate) {
    return { ok: false, error: "Workspace path is required." };
  }
  if (!path.isAbsolute(candidate)) {
    return { ok: false, error: "Workspace path must be absolute." };
  }

  const resolvedPath = path.resolve(candidate);
  const stat = await fsImpl.stat(resolvedPath).catch(() => null);
  if (!stat?.isDirectory()) {
    return { ok: false, error: "Workspace path is not a directory.", path: resolvedPath };
  }

  const nonceCheck = await verifyNonce({ nonceStorePath, token, now, fsImpl });
  if (!nonceCheck.ok) {
    return nonceCheck;
  }

  const id = `req_${randomUUID().replace(/-/g, "")}`;
  const claimedSource = typeof source === "string" ? source : "";
  const normalizedSource = SOURCES.has(claimedSource) ? claimedSource : "unknown";
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ONBOARDING_WORKSPACE_REQUEST_TTL_MS).toISOString();
  const payload = {
    id,
    path: resolvedPath,
    basename: path.basename(resolvedPath),
    source: normalizedSource,
    claimedSource,
    createdAt,
    expiresAt,
    usedCwd: Boolean(usedCwd),
    status: "pending",
  };

  const requestPath = path.join(
    resolvedAppSupportPath,
    ONBOARDING_WORKSPACE_REQUESTS_DIRNAME,
    `${id}.json`,
  );
  await atomicWriteJson(requestPath, payload);

  return {
    ok: true,
    id,
    path: resolvedPath,
    basename: payload.basename,
    source: normalizedSource,
    claimedSource,
    usedCwd: Boolean(usedCwd),
    expiresAt,
    message: "Agentic30 workspace request registered. Return to Agentic30 to confirm the project folder.",
  };
}
