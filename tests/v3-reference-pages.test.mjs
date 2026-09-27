import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { UNIVERSITY_PHOTOS, universityIntakeLabel } from "../src/lib/platform-university-catalog.ts";
import {
  UNIVERSITY_PAGE_SIZE,
  catalogueDueWord,
  catalogueServerPage,
  catalogueSortedPage,
  formatCatalogueDay,
  intakeDeadlineView,
  intakeStartView,
  intakeStateLabel,
  photoAuthorRu,
  photoLicenseRu,
  programsWord,
  shownIntakes,
  sortCatalogueRows,
} from "../src/lib/v3/university-view.ts";

/**
 * Э6 плана редизайна (27.09.2026) — справочные и служебные страницы:
 * «Университеты» таблицей со сроками, «Настройки» с одной таблицей
 * интеграций, постоянные места в меню. Чистые правила — напрямую; страницы —
 * настоящим рендером `tests/e2e/reference-static-render.cjs --json`
 * (синтетические сотрудники и состояние сервисов, каталог — проверенные
 * шаблоны карточек репозитория), без живого backend.
 */

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// Суббота 27.09.2026, 10:00 по Бишкеку.
const NOW = new Date("2026-09-27T04:00:00.000Z");

let sequence = 0;
function intake(fields = {}) {
  return {
    label: "Набор", startDate: null, startMonth: null, applicationDeadline: null, deadlineTime: null, timezone: "Asia/Shanghai",
    status: "open", note: "", sourceUrl: "https://example.org/intake", verifiedOn: "2026-09-10", ...fields,
  };
}
function university(name, programs) {
  sequence += 1;
  return {
    id: `57ce9b97-43fb-4563-9c61-${String(sequence).padStart(12, "0")}`, version: 1, publishedAt: "2026-09-10T00:00:00+00:00",
    content: {
      name, country: "CN", city: null, overview: "Описание.", websiteUrl: "https://example.org", sourceUrl: "https://example.org/source",
      verifiedOn: "2026-09-10", notes: "", photoKey: null,
      programs: programs.map(([level, intakes], index) => ({
        id: `p-${index}`, title: `Программа ${index + 1}`, level, duration: null, language: null, summary: "Кратко.",
        sourceUrl: "https://example.org/program", intakes,
      })),
    },
  };
}

/* ------------------------------------------------------------ Каталог */

test("catalogue order: the nearest verified deadline first, then the name — across the whole catalogue", () => {
  const later = university("Альфа", [["bachelor", [intake({ applicationDeadline: "2026-11-30" })]]]);
  const sooner = university("Яблоко", [["master", [intake({ applicationDeadline: "2026-10-15" })]]]);
  const passed = university("Бета", [["bachelor", [intake({ applicationDeadline: "2026-09-01" })]]]);
  const unverified = university("Гамма", [["bachelor", [intake({ applicationDeadline: "2026-10-01", status: "needs_reconfirmation" })]]]);
  const none = university("Аист", [["bachelor", []]]);
  const rows = sortCatalogueRows([none, passed, later, unverified, sooner], "", NOW);
  assert.deepEqual(rows.map((row) => row.university.content.name), ["Яблоко", "Альфа", "Аист", "Бета", "Гамма"],
    "deadlines first; a passed or unconfirmed deadline is no deadline; the rest by name");
  assert.deepEqual(rows[0].deadline, {
    dateTime: "2026-10-15", text: "15.10", timezone: "Asia/Shanghai", word: { text: "через 18 дн", tone: "upcoming" },
    program: "Программа 1", intake: "Набор", verifiedOn: "2026-09-10", sameDateCount: 0,
  });
  // The level filter picks the deadline of that level only.
  const byLevel = sortCatalogueRows([later, sooner], "bachelor", NOW);
  assert.deepEqual(byLevel.map((row) => [row.university.content.name, row.deadline?.dateTime ?? null]), [["Альфа", "2026-11-30"], ["Яблоко", null]]);
});

