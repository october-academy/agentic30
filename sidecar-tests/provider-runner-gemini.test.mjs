import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPromptText,
  extractGeminiChunkText,
  extractGeminiFunctionCalls,
  getProviderAuthState,
  getProviderConnectionState,
  resolveGeminiModel,
  supportsGeminiExecutionMode,
} from "../sidecar/provider-runner.mjs";

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("Gemini auth state reports missing key when no Google secret is set", () => {
  const previousStub = process.env.AGENTIC30_TEST_STUB_PROVIDER;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  try {
    delete process.env.AGENTIC30_TEST_STUB_PROVIDER;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const state = getProviderAuthState("gemini");
    assert.equal(state.available, false);
    assert.equal(state.source, "missing");
    assert.match(state.message, /GEMINI_API_KEY|GOOGLE_API_KEY|gcloud|Vertex/);
  } finally {
    restoreEnv("AGENTIC30_TEST_STUB_PROVIDER", previousStub);
    restoreEnv("GOOGLE_API_KEY", previousGoogle);
    restoreEnv("GEMINI_API_KEY", previousGemini);
  }
});

test("Gemini auth state accepts GOOGLE_API_KEY or GEMINI_API_KEY", () => {
  const previousStub = process.env.AGENTIC30_TEST_STUB_PROVIDER;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  try {
    delete process.env.AGENTIC30_TEST_STUB_PROVIDER;
    delete process.env.GOOGLE_API_KEY;
    process.env.GEMINI_API_KEY = "fake-key-for-test";
    const state = getProviderAuthState("gemini");
    assert.equal(state.available, true);
    assert.equal(state.source, "api-key");
    assert.match(state.message, /GEMINI_API_KEY|GOOGLE_API_KEY/);
  } finally {
    restoreEnv("AGENTIC30_TEST_STUB_PROVIDER", previousStub);
    restoreEnv("GOOGLE_API_KEY", previousGoogle);
    restoreEnv("GEMINI_API_KEY", previousGemini);
  }
});

test("Gemini provider connection reports installed @google/genai SDK", () => {
  const state = getProviderConnectionState("gemini");
  assert.equal(state.sdk.packageName, "@google/genai");
  assert.equal(state.sdk.available, true);
  assert.match(state.sdk.entrypointPath, /@google\/genai\/package\.json$/);
  assert.match(state.sdk.version, /^\d+\.\d+\.\d+/);
});

test("resolveGeminiModel defaults to gemini-3.1-pro-preview when no override is set", () => {
  const previousAgentic = process.env.AGENTIC30_GEMINI_MODEL;
  const previousGemini = process.env.GEMINI_MODEL;
  const previousGenai = process.env.GOOGLE_GENAI_MODEL;
  try {
    delete process.env.AGENTIC30_GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.GOOGLE_GENAI_MODEL;
    assert.equal(resolveGeminiModel(), "gemini-3.1-pro-preview");
  } finally {
    restoreEnv("AGENTIC30_GEMINI_MODEL", previousAgentic);
    restoreEnv("GEMINI_MODEL", previousGemini);
    restoreEnv("GOOGLE_GENAI_MODEL", previousGenai);
  }
});

test("resolveGeminiModel honors AGENTIC30_GEMINI_MODEL override", () => {
  const previous = process.env.AGENTIC30_GEMINI_MODEL;
  try {
    process.env.AGENTIC30_GEMINI_MODEL = "gemini-2.5-flash";
    assert.equal(resolveGeminiModel(), "gemini-2.5-flash");
    assert.equal(resolveGeminiModel("gemini-2.5-flash-lite"), "gemini-2.5-flash-lite");
  } finally {
    restoreEnv("AGENTIC30_GEMINI_MODEL", previous);
  }
});

test("supportsGeminiExecutionMode allows shared read-only/agentic lanes", () => {
  assert.equal(supportsGeminiExecutionMode("agentic"), true);
  assert.equal(supportsGeminiExecutionMode("fast_chat"), true);
  assert.equal(supportsGeminiExecutionMode("judge_read_only"), true);
  assert.equal(supportsGeminiExecutionMode("isolated_read_only"), true);
  assert.equal(supportsGeminiExecutionMode("memory_chat"), true);
  assert.equal(supportsGeminiExecutionMode("idd_question_synthesis"), true);
});

test("supportsGeminiExecutionMode blocks Claude-only lanes", () => {
  assert.equal(supportsGeminiExecutionMode("bip_coach_read_only"), false);
  assert.equal(supportsGeminiExecutionMode("mini_action_execution_only"), false);
  assert.equal(supportsGeminiExecutionMode(""), false);
});

test("extractGeminiChunkText prefers direct string text, falls back to candidate parts", () => {
  assert.equal(extractGeminiChunkText({ text: "안녕하세요" }), "안녕하세요");
  assert.equal(
    extractGeminiChunkText({
      candidates: [
        {
          content: {
            parts: [{ text: "hello " }, { text: "world" }],
          },
        },
      ],
    }),
    "hello world",
  );
  assert.equal(extractGeminiChunkText({}), "");
  assert.equal(extractGeminiChunkText(null), "");
});

test("extractGeminiFunctionCalls normalizes top-level and embedded function calls", () => {
  const fromTopLevel = extractGeminiFunctionCalls({
    functionCalls: [{ id: "call-1", name: "lookup_doc", args: { path: "docs/ICP.md" } }],
  });
  assert.deepEqual(fromTopLevel, [
    {
      phase: "use",
      toolName: "lookup_doc",
      toolCallKey: "call-1",
      payload: { path: "docs/ICP.md" },
    },
  ]);

  const fromCandidates = extractGeminiFunctionCalls({
    candidates: [
      {
        content: {
          parts: [
            { functionCall: { name: "list_dir", args: { path: "." } } },
          ],
        },
      },
    ],
  });
  assert.deepEqual(fromCandidates, [
    {
      phase: "use",
      toolName: "list_dir",
      toolCallKey: "list_dir",
      payload: { path: "." },
    },
  ]);

  assert.deepEqual(extractGeminiFunctionCalls({}), []);
  assert.deepEqual(extractGeminiFunctionCalls(null), []);
});

test("buildSystemPromptText emits Provider mode: gemini for Gemini sessions", () => {
  const prompt = buildSystemPromptText({
    provider: "gemini",
    workspaceRoot: "/tmp/workspace",
    executionMode: "agentic",
  });
  assert.match(prompt, /Provider mode: gemini/);
});
