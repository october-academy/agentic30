import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAuthContextSummary } from "./auth-context.mjs";

const DISABLE_TELEMETRY_ENV_KEY = "AGENTIC30_DISABLE_TELEMETRY";
const ENABLE_DEV_TELEMETRY_ENV_KEY = "AGENTIC30_ENABLE_DEV_TELEMETRY";
const TELEMETRY_ENVIRONMENT_ENV_KEY = "AGENTIC30_TELEMETRY_ENVIRONMENT";
const BUILD_CONFIGURATION_ENV_KEY = "AGENTIC30_BUILD_CONFIGURATION";
const INTERNAL_TRAFFIC_ENV_KEY = "AGENTIC30_INTERNAL_TRAFFIC";
const POSTHOG_PROJECT_API_KEY_ENV_KEY = "POSTHOG_PROJECT_API_KEY";
const POSTHOG_PROJECT_TOKEN_ENV_KEY = "POSTHOG_PROJECT_TOKEN";
const POSTHOG_HOST_ENV_KEY = "POSTHOG_HOST";

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

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function falsy(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function configValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.includes("$(")) return "";
  return trimmed;
}

function projectToken(value) {
  const trimmed = configValue(value);
  return trimmed.startsWith("phc_") ? trimmed : "";
}

export function projectTokenFromEnvironment(environment = process.env) {
  return (
    projectToken(environment[POSTHOG_PROJECT_API_KEY_ENV_KEY])
    || projectToken(environment[POSTHOG_PROJECT_TOKEN_ENV_KEY])
  );
}

function normalizeTelemetryEnvironment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "prod") return "production";
  if (normalized === "dev") return "development";
  return normalized;
}

function normalizeBuildConfiguration(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "development") return "debug";
  if (normalized === "prod" || normalized === "production") return "release";
  return normalized;
}

function inferDevelopmentSidecar({ environment, sidecarRoot }) {
  if (truthy(environment.AGENTIC30_FORCE_DEVELOPMENT_TELEMETRY_CONTEXT)) return true;
  if (normalizeTelemetryEnvironment(environment[TELEMETRY_ENVIRONMENT_ENV_KEY]) === "development") return true;
  if (normalizeBuildConfiguration(environment[BUILD_CONFIGURATION_ENV_KEY]) === "debug") return true;
  if (String(environment.NODE_ENV || "").trim().toLowerCase() === "development") return true;
  if (String(environment.npm_lifecycle_event || "") === "sidecar") return true;

  const root = String(sidecarRoot || "").replace(/\\/g, "/");
  if (!root) return false;
  return !root.includes(".app/Contents/Resources/");
}

export function resolveTelemetryRuntimePolicy({
  environment = process.env,
  sidecarRoot = process.env.AGENTIC30_SIDECAR_ROOT || "",
} = {}) {
  const isDevelopment = inferDevelopmentSidecar({ environment, sidecarRoot });
  const telemetryEnvironment =
    normalizeTelemetryEnvironment(environment[TELEMETRY_ENVIRONMENT_ENV_KEY])
    || (isDevelopment ? "development" : "production");
  const buildConfiguration =
    normalizeBuildConfiguration(environment[BUILD_CONFIGURATION_ENV_KEY])
    || (isDevelopment ? "debug" : "release");

  let isInternalTraffic = telemetryEnvironment !== "production" || buildConfiguration !== "release";
  if (truthy(environment[INTERNAL_TRAFFIC_ENV_KEY])) {
    isInternalTraffic = true;
  } else if (falsy(environment[INTERNAL_TRAFFIC_ENV_KEY])) {
    isInternalTraffic = false;
  }

  const isDevelopmentTelemetryEnabled = truthy(environment[ENABLE_DEV_TELEMETRY_ENV_KEY]);
  return {
    telemetryEnvironment,
    buildConfiguration,
    isInternalTraffic,
    isDevelopmentTelemetryEnabled,
    isSuppressed:
      truthy(environment[DISABLE_TELEMETRY_ENV_KEY])
      || (isInternalTraffic && !isDevelopmentTelemetryEnabled),
  };
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

function persistDistinctId(statePath, distinctId) {
  try {
    fs.writeFileSync(statePath, JSON.stringify({ distinctId }, null, 2), { mode: 0o600 });
  } catch {}
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

const LOG_SEVERITY = {
  trace: { text: "TRACE", number: 1 },
  debug: { text: "DEBUG", number: 5 },
  info: { text: "INFO", number: 9 },
  warn: { text: "WARN", number: 13 },
  warning: { text: "WARN", number: 13 },
  error: { text: "ERROR", number: 17 },
  fatal: { text: "FATAL", number: 21 },
};

function normalizeLogSeverity(level) {
  return LOG_SEVERITY[String(level || "").trim().toLowerCase()] || LOG_SEVERITY.info;
}

function otlpValue(value) {
  if (value == null) return { stringValue: "" };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "bigint") return { intValue: String(value) };
  if (value instanceof Date) return { stringValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(otlpValue) } };
  }
  if (typeof value === "object") {
    return {
      kvlistValue: {
        values: Object.entries(value).map(([key, nested]) => ({
          key,
          value: otlpValue(nested),
        })),
      },
    };
  }
  return { stringValue: String(value) };
}

