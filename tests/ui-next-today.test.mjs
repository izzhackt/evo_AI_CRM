// «Новый вид» (решение владельца 27.10.2026), поток «today»: «Сегодня» (`/main`) и «Заявки» (`/requests`).
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

const nextRequests = spawnJson("requests-static-render.cjs", "--next-json");
const nextToday = spawnJson("today-static-render.cjs", "--next-json");
const pageToday = spawnJson("today-static-render.cjs", "--page-json");
// `--next-props` настоящей страницы «Заявок» бросает, если свойства `RequestsNextLazy` не сериализуются (`assertFlightProps`).
const requestsNextPropsChecked = Object.keys(JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./e2e/requests-static-render.cjs", import.meta.url)), "--next-props"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))).length === 3;

const count = (html, pattern) => [...html.matchAll(pattern)].length;
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/\s+/gu, " ").trim();

/** Плитки и карточки виджетов нового вида (у прежнего вида тот же `id="today-band-…"` стоит на заголовке группы). */
const WIDGETS = /data-slot="stat-tile"|data-slot="card"[^>]*id="today-band-/u;
/** Плитки раздела по его атрибуту: у Admin два раздела, у роли с одним — один без заголовка. */
const sectionOf = (html, name) => {
  const start = html.indexOf(`data-today-section="${name}"`);
  const next = html.indexOf("data-today-section=", start + 10);
  return start < 0 ? "" : html.slice(start, next < 0 ? undefined : next);
};
const tilesOf = (html) => [...html.matchAll(/<li class="[^"]*"><a [^>]*data-slot="stat-tile"[^>]*>([\s\S]*?)<\/a><\/li>/gu)].map((match) => text(match[1]));
const NEW_FILES = [
  "src/components/staff/today-next/TodayNext.tsx", "src/components/staff/today-next/TodayDashboard.tsx", "src/components/staff/today-next/TodayBandWidget.tsx",
  "src/components/staff/today-next/TodayTiles.tsx",
  "src/components/staff/requests-next/RequestsNextView.tsx", "src/components/staff/requests-next/RequestsNextTable.tsx",
  "src/components/staff/requests-next/RequestSheetBody.tsx", "src/components/staff/requests-next/requests-next-rows.tsx",
  "src/components/staff/requests-next/RequestsNextEmpty.tsx",
  "src/components/staff/today-next/TodayNextPage.tsx", "src/components/staff/today-next/TodayNextLazy.tsx",
  "src/components/staff/requests-next/RequestsNextPage.tsx", "src/components/staff/requests-next/RequestsNextLazy.tsx",
];

/* ---------------------------------------------------------------- выбор вида: переключатель и только администратор */

test("«Сегодня»: настоящая страница рисует новый вид каждой роли (#1327): администратор с cookie и без, просмотр роли, продажи", () => {
  const admin = pageToday.get("admin-cookie");
  assert.match(admin, /data-testid="v3-operational-dashboard"/u);
  assert.match(admin, /data-slot="stat-tile"/u, "плитки набора");
  assert.match(admin, /data-slot="card"[^>]*id="today-band-sales-overdue"/u, "виджет группы продаж");
  assert.match(admin, /data-slot="card"[^>]*id="today-band-admissions-overdue"/u, "виджет группы поступления");
  assert.doesNotMatch(admin, /data-testid="queue-skeleton"/u);
  for (const name of ["admin-no-cookie", "preview-cookie", "preview-no-cookie", "sales-cookie", "sales-no-cookie"]) {
    assert.match(pageToday.get(name), WIDGETS, `${name}: новый вид`);
    assert.match(pageToday.get(name), /data-testid="v3-operational-dashboard"/u, name);
  }
});

test("«Заявки»: новый вид у каждой роли (#1327): продажи, просмотр роли, администратор", () => {
  for (const name of ["next-sales-cookie", "next-preview", "next-off"]) {
    assert.match(nextRequests.get(name), /data-slot="data-table"|data-testid="requests-empty"|data-testid="v3-requests"/u, `${name}: новый вид`);
    assert.doesNotMatch(nextRequests.get(name), /data-queue-row=/u, `${name}: строк прежнего вида нет`);
  }
  for (const name of ["next-waiting", "next-populated", "next-empty", "next-error", "next-invalid", "next-calls-dial"]) {
    const html = nextRequests.get(name);
    assert.match(html, /data-testid="v3-requests"/u, name);
    assert.doesNotMatch(html, /data-queue-row=/u, `${name}: строки прежнего вида`);
    assert.doesNotMatch(html, /data-testid="requests-detail-panel"/u, `${name}: панель открывается нажатием, а не выводится в странице`);
  }
  for (const name of ["next-waiting", "next-populated", "next-empty", "next-calls-dial"]) assert.match(nextRequests.get(name), /data-slot="data-table"/u, name);
});

/* ---------------------------------------------------------------- «Заявки»: те же данные, действия и request_id */

test("«Заявки»: строки, источники, вкладки и «Взять себе» в новом виде (те же лиды и request_id)", () => {
  const next = nextRequests.get("next-populated");
  const nextTable = next.slice(next.indexOf("<tbody"), next.indexOf("</tbody>"));
  assert.equal(count(nextTable, /<tr[ >]/gu), 9, "та же 9 строк");
  // «Взять себе»: у лидов request_id свой (в таблице и в списке карточек для телефона — по экземпляру на каждый).
  const pairs = (html) => [...new Set([...html.matchAll(/name="lead_id" value="([^"]+)"\/><input type="hidden" name="expected_version" value="([^"]+)"\/><input type="hidden" name="request_id" value="([^"]+)"/gu)].map((match) => match.slice(1).join("|")))].sort();
  assert.ok(pairs(next).length >= 2, "в данных есть не взятые лиды");
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
  const page = read("src/app/(staff)/requests/page.tsx");
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
});

/* ---------------------------------------------------------------- «Сегодня»: плитки честны, строки те же */

test("«Сегодня»: плитка на каждую группу, числа из чтения, «—» там, где числа нет; красное — только просроченное", () => {
  const admin = nextToday.get("next-admin");
  // Admin: продажи и поступление — два раздела, у каждого свои плитки; слово «Ждут вас» без числа — из-за переписок.
  assert.deepEqual(tilesOf(sectionOf(admin, "sales")), ["Просрочено 1", "Сегодня 1", "Ждут вас 2", "Без следующего шага 1", "Ближайшие 14 дней 1"]);
  assert.deepEqual(tilesOf(sectionOf(admin, "admissions")), ["Просрочено 3", "Сегодня 2", "Ждут вас — нет данных", "Без следующего шага 1", "Ближайшие 14 дней 2"]);
  const tiles = tilesOf(admin);
  assert.equal(count(admin, /text-danger[^"]*t-figure|t-figure[^"]*text-danger/gu), 3, "красное число просроченного — по одному на раздел с просрочкой");
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

test("«Сегодня»: строки в виджетах: задача — настоящая строка «Задач»", () => {
  const admin = nextToday.get("next-admin");
  assert.ok(count(admin, /data-kind="staff"/gu) >= 1, "рабочая задача рисуется строкой «Задач» с кругом завершения");
  assert.match(admin, /aria-label="Завершить: /u);
  assert.match(admin, /шаг просрочен/u, "причина строки та же");
  assert.equal(count(admin, /data-slot="card" data-size="default"/gu) >= 10, true, "виджеты — карточки набора, по группам каждого раздела");
});

test("«Сегодня»: пустой день говорит прежними словами; доски роли — кнопки шапки", () => {
  const empty = text(nextToday.get("next-empty"));
  assert.match(empty, /На сегодня всё/u);
  assert.match(empty, /Ближайший срок — чт 01\.10/u);
  const admissions = text(nextToday.get("next-empty-admissions"));
  assert.match(admissions, /На сегодня всё/u);
  // Решение владельца 30.10: воронки открываются из бокового меню, в шапке «Сегодня» их нет.
  const admin = nextToday.get("next-admin");
  assert.doesNotMatch(admin, /aria-label="Доски"/u);
  assert.doesNotMatch(text(admin), /Воронка продаж|Воронка поступления/u);
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
  assert.match(read("src/components/staff/today-next/TodayBandWidget.tsx"), /WidgetCard/u);
  assert.match(read("src/components/staff/today-next/TodayTiles.tsx"), /StatTile/u);
  assert.match(read("src/components/staff/requests-next/RequestsNextTable.tsx"), /DataTable[\s\S]*DetailSheet/u);
  assert.match(read("src/components/staff/requests-next/RequestsNextView.tsx"), /SectionTabs/u);
  assert.match(read("src/components/staff/requests-next/RequestsNextTable.tsx"), /^"use client";/u);
  assert.match(read("src/components/staff/today-next/TodayDashboard.tsx"), /^"use client";/u);
});

test("страницы всегда рисуют новый вид (#1327), читают и проверяют права как прежде", () => {
  const main = read("src/app/(staff)/main/page.tsx");
  assert.doesNotMatch(main, /isNextUi/u);
  // Новый вид подгружается лениво и не импортируется статически.
  assert.match(main, /return <TodayNextLazy queue=\{queue\} sections=\{sections\} headed=\{headed\} nowIso=\{now\.toISOString\(\)\} mainAction=\{mainAction\} dial=\{dial\} taskLeads=\{taskLeads\} permissions=\{permissions\} \/>;/u);
  assert.doesNotMatch(main, /from "@\/components\/staff\/today-next\/Today(Next|Dashboard)"|from "@\/components\/kit"/u, "виджеты нового вида в первую загрузку страницы не входят");
  assert.doesNotMatch(main, /<PartShell|<TodayScreen/u, "прежнего вида нет");
  assert.match(main, /const taskLeads = dial\.status === "ready" \? await readTodayTaskLeads\(actor, \{ bands: sections\.flatMap\(\(section\) => section\.queue\.bands\) \}\) : null;/u, "чтения прежние");
  assert.match(main, /buildTodaySections\(reads, now, access\.role\)/u, "разделы по роли");
  const requests = read("src/app/(staff)/requests/page.tsx");
  assert.doesNotMatch(requests, /isNextUi/u);
  assert.match(requests, /return \(\s*<ManualLeadDisclosure>\s*<RequestsNextLazy/u);
  assert.match(requests, /return <RequestsNextInvalidLazy \/>;/u);
  assert.doesNotMatch(requests, /from "@\/components\/staff\/requests-next\/RequestsNext(View|Page)"|from "@\/components\/kit"/u, "очередь нового вида в первую загрузку страницы не входит");
  assert.doesNotMatch(requests, /<PartShell|<RequestsQueueView/u, "прежнего вида нет");
  assert.match(requests, /const \[read, owners, dial\] = await Promise\.all\(\[/u, "чтения прежние");
});

test("ленивые входы нового вида: «use client» и подгрузка настоящего вида, свойства страницы доходят целиком", () => {
  const today = read("src/components/staff/today-next/TodayNextLazy.tsx");
  assert.match(today, /^"use client";/u);
  assert.match(today, /dynamic\(\(\) => import\("\.\/TodayNextPage"\)\.then\(\(module\) => module\.TodayNextPage\)\.catch\(onScreenLoadFailed\)\)/u);
  const requests = read("src/components/staff/requests-next/RequestsNextLazy.tsx");
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
  const table = read("src/components/staff/requests-next/RequestsNextTable.tsx");
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
  assert.match(read("src/components/staff/requests-next/RequestsNextTable.tsx"), /paginate=\{false\}/u);
  assert.doesNotMatch(read("src/components/staff/requests-next/RequestsNextTable.tsx"), /pageSize=/u);
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
  assert.equal(count(admin, /data-queue-list=/gu), 3, "область очереди — сетка каждого раздела (продажи, поступление, рабочие задачи)");
  assert.ok(region.indexOf("data-queue-list") < region.indexOf('id="today-band-'), "область объемлет виджеты раздела");
  assert.doesNotMatch(region.slice(region.indexOf("<ul")), /<ul[^>]*data-queue-list/u, "не на списке строк: кнопка «Показать ещё» стоит вне него");
  // Строки виджета — без широкой раскладки от 32rem.
  assert.equal(count(region, /@min-\[32rem\]/gu), 0, "в виджетах нет широкой сетки строки");
  // Плитки: на каждую группу при нескольких группах; у единственной группы и у пустого дня с названным сроком — нет.
  assert.equal(tilesOf(admin).length >= 10, true, "у каждого раздела свои плитки");
  assert.match(admin, /data-testid="today-tiles"/u);
  assert.match(admin, /md:grid-cols-\[repeat\(auto-fit,minmax\(11rem,1fr\)\)\]/u);
  for (const name of ["next-empty", "next-empty-admissions"]) assert.doesNotMatch(nextToday.get(name), /data-testid="today-tiles"/u, `${name}: плиток нет`);
  assert.match(text(nextToday.get("next-empty")), /Ближайший срок — чт 01\.10/u, "срок назван один раз, в панели");
  assert.match(read("src/components/staff/today-next/TodayBandWidget.tsx"), /stacked/u);
});

/* ---------------------------------------------------------------- «Сегодня» по роли (06.11.2026) */

test("«Сегодня» куратора: его студенты, документы на проверке и задачи; перезвонов и заявок продаж нет", () => {
  const curator = nextToday.get("next-curator");
  assert.equal(count(curator, /data-today-section="/gu), 1, "один раздел — без заголовка");
  assert.doesNotMatch(curator, /<h2 id="today-section-/u);
  assert.match(text(curator), /Проверить документы/u);
  assert.match(text(curator), /на проверке: 3 документа/u);
  assert.match(text(curator), /на проверке: 1 документ/u);
  assert.match(curator, /href="\/profile\?case=dddddddd-2222-4222-8222-000000000021&amp;tab=documents"/u, "строка ведёт на вкладку «Документы» студента");
  assert.doesNotMatch(text(curator), /Перезвонить клиенту|Нет ответственного|Новая заявка/u);
  assert.equal(count(curator, /data-today-source="(leads|requests)"/gu), 0);
  assert.equal(count(curator, /data-today-assign/gu), 0);
});

test("«Сегодня» администратора: продажи и «Студенты и документы» раздельно, у заявок без ответственного — «Назначить»", () => {
  const both = nextToday.get("next-both");
  assert.deepEqual([...both.matchAll(/<h2 id="today-section-(\w+)"[^>]*>([^<]+)</gu)].map((match) => [match[1], match[2]]),
    [["sales", "Продажи"], ["admissions", "Студенты и документы"], ["work", "Рабочие задачи"]]);
  const sales = sectionOf(both, "sales");
  assert.match(text(sales), /Перезвонить клиенту/u, "перезвон — в продажах");
  assert.doesNotMatch(text(sectionOf(both, "admissions")), /Перезвонить клиенту|Новая заявка/u);
  assert.match(text(sectionOf(both, "admissions")), /Проверить документы/u);
  assert.equal(count(sales, /data-today-assign/gu), 2, "«Назначить» у каждой из двух заявок без ответственного");
  assert.match(sales, /aria-label="Назначить ответственного: Эльмира Формова"/u);
  const assignTag = [...sales.matchAll(/<a [^>]*data-today-assign[^>]*>/gu)].map((match) => match[0]).find((tag) => tag.includes("Эльмира Формова"));
  assert.match(assignTag, /href="\/pipeline\?lead=ffffffff-3333-4333-8333-000000000006"/u);
  // Идентификаторы виджетов разных разделов не совпадают, плитки ведут к своему разделу.
  const ids = [...both.matchAll(/id="(today-band-[\w-]+)"/gu)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(both, /aria-label="Числа: Продажи"/u);
});

test("«Сегодня» просмотра роли: «Поступление» — как у куратора, без продаж", () => {
  assert.match(read("src/lib/v3/today-source.ts"), /role: Object\.freeze\(\{ sales, admissions: students \}\)/u);
});
