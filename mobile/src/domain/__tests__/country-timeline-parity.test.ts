// Паритет «Пути поступления»: файл сверки country-timeline-parity.json пишет скрипт
// веба (scripts/portal/write-country-timeline-ios-parity.mjs) и им же проверяют iPhone.
// Здесь тот же отпечаток считает приложение из тех же файлов контента через тот же
// разбор, который собирает Metro (@web), и сверяет с файлом.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { COUNTRY_TIMELINES, COUNTRY_TIMELINE_FILE_KEYS, selectCountryTimeline, type CountryTimelineView } from "@web/lib/portal/country-timeline";
import { TIMELINE_MODULE_ROUTES } from "@web/lib/portal/timeline-module-routes";

type ParityCase = {
  choice: string;
  locale: string;
  today: string;
  modules: Record<string, string> | null;
  kind: string;
  file: string;
  datesHidden: boolean;
  steps: number;
  items: number;
  sha256: string;
};
type Fixture = { files: Record<string, { contentVersion: number; validUntil: string; sha256: string }>; cases: ParityCase[] };

const FIXTURE_PATH = path.join(__dirname, "fixtures", "country-timeline-parity.json");
const IOS_FIXTURE_PATH = path.join(__dirname, "../../../../ios/EVOAdmissionsTests/Fixtures/country-timeline-parity.json");
const CONTENT_DIR = path.join(__dirname, "../../../../src/content/timelines");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

const NUL = "\u0000";
const SEP = "\u001f";
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const n = (value: string | null) => (value === null ? NUL : value);
const flag = (value: boolean) => (value ? "1" : "0");

/** Все поля выдачи по порядку, как в скрипте веба и в CountryTimelineTests.swift. */
function canonicalTimelineView(view: CountryTimelineView): string {
  return [
    view.choice, view.kind, n(view.countryCode), n(view.countryName), view.file, String(view.contentVersion),
    flag(view.datesHidden), view.intake.label, n(view.intake.note), String(view.steps.length),
    ...view.steps.flatMap((step) => [
      step.id, String(step.order), step.stageKeys.join(","), step.title, step.summary, n(step.timing), n(step.note),
      step.doneWhen, String(step.items.length),
      ...step.items.flatMap((item) => [item.id, item.who, item.whoLabel, item.text, n(item.note), n(item.appliesTo)]),
      String(step.links.length),
      ...step.links.flatMap((link) => [link.id, link.label, link.href, flag(link.external)]),
    ]),
    ...view.disclaimers,
    flag(view.kyNeedsProofreading),
  ].join(SEP);
}

describe("файл сверки пути поступления", () => {
  it("копия в приложении совпадает с файлом iPhone, пока ios/ в репозитории", () => {
    if (!existsSync(IOS_FIXTURE_PATH)) return;
    expect(readFileSync(FIXTURE_PATH, "utf8")).toBe(readFileSync(IOS_FIXTURE_PATH, "utf8"));
  });

  it("файлы контента: те же байты, версия и срок", () => {
    expect(Object.keys(fixture.files)).toEqual([...COUNTRY_TIMELINE_FILE_KEYS]);
    for (const key of COUNTRY_TIMELINE_FILE_KEYS) {
      const entry = fixture.files[key];
      expect(sha256(readFileSync(path.join(CONTENT_DIR, `${key}.json`)))).toBe(entry.sha256);
      expect(COUNTRY_TIMELINES[key].contentVersion).toBe(entry.contentVersion);
      expect(COUNTRY_TIMELINES[key].validUntil).toBe(entry.validUntil);
    }
  });

  it("46 случаев: выбор, язык, дата и карта модулей дают те же отпечатки", () => {
    expect(fixture.cases).toHaveLength(46);
    const withRealMap = fixture.cases.filter((entry) => entry.modules?.csca === TIMELINE_MODULE_ROUTES.csca);
    expect(withRealMap.map((entry) => entry.locale)).toEqual(["ru", "ky"]);
    for (const entry of fixture.cases) {
      const view = selectCountryTimeline(entry.choice, {
        locale: entry.locale,
        today: entry.today,
        ...(entry.modules ? { modules: entry.modules } : {}),
      });
      const label = `${entry.choice} ${entry.locale} ${entry.today} ${JSON.stringify(entry.modules)}`;
      expect(view).not.toBeNull();
      if (!view) continue;
      expect([label, view.kind, view.file, view.datesHidden, view.steps.length]).toEqual([label, entry.kind, entry.file, entry.datesHidden, entry.steps]);
      expect([label, view.steps.reduce((sum, step) => sum + step.items.length, 0)]).toEqual([label, entry.items]);
      expect([label, sha256(Buffer.from(canonicalTimelineView(view), "utf8"))]).toEqual([label, entry.sha256]);
    }
  });

  it("даты прячутся на следующий день после validUntil, в сам день остаются", () => {
    for (const entry of fixture.cases) {
      expect(entry.datesHidden).toBe(entry.today > fixture.files[entry.file].validUntil);
    }
  });
});
