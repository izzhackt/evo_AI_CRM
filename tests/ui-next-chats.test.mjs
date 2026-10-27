// «Новый вид» (решение владельца 27.10.2026), поток «chats»: «WhatsApp» (`/v3/inbox`), «Переписка» (`/v3/messages`) и рамка
// переписки по делу. Проверяется то, что обещано: новый вид выбирает переключатель и только настоящий администратор, у остальных —
// прежняя разметка байт в байт; данные, ссылки и правила те же; движок чата не менялся (его разметка в новом виде совпадает с
// прежней побайтно); правила Wazzup («только чтение», подпись ответа продавца, нет поля и «Отправить») живут в новом виде; новый
// вид собран из набора виджетов и коротких файлов. Разметку даёт НАСТОЯЩИЕ страницы и компоненты с синтетическими данными
// (tests/e2e/chats-next-static-render.cjs --page-json, отдельный node-процесс). Вёрстку, адаптив, фокус, Esc и доступность на деле
// меряет тот же стенд в Chromium (--screenshots).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pages = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/chats-next-static-render.cjs", import.meta.url)), "--page-json"],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
)).map((page) => [page.name, page.html]));
const page = (kind, scenario, mode) => {
  const html = pages.get(`${kind}:${scenario}:${mode}`);
  assert.ok(html, `${kind}:${scenario}:${mode}`);
  return html;
};

const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
const all = (html, pattern) => [...html.matchAll(pattern)].map((match) => match[1]);
/** Идентификаторы React (`useId`) зависят от места в дереве: сравнивая движок, их стирают. */
const sameIds = (html) => html.replace(/_R_[a-z0-9]+_/gu, "_R_");
const LEGACY_MODES = ["admin-no-cookie", "preview-cookie", "preview-no-cookie", "sales-cookie", "sales-no-cookie"];
const WHATSAPP_NEW = 'data-testid="v3-whatsapp-next"';
const MESSAGES_NEW = 'data-testid="v3-messages-next"';
const INBOX_SCENARIOS = ["chat", "not-connected", "wazzup-read-only", "list", "empty", "empty-filtered"];
const MESSAGES_SCENARIOS = ["thread", "cabinet", "failure"];

/* ---------------------------------------------------------------- выбор вида: переключатель и только администратор */

test("«WhatsApp»: настоящая страница рисует новый вид только администратору с cookie; у остальных и без cookie — прежняя разметка", () => {
  for (const scenario of INBOX_SCENARIOS) {
    assert.ok(page("inbox", scenario, "admin-cookie").includes(WHATSAPP_NEW), scenario);
    for (const mode of LEGACY_MODES) assert.ok(!page("inbox", scenario, mode).includes(WHATSAPP_NEW), `${scenario}/${mode}: нового вида нет`);
    // Cookie сотруднику и просмотру роли ничего не даёт: разметка та же, что без неё.
    assert.equal(page("inbox", scenario, "sales-cookie"), page("inbox", scenario, "sales-no-cookie"), `${scenario}: сотрудник с cookie`);
    assert.equal(page("inbox", scenario, "preview-cookie"), page("inbox", scenario, "preview-no-cookie"), `${scenario}: просмотр роли с cookie`);
  }
  const legacy = page("inbox", "chat", "admin-no-cookie");
  assert.match(legacy, /data-testid="v3-inbox"/u);
  assert.match(legacy, /<a [^>]*data-testid="v3-inbox-profile-link"/u, "прежняя ссылка «Карточка лида»");
  assert.doesNotMatch(legacy, /data-slot="(input|button)"/u, "прежний вид без кнопок и полей набора");
  const next = page("inbox", "chat", "admin-cookie");
  assert.match(next, /data-slot="input"/u);
  assert.match(next, /data-slot="button"/u);
  assert.equal((next.match(/<h1[ >]/gu) ?? []).length, 1);
});

