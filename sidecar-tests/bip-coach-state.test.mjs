import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  BIP_COACH_SCHEMA_VERSION,
  buildFallbackBipMissionChoices,
  buildBipCoachMissionPrompt,
  buildBipCoachMissionPromptFromEvidence,
  buildSheetRange,
  completeBipCoachMission,
  extractGoogleDocPlainText,
  formatBipCoachGwsError,
  loadBipCoachState,
  mergeBipConfigIntoCoachState,
  normalizeBipCoachState,
  parseGoogleDocUrl,
  parseGoogleSheetUrl,
  parseMissionChoicesResponse,
  parseMissionResponse,
  persistBipCoachState,
  pickSheetTab,
  summarizeSheetValues,
} from "../sidecar/bip-coach-state.mjs";

test("parses Google Sheet and Doc URLs from shared links", () => {
  const sheet = parseGoogleSheetUrl(
    "https://docs.google.com/spreadsheets/d/16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA/edit?pli=1&gid=0#gid=0",
  );
  const doc = parseGoogleDocUrl(
    "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit",
  );

  assert.equal(sheet.spreadsheetId, "16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA");
  assert.equal(sheet.gid, "0");
  assert.equal(doc.documentId, "1AbCdEfGhIjKlMnOpQrStUvWxYz");
});

test("picks october sheet tab and escapes sheet ranges", () => {
  const metadata = {
    sheets: [
      { properties: { title: "콜드콜 영업" } },
      { properties: { title: "@october.ai" } },
    ],
  };

  assert.equal(pickSheetTab(metadata), "@october.ai");
  assert.equal(buildSheetRange("A user's tab"), "'A user''s tab'!A:I");
});

test("summarizes Korean BIP sheet rows", () => {
  const summary = summarizeSheetValues({
    values: [
      ["날짜", "팔로어", "게시물", "게시물 1", "게시물 2", "게시물 3", "특이사항", "인사이트와 배움", "글 쓰는데 소요된 시간"],
      ["2026-04-20", "100", "", "첫 글", "둘째 글", "", "좋아요 증가", "후킹이 중요", "20분"],
      ["2026-04-21", "104", "단일 글", "", "", "", "", "문제 정의가 반응 좋음", "15분"],
    ],
  });

  assert.equal(summary.allRows.length, 2);
  assert.equal(summary.recentRows.length, 2);
  assert.equal(summary.recentRows[0].posts.length, 2);
  assert.equal(summary.recentRows[1].posts[0], "단일 글");
  assert.match(summary.summary, /전체 2개 BIP 기록/);
  assert.match(summary.summary, /팔로어 변화: 100 -> 104/);
  assert.match(summary.summary, /문제 정의가 반응 좋음/);
});

test("keeps all Sheet rows while exposing recent rows for quick UI context", () => {
  const values = [
    ["날짜", "팔로어", "게시물", "게시물 1", "게시물 2", "게시물 3", "특이사항", "인사이트와 배움", "글 쓰는데 소요된 시간"],
  ];
  for (let index = 1; index <= 50; index += 1) {
    values.push([`2026-04-${String(index).padStart(2, "0")}`, String(100 + index), `글 ${index}`]);
  }

  const summary = summarizeSheetValues({ values });

  assert.equal(summary.allRows.length, 50);
  assert.equal(summary.recentRows.length, 7);
  assert.equal(summary.recentRows.at(-1).date, "2026-04-50");
  assert.match(summary.summary, /전체 50개 BIP 기록을 읽었습니다/);
});

test("extracts plain text from Google Docs document payload", () => {
  const text = extractGoogleDocPlainText({
    body: {
      content: [
        {
          paragraph: {
            elements: [
              { textRun: { content: "2026-04-24\n" } },
              { textRun: { content: "오늘은 BIP 글감을 정리했다." } },
            ],
          },
        },
      ],
    },
  });

  assert.equal(text, "2026-04-24\n오늘은 BIP 글감을 정리했다.");
});

