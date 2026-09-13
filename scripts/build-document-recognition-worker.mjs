import { build } from "esbuild";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function buildDocumentRecognitionWorker(outfile = ".next/document-recognition-worker.mjs") {
  return build({
    entryPoints: ["scripts/run-document-recognition-worker.ts"],
    outfile, bundle: true, platform: "node", format: "esm", target: "node22",
    conditions: ["react-server"],
    // Bundled CommonJS SDK dependencies still need native Node builtins.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDocumentRecognitionWorker();
}
