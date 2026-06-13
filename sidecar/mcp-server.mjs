import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CodexStructuredInputToolZodShape,
  parseCodexStructuredInputToolInput,
  parseCodexStructuredInputToolOutput,
} from "./provider-sdk-contracts.mjs";
import {
  buildPendingUserInputToolOutput,
  createUserInputRequest,
  deleteUserInputArtifacts,
  ensureUserInputDirs,
  waitForUserInputResponse,
} from "./user-input.mjs";
import { fetchAuthenticatedAppContext } from "./auth-context.mjs";
import { persistGwsReadToMemory } from "./gws-memory.mjs";
import { requiredDocByType } from "./idd-doc-gate.mjs";
import { projectDocCandidatePaths } from "./project-doc-paths.mjs";
import {
  CODEX_STRUCTURED_INPUT_TOOL,
} from "./structured-input-tools.mjs";
import {
  recordFlatRubricAssessment,
  getRubricStatus,
} from "./rubric-assessment-host.mjs";
import { buildDay30NoGoPrompt } from "./specialists/plan-ceo-review.mjs";
import { redactRubricStatus } from "./rubric-redact.mjs";
import {
  isSecretFilename,
  isSecretPath,
  redactSecrets,
  SEARCH_EXCLUDE_GLOBS,
} from "./workspace-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarRoot = path.resolve(__dirname);
process.env.AGENTIC30_SIDECAR_ROOT ??= sidecarRoot;
const workspaceRoot = path.resolve(readArg("--workspace") ?? process.cwd());
const workspaceRootRealpath = await fs.realpath(workspaceRoot);
const sessionId = readArg("--session") ?? "unknown";
const appSupportPath = process.env.AGENTIC30_APP_SUPPORT_PATH
  ? path.resolve(process.env.AGENTIC30_APP_SUPPORT_PATH)
  : path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "agentic30",
    );
const approvedToolExecution = process.env.AGENTIC30_APPROVED_TOOL_EXECUTION === "1";
const executionMode = String(process.env.AGENTIC30_EXECUTION_MODE || "");
const gwsWriteApprovalTimeoutMs = Number.parseInt(
  process.env.AGENTIC30_GWS_WRITE_APPROVAL_TIMEOUT_MS || "",
  10,
) || 5 * 60 * 1000;
const OFFICE_HOURS_QUESTION_EXECUTION_MODE = "office_hours_question";

const server = new McpServer({
  name: "agentic30",
  version: "0.1.0",
});

await ensureUserInputDirs(appSupportPath);

const structuredPromptSchema = CodexStructuredInputToolZodShape;

