import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseStructuredPromptRequestOutput } from "./provider-sdk-contracts.mjs";

const REQUESTS_DIRNAME = "user-input-requests";
const RESPONSES_DIRNAME = "user-input-responses";

export function getUserInputPaths(appSupportPath) {
  return {
    requestsDir: path.join(appSupportPath, REQUESTS_DIRNAME),
    responsesDir: path.join(appSupportPath, RESPONSES_DIRNAME),
  };
}

export async function ensureUserInputDirs(appSupportPath) {
  const { requestsDir, responsesDir } = getUserInputPaths(appSupportPath);
  await fs.mkdir(requestsDir, { recursive: true });
  await fs.mkdir(responsesDir, { recursive: true });
  return { requestsDir, responsesDir };
}

export async function clearUserInputArtifacts(appSupportPath) {
  const { requestsDir, responsesDir } = await ensureUserInputDirs(appSupportPath);
  await Promise.all([
    removeJsonFiles(requestsDir),
    removeJsonFiles(responsesDir),
  ]);
}

export async function createUserInputRequest(
  appSupportPath,
  {
    sessionId,
    toolName,
    title = null,
    intro = null,
    resources = null,
    questions,
    generation = null,
  },
) {
  const requestId = randomUUID();
  const request = {
    requestId,
    sessionId,
    toolName,
    title,
    createdAt: new Date().toISOString(),
    questions,
  };
  if (intro && typeof intro === "object") {
    request.intro = intro;
  }
  if (Array.isArray(resources) && resources.length > 0) {
    request.resources = resources;
  }
  if (generation && typeof generation === "object") {
    request.generation = generation;
  }
  const validatedRequest = parseStructuredPromptRequestOutput(request);

  await ensureUserInputDirs(appSupportPath);
  await fs.writeFile(
    requestFilePath(appSupportPath, sessionId, requestId),
    JSON.stringify(validatedRequest, null, 2),
    "utf8",
  );

  return validatedRequest;
}

export async function listUserInputRequests(appSupportPath) {
  const { requestsDir } = await ensureUserInputDirs(appSupportPath);
  const entries = await fs.readdir(requestsDir).catch(() => []);
  const requests = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(requestsDir, entry);
    const request = await readJson(filePath);
    if (request?.requestId && request?.sessionId && Array.isArray(request?.questions)) {
      try {
        requests.push(parseStructuredPromptRequestOutput(request));
      } catch {
        // Ignore stale or malformed request files; callers only receive UI-safe contracts.
      }
    }
  }

  return requests.sort((lhs, rhs) =>
    String(lhs.createdAt || "").localeCompare(String(rhs.createdAt || "")),
  );
}

export async function writeUserInputResponse(
  appSupportPath,
  {
    sessionId,
    requestId,
    response,
  },
) {
  await ensureUserInputDirs(appSupportPath);
  const payload = {
    sessionId,
    requestId,
    submittedAt: new Date().toISOString(),
    ...response,
  };
  await fs.writeFile(
    responseFilePath(appSupportPath, sessionId, requestId),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  return payload;
}

export async function waitForUserInputResponse(
  appSupportPath,
  {
    sessionId,
    requestId,
    signal,
    pollMs = 250,
  },
) {
  const filePath = responseFilePath(appSupportPath, sessionId, requestId);

  while (!signal?.aborted) {
    const response = await readJson(filePath);
    if (response) {
      return response;
    }
    await sleep(pollMs, signal);
  }

  throw abortError();
}

export async function deleteUserInputArtifacts(appSupportPath, sessionId, requestId) {
  await Promise.allSettled([
    fs.unlink(requestFilePath(appSupportPath, sessionId, requestId)),
    fs.unlink(responseFilePath(appSupportPath, sessionId, requestId)),
  ]);
}

function requestFilePath(appSupportPath, sessionId, requestId) {
  const { requestsDir } = getUserInputPaths(appSupportPath);
  return path.join(requestsDir, `${sessionId}--${requestId}.json`);
}

function responseFilePath(appSupportPath, sessionId, requestId) {
  const { responsesDir } = getUserInputPaths(appSupportPath);
  return path.join(responsesDir, `${sessionId}--${requestId}.json`);
}

async function removeJsonFiles(directory) {
  const entries = await fs.readdir(directory).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => fs.unlink(path.join(directory, entry)).catch(() => {})),
  );
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(abortError());
    };

    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  const error = new Error("User input wait aborted.");
  error.name = "AbortError";
  return error;
}
