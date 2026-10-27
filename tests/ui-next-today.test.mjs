// «Новый вид» (решение владельца 27.10.2026), поток «today»: «Сегодня» (`/v3/main`) и «Заявки» (`/v3/requests`).
// Проверяется то, что обещано: новый вид выбирает переключатель и только настоящий администратор, прежний вид у
// сотрудников и в просмотре роли — байт в байт тот же; данные, права, request_id и действия в новом виде те же, что в
// прежнем; плитки честны («—» вместо выдуманного числа); экраны собраны из виджетов набора и короткими файлами.
// Разметку даёт НАСТОЯЩИЕ страницы и компоненты с синтетическими данными (tests/e2e/today-static-render.cjs и
// requests-static-render.cjs, отдельные node-процессы). Взаимодействия в браузере — tests/e2e/ui-next-today-client.cjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const spawnJson = (script, flag) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL(`./e2e/${script}`, import.meta.url)), flag],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));

const legacyRequests = spawnJson("requests-static-render.cjs", "--json");
const nextRequests = spawnJson("requests-static-render.cjs", "--next-json");
const legacyToday = spawnJson("today-static-render.cjs", "--json");
const nextToday = spawnJson("today-static-render.cjs", "--next-json");
const pageToday = spawnJson("today-static-render.cjs", "--page-json");
// `--next-props` настоящей страницы «Заявок» бросает, если свойства `RequestsNextLazy` не сериализуются (`assertFlightProps`).
const requestsNextPropsChecked = Object.keys(JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./e2e/requests-static-render.cjs", import.meta.url)), "--next-props"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))).length === 3;

const count = (html, pattern) => [...html.matchAll(pattern)].length;
const all = (html, pattern) => [...html.matchAll(pattern)].map((match) => match[1]);
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/\s+/gu, " ").trim();

/** Плитки и карточки виджетов нового вида (у прежнего вида тот же `id="today-band-…"` стоит на заголовке группы). */
const WIDGETS = /data-slot="stat-tile"|data-slot="card"[^>]*id="today-band-/u;
const NEW_FILES = [
  "src/components/v3/today-next/TodayNext.tsx", "src/components/v3/today-next/TodayDashboard.tsx", "src/components/v3/today-next/TodayBandWidget.tsx",
  "src/components/v3/today-next/TodayTiles.tsx", "src/components/v3/today-next/TodayBoards.tsx",
  "src/components/v3/requests-next/RequestsNextView.tsx", "src/components/v3/requests-next/RequestsNextTable.tsx",
  "src/components/v3/requests-next/RequestSheetBody.tsx", "src/components/v3/requests-next/requests-next-rows.tsx",
  "src/components/v3/requests-next/RequestsNextEmpty.tsx",
  "src/components/v3/today-next/TodayNextPage.tsx", "src/components/v3/today-next/TodayNextLazy.tsx",
  "src/components/v3/requests-next/RequestsNextPage.tsx", "src/components/v3/requests-next/RequestsNextLazy.tsx",
];

/* ---------------------------------------------------------------- выбор вида: переключатель и только администратор */

test("«Сегодня»: настоящая страница рисует новый вид только администратору с cookie; у остальных и без cookie — прежняя разметка байт в байт", () => {
  const admin = pageToday.get("admin-cookie");
  assert.match(admin, /data-testid="v3-operational-dashboard"/u);
  assert.match(admin, /data-slot="stat-tile"/u, "плитки набора");
  assert.match(admin, /data-slot="card"[^>]*id="today-band-overdue"/u, "виджет группы");
  assert.doesNotMatch(admin, /data-testid="queue-skeleton"/u);
  // Без cookie — прежняя страница; она равна прежнему рендеру настоящего PartShell + TodayScreen из стенда.
  assert.equal(pageToday.get("admin-no-cookie"), legacyToday.get("admin"), "администратор без cookie видит прежний вид без единого отличия");
  assert.doesNotMatch(pageToday.get("admin-no-cookie"), WIDGETS);
  // Просмотр роли и сотрудник с тем же cookie — прежнее: cookie их вид не меняет.
  assert.equal(pageToday.get("preview-cookie"), pageToday.get("preview-no-cookie"), "просмотр роли с cookie");
  assert.equal(pageToday.get("sales-cookie"), pageToday.get("sales-no-cookie"), "сотрудник с cookie");
  assert.equal(pageToday.get("sales-no-cookie"), legacyToday.get("sales"));
  for (const name of ["preview-cookie", "sales-cookie"]) assert.doesNotMatch(pageToday.get(name), WIDGETS, name);
});