test("catalogue pages: honest «N–M из K» from the complete read, none from the name-ordered server page", () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({ university: university(`В${index}`, [["bachelor", []]]), deadline: null }));
  assert.equal(UNIVERSITY_PAGE_SIZE, 30);
  assert.deepEqual({ ...catalogueSortedPage(rows, 0), rows: undefined }, { rows: undefined, total: 65, first: 1, last: 30, previousOffset: null, nextOffset: 30, order: "deadline" });
  assert.deepEqual({ ...catalogueSortedPage(rows, 60), rows: undefined }, { rows: undefined, total: 65, first: 61, last: 65, previousOffset: 30, nextOffset: null, order: "deadline" });
  // An address past the end is an empty page whose «Назад» leads to the last real page.
  const past = catalogueSortedPage(rows, 300);
  assert.equal(past.rows.length, 0);
  assert.equal(past.first, 0);
  assert.equal(past.previousOffset, 60);
  const server = catalogueServerPage(rows.slice(0, 30).map((row) => row.university), 30, 60, "", NOW);
  assert.equal(server.total, null, "no total without the complete read");
  assert.equal(server.order, "name");
  assert.deepEqual([server.first, server.last, server.previousOffset, server.nextOffset], [31, 60, 0, 60]);
});

test("dates and words: dense day, year only when not current, the deadline word, the intake state", () => {
  assert.equal(formatCatalogueDay("2026-10-15", "2026-09-27"), "15.10");
  assert.equal(formatCatalogueDay("2027-01-15", "2026-09-27"), "15.01.27");
  assert.deepEqual(catalogueDueWord("2026-09-27", "2026-09-27"), { text: "сегодня", tone: "today" });
  assert.deepEqual(catalogueDueWord("2026-09-28", "2026-09-27"), { text: "завтра", tone: "upcoming" });
  assert.equal(catalogueDueWord("2026-09-26", "2026-09-27"), null);
  // The intake state is main's `universityIntakeLabel`, unchanged (review #1079).
  assert.equal(intakeStateLabel(intake({ status: "closed" }), NOW), "Приём закрыт по данным источника");
  assert.equal(intakeStateLabel(intake({ applicationDeadline: "2026-09-01" }), NOW), "Опубликованный срок приёма прошёл");
  assert.equal(intakeStateLabel(intake({ applicationDeadline: "2026-12-01" }), NOW), "Приём открыт по данным источника");
  assert.equal(intakeStateLabel(intake({ applicationDeadline: "2026-12-01", status: "announced" }), NOW), "Набор объявлен");
  // A missing deadline or time zone cannot establish either an open intake or expiry.
  assert.equal(intakeStateLabel(intake({ status: "announced" }), NOW), "Срок приёма нужно уточнить");
  assert.equal(intakeStateLabel(intake(), NOW), "Срок приёма нужно уточнить");
  const unzoned = intake({ applicationDeadline: "2026-03-15", timezone: null });
  assert.equal(intakeStateLabel(unzoned, NOW), "Срок приёма нужно уточнить", "a past date without a zone is not «open»");
  assert.equal(intakeStateLabel({ ...unzoned, status: "announced" }, NOW), "Срок приёма нужно уточнить");
  assert.equal(intakeDeadlineView(unzoned, NOW).word, null, "no countdown without a zone");
  assert.equal(intakeStateLabel(intake({ status: "unknown" }), NOW), null, "unconfirmed intakes are not shown (#729)");
  assert.equal(intakeStateLabel(intake({ status: "needs_reconfirmation" }), NOW), null);
  for (const status of ["open", "announced", "closed"]) {
    for (const fields of [{}, { applicationDeadline: "2026-09-01" }, { applicationDeadline: "2026-12-01" }, { applicationDeadline: "2026-03-15", timezone: null }]) {
      const one = intake({ status, ...fields });
      assert.equal(intakeStateLabel(one, NOW), universityIntakeLabel(one, NOW), `${status} ${JSON.stringify(fields)}`);
    }
  }
  assert.deepEqual(shownIntakes([intake({ status: "unknown" }), intake({ status: "needs_reconfirmation" }), intake({ status: "closed" })]).map((one) => one.status), ["closed"]);
  assert.deepEqual(intakeDeadlineView(intake({ applicationDeadline: "2026-10-01", deadlineTime: "17:00" }), NOW),
    { dateTime: "2026-10-01", text: "01.10", zone: "17:00, Asia/Shanghai", word: { text: "через 4 дн", tone: "upcoming" } });
  assert.equal(intakeDeadlineView(intake({ applicationDeadline: "2026-10-01", status: "closed" }), NOW).word, null, "a closed intake has no countdown");
  assert.equal(intakeDeadlineView(intake(), NOW), null);
  assert.deepEqual(intakeStartView(intake({ startMonth: "2026-11" }), "2026-09-27"), { dateTime: "2026-11", text: "ноябрь 2026", mono: false });
  assert.deepEqual(intakeStartView(intake({ startDate: "2026-11-24", startMonth: "2026-11" }), "2026-09-27"), { dateTime: "2026-11-24", text: "24.11", mono: true });
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25].map(programsWord),
    ["программа", "программы", "программ", "программ", "программ", "программа", "программы", "программ"]);
});

