import path from "node:path";
import { fileURLToPath } from "node:url";

export function ensureAbsolutePathWithinCwd(cwd, targetPath) {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedCwd, resolvedTarget);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path "${resolvedTarget}" is outside the session cwd.`);
  }
  return resolvedTarget;
}

export function extractPromptContext(promptBlocks) {
  const promptTexts = [];
  const resources = [];

  for (const block of promptBlocks || []) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "text" && typeof block.text === "string") {
      promptTexts.push(block.text.trim());
      continue;
    }

    if (block.type === "resource" && block.resource) {
      const resource = block.resource;
      const resourcePath = filePathFromUri(resource.uri);
      resources.push({
        path: resourcePath,
        uri: resource.uri,
        mimeType: resource.mimeType || "text/plain",
        text: typeof resource.text === "string" ? resource.text : null,
      });
      continue;
    }

    if (block.type === "resource_link") {
      const resourcePath = filePathFromUri(block.uri);
      resources.push({
        path: resourcePath,
        uri: block.uri,
        mimeType: block.mimeType || "text/plain",
        text: null,
      });
    }
  }

  return {
    promptText: promptTexts.filter(Boolean).join("\n\n").trim(),
    resources,
  };
}

export function buildProviderPrompt({ promptText, fileContexts }) {
  const lines = [
    "You are editing files on behalf of an ACP client.",
    "Return exactly one JSON object with this shape:",
    '{"message":"short markdown summary","edits":[{"fileId":"file_1","content":"full replacement text"}]}',
    "Rules:",
    "- The JSON must be valid and contain no surrounding markdown fences.",
    "- Only include edits for fileIds that appear in the provided context.",
    "- If no edit is needed, return an empty edits array.",
    "- Preserve content you are not intentionally changing.",
    "- Never reference files outside the provided fileIds.",
    "",
    "User request:",
    promptText || "(no explicit text prompt provided)",
  ];

  if (fileContexts.length) {
    lines.push("");
    lines.push("File context:");
    for (const file of fileContexts) {
      lines.push(`<<FILE_ID:${file.fileId}>>`);
      lines.push(`Display name: ${file.displayName}`);
      lines.push(file.content);
      lines.push("<<END_FILE>>");
    }
  }

  return lines.join("\n");
}

export function parseAgentJsonResponse(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { message: "", edits: [] };
  }

  try {
    return normalizeAgentResult(JSON.parse(trimmed));
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) {
      return normalizeAgentResult(JSON.parse(fenced[1]));
    }
  }

  return {
    message: trimmed,
    edits: [],
  };
}

function normalizeAgentResult(value) {
  const edits = Array.isArray(value?.edits)
    ? value.edits
        .filter(
          (edit) =>
            edit &&
            (typeof edit.fileId === "string" || typeof edit.path === "string") &&
            typeof edit.content === "string",
        )
        .map((edit) => ({
          fileId: typeof edit.fileId === "string" ? edit.fileId : null,
          path: edit.path,
          content: edit.content,
        }))
    : [];

  return {
    message: typeof value?.message === "string" ? value.message : "",
    edits,
  };
}

function filePathFromUri(uri) {
  if (!uri || typeof uri !== "string") return null;
  if (uri.startsWith("file://")) {
    return fileURLToPath(uri);
  }
  return null;
}
