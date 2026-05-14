import test from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_CONTEXT_FIELD_IDS,
  ONBOARDING_CONTEXT_FIELDS,
  getOnboardingContextFields,
} from "../sidecar/onboarding-questions.mjs";

const expectedFields = [
  {
    id: "business_description",
    property: "businessDescription",
    label: "Business description",
  },
  {
    id: "current_stage",
    property: "currentStage",
    label: "Current stage",
  },
  {
    id: "goal",
    property: "goal",
    label: "Goal",
  },
];

test("onboarding questions expose exactly the three required context fields", () => {
  assert.deepEqual(ONBOARDING_CONTEXT_FIELDS, expectedFields);
  assert.deepEqual(ONBOARDING_CONTEXT_FIELD_IDS, expectedFields.map((field) => field.id));
  assert.deepEqual(getOnboardingContextFields(), expectedFields);
});

test("onboarding question field contract has no extra or missing fields", () => {
  const allowedIds = new Set(["business_description", "current_stage", "goal"]);
  const exposedIds = ONBOARDING_CONTEXT_FIELDS.map((field) => field.id);

  assert.equal(ONBOARDING_CONTEXT_FIELDS.length, allowedIds.size);
  assert.deepEqual(new Set(exposedIds), allowedIds);
  assert.equal(new Set(exposedIds).size, exposedIds.length);

  for (const field of ONBOARDING_CONTEXT_FIELDS) {
    assert.deepEqual(Object.keys(field), ["id", "property", "label"]);
  }
});
