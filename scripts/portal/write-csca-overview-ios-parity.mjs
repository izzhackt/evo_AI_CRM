/**
 * Паритет обзора экзамена CSCA веба и iPhone (контракт
 * docs/portal/csca-contract.md §19). Тот же приём, что у «Пути поступления»
 * (scripts/portal/write-country-timeline-ios-parity.mjs).
 *
 * Пишет ios/EVOAdmissionsTests/Fixtures/csca-overview-parity.json:
 * - SHA-256 сырых src/content/csca/overview.json и photos.json, так что
 *   фикстура привязана к байтам файлов;
 * - отпечатки SHA-256 разобранного обзора, манифеста фото и подписей
 *   предметов (`cscaGroupFacts`, `cscaSubjectFacts`) на RU и KY: все поля по
 *   порядку, соединённые U+001F (null это U+0000);
 * - варианты файлов (правки по пути в JSON) и решение веба по каждому:
 *   принят или текст ошибки `parseCscaOverview` / `parseCscaOverviewPhotos`;
 * - правило «открыт или свёрнут» (`parseCscaOverviewChoice`, `cscaOverviewOpen`).
 * `CSCAOverviewTests` на iPhone применяет те же правки к тем же файлам bundle
 * своим портом и сравнивает решения и отпечатки.
 *
 * После правки src/content/csca/*.json или парсера:
 *   node --experimental-strip-types scripts/portal/write-csca-overview-ios-parity.mjs
 * Проверка без записи (код выхода 1, если файл устарел; её же вызывает
 * tests/portal-csca-overview-ios-parity.test.mjs):
 *   node --experimental-strip-types scripts/portal/write-csca-overview-ios-parity.mjs --check
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CSCA_OVERVIEW,
  CSCA_OVERVIEW_PHOTOS,
  CSCA_SUBJECT_FACT_KEYS,
  CSCA_EVO_STATUSES,
  cscaGroupFacts,
  cscaSubjectFacts,
  parseCscaOverview,
  parseCscaOverviewPhotos,
} from "../../src/lib/portal/csca-overview.ts";
import { cscaOverviewOpen, parseCscaOverviewChoice } from "../../src/lib/portal/csca-overview-choice.ts";

export const PARITY_FIXTURE = new URL("../../ios/EVOAdmissionsTests/Fixtures/csca-overview-parity.json", import.meta.url);
const CONTENT = (name) => new URL(`../../src/content/csca/${name}`, import.meta.url);
const NUL = "\u0000";
const SEP = "\u001f";
const COLUMNS = ["subject", "language", "duration", "questions", "scoreRange", "evo"];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fingerprint = (fields) => sha256(Buffer.from(fields.map((field) => (field === null ? NUL : String(field))).join(SEP), "utf8"));
const pair = (text) => [text.ru, text.ky];

/** Все поля разобранного обзора по порядку; тот же порядок в CSCAOverviewTests.swift. */
export function canonicalOverview(o) {
  return [
    o.schemaVersion, o.contentVersion, o.confirmedOn, o.kyStatus,
    o.exam.short, o.exam.nameEn, o.exam.subjectsTotal, o.exam.universitiesTotal,
    ...pair(o.summary), o.intro.length, ...o.intro.flatMap(pair),
    ...pair(o.audience.title), ...pair(o.audience.needed.label), ...pair(o.audience.needed.text),
    ...pair(o.audience.notNeeded.label), ...pair(o.audience.notNeeded.text),
    ...pair(o.subjects.title), ...COLUMNS.flatMap((name) => pair(o.subjects.columns[name])),
    ...pair(o.subjects.formats.minutes), ...pair(o.subjects.formats.scoreRange),
    ...CSCA_EVO_STATUSES.flatMap((status) => pair(o.subjects.evoStatus[status])),
    o.subjects.groups.length,
    ...o.subjects.groups.flatMap((group) => [
      group.key, group.nameEn, ...pair(group.name), group.subjects.length,
      ...group.subjects.flatMap((subject) => [
        subject.key, subject.nameEn, ...(subject.name ? pair(subject.name) : [null, null]), ...pair(subject.language),
        subject.minutes, subject.questions, subject.scoreMin, subject.scoreMax, subject.evo,
      ]),
    ]),
    ...pair(o.fees.title), o.fees.currency, ...pair(o.fees.columns.subjects), ...pair(o.fees.columns.fee), o.fees.rows.length,
    ...o.fees.rows.flatMap((row) => [row.key, ...pair(row.label), row.minSubjects, row.maxSubjects, row.fee]),
    ...pair(o.faq.title), o.faq.items.length,
    ...o.faq.items.flatMap((item) => [
      item.id, ...pair(item.question), item.answer.length, ...item.answer.flatMap(pair),
      ...(item.link ? [item.link.target, ...pair(item.link.label), ...pair(item.link.withoutSessions)] : [null]),
    ]),
    o.photos.hero, o.photos.audience, o.sources.length,
    ...o.sources.flatMap((source) => [source.id, source.kind, source.title, source.checkedOn, source.omitted ?? null]),
  ];
}

