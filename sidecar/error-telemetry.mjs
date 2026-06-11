// Centralized helper for reporting otherwise-silent errors to PostHog so that
// real I/O / provider failures inside `.catch(() => {})` or `try { ... } catch {}`
// blocks reach Error Tracking instead of disappearing into a stuck spinner.
//
// Design:
//   - `setTelemetryClient` is called once from `index.mjs` after
//     `createTelemetryClient(...)` so any module can `reportError(...)` without
//     plumbing the client through every call site.
//   - `reportError(error, properties)` is safe to call before the client is
//     registered (it falls back to `console.warn` so failures still leave a
//     local breadcrumb in `sidecar-crashes.jsonl`'s sibling stderr stream).
//   - `swallow(operation, awaitable)` is the grep-able replacement for
//     `<promise>.catch(() => {})` when the call site genuinely wants to keep
//     going on failure but the failure itself is operationally interesting.
//   - `swallowSync(operation, fn)` handles synchronous try/catch sites.
//
// Cleanup-y best-effort calls (fs.unlink, fs.rm, handle.close, lock release)
// should still use the bare `.catch(() => {})` — those failures are noise and
// not worth a PostHog event.

let activeTelemetry = null;

export function setTelemetryClient(client) {
  activeTelemetry = client || null;
}

export function reportError(error, properties = {}) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (activeTelemetry?.captureException) {
    try {
      activeTelemetry.captureException(normalized, properties);
    } catch {
      // Telemetry itself must never crash a caller.
    }
  }
  if (activeTelemetry?.captureLog) {
    try {
      activeTelemetry.captureLog("sidecar swallowed error", "error", {
        ...properties,
        error_type: normalized.name || "Error",
        error_message: normalized.message,
      });
    } catch {
      // Telemetry itself must never crash a caller.
    }
  }
  const op = properties?.operation || "unknown";
  console.warn(`[sidecar] swallowed error in ${op}: ${normalized.message}`);
}

export async function swallow(operation, awaitable, properties = {}) {
  try {
    return await awaitable;
  } catch (error) {
    reportError(error, { operation, ...properties });
    return undefined;
  }
}

export function swallowSync(operation, fn, properties = {}) {
  try {
    return fn();
  } catch (error) {
    reportError(error, { operation, ...properties });
    return undefined;
  }
}
