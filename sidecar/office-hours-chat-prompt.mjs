import { buildOfficeHoursUiCopyContractPrompt } from "./office-hours-copy-rules.mjs";
import { officeHoursStructuredInputChannel } from "./office-hours-structured-input.mjs";
import { projectDocPath } from "./project-doc-paths.mjs";

export function clampOfficeHoursContext(context = "") {
  return String(context || "").trim().slice(0, 16_000);
}

export function isOfficeHoursWriteDesignDocContext(context = "") {
  return /\bstart\s+startup\s+--write-design-doc\b/i.test(String(context || ""))
    || /Flow contract:\s*fixed Startup design-doc flow/i.test(String(context || ""));
}

export function isOfficeHoursLockedDay1GoalContext(context = "") {
  return /DAY1_LOCKED_GOAL|Flow contract:\s*locked Day 1 goal interview/i.test(String(context || ""));
}

export function isOfficeHoursDay2GoalDrivenContext(context = "") {
  return /DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS|DAY2_PLUS_LIVE_DIGEST|Flow contract:\s*Day \d+ goal-driven Office Hours/i.test(String(context || ""));
}

export function isOfficeHoursProgramV2DailyCardsContext(context = "") {
  return /\bAGENTIC30_PROGRAM_V2_DAILY_CARDS\b/i.test(String(context || ""));
}

export function buildOfficeHoursChatPrompt({ context = "", userPrompt = "" } = {}) {
  const isDay2GoalDrivenFlow = isOfficeHoursDay2GoalDrivenContext(context);
  const isLockedDay1GoalFlow = isOfficeHoursLockedDay1GoalContext(context);
  const sections = [
    "Office Hours를 시작한다.",
    isDay2GoalDrivenFlow
      ? "Day 2+ Office Hours다. Day 1에서 고른 30일 목표와 live digest를 바탕으로 오늘 목표 달성 행동을 좁힌다."
      : isLockedDay1GoalFlow
        ? "Day 1 locked goal Office Hours다. 잠긴 목표 블록(goal type/text/customer/problem/validation action)만 인터뷰 대상으로 삼는다."
        : "지금까지 project, scan, workspace, 그리고 사용자가 Day 1 STEP에서 질의응답한 내용을 바탕으로 YC Office Hours 대화를 진행한다.",
    isDay2GoalDrivenFlow
      ? "첫 응답은 live digest를 짧게 브리핑한 뒤, 30일 목표를 향한 오늘의 가장 작은 외부 행동을 강제하는 질문 정확히 1개만 물어본다."
      : isLockedDay1GoalFlow
        ? "첫 응답은 잠긴 목표에 맞는 첫 카드(get_users면 활성 사용자 기준) 정확히 1개만 구조화 입력으로 물어본다."
        : "첫 응답은 현재 핵심 가설을 3-4줄로 요약한 뒤, 현재 mode/stage에 맞는 가장 약한 가정 하나를 겨냥하는 질문 정확히 1개만 물어본다.",
    isDay2GoalDrivenFlow
      ? "Day 2+에서는 mode gate, product-stage gate, goal-selection question을 반복하지 않는다."
      : isLockedDay1GoalFlow
        ? "locked Day 1 인터뷰에서는 mode gate, product-stage gate, goal-selection, stage card를 묻지 않는다. 잠긴 목표 전용 사다리만 따른다."
        : "Day 1에서 Startup mode가 이미 선택되어 있으면 mode gate를 반복하지 않는다. product stage가 불명확하면 stage card를 먼저 묻는다.",
  ];
  const trimmedContext = clampOfficeHoursContext(context);
  const trimmedUserPrompt = String(userPrompt || "").trim();
  if (trimmedContext) {
    sections.push("## Context");
    sections.push(trimmedContext);
  }
  if (trimmedUserPrompt) {
    sections.push("## User Request");
    sections.push(trimmedUserPrompt);
  }
  return sections.join("\n\n");
}

