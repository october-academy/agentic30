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
    occurredAt: "2026-06-28T13:01:00.000Z",
    eventKind: "copy",
    appName: "Agentic30",
    windowTitle: "Founder Replay",
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
    const result = recordClipboardEvent(store, clipboardEvent(), {
      controlState: readyControlState(),
      now: new Date("2026-06-28T13:02:00.000Z"),
    });

    assert.equal(result.event.id, "clipboard-1");
    assert.equal(result.event.captureMode, "trigger_only");
    assert.equal(result.event.contentCaptured, false);
    assert.equal(result.event.rawContentExposed, false);
    assert.equal(result.proofAcceptedByClipboardEvent, false);

    const row = store.getRecord("clipboard_events", "clipboard-1");
    assert.equal(row.capture_mode, "trigger_only");
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
      contentText: "raw copied content token=secret",
      redactedText: "redacted copied content",
      contentHash: "",
    }), {
      controlState: readyControlState({ contentOptIn: true }),
      now: new Date("2026-06-28T13:04:00.000Z"),
    });
    const row = store.getRecord("clipboard_events", "clipboard-content-opt-in");
    assert.equal(row.capture_mode, "content_opt_in");
    assert.equal(row.content_captured, 1);
    assert.equal(row.content_text, "raw copied content token=secret");
    assert.match(row.content_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.event.contentCaptured, true);
    assert.equal(result.event.rawContentExposed, false);
    assert.doesNotMatch(JSON.stringify(result), /raw copied content|content_text|token=secret/);
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
