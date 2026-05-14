import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_TOOL_VERIFICATION_STATUS,
  buildBrowserHarnessVerificationScript,
  buildBrowserVerificationRequest,
  evaluateBrowserExpectedState,
  isBrowserExpectedStateObservable,
  verifyBrowserActionExpectedState,
} from "../sidecar/browser-tool-verification.mjs";

test("browser verification detects observable expected state from action spec", () => {
  const request = buildBrowserVerificationRequest({
    action_id: "day-8-public-proof",
    completion_signal: "Published landing page shows the beta CTA.",
    verification_method: "browser",
    verification_arguments: {
      url: "https://example.test/beta",
      expectedText: "Join the beta",
      expectedUrlIncludes: "/beta",
      expectedSelector: { selector: "[data-testid='signup-cta']", text: "Join" },
    },
  });

  assert.equal(request.url, "https://example.test/beta");
  assert.deepEqual(request.expectedTexts, ["Join the beta"]);
  assert.deepEqual(request.expectedUrlIncludes, ["/beta"]);
  assert.deepEqual(request.expectedSelectors, [{
    selector: "[data-testid='signup-cta']",
    text: "Join",
  }]);

  const observability = isBrowserExpectedStateObservable({ verification_arguments: request });
  assert.equal(observability.observable, true);
});

test("browser verification returns unsupported when no URL or observable state is supplied", async () => {
  const noUrl = await verifyBrowserActionExpectedState({
    actionSpec: {
      verification_method: "browser",
      verification_arguments: { expectedText: "Published" },
    },
  });
  assert.equal(noUrl.status, BROWSER_TOOL_VERIFICATION_STATUS.unsupported);
  assert.equal(noUrl.passed, false);
  assert.equal(noUrl.reason, "browser_verification_url_missing");

  const noExpectedState = await verifyBrowserActionExpectedState({
    actionSpec: {
      verification_method: "browser",
      verification_arguments: { url: "https://example.test" },
    },
  });
  assert.equal(noExpectedState.status, BROWSER_TOOL_VERIFICATION_STATUS.unsupported);
  assert.equal(noExpectedState.reason, "browser_expected_state_missing");
  assert.match(noExpectedState.raw.runnableCommand, /browser-harness -c/);
});

test("browser verification passes when the expected state is observable on the page", async () => {
  const result = await verifyBrowserActionExpectedState({
    actionSpec: {
      verification_method: "browser-harness",
      verification_arguments: {
        url: "https://example.test/launch",
        expectedTexts: ["Launch notes", "Book a call"],
        expectedSelector: { selector: "#primary-cta", text: "Book" },
      },
    },
    fetchPageState: async ({ request, script }) => {
      assert.equal(request.url, "https://example.test/launch");
      assert.match(script, /new_tab\("https:\/\/example\.test\/launch"\)/);
      return {
        url: "https://example.test/launch",
        title: "Launch notes",
        text: "Launch notes are live. Book a call for onboarding.",
        selectors: {
          "#primary-cta": { exists: true, text: "Book a call" },
        },
      };
    },
  });

  assert.equal(result.status, BROWSER_TOOL_VERIFICATION_STATUS.pass);
  assert.equal(result.passed, true);
  assert.equal(result.confidence, 0.86);
  assert.equal(result.evidenceItems.length, 3);
  assert.match(result.agentAssessment, /observed/);
});

test("browser verification fails when page state is reachable but expected evidence is missing", () => {
  const evaluation = evaluateBrowserExpectedState({
    url: "https://example.test/launch",
    expectedTexts: ["Join the beta"],
    expectedSelectors: [{ selector: "#primary-cta", text: "Join" }],
    expectedUrlIncludes: ["/launch"],
  }, {
    url: "https://example.test/launch",
    title: "Waitlist",
    text: "Read the update.",
    selectors: { "#primary-cta": { exists: true, text: "Read more" } },
  });

  assert.equal(evaluation.passed, false);
  assert.match(evaluation.reason, /Page text missing "Join the beta"/);
  assert.match(evaluation.reason, /Selector "#primary-cta" text missing "Join"/);
  assert.deepEqual(evaluation.evidenceItems, [{
    type: "browser_url",
    content: "/launch",
    source: "https://example.test/launch",
  }]);
});

test("browser harness script is runnable and preserves the user's active tab", () => {
  const script = buildBrowserHarnessVerificationScript({
    url: "https://example.test/proof",
    expectedSelectors: [{ selector: ".proof-card" }],
  });

  assert.match(script, /new_tab\("https:\/\/example\.test\/proof"\)/);
  assert.doesNotMatch(script, /goto_url/);
  assert.match(script, /wait_for_load\(\)/);
  assert.match(script, /document\.querySelector/);
  assert.match(script, /print\(json\.dumps\(state\)\)/);
});
