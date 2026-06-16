import { resolveCloudflareMcpSettings } from "./cloudflare-mcp-config.mjs";
import { resolvePostHogMcpSettings } from "./posthog-mcp-config.mjs";
import {
  normalizeCloudflareDrilldownMeasurements,
  normalizeMorningBriefingDrilldown,
} from "./morning-briefing-drilldown.mjs";

// Direct API collectors for the morning-briefing drilldowns. The same
// credentials the MCP integrations already store (PostHog phx_/pha_ personal
// API key, Cloudflare API token) also authenticate the vendors' public HTTP
// APIs, so the drilldown numbers come straight from PostHog Query API (HogQL)
// and the Cloudflare GraphQL Analytics API — deterministic, no LLM in the
// numeric path. The provider digest still supplies narrative sections (action
// drafts, funnels) and is merged in section-by-section: direct numbers win,
// digest fills what the APIs cannot know.

const DIRECT_FETCH_TIMEOUT_MS = 15_000;
const HOUR_MS = 3_600_000;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchJson(fetchImpl, url, { method = "GET", headers = {}, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

function deltaLabelFor(current, previous) {
  const cur = finiteNumber(current);
  const prev = finiteNumber(previous);
  if (cur === null || prev === null) return { deltaLabel: null, direction: null };
  const diff = cur - prev;
  if (diff === 0) return { deltaLabel: "=", direction: "flat" };
  const pct = prev > 0 ? Math.round((Math.abs(diff) / prev) * 100) : null;
  const arrow = diff > 0 ? "▲" : "▼";
  return {
    deltaLabel: pct !== null && pct <= 999 ? `${arrow} ${pct}%` : `${arrow} ${Math.abs(diff)}`,
    direction: diff > 0 ? "up" : "down",
  };
}

function utcSqlDateTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function dayLabel(value) {
  const text = String(value || "");
  return text.length >= 10 ? text.slice(5, 10) : text;
}

// ── PostHog (Query API / HogQL) ──────────────────────────────────────────────

function posthogHost(region = "us") {
  return region === "eu" ? "https://eu.posthog.com" : "https://us.posthog.com";
}

const POSTHOG_PRODUCT_SOURCES = Object.freeze(["mac_app", "mac_sidecar"]);
const POSTHOG_CORE_ACTION_EVENTS = Object.freeze([
  "workspace_setup_completed",
  "mac_session_created",
  "mac_sidecar_session_created",
  "mac_sidecar_office_hours_completed",
]);

function hogqlString(value) {
  // Escape backslashes BEFORE quotes (ClickHouse honors backslash escapes; a
  // trailing backslash would otherwise neutralize the closing quote). Mirrors
  // active-users-snapshot.mjs. For today's hardcoded constant inputs this is a
  // no-op — pure hardening for any future dynamic source name.
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function hogqlList(values = []) {
  return `(${values.map(hogqlString).join(", ")})`;
}

const POSTHOG_PRODUCT_SOURCE_SQL = hogqlList(POSTHOG_PRODUCT_SOURCES);
const POSTHOG_CORE_ACTION_EVENT_SQL = hogqlList(POSTHOG_CORE_ACTION_EVENTS);
const POSTHOG_INTERNAL_EMAIL_DOMAIN = "october-academy.com";
const POSTHOG_INTERNAL_EMAIL_DOMAIN_SQL = hogqlString(POSTHOG_INTERNAL_EMAIL_DOMAIN);
const POSTHOG_NON_INTERNAL_FILTER = [
  "lower(coalesce(toString(properties.capture_internal), '')) NOT IN ('true', '1', 'yes')",
  "lower(coalesce(toString(properties.is_internal_traffic), '')) NOT IN ('true', '1', 'yes')",
  "lower(coalesce(toString(person.properties.is_internal_tester), '')) NOT IN ('true', '1', 'yes')",
  `lower(coalesce(toString(properties.auth_email_domain), '')) != ${POSTHOG_INTERNAL_EMAIL_DOMAIN_SQL}`,
  `lower(coalesce(toString(person.properties.email_domain), '')) != ${POSTHOG_INTERNAL_EMAIL_DOMAIN_SQL}`,
  `positionCaseInsensitive(coalesce(toString(person.properties.email), ''), '@${POSTHOG_INTERNAL_EMAIL_DOMAIN}') = 0`,
  "NOT match(coalesce(toString(properties.$host), ''), '^(localhost|127[.]0[.]0[.]1)($|:)')",
  "NOT match(coalesce(toString(properties.$ip), ''), '^(127[.]0[.]0[.]1|::1)$')",
].join(" AND ");
const POSTHOG_PRODUCT_TELEMETRY_FILTER = [
  `toString(properties.telemetry_source) IN ${POSTHOG_PRODUCT_SOURCE_SQL}`,
  "toString(properties.telemetry_environment) = 'production'",
  "toString(properties.build_configuration) = 'release'",
  POSTHOG_NON_INTERNAL_FILTER,
].join(" AND ");
const POSTHOG_CORE_ACTION_FILTER = `event IN ${POSTHOG_CORE_ACTION_EVENT_SQL}`;

async function runHogql({ fetchImpl, host, token, query }) {
  const { ok, payload } = await fetchJson(fetchImpl, `${host}/api/projects/@current/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: { query: { kind: "HogQLQuery", query } },
  });
  if (!ok || !Array.isArray(payload?.results)) {
    throw new Error(`PostHog query failed: ${payload?.detail || payload?.error || "no results"}`);
  }
  return payload.results;
}

function posthogWindowRangeLabel(window = {}) {
  const start = window.startIso
    || (Number.isFinite(window.startMs) ? new Date(window.startMs).toISOString() : "");
  const until = window.untilIso
    || (Number.isFinite(window.untilMs) ? new Date(window.untilMs).toISOString() : "");
  if (!start && !until) return "기간 미상";
  return `${dayLabel(start) || "?"}~${dayLabel(until) || "?"}`;
}

// When the deterministic Query-API collection genuinely ERRORS (a thrown HogQL
// query — caught in index.mjs with telemetry), we must NOT silently fall back to
// the LLM digest's zero-defaults: that masks the failure as "0 events / 0 active"
// and reads as "you have no users" when measurement simply did not complete. This
// explicit card says "수집 실패" instead of "0", and its `collectionFailed` marker
// makes mergeMorningBriefingDrilldown keep it terminal (no narrative/zero backfill
// from the digest). NOTE: a missing API key is NOT an error — in OAuth-only mode
// collectPosthogDirectDrilldown returns null and the digest's real OAuth-collected
// numbers are kept, so this card is reserved strictly for genuine errors.
// normalizeMorningBriefingDrilldown preserves the marker through merge and the
// re-normalization in buildMorningBriefing, so it reaches the broadcast; Swift's
// synthesized Codable ignores it today but can later render a retry affordance.
export function buildPosthogCollectionFailureDrilldown({ reason = "", region = "us", window = {} } = {}) {
  const windowLabel = posthogWindowRangeLabel(window);
  const detail = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 160)
    || "PostHog 집계 쿼리를 완료하지 못했습니다.";
  const regionLabel = String(region || "us").toUpperCase();
  const failedKpi = (label, vs) => ({
    label,
    valueLabel: "수집 실패",
    deltaLabel: "재시도 필요",
    direction: "flat",
    vs,
    flag: true,
  });
  return normalizeMorningBriefingDrilldown("posthog", {
    collectionFailed: true,
    title: "PostHog · 측정 수집 실패",
    subtitle: "수집 경로 오류 — 0과 실제 공백을 구분할 수 없음",
    syncPills: ["측정 수집 실패", "수치는 0이 아니라 미수집"],
    kpis: [
      failedKpi("이벤트", windowLabel),
      failedKpi("활성 사용자", "집계 미완료"),
      failedKpi("Day-1 리텐션", "집계 미완료"),
    ],
    kpisMeta: "PostHog Query API 수집 실패 · 수치 미표시",
    signals: [
      { time: "수집 실패", text: detail },
      { time: "주의", text: "측정값이 0이라는 뜻이 아니라 집계를 끝내지 못했다는 뜻이에요. 재시도 후 갱신하세요." },
    ],
    meta: {
      progress: { label: "측정 상태", valueLabel: "수집 실패", sub: "재시도 후 갱신", ratio: 0 },
      rows: [
        { key: "집계", value: "PostHog Query API", tone: "accent" },
        { key: "리전", value: regionLabel },
        { key: "상태", value: "수집 실패 — 재시도 필요", tone: "amber" },
      ],
    },
  });
}

export async function collectPosthogDirectDrilldown({
  window = {},
  env = process.env,
  appSupportPath = "",
  settings = null,
  fetchImpl = fetch,
} = {}) {
  const resolved = settings ?? resolvePostHogMcpSettings({ env, appSupportPath });
  // No stored Query-API key. In production this is only reached when PostHog is
  // "ready" via MCP OAuth (readiness = tokenValid || oauthReady, see
  // daily-office-hours-digest.mjs), where the real numbers arrive through the LLM
  // digest's posthog drilldown. Return null so the merge keeps those real digest
  // numbers — a missing API key is NOT a collection failure. The terminal failure
  // card is reserved for a genuine direct-collection error (a thrown HogQL query,
  // caught in index.mjs with telemetry).
  if (!resolved?.tokenValid) return null;
  const host = posthogHost(resolved.region);
  const token = resolved.token;
  const parsedUntilMs = Date.parse(window.untilIso || "");
  const untilMs = finiteNumber(window.untilMs) ?? (Number.isFinite(parsedUntilMs) ? parsedUntilMs : Date.now());
  const parsedStartMs = Date.parse(window.startIso || "");
  const startMs = finiteNumber(window.startMs) ?? (Number.isFinite(parsedStartMs) ? parsedStartMs : untilMs - 86_400_000);
  const spanMs = untilMs - startMs;
  const start = utcSqlDateTime(startMs);
  const until = utcSqlDateTime(untilMs);
  const prevStart = utcSqlDateTime(startMs - spanMs);

  const totalsQuery = (fromSql, toSql) =>
    `SELECT count() AS events, uniqIf(person_id, ${POSTHOG_CORE_ACTION_FILTER}) AS actives FROM events `
    + `WHERE timestamp >= toDateTime('${fromSql}') AND timestamp < toDateTime('${toSql}') `
    + `AND ${POSTHOG_PRODUCT_TELEMETRY_FILTER}`;

  const cohortStart = utcSqlDateTime(untilMs - 9 * 86_400_000);
  const webStart = utcSqlDateTime(untilMs - 14 * 86_400_000);
  const [current, previous, topEvents, firstDays, activeDays, webPaths] = await Promise.all([
    runHogql({ fetchImpl, host, token, query: totalsQuery(start, until) }),
    runHogql({ fetchImpl, host, token, query: totalsQuery(prevStart, start) }),
    runHogql({
      fetchImpl, host, token,
      query: `SELECT event, count() AS c, count(DISTINCT person_id) AS people FROM events `
        + `WHERE timestamp >= toDateTime('${start}') AND timestamp < toDateTime('${until}') `
        + `AND ${POSTHOG_PRODUCT_TELEMETRY_FILTER} `
        + `GROUP BY event ORDER BY c DESC LIMIT 6`,
    }),
    // First-time cohorts: each person's first core product action day (last ~9 days).
    runHogql({
      fetchImpl, host, token,
      query: `SELECT person_id, first_day FROM `
        + `(SELECT person_id, min(toDate(timestamp)) AS first_day FROM events `
        + `WHERE ${POSTHOG_PRODUCT_TELEMETRY_FILTER} AND ${POSTHOG_CORE_ACTION_FILTER} GROUP BY person_id) `
        + `WHERE first_day >= toDate(toDateTime('${cohortStart}')) ORDER BY first_day ASC LIMIT 10000`,
    }),
    // Core-action days for those windows — joined in JS to compute Day-1 복귀율.
    runHogql({
      fetchImpl, host, token,
      query: `SELECT DISTINCT person_id, toDate(timestamp) AS day FROM events `
        + `WHERE timestamp >= toDateTime('${cohortStart}') AND timestamp < toDateTime('${until}') `
        + `AND ${POSTHOG_PRODUCT_TELEMETRY_FILTER} AND ${POSTHOG_CORE_ACTION_FILTER} LIMIT 50000`,
    }),
    // Web path breakdown for the 웹 신호 section (last 2 weeks of $pageview).
    runHogql({
      fetchImpl, host, token,
      query: `SELECT properties.$pathname AS path, count() AS views FROM events `
        + `WHERE event = '$pageview' AND timestamp >= toDateTime('${webStart}') AND timestamp < toDateTime('${until}') `
        + `AND ${POSTHOG_NON_INTERNAL_FILTER} `
        + `GROUP BY path ORDER BY views DESC LIMIT 6`,
    }),
  ]);

  const [events, actives] = [finiteNumber(current?.[0]?.[0]) ?? 0, finiteNumber(current?.[0]?.[1]) ?? 0];
  const [prevEvents, prevActives] = [finiteNumber(previous?.[0]?.[0]) ?? 0, finiteNumber(previous?.[0]?.[1]) ?? 0];
  const activesDelta = deltaLabelFor(actives, prevActives);
  const eventsDelta = deltaLabelFor(events, prevEvents);

  // Day-1 복귀율 per first-time cohort (briefing-posthog.html retention curve):
  // share of each day's first-ever users who came back the following day.
  const activityByPerson = new Map();
  for (const row of activeDays || []) {
    const person = String(row?.[0] ?? "");
    const day = String(row?.[1] ?? "");
    if (!person || !day) continue;
    if (!activityByPerson.has(person)) activityByPerson.set(person, new Set());
    activityByPerson.get(person).add(day);
  }
  const cohorts = new Map();
  for (const row of firstDays || []) {
    const person = String(row?.[0] ?? "");
    const day = String(row?.[1] ?? "");
    if (!person || !day) continue;
    if (!cohorts.has(day)) cohorts.set(day, { size: 0, returned: 0 });
    const cohort = cohorts.get(day);
    cohort.size += 1;
    const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (activityByPerson.get(person)?.has(nextDay)) cohort.returned += 1;
  }
  const todayKey = new Date(untilMs).toISOString().slice(0, 10);
  const cohortPoints = [...cohorts.entries()]
    .filter(([day, cohort]) => day < todayKey && cohort.size > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([day, cohort]) => ({
      day,
      size: cohort.size,
      returned: cohort.returned,
      pct: Math.round((cohort.returned / cohort.size) * 100),
    }));
  const latestCohort = cohortPoints[cohortPoints.length - 1] || null;
  const newToday = cohorts.get(todayKey)?.size ?? 0;

  // 웹 신호: path-level pageview breakdown, top-share framing like the mockup.
  const pathRows = (webPaths || [])
    .map((row) => ({ path: String(row?.[0] || ""), views: finiteNumber(row?.[1]) ?? 0 }))
    .filter((row) => row.path);
  const totalWebViews = pathRows.reduce((sum, row) => sum + row.views, 0);
  const webSignals = [];
  if (pathRows[0]) {
    const share = totalWebViews > 0 ? Math.round((pathRows[0].views / totalWebViews) * 100) : 0;
    webSignals.push({
      time: "유입 1위",
      text: `${pathRows[0].path} ${pathRows[0].views}뷰 — 2주 $pageview ${totalWebViews}뷰의 ${share}%`,
    });
  }
  for (const row of pathRows.slice(1, 4)) {
    webSignals.push({ time: "경로", text: `${row.path} · ${row.views}뷰` });
  }

  return normalizeMorningBriefingDrilldown("posthog", {
    title: "PostHog · 리텐션·이탈 드릴다운",
    subtitle: `PostHog Query API · ${resolved.region.toUpperCase()}`,
    syncPills: [
      latestCohort
        ? `Day-1 복귀율 ${latestCohort.pct}% · 코호트 ${latestCohort.size}명`
        : `지난 24시간 활성 ${actives}`,
      `이벤트 ${events} · 어제 ${prevEvents}`,
    ],
    kpis: [
      ...(latestCohort
        ? [{
            label: "Day-1 복귀율",
            valueLabel: `${latestCohort.pct}%`,
            vs: `${dayLabel(latestCohort.day)} 코호트 ${latestCohort.size}명`,
            flag: latestCohort.pct < 40,
          }]
        : []),
      {
        label: "활성 사용자",
        valueLabel: String(actives),
        deltaLabel: activesDelta.deltaLabel,
        direction: activesDelta.direction,
        vs: `어제 ${prevActives}`,
      },
      { label: "신규(첫 핵심 행동)", valueLabel: String(newToday), vs: "오늘 첫 핵심 행동 기준" },
      {
        label: "이벤트",
        valueLabel: String(events),
        deltaLabel: eventsDelta.deltaLabel,
        direction: eventsDelta.direction,
        vs: `어제 ${prevEvents}`,
      },
    ],
    kpisMeta: "PostHog Query API · 표본 작음 · 방향만",
    chart: cohortPoints.length >= 2
      ? {
          kind: "curve",
          title: "Day-1 복귀율 · 첫 실행 코호트별",
          subtitle: "첫 핵심 행동 코호트 · 다음날 복귀율 · HogQL 집계",
          points: cohortPoints.map((point) => ({
            label: `${dayLabel(point.day)} · ${point.pct}% (${point.size}명)`,
            pct: point.pct,
            date: point.day,
            cohortSize: point.size,
            returned: point.returned,
            tip: `${point.day} 코호트 n=${point.size} · ${point.returned}/${point.size} 복귀`,
          })),
          baselinePct: 40,
          legend: [
            { label: "Day-1 복귀율", tone: "rose" },
            { label: "건강 기준 40%", tone: "muted" },
          ],
          footnote: "프로덕션 앱/사이드카의 핵심 행동만 직접 집계한 값이에요 — 표본이 작으면 한 명 차이도 크게 보여요.",
        }
      : null,
    signals: (topEvents || []).map((row) => ({
      time: "이벤트",
      text: `${row?.[0]} · ${finiteNumber(row?.[1]) ?? 0}회 · 사람 ${finiteNumber(row?.[2]) ?? 0}명`,
    })),
    webSignals,
    webMeta: totalWebViews > 0 ? `최근 2주 · $pageview ${totalWebViews}뷰 · 경로 분해` : null,
    meta: {
      progress: {
        label: "Day-1 복귀율",
        valueLabel: latestCohort ? `${latestCohort.pct}% · ${latestCohort.size}명` : `활성 ${actives}`,
        sub: latestCohort && latestCohort.pct < 40 ? "기준 40% 미달" : null,
        ratio: latestCohort ? Math.min(1, latestCohort.pct / 100) : Math.min(1, actives / Math.max(1, prevActives, actives)),
      },
      rows: [
        { key: "소스", value: "PostHog Query API", tone: "accent" },
        { key: "리전", value: resolved.region.toUpperCase() },
        { key: "표본", value: latestCohort ? `코호트 n = ${latestCohort.size}` : `활성 n = ${actives}`, tone: "amber" },
      ],
    },
  });
}

// ── Cloudflare (GraphQL Analytics API) ───────────────────────────────────────

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_CLOUDFLARE_WEB_HOST = "agentic30.app";

// Resolve which Cloudflare zone this drilldown reports on. Hardcoding the
// product domain would break forks (CLAUDE.md requires forks to change the
// domain), while blindly taking the first active zone silently switches to the
// wrong domain's traffic once the account holds more than one zone (or a zone
// sorts ahead alphabetically). Prefer an explicit env override, then the
// configured web host, then fall back to the first active zone so single-zone
// tokens and unconfigured forks keep working exactly as before.
function cloudflareWebHost(env = process.env) {
  const raw = String(env.AGENTIC30_WEB_BASE_URL || `https://${DEFAULT_CLOUDFLARE_WEB_HOST}`).trim();
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return DEFAULT_CLOUDFLARE_WEB_HOST;
  }
}

function pickCloudflareZone(zones = [], env = process.env) {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  const preferredId = String(env.CLOUDFLARE_ZONE_ID || "").trim();
  const preferredName = String(env.CLOUDFLARE_ZONE_NAME || "").trim().toLowerCase();
  const webHost = cloudflareWebHost(env);
  const byName = (name) => zones.find((zone) => String(zone?.name || "").toLowerCase() === name);
  return (
    (preferredId && zones.find((zone) => zone?.id === preferredId))
    || (preferredName && byName(preferredName))
    || (webHost && byName(webHost))
    || zones[0]
    || null
  );
}

async function cloudflareGraphql({ fetchImpl, token, query, variables }) {
  const { ok, payload } = await fetchJson(fetchImpl, `${CLOUDFLARE_API_BASE}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: { query, variables },
  });
  if (!ok || payload?.errors?.length) {
    throw new Error(`Cloudflare GraphQL failed: ${payload?.errors?.[0]?.message || "request error"}`);
  }
  return payload?.data;
}

export async function collectCloudflareDirectDrilldown({
  window = {},
  env = process.env,
  appSupportPath = "",
  settings = null,
  fetchImpl = fetch,
} = {}) {
  const resolved = settings ?? resolveCloudflareMcpSettings({ env, appSupportPath });
  if (!resolved?.tokenValid) return null;
  const token = resolved.token;

  const zonesResult = await fetchJson(fetchImpl, `${CLOUDFLARE_API_BASE}/zones?status=active&per_page=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const zones = zonesResult.ok && Array.isArray(zonesResult.payload?.result)
    ? zonesResult.payload.result
    : [];
  const zone = pickCloudflareZone(zones, env);
  if (!zone?.id) return null;

  const parsedUntilMs = Date.parse(window.untilIso || "");
  const rawUntilMs = finiteNumber(window.untilMs) ?? (Number.isFinite(parsedUntilMs) ? parsedUntilMs : Date.now());
  // Floor the window end to the hour. httpRequests1hGroups buckets are hourly
  // and filtered by their bucket-start datetime, so an unaligned end (e.g.
  // 04:18Z) pulls in the in-progress 04:00 bucket whole — its requests/uniques
  // keep climbing on every re-query of the *same* window. Flooring drops the
  // live partial hour so the totals are reproducible (cost: up to ~1h of lag).
  const untilMs = Math.floor(rawUntilMs / HOUR_MS) * HOUR_MS;
  const parsedStartMs = Date.parse(window.startIso || "");
  const requestedStartMs = finiteNumber(window.startMs)
    ?? (Number.isFinite(parsedStartMs) ? parsedStartMs : untilMs - 86_400_000);
  // Cloudflare adaptive analytics are used for the OD "지난 24시간" drilldown and
  // can reject wider path queries. Keep the traffic drilldown on the trailing
  // 24h window even when the broader morning briefing window starts yesterday.
  const startMs = Math.floor(Math.max(requestedStartMs, untilMs - 86_400_000) / HOUR_MS) * HOUR_MS;
  const cardStartMs = Math.floor(requestedStartMs / HOUR_MS) * HOUR_MS;
  const spanMs = untilMs - startMs;
  const toIso = (ms) => new Date(ms).toISOString();

  const analyticsQuery = `
    query($zone: String!, $start: Time!, $end: Time!, $prevStart: Time!, $cardStart: Time!) {
      viewer { zones(filter: { zoneTag: $zone }) {
        totals: httpRequests1hGroups(limit: 1, filter: { datetime_geq: $start, datetime_lt: $end }) {
          sum { requests pageViews threats }
          uniq { uniques }
        }
        hourly: httpRequests1hGroups(limit: 96, filter: { datetime_geq: $start, datetime_lt: $end }, orderBy: [datetime_ASC]) {
          dimensions { datetime }
          sum { requests pageViews threats }
          uniq { uniques }
        }
        cardHourly: httpRequests1hGroups(limit: 96, filter: { datetime_geq: $cardStart, datetime_lt: $end }, orderBy: [datetime_ASC]) {
          dimensions { datetime }
          sum { requests pageViews threats }
          uniq { uniques }
        }
        previousTotals: httpRequests1hGroups(limit: 1, filter: { datetime_geq: $prevStart, datetime_lt: $start }) {
          sum { requests pageViews threats }
          uniq { uniques }
        }
      } }
    }`;
  const analyticsData = await cloudflareGraphql({
    fetchImpl,
    token,
    query: analyticsQuery,
    variables: {
      zone: zone.id,
      start: toIso(startMs),
      end: toIso(untilMs),
      prevStart: toIso(startMs - spanMs),
      cardStart: toIso(cardStartMs),
    },
  });

  const zoneData = analyticsData?.viewer?.zones?.[0] || {};
  const totalGroup = zoneData.totals?.[0] || null;
  const previousGroup = zoneData.previousTotals?.[0] || null;
  const hourlyGroups = zoneData.hourly || [];
  const cardHourlyGroups = zoneData.cardHourly || [];
  if (!totalGroup) return null;

  const totalsFromGroup = (group, start, until) => ({
    startIso: toIso(start),
    untilIso: toIso(until),
    uniqueVisitors: Math.max(0, Math.round(finiteNumber(group?.uniq?.uniques) ?? 0)),
    pageviews: Math.max(0, Math.round(finiteNumber(group?.sum?.pageViews) ?? 0)),
    requests: Math.max(0, Math.round(finiteNumber(group?.sum?.requests) ?? 0)),
    threats: Math.max(0, Math.round(finiteNumber(group?.sum?.threats) ?? 0)),
  });
  const hourlyFromGroup = (group) => {
    const ts = Date.parse(group?.dimensions?.datetime || "");
    if (!Number.isFinite(ts)) return null;
    return {
      datetimeIso: new Date(ts).toISOString(),
      uniqueVisitors: Math.max(0, Math.round(finiteNumber(group?.uniq?.uniques) ?? 0)),
      pageviews: Math.max(0, Math.round(finiteNumber(group?.sum?.pageViews) ?? 0)),
      requests: Math.max(0, Math.round(finiteNumber(group?.sum?.requests) ?? 0)),
    };
  };

  // Top paths come from the sampled adaptive dataset; not all plans expose it,
  // and a missing table section simply doesn't render — no invented rows.
  let pathTable = [];
  let pathTableUsesEyeballFilter = false;
  try {
    const pathsData = await cloudflareGraphql({
      fetchImpl,
      token,
      query: `
        query($zone: String!, $start: Time!, $end: Time!) {
          viewer { zones(filter: { zoneTag: $zone }) {
            httpRequestsAdaptiveGroups(
              limit: 6,
              filter: { AND: [{ datetime_geq: $start, datetime_lt: $end }, { requestSource: "eyeball" }] },
              orderBy: [count_DESC]
            ) {
              count
              sum { edgeResponseBytes }
              dimensions { metric: clientRequestPath }
            }
          } }
        }`,
      variables: { zone: zone.id, start: toIso(startMs), end: toIso(untilMs) },
    });
    pathTable = (pathsData?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [])
      .map((group) => ({
        path: String(group?.dimensions?.metric || ""),
        label: "",
        value: finiteNumber(group?.count) ?? 0,
      }))
      .filter((row) => row.path);
    pathTableUsesEyeballFilter = pathTable.length > 0;
  } catch {
    pathTable = [];
    pathTableUsesEyeballFilter = false;
  }

  return normalizeCloudflareDrilldownMeasurements({
    measurements: {
      totals: totalsFromGroup(totalGroup, startMs, untilMs),
      previousTotals: totalsFromGroup(previousGroup, startMs - spanMs, startMs),
      hourly: hourlyGroups.map(hourlyFromGroup).filter(Boolean),
      cardHourly: (cardHourlyGroups.length ? cardHourlyGroups : hourlyGroups).map(hourlyFromGroup).filter(Boolean),
      cardWindow: { startIso: toIso(cardStartMs), untilIso: toIso(untilMs) },
      zoneName: String(zone.name || ""),
      pathTable,
      pathTableUsesEyeballFilter,
    },
  });
}

// ── Merge: direct numbers win, digest fills narrative ────────────────────────

const DRILLDOWN_SECTION_KEYS = Object.freeze([
  "syncPills", "kpis", "kpisMeta", "cardSparkline", "chart", "table", "listRows", "listMeta",
  "scan", "funnel", "signals", "webSignals", "webMeta", "drafts", "draftsEmpty",
  "maintenance",
]);

function sectionIsEmpty(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function mergeMorningBriefingDrilldown(primary, secondary) {
  if (!primary) return secondary ?? null;
  // An explicit collection-failure card is terminal: never backfill it with the
  // digest's narrative or zero numbers, or we recreate the masked-failure bug
  // (a failed collection rendered as authoritative "0 events / 0 active").
  if (primary.collectionFailed) return primary;
  if (!secondary) return primary;
  const merged = { ...primary };
  for (const key of DRILLDOWN_SECTION_KEYS) {
    if (sectionIsEmpty(merged[key]) && !sectionIsEmpty(secondary[key])) {
      merged[key] = secondary[key];
    }
  }
  const primaryRows = primary.meta?.rows || [];
  const secondaryRows = secondary.meta?.rows || [];
  merged.meta = {
    progress: primary.meta?.progress ?? secondary.meta?.progress ?? null,
    rows: primaryRows.length ? primaryRows : secondaryRows,
  };
  return merged;
}

export function mergeMorningBriefingDrilldownMaps(primary = {}, secondary = {}) {
  const ids = new Set([...Object.keys(primary || {}), ...Object.keys(secondary || {})]);
  const output = {};
  for (const id of ids) {
    const merged = mergeMorningBriefingDrilldown(primary?.[id] ?? null, secondary?.[id] ?? null);
    if (merged) output[id] = merged;
  }
  return output;
}

export function shouldCollectCloudflareDirectDrilldown({ readySources = [], externalSources = [] } = {}) {
  if (!Array.isArray(readySources) || !readySources.includes("cloudflare")) return false;
  const cloudflare = (Array.isArray(externalSources) ? externalSources : [])
    .find((source) => source?.id === "cloudflare");
  return cloudflare?.state === "ready";
}

function kpiNumber(drilldown, label) {
  const value = drilldown?.kpis?.find((kpi) => kpi.label === label)?.valueLabel;
  if (value === null || value === undefined) return null;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

export function posthogSourceSignalFromDrilldown(drilldown, existing = {}) {
  if (!drilldown || drilldown.id !== "posthog") return null;
  const activeUsers = kpiNumber(drilldown, "활성 사용자");
  if (activeUsers === null) return null;
  const events = kpiNumber(drilldown, "이벤트") ?? 0;
  const signups = kpiNumber(drilldown, "신규(첫 핵심 행동)") ?? 0;
  return {
    ...existing,
    id: "posthog",
    label: existing.label || "PostHog",
    state: "ready",
    available: true,
    detail: "PostHog Query API direct aggregation succeeded",
    counts: {
      activeUsers,
      events,
      signups,
    },
    highlights: [
      `PostHog 활성 사용자 ${activeUsers}명 · 이벤트 ${events}건`,
      ...(signups ? [`첫 핵심 행동 ${signups}명`] : []),
      ...(Array.isArray(existing.highlights) ? existing.highlights : []),
    ].slice(0, 6),
    summary: `PostHog 활성 사용자 ${activeUsers}명`,
    goalSignals: Array.isArray(existing.goalSignals) ? existing.goalSignals : [],
    evidenceGaps: Array.isArray(existing.evidenceGaps) ? existing.evidenceGaps : [],
    events: Array.isArray(existing.events) ? existing.events : [],
  };
}

export function cloudflareSourceSignalFromDrilldown(drilldown, existing = {}) {
  if (!drilldown || drilldown.id !== "cloudflare") return null;
  const uniqueVisitors = kpiNumber(drilldown, "순 방문");
  if (uniqueVisitors === null) return null;
  const pageviews = kpiNumber(drilldown, "페이지뷰") ?? 0;
  const requests = kpiNumber(drilldown, "요청") ?? 0;
  const threats = kpiNumber(drilldown, "위협") ?? 0;
  return {
    ...existing,
    id: "cloudflare",
    label: existing.label || "Cloudflare",
    state: "ready",
    available: true,
    detail: "Cloudflare GraphQL Analytics direct aggregation succeeded",
    counts: {
      visits: uniqueVisitors,
      uniqueVisitors,
      pageviews,
      requests,
      threats,
    },
    highlights: [
      `Cloudflare 순 방문 ${uniqueVisitors}명 · 페이지뷰 ${pageviews}건 · 요청 ${requests}건`,
      ...(Array.isArray(existing.highlights) ? existing.highlights : []),
    ].slice(0, 6),
    summary: `Cloudflare 순 방문 ${uniqueVisitors}명`,
    goalSignals: Array.isArray(existing.goalSignals) ? existing.goalSignals : [],
    evidenceGaps: Array.isArray(existing.evidenceGaps) ? existing.evidenceGaps : [],
    events: Array.isArray(existing.events) ? existing.events : [],
  };
}
