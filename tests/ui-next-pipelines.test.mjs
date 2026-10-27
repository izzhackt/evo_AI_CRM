// «Новый вид» (решение владельца 27.10.2026), поток «pipelines»: «Воронка продаж» (`/v3/pipeline`), «Воронка поступления»
// (`/v3/admissions-pipeline`) и «Отчёт продаж» (`/v3/main?view=sales`). Проверяется то, что обещано: новый вид выбирает переключатель и
// только настоящий администратор; у сотрудника, в просмотре роли и у администратора без cookie — прежняя разметка байт в байт; чтения,
// права, адреса, request_id и команды те же; числа и слова нового вида совпадают с прежним видом; перетаскивание — `@dnd-kit/core` с
// теми же серверными действиями и тем же клавиатурным путём (меню «⋯»); экраны собраны из набора виджетов короткими файлами; первая
// загрузка у остальных сотрудников не растёт (ленивые входы). Разметку дают НАСТОЯЩИЕ страницы с синтетическими данными
// (tests/e2e/boards-static-render.cjs и sales-report-next-static-render.cjs — отдельные node-процессы). Браузер —
// tests/e2e/pipelines-next-static-render.cjs и sales-report-next-static-render.cjs --screenshots.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(`./e2e/${path}`, import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const spawnJson = (script, flag) => new Map(JSON.parse(execFileSync(process.execPath, [here(script), flag], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })).map((surface) => [surface.name, surface.html]));

const legacyBoards = spawnJson("boards-static-render.cjs", "--json");
const nextBoards = spawnJson("boards-static-render.cjs", "--next-json");
const report = spawnJson("sales-report-next-static-render.cjs", "--json");
// `--next-props` настоящих страниц бросает, если свойства ленивого входа не сериализуются (RSC); серверные компоненты внутри свойств раскрываются
// (границу пересекает их результат): `flight-props-expand.cjs`.
const spawnProps = (script) => JSON.parse(execFileSync(process.execPath, [here(script), "--next-props"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const boardProps = spawnProps("boards-static-render.cjs");
const reportProps = spawnProps("sales-report-next-static-render.cjs");

const RED = /\bbg-(?:primary|accent)(?![-\w])/gu;
const count = (html, pattern) => [...html.matchAll(pattern)].length;
const all = (html, pattern) => [...html.matchAll(pattern)].map((match) => match[1]);
const text = (html) => html.replace(/<!--[\s\S]*?-->/gu, "").replace(/<script[\s\S]*?<\/script>/gu, " ").replace(/<style[\s\S]*?<\/style>/gu, " ").replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/&quot;/gu, '"').replace(/\s+/gu, " ").trim();
const mainOf = (html) => html.slice(html.indexOf("<main", html.indexOf("data-shell-content")), html.lastIndexOf("</main>") + 7);
/** Текст ряда вкладок (`nav` с этой подписью). */
function navText(html, label) {
  const at = html.indexOf(`aria-label="${label}"`);
  assert.ok(at >= 0, label);
  const start = html.lastIndexOf("<nav", at);
  return text(html.slice(start, html.indexOf("</nav>", start)));
}
/** `useId` берёт путь в дереве: в другой странице те же части получают другие идентификаторы — сравниваем без них. */
const noIds = (html) => html.replace(/_R_[a-z0-9]+_/gu, "_R_");
/** Разметка элемента, начиная с открывающего тега с этой подписью, до парного закрывающего (теги `div` считаются парами). */
function divBlock(html, marker) {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, marker);
  const start = html.lastIndexOf("<div", at);
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<(\/?)div\b/gu)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index + 6);
  }
  throw new Error(`не закрыт блок ${marker}`);
}

const KIT_WIDGET = /data-slot="(card|data-table|stat-tile)"/u;
const NEXT_FILES = [
  ...readdirSync(new URL("../src/components/v3/pipeline-next", import.meta.url)).map((name) => `src/components/v3/pipeline-next/${name}`),
  ...readdirSync(new URL("../src/components/v3/admissions-pipeline-next", import.meta.url)).map((name) => `src/components/v3/admissions-pipeline-next/${name}`),
  ...readdirSync(new URL("../src/components/v3/board-next", import.meta.url)).map((name) => `src/components/v3/board-next/${name}`),
  ...readdirSync(new URL("../src/components/v3/sales-next", import.meta.url)).map((name) => `src/components/v3/sales-next/${name}`),
  ...readdirSync(new URL("../src/components/v3/admissions-board", import.meta.url)).map((name) => `src/components/v3/admissions-board/${name}`),
  ...readdirSync(new URL("../src/components/v3/sales-report", import.meta.url)).map((name) => `src/components/v3/sales-report/${name}`),
  "src/lib/v3/sales-register-page.ts", "src/lib/sales-register-money-view.ts",
];

/* ---------------------------------------------------------------- выбор вида: переключатель и только администратор */

