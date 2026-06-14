import test from "node:test";
import assert from "node:assert/strict";

import {
  cloudflareSourceSignalFromDrilldown,
  collectCloudflareDirectDrilldown,
  collectPosthogDirectDrilldown,
  mergeMorningBriefingDrilldown,
  mergeMorningBriefingDrilldownMaps,
} from "../sidecar/morning-briefing-direct-sources.mjs";
import { normalizeMorningBriefingDrilldown } from "../sidecar/morning-briefing-drilldown.mjs";

const WINDOW = {
  startMs: Date.parse("2026-06-09T00:00:00.000Z"),
  untilMs: Date.parse("2026-06-10T00:00:00.000Z"),
  startIso: "2026-06-09T00:00:00.000Z",
  untilIso: "2026-06-10T00:00:00.000Z",
};

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

// ── PostHog ──────────────────────────────────────────────────────────────────

function stubPosthogFetch() {
  const calls = [];
  return {
    calls,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      const query = JSON.parse(options.body || "{}")?.query?.query || "";
      if (query.includes("first_day FROM")) {
        // First-time cohorts: 06-08 → 2명, 06-09 → 1명, 오늘(06-10) → 1명.
        return jsonResponse({ results: [["p1", "2026-06-08"], ["p2", "2026-06-08"], ["p3", "2026-06-09"], ["p4", "2026-06-10"]] });
      }
      if (query.includes("DISTINCT person_id, toDate")) {
        // p1 returned next day, p2 did not, p3 returned on 06-10.
        return jsonResponse({ results: [
          ["p1", "2026-06-08"], ["p1", "2026-06-09"],
          ["p2", "2026-06-08"],
          ["p3", "2026-06-09"], ["p3", "2026-06-10"],
          ["p4", "2026-06-10"],
        ] });
      }
      if (query.includes("$pathname")) {
        return jsonResponse({ results: [["/blog/paddle-guide", 76], ["/", 22], ["/pricing", 12]] });
      }
      if (query.includes("GROUP BY event")) {
        return jsonResponse({ results: [["mac_session_created", 24, 3], ["mac_sidecar_office_hours_completed", 4, 2]] });
      }
      if (query.includes(`toDateTime('2026-06-08 00:00:00')`)) {
        return jsonResponse({ results: [[55, 4]] }); // previous window
      }
      return jsonResponse({ results: [[40, 3]] }); // current window
    },
  };
}

