import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderClipboardError,
  recordClipboardEvent,
} from "../sidecar/recorder-clipboard.mjs";
import {
  makeDefaultRecorderControlState,
  transitionRecorderControlState,
} from "../sidecar/recorder-control-state.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-clipboard-"));
  const store = new RecorderStore({ appSupportRoot: path.join(root, "app-support") }).open();
  return { root, store };
}

function readyControlState({ contentOptIn = false } = {}) {
  const now = new Date("2026-06-28T13:00:00.000Z");
  let state = makeDefaultRecorderControlState({ now });
  state = transitionRecorderControlState(state, {
    type: "grant_consent",
    visibleIndicatorAcknowledged: true,
  }, { now });
  for (const permission of ["screenRecording", "accessibility", "clipboard"]) {
    state = transitionRecorderControlState(state, {
      type: "set_permission",
      permission,
      state: "granted",
    }, { now });
  }
  if (contentOptIn) {
    state = transitionRecorderControlState(state, {
      type: "set_sensitive_capture",
      clipboardMode: "content_opt_in",
    }, { now });
  }
  return state;
}

function clipboardEvent(overrides = {}) {
  return {
    id: "clipboard-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    capturedAt: "2026-06-28T13:01:00.000Z",
    eventKind: "copy",
    sourceAppName: "Agentic30",
    sourceWindowTitle: "Founder Replay",
    contentType: "text",
    contentHash: "sha256:redacted-clipboard",
    redactedText: "redacted copied customer ask",
    redactionStatus: "redacted",
    privacyState: "searchable_local",
    safeForSearch: true,
    safeForMemory: true,
    safeForExport: false,
    ...overrides,
  };
}

