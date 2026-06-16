import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseCodexStructuredInputToolOutput,
  parseStructuredPromptRequestOutput,
} from "./provider-sdk-contracts.mjs";

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

export async function writeUserInputRequest(appSupportPath, request) {
  const validatedRequest = parseStructuredPromptRequestOutput(request);
  await ensureUserInputDirs(appSupportPath);
  await fs.writeFile(
    requestFilePath(appSupportPath, validatedRequest.sessionId, validatedRequest.requestId),
    JSON.stringify(validatedRequest, null, 2),
    "utf8",
  );
  return validatedRequest;
}

export function buildPendingUserInputToolOutput(request = {}) {
  return parseCodexStructuredInputToolOutput({
    status: "pending_user_input",
    requestId: request.requestId,
    title: request.title ?? null,
    questions: Array.isArray(request.questions) ? request.questions : [],
    answers: {},
    annotations: {},
    responses: [],
  });
}

export function extractCodexStructuredInputToolOutputFromPayload(payload = null) {
  const stack = [payload];
  const seen = new Set();

  while (stack.length > 0 && seen.size < 40) {
    const value = stack.shift();
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      if (!looksLikeJson(text)) continue;
      try {
        stack.push(JSON.parse(text));
      } catch {
        // Ignore free-form text in provider envelopes.
      }
      continue;
    }
    if (typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);

    try {
      return parseCodexStructuredInputToolOutput(value);
    } catch {
      // Keep walking nested result/content/text envelopes.
    }

    if (Array.isArray(value)) {
      for (const entry of value) stack.push(entry);
      continue;
    }

    if (typeof value.text === "string") stack.push(value.text);
    if (typeof value.output === "string") stack.push(value.output);
    if (typeof value.result === "string") stack.push(value.result);
    if (value.output && typeof value.output === "object") stack.push(value.output);
    if (value.result && typeof value.result === "object") stack.push(value.result);
    if (Array.isArray(value.content)) {
      for (const entry of value.content) stack.push(entry);
    }
    if (Array.isArray(value.result?.content)) {
      for (const entry of value.result.content) stack.push(entry);
    }
  }

  return null;
}

export function isPendingCodexStructuredInputToolOutput(output = null) {
  if (!isCodexStructuredInputToolOutputLike(output)) return false;
  if (String(output.status || "").trim().toLowerCase() === "pending_user_input") {
    return true;
  }
  return hasEmptyStructuredInputAnswers(output);
}

export function isAnsweredCodexStructuredInputToolOutput(output = null) {
  if (!isCodexStructuredInputToolOutputLike(output)) return false;
  return !hasEmptyStructuredInputAnswers(output);
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

function looksLikeJson(text) {
  return text.startsWith("{") || text.startsWith("[");
}

function isCodexStructuredInputToolOutputLike(output = null) {
  return Boolean(
    output
    && typeof output === "object"
    && typeof output.requestId === "string"
    && output.requestId.trim()
    && Array.isArray(output.questions)
    && output.questions.length > 0,
  );
}

function hasEmptyStructuredInputAnswers(output = null) {
  const answers = output?.answers && typeof output.answers === "object" && !Array.isArray(output.answers)
    ? output.answers
    : {};
  const responses = Array.isArray(output?.responses) ? output.responses : [];
  return Object.keys(answers).length === 0 && responses.length === 0;
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