test("collectPosthogDirectDrilldown builds Day-1 return curve, KPIs, and web signals from HogQL", async () => {
  const { fetch, calls } = stubPosthogFetch();
  const drilldown = await collectPosthogDirectDrilldown({
    window: WINDOW,
    settings: { token: "phx_test", tokenValid: true, region: "us" },
    fetchImpl: fetch,
  });

  assert.equal(drilldown.id, "posthog");
  assert.match(drilldown.title, /리텐션·이탈/);

  const day1 = drilldown.kpis.find((kpi) => kpi.label === "Day-1 복귀율");
  assert.equal(day1.valueLabel, "100%"); // 06-09 cohort: p3 returned on 06-10
  assert.equal(day1.flag, false);
  assert.match(day1.vsLabel, /06-09 코호트 1명/);
  const actives = drilldown.kpis.find((kpi) => kpi.label === "활성 사용자");
  assert.equal(actives.valueLabel, "3");
  assert.equal(actives.direction, "down");
  const fresh = drilldown.kpis.find((kpi) => kpi.label === "신규(첫 핵심 행동)");
  assert.equal(fresh.valueLabel, "1"); // p4 first seen today

  assert.equal(drilldown.chart.kind, "curve");
  assert.equal(drilldown.chart.baselinePct, 40);
  assert.equal(drilldown.chart.points.length, 2); // 06-08, 06-09 (today excluded)
  assert.match(drilldown.chart.points[0].label, /06-08 · 50% \(2명\)/);
  assert.equal(drilldown.chart.points[0].pct, 50);
  assert.equal(drilldown.chart.points[0].cohortSize, 2);
  assert.equal(drilldown.chart.points[0].returned, 1);
  assert.match(drilldown.chart.points[0].tip, /2026-06-08 코호트 n=2 · 1\/2 복귀/);

  assert.match(drilldown.webMeta, /\$pageview 110뷰/); // 76+22+12
  assert.equal(drilldown.webSignals.length, 3);
  assert.match(drilldown.webSignals[0].text, /\/blog\/paddle-guide 76뷰 — 2주 \$pageview 110뷰의 69%/);
  assert.match(drilldown.webSignals[1].text, /\/ · 22뷰/);

  assert.equal(drilldown.signals.length, 2);
  assert.match(drilldown.signals[0].text, /mac_session_created · 24회/);
  // All calls hit the us Query API with the bearer token.
  assert.ok(calls.every((call) => call.url.startsWith("https://us.posthog.com/api/projects/@current/query")));
  assert.ok(calls.every((call) => call.options.headers.Authorization === "Bearer phx_test"));

  const queries = calls.map((call) => JSON.parse(call.options.body || "{}")?.query?.query || "");
  const productQueries = queries.filter((query) => !query.includes("event = '$pageview'"));
  assert.ok(productQueries.every((query) => query.includes("properties.telemetry_source")));
  assert.ok(productQueries.every((query) => query.includes("'mac_app', 'mac_sidecar'")));
  assert.ok(productQueries.every((query) => query.includes("properties.telemetry_environment")));
  assert.ok(productQueries.every((query) => query.includes("properties.build_configuration")));
  assert.ok(queries.every((query) => query.includes("properties.is_internal_traffic")));
  assert.ok(queries.every((query) => query.includes("person.properties.is_internal_tester")));
  assert.ok(queries.every((query) => query.includes("properties.capture_internal")));
  assert.ok(queries.every((query) => query.includes("properties.auth_email_domain")));
  assert.ok(queries.every((query) => query.includes("person.properties.email_domain")));
  assert.ok(queries.every((query) => query.includes("person.properties.email")));
  assert.ok(queries.every((query) => query.includes("october-academy.com")));
  assert.ok(queries.every((query) => query.includes("properties.$host")));
  assert.ok(queries.every((query) => query.includes("properties.$ip")));
  assert.ok(productQueries.every((query) => !query.includes("workspace_basename")));

  const totalsQuery = queries.find((query) => query.includes("uniqIf(person_id"));
  assert.ok(totalsQuery.includes("workspace_setup_completed"));
  assert.ok(totalsQuery.includes("mac_session_created"));
  assert.ok(totalsQuery.includes("mac_sidecar_session_created"));
  assert.ok(totalsQuery.includes("mac_sidecar_office_hours_completed"));

  const cohortQueries = queries.filter((query) => query.includes("first_day FROM") || query.includes("SELECT DISTINCT person_id, toDate"));
  assert.ok(cohortQueries.length >= 2);
  assert.ok(cohortQueries.every((query) => query.includes("event IN")));
  assert.ok(cohortQueries.every((query) => query.includes("mac_sidecar_office_hours_completed")));

  const webPathQuery = queries.find((query) => query.includes("event = '$pageview'"));
  assert.ok(webPathQuery);
  assert.ok(!webPathQuery.includes("properties.telemetry_source"));
});

test("collectPosthogDirectDrilldown returns null without a valid token", async () => {
  const result = await collectPosthogDirectDrilldown({
    window: WINDOW,
    settings: { token: "", tokenValid: false, region: "us" },
    fetchImpl: async () => { throw new Error("must not be called"); },
  });
  assert.equal(result, null);
});

test("collectPosthogDirectDrilldown surfaces API failures as thrown errors", async () => {
  await assert.rejects(
    collectPosthogDirectDrilldown({
      window: WINDOW,
      settings: { token: "phx_test", tokenValid: true, region: "us" },
      fetchImpl: async () => jsonResponse({ detail: "invalid key" }, false, 401),
    }),
    /PostHog query failed/,
  );
});

// ── Cloudflare ───────────────────────────────────────────────────────────────