test("recordClipboardEvent stores trigger-only metadata without raw content", async () => {
  const { root, store } = await makeStore();
  try {
    const result = recordClipboardEvent(store, clipboardEvent({ contentSize: 28 }), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T13:02:00.000Z"),
    });

    assert.equal(result.event.id, "clipboard-1");
    assert.equal(result.event.policyMode, "trigger_only");
    assert.equal(result.event.captureMode, "trigger_only");
    assert.equal(result.event.capturedAt, "2026-06-28T13:01:00.000Z");
    assert.equal(result.event.contentCaptured, false);
    assert.equal(result.event.rawContentExposed, false);
    assert.equal(result.proofAcceptedByClipboardEvent, false);

    const row = store.getRecord("clipboard_events", "clipboard-1");
    assert.equal(row.policy_mode, "trigger_only");
    assert.equal(row.captured_at, "2026-06-28T13:01:00.000Z");
    assert.equal(row.source_app_name, "Agentic30");
    assert.equal(row.source_window_title, "Founder Replay");
    assert.equal(row.content_size, 28);
    assert.equal(row.suppression_reason, null);
    assert.equal(row.raw_retention_expires_at, null);
    assert.equal(row.content_captured, 0);
    assert.equal(row.content_text, null);
    assert.equal(row.redacted_text, "redacted copied customer ask");
    assert.doesNotMatch(JSON.stringify(result), /content_text|raw copied content|token_hash|a30_recorder_/);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordClipboardEvent requires explicit content opt-in before storing raw clipboard text", async () => {
  const { root, store } = await makeStore();
  try {
    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent({
        id: "clipboard-blocked-content",
        contentText: "raw copied content token=secret",
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T13:03:00.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_CLIPBOARD_CONTENT_BLOCKED"
        && !JSON.stringify(error.details).includes("raw copied content"),
    );

    const result = recordClipboardEvent(store, clipboardEvent({
      id: "clipboard-content-opt-in",
      contentText: "raw copied customer note",
      redactedText: "",
      redactionStatus: "",
      contentHash: "",
      rawRetentionExpiresAt: "2026-06-29T13:04:00.000Z",
    }), {
      controlState: readyControlState({ contentOptIn: true }),
      now: new Date("2026-06-28T13:04:00.000Z"),
    });
    const row = store.getRecord("clipboard_events", "clipboard-content-opt-in");
    assert.equal(row.policy_mode, "content_opt_in");
    assert.equal(row.content_captured, 1);
    assert.equal(row.content_text, "raw copied customer note");
    assert.equal(row.content_size, "raw copied customer note".length);
    assert.equal(row.raw_retention_expires_at, "2026-06-29T13:04:00.000Z");
    assert.equal(row.redacted_text, "raw copied customer note");
    assert.equal(row.redaction_status, "safe");
    assert.match(row.content_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.event.contentCaptured, true);
    assert.equal(result.event.rawContentExposed, false);
    assert.doesNotMatch(JSON.stringify(result), /raw copied customer note|content_text/);

    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent({
        id: "clipboard-secret-blocked",
        contentText: "LOCAL_TEST_PASSWORD=abcdefgh",
        redactedText: "",
        redactionStatus: "",
        contentHash: "",
      }), {
        controlState: readyControlState({ contentOptIn: true }),
        now: new Date("2026-06-28T13:04:30.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_CLIPBOARD_CONTENT_SECRET_BLOCKED"
        && error.details.secretSuppression === true
        && !JSON.stringify(error.details).includes("LOCAL_TEST_PASSWORD"),
    );
    assert.equal(store.getRecord("clipboard_events", "clipboard-secret-blocked"), null);

    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent({
        id: "clipboard-too-large",
        contentText: "x".repeat(2001),
        contentHash: "",
      }), {
        controlState: readyControlState({ contentOptIn: true }),
        now: new Date("2026-06-28T13:04:45.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_CLIPBOARD_CONTENT_TOO_LARGE"
        && error.details.maxLength === 2000
        && error.details.length === 2001,
    );
    assert.equal(store.getRecord("clipboard_events", "clipboard-too-large"), null);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordClipboardEvent derives safe public text for content opt-in without indexing raw locators", async () => {
  const { root, store } = await makeStore();
  try {
    const result = recordClipboardEvent(store, clipboardEvent({
      id: "clipboard-redacted-content",
      contentText: "Copied https://private.example.test/customer/secret from /Users/october/private-note.md and phone +1 555 123 4567 for activation friction.",
      redactedText: "",
      redactionStatus: "",
      contentHash: "",
    }), {
      controlState: readyControlState({ contentOptIn: true }),
      now: new Date("2026-06-28T13:04:50.000Z"),
    });

    const row = store.getRecord("clipboard_events", "clipboard-redacted-content");
    assert.equal(row.policy_mode, "content_opt_in");
    assert.equal(row.content_captured, 1);
    assert.equal(row.redaction_status, "redacted");
    assert.match(row.redacted_text, /private\.example\.test/);
    assert.match(row.redacted_text, /\[redacted-path\]/);
    assert.match(row.redacted_text, /\[redacted-phone\]/);
    assert.match(row.redacted_text, /activation friction/);
    assert.equal(row.redacted_text.includes("https://"), false);
    assert.equal(row.redacted_text.includes("/customer/secret"), false);
    assert.equal(row.redacted_text.includes("/Users/october"), false);
    assert.equal(row.safe_for_search, 1);
    assert.equal(row.safe_for_memory, 1);
    assert.equal(result.event.redactedText, row.redacted_text);
    assert.equal(result.event.rawContentExposed, false);
    assert.doesNotMatch(JSON.stringify(result), /content_text|\/Users\/october|\/customer\/secret/);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordClipboardEvent ignores caller-supplied redacted text for content opt-in receipts", async () => {
  const { root, store } = await makeStore();
  try {
    const result = recordClipboardEvent(store, clipboardEvent({
      id: "clipboard-supplied-unsafe-redaction",
      contentText: "Copied https://private.example.test/customer/secret from /Users/october/private-note.md for activation friction.",
      redactedText: "caller supplied https://private.example.test/customer/secret from /Users/october/private-note.md",
      redactionStatus: "allowlisted",
      contentHash: "",
      safeForSearch: false,
      safeForMemory: false,
      safeForExport: false,
    }), {
      controlState: readyControlState({ contentOptIn: true }),
      now: new Date("2026-06-28T13:04:55.000Z"),
    });

    const row = store.getRecord("clipboard_events", "clipboard-supplied-unsafe-redaction");
    assert.equal(row.safe_for_search, 0);
    assert.equal(row.safe_for_memory, 0);
    assert.equal(row.safe_for_export, 0);
    assert.equal(row.redaction_status, "redacted");
    assert.match(row.redacted_text, /private\.example\.test/);
    assert.match(row.redacted_text, /\[redacted-path\]/);
    assert.equal(row.redacted_text.includes("https://"), false);
    assert.equal(row.redacted_text.includes("/customer/secret"), false);
    assert.equal(row.redacted_text.includes("/Users/october"), false);
    assert.equal(result.event.redactedText, row.redacted_text);
    assert.equal(result.event.rawContentExposed, false);
    assert.doesNotMatch(JSON.stringify(result), /content_text|https:\/\/|\/Users\/october|\/customer\/secret/);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recordClipboardEvent fails closed for missing policy, missing redaction, and duplicate ids", async () => {
  const { root, store } = await makeStore();
  try {
    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent(), {
        now: new Date("2026-06-28T13:05:00.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_CLIPBOARD_CONTROL_STATE_REQUIRED",
    );

    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent({
        id: "clipboard-missing-redaction",
        redactedText: "",
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T13:06:00.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_CLIPBOARD_SEARCH_REQUIRES_REDACTED_TEXT",
    );

    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent({
        id: "clipboard-invalid-raw-retention",
        rawRetentionExpiresAt: "not-a-date",
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T13:06:30.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_CLIPBOARD_INVALID_RAW_RETENTION_EXPIRES_AT",
    );

    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent({
        id: "clipboard-trigger-unsafe-redaction",
        redactedText: "caller supplied https://private.example.test/customer/secret from /Users/october/private-note.md",
        redactionStatus: "redacted",
        safeForSearch: false,
        safeForMemory: false,
        safeForExport: false,
      }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T13:06:45.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_PUBLIC_LOCATOR",
    );

    recordClipboardEvent(store, clipboardEvent({ id: "clipboard-duplicate" }), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T13:07:00.000Z"),
    });
    assert.throws(
      () => recordClipboardEvent(store, clipboardEvent({ id: "clipboard-duplicate" }), {
        controlState: readyControlState(),
        now: new Date("2026-06-28T13:08:00.000Z"),
      }),
      (error) => error instanceof RecorderClipboardError
        && error.code === "ERR_RECORDER_CLIPBOARD_DUPLICATE_EVENT",
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
