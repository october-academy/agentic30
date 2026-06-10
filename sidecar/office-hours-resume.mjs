// Day-1 Office Hours interview resume.
//
// All in-flight interview state (the provider stream, question index, the
// pendingUserInput card) lives in sidecar process memory and dies with the
// daemon; sessions.json is wiped on boot. What DOES survive a relaunch is the
// workspace .agentic30/ pair:
//   - day-progress.json          -> is this day's first_interview step still active?
//   - memory/office-hours-turns  -> which questions were already answered (day-scoped)
// These helpers rebuild an in-progress Day-1 interview from that pair so an app
// relaunch continues at question k+1 instead of restarting at question 1.
//
// Pure functions only — index.mjs owns session mutation, transcript seeding,
// and telemetry. Scope is deliberately Day 1 (`kind === "day1"`): Day 2+ runs
// the goal-driven digest flow and closes through different steps.

// An interview is 6 questions; the cap only guards a pathological turn log.
const MAX_RESUME_TURNS = 8;
const MAX_RESUME_QUESTION_CHARS = 240;
const MAX_RESUME_ANSWER_CHARS = 320;

// User-role transcript rows whose content matches one of these are the
// synthetic "start" prompts the Mac client sends with office_hours_start —
// they are not answers (the client hides them via
// OfficeHoursTranscriptRow.syntheticStartPrompt / legacySyntheticStartPrompt).
const SYNTHETIC_START_PROMPTS = new Set(["office hours", "day999 office hours"]);

// Returns the already-answered turns to resume from, or [] for a normal fresh
// start. Resume requires ALL of: the day resolves, the day is a Day-1 kind, its
// first_interview step is still "active" (not yet closed through the interview
// gate), and the turn log holds completed Q/A turns recorded for that day.
// A manual `/office-hours` slash start carries arbitrary ad-hoc context and
// must stay a clean session — runtimeDay falls back to the elapsed challenge
// day, so without the source gate it would inherit the Day-1 interview history.
// Duplicate answers for the same question (the pre-resume restart bug re-asked
// question 1 on every relaunch) collapse to the LATEST answer per question so
// the resume index never overstates progress.
export function selectOfficeHoursResumeTurns({ turnLog, day, dayProgress, source } = {}) {
  if (String(source || "") === "slash_command") return [];
  const dayNumber = Number.parseInt(String(day ?? ""), 10);
  if (!Number.isFinite(dayNumber) || dayNumber <= 0) return [];
  const dayState = dayProgress?.days?.[String(dayNumber)];
  if (!dayState || dayState.kind !== "day1") return [];
  if (dayState.steps?.first_interview !== "active") return [];
  const turns = Array.isArray(turnLog?.turns) ? turnLog.turns : [];
  const eligible = turns.filter((turn) =>
    Number.parseInt(String(turn?.day ?? ""), 10) === dayNumber
    && String(turn?.questionText || "").trim().length > 0
    && String(turn?.responseText || "").trim().length > 0);
  return dedupeByQuestionKeepLast(eligible).slice(-MAX_RESUME_TURNS);
}

// Counts the resume turns recorded by sessions OTHER than the given one. This
// is the value to stamp on session.runtime.officeHours.resumedTurns: the
// incomplete-interview detector adds it to countOfficeHoursTurnsForSession,
// which already counts the current session's own turns — the Mac retry path
// re-enters runOfficeHours on the SAME failed session, so including own turns
// here would double-count them.
export function countOfficeHoursResumeTurnsFromOtherSessions(turns = [], sessionId = "") {
  const id = String(sessionId || "").trim();
  const list = Array.isArray(turns) ? turns : [];
  if (!id) return list.length;
  return list.filter((turn) => String(turn?.sessionId || "") !== id).length;
}

// The Mac client derives the 답변 N/M counter and the visible Q&A history from
// transcript user rows (minus the synthetic start prompt), so seeded turns
// restore both with no client change. Seed only when the session has no real
// answer rows yet — a same-daemon retry already carries the seeded transcript
// and must not duplicate it.
export function shouldSeedOfficeHoursResumeTranscript(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return !messages.some((message) => {
    if (message?.role !== "user") return false;
    const content = String(message?.content || "").replace(/\s+/g, " ").trim();
    if (!content) return false;
    return !SYNTHETIC_START_PROMPTS.has(content.toLowerCase());
  });
}

// Context preamble for a resumed run. Injected ABOVE the regular office-hours
// context so the provider treats the prior answers as settled and continues at
// question k+1 — or, when every question is already answered (the founder quit
// between the last answer and the commitment close), skips question generation
// and goes straight to the wrap-up. `expected` comes from the "Expected
// question count: N" line the Mac client embeds; 0 means unknown (never
// enforce a total, just continue).
export function buildOfficeHoursResumePreamble({ turns = [], expected = 0 } = {}) {
  if (!Array.isArray(turns) || turns.length === 0) return "";
  const answered = turns.length;
  const total = Number.isInteger(expected) && expected > 0 ? expected : null;
  const lines = [
    "[Office Hours 인터뷰 이어하기 — RESUME]",
    total
      ? `이 인터뷰는 진행 중이었다. 전체 ${total}개 질문 중 ${answered}개는 이미 답변을 받았다.`
      : `이 인터뷰는 진행 중이었다. 아래 ${answered}개 질문은 이미 답변을 받았다.`,
    "이미 답한 질문/답변:",
    ...turns.map((turn, index) =>
      `${index + 1}. Q: ${clipResumeText(turn?.questionText, MAX_RESUME_QUESTION_CHARS)} / A: ${clipResumeText(turn?.responseText, MAX_RESUME_ANSWER_CHARS)}`),
  ];
  if (total && answered >= total) {
    lines.push(
      `모든 ${total}개 질문에 답변이 끝났다. 새 질문을 만들지 말고, 위 답변을 근거로 인터뷰 마무리(결론 요약과 다음 과제)로 바로 진행한다.`,
    );
  } else {
    lines.push(
      total
        ? `처음부터 다시 시작하지 마라. 위 답변을 그대로 인정하고 질문 ${answered + 1}/${total}부터 이어서 진행한다.`
        : "처음부터 다시 시작하지 마라. 위 답변을 그대로 인정하고 다음 질문부터 이어서 진행한다.",
      "이미 답한 질문과 같은 질문을 다시 묻지 않는다. 첫 응답에서 가설 요약을 길게 반복하지 말고, 직전 답변에서 가장 약한 가정을 겨냥한 다음 질문 1개를 바로 structured input으로 물어본다.",
    );
  }
  return lines.join("\n");
}

// Keep the LAST answer per normalized question text, preserving overall log
// order (by each question's final occurrence).
function dedupeByQuestionKeepLast(turns = []) {
  const seen = new Set();
  const output = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const key = String(turn?.questionText || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(turn);
  }
  return output.reverse();
}

function clipResumeText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}