server.tool(
  "get_agentic30_context",
  "Return high-signal app and workspace context for the current multi-session chat.",
  {},
  async () => {
    const authenticatedContext = await fetchAuthenticatedAppContext();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessionId,
              workspaceRoot,
              timestamp: new Date().toISOString(),
              authenticatedContext,
              capabilities: [
                "get_agentic30_context",
                "list_workspace_files",
                "read_workspace_file",
                "search_workspace",
                "get_bip_context",
                "read_project_doc",
                "get_social_context",
                ...(GWS_BIN
                  ? [
                      ...(approvedToolExecution ? ["gws_gmail_send"] : []),
                      "gws_gmail_list",
                      "gws_gmail_read",
                      "gws_drive_list",
                      "gws_calendar_list",
                      "gws_sheets_read",
                      "gws_docs_read",
                    ]
                  : []),
              ],
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

registerUserInputTool(
  CODEX_STRUCTURED_INPUT_TOOL,
  "Ask the host app for structured user input before continuing. Use this tool from Codex sidecar sessions.",
);
registerUserInputTool(
  "AskUserQuestion",
  "Ask the host app a structured question and wait for the user's answer before continuing.",
);
registerUserInputTool(
  "ask_user_question",
  "Ask the host app a structured question and wait for the user's answer before continuing.",
);

server.tool(
  "list_workspace_files",
  "List files within the workspace. Paths are always relative to the workspace root.",
  {
    relativePath: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async ({ relativePath = ".", limit = 80 }) => {
    const targetPath = await resolveWorkspacePath(relativePath);
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !entry.name.startsWith(".git") && !isSecretFilename(entry.name))
      .slice(0, limit)
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              relativePath,
              items: visible,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "read_workspace_file",
  "Read a UTF-8 text file inside the workspace root.",
  {
    relativePath: z.string(),
    maxChars: z.number().int().min(200).max(20000).optional(),
  },
  async ({ relativePath, maxChars = 8000 }) => {
    if (isSecretPath(relativePath)) {
      return {
        content: [
          {
            type: "text",
            text: `Refused: "${relativePath}" looks like a secret/credential file and is blocked from reads.`,
          },
        ],
      };
    }
    const filePath = await resolveWorkspacePath(relativePath);
    const content = await fs.readFile(filePath, "utf8");
    return {
      content: [
        {
          type: "text",
          text: redactSecrets(content.slice(0, maxChars)),
        },
      ],
    };
  },
);

server.tool(
  "search_workspace",
  "Search the workspace using ripgrep and return matching lines.",
  {
    query: z.string().min(1),
    glob: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async ({ query, glob, limit = 60 }) => {
    const args = ["-n", "--no-heading", "--color", "never"];
    for (const exclude of SEARCH_EXCLUDE_GLOBS) {
      args.push("-g", exclude);
    }
    if (glob) {
      args.push("-g", glob);
    }
    args.push(query, workspaceRootRealpath);

    const output = await execCapture("rg", args);
    const lines = output
      .split("\n")
      .filter(Boolean)
      // rg output is `path:line:content` — drop any hit whose file is a secret
      // path that slipped past the glob excludes, then redact the line content.
      .filter((line) => {
        const filePart = line.split(":", 1)[0];
        const relative = path.relative(workspaceRootRealpath, filePart);
        return !isSecretPath(relative || filePart);
      })
      .slice(0, limit)
      .map((line) => redactSecrets(line))
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: lines || "No matches found.",
        },
      ],
    };
  },
);

// MARK: - BIP (Build In Public) Tools

server.tool(
  "get_bip_context",
  "Return BIP (Build In Public) configuration: project doc paths, external doc URLs, and social handles.",
  {},
  async () => {
    const bipConfig = readJsonFile(
      path.join(appSupportPath, "bip-config.json"),
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            bipConfig || { error: "BIP not configured. Open Settings > Build In Public to set up." },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "read_project_doc",
  "Read a BIP project document by role (icp, spec, values, designSystem, adr, goal, docs, sheet). For directories, optionally specify a filename to read a specific file.",
  {
    role: z.enum(["icp", "spec", "values", "designSystem", "adr", "goal", "docs", "sheet"]),
    filename: z.string().optional(),
    maxChars: z.number().int().min(200).max(20000).optional(),
  },
  async ({ role, filename, maxChars = 8000 }) => {
    const bipConfig = readJsonFile(
      path.join(appSupportPath, "bip-config.json"),
    );
    const roleDoc = requiredDocByType(role);
    const candidatePaths = projectDocCandidatePaths(role);
    if (!bipConfig?.workspace?.root && !workspaceRoot) {
      return {
        content: [
          {
            type: "text",
            text: `BIP ${role} path not configured. Open Settings > Build In Public to set it up.`,
          },
        ],
      };
    }

    const bipRoot = path.resolve(bipConfig?.workspace?.root || workspaceRoot);
    let relativeDocPath = candidatePaths[0] || roleDoc?.canonicalPath || "";

    try {
      const bipRootRealpath = await fs.realpath(bipRoot);
      let safeDocPath = null;
      let stat = null;
      let lastError = null;
      for (const candidate of candidatePaths) {
        try {
          const docPath = path.resolve(bipRoot, candidate || ".");
          assertInside(bipRoot, docPath, "Path must stay inside the BIP workspace root.");
          const candidateSafePath = await resolveInsideRealpath(
            bipRootRealpath,
            docPath,
            "Path must stay inside the BIP workspace root.",
          );
          const candidateStat = await fs.stat(candidateSafePath);
          safeDocPath = candidateSafePath;
          stat = candidateStat;
          relativeDocPath = candidate;
          break;
        } catch (error) {
          if (/Path must stay inside|Path traversal blocked/i.test(String(error?.message || ""))) {
            throw error;
          }
          lastError = error;
        }
      }
      if (!safeDocPath || !stat) {
        throw lastError || new Error(`Canonical project doc not found at ${relativeDocPath}. Only .agentic30/docs/* project docs are used.`);
      }

      if (stat.isDirectory()) {
        if (filename) {
          const filePath = path.resolve(safeDocPath, filename);
          assertInside(safeDocPath, filePath, "Path traversal blocked.");
          const safeFilePath = await resolveInsideRealpath(safeDocPath, filePath, "Path traversal blocked.");
          const content = await fs.readFile(safeFilePath, "utf8");
          return {
            content: [{ type: "text", text: content.slice(0, maxChars) }],
          };
        }
        const entries = await fs.readdir(safeDocPath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { directory: relativeDocPath, files: entries },
                null,
                2,
              ),
            },
          ],
        };
      }

      const content = await fs.readFile(safeDocPath, "utf8");
      return {
        content: [{ type: "text", text: content.slice(0, maxChars) }],
      };
    } catch (err) {
      const missingMessage = /ENOENT|no such file or directory/i.test(String(err?.message || ""))
        ? `Canonical project doc missing at "${relativeDocPath}". Only .agentic30/docs/* project docs are used.`
        : `Failed to read ${role} at "${relativeDocPath}": ${err.message}`;
      return {
        content: [
          {
            type: "text",
            text: missingMessage,
          },
        ],
      };
    }
  },
);