test("extracts plain text from Google Docs table cells", () => {
  const text = extractGoogleDocPlainText({
    body: {
      content: [
        {
          table: {
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            { textRun: { content: "업무 일지\n" } },
                          ],
                        },
                      },
                    ],
                  },
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            { textRun: { content: "오늘은 고객 인터뷰 질문을 정리했다.\n" } },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  });

  assert.equal(text, "업무 일지\n오늘은 고객 인터뷰 질문을 정리했다.");
});

test("extracts plain text from Google Docs tab content", () => {
  const text = extractGoogleDocPlainText({
    tabs: [
      {
        documentTab: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [
                    { textRun: { content: "탭 안의 업무일지\n" } },
                  ],
                },
              },
            ],
          },
        },
      },
    ],
  });

  assert.equal(text, "탭 안의 업무일지");
});

test("mission prompt delegates full Google reads to the agent", () => {
  const prompt = buildBipCoachMissionPrompt({
    today: "2026-04-25",
    curriculumDay: {
      day: 12,
      phase: "build",
      title: "Daily Mission loop를 만든다",
      tasks: ["Day context를 prompt에 넣기", "미션 카드 출력 확인", "완료 기록 저장 흐름 연결"],
      output: "오늘 미션 생성/완료 흐름",
    },
    state: {
      config: {
        provider: "codex",
        sheetId: "sheet123",
        docId: "doc123",
        sheetTabName: "@october.ai",
        threadsHandle: "october.ai",
      },
      evidence: {
        fullRead: true,
        sheetTitle: "SNS 기록",
        sheetTabName: "@october.ai",
        allRows: [
          { rowNumber: 2, date: "2026-04-20", followers: "100", posts: ["첫 글"] },
          { rowNumber: 3, date: "2026-04-25", followers: "120", posts: ["최신 글"] },
        ],
        recentRows: [
          { rowNumber: 3, date: "2026-04-25", followers: "120", posts: ["최신 글"] },
        ],
        sheetRowsRead: 2,
        docTitle: "업무일지",
        docText: "전체 업무일지 본문",
        docCharsRead: 9,
      },
    },
  });

  assert.match(prompt, /gws_sheets_read/);
  assert.match(prompt, /gws_docs_read/);
  assert.match(prompt, /'<tab>'!A:I/);
  assert.match(prompt, /sheet123/);
  assert.match(prompt, /doc123/);
  assert.match(prompt, /\/office-hours/);
  assert.match(prompt, /Demand reality/);
  assert.match(prompt, /\/plan-ceo-review/);
  assert.match(prompt, /10-star product/);
  assert.match(prompt, /Daily Mission loop/);
  assert.match(prompt, /미션 카드 출력 확인/);
  assert.match(prompt, /"missions"/);
  assert.doesNotMatch(prompt, /"allRows"/);
  assert.doesNotMatch(prompt, /2026-04-20/);
  assert.doesNotMatch(prompt, /전체 업무일지 본문/);
});

test("mission prompt can use sidecar-read evidence without delegating Google reads", () => {
  const prompt = buildBipCoachMissionPromptFromEvidence({
    today: "2026-04-25",
    curriculumDay: {
      day: 12,
      title: "Daily Mission loop를 만든다",
      tasks: ["미션 카드 출력 확인"],
      output: "오늘 미션 생성/완료 흐름",
    },
    state: {
      config: {
        provider: "codex",
        sheetId: "sheet123",
        docId: "doc123",
        sheetTabName: "@october.ai",
        threadsHandle: "october.ai",
      },
      evidence: {
        fullRead: true,
        source: "sidecar_gws",
        sheetTitle: "SNS 기록",
        sheetTabName: "@october.ai",
        allRows: [
          { rowNumber: 2, date: "2026-04-20", followers: "100", posts: ["첫 글"] },
          { rowNumber: 3, date: "2026-04-25", followers: "120", posts: ["최신 글"] },
        ],
        recentRows: [
          { rowNumber: 3, date: "2026-04-25", followers: "120", posts: ["최신 글"] },
        ],
        sheetRowsRead: 2,
        docTitle: "업무일지",
        docText: "전체 업무일지 본문",
        docCharsRead: 9,
      },
    },
  });

  assert.doesNotMatch(prompt, /agentic30_sidecar\.gws_sheets_read/);
  assert.doesNotMatch(prompt, /agentic30_sidecar\.gws_docs_read/);
  assert.match(prompt, /sidecar가 이미 Google Sheet 전체 A:I 범위/);
  assert.match(prompt, /2026-04-20/);
  assert.match(prompt, /최신 글/);
  assert.match(prompt, /전체 업무일지 본문/);
  assert.match(prompt, /Daily Mission loop/);
  assert.match(prompt, /"missions"/);
});

