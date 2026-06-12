import { z } from "zod";

const UnknownRecordSchema = z.object({}).passthrough();
const NonEmptyStringSchema = z.string().min(1);
const OptionalStringSchema = z.string().optional();
const OptionalNullableStringSchema = z.string().nullable().optional();

const StructuredPromptOptionInputSchema = z.object({
  label: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  preview: z.string().max(4000).optional(),
  nextIntent: z.string().max(160).optional(),
  next_intent: z.string().max(160).optional(),
  recommended: z.boolean().optional(),
  risk: z.string().max(280).optional(),
  evidenceTarget: z.string().max(280).optional(),
  evidence_target: z.string().max(280).optional(),
  mapsTo: z.string().max(160).optional(),
  maps_to: z.string().max(160).optional(),
  failureMode: z.string().max(280).optional(),
  failure_mode: z.string().max(280).optional(),
}).passthrough();

const CodexStructuredPromptOptionInputSchema = StructuredPromptOptionInputSchema.extend({
  description: z.string().min(1).max(280),
});

const StructuredPromptEmphasisInputSchema = z.object({
  phrase: z.string().min(1).max(280).optional(),
  text: z.string().min(1).max(280).optional(),
  style: z.enum(["strong", "mark", "code"]).optional(),
  kind: z.enum(["strong", "mark", "code"]).optional(),
}).passthrough().superRefine((span, context) => {
  if (!span.phrase && !span.text) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Emphasis spans need phrase or text.",
    });
  }
});

const StructuredPromptQuestionBaseInputSchema = z.object({
  questionId: z.string().max(96).optional(),
  question_id: z.string().max(96).optional(),
  id: z.string().max(96).optional(),
  header: z.string().max(32).optional(),
  question: z.string().min(1).max(400),
  multiSelect: z.boolean().default(false),
  allowFreeText: z.boolean().default(false),
  requiresFreeText: z.boolean().default(false),
  helperText: z.string().max(280).optional(),
  freeTextPlaceholder: z.string().max(280).optional(),
  textMode: z.enum(["short", "long"]).optional(),
  highlightPhrases: z.array(z.string().min(1).max(280)).max(8).optional(),
  highlight_phrases: z.array(z.string().min(1).max(280)).max(8).optional(),
  highlights: z.array(z.string().min(1).max(280)).max(8).optional(),
  emphasis: z.array(StructuredPromptEmphasisInputSchema).max(8).optional(),
  emphasis_spans: z.array(StructuredPromptEmphasisInputSchema).max(8).optional(),
}).passthrough();

const ClaudeStructuredPromptQuestionInputSchema = StructuredPromptQuestionBaseInputSchema.extend({
  options: z.array(StructuredPromptOptionInputSchema).max(7).optional(),
}).superRefine(refineStructuredPromptInputQuestion);

const CodexStructuredPromptQuestionInputSchema = StructuredPromptQuestionBaseInputSchema.extend({
  header: z.string().min(1).max(32),
  options: z.array(CodexStructuredPromptOptionInputSchema).max(7).optional(),
}).superRefine(refineStructuredPromptInputQuestion);

const StructuredPromptIntroInputSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(500).optional(),
  bullets: z.array(z.string().min(1).max(180)).max(6).optional(),
}).passthrough();

const StructuredPromptResourceInputSchema = z.object({
  title: z.string().min(1).max(160),
  source: z.string().max(80).optional(),
  url: z.string().url().max(500),
  description: z.string().max(240).optional(),
}).passthrough();

export const ClaudeStructuredInputToolInputSchema = z.object({
  title: z.string().max(120).optional(),
  intro: StructuredPromptIntroInputSchema.optional(),
  resources: z.array(StructuredPromptResourceInputSchema).max(5).optional(),
  questions: z.array(ClaudeStructuredPromptQuestionInputSchema).min(1).max(4),
}).passthrough();

export const CodexStructuredInputToolInputSchema = z.object({
  title: z.string().max(120).optional(),
  intro: StructuredPromptIntroInputSchema.optional(),
  resources: z.array(StructuredPromptResourceInputSchema).max(5).optional(),
  questions: z.array(CodexStructuredPromptQuestionInputSchema).min(1).max(4),
}).passthrough();