server.tool(
  "get_social_context",
  "Return configured social media handles and profile URLs for BIP context.",
  {},
  async () => {
    const bipConfig = readJsonFile(
      path.join(appSupportPath, "bip-config.json"),
    );
    const social = bipConfig?.social ?? {};
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              threads: social.threads
                ? {
                    handle: `@${social.threads}`,
                    url: `https://threads.net/@${social.threads}`,
                  }
                : null,
              x: social.x
                ? {
                    handle: `@${social.x}`,
                    url: `https://x.com/${social.x}`,
                  }
                : null,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

function registerUserInputTool(name, description) {
  server.tool(name, description, structuredPromptSchema, async (rawInput) => {
    const { title, intro, resources, questions } = parseCodexStructuredInputToolInput(rawInput);
    const request = await createUserInputRequest(appSupportPath, {
      sessionId,
      toolName: name,
      title: title ?? null,
      intro: intro ?? null,
      resources: resources ?? null,
      questions,
    });

    if (executionMode === OFFICE_HOURS_QUESTION_EXECUTION_MODE && name === CODEX_STRUCTURED_INPUT_TOOL) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(buildPendingUserInputToolOutput(request), null, 2),
          },
        ],
      };
    }

    try {
      const response = await waitForUserInputResponse(appSupportPath, {
        sessionId,
        requestId: request.requestId,
        signal: AbortSignal.timeout(1000 * 60 * 30),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              parseCodexStructuredInputToolOutput({
                requestId: request.requestId,
                title: request.title,
                questions: request.questions,
                answers: response.answers ?? {},
                annotations: response.annotations ?? {},
                responses: response.responses ?? [],
              }),
              null,
              2,
            ),
          },
        ],
      };
    } finally {
      await deleteUserInputArtifacts(appSupportPath, sessionId, request.requestId);
    }
  });
}

// MARK: - Google Workspace (GWS) Tools

function resolveGwsBin() {
  const override = process.env.AGENTIC30_GWS_BIN;
  if (override && fsSync.existsSync(override)) {
    return override;
  }
  const pathEntries = (process.env.PATH || "/usr/bin:/bin").split(path.delimiter);
  for (const dir of pathEntries) {
    if (!dir) continue;
    const candidate = path.join(dir, "gws");
    try {
      fsSync.accessSync(candidate, fsSync.constants.X_OK);
      return candidate;
    } catch {
      // not found; keep searching
    }
  }
  return null;
}

const GWS_BIN = resolveGwsBin();

function gwsExec(args) {
  if (!GWS_BIN) {
    return Promise.reject(
      new Error(
        "`gws` CLI not found on PATH. Install it or set AGENTIC30_GWS_BIN.",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(GWS_BIN, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `gws exited with code ${code}`));
      }
    });
  });
}

if (GWS_BIN) {
  registerGwsTools();
}