function cloudflareHours(startIso, values) {
  return values.map((value, index) => ({
    dimensions: { datetime: new Date(Date.parse(startIso) + index * 3_600_000).toISOString() },
    sum: { requests: value * 3, pageViews: value, threats: 0 },
    uniq: { uniques: value },
  }));
}

function cloudflareTotals({ uniqueVisitors, pageviews, requests, threats = 0 }) {
  return {
    sum: { requests, pageViews: pageviews, threats },
    uniq: { uniques: uniqueVisitors },
  };
}

function stubCloudflareFetch({ failPaths = false, zones = [{ id: "zone-1", name: "agentic30.dev" }] } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("/zones?")) {
        return jsonResponse({ result: zones });
      }
      const body = JSON.parse(options.body || "{}");
      if (String(body.query || "").includes("httpRequestsAdaptiveGroups")) {
        if (failPaths) return jsonResponse({ errors: [{ message: "not entitled" }] });
        return jsonResponse({
          data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [
            { count: 132, sum: { edgeResponseBytes: 12000 }, dimensions: { metric: "/landing" } },
            { count: 34, sum: { edgeResponseBytes: 5000 }, dimensions: { metric: "/pricing" } },
          ] }] } },
        });
      }
      return jsonResponse({
        data: { viewer: { zones: [{
          totals: [cloudflareTotals({ uniqueVisitors: 13, pageviews: 18, requests: 54 })],
          previousTotals: [cloudflareTotals({ uniqueVisitors: 7, pageviews: 8, requests: 24 })],
          hourly: cloudflareHours("2026-06-09T00:00:00.000Z", [2, 3, 8, 5]),
        }] } },
      });
    },
  };
}

test("collectCloudflareDirectDrilldown builds KPIs, 2h buckets, and path table from GraphQL", async () => {
  const { fetch, calls } = stubCloudflareFetch();
  const drilldown = await collectCloudflareDirectDrilldown({
    window: WINDOW,
    settings: { token: "cf_token", tokenValid: true },
    fetchImpl: fetch,
  });

  assert.equal(drilldown.id, "cloudflare");
  assert.match(drilldown.subtitle, /agentic30\.dev/);
  const pv = drilldown.kpis.find((kpi) => kpi.label === "페이지뷰");
  assert.equal(pv.valueLabel, "18"); // 2+3+8+5
  assert.equal(pv.direction, "up"); // vs 8
  const visits = drilldown.kpis.find((kpi) => kpi.label === "순 방문");
  assert.equal(visits.valueLabel, "13"); // no-dimension period total, not max/sum hourly uniques
  assert.equal(visits.vsLabel, "직전 7");

  assert.equal(drilldown.chart.kind, "bars");
  assert.equal(drilldown.chart.title, "시간대별 순 방문, 지난 24시간");
  assert.equal(drilldown.chart.bars.length, 4);
  assert.deepEqual(drilldown.chart.bars.map((bar) => bar.value), [2, 3, 8, 5]);
  assert.doesNotMatch(drilldown.chart.subtitle, /합계/);
  assert.match(drilldown.chart.footnote, /서로 더하지 않습니다/);

  assert.equal(drilldown.table.length, 2);
  assert.equal(drilldown.table[0].code, "/landing");
  assert.equal(drilldown.table[0].share, Math.round((132 / 166) * 100));
  assert.ok(drilldown.meta.rows.some((row) => row.key === "존" && row.value === "agentic30.dev"));

  const pathQuery = calls
    .map((call) => JSON.parse(call.options.body || "{}")?.query || "")
    .find((query) => query.includes("httpRequestsAdaptiveGroups"));
  assert.ok(pathQuery.includes("orderBy: [count_DESC]"));
  assert.match(pathQuery, /requestSource: "eyeball"/);
  assert.ok(pathQuery.includes("dimensions { metric: clientRequestPath }"));

  const source = cloudflareSourceSignalFromDrilldown(drilldown, { selected: true });
  assert.equal(source.counts.visits, 13);
  assert.equal(source.counts.uniqueVisitors, 13);
  assert.equal(source.counts.pageviews, 18);
  assert.equal(Object.hasOwn(source.counts, "pageViews"), false);
  assert.equal(source.selected, true);
});