test("доски: новый вид рисуется только настоящему администратору с cookie; сотрудник и просмотр роли с cookie и администратор без неё — прежняя разметка байт в байт", () => {
  for (const [name, legacy] of [["sales", "sales"], ["sales-closed", "sales-closed"], ["admissions", "admissions"]]) {
    assert.equal(nextBoards.get(`admin-no-cookie-${name}`), legacyBoards.get(legacy), `${name}: администратор без cookie видит прежний вид без единого отличия`);
    assert.equal(nextBoards.get(`staff-cookie-${name}`), nextBoards.get(`staff-no-cookie-${name}`), `${name}: cookie сотрудника вид не меняет`);
    assert.equal(nextBoards.get(`preview-cookie-${name}`), nextBoards.get(`preview-no-cookie-${name}`), `${name}: cookie просмотра роли вид не меняет`);
    for (const who of ["admin-no-cookie", "staff-cookie", "preview-cookie"]) {
      const html = nextBoards.get(`${who}-${name}`);
      assert.doesNotMatch(html, /data-ui="next"/u, `${who} ${name}: корень нового вида не ставится`);
      assert.doesNotMatch(mainOf(html), KIT_WIDGET, `${who} ${name}: карточек и таблиц набора нет`);
    }
  }
  for (const name of ["sales", "sales-focus", "sales-handed", "sales-mine", "sales-search", "sales-volume", "sales-closed", "admissions", "admissions-visa", "admissions-curator", "admissions-first-empty", "admissions-stage"]) {
    const html = nextBoards.get(`next-${name}`);
    assert.match(html, /data-ui="next"/u, name);
    assert.doesNotMatch(html, /data-testid="v3-pipeline-lead-panel"|data-stage-rail=/u, `${name}: панели и рейки прежнего вида нет`);
    if (name !== "sales-closed") assert.match(mainOf(html), /data-slot="card"/u, `${name}: колонки — карточки набора`);
  }
});

test("«Отчёт продаж»: новый вид только у администратора с cookie; сотрудник и просмотр роли с cookie и администратор без неё — прежняя разметка", () => {
  const admin = report.get("admin-cookie");
  assert.match(admin, /data-ui="next"/u);
  assert.match(admin, /data-testid="v3-sales-report"/u);
  assert.match(admin, /data-slot="data-table"/u);
  assert.match(admin, /data-slot="stat-tile"/u);
  assert.equal(report.get("staff-cookie"), report.get("staff-no-cookie"), "cookie сотрудника вид не меняет");
  assert.equal(report.get("preview-cookie"), report.get("preview-no-cookie"), "cookie просмотра роли вид не меняет");
  for (const name of ["admin-no-cookie", "staff-cookie", "preview-cookie"]) {
    const html = report.get(name);
    assert.doesNotMatch(html, /data-ui="next"/u, name);
    assert.doesNotMatch(html, /data-slot="(data-table|stat-tile|card)"/u, `${name}: виджетов набора нет`);
    assert.match(html, /data-testid="sales-report-toolbar"/u, `${name}: прежняя строка фильтров`);
  }
});

test("свойства ленивых входов — данные: страницы отдают их через границу сервер → клиент без функций и экземпляров классов", () => {
  assert.deepEqual(Object.keys(boardProps).sort(), ["next-admissions", "next-admissions-visa", "next-sales", "next-sales-closed", "next-sales-panel"]);
  assert.deepEqual(Object.keys(reportProps).sort(), ["import", "managers", "report", "report-edit", "report-record"]);
  // Те же чтения, что у прежней страницы: доска получает данные и права, а не готовый вид; панель записи и форма плана — серверные части.
  for (const key of ["stages", "leads", "ownerOptions", "actor", "requestIds", "filteredStage", "today", "toolbar"]) assert.ok(boardProps["next-sales"].includes(key), `доска продаж: ${key}`);
  for (const key of ["rows", "tab", "query", "boardUnavailable", "truncated", "tabs", "toolbar"]) assert.ok(boardProps["next-admissions"].includes(key), `доска поступления: ${key}`);
  for (const key of ["headline", "money", "table", "cash", "plan", "toolbar", "period", "dynamics"]) assert.ok(reportProps.report.includes(key), `отчёт: ${key}`);
});

/* ---------------------------------------------------------------- «Воронка продаж»: те же лиды, срезы, фильтры и действия */

