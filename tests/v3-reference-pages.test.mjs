import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { UNIVERSITY_PHOTOS, universityIntakeLabel } from "../src/lib/platform-university-catalog.ts";
import { universityListItem } from "../src/lib/university-list-item.ts";
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
  // 364: the list sorts light rows (the same projection the SQL read returns).
  const rows = sortCatalogueRows([none, passed, later, unverified, sooner].map(universityListItem), "", NOW);
  assert.deepEqual(rows.map((row) => row.university.content.name), ["Яблоко", "Альфа", "Аист", "Бета", "Гамма"],
    "deadlines first; a passed or unconfirmed deadline is no deadline; the rest by name");
  assert.deepEqual(rows[0].deadline, {
    dateTime: "2026-10-15", text: "15.10", timezone: "Asia/Shanghai", word: { text: "через 18 дн", tone: "upcoming" },
    program: "Программа 1", intake: "Набор", verifiedOn: "2026-09-10", sameDateCount: 0,
  });
  // The level filter picks the deadline of that level only.
  const byLevel = sortCatalogueRows([later, sooner].map(universityListItem), "bachelor", NOW);
  assert.deepEqual(byLevel.map((row) => [row.university.content.name, row.deadline?.dateTime ?? null]), [["Альфа", "2026-11-30"], ["Яблоко", null]]);
});

test("catalogue pages: honest «N–M из K» from the complete read, none from the name-ordered server page", () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({ university: universityListItem(university(`В${index}`, [["bachelor", []]])), deadline: null }));
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
const page = (name) => pages.find((entry) => entry.name === name)?.html ?? assert.fail(name);
const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/gu, "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

// Каталог страниц — те же проверенные шаблоны карточек, что отдаёт стенд (`reference-static-render.cjs`): число вузов считается из них.
const catalogueCards = ["china", "malaysia", "europe", "turkey", "international", "other"]
  .flatMap((name) => JSON.parse(source(`src/lib/server/university-catalog-reviewed-${name}.json`)));
// Строки таблицы «Нового вида»: `DataTable` рисует `<tr>` без своих атрибутов, имя вуза — `div[data-university-row]` в первой ячейке.
const tableRows = (html) => [...html.matchAll(/<tr[^>]*><td[^>]*><div data-university-row="[^"]+"[\s\S]*?<\/tr>/gu)].map((match) => match[0]);

test("«Университеты»: one dense table of 30 rows with the photo, the deadline column and an honest count", () => {
  const html = page("universities-list");
  // The count below comes from the same reviewed catalogue the harness renders; it proves «the full total, not the page
  // size» only while the catalogue is larger than one page.
  assert.ok(catalogueCards.length > 30, `the catalogue is larger than one page (${catalogueCards.length})`);
  assert.match(html, new RegExp(`<h1 class="t-page-title[^"]*">Университеты<span[^>]*>${catalogueCards.length}</span></h1>`, "u"), "count from the complete read");
  assert.match(html, /data-testid="v3-universities-next"/u);
  assert.match(html, /<div role="region" aria-label="Университеты"[^>]*><table/u);
  const rows = tableRows(html);
  assert.equal(rows.length, 30);
  // Страна и город — вторая строка ячейки имени («Китай · Шанхай»), своей колонки у страны больше нет.
  assert.deepEqual(text(html.match(/<thead[\s\S]*?<\/thead>/u)[0]).trim().split(" ").filter(Boolean),
    ["Университет", "Программы", "Ближайший", "срок"]);
  assert.ok(rows.every((row) => /<span class="block truncate t-meta text-fg-2">[^<·]+ · [^<]+<\/span>/u.test(row)), "country · city under each name");
  // Deadlines first, in date order; the rest say so in words.
  const deadlines = rows.map((row) => row.match(/data-deadline="([^"]+)"/u)[1]);
  const dated = deadlines.filter((value) => value !== "none");
  assert.ok(dated.length > 0);
  assert.deepEqual(deadlines.slice(0, dated.length), [...dated].sort(), "deadline rows lead, nearest first");
  assert.ok(deadlines.slice(dated.length).every((value) => value === "none"));
  assert.ok(rows.filter((row) => row.includes('data-deadline="none"')).every((row) => row.includes(">Срок не подтверждён</span>")));
  assert.ok(rows.every((row) => /<figure class="size-12[^"]*"><img[^>]*alt=""|<span aria-hidden="true" class="grid size-12/u.test(row)), "a 48 px photo or its neutral place in each row");
  assert.match(html, new RegExp(`<nav aria-label="Страницы каталога"[\\s\\S]*?1–30</span> из <span class="tabular-nums">${catalogueCards.length}</span>`, "u"));
  assert.match(html, /href="\/universities\?offset=30"/u);
  // «Управлять каталогом» is a quiet outline button, not the page's red action.
  const end = html.indexOf("Управлять каталогом</a>");
  assert.ok(end > 0, "manage link");
  const manage = html.slice(html.lastIndexOf("<a ", end), end);
  assert.doesNotMatch(manage, /bg-accent|btn/u);
  assert.doesNotMatch(html, /Фото: |Photo by|Сроки подачи — в карточке/u, "no credits and no placeholders in the list");
});

