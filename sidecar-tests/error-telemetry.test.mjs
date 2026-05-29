import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reportError,
  setTelemetryClient,
  swallow,
  swallowSync,
} from "../sidecar/error-telemetry.mjs";

function makeFakeTelemetry() {
  const captured = [];
  return {
    captured,
    captureException(error, properties = {}) {
      captured.push({ error, properties });
    },
  };
}

function muteConsoleWarn() {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  return {
    lines,
    restore() {
      console.warn = original;
    },
  };
}

test("reportError forwards to telemetry with operation", () => {
  const fake = makeFakeTelemetry();
  setTelemetryClient(fake);
  const warn = muteConsoleWarn();
  try {
    reportError(new Error("boom"), { operation: "unit_test_op", extra: 1 });
  } finally {
    warn.restore();
    setTelemetryClient(null);
  }
  assert.equal(fake.captured.length, 1);
  assert.equal(fake.captured[0].error.message, "boom");
  assert.equal(fake.captured[0].properties.operation, "unit_test_op");
  assert.equal(fake.captured[0].properties.extra, 1);
  assert.ok(warn.lines.some((line) => line.includes("unit_test_op")));
});

test("reportError still warns when no telemetry client is registered", () => {
  setTelemetryClient(null);
  const warn = muteConsoleWarn();
  try {
    reportError(new Error("standalone"), { operation: "no_client_op" });
  } finally {
    warn.restore();
  }
  assert.ok(warn.lines.some((line) => line.includes("no_client_op")));
});

test("reportError survives telemetry that throws", () => {
  setTelemetryClient({
    captureException() {
      throw new Error("telemetry exploded");
    },
  });
  const warn = muteConsoleWarn();
  try {
    assert.doesNotThrow(() => reportError(new Error("payload"), { operation: "telemetry_throws" }));
  } finally {
    warn.restore();
    setTelemetryClient(null);
  }
});

test("swallow reports and returns undefined on rejection", async () => {
  const fake = makeFakeTelemetry();
  setTelemetryClient(fake);
  const warn = muteConsoleWarn();
  let result;
  try {
    result = await swallow("rejecting_op", Promise.reject(new Error("nope")), { extra: "x" });
  } finally {
    warn.restore();
    setTelemetryClient(null);
  }
  assert.equal(result, undefined);
  assert.equal(fake.captured.length, 1);
  assert.equal(fake.captured[0].properties.operation, "rejecting_op");
  assert.equal(fake.captured[0].properties.extra, "x");
});

test("swallow passes through resolved value", async () => {
  setTelemetryClient(null);
  const value = await swallow("resolving_op", Promise.resolve(42));
  assert.equal(value, 42);
});

test("swallowSync reports and returns undefined on throw", () => {
  const fake = makeFakeTelemetry();
  setTelemetryClient(fake);
  const warn = muteConsoleWarn();
  let result;
  try {
    result = swallowSync("sync_throws", () => {
      throw new Error("sync fail");
    });
  } finally {
    warn.restore();
    setTelemetryClient(null);
  }
  assert.equal(result, undefined);
  assert.equal(fake.captured.length, 1);
  assert.equal(fake.captured[0].properties.operation, "sync_throws");
});

test("swallowSync returns synchronous value when no throw", () => {
  setTelemetryClient(null);
  assert.equal(swallowSync("sync_ok", () => "ok"), "ok");
});