async function requestGwsGmailSendApproval({ to, subject, body, cc, bcc }) {
  const safe = sanitizeGwsGmailHeaders({ to, subject, cc, bcc });
  const question = [
    "Send Gmail message?",
    `To: ${safe.to}`,
    safe.cc ? `Cc: ${safe.cc}` : null,
    safe.bcc ? `Bcc: ${safe.bcc}` : null,
    `Subject: ${safe.subject}`,
    `Body: ${truncateForPreview(body, 180)}`,
  ].filter(Boolean).join("\n").slice(0, 400);
  const request = await createUserInputRequest(appSupportPath, {
    sessionId,
    toolName: "gws_gmail_send",
    title: "Approve Gmail send",
    questions: [
      {
        header: "Gmail",
        question,
        options: [
          {
            label: "Approve send",
            description: "Send this Gmail message with the shown recipients and body preview.",
          },
          {
            label: "Deny",
            description: "Do not send this Gmail message.",
          },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    ],
  });

  try {
    const response = await waitForUserInputResponse(appSupportPath, {
      sessionId,
      requestId: request.requestId,
      signal: AbortSignal.timeout(gwsWriteApprovalTimeoutMs),
    });
    return {
      approved: userInputApprovedSend(response),
      reason: userInputApprovedSend(response) ? "approved" : "denied",
    };
  } catch (err) {
    return {
      approved: false,
      reason: err?.name === "AbortError" ? "approval_timeout" : "approval_failed",
    };
  } finally {
    await deleteUserInputArtifacts(appSupportPath, sessionId, request.requestId);
  }
}

function sanitizeGwsGmailHeaders({ to, subject, cc, bcc }) {
  const safe = {
    to: sanitizeGwsHeaderValue(to, 500),
    subject: sanitizeGwsHeaderValue(subject, 200),
    cc: sanitizeGwsHeaderValue(cc, 500),
    bcc: sanitizeGwsHeaderValue(bcc, 500),
  };
  if (!safe.to || !safe.subject) {
    throw new Error("gws_gmail_send requires non-empty to and subject after sanitization");
  }
  return safe;
}

function sanitizeGwsHeaderValue(value, max) {
  const text = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function userInputApprovedSend(response) {
  const selected = [
    ...Object.values(response?.answers || {}),
    ...(response?.responses || []).flatMap((entry) => entry?.selectedOptions || []),
  ].map((value) => String(value).trim().toLowerCase());
  return selected.includes("approve send");
}

function truncateForPreview(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function registerGwsTools() {
if (approvedToolExecution) {
server.tool(
  "gws_gmail_send",
  "Send an email via Gmail after explicit host-app approval.",
  {
    to: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    cc: z.string().optional(),
    bcc: z.string().optional(),
  },
  async ({ to, subject, body, cc, bcc }) => {
    const safeHeaders = sanitizeGwsGmailHeaders({ to, subject, cc, bcc });
    const approval = await requestGwsGmailSendApproval({ ...safeHeaders, body });
    if (!approval.approved) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              cancelled: true,
              reason: approval.reason,
            }, null, 2),
          },
        ],
      };
    }
    const args = ["gmail", "+send", "--to", safeHeaders.to, "--subject", safeHeaders.subject, "--body", body];
    if (safeHeaders.cc) args.push("--cc", safeHeaders.cc);
    if (safeHeaders.bcc) args.push("--bcc", safeHeaders.bcc);
    const output = await gwsExec(args);
    return {
      content: [{ type: "text", text: output || "Email sent." }],
    };
  },
);
}

server.tool(
  "gws_gmail_list",
  "List recent Gmail messages. Returns sender, subject, and date.",
  {
    query: z.string().optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
  },
  async ({ query, maxResults = 10 }) => {
    const params = { userId: "me", maxResults };
    if (query) params.q = query;
    const output = await gwsExec([
      "gmail", "users", "messages", "list",
      "--params", JSON.stringify(params),
      "--format", "json",
    ]);
    return {
      content: [{ type: "text", text: output || "No messages found." }],
    };
  },
);

server.tool(
  "gws_gmail_read",
  "Read a specific Gmail message by ID.",
  {
    messageId: z.string().min(1),
  },
  async ({ messageId }) => {
    const output = await gwsExec([
      "gmail", "+read", "--message-id", messageId,
      "--format", "json",
    ]);
    return {
      content: [{ type: "text", text: output || "Message not found." }],
    };
  },
);