test("«Заявки»: новый вид только у администратора с cookie; сотрудник и просмотр роли с cookie и администратор без него — прежняя разметка байт в байт", () => {
  assert.equal(nextRequests.get("next-sales-cookie"), legacyRequests.get("sales-empty"), "сотрудник с cookie");
  assert.equal(nextRequests.get("next-preview"), legacyRequests.get("preview"), "просмотр роли с cookie");
  assert.equal(nextRequests.get("next-off"), legacyRequests.get("waiting"), "администратор без cookie");
  for (const name of ["next-sales-cookie", "next-preview", "next-off"]) assert.doesNotMatch(nextRequests.get(name), /data-slot="data-table"/u, `${name}: таблицы нового вида нет`);
  for (const name of ["sales-empty", "preview", "waiting"]) assert.match(legacyRequests.get(name), /data-queue-row=|data-testid="queue-empty"/u, `${name}: прежний вид`);
  for (const name of ["next-waiting", "next-populated", "next-empty", "next-error", "next-invalid", "next-calls-dial"]) {
    const html = nextRequests.get(name);
    assert.match(html, /data-testid="v3-requests"/u, name);
    assert.doesNotMatch(html, /data-queue-row=/u, `${name}: строки прежнего вида`);
    assert.doesNotMatch(html, /data-testid="requests-detail-panel"/u, `${name}: панель открывается нажатием, а не выводится в странице`);
  }
  for (const name of ["next-waiting", "next-populated", "next-empty", "next-calls-dial"]) assert.match(nextRequests.get(name), /data-slot="data-table"/u, name);
});

/* ---------------------------------------------------------------- «Заявки»: те же данные, действия и request_id */

