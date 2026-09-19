import { build } from "esbuild";
await build({
  entryPoints: ["scripts/knowledge-library/maintenance.ts"], outfile: ".next/knowledge-maintenance.mjs",
  bundle: true, platform: "node", format: "esm", target: "node22", conditions: ["react-server"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