test("sidecar-read mission prompt supports one parallel generation lane", () => {
  const prompt = buildBipCoachMissionPromptFromEvidence({
    today: "2026-04-25",
    lane: "customer_evidence",
    state: {
      config: { provider: "codex", sheetId: "sheet", docId: "doc" },
      evidence: {
        fullRead: true,
        allRows: [{ rowNumber: 2, date: "2026-04-25", posts: ["고객 인터뷰 배움"] }],
        docText: "고객이 온보딩에서 막혔다.",
        sheetRowsRead: 1,
        docCharsRead: 15,
      },
    },
  });

  assert.match(prompt, /고객증거/);
  assert.match(prompt, /고객이 온보딩에서 막혔다/);
  assert.match(prompt, /"title"/);
  assert.doesNotMatch(prompt, /"missions"/);
});

test("builds fallback mission choices from sidecar-read evidence and curriculum", () => {
  const choices = buildFallbackBipMissionChoices({
    today: "2026-04-25",
    now: new Date("2026-04-25T01:00:00.000Z"),
    curriculumDay: {
      day: 1,
      title: "문제 지도를 만든다",
      tasks: ["반복 문제 후보를 3개 적기"],
      output: "문제 지도",
    },
    state: {
      config: {
        provider: "codex",
        threadsHandle: "october.ai",
        sheetId: "sheet",
        docId: "doc",
      },
      evidence: {
        fullRead: true,
        source: "sidecar_gws",
        summary: "전체 2개 BIP 기록을 읽었습니다.",
        allRows: [
          { rowNumber: 2, date: "2026-04-24", followers: "100", posts: ["첫 글"], insights: "문제 정의가 반응 좋음" },
          { rowNumber: 3, date: "2026-04-25", followers: "104", posts: ["둘째 글"], insights: "온보딩 막힘이 반복됨" },
        ],
        recentRows: [
          { rowNumber: 2, date: "2026-04-24", followers: "100", posts: ["첫 글"], insights: "문제 정의가 반응 좋음" },
          { rowNumber: 3, date: "2026-04-25", followers: "104", posts: ["둘째 글"], insights: "온보딩 막힘이 반복됨" },
        ],
        docText: "오늘은 ICP가 어디서 막히는지 정리했다.",
        sheetRowsRead: 2,
        docCharsRead: 24,
      },
    },
  });

  assert.equal(choices.length, 3);
  assert.equal(choices[0].provider, "local");
  assert.match(choices[0].mission, /반복 문제 후보를 3개 적기/);
  assert.match(choices[1].drafts.join("\n"), /문제 지도/);
  assert.match(choices[2].evidenceRefs.join("\n"), /오늘은 ICP/);
});