/** Все поля манифеста фото по порядку. */
export function canonicalPhotos(photos) {
  return [
    photos.length,
    ...photos.flatMap((photo) => [
      photo.key, ...pair(photo.alt), photo.author, photo.authorUrl, photo.sourceName, photo.sourceUrl, photo.sourceTitle,
      photo.licence, photo.licenceUrl, photo.attributionRequired ? "1" : "0", photo.uploadedOn, photo.fetchedOn,
      photo.objectPosition, photo.files.length,
      ...photo.files.flatMap((file) => [file.path, file.format, file.width, file.height, file.bytes, file.sha256]),
    ]),
  ];
}

const facts = (list) => [list.length, ...list.flatMap((fact) => [fact.key, fact.label, fact.value])];

/** Подписи предметов на языке студента: общие факты группы и факты каждого предмета. */
export function canonicalSubjectView(o, groups, locale) {
  return [
    CSCA_SUBJECT_FACT_KEYS.join(","),
    ...groups.flatMap((group) => {
      const grouped = cscaGroupFacts(o, group, locale);
      return [
        group.key, ...facts(grouped.shared),
        ...group.subjects.flatMap((subject) => [
          subject.key, ...facts(cscaSubjectFacts(o, subject, locale)), ...facts(grouped.bySubject[subject.key] ?? []),
        ]),
      ];
    }),
  ];
}

/** Группа, у предметов которой время разное (тест веба): этот факт остаётся у предмета. */
export function mixedGroup(o) {
  const [group] = o.subjects.groups;
  return { ...group, subjects: [group.subjects[0], { ...group.subjects[1], minutes: 75 }] };
}

// ---------------------------------------------------------------------------
// Варианты файлов. Правка: `set` (значение по пути), `delete` (ключ или
// элемент по пути), `copy` (копия значения `from` по пути `path`; индекс,
// равный длине массива, добавляет в конец).
// ---------------------------------------------------------------------------

const set = (path, value) => ({ op: "set", path, value });
const del = (path) => ({ op: "delete", path });
const copy = (from, path) => ({ op: "copy", from, path });

