const DEFAULT_WEB_BASE_URL = "https://agentic30.app";

let authContext = null;

export function setAuthContext(input = {}) {
  const accessToken = String(input.accessToken || "").trim();
  if (!accessToken) {
    authContext = null;
    return null;
  }

  authContext = {
    accessToken,
    refreshToken: String(input.refreshToken || "").trim(),
    expiresAt: Number.isFinite(Number(input.expiresAt))
      ? Number(input.expiresAt)
      : null,
    userId: String(input.userId || "").trim(),
    email: input.email ? String(input.email) : null,
    webBaseUrl: normalizeBaseUrl(input.webBaseUrl),
    onboardingContext: normalizeOnboardingContext(input.onboardingContext),
    updatedAt: new Date().toISOString(),
  };
  return getAuthContextSummary();
}

export function clearAuthContext() {
  authContext = null;
}

export function getAuthContextSummary() {
  if (!authContext) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    userId: authContext.userId || null,
    email: authContext.email,
    expiresAt: authContext.expiresAt,
    onboardingContext: authContext.onboardingContext,
    updatedAt: authContext.updatedAt,
  };
}

export function buildAuthEnv() {
  if (!authContext?.accessToken) return {};
  return {
    AGENTIC30_WEB_BASE_URL: authContext.webBaseUrl,
    AGENTIC30_SUPABASE_ACCESS_TOKEN: authContext.accessToken,
    AGENTIC30_AUTH_USER_ID: authContext.userId,
    AGENTIC30_AUTH_EMAIL: authContext.email || "",
  };
}

export async function fetchAuthenticatedAppContext(env = process.env) {
  const accessToken = env.AGENTIC30_SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    return { authenticated: false };
  }

  const baseUrl = normalizeBaseUrl(env.AGENTIC30_WEB_BASE_URL);
  try {
    const response = await fetch(`${baseUrl}/api/mac/context`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return {
        authenticated: false,
        error: `context_${response.status}`,
      };
    }

    return redactSensitiveValues(await response.json());
  } catch (error) {
    return {
      authenticated: false,
      error: error instanceof Error ? error.message : "context_fetch_failed",
    };
  }
}

export function redactSensitiveValues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|key|authorization|password|encrypted/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactSensitiveValues(item);
    }
  }
  return redacted;
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_WEB_BASE_URL).trim() || DEFAULT_WEB_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function normalizeOnboardingContext(value) {
  if (!value || typeof value !== "object") return null;
  const role = String(value.role || "").trim();
  const projectStage = String(value.projectStage || value.project_stage || "").trim();
  const isolationLevel = String(value.isolationLevel || value.isolation_level || "").trim();
  const completedAt = String(value.completedAt || value.completed_at || "").trim();
  if (!role && !projectStage && !isolationLevel) return null;
  return {
    role,
    projectStage,
    isolationLevel,
    completedAt: completedAt || null,
  };
}
