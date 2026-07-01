import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRecorderPublicTextSafe,
  assertRecorderRedactionPolicyForRecord,
  redactRecorderPublicText,
} from "../sidecar/recorder-redaction-policy.mjs";

test("redactRecorderPublicText derives bounded public text without raw local locators", () => {
  const redacted = redactRecorderPublicText(
    "Customer founder@example.test opened https://private.example.test/customer/secret?token=raw from /Users/october/private-note.md with token=local-sensitive-value and phone +1 555 123 4567.",
  );

  assert.match(redacted, /\[redacted-email\]/);
  assert.match(redacted, /\[redacted-secret\]/);
  assert.match(redacted, /\[redacted-path\]/);
  assert.match(redacted, /\[redacted-phone\]/);
  assert.match(redacted, /private\.example\.test/);
  assert.equal(redacted.includes("founder@example.test"), false);
  assert.equal(redacted.includes("https://"), false);
  assert.equal(redacted.includes("/customer/secret"), false);
  assert.equal(redacted.includes("/Users/october"), false);
  assert.equal(redacted.includes("local-sensitive-value"), false);
});

test("redactRecorderPublicText fails closed when output still looks like raw metadata", () => {
  assert.throws(
    () => redactRecorderPublicText("Raw document locator private/customer-note.md"),
    (error) => error.code === "ERR_RECORDER_REDACTION_ADAPTER_UNSAFE_OUTPUT",
  );
});

test("redaction policy rejects raw URL or local path public text before safe sinks", () => {
  for (const [value, expectedColumn] of [
    ["redacted summary still contains https://private.example.test/customer/secret", "redacted_text"],
    ["redacted summary still contains /Users/october/private-note.md", "redacted_text"],
  ]) {
    assert.throws(
      () => assertRecorderRedactionPolicyForRecord("frames", {
        redaction_status: "redacted",
        redacted_text: value,
        app_name: "Agentic30",
        window_title: "Founder Memory",
        browser_domain: "private.example.test",
        browser_url_search_label: "private.example.test",
        document_path_search_label: "private-note.md",
        safe_for_search: 1,
        safe_for_memory: 1,
        safe_for_export: 0,
      }),
      (error) => error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_PUBLIC_LOCATOR"
        && error.details.column === expectedColumn,
    );
  }
});

test("redaction policy rejects bare tokens and phone-shaped text before safe sinks", () => {
  for (const value of [
    "summary still contains sk-1234567890abcdef",
    "summary still contains +1 555 123 4567",
  ]) {
    assert.throws(
      () => assertRecorderRedactionPolicyForRecord("product_events", {
        title: "Unsafe product event",
        summary: value,
        safe_for_search: 1,
        safe_for_memory: 1,
        safe_for_export: 0,
      }),
      (error) => error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT"
        && error.details.column === "summary",
    );
  }
});

test("assertRecorderPublicTextSafe rejects unsafe arbitrary public text", () => {
  assert.throws(
    () => assertRecorderPublicTextSafe("public SQL value contains customer@example.test", {
      column: "summary",
    }),
    (error) => error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT"
      && error.details.column === "summary",
  );
  assert.throws(
    () => assertRecorderPublicTextSafe("public SQL value contains /Users/october/private-note.md", {
      column: "redacted_text",
    }),
    (error) => error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_PUBLIC_LOCATOR"
      && error.details.column === "redacted_text",
  );
  assert.doesNotThrow(() => assertRecorderPublicTextSafe("Day 1/Day 2 handoff"));
});

test("redaction policy still allows ordinary slashes in non-locator public text", () => {
  assert.doesNotThrow(() => assertRecorderRedactionPolicyForRecord("product_events", {
    title: "Day 1/Day 2 handoff",
    summary: "Reviewed activation friction and next action for the founder loop.",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
  }));
});

test("redactRecorderPublicText redacts fullwidth (NFKC) and zero-width-split PII", () => {
  // Fullwidth Latin email — NFKC-folds to "secret@victim.com".
  const fullwidth = redactRecorderPublicText("mail me at ｓｅｃｒｅｔ＠ｖｉｃｔｉｍ．ｃｏｍ");
  assert.match(fullwidth, /\[redacted-email\]/);
  assert.equal(fullwidth.normalize("NFKC").includes("secret@victim.com"), false);

  // Fullwidth URL — must not survive as a recoverable raw URL.
  const fullwidthUrl = redactRecorderPublicText("visit ｈｔｔｐｓ：／／ｅｖｉｌ．ｃｏｍ／ｐａｔｈ");
  assert.equal(fullwidthUrl.normalize("NFKC").toLowerCase().includes("https://"), false);

  // Zero-width-space-split email — ZWSP (​) removed before matching.
  const zeroWidth = redactRecorderPublicText("ping leak​@​victim.com now");
  assert.match(zeroWidth, /\[redacted-email\]/);
  assert.equal(zeroWidth.replace(/​/g, "").includes("leak@victim.com"), false);
});

test("redaction policy gate rejects fullwidth/zero-width PII in frame metadata before safe sinks", () => {
  // Fullwidth email in window_title must fail closed exactly like its ASCII twin.
  assert.throws(
    () => assertRecorderRedactionPolicyForRecord("frames", {
      redaction_status: "redacted",
      redacted_text: "safe activation summary",
      app_name: "Agentic30",
      window_title: "ｓｅｃｒｅｔ＠ｖｉｃｔｉｍ．ｃｏｍ",
      browser_domain: "example.test",
      browser_url_search_label: "example.test",
      document_path_search_label: "note",
      safe_for_search: 1,
      safe_for_memory: 1,
      safe_for_export: 0,
    }),
    (error) => error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT"
      && error.details.column === "window_title",
  );

  // assertRecorderPublicTextSafe must also catch the normalized form.
  assert.throws(
    () => assertRecorderPublicTextSafe("value ｓｅｃｒｅｔ＠ｖｉｃｔｉｍ．ｃｏｍ", {
      column: "summary",
    }),
    (error) => error.code === "ERR_RECORDER_REDACTION_POLICY_UNSAFE_TEXT",
  );
});