export const VECTORS = Object.freeze([
  // Обзор: правила текста.
  ["overview", "em dash", [set(["intro", 0, "ru"], "CSCA \u2014 новый тест.")]],
  ["overview", "en dash in KY", [set(["intro", 0, "ky"], "CSCA \u2013 жаңы тест.")]],
  ["overview", "minus sign", [set(["intro", 1, "ru"], "Баллы от \u22121 до 100.")]],
  ["overview", "KY guarantee", [set(["audience", "needed", "text", "ky"], "CSCнын 306 университети кепилдик берет.")]],
  ["overview", "100 % with a no-break space", [set(["intro", 0, "ru"], "Тест на 100\u00a0% готовности.")]],
  ["overview", "partner", [set(["intro", 0, "ru"], "EVO партнёр CSC.")]],
  ["overview", "Official Partner in KY", [set(["intro", 2, "ky"], "EVO Official Partner.")]],
  ["overview", "passing score", [set(["intro", 0, "ru"], "Проходной балл не нужен.")]],
  ["overview", "percentile", [set(["intro", 0, "ru"], "Перцентиль не считается.")]],
  ["overview", "guarantee in withoutSessions", [set(["faq", "items", 1, "link", "withoutSessions", "ru"], "Гарантируем места.")]],
  ["overview", "year in an answer", [set(["faq", "items", 1, "answer", 0, "ru"], "Регистрация до 14 февраля 2026.")]],
  ["overview", "dotted date", [set(["intro", 0, "ru"], "Сессия 21.12.25 прошла.")]],
  ["overview", "year in KY", [set(["faq", "items", 0, "answer", 0, "ky"], "2027-жылы тапшырышат.")]],
  ["overview", "digit groups with a plain space", [set(["intro", 0, "ru"], "Тест для 1 200 абитуриентов.")]],
  ["overview", "digit groups with U+00A0", [set(["intro", 0, "ru"], "Тест для 1\u00a0200 абитуриентов.")]],
  ["overview", "digit groups with U+202F", [set(["intro", 0, "ru"], "Тест для 1\u202f200 абитуриентов.")]],
  ["overview", "mixed script word", [set(["intro", 0, "ru"], "Новый тестCSCA.")]],
  ["overview", "Latin word with a Kyrgyz ending", [set(["intro", 0, "ky"], "CSCAнын жаңы тести.")]],
  ["overview", "leading space", [set(["intro", 0, "ru"], " Новый тест.")]],
  ["overview", "trailing U+FEFF", [set(["intro", 0, "ru"], "Новый тест.\ufeff")]],
  ["overview", "vertical tab and a space", [set(["intro", 0, "ru"], "Новый\u000b тест.")]],
  ["overview", "trailing U+0085 is not JavaScript whitespace", [set(["intro", 0, "ru"], "Новый тест.\u0085")]],
  ["overview", "empty KY summary", [set(["summary", "ky"], "")]],
  // Обзор: цифры сводки и таблиц.
  ["overview", "summary without 306", [set(["summary", "ru"], "Нужен для бакалавриата. 5 предметов, взнос 450 CNY или 700 CNY.")]],
  ["overview", "3060 is not 306", [set(["summary", "ru"], "Нужен в 3060 вузах CSC. 5 предметов, взнос 450 CNY или 700 CNY.")]],
  ["overview", "audience without 306", [set(["audience", "needed", "text", "ru"], "Бакалавриат в вузах CSC.")]],
  ["overview", "fee rows with a gap", [set(["fees", "rows", 1, "minSubjects"], 3)]],
  ["overview", "last fee row closed", [set(["fees", "rows", 1, "maxSubjects"], 5)]],
  ["overview", "fee label without its count", [set(["fees", "rows", 1, "label", "ru"], "два и больше")]],
  ["overview", "currency", [set(["fees", "currency"], "USD")]],
  ["overview", "zero fee", [set(["fees", "rows", 0, "fee"], 0)]],
  ["overview", "subjects total", [set(["exam", "subjectsTotal"], 4)]],
  ["overview", "empty score range", [set(["subjects", "groups", 1, "subjects", 0, "scoreMin"], 100)]],
  ["overview", "fractional minutes", [set(["subjects", "groups", 0, "subjects", 0, "minutes"], 90.5)]],
  ["overview", "minutes as a string", [set(["subjects", "groups", 0, "subjects", 0, "minutes"], "90")]],
  ["overview", "content version as a string", [set(["contentVersion"], "1")]],
  // Обзор: структура и словари.
  ["overview", "unknown photo", [set(["photos", "hero"], "campus-tsinghua")]],
  ["overview", "question without ?", [set(["faq", "items", 0, "question", "ru"], "Кто должен сдавать CSCA")]],
  ["overview", "unknown key", [set(["subjects", "groups", 0, "extra"], true)]],
  ["overview", "minutes template without its slot", [set(["subjects", "formats", "minutes", "ky"], "мүнөт")]],
  ["overview", "minutes template with the slot twice", [set(["subjects", "formats", "minutes", "ru"], "{n} мин {n}")]],
  ["overview", "score template with the slots swapped", [set(["subjects", "formats", "scoreRange", "ru"], "до {max} от {min}")]],
  ["overview", "agency source", [set(["sources", 0, "kind"], "agency")]],
  ["overview", "source without omitted", [del(["sources", 0, "omitted"])]],
  ["overview", "source omitted null", [set(["sources", 0, "omitted"], null)]],
  ["overview", "Cyrillic English name", [set(["subjects", "groups", 0, "subjects", 0, "nameEn"], "Гуманитарные")]],
  ["overview", "unknown EVO status", [set(["subjects", "groups", 1, "subjects", 0, "evo"], "soon")]],
  ["overview", "subject without a local name", [set(["subjects", "groups", 1, "subjects", 0, "name"], null)]],
  ["overview", "impossible date", [set(["confirmedOn"], "2026-02-30")]],
  ["overview", "schema version 2", [set(["schemaVersion"], 2)]],
  ["overview", "unknown KY status", [set(["kyStatus"], "draft")]],
  ["overview", "five intro paragraphs", [copy(["intro", 0], ["intro", 3]), copy(["intro", 0], ["intro", 4])]],
  ["overview", "empty answer", [set(["faq", "items", 0, "answer"], [])]],
  ["overview", "link to another block", [set(["faq", "items", 1, "link", "target"], "faq")]],
  ["overview", "dates answer without a link", [set(["faq", "items", 1, "link"], null)]],
  ["overview", "capital group key", [set(["subjects", "groups", 0, "key"], "Professional")]],
  ["overview", "repeated subject key", [set(["subjects", "groups", 1, "subjects", 1, "key"], "mathematics")]],
  ["overview", "missing summary", [del(["summary"])]],
  ["overview", "another exam", [set(["exam", "short"], "HSK")]],
  ["overview", "audience as a list", [set(["audience"], [])]],
  ["overview", "EVO status without later", [del(["subjects", "evoStatus", "later"])]],
  // Манифест фото.
  ["photos", "Unsplash source", [set(["photos", 0, "sourceName"], "Unsplash")]],
  ["photos", "no JPEG fallback", [del(["photos", 1, "files", 2])]],
  ["photos", "no WebP source", [
    set(["photos", 1, "files", 0], { path: "photos/campus-xiamen-480.jpg", format: "jpeg", width: 480, height: 319, bytes: 30000, sha256: "0".repeat(64) }),
    del(["photos", 1, "files", 1]),
  ]],
  ["photos", "file of another photo", [set(["photos", 0, "files", 0, "path"], "photos/campus-xiamen-240.webp")]],
  ["photos", "width differs from the name", [set(["photos", 0, "files", 0, "width"], 241)]],
  ["photos", "width with a leading zero in the name", [set(["photos", 0, "files", 0, "path"], "photos/campus-sichuan-0240.webp")]],
  ["photos", "format differs from the extension", [set(["photos", 0, "files", 0, "format"], "jpeg")]],
  ["photos", "file too large", [set(["photos", 0, "files", 0, "bytes"], 500000)]],
  ["photos", "upper-case hash", [set(["photos", 0, "files", 0, "sha256"], "87E421A3642099F95AAE46CA559A93E16032ED3AD3CB2AEAE3C84F2B51D5C102")]],
  ["photos", "object position without %", [set(["photos", 0, "objectPosition"], "50% 55")]],
  ["photos", "attribution as a string", [set(["photos", 0, "attributionRequired"], "no")]],
  ["photos", "impossible upload date", [set(["photos", 0, "uploadedOn"], "2026-13-01")]],
  ["photos", "http author page", [set(["photos", 0, "authorUrl"], "http://www.pexels.com/@oli-liao-883836674/")]],
  ["photos", "repeated photo", [copy(["photos", 0], ["photos", 2])]],
  ["photos", "repeated file", [copy(["photos", 0, "files", 0], ["photos", 0, "files", 1])]],
  ["photos", "small original", [set(["photos", 0, "original", "width"], 1000)]],
  ["photos", "unknown key", [set(["photos", 0, "extra"], 1)]],
  ["photos", "rules with a double space", [set(["rules"], "Licence  manifest.")]],
  ["photos", "alt text with an em dash", [set(["photos", 0, "alt", "ru"], "Корпус \u2014 Чэнду")]],
  ["photos", "empty people note", [set(["photos", 0, "people"], "")]],
].map(([file, id, ops]) => Object.freeze({ id, file, ops })));

