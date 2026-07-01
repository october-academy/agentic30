// Pure decision logic for auto-firing the recorder Day Memory loop inside the
// Day-0-3 office-hours journey. Extracted from index.mjs so it is unit-testable
// (index.mjs cannot be imported in tests — boot side effects). The main reducer
// gathers the inputs (some via I/O) and calls shouldAutoRunRecorderDayMemoryLoop
// once; it remains the single authority for state.recorderDayMemoryLoop.
//
// This module performs NO I/O, owns NO state, and NEVER touches proof. A fired
// loop result is recorder-derived context, never proof by itself.

// Day-0-3 inclusive. computeDayNumber is 1-based (returns 1 for the start day),
// so the window is day 1..4. Day-0 maps to 1.
const DAY_WINDOW_MAX = 4;

export const RECORDER_DAY_LOOP_AUTOFIRE_REASONS = Object.freeze([
  "ok",
  "not_running",
  "out_of_window",
  "already_ran_today",
  "not_ready",
]);

// Decide whether to auto-fire, in strict precedence order:
// not_running > out_of_window > already_ran_today > not_ready > ok.
// - recorderStoreReady: state.recorderStore is non-null (recorder running).
// - day: computeDayNumber result, or null when day-progress is unknown (a fresh
//   first session before day-progress exists -> allow the fire, do not gate out).
// - readinessCanRecord: evaluateRecorderCaptureReadiness(...).canRecord.
// - lastRunDayKey: local-day key the cached result was generated for ("" if none).
// - todayKey: local-day key for `now`.
export function shouldAutoRunRecorderDayMemoryLoop({
  recorderStoreReady = false,
  day = null,
  readinessCanRecord = false,
  lastRunDayKey = "",
  todayKey = "",
} = {}) {
  if (!recorderStoreReady) {
    return { fire: false, reason: "not_running" };
  }
  if (day != null && Number(day) > DAY_WINDOW_MAX) {
    return { fire: false, reason: "out_of_window" };
  }
  const last = String(lastRunDayKey ?? "").trim();
  const today = String(todayKey ?? "").trim();
  if (last && today && last === today) {
    return { fire: false, reason: "already_ran_today" };
  }
  if (!readinessCanRecord) {
    return { fire: false, reason: "not_ready" };
  }
  return { fire: true, reason: "ok" };
}

// Derive the local-day key the cached Day-loop result was generated for, so the
// caller can compare against todayKey(now) for once-per-day idempotency. This
// also dedups against the manual Control-tab button (same generatedAt -> skip).
// todayKey is injected (the local-day formatter) to keep this pure/testable.
export function recorderDayMemoryLoopRanForDayKey(result, { todayKey } = {}) {
  if (typeof todayKey !== "function") return "";
  const iso = result?.generatedAt || result?.generated_at;
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return todayKey(date);
}