test("photo credit: every licence note and author note of the library reads in Russian; licence names and author names stay as in the source", () => {
  for (const [key, photo] of Object.entries(UNIVERSITY_PHOTOS)) {
    const license = photoLicenseRu(photo.license);
    assert.doesNotMatch(license, /embedding|license|reserved|Public domain|Rights holder/u, `${key}: ${photo.license}`);
    // Review #1079: 21 author strings carried «(photographer not named)» or «(official website; photographer not stated)».
    const author = photoAuthorRu(photo.author);
    assert.doesNotMatch(author, /photographer|official website|not stated|not named|Photographs by|Wikipedia user|at English Wikipedia/u, `${key}: ${photo.author}`);
    const name = photo.author.replace(/\s*\([^)]*(?:photographer|official website)[^)]*\)$/u, "").replace(/^Photographs by\s+/u, "")
      .replace(/^Czech Wikipedia user\s+/u, "").replace(/\s+at English Wikipedia$/u, "");
    assert.ok(author.includes(name), `${key}: the author name stays as in the source (${name})`);
  }
  assert.equal(photoAuthorRu("China Jiliang University (photographer not named)"), "China Jiliang University — фотограф не указан");
  assert.equal(photoAuthorRu("Bilkent University (official website; photographer not stated)"), "Bilkent University — официальный сайт; фотограф не указан");
  assert.equal(photoAuthorRu("Photographs by Radosław Drożdżewski (User:Zwiadowca21)"), "Radosław Drożdżewski (User:Zwiadowca21)");
  assert.equal(photoAuthorRu("Chongkian"), "Chongkian");
  assert.equal(photoAuthorRu("Some future (note)"), "Some future (note)", "an unknown note is shown as is");
  assert.equal(photoLicenseRu("CC BY-SA 4.0"), "CC BY-SA 4.0");
  assert.equal(photoLicenseRu("Official-source embedding; no reuse license stated"), "с официального сайта, лицензия не указана");
  assert.equal(photoLicenseRu("Some future note"), "Some future note", "an unknown note is shown as is, not guessed");
});

/* ------------------------------------------------------------ Страницы */

const pages = JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/reference-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
));
const page = (name, look = "current") => pages.find((entry) => entry.name === name && entry.look === look)?.html ?? assert.fail(`${name} ${look}`);
const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/gu, "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

