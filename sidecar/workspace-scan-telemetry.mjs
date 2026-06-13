const WORKSPACE_SCAN_RECOVERABLE_BLOCK_REASONS = new Set([
  "unavailable",
  "usage_limit",
]);

export function workspaceScanBlockedLogLevel(reason) {
  const normalizedReason = String(reason || "").trim().toLowerCase();
  return WORKSPACE_SCAN_RECOVERABLE_BLOCK_REASONS.has(normalizedReason)
    ? "warn"
    : "error";
}