test("parses three mission choices from provider JSON", () => {
  const choices = parseMissionChoicesResponse(
    JSON.stringify({
      missions: [
        {
          title: "문제 증거 공개",
          angle: "Day 12 미션 루프의 근거",
          mission: "문제 증거 하나를 Threads에 올리고 Sheet에 기록한다.",
          drafts: ["초안1"],
          eveningChecklist: ["URL 기록"],
          evidenceRefs: ["Sheet row 2", "Day 12 output"],
        },
        {
          title: "제품 진행 공개",
          angle: "미션 카드 출력 확인",
          mission: "오늘 만든 카드 흐름을 공개한다.",
        },
        {
          title: "학습 공개",
          angle: "반응 없는 이유를 줄인다",
          mission: "막힌 점 하나와 다음 실험을 쓴다.",
        },
      ],
    }),
    {
      provider: "codex",
      compact: true,
      today: "2026-04-24",
      now: new Date("2026-04-24T01:00:00.000Z"),
    },
  );

  assert.equal(choices.length, 3);
  assert.equal(choices[0].id, "2026-04-24-1776992400000-1");
  assert.equal(choices[0].compact, true);
  assert.equal(choices[1].title, "제품 진행 공개");
  assert.deepEqual(choices[0].evidenceRefs, ["Sheet row 2", "Day 12 output"]);
});

test("pads mission choices to three cards when provider returns too few", () => {
  const choices = parseMissionChoicesResponse(
    JSON.stringify({
      title: "하나만 온 미션",
      mission: "그래도 카드 세 개를 보여줘야 한다.",
    }),
    {
      provider: "codex",
      today: "2026-04-24",
      now: new Date("2026-04-24T01:00:00.000Z"),
    },
  );

  assert.equal(choices.length, 3);
  assert.equal(choices[0].title, "하나만 온 미션");
  assert.match(choices[1].title, /제품 진행/);
  assert.match(choices[2].title, /학습/);
});

test("drops legacy partial evidence and missions on load", () => {
  const state = normalizeBipCoachState({
    config: { provider: "codex", sheetId: "sheet", docId: "doc" },
    evidence: {
      recentRows: [{ rowNumber: 2, date: "2026-03-07" }],
      docExcerpt: "부분 업무일지",
      sheetRowsRead: 1,
      docCharsRead: 6,
      docWasTruncated: true,
    },
    currentMission: {
      id: "legacy",
      status: "drafted",
      title: "잘린 근거 미션",
    },
  });

  assert.equal(state.evidence, null);
  assert.equal(state.currentMission, null);
});

test("preserves full-read evidence and mission state", () => {
  const state = normalizeBipCoachState({
    config: { provider: "codex", sheetId: "sheet", docId: "doc" },
    evidence: {
      fullRead: true,
      allRows: [{ rowNumber: 2, date: "2026-04-25" }],
      recentRows: [{ rowNumber: 2, date: "2026-04-25" }],
      docText: "",
      sheetRowsRead: 1,
      docCharsRead: 0,
    },
    currentMission: {
      id: "full",
      status: "drafted",
      title: "전체 근거 미션",
    },
  });

  assert.equal(state.evidence.fullRead, true);
  assert.equal(state.currentMission.id, "full");
});

test("preserves agent-read gws evidence receipts", () => {
  const state = normalizeBipCoachState({
    config: { provider: "codex", sheetId: "sheet", docId: "doc" },
    evidence: {
      fullRead: true,
      source: "agent_gws",
      summary: "Agent가 gws 도구로 전체 확인",
      toolUsage: {
        sheetValuesRead: true,
        docRead: true,
      },
    },
    currentMission: {
      id: "agent-read",
      status: "drafted",
      title: "agent 근거 미션",
    },
  });

  assert.equal(state.evidence.source, "agent_gws");
  assert.equal(state.evidence.toolUsage.sheetValuesRead, true);
  assert.equal(state.currentMission.id, "agent-read");
});

test("normalizes missing BIP config as empty state", () => {
  const state = normalizeBipCoachState(null);
  const merged = mergeBipConfigIntoCoachState(state, null);

  assert.equal(merged.schemaVersion, BIP_COACH_SCHEMA_VERSION);
  assert.equal(merged.config.provider, "codex");
  assert.equal(merged.config.sheetId, "");
  assert.equal(merged.config.docId, "");
});