export const CodexStructuredInputToolZodShape = CodexStructuredInputToolInputSchema.shape;

const StructuredPromptOptionOutputSchema = z.object({
  label: z.string().min(1).max(80),
  description: z.string().max(280),
  preview: z.string().max(4000).optional(),
  nextIntent: z.string().max(160).optional(),
  recommended: z.boolean().optional(),
  risk: z.string().max(280).optional(),
  evidenceTarget: z.string().max(280).optional(),
  mapsTo: z.string().max(160).optional(),
  failureMode: z.string().max(280).optional(),
}).passthrough();

const StructuredPromptEmphasisOutputSchema = z.object({
  phrase: z.string().min(1).max(280),
  style: z.enum(["strong", "mark", "code"]).optional(),
}).passthrough();

export const StructuredPromptQuestionOutputSchema = z.object({
  questionId: z.string().max(96).optional(),
  header: z.string().max(32),
  question: z.string().min(1).max(400),
  options: z.array(StructuredPromptOptionOutputSchema).max(7).optional(),
  multiSelect: z.boolean().optional(),
  allowFreeText: z.boolean().optional(),
  requiresFreeText: z.boolean().optional(),
  helperText: z.string().max(280).optional(),
  freeTextPlaceholder: z.string().max(280).optional(),
  textMode: z.enum(["short", "long"]).optional(),
  highlightPhrases: z.array(z.string().min(1).max(280)).max(8).optional(),
  emphasis: z.array(StructuredPromptEmphasisOutputSchema).max(8).optional(),
}).passthrough().superRefine((question, context) => {
  const optionCount = Array.isArray(question.options) ? question.options.length : 0;
  if (optionCount === 0 && question.allowFreeText !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each structured output question needs choices, free text, or both.",
    });
  }
  if (optionCount === 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choice questions need at least two options.",
    });
  }
});

const StructuredPromptIntroOutputSchema = z.object({
  title: OptionalNullableStringSchema,
  body: OptionalNullableStringSchema,
  bullets: z.array(z.string().min(1).max(180)).max(6).nullable().optional(),
}).passthrough();

const StructuredPromptResourceOutputSchema = z.object({
  title: z.string().min(1).max(160),
  source: OptionalNullableStringSchema,
  url: z.string().url().max(500),
  description: OptionalNullableStringSchema,
}).passthrough();

const StructuredPromptGenerationOutputSchema = z.object({
  mode: OptionalNullableStringSchema,
  docType: OptionalNullableStringSchema,
  signalId: OptionalNullableStringSchema,
  signalLabel: OptionalNullableStringSchema,
  isLastSignalForDoc: z.boolean().nullable().optional(),
  dimensionTransitioned: z.boolean().nullable().optional(),
  previousSignalLabel: OptionalNullableStringSchema,
  previousAnswerLabel: OptionalNullableStringSchema,
  dimensionStepIndex: z.number().int().nullable().optional(),
  dimensionTotal: z.number().int().nullable().optional(),
}).passthrough();

export const StructuredPromptRequestOutputSchema = z.object({
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  toolName: z.string().min(1),
  title: OptionalNullableStringSchema,
  createdAt: z.string().min(1),
  intro: StructuredPromptIntroOutputSchema.nullable().optional(),
  resources: z.array(StructuredPromptResourceOutputSchema).max(5).nullable().optional(),
  questions: z.array(StructuredPromptQuestionOutputSchema).min(1).max(4),
  generation: StructuredPromptGenerationOutputSchema.nullable().optional(),
}).passthrough();

const StructuredPromptResponsesOutputSchema = z.array(z.object({
  question: z.string().min(1).max(400),
  selectedOptions: z.array(z.string().max(160)).optional(),
  freeText: z.string().max(4000).optional(),
}).passthrough()).max(8);

