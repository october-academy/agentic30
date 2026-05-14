export const ONBOARDING_CONTEXT_FIELDS = Object.freeze([
  Object.freeze({
    id: "business_description",
    property: "businessDescription",
    label: "Business description",
  }),
  Object.freeze({
    id: "current_stage",
    property: "currentStage",
    label: "Current stage",
  }),
  Object.freeze({
    id: "goal",
    property: "goal",
    label: "Goal",
  }),
]);

export const ONBOARDING_CONTEXT_FIELD_IDS = Object.freeze(
  ONBOARDING_CONTEXT_FIELDS.map((field) => field.id),
);

export function getOnboardingContextFields() {
  return ONBOARDING_CONTEXT_FIELDS.map((field) => ({ ...field }));
}