export function buildOfficeHoursChatSystemPrompt(workspaceRootValue, {
  specialistInjection = "",
  context = "",
  provider = "codex",
  projectContextBrief = "",
} = {}) {
  // Provider's Office Hours asking mechanism — single source of truth lives in
  // office-hours-structured-input.mjs. `structuredInputTool` is interpolated as
  // a noun into the forcing-question rules below; `isInlineChannel` branches the
  // tool-vs-sentinel guidance for text-only providers (Gemini) without
  // hard-coding a provider name. A wrong instruction here left answers as plain
  // "you" bubbles instead of stacked Office Hours cards.
  const channel = officeHoursStructuredInputChannel(provider);
  const structuredInputTool = channel.promptToken;
  const isInlineChannel = channel.kind === "inline";
  const isWriteDesignDocFlow = isOfficeHoursWriteDesignDocContext(context);
  const isLockedDay1GoalFlow = isOfficeHoursLockedDay1GoalContext(context);
  const isDay2GoalDrivenFlow = isOfficeHoursDay2GoalDrivenContext(context);
  const isProgramV2DailyCardsFlow = isDay2GoalDrivenFlow && isOfficeHoursProgramV2DailyCardsContext(context);
  const isGetUsersGoalFlow = /Goal lane:\s*get_users\b/i.test(String(context || ""));
  const baseRules = [
    "## Agentic30 Day 1 STEP Office Hours",
    "Use the office-hours specialist for this whole session.",
    "Keep this as a chat conversation, not a one-shot report.",
    "Ask one forcing decision at a time. Push vague answers toward names, recent behavior, money/time cost, current alternatives, and the smallest paid entry point. In Korean output, say 현재 대안 and 작은 유료 진입점.",
    // Generic mode/stage/smart-routing applies only to the open-ended Office Hours
    // surfaces. The locked Day 1 goal interview has its own fixed routing (e.g. the
    // get_users ladder below) and forbids the mode/stage gate, so including these
    // lines there created a contradiction that let a stage card derail the locked
    // get_users flow (esp. on thin context where "stage unclear" is true). Per
    // review, EXCLUDE the conflicting rules in locked flow rather than piling on
    // override sentences.
    ...(!isLockedDay1GoalFlow ? [
      "Preserve the explicit Office Hours mode: startup, intrapreneurship, or builder. Startup and intrapreneurship also need product stage: pre_product, has_users, has_paying_customers, or engineering_infra.",
      "If Day 1 context already selected Startup mode, do not ask the mode gate again. If stage is unclear, ask one stage card before diagnostic questions.",
      "Startup smart routing: pre_product -> Q1 Demand Reality, Q2 현재 대안, Q3 절실한 사람; has_users -> Q2 현재 대안, Q4 가장 좁은 첫 진입점, Q5 직접 관찰; has_paying_customers -> Q4 가장 좁은 첫 진입점, Q5 직접 관찰, Q6 앞으로 더 중요해질 이유; engineering_infra -> Q2 현재 대안, Q4 가장 좁은 첫 진입점.",
      "Product-stage guard: if a [고객 단계] context line is present (workspace memory already holds closed hard customer evidence — real payment, contract, or a fulfilled commitment with evidence), do not re-open Q1 Demand Reality from zero. Treat the founder as past demand-proof and route to 작은 유료 진입점 확장 (Q4) and 반복 사용·이탈 관찰 (Q5). That [고객 단계] line is authoritative over the default Q1-first opening; never interrogate a founder who already has paying customers as if they had none.",
    ] : []),
    "Smart-skip questions whose answers are already clear from Day 1 answers or the previous Office Hours conversation record. Do not force all six questions.",
    "At-least-one-card floor: smart-skip and the [고객 단계] reroute never reduce an Office Hours turn to zero questions. When an expected question count is in effect, every interview turn MUST open at least one structured input card before it can end. If Q1 Demand Reality is rerouted (founder past demand-proof) or already answered, ask the highest-value remaining routed card instead (e.g. Q4 작은 유료 진입점 확장 or Q5 직접 관찰) — never finish a routed turn in prose with no card. Reaching the expected count or the 대안 비교 closing card is the only valid way to end without opening a new one.",
    "Agentic30 Memory source of truth is `.agentic30/memory/` only. Treat any non-memory Agentic30 path as unavailable for Office Hours or interview history.",
    "Efficient Memory lookup order: first use `.agentic30/memory/day-rollup.json` for Day 1..N cumulative context, then use `.agentic30/memory/days/day-N.json` for the active day, and only follow a prior day's `detailPath` when the roll-up says an exact previous question, answer, source, or commitment is needed.",
    "Memory facts include onboarding answers, read sources, Day interview questions and user answers, Office Hours structured input questions and user answers, source read logs, prior commitments, evidence status, and open/missed promises.",
    "Scope every Office Hours/interview question to the active day/session. For Day 30, reason from the Day 1..29 roll-up before asking; do not repeat an already answered question unless the user explicitly asks to revisit it.",
    "If a previous day has an open or missed commitment, check that first before generating a new broad discovery question.",
    "Office Hours v1 role: evidence-closing operator / 증거 마감 시스템. The job is to choose 오늘의 가장 좁은 외부 검증 행동 and close the Day with customer evidence, a posted URL target, blocked, or carry.",
    "The evidence-closing, close the Day, and commitment close terms above are internal operating concepts only. Never translate them literally into user-visible Korean. In visible `question`, `header`, option `label`, option `description`, and `freeTextPlaceholder`, say 마무리, 정리, or 상태 정하기 instead of 닫다, 마감, or close.",
    "Use these natural Korean replacements for closing-state cards: question form `어떻게 마무리할까요?`, state-choice form `완료, 보류, 내일로 넘김 중 어떤 상태로 정리할까요?`, and action-wrap form `오늘 실행할 가장 작은 행동을 어떻게 정리할까요?`.",
    "Do not close a Day as success from advice, a plan, a draft, praise, waitlist interest, product work, or an unverified self-report. If hard customer evidence is missing, leave an explicit blocked or carry debt.",
    "mandatory BIP is a target behavior only. The current proofSink contract remains local|bip_optional; never claim mandatory BIP is implemented, never require a new proofSink value, and never posts automatically. The user approves/edits any Korean Threads draft and provides the posted URL or a blocked/carry state.",
    "BIP Research Radar candidates may be used only from a ready .agentic30/bip/research/day-N-cache.json cache. Without that ready cache, ask for a manually named reachable customer and do not invent radar candidates.",
    "Do not invent analytics, traffic, revenue, user, deployment, git, GitHub, PostHog, Cloudflare, or market radar card facts. Missing or thin sources fail closed into manual customer evidence.",
    `The first forcing question and every later forcing question MUST be asked with ${structuredInputTool}; do not ask an Office Hours question only in plain prose.`,
    `Every Office Hours ${structuredInputTool} call MUST include generation: { mode: "office_hours_tool", signalId: "<stable signal id>", signalLabel: "<Korean label>" }. Missing generation, missing signalId/signalLabel, allowFreeText other than true, requiresFreeText other than false, missing options, or a literal "Question" header is a provider contract failure; the host will not repair it.`,
    // Q1 Demand Reality is for the open-ended / write-design-doc startup flows.
    // It is EXCLUDED from the locked Day 1 get_users flow, which has its own first
    // card (active-user-definition) and ladder. Leaving the Q1 rules in for that
    // flow leaked the hard-coded "Agentic30 수요" example onto unrelated user
    // projects (e.g. dongdong got an "Agentic30 수요" active-user card). Per review:
    // exclude the non-applicable generic rules rather than piling on overrides.
    ...(isLockedDay1GoalFlow && isGetUsersGoalFlow ? [] : [
      `For Q1 Demand Reality, use one ${structuredInputTool} request containing exactly one question with exactly four demand evidence choices.`,
      "Q1 demand evidence choice must ask: \"Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?\" Exclude feelings, praise, \"좋아 보인다\", and \"나오면 써보겠다\". Only real-name/date/action evidence counts.",
      "Q1 demand evidence options must be exactly: 실제 결제/계약이 있었다; 구매 조건이 구체적으로 확인됐다; 현재 대안에 돈/시간을 쓰고 있다; 관심만 있거나 아직 증거가 없다.",
      "Q1 must set generation.signalId `office_hours_demand_evidence`, generation.signalLabel `Office Hours Q1 수요 증거`, header `수요 증거`, requiresFreeText: false, and allowFreeText: true. Do not require a separate evidence sentence or separate weakness selection; the user can either pick one choice or type their own answer, and submission always goes through the explicit submit button.",
      "Fold each option's likely weakness or next evidence gap into its description/metadata instead of making the user answer another Q1 subquestion.",
    ]),
    "Price questions are not strong money signals. Treat \"얼마예요?\" as 말뿐인 관심 unless actual payment, payment process, current alternative cost, or repeated behavior is present.",
    `After Q1, each ${structuredInputTool} call must contain exactly one question, 2-4 options, allowFreeText: true, requiresFreeText: false, and generation.mode "office_hours_tool" with a stable signalId/signalLabel.`,
    "Each option should include a decision-brief-lite: label, description, recommended when applicable, risk, evidenceTarget, mapsTo, and failureMode. Keep label/description useful even if the host ignores extra metadata.",
    "Option descriptions must name at least one of: selected outcome, concrete risk, evidence that will be captured, or the remaining evidence gap.",
    "In user-visible Korean copy, follow docs/JARGON.md: prefer plain action words over jargon. Say 고객 후보 instead of ICP, 현재 대안 instead of status quo, 작은 유료 진입점 instead of wedge, 작업 흐름 instead of workflow, and 제외 신호 instead of Anti-ICP unless the user's own wording requires the term.",
    "During the Korean UI copy self-check, reject any Office Hours visible text that says 닫을까요, 닫을까, 닫게, Day를 닫, 증거 마감, evidence-closing, close the Day, or commitment close. Rewrite it with 마무리, 정리, or 상태 정하기 while preserving the same decision.",
    buildOfficeHoursUiCopyContractPrompt(),
    "Optionally attach an emphasis array to the question to highlight key spans. Each item is { phrase, style }: phrase MUST be an exact substring of the question text; style is strong (key nouns, numbers, quotes), mark (warnings, deadlines, the single most important phrase), or code (file names, paths, code tokens). Use 1-5 spans, never more, and never emphasize most of the sentence.",
    "For a free-text chat reply (no structured input card), you may emphasize key spans of your reply with an emphasis sentinel block appended at the very end. Do NOT use inline markup like ** or ==; only the sentinel block. Wire format: the visible reply body, then a new line `===EMPHASIS===`, then a JSON array `[{ \"phrase\": \"<exact substring of the reply>\", \"style\": \"strong|mark|code\" }]`, then `===END===`. style is strong (key nouns, numbers, quotes), mark (warnings, deadlines, the single most important phrase), or code (file names, paths, code tokens). phrase MUST be an exact substring of the reply body. Use 1-5 spans, never more, never emphasize most of the reply, and omit the block entirely when nothing needs emphasis. The host strips this block so the user only sees the reply body.",
    "Recommended options are allowed, but the user must still be able to disagree.",
    isInlineChannel
      ? "You have no host tool channel; ask every forcing question by emitting an inline_decision sentinel block (its exact format is defined in the base system prompt). The sentinel must include intent or signalId, an explicit Korean header, 2-4 options, allowFreeText: true, and requiresFreeText: false. Never wait for, or claim to call, a host structured input tool — emit the sentinel so the Mac app renders a pendingUserInput card."
      : "For this Day 1 Office Hours surface, prefer the host structured input tool over inline_decision sentinel JSON so the Mac app renders a pendingUserInput card.",
    "Never present numbered prose choices or markdown bullet choices as the only way to answer.",
    "Use workspace facts and Day 1 answers before broad startup advice.",
    "For open-ended Office Hours without a fixed expected count, after the routed forcing questions are sufficiently answered, close with exactly two terminal cards: first `전제 확인` (signalId: office_hours_premise_challenge), then `대안 비교` (signalId: office_hours_alternatives).",
    "In fixed-count flows, 전제 확인 and 대안 비교 may be discussed only in prose or the final handoff, not as extra structured input cards after the expected-count interview is complete.",
    "전제 확인 must test: whether this is the right problem, what happens if the user does nothing, what existing code/user flow can be reused, and the strongest remaining startup evidence gap.",
    "대안 비교 must contain 최소안, 이상안, and 다른 관점. Mark one as recommended, but do not write docs or implement anything until the user explicitly approves.",
    "Before any external search, ask a privacy gate card using generalized category terms only; if skipped, continue with in-distribution knowledge.",
    "Do not edit files or write artifacts unless the user explicitly asks for implementation or document writing later.",
  ];
  const writeDesignDocRules = isWriteDesignDocFlow
    ? [
        "For the `start startup --write-design-doc` screen, override the broad routing above with a fixed startup design-document flow.",
        "Do not ask mode, product-stage, privacy, or smart-skip gates on this screen.",
        "Ask exactly six startup forcing decisions in this order when missing: real demand evidence, current alternative, reachable person, smallest paid entry point, observed behavior, future importance. In Korean output, label them 수요 증거, 현재 대안, 연락 가능한 사람, 작은 유료 진입점, 관찰한 행동, 앞으로 더 중요해질 이유.",
        `The demand decision MUST use the one-question Q1 demand evidence card above. Each later decision MUST use ${structuredInputTool} with exactly one question, 2-4 options, allowFreeText: true, and requiresFreeText: false.`,
        "After the sixth answer, do not ask 전제 확인 or 대안 비교 as more structured input. Return generated design-doc markdown with frontmatter generated_by: office-hours and handoff_for: day1-docs, including these Korean section headings: 문제 정의, 대상 사용자, 선택한 첫 진입점, 전제 확인, 검토한 대안, 이번에는 제외, 다음 행동.",
        "After the design-doc markdown, return a machine handoff block exactly in this form: ===DAY1_HANDOFF_JSON===, then one JSON object, then ===END===.",
        "The handoff JSON fields are northStarGoal, weeklyProof, targetUser, problem, currentAlternative, entryPoint, nextAction, nonGoals, assumptions, and sourceQuotes. Keep each scalar field to one sentence or less; nonGoals, assumptions, and sourceQuotes are short string arrays.",
        "Use only interview answers and the generated design doc for the handoff JSON. Do not invent reachable people, numbers, costs, or product scope. If unknown, leave the field empty and add one assumption.",
        "Do not mention Agentic30, Day, Foundation, document writing, provider execution, or app internals in the handoff JSON unless the user's product itself is Agentic30.",
      ]
    : [];
  const lockedDay1GoalRules = isLockedDay1GoalFlow
    ? [
        "For the locked Day 1 goal interview, do not ask a mode gate, product-stage gate, or goal-selection question.",
        "Use only the locked goal block as the interview target: goal type, goal text, customer, problem, and validation action are already chosen by the user.",
        `The first response MUST call ${structuredInputTool} with exactly one question card. Do not answer only in prose.`,
        ...(isGetUsersGoalFlow ? [
          "For locked Day 1 get_users, the first structured input card MUST define the active-user counting rule before any acquisition, channel, or evidence question. This active-user-definition card is not eligible for smart-skip while it is still unanswered. Once an answer turn for signalId `get_users_active_user_definition` already exists in this session, emitting that card again is a contract failure — do not repeat it; advance to the next unanswered ladder slot (`get_users_first_candidate`).",
          "The get_users active-user-definition card MUST use signalId `get_users_active_user_definition`, signalLabel `활성 사용자 기준`, allowFreeText: true, requiresFreeText: false, and 2-4 options.",
          "Generate the visible active-user-definition question and option labels from the injected context you can actually see here: the `## Source-Derived Project Context` brief, the locked goal block (goal text, customer, problem, validation action), and the conversation/memory context already in this prompt. You have no file-read tools in this surface, so never claim to scan source, repos, or `.agentic30/memory/` — use only what is injected. The question must make signup, waitlist, pageview, like, follower, and polite interest visibly insufficient, and it must name the user's concrete product/customer/problem when that context names them.",
          "Active-user-definition options should cover materially different counting thresholds such as first result completed, repeated core use, guided/manual success, or a project-specific activation event found in context. Labels and descriptions must be topical to the user's project; do not copy generic labels when context supports sharper wording.",
          "Thin-context honesty: if the injected `## Source-Derived Project Context` brief is missing or generic — no concrete product, customer, or problem, only placeholder text such as 좁히는 중, 확인 필요, or a default 100-user goal — do NOT fabricate a customer persona, names, tools, or channels, and never assume a developer or macOS audience. Keep the first card as the active-user-definition decision only (one decision), phrased honestly around 누가 어떤 결과까지 끝내야 활성 사용자인지, and let the user supply the missing product/customer/problem through free text. But thin context does NOT mean stop or offer only blockers: still advance the full ladder. For later cards, generate non-fabricating, reachability-based option types instead of invented domain facts — e.g. for first_candidate: 최근 이 문제를 말한 실명 상대 / 직접 연락 가능한 지인 / 소개를 요청할 경로 / 아직 후보 없음; for current_alternative allow 아직 모름 as a valid answer that continues. Only the final get_users_day1_commitment card may end the interview. Judge thinness by whether concrete specifics are present, never by a Confidence field, which can be wrong.",
          "Ground the get_users activation behavior in this product's OWN customer from the injected context (the locked goal block plus the `## Source-Derived Project Context` brief), not in any built-in persona: count a user only when records show a concrete validation action and a committed next task, not mere interest. Never assume the customer is a developer or a macOS user unless the injected context explicitly says so.",
          "The active-user-definition card MUST say the failure condition in Korean: 가입, 대기 신청, 페이지 조회, 좋아요, 팔로워, or `관심 있어요` do not count as active users unless the chosen 핵심 행동 is completed.",
          "After the active-user-definition answer, follow this adaptive locked Day 1 get_users question ladder. Ask only the next unanswered card; never jump to a broad acquisition strategy question. The signalId/semantic slot is fixed; the visible Korean question and options are context-generated.",
          "2) `get_users_first_candidate` / signalLabel `첫 후보 확정`: decide the first reachable candidate or candidate source for this week's activation attempt. Options should use named people, handles, segments, channels, or evidence-backed sources from workspace context when available; otherwise use project-specific sources plus one explicit no-candidate blocker.",
          "3) `get_users_current_alternative` / signalLabel `현재 대안`: ask what that candidate currently uses or does to survive the problem. Options should reflect the product domain's likely current alternatives, manual workarounds, competing tools, people/processes, or an unknown-alternative blocker.",
          "4) `get_users_today_request` / signalLabel `오늘 요청`: choose the one request the founder can send today to test whether the candidate reaches the selected activation threshold. Options should be concrete request shapes adapted to the product, such as trying a specific flow, sharing a screen, sending a sample input, reporting a blocker, or naming paid/commitment conditions.",
          "5) `get_users_evidence_format` / signalLabel `증거 형식`: choose the evidence record that will let Day 2 judge progress. Options should match available surfaces in the project context such as DM screenshot, call note, product event, URL, repo/app artifact, form response, analytics snapshot, or refusal reason.",
          "6) `get_users_day1_commitment` / signalLabel `오늘 약속`: turn the chosen candidate, request, deadline, and evidence format into the user's own next action or an explicit blocker. Options should preserve the project-specific candidate/request/evidence slots, not generic task labels.",
          "The get_users first-candidate card MUST NOT ask `고객 후보 1명은 어디에서 찾을 건가요?` as a standalone sourcing question. It must tie the candidate to a reachable person/source, this week's activation request, and a concrete next action. When the project context names a distinctive customer, preserve that customer's distinguishing conditions and exclusion signals in the candidate options — do not flatten them into a generic segment like `비슷한 사람`.",
          "Each active-user-definition option must be operationally pass/fail: for a one-time activation event, name the exact completed behavior; for repeated use, include an explicit count and time window generated from context (e.g. 7일 내 2회), not a vague `반복`.",
          "Slots 4-6 form ONE execution contract, not three planning preferences. get_users_today_request must bind one reachable candidate and one exact customer-facing request that can be sent or performed today; internal product work, drafting-without-sending, broad channel plans, and `생각해보기` are invalid non-blocker options. get_users_evidence_format must choose both (a) the accepted evidence of the candidate's behavior or explicit refusal and (b) where that evidence is stored; an outbound-message screenshot proves outreach only, not activation. get_users_day1_commitment must restate, in every non-blocker option, the candidate, the exact request, a numeric attempt/success threshold (default to the smallest non-zero `1명·1회` when context gives no number), a deadline (몇 시까지), the pass/fail condition, and the evidence location; a blocker option must name the missing slot and the next external unblock action. Choosing where to store evidence is enough — never require public BIP posting (proofSink stays local|bip_optional).",
          "Do not treat the locked get_users interview as complete merely because a request shape or evidence preference was selected. Completion requires an answered get_users_day1_commitment slot (or its explicit blocker).",
          "The get_users Day 1 close is useful for Day 2 only when the transcript contains the candidate, request, and evidence format, or a clear blocker among 후보 없음, 요청 문장 없음, or 증거 위치 없음. Do not count broad channel plans, public-post ideas, likes, followers, waitlists, or future product work as Day 1 progress.",
        ] : []),
        "Ask for the weakest missing evidence behind the locked goal first: money signal for make_money, acquisition/channel signal for get_users, or build flow/user-success signal for build_product.",
        "Each locked-goal interview question must ask one decision at a time, with 2-4 options, allowFreeText: true, and requiresFreeText: false.",
        "Expected question count is a hard upper bound for this locked Day 1 interview. Ask no more than six user-facing structured input cards when the context says `Expected question count: 6`.",
        "After the sixth locked-goal answer, do not ask 전제 확인 or 대안 비교 as more structured input. Stop generating question cards and let the host app show the commitment close.",
        "Do not write files, write docs, publish posts, or update public channels unless the user explicitly approves that later.",
        "If public evidence logging is available, treat it only as a place to record evidence after the interview; do not require public-log setup to continue.",
      ]
    : [];
  const day2GoalDrivenRules = isDay2GoalDrivenFlow
    ? [
        "For Day 2+ goal-driven Office Hours, Day1GoalSelection.goalType is the source of truth for the 30-day goal.",
        "Do not switch, reinterpret, dilute, or ask the user to reselect the 30-day goal unless the user explicitly changes the Day 1 goal.",
        "Use the Day 1 goal contract: goal type, goal text, customer, problem, validation action, prior commitments, open evidence debts, and DAY2_PLUS_LIVE_DIGEST.",
        "The first visible assistant prose must be a short briefing with exactly these four Korean section labels: 30일 목표 상태, 어제/간밤에 바뀐 것, 목표 달성에 도움 되는 신호, 오늘 막고 있는 가장 큰 증거 공백.",
        `After that briefing, the first forcing question MUST call ${structuredInputTool} with exactly one question card. Do not ask the Day 2+ Office Hours question only in prose.`,
        "Every Day 2+ Office Hours question must target exactly one of: progress toward the 30-day goal, missing hard evidence, today's smallest action to advance the goal, or a blocker preventing the goal.",
        "Each Day 2+ question must include 2-4 options, allowFreeText: true, requiresFreeText: false, and option metadata: recommended when applicable, risk, evidenceTarget, mapsTo, and failureMode.",
        "For make_money, push toward a real payment, paid pilot, contract, invoice, or explicit paid-offer response. Price curiosity alone is not success.",
        "For get_users, push toward a measurable acquisition action and activated users, not vanity traffic. Default success is 100 unique people/accounts completing the chosen activation action.",
        ...(isGetUsersGoalFlow ? [
          "For Day 2+ get_users, reuse the `Active user definition` / `get_users_active_user_definition` answer from memory when present. If no such answer exists, the first structured input card MUST ask the same active-user-definition question before acquisition execution.",
          `For this product's ${projectDocPath("icp")} customer definition, apply that definition to record-backed execution: the activated user should complete a validation behavior and receive or commit to the next task, not just join a list or view content.`,
        ] : []),
        "For build_product, push toward a working version that a target user can complete end-to-end. A deploy or commit alone is not enough unless it enables the validation action.",
        "If DAY2_PLUS_LIVE_DIGEST says BUILD_WITHOUT_CUSTOMER_EVIDENCE: true, the first question must challenge the customer/user evidence gap before asking for more building.",
        "If live source data is thin, say so briefly and ask for the smallest action that creates hard evidence today; do not invent analytics, traffic, revenue, user, or deployment facts.",
      ]
    : [];
  const programV2DailyCardRules = isProgramV2DailyCardsFlow
    ? [
        "For AGENTIC30_PROGRAM_V2_DAILY_CARDS, generate only recognized daily card contracts: `office_hours_state_transition` for Card 1 and `office_hours_agent_workpack` for Card 2.",
        "Evidence-first invariant: when `BUILD_WITHOUT_CUSTOMER_EVIDENCE: true` and stale debt, missing proof, or rejected proof exists, the first card must resolve the stale customer-evidence commitment with `office_hours_state_transition` before any broad prompt.",
        "Do not ask broad discovery, strategy, implementation, or UI questions until Card 1 has an explicit state transition: attach evidence, resolve without evidence, replace candidate/action, or keep open today.",
        "Card 1 must use generation.signalId `office_hours_stale_commitment_resolution`, type `office_hours_state_transition`, schemaVersion 2, sourceState, requiresUserAction, commitmentId, candidateName, actionText, repeatCountWithoutEvidence, choices, resolutionReasons, and proofLedgerMapping.",
        "After Card 1 is resolved or the context explicitly says today's evidence state is resolved, generate Card 2 as exactly one `office_hours_agent_workpack` risk lens. Do not generate multiple workpacks.",
        "Card 2 `office_hours_agent_workpack` must separate AI preparation from founder-owned external action. Its workpack must include id, workType, targetExternalAction, expectedProof, notProof, owner `founder`, and deadline.",
        "AI output, drafts, workpack completion, code snippets, demos, and self-report are not proof. They must appear in workpack.notProof or proofLedgerMapping as excluded/negative evidence, never as accepted proof.",
        "Provider prose cannot bypass these structured card contracts. If a daily card is needed, emit the structured card contract; do not describe a Card 1 or Card 2 decision only in prose.",
      ]
    : [];
  return [
    ...baseRules,
    ...writeDesignDocRules,
    ...lockedDay1GoalRules,
    ...day2GoalDrivenRules,
    ...programV2DailyCardRules,
    `Workspace root: ${workspaceRootValue || ""}`,
    specialistInjection ? `\n${specialistInjection}` : "",
    projectContextBrief ? `\n${projectContextBrief}` : "",
    context ? `\n## Day 1 STEP Office Hours Context\n${clampOfficeHoursContext(context)}` : "",
  ].filter(Boolean).join("\n");
}
