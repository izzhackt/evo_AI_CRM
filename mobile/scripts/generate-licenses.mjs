#!/usr/bin/env node
// npm run licenses — пересобрать src/features/profile/licenses.generated.json из node_modules.
// Запускать после изменения зависимостей и перед релизной сборкой; результат коммитится.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXTRA_ENTRIES, buildLicenses } from "./licenses-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { data, missing } = buildLicenses({ root, extras: EXTRA_ENTRIES });
if (missing.length) {
  console.error(`Не найдены в node_modules (выполните npm ci): ${[...new Set(missing)].sort().join(", ")}`);
  process.exit(1);
}
const out = path.join(root, "src/features/profile/licenses.generated.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(data)}\n`);
const unknown = data.packages.filter((p) => p.license === "UNKNOWN" || !p.text);
console.log(`Лицензии: ${data.packages.length} записей, ${Object.keys(data.texts).length} уникальных текстов; без текста: ${unknown.length}.`);
