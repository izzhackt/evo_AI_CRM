import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const output = process.argv[2];
if (!output || process.argv.length !== 3) throw new Error("Usage: build.mjs <output-directory>");
const runtime = join(output, "runtime"), proof = join(output, "proof");
await mkdir(runtime, { recursive: true });
await mkdir(join(proof, "missing-addon"), { recursive: true });
await cp("scripts/document-source/bootstrap.mjs", join(runtime, "bootstrap.mjs"));
await cp("scripts/document-source/bootstrap.mjs", join(proof, "missing-addon", "bootstrap.mjs"));
const options = { bundle: true, platform: "node", format: "esm", target: "node22", conditions: ["react-server"], treeShaking: true };
await build({ ...options, entryPoints: ["scripts/university-template/inspect.mjs"], outfile: join(runtime, "inspect.mjs") });
await build({ ...options, entryPoints: ["src/lib/server/university-template-preflight.ts"], outfile: join(proof, "adapter.mjs") });
await build({ ...options, external: ["./adapter.mjs"], entryPoints: ["scripts/university-template/test-harness.mjs"], outfile: join(proof, "test-harness.mjs") });