test("collectCloudflareDirectDrilldown clamps wide briefing windows to trailing 24h", async () => {
  const { fetch, calls } = stubCloudflareFetch();
  await collectCloudflareDirectDrilldown({
    window: {
      startMs: Date.parse("2026-06-08T00:00:00.000Z"),
      untilMs: Date.parse("2026-06-10T00:00:00.000Z"),
    },
    settings: { token: "cf_token", tokenValid: true },
    fetchImpl: fetch,
  });

  const graphqlCalls = calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => JSON.parse(call.options.body || "{}"));
  assert.ok(graphqlCalls.every((body) => body.variables.start >= "2026-06-08T00:00:00.000Z"));
  assert.ok(graphqlCalls.some((body) => body.variables.start === "2026-06-09T00:00:00.000Z"));
  assert.ok(!graphqlCalls.some((body) => body.variables.start === "2026-06-08T00:00:00.000Z" && body.variables.end === "2026-06-10T00:00:00.000Z"));
});

test("collectCloudflareDirectDrilldown selects the product-domain zone, not the first active one", async () => {
  const { fetch, calls } = stubCloudflareFetch({
    zones: [
      { id: "zone-other", name: "october-academy.com" },
      { id: "zone-app", name: "agentic30.app" },
    ],
  });
  await collectCloudflareDirectDrilldown({
    window: WINDOW,
    settings: { token: "cf_token", tokenValid: true },
    env: { AGENTIC30_WEB_BASE_URL: "https://agentic30.app" },
    fetchImpl: fetch,
  });
  const analyticsBody = calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => JSON.parse(call.options.body || "{}"))
    .find((body) => String(body.query).includes("httpRequests1hGroups"));
  // zone-other is result[0], but the agentic30.app web host must win the pick
  assert.equal(analyticsBody.variables.zone, "zone-app");
});

test("collectCloudflareDirectDrilldown honors an explicit CLOUDFLARE_ZONE_ID override", async () => {
  const { fetch, calls } = stubCloudflareFetch({
    zones: [
      { id: "zone-a", name: "agentic30.app" },
      { id: "zone-b", name: "staging.agentic30.app" },
    ],
  });
  await collectCloudflareDirectDrilldown({
    window: WINDOW,
    settings: { token: "cf_token", tokenValid: true },
    env: { CLOUDFLARE_ZONE_ID: "zone-b" },
    fetchImpl: fetch,
  });
  const body = calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => JSON.parse(call.options.body || "{}"))[0];
  assert.equal(body.variables.zone, "zone-b");
});

test("collectCloudflareDirectDrilldown falls back to the first active zone when nothing matches", async () => {
  const { fetch, calls } = stubCloudflareFetch({
    zones: [{ id: "zone-first", name: "someones-fork.example" }],
  });
  await collectCloudflareDirectDrilldown({
    window: WINDOW,
    settings: { token: "cf_token", tokenValid: true },
    env: { AGENTIC30_WEB_BASE_URL: "https://agentic30.app" }, // host has no matching zone here
    fetchImpl: fetch,
  });
  const body = calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => JSON.parse(call.options.body || "{}"))[0];
  assert.equal(body.variables.zone, "zone-first");
});

test("collectCloudflareDirectDrilldown floors the window to the hour so re-queries are reproducible", async () => {
  const { fetch, calls } = stubCloudflareFetch();
  await collectCloudflareDirectDrilldown({
    window: { untilMs: Date.parse("2026-06-10T04:22:33.000Z") },
    settings: { token: "cf_token", tokenValid: true },
    fetchImpl: fetch,
  });
  const analyticsBody = calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => JSON.parse(call.options.body || "{}"))
    .find((body) => String(body.query).includes("httpRequests1hGroups"));
  // 04:22:33 floors to 04:00 on both ends so the in-progress hour is dropped
  assert.equal(analyticsBody.variables.end, "2026-06-10T04:00:00.000Z");
  assert.equal(analyticsBody.variables.start, "2026-06-09T04:00:00.000Z");
  assert.equal(analyticsBody.variables.prevStart, "2026-06-08T04:00:00.000Z");
});

