// Э7 (27.09.2026): одна боковая панель на всех рабочих экранах — `SidePanel`.
// Синтетические данные: имена, задачи, лиды и записи выдуманы, записей EVO здесь нет.
// Чистая логика — прямо из модуля; разметка — настоящие компоненты статических
// рендеров экранов (tests/e2e/*-static-render.cjs --json) в отдельных процессах.
// Поведение в браузере (режим, ширина, фокус, Esc, лист на телефоне) меряет тот
// же рендер в Chromium: `--f1` у students и numbers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SIDE_PANEL_SPLIT,
  SIDE_PANEL_WIDE_QUERY,
  SIDE_PANEL_WIDTH_REM,
  attributeReturn,
  queueRowReturn,
  sidePanelEscape,
  sidePanelFocusReturn,
  sidePanelReturnTarget,
  sidePanelSplit,
} from "../src/components/staff/panel/side-panel.ts";
import { BOARD_PANEL_PX } from "../src/components/staff/board/board-tracks.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const harness = (script, ...args) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL(`./e2e/${script}`, import.meta.url)), ...args],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
/** Сама панель: `<dialog data-side-panel>` до конца разметки. */
const panelOf = (html) => {
  const at = html.search(/<dialog [^>]*data-side-panel=""/u);
  return at < 0 ? "" : html.slice(at);
};
const openTag = (html) => html.match(/^<dialog [^>]*>/u)?.[0] ?? "";
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "u"))?.[1] ?? null;
const unescape = (value) => value?.replaceAll("&amp;", "&") ?? null;

/** Каждый экран с панелью записи и то, чем он её открывает. */
const HOSTS = [
  ["src/components/staff/students/StudentQuickView.tsx", "«Быстрый просмотр» «Студентов»"],
  ["src/components/staff/students/CuratorWorkloadView.tsx", "«Нагрузка кураторов»"],
  ["src/components/staff/requests/RequestsQueueView.tsx", "«Заявки»"],
  ["src/components/staff/SalesRegisterView.tsx", "«Отчёт продаж»"],
  ["src/components/staff/Pipeline.tsx", "панель лида «Воронки продаж»"],
];

const students = harness("students-static-render.cjs", "--json");
const numbers = harness("numbers-static-render.cjs", "--json-e4");

test("one panel: every record panel host renders SidePanel and no dialog of its own", () => {
  for (const [path, name] of HOSTS) {
    const source = read(path);
    assert.match(source, /import \{ SidePanel \} from "(?:\.\.\/panel|\.\/panel|@\/components\/staff\/panel)\/SidePanel";/u, `${name}: imports the shared panel`);
    assert.match(source, /<SidePanel\b/u, `${name}: renders it`);
    assert.doesNotMatch(source, /<dialog\b/u, `${name}: no dialog of its own`);
    assert.doesNotMatch(source, /\b26rem\]|w-\[400px\]/u, `${name}: no width of its own — the token`);
  }
  assert.equal(existsSync(new URL("../src/components/staff/queue/QueueDetailPanel.tsx", import.meta.url)), false, "the old queue panel is gone");
  // Во всём коде CRM разметку панели записи (`data-side-panel`) рисует только SidePanel.
  const owners = [];
  for (const root of ["src/app/(staff)", "src/components/staff"]) {
    for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true })) {
      const path = `${root}/${String(entry).split("\\").join("/")}`;
      if (!/\.tsx?$/u.test(path)) continue;
      const source = read(path);
      if (/QueueDetailPanel/u.test(source)) owners.push(`${path}: QueueDetailPanel`);
      if (/data-side-panel=""/u.test(source)) owners.push(path);
    }
  }
  assert.deepEqual(owners, ["src/components/staff/panel/SidePanel.tsx"]);
  // Список и панель — одна сетка у всех экранов-очередей.
  for (const path of ["src/components/staff/students/StudentsQueueBody.tsx",
    "src/components/staff/students/CuratorWorkloadView.tsx", "src/components/staff/requests/RequestsQueueView.tsx", "src/components/staff/SalesRegisterView.tsx"]) {
    assert.match(read(path), /sidePanelSplit\(/u, path);
  }
});