test("«Университеты»: search runs by itself after a pause and without scripts is a plain GET form; filters are links with removable chips", () => {
  // «Новый вид» (#1327) заменил строку из двух `select` и «Найти» (прежний `UniversityToolbar`): поиск `ListSearch` с `liveMs`, фильтры ссылками.
  const html = page("universities-list-filtered");
  // 25.11.2026: в заголовках таблицы нет стрелок сортировки (они переставляли 30 строк страницы); порядок — меню «Порядок».
  assert.doesNotMatch(html.slice(html.indexOf("<thead"), html.indexOf("</thead>")), /aria-sort=/u);
  assert.match(html, /<form role="search" aria-label="Поиск университетов"[^>]*action="\/universities" method="get">/u, "works without scripts: a GET form");
  assert.match(html, /<input type="hidden" name="country" value="MY"\/><input type="hidden" name="level" value="bachelor"\/>/u, "the chosen filters ride along with a search");
  assert.match(html, /data-testid="list-filters"/u);
  // Each chosen filter is a chip whose link removes only that filter; none on the unfiltered list.
  const chip = (label) => html.match(new RegExp(`<a [^>]*aria-label="Убрать фильтр: ${label}"[^>]*>`, "u"))?.[0] ?? assert.fail(label);
  assert.match(chip("Страна: Малайзия"), /data-testid="list-filter-applied"[^>]*href="\/universities\?level=bachelor"/u);
  assert.match(chip("Уровень: Бакалавриат"), /data-testid="list-filter-applied"[^>]*href="\/universities\?country=MY"/u);
  assert.doesNotMatch(page("universities-list"), /data-testid="list-filter-applied"/u);
  const list = source("src/components/staff/universities-next/UniversitiesListNext.tsx");
  assert.match(list, /<ListSearch action="\/universities" value=\{query\} placeholder="Найти университет" label="Поиск университетов" hidden=\{searchHidden\} liveMs=\{400\} \/>/u, "search runs by itself after a pause");
  assert.match(list, /<LinkFilters bar=\{filters\} \/>/u);
  const search = source("src/components/staff/list-next/ListSearch.tsx");
  assert.match(search, /timer\.current = setTimeout\(\(\) => go\(event\.target\.value, true\), liveMs\)/u);
  assert.match(search, /router\.replace\(href, \{ scroll: false \}\)/u, "the pause search does not stack history entries");
  // The Malaysian bachelor filters reached the read: as many rows as cards that match, no pagination.
  const expected = catalogueCards.filter((card) => card.content.country === "MY" && card.content.programs.some((program) => program.level === "bachelor")).length;
  assert.ok(expected > 0);
  assert.match(html, new RegExp(`<h1 class="t-page-title[^"]*">Университеты<span[^>]*>${expected}</span></h1>`, "u"));
  assert.equal(tableRows(html).length, expected);
  assert.doesNotMatch(html, /aria-label="Страницы каталога"/u);
});

