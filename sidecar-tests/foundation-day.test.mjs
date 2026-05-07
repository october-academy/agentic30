import test from "node:test";
import assert from "node:assert/strict";
import {
  FOUNDATION_DAY_MS,
  FOUNDATION_MAX_DAY_INDEX,
  FOUNDATION_TOTAL_DAYS,
  computeFoundationDayFromStartedAt,
  getFoundationDay,
  resolveFoundationDayFromPayload,
} from "../sidecar/foundation-chat.mjs";

// Anchor pinned to a fixed wall-clock so the assertions don't drift with
// whatever the host clock happens to be. All `now` arguments are derived
// from this same anchor — the function is pure with respect to its inputs.
const ANCHOR_ISO = "2026-05-01T00:00:00.000Z";
const ANCHOR_MS = Date.parse(ANCHOR_ISO);

test("constants pin the Foundation phase span at Day 0..7 inclusive", () => {
  assert.equal(FOUNDATION_DAY_MS, 86_400_000);
  assert.equal(FOUNDATION_TOTAL_DAYS, 8);
  assert.equal(FOUNDATION_MAX_DAY_INDEX, 7);
});

test("computeFoundationDayFromStartedAt returns 0 at the start instant", () => {
  const day = computeFoundationDayFromStartedAt(ANCHOR_ISO, new Date(ANCHOR_MS));
  assert.equal(day, 0);
});

test("computeFoundationDayFromStartedAt floors elapsed time inside Day 0", () => {
  // 23h 59m 59s after the anchor still belongs to Day 0.
  const almostOneDay = new Date(ANCHOR_MS + FOUNDATION_DAY_MS - 1);
  assert.equal(computeFoundationDayFromStartedAt(ANCHOR_ISO, almostOneDay), 0);
});

test("computeFoundationDayFromStartedAt rolls to Day 1 exactly at +24h", () => {
  const exactlyOneDay = new Date(ANCHOR_MS + FOUNDATION_DAY_MS);
  assert.equal(computeFoundationDayFromStartedAt(ANCHOR_ISO, exactlyOneDay), 1);
});

test("computeFoundationDayFromStartedAt returns 7 at the last hour of Day 7", () => {
  // +7d 23h 59m 59s → still Day 7 (inclusive upper bound of Foundation).
  const lastTickOfDay7 = new Date(ANCHOR_MS + 8 * FOUNDATION_DAY_MS - 1);
  assert.equal(
    computeFoundationDayFromStartedAt(ANCHOR_ISO, lastTickOfDay7),
    7,
  );
});

test("computeFoundationDayFromStartedAt returns null one ms past Day 7 (Build phase)", () => {
  const buildPhaseStart = new Date(ANCHOR_MS + 8 * FOUNDATION_DAY_MS);
  assert.equal(
    computeFoundationDayFromStartedAt(ANCHOR_ISO, buildPhaseStart),
    null,
  );
});

test("computeFoundationDayFromStartedAt clamps clock skew (now < startedAt) to Day 0", () => {
  // User's clock briefly skews back 5 minutes after ensureFoundationStarted.
  const skewed = new Date(ANCHOR_MS - 5 * 60 * 1000);
  assert.equal(computeFoundationDayFromStartedAt(ANCHOR_ISO, skewed), 0);
});

test("computeFoundationDayFromStartedAt accepts ISO string, Date, and epoch ms", () => {
  const future = new Date(ANCHOR_MS + 3 * FOUNDATION_DAY_MS); // Day 3
  assert.equal(computeFoundationDayFromStartedAt(ANCHOR_ISO, future), 3);
  assert.equal(
    computeFoundationDayFromStartedAt(new Date(ANCHOR_MS), future),
    3,
  );
  assert.equal(computeFoundationDayFromStartedAt(ANCHOR_MS, future), 3);
});

