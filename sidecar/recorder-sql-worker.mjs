import { parentPort, workerData } from "node:worker_threads";

import Database from "better-sqlite3";

const MAX_SANDBOX_VIEW_COPY_ROWS = 200000;

function run() {
  const dbPath = String(workerData?.dbPath || "");
  const query = String(workerData?.query || "");
  const allowedViews = Array.isArray(workerData?.allowedViews)
    ? workerData.allowedViews.map((view) => String(view || "").trim()).filter(Boolean)
    : [];
  const rowCap = Math.max(1, Math.min(1000, Number.parseInt(String(workerData?.rowCap ?? 1000), 10) || 1000));
  if (!dbPath || !query) {
    throw sqlError("ERR_RECORDER_RAW_API_SQL_WORKER_INPUT_INVALID", "recorder SQL worker requires dbPath and query");
  }

  const sourceDb = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: 1000,
  });
  const sandboxDb = new Database(":memory:");
  try {
    const copyTruncated = copyAllowedViewsIntoSandbox({ sourceDb, sandboxDb, allowedViews });
    sandboxDb.pragma("query_only = ON");
    const statement = sandboxDb.prepare(query);
    if (statement.reader !== true) {
      throw sqlError("ERR_RECORDER_RAW_API_SQL_NOT_READONLY", "recorder SQL inspector allows read-only statements only");
    }
    const rows = [];
    // If any allowed view's copy hit MAX_SANDBOX_VIEW_COPY_ROWS, the sandbox
    // holds an arbitrary (non-recency-ordered) prefix of the real data, so
    // aggregates/ORDER BY results can be silently wrong even when the
    // query's own result rows never reach rowCap. Surface that via the same
    // `truncated` signal the caller already reports to API consumers.
    let truncated = copyTruncated;
    for (const row of statement.iterate()) {
      if (rows.length >= rowCap) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    parentPort.postMessage({ ok: true, rows, truncated });
  } finally {
    sandboxDb.close();
    sourceDb.close();
  }
}

function copyAllowedViewsIntoSandbox({ sourceDb, sandboxDb, allowedViews }) {
  const uniqueViews = [...new Set(allowedViews)];
  let copyTruncated = false;
  const copy = sandboxDb.transaction(() => {
    for (const view of uniqueViews) {
      const sourceIdentifier = quoteIdentifier(view);
      const columns = sourceDb.prepare(`PRAGMA table_info(${sourceIdentifier})`).all();
      if (!columns.length) {
        throw sqlError("ERR_RECORDER_RAW_API_SQL_ALLOWED_VIEW_MISSING", `recorder SQL allowed view is missing: ${view}`);
      }
      const columnNames = columns.map((column) => String(column.name || ""));
      const columnSql = columnNames.map(quoteIdentifier).join(", ");
      sandboxDb.prepare(`CREATE TABLE ${sourceIdentifier} (${columnSql})`).run();
      // Bound the per-view copy so a long recording history cannot exhaust
      // sandbox memory. Once a view's true row count exceeds this cap, the
      // sandbox copy is an arbitrary (non-recency-ordered) prefix, so flag
      // copyTruncated for the caller instead of silently returning it as if
      // it were the complete view.
      const rows = sourceDb
        .prepare(`SELECT * FROM ${sourceIdentifier} LIMIT ${MAX_SANDBOX_VIEW_COPY_ROWS}`)
        .all();
      if (rows.length >= MAX_SANDBOX_VIEW_COPY_ROWS) {
        copyTruncated = true;
      }
      if (!rows.length) continue;
      const placeholders = columnNames.map(() => "?").join(", ");
      const insert = sandboxDb.prepare(`INSERT INTO ${sourceIdentifier} (${columnSql}) VALUES (${placeholders})`);
      for (const row of rows) {
        insert.run(columnNames.map((column) => row[column]));
      }
    }
  });
  copy();
  return copyTruncated;
}

function quoteIdentifier(value) {
  const identifier = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw sqlError("ERR_RECORDER_RAW_API_SQL_IDENTIFIER_REJECTED", "recorder SQL worker received an invalid identifier");
  }
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function sqlError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

try {
  run();
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code: error?.code || "ERR_RECORDER_RAW_API_SQL_EXECUTION_FAILED",
    message: error?.message || String(error),
  });
}