test("catalogue read (364): one light read per page, no paging of full cards, the old pages by name only past the limit", () => {
  const offsets = (name) => pages.find((entry) => entry.name === name).catalogueOffsets;
  assert.deepEqual(offsets("universities-list"), ["rows"], "the whole catalogue in one light call");
  assert.deepEqual(offsets("universities-list-filtered"), ["rows"], "a filtered list: one call too");
  // Past the limit the light read answers complete = false and the page reads the old server page by name, offset 0.
  assert.deepEqual(offsets("universities-list-over-limit"), ["rows", 0], "past the limit: the old page by name");
  assert.doesNotMatch(page("universities-list-over-limit"), /Не удалось загрузить каталог/u);
  const reader = source("src/lib/v3/university-source.ts");
  assert.match(reader, /rpc\("staff_university_catalog_rows_v1"/u);
  assert.match(reader, /if \(read\.complete\) return \{ kind: "complete", items: read\.items \};\s*const page = await readStaffUniversities\(actor, filters\);/u,
    "past the limit: the old server page by name");
  assert.doesNotMatch(reader, /CATALOGUE_SORT_PAGES|CatalogueChangedError|readWholeCatalogue/u, "no batched reading of full cards");
});

test("university page: programmes and intakes first, then the overview; the photo smaller at the side with one Russian credit line", () => {
  const html = page("universities-detail");
  // «Новый вид»: каждая программа — своя секция с таблицей наборов, затем «Об университете», фото — боковая колонка (`aside`) последним в разметке.
  const programs = html.indexOf('<section id="program-');
  const about = html.indexOf('id="university-about"');
  const photo = html.indexOf('aria-label="Фото кампуса"');
  assert.ok(programs > 0 && about > programs && photo > about, "programmes → overview → photo");
  // Name and place read as one unit: the place is the line under the h1, the Admin links come after it.
  const utm = catalogueCards.find((card) => card.key === "utm").content.programs.length;
  const h1 = html.indexOf("<h1");
  const place = html.indexOf(`<p class="t-meta basis-full text-fg-3">Малайзия · Johor Bahru · ${utm} программ</p>`);
  assert.ok(h1 > 0 && place > h1 && html.indexOf(">Бланки университета</a>") > place && programs > place, "h1 → place → Admin links → programmes");
  assert.equal([...html.matchAll(/Малайзия · Johor Bahru/gu)].length, 1, "the place once");
  assert.match(html, /<a class="inline-flex min-h-11[^"]*" href="\/universities">(?:<svg[\s\S]*?<\/svg>)?Все университеты<\/a>/u);
  assert.match(html, /data-photo-credit="">Фото: <a[^>]*>[^<]+<span class="sr-only"> \(в новой вкладке\)<\/span><\/a> · <a[^>]*>CC BY-SA 4\.0<span/u);
  assert.match(html, /<aside aria-label="Фото кампуса" class="min-w-0 @max-4xl:max-w-80">/u, "the photo is a side column, at most 20 rem on a phone");
  assert.match(html, /aspect-\[4\/3\]/u);
  assert.match(html, /<th [^>]*>Срок подачи<\/th>/u);
  assert.match(html, /<span[^>]*data-cell="deadline"[^>]*><span[^>]*><time dateTime="2026-07-17"[^>]*>17\.07<\/time>/u);
  assert.match(html, />Приём закрыт по данным источника</u);
  const [year, month, day] = catalogueCards.find((card) => card.key === "utm").content.verifiedOn.split("-");
  assert.match(html, new RegExp(`>Карточка проверена <time dateTime="${year}-${month}-${day}"[^>]*>${day}\\.${month}</time>`, "u"), "the card's own verification day");
  assert.match(html, />проверено <time dateTime="2026-09-10"[^>]*>10\.09<\/time>/u, "the intake's verification day in its state cell");
  assert.match(html, />Бланки университета<\/a>/u);
  assert.match(html, />Предложить обновление<\/a>/u);
  assert.doesNotMatch(html.slice(html.indexOf("<main"), html.indexOf("</main>")), /(?<![:\w-])bg-accent(?![\w-])/u, "no solid red on the reference page");
});

test("university page: each intake state is main's label — no deadline or zone reads «Срок приёма нужно уточнить»; the credit line is Russian (review #1079)", () => {
  // apu: reviewed card whose announced intakes publish no deadline and no zone, and whose photo author carries an English note.
  const apu = JSON.parse(source("src/lib/server/university-catalog-reviewed-malaysia.json")).find((entry) => entry.key === "apu").content;
  const expected = apu.programs.flatMap((program) => shownIntakes(program.intakes)).map((one) => universityIntakeLabel(one, NOW));
  assert.ok(expected.includes("Срок приёма нужно уточнить"), "the card has an intake without a deadline");
  const html = page("universities-detail-unconfirmed");
  // «Новый вид»: таблица наборов — `<tbody>` каждой программы; состояние — третья ячейка строки (вторая строка в ней — «проверено …»).
  const states = [...html.matchAll(/<tbody[^>]*>[\s\S]*?<\/tbody>/gu)].flatMap((body) => [...body[0].matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gu)])
    .map((row) => row[0].match(/<td[^>]*>[\s\S]*?<\/td><td[^>]*>[\s\S]*?<\/td><td[^>]*><span[^>]*>([^<]*)<span/u)?.[1]);
  assert.deepEqual(states, expected, "states as on main");
  assert.doesNotMatch(html, />(?:Приём открыт|Набор объявлен)</u, "an undated intake is neither open nor announced");
  assert.match(html, /data-photo-credit="">Фото: <a[^>]*>Asia Pacific University of Technology &amp; Innovation — официальный сайт; фотограф не указан<span class="sr-only"> \(в новой вкладке\)<\/span><\/a> · <a[^>]*>с официального сайта, лицензия не указана<span class="sr-only"> \(в новой вкладке\)<\/span><\/a> · кадрировано<\/figcaption>/u);
  assert.doesNotMatch(html.match(/data-photo-credit=""[\s\S]*?<\/figcaption>/u)[0], /photographer|official website|embedding|license/u);
});

