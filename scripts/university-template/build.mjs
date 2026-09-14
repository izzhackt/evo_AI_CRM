import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const output = process.argv[2];
if (!output || process.argv.length !== 3) throw new Error("Usage: build.mjs <output-directory>");
const runtime = join(output, "runtime"), proof = join(output, "proof");
if (process.platform !== "linux" || !["arm64", "x64"].includes(process.arch)) throw new Error("Native Linux arm64/x64 build required");
const require = createRequire(import.meta.url);
await mkdir(runtime, { recursive: true });
await mkdir(join(proof, "missing-addon"), { recursive: true });
await mkdir(join(proof, "canvas-compatibility"), { recursive: true });
await mkdir(join(proof, "fill-proof", "src", "lib", "server"), { recursive: true });
await cp("scripts/document-source/bootstrap.mjs", join(runtime, "bootstrap.mjs"));
await cp("scripts/document-source/bootstrap.mjs", join(proof, "missing-addon", "bootstrap.mjs"));
await cp("scripts/document-source/bootstrap.mjs", join(proof, "canvas-compatibility", "bootstrap.mjs"));
await cp("scripts/document-source/bootstrap.mjs", join(proof, "fill-proof", "src", "lib", "server", "bootstrap.mjs"));
await mkdir(join(proof, "fill-proof", "assets", "fonts"), { recursive: true });
await cp("assets/fonts/NotoSans-Regular.ttf", join(proof, "fill-proof", "assets", "fonts", "NotoSans-Regular.ttf"));
await cp("assets/fonts/OFL.txt", join(proof, "fill-proof", "assets", "fonts", "OFL.txt"));
await mkdir(join(proof, "public-fixtures"), { recursive: true });
// Public OFL test asset only; never a production font fallback or new fill font.
for (const [source, filename, size, sha256] of [
  ["Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Regular.otf", 16437364, "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b"],
  ["Sans/SubsetOTF/SC/NotoSansSC-Regular.otf", "NotoSansSC-Regular.otf", 8331336, "faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9"],
  ["LICENSE", "NotoCJK-OFL.txt", 4301, "6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2"],
]) {
  const response = await fetch(`https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/${source}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error("Public fixture unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Public fixture checksum mismatch");
  await writeFile(join(proof, "public-fixtures", filename), bytes);
}
const pdfjsRoot = join("node_modules", "pdfjs-dist"), canvasRoot = join("node_modules", "@napi-rs", "canvas");
for (const [root, version] of [[pdfjsRoot, "6.3.289"], [canvasRoot, "1.0.9"]]) {
  if (JSON.parse(await readFile(join(root, "package.json"), "utf8")).version !== version) throw new Error("Unexpected rasterizer version");
}
for (const part of ["cmaps", "standard_fonts", "wasm", "LICENSE", "package.json", "legacy/build/pdf.mjs", "legacy/build/pdf.worker.mjs"]) {
  const target = join(runtime, "vendor", "pdfjs", part);
  await mkdir(join(target, ".."), { recursive: true });
  await cp(join(pdfjsRoot, part), target, { recursive: true });
}
await cp(canvasRoot, join(runtime, "node_modules", "@napi-rs", "canvas"), { recursive: true });
await cp(require.resolve(`@napi-rs/canvas-linux-${process.arch}-gnu`), join(runtime, "vendor", "canvas-native.node"));
const assets = {};
async function recordAssets(relative) {
  for (const entry of await readdir(join(runtime, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await recordAssets(path);
    else if (entry.isFile()) assets[path] = createHash("sha256").update(await readFile(join(runtime, path))).digest("hex");
    else throw new Error("Runtime assets must be ordinary files/directories");
  }
}
await recordAssets("vendor"); await recordAssets("node_modules");
await writeFile(join(runtime, "raster-assets.json"), JSON.stringify({ architecture: process.arch, pdfjs: "6.3.289", canvas: "1.0.9", assets }));
const options = { bundle: true, platform: "node", format: "esm", target: "node22", conditions: ["react-server"], treeShaking: true };
await build({ ...options, entryPoints: ["scripts/university-template/compatibility.mjs"], outfile: join(proof, "canvas-compatibility", "inspect.mjs") });
await build({ ...options, entryPoints: ["scripts/university-template/inspect.mjs"], outfile: join(runtime, "inspect.mjs") });
await build({ ...options, entryPoints: ["scripts/university-template/render-page.mjs"], outfile: join(runtime, "render-page.mjs") });
await build({ ...options, entryPoints: ["scripts/university-template/fill-proof.mjs"], outfile: join(proof, "fill-proof", "src", "lib", "server", "inspect.mjs") });
await build({ ...options, entryPoints: ["scripts/university-template/raster-fixtures.mjs"], outfile: join(proof, "raster-fixtures.mjs") });
await build({ ...options, entryPoints: ["src/lib/server/university-template-preflight.ts"], outfile: join(proof, "adapter.mjs") });
await build({ ...options, external: ["./adapter.mjs"], entryPoints: ["scripts/university-template/test-harness.mjs"], outfile: join(proof, "test-harness.mjs") });
