import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIVATE_HASH_VERSION,
  hashPrivateExcerpt,
  __resetWarnOnceForTests,
} from "../sidecar/private-hash.mjs";

const ENV_KEY = "AGENTIC30_LEDGER_PEPPER";

function withPepper(value, fn) {
  const prev = process.env[ENV_KEY];
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = prev;
    }
  }
}

test("hashPrivateExcerpt throws when AGENTIC30_LEDGER_PEPPER is missing", () => {
  withPepper(undefined, () => {
    assert.throws(() => hashPrivateExcerpt("anything"), /not set/);
  });
});

test("hashPrivateExcerpt requires non-empty string input", () => {
  withPepper("test-pepper-1", () => {
    assert.throws(() => hashPrivateExcerpt(""), /non-empty string/);
    assert.throws(() => hashPrivateExcerpt(null), /non-empty string/);
    assert.throws(() => hashPrivateExcerpt(123), /non-empty string/);
  });
});

test("hashPrivateExcerpt produces 64-hex with pepperVersion field", () => {
  withPepper("test-pepper-A", () => {
    const result = hashPrivateExcerpt("private-keyword");
    assert.equal(result.pepperVersion, PRIVATE_HASH_VERSION);
    assert.match(result.hash, /^[a-f0-9]{64}$/);
  });
});

test("hashPrivateExcerpt is deterministic for the same pepper + input", () => {
  withPepper("test-pepper-A", () => {
    const a = hashPrivateExcerpt("same input");
    const b = hashPrivateExcerpt("same input");
    assert.equal(a.hash, b.hash);
  });
});

test("hashPrivateExcerpt yields different hash when pepper changes", () => {
  // Codex HIGH: pepper is the only thing keeping hash class collisions hard.
  // A pepper change must produce a different hash for the same input,
  // otherwise rotation would be ineffective.
  let withPepperA;
  let withPepperB;
  withPepper("pepper-A-secret", () => {
    withPepperA = hashPrivateExcerpt("identical input").hash;
  });
  withPepper("pepper-B-different", () => {
    withPepperB = hashPrivateExcerpt("identical input").hash;
  });
  assert.notEqual(withPepperA, withPepperB);
});

test("hashPrivateExcerpt warns once when pepper starts with dev-only-", () => {
  __resetWarnOnceForTests();
  const captured = [];
  const original = process.emitWarning;
  process.emitWarning = (...args) => {
    captured.push(args[0]);
  };
  try {
    withPepper("dev-only-not-secure-abc123", () => {
      hashPrivateExcerpt("first-call");
      hashPrivateExcerpt("second-call");
      hashPrivateExcerpt("third-call");
    });
  } finally {
    process.emitWarning = original;
  }
  const devWarnings = captured.filter((m) => /dev-only-/.test(String(m)));
  assert.equal(
    devWarnings.length,
    1,
    `expected exactly 1 warning, got ${devWarnings.length}: ${captured.join(" | ")}`,
  );
});
