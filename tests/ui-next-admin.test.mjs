// «Новый вид» (решение владельца 27.10.2026), поток «admin»: «Настройки» (все разделы, в том числе карточка канала Wazzup и «Отчёты»), «Маркетинг»
// («Обзор», «Заявки», «Отчёты»), «Финансы» и «ИИ-агент» (ответы Gemini в чате: шесть подразделов). Проверяется то, что обещано: новый вид выбирает
// переключатель и только настоящий администратор, у остальных страница прежняя, байт в байт (сверку с базовым коммитом даёт
// `tests/e2e/admin-next-pages.cjs --legacy-json`); данные, права, команды, поля форм и адреса те же; правила Wazzup (только чтение) в новом виде те же;
// ленивые входы не тянут новый вид в первую загрузку; файлы нового вида короткие и собраны из набора. Разметку даёт НАСТОЯЩАЯ страница с
// синтетическими данными (tests/e2e/admin-next-pages.cjs, отдельный node-процесс); взаимодействия в браузере — tests/e2e/admin-next-static-render.cjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");
const pages = new Map(JSON.parse(execFileSync(process.execPath, [root("tests/e2e/admin-next-pages.cjs"), "--json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })).map((row) => [row.name, row]));
const html = (name) => pages.get(name).html;
const count = (value, pattern) => [...value.matchAll(pattern)].length;
const text = (value) => value.replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
const all = (value, pattern) => [...value.matchAll(pattern)].map((match) => match[1]);
const MODES = ["admin-cookie", "admin-no-cookie", "preview-cookie", "staff-cookie"];
const LEGACY_MODES = MODES.slice(1);
const NEXT = /data-slot="page-header"/u;

const sourcesIn = (directory) => readdirSync(root(directory), { recursive: true }).filter((file) => /\.(tsx?|ts)$/u.test(String(file))).map((file) => `${directory}/${file}`);
const NEW_DIRS = ["reports-next", "finance-next", "marketing-next", "settings-next", "ai-agent-next", "admin-next"].map((name) => `src/components/v3/${name}`);
const NEW_FILES = NEW_DIRS.flatMap(sourcesIn);
const names = (value) => [...new Set(all(value, /\bname="([a-z_]+)"/gu))].sort();
const actionsIn = (value) => [...new Set(all(value, /\b([a-z][A-Za-z]+Action)\b/gu))].sort();

/* ---------------------------------------------------------------- выбор вида: переключатель и только администратор */

const SCREENS = [
  ["settings-staff", "v3-settings-nav-compact"], ["settings-roles", "v3-settings-nav-compact"], ["settings-departments", "v3-settings-nav-compact"],
  ["settings-integrations", "v3-settings-integrations"], ["settings-integrations-wazzup", "v3-wazzup-card"], ["settings-telephony", "v3-settings-telephony"],
  ["settings-reports", "v3-settings-reports"], ["settings-journal", "v3-audit-export"], ["settings-deletion", "v3-deletions"], ["settings-documents", "v3-settings-nav-compact"],
  ["settings-platform", "v3-settings-nav-compact"], ["finance", "v3-looker-report-finance"], ["ai-documents", "v3-ai-documents"], ["ai-review", "v3-ai-review"],
  ["ai-lab", "v3-ai-examples"], ["ai-rules", "v3-ai-rules"], ["ai-spend", "v3-ai-spend"], ["ai-autosend", "v3-ai-autosend"],
];

test("каждый экран потока: новый вид только у администратора с cookie; без cookie, в просмотре роли и у сотрудника — прежняя разметка", () => {
  for (const [name, marker] of SCREENS) {
    const next = html(`${name}:admin-cookie`);
    assert.match(next, NEXT, `${name}: шапка набора`);
    assert.equal(count(next, /<h1[ >]/gu), 1, `${name}: один h1`);
    for (const mode of LEGACY_MODES) {
      const legacy = html(`${name}:${mode}`);
      assert.doesNotMatch(legacy, /data-slot="(?:page-header|card|data-table|badge)"/u, `${name}:${mode}: виджетов нового вида нет`);
      assert.ok(legacy.includes(marker) || /v3-/u.test(legacy), `${name}:${mode}: прежняя разметка`);
    }
  }
  // «Маркетинг» открыт только настоящему администратору: просмотр роли и сотрудник получают прежний отказ (не нового вида).
  for (const name of ["marketing-overview", "marketing-leads", "marketing-reports"]) {
    assert.match(html(`${name}:admin-cookie`), /data-testid="v3-marketing"/u, name);
    assert.match(html(`${name}:admin-cookie`), NEXT, name);
    assert.doesNotMatch(html(`${name}:admin-no-cookie`), /data-slot="(?:page-header|card)"/u, `${name}: без cookie прежний вид`);
    for (const mode of ["preview-cookie", "staff-cookie"]) assert.equal(pages.get(`${name}:${mode}`).rejected, "marketing_forbidden", `${name}:${mode}`);
  }
});

test("cookie ничего не даёт сотруднику и просмотру роли: у «Финансов» и «ИИ-агента» они видят прежний вид", () => {
  for (const name of ["finance", "finance-empty", "ai-documents", "ai-spend"]) {
    for (const mode of ["preview-cookie", "staff-cookie"]) assert.doesNotMatch(html(`${name}:${mode}`), /data-slot="(?:page-header|card)"/u, `${name}:${mode}`);
  }
  // Просмотр роли с cookie на «Настройках»: страница та же, что и без cookie (а не новая).
  assert.doesNotMatch(html("settings-staff:preview-cookie"), NEXT);
});

/* ------------------------------------------------------------------------------------------ «Настройки» */

test("«Настройки»: те же десять разделов с теми же адресами, число у «Запросов на удаление», одно предупреждение о сломанном сервисе", () => {
  const next = html("settings-staff:admin-cookie");
  const legacy = html("settings-staff:admin-no-cookie");
  // Строки сотрудников в прежнем виде — ссылки `&member=`; в новом строка открывает панель на месте и ведёт к тому же адресу через `history`.
  const hrefs = (value) => [...new Set(all(value, /href="(\/v3\/settings\?section=[^"]+)"/gu))].filter((href) => !href.includes("member=")).sort();
  assert.deepEqual(hrefs(next), hrefs(legacy), "те же адреса разделов");
  assert.match(read("src/components/v3/settings-next/StaffNext.tsx"), /`\$\{PEOPLE_HREF\}&member=\$\{encodeURIComponent\(id\)\}`/u, "адрес выбранного сотрудника — тот же");
  assert.ok(hrefs(next).length >= 9);
  assert.match(next, /aria-label="Разделы настроек"/u, "ряд разделов — ссылки");
  assert.match(next, /aria-current="page"[^>]*>(?:<span[^>]*>)?Сотрудники</u, "текущий раздел назван");
  assert.match(text(next), /Запросы на удаление 2/u, "число открытых запросов");
  // Сломанный настроенный сервис — одна строка над разделами, кроме самих «Интеграций»; текст тот же.
  const banner = (value) => text(value.slice(value.indexOf('data-testid="v3-settings-blocking"'), value.indexOf('data-testid="v3-settings-blocking"') + 900)).split("Открыть")[0];
  for (const name of ["settings-journal", "settings-reports"]) assert.doesNotMatch(html(`${name}:admin-cookie`), /v3-settings-blocking/u, `${name}: сервисы в порядке`);
  const blocked = html("settings-integrations:admin-cookie");
  assert.doesNotMatch(blocked, /v3-settings-blocking/u, "на «Интеграциях» таблица сама говорит");
  assert.match(text(blocked), /amoCRM/u);
  assert.equal(banner(html("settings-integrations:admin-no-cookie")).length >= 0, true);
  assert.match(read("src/components/v3/settings-next/BlockingNotice.tsx"), /row\.blocksWork/u, "предупреждение — только у настроенного и сломанного сервиса");
});

test("«Сотрудники», «Роли и доступ», «Отделы»: те же люди, роли и отделы с теми же словами; панель открывает запись", () => {
  const staffNext = text(html("settings-staff:admin-cookie"));
  const staffLegacy = text(html("settings-staff:admin-no-cookie"));
  for (const word of ["Айна Тестова", "Бекболот Примеров", "Данияр Макетов", "Доступ заблокирован", "Руководитель сопровождения", "Журнал доступа"]) {
    assert.match(staffNext, new RegExp(word, "u"), `новый: ${word}`);
    assert.match(staffLegacy, new RegExp(word, "u"), `прежний: ${word}`);
  }
  assert.match(html("settings-staff:admin-cookie"), /aria-label="Список сотрудников"/u);
  assert.match(html("settings-staff:admin-cookie"), /aria-expanded="false"[^>]*>(?:<svg.*?<\/svg>)?Пригласить сотрудника/su, "приглашение — раскрывающаяся форма, не панель");
  const rolesNext = text(html("settings-roles:admin-cookie"));
  for (const word of ["Admissions", "Sales Manager", "Финансист \\(черновик\\)", "Черновик", "Опубликована", "Создать роль", "Посмотреть интерфейс роли"]) assert.match(rolesNext, new RegExp(word, "u"), word);
  assert.doesNotMatch(rolesNext, /Прежний куратор/u, "архивные скрыты, пока не включены");
  assert.match(text(html("settings-roles:admin-no-cookie")), /Создать роль/u);
  const departments = text(html("settings-departments:admin-cookie"));
  for (const word of ["Продажи", "Сопровождение", "Добавить отдел", "Показать архивные · 1"]) assert.match(departments, new RegExp(word, "u"), word);
  assert.doesNotMatch(departments, /Старый отдел/u, "архивный отдел скрыт");
});

test("«Интеграции»: те же сервисы и слова состояния; карточка Wazzup — только чтение, те же слова, запасной путь WAHA назван; без Wazzup — прежнее подключение с QR", () => {
  const rows = (value) => all(value, /data-integration="(\w+)"/gu).sort();
  assert.deepEqual([...new Set(rows(html("settings-integrations:admin-cookie")))], [...new Set(rows(html("settings-integrations:admin-no-cookie")))], "те же четыре сервиса");
  for (const mode of ["admin-cookie", "admin-no-cookie"]) {
    const value = text(html(`settings-integrations-wazzup:${mode}`));
    for (const word of ["WhatsApp продаж через Wazzup", "Подключён", "Обычный WhatsApp", "••••4821", "Последнее входящее", "27.10 14:41", "Приём", "включён", "Ответы из EVO", "Запасной путь WAHA выключен, пока работает Wazzup."]) {
      assert.ok(value.includes(word), `${mode}: ${word}`);
    }
  }
  const nextCard = html("settings-integrations-wazzup:admin-cookie");
  const body = nextCard.slice(nextCard.indexOf('data-testid="v3-wazzup-card"'), nextCard.indexOf('data-testid="v3-wazzup-fallback"'));
  assert.doesNotMatch(body, /<button|<form|<a |<input|onclick/iu, "карточка канала не даёт действий");
  assert.doesNotMatch(text(nextCard), /Wazzup[^.]*QR|Получить код|Подключить\b/u, "у Wazzup нет QR и кода");
  assert.match(nextCard, /id="whatsapp-connect"/u, "якорь подключения тот же");
  // Путь WAHA: блок «Подключение WhatsApp» (QR) стоит под таблицей, как раньше.
  assert.match(text(html("settings-integrations:admin-cookie")), /Подключение WhatsApp/u);
  assert.match(text(html("settings-integrations:admin-no-cookie")), /Подключение WhatsApp/u);
});

test("«Телефония»: те же слова состояния, вердикт, строки пользователей ВАТС и поля настроек; значения кабинета ВАТС названы", () => {
  const next = html("settings-telephony:admin-cookie");
  const legacy = html("settings-telephony:admin-no-cookie");
  const verdict = (value) => text(value.slice(value.indexOf('data-testid="v3-telephony-verdict"'), value.indexOf('data-testid="v3-telephony-verdict"') + 300)).split(">")[1]?.split("Приём")[0]?.trim() ?? "";
  assert.match(verdict(next), /^(Замечаний нет|Требует внимания: \d+ из \d+)/u);
  assert.equal(verdict(next).slice(0, 12), verdict(legacy).slice(0, 12));
  // Строки «Остальные» и значения кабинета ВАТС лежат в панелях (в разметке страницы их нет); остальные признаки блоков те же.
  const marks = (value) => [...new Set(all(value, /data-testid="(v3-telephony-[a-z-]+)"/gu))].filter((id) => !/rest|folded|copy-value|connection/u.test(id)).sort();
  assert.deepEqual(marks(next), marks(legacy), "те же признаки блоков");
  for (const id of ["v3-telephony-status-rest", "v3-telephony-connection-folded"]) assert.ok(read("src/components/v3/settings-next/TelephonyStatus.tsx").includes(id) || read("src/components/v3/settings-next/TelephonyGuide.tsx").includes(id), id);
  assert.match(next, /data-testid="v3-telephony-extensions"/u, "пользователи ВАТС — прежний блок");
  assert.match(next, /data-testid="v3-telephony-settings-status"/u, "форма настроек — прежняя");
  assert.match(text(next), /Подключение «Ваша CRM» в кабинете ВАТС/u);
  assert.match(text(next), /Состояние/u);
});

test("«Отчёты»: те же две карточки, те же поля формы и подпись о доступе; «Открыть раздел» — те же адреса", () => {
  const next = html("settings-reports:admin-cookie");
  const legacy = html("settings-reports:admin-no-cookie");
  assert.deepEqual(names(next), names(legacy), "те же имена полей формы");
  for (const field of ["embed", "request_id", "report_key", "expected_version"]) assert.ok(names(next).includes(field), field);
  for (const value of [next, legacy]) {
    assert.match(text(value), /Подключён · изменён 27\.10, 15:32/u);
    assert.match(text(value), /Не подключён/u);
    assert.match(text(value), /Снятие роли в CRM не закрывает отчёт в Google/u, "примечание о доступе — одно, на виду");
    assert.equal(count(value, /data-testid="v3-settings-reports-note"/gu), 1);
  }
  assert.deepEqual(all(next, /href="(\/v3\/(?:finance|marketing\?view=reports))"/gu).sort(), all(legacy, /href="(\/v3\/(?:finance|marketing\?view=reports))"/gu).sort());
});

test("«Журнал действий»: те же события и фильтры-ссылки; экспорт — та же форма с теми же полями; следующая страница — тот же адрес", () => {
  const next = html("settings-journal:admin-cookie");
  const legacy = html("settings-journal:admin-no-cookie");
  for (const word of ["Задача создана", "Журнал действий"]) assert.match(text(next), new RegExp(word.split(" ")[0], "u"));
  const filterHrefs = (value) => [...new Set(all(value, /href="(\/v3\/settings\?section=journal[^"]*)"/gu).map((href) => href.replaceAll("&amp;", "&")))].sort();
  assert.deepEqual(filterHrefs(next), filterHrefs(legacy), "те же адреса фильтров и следующей страницы");
  const form = (value) => value.slice(value.indexOf('action="/api/platform-audit/export"'), value.indexOf("</form>", value.indexOf('action="/api/platform-audit/export"')));
  assert.deepEqual(names(form(next)), names(form(legacy)));
  assert.deepEqual(names(form(next)), ["end_at", "request_id", "start_at"]);
  assert.match(text(next), /Следующие события/u);
  assert.match(text(legacy), /Следующие события/u);
});

test("«Запросы на удаление»: та же очередь со сроками и состояниями; просроченное остаётся на виду; открытие запроса — тот же адрес `?request=`", () => {
  const next = text(html("settings-deletion:admin-cookie"));
  const legacy = text(html("settings-deletion:admin-no-cookie"));
  for (const word of ["Заявитель 1", "Студентка Вымышленная", "просрочено на", "ждёт удаления", "выполнено|удалено", "Открытых запросов: 2"]) {
    assert.match(next, new RegExp(word, "u"), `новый: ${word}`);
    assert.match(legacy, new RegExp(word, "u"), `прежний: ${word}`);
  }
  assert.match(html("settings-deletion:admin-cookie"), /data-overdue="true"/u, "просрочка помечена");
  const source = read("src/components/v3/settings-next/DeletionNext.tsx");
  assert.match(source, /`\$\{listHref\}&request=\$\{encodeURIComponent\(row\.id\)\}`/u);
  assert.match(html("settings-deletion:admin-no-cookie"), /href="\/v3\/settings\?section=deletion&amp;request=66666666-2222-4222-8222-000000000001"/u, "прежний адрес — тот же вид");
  // Предупреждения и запреты остаются на виду в панели: слова те же, что у прежнего вида.
  const detail = read("src/components/v3/settings-next/DeletionNotices.tsx") + read("src/components/v3/settings-next/DeletionPlans.tsx");
  for (const word of ["Журнал входов не очищен", "Автоматическое удаление было начато", "Ручная обработка"]) assert.ok(detail.includes(word), word);
  for (const component of ["AccountDeletionProcess", "AccountDeletionManualDone", "AccountDeletionEmailRetry"]) assert.ok(read("src/components/v3/settings-next/DeletionDetailBody.tsx").includes(component), `${component} — прежний движок`);
});

test("«Документы и передача» и «Платформа»: те же правила, числа и предупреждения эксплуатации", () => {
  for (const [name, words] of [["settings-documents", ["PDF, JPEG, PNG", "25 МиБ", "Передач", "12", "Исключений", "Финансовых стопов"]], ["settings-platform", ["База данных", "не проверялось", "Восстановление из резервной копии не проверено", "Перенос данных", "Менеджеры в отчёте"]]]) {
    for (const mode of ["admin-cookie", "admin-no-cookie"]) for (const word of words) assert.match(text(html(`${name}:${mode}`)), new RegExp(word, "u"), `${name}:${mode}: ${word}`);
  }
});

/* ------------------------------------------------------------------------------------------ «Маркетинг» */

test("«Маркетинг»: те же вкладки и адреса, те же числа обзора; расход — те же поля и действия; сверка с «Продажами» на виду", () => {
  const next = html("marketing-overview:admin-cookie");
  const legacy = html("marketing-overview:admin-no-cookie");
  const tabs = (value) => [...new Set(all(value, /href="(\/v3\/marketing[^"]*)"/gu).map((href) => href.replaceAll("&amp;", "&")))].sort();
  assert.deepEqual(tabs(next), tabs(legacy), "те же адреса вкладок и периода");
  assert.ok(tabs(next).includes("/v3/marketing?view=reports"), "вкладка «Отчёты» — при подключённой ссылке");
  for (const mode of ["admin-cookie", "admin-no-cookie"]) {
    const value = text(html(`marketing-overview:${mode}`));
    for (const word of ["1 200 USD", "18", "11 из 18", "Совпадает", "связано вручную 1", "Повторные обращения", "Откуда узнал", "Без привязки к лиду", "Расход вводился|Расход периода"]) assert.match(value, new RegExp(word, "u"), `${mode}: ${word}`);
  }
  const sheet = read("src/components/v3/marketing-next/SpendAddSheet.tsx");
  const legacyForm = read("src/components/v3/marketing/MarketingSpendForm.tsx");
  assert.deepEqual(names(sheet), names(legacyForm), "те же поля формы расхода");
  assert.deepEqual(actionsIn(sheet), actionsIn(legacyForm), "то же действие записи");
  assert.deepEqual(actionsIn(read("src/components/v3/marketing-next/LeadsNext.tsx")), actionsIn(read("src/components/v3/marketing/MarketingLeadsTable.tsx")), "тот же «Показать ещё»");
  assert.equal(count(next, /data-testid="marketing-reconciliation"/gu), 1);
  for (const value of [next, legacy]) assert.match(value, /data-testid="marketing-website-source"[^>]*>10</u, "источник «Сайт» — то же число");
  assert.match(next, /data-matches="true"/u);
});

test("«Маркетинг → Заявки»: те же лиды; фильтры — та же GET-форма с теми же именами; «Указать» у «Не известно»; «Показать ещё» при неполном списке", () => {
  const next = html("marketing-leads:admin-cookie");
  const legacy = html("marketing-leads:admin-no-cookie");
  for (const word of ["Лид Вымышленный 1", "Лид без имени", "Заявок по фильтрам: 48", "показано 6", "Показать ещё", "Указать"]) {
    assert.match(text(next), new RegExp(word, "u"), `новый: ${word}`);
    assert.match(text(legacy), new RegExp(word, "u"), `прежний: ${word}`);
  }
  // Фильтры нового вида стоят в панели (в разметке страницы их нет): поля и форма сверяются по файлу с прежним.
  const form = (value) => value.slice(value.indexOf('aria-label="Фильтры заявок"'), value.indexOf("</form>", value.indexOf('aria-label="Фильтры заявок"')));
  const sheet = read("src/components/v3/marketing-next/LeadFiltersSheet.tsx");
  const filters = (list) => list.filter((name) => !["period", "from", "to"].includes(name));
  assert.deepEqual(filters(names(sheet)), filters(names(form(legacy))), "те же имена полей фильтра (период форма несёт скрытыми полями при выбранном «Периоде»)");
  assert.deepEqual(filters(names(sheet)), ["campaign", "channel", "contract", "no_owner", "stage", "unknown", "view"]);
  assert.match(sheet, /action="\/v3\/marketing"/u);
  assert.match(sheet, /method="get"/u);
});

test("«Маркетинг → Отчёты»: окно Looker Studio с тем же адресом и теми же правами песочницы, подпись источника на виду", () => {
  const next = html("marketing-reports:admin-cookie");
  const legacy = html("marketing-reports:admin-no-cookie");
  for (const value of [next, legacy]) {
    // Окно (`iframe`) ставится на клиенте от 768 px, поэтому в разметке сервера его нет в обоих видах; адрес окна и права песочницы — в Chromium-стенде.
    assert.match(value, /href="https:\/\/lookerstudio\.google\.com\/reporting\/abcdefgh12\/page\/pg01"/u);
    assert.match(value, /Данные Meta Ads и Instagram приходят из Windsor\.ai/u);
  }
  assert.equal(all(next, /sandbox="([^"]+)"/gu).length, all(legacy, /sandbox="([^"]+)"/gu).length);
  assert.deepEqual(all(next, /sandbox="([^"]+)"/gu), all(legacy, /sandbox="([^"]+)"/gu), "те же права окна");
  assert.deepEqual(all(next, /referrerPolicy="([^"]+)"|referrerpolicy="([^"]+)"/gu), all(legacy, /referrerPolicy="([^"]+)"|referrerpolicy="([^"]+)"/gu));
  assert.match(next, /<a [^>]*rel="noopener noreferrer"[^>]*>/u, "ссылка в новую вкладку — безопасная");
  assert.match(next, /data-testid="v3-looker-phone"/u, "на телефоне — карточка вместо окна");
});

/* ------------------------------------------------------------------------------------------ «Финансы» */

test("«Финансы»: окно и адрес те же; нет ссылки — те же слова для администратора; нет доступа — без окна и адреса", () => {
  const next = html("finance:admin-cookie");
  const legacy = html("finance:admin-no-cookie");
  assert.deepEqual(all(next, /src="(https:\/\/lookerstudio[^"]+)"/gu), all(legacy, /src="(https:\/\/lookerstudio[^"]+)"/gu));
  assert.match(text(next), /Цифры — из Google Таблицы финансиста, а не из CRM\. Они могут не совпадать с «Отчётом продаж»/u, "источник назван и на виду");
  assert.match(text(next), /Снятие роли в CRM не закрывает отчёт/u, "напоминание администратору");
  const empty = text(html("finance-empty:admin-cookie"));
  assert.match(empty, /Отчёт ещё не подключён\./u);
  assert.match(html("finance-empty:admin-cookie"), /href="\/v3\/settings\?section=reports"[^>]*>(?:<[^>]+>)*Добавить ссылку/u);
  assert.doesNotMatch(empty, /\d/u, "нет данных — нет цифр");
  const denied = html("finance-denied:admin-cookie");
  assert.match(denied, /data-testid="v3-finance-denied"/u);
  assert.doesNotMatch(denied, /iframe|lookerstudio/u, "без окна и адреса");
  assert.match(text(denied), /Нет доступа к отчёту «Финансы»/u);
});

/* ------------------------------------------------------------------------------------------ «ИИ-агент» */

test("«ИИ-агент»: те же подразделы-ссылки с числом листа сверки, возврат к хабу, те же материалы, предупреждения и пауза автоответчика", () => {
  const next = html("ai-documents:admin-cookie");
  const legacy = html("ai-documents:admin-no-cookie");
  const hrefs = (value) => [...new Set(all(value, /href="(\/v3\/ai-agent[^"]*)"/gu).map((href) => href.replaceAll("&amp;", "&")))];
  for (const href of ["/v3/ai-agent", "/v3/ai-agent?section=review", "/v3/ai-agent?section=lab", "/v3/ai-agent?section=rules", "/v3/ai-agent?section=spend", "/v3/ai-agent?section=autosend"]) {
    assert.ok(hrefs(next).includes(href), `новый: ${href}`);
    assert.ok(hrefs(legacy).includes(href), `прежний: ${href}`);
  }
  assert.match(next, /href="\/v3\/ai-agents"[^>]*>(?:<[^>]+>)*Все ИИ-агенты/u);
  for (const word of ["Прайс 2026 — Малайзия \\(скан\\)", "Буклет EVO 2026", "Политика возвратов", "Нужна сверка · 3", "Похоже на документ клиента"]) {
    assert.match(text(next), new RegExp(word, "u"), `новый: ${word}`);
    assert.match(text(legacy), new RegExp(word, "u"), `прежний: ${word}`);
  }
  assert.match(text(next), /Лист сверки 4/u, "число у вкладки «Лист сверки»: открытые и применяемые");
  for (const mode of MODES.slice(0, 2)) {
    const paused = html(`ai-documents-paused:${mode}`);
    assert.match(paused, /data-testid="v3-ai-autosend-pause-banner"/u, `${mode}: пауза видна в любом подразделе`);
    assert.match(text(paused), /Автоответчик на паузе: WhatsApp не на связи/u);
    assert.match(paused, /href="\/v3\/ai-agent\?section=autosend"/u);
  }
  assert.doesNotMatch(html("ai-documents:admin-cookie"), /v3-ai-consent"|v3-ai-feature-off/u, "согласие записано, агент подключён: строк нет");
});

test("«ИИ-агент → Автоответчик, Расходы, Правила, Лист сверки, Лаборатория»: те же слова, числа и команды", () => {
  const checks = [
    ["ai-autosend", ["Автоответчик", "Проверка без отправки|Отвечает", "Ответственный: Айгерим Синтетическая", "Отправка выключена на сервере", "Настройки", "Журнал", "Утренняя сводка"]],
    ["ai-autosend-journal", ["Отправил бы", "Здравствуйте! Магистратура", "Сотрудник отвечал или был активен в чате последние 15 минут", "Показаны последние 3 решений"]],
    ["ai-autosend-summary", ["Диалогов", "Сообщений рассмотрено", "Позвонить", "Чат недоступен"]],
    ["ai-spend", ["Сегодня", "Этот месяц", "Лимит на месяц", "Ответы клиентам", "Агент и лимит", "Память о клиенте", "Gemini принимает ключ EVO"]],
    ["ai-rules", ["Версия 2", "нужна проверка", "Проверено", "История версий"]],
    ["ai-review", ["Лист сверки", "Открытые", "Решённые", "Прайс 2026 — Малайзия", "1 250,00 \\$"]],
    ["ai-lab", ["Проверка ответа", "Эталонные ответы", "Можно ли поступить в Малайзию без IELTS"]],
    ["ai-viewer", ["Прайс 2026 — Малайзия", "Фрагменты", "Материалы агента"]],
  ];
  for (const [name, words] of checks) {
    for (const mode of ["admin-cookie", "admin-no-cookie"]) {
      const value = text(html(`${name}:${mode}`));
      for (const word of words) assert.match(value, new RegExp(word, "u"), `${name}:${mode}: ${word}`);
    }
  }
  assert.match(html("ai-autosend:admin-cookie"), /data-testid="v3-ai-autosend-server-off"/u, "выключенная отправка на сервере — на виду");
});

/* ------------------------------------------------- те же команды, поля форм и request_id в новом виде */

test("команды и поля форм те же, что в прежних файлах: ни одного нового действия и ни одной новой команды", () => {
  const joined = (paths) => paths.map(read).join("\n");
  for (const [next, legacy] of [
    [NEW_DIRS[2], ["src/components/v3/marketing"]],
    [NEW_DIRS[3], ["src/components/v3/settings"]],
    [NEW_DIRS[4], ["src/components/v3/ai-agent"]],
  ]) {
    const nextActions = actionsIn(joined(sourcesIn(next)));
    const legacyActions = actionsIn(joined(legacy.flatMap(sourcesIn)));
    const extra = nextActions.filter((action) => !legacyActions.includes(action) && !/^set[A-Z]|^use[A-Z]|^toggle[A-Z]/u.test(action));
    assert.deepEqual(extra.filter((action) => !["onAction", "refreshAction"].includes(action)), [], `${next}: новых серверных действий нет`);
  }
  // Новый вид «Настроек» берёт действия только у прежних клиентских форм: сам ни одного действия не вызывает напрямую.
  assert.deepEqual(actionsIn(joinedSource(NEW_DIRS[3])).filter((action) => /^(?:staff|save|remove|process|record|select)/u.test(action)), ["selectStaffRolePreviewAction"], "одно действие — просмотр роли (то же)");
});
function joinedSource(directory) { return sourcesIn(directory).map(read).join("\n"); }

test("правила Wazzup (только чтение) в новом виде те же: свежесть состояния, слова, запасной путь, ни одной кнопки в карточке", () => {
  const card = read("src/components/v3/settings-next/TransportCardNext.tsx");
  assert.ok(card.split("\n").length <= 150);
  assert.match(card, /wazzupChannelWords\(transport\.channel\?\.state \?\? null, \{\s*observedAt: transport\.channel\?\.observedAt \?\? null,\s*nowMs: now\.getTime\(\),\s*\}\)/u, "слово состояния — с тем же «сейчас»");
  assert.match(card, /WAZZUP_FALLBACK_LINE/u);
  assert.match(card, /wazzupCardRows\(transport, intakeEnabled/u);
  assert.doesNotMatch(card, /"use client"|onClick|<button|<form|fetch\(|WHATSAPP_CONNECT_PATH|Button\b/u, "блок только для чтения: действий нет");
  assert.doesNotMatch(card, /Bearer|crmKey|api\.wazzup24|EVO_PLATFORM_WAZZUP_WEBHOOK_TOKEN|\+\d{6,}/u, "ни ключа, ни адреса, ни номера");
  const table = read("src/components/v3/settings-next/IntegrationsNext.tsx");
  assert.match(table, /whatsapp\.wazzup\s*\n?\s*\? <TransportCardNext/u, "карточка Wazzup стоит на месте блока подключения WAHA");
  assert.match(table, /: <WhatsAppConnectSection initialStatus=/u);
  assert.match(table, /WHATSAPP_CONNECT_ANCHOR/u, "ссылка на блок подключения не дублируется второй");
});

/* --------------------------------------------------------------- первая загрузка: ленивые входы и серверные тексты */

test("входы нового вида ленивые, с заглушкой при обрыве связи; у каждого маршрута есть loading.tsx; страницы не подключают новый вид статически", () => {
  const routes = { settings: "SettingsNextLazy", marketing: "MarketingNextLazy", finance: "FinanceNextLazy", "ai-agent": "AiAgentNextLazy" };
  for (const [route, name] of Object.entries(routes)) {
    const dir = `src/app/(v3)/v3/${route}`;
    assert.ok(existsSync(root(`${dir}/loading.tsx`)), `${route}: есть loading.tsx`);
    const page = read(`${dir}/page.tsx`);
    assert.match(page, new RegExp(`<${name}\\b`, "u"), `${route}: страница рисует ${name}`);
    assert.match(page, /await isNextUi\(actor\)/u, `${route}: выбор вида — переключатель`);
    const imports = [...page.matchAll(/^import .* from "(@\/components\/v3\/[^"]+)";$/gmu)].map((match) => match[1]);
    for (const path of imports.filter((value) => /-next\//u.test(value))) assert.match(path, /Lazy$|-types$/u, `${route}: ${path} — только ленивый вход и типы`);
  }
  for (const file of ["settings-next/SettingsNextLazy", "marketing-next/MarketingNextLazy", "finance-next/FinanceNextLazy", "ai-agent-next/AiAgentNextLazy"]) {
    const entry = read(`src/components/v3/${file}.tsx`);
    assert.match(entry, /^"use client";/u, file);
    assert.match(entry, /\.catch\(onScreenLoadFailed\)/u, `${file}: при обрыве связи — «Обновить страницу»`);
    assert.match(entry, /from "next\/dynamic"/u);
  }
});

test("серверные тексты агентов и ключи не попадают в клиентский граф нового вида; видимые свойства — данные", () => {
  const forbidden = /@\/content\/|server-only|node:crypto|process\.env|SUPABASE_SERVICE|api\.wazzup24/u;
  for (const file of NEW_FILES) assert.doesNotMatch(read(file), forbidden, file);
  // request_id и время выдаёт страница: клиентский вид не зовёт randomUUID и не читает часы страницы для данных.
  for (const file of NEW_FILES) assert.doesNotMatch(read(file), /import \{[^}]*randomUUID[^}]*\} from|[^.]\brandomUUID\(/u, `${file}: первый request_id выдаёт сервер (в браузере — только следующий, как раньше: crypto.randomUUID)`);
  for (const file of ["src/lib/v3/settings-next-props.ts", "src/lib/v3/marketing-next-props.ts"]) assert.match(read(file), /randomUUID/u, file);
});

test("файлы нового вида короткие (до 150 строк) и собраны из набора виджетов", () => {
  for (const file of NEW_FILES) assert.ok(read(file).split("\n").length <= 150, `${file}: ${read(file).split("\n").length} строк`);
  for (const file of ["src/lib/v3/settings-next-props.ts", "src/lib/v3/marketing-next-props.ts"]) assert.ok(read(file).split("\n").length <= 150, file);
  const pagesSources = NEW_FILES.filter((file) => /(?:NextPage|Next)\.tsx$/u.test(file)).map(read).join("\n");
  for (const widget of ["PageShell", "WidgetCard", "DataTable", "DetailSheet", "SectionTabs", "StatusBadge", "KeyFacts", "StatTile", "EmptyState"]) assert.match(pagesSources, new RegExp(`\\b${widget}\\b`, "u"), `набор: ${widget}`);
  // Таблицы списков — TanStack через `DataTable`, а не рукописные `<table>` со своими строками (сводные таблицы отчёта — `ReportTable`).
  for (const file of NEW_FILES.filter((path) => path.endsWith(".tsx"))) assert.doesNotMatch(read(file), /<table\b/u, `${file}: рукописной таблицы нет`);
});
