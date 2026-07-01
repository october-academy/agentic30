export const RECORDER_REDACTION_SAFE_STATUSES = Object.freeze([
  "redacted",
  "safe",
  "safe_redacted",
  "allowlisted",
]);

const SAFE_STATUS_SET = new Set(RECORDER_REDACTION_SAFE_STATUSES);
const UNSAFE_TEXT_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:api[_-]?key|oauth|secret|token|password)\s*[:=]|\b(?:sk-[A-Za-z0-9_-]{16,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{48,})\b|(?<![\p{L}\p{N}])(?:\+\d[\d\s().-]{7,}\d|\d(?:[\s().-]+\d){7,})(?![\p{L}\p{N}])/iu;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/giu;
const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|oauth|secret|token|password)\s*[:=]\s*[^\s,;]+/giu;
const TOKEN_LIKE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{48,})\b/gu;
const PHONE_PATTERN = /(?<![\p{L}\p{N}])(?:\+?\d[\d\s().-]{7,}\d)(?![\p{L}\p{N}])/gu;
const LOCAL_PATH_PATTERN = /(?:~\/|\/Users\/|\/private\/|\/var\/|\/tmp\/|[A-Z]:\\)[^\s<>"')]+/giu;
const METADATA_LABEL_COLUMNS = new Set(["browser_url_search_label", "document_path_search_label"]);

export const RECORDER_REDACTION_POLICY_MATRIX = Object.freeze({
  frames: Object.freeze({
    redactionStatusColumn: "redaction_status",
    publicTextColumns: Object.freeze([
      "redacted_text",
      "app_name",
      "window_title",
      "browser_domain",
      "browser_url_search_label",
      "document_path_search_label",
    ]),
    sinks: Object.freeze({
      search: Object.freeze({ flagColumn: "safe_for_search", requiredTextColumns: Object.freeze(["redacted_text"]) }),
      memory: Object.freeze({ flagColumn: "safe_for_memory", requiredTextColumns: Object.freeze(["redacted_text"]) }),
      export: Object.freeze({ flagColumn: "safe_for_export", requiredTextColumns: Object.freeze(["redacted_text"]) }),
    }),
  }),
  transcript_segments: Object.freeze({
    redactionStatusColumn: "redaction_status",
    publicTextColumns: Object.freeze(["redacted_text", "speaker_label"]),
    sinks: Object.freeze({
      search: Object.freeze({ flagColumn: "safe_for_search", requiredTextColumns: Object.freeze(["redacted_text"]) }),
      memory: Object.freeze({ flagColumn: "safe_for_memory", requiredTextColumns: Object.freeze(["redacted_text"]) }),
    }),
  }),
  clipboard_events: Object.freeze({
    redactionStatusColumn: "redaction_status",
    publicTextColumns: Object.freeze(["redacted_text", "source_app_name", "source_window_title"]),
    sinks: Object.freeze({
      search: Object.freeze({ flagColumn: "safe_for_search", requiredTextColumns: Object.freeze(["redacted_text"]) }),
      memory: Object.freeze({ flagColumn: "safe_for_memory", requiredTextColumns: Object.freeze(["redacted_text"]) }),
      export: Object.freeze({ flagColumn: "safe_for_export", requiredTextColumns: Object.freeze(["redacted_text"]) }),
    }),
  }),
  memory_items: Object.freeze({
    redactionStatusColumn: "redaction_status",
    publicTextColumns: Object.freeze(["title", "summary"]),
    sinks: Object.freeze({
      search: Object.freeze({ flagColumn: "safe_for_search", requiredTextColumns: Object.freeze(["title", "summary"]) }),
      memory: Object.freeze({ flagColumn: "safe_for_memory", requiredTextColumns: Object.freeze(["title", "summary"]) }),
      export: Object.freeze({ flagColumn: "safe_for_export", requiredTextColumns: Object.freeze(["title", "summary"]) }),
    }),
  }),
  product_events: Object.freeze({
    redactionStatusColumn: null,
    publicTextColumns: Object.freeze(["title", "summary"]),
    sinks: Object.freeze({
      search: Object.freeze({ flagColumn: "safe_for_search", requiredTextColumns: Object.freeze(["title", "summary"]) }),
      memory: Object.freeze({ flagColumn: "safe_for_memory", requiredTextColumns: Object.freeze(["title", "summary"]) }),
      export: Object.freeze({ flagColumn: "safe_for_export", requiredTextColumns: Object.freeze(["title", "summary"]) }),
    }),
  }),
});

export function assertRecorderRedactionPolicyForRecord(
  tableName,
  record = {},
  {
    currentRecord = null,
    fail = defaultFail,
  } = {},
) {
  const policy = RECORDER_REDACTION_POLICY_MATRIX[tableName];
  if (!policy) return;
  const merged = { ...(currentRecord || {}), ...(record || {}) };

  for (const [sink, sinkPolicy] of Object.entries(policy.sinks)) {
    if (!isEnabled(merged[sinkPolicy.flagColumn])) continue;
    assertSinkRedactionPolicy({
      tableName,
      sink,
      sinkPolicy,
      policy,
      record: merged,
      fail,
    });
  }
}

export function redactRecorderPublicText(
  value,
  {
    maxLength = 500,
    fail = defaultFail,
  } = {},
) {
  let text = cleanText(value);
  if (!text) return null;
  text = text
    .replace(URL_PATTERN, (match) => {
      try {
        return new URL(match).hostname || "[redacted-url]";
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "[redacted-secret]")
    .replace(TOKEN_LIKE_PATTERN, "[redacted-token]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(LOCAL_PATH_PATTERN, "[redacted-path]");
  text = cleanText(text).slice(0, maxLength).trim();
  if (!text) return null;
  if (UNSAFE_TEXT_PATTERN.test(text) || containsRawMetadataLocator(text)) {
    fail("ERR_RECORDER_REDACTION_ADAPTER_UNSAFE_OUTPUT", "recorder redaction adapter produced unsafe public text", {
      maxLength,
      max_length: maxLength,
    });
  }
  return text;
}

export function assertRecorderPublicTextSafe(
  value,
  {
    fail = defaultFail,
    tableName = "",
    sink = "",
    column = "",
  } = {},
) {
  const text = cleanText(value);
  if (!text) return;
  const details = {
    tableName: cleanText(tableName) || null,
    table_name: cleanText(tableName) || null,
    sink: cleanText(sink) || null,
    column: cleanText(column) || null,
  };
  if (UNSAFE_TEXT_PATTERN.test(text)) {
    fail("ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT", "recorder public text contains unsafe text", details);
  }
  if (containsRawPublicTextLocator(text)) {
    fail("ERR_RECORDER_REDACTION_POLICY_UNSAFE_PUBLIC_LOCATOR", "recorder public text contains a raw URL or local path", details);
  }
}

function assertSinkRedactionPolicy({ tableName, sink, sinkPolicy, policy, record, fail }) {
  if (policy.redactionStatusColumn) {
    const redactionStatus = cleanText(record[policy.redactionStatusColumn]);
    if (!SAFE_STATUS_SET.has(redactionStatus)) {
      fail("ERR_RECORDER_REDACTION_POLICY_UNSAFE_STATUS", `${tableName}.${sink} requires search-safe redaction status`, {
        tableName,
        table_name: tableName,
        sink,
        redactionStatus,
        redaction_status: redactionStatus,
      });
    }
  }

  for (const column of sinkPolicy.requiredTextColumns) {
    if (!cleanText(record[column])) {
      fail("ERR_RECORDER_REDACTION_POLICY_MISSING_TEXT", `${tableName}.${sink} requires ${column}`, {
        tableName,
        table_name: tableName,
        sink,
        column,
      });
    }
  }

  const unsafeColumn = policy.publicTextColumns.find((column) => UNSAFE_TEXT_PATTERN.test(cleanText(record[column])));
  if (unsafeColumn) {
    fail("ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT", `${tableName}.${sink} contains unsafe text in ${unsafeColumn}`, {
      tableName,
      table_name: tableName,
      sink,
      column: unsafeColumn,
    });
  }

  const rawPublicLocatorColumn = policy.publicTextColumns.find((column) => containsRawPublicTextLocator(cleanText(record[column])));
  if (rawPublicLocatorColumn) {
    fail("ERR_RECORDER_REDACTION_POLICY_UNSAFE_PUBLIC_LOCATOR", `${tableName}.${sink} contains a raw URL or local path in ${rawPublicLocatorColumn}`, {
      tableName,
      table_name: tableName,
      sink,
      column: rawPublicLocatorColumn,
    });
  }

  const rawMetadataColumn = policy.publicTextColumns
    .filter((column) => METADATA_LABEL_COLUMNS.has(column))
    .find((column) => containsRawMetadataLocator(cleanText(record[column])));
  if (rawMetadataColumn) {
    fail("ERR_RECORDER_REDACTION_POLICY_UNSAFE_METADATA_LABEL", `${tableName}.${sink} contains raw URL or path in ${rawMetadataColumn}`, {
      tableName,
      table_name: tableName,
      sink,
      column: rawMetadataColumn,
    });
  }
}

function isEnabled(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanText(value) {
  // Normalize before any redaction match so hostile captured text cannot evade
  // the ASCII-range patterns: NFKC folds fullwidth/compatibility Latin
  // (e.g. "ｓｅｃｒｅｔ＠ｖｉｃｔｉｍ．ｃｏｍ" -> "secret@victim.com"), and stripping Unicode
  // format chars (\p{Cf}) removes zero-width splitters (ZWSP/ZWNJ/ZWJ/BOM/bidi)
  // that would otherwise break an email/secret across the pattern. Without this
  // such PII reached the search/memory/export sinks verbatim and was trivially
  // recovered with a single .normalize("NFKC").
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsRawMetadataLocator(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/https?:\/\//iu.test(text)) return true;
  if (/^~[\\/]/u.test(text) || /^[a-z]:[\\/]/iu.test(text)) return true;
  if (text.includes("/") || text.includes("\\")) return true;
  return false;
}

function containsRawPublicTextLocator(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/https?:\/\//iu.test(text)) return true;
  if (LOCAL_PATH_PATTERN.test(text)) {
    LOCAL_PATH_PATTERN.lastIndex = 0;
    return true;
  }
  LOCAL_PATH_PATTERN.lastIndex = 0;
  return false;
}

function defaultFail(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  throw error;
}