test("one width token and one breakpoint for the grid, the sheet and the board", () => {
  assert.equal(SIDE_PANEL_WIDTH_REM, 26);
  const css = read("src/app/(staff)/staff.css");
  assert.match(css, /\.v3-world \{\s*--side-panel-width: 26rem;\s*\}/u);
  assert.equal(BOARD_PANEL_PX, SIDE_PANEL_WIDTH_REM * 16, "the board reserves the same 416px");
  // Лист шага лида в карточке лида — той же ширины: токен, а не своё число.
  const drawer = read("src/components/staff/profile/LeadStepDrawer.tsx");
  assert.match(drawer, /\bmax-w-\[var\(--side-panel-width\)\]/u);
  assert.doesNotMatch(drawer, /26rem\]/u);
  // `xl` Tailwind — 80rem: запрос в JS тот же, что в CSS, и при крупном шрифте браузера.
  assert.equal(SIDE_PANEL_WIDE_QUERY, "(min-width: 80rem)");
  assert.equal(SIDE_PANEL_SPLIT, "xl:grid xl:grid-cols-[minmax(0,1fr)_var(--side-panel-width)] xl:items-start xl:gap-6");
  assert.equal(sidePanelSplit(false), undefined);
  assert.equal(sidePanelSplit(false, "mt-3"), "mt-3");
  assert.equal(sidePanelSplit(true), SIDE_PANEL_SPLIT);
  assert.equal(sidePanelSplit(true, "mt-3"), `mt-3 ${SIDE_PANEL_SPLIT}`);
  // Движение — только у листа, только при `no-preference`, не дольше 200 мс.
  const motion = css.match(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.v3-world \[data-side-panel\]:modal \{([\s\S]*?)\n\}/u);
  assert.ok(motion, "the sheet motion sits behind prefers-reduced-motion: no-preference");
  for (const [, ms] of motion[0].matchAll(/(\d+)ms/gu)) assert.ok(Number(ms) <= 200, `${ms}ms`);
  assert.doesNotMatch(css.replace(motion[0], ""), /v3-side-(?:sheet|backdrop)-in \d/u, "no panel motion outside that media query");
});

test("URL-addressable: each page keeps its own parameter, and closing drops only it", () => {
  const cases = [
    ["«Студенты»", panelOf(students.get("admin-panel")), "/profile?view=active", "К студентам"],
    ["«Нагрузка кураторов»", panelOf(students.get("curators")), "/profile?view=curators", "К нагрузке"],
    ["«Отчёт продаж»", panelOf(numbers.get("report-panel")), "/main?view=sales&year=2026&month=9", "К отчёту"],
  ];
  for (const [name, panel, closeHref, back] of cases) {
    assert.ok(panel, `${name}: the address opens the panel on the server`);
    const dialog = openTag(panel);
    assert.equal(attr(dialog, "open"), "", `${name}: <dialog open> from the server`);
    const close = panel.match(/<a data-testid="queue-detail-close"[^>]*>/u)?.[0] ?? "";
    assert.equal(unescape(attr(close, "href")), closeHref, `${name}: closing keeps the list address`);
    assert.equal(panel.match(/data-testid="queue-detail-close"/gu)?.length, 1, `${name}: one close link`);
    assert.match(panel, new RegExp(`<span class="md:hidden">${back}</span><span class="hidden md:block md:sr-only">Закрыть</span>`, "u"), `${name}: «← ${back}» on a phone, the corner «Закрыть» from 768px`);
  }
  // Открытые адреса — прежние параметры страниц.
  assert.match(students.get("admin-panel"), /href="\/profile\?view=active&amp;open=cccccccc-2222-4222-8222-000000000003"/u);
  assert.match(students.get("curators"), /href="\/profile\?view=curators&amp;coverage_curator=[^"]+#curator-coverage"/u);
  // «Отчёт продаж»: строка открывает запись просмотром (Э8.6), правка — `&edit=true` из «Исправить запись».
  assert.match(numbers.get("report-panel"), /href="\/main\?view=sales&amp;year=2026&amp;month=9&amp;record=78787878-5555-4555-8555-000000000001"/u);
  assert.match(numbers.get("report-panel"), /data-testid="sales-record-edit" href="\/main\?view=sales&amp;year=2026&amp;month=9&amp;record=78787878-5555-4555-8555-000000000002&amp;edit=true"/u);
  assert.match(read("src/components/staff/Pipeline.tsx"), /window\.history\.pushState\(null, "", href\)/u, "the board keeps ?lead= client-side");
  // Переход из «Сегодня» — те же адреса панелей.
  const today = read("src/lib/v3/today-queue.ts");
  assert.match(today, /queueHref\("\/profile", \{ view: "mine", open: row\.studentCaseId \}\)/u);
  assert.match(today, /queueHref\("\/pipeline", \{ lead: lead\.id \}\)/u);
  assert.match(today, /queueHref\(TODAY_REQUESTS_PATH, \{ source: lead\.source, open: `lead:\$\{lead\.id\}` \}\)/u);
  assert.match(today, /queueHref\("\/tasks", \{\}, \{ task: task\.id \}\)/u);
});