const StructuredPromptToolOutputBaseSchema = z.object({
  questions: z.array(StructuredPromptQuestionOutputSchema).min(1).max(4),
  answers: z.record(z.string(), z.unknown()).default({}),
  annotations: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export const ClaudeStructuredInputToolOutputSchema = StructuredPromptToolOutputBaseSchema;

export const CodexStructuredInputToolOutputSchema = StructuredPromptToolOutputBaseSchema.extend({
  requestId: z.string().min(1),
  title: OptionalNullableStringSchema,
  responses: StructuredPromptResponsesOutputSchema.default([]),
});

const CodexUsageSchema = z.object({
  input_tokens: z.number(),
  cached_input_tokens: z.number(),
  output_tokens: z.number(),
  reasoning_output_tokens: z.number(),
}).passthrough();

const CodexCommandExecutionItemSchema = z.object({
  id: z.string(),
  type: z.literal("command_execution"),
  command: z.string(),
  aggregated_output: z.string(),
  exit_code: z.number().nullable().optional(),
  status: z.enum(["in_progress", "completed", "failed"]),
}).passthrough();

const CodexFileChangeItemSchema = z.object({
  id: z.string(),
  type: z.literal("file_change"),
  changes: z.array(z.object({
    path: z.string(),
    kind: z.enum(["add", "delete", "update"]),
  }).passthrough()),
  status: z.enum(["completed", "failed"]),
}).passthrough();

const CodexMcpToolCallItemSchema = z.object({
  id: z.string(),
  type: z.literal("mcp_tool_call"),
  server: z.string(),
  tool: z.string(),
  arguments: z.unknown(),
  result: z.object({
    content: z.array(UnknownRecordSchema),
    _meta: z.unknown().optional(),
    structured_content: z.unknown(),
  }).passthrough().nullable().optional(),
  error: z.object({ message: z.string() }).passthrough().nullable().optional(),
  status: z.enum(["in_progress", "completed", "failed"]),
}).passthrough();

const CodexFunctionCallItemSchema = z.object({
  id: z.string().optional(),
  type: z.literal("function_call"),
  name: z.string().min(1),
  namespace: z.string().min(1).optional(),
  call_id: z.string().min(1).optional(),
  arguments: z.unknown().optional(),
  input: z.unknown().optional(),
  status: z.enum(["in_progress", "completed", "failed"]).optional(),
}).passthrough();

const CodexFunctionCallOutputItemSchema = z.object({
  id: z.string().optional(),
  type: z.literal("function_call_output"),
  name: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  call_id: z.string().min(1).optional(),
  output: z.unknown().nullable().optional(),
  result: z.unknown().nullable().optional(),
  error: z.unknown().nullable().optional(),
  status: z.enum(["in_progress", "completed", "failed"]).optional(),
}).passthrough();

const CodexAgentMessageItemSchema = z.object({
  id: z.string(),
  type: z.literal("agent_message"),
  text: z.string(),
}).passthrough();

const CodexReasoningItemSchema = z.object({
  id: z.string(),
  type: z.literal("reasoning"),
  text: z.string(),
}).passthrough();

const CodexWebSearchItemSchema = z.object({
  id: z.string(),
  type: z.literal("web_search"),
  query: z.string(),
}).passthrough();

const CodexTodoListItemSchema = z.object({
  id: z.string(),
  type: z.literal("todo_list"),
  items: z.array(z.object({
    text: z.string(),
    completed: z.boolean(),
  }).passthrough()),
}).passthrough();

const CodexErrorItemSchema = z.object({
  id: z.string(),
  type: z.literal("error"),
  message: z.string(),
}).passthrough();

const CodexKnownThreadItemSchema = z.discriminatedUnion("type", [
  CodexAgentMessageItemSchema,
  CodexReasoningItemSchema,
  CodexCommandExecutionItemSchema,
  CodexFileChangeItemSchema,
  CodexMcpToolCallItemSchema,
  CodexFunctionCallItemSchema,
  CodexFunctionCallOutputItemSchema,
  CodexWebSearchItemSchema,
  CodexTodoListItemSchema,
  CodexErrorItemSchema,
]);

const CodexUnknownThreadItemSchema = z.object({
  id: z.string().optional(),
  type: NonEmptyStringSchema,
}).passthrough();

const CodexKnownEventSchemas = new Map([
  ["thread.started", z.object({
    type: z.literal("thread.started"),
    thread_id: z.string(),
  }).passthrough()],
  ["turn.started", z.object({
    type: z.literal("turn.started"),
  }).passthrough()],
  ["item.started", z.object({
    type: z.literal("item.started"),
    item: z.unknown(),
  }).passthrough()],
  ["item.updated", z.object({
    type: z.literal("item.updated"),
    item: z.unknown(),
  }).passthrough()],
  ["item.completed", z.object({
    type: z.literal("item.completed"),
    item: z.unknown(),
  }).passthrough()],
  ["turn.completed", z.object({
    type: z.literal("turn.completed"),
    usage: CodexUsageSchema,
  }).passthrough()],
  ["turn.failed", z.object({
    type: z.literal("turn.failed"),
    error: z.object({ message: z.string() }).passthrough(),
  }).passthrough()],
  ["error", z.object({
    type: z.literal("error"),
    message: z.string(),
  }).passthrough()],
]);

const CodexUnknownEventSchema = z.object({
  type: NonEmptyStringSchema,
}).passthrough();

const ClaudeTextContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
}).passthrough();

const ClaudeToolUseContentBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown().optional(),
}).passthrough();

const ClaudeToolResultContentBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string().min(1),
  content: z.unknown().optional(),
}).passthrough();

const ClaudeThinkingContentBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string().optional(),
}).passthrough();

const ClaudeKnownContentBlockSchemas = new Map([
  ["text", ClaudeTextContentBlockSchema],
  ["tool_use", ClaudeToolUseContentBlockSchema],
  ["tool_result", ClaudeToolResultContentBlockSchema],
  ["thinking", ClaudeThinkingContentBlockSchema],
]);

const ClaudeContentBlockSchema = z.object({
  type: NonEmptyStringSchema,
}).passthrough().superRefine((block, context) => {
  const schema = ClaudeKnownContentBlockSchemas.get(block.type);
  if (!schema) return;
  addNestedContractIssues(context, schema.safeParse(block));
});

const ClaudeMessageSchema = z.object({
  content: z.union([z.string(), z.array(ClaudeContentBlockSchema)]),
}).passthrough();

const ClaudeTextDeltaSchema = z.object({
  type: z.literal("text_delta"),
  text: z.string(),
}).passthrough();

const ClaudeInputJsonDeltaSchema = z.object({
  type: z.literal("input_json_delta"),
  partial_json: z.string(),
}).passthrough();

const ClaudeThinkingDeltaSchema = z.object({
  type: z.literal("thinking_delta"),
  thinking: z.string(),
}).passthrough();

const ClaudeKnownDeltaSchemas = new Map([
  ["text_delta", ClaudeTextDeltaSchema],
  ["input_json_delta", ClaudeInputJsonDeltaSchema],
  ["thinking_delta", ClaudeThinkingDeltaSchema],
]);

const ClaudeStreamDeltaSchema = z.object({
  type: NonEmptyStringSchema,
}).passthrough().superRefine((delta, context) => {
  const schema = ClaudeKnownDeltaSchemas.get(delta.type);
  if (!schema) return;
  addNestedContractIssues(context, schema.safeParse(delta));
});

const ClaudeKnownStreamEventSchemas = new Map([
  ["content_block_start", z.object({
    type: z.literal("content_block_start"),
    index: z.number().int().nonnegative().optional(),
    content_block: ClaudeContentBlockSchema,
  }).passthrough()],
  ["content_block_delta", z.object({
    type: z.literal("content_block_delta"),
    index: z.number().int().nonnegative().optional(),
    delta: ClaudeStreamDeltaSchema,
  }).passthrough()],
]);

const ClaudeStreamEventSchema = z.object({
  type: NonEmptyStringSchema,
}).passthrough().superRefine((event, context) => {
  const schema = ClaudeKnownStreamEventSchemas.get(event.type);
  if (!schema) return;
  addNestedContractIssues(context, schema.safeParse(event));
});