test("«Переписка»: новый вид только администратору с cookie; у остальных и без cookie — прежняя разметка", () => {
  for (const scenario of MESSAGES_SCENARIOS) {
    assert.ok(page("messages", scenario, "admin-cookie").includes(MESSAGES_NEW), scenario);
    for (const mode of LEGACY_MODES) assert.ok(!page("messages", scenario, mode).includes(MESSAGES_NEW), `${scenario}/${mode}`);
    assert.equal(page("messages", scenario, "sales-cookie"), page("messages", scenario, "sales-no-cookie"), `${scenario}: сотрудник с cookie`);
    assert.equal(page("messages", scenario, "preview-cookie"), page("messages", scenario, "preview-no-cookie"), `${scenario}: просмотр роли с cookie`);
  }
  assert.match(page("messages", "thread", "admin-no-cookie"), /data-conversations-main=""/u, "прежняя рамка ConversationsMain");
  assert.doesNotMatch(page("messages", "thread", "admin-no-cookie"), /data-slot="button"/u);
});

/* ---------------------------------------------------------------- те же данные, ссылки и движок */

test("«WhatsApp»: те же диалоги, адреса, номера и слова ожидания, что у прежнего вида", () => {
  for (const scenario of ["chat", "list"]) {
    const legacy = page("inbox", scenario, "admin-no-cookie");
    const next = page("inbox", scenario, "admin-cookie");
    const rows = (html) => all(html, /data-testid="v3-inbox-row" data-conversation-id="([^"]+)"/gu);
    assert.deepEqual(rows(next), rows(legacy), `${scenario}: те же строки в том же порядке`);
    assert.equal(rows(next).length, 7);
    const hrefs = (html) => all(html, /data-testid="v3-inbox-row"[^>]*><a [^>]*href="([^"]+)"/gu);
    assert.deepEqual(hrefs(next), hrefs(legacy), `${scenario}: те же адреса`);
    const masks = (html) => all(html, /<span aria-hidden="true">(\+[^<]+)<\/span>/gu);
    assert.deepEqual(masks(next), masks(legacy), `${scenario}: те же маски номеров`);
    assert.match(text(next), /Ждёт ответа · 20 мин/u);
    assert.match(text(legacy), /Ждёт ответа · 20 мин/u);
  }
  // Поиск — та же форма GET, «Сортировка» — те же два пункта-ссылки.
  const next = page("inbox", "list", "admin-cookie");
  assert.match(next, /<form role="search" action="\/v3\/inbox" method="get">/u);
  assert.match(next, /aria-label="Найти"/u);
  assert.match(next, /placeholder="Имя, телефон или тема"/u);
  assert.match(next, /Сортировка: <span class="text-fg">сначала новые<\/span>/u);
});

test("«WhatsApp»: движок чата не менялся — лента и поле ответа (или строка «только чтение») в новом виде совпадают с прежними побайтно", () => {
  for (const scenario of ["chat", "wazzup-read-only"]) {
    const legacy = sameIds(page("inbox", scenario, "admin-no-cookie"));
    const next = sameIds(page("inbox", scenario, "admin-cookie"));
    const from = legacy.lastIndexOf("<div", legacy.indexOf('data-testid="v3-inbox-chat"'));
    const engine = legacy.slice(from, legacy.indexOf("</section>", from));
    assert.ok(engine.length > 2000, `${scenario}: движок взят целиком (${engine.length} знаков)`);
    assert.ok(next.includes(engine), `${scenario}: разметка движка в новом виде та же`);
  }
  const thread = (html) => {
    const feed = html.lastIndexOf('<div class="relative flex min-h-0 flex-1 flex-col">', html.indexOf('aria-label="История переписки"'));
    const tail = '<div class="h-[54px] rounded-card border border-border"></div></div>';
    return html.slice(feed, html.indexOf(tail, feed) + tail.length);
  };
  const legacy = sameIds(page("messages", "thread", "admin-no-cookie"));
  const engine = thread(legacy);
  assert.ok(engine.length > 2000);
  assert.ok(sameIds(page("messages", "thread", "admin-cookie")).includes(engine), "лента и поле «Переписки» те же");
});