function at(root, path) {
  return path.reduce((node, step) => node[step], root);
}

/** Применяет правки к копии разобранного JSON. */
export function applyOps(raw, ops) {
  const copyOf = structuredClone(raw);
  for (const op of ops) {
    const parent = at(copyOf, op.path.slice(0, -1));
    const last = op.path.at(-1);
    if (op.op === "set") parent[last] = structuredClone(op.value);
    else if (op.op === "copy") parent[last] = structuredClone(at(copyOf, op.from));
    else if (Array.isArray(parent)) parent.splice(last, 1);
    else delete parent[last];
  }
  return copyOf;
}

const readJson = (name) => JSON.parse(readFileSync(CONTENT(name), "utf8"));

/** Решение веба: "accept" или текст ошибки парсера. */
export function webDecision(vector) {
  const photos = readJson("photos.json");
  const overview = readJson("overview.json");
  try {
    if (vector.file === "photos") {
      parseCscaOverviewPhotos(applyOps(photos, vector.ops));
    } else {
      const keys = new Set(parseCscaOverviewPhotos(photos).map((photo) => photo.key));
      parseCscaOverview(applyOps(overview, vector.ops), keys);
    }
    return "accept";
  } catch (error) {
    return error.message;
  }
}

function parityFixture() {
  const o = CSCA_OVERVIEW;
  return {
    generatedBy: "scripts/portal/write-csca-overview-ios-parity.mjs",
    files: Object.fromEntries(["overview.json", "photos.json"].map((name) => [name, { sha256: sha256(readFileSync(CONTENT(name))) }])),
    overview: { contentVersion: o.contentVersion, sha256: fingerprint(canonicalOverview(o)) },
    photos: { keys: CSCA_OVERVIEW_PHOTOS.map((photo) => photo.key), sha256: fingerprint(canonicalPhotos(CSCA_OVERVIEW_PHOTOS)) },
    views: ["ru", "ky"].flatMap((locale) => [
      { case: "groups", locale, sha256: fingerprint(canonicalSubjectView(o, o.subjects.groups, locale)) },
      { case: "mixed", locale, sha256: fingerprint(canonicalSubjectView(o, [mixedGroup(o)], locale)) },
    ]),
    choice: {
      parse: ["open", "closed", "", "OPEN", "1", " open", null].map((value) => [value, parseCscaOverviewChoice(value)]),
      open: [[null, false], [null, true], ["open", true], ["open", false], ["closed", false], ["closed", true]]
        .map(([choice, started]) => [choice, started, cscaOverviewOpen(choice, started)]),
    },
    vectors: VECTORS.map((vector) => ({ ...vector, expect: webDecision(vector) })),
  };
}

/** Невидимые и тире-подобные знаки пишутся экранированными: фикстуру читает человек. */
const VISIBLE = /[\u0085\u00a0\u2010-\u2015\u2028\u2029\u202f\u2212\ufeff]/gu;

/** Ожидаемый текст фикстуры для текущих файлов и парсера. */
export function parityFixtureText() {
  return `${JSON.stringify(parityFixture(), null, 2)}\n`
    .replace(VISIBLE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = parityFixtureText();
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(PARITY_FIXTURE, "utf8"); } catch { /* нет файла: устарел */ }
    if (current !== text) {
      console.error("csca-overview-parity.json is stale: run this script without --check");
      process.exit(1);
    }
    console.log("csca-overview-parity.json is current");
  } else {
    writeFileSync(PARITY_FIXTURE, text);
    console.log(`wrote ${fileURLToPath(PARITY_FIXTURE)}`);
  }
}
