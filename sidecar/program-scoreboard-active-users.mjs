const ACCEPTED_ACTIVE_USER_SOURCES = new Set(["posthog_hogql", "core_activation_snapshot"]);

export function normalizeActiveUserSnapshotList(value, field = "activeUsers.snapshots") {
  return value.map((entry, index) => normalizeActiveUserSnapshot(entry, `${field}[${index}]`));
}

export function latestAcceptedActiveUserCount(snapshots = [], field = "snapshots") {
  const accepted = normalizeActiveUserSnapshotList(snapshots, field)
    .filter((snapshot) =>
      snapshot.firstValueEventName === "first_value"
      && ACCEPTED_ACTIVE_USER_SOURCES.has(snapshot.source)
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return accepted.at(-1)?.activeUserCount ?? 0;
}

function normalizeActiveUserSnapshot(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("ERR_INVALID_ACTIVE_USER_SNAPSHOT", `${field} must be an object.`);
  }
  const activeUserCount = nonNegativeInteger(value.activeUserCount ?? value.active_user_count);
  if (activeUserCount === null) {
    throw codedError(
      "ERR_INVALID_ACTIVE_USER_SNAPSHOT",
      `${field}.activeUserCount must be a non-negative integer.`,
    );
  }
  const at = normalizeIso(value.at);
  if (!at) {
    throw codedError("ERR_INVALID_ACTIVE_USER_SNAPSHOT", `${field}.at must be a valid timestamp.`);
  }
  return {
    at,
    activeUserCount,
    firstValueEventName: cleanString(value.firstValueEventName ?? value.first_value_event_name),
    source: cleanString(value.source),
  };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number);
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function cleanString(value = "") {
  return String(value ?? "").trim();
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
