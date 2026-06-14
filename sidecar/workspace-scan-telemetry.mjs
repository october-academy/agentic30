const WORKSPACE_SCAN_RECOVERABLE_BLOCK_REASONS = new Set([
  "aborted",
  "unavailable",
  "usage_limit",
]);

export function workspaceScanBlockedLogLevel(reason) {
  const normalizedReason = String(reason || "").trim().toLowerCase();
  return WORKSPACE_SCAN_RECOVERABLE_BLOCK_REASONS.has(normalizedReason)
    ? "warn"
    : "error";
}

/**
 * Classify *why* a workspace-scan provider run aborted, so blocked-scan
 * telemetry can separate a slow run that tripped our own soft timeout from one
 * that ignored it long enough to hit the hard deadline (the SDK hung), or an
 * SDK/network-level abort that fired with neither timer. There is no user-cancel
 * path: the scan AbortController is local to runWorkspaceScanAgent, so an abort
 * here is always one of these three. Returns null when the failure was not an
 * abort at all (a genuine run error).
 *
 * Hard deadline wins when both timers fired — reaching it means the run ignored
 * the soft abort, which is the more actionable signal.
 */
export function deriveScanAbortCause({
  softTimeoutFired = false,
  hardDeadlineFired = false,
  isAbortLike = false,
} = {}) {
  if (hardDeadlineFired) return "hard_deadline";
  if (softTimeoutFired) return "soft_timeout";
  if (isAbortLike) return "external";
  return null;
}