test("«Настройки»: every staff view has one section heading — no hidden duplicate for Playwright strict mode (review #1079)", () => {
  const headings = (html) => [...html.slice(html.indexOf("<main"), html.indexOf("</main>")).matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gu)]
    .map((match) => ({ level: Number(match[1]), hidden: /sr-only/u.test(match[2]), text: match[3].replace(/<[^>]+>/gu, "").trim() }));
  // «Новый вид» (#1313): заголовок раздела один — скрытый `h2` с названием выбранного раздела (его уже называет вкладка в ряду разделов,
  // а Playwright и чтец экрана ждут именно его); счётчика «· N» в заголовке больше нет.
  for (const [name, title] of [["settings-staff", "Сотрудники"], ["settings-roles", "Роли и доступ"], ["settings-departments", "Отделы"], ["settings-integrations", "Интеграции"]]) {
    const list = headings(page(name));
    assert.deepEqual(list.filter((heading) => heading.level === 2), [{ level: 2, hidden: true, text: title }], `${name}: one section h2 (${title})`);
    const upper = list.filter((heading) => heading.level <= 2).map((heading) => heading.text);
    assert.equal(new Set(upper).size, upper.length, `${name}: no two page or section headings share a name (${upper})`);
    assert.ok(list.every((heading, index) => index === 0 || heading.level <= list[index - 1].level + 1), `${name}: no skipped level`);
  }
  // `verifyScopedStaffRoleEditor` waits for this exact heading: one element, not two.
  assert.equal([...page("settings-roles").matchAll(/<h[1-6][^>]*>Роли и доступ<\/h[1-6]>/gu)].length, 1);
  assert.match(source("src/components/staff/settings-next/SettingsSection.tsx"), /<h2 className="sr-only">\{current\?\.title\}<\/h2>/u, "the section heading is the one h2 of the page");
  const roles = source("src/components/staff/settings/StaffRolesSection.tsx");
  assert.match(roles, /if \(newRole\) return <><h2 className="sr-only">Роли и доступ<\/h2><RoleEditor /u, "the new-role form keeps the section heading");
});

