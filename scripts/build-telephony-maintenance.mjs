import { build } from "esbuild";

// One self-contained file for the image: `node /app/telephony-maintenance.mjs`.
// `react-server` resolves the `server-only` guard to its empty module, as for the
// knowledge maintenance job.
await build({
  entryPoints: ["scripts/telephony-maintenance.mjs"],
  outfile: ".next/telephony-maintenance.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["react-server"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
