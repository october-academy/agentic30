import path from "node:path";
import os from "node:os";
import { registerOnboardingWorkspaceRequest } from "./onboarding-workspace-request.mjs";

export function defaultAppSupportPath(env = process.env) {
  return env.AGENTIC30_APP_SUPPORT_PATH
    ? path.resolve(env.AGENTIC30_APP_SUPPORT_PATH)
    : path.join(os.homedir(), "Library", "Application Support", "agentic30");
}

export function defaultNonceStorePath(env = process.env, appSupportPath = defaultAppSupportPath(env)) {
  if (env.AGENTIC30_ONBOARDING_NONCE_PATH) {
    return path.resolve(env.AGENTIC30_ONBOARDING_NONCE_PATH);
  }
  return path.join(appSupportPath, "onboarding-nonce.json");
}

function parseRegisterArgs(argv) {
  const opts = { register: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--register") {
      opts.register = true;
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--path") { opts.path = next; i += 1; continue; }
    if (arg === "--source") { opts.source = next; i += 1; continue; }
    if (arg === "--token") { opts.token = next; i += 1; continue; }
    if (arg.startsWith("--path=")) { opts.path = arg.slice("--path=".length); continue; }
    if (arg.startsWith("--source=")) { opts.source = arg.slice("--source=".length); continue; }
    if (arg.startsWith("--token=")) { opts.token = arg.slice("--token=".length); continue; }
  }
  return opts;
}

export async function runRegisterCli({
  argv,
  env = process.env,
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
  registerWorkspaceRequest = registerOnboardingWorkspaceRequest,
} = {}) {
  const opts = parseRegisterArgs(argv);
  const usedCwd = !opts.path || !String(opts.path).trim();
  const result = await registerWorkspaceRequest({
    appSupportPath: defaultAppSupportPath(env),
    workspacePath: usedCwd ? cwd : opts.path,
    source: opts.source ?? "unknown",
    usedCwd,
    token: opts.token,
    nonceStorePath: defaultNonceStorePath(env),
  });
  stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) {
    stderr.write(`agentic30-onboarding: ${result.error || "register failed"}\n`);
    return 1;
  }
  return 0;
}

const USAGE = "usage: agentic30-onboarding --register --path <absolute> --source <cursor|codex|claude_code> --token <onboarding-token>\n";

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  const code = await runRegisterCli({ argv });
  process.exit(code);
}
