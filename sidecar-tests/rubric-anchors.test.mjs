import test from "node:test";
import assert from "node:assert/strict";

import { RUBRIC_AXES } from "../sidecar/specialists/schema.mjs";
import {
  RUBRIC_ANCHORS,
  RUBRIC_ANCHOR_LEVELS,
  getAnchorText,
  nearestAnchorLevel,
} from "../sidecar/rubric-anchors.mjs";

test("RUBRIC_ANCHOR_LEVELS is exactly [1, 3, 5]", () => {
  assert.deepEqual([...RUBRIC_ANCHOR_LEVELS], [1, 3, 5]);
});

test("every axis from RUBRIC_AXES has anchors for all three levels", () => {
  for (const axis of RUBRIC_AXES) {
    const anchors = RUBRIC_ANCHORS[axis];
    assert.ok(anchors, `missing anchors for ${axis}`);
    for (const level of [1, 3, 5]) {
      const text = anchors[level];
      assert.equal(typeof text, "string", `${axis} level ${level} not string`);
      assert.ok(text.length > 10, `${axis} level ${level} too short: ${text}`);
    }
  }
});

test("getAnchorText returns string for valid (axis, level) pairs", () => {
  for (const axis of RUBRIC_AXES) {
    for (const level of [1, 3, 5]) {
      const text = getAnchorText(axis, level);
      assert.equal(typeof text, "string", `${axis} ${level}`);
    }
  }
});

test("getAnchorText returns null for unknown axis or level", () => {
  assert.equal(getAnchorText("unknown", 1), null);
  assert.equal(getAnchorText("definition", 2), null);
  assert.equal(getAnchorText("definition", 99), null);
  assert.equal(getAnchorText(null, 1), null);
});

test("nearestAnchorLevel maps 1-5 scores to 1/3/5 anchor levels", () => {
  assert.equal(nearestAnchorLevel(1), 1);
  assert.equal(nearestAnchorLevel(2), 1);
  assert.equal(nearestAnchorLevel(3), 3);
  assert.equal(nearestAnchorLevel(4), 3);
  assert.equal(nearestAnchorLevel(5), 5);
});

test("nearestAnchorLevel returns null for non-numeric input", () => {
  assert.equal(nearestAnchorLevel("3"), null);
  assert.equal(nearestAnchorLevel(NaN), null);
  assert.equal(nearestAnchorLevel(null), null);
  assert.equal(nearestAnchorLevel(undefined), null);
});
