import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAuthContextSummary } from "./auth-context.mjs";

export function resolveIngestBaseURL(rawHost) {
  const trimmed = String(rawHost || "").trim() || "https://us.posthog.com";
  const normalized = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  const host = url.host.toLowerCase();
  const scheme = url.protocol.replace(/:$/, "") || "https";
  if (host === "us.posthog.com") return `${scheme}://us.i.posthog.com`;
  if (host === "eu.posthog.com") return `${scheme}://eu.i.posthog.com`;
  if (host === "us.i.posthog.com" || host === "eu.i.posthog.com") return `${scheme}://${host}`;
  return `${scheme}://${host}`;
}

const SUFFIX_ONLY_KEYS = new Set([
  "payment_key",
  "billing_key",
  "customer_key",
  "event_key",
]);

const REDACTED_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /authorization/i,
  /password/i,
  /signature/i,
  /api[_-]?key/i,
];

function emailDomain(value) {
  const [, domain] = String(value || "").trim().split("@");
  return domain ? domain.toLowerCase() : undefined;
}

function identifierSuffix(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed.slice(-6) : undefined;
}

function isAbsoluteLocalPath(value) {
  return String(value || "").startsWith("/") || /^[A-Za-z]:[\\/]/.test(String(value || ""));
}

function basenameKey(key) {
  if (key.endsWith("_root")) return `${key.slice(0, -5)}_basename`;
  if (key.endsWith("_path")) return `${key.slice(0, -5)}_basename`;
  if (key.endsWith("Root")) return `${key.slice(0, -4)}Basename`;
  if (key.endsWith("Path")) return `${key.slice(0, -4)}Basename`;
  return `${key}_basename`;
}

function shouldRedactKey(key) {
  return REDACTED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function sanitizeEntry(key, value) {
  const normalizedKey = String(key).toLowerCase();

  if (value == null) return {};

  if (normalizedKey === "email" || normalizedKey === "auth_email") {
    const domain = emailDomain(value);
    return domain ? { [`${key}_domain`]: domain } : {};
  }

  if (SUFFIX_ONLY_KEYS.has(normalizedKey)) {
    const suffix = identifierSuffix(value);
    return suffix ? { [`${key}_suffix`]: suffix } : { [`has_${key}`]: false };
  }

  if (shouldRedactKey(normalizedKey)) {
    return { [key]: "[redacted]" };
  }

  if (
    typeof value === "string"
    && /(?:root|path)$/i.test(key)
    && isAbsoluteLocalPath(value)
  ) {
    return { [basenameKey(key)]: path.basename(value) || value };
  }

  if (Array.isArray(value)) {
    return {
      [key]: value.map((item) => (
        item && typeof item === "object" && !Array.isArray(item)
          ? sanitizeTelemetryProperties(item)
          : item
      )),
    };
  }

  if (value && typeof value === "object") {
    return { [key]: sanitizeTelemetryProperties(value) };
  }

  return { [key]: value };
}

export function sanitizeTelemetryProperties(properties = {}) {
  return Object.entries(properties).reduce((acc, [key, value]) => ({
    ...acc,
    ...sanitizeEntry(key, value),
  }), {});
}

function parseFrames(stack) {
  if (!stack) return [];
  const frames = [];
  for (const rawLine of String(stack).split("\n").slice(1, 8)) {
    const line = rawLine.trim();
    const match =
      /at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$/.exec(line)
      || /at\s+(.*?):(\d+):(\d+)$/.exec(line);
    if (!match) continue;
    if (match.length === 5) {
      const [, fn, filename, lineno, colno] = match;
      frames.push({
        platform: "custom",
        lang: "javascript",
        function: fn || "<anonymous>",
        filename,
        lineno: Number(lineno),
        colno: Number(colno),
      });
      continue;
    }
    const [, filename, lineno, colno] = match;
    frames.push({
      platform: "custom",
      lang: "javascript",
      function: "<anonymous>",
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
    });
  }
  return frames;
}

function loadOrCreateDistinctId(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (parsed?.distinctId) return parsed.distinctId;
  } catch {}

  const distinctId = randomUUID();
  try {
    fs.writeFileSync(statePath, JSON.stringify({ distinctId }, null, 2), { mode: 0o600 });
  } catch {}
  return distinctId;
}

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      value: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { type: "Error", value: error };
  }
  try {
    return { type: "Error", value: JSON.stringify(error) };
  } catch {
    return { type: "Error", value: String(error) };
  }
}

export function createTelemetryClient({ appSupportPath, workspaceRoot }) {
  const distinctIdPath = path.join(appSupportPath, "posthog-telemetry.json");
  const anonymousDistinctId = loadOrCreateDistinctId(distinctIdPath);

  function loadConfig() {
    const configPath = path.join(appSupportPath, "ad-config.json");
    let config = null;
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {}

    const configuredKey =
      process.env.POSTHOG_PROJECT_API_KEY
      || config?.posthog?.projectApiKey
      || (String(config?.posthog?.apiKey || "").startsWith("phc_") ? config?.posthog?.apiKey : "");
    const configuredHost =
      process.env.POSTHOG_HOST
      || config?.posthog?.host
      || "https://us.posthog.com";

    if (!configuredKey) return null;

    const ingestBaseURL = resolveIngestBaseURL(configuredHost);
    if (!ingestBaseURL) return null;

    return {
      apiKey: configuredKey,
      ingestBaseURL,
    };
  }

  function baseProperties(extra = {}) {
    const auth = getAuthContextSummary();
    return sanitizeTelemetryProperties({
      source: "mac-sidecar",
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      workspace_basename: path.basename(workspaceRoot),
      ...(auth.authenticated
        ? {
            auth_user_id: auth.userId || undefined,
            auth_email_domain: emailDomain(auth.email),
          }
        : {}),
      ...extra,
    });
  }

  function distinctId() {
    const auth = getAuthContextSummary();
    return auth.userId || anonymousDistinctId;
  }

  function send(url, payload) {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  return {
    captureEvent(event, properties = {}) {
      const config = loadConfig();
      if (!config) return;
      send(`${config.ingestBaseURL}/capture/`, {
        api_key: config.apiKey,
        event,
        distinct_id: distinctId(),
        properties: baseProperties(properties),
        timestamp: new Date().toISOString(),
      });
    },

    captureException(error, properties = {}, handled = true) {
      const config = loadConfig();
      if (!config) return;
      const normalized = normalizeError(error);
      send(`${config.ingestBaseURL}/i/v0/e/`, {
        token: config.apiKey,
        event: "$exception",
        properties: {
          distinct_id: distinctId(),
          ...baseProperties(properties),
          handled,
          $exception_level: "error",
          $exception_list: [
            {
              type: normalized.type,
              value: normalized.value,
              mechanism: {
                handled,
                synthetic: false,
              },
              stacktrace: {
                type: "raw",
                frames: parseFrames(normalized.stack),
              },
            },
          ],
        },
        timestamp: new Date().toISOString(),
      });
    },
  };
}
