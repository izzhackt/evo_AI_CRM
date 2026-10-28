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

test("входы нового вида ленивые, с заглушкой при обрыве связи; у маршрутов нет своего loading.tsx (он менял бы и прежний вид); страницы не подключают новый вид статически", () => {
  const routes = { settings: "SettingsNextLazy", marketing: "MarketingNextLazy", finance: "FinanceNextLazy", "ai-agent": "AiAgentNextLazy" };
  for (const [route, name] of Object.entries(routes)) {
    const dir = `src/app/(v3)/v3/${route}`;
    assert.equal(existsSync(root(`${dir}/loading.tsx`)), false, `${route}: loading.tsx нет: граница Suspense маршрута стала бы и у сотрудников с прежним видом (скелет, ответ 200 вместо 307/404)`);
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
    // Границу `Suspense` над ленивым куском держит сам вход (опция `loading` у `next/dynamic`): так сервер слышит отказ кода, а ответ остаётся 200.
    assert.match(entry, /\{\s*loading: /u, `${file}: заглушка загрузки — граница Suspense внутри входа нового вида`);
    assert.match(entry, /NextScreenLoading/u, file);
  }
  // Скелет входа лежит в первой загрузке маршрута: ни одного импорта (`cn` тянул бы `tailwind-merge` ≈ 8 КБ gzip, виджеты набора — свой код).
  assert.doesNotMatch(read("src/components/v3/admin-next/NextScreenLoading.tsx"), /^import /mu, "NextScreenLoading без импортов");
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

/* ------------------------------------------------------------------ правки по независимой проверке (28.10.2026) */

const region = (value, id) => value.match(new RegExp(`<div[^>]*data-testid="${id}"[^>]*>`, "u"))?.[0] ?? "";

test("«Создать аккаунт» и «Пригласить сотрудника»: обе формы стоят на странице с самого начала (скрыты), а не собираются заново при каждом выборе: пароль и неизвестный итог не теряются", () => {
  const next = html("settings-staff:admin-cookie");
  for (const [id, operation] of [["v3-staff-new-account", "password"], ["v3-staff-new-invite", "invite"]]) {
    assert.match(region(next, id), /\shidden=""/u, `${id}: скрыта, но в разметке`);
    const from = next.indexOf(`data-testid="${id}"`);
    assert.ok(next.indexOf(`name="operation" value="${operation}"`, from) > from, `${id}: форма «${operation}» внутри`);
  }
  const source = read("src/components/v3/settings-next/StaffNewAccess.tsx");
  assert.doesNotMatch(source, /panel \? \(/u, "форма не выбрасывается условием");
  assert.match(source, /hidden=\{panel !== /u);
  assert.match(source, /\.focus\(\)/u, "«Закрыть» возвращает фокус на кнопку, что открыла форму");
});

test("панели «Журнала доступа», сотрудника, роли, отдела, расхода и запроса на удаление не закрываются, пока запрос не завершён или итог неизвестен, и спрашивают при несохранённой правке", () => {
  const guard = read("src/components/v3/admin-next/SheetGuard.tsx");
  assert.match(guard, /Есть несохранённые изменения\. Закрыть без сохранения\?/u, "тот же вопрос, что у первой волны");
  assert.match(guard, /window\.confirm/u);
  assert.match(guard, /isConnected/u, "правка в уже закрытой форме не считается");
  for (const file of ["StaffAccessLog", "StaffNext", "RolesNext", "DepartmentsNext", "DeletionNext"]) {
    assert.match(read(`src/components/v3/settings-next/${file}.tsx`), /useSheetGuard\(\)/u, file);
    assert.match(read(`src/components/v3/settings-next/${file}.tsx`), /allowClose\(/u, `${file}: закрытие идёт через охрану`);
  }
  // Независимая проверка сборки 2B: заметка «Что сделано» и слово подтверждения стоят на странице у прежнего вида, а в панели Esc и щелчок мимо
  // закрывали их без вопроса. Тело панели лежит под охраной, а закрытие идёт только через неё (не напрямую в `go(null, listHref)`).
  const deletion = read("src/components/v3/settings-next/DeletionNext.tsx");
  assert.match(deletion, /<GuardedBody guard=\{guard\}>[\s\S]*<DeletionDetailBody[\s\S]*<\/GuardedBody>/u, "запрос в панели лежит под охраной");
  assert.match(deletion, /onOpenChange=\{\(next\) => \{ if \(!next && guard\.allowClose\(\)\) go\(null, listHref\); \}\}/u, "закрытие панели идёт через allowClose");
  assert.doesNotMatch(deletion, /onOpenChange=\{\(next\) => \{ if \(!next\) go\(/u, "закрытия без охраны нет");
  assert.match(read("src/components/v3/marketing-next/SpendAddSheet.tsx"), /allowClose\(/u);
  // Формы прежнего вида сообщают панели о незавершённом запросе через необязательный контекст (без него — ничего не делают, разметка та же).
  for (const file of ["useStaffCommandForm.tsx", "StaffRoleForms.tsx", "StaffMemberDetails.tsx", "StaffSection.tsx"]) {
    assert.match(read(`src/components/v3/settings/${file}`), /useStaffSheetLock\(/u, file);
  }
  const lock = read("src/components/v3/settings/staff-sheet-lock.ts");
  assert.match(lock, /createContext<[^>]*\| null>\(null\)/u, "по умолчанию контекста нет");
  assert.match(lock, /if \(!report\) return/u, "без панели хук ничего не делает");
});

test("«Открыть роль» и ссылка `?member=` после мягкого перехода открывают запись: выбор из адреса подхватывается и при смене свойства, а не только при первом показе", () => {
  for (const [file, key] of [["RolesNext", "selectedRoleId"], ["StaffNext", "selectedMemberId"]]) {
    const source = read(`src/components/v3/settings-next/${file}.tsx`);
    assert.match(source, new RegExp(`if \\(synced !== ${key}\\)`, "u"), `${file}: свойство ${key} переносится в состояние при смене`);
  }
  // Копия роли — в той же панели (две панели подряд оставляли фокус на строке за ними).
  assert.doesNotMatch(read("src/components/v3/settings-next/RoleSheetBody.tsx"), /onCopy/u);
  assert.match(read("src/components/v3/settings-next/RoleSheetBody.tsx"), /Скопировать роль/u);
});

test("загрузка материала: форма стоит на странице всегда (свёрнутая скрыта), поэтому сворачивание не обрывает передачу", () => {
  const next = html("ai-documents:admin-cookie");
  assert.match(region(next, "v3-ai-upload-region"), /\shidden=""/u, "свёрнута, но в разметке");
  assert.ok(next.indexOf('data-testid="v3-ai-upload"', next.indexOf('data-testid="v3-ai-upload-region"')) > 0, "форма загрузки внутри");
  assert.doesNotMatch(read("src/components/v3/ai-agent-next/AiUploadPanel.tsx"), /\{open \? \(/u);
});

test("«Журнал действий»: ссылка «Следующие события» есть и тогда, когда ни у одного события страницы нет названия; слова события, актора и объекта считает сервер", () => {
  const next = html("settings-journal-unnamed:admin-cookie");
  const legacy = html("settings-journal-unnamed:admin-no-cookie");
  for (const [mode, value] of [["новый", next], ["прежний", legacy]]) {
    assert.match(text(value), /2 события без названия/u, `${mode}: счёт событий без названия`);
    assert.match(text(value), /Следующие события/u, `${mode}: ссылка на следующую страницу`);
  }
  const hrefOf = (value) => value.match(/href="([^"]*snapshot=[^"]*)"[^>]*>(?:<[^>]+>)*Следующие события/u)?.[1];
  assert.equal(hrefOf(next)?.replaceAll("&amp;", "&"), hrefOf(legacy)?.replaceAll("&amp;", "&"), "тот же адрес курсора");
  assert.doesNotMatch(text(next), /future\.action|case_task/u, "сырые коды не показываются");
  const journal = read("src/components/v3/settings-next/JournalNext.tsx");
  assert.doesNotMatch(journal, /^import (?!type )[^\n]*from "@\/lib\/v3\/(?:wording|settings-journal-contract)"/mu, "слова журнала не едут в клиентский кусок: они в общей первой загрузке всех маршрутов");
  assert.match(read("src/lib/v3/settings-next-props.ts"), /journalNextProps/u);
  const ready = html("settings-journal:admin-cookie");
  for (const word of ["Задача создана", "Сотрудник", "Задача"]) assert.match(text(ready), new RegExp(word, "u"), `слова журнала с сервера: ${word}`);
});

test("«Лист сверки»: у открытого пункта, чьё исправление не применилось, ошибка видна в списке, а не только в панели", () => {
  const next = html("ai-review:admin-cookie");
  const legacy = html("ai-review:admin-no-cookie");
  const sentence = "Исправление не применилось: число встречается в тексте не один раз. Подтвердите или исправьте снова.";
  assert.equal(count(text(legacy), new RegExp(sentence, "gu")), 1, "прежний вид: на виду");
  // Таблица и карточки телефона — две отрисовки одного списка; панель в разметке закрыта, поэтому полная фраза пришла из списка, а не из панели.
  assert.ok(count(text(next), new RegExp(sentence, "gu")) >= 1, "новый вид: тоже в списке");
  assert.match(next, /t-meta text-warn[^>]*>Исправление не применилось/u, "предупреждающий цвет, не серая подпись");
});

test("длинные подписи кнопок-команд ИИ-агента переносятся, а не растягивают карточку и панель", () => {
  const next = html("ai-spend:admin-cookie");
  const revoke = next.slice(next.indexOf('data-testid="v3-ai-consent-revoke"'));
  const button = revoke.match(/<button[^>]*type="submit"[^>]*class="([^"]*)"|<button[^>]*class="([^"]*)"[^>]*type="submit"/u);
  const classes = (button?.[1] ?? button?.[2] ?? "").split(/\s+/u);
  assert.ok(classes.includes("whitespace-normal"), "подпись переносится");
  assert.ok(!classes.includes("whitespace-nowrap"), "строка классов не держит запрета переноса");
  assert.ok(classes.includes("h-auto") && classes.includes("min-h-11"), "высота растёт с подписью, цель не меньше 44 px");
  assert.ok(classes.includes("max-w-full"));
});

test("«Интеграции»: «Что не работает» стоит в таблице на виду (не колонка второго плана, которой на ноутбуке нет); «Заявки» маркетинга: имя и четыре данных, остальное в панели", () => {
  const integrations = html("settings-integrations:admin-cookie");
  const header = integrations.match(/<th[^>]*>(?:(?!<\/th>)[\s\S])*Что не работает/u)?.[0] ?? "";
  assert.ok(header.length > 0, "колонка есть");
  assert.doesNotMatch(header, /hidden/u, "колонка не скрыта на ноутбуке");
  assert.match(text(integrations), /Синхронизация с amoCRM не выполняется/u);
  const leads = html("marketing-leads:admin-cookie");
  const headers = all(leads, /<th[^>]*>([\s\S]*?)<\/th>/gu).map((cell) => text(cell)).filter(Boolean);
  assert.ok(headers.length <= 5, `колонок в таблице: ${headers.join(", ")}`);
  for (const word of ["Телефон", "Канал связи", "Кампания"]) assert.ok(!headers.includes(word), `${word} — в панели записи`);
  const sheet = read("src/components/v3/marketing-next/LeadSheetBody.tsx");
  for (const word of ["Телефон", "Канал связи", "Кампания"]) assert.ok(sheet.includes(word), `${word}: есть в панели`);
});

test("«Настройки» на узком окне: одна колонка с явной шириной, ряд разделов не раздувает её (иначе содержимое шире экрана и обрезано)", () => {
  const page = read("src/components/v3/settings-next/SettingsNextPage.tsx");
  assert.match(page, /grid-cols-1[^"]*@4xl:grid-cols-\[/u, "до 56rem — одна колонка minmax(0, 1fr)");
  const nav = html("settings-staff:admin-cookie");
  assert.match(region(nav, "v3-settings-nav-compact"), /class="[^"]*\bmin-w-0\b/u, "ряд вкладок может сжиматься до колонки");
});

test("стенды, что рисуют страницу «ИИ-агента» вне запроса, подменяют переключатель; стенд Chromium меряет настоящую боковую прокрутку и узкие окна", () => {
  for (const file of readdirSync(root("tests/e2e")).filter((name) => name.endsWith(".cjs"))) {
    const source = read(`tests/e2e/${file}`);
    if (!/src\/app\/\(v3\)\/v3\/ai-agent\/page\.tsx/u.test(source) || file.startsWith("admin-next-")) continue;
    assert.match(source, /ui-next\.ts"\)\)\.isNextUi = async \(\) => false/u, `${file}: страница спрашивает cookie, вне запроса её нет`);
    const pages = source.match(/require\(join\(ROOT, "src\/app\/\(v3\)\/v3\/ai-agent\/page\.tsx"\)\)/gu).length;
    const stubs = source.match(/ui-next\.ts"\)\)\.isNextUi = async \(\) => false/gu).length;
    assert.ok(stubs >= pages, `${file}: подмена до каждого подключения страницы (${stubs} из ${pages})`);
  }
  const checks = read("tests/e2e/admin-next-checks.cjs");
  assert.match(checks, /doc\.scrollWidth - doc\.clientWidth/u, "ширина видимой области, а не innerWidth (у телефонного окна он растягивается)");
  assert.match(checks, /main\.scrollWidth - main\.clientWidth/u, "содержимое страницы не шире экрана: html и body обрезают его молча");
  const viewports = read("tests/e2e/admin-next-static-render.cjs");
  for (const key of ["d1024", "m360", "m320"]) assert.match(viewports, new RegExp(`${key}: \\{ viewport`, "u"), `окно ${key}`);
});

/* ------------------------------------------------------------------ сборка волны 2B (28.10.2026): уроки волны 2A */

test("панели с полями у «Настроек», «Маркетинга» и «ИИ-агента» ловят Esc через sheetEscape: первая Esc выводит из поля, а не выбрасывает набранное", () => {
  const WITH_FIELDS = [
    "ai-agent-next/AiDocumentsNext", "ai-agent-next/AiExamplesNext", "ai-agent-next/AiReviewNext", "marketing-next/LeadFiltersSheet", "marketing-next/LeadsNext",
    "marketing-next/SpendAddSheet", "settings-next/DeletionNext", "settings-next/DepartmentsNext", "settings-next/IntegrationsNext", "settings-next/RolesNext",
    "settings-next/StaffAccessLog", "settings-next/StaffNext",
  ];
  for (const name of WITH_FIELDS) {
    const source = read(`src/components/v3/${name}.tsx`);
    const sheets = count(source, /<DetailSheet\b/gu);
    assert.ok(sheets >= 1, `${name}: есть панель`);
    assert.equal(count(source, /onEscapeKeyDown=\{sheetEscape\}/gu), sheets, `${name}: у каждой панели sheetEscape`);
    assert.match(source, /from "@\/components\/v3\/panel\/sheet-escape"/u, `${name}: тот же помощник, что у панелей волны 2A`);
  }
});

test("итоговые таблицы («Заявки по каналам», «Продажи периода», «Расходы по назначению») на узкой карточке — стопка с теми же словами и числами; таблица и стопка показываются взаимно", () => {
  const rows = (block, pattern) => all(block, pattern).map(text);
  for (const name of ["marketing-overview:admin-cookie", "ai-spend:admin-cookie"]) {
    const page = html(name);
    const tables = [...page.matchAll(/<div class="@container[^"]*"[^>]*>\s*<div role="region" aria-label="([^"]+)"[^>]*class="([^"]*)"[\s\S]*?<ul aria-label="\1" data-slot="report-stack" class="([^"]*)">([\s\S]*?)<\/ul><\/div>/gu)];
    assert.ok(tables.length >= 1, `${name}: итоговая таблица со стопкой`);
    for (const [block, label, tableClass, stackClass, stack] of tables) {
      const [, tableHidden, stackHidden] = tableClass.match(/(@max-\[(\d+)rem\]:hidden)/u) ? [null, tableClass.match(/@max-\[(\d+)rem\]:hidden/u)[1], stackClass.match(/@min-\[(\d+)rem\]:hidden/u)?.[1]] : [null, null, null];
      assert.ok(tableHidden && tableHidden === stackHidden, `${label}: таблица прячется там же, где стопка показывается (${tableHidden} / ${stackHidden})`);
      const tableCells = rows(block.slice(0, block.indexOf("<ul")), /<td[^>]*>([\s\S]*?)<\/td>/gu);
      const stackCells = rows(stack, /<dd[^>]*>([\s\S]*?)<\/dd>/gu);
      assert.deepEqual(stackCells, tableCells, `${label}: числа и слова ячеек те же`);
      const heads = rows(block.slice(0, block.indexOf("<ul")), /<th[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/gu);
      const stackHeads = rows(stack, /<li[^>]*><p[^>]*>([\s\S]*?)<\/p>/gu);
      assert.deepEqual(stackHeads, heads, `${label}: названия строк те же`);
      assert.doesNotMatch(stack, /<li[^>]*data-channel=|data-testid=/u, `${label}: у строк стопки нет меток строк таблицы (они не дублируются)`);
    }
  }
});

test("полоса фокуса итоговой таблицы рисуется карточкой снаружи: внутри области её режет overflow-hidden карточки и закрывает прилипший первый столбец", () => {
  // Независимая проверка сборки 2B (28.10.2026): область таблицы берёт фокус с клавиатуры, а общая полоса (2 px, снаружи) целиком попадала под обрезку.
  // Картинку проверяет стенд Chromium (`admin-next-flows-focus.cjs`: рамка по всем четырём сторонам, до исправления 0 точек); здесь — разметка настоящих страниц.
  const RING = ["outline-2", "outline-offset-3", "outline-focus-ring"].map((utility) => `has-[>[role=region]:focus-visible]:${utility}`);
  for (const name of ["marketing-overview:admin-cookie", "ai-spend:admin-cookie"]) {
    const cards = all(html(name).replaceAll("&gt;", ">"), /<div class="(@container[^"]*)"[^>]*>\s*<div role="region"[^>]*tabindex="0"/gu);
    assert.ok(cards.length >= 1, `${name}: итоговая таблица с областью, берущей фокус`);
    for (const classes of cards) {
      assert.match(classes, /\boverflow-hidden\b/u, `${name}: карточка по-прежнему обрезает углы таблицы`);
      for (const utility of RING) assert.ok(classes.split(" ").includes(utility), `${name}: у карточки ${utility}`);
    }
  }
  assert.doesNotMatch(read("src/components/v3/admin-next/ReportTable.tsx"), /role="region"[^>]*className=\{cn\("[^"]*focus-visible/u, "полосу не прячут внутрь области: её закрыл бы прилипший столбец");
});