test("computeFoundationDayFromStartedAt rejects missing or unusable anchors", () => {
  const now = new Date(ANCHOR_MS);
  assert.equal(computeFoundationDayFromStartedAt(null, now), null);
  assert.equal(computeFoundationDayFromStartedAt(undefined, now), null);
  assert.equal(computeFoundationDayFromStartedAt("", now), null);
  assert.equal(computeFoundationDayFromStartedAt("not-a-date", now), null);
  assert.equal(computeFoundationDayFromStartedAt(Number.NaN, now), null);
  assert.equal(computeFoundationDayFromStartedAt(Number.POSITIVE_INFINITY, now), null);
  assert.equal(computeFoundationDayFromStartedAt({}, now), null);
});

test("computeFoundationDayFromStartedAt rejects an unusable `now`", () => {
  // `now` is normally injected by callers (Date.now() default); a bad
  // override should fail closed instead of silently picking Day 0.
  assert.equal(
    computeFoundationDayFromStartedAt(ANCHOR_ISO, "not-a-date"),
    null,
  );
});

test("every Day in [0, 7] computed by this helper round-trips through getFoundationDay", () => {
  // Guards the contract that any non-null return is a valid descriptor key.
  for (let i = 0; i < FOUNDATION_TOTAL_DAYS; i += 1) {
    const at = new Date(ANCHOR_MS + i * FOUNDATION_DAY_MS);
    const computed = computeFoundationDayFromStartedAt(ANCHOR_ISO, at);
    assert.equal(computed, i);
    const descriptor = getFoundationDay(computed);
    assert.ok(descriptor, `Day ${i} must resolve to a FOUNDATION_DAYS entry`);
    assert.equal(descriptor.day, i);
  }
});

test("resolveFoundationDayFromPayload trusts an explicit in-range `day`", () => {
  const payload = { day: 3 };
  const now = new Date(ANCHOR_MS + 6 * FOUNDATION_DAY_MS); // anchor would say Day 6
  // Explicit wins so the host badge and sidecar log stay aligned.
  assert.equal(resolveFoundationDayFromPayload(payload, now), 3);
});

test("resolveFoundationDayFromPayload falls back to startedAt when `day` is missing", () => {
  const payload = { foundationStartedAt: ANCHOR_ISO };
  const now = new Date(ANCHOR_MS + 2 * FOUNDATION_DAY_MS);
  assert.equal(resolveFoundationDayFromPayload(payload, now), 2);
});

test("resolveFoundationDayFromPayload falls back to startedAt when `day` is out of range", () => {
  // 9 is outside [0,7]; sidecar must NOT trust it. With a valid anchor it
  // recomputes; without one it returns null so the handler can reject.
  const recoverable = resolveFoundationDayFromPayload(
    { day: 9, foundationStartedAt: ANCHOR_ISO },
    new Date(ANCHOR_MS + 4 * FOUNDATION_DAY_MS),
  );
  assert.equal(recoverable, 4);

  const unrecoverable = resolveFoundationDayFromPayload(
    { day: 9 },
    new Date(ANCHOR_MS),
  );
  assert.equal(unrecoverable, null);
});

test("resolveFoundationDayFromPayload accepts the legacy `startedAt` key as a fallback", () => {
  const payload = { startedAt: ANCHOR_ISO };
  const now = new Date(ANCHOR_MS + 5 * FOUNDATION_DAY_MS);
  assert.equal(resolveFoundationDayFromPayload(payload, now), 5);
});

test("resolveFoundationDayFromPayload returns null when neither field is present", () => {
  assert.equal(resolveFoundationDayFromPayload({}, new Date(ANCHOR_MS)), null);
  assert.equal(
    resolveFoundationDayFromPayload(undefined, new Date(ANCHOR_MS)),
    null,
  );
});

test("resolveFoundationDayFromPayload returns null past Day 7 (Build phase)", () => {
  const payload = { foundationStartedAt: ANCHOR_ISO };
  const buildPhase = new Date(ANCHOR_MS + 9 * FOUNDATION_DAY_MS);
  assert.equal(resolveFoundationDayFromPayload(payload, buildPhase), null);
});
