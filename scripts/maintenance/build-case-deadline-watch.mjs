import { build } from "esbuild";

// One self-contained file for the image: `node /app/case-deadline-watch.mjs`. `react-server` resolves the
// `server-only` guard to its empty module, as for the other maintenance jobs.
await build({
  entryPoints: ["scripts/maintenance/run-case-deadline-watch.mjs"],
  outfile: ".next/case-deadline-watch.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["react-server"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