test("one header: record title, context line, «Открыть …», actions and close", () => {
  const headers = [
    ["«Студенты»", panelOf(students.get("admin-panel")), "Открыть дело"],
    ["«Нагрузка кураторов»", panelOf(students.get("curators")), null],
    ["«Отчёт продаж» (запись)", panelOf(numbers.get("report-panel")), null],
    ["«Отчёт продаж» (форма)", panelOf(numbers.get("report-panel-edit")), null],
  ];
  for (const [name, panel, open] of headers) {
    const header = panel.match(/<header [^>]*data-side-panel-header="">[\s\S]*?<\/header>/u)?.[0] ?? "";
    assert.ok(header, `${name}: the shared header`);
    const heading = header.match(/<h2 id="([^"]+)" tabindex="-1" data-queue-heading="" class="t-record-title break-words text-fg">/u);
    assert.ok(heading, `${name}: the record heading, t-record-title, focusable by script`);
    assert.equal(attr(openTag(panel), "aria-labelledby"), heading[1], `${name}: the heading names the panel`);
    assert.equal(panel.match(/<h2\b/gu)?.length ? panel.match(/data-queue-heading=""/gu).length : 0, 1, `${name}: one record heading`);
    if (open) assert.match(header, new RegExp(`data-side-panel-open="" href="[^"]+">${open}<svg`, "u"), `${name}: «${open}» in the header`);
  }
  // Строка контекста — у каждой панели, и у доски, и у формы «Отчёта продаж».
  for (const [name, panel] of headers) assert.match(panel.match(/<header [\s\S]*?<\/header>/u)[0], /data-side-panel-context="">/u, `${name}: a context line`);
  for (const name of ["report-panel", "report-panel-edit"]) {
    assert.match(panelOf(numbers.get(name)), /data-side-panel-context="">Сведения из записи отчёта\.(?: Текущие данные клиента и условия — в его карточке\.)?<\/div>/u, `${name}: the report form and the record view share one line`);
  }
  assert.match(panelOf(students.get("curators")), /data-side-panel-context=""><dl[^>]*><div><dt class="inline">Активных дел: <\/dt>/u, "curator workload as the context line");
  // Сплошного красного в панели нет: подтверждения — тёмные нейтральные.
  for (const [name, panel] of headers) assert.doesNotMatch(panel.split("</dialog>")[0], /(?<![\w:-])bg-accent(?![\w-])/u, name);
});