server.tool(
  "gws_drive_list",
  "List files in Google Drive.",
  {
    query: z.string().optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  },
  async ({ query, pageSize = 20 }) => {
    const params = { pageSize };
    if (query) params.q = query;
    const output = await gwsExec([
      "drive", "files", "list",
      "--params", JSON.stringify(params),
      "--format", "json",
    ]);
    return {
      content: [{ type: "text", text: output || "No files found." }],
    };
  },
);

server.tool(
  "gws_calendar_list",
  "List upcoming calendar events.",
  {
    maxResults: z.number().int().min(1).max(50).optional(),
    timeMin: z.string().optional(),
  },
  async ({ maxResults = 10, timeMin }) => {
    const params = {
      calendarId: "primary",
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: timeMin || new Date().toISOString(),
    };
    const output = await gwsExec([
      "calendar", "events", "list",
      "--params", JSON.stringify(params),
      "--format", "json",
    ]);
    return {
      content: [{ type: "text", text: output || "No events found." }],
    };
  },
);

server.tool(
  "gws_sheets_read",
  "Read data from a Google Sheets spreadsheet.",
  {
    spreadsheetId: z.string().min(1),
    range: z.string().optional(),
  },
  async ({ spreadsheetId, range }) => {
    if (range) {
      const output = await gwsExec([
        "sheets", "spreadsheets", "values", "get",
        "--params", JSON.stringify({ spreadsheetId, range }),
        "--format", "json",
      ]);
      await persistGwsOutput({
        kind: "sheet",
        id: spreadsheetId,
        range,
        output,
      });
      return {
        content: [{ type: "text", text: output || "No data found." }],
      };
    }
    const output = await gwsExec([
      "sheets", "spreadsheets", "get",
      "--params", JSON.stringify({ spreadsheetId }),
      "--format", "json",
    ]);
    await persistGwsOutput({
      kind: "sheet",
      id: spreadsheetId,
      output,
    });
    return {
      content: [{ type: "text", text: output || "Spreadsheet not found." }],
    };
  },
);

server.tool(
  "gws_docs_read",
  "Read the content of a Google Doc by document ID.",
  {
    documentId: z.string().min(1),
  },
  async ({ documentId }) => {
    const output = await gwsExec([
      "docs", "documents", "get",
      "--params", JSON.stringify({ documentId }),
      "--format", "json",
    ]);
    await persistGwsOutput({
      kind: "doc",
      id: documentId,
      output,
    });
    return {
      content: [{ type: "text", text: output || "Document not found." }],
    };
  },
);
}

async function persistGwsOutput({ kind, id, range = "", output }) {
  try {
    const text = String(output || "").trim();
    if (!text) return;
    await persistGwsReadToMemory({
      appSupportPath,
      sidecarRoot,
      kind,
      id,
      range,
      payload: JSON.parse(text),
    });
  } catch {
    // MEMORY persistence is best-effort. Never fail the user's live GWS read.
  }
}

// MARK: - Alignment Rubric Tools (5-axis Day 0/30 self-assessment)

const rubricEvidenceRefSchema = z.object({
  type: z.enum(["session_message", "doc_path", "external_link"]),
  ref: z.string().min(1),
  quote_excerpt: z.string().max(2000).optional(),
});

