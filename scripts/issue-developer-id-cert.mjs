#!/usr/bin/env node
// Issue a Developer ID Application certificate via App Store Connect API.
// Generates CSR, signs JWT with the .p8 API key, posts to /v1/certificates,
// downloads the .cer, packs .p12, and imports into login.keychain.
//
// Usage:
//   node scripts/issue-developer-id-cert.mjs \
//     --key-path ~/.config/agentic30/asc-api-key.p8 \
//     --key-id    XXXXXXXXXX \
//     --issuer-id YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY \
//     --common-name "Hogyun Yu" \
//     --organization "October Academy"
//
// Side effects:
//   - Writes ~/.config/agentic30/developer-id.{key,csr,cer,p12} (0600).
//   - `security import` into login.keychain so codesign can find the identity.
//
// Idempotency: re-running issues a NEW certificate. Apple permits multiple
// Developer ID Application certs per team. Old cert files are not deleted.
//
// Why not fastlane match yet: founder chose API path now, fastlane match in W2
// (5/19+). The .p8 key created here is reused by fastlane match — no rework.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const args = parseArgs(process.argv.slice(2));
requireFlags(args, ["key-path", "key-id", "issuer-id", "common-name"]);

const KEY_PATH = expand(args["key-path"]);
const KEY_ID = args["key-id"];
const ISSUER_ID = args["issuer-id"];
const COMMON_NAME = args["common-name"];
const ORGANIZATION = args["organization"] || COMMON_NAME;
const COUNTRY = args["country"] || "KR";

const OUT_DIR = path.join(homedir(), ".config", "agentic30");
mkdirSync(OUT_DIR, { recursive: true });
chmodSync(OUT_DIR, 0o700);

const KEY_OUT = path.join(OUT_DIR, "developer-id.key");
const CSR_OUT = path.join(OUT_DIR, "developer-id.csr");
const CER_OUT = path.join(OUT_DIR, "developer-id.cer");
const P12_OUT = path.join(OUT_DIR, "developer-id.p12");

main().catch((err) => {
  console.error("[issue-developer-id-cert] FAILED:", err.message);
  process.exit(1);
});

async function main() {
  console.log("[1/5] Generating private key + CSR...");
  generateKeyAndCSR();

  console.log("[2/5] Signing JWT for App Store Connect API...");
  const jwt = signJWT();

  console.log("[3/5] POSTing certificate request to App Store Connect...");
  const cerBase64 = await requestCertificate(jwt);

  console.log("[4/5] Writing .cer and packing into .p12...");
  writeFileSync(CER_OUT, Buffer.from(cerBase64, "base64"), { mode: 0o600 });
  packP12();

  console.log("[5/5] Importing .p12 into login.keychain...");
  importToKeychain();

  console.log("\n✅ DONE");
  console.log(`  cert:  ${CER_OUT}`);
  console.log(`  p12:   ${P12_OUT}`);
  console.log(`  key:   ${KEY_OUT}`);
  console.log(
    "\n  Verify: security find-identity -v -p codesigning login.keychain"
  );
  console.log(
    "  Expect: \"Developer ID Application: " +
      ORGANIZATION +
      " (TEAMID)\" entry"
  );
}

function generateKeyAndCSR() {
  if (existsSync(KEY_OUT)) {
    console.log(`  reusing existing key: ${KEY_OUT}`);
  } else {
    run("openssl", ["genrsa", "-out", KEY_OUT, "2048"]);
    chmodSync(KEY_OUT, 0o600);
  }
  // Subject must match Apple's expectations; CN is what shows up in keychain.
  run("openssl", [
    "req",
    "-new",
    "-key",
    KEY_OUT,
    "-out",
    CSR_OUT,
    "-subj",
    `/CN=${COMMON_NAME}/O=${ORGANIZATION}/C=${COUNTRY}`,
  ]);
}

function signJWT() {
  const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER_ID,
    iat: now,
    exp: now + 1200, // 20 min, App Store Connect API max
    aud: "appstoreconnect-v1",
  };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKey = crypto.createPrivateKey({
    key: readFileSync(KEY_PATH, "utf8"),
    format: "pem",
  });
  // ASC requires JOSE-format ECDSA signature (r || s, 64 bytes for P-256),
  // but Node's crypto.sign emits DER. Use dsaEncoding: "ieee-p1363".
  const signature = crypto.sign(
    "sha256",
    Buffer.from(signingInput),
    { key: privateKey, dsaEncoding: "ieee-p1363" }
  );

  return `${signingInput}.${b64url(signature)}`;
}

async function requestCertificate(jwt) {
  const csrBase64 = readFileSync(CSR_OUT, "utf8")
    .replace(/-----BEGIN CERTIFICATE REQUEST-----/, "")
    .replace(/-----END CERTIFICATE REQUEST-----/, "")
    .replace(/\s+/g, "");

  const body = {
    data: {
      type: "certificates",
      attributes: {
        certificateType: "DEVELOPER_ID_APPLICATION",
        csrContent: csrBase64,
      },
    },
  };

  const res = await fetch(
    "https://api.appstoreconnect.apple.com/v1/certificates",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `App Store Connect API ${res.status}: ${text.slice(0, 1000)}`
    );
  }
  const json = JSON.parse(text);
  const cerBase64 = json?.data?.attributes?.certificateContent;
  if (!cerBase64) {
    throw new Error(`Response missing certificateContent: ${text.slice(0, 500)}`);
  }
  return cerBase64;
}

function packP12() {
  // Bundle .key + .cer into .p12 with empty password (keychain can re-encrypt).
  // We rely on keychain ACL for protection; explicit password is unnecessary
  // and complicates re-import on rotation.
  run("openssl", [
    "pkcs12",
    "-export",
    "-inkey",
    KEY_OUT,
    "-in",
    CER_OUT,
    "-out",
    P12_OUT,
    "-password",
    "pass:",
    "-name",
    `Developer ID Application: ${ORGANIZATION}`,
  ]);
  chmodSync(P12_OUT, 0o600);
}

function importToKeychain() {
  // -T grants codesign + productbuild access without per-use prompt.
  run("security", [
    "import",
    P12_OUT,
    "-k",
    `${homedir()}/Library/Keychains/login.keychain-db`,
    "-P",
    "",
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/productbuild",
    "-T",
    "/usr/bin/security",
  ]);
}

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argv.join(" ")} exited ${r.status}`);
  }
}

function b64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function expand(p) {
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function requireFlags(out, keys) {
  const missing = keys.filter((k) => typeof out[k] !== "string" || out[k].trim() === "");
  if (missing.length) {
    console.error(
      `[issue-developer-id-cert] missing flags: ${missing.map((k) => "--" + k).join(", ")}`
    );
    process.exit(2);
  }
}
