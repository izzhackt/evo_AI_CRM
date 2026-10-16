#!/usr/bin/env node
/**
 * Генератор раздела сида миграции 283 (страны, города, связи вуз → город).
 *
 * Входы (схема: SEED_CONTRACT.md контент-потока в папке сида, сводка в
 * docs/catalog/geography-costs-contract.md, раздел 4):
 *   <seed-dir>/countries.json, cities.json, institution-cities.json,
 *   photos-manifest.json, photos/; src/lib/study-countries.json (коды и
 *   названия стран продукта).
 * Папка по умолчанию: output/student-app-v2/seed этого checkout (игнорируется
 * Git); другую задаёт --seed-dir или EVO_GEOGRAPHY_SEED_DIR.
 *
 * Режимы:
 *   (по умолчанию)  проверка входов и отчёт JSON, ничего не пишет;
 *   --print         печатает SQL раздела сида;
 *   --write         заменяет раздел между маркерами в
 *                   supabase/migrations/283_platform_catalog_geography_costs.sql;
 *   --check         код 1, если раздел в миграции не равен сгенерированному.
 * Флаги:
 *   --allow-missing            отсутствующий файл входа даёт пустую часть;
 *   --prod-institutions <file> отчёт покрытия по выгрузке production
 *                              (поля country_code, institution_name);
 *   --require-complete         код 1, если покрытие не полное или
 *                              production_id связи не совпал с выгрузкой.
 * Сеть и база не используются.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_FILE, REPO_ROOT, SeedError, buildSeedSql, coverageAgainst, loadGeographySeed, replaceSeedSection,
} from "./geography-seed-lib.mjs";

function parseArgs(argv) {
  const options = { mode: "report", allowMissing: false, requireComplete: false, seedDir: null, prodInstitutions: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--print" || arg === "--write" || arg === "--check") {
      if (options.mode !== "report") throw new Error("only one of --print, --write, --check");
      options.mode = arg.slice(2);
    } else if (arg === "--allow-missing") options.allowMissing = true;
    else if (arg === "--require-complete") options.requireComplete = true;
    else if (arg === "--seed-dir") options.seedDir = argv[++index];
    else if (arg === "--prod-institutions") options.prodInstitutions = argv[++index];
    else if (arg === "--help") options.mode = "help";
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export function runGenerator(argv, { write = (text) => process.stdout.write(text), environment = process.env } = {}) {
  let options;
  try { options = parseArgs(argv); } catch (error) { write(`${JSON.stringify({ status: "arguments_invalid", error: error.message })}\n`); return 1; }
  if (options.mode === "help") {
    write("Usage: node scripts/catalog/generate-geography-seed.mjs [--seed-dir DIR] [--print|--write|--check] [--allow-missing] [--prod-institutions FILE] [--require-complete]\n");
    return 0;
  }
  const seedDir = resolve(options.seedDir ?? environment.EVO_GEOGRAPHY_SEED_DIR ?? resolve(REPO_ROOT, "output/student-app-v2/seed"));
  let seed;
  try {
    seed = loadGeographySeed({ seedDir, allowMissing: options.allowMissing });
  } catch (error) {
    if (error instanceof SeedError) { write(`${JSON.stringify({ status: "seed_invalid", problems: error.problems }, null, 2)}\n`); return 1; }
    throw error;
  }
  const sql = buildSeedSql(seed);
  let coverage = null;
  if (options.prodInstitutions) {
    const exported = JSON.parse(readFileSync(resolve(options.prodInstitutions), "utf8"));
    coverage = coverageAgainst(seed, exported.institutions ?? exported);
  }
  const report = {
    status: "seed_valid",
    inputs: seed.inputs,
    countries: seed.countries.length,
    countriesWithPhoto: seed.countries.filter((c) => c.photo).length,
    cities: seed.cities.length,
    citiesPublished: seed.cities.filter((c) => c.status === "published").length,
    links: seed.links.length,
    photos: seed.uploads.length,
    coverage,
  };
  if (options.mode === "print") { write(sql); return 0; }
  if (options.mode === "write" || options.mode === "check") {
    const current = readFileSync(MIGRATION_FILE, "utf8");
    const next = replaceSeedSection(current, sql);
    if (options.mode === "check") {
      const same = next === current;
      write(`${JSON.stringify({ ...report, status: same ? "migration_seed_current" : "migration_seed_stale" }, null, 2)}\n`);
      return same ? 0 : 1;
    }
    writeFileSync(MIGRATION_FILE, next);
    write(`${JSON.stringify({ ...report, status: "migration_seed_written" }, null, 2)}\n`);
  } else {
    write(`${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.requireComplete && (!coverage || coverage.missing.length > 0 || coverage.unknownLinks.length > 0
    || coverage.idMismatch.length > 0)) return 1;
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runGenerator(process.argv.slice(2));
}
