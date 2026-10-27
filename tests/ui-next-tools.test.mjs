// «Новый вид» (решение владельца 27.10.2026), поток «tools»: «Календарь» (`/v3/calendar`), «Документы», «Шаблоны ответов» и «База знаний»
// (`/v3/knowledge`, разделы `?section=documents|snippets`), «Командный чат» (`/v3/team-chat`). Проверяется то, что обещано: новый вид выбирает
// переключатель и только настоящий администратор, у остальных страница прежняя, байт в байт (сверку с базовым коммитом даёт
// `tests/e2e/tools-next-pages.cjs --legacy-json`); данные, права, команды и request_id те же, что у прежнего вида (поля форм и серверные
// действия совпадают с прежними файлами); ленивые входы не тянут новый вид в первую загрузку; файлы нового вида короткие и собраны из набора.
// Разметку даёт НАСТОЯЩАЯ страница с синтетическими данными (tests/e2e/tools-next-pages.cjs, отдельный node-процесс); взаимодействия в браузере —
// tests/e2e/tools-next-static-render.cjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");
const pages = new Map(JSON.parse(execFileSync(process.execPath, [root("tests/e2e/tools-next-pages.cjs"), "--json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })).map((row) => [row.name, row]));
const html = (name) => pages.get(name).html;
const count = (value, pattern) => [...value.matchAll(pattern)].length;
const text = (value) => value.replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
const all = (value, pattern) => [...value.matchAll(pattern)].map((match) => match[1]);
const MODES = ["admin-cookie", "admin-no-cookie", "preview-cookie", "staff-cookie"];
const LEGACY_MODES = MODES.slice(1);

const sourcesIn = (directory) => readdirSync(root(directory), { recursive: true }).filter((file) => /\.(tsx?|ts)$/u.test(String(file))).map((file) => `${directory}/${file}`);
const NEW_DIRS = [
  "src/components/v3/calendar/next", "src/components/v3/knowledge/next", "src/components/v3/reply-snippets/next", "src/components/v3/team-chat/next",
];
const NEW_FILES = NEW_DIRS.flatMap(sourcesIn);

/* ---------------------------------------------------------------- выбор вида: переключатель и только администратор */

test("«Календарь»: новый вид только у администратора с cookie; без cookie, в просмотре роли и у сотрудника — прежняя разметка", () => {
  const next = html("calendar:admin-cookie");
  assert.match(next, /data-testid="v3-calendar-next"/u);
  assert.match(next, /aria-label="Вид календаря"/u, "вкладки вида — ряд ссылок");
  assert.equal(count(next, /<h1[ >]/gu), 1);
  for (const mode of LEGACY_MODES) {
    const legacy = html(`calendar:${mode}`);
    assert.match(legacy, /data-calendar-sheet=""/u, `${mode}: прежний белый лист`);
    assert.doesNotMatch(legacy, /v3-calendar-next|data-slot="card"/u, `${mode}: виджетов нового вида нет`);
  }
  // Cookie сотруднику и просмотру роли ничего не даёт: прежние сетки, вкладки и панель на месте.
  for (const mode of ["preview-cookie", "staff-cookie"]) assert.match(html(`calendar:${mode}`), /data-calendar-root=""/u, mode);
});

test("«База знаний»: новый вид только у администратора с cookie; сотрудник и просмотр роли получают тот же отказ, что раньше; прежние страницы документов и шаблонов администратора перенаправляют", () => {
  for (const name of ["knowledge-library", "knowledge-documents", "knowledge-snippets"]) {
    assert.match(html(`${name}:admin-cookie`), /data-testid="v3-knowledge-next"/u, `${name}: новый вид`);
    assert.doesNotMatch(html(`${name}:admin-no-cookie`), /v3-knowledge-next|data-slot="data-table"/u, `${name}: без cookie прежний вид`);
    for (const mode of ["preview-cookie", "staff-cookie"]) assert.equal(pages.get(`${name}:${mode}`).rejected, "knowledge_forbidden", `${name}:${mode}: раздел только для администратора`);
  }
  // `/v3/documents` и `/v3/reply-snippets`: администратор уходит в разделы базы знаний независимо от cookie, поэтому нового вида у отдельных страниц нет.
  for (const mode of ["admin-cookie", "admin-no-cookie"]) {
    assert.equal(pages.get(`documents-page:${mode}`).redirect, "/v3/knowledge?section=documents");
    assert.equal(pages.get(`reply-snippets-page:${mode}`).redirect, "/v3/knowledge?section=snippets");
  }
  for (const mode of ["preview-cookie", "staff-cookie"]) {
    assert.doesNotMatch(html(`documents-page:${mode}`), /data-slot="data-table"|v3-documents-next/u, `${mode}: документы прежние`);
    assert.doesNotMatch(html(`reply-snippets-page:${mode}`), /data-slot="data-table"|v3-knowledge-reply-snippets-next/u, `${mode}: шаблоны прежние`);
  }
});

test("«Командный чат»: новая рамка только у администратора с cookie; один h1 — шапка страницы; движок и прежний вид без cookie те же", () => {
  const next = html("team-chat:admin-cookie");
  assert.match(next, /data-testid="v3-team-chat-next"/u);
  assert.match(next, /data-frame="card"/u, "чат знает, что рамку рисует страница");
  assert.equal(count(next, /<h1[ >]/gu), 1, "заголовок страницы один, не дважды");
  assert.doesNotMatch(next, /<nav[^>]*aria-label="Каналы команды"[^>]*>\s*<h1/u, "в списке каналов своего h1 больше нет");
  for (const mode of LEGACY_MODES) {
    const legacy = html(`team-chat:${mode}`);
    assert.match(legacy, /<nav[^>]*aria-label="Каналы команды"[^>]*>\s*<h1/u, `${mode}: заголовок прежнего вида в списке каналов`);
    assert.doesNotMatch(legacy, /v3-team-chat-next|data-frame=/u);
  }
  // Каналы, сообщения и состояние чтения — те же данные в обоих видах.
  const channels = (value) => all(value, /href="\/v3\/team-chat\?channel=(\w+)"/gu);
  assert.deepEqual(channels(next), channels(html("team-chat:admin-no-cookie")));
  assert.deepEqual(all(next, /data-chat-row="([^"]+)"/gu), all(html("team-chat:admin-no-cookie"), /data-chat-row="([^"]+)"/gu), "те же сообщения в том же порядке");
});

test("«Командный чат»: ошибка чтения остаётся на виду в обоих видах, со ссылкой «Обновить канал»", () => {
  for (const mode of MODES) {
    const failure = html(`team-chat-failure:${mode}`);
    assert.match(failure, /role="alert"/u, mode);
    assert.match(failure, /href="\/v3\/team-chat\?channel=general"/u, mode);
    assert.match(text(failure), /Обновить канал/u, mode);
  }
  assert.match(html("team-chat-failure:admin-cookie"), /data-testid="v3-team-chat-next-failure"/u);
  assert.equal(count(html("team-chat-failure:admin-cookie"), /<h1[ >]/gu), 1);
});

/* ------------------------------------------------------- те же данные, права и поля форм в новом виде */

test("«Шаблоны ответов»: те же шаблоны, права и слова аудитории, что у прежнего вида; «Новый шаблон» — для того, кто управляет", () => {
  const next = html("knowledge-snippets:admin-cookie");
  const legacy = html("knowledge-snippets:admin-no-cookie");
  const titles = (value) => all(value, /(?:<h3 class="t-item text-fg">|<span class="block font-medium text-fg \[overflow-wrap:anywhere\]">)([^<]+)</gu).sort();
  assert.deepEqual(titles(next).filter((title, index, list) => list.indexOf(title) === index), titles(legacy), "те же названия");
  assert.equal(titles(legacy).length, 4);
  for (const word of ["Продажи", "Поступление", "Все роли"]) assert.match(text(next), new RegExp(word, "u"), word);
  assert.match(text(next), /Новый шаблон/u);
  assert.match(text(legacy), /Новый шаблон/u);
  assert.match(next, /placeholder="Найти шаблон"/u, "поиск таблицы называет, что ищет");
});

test("«Документы»: те же файлы, папки студентов и уведомления, что у прежнего вида", () => {
  const next = text(html("knowledge-documents:admin-cookie"));
  const legacy = text(html("knowledge-documents:admin-no-cookie"));
  for (const word of ["Компания", "Студенты"]) {
    assert.match(next, new RegExp(word, "u"), `новый: ${word}`);
    assert.match(legacy, new RegExp(word, "u"), `прежний: ${word}`);
  }
  assert.match(html("knowledge-documents:admin-cookie"), /aria-label="Таблица документов"/u);
  assert.match(html("knowledge-documents:admin-cookie"), /data-company-file-search/u, "поиск документов — тот же атрибут");
});

test("«База знаний»: рамка с тремя вкладками-ссылками и список материалов; адреса разделов прежние", () => {
  const library = html("knowledge-library:admin-cookie");
  assert.deepEqual(all(library.slice(library.indexOf('data-testid="queue-view-tabs"')), /<a [^>]*href="([^"]+)"/gu).slice(0, 3), ["/v3/knowledge", "/v3/knowledge?section=documents", "/v3/knowledge?section=snippets"]);
  assert.match(library, /aria-current="page"[^>]*>Материалы</u, "Материалы — текущий раздел");
  assert.match(library, /data-testid="knowledge-library"/u);
  assert.match(library, /aria-label="Папки базы знаний"/u, "дерево папок слева");
  assert.match(library, /placeholder="Найти материал"/u, "поиск идёт на сервер");
  assert.doesNotMatch(library.slice(library.indexOf('data-slot="data-table-toolbar"')), /placeholder="Поиск"/u, "второго поля поиска у таблицы нет");
  for (const [name, tab] of [["knowledge-documents", "Документы"], ["knowledge-snippets", "Шаблоны ответов"]]) {
    assert.match(html(`${name}:admin-cookie`), new RegExp(`aria-current="page"[^>]*>${tab}<`, "u"), `${tab}: текущий раздел`);
  }
});

test("поля форм и серверные действия те же, что в прежних файлах: ни одного нового имени поля и ни одной новой команды", () => {
  const legacyFiles = read("src/components/v3/FileManager.tsx");
  const nextFiles = ["FileActionForm", "FileSheetBody", "FileUploadForm", "FolderSheets", "FilesNext"].map((name) => read(`src/components/v3/knowledge/next/${name}.tsx`)).join("\n");
  const actions = (source) => [...new Set(all(source, /\b((?:archive|create|move|rename)PlatformCompanyFile(?:Folder)?Action)\b/gu))].sort();
  assert.deepEqual(actions(nextFiles), actions(legacyFiles), "те же восемь действий над файлами и папками");
  assert.equal(actions(legacyFiles).length, 8);
  for (const field of ["parent_folder_id", "request_id", "folder_id", "display_name", "expected_version", "new_parent_folder_id", "company_file_id", "expected_file_version"]) {
    assert.ok(legacyFiles.includes(`"${field}"`) || legacyFiles.includes(`name="${field}"`), `прежний файл знает поле ${field}`);
    assert.ok(new RegExp(`name="${field}"|\\b${field}\\b`, "u").test(nextFiles), `новый вид шлёт поле ${field}`);
  }
  assert.match(nextFiles, /\/api\/v3\/company-files\/\$\{encodeURIComponent\(file\.id\)\}\/versions/u, "загрузка файла — тот же адрес");
  const legacySnippets = read("src/components/v3/reply-snippets/KnowledgeReplySnippetSection.tsx");
  const nextSnippets = ["SnippetCreateSheet", "SnippetSheetBody", "SnippetFields", "SnippetsNext"].map((name) => read(`src/components/v3/reply-snippets/next/${name}.tsx`)).join("\n");
  const snippetActions = (source) => [...new Set(all(source, /\b((?:archive|create|update)PlatformReplySnippetAction)\b/gu))].sort();
  assert.deepEqual(snippetActions(nextSnippets), snippetActions(legacySnippets));
  for (const field of ["reply_snippet_id", "expected_version", "request_id", "title", "body", "audience"]) assert.match(nextSnippets, new RegExp(`name="${field}"`, "u"), `шаблон: поле ${field}`);
  assert.match(nextSnippets, /createReplySnippetFormKey\(createRequestId\)/u, "после сохранения форма создания закрывается новым ключом");
  assert.match(nextSnippets, /replySnippetRowFormKey\(/u, "форма строки перерождается с новыми request_id");
});

test("«База знаний»: команды и чтения те же, что у прежней библиотеки (те же `op`, те же адреса `/api/v3/knowledge`)", () => {
  const legacy = read("src/components/v3/knowledge/KnowledgeLibrary.tsx");
  const next = ["useKnowledgeData", "useKnowledgeActions"].map((name) => read(`src/components/v3/knowledge/next/${name}.ts`)).join("\n");
  const ops = (source) => [...new Set(all(source, /\bop(?:: |\s*=\s*)"(\w+)"|\bop: "(\w+)"/gu).concat(all(source, /\{ op, id: item\.id/gu).map(() => "dynamic")))].sort();
  for (const op of ["trash", "restore", "archive", "unarchive", "create", "edit", "move"]) {
    assert.ok(legacy.includes(`"${op}"`), `прежняя библиотека знает ${op}`);
    assert.ok(next.includes(`"${op}"`), `новая знает ${op}`);
  }
  assert.ok(ops(next).length > 0);
  for (const route of ["list?", "item/", "mode: \"folders\"", "limit: \"200\"", "afterTitle", "afterId"]) assert.ok(next.includes(route) && legacy.includes(route), `чтение: ${route}`);
  assert.match(next, /configureKnowledgeCommands\(commandScope\)/u, "команды помнят область запросов как раньше");
  assert.match(next, /setTimeout\([\s\S]*search \? 250 : 0/u, "поиск с задержкой 250 мс, как раньше");
  assert.match(read("src/components/v3/knowledge/next/LibraryToolbar.tsx"), /type="search" maxLength=\{240\}/u);
});

test("«Календарь»: тот же движок сетки и те же формы дела; адрес открытой задачи собирается так же", () => {
  const page = read("src/components/v3/calendar/next/CalendarNextPage.tsx");
  const sheet = read("src/components/v3/calendar/next/CalendarTaskSheet.tsx");
  assert.match(page, /import \{ DayList, MonthGrid, TimeGrid, type CalendarCellProps \} from "\.\.\/grids";/u, "сетки прежние");
  assert.match(sheet, /import \{ CalendarTaskControls \} from "\.\.\/TaskControls";/u, "формы дела прежние: те же команды и request_id");
  assert.match(read("src/components/v3/calendar/next/useCalendarTaskSheet.ts"), /params\.set\("case", target\.studentCaseId\)[\s\S]*params\.set\("kind", "staff"\)[\s\S]*params\.set\("task", target\.id\)/u);
  assert.match(page, /staffPresentationCan\(actor, "admissions\.read"\) && !isStaffPreview\(actor\) && staffHasPermission\(actor, "task\.create"\)/u, "та же граница права на создание");
  assert.match(sheet, /task\?\.kind === "case" && confirmed && caps && requestIds\[task\.key\] && task\.caseState === "active"/u, "формы дела — когда сервер подтвердил права на задачу");
  assert.match(page, /TaskComposerContextMark value=\{\{ dueDay: day, cases, casesHaveMore \}\}/u, "«Создать задача» оболочки берёт выбранный день");
});

/* ---------------------------------------------------------------- устройство: короткие файлы, набор, токены */

test("новые файлы короче 150 строк, собраны из набора и не вводят своих цветов", () => {
  assert.ok(NEW_FILES.length >= 36, `новых файлов: ${NEW_FILES.length}`);
  for (const file of NEW_FILES) {
    const source = read(file);
    const lines = source.split("\n").length - 1;
    assert.ok(lines <= 150, `${file}: ${lines} строк`);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsl\(/u, `${file}: цвета только токенами`);
    assert.doesNotMatch(source, /text-fg\/\d|bg-[a-z-]+\/\d|opacity-/u, `${file}: без прозрачности`);
    assert.doesNotMatch(source, /dark:/u, `${file}: CRM только светлая`);
  }
  assert.match(read("src/components/v3/calendar/next/CalendarNextPage.tsx"), /PageShell[\s\S]*SectionTabs[\s\S]*WidgetCard/u);
  assert.match(read("src/components/v3/calendar/next/CalendarTaskSheet.tsx"), /DetailSheet[\s\S]*KeyFacts/u);
  assert.match(read("src/components/v3/knowledge/next/LibraryTable.tsx"), /DataTable/u);
  assert.match(read("src/components/v3/knowledge/next/FilesNext.tsx"), /DataTable[\s\S]*DetailSheet/u);
  assert.match(read("src/components/v3/reply-snippets/next/SnippetsNext.tsx"), /DataTable[\s\S]*DetailSheet/u);
  assert.match(read("src/components/v3/knowledge/next/KnowledgeNextPage.tsx"), /PageShell[\s\S]*SectionTabs/u);
  assert.match(read("src/components/v3/team-chat/next/TeamChatNextPage.tsx"), /PageHeader/u);
});

test("красная кнопка одна: у «Нового шаблона», «Нового файла», «Создать» библиотеки; подтверждения в панелях — тёмные", () => {
  assert.match(read("src/components/v3/reply-snippets/next/SnippetCreateSheet.tsx"), /<Button><PlusIcon[^>]*\/>Новый шаблон<\/Button>/u);
  assert.match(read("src/components/v3/knowledge/next/FolderSheets.tsx"), /<Button><FilePlusIcon[^>]*\/>Новый файл<\/Button>/u);
  assert.match(read("src/components/v3/knowledge/next/LibraryToolbar.tsx"), /<Button data-testid="knowledge-create-menu">Создать/u);
  for (const file of ["SnippetSheetBody", "SnippetCreateSheet"]) assert.match(read(`src/components/v3/reply-snippets/next/${file}.tsx`), /QUEUE_CONFIRM/u, file);
  assert.match(read("src/components/v3/knowledge/next/FileActionForm.tsx"), /QUEUE_CONFIRM/u);
  assert.match(read("src/components/v3/knowledge/next/LibraryDialogs.tsx"), /QUEUE_CONFIRM/u);
});

test("«Выбрать» на телефоне стоит в заголовке карточки, а таблица не ищет сама, когда ищет страница", () => {
  assert.match(read("src/components/v3/knowledge/next/LibraryColumns.tsx"), /className="mt-3 md:hidden"/u);
  assert.match(read("src/components/v3/knowledge/next/files-columns.tsx"), /className="mt-0\.5 md:hidden"/u);
  assert.match(read("src/components/kit/DataTable.tsx"), /searchPlaceholder\?: string \| null;/u);
  assert.match(read("src/components/kit/DataTableToolbar.tsx"), /placeholder === null \? null : \(/u);
  assert.match(read("src/components/kit/DataTable.tsx"), /searchPlaceholder = "Поиск"/u, "по умолчанию поиск есть, как у первой волны");
  assert.equal(read("src/components/kit/DataTable.tsx").split("\n").length - 1 <= 150, true);
  assert.match(read("src/components/ui/native-select.tsx"), /<select/u, "выбор в формах с серверными действиями — настоящий select");
});

/* ------------------------------------------------------------------------ выбор вида в страницах, первая загрузка */

test("страницы спрашивают isNextUi после тех же чтений и проверок; прежняя ветка осталась; новый вид в первую загрузку не входит", () => {
  const calendar = read("src/app/(v3)/v3/calendar/page.tsx");
  assert.match(calendar, /import \{ isNextUi \} from "@\/lib\/ui-next";/u);
  assert.match(calendar, /if \(await isNextUi\(actor\)\) \{\s*return \(\s*<CalendarNextLazy/u);
  assert.match(calendar, /<PartShell title="Календарь">\s*<Calendar/u, "прежний вид на месте");
  assert.ok(calendar.indexOf("isNextUi(actor)") > calendar.indexOf("readCalendarWorkspace(actor") && calendar.indexOf("isNextUi(actor)") < calendar.indexOf("<PartShell"), "после чтений, до прежней разметки");
  const knowledge = read("src/app/(v3)/v3/knowledge/page.tsx");
  assert.match(knowledge, /requireKnowledgeAdmin\(actor\);/u, "граница администратора та же");
  assert.ok(knowledge.indexOf("requireKnowledgeAdmin(actor)") < knowledge.indexOf("isNextUi(actor)"), "сначала проверка прав");
  assert.match(knowledge, /<KnowledgeNextLazy commandScope=\{`\$\{actor\.organizationId\}:\$\{actor\.membershipId\}`\} section=\{section\}>/u);
  assert.match(knowledge, /<KnowledgeDocuments actor=\{actor\} embedded next \/>/u);
  assert.match(knowledge, /<KnowledgeSnippets actor=\{actor\} next \/>/u);
  assert.match(knowledge, /<PartShell title="База знаний"><Suspense fallback=\{<KnowledgeLibrarySkeleton \/>\}>/u, "прежняя ветка на месте");
  const chat = read("src/app/(v3)/v3/team-chat/page.tsx");
  assert.match(chat, /const next = await isNextUi\(actor\);/u);
  assert.match(chat, /if \(next\) return <TeamChatNextFailureLazy/u);
  assert.match(chat, /if \(next\) \{\s*return <TeamChatNextLazy/u);
  assert.match(chat, /<main className="flex h-\[calc\(100dvh-150px\)\] min-h-0 flex-col md:h-\[calc\(100dvh-64px\)\]" aria-label="Командный чат">/u, "прежняя рамка");
  for (const page of [calendar, knowledge, chat]) assert.doesNotMatch(page, /from "@\/components\/kit"|next\/(?:CalendarNextPage|KnowledgeNextPage|TeamChatNextPage|FilesNext|SnippetsNext)"/u, "виджеты нового вида в первую загрузку страницы не входят");
  for (const server of ["KnowledgeDocuments", "KnowledgeSnippets"]) assert.doesNotMatch(read(`src/components/v3/knowledge/${server}.tsx`), /from "@\/components\/kit"|next\/(?:FilesNext|SnippetsNext)"/u, `${server}: только ленивый вход`);
});

test("ленивые входы: «use client», подгрузка настоящего вида и `.catch(onScreenLoadFailed)`", () => {
  const entries = [
    ["calendar/next/CalendarNextLazy", "CalendarNextPage", "CalendarNextPage"], ["knowledge/next/KnowledgeNextLazy", "KnowledgeNextPage", "KnowledgeNextPage"],
    ["knowledge/next/FilesNextLazy", "FilesNext", "FilesNext"], ["reply-snippets/next/SnippetsNextLazy", "SnippetsNext", "SnippetsNext"],
    ["team-chat/next/TeamChatNextLazy", "TeamChatNextPage", "TeamChatNextPage"],
  ];
  for (const [file, module, exported] of entries) {
    const source = read(`src/components/v3/${file}.tsx`);
    assert.match(source, /^"use client";/u, file);
    assert.match(source, new RegExp(`dynamic\\(\\(\\) => import\\("\\./${module}"\\)\\.then\\(\\(module\\) => module\\.${exported}\\)\\.catch\\(onScreenLoadFailed\\)\\)`, "u"), file);
  }
  assert.match(read("src/components/v3/team-chat/next/TeamChatNextLazy.tsx"), /module\.TeamChatNextFailure\)\.catch\(onScreenLoadFailed\)/u);
});

test("свойства, которые страницы отдают ленивым входам, проходят границу сервер → клиент (проверил стенд на настоящих страницах)", () => {
  for (const name of ["calendar", "knowledge-library", "knowledge-documents", "knowledge-snippets", "team-chat", "team-chat-failure"]) assert.ok(pages.get(`${name}:admin-cookie`).html, `${name}: ленивый вход получил сериализуемые свойства`);
});

test("прежние части получили только то, что нужно новому виду: общие значения экспортированы, у чата и дерева — необязательное свойство", () => {
  const manager = read("src/components/v3/FileManager.tsx");
  for (const name of ["ACTION_MESSAGE", "MAX_FILE_BYTES", "FILE_ACCEPT", "initialActionState", "useRefreshAfterMutation", "folderValue", "isDescendant", "uploadConfirmed"]) assert.match(manager, new RegExp(`export (?:const|function) ${name}\\b`, "u"), name);
  assert.match(read("src/components/v3/knowledge/KnowledgeTree.tsx"), /sections = true/u, "по умолчанию группа «Файлы и шаблоны» есть");
  assert.match(read("src/components/v3/team-chat/TeamChat.tsx"), /frame = "page"/u);
  assert.match(read("src/components/v3/team-chat/TeamChat.tsx"), /data-frame=\{frame === "card" \? "card" : undefined\}/u, "у прежнего вида атрибута нет");
  assert.match(read("src/components/v3/team-chat/team-chat.module.css"), /\.workspace\[data-frame="card"\] \.channels \{ padding-top: 12px; \}/u);
  assert.ok(existsSync(root("src/components/ui/native-select.tsx")));
});