test("«Заявки»: строки, источники, вкладки и «Взять себе» те же, что у прежнего вида (те же лиды и request_id)", () => {
  const legacy = legacyRequests.get("populated");
  const next = nextRequests.get("next-populated");
  const legacyNames = all(legacy, /data-queue-row="[^"]+"[^>]*>[\s\S]*?<span class="block truncate t-item text-fg md:pointer-fine:hidden" title="([^"]+)"/gu);
  const nextTable = next.slice(next.indexOf("<tbody"), next.indexOf("</tbody>"));
  const nextNames = all(nextTable, /<tr[^>]*>\s*<td[^>]*>[\s\S]*?<span class="block truncate md:pointer-fine:hidden" title="([^"]+)"/gu);
  assert.equal(count(legacy, /data-queue-row=/gu), 9);
  assert.equal(count(nextTable, /<tr[ >]/gu), 9, "та же 9 строк");
  assert.deepEqual(nextNames.map((name) => name.trim()), legacyNames.map((name) => name.trim()), "те же имена в том же порядке");
  // Вкладки с числами — тот же общий ряд (`QueueViewTabs`) с теми же адресами.
  const tabs = (html) => all(html.slice(html.indexOf('data-testid="queue-view-tabs"')), /<a [^>]*href="([^"]+)"[^>]*>([^<]*(?:<span[^>]*>\d+<\/span>)?)<\/a>/gu).slice(0, 5);
  assert.deepEqual(tabs(next), tabs(legacy));
  // «Взять себе»: те же лиды с теми же request_id (в таблице и в списке карточек для телефона — по экземпляру на каждый).
  const pairs = (html) => [...new Set([...html.matchAll(/name="lead_id" value="([^"]+)"\/><input type="hidden" name="expected_version" value="([^"]+)"\/><input type="hidden" name="request_id" value="([^"]+)"/gu)].map((match) => match.slice(1).join("|")))].sort();
  assert.deepEqual(pairs(next), pairs(legacy));
  assert.ok(pairs(next).length >= 2, "в данных есть не взятые лиды");
  assert.equal(count(next, /data-testid="requests-take"/gu), 2 * count(legacy, /data-testid="requests-take"/gu), "кнопка в строке таблицы и в карточке телефона");
  // Состояния разбора словами, как раньше.
  for (const word of ["Взять себе", "ждёт решения", "Передан в поступление", "отклонена", "открыта", "обработана"]) assert.match(text(next), new RegExp(word, "u"), word);
});

test("«Заявки»: число красных кнопок одно («Добавить лида»), заголовок один, таблица и карточки телефона размечены", () => {
  const html = nextRequests.get("next-populated");
  const page = html.slice(html.lastIndexOf("<main", html.indexOf('data-testid="v3-requests"')), html.indexOf("</main>", html.indexOf('data-testid="v3-requests"')));
  assert.equal(count(page, /<h1[ >]/gu), 1);
  assert.equal(count(page, /bg-primary/gu) <= 1, true, "сплошной красный — только главное действие");
  assert.match(page, /Добавить лида/u);
  assert.match(page, /data-slot="data-table-cards"/u);
  assert.match(page, /role="region" aria-label="Заявки"/u);
  assert.match(page, /aria-label="Состояние"/u);
  assert.match(page, /placeholder="Найти на странице"/u);
});

test("«Заявки»: пустая очередь, сбой чтения и неверная ссылка говорят прежними словами; пояснение «Что сюда приходит» ушло за «?»", () => {
  const empty = text(nextRequests.get("next-empty"));
  assert.match(empty, /Новых заявок нет/u);
  assert.match(empty, /Последняя пришла вчера в 19:05\./u);
  assert.match(empty, /Показать все/u);
  assert.doesNotMatch(empty, /Сюда приходят/u, "пояснение не стоит на экране");
  assert.match(text(legacyRequests.get("empty")), /Сюда приходят/u, "а у прежнего вида стояло");
  const page = read("src/app/(v3)/v3/requests/page.tsx");
  assert.match(page, /requestEmptyWhat\(read\.queue, selection\.source\)/u, "и теперь живёт в справке шапки");
  const error = nextRequests.get("next-error");
  assert.match(error, /role="alert"/u);
  assert.match(text(error), /Заявки не загрузились\. Список и числа сейчас неизвестны\./u, "ошибка остаётся на виду");
  assert.match(text(error), /Повторить/u);
  assert.match(text(nextRequests.get("next-invalid")), /Эта ссылка на очередь заявок неверна\./u);
});

test("«Заявки»: звонки — исход последнего звонка и «Позвонить» остаются в строке", () => {
  const html = nextRequests.get("next-calls-dial");
  assert.equal(count(html, /data-testid="requests-call-outcome"/gu) >= 2, true);
  assert.match(text(html), /Пропущен/u);
  assert.match(text(html), /Ответил Нурлан Демо/u);
  assert.match(html, /aria-describedby="[^"]*"/u);
  assert.equal(count(legacyRequests.get("calls-dial"), /data-testid="requests-call-outcome"/gu) >= 1, true);
});

/* ---------------------------------------------------------------- «Сегодня»: плитки честны, строки те же */

test("«Сегодня»: плитка на каждую группу, числа из чтения, «—» там, где числа нет; красное — только просроченное", () => {
  const admin = nextToday.get("next-admin");
  const tiles = [...admin.matchAll(/<li class="[^"]*"><a [^>]*data-slot="stat-tile"[^>]*>([\s\S]*?)<\/a><\/li>/gu)].map((match) => text(match[1]));
  assert.deepEqual(tiles, ["Просрочено 5", "Сегодня 4", "Ждут вас — нет данных", "Без следующего шага 2", "Ближайшие 14 дней 4"]);
  assert.match(admin, /text-danger[^"]*">5</u, "красное число просроченного");
  assert.equal(count(admin, /text-danger[^"]*t-figure|t-figure[^"]*text-danger/gu), 1, "красное число одно");
  // Группа «Ждут вас» без честного числа: плитка «—», а предупреждение «числа нет» остаётся на виду в виджете.
  assert.match(text(admin), /Числа нет: часть переписок могла получить ответ\./u);
  // Название группы без даты: число дня стоит под заголовком страницы, а не в каждой плитке.
  assert.doesNotMatch(tiles.join(" "), /26\.09/u);
  assert.match(text(admin), /Суббота, 26 сентября/u);
  // Неполное чтение: «—» у групп, которые от него зависят; сообщение о неполноте и его ссылка на виду.
  const partial = nextToday.get("next-partial");
  assert.match(partial, /data-testid="today-notices"/u);
  assert.match(partial, /data-today-notice="error"/u);
  assert.ok(count(partial, /нет данных/gu) >= 1, "плитки без числа показывают «—»");
  assert.match(partial, /role="alert"/u);
  for (const group of ["Просрочено", "Сегодня"]) assert.match(text(partial), new RegExp(group, "u"));
});

test("«Сегодня»: строки в виджетах те же, что в прежней ленте (ключи, источники, причины), задача — настоящая строка «Задач»", () => {
  for (const name of ["admin", "admissions", "sales", "partial"]) {
    const keys = (html) => all(html, /data-queue-row="([^"]+)"/gu).sort();
    assert.deepEqual(keys(nextToday.get(`next-${name}`)), keys(legacyToday.get(name)), `${name}: те же строки`);
    const sources = (html) => all(html, /data-today-source="([^"]+)"/gu).sort();
    assert.deepEqual(sources(nextToday.get(`next-${name}`)), sources(legacyToday.get(name)), `${name}: те же источники`);
  }
  const admin = nextToday.get("next-admin");
  assert.ok(count(admin, /data-kind="staff"/gu) >= 1, "рабочая задача рисуется строкой «Задач» с кругом завершения");
  assert.match(admin, /aria-label="Завершить: /u);
  assert.match(admin, /шаг просрочен/u, "причина строки та же");
  assert.equal(count(admin, /data-slot="card" data-size="default"/gu) >= 5, true, "виджеты — карточки набора");
});

test("«Сегодня»: пустой день говорит прежними словами; доски роли — кнопки шапки", () => {
  const empty = text(nextToday.get("next-empty"));
  assert.match(empty, /На сегодня всё/u);
  assert.match(empty, /Ближайший срок — чт 01\.10/u);
  const admissions = text(nextToday.get("next-empty-admissions"));
  assert.match(admissions, /На сегодня всё/u);
  const boards = nextToday.get("next-admin");
  assert.match(boards, /aria-label="Доски"/u);
  assert.match(text(boards), /Воронка продаж/u);
  assert.match(text(boards), /Воронка поступления/u);
});

/* ---------------------------------------------------------------- устройство: виджеты набора, короткие файлы, токены */

test("новые файлы короче 150 строк, собраны из набора и не вводят своих цветов", () => {
  for (const file of NEW_FILES) {
    const source = read(file);
    const lines = source.split("\n").length - 1;
    assert.ok(lines <= 150, `${file}: ${lines} строк`);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/u, `${file}: цвета только токенами`);
    assert.doesNotMatch(source, /text-fg\/\d|bg-[a-z-]+\/\d|opacity-/u, `${file}: без прозрачности`);
    assert.doesNotMatch(source, /dark:/u, `${file}: CRM только светлая`);
  }
  assert.match(read("src/components/v3/today-next/TodayBandWidget.tsx"), /WidgetCard/u);
  assert.match(read("src/components/v3/today-next/TodayTiles.tsx"), /StatTile/u);
  assert.match(read("src/components/v3/requests-next/RequestsNextTable.tsx"), /DataTable[\s\S]*DetailSheet/u);
  assert.match(read("src/components/v3/requests-next/RequestsNextView.tsx"), /SectionTabs/u);
  assert.match(read("src/components/v3/requests-next/RequestsNextTable.tsx"), /^"use client";/u);
  assert.match(read("src/components/v3/today-next/TodayDashboard.tsx"), /^"use client";/u);
});

test("страницы спрашивают isNextUi, читают и проверяют права как прежде; прежняя ветка осталась", () => {
  const main = read("src/app/(v3)/v3/main/page.tsx");
  assert.match(main, /import \{ isNextUi \} from "@\/lib\/ui-next";/u);
  // Новый вид подгружается лениво: страница отдаёт его только настоящему администратору и не импортирует статически.
  assert.match(main, /if \(await isNextUi\(actor\)\) \{\s*return <TodayNextLazy boards=\{boards\} queue=\{queue\} nowIso=\{now\.toISOString\(\)\} mainAction=\{mainAction\} dial=\{dial\} taskLeads=\{taskLeads\} permissions=\{permissions\} \/>;/u);
  assert.doesNotMatch(main, /from "@\/components\/v3\/today-next\/Today(Next|Boards|Dashboard)"|from "@\/components\/kit"/u, "виджеты нового вида в первую загрузку страницы не входят");
  assert.match(main, /<PartShell\s+title="Сегодня"[\s\S]*?<TodayScreen/u, "прежний вид на месте");
  assert.match(main, /const taskLeads = dial\.status === "ready" \? await readTodayTaskLeads\(actor, queue\) : null;/u, "чтения прежние");
  const requests = read("src/app/(v3)/v3/requests/page.tsx");
  assert.match(requests, /const next = await isNextUi\(actor\);/u);
  assert.match(requests, /if \(next\) \{\s*return \(\s*<ManualLeadDisclosure>\s*<RequestsNextLazy/u);
  assert.match(requests, /if \(next\) return <RequestsNextInvalidLazy \/>;/u);
  assert.doesNotMatch(requests, /from "@\/components\/v3\/requests-next\/RequestsNext(View|Page)"|from "@\/components\/kit"/u, "очередь нового вида в первую загрузку страницы не входит");
  assert.match(requests, /<PartShell title="Заявки" dense testId="v3-requests"/u, "прежний вид на месте");
  assert.match(requests, /const \[read, owners, dial\] = await Promise\.all\(\[/u, "чтения прежние");
  for (const page of [main, requests]) assert.ok(page.indexOf("isNextUi(actor)") < page.indexOf("<PartShell"), "выбор вида до прежней разметки");
});

test("ленивые входы нового вида: «use client» и подгрузка настоящего вида, свойства страницы доходят целиком", () => {
  const today = read("src/components/v3/today-next/TodayNextLazy.tsx");
  assert.match(today, /^"use client";/u);
  assert.match(today, /dynamic\(\(\) => import\("\.\/TodayNextPage"\)\.then\(\(module\) => module\.TodayNextPage\)\)/u);
  const requests = read("src/components/v3/requests-next/RequestsNextLazy.tsx");
  assert.match(requests, /^"use client";/u);
  assert.match(requests, /import\("\.\/RequestsNextPage"\)\.then\(\(module\) => module\.RequestsNextPage\)/u);
  assert.match(requests, /import\("\.\/RequestsNextPage"\)\.then\(\(module\) => module\.RequestsNextInvalid\)/u);
  // Свойства, которые страница отдаёт ленивому входу, проходят границу сервер → клиент: данные, а не функции и объекты классов.
  // Это проверяет сам стенд на настоящей странице (`tests/e2e/flight-props.cjs`): он бросает, а не пропускает.
  assert.ok(pageToday.has("admin-cookie") && requestsNextPropsChecked, "стенды проверили свойства ленивых входов");
});

test("список карточек телефона занимает одну колонку: длинное слово не раздвигает карточки за экран", () => {
  assert.match(read("src/components/kit/DataTableCards.tsx"), /<ul className="grid grid-cols-1 gap-2 md:hidden" data-slot="data-table-cards">/u);
});

test("панель заявки открывается адресом, а закрытие и открытие идут сразу (состояние нажатой строки)", () => {
  const table = read("src/components/v3/requests-next/RequestsNextTable.tsx");
  assert.match(table, /router\.push\(href, \{ scroll: false \}\)/u);
  assert.match(table, /requestsHref|openHref/u);
  assert.match(table, /onOpenChange=\{\(next\) => \{ if \(!next\) go\(null, listHref\); \}\}/u);
  assert.match(table, /Открываем заявку…/u, "пока запись приходит с сервера — скелет под названием строки");
});

/* ---------------------------------------------------------------- правки по ревью (27.10.2026) */

test("«Заявки»: страницы ведёт сервер — у таблицы нет своей полосы страниц, «из N» и второй «Следующая страница»", () => {
  for (const name of ["next-populated", "next-waiting", "next-calls-dial", "next-empty"]) {
    const html = nextRequests.get(name);
    assert.doesNotMatch(html, /data-slot="data-table-pagination"/u, `${name}: своей полосы страниц нет`);
    assert.doesNotMatch(text(html), /\d+–\d+ из \d+/u, `${name}: «1–N из N» по загруженным строкам не пишется`);
    assert.doesNotMatch(html, /aria-label="Строк на странице"/u, name);
  }
  assert.match(read("src/components/v3/requests-next/RequestsNextTable.tsx"), /paginate=\{false\}/u);
  assert.doesNotMatch(read("src/components/v3/requests-next/RequestsNextTable.tsx"), /pageSize=/u);
  // Набор: без `paginate` таблица листает сама, как раньше (страница «Новый вид: набор виджетов»).
  assert.match(read("src/components/kit/DataTable.tsx"), /paginate = true/u);
  assert.match(read("src/components/kit/DataTable.tsx"), /loading \|\| !paginate \? null/u);
});

test("«Заявки»: в пустой очереди одно вторичное действие («Показать все»), красная «Добавить лида» — только в шапке; панель — значения столбцом на телефоне", () => {
  const empty = nextRequests.get("next-empty");
  assert.equal(count(text(empty), /Добавить лида/gu), 1, "кнопка шапки, без второй ссылки в пустом состоянии");
  assert.match(text(empty), /Показать все/u);
  assert.doesNotMatch(empty, /underline-offset-4 hover:text-fg">Добавить лида/u, "тихой ссылки нет");
  assert.match(read("src/components/kit/KeyFacts.tsx"), /2: "grid-cols-1 @md:grid-cols-2"/u, "две колонки только от 28rem блока");
});

test("«Сегодня»: клавиатура очереди ↑/↓ — по всей сетке виджетов (с «Показать ещё»), строки виджета двухстрочные, плитки — по числу групп", () => {
  const admin = nextToday.get("next-admin");
  const region = admin.slice(admin.indexOf('data-today-queue=""'));
  assert.equal(count(admin, /data-queue-list=/gu), 1, "область очереди одна");
  assert.ok(region.indexOf("data-queue-list") < region.indexOf('id="today-band-'), "область объемлет все виджеты");
  assert.doesNotMatch(region.slice(region.indexOf("<ul")), /<ul[^>]*data-queue-list/u, "не на списке строк: кнопка «Показать ещё» стоит вне него");
  // Строки виджета — без широкой раскладки от 32rem; у прежней ленты она есть.
  assert.equal(count(region, /@min-\[32rem\]/gu), 0, "в виджетах нет широкой сетки строки");
  assert.ok(count(legacyToday.get("admin"), /@min-\[32rem\]/gu) > 0, "а у прежнего вида есть");
  // Плитки: на каждую группу при нескольких группах; у единственной группы и у пустого дня с названным сроком — нет.
  assert.equal(count(admin, /data-slot="stat-tile"/gu), 5);
  assert.match(admin, /data-testid="today-tiles"/u);
  assert.match(admin, /md:grid-cols-\[repeat\(auto-fit,minmax\(11rem,1fr\)\)\]/u);
  for (const name of ["next-empty", "next-empty-admissions"]) assert.doesNotMatch(nextToday.get(name), /data-testid="today-tiles"/u, `${name}: плиток нет`);
  assert.match(text(nextToday.get("next-empty")), /Ближайший срок — чт 01\.10/u, "срок назван один раз, в панели");
  assert.match(read("src/components/v3/today-next/TodayBandWidget.tsx"), /stacked/u);
});