test("«Настройки»: open on «Сотрудники», one section list, no «админ» marks, one integrations table", () => {
  const SECTIONS = ["Сотрудники", "Роли и доступ", "Отделы", "Интеграции", "Телефония", "Отчёты", "Кураторы стран", "Реквизиты для оплаты", "Кабинеты студентов",
    "Журнал действий", "Запросы на удаление", "Документы и передача", "Платформа"];
  const staff = page("settings-staff");
  // Один и тот же список разделов дважды: вкладки (узкий экран, `v3-settings-nav-compact`) и столбец слева (`v3-settings-nav`).
  const navs = [...staff.matchAll(/<nav aria-label="Разделы настроек"[\s\S]*?<\/nav>/gu)].map((match) => match[0]);
  assert.equal(navs.length, 2, "the same list for a narrow and a wide screen");
  for (const nav of navs) {
    assert.deepEqual([...nav.matchAll(/<a\b[^>]*>(?:<span[^>]*>)?([^<]+)(?:<\/span>)?<\/a>/gu)].map((match) => match[1]), SECTIONS);
    // «Телефония» (T4b, 17.10.2026): раздел «Настройки → Телефония» стоит сразу после «Интеграций»; «Отчёты» (323, 27.10.2026) — после «Телефонии».
    assert.match(nav, /<a aria-current="page"[^>]*href="\/settings\?section=staff&amp;view=people">(?:<span[^>]*>)?Сотрудники(?:<\/span>)?<\/a>/u, "opens on «Сотрудники»");
    assert.equal([...nav.matchAll(/aria-current="page"/gu)].length, 1);
  }
  assert.doesNotMatch(staff, /aria-label="Управление командой"|виден только администратору|>админ</u, "no second tab row, no admin marks");
  // Search, «Отдел» and «Доступ» in one toolbar row above the list (review #1079).
  const searchAt = staff.lastIndexOf("<input", staff.indexOf('placeholder="Имя, должность или отдел"'));
  const listAt = staff.indexOf('aria-label="Список сотрудников"');
  assert.ok(searchAt > 0 && listAt > searchAt, "staff toolbar row above the list");
  const toolbar = staff.slice(searchAt, listAt);
  assert.equal([...toolbar.matchAll(/<input type="search"/gu)].length, 1);
  assert.deepEqual([...toolbar.matchAll(/<select [^>]*aria-label="([^"]+)"/gu)].map((match) => match[1]), ["Отдел", "Доступ"]);
  // «Показано N из M» — только когда отбор что-то скрыл.
  assert.doesNotMatch(toolbar, /Показано/u);

  const integrations = page("settings-integrations");
  assert.match(integrations, /data-testid="v3-settings-integrations"/u);
  assert.equal([...integrations.matchAll(/<table\b/gu)].length, 1, "one integrations table");
  // The phone cards repeat each row, so the rows are read in the table itself.
  assert.deepEqual([...integrations.match(/<table\b[\s\S]*?<\/table>/u)[0].matchAll(/data-integration="([a-z]+)"/gu)].map((match) => match[1]), ["whatsapp", "amocrm", "gemini"]);
  assert.doesNotMatch(integrations, /data-testid="v3-settings-blocking"/u, "production facts are not a warning");
  assert.doesNotMatch(integrations, /Требует внимания|v3-edge-|border-s-2/u);
  const integrationsTable = text(integrations.match(/<table\b[\s\S]*?<\/table>/u)[0]);
  assert.match(integrationsTable, /^ ?Сервис Состояние Последняя проверка Что не работает WhatsApp не подключён нет данных Входящие WhatsApp не приходят в CRM, ответить отсюда нельзя amoCRM не используется/u);
  // Блок «Подключение WhatsApp» стоит под таблицей, поэтому ссылка на него из строки не нужна: путь один — кнопка «Подключить» в блоке.
  assert.doesNotMatch(integrations, /<a class="inline-flex min-h-11[^"]*" href="\/settings\?section=integrations#whatsapp-connect">Подключить WhatsApp<\/a>/u);

  // «Подключение WhatsApp» (20.10.2026): блок под таблицей, у Администратора. Состояния WAHA нет — слова состояния нет,
  // только честное «определить не удалось»; кнопки «Подключить» и «Получить код» есть, «Отключить» и «Выйти» нет.
  assert.ok(integrations.indexOf("</table>") < integrations.indexOf('id="whatsapp-connect"'), "the block stands under the table");
  assert.match(integrations, /<section id="whatsapp-connect"[^>]*data-testid="v3-whatsapp-connect"/u);
  assert.doesNotMatch(integrations, /v3-chip/u, "an unknown WAHA state draws no chip");
  assert.match(text(integrations), /Подключение WhatsApp Привязка рабочего номера к CRM\./u);
  assert.match(text(integrations), /Состояние сейчас определить не удалось\./u);
  assert.match(integrations, /<button type="button"[^>]*>Подключить<\/button>/u);
  assert.match(integrations, /<button type="submit"[^>]*>Получить код<\/button>/u);
  assert.match(integrations, /<input id="[^"]+" type="tel" inputMode="tel" autoComplete="off"/u);
  assert.doesNotMatch(text(integrations), /Отключить|Выйти из аккаунта|Сбросить/u, "no logout, no reset");
  assert.doesNotMatch(integrations, /data-testid="v3-whatsapp-qr"|data-testid="v3-whatsapp-code"/u, "no QR or code before a request");

  const blocked = page("settings-integrations-blocked");
  assert.match(blocked, /<section id="whatsapp-connect"[^>]*data-tone="warn"/u);
  assert.doesNotMatch(blocked, /data-status=|SCAN_QR_CODE/u, "the provider word never reaches the page");
  assert.match(text(blocked), /Подключение WhatsApp Ожидает подключения/u);
  assert.match(blocked, /<span class="v3-chip t-caption" data-tone="warn"[^>]*>Ожидает подключения<\/span>/u);
  // На самих «Интеграциях» то же стоит в таблице, поэтому предупреждения над ней нет; над остальными разделами оно есть (v3-truthful-state).
  assert.equal([...blocked.matchAll(/data-testid="v3-settings-blocking"/gu)].length, 0, "the table already says it");
  assert.doesNotMatch(text(blocked), /Не работают:/u);
  const blockedTable = text(blocked.match(/<table\b[\s\S]*?<\/table>/u)[0]);
  assert.match(blockedTable, /WhatsApp заблокирован Требуется подключение WhatsApp по QR-коду\. 26\.09 14:15 Входящие WhatsApp не приходят в CRM, ответить отсюда нельзя/u);
  assert.match(blockedTable, /amoCRM заблокирована Доступ к аккаунту amoCRM не подтверждён\./u);
  assert.match(blocked, /<time dateTime="2026-09-26T08:15:00.000Z"[^>]*>26\.09 14:15<\/time>/u);
});

// «Заявки» — первыми в «Продажах» (решение владельца 28.09.2026; с Э6 до него
// — первыми в «Общем»), у каждой из трёх ролей: у куратора поступления тоже —
// маршрут ему открыт (`lead.read`), а D скрывает только доску и WhatsApp.
// Переписки — в своих отделах (решение владельца 27.09.2026 вместо одного
// пункта «Переписки» Э5): WhatsApp — в «Продажах», «Переписка» (28.09.2026) — в
// «Поступлении»; в «Общем» их нет.
test("menu: «Заявки» lead «Продажи»; WhatsApp stands in «Продажи» and «Переписка» in «Поступление»", () => {
  for (const role of ["admin", "admissions", "sales"]) {
    const html = page(`menu-${role}`);
    const common = html.match(/<section aria-label="Общее"[\s\S]*?<\/section>/u)?.[0] ?? assert.fail(`${role}: «Общее»`);
    const labels = [...common.matchAll(/<span class="min-w-0[^"]*">([^<]+)<\/span>/gu)].map((match) => match[1]);
    for (const moved of ["Переписки", "WhatsApp", "Переписка", "Заявки"]) {
      assert.equal(labels.includes(moved), false, `${role}: no «${moved}» in «Общее» (${labels})`);
    }
    assert.equal(labels[0], "Задачи", `${role}: «Задачи» lead «Общее»`);
    const menu = html.slice(0, html.indexOf('aria-label="Общее"'));
    // «Продажи» — группа с кнопкой отдела; её первый пункт — «Заявки».
    const salesGroup = menu.match(/<span class="min-w-0 flex-1">Продажи<\/span>[\s\S]*?<\/button><ul [^>]*>([\s\S]*?)<\/ul>/u)?.[1] ?? assert.fail(`${role}: «Продажи»`);
    const salesItems = [...salesGroup.matchAll(/href="(\/[^"]*)"/gu)].map((match) => match[1]);
    assert.equal(salesItems[0], "/requests", `${role}: «Заявки» lead «Продажи» (${salesItems})`);
    assert.equal([...menu.matchAll(/href="\/requests"/gu)].length, 1, `${role}: «Заявки» stand once`);
    // Отдел пункта — по порядку меню: WhatsApp — после «Воронки продаж», «Переписка» — сразу после «Воронки поступления».
    // WhatsApp виден и роли поступления (решение владельца 06.10.2026 «нет, все могут»,
    // миграция 261; src/lib/v3/navigation.ts): без работы продаж скрыта только доска.
    const order = [...menu.matchAll(/href="(\/[^"]*)"/gu)].map((match) => match[1]);
    const after = (href, previous) => order.indexOf(href) === order.indexOf(previous) + 1;
    if (role === "admissions") assert.ok(after("/inbox", "/requests"), `${role}: D leaves «Заявки» and WhatsApp; «Отчёт продаж» is a tab of «Финансы» (${order})`);
    else assert.ok(after("/pipeline", "/requests"), `${role}: the board follows «Заявки» (${order})`);
    if (role === "admissions") assert.equal(order.includes("/pipeline"), false, `${role}: the sales board is hidden without sales work (D)`);
    else assert.ok(after("/inbox", "/pipeline"), `${role}: WhatsApp in «Продажи» (${order})`);
    if (role === "sales") assert.equal(order.includes("/messages"), false, `${role}: no student chat for sales`);
    else assert.ok(after("/messages", "/admissions-pipeline"), `${role}: «Переписка» in «Поступление» (${order})`);
  }
});

test("«Календарь»: «сегодня» is a small red fill with a white figure", () => {
  const grids = source("src/components/staff/calendar/grids.tsx");
  assert.match(grids, /data-calendar-today=\{isToday \? "" : undefined\}/u);
  assert.match(grids, /isToday \? "bg-accent text-on-accent" : muted \? "text-fg-3" : "text-fg"/u);
  // Одна заливка — классом; своего правила в staff.css (прежнее тёмное пятно поверх) нет.
  assert.doesNotMatch(source("src/app/(staff)/staff.css"), /\[data-calendar-today\]/u);
});
