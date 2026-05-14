export const BROWSER_TOOL_VERIFICATION_STATUS = Object.freeze({
  pass: "pass",
  fail: "fail",
  unsupported: "unsupported",
});

const MAX_TEXT_CHARS = 16_000;

export function buildBrowserVerificationRequest(actionSpec = {}) {
  const args = normalizePlainObject(
    actionSpec.verification_arguments
      ?? actionSpec.verificationArguments
      ?? actionSpec.browser_arguments
      ?? actionSpec.browserArguments
      ?? actionSpec.arguments
      ?? {},
  );
  const expectedState = normalizePlainObject(
    args.expected_state
      ?? args.expectedState
      ?? actionSpec.expected_state
      ?? actionSpec.expectedState
      ?? {},
  );
  const url = firstText(
    args.url,
    args.publicUrl,
    args.public_url,
    args.evidenceUrl,
    args.evidence_url,
    actionSpec.url,
    actionSpec.publicUrl,
    actionSpec.public_url,
  );
  const expectedTexts = uniqueStrings([
    ...asArray(args.expectedText ?? args.expected_text),
    ...asArray(args.expectedTexts ?? args.expected_texts),
    ...asArray(args.requiredText ?? args.required_text),
    ...asArray(args.requiredTexts ?? args.required_texts),
    ...asArray(expectedState.text),
    ...asArray(expectedState.texts),
    ...asArray(expectedState.requiredText ?? expectedState.required_text),
    ...asArray(expectedState.requiredTexts ?? expectedState.required_texts),
  ]);
  const expectedUrlIncludes = uniqueStrings([
    ...asArray(args.expectedUrlIncludes ?? args.expected_url_includes),
    ...asArray(expectedState.urlIncludes ?? expectedState.url_includes),
  ]);
  const expectedSelectors = normalizeExpectedSelectors([
    ...asArray(args.expectedSelector ?? args.expected_selector),
    ...asArray(args.expectedSelectors ?? args.expected_selectors),
    ...asArray(args.requiredSelector ?? args.required_selector),
    ...asArray(args.requiredSelectors ?? args.required_selectors),
    ...asArray(expectedState.selector),
    ...asArray(expectedState.selectors),
    ...asArray(expectedState.requiredSelector ?? expectedState.required_selector),
    ...asArray(expectedState.requiredSelectors ?? expectedState.required_selectors),
  ]);

  return {
    url,
    expectedTexts,
    expectedUrlIncludes,
    expectedSelectors,
    completionSignal: firstText(actionSpec.completion_signal, actionSpec.completionSignal, actionSpec.completion),
    actionId: firstText(actionSpec.action_id, actionSpec.actionId),
    dayId: actionSpec.day_id ?? actionSpec.dayId ?? null,
  };
}

export function isBrowserExpectedStateObservable(actionSpec = {}) {
  const request = buildBrowserVerificationRequest(actionSpec);
  if (!request.url) {
    return {
      observable: false,
      reason: "browser_verification_url_missing",
      request,
    };
  }
  if (
    request.expectedTexts.length === 0
    && request.expectedUrlIncludes.length === 0
    && request.expectedSelectors.length === 0
  ) {
    return {
      observable: false,
      reason: "browser_expected_state_missing",
      request,
    };
  }
  return {
    observable: true,
    reason: "",
    request,
  };
}

export async function verifyBrowserActionExpectedState({
  actionSpec = {},
  browserTool = null,
  fetchPageState = null,
  pageState = null,
} = {}) {
  const observability = isBrowserExpectedStateObservable(actionSpec);
  const runnableScript = buildBrowserHarnessVerificationScript(observability.request);
  const runnableCommand = runnableScript
    ? `browser-harness -c ${JSON.stringify(runnableScript)}`
    : "";

  if (!observability.observable) {
    return buildBrowserVerificationResult({
      status: BROWSER_TOOL_VERIFICATION_STATUS.unsupported,
      reason: observability.reason,
      request: observability.request,
      runnableScript,
      runnableCommand,
    });
  }

  let rawPageState = pageState;
  if (!rawPageState && typeof fetchPageState === "function") {
    rawPageState = await fetchPageState({
      request: observability.request,
      script: runnableScript,
      command: runnableCommand,
    });
  } else if (!rawPageState && typeof browserTool === "function") {
    rawPageState = await browserTool({
      request: observability.request,
      script: runnableScript,
      command: runnableCommand,
    });
  }

  if (!rawPageState) {
    return buildBrowserVerificationResult({
      status: BROWSER_TOOL_VERIFICATION_STATUS.unsupported,
      reason: "browser_tool_not_configured",
      request: observability.request,
      runnableScript,
      runnableCommand,
    });
  }

  const normalizedPageState = normalizeBrowserPageState(rawPageState);
  const evaluation = evaluateBrowserExpectedState(observability.request, normalizedPageState);
  return buildBrowserVerificationResult({
    status: evaluation.passed
      ? BROWSER_TOOL_VERIFICATION_STATUS.pass
      : BROWSER_TOOL_VERIFICATION_STATUS.fail,
    reason: evaluation.reason,
    request: observability.request,
    pageState: normalizedPageState,
    evidenceItems: evaluation.evidenceItems,
    runnableScript,
    runnableCommand,
  });
}

