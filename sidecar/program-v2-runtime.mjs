export {
  buildProgramV2DailyCardContext,
  buildProgramV2DailyCardEvents,
  emitProgramV2DailyCards,
} from "./program-v2-cards.mjs";
export { handleOfficeHoursDailyCardSubmit } from "./program-v2-submit.mjs";

export function programV2Enabled(env = process.env) {
  return String(env?.AGENTIC30_ENABLE_PROGRAM_V2 || "").trim() === "1";
}