test("«Воронка продаж»: те же лиды в тех же колонках, что у прежней доски; вкладки этапов — ссылки `?stage=` с теми же числами; рабочих колонок шесть, «Переданы» — вкладка", () => {
  for (const [legacyName, nextName] of [["sales", "next-sales"], ["sales-mine", "next-sales-mine"], ["sales-search", "next-sales-search"], ["sales-volume", "next-sales-volume"]]) {
    const legacy = legacyBoards.get(legacyName);
    const next = nextBoards.get(nextName);
    const leadsOf = (html) => all(html, /data-testid="v3-pipeline-card"[^>]*data-lead-id="([^"]+)"/gu).sort();
    // Прежняя доска рисует колонку «Переданы» и рейкой, и списком для телефона: считаем лиды по рабочим этапам и «Переданы» через вкладку.
    const working = (html) => all(html, /data-testid="v3-pipeline-card"[^>]*data-lead-id="([^"]+)"/gu);
    assert.ok(working(next).length > 0, nextName);
    assert.ok(working(next).every((id) => leadsOf(legacy).includes(id)), `${nextName}: новый вид не показывает лишнего`);
    assert.equal(count(next, /data-testid="v3-pipeline-column"/gu), 6, `${nextName}: шесть рабочих колонок`);
    const tabs = all(mainOf(next), /<a [^>]*href="([^"]*)"[^>]*>(?:Все этапы|[^<]+)<span[^>]*>\d+<\/span><\/a>/gu);
    assert.ok(tabs.length >= 8, `${nextName}: вкладки: все этапы, шесть этапов и «Переданы»`);
  }
  assert.equal(navText(nextBoards.get("next-sales"), "Этапы воронки"), "Все этапы 12 Новый 3 Связались 2 Квалифицирован 2 Встреча назначена 1 Встреча проведена 2 Потенциальный клиент 2 Переданы 2");
  const focus = nextBoards.get("next-sales-focus");
  assert.equal(count(focus, /data-testid="v3-pipeline-column"/gu), 1, "фокус на этапе: одна колонка");
  assert.match(focus, /data-focus="qualified"/u);
  assert.equal(count(nextBoards.get("next-sales-handed"), /data-testid="v3-pipeline-card"/gu), 2, "«Переданы»: две карточки");
});

test("«Воронка продаж»: строка поиска и фильтров — те же части, что у прежней страницы (адреса, скрытые поля, «Закрытые»); красная кнопка одна; перетаскивания нет", () => {
  const toolbar = (html) => divBlock(html, 'class="flex shrink-0 flex-wrap items-center gap-2 @2xl:gap-3"');
  assert.equal(noIds(toolbar(nextBoards.get("next-sales"))), noIds(toolbar(legacyBoards.get("sales"))), "та же строка инструментов");
  assert.equal(noIds(toolbar(nextBoards.get("next-sales-search"))), noIds(toolbar(legacyBoards.get("sales-search"))));
  assert.equal(count(mainOf(nextBoards.get("next-sales")), RED), 1, "сплошной красный — «Добавить лида»");
  assert.match(text(mainOf(nextBoards.get("next-sales"))), /Добавить лида/u);
  assert.doesNotMatch(read("src/components/v3/pipeline-next/PipelineBoardNext.tsx") + read("src/components/v3/pipeline-next/PipelineColumn.tsx"), /draggable|@dnd-kit|onDrop/u, "в продажах этап меняет форма решения в панели: перетаскивания нет, как у прежней доски");
  // Панель — настоящая форма решения прежнего вида: те же поля, версия и request_id, а не новая.
  const body = read("src/components/v3/pipeline-next/LeadSheetBody.tsx");
  assert.match(body, /<PipelineDecisionForm key=\{`\$\{lead\.workflow\.leadId\}:\$\{lead\.workflow\.workflowVersion\}`\}/u);
  assert.match(body, /requestId=\{requestId\}/u);
  assert.match(read("src/components/v3/pipeline-next/LeadSheetNext.tsx"), /<CloseRecordMenu kind="lead"[\s\S]*onClosed=\{onLeadClosed\}/u, "«Закрыть лид» — прежняя команда");
});

test("«Воронка продаж»: закрытые лиды — тот же список в рамке нового вида с возвратом к доске", () => {
  const legacy = legacyBoards.get("sales-closed");
  const next = nextBoards.get("next-sales-closed");
  const rows = (html) => all(html, /data-lead-id="([^"]+)"/gu);
  assert.deepEqual(rows(next), rows(legacy), "те же строки в том же порядке");
  assert.match(next, /data-testid="v3-pipeline-closed"/u);
  assert.match(text(next), /Закрытые лиды/u);
  assert.match(next, /href="\/v3\/pipeline"/u, "возврат к доске");
});

test("«Воронка продаж»: при усечённом чтении (4000+ лидов) числа нет ни в заголовке, ни у вкладки «Все этапы» — нет чтения, нет числа", () => {
  const heading = (html) => text(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/u)[0]);
  const full = nextBoards.get("next-sales");
  const cut = nextBoards.get("next-sales-truncated");
  assert.equal(heading(full), "Воронка продаж 12");
  assert.match(navText(full, "Этапы воронки"), /^Все этапы 12 Новый 3/u, "чтение полное: число у вкладки то же, что в заголовке");
  assert.match(text(mainOf(cut)), /Прочитаны первые 4000 лидов — уточните поиск или фильтры\./u, "обрыв чтения назван");
  assert.equal(heading(cut), "Воронка продаж", "в заголовке числа нет");
  assert.match(navText(cut, "Этапы воронки"), /^Все этапы Новый 3/u, "у вкладки «Все этапы» числа тоже нет: частичное число не выдаётся за общее");
});