server.tool(
  "record_rubric_assessment",
  [
    "Record a Day 0 or Day 30 5-axis (Definition/Command/Clout/Responsibility/Adaptability) self-assessment for the current workspace. Hydrates anchor_text from the sidecar anchor schema and persists.",
    "",
    "Workflow:",
    "1. Ask the user each axis score 1-5 with the built-in anchor text.",
    "2. For any axis with score >= 3, scan recent session messages, project doc changes, and BIP entries for 1-3 candidate evidence_refs and surface them to the user as \"이 내용을 근거로 활용할까요?\" rather than asking them to type evidence from scratch.",
    "3. For Day 30, every axis needs either evidence_refs or a no_evidence_reason explaining why the user can't cite evidence (Day 0 baseline is allowed loose).",
    "4. Persist via this tool.",
    "5. If day === 30, immediately follow up with the Day 30 결산 prompt: 지속(Continue) / 전환(Pivot) / 중단(Stop). Each option also asks for a one-line nextAction so the decision lands as the start of the next cycle, not as a blank. See `buildDay30NoGoPrompt` in sidecar/specialists/plan-ceo-review.mjs.",
  ].join("\n"),
  {
    sessionId: z.string().min(1),
    day: z.union([z.literal(0), z.literal(30)]),
    axes: z.object({
      definition: z.number().int().min(1).max(5),
      command: z.number().int().min(1).max(5),
      clout: z.number().int().min(1).max(5),
      responsibility: z.number().int().min(1).max(5),
      adaptability: z.number().int().min(1).max(5),
    }),
    evidence: z
      .object({
        definition: z.array(rubricEvidenceRefSchema).optional(),
        command: z.array(rubricEvidenceRefSchema).optional(),
        clout: z.array(rubricEvidenceRefSchema).optional(),
        responsibility: z.array(rubricEvidenceRefSchema).optional(),
        adaptability: z.array(rubricEvidenceRefSchema).optional(),
      })
      .optional(),
    no_evidence_reasons: z
      .object({
        definition: z.string().min(1).max(500).optional(),
        command: z.string().min(1).max(500).optional(),
        clout: z.string().min(1).max(500).optional(),
        responsibility: z.string().min(1).max(500).optional(),
        adaptability: z.string().min(1).max(500).optional(),
      })
      .optional(),
    notes: z.string().max(4000).optional(),
  },
  async ({ sessionId, day, axes, evidence, no_evidence_reasons, notes }) => {
    try {
      const result = await recordFlatRubricAssessment({
        workspaceRoot,
        sessionId,
        day,
        axes,
        evidence: evidence || {},
        noEvidenceReasons: no_evidence_reasons || {},
        notes,
      });
      // Round 6 / CCG-Gemini "보상 없는 엔딩" 차단: Day 30 record가 저장되면
      // 즉시 결산 prompt(지속/전환/중단 + nextAction)를 응답에 동봉. 이는
      // buildDay30NoGoPrompt가 dead helper에서 실 사용 surface로 이동한 것.
      // raw evidence/notes는 prompt body에 절대 들어가지 않음 — helper가 이미
      // delta(숫자) + axis별 no_evidence_reason 한 줄만 사용.
      let day30NoGoPrompt = null;
      if (result.record.day === 30) {
        try {
          const status = await getRubricStatus(workspaceRoot);
          day30NoGoPrompt = buildDay30NoGoPrompt({ rubricStatus: status });
        } catch {
          // Prompt failure must never block persistence success.
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                filePath: result.filePath,
                day: result.record.day,
                sessionId: result.record.sessionId,
                recordedAt: result.record.recordedAt,
                ...(day30NoGoPrompt ? { day30NoGoPrompt } : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: false, error: err?.message || String(err) },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
);

server.tool(
  "get_rubric_status",
  "Return a redacted summary of the latest Day 0 / Day 30 records: only `sessionId`, `day`, `recordedAt`, axis scores, and the within-person delta. Raw evidence_refs, anchor_text, no_evidence_reason, and notes stay LOCAL — read them directly from `<workspace>/.agentic30/rubric-assessments.json` if needed.",
  {},
  async () => {
    try {
      const status = await getRubricStatus(workspaceRoot);
      return {
        content: [
          { type: "text", text: JSON.stringify(redactRubricStatus(status), null, 2) },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: false, error: err?.message || String(err) },
              null,
              2,
            ),
          },
        ],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertInside(parent, resolved, message) {
  const rel = path.relative(parent, resolved);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(message);
  }
}

async function resolveWorkspacePath(relativePath) {
  const resolved = path.resolve(workspaceRoot, relativePath);
  assertInside(workspaceRoot, resolved, "Path must stay inside the workspace root.");
  return resolveInsideRealpath(
    workspaceRootRealpath,
    resolved,
    "Path must stay inside the workspace root.",
  );
}

async function resolveInsideRealpath(parentRealpath, candidate, message) {
  const real = await fs.realpath(candidate);
  assertInside(parentRealpath, real, message);
  return real;
}

function readJsonFile(filePath) {
  try {
    if (!fsSync.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function execCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || code === 1) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
  });
}