export function evaluateBrowserExpectedState(request = {}, pageState = {}) {
  const failures = [];
  const evidenceItems = [];
  const url = trimText(pageState.url);
  const pageText = normalizeComparableText([pageState.title, pageState.text].filter(Boolean).join("\n"));
  const selectorMap = normalizeSelectorStateMap(pageState.selectors);

  for (const expected of request.expectedUrlIncludes || []) {
    if (!normalizeComparableText(url).includes(normalizeComparableText(expected))) {
      failures.push(`URL does not include "${expected}".`);
    } else {
      evidenceItems.push({ type: "browser_url", content: expected, source: url });
    }
  }

  for (const expected of request.expectedTexts || []) {
    if (!pageText.includes(normalizeComparableText(expected))) {
      failures.push(`Page text missing "${expected}".`);
    } else {
      evidenceItems.push({ type: "browser_text", content: expected, source: url });
    }
  }

  for (const expected of request.expectedSelectors || []) {
    const observed = selectorMap.get(expected.selector);
    if (!observed?.exists) {
      failures.push(`Selector missing "${expected.selector}".`);
      continue;
    }
    if (expected.text && !normalizeComparableText(observed.text).includes(normalizeComparableText(expected.text))) {
      failures.push(`Selector "${expected.selector}" text missing "${expected.text}".`);
      continue;
    }
    evidenceItems.push({
      type: "browser_selector",
      content: expected.text || expected.selector,
      source: expected.selector,
    });
  }

  return {
    passed: failures.length === 0,
    reason: failures.join(" "),
    evidenceItems,
  };
}

export function buildBrowserHarnessVerificationScript(request = {}) {
  if (!request?.url) return "";
  const selectors = (request.expectedSelectors || []).map((item) => item.selector).filter(Boolean);
  return [
    "import json",
    `new_tab(${JSON.stringify(request.url)})`,
    "wait_for_load()",
    "state = {",
    "  'url': js('location.href'),",
    "  'title': js('document.title'),",
    "  'text': js('document.body ? document.body.innerText : \"\"'),",
    "  'selectors': {},",
    "}",
    `for selector in ${JSON.stringify(selectors)}:`,
    "  state['selectors'][selector] = js(f\"\"\"",
    "    (() => {",
    "      const node = document.querySelector({json.dumps(selector)});",
    "      return node ? { exists: true, text: node.innerText || node.textContent || '' } : { exists: false, text: '' };",
    "    })()",
    "  \"\"\")",
    "print(json.dumps(state))",
  ].join("\n");
}

export function normalizeBrowserPageState(raw = {}) {
  const source = raw?.structuredContent ?? raw?.structured_content ?? raw;
  const parsed = typeof source === "string" ? parseJsonObject(source) : null;
  const state = parsed || (source && typeof source === "object" ? source : {});
  return {
    url: trimText(state.url ?? state.href ?? state.currentUrl ?? state.current_url),
    title: trimText(state.title),
    text: trimText(state.text ?? state.innerText ?? state.inner_text ?? state.bodyText ?? state.body_text, MAX_TEXT_CHARS),
    selectors: normalizeSelectorsState(state.selectors ?? state.selectorState ?? state.selector_state),
    raw,
  };
}

function buildBrowserVerificationResult({
  status,
  reason = "",
  request = {},
  pageState = null,
  evidenceItems = [],
  runnableScript = "",
  runnableCommand = "",
} = {}) {
  const passed = status === BROWSER_TOOL_VERIFICATION_STATUS.pass;
  const unsupported = status === BROWSER_TOOL_VERIFICATION_STATUS.unsupported;
  return {
    method: "browser",
    verifier: "browser-harness",
    status,
    outcome: status,
    passed,
    unsupported,
    confidence: passed ? 0.86 : 0,
    reason: trimText(reason || (passed ? "" : "Browser verification did not observe the expected state.")),
    agentAssessment: passed
      ? "Browser Tool verification observed the expected action state."
      : unsupported
        ? "Browser Tool verification cannot run until the action provides a URL and observable expected state."
        : "Browser Tool verification ran but did not observe enough evidence for the completion signal.",
    evidenceItems,
    raw: {
      request,
      pageState,
      runnableScript,
      runnableCommand,
    },
  };
}

function normalizeExpectedSelectors(values = []) {
  return values.flatMap((value) => {
    if (!value) return [];
    if (typeof value === "string") {
      const selector = trimText(value);
      return selector ? [{ selector, text: "" }] : [];
    }
    if (typeof value !== "object" || Array.isArray(value)) return [];
    const selector = trimText(value.selector ?? value.css ?? value.query ?? value.id);
    if (!selector) return [];
    return [{
      selector,
      text: trimText(value.text ?? value.expectedText ?? value.expected_text ?? value.contains ?? ""),
    }];
  });
}

function normalizeSelectorsState(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => ({
      selector: trimText(item?.selector),
      exists: Boolean(item?.exists ?? item?.found ?? item?.visible),
      text: trimText(item?.text ?? item?.innerText ?? item?.inner_text ?? item?.content),
    })).filter((item) => item.selector);
  }
  if (typeof value === "object") {
    return Object.entries(value).map(([selector, item]) => {
      if (typeof item === "boolean") {
        return { selector: trimText(selector), exists: item, text: "" };
      }
      if (typeof item === "string") {
        return { selector: trimText(selector), exists: true, text: trimText(item) };
      }
      return {
        selector: trimText(selector),
        exists: Boolean(item?.exists ?? item?.found ?? item?.visible),
        text: trimText(item?.text ?? item?.innerText ?? item?.inner_text ?? item?.content),
      };
    }).filter((item) => item.selector);
  }
  return [];
}

function normalizeSelectorStateMap(value) {
  return new Map(normalizeSelectorsState(value).map((item) => [item.selector, item]));
}

function normalizeComparableText(value) {
  return trimText(value, MAX_TEXT_CHARS).replace(/\s+/g, " ").toLowerCase();
}

function firstText(...values) {
  for (const value of values) {
    const text = trimText(value);
    if (text) return text;
  }
  return "";
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => trimText(value)).filter(Boolean))];
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function trimText(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}