const ClaudeKnownMessageSchemas = new Map([
  ["system:init", z.object({
    type: z.literal("system"),
    subtype: z.literal("init"),
    session_id: z.string(),
  }).passthrough()],
  ["stream_event", z.object({
    type: z.literal("stream_event"),
    event: ClaudeStreamEventSchema,
    session_id: OptionalStringSchema,
  }).passthrough()],
  ["assistant", z.object({
    type: z.literal("assistant"),
    message: ClaudeMessageSchema,
    session_id: OptionalStringSchema,
  }).passthrough()],
  ["result", z.object({
    type: z.literal("result"),
    subtype: z.enum([
      "success",
      "error_during_execution",
      "error_max_turns",
      "error_max_budget_usd",
      "error_max_structured_output_retries",
    ]),
    duration_ms: z.number(),
    duration_api_ms: z.number(),
    num_turns: z.number(),
    total_cost_usd: z.number(),
    session_id: z.string(),
  }).passthrough()],
  ["user", z.object({
    type: z.literal("user"),
    message: ClaudeMessageSchema,
    session_id: OptionalStringSchema,
  }).passthrough()],
]);

const ClaudeUnknownMessageSchema = z.object({
  type: NonEmptyStringSchema,
}).passthrough();

const CODEX_KNOWN_ITEM_TYPES = new Set([
  "agent_message",
  "reasoning",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "function_call",
  "function_call_output",
  "web_search",
  "todo_list",
  "error",
]);

export function parseCodexSdkEvent(value) {
  const type = sdkType(value);
  const schema = CodexKnownEventSchemas.get(type) || CodexUnknownEventSchema;
  const event = parseWithContract(schema, value, "Codex Agent SDK event");
  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    return {
      ...event,
      item: parseCodexThreadItem(event.item),
    };
  }
  return event;
}

export function parseCodexThreadItem(value) {
  const type = sdkType(value);
  const schema = CODEX_KNOWN_ITEM_TYPES.has(type)
    ? CodexKnownThreadItemSchema
    : CodexUnknownThreadItemSchema;
  return parseWithContract(schema, value, "Codex Agent SDK thread item");
}

export function parseClaudeSdkMessage(value) {
  const type = sdkType(value);
  const subtype = String(value?.subtype || "");
  const key = type === "system" && subtype === "init" ? "system:init" : type;
  const schema = ClaudeKnownMessageSchemas.get(key) || ClaudeUnknownMessageSchema;
  return parseWithContract(schema, value, "Claude Agent SDK message");
}

export function parseClaudeStreamEvent(value) {
  return parseWithContract(ClaudeStreamEventSchema, value, "Claude Agent SDK stream event");
}

export function parseClaudeStructuredInputToolInput(value) {
  return parseWithContract(
    ClaudeStructuredInputToolInputSchema,
    value,
    "Claude structured input tool input",
  );
}

export function parseCodexStructuredInputToolInput(value) {
  return parseWithContract(
    CodexStructuredInputToolInputSchema,
    value,
    "Codex structured input tool input",
  );
}

export function parseStructuredPromptQuestionOutput(value) {
  return parseWithContract(
    StructuredPromptQuestionOutputSchema,
    value,
    "structured input question output",
  );
}

export function parseStructuredPromptQuestionsOutput(value) {
  return parseWithContract(
    z.array(StructuredPromptQuestionOutputSchema).min(1).max(4),
    value,
    "structured input questions output",
  );
}

export function parseStructuredPromptRequestOutput(value) {
  return parseWithContract(
    StructuredPromptRequestOutputSchema,
    value,
    "structured input request output",
  );
}

export function parseClaudeStructuredInputToolOutput(value) {
  return parseWithContract(
    ClaudeStructuredInputToolOutputSchema,
    value,
    "Claude structured input tool output",
  );
}

export function parseCodexStructuredInputToolOutput(value) {
  return parseWithContract(
    CodexStructuredInputToolOutputSchema,
    value,
    "Codex structured input tool output",
  );
}

function sdkType(value) {
  return String(value?.type || "");
}

function parseWithContract(schema, value, label) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues
    .slice(0, 4)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
  throw new Error(`${label} contract violation: ${details}`);
}

function addNestedContractIssues(context, result) {
  if (result.success) return;
  for (const issue of result.error.issues) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: issue.path,
      message: issue.message,
    });
  }
}

function refineStructuredPromptInputQuestion(question, context) {
  const optionCount = Array.isArray(question.options) ? question.options.length : 0;
  if (optionCount === 0 && question.allowFreeText !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each structured input question needs choices, free text, or both.",
    });
  }
  if (optionCount === 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choice questions need at least two options.",
    });
  }
}
