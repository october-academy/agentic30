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
  createUserInputRequest,
  deleteUserInputArtifacts,
  ensureUserInputDirs,
  waitForUserInputResponse,
} from "./user-input.mjs";
import { fetchAuthenticatedAppContext } from "./auth-context.mjs";
import { persistGwsReadToMemory } from "./gws-memory.mjs";
import { requiredDocByType } from "./idd-doc-gate.mjs";
import {
  CODEX_STRUCTURED_INPUT_TOOL,
} from "./structured-input-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidecarRoot = path.resolve(__dirname);
process.env.AGENTIC30_SIDECAR_ROOT ??= sidecarRoot;
const workspaceRoot = path.resolve(readArg("--workspace") ?? process.cwd());
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

const server = new McpServer({
  name: "agentic30",
  version: "0.1.0",
});

await ensureUserInputDirs(appSupportPath);

const structuredOptionSchema = z.object({
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(280),
  preview: z.string().max(4000).optional(),
});

const structuredQuestionSchema = z
  .object({
    header: z.string().min(1).max(32),
    question: z.string().min(1).max(400),
    options: z.array(structuredOptionSchema).min(2).max(4).optional(),
    multiSelect: z.boolean().default(false),
    allowFreeText: z.boolean().default(false),
    freeTextPlaceholder: z.string().max(280).optional(),
    textMode: z.enum(["short", "long"]).optional(),
  })
  .superRefine((question, context) => {
    if ((!question.options || question.options.length === 0) && !question.allowFreeText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each question needs choices, free text, or both.",
      });
    }
  });

const structuredPromptSchema = {
  title: z.string().max(120).optional(),
  questions: z.array(structuredQuestionSchema).min(1).max(4),
};

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
                      ...(approvedToolExecution ? ["gws_exec", "gws_gmail_send"] : []),
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
    const targetPath = resolveWorkspacePath(relativePath);
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const visible = entries
      .filter((entry) => !entry.name.startsWith(".git"))
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
    const filePath = resolveWorkspacePath(relativePath);
    const content = await fs.readFile(filePath, "utf8");
    return {
      content: [
        {
          type: "text",
          text: content.slice(0, maxChars),
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
    const args = ["-n", "--no-heading", "--color", "never", query];
    if (glob) {
      args.push("-g", glob);
    }
    args.push(workspaceRoot);

    const output = await execCapture("rg", args);
    const lines = output
      .split("\n")
      .filter(Boolean)
      .slice(0, limit)
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
    const relativeDocPath = bipConfig?.workspace?.[role] || roleDoc?.canonicalPath;
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

    const bipRoot = bipConfig?.workspace?.root || workspaceRoot;
    const docPath = path.resolve(bipRoot, relativeDocPath);

    // Safety: must stay inside workspace root
    assertInside(bipRoot, docPath, "Path must stay inside the BIP workspace root.");

    try {
      const stat = await fs.stat(docPath);

      if (stat.isDirectory()) {
        if (filename) {
          const filePath = path.resolve(docPath, filename);
          assertInside(docPath, filePath, "Path traversal blocked.");
          const content = await fs.readFile(filePath, "utf8");
          return {
            content: [{ type: "text", text: content.slice(0, maxChars) }],
          };
        }
        const entries = await fs.readdir(docPath);
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

      const content = await fs.readFile(docPath, "utf8");
      return {
        content: [{ type: "text", text: content.slice(0, maxChars) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to read ${role} at "${relativeDocPath}": ${err.message}`,
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
  server.tool(name, description, structuredPromptSchema, async ({ title, questions }) => {
    const request = await createUserInputRequest(appSupportPath, {
      sessionId,
      toolName: name,
      title: title ?? null,
      questions,
    });

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
              {
                requestId: request.requestId,
                title: request.title,
                questions: request.questions,
                answers: response.answers ?? {},
                annotations: response.annotations ?? {},
                responses: response.responses ?? [],
              },
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

function registerGwsTools() {
if (approvedToolExecution) {
server.tool(
  "gws_exec",
  "Run any Google Workspace CLI command. Pass the full argument list (e.g. ['gmail', '+send', '--to', 'user@example.com', '--subject', 'Hi', '--body', 'Hello']). Returns JSON output.",
  {
    args: z.array(z.string()).min(1),
  },
  async ({ args }) => {
    const output = await gwsExec([...args, "--format", "json"]);
    return {
      content: [{ type: "text", text: output || "Command completed with no output." }],
    };
  },
);

server.tool(
  "gws_gmail_send",
  "Send an email via Gmail.",
  {
    to: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    cc: z.string().optional(),
    bcc: z.string().optional(),
  },
  async ({ to, subject, body, cc, bcc }) => {
    const args = ["gmail", "+send", "--to", to, "--subject", subject, "--body", body];
    if (cc) args.push("--cc", cc);
    if (bcc) args.push("--bcc", bcc);
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

function resolveWorkspacePath(relativePath) {
  const resolved = path.resolve(workspaceRoot, relativePath);
  assertInside(workspaceRoot, resolved, "Path must stay inside the workspace root.");
  return resolved;
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