test("collectCloudflareDirectDrilldown omits the path table when the dataset is not entitled", async () => {
  const { fetch } = stubCloudflareFetch({ failPaths: true });
  const drilldown = await collectCloudflareDirectDrilldown({
    window: WINDOW,
    settings: { token: "cf_token", tokenValid: true },
    fetchImpl: fetch,
  });
  assert.deepEqual(drilldown.table, []);
  assert.ok(drilldown.kpis.length >= 2);
});

test("collectCloudflareDirectDrilldown returns null without token or zone", async () => {
  assert.equal(
    await collectCloudflareDirectDrilldown({
      window: WINDOW,
      settings: { token: "", tokenValid: false },
      fetchImpl: async () => { throw new Error("must not be called"); },
    }),
    null,
  );
  assert.equal(
    await collectCloudflareDirectDrilldown({
      window: WINDOW,
      settings: { token: "cf_token", tokenValid: true },
      fetchImpl: async () => jsonResponse({ result: [] }),
    }),
    null,
  );
});

// ── Merge ────────────────────────────────────────────────────────────────────

test("mergeMorningBriefingDrilldown keeps direct numbers and fills narrative from digest", () => {
  const direct = normalizeMorningBriefingDrilldown("posthog", {
    title: "PostHog · 프로덕트 드릴다운",
    kpis: [{ label: "활성 사용자", value: 11, deltaLabel: "▼ 21%", direction: "down" }],
    chart: { kind: "curve", title: "일별 활성 사용자", points: [{ label: "a", pct: 50 }, { label: "b", pct: 100 }] },
  });
  const digest = normalizeMorningBriefingDrilldown("posthog", {
    title: "PostHog · 리텐션·이탈 드릴다운",
    kpis: [{ label: "Day-2 리텐션", valueLabel: "27%" }],
    funnel: {
      steps: [{ label: "랜딩 방문", value: 64 }, { label: "가입", value: 6 }],
      gapLabel: "가입 → 연결 이탈",
    },
    drafts: [{ kind: "message", badge: "메시지", title: "DM 초안", body: "...", applyLabel: "큐에 추가" }],
  });

  const merged = mergeMorningBriefingDrilldown(direct, digest);
  // Direct numbers win.
  assert.equal(merged.kpis[0].label, "활성 사용자");
  assert.equal(merged.chart.title, "일별 활성 사용자");
  // Digest fills sections the API cannot know.
  assert.equal(merged.funnel.steps.length, 2);
  assert.equal(merged.drafts[0].title, "DM 초안");
  assert.equal(merged.title, "PostHog · 프로덕트 드릴다운");

  assert.equal(mergeMorningBriefingDrilldown(null, digest), digest);
  assert.equal(mergeMorningBriefingDrilldown(direct, null), direct);
});

test("mergeMorningBriefingDrilldownMaps merges per source id", () => {
  const direct = {
    cloudflare: normalizeMorningBriefingDrilldown("cloudflare", { kpis: [{ label: "순 방문", value: 8 }] }),
  };
  const digest = {
    cloudflare: normalizeMorningBriefingDrilldown("cloudflare", {
      kpis: [{ label: "방문", value: 64 }],
      signals: [{ time: "02:10", text: "봇 스파이크" }],
    }),
    posthog: normalizeMorningBriefingDrilldown("posthog", { kpis: [{ label: "Day-2 리텐션", valueLabel: "27%" }] }),
  };
  const merged = mergeMorningBriefingDrilldownMaps(direct, digest);
  assert.equal(merged.cloudflare.kpis[0].valueLabel, "8");
  assert.equal(merged.cloudflare.signals[0].time, "02:10");
  assert.equal(merged.posthog.kpis[0].label, "Day-2 리텐션");
});