test("selected row: aria-current and the hover-free surface-2 on every list", () => {
  /** Открывающий тег строки с этим атрибутом. */
  const rowOf = (html, marker) => {
    const at = html.indexOf(marker);
    return at < 0 ? "" : html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
  };
  assert.match(rowOf(students.get("admin-panel"), 'data-queue-row="cccccccc-2222-4222-8222-000000000003"'), /\bbg-surface-2\b/u);
  assert.match(numbers.get("report-panel"), /data-selected="" class="[^"]*\bbg-surface-2\b/u);
  assert.doesNotMatch(read("src/components/staff/Pipeline.tsx"), /v3-choice/u);
  for (const [name, html] of [["students", students.get("admin-panel")], ["report", numbers.get("report-panel")]]) {
    assert.equal(html.match(/aria-current="true"/gu)?.filter(Boolean).length >= 1, true, name);
  }
});

test("focus returns to the row that was open, and only when focus had nowhere to go", () => {
  // Селекторы возврата совпадают с разметкой строк.
  assert.equal(queueRowReturn("case:abc"), '[data-queue-row="case:abc"] [data-queue-open]');
  assert.equal(queueRowReturn('a"b\\c'), '[data-queue-row="a\\"b\\\\c"] [data-queue-open]', "quotes and backslashes are escaped");
  assert.equal(attributeReturn("data-lead-link", "x1"), '[data-lead-link="x1"]');
  assert.equal(attributeReturn("id", "sale-7", "a"), '[id="sale-7"] a');
  assert.match(numbers.get("report-panel"), /<tr role="row" id="sale-78787878-5555-4555-8555-000000000001"[^>]*>[\s\S]*?<a /u);

  // Первый видимый и подключённый элемент; внутри диалога и скрытые — нет; плохой селектор — пропуск.
  const element = (name, { shown = true, connected = true, inDialog = false } = {}) => ({
    name, isConnected: connected, getClientRects: () => (shown ? [{}] : []), closest: (selector) => (selector === "dialog" && inDialog ? {} : null), focus() {},
  });
  const scope = (map) => ({ querySelectorAll(selector) { if (selector === "!bad") throw new Error("SyntaxError"); return map[selector] ?? []; } });
  const card = element("card", { shown: false });
  const rail = element("rail");
  assert.equal(sidePanelReturnTarget(scope({ "[card]": [card], "[rail]": [rail] }), ["[card]", "[rail]"]), rail, "a folded card falls back to the stage rail");
  assert.equal(sidePanelReturnTarget(scope({ "[row]": [element("inside", { inDialog: true }), element("row")] }), "[row]").name, "row");
  assert.equal(sidePanelReturnTarget(scope({ "[row]": [element("gone", { connected: false })] }), "[row]"), null);
  assert.equal(sidePanelReturnTarget(scope({ "[row]": [rail] }), ["!bad", "[row]"]), rail);
  assert.equal(sidePanelReturnTarget(scope({}), undefined), null);
  // Фокус ушёл вместе с панелью — вернуть; человек перевёл его сам — не трогать.
  const body = { isConnected: true };
  assert.equal(sidePanelFocusReturn(null, body), true);
  assert.equal(sidePanelFocusReturn(body, body), true);
  assert.equal(sidePanelFocusReturn({ isConnected: false }, body), true);
  assert.equal(sidePanelFocusReturn({ isConnected: true }, body), false);

  const panel = read("src/components/staff/panel/SidePanel.tsx");
  assert.match(panel, /useEffect\(\(\) => \(\) => \{\s*if \(sidePanelFocusReturn\(document\.activeElement, document\.body\)\) sidePanelReturnTarget\(document, returnRef\.current\)\?\.focus\(\);\s*\}, \[\]\);/u,
    "on close (unmount) the panel focuses the row it was opened from");
  assert.match(panel, /document\.getElementById\(headingId\)\?\.focus\(\{ preventScroll: true \}\);/u, "on open — the record heading");
  // Каждый экран называет свою строку.
  assert.match(read("src/components/staff/students/StudentQuickView.tsx"), /returnTo=\{queueRowReturn\(row\.studentCaseId\)\}/u);
  assert.match(read("src/components/staff/students/CuratorWorkloadView.tsx"), /returnTo=\{queueRowReturn\(selectedId\)\}/u);
  assert.match(read("src/components/staff/requests/RequestsQueueView.tsx"), /returnTo=\{queueRowReturn\(requestOpenKey\(row\)\)\}/u);
  assert.match(read("src/components/staff/SalesRegisterView.tsx"), /returnTo=\{query\.record \? attributeReturn\("id", `sale-\$\{query\.record\}`, "a"\) : undefined\}/u);
  assert.match(read("src/components/staff/Pipeline.tsx"), /\[attributeReturn\("data-lead-link", selected\.id\), attributeReturn\("data-stage-rail", selected\.stageKey\)\]/u);
  // Прежний возврат очереди ушёл в панель: одна логика, не две.
  assert.doesNotMatch(read("src/components/staff/queue/useQueueKeyboard.ts"), /previousOpenKey|row\.focus\(\)/u);
});

