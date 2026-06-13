export function buildDiagnosticsSnapshot({
  appSupportPath,
  workspaceRoot,
  environment,
  preflight,
  sessions = [],
  activeRuns,
  sessionStoreSchemaVersion,
  sessionStoreWarnings = [],
  executionOs = null,
  mcpOauthTraces = [],
  now = () => new Date(),
  processInfo = process,
} = {}) {
  const statuses = {};
  for (const session of sessions) {
    const status = session?.status || "unknown";
    statuses[status] = (statuses[status] || 0) + 1;
  }

  return {
    generatedAt: now().toISOString(),
    appSupportPath,
    workspaceRoot,
    runtime: {
      pid: processInfo.pid,
      platform: processInfo.platform,
      arch: processInfo.arch,
      node: processInfo.version,
    },
    storage: {
      sessionsSchemaVersion: sessionStoreSchemaVersion,
      sessionStoreWarnings: sanitizeValue(sessionStoreWarnings),
    },
    sessions: {
      total: sessions.length,
      activeRuns: activeRuns?.size ?? 0,
      statuses,
    },
    environment: sanitizeEnvironmentSummary(environment),
    preflight: preflight ? sanitizeValue(preflight) : null,
    executionOs: executionOs ? sanitizeValue(executionOs) : null,
    mcpOauthTraces: sanitizeValue(Array.isArray(mcpOauthTraces) ? mcpOauthTraces.slice(-10) : []),
    redactionSafe: true,
  };
}

function sanitizeEnvironmentSummary(environment = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment)) {
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

function sanitizeValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (/token|secret|key|authorization|password/i.test(key)) {
      output[key] = nestedValue ? "[redacted]" : nestedValue;
      continue;
    }
    output[key] = sanitizeValue(nestedValue);
  }
  return output;
}
