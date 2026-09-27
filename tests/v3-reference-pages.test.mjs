import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { UNIVERSITY_PHOTOS } from "../src/lib/platform-university-catalog.ts";
import {
  UNIVERSITY_PAGE_SIZE,
  catalogueDueWord,
  catalogueServerPage,
  catalogueSortedPage,
  formatCatalogueDay,
  intakeDeadlineView,
  intakeStartView,
  intakeStateWord,
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
  assert.equal(intakeStateWord(intake({ status: "closed" }), NOW), "Приём закрыт");
  assert.equal(intakeStateWord(intake({ applicationDeadline: "2026-09-01" }), NOW), "Срок прошёл");
  assert.equal(intakeStateWord(intake({ applicationDeadline: "2026-12-01" }), NOW), "Приём открыт");
  assert.equal(intakeStateWord(intake({ status: "announced" }), NOW), "Набор объявлен");
  assert.equal(intakeStateWord(intake({ status: "unknown" }), NOW), null, "unconfirmed intakes are not shown (#729)");
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

test("photo credit: every licence note of the library reads in Russian; licence names and authors stay as in the source", () => {
  for (const [key, photo] of Object.entries(UNIVERSITY_PHOTOS)) {
    const license = photoLicenseRu(photo.license);
    assert.doesNotMatch(license, /embedding|license|reserved|Public domain|Rights holder/u, `${key}: ${photo.license}`);
  }
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
  assert.match(toolbar, /onChange=\{\(event\) => router\.push\(href\(\{ country: event\.target\.value \}\)/u);
  assert.match(toolbar, /onChange=\{\(event\) => router\.push\(href\(\{ level: event\.target\.value \}\)/u);
  assert.match(toolbar, /setTimeout\(\(\) => search\(value, true\), LIVE_DELAY_MS\)/u, "search runs by itself after a pause");
  // Both Malaysian bachelor filters reached the read: 13 rows, no pagination.
  assert.equal([...html.matchAll(/data-university-row=/gu)].length, 13);
  assert.doesNotMatch(html, /aria-label="Страницы каталога"/u);
});

test("university page: programmes and intakes first, then the overview; the photo smaller at the side with one Russian credit line", () => {
  for (const look of ["current", "next"]) {
    const html = page("universities-detail", look);
    const programs = html.indexOf('id="university-programs"');
    const about = html.indexOf('id="university-about"');
    const photo = html.indexOf('aria-label="Фото кампуса"');
    assert.ok(programs > 0 && about > programs && photo > about, `${look}: programmes → overview → photo`);
    assert.match(html, /<a class="inline-flex min-h-11[^"]*" href="\/v3\/universities">(?:<svg[\s\S]*?<\/svg>)?Все университеты<\/a>/u);
    assert.match(html, /data-photo-credit="">Фото: <a[^>]*>[^<]+<span class="sr-only"> \(в новой вкладке\)<\/span><\/a> · <a[^>]*>CC BY-SA 4\.0<span/u);
    assert.match(html, /aspect-\[4\/3\]/u);
    assert.match(html, /<th role="columnheader" scope="col" class="t-caption text-start text-fg-2">Срок подачи<\/th>/u);
    assert.match(html, /<td role="cell" class="t-body-compact" data-cell="deadline">[\s\S]*?<time dateTime="2026-07-17" class="font-mono tabular-nums text-fg">17\.07<\/time>/u);
    assert.match(html, />Приём закрыт</u);
    assert.match(html, />Проверено:<\/span><time dateTime="2026-09-10" class="font-mono tabular-nums">10\.09<\/time>/u);
    assert.match(html, />Бланки университета<\/a>/u);
    assert.match(html, />Предложить обновление<\/a>/u);
    assert.doesNotMatch(html.slice(html.indexOf("<main"), html.indexOf("</main>")), /(?<![:\w-])bg-accent(?![\w-])/u, "no solid red on the reference page");
  }
});

test("«Настройки»: open on «Сотрудники», one section list, no «админ» marks, one integrations table", () => {
  const staff = page("settings-staff");
  const nav = staff.match(/<nav aria-label="Разделы настроек"[\s\S]*?<\/nav>/u)[0];
  assert.deepEqual([...nav.matchAll(/<a\b[^>]*>([^<]+)<\/a>/gu)].map((match) => match[1]),
    ["Сотрудники", "Роли и доступ", "Отделы", "Интеграции", "Журнал действий", "Документы и передача", "Платформа"]);
  assert.match(nav, /<a aria-current="page"[^>]*href="\/v3\/settings\?section=staff&amp;view=people">Сотрудники<\/a>/u);
  assert.doesNotMatch(staff, /aria-label="Управление командой"|виден только администратору|>админ</u, "no second tab row, no admin marks");
  assert.match(staff, /<h3 class="t-section">Сотрудники · 5<\/h3>/u);

  const integrations = page("settings-integrations");
  assert.match(integrations, /data-testid="v3-settings-integrations"/u);
  assert.deepEqual([...integrations.matchAll(/data-integration="([a-z]+)"/gu)].map((match) => match[1]), ["whatsapp", "amocrm", "gemini"]);
  assert.doesNotMatch(integrations, /data-testid="v3-settings-blocking"/u, "production facts are not a warning");
  assert.doesNotMatch(integrations, /Требует внимания|v3-edge-|border-s-2/u);
  assert.match(text(integrations), /WhatsApp не подключён Последняя проверка: нет данных Что не работает: Входящие WhatsApp не приходят в CRM, ответить отсюда нельзя Что сделать: Подключается на сервере: вебхук и вход по QR/u);

  const blocked = page("settings-integrations-blocked");
  assert.equal([...blocked.matchAll(/data-testid="v3-settings-blocking"/gu)].length, 1, "one warning on top");
  assert.match(text(blocked), /Не работают: WhatsApp — требуется подключение WhatsApp по QR-коду; amoCRM — доступ к аккаунту amoCRM не подтверждён\./u);
  assert.match(blocked, /<time dateTime="2026-09-26T08:15:00.000Z" class="font-mono tabular-nums text-fg">26\.09 14:15<\/time>/u);
});

test("menu: «Заявки» and WhatsApp stand in «Общее» for Admin, admissions and sales, in both looks", () => {
  for (const look of ["current", "next"]) {
    for (const role of ["admin", "admissions", "sales"]) {
      const html = page(`menu-${role}`, look);
      const common = html.match(/<section aria-label="Общее"[\s\S]*?<\/section>/u)?.[0] ?? assert.fail(`${role} ${look}: «Общее»`);
      const labels = [...common.matchAll(/<span class="min-w-0[^"]*">([^<]+)<\/span>/gu)].map((match) => match[1]);
      assert.ok(labels.includes("WhatsApp"), `${role} ${look}: WhatsApp in «Общее» (${labels})`);
      assert.equal(labels[0], "Заявки", `${role} ${look}: «Заявки» leads «Общее»`);
      const menu = html.slice(0, html.indexOf('aria-label="Общее"'));
      assert.doesNotMatch(menu, /href="\/v3\/(?:requests|inbox)"/u, `${role} ${look}: no department group holds them`);
    }
  }
});

test("«Календарь»: «сегодня» is a small red fill only in the new look", () => {
  const css = source("src/app/(v3)/v3.css");
  assert.match(css, /\.v3-world\[data-look="next"\] \[data-calendar-today\] \{\s*background: var\(--accent\);\s*color: var\(--on-accent\);\s*\}/u);
  assert.doesNotMatch(css.replace(/\.v3-world\[data-look="next"\] \[data-calendar-today\]/gu, ""), /\[data-calendar-today\]/u, "the current look keeps its dark mark");
  assert.match(source("src/components/v3/calendar/grids.tsx"), /data-calendar-today=\{isToday \? "" : undefined\}/u);
});
