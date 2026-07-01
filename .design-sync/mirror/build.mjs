// Build the mirror DS into dist/: a single ESM JS bundle (react external),
// the .d.ts tree (tsc), and the stylesheet. The design-sync converter re-bundles
// dist/index.js into its IIFE and reads dist/index.d.ts for prop extraction.
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(root, "dist"), { recursive: true });

await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(root, "dist/index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  logLevel: "info",
});

cpSync(join(root, "src/ds.css"), join(root, "dist/ds.css"));

execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(root, "tsconfig.json")], {
  stdio: "inherit",
  cwd: root,
});

console.log("✓ mirror build → dist/index.js, dist/index.d.ts, dist/ds.css");