function otlpAttributes(properties = {}) {
  return Object.entries(properties)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value: otlpValue(value) }));
}

function timeUnixNano(date = new Date()) {
  return String(BigInt(date.getTime()) * 1_000_000n);
}

export function createTelemetryClient({
  appSupportPath,
  workspaceRoot,
  environment = process.env,
  sidecarRoot = process.env.AGENTIC30_SIDECAR_ROOT || "",
}) {
  const distinctIdPath = path.join(appSupportPath, "posthog-telemetry.json");
  let anonymousDistinctId = loadOrCreateDistinctId(distinctIdPath);

  function runtimePolicy() {
    return resolveTelemetryRuntimePolicy({ environment, sidecarRoot });
  }

  function loadConfig() {
    if (runtimePolicy().isSuppressed) return null;

    const configPath = path.join(appSupportPath, "ad-config.json");
    let config = null;
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {}

    const configuredKey =
      projectTokenFromEnvironment(environment)
      || projectToken(config?.posthog?.projectApiKey)
      || projectToken(config?.posthog?.apiKey);
    const configuredHost =
      configValue(environment[POSTHOG_HOST_ENV_KEY])
      || configValue(config?.posthog?.host)
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
    const policy = runtimePolicy();
    return sanitizeTelemetryProperties({
      source: "mac-sidecar",
      telemetry_source: "mac_sidecar",
      telemetry_environment: policy.telemetryEnvironment,
      build_configuration: policy.buildConfiguration,
      is_internal_traffic: policy.isInternalTraffic,
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

  function send(url, payload, headers = {}) {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  function setAnonymousDistinctId(nextId) {
    const trimmed = String(nextId || "").trim();
    if (!trimmed || trimmed === anonymousDistinctId) return false;
    anonymousDistinctId = trimmed;
    persistDistinctId(distinctIdPath, trimmed);
    return true;
  }

  return {
    setAnonymousDistinctId,

    getAnonymousDistinctId() {
      return anonymousDistinctId;
    },

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

    captureLog(message, level = "info", attributes = {}) {
      const config = loadConfig();
      if (!config) return;
      const now = new Date();
      const severity = normalizeLogSeverity(level);
      const base = baseProperties({
        posthogDistinctId: distinctId(),
        distinct_id: distinctId(),
        ...attributes,
      });
      send(
        `${config.ingestBaseURL}/i/v1/logs`,
        {
          resourceLogs: [
            {
              resource: {
                attributes: otlpAttributes({
                  "service.name": "agentic30-sidecar",
                  "service.version": environment.AGENTIC30_APP_VERSION || "",
                  "deployment.environment": runtimePolicy().telemetryEnvironment,
                }),
              },
              scopeLogs: [
                {
                  scope: { name: "agentic30-sidecar" },
                  logRecords: [
                    {
                      timeUnixNano: timeUnixNano(now),
                      observedTimeUnixNano: timeUnixNano(now),
                      severityNumber: severity.number,
                      severityText: severity.text,
                      body: otlpValue(String(message || "")),
                      attributes: otlpAttributes(base),
                    },
                  ],
                },
              ],
            },
          ],
        },
        { Authorization: `Bearer ${config.apiKey}` },
      );
    },
  };
}
