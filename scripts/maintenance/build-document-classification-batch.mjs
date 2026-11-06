import { build } from "esbuild";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function buildDocumentClassificationBatch(outfile = ".next/document-classification-batch.mjs") {
  return build({
    entryPoints: ["scripts/maintenance/run-document-classification.ts"],
    outfile, bundle: true, platform: "node", format: "esm", target: "node22",
    conditions: ["react-server"],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDocumentClassificationBatch();
}
