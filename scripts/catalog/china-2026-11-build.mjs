#!/usr/bin/env node
/**
 * Китай 2026-11: сборка карточек, программ, строк стоимости и привязок городов из разбора рабочей таблицы EVO
 * (план docs/catalog/china-2026-11-plan.md). Скрипт ничего не публикует: он пишет три файла в репозиторий.
 *
 *   node scripts/catalog/china-2026-11-build.mjs --work-dir DIR [--base-ref origin/main] [--verified-on 2026-11-19] [--write]
 *
 * Рабочая папка (вне Git: в ней сырые строки таблицы) содержит:
 *   rows.json        строки Excel как есть (row, id, uid, nameEn, nameZh, location, intakeRaw, major, langRaw, fee, req, deadline)
 *   identities.json  проверенные личности вузов по uid (нужны nameEn, cityRu, cityKey, websiteUrl, overviewRu, crmMatch)
 *   majors.json      вычитка названий специальностей: { "<предочищенное>": { action, titles } }
 *   fee_groups.json  группы текстов платы: [{ feeId, uid, text, rows }]
 *   cost_a.json, cost_b.json   два независимых разбора текстов платы: [{ feeId, items, scholarshipMentioned }]
 *   live_costs.json  опубликованные строки стоимости Китая сейчас (для уже имевшихся вузов): [{ institution, kind, level, ... }]
 *   overrides.json   { dropRows: [row], splitRows: { "<row>": ["title", ...] }, excludeUids: { "<uid>": "причина" } }
 * Выход (с --write): src/lib/server/university-catalog-reviewed-china.json (47 прежних карточек первыми, слияние
 * вместо замены, новые по алфавиту), scripts/catalog/data/china-2026-11/{programme-costs,city-links,programme-trace}.json
 * и build-report.json в рабочей папке. В Git не попадает ничего, кроме того, что платформа покажет студенту.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_NOTES, acceptCostItems, autoFillRows, basicMajorClean, buildCostRows, cleanedTitleIsFaithful, buildIntakes, buildSummary, collapse, lettersOnly, mergeIntoExisting,
  normalizeLanguage, parseAge, parseDurationYears, programmesSentence, slugify, uniqueProgramId, yearsRu,
} from "./china-2026-11-lib.mjs";
import { parseUniversityContent } from "../../src/lib/platform-university-catalog.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEWED_PATH = "src/lib/server/university-catalog-reviewed-china.json";
const DATA_DIR = resolve(ROOT, "scripts/catalog/data/china-2026-11");

/** Опубликованные карточки городов Китая в production на 19.11.2026: новые вузы привязываются только к ним. */
export const EXISTING_CITY_KEYS = Object.freeze(["hangzhou", "shanghai", "beijing", "guangzhou", "xian", "chengdu", "qingdao", "wuhan",
  "chongqing", "harbin", "hefei", "nanchang", "nanjing", "ningbo", "shenyang", "suzhou", "xiangyang", "yibin", "zhuhai"]);

const readJson = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));

export function loadWorkDir(dir) {
  const optional = (name, fallback) => { try { return readJson(dir, name); } catch { return fallback; } };
  const rows = readJson(dir, "rows.json");
  const feeGroups = readJson(dir, "fee_groups.json");
  return {
    rows: Array.isArray(rows) ? rows : rows.rows,
    identities: readJson(dir, "identities.json"),
    majors: readJson(dir, "majors.json"),
    feeGroups,
    costA: readJson(dir, "cost_a.json"),
    costB: readJson(dir, "cost_b.json"),
    liveCosts: optional("live_costs.json", []),
    overrides: optional("overrides.json", { dropRows: [], splitRows: {}, excludeUids: {} }),
  };
}