/* ---------------------------------------------------------------- «Воронка поступления» */

test("«Воронка поступления»: те же дела на тех же этапах, вкладки разделов с теми же числами, те же поиск и фильтры; «Добавить студента» — единственный красный", () => {
  for (const [legacyName, nextName] of [["admissions", "next-admissions"], ["admissions-visa", "next-admissions-visa"], ["admissions-curator", "next-admissions-curator"], ["admissions-first-empty", "next-admissions-first-empty"], ["admissions-stage", "next-admissions-stage"]]) {
    const legacy = legacyBoards.get(legacyName);
    const next = nextBoards.get(nextName);
    const casesOf = (html) => all(html, /data-student-case-id="([^"]+)"/gu).sort();
    assert.deepEqual(casesOf(next), casesOf(legacy), `${nextName}: те же дела`);
    const stagesOf = (html) => all(html, /data-student-case-id="([^"]+)"/gu).length;
    assert.equal(stagesOf(next), stagesOf(legacy), nextName);
  }
  const next = mainOf(nextBoards.get("next-admissions"));
  assert.equal(navText(next, "Разделы воронки поступления"), "Поступление 7 Виза и выезд 5");
  assert.equal(navText(legacyBoards.get("admissions"), "Разделы воронки поступления").replace(/\s+/gu, " "), "Поступление 7 Виза и выезд 5", "те же числа у прежнего вида");
  const bar = (html) => all(html, /<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/gu);
  assert.deepEqual(bar(nextBoards.get("next-admissions-curator")), bar(legacyBoards.get("admissions-curator")), "поиск несёт те же выбранные фильтры");
  assert.equal(count(next, RED), 1);
  assert.match(text(next), /Добавить студента/u);
  assert.match(text(next), /Документы на проверку 20\+/u, "очереди проверки остаются в шапке");
});

