import { parentPort, workerData } from "node:worker_threads";

import Database from "better-sqlite3";

function run() {
  const dbPath = String(workerData?.dbPath || "");
  const query = String(workerData?.query || "");
  const rowCap = Math.max(1, Math.min(1000, Number.parseInt(String(workerData?.rowCap ?? 1000), 10) || 1000));
  if (!dbPath || !query) {
    throw sqlError("ERR_RECORDER_RAW_API_SQL_WORKER_INPUT_INVALID", "recorder SQL worker requires dbPath and query");
  }

  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: 1000,
  });
  try {
    db.pragma("query_only = ON");
    const statement = db.prepare(query);
    if (statement.reader !== true) {
      throw sqlError("ERR_RECORDER_RAW_API_SQL_NOT_READONLY", "recorder SQL inspector allows read-only statements only");
    }
    const rows = [];
    let truncated = false;
    for (const row of statement.iterate()) {
      if (rows.length >= rowCap) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    parentPort.postMessage({ ok: true, rows, truncated });
  } finally {
    db.close();
  }
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
