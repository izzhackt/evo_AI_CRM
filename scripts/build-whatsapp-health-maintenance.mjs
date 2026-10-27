import { build } from "esbuild";

// One self-contained file for the image: `node /app/whatsapp-health-maintenance.mjs`.
// `react-server` resolves the `server-only` guard to its empty module, as for the telephony, AI agents and
// knowledge maintenance jobs.
await build({
  entryPoints: ["scripts/whatsapp-health-maintenance.mjs"],
  outfile: ".next/whatsapp-health-maintenance.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["react-server"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

// The Wazzup operator script (docs/runbooks/wazzup-whatsapp.md) ships the same way, as its own file:
// `docker exec -i evo-crm-app-1 node /app/wazzup-ops.mjs <command>`. `deploy/` is not in the image and the container is
// read-only, so the script is bundled, not copied from the repository.
await build({
  entryPoints: ["scripts/wazzup-ops.mjs"],
  outfile: ".next/wazzup-ops.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["react-server"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