test("«Переписка»: те же очереди с числами, строки, шапка и переключатель состояния; сбой читается теми же словами и тем же адресом", () => {
  for (const scenario of ["thread", "cabinet"]) {
    const legacy = page("messages", scenario, "admin-no-cookie");
    const next = page("messages", scenario, "admin-cookie");
    const rows = (html) => all(html, /data-case-chat-row="([^"]+)"/gu);
    assert.deepEqual(rows(next), rows(legacy), `${scenario}: те же дела в том же порядке`);
    assert.ok(rows(next).length >= 3);
    const hrefs = (html) => all(html, /<a href="([^"]+)"[^>]*data-case-chat-row=/gu);
    assert.deepEqual(hrefs(next), hrefs(legacy), `${scenario}: те же адреса`);
    assert.deepEqual(all(next, /data-queue-count="([^"]+)">(\d+)</gu), all(legacy, /data-queue-count="([^"]+)">(\d+)</gu), `${scenario}: имена очередей`);
    for (const word of ["Нужен ответ", "Ждём студента", "Поиск по студенту"]) assert.match(text(next), new RegExp(word, "u"), word);
  }
  const next = page("messages", "thread", "admin-cookie");
  const legacy = page("messages", "thread", "admin-no-cookie");
  for (const html of [legacy, next]) {
    assert.match(html, /data-testid="case-chat-await-control"/u);
    assert.match(text(html), /Китай · Документы|Китай Документы/u);
    assert.match(html, /href="\/v3\/profile\?case=dddddddd-2222-4222-8222-000000000001"/u, "«Открыть дело»");
  }
  assert.deepEqual(all(next, /<button [^>]*aria-pressed="(true|false)"[^>]*data-tone="([^"]+)"/gu), all(legacy, /<button [^>]*aria-pressed="(true|false)"[^>]*data-tone="([^"]+)"/gu), "то же нажатое состояние и тон");
  for (const html of [page("messages", "failure", "admin-no-cookie"), page("messages", "failure", "admin-cookie")]) {
    assert.match(html, /role="alert"/u);
    assert.match(text(html), /Не удалось загрузить переписки\. Обновите страницу\./u);
    assert.match(html, /<a [^>]*href="\/v3\/messages"[^>]*>Обновить страницу</u);
  }
});

/* ---------------------------------------------------------------- Wazzup: только чтение остаётся только чтением */

test("Wazzup: в новом виде чат «только чтение» — одна строка вместо поля, нет «Отправить», нет окна ИИ, ответ продавца подписан; как в прежнем виде", () => {
  const legacy = page("inbox", "wazzup-read-only", "admin-no-cookie");
  const next = page("inbox", "wazzup-read-only", "admin-cookie");
  for (const [label, html] of [["прежний", legacy], ["новый", next]]) {
    assert.match(html, /data-testid="v3-inbox-reply-unavailable"[^>]*data-reason="receive_only"|data-reason="receive_only"[^>]*data-testid="v3-inbox-reply-unavailable"/u, `${label}: причина receive_only`);
    assert.match(text(html), /Только чтение: отвечайте в amoCRM или Wazzup\./u, `${label}: строка`);
    assert.doesNotMatch(html, /<textarea/u, `${label}: поля ответа нет`);
    assert.doesNotMatch(text(html), /Отправить|Шаблон|Помочь с ответом/u, `${label}: ни «Отправить», ни шаблонов, ни окна ИИ`);
    assert.deepEqual(all(html, /data-testid="v3-inbox-message"[^>]*data-origin="([^"]+)"/gu), ["client", "wazzup", "client"], `${label}: происхождения`);
    assert.match(text(html), /отправлено в amoCRM\/Wazzup/u, `${label}: подпись ответа продавца`);
  }
  // У обычного чата (путь WAHA) поле и «Отправить» есть в обоих видах: правило не расползлось.
  for (const html of [page("inbox", "chat", "admin-no-cookie"), page("inbox", "chat", "admin-cookie")]) {
    assert.match(html, /<textarea/u);
    assert.doesNotMatch(text(html), /Только чтение: отвечайте в amoCRM или Wazzup\./u);
  }
});

