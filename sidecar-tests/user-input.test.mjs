import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  clearUserInputArtifacts,
  createUserInputRequest,
  deleteUserInputArtifacts,
  ensureUserInputDirs,
  listUserInputRequests,
  waitForUserInputResponse,
  writeUserInputResponse,
} from "../sidecar/user-input.mjs";

test("user input request lifecycle round-trips through request and response files", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-user-input-"));
  await ensureUserInputDirs(appSupportPath);

  const request = await createUserInputRequest(appSupportPath, {
    sessionId: "session-1",
    toolName: "agentic30_request_user_input",
    title: "assistant needs a choice",
    generation: {
      mode: "provider_adaptive",
      docType: "icp",
    },
    questions: [
      {
        header: "Scope",
        question: "Which scope should we use?",
        options: [
          { label: "Hero", description: "Work on hero only" },
          { label: "App", description: "Work on the full app" },
        ],
        multiSelect: false,
        allowFreeText: true,
        textMode: "short",
      },
    ],
  });

  const requests = await listUserInputRequests(appSupportPath);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestId, request.requestId);
  assert.equal(requests[0].toolName, "agentic30_request_user_input");
  assert.deepEqual(requests[0].generation, {
    mode: "provider_adaptive",
    docType: "icp",
  });

  const waitPromise = waitForUserInputResponse(appSupportPath, {
    sessionId: "session-1",
    requestId: request.requestId,
    signal: AbortSignal.timeout(2_000),
    pollMs: 10,
  });

  await writeUserInputResponse(appSupportPath, {
    sessionId: "session-1",
    requestId: request.requestId,
    response: {
      answers: {
        "Which scope should we use?": "App",
      },
      responses: [
        {
          question: "Which scope should we use?",
          selectedOptions: ["App"],
          freeText: "",
        },
      ],
    },
  });

  const response = await waitPromise;
  assert.equal(response.answers["Which scope should we use?"], "App");

  await deleteUserInputArtifacts(appSupportPath, "session-1", request.requestId);
  assert.deepEqual(await listUserInputRequests(appSupportPath), []);
});

test("clearUserInputArtifacts removes stale request and response files", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-user-input-clear-"));
  await ensureUserInputDirs(appSupportPath);

  const request = await createUserInputRequest(appSupportPath, {
    sessionId: "session-2",
    toolName: "AskUserQuestion",
    title: null,
    questions: [
      {
        header: "Tone",
        question: "What tone should we use?",
        options: [
          { label: "Bold", description: "High-energy" },
          { label: "Quiet", description: "Minimal motion" },
        ],
        multiSelect: false,
      },
    ],
  });

  await writeUserInputResponse(appSupportPath, {
    sessionId: "session-2",
    requestId: request.requestId,
    response: {
      answers: { "What tone should we use?": "Bold" },
      responses: [],
    },
  });

  await clearUserInputArtifacts(appSupportPath);
  assert.deepEqual(await listUserInputRequests(appSupportPath), []);
});

test("createUserInputRequest rejects malformed structured prompt output", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-user-input-invalid-"));
  await ensureUserInputDirs(appSupportPath);

  await assert.rejects(
    () => createUserInputRequest(appSupportPath, {
      sessionId: "session-invalid",
      toolName: "AskUserQuestion",
      title: "Invalid",
      questions: [
        {
          question: "This request is missing the app-facing header field.",
          allowFreeText: true,
        },
      ],
    }),
    /structured input request output contract violation/,
  );

  assert.deepEqual(await listUserInputRequests(appSupportPath), []);
});
