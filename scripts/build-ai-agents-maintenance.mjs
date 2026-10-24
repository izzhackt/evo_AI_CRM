import { build } from "esbuild";

// One self-contained file for the image: `node /app/ai-agents-maintenance.mjs`.
// `react-server` resolves the `server-only` guard to its empty module, as for the
// telephony and knowledge maintenance jobs.
await build({
  entryPoints: ["scripts/ai-agents-maintenance.mjs"],
  outfile: ".next/ai-agents-maintenance.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["react-server"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
