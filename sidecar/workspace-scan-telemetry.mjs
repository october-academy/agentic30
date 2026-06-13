const WORKSPACE_SCAN_RECOVERABLE_BLOCK_REASONS = new Set([
  "unavailable",
  "usage_limit",
]);

export function workspaceScanBlockedLogLevel(reason) {
  return WORKSPACE_SCAN_RECOVERABLE_BLOCK_REASONS.has(String(reason || ""))
    ? "warn"
    : "error";
}