const ELIGIBLE_CONFIDENCE = new Set(["high", "medium"]);
export function identityProblem(rec) {
  if (!rec) return "no identity record";
  if (rec.status !== "resolved") return `identity ${rec.status}: ${rec.statusReason ?? "no reason"}`;
  if (!ELIGIBLE_CONFIDENCE.has(rec.confidence)) return `confidence ${rec.confidence}`;
  for (const field of ["nameEn", "nameZh", "cityRu", "cityKey", "websiteUrl", "overviewRu"]) if (typeof rec[field] !== "string" || rec[field].trim() === "") return `missing ${field}`;
  if (!/^https:\/\//u.test(rec.websiteUrl)) return "websiteUrl is not https";
  return null;
}

/** Программы одного вуза из его строк таблицы; возвращает программы, сведения для трассировки и отчёт об исключённом. */
export function programmesForRows(rows, { majors, overrides, sourceUrl, scholarshipByRow }) {
  const drop = new Set((overrides.dropRows ?? []).map(Number));
  const programmes = [], trace = [], skipped = [], blanked = [];
  const taken = new Set();
  const seen = new Map();
  const ordered = [...rows].sort((a, b) => a.row - b.row);
  // Excel drag-fill leaves «Age: 18-28, 18-29, 18-30» and «June 31, 32, 33» runs: such cells are unreliable and are not used.
  const badAge = autoFillRows(ordered.map((entry) => ({ row: entry.row, text: entry.req })));
  const badDeadline = autoFillRows(ordered.map((entry) => ({ row: entry.row, text: entry.deadline })));
  for (const row of ordered) {
    if (drop.has(row.row)) { skipped.push({ row: row.row, why: "dropped by override" }); continue; }
    const cleaned = basicMajorClean(row.major);
    if (cleaned === "") { skipped.push({ row: row.row, why: "empty major" }); continue; }
    const fix = majors[cleaned];
    if (!fix) throw new Error(`no title fix for row ${row.row}: ${JSON.stringify(cleaned)}`);
    if (fix.action === "drop") { skipped.push({ row: row.row, why: `not a programme: ${fix.reason ?? ""}`.trim() }); continue; }
    const titles = overrides.splitRows?.[String(row.row)] ?? fix.titles;
    // A title fix may only change spelling, spacing and case; a larger change needs an explicit approval in overrides.json.
    if (!cleanedTitleIsFaithful(cleaned, titles) && !(overrides.approvedTitleFixes ?? []).includes(cleaned)) {
      throw new Error(`title fix for row ${row.row} changes more than spelling: ${JSON.stringify(cleaned)} -> ${JSON.stringify(titles)}`);
    }
    const language = normalizeLanguage(row.langRaw);
    const years = parseDurationYears(row.major);
    for (const title of titles.map((entry) => overrides.titleOverrides?.[entry] ?? entry)) {
      const key = `${lettersOnly(title)}|${language.iso}`;
      if (seen.has(key)) { seen.get(key).rows.push(row.row); continue; }
      const id = uniqueProgramId(title, language.iso, taken);
      taken.add(id);
      if (badAge.has(row.row)) blanked.push({ row: row.row, field: "age" });
      if (badDeadline.has(row.row)) blanked.push({ row: row.row, field: "deadline" });
      const programme = {
        id, level: "bachelor", title, intakes: buildIntakes({ intakeRaw: row.intakeRaw, deadlineRaw: badDeadline.has(row.row) ? "" : row.deadline, sourceUrl }),
        summary: buildSummary({ languageRu: language.ru, ageRu: badAge.has(row.row) ? null : parseAge(row.req), scholarship: scholarshipByRow.get(row.row) === true }),
        duration: years === null ? null : yearsRu(years), language: language.ru, sourceUrl,
      };
      const entry = { programme, languageIso: language.iso, rows: [row.row] };
      seen.set(key, entry);
      programmes.push(entry);
    }
  }
  for (const entry of programmes) trace.push({ programId: entry.programme.id, rows: entry.rows });
  return { programmes, trace, skipped, blanked };
}

function baseCards(ref) {
  const text = execFileSync("git", ["show", `${ref}:${REVIEWED_PATH}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  return JSON.parse(text);
}

export function build({ workDir, baseRef = "origin/main", verifiedOn }) {
  const input = loadWorkDir(workDir);
  const base = baseCards(baseRef);
  const baseByName = new Map(base.map((card) => [card.content.name, card]));
  const idByUid = new Map(input.identities.map((rec) => [rec.uid, rec]));
  const rowsByUid = new Map();
  for (const row of input.rows) rowsByUid.set(row.uid, [...(rowsByUid.get(row.uid) ?? []), row]);
  const feeByRow = new Map();
  for (const group of input.feeGroups) for (const rowNumber of group.rows) feeByRow.set(rowNumber, group.feeId);
  const feeById = new Map(input.feeGroups.map((group) => [group.feeId, group]));
  const aById = new Map(input.costA.map((entry) => [entry.feeId, entry]));
  const bById = new Map(input.costB.map((entry) => [entry.feeId, entry]));
  const acceptedByFee = new Map(), rejectedCosts = [];
  for (const group of input.feeGroups) {
    const a = aById.get(group.feeId), b = bById.get(group.feeId);
    const { accepted, rejected } = acceptCostItems(group.text, a?.items, b?.items);
    acceptedByFee.set(group.feeId, { accepted, scholarship: Boolean(a?.scholarshipMentioned || b?.scholarshipMentioned) });
    for (const entry of rejected) rejectedCosts.push({ feeId: group.feeId, ...entry });
  }
  const report = { builtFor: baseRef, universities: rowsByUid.size, excluded: [], merged: [], created: [], skippedRows: [], blankedCells: [], rowsMatchedToExisting: [], rejectedCosts, droppedCosts: [], costRows: 0 };
  const cardsByKey = new Map(base.map((card) => [card.key, card]));
  const newCards = [], links = {}, newLinks = {}, trace = [], costRows = [];
  for (const [uid, rows] of [...rowsByUid.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const excludedReason = input.overrides.excludeUids?.[uid] ?? identityProblem(idByUid.get(uid));
    if (excludedReason) { report.excluded.push({ uid, rows: rows.length, why: excludedReason }); continue; }
    const rec = idByUid.get(uid);
    const existing = rec.crmMatch ? baseByName.get(rec.crmMatch) : null;
    if (rec.crmMatch && !existing) throw new Error(`${uid}: crmMatch ${rec.crmMatch} is not a card of ${baseRef}`);
    const sourceUrl = rec.admissionsUrl && /^https:\/\//u.test(rec.admissionsUrl) ? rec.admissionsUrl : rec.websiteUrl;
    const scholarshipByRow = new Map(rows.map((row) => [row.row, acceptedByFee.get(feeByRow.get(row.row))?.scholarship === true]));
    const built = programmesForRows(rows, { majors: input.majors, overrides: input.overrides, sourceUrl: existing ? existing.content.sourceUrl : sourceUrl, scholarshipByRow });
    report.skippedRows.push(...built.skipped.map((entry) => ({ uid, ...entry })));
    report.blankedCells.push(...built.blanked.map((entry) => ({ uid, ...entry })));
    if (built.programmes.length === 0) { report.excluded.push({ uid, rows: rows.length, why: "no programmes after cleaning" }); continue; }
    let card, key;
    if (existing) {
      const merged = mergeIntoExisting(existing.content, built.programmes.map((entry) => ({ ...entry.programme, languageIso: entry.languageIso })));
      key = existing.key;
      card = { key, content: merged.content };
      report.merged.push({ uid, key, added: merged.added, offered: built.programmes.length });
      cardsByKey.set(key, card);
      // Trace only the programmes that were really added (under their final ids); rows of a programme the card already had are listed apart.
      built.trace = built.trace.filter((entry) => merged.idMap.has(entry.programId)).map((entry) => ({ ...entry, programId: merged.idMap.get(entry.programId) }));
      report.rowsMatchedToExisting.push(...built.programmes.filter((entry) => merged.skipped.includes(entry.programme.id)).map((entry) => ({ uid, key, rows: entry.rows })));
    } else {
      key = slugify(rec.nameEn);
      if (cardsByKey.has(key) || newCards.some((entry) => entry.key === key)) throw new Error(`duplicate card key ${key}`);
      // Identity in the database is country plus the name without case and extra spaces: a repeat would publish into an existing card.
      const identity = collapse(rec.nameEn).toLowerCase();
      if ([...base, ...newCards].some((card) => collapse(card.content.name).toLowerCase() === identity)) {
        throw new Error(`${uid}: ${rec.nameEn} repeats an existing card name; set crmMatch or fix the name`);
      }
      const programs = built.programmes.map((entry) => entry.programme);
      const overview = `${collapse(rec.overviewRu)} ${programmesSentence(programs)}`;
      card = { key, content: {
        name: rec.nameEn, country: "CN", city: rec.cityRu, overview, websiteUrl: rec.websiteUrl, sourceUrl,
        verifiedOn, notes: CARD_NOTES, photoKey: null, programs,
      } };
      newCards.push(card);
      if (EXISTING_CITY_KEYS.includes(rec.cityKey)) links[key] = rec.cityKey; else newLinks[key] = rec.cityKey;
      report.created.push({ uid, key, programmes: programs.length, cityKey: rec.cityKey, linked: key in links });
    }
    const parsed = parseUniversityContent(card.content);
    if (JSON.stringify(parsed) !== JSON.stringify(card.content)) throw new Error(`card ${key} does not survive parseUniversityContent`);
    const usedIds = new Set(card.content.programs.map((program) => program.id));
    for (const entry of built.trace) if (usedIds.has(entry.programId)) trace.push({ card: key, ...entry });
    const groups = input.feeGroups.filter((group) => group.uid === uid).map((group) => ({ feeId: group.feeId, accepted: acceptedByFee.get(group.feeId).accepted }));
    const live = existing ? input.liveCosts.filter((row) => row.institution === existing.content.name) : [];
    const costs = buildCostRows({
      cardKey: key, institutionName: card.content.name, groups, existingPublished: live,
      programmeLanguages: new Set(built.programmes.map((entry) => entry.languageIso).filter(Boolean)),
    });
    costRows.push(...costs.rows);
    report.droppedCosts.push(...costs.dropped.map((entry) => ({ uid, ...entry })));
  }
  newCards.sort((a, b) => a.content.name.localeCompare(b.content.name, "en"));
  const cards = [...base.map((card) => cardsByKey.get(card.key)), ...newCards];
  costRows.sort((a, b) => a.importKey.localeCompare(b.importKey, "en"));
  report.costRows = costRows.length;
  report.cards = cards.length;
  return { cards, links, newLinks, trace, costs: { schemaVersion: 1, rows: costRows, fxRates: [] }, report };
}

/** Таблица источников для docs/catalog/china-2026-11-sources.md: только публичные адреса и счётчики, без сырых строк таблицы. */
export function evidenceMarkdown({ result, identities, rows, verifiedOn }) {
  const byUid = new Map(identities.map((rec) => [rec.uid, rec]));
  const costsByCard = new Map();
  for (const row of result.costs.rows) costsByCard.set(row.importKey.split(":")[1], (costsByCard.get(row.importKey.split(":")[1]) ?? 0) + 1);
  const lines = [];
  const out = (text = "") => lines.push(text);
  const report = result.report;
  const tableProgrammes = result.trace.length;
  out("# Китай: источники карточек и программ (рабочая таблица EVO, 19.11.2026)");
  out();
  out(`Карточки собраны \`${verifiedOn}\` для \`src/lib/server/university-catalog-reviewed-china.json\` скриптом \`scripts/catalog/china-2026-11-build.mjs\`. Личность вуза (название, город, официальный сайт, год основания, тип) проверена по официальным источникам и Wikidata/Wikipedia; перечень программ, языки, месяцы набора и ориентировочные суммы взяты из рабочей таблицы EVO (\`Новая таблица(6).xlsx\`, файл от 2026-01-16, SHA-256 \`4c8c6ee36c84feb0c68c0dbb8b353680ce637e70a80f97073f1f7e434117163c\`, ${rows.length} строк-программ). Программы по отдельности с сайтами вузов не сверялись: у программ указана общая страница вуза. Фото вузов не добавлялись.`);
  out();
  out(`Итого: ${report.created.length} новых карточек, ${report.merged.length} прежних карточек получили программы из таблицы, ${report.excluded.length} вузов таблицы не опубликованы (ниже), программ из таблицы ${tableProgrammes}, строк стоимости ${report.costRows}, пропущено строк таблицы ${report.skippedRows.length}.`);
  out();
  out("## Новые карточки");
  out();
  out("| Карточка | Город | Программ | Строк стоимости | Официальный сайт | Источники личности |");
  out("|---|---|---|---|---|---|");
  for (const created of [...report.created].sort((a, b) => a.key.localeCompare(b.key))) {
    const rec = byUid.get(created.uid);
    const sources = (rec.sources ?? []).filter((url) => /^https:\/\//u.test(url)).slice(0, 2).join(" ");
    out(`| ${rec.nameEn} | ${rec.cityEn ?? rec.cityRu} | ${created.programmes} | ${costsByCard.get(created.key) ?? 0} | ${rec.websiteUrl} | ${sources} |`);
  }
  out();
  out("## Прежние карточки, получившие программы из таблицы");
  out();
  out("| Карточка | Добавлено программ | Из таблицы предложено | Строк стоимости |");
  out("|---|---|---|---|");
  for (const merged of [...report.merged].sort((a, b) => a.key.localeCompare(b.key))) {
    out(`| ${byUid.get(merged.uid).nameEn} | ${merged.added} | ${merged.offered} | ${costsByCard.get(merged.key) ?? 0} |`);
  }
  out();
  out("## Не опубликовано");
  out();
  out("| Вуз в таблице | Строк | Причина |");
  out("|---|---|---|");
  for (const excluded of report.excluded) {
    const first = rows.find((row) => row.uid === excluded.uid);
    out(`| ${first?.nameEn || excluded.uid} (${first?.location ?? ""}) | ${excluded.rows} | ${excluded.why} |`);
  }
  out();
  out("## Что не проверено");
  out();
  out("- Названия, языки и месяцы набора программ взяты из таблицы EVO и не сверялись постранично с сайтами вузов.");
  out("- Суммы это условия таблицы на набор 2026; часть текстов платы называет сумму «после стипендии», такие суммы за обучение не внесены. Бесплатное обучение и размер стипендии суммами не записаны.");
  out("- Сроки подачи 2026 прошли; даты следующего набора не придуманы.");
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback = null) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
  const workDir = option("--work-dir");
  if (!workDir) { process.stderr.write("Usage: node scripts/catalog/china-2026-11-build.mjs --work-dir DIR [--base-ref origin/main] [--verified-on YYYY-MM-DD] [--write]\n"); process.exit(1); }
  const result = build({ workDir: resolve(workDir), baseRef: option("--base-ref", "origin/main"), verifiedOn: option("--verified-on", new Date().toISOString().slice(0, 10)) });
  const summary = { cards: result.report.cards, created: result.report.created.length, merged: result.report.merged.length, excluded: result.report.excluded.length,
    costRows: result.report.costRows, links: Object.keys(result.links).length, newCityLinks: Object.keys(result.newLinks).length, skippedRows: result.report.skippedRows.length };
  if (args.includes("--write")) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(resolve(ROOT, REVIEWED_PATH), `${JSON.stringify(result.cards, null, 2)}\n`);
    writeFileSync(resolve(DATA_DIR, "programme-costs.json"), `${JSON.stringify(result.costs, null, 2)}\n`);
    writeFileSync(resolve(DATA_DIR, "city-links.json"), `${JSON.stringify(result.links, null, 2)}\n`);
    writeFileSync(resolve(DATA_DIR, "city-links-new.json"), `${JSON.stringify(result.newLinks, null, 2)}\n`);
    writeFileSync(resolve(DATA_DIR, "programme-trace.json"), `${JSON.stringify(result.trace)}\n`);
    const verifiedOn = option("--verified-on", new Date().toISOString().slice(0, 10));
    const input = loadWorkDir(resolve(workDir));
    writeFileSync(resolve(ROOT, "docs/catalog/china-2026-11-sources.md"), evidenceMarkdown({ result, identities: input.identities, rows: input.rows, verifiedOn }));
  }
  writeFileSync(resolve(workDir, "build-report.json"), `${JSON.stringify(result.report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ mode: args.includes("--write") ? "written" : "dry run", ...summary }, null, 2)}\n`);
}
