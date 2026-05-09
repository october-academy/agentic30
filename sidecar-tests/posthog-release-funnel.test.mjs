import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostHogPayload,
  computeDownloadEvents,
  normalizePostHogHost,
} from "../scripts/posthog-release-funnel.mjs";

test("computeDownloadEvents emits one installer_downloaded event per new GitHub asset download", () => {
  const release = {
    id: 42,
    tag_name: "v20260512",
    name: "Launch",
  };
  const assets = [
    {
      id: 1001,
      name: "agentic30.pkg",
      label: "Agentic30 PKG",
      content_type: "application/octet-stream",
      size: 185_000_000,
      download_count: 3,
      browser_download_url: "https://github.com/october-academy/agentic30-private/releases/download/v20260512/agentic30.pkg",
    },
  ];
  const previousState = {
    1001: { download_count: 1 },
  };

  const { events, nextState, skippedEvents } = computeDownloadEvents({
    release,
    assets,
    previousState,
    repo: "october-academy/agentic30-private",
  });

  assert.equal(events.length, 2);
  assert.equal(skippedEvents, 0);
  assert.deepEqual(
    events.map((event) => event.distinct_id),
    [
      "github-release-asset-1001-download-2",
      "github-release-asset-1001-download-3",
    ],
  );
  assert.deepEqual(
    events.map((event) => event.properties.idempotency_key),
    [
      "github-release-asset-1001-download-2",
      "github-release-asset-1001-download-3",
    ],
  );
  assert.match(events[0].uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(events[0].event, "installer_downloaded");
  assert.equal(events[0].properties.event_schema_version, 1);
  assert.equal(events[0].properties.source, "github_release_asset");
  assert.equal(events[0].properties.release_tag, "v20260512");
  assert.equal(events[0].properties.asset_name, "agentic30.pkg");
  assert.equal(events[0].properties.download_count_delta, 2);
  assert.equal(nextState[1001].download_count, 3);
});

test("computeDownloadEvents reuses deterministic event uuids across retries", () => {
  const release = { id: 42, tag_name: "v20260512" };
  const assets = [{ id: 1001, name: "agentic30.pkg", download_count: 2 }];
  const input = {
    release,
    assets,
    previousState: {},
    repo: "october-academy/agentic30-private",
  };

  const firstRun = computeDownloadEvents(input);
  const retryRun = computeDownloadEvents(input);

  assert.deepEqual(
    retryRun.events.map((event) => event.uuid),
    firstRun.events.map((event) => event.uuid),
  );
});

test("computeDownloadEvents respects maxEvents but still advances state", () => {
  const release = { id: 42, tag_name: "v20260512" };
  const assets = [{ id: 1001, name: "agentic30.pkg", download_count: 5 }];

  const { events, nextState, skippedEvents } = computeDownloadEvents({
    release,
    assets,
    previousState: {},
    repo: "october-academy/agentic30-private",
    maxEvents: 2,
  });

  assert.equal(events.length, 2);
  assert.equal(skippedEvents, 3);
  assert.equal(nextState[1001].download_count, 5);
});

test("normalizePostHogHost maps app hosts to ingest hosts", () => {
  assert.equal(normalizePostHogHost("https://us.posthog.com"), "https://us.i.posthog.com");
  assert.equal(normalizePostHogHost("eu.posthog.com"), "https://eu.i.posthog.com");
  assert.equal(normalizePostHogHost("https://analytics.example.com"), "https://analytics.example.com");
});

test("buildPostHogPayload keeps event distinct id and schema properties", () => {
  const payload = buildPostHogPayload("phc_test", {
    event: "installer_downloaded",
    distinct_id: "download-1",
    uuid: "018f2c7a-0000-7000-8000-000000000001",
    properties: {
      idempotency_key: "download-1",
      event_schema_version: 1,
    },
  });

  assert.equal(payload.api_key, "phc_test");
  assert.equal(payload.event, "installer_downloaded");
  assert.equal(payload.distinct_id, "download-1");
  assert.equal(payload.uuid, "018f2c7a-0000-7000-8000-000000000001");
  assert.equal(payload.properties.idempotency_key, "download-1");
  assert.equal(payload.properties.event_schema_version, 1);
  assert.ok(payload.timestamp);
});