test("«Университеты»: one dense table of 30 rows with the photo, the deadline column and an honest count", () => {
  for (const look of ["current", "next"]) {
    const html = page("universities-list", look);
    assert.match(html, /<h1 class="t-page-title[^"]*">Университеты<span[^>]*>143<\/span><\/h1>/u, `${look}: count from the complete read`);
    assert.match(html, /data-testid="v3-university-table"/u);
    const rows = [...html.matchAll(/<tr role="row" data-university-row="[^"]+"[\s\S]*?<\/tr>/gu)].map((match) => match[0]);
    assert.equal(rows.length, 30);
    assert.deepEqual(text(html.match(/<thead[\s\S]*?<\/thead>/u)[0]).trim().split(" ").filter(Boolean),
      ["Университет", "Страна", "Программы", "Ближайший", "срок", "Проверено"]);
    // Deadlines first, in date order; the rest say so in words.
    const deadlines = rows.map((row) => row.match(/data-deadline="([^"]+)"/u)[1]);
    const dated = deadlines.filter((value) => value !== "none");
    assert.ok(dated.length > 0);
    assert.deepEqual(deadlines.slice(0, dated.length), [...dated].sort(), "deadline rows lead, nearest first");
    assert.ok(deadlines.slice(dated.length).every((value) => value === "none"));
    assert.ok(rows.filter((row) => row.includes('data-deadline="none"')).every((row) => row.includes(">Срок не подтверждён</p>")));
    assert.ok(rows.every((row) => /<img[^>]*alt=""[^>]*class="size-full object-cover"|<span aria-hidden="true" class="grid size-12/u.test(row)), "a 48 px photo or its neutral place in each row");
    assert.match(html, /<nav aria-label="Страницы каталога"[\s\S]*?1–30<\/span> из <span class="tabular-nums">143<\/span>/u);
    assert.match(html, /href="\/v3\/universities\?offset=30"/u);
    // «Управлять каталогом» is a quiet link, not the page's red action.
    const end = html.indexOf("Управлять каталогом</a>");
    assert.ok(end > 0, "manage link");
    const manage = html.slice(html.lastIndexOf("<a ", end), end);
    assert.doesNotMatch(manage, /bg-accent|btn/u);
    assert.doesNotMatch(html, /Фото: |Photo by|Сроки подачи — в карточке/u, "no credits and no placeholders in the list");
  }
});

test("«Университеты»: the toolbar applies filters on change and keeps «Найти» for a browser without scripts", () => {
  const html = page("universities-list-filtered");
  assert.match(html, /<form role="search" aria-label="Поиск университетов" data-testid="university-toolbar"[^>]*action="\/v3\/universities" method="get">/u);
  assert.match(html, /<noscript>/u);
  assert.match(html, /href="\/v3\/universities"[^>]*>Сбросить<\/a>/u, "«Сбросить» only when something is chosen");
  assert.doesNotMatch(page("universities-list"), />Сбросить<\/a>/u);
  const toolbar = source("src/components/v3/universities/UniversityToolbar.tsx");
  // Controlled selects, no remount after a choice: keyboard focus stays on the select (review #1079).
  assert.match(toolbar, /<select name="country" value=\{countryValue\} onChange=\{\(event\) => \{\s*setCountryValue\(event\.target\.value\);\s*router\.push\(href\(\{ country: event\.target\.value \}\)/u);
  assert.match(toolbar, /<select name="level" value=\{levelValue\} onChange=\{\(event\) => \{\s*setLevelValue\(event\.target\.value\);\s*router\.push\(href\(\{ level: event\.target\.value \}\)/u);
  assert.doesNotMatch(toolbar, /key=\{(?:country|level)\}|defaultValue=\{(?:country|level)\}/u);
  assert.match(html, /<select name="country"[^>]*>[\s\S]*?<option value="MY" selected="">Малайзия<\/option>/u, "the address still sets the value");
  assert.match(toolbar, /setTimeout\(\(\) => search\(value, true\), LIVE_DELAY_MS\)/u, "search runs by itself after a pause");
  // Both Malaysian bachelor filters reached the read: 13 rows, no pagination.
  assert.equal([...html.matchAll(/data-university-row=/gu)].length, 13);
  assert.doesNotMatch(html, /aria-label="Страницы каталога"/u);
});

test("catalogue read: offset 0 alone, then four at once, nothing past the end; one retry when the catalogue changes mid-read", () => {
  const offsets = (name) => pages.find((entry) => entry.name === name && entry.look === "current").catalogueOffsets;
  assert.deepEqual(offsets("universities-list"), [0, 30, 60, 90, 120], "143 universities: 5 calls, none past the end");
  assert.deepEqual(offsets("universities-list-filtered"), [0], "13 rows: one call");
  // A row seen twice (Admin publishes during the read) reads the catalogue once more instead of failing the page.
  assert.deepEqual(offsets("universities-list-changed"), [0, 30, 60, 90, 120, 0, 30, 60, 90, 120]);
  const changed = page("universities-list-changed");
  assert.doesNotMatch(changed, /Не удалось загрузить каталог/u);
  assert.match(changed, /1–30<\/span> из <span class="tabular-nums">143<\/span>/u);
  const reader = source("src/lib/v3/university-source.ts");
  assert.match(reader, /if \(!\(error instanceof CatalogueChangedError\)\) throw error;\s*return readWholeCatalogue\(actor, filters\);/u, "one retry, then the error");
});

test("university page: programmes and intakes first, then the overview; the photo smaller at the side with one Russian credit line", () => {
  for (const look of ["current", "next"]) {
    const html = page("universities-detail", look);
    const programs = html.indexOf('id="university-programs"');
    const about = html.indexOf('id="university-about"');
    const photo = html.indexOf('aria-label="Фото кампуса"');
    assert.ok(programs > 0 && about > programs && photo > about, `${look}: programmes → overview → photo`);
    // Name and place read as one unit: the place is the line under the h1, the Admin links come after it.
    const h1 = html.indexOf("<h1");
    const place = html.indexOf('<p class="t-meta mt-1 text-fg-3">Малайзия · Johor Bahru · <span class="tabular-nums">3</span> программы</p>');
    assert.ok(h1 > 0 && place > h1 && html.indexOf(">Бланки университета</a>") > place && programs > place, `${look}: h1 → place → Admin links → programmes`);
    assert.equal([...html.matchAll(/Малайзия · Johor Bahru/gu)].length, 1, `${look}: the place once`);
    assert.match(html, /<a class="inline-flex min-h-11[^"]*" href="\/v3\/universities">(?:<svg[\s\S]*?<\/svg>)?Все университеты<\/a>/u);
    assert.match(html, /data-photo-credit="">Фото: <a[^>]*>[^<]+<span class="sr-only"> \(в новой вкладке\)<\/span><\/a> · <a[^>]*>CC BY-SA 4\.0<span/u);
    assert.match(html, /aspect-\[4\/3\]/u);
    assert.match(html, /<th role="columnheader" scope="col" class="t-caption text-start text-fg-2">Срок подачи<\/th>/u);
    assert.match(html, /<td role="cell" class="t-body-compact" data-cell="deadline">[\s\S]*?<time dateTime="2026-07-17" class="font-mono tabular-nums text-fg">17\.07<\/time>/u);
    assert.match(html, />Приём закрыт по данным источника</u);
    assert.match(html, />Проверено:<\/span><time dateTime="2026-09-10" class="font-mono tabular-nums">10\.09<\/time>/u);
    assert.match(html, />Бланки университета<\/a>/u);
    assert.match(html, />Предложить обновление<\/a>/u);
    assert.doesNotMatch(html.slice(html.indexOf("<main"), html.indexOf("</main>")), /(?<![:\w-])bg-accent(?![\w-])/u, "no solid red on the reference page");
  }
});

test("university page: each intake state is main's label — no deadline or zone reads «Срок приёма нужно уточнить»; the credit line is Russian (review #1079)", () => {
  // apu: reviewed card whose announced intakes publish no deadline and no zone, and whose photo author carries an English note.
  const apu = JSON.parse(source("src/lib/server/university-catalog-reviewed-malaysia.json")).find((entry) => entry.key === "apu").content;
  const expected = apu.programs.flatMap((program) => shownIntakes(program.intakes)).map((one) => universityIntakeLabel(one, NOW));
  assert.ok(expected.includes("Срок приёма нужно уточнить"), "the card has an intake without a deadline");
  for (const look of ["current", "next"]) {
    const html = page("universities-detail-unconfirmed", look);
    const states = [...html.matchAll(/<tr role="row" data-intake=""[\s\S]*?<\/tr>/gu)]
      .map((row) => row[0].match(/<td role="cell" class="t-body-compact text-fg-2"><span[^>]*>Состояние:<\/span>([^<]*)<\/td>/u)?.[1]);
    assert.deepEqual(states, expected, `${look}: states as on main`);
    assert.doesNotMatch(html, />(?:Приём открыт|Набор объявлен)</u, `${look}: an undated intake is neither open nor announced`);
    assert.match(html, /data-photo-credit="">Фото: <a[^>]*>Asia Pacific University of Technology &amp; Innovation — официальный сайт; фотограф не указан<span class="sr-only"> \(в новой вкладке\)<\/span><\/a> · <a[^>]*>с официального сайта, лицензия не указана<span class="sr-only"> \(в новой вкладке\)<\/span><\/a> · кадрировано<\/figcaption>/u);
    assert.doesNotMatch(html.match(/data-photo-credit=""[\s\S]*?<\/figcaption>/u)[0], /photographer|official website|embedding|license/u);
  }
});

test("«Настройки»: every staff view has one section heading — no hidden duplicate for Playwright strict mode (review #1079)", () => {
  const headings = (html) => [...html.slice(html.indexOf("<main"), html.indexOf("</main>")).matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gu)]
    .map((match) => ({ level: Number(match[1]), hidden: /sr-only/u.test(match[2]), text: match[3].replace(/<[^>]+>/gu, "").trim() }));
  for (const look of ["current", "next"]) {
    for (const [name, title] of [["settings-staff", "Сотрудники · 5"], ["settings-roles", "Роли и доступ"], ["settings-departments", "Отделы · 2"], ["settings-integrations", "Интеграции"]]) {
      const list = headings(page(name, look));
      const texts = list.map((heading) => heading.text);
      assert.deepEqual(list.filter((heading) => heading.level === 2), [{ level: 2, hidden: false, text: title }], `${name} ${look}: one visible h2`);
      assert.equal(new Set(texts).size, texts.length, `${name} ${look}: no two headings share a name (${texts})`);
      assert.ok(list.every((heading, index) => index === 0 || heading.level <= list[index - 1].level + 1), `${name} ${look}: no skipped level`);
    }
  }
  // `verifyScopedStaffRoleEditor` waits for this exact heading: one element, not two.
  assert.equal([...page("settings-roles").matchAll(/<h[1-6][^>]*>Роли и доступ<\/h[1-6]>/gu)].length, 1);
  const roles = source("src/components/v3/settings/StaffRolesSection.tsx");
  assert.match(roles, /if \(newRole\) return <><h2 className="sr-only">Роли и доступ<\/h2><RoleEditor /u, "the new-role form keeps the section heading");
  assert.doesNotMatch(source("src/components/v3/settings/Settings.tsx"), /className=\{current\.key === "staff" \? "sr-only"/u);
});

test("«Настройки»: open on «Сотрудники», one section list, no «админ» marks, one integrations table", () => {
  const staff = page("settings-staff");
  const nav = staff.match(/<nav aria-label="Разделы настроек"[\s\S]*?<\/nav>/u)[0];
  assert.deepEqual([...nav.matchAll(/<a\b[^>]*>([^<]+)<\/a>/gu)].map((match) => match[1]),
    ["Сотрудники", "Роли и доступ", "Отделы", "Интеграции", "Журнал действий", "Документы и передача", "Платформа"]);
  assert.match(nav, /<a aria-current="page"[^>]*href="\/v3\/settings\?section=staff&amp;view=people">Сотрудники<\/a>/u);
  assert.doesNotMatch(staff, /aria-label="Управление командой"|виден только администратору|>админ</u, "no second tab row, no admin marks");
  assert.match(staff, /<h2 class="t-section">Сотрудники · 5<\/h2>/u);
  // Search, «Отдел» and «Доступ» in one toolbar row above the list and the card (review #1079).
  const toolbar = staff.match(/<div role="search" aria-label="Поиск сотрудников" class="flex flex-wrap items-center gap-2">[\s\S]*?<\/div>/u)?.[0] ?? assert.fail("staff toolbar row");
  assert.equal([...toolbar.matchAll(/<input type="search"|<select /gu)].length, 3);
  assert.match(toolbar, /Показано <span class="tabular-nums">5<\/span> из <span class="tabular-nums">5<\/span>/u);
  assert.ok(staff.indexOf('aria-label="Поиск сотрудников"') < staff.indexOf('aria-label="Список сотрудников"'), "the row stands above the list");

  const integrations = page("settings-integrations");
  assert.match(integrations, /data-testid="v3-settings-integrations"/u);
  assert.deepEqual([...integrations.matchAll(/data-integration="([a-z]+)"/gu)].map((match) => match[1]), ["whatsapp", "amocrm", "gemini"]);
  assert.doesNotMatch(integrations, /data-testid="v3-settings-blocking"/u, "production facts are not a warning");
  assert.doesNotMatch(integrations, /Требует внимания|v3-edge-|border-s-2/u);
  assert.match(text(integrations), /WhatsApp не подключён Последняя проверка: нет данных Что не работает: Входящие WhatsApp не приходят в CRM, ответить отсюда нельзя Что сделать: Подключает технический специалист на сервере: вебхук и вход по QR Открыть WhatsApp/u);
  assert.match(integrations, /<a class="inline-flex min-h-11[^"]*" href="\/v3\/inbox">Открыть WhatsApp<\/a>/u);

  const blocked = page("settings-integrations-blocked");
  assert.equal([...blocked.matchAll(/data-testid="v3-settings-blocking"/gu)].length, 1, "one warning on top");
  assert.match(text(blocked), /Не работают: WhatsApp — требуется подключение WhatsApp по QR-коду; amoCRM — доступ к аккаунту amoCRM не подтверждён\./u);
  assert.match(blocked, /<time dateTime="2026-09-26T08:15:00.000Z" class="font-mono tabular-nums text-fg">26\.09 14:15<\/time>/u);
});

// «Переписки» Э5 (WhatsApp и «Кабинет студента» одним пунктом) стоят в «Общем»
// рядом с «Заявками»: ни один отдел не держит ни их, ни прежние пункты каналов.
test("menu: «Заявки» and «Переписки» stand in «Общее» for Admin, admissions and sales, in both looks", () => {
  for (const look of ["current", "next"]) {
    for (const role of ["admin", "admissions", "sales"]) {
      const html = page(`menu-${role}`, look);
      const common = html.match(/<section aria-label="Общее"[\s\S]*?<\/section>/u)?.[0] ?? assert.fail(`${role} ${look}: «Общее»`);
      const labels = [...common.matchAll(/<span class="min-w-0[^"]*">([^<]+)<\/span>/gu)].map((match) => match[1]);
      assert.ok(labels.includes("Переписки"), `${role} ${look}: «Переписки» in «Общее» (${labels})`);
      assert.equal(labels.includes("WhatsApp"), false, `${role} ${look}: no separate WhatsApp item (${labels})`);
      assert.equal(labels[0], "Заявки", `${role} ${look}: «Заявки» leads «Общее»`);
      const menu = html.slice(0, html.indexOf('aria-label="Общее"'));
      assert.doesNotMatch(menu, /href="\/v3\/(?:requests|inbox|messages)"/u, `${role} ${look}: no department group holds them`);
    }
  }
});

test("«Календарь»: «сегодня» is a small red fill only in the new look", () => {
  const css = source("src/app/(v3)/v3.css");
  assert.match(css, /\.v3-world\[data-look="next"\] \[data-calendar-today\] \{\s*background: var\(--accent\);\s*color: var\(--on-accent\);\s*\}/u);
  assert.doesNotMatch(css.replace(/\.v3-world\[data-look="next"\] \[data-calendar-today\]/gu, ""), /\[data-calendar-today\]/u, "the current look keeps its dark mark");
  assert.match(source("src/components/v3/calendar/grids.tsx"), /data-calendar-today=\{isToday \? "" : undefined\}/u);
});
