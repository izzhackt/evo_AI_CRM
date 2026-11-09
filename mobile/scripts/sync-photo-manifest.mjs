#!/usr/bin/env node
// Манифест фото вузов: <repo>/scripts/portal/university-photos-manifest.json (вне src, в
// приложение напрямую не импортируется) -> src/features/universities/photo-manifest.generated.json.
// В файл попадают только фото, которые лежат в нашем бакете: verified и migrated, ключ -> путь
// объекта. Остальные фото студенту не показываются (никакого hotlink на сайты вузов).
//   node scripts/sync-photo-manifest.mjs           записать файл
//   node scripts/sync-photo-manifest.mjs --check   упасть, если файл устарел (npm run check)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "..");
const sourcePath = path.resolve(mobileRoot, "../scripts/portal/university-photos-manifest.json");
const outPath = path.join(mobileRoot, "src/features/universities/photo-manifest.generated.json");

// Та же проверка, что в src/lib/university-photo-url.ts (managedObjectPath).
const OBJECT_PATH = /^[a-z0-9][a-z0-9-]*\.(?:avif|gif|jpg|png|webp)(?![\s\S])/u;

const manifest = JSON.parse(readFileSync(sourcePath, "utf8"));
const entries = {};
for (const key of Object.keys(manifest.entries).sort()) {
  const entry = manifest.entries[key];
  if (entry.status === "verified" && entry.migrated === true && typeof entry.objectPath === "string"
    && OBJECT_PATH.test(entry.objectPath) && entry.objectPath.startsWith(`${key}.`)) {
    entries[key] = entry.objectPath;
  }
}
const text = `${JSON.stringify({ bucket: manifest.bucket, entries }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== text) {
    console.error("photo-manifest.generated.json устарел: npm run sync-photo-manifest");
    process.exit(1);
  }
  console.log("photo-manifest.generated.json актуален");
} else {
  writeFileSync(outPath, text);
  console.log(`photo-manifest.generated.json: ${Object.keys(entries).length} фото`);
}