test("phone and narrow windows: the same dialog becomes a modal sheet; Esc and close follow one rule", () => {
  const panel = read("src/components/staff/panel/SidePanel.tsx");
  // Esc — одно правило на любой ширине: в поле панели первая Esc выводит из поля, вторая закрывает.
  assert.equal(sidePanelEscape(false, false), "close");
  assert.equal(sidePanelEscape(false, true), "close");
  assert.equal(sidePanelEscape(true, true), "leave-field");
  assert.equal(sidePanelEscape(true, false), "ignore", "a field outside the panel (list search) is not the panel's business");
  assert.match(panel, /const media = window\.matchMedia\(SIDE_PANEL_WIDE_QUERY\);[\s\S]*?const modal = !media\.matches;[\s\S]*?if \(modal\) dialog\.showModal\(\);\s*else dialog\.show\(\);/u,
    "below 1280px showModal(): top layer, inert page, focus kept inside");
  assert.match(panel, /media\.addEventListener\("change", arrange\)/u, "resizing across 1280px switches the mode without remounting");
  // `cancel` окна поверх панели («Закрыть лид», «Завершить дело») React доносит и до панели:
  // он закрывает только своё окно — панель, адрес и введённое остаются.
  assert.match(panel, /onCancel=\{\(event\) => \{(?:\s*\/\/[^\n]*)*\s*if \(event\.target !== event\.currentTarget\) return;/u,
    "a nested dialog's cancel does not close the panel");
  assert.match(panel, /onCancel=\{\(event\) => \{[\s\S]*?const step = sidePanelEscape\(typingTarget\(active\), event\.currentTarget\.contains\(active\)\);\s*if \(step === "leave-field" && event\.cancelable\) \{\s*event\.preventDefault\(\);\s*leaveField\(event\.currentTarget\);\s*return;\s*\}\s*event\.preventDefault\(\);\s*closeRef\.current\(\);/u,
    "the sheet: the first Esc in a field leaves it and keeps the input; otherwise Esc closes through the page address");
  assert.match(panel, /if \(event\.key !== "Escape" \|\| event\.defaultPrevented \|\| openPopover\(\) \|\| modalOpen\(\)\) return;[\s\S]*?const step = sidePanelEscape\(typingTarget\(event\.target\), inPanel\);\s*if \(step === "ignore"\) return;\s*event\.preventDefault\(\);\s*if \(step === "leave-field"\) leaveField\(dialog\);\s*else closeRef\.current\(\);/u,
    "beside the list: the same rule, unless a menu or dialog is on top");
  assert.match(panel, /function leaveField\(dialog: HTMLDialogElement \| null\) \{\s*dialog\?\.querySelector<HTMLElement>\("\[data-queue-heading\]"\)\?\.focus\(\{ preventScroll: true \}\);/u, "leaving a field puts focus on the record heading");
  assert.match(panel, /closeRef\.current = onClose \?\? \(\(\) => router\.push\(closeHref, \{ scroll: false \}\)\);/u);
  // Затемнение листа закрывает его; щелчок по самой панели (и её полосе прокрутки) — нет.
  assert.match(panel, /const outside = event\.clientX < box\.left \|\| event\.clientX > box\.right \|\| event\.clientY < box\.top \|\| event\.clientY > box\.bottom;\s*if \(event\.target === event\.currentTarget && outside\) closeRef\.current\(\);/u);
  // Лист: во весь экран на телефоне, шириной токена от 768 px, рядом со списком от 1280 px.
  for (const [name, html] of [["report", numbers.get("report-panel")]]) {
    const classes = attr(openTag(panelOf(html)), "class");
    assert.match(classes, /^fixed inset-0 z-50 m-0 hidden h-dvh max-h-none w-full max-w-none flex-col overflow-y-auto overscroll-contain /u, `${name}: full screen on a phone, the whole sheet scrolls`);
    assert.match(classes, /\bopen:flex\b/u, `${name}: a column while open`);
    assert.match(classes, /\bmd:w-\[var\(--side-panel-width\)\]/u, `${name}: the token from 768px (sheet and beside the list)`);
    assert.match(classes, /\bmd:overflow-hidden\b/u, `${name}: from 768px only the body scrolls`);
    assert.match(classes, /\bbackdrop:bg-black\/40\b/u, `${name}: one backdrop`);
    // Закреплённая шапка от 768 px: полоса «← К …» — только телефон, крестик — в углу шапки.
    const markup = panelOf(html);
    assert.match(markup, /<div class="sticky top-0 z-10 flex min-h-14 shrink-0 items-center border-b border-border bg-surface px-2 md:contents"><a data-testid="queue-detail-close" class="[^"]*\bmd:absolute md:end-2 md:top-2\b/u, `${name}: the corner cross from 768px`);
    assert.match(markup, /<header class="flex shrink-0 [^"]*" data-side-panel-header="">/u, `${name}: the header does not shrink or scroll`);
    assert.match(markup, /<div class="flex-1 p-4 md:min-h-0 md:overflow-y-auto md:overscroll-contain" data-side-panel-body="">/u, `${name}: the body scrolls under it`);
  }
  // Живая проверка — Chromium, `--f1`: снимки f1-*.png и путь Esc/«Закрыть» с возвратом фокуса.
  for (const script of ["students", "numbers"]) {
    assert.match(read(`tests/e2e/${script}-static-render.cjs`), /--f1/u, script);
  }
  const probe = read("tests/e2e/side-panel-probe.cjs");
  assert.match(probe, /async function journey\(page, \{ selected, returnSelector, reopen, scrolledPath, overlay = null \}\)/u);
  assert.match(probe, /Esc in a dialog over the panel closes only that dialog: the panel, its address and the typed text stay/u);
  assert.match(read("tests/e2e/students-static-render.cjs"), /dialog: '\[data-testid="v3-close-case-dialog"\]'[\s\S]*?\["students", "panel-close", OPEN_CASE, closeCase\]/u, "«Быстрый просмотр»: Esc in «Завершить дело»");
  assert.match(probe, /\["1024", \{ viewport: \{ width: 1024, height: 768 \}/u, "the tablet sheet is measured and captured");
  assert.match(probe, /the first Esc in a panel field keeps the panel open and the typed text/u);
  assert.match(probe, /from 768px the header stays put while the body scrolls/u);
  assert.match(probe, /a click on the dimmed page closes the sheet and returns focus to the row/u);
  assert.match(probe, /the page renders inside the staff CRM root/u, "the staff root is asserted, not assumed from the file name");
});

test("one vertical start: tabs and toolbars span the page above the list | panel grid", () => {
  const gridAt = (html) => html.indexOf(`<div class="${SIDE_PANEL_SPLIT}">`);
  // «Студенты» и «Нагрузка кураторов» так и было: шапка — во всю ширину над сеткой.
  const studentPage = students.get("admin-panel");
  assert.ok(gridAt(studentPage) > studentPage.indexOf('data-testid="queue-toolbar"'));
  // «Нагрузка кураторов»: форма замещения в панели 26rem — поля в одну колонку.
  const form = read("src/components/staff/profile/CuratorCoverageForm.tsx");
  assert.doesNotMatch(form, /sm:grid-cols-2/u);
  assert.match(panelOf(students.get("curators")), /<div class="grid gap-4"><label><span class="[^"]*">Заместитель<\/span>/u);
});