test("formats GWS auth failures as reconnect instructions", () => {
  const error = new Error(
    "Using keyring backend: keyring error[auth]: Authentication failed: Failed to get token: Server error: invalid_grant",
  );

  const message = formatBipCoachGwsError(error);

  assert.match(message, /Google 연결이 만료됐어요/);
  assert.match(message, /BIP Coach 카드/);
  assert.match(message, /원래 작업/);
  assert.doesNotMatch(message, /터미널/);
  assert.doesNotMatch(message, /invalid_grant/);
  assert.doesNotMatch(message, /keyring/);
});

test("formats missing GWS CLI as setup instructions", () => {
  const message = formatBipCoachGwsError(new Error("`gws` CLI not found on PATH."));

  assert.match(message, /`gws` CLI를 찾지 못했어요/);
  assert.match(message, /BIP Coach 설정 카드/);
});

test("formats OAuth test-user denial as consent-screen instructions", () => {
  const message = formatBipCoachGwsError(
    new Error("Error 403: access_denied. The developer hasn't given you access to this app. The app is currently being tested."),
  );

  assert.match(message, /OAuth 앱/);
  assert.match(message, /테스트 모드/);
  assert.match(message, /Test users/);
});

test("parses mission JSON and completes streaks", () => {
  const mission = parseMissionResponse(
    JSON.stringify({
      title: "오늘은 문제를 좁힌다",
      angle: "마케팅이 아니라 첫 반응 수집",
      mission: "Threads에 관찰글을 올리고 Sheet를 채운다.",
      drafts: ["초안1", "초안2", "초안3"],
      eveningChecklist: ["URL 기록", "Sheet 행 기록"],
      evidenceRefs: ["Sheet row 2"],
    }),
    {
      provider: "claude",
      today: "2026-04-24",
      now: new Date("2026-04-24T01:00:00.000Z"),
    },
  );

  assert.equal(mission.provider, "claude");
  assert.equal(mission.drafts.length, 3);

  const completed = completeBipCoachMission(
    {
      config: { provider: "claude", sheetId: "sheet", docId: "doc" },
      evidence: {
        fullRead: true,
        allRows: [{ rowNumber: 2, date: "2026-04-24" }],
        recentRows: [{ rowNumber: 2, date: "2026-04-24" }],
        docText: "",
        sheetRowsRead: 1,
        docCharsRead: 0,
      },
      currentMission: mission,
      streak: { current: 2, longest: 5, lastCompletedDate: "2026-04-23" },
    },
    {
      threadsUrl: "https://threads.net/@october/post/1",
      sheetRowNote: "@october.ai row 24",
      completedAt: new Date("2026-04-24T12:00:00.000Z"),
      today: "2026-04-24",
    },
  );

  assert.equal(completed.schemaVersion, BIP_COACH_SCHEMA_VERSION);
  assert.equal(completed.currentMission.status, "completed");
  assert.equal(completed.streak.current, 3);
  assert.equal(completed.streak.longest, 5);
});

test("persists normalized BIP Coach state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-bip-coach-"));
  const filePath = path.join(dir, "bip-coach-state.json");

  await persistBipCoachState(filePath, {
    sessionId: "session-1",
    config: {
      provider: "claude",
      sheetUrl: "https://docs.google.com/spreadsheets/d/sheet12345678901234567890/edit",
      docUrl: "https://docs.google.com/document/d/doc12345678901234567890/edit",
    },
  });

  const loaded = await loadBipCoachState(filePath);
  assert.equal(loaded.schemaVersion, BIP_COACH_SCHEMA_VERSION);
  assert.equal(loaded.sessionId, "session-1");
  assert.equal(loaded.config.provider, "claude");
  assert.equal(loaded.config.sheetId, "sheet12345678901234567890");
  assert.equal(loaded.config.docId, "doc12345678901234567890");
});