test("Wazzup: рамка нового вида не добавляет отправку и не знает путей WAHA, Wazzup и подключения; ни одного серверного действия в ней нет", () => {
  const dirs = ["inbox-next", "case-chat-next", "chats-next"].map((dir) => `src/components/v3/${dir}`);
  const files = dirs.flatMap((dir) => readdirSync(new URL(`../${dir}`, import.meta.url)).map((name) => `${dir}/${name}`));
  assert.ok(files.length >= 18);
  for (const file of files) {
    const source = read(file);
    const imports = source.match(/^import [^;]*from "[^"]+";$/gmu) ?? [];
    for (const line of imports) assert.doesNotMatch(line, /waha|wazzup|whatsapp-connect|provider-actions|platform-whatsapp|case-chat-actions|ui-next-actions/iu, `${file}: ${line}`);
    assert.doesNotMatch(source, /["']use server["']|fetch\(|sendPlatformWhatsApp|reconcilePlatformWhatsApp|postCaseChatMessageAction|<textarea/u, `${file}: рамка ничего не отправляет`);
  }
  // Ответ только через прежний движок: в рамке стоят `InboxChat` и `CaseChatWorkspace`, больше полей нет.
  assert.match(read("src/components/v3/inbox-next/InboxNextThread.tsx"), /import \{ InboxChat \} from "@\/components\/v3\/inbox\/InboxChat";/u);
  assert.match(read("src/components/v3/case-chat-next/CaseChatNextPage.tsx"), /import \{ CaseChatWorkspace \} from "@\/components\/v3\/case-chat\/CaseChatThread";/u);
});

/* ---------------------------------------------------------------- текст: на экране заголовки, данные и кнопки; пояснения за «?» */

test("текст: пояснение «WhatsApp» ушло за «?», пустой список — одна строка с кнопкой; беды канала и «не подключён» остаются на виду", () => {
  const legacyEmpty = text(page("inbox", "empty", "admin-no-cookie"));
  const nextEmpty = text(page("inbox", "empty", "admin-cookie"));
  assert.match(legacyEmpty, /Здесь отображаются диалоги, к которым у вас есть доступ\./u, "а у прежнего вида стояло");
  assert.match(nextEmpty, /Пока нет доступных диалогов/u);
  assert.doesNotMatch(nextEmpty, /Здесь отображаются/u, "пояснения на экране нет");
  const filtered = text(page("inbox", "empty-filtered", "admin-cookie"));
  assert.match(filtered, /По выбранным условиям диалогов нет/u);
  assert.match(filtered, /Сбросить фильтры/u);
  assert.doesNotMatch(filtered, /Попробуйте другой запрос/u);
  assert.match(page("inbox", "chat", "admin-cookie"), /aria-label="Пояснение: WhatsApp"/u);
  assert.match(read("src/components/v3/inbox-next/InboxNextPage.tsx"), /const HELP = "Чаты WhatsApp продаж: слева диалоги, справа переписка\. «Неотвеченные» ставят выше клиентов, которые написали последними\. Здесь отображаются диалоги, к которым у вас есть доступ\."/u);
  assert.match(page("messages", "cabinet", "admin-cookie"), /aria-label="Пояснение: Переписка"/u);
  // «Не подключён»: честное состояние, ссылка на настройки — только у администратора вне просмотра роли (её даёт страница).
  const notConnected = page("inbox", "not-connected", "admin-cookie");
  assert.match(text(notConnected), /WhatsApp не подключён к CRM — подключает Администратор/u);
  assert.match(notConnected, /href="\/v3\/settings\?section=integrations"[^>]*>Открыть настройки</u);
  assert.doesNotMatch(notConnected, /<h1[^>]*>WhatsApp\s*<span[^>]*>\d/u, "числа у заголовка нет");
  const attention = read("src/components/v3/inbox-next/InboxNextList.tsx");
  assert.match(attention, /role="status" data-testid="v3-inbox-channel-status"/u);
  assert.match(attention, /bg-warn-weak/u);
  assert.match(read("src/components/v3/inbox-next/InboxNextThread.tsx"), /role="status" data-testid="v3-inbox-thread-channel"/u);
});

/* ---------------------------------------------------------------- устройство: страницы, ленивые входы, виджеты набора, короткие файлы */

test("страницы спрашивают isNextUi, читают и проверяют права как прежде; новый вид — ленивый вход, прежняя ветка осталась", () => {
  const inbox = read("src/app/(v3)/v3/inbox/page.tsx");
  assert.match(inbox, /import \{ isNextUi \} from "@\/lib\/ui-next";/u);
  assert.match(inbox, /import \{ InboxNextLazy \} from "@\/components\/v3\/inbox-next\/InboxNextLazy";/u);
  assert.doesNotMatch(inbox, /from "@\/components\/v3\/inbox-next\/(?!InboxNextLazy)|from "@\/components\/kit/u, "новый вид и набор в первую загрузку страницы не входят");
  assert.match(inbox, /if \(await isNextUi\(actor\)\) \{\s*return \(\s*<InboxNextLazy/u);
  assert.match(inbox, /<PartShell title="WhatsApp" count=\{notConnected \|\| paged \? null : view\.conversations\.length\} fill>/u, "прежний вид на месте");
  assert.ok(inbox.indexOf("await readInbox(actor") < inbox.indexOf("isNextUi(actor)"), "чтение страницы — до выбора вида");
  assert.ok(inbox.indexOf("isNextUi(actor)") < inbox.indexOf("<PartShell"), "выбор вида до прежней разметки");
  const messages = read("src/app/(v3)/v3/messages/page.tsx");
  assert.match(messages, /import \{ isNextUi \} from "@\/lib\/ui-next";/u);
  assert.match(messages, /import \{ CaseChatNextFailureLazy, CaseChatNextLazy \} from "@\/components\/v3\/case-chat-next\/CaseChatNextLazy";/u);
  assert.doesNotMatch(messages, /from "@\/components\/v3\/case-chat-next\/(?!CaseChatNextLazy)|from "@\/components\/kit/u);
  assert.match(messages, /const nextUi = await isNextUi\(actor\);/u);
  assert.match(messages, /if \(nextUi\) return <CaseChatNextFailureLazy forbidden=\{threadsFailure === "forbidden"\}/u);
  assert.match(messages, /if \(nextUi\) \{\s*return \(\s*<CaseChatNextLazy/u);
  assert.match(messages, /<ConversationsMain title=\{TITLE\} threadOpen=\{rawCase !== null\}>/u, "прежний вид на месте");
  assert.match(messages, /readCaseChatPage\(actor, rawCase, "latest"\)/u, "чтения прежние");
  assert.match(messages, /documentsAwaitCurator=\{caseDocumentsAwaitCurator\(caseState\)\}/u);
});

test("ленивые входы: «use client» и подгрузка настоящего вида; движок «Переписки» получает рамку, прежний вид — прежнюю", () => {
  const inbox = read("src/components/v3/inbox-next/InboxNextLazy.tsx");
  assert.match(inbox, /^"use client";/u);
  assert.match(inbox, /dynamic\(\(\) => import\("\.\/InboxNextPage"\)\.then\(\(module\) => module\.InboxNextPage\)\.catch\(onScreenLoadFailed\)\)/u);
  const messages = read("src/components/v3/case-chat-next/CaseChatNextLazy.tsx");
  assert.match(messages, /^"use client";/u);
  assert.match(messages, /import\("\.\/CaseChatNextPage"\)\.then\(\(module\) => module\.CaseChatNextPage\)\.catch\(onScreenLoadFailed\)/u);
  assert.match(messages, /import\("\.\/CaseChatNextFailure"\)\.then\(\(module\) => module\.CaseChatNextFailure\)\.catch\(onScreenLoadFailed\)/u);
  const engine = read("src/components/v3/case-chat/CaseChatThread.tsx");
  assert.match(engine, /const LEGACY_FRAME: CaseChatFrame = \{ List: CaseChatList, Header: ThreadHeader, Idle: NextThreadPane \};/u);
  assert.match(engine, /initialPageFailure, caseFacts = null, snippets = null, documentsAwaitCurator = false, frame = LEGACY_FRAME,/u);
  assert.match(engine, /<frame\.List threads=\{threads\}/u);
  assert.match(engine, /<frame\.Idle read=\{queueRead\}/u);
  assert.match(engine, /<CaseChatThreadView Header=\{frame\.Header\} caseId=\{selectedCaseId\}/u);
  const next = read("src/components/v3/case-chat-next/CaseChatNextPage.tsx");
  assert.match(next, /<CaseChatWorkspace key=\{`\$\{membershipId\}:\$\{selectedCaseId \?\? "list"\}`\} \{\.\.\.workspace\} frame=\{CASE_CHAT_NEXT_FRAME\} \/>/u, "ключ — как у прежней страницы: переписка перемонтируется при смене дела");
});

const NEW_FILES = ["inbox-next", "case-chat-next", "chats-next"].flatMap((dir) => readdirSync(new URL(`../src/components/v3/${dir}`, import.meta.url)).map((name) => `src/components/v3/${dir}/${name}`));

test("новые файлы короче 150 строк, собраны из набора и не вводят своих цветов, теней и тёмной темы", () => {
  assert.ok(NEW_FILES.length >= 18, `${NEW_FILES.length} файлов`);
  for (const file of NEW_FILES) {
    const source = read(file);
    const lines = source.split("\n").length - 1;
    assert.ok(lines <= 150, `${file}: ${lines} строк`);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/u, `${file}: цвета только токенами`);
    assert.doesNotMatch(source, /text-fg\/\d|bg-[a-z-]+\/\d|opacity-|shadow-\[/u, `${file}: без прозрачности и своих теней`);
    assert.doesNotMatch(source, /dark:/u, `${file}: CRM только светлая`);
  }
  assert.match(read("src/components/v3/inbox-next/InboxNextRow.tsx"), /StatusBadge/u);
  assert.match(read("src/components/v3/inbox-next/InboxNextSearch.tsx"), /import \{ Input \} from "@\/components\/ui\/input";/u);
  assert.match(read("src/components/v3/inbox-next/InboxNextList.tsx"), /EmptyState/u);
  assert.match(read("src/components/v3/inbox-next/InboxNextPage.tsx"), /EmptyState/u);
  assert.match(read("src/components/v3/chats-next/ChatPageShell.tsx"), /import \{ PageHeader \} from "@\/components\/kit\/PageHeader";/u);
  assert.match(read("src/components/v3/chats-next/ChatLinkMenu.tsx"), /DropdownMenu/u);
  assert.match(read("src/components/v3/case-chat-next/CaseChatNextList.tsx"), /import \{ Input \} from "@\/components\/ui\/input";/u);
  assert.match(read("src/components/v3/case-chat-next/CaseChatNextFailure.tsx"), /EmptyState/u);
});

test("красных кнопок нет: в рамке чатов сплошной красный — только у движка («Отправить»); цели 44 px у всех кнопок набора", () => {
  for (const file of NEW_FILES) assert.doesNotMatch(read(file), /variant="default"|bg-primary|bg-accent(?!-)/u, file);
  const shell = read("src/components/v3/chats-next/ChatPageShell.tsx");
  assert.match(shell, /h-\[calc\(100dvh-150px\)\] min-h-0 pb-4 pt-6 md:h-\[calc\(100dvh-64px\)\]/u, "рамка «Переписки» на высоту окна, как ConversationsMain");
  assert.match(shell, /data-conversations-main=\{messages \? "" : undefined\}/u);
  assert.match(shell, /md:min-h-0 md:flex-1/u, "рамка WhatsApp — как PartShell fill");
  assert.match(read("src/components/v3/inbox-next/InboxNextView.tsx"), /v3-inbox grid/u, "зацепка телефонных правил оболочки");
  assert.match(read("src/components/v3/inbox-next/InboxNextView.tsx"), /data-inbox-open=\{open \? "" : undefined\}/u);
});

test("стенд и данные на месте: страницы, Chromium-проверки, синтетические данные", () => {
  for (const file of ["tests/e2e/chats-next-static-render.cjs", "tests/e2e/chats-next-checks.cjs", "tests/e2e/chats-next-fixtures.cjs"]) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  assert.match(read("tests/e2e/chats-next-fixtures.cjs"), /ВЫДУМАНЫ/u);
});
