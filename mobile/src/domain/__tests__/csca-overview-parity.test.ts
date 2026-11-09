// Паритет обзора экзамена CSCA: файл csca-overview-parity.json пишет скрипт веба
// (scripts/portal/write-csca-overview-ios-parity.mjs), iPhone проверяет им свой порт.
// Приложение берёт разбор из веба как есть, поэтому тест пересчитывает отпечатки,
// решения по 81 правке файлов и правило «открыт или свёрнут» и сверяет с файлом.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  CSCA_EVO_STATUSES,
  CSCA_OVERVIEW,
  CSCA_OVERVIEW_PHOTOS,
  CSCA_SUBJECT_FACT_KEYS,
  cscaGroupFacts,
  cscaSubjectFacts,
  parseCscaOverview,
  parseCscaOverviewPhotos,
  type CscaOverview,
  type CscaOverviewGroup,
  type CscaPhoto,
} from "@web/lib/portal/csca-overview";
import { cscaOverviewOpen, parseCscaOverviewChoice } from "@web/lib/portal/csca-overview-choice";

type Op = { op: "set" | "delete" | "copy"; path: (string | number)[]; value?: unknown; from?: (string | number)[] };
type Vector = { id: string; file: "overview" | "photos"; ops: Op[]; expect: string };
type Fixture = {
  files: Record<string, { sha256: string }>;
  overview: { contentVersion: number; sha256: string };
  photos: { keys: string[]; sha256: string };
  views: { case: "groups" | "mixed"; locale: "ru" | "ky"; sha256: string }[];
  choice: { parse: [string | null, string | null][]; open: [string | null, boolean, boolean][] };
  vectors: Vector[];
};

const FIXTURE_PATH = path.join(__dirname, "fixtures", "csca-overview-parity.json");
const IOS_FIXTURE_PATH = path.join(__dirname, "../../../../ios/EVOAdmissionsTests/Fixtures/csca-overview-parity.json");
const CONTENT = (name: string) => path.join(__dirname, "../../../../src/content/csca", name);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

const NUL = "\u0000";
const SEP = "\u001f";
const COLUMNS = ["subject", "language", "duration", "questions", "scoreRange", "evo"] as const;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fingerprint = (fields: readonly (string | number | null)[]) =>
  sha256(Buffer.from(fields.map((field) => (field === null ? NUL : String(field))).join(SEP), "utf8"));
const pair = (text: { ru: string; ky: string }) => [text.ru, text.ky];

function canonicalOverview(o: CscaOverview): (string | number | null)[] {
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

function canonicalPhotos(photos: readonly CscaPhoto[]): (string | number | null)[] {
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

const facts = (list: readonly { key: string; label: string; value: string }[]) => [
  list.length,
  ...list.flatMap((fact) => [fact.key, fact.label, fact.value]),
];

function canonicalSubjectView(o: CscaOverview, groups: readonly CscaOverviewGroup[], locale: "ru" | "ky"): (string | number | null)[] {
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

/** Группа, у предметов которой время разное (тест веба). */
function mixedGroup(o: CscaOverview): CscaOverviewGroup {
  const [group] = o.subjects.groups;
  return { ...group, subjects: [group.subjects[0], { ...group.subjects[1], minutes: 75 }] };
}

type Json = Record<string | number, unknown> | unknown[];
const at = (root: Json, route: readonly (string | number)[]): Json => route.reduce<Json>((node, step) => (node as Record<string | number, Json>)[step], root);

function applyOps(raw: unknown, ops: readonly Op[]): unknown {
  const copyOf = structuredClone(raw) as Json;
  for (const op of ops) {
    const parent = at(copyOf, op.path.slice(0, -1));
    const last = op.path[op.path.length - 1];
    if (op.op === "set") (parent as Record<string | number, unknown>)[last] = structuredClone(op.value);
    else if (op.op === "copy") (parent as Record<string | number, unknown>)[last] = structuredClone(at(copyOf, op.from ?? []));
    else if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete (parent as Record<string, unknown>)[String(last)];
  }
  return copyOf;
}

/**
 * Babel приложения переписывает литералы с флагом `u` в экранированный вид, поэтому в тексте
 * «forbidden wording /…/» меняется только запись регулярного выражения: сравниваем до неё.
 */
const comparable = (message: string): string => message.replace(/(forbidden wording) \/.*$/, "$1");

const readJson = (name: string): unknown => JSON.parse(readFileSync(CONTENT(name), "utf8"));

function decision(vector: Vector): string {
  try {
    if (vector.file === "photos") {
      parseCscaOverviewPhotos(applyOps(readJson("photos.json"), vector.ops));
    } else {
      const keys = new Set(parseCscaOverviewPhotos(readJson("photos.json")).map((photo) => photo.key));
      parseCscaOverview(applyOps(readJson("overview.json"), vector.ops), keys);
    }
    return "accept";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("файл сверки обзора CSCA", () => {
  it("копия в приложении совпадает с файлом iPhone, пока ios/ в репозитории", () => {
    if (!existsSync(IOS_FIXTURE_PATH)) return;
    expect(readFileSync(FIXTURE_PATH, "utf8")).toBe(readFileSync(IOS_FIXTURE_PATH, "utf8"));
  });

  it("сырые файлы: те же байты", () => {
    for (const [name, entry] of Object.entries(fixture.files)) expect(sha256(readFileSync(CONTENT(name)))).toBe(entry.sha256);
  });

  it("разобранный обзор и манифест фото дают те же отпечатки", () => {
    expect(CSCA_OVERVIEW.contentVersion).toBe(fixture.overview.contentVersion);
    expect(fingerprint(canonicalOverview(CSCA_OVERVIEW))).toBe(fixture.overview.sha256);
    expect(CSCA_OVERVIEW_PHOTOS.map((photo) => photo.key)).toEqual(fixture.photos.keys);
    expect(fingerprint(canonicalPhotos(CSCA_OVERVIEW_PHOTOS))).toBe(fixture.photos.sha256);
  });

  it("подписи предметов на RU и KY, в том числе группа с разным временем", () => {
    expect(fixture.views).toHaveLength(4);
    for (const view of fixture.views) {
      const groups = view.case === "groups" ? CSCA_OVERVIEW.subjects.groups : [mixedGroup(CSCA_OVERVIEW)];
      expect([view.case, view.locale, fingerprint(canonicalSubjectView(CSCA_OVERVIEW, groups, view.locale))]).toEqual([view.case, view.locale, view.sha256]);
    }
  });

  it("выбор «открыт или свёрнут»: разбор значения и правило", () => {
    for (const [value, expected] of fixture.choice.parse) expect([value, parseCscaOverviewChoice(value)]).toEqual([value, expected]);
    for (const [choice, started, expected] of fixture.choice.open) {
      expect([choice, started, cscaOverviewOpen(choice as "open" | "closed" | null, started)]).toEqual([choice, started, expected]);
    }
  });

  it("81 правка файлов: приложение принимает и отклоняет ровно как веб", () => {
    expect(fixture.vectors).toHaveLength(81);
    for (const vector of fixture.vectors) expect([vector.id, comparable(decision(vector))]).toEqual([vector.id, comparable(vector.expect)]);
  });
});
