import * as officeHours from "./office-hours.mjs";
import * as planCeoReview from "./plan-ceo-review.mjs";
import * as designShotgun from "./design-shotgun.mjs";
import * as designHtml from "./design-html.mjs";
import * as planDevexReview from "./plan-devex-review.mjs";
import * as devexReview from "./devex-review.mjs";
import * as designReview from "./design-review.mjs";
import * as planDesignReview from "./plan-design-review.mjs";
import * as designConsultation from "./design-consultation.mjs";
import { assertValidSpecialistModule } from "./schema.mjs";

const MODULES = [
  officeHours,
  planCeoReview,
  designShotgun,
  designHtml,
  planDevexReview,
  devexReview,
  designReview,
  planDesignReview,
  designConsultation,
];

function toEntry(mod) {
  return {
    id: mod.ID,
    name: mod.NAME,
    phases: Array.isArray(mod.PHASES) ? mod.PHASES.slice() : [],
    decisions: Array.isArray(mod.DECISIONS) ? mod.DECISIONS.slice() : [],
    summary: mod.SUMMARY || "",
    rubric: Object.freeze([...mod.RUBRIC]),
    build: mod.buildPrompt,
  };
}

export const SPECIALIST_CATALOG = Object.freeze(
  MODULES.reduce((acc, mod) => {
    assertValidSpecialistModule(mod);
    acc[mod.ID] = Object.freeze(toEntry(mod));
    return acc;
  }, {}),
);

export const SPECIALIST_IDS = Object.freeze(MODULES.map((mod) => mod.ID));

export function getSpecialist(id) {
  if (!id) return null;
  return SPECIALIST_CATALOG[id] || null;
}

export function listSpecialists() {
  return SPECIALIST_IDS.map((id) => SPECIALIST_CATALOG[id]);
}

export function listSpecialistsByPhase(phase) {
  if (!phase) return listSpecialists();
  return listSpecialists().filter((entry) => entry.phases.includes(phase));
}

export function buildSpecialistPrompt(id, context = {}) {
  const entry = getSpecialist(id);
  if (!entry || typeof entry.build !== "function") return null;
  return entry.build(context);
}
