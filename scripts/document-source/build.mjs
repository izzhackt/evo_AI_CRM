import { build } from "esbuild";
import { cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const output = process.argv[2];
if (!output || process.argv.length !== 3) throw new Error("Usage: build.mjs <output-directory>");
const runtime = join(output, "runtime"), proof = join(output, "proof");
await mkdir(runtime, { recursive: true }); await mkdir(proof, { recursive: true });
const options = { bundle: true, platform: "node", format: "esm", target: "node22", conditions: ["react-server"], external: ["sharp"] };
await build({ ...options, entryPoints: ["scripts/document-source/inspect.mjs"], outfile: join(runtime, "inspect.mjs") });
await build({ ...options, entryPoints: ["src/lib/server/document-source-preflight.ts"], outfile: join(proof, "adapter.mjs") });
await build({ ...options, external: ["sharp", "./adapter.mjs"], entryPoints: ["scripts/document-source/test-harness.mjs"], outfile: join(proof, "test-harness.mjs") });

// Copy only sharp's installed production dependency closure, including this Linux
// architecture's @img binaries. No application sources, config or broad .next tree.
const copied = new Set();
async function copyPackage(name, optional = false, parentRequire = require) {
  if (copied.has(name)) return;
  let manifest, pkg;
  // package.json is intentionally not a public export of sharp. Resolve the
  // installed package through Node's actual search roots, not that API subpath.
  for (const directory of parentRequire.resolve.paths(name) ?? []) {
    const candidate = join(directory, name, "package.json");
    try { pkg = JSON.parse(await readFile(candidate, "utf8")); manifest = candidate; break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!manifest || !pkg) { if (optional) return; throw new Error(`Missing runtime dependency: ${name}`); }
  if (pkg.name !== name) throw new Error("Runtime dependency identity mismatch");
  if (optional && ((pkg.os && !pkg.os.includes(process.platform)) || (pkg.cpu && !pkg.cpu.includes(process.arch))
    || (pkg.libc && !pkg.libc.includes("glibc")))) return;
  const root = dirname(manifest);
  copied.add(name);
  await cp(root, join(runtime, "node_modules", name), { recursive: true, dereference: true });
  const childRequire = createRequire(manifest);
  for (const name of Object.keys(pkg.dependencies ?? {})) await copyPackage(name, false, childRequire);
  for (const name of Object.keys(pkg.optionalDependencies ?? {})) await copyPackage(name, true, childRequire);
}
await copyPackage("sharp");