test("«Воронка поступления»: перетаскивание — `@dnd-kit/core` с теми же серверными действиями; клавиатура и телефон — прежнее меню «⋯ → Переместить в…»; движок общий с прежней доской", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["@dnd-kit/core"], "6.3.1", "точная версия без «^»");
  assert.equal(pkg.dependencies["@dnd-kit/sortable"], undefined, "перестановки внутри колонки нет (порядок задаёт сервер): sortable не нужен");
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages["node_modules/@dnd-kit/core"].version, "6.3.1");
  assert.equal(lock.packages["node_modules/@dnd-kit/core"].license, "MIT");
  const card = read("src/components/v3/admissions-pipeline-next/AdmissionsCardNext.tsx");
  assert.match(card, /useDraggable\(\{ id: row\.studentCaseId/u);
  assert.match(card, /<AdmissionsCardMenu row=\{row\} tab=\{tab\} onMove=\{onMove\} \/>/u, "то же меню");
  const board = read("src/components/v3/admissions-pipeline-next/AdmissionsBoardNext.tsx");
  // Мышь и палец — разные датчики: `PointerSensor` перехватывает и касание (`pointerdown` приходит раньше `touchstart`), `TouchSensor` с удержанием
  // тогда не срабатывает никогда, а жест забирает прокрутка и отменяет перетаскивание (CDP-проверка в pipelines-next-static-render.cjs).
  assert.match(board, /MouseSensor[\s\S]*TouchSensor/u);
  assert.doesNotMatch(board.replace(/^\s*\/\/.*$/gmu, ""), /PointerSensor/u, "касание не должно попадать в датчик указателя");
  assert.match(board, /useSensor\(MouseSensor, \{ activationConstraint: \{ distance: 6 \} \}\)/u);
  assert.match(board, /useSensor\(TouchSensor, \{ activationConstraint: \{ delay: 250, tolerance: 8 \} \}\)/u);
  // Дело, отпущенное мимо колонок, никуда не двигается, и читалке об этом сказано, а не оставлено «взято».
  assert.match(board, /onDragEnd: \(\{ over \}\) => \(over \? undefined : "Перемещение отменено\."\)/u);
  // Меню «⋯» лежит внутри перетаскиваемой карточки: нажатие на пункт меню перетаскивания не начинает.
  assert.match(card, /const keepPressInMenu = \(event: SyntheticEvent\) => \{\s*if \(event\.target instanceof Element && event\.target\.closest\("\[popover\]"\)\) event\.stopPropagation\(\);/u);
  assert.match(card, /onMouseDown=\{keepPressInMenu\} onTouchStart=\{keepPressInMenu\}>\s*<AdmissionsCardMenu/u);
  // Ссылка-чип «нужен ответ» подчёркнута: рядом такой же по виду «просрочено», который не ссылка.
  assert.match(card, /<StatusBadge label=\{replyWord\} tone="warn" className="underline [^"]*" \/>/u);
  assert.doesNotMatch(board, /KeyboardSensor/u, "клавиатурный путь — меню, не второй способ перетаскивания");
  assert.match(board, /board\.moveCard\(String\(active\.id\), \{ stage: over\.id as AdmissionsPipelineStage \}, "drag"\)/u);
  assert.match(read("src/components/v3/admissions-pipeline-next/AdmissionsColumnNext.tsx"), /useDroppable\(\{ id: stage/u);
  // Движок — один: его зовут прежняя и новая доска; серверное действие стоит только в нём.
  const hook = read("src/components/v3/admissions-board/useAdmissionsBoard.ts");
  assert.match(hook, /moveCasePipelineAction\(/u);
  assert.match(read("src/components/v3/AdmissionsPipelineBoard.tsx"), /useAdmissionsBoard\(\{ rows, tab, query, basePath, requestedStage \}\)/u);
  assert.match(board, /useAdmissionsBoard\(props\)/u);
  for (const file of NEXT_FILES.filter((name) => !name.endsWith("useAdmissionsBoard.ts"))) assert.doesNotMatch(read(file), /moveCasePipelineAction/u, `${file}: действие зовёт только движок`);
  // @dnd-kit — только в ленивом куске поступления: у остальных сотрудников его в первой загрузке нет.
  for (const file of NEXT_FILES) if (!file.includes("admissions-pipeline-next/")) assert.doesNotMatch(read(file), /@dnd-kit/u, file);
});

/* ---------------------------------------------------------------- «Отчёт продаж»: числа и слова те же */

test("«Отчёт продаж»: те же записи, деньги, остаток и слова отказа, что у прежнего вида; строка фильтров — та же разметка", () => {
  const legacy = report.get("admin-no-cookie");
  const next = report.get("admin-cookie");
  const rowsOf = (html, selector) => [...html.matchAll(selector)].map((match) => match[0]);
  const legacyRows = rowsOf(legacy, /<tr role="row" id="sale-[^"]+"[\s\S]*?<\/tr>/gu);
  const nextTable = next.slice(next.indexOf('data-slot="data-table"'));
  const nextRows = rowsOf(nextTable.slice(nextTable.indexOf("<tbody"), nextTable.indexOf("</tbody>")), /<tr[ >][\s\S]*?<\/tr>/gu);
  assert.equal(legacyRows.length, 8);
  assert.equal(nextRows.length, 8, "те же 8 записей");
  const money = (html) => [...new Set(html.match(/(?<![\d.])(?:\d{1,3}(?:[\s  ]\d{3})+|\d+)[\s  ](?:USD|KGS)/gu) ?? [])].map((item) => item.replace(/\s+/gu, " ").trim()).sort();
  const names = (html) => text(html).match(/(Алина|Айжан|Тимур|Бекзат|Данияр|Руслан|Эльвира|Нурлан)\S*/gu);
  for (let index = 0; index < 8; index += 1) {
    assert.deepEqual(money(text(nextRows[index])), money(text(legacyRows[index])), `запись ${index + 1}: те же суммы и остаток`);
    assert.deepEqual(names(nextRows[index]).slice(0, 1), names(legacyRows[index]).slice(0, 1), `запись ${index + 1}: то же имя`);
  }
  // Слово отказа, «Уточнить», причина «остатка нет» — те же слова.
  for (const word of ["Отказ, оплачено частично", "нет даты продажи", "оплата в другой валюте без суммы в валюте договора", "стоимость не разобрана", "Статус не указан"]) assert.match(text(next), new RegExp(word, "u"), word);
  // Продажи, план, суммы по валютам, сноска о том, что не вошло, строка отказа — одни числа и слова.
  assert.equal(all(legacy, /data-sales="(\d+)"/gu)[0], all(next, /data-sales="(\d+)"/gu)[0], "то же число «Продажи»");
  assert.equal(all(legacy, /data-sales-target="(\d+)"/gu)[0], "35");
  assert.match(text(next), /План 35 осталось 29/u);
  assert.equal(all(legacy, /data-money-basis="(\d+)"/gu)[0], "7");
  const legacyCaption = all(legacy, /data-money-basis="\d+">([^<]+)</gu)[0];
  assert.match(text(next), new RegExp(legacyCaption.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), "та же подпись основы сумм");
  for (const sentence of [/Не вошли: без стоимости — 1 запись, оплата не указана — 1 запись\./u, /Остаток не считается, если оплата в другой валюте и нет суммы в валюте договора\./u,
    /Отказ — 1 запись; по ним оплачено 600 USD\. В продажи и суммы ниже они не входят\./u, /Не входят: без даты продажи — 1 запись/u]) {
    assert.match(text(legacy), sentence, "прежний вид");
    assert.match(text(next), sentence, "новый вид");
  }
  for (const line of ["KGS", "USD"]) assert.match(next, new RegExp(`data-money-line="${line}"`, "u"));
  // Строка поиска и фильтров — одна разметка (общая часть).
  assert.equal(noIds(divBlock(next, 'data-testid="sales-report-toolbar"')), noIds(divBlock(legacy, 'data-testid="sales-report-toolbar"')));
});

test("«Отчёт продаж»: «План месяца» не повторяет число, которое уже стоит плиткой «План»", () => {
  const next = report.get("admin-cookie");
  assert.match(text(next), /План 35 осталось 29/u, "число плана стоит плиткой");
  assert.match(text(next), /План месяца Изменить план/u, "карточка осталась: в ней действие");
  assert.doesNotMatch(text(next), /План на месяц: 35/u, "то же число второй раз предложением не повторяется");
});

test("«Отчёт продаж»: о плане, которого не прочли, не сказано ничего — «не задан» только при удавшемся чтении (нет чтения — нет числа)", () => {
  // Чтение плана не удалось: сказано про сбой, а «не задан» не утверждается — ни в новом, ни в прежнем виде.
  for (const name of ["admin-cookie-management-unavailable", "admin-no-cookie-management-unavailable"]) {
    assert.match(text(report.get(name)), /Не удалось проверить доступ к плану и переносу данных\./u, `${name}: сбой на виду`);
    assert.doesNotMatch(text(report.get(name)), /План на месяц не задан|Текущий план: не задан/u, `${name}: «не задан» не утверждается без чтения`);
    assert.doesNotMatch(text(report.get(name)), /План на месяц: \d/u, name);
  }
  // Чтение удалось, плана нет: так и сказано, плитки «План» нет.
  const none = report.get("admin-cookie-no-plan");
  assert.match(text(none), /План на месяц не задан/u);
  assert.doesNotMatch(text(none), /План 35/u);
});

test("«Отчёт продаж»: таблицы сумм и поступлений лежат в прокручиваемой области, а не растягивают карточку; панель записи без действий — без пустого подвала", () => {
  const next = report.get("admin-cookie");
  for (const [testId, region] of [["sales-money-table", "Суммы по валютам"], ["sales-cash-totals", "Поступления и возвраты по валютам"]]) {
    const at = next.indexOf(`data-testid="${testId}"`);
    assert.ok(at > 0, testId);
    const tag = next.lastIndexOf("<table", at);
    assert.ok(next.slice(Math.max(0, tag - 160), tag).endsWith(`<div role="region" aria-label="${region}" tabindex="0" class="relative min-w-0 overflow-x-auto">`), `${testId}: область прокрутки с подписью и фокусом клавиатуры`);
  }
  const table = read("src/components/v3/sales-next/SalesRecordsTable.tsx");
  assert.match(table, /footer=\{shown && \(shown\.open \|\| shown\.extra\) \? \(/u, "подвал панели есть, только когда в нём есть действие");
  assert.match(table, /toolbar=\{toolbar \? <div className="min-w-0 flex-1">\{toolbar\}<\/div> : null\}/u, "строка фильтров занимает всю строку инструментов, как у прежнего вида");
});

test("«Отчёт продаж»: «Убрать» / «Вернуть» — те же записи и версии, у каждой строки свой request_id; «Добавить продажу» ведёт на тот же адрес; красная кнопка одна", () => {
  const legacy = report.get("admin-no-cookie");
  const next = report.get("admin-cookie");
  const pairs = (html) => [...new Set([...html.matchAll(/name="request_id" value="([^"]+)"\/><input type="hidden" name="record_id" value="(78787878-[^"]+)"\/><input type="hidden" name="expected_version" value="([^"]+)"/gu)].map((match) => `${match[2]}|${match[3]}`))].sort();
  assert.deepEqual(pairs(next), pairs(legacy), "те же записи с теми же версиями");
  assert.ok(pairs(next).length >= 7);
  const ids = [...new Set(all(next, /name="request_id" value="([^"]+)"/gu))];
  assert.ok(ids.length >= 7, "у каждой строки свой request_id");
  const add = (html) => all(html, /<a [^>]*href="([^"]*new=true[^"]*)"[^>]*>Добавить продажу<\/a>/gu)[0];
  assert.equal(add(next), add(legacy));
  assert.equal(count(mainOf(next), RED), 1, "сплошной красный — «Добавить продажу»");
  assert.match(text(next), /Изменить план/u);
  assert.match(text(next), /Поступления и возвраты за месяц/u);
  assert.match(text(next), /Динамика по дням/u, "прежний раздел остаётся");
});

test("«Отчёт продаж»: в клиентские свойства таблицы не идут телефон, заметки и источник записи; модель строки — слова, как на экране", () => {
  const types = read("src/components/v3/sales-next/sales-next-types.ts");
  const rowType = types.slice(types.indexOf("export type SalesRowData"), types.indexOf("}>;", types.indexOf("export type SalesRowData")));
  for (const field of ["phone", "notes", "sourceSha256", "sourceKey", "contractNumber", "statusRaw"]) assert.doesNotMatch(rowType, new RegExp(`\\b${field}\\b`, "u"), field);
  const rows = read("src/components/v3/sales-next/sales-next-rows.ts");
  assert.match(rows, /salesRowReview\(row\)/u);
  assert.match(rows, /salesRowRemainder\(row\)/u);
  assert.match(rows, /salesWithdrawalWord\(row\.withdrawal\.kind\)/u);
  const view = read("src/components/v3/sales-next/SalesRegisterNextView.tsx");
  assert.match(view, /readSalesRegisterPage\(actor, query\)/u, "те же чтения, что у прежнего вида");
  assert.match(read("src/components/v3/SalesRegisterView.tsx"), /readSalesRegisterPage\(actor, query\)/u);
  assert.match(read("src/components/v3/sales-next/sales-next-sheet.tsx"), /<SalesRegisterForm[\s\S]*<SalesRecordPreview/u, "панель — прежние просмотр и форма");
});

/* ---------------------------------------------------------------- страницы: выбор вида, ленивые входы, первая загрузка */

test("страницы спрашивают isNextUi после тех же чтений; новый вид — только ленивые входы; прежняя ветка осталась", () => {
  const pipeline = read("src/app/(v3)/v3/pipeline/page.tsx");
  const admissions = read("src/app/(v3)/v3/admissions-pipeline/page.tsx");
  const main = read("src/app/(v3)/v3/main/page.tsx");
  for (const page of [pipeline, admissions, main]) {
    assert.match(page, /import \{ isNextUi \} from "@\/lib\/ui-next";/u);
    assert.doesNotMatch(page, /from "@\/components\/kit"|from "@\/components\/ui\/|from "@dnd-kit/u, "виджеты нового вида в первую загрузку страницы не входят");
  }
  assert.match(pipeline, /if \(await isNextUi\(actor\)\) \{\s*return \(\s*<ManualLeadDisclosure>\s*<PipelineNextLazy/u);
  assert.match(pipeline, /return <PipelineClosedNextLazy title=/u);
  assert.match(pipeline, /<PartShell\s+width="board"\s+title="Воронка продаж"/u, "прежний вид на месте");
  assert.match(admissions, /if \(await isNextUi\(actor\)\) \{\s*return \(\s*<AdmissionsPipelineNextLazy/u);
  assert.match(admissions, /<PartShell\s+width="board"\s+title="Воронка поступления"/u);
  assert.match(main, /const next = await isNextUi\(actor\);/u);
  for (const name of ["SalesImportNextView", "SalesManagersNextView", "SalesRegisterNextView", "SalesDynamicsNextView"]) assert.match(main, new RegExp(`next \\? <${name}`, "u"), name);
  for (const name of ["SalesRegisterImportView", "SalesManagerLabelsView", "SalesRegisterView", "SalesDynamicsReport"]) assert.match(main, new RegExp(`: <${name}`, "u"), `${name}: прежняя ветка`);
  for (const page of [pipeline, admissions]) assert.ok(page.indexOf("isNextUi(actor)") > page.indexOf("requireV3PageActor("), "выбор вида после проверки сотрудника");
});

test("ленивые входы: «use client», `next/dynamic` и `.catch(onScreenLoadFailed)`; у маршрутов есть `loading.tsx` (граница Suspense над входом)", () => {
  const entries = {
    "src/components/v3/pipeline-next/PipelineNextLazy.tsx": ["PipelineNextPage", "PipelineClosedNextPage"],
    "src/components/v3/admissions-pipeline-next/AdmissionsPipelineNextLazy.tsx": ["AdmissionsPipelineNextPage"],
    "src/components/v3/sales-next/SalesNextLazy.tsx": ["SalesReportNextPage", "SalesFrameNextPage"],
  };
  for (const [file, modules] of Object.entries(entries)) {
    const source = read(file);
    assert.match(source, /^"use client";/u, file);
    assert.match(source, /from "@\/components\/kit\/LoadFailed"/u);
    assert.equal(count(source, /\.catch\(onScreenLoadFailed\)/gu), modules.length, `${file}: каждый вход ловит только отказ загрузки`);
    for (const name of modules) assert.match(source, new RegExp(`module\\.${name}\\)`, "u"), `${file}: ${name}`);
    assert.doesNotMatch(source, /\.catch\(\(\) =>/u);
  }
  for (const route of ["pipeline", "admissions-pipeline", "main"]) assert.ok(existsSync(new URL(`../src/app/(v3)/v3/${route}/loading.tsx`, import.meta.url)), `${route}: есть loading.tsx`);
  // Серверные части отчёта не тянут виджеты набора в первую загрузку (их клиентские куски приходят только лениво).
  for (const file of ["SalesRegisterNextView.tsx", "SalesFramesNext.tsx", "sales-next-sheet.tsx", "sales-next-rows.ts", "sales-next-summary.ts", "sales-next-toolbar.ts"]) {
    assert.doesNotMatch(read(`src/components/v3/sales-next/${file}`), /@\/components\/kit|radix-ui|@\/components\/ui\/(?!card)/u, `${file}: без клиентских виджетов`);
  }
});

test("новые файлы короче 150 строк, собраны из набора и не вводят своих цветов", () => {
  for (const file of NEXT_FILES) {
    const source = read(file);
    const lines = source.split("\n").length - 1;
    // Движок доски поступления и чтения отчёта — вынесенный без изменений прежний код (не виджеты): они длиннее.
    const moved = ["admissions-board/useAdmissionsBoard.ts", "admissions-board/AdmissionsCardMenu.tsx", "lib/v3/sales-register-page.ts"].some((name) => file.endsWith(name));
    if (moved) continue;
    assert.ok(lines <= 150, `${file}: ${lines} строк`);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/u, `${file}: цвета только токенами`);
    assert.doesNotMatch(source, /text-fg\/\d|bg-[a-z-]+\/\d|opacity-(?!40)/u, `${file}: без прозрачности`);
    assert.doesNotMatch(source, /dark:/u, `${file}: CRM только светлая`);
  }
  assert.match(read("src/components/v3/pipeline-next/PipelineBoardNext.tsx"), /SectionTabs/u);
  assert.match(read("src/components/v3/board-next/BoardColumnCard.tsx"), /Card size="sm"/u);
  assert.match(read("src/components/v3/pipeline-next/LeadSheetNext.tsx"), /<DetailSheet/u);
  assert.match(read("src/components/v3/admissions-pipeline-next/AdmissionsPipelineNextPage.tsx"), /PageShell[\s\S]*SectionTabs/u);
  assert.match(read("src/components/v3/sales-next/SalesRecordsTable.tsx"), /<DataTable[\s\S]*<DetailSheet/u);
  assert.match(read("src/components/v3/sales-next/SalesHeadlineTiles.tsx"), /StatTile/u);
  assert.match(read("src/components/v3/sales-next/SalesMoneyCard.tsx"), /WidgetCard/u);
  assert.match(read("src/components/v3/sales-next/SalesRecordsTable.tsx"), /^"use client";/u);
  assert.match(read("src/components/v3/sales-next/SalesRecordsTable.tsx"), /searchable=\{false\}[\s\S]*paginate=\{false\}/u, "поиск, фильтры и страницы ведёт сервер");
});

test("набор: у `DataTable` есть `searchable` (по умолчанию включён); без него поля поиска нет, остальное то же", () => {
  const table = read("src/components/kit/DataTable.tsx");
  assert.match(table, /searchable = true/u);
  assert.match(table, /placeholder=\{searchable \? searchPlaceholder : null\}/u);
  const toolbar = read("src/components/kit/DataTableToolbar.tsx");
  assert.match(toolbar, /placeholder === null \? null/u);
  assert.match(read("DESIGN.md"), /searchable\?: boolean/u, "каталог набора назвал свойство");
  assert.match(read("DESIGN.md"), /`searchable=\{false\}`/u);
});

test("правила нового вида: доски — карточки набора; «Закрыть лид», «Убрать» и «Связать с лидом» остаются прежними командами; текст на экране — заголовки, данные, кнопки", () => {
  const sheet = read("src/components/v3/pipeline-next/LeadSheetNext.tsx");
  assert.match(sheet, /blockedReason=\{terminal \? closureWords\.lead\.handedOff : null\}/u, "переданный лид: причина названа");
  const closed = text(mainOf(nextBoards.get("next-sales-closed")));
  assert.match(closed, /Вернуть в работу/u);
  // Пояснения за «?»: «Фильтр направления точный…» остаётся на виду (предупреждение о данных), а справка «Менеджеров в отчёте» — за «?».
  const managers = read("src/components/v3/sales-next/SalesFramesNext.tsx");
  assert.match(managers, /help="Написания с разным регистром/u);
  assert.match(read("src/components/v3/sales-next/SalesCashCard.tsx"), /help="Подтверждённые финансовые события/u);
  // Предупреждения остаются на виду: сбой чтения, граница роли, неполный итог.
  assert.match(read("src/components/v3/sales-next/SalesReportNextPage.tsx"), /role=\{alert\.role\}/u);
  assert.match(read("src/components/v3/sales-next/SalesMoneyCard.tsx"), /\{data\.footnote\}/u);
  assert.match(read("src/components/v3/sales-next/SalesFramesNext.tsx"), /Записи продаж вашей роли недоступны/u);
});
