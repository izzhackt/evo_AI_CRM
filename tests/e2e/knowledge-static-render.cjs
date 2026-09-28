"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Э8.10 (28.09.2026): «База знаний» — снимки настоящих компонентов в Chromium.
 *
 * Страница целиком — оболочка (`AppShell`), `PartShell` и `KnowledgeLibrary` —
 * рисуется в браузере самим React (бандл esbuild). Данные СИНТЕТИЧЕСКИЕ:
 * папки, страницы, файлы, доступы, клиенты и выгрузки выдуманы для проверки
 * вёрстки и не являются записями EVO. Сервер заменён заглушкой `fetch`
 * (`/api/v3/knowledge/*`): она отвечает тем же видом, что `http.ts`, и
 * ничего не записывает. Живой Supabase, проверка Admin, команды и
 * маршрутизатор Next.js этот рендер не проверяет.
 *
 *   node tests/e2e/knowledge-static-render.cjs --screenshots [outDir]
 *     → снимки `kb-*.png` (1440×900, 1280×800, 390×844); по умолчанию
 *       outDir — .impeccable/review (не коммитится). Проверки печатаются
 *       строкой на снимок: прокрутка вбок, текст мельче 12 px, число сплошных
 *       красных, цели нажатия меньше 44 px; нарушение — код выхода 1.
 */

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;

// --- браузерная точка входа ----------------------------------------------------
const CLIENT_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { PartShell } = require("@/components/v3/PartShell");
const { KnowledgeLibrary } = require("@/components/v3/knowledge/KnowledgeLibrary");
const { FileManager } = require("@/components/v3/FileManager");
const h = React.createElement;

const fixture = JSON.parse(document.getElementById("kb-fixture").textContent);
window.__kb = { pushes: [], requests: [] };
const router = {
  push: (href) => { window.__kb.pushes.push(String(href)); }, replace: (href) => { window.__kb.pushes.push(String(href)); },
  refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};

// --- синтетика -----------------------------------------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Администратор (синтетический)", systemRole: "admin",
  platformAccessVersion: 1, assignments: [], permissionKeys: [], email: "synthetic@example.invalid", presentationRole: null,
};
const uuid = (n) => "cccccccc-2222-4222-8222-" + String(n).padStart(12, "0");
const YEAR = new Date().getFullYear();
const at = (month, day, hour = 10) => new Date(Date.UTC(YEAR, month - 1, day, hour - 6, 5)).toISOString();
let serial = 0;
function node(area, parent, kind, title, extra = {}) {
  serial += 1;
  return {
    id: extra.id ?? uuid(serial), organization_id: ORG, area, parent_id: parent, kind, title, description: "",
    client_case_id: null, blob_id: kind === "file" ? uuid(9000 + serial) : null, source_blob_id: null,
    mime_type: kind === "file" ? "application/pdf" : kind === "page" ? "text/markdown" : "", source_key: null,
    review_question: "", version: 3, archived_at: null, deleted_at: null,
    created_at: at(9, 1), updated_at: extra.updated_at ?? at(9, 20 - (serial % 9), 9 + (serial % 8)), updated_by: ME,
    ...extra,
  };
}
const F = {};
const folders = [];
const folder = (key, area, parentKey, title) => { const item = node(area, parentKey ? F[parentKey].id : null, "folder", title); F[key] = item; folders.push(item); return item; };
// Внутренняя база: глубина 5, путь к открытой папке раскрыт.
folder("countries", "internal", null, "Страны и направления");
folder("china", "internal", "countries", "Китай");
folder("unis", "internal", "china", "Университеты-партнёры");
folder("beijing", "internal", "unis", "Пекин");
folder("bjdocs", "internal", "beijing", "Документы для подачи");
folder("shanghai", "internal", "unis", "Шанхай");
folder("visa", "internal", "china", "Виза X1 и X2");
folder("malaysia", "internal", "countries", "Малайзия");
folder("korea", "internal", "countries", "Корея");
folder("process", "internal", null, "Процессы отдела поступления");
folder("templates", "internal", null, "Шаблоны писем и ответов");
folder("legal", "internal", null, "Договоры и юридические вопросы");
folder("prices", "internal", "legal", "Цены и скидки");
for (let n = 1; n <= 6; n += 1) folder("misc" + n, "internal", null, ["Маркетинг", "Обучение сотрудников", "Инструкции CRM", "Партнёры", "Выезд и встреча", "Разное"][n - 1]);
// Сырой архив: большая папка (950 файлов) и глубокая цепочка.
folder("rawmail", "raw", null, "Почта 2025");
folder("rawbig", "raw", "rawmail", "Вложения писем");
folder("rawnotion", "raw", null, "Notion — экспорт");
for (let depth = 2; depth <= 9; depth += 1) folder("rawchain" + depth, "raw", depth === 2 ? "rawnotion" : "rawchain" + (depth - 1), "Уровень " + depth);
// Клиентская база и секреты (секреты — только названия папок, значений нет).
folder("clientsroot", "clients", null, "Клиенты 2026");
folder("secretsvps", "secrets", null, "Серверы");
folder("secretsmail", "secrets", null, "Почта и домены");

const LONG = "Порядок подготовки и заверения пакета документов для магистратуры в Китае: перевод, нотариальное заверение и легализация в консульстве, сроки и типичные ошибки";
const items = [];
const add = (area, parentKey, kind, title, extra) => { const item = node(area, parentKey ? F[parentKey].id : null, kind, title, extra); items.push(item); return item; };
add("internal", "bjdocs", "page", "Чек-лист документов: бакалавриат", { review_question: "Нужен ли апостиль на аттестат для 2027?" });
add("internal", "bjdocs", "page", LONG);
add("internal", "bjdocs", "file", "Анкета университета — образец.pdf");
add("internal", "bjdocs", "file", "Требования к фото.pdf", { updated_at: new Date(Date.UTC(YEAR - 1, 11, 3, 4)).toISOString() });
add("internal", "bjdocs", "page", "Мотивационное письмо: структура");
const EDITOR_PAGE = add("internal", "bjdocs", "page", "Как готовить мотивационное письмо", {
  body: "## Структура\\n\\nПисьмо — одна страница: кто вы, почему этот вуз и эта программа, что вы уже сделали.\\n\\n- Начало — конкретный случай, а не общие слова.\\n- Середина — опыт и результаты.\\n- Конец — план на учёбу.\\n\\n| Часть | Объём |\\n| --- | --- |\\n| Начало | 3–4 предложения |\\n| Основная часть | 2 абзаца |\\n\\nПодробнее — [требования вуза](https://example.invalid/requirements).",
  review_question: "Уточнить объём для программ на английском",
});
for (let n = 1; n <= 950; n += 1) add("raw", "rawbig", "file", "Вложение " + String(n).padStart(4, "0") + ".pdf");
for (const [n, title] of ["Скан приказа о стипендии.pdf", "Заметки со встречи с партнёром", "Прайс вуза 2026.xlsx", "Письмо от университета.pdf", "Разбор звонка с родителями", "Список общежитий.pdf", "Новые правила визы"].entries()) {
  add("internal", null, /\.[a-z]+$/u.test(title) ? "file" : "page", title, { review_question: n === 1 ? "Кто ответственный за партнёра?" : "" });
}
const SECRET = add("secrets", "secretsvps", "secret", "Панель хостинга");
add("secrets", "secretsvps", "secret", "Резервные копии");
add("clients", "clientsroot", "folder", "Материалы без дела");

const CLIENTS = [
  { studentCaseId: uuid(7001), studentDisplayName: "Айжан Примерова", targetCountry: "Китай", targetDegree: "Магистратура", intake: "Сентябрь 2027", createdAt: at(8, 14), handoffAt: at(8, 20), state: "active" },
  { studentCaseId: uuid(7002), studentDisplayName: "Бекзат Условный", targetCountry: "Малайзия", targetDegree: "Бакалавриат", intake: "Февраль 2027", createdAt: at(9, 2), handoffAt: null, state: "open" },
  { studentCaseId: uuid(7003), studentDisplayName: "Дарина Тестовая", targetCountry: "Корея", targetDegree: "Языковой курс", intake: "Март 2027", createdAt: at(9, 11), handoffAt: at(9, 15), state: "active" },
];

// --- заглушка /api/v3/knowledge ------------------------------------------------
function page(list, params) {
  const limit = Number(params.get("limit") || 100);
  const afterId = params.get("afterId");
  const start = afterId ? list.findIndex((item) => item.id === afterId) + 1 : 0;
  const slice = list.slice(start, start + limit);
  const hasMore = start + limit < list.length;
  const last = slice[slice.length - 1];
  return { items: slice, hasMore, nextCursor: hasMore && last ? { title: last.title, id: last.id } : null };
}
const byTitle = (a, b) => a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id);
function respond(path, params, init) {
  const [route, id, option] = path.split("/");
  if (route === "list") {
    const mode = params.get("mode");
    if (mode === "folders") return page([...folders].sort(byTitle), params);
    const area = params.get("area");
    const all = [...folders, ...items];
    if (mode === "search") {
      const search = (params.get("search") || "").toLowerCase();
      return page(all.filter((item) => item.area !== "secrets" && (!area || item.area === area) && item.title.toLowerCase().includes(search)).sort(byTitle), params);
    }
    if (mode === "inbox") return page(items.filter((item) => item.area === area && item.parent_id === null).sort(byTitle), params);
    if (mode === "review") return page(items.filter((item) => item.area === area && item.review_question).sort(byTitle), params);
    if (mode === "trash" || mode === "archive") return page([], params);
    const parent = params.get("parentId");
    return page(all.filter((item) => item.area === area && item.parent_id === (parent || null)).sort((a, b) => (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || byTitle(a, b)), params);
  }
  if (route === "item" && !option) {
    const item = [...folders, ...items].find((candidate) => candidate.id === id);
    return item ? { ...item, body: item.body ?? "" } : null;
  }
  if (route === "exports") return [
    { id: uuid(8001), state: "ready", entry_count: 42, completed_entries: 42, written_bytes: 18_400_000, created_at: at(9, 27, 16), expires_at: new Date(Date.now() + 36e5).toISOString(), lease_until: null, error_code: null },
    { id: uuid(8002), state: "running", entry_count: 950, completed_entries: 312, written_bytes: 96_000_000, created_at: new Date(Date.now() - 5000).toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString(), lease_until: new Date(Date.now() + 6e4).toISOString(), error_code: null },
  ];
  if (route === "secrets" && id === "status") return { available: true };
  if (route === "secrets" && id) return { service: "Панель хостинга", url: "https://panel.example.invalid", login: "admin-synthetic", purpose: "Управление сервером CRM", note: "Двухфакторный вход у владельца", item: SECRET };
  if (route === "clients" && !id) {
    const search = (params.get("search") || "").toLowerCase();
    return { items: CLIENTS.filter((row) => row.studentDisplayName.toLowerCase().includes(search)), hasMore: false, nextCursor: null };
  }
  if (route === "search-canonical") return { items: [
    { kind: "student", id: uuid(7001), title: "Айжан Примерова", context: "Дело · Китай · Магистратура", href: "/v3/profile?case=" + uuid(7001), downloadHref: null },
    { kind: "university_file", id: uuid(7101), title: "Требования к документам — Пекин", context: "Университет · Пекин", href: "/v3/universities", downloadHref: "/api/v3/universities/files/" + uuid(7101) },
  ], hasMore: false, nextCursor: null };
  return null;
}
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, "http://kb.invalid");
  if (!url.pathname.startsWith("/api/v3/knowledge/")) return realFetch(input, init);
  const path = url.pathname.slice("/api/v3/knowledge/".length);
  window.__kb.requests.push(path + url.search);
  if (fixture.hang && path.startsWith("list")) return new Promise(() => {});
  const body = respond(path, url.searchParams, init);
  return new Response(JSON.stringify(body ?? { error: "knowledge_not_found" }), { status: body ? 200 : 404, headers: { "Content-Type": "application/json" } });
};

window.__kbActions = {
  loadStaffNotificationsAction: async () => ({ ok: true, page: { items: [], unreadCount: "0", nextCursor: null } }),
};

function documentsSection() {
  const folders = [
    { id: "company", name: "Компания", parentId: null, kind: "company-root", version: null, renameRequestId: null, moveRequestId: null, archiveRequestId: null },
    { id: uuid(6001), name: "Бланки договоров", parentId: "company", kind: "company", version: "2", renameRequestId: uuid(6101), moveRequestId: uuid(6102), archiveRequestId: uuid(6103) },
    { id: "students", name: "Студенты", parentId: null, kind: "students", version: null, renameRequestId: null, moveRequestId: null, archiveRequestId: null },
  ];
  const files = [
    { id: uuid(6201), folderId: uuid(6001), name: "Договор — образец.pdf", addedAt: "18.09", size: "240 КБ", kind: "company", version: "1", currentVersionId: uuid(6301), downloadHref: "#", renameRequestId: uuid(6401), moveRequestId: uuid(6402), archiveRequestId: uuid(6403), uploadRequestId: uuid(6404) },
  ];
  return h(FileManager, { embedded: true, allowKnowledgeExport: true, rootLabel: "Документы", folders, files, canManage: true, canUpload: true, createFolderRequestId: uuid(6501), createFileRequestId: uuid(6502) });
}

// Адрес сценария называет папки и материалы ключами («@bjdocs»): id синтетики считаются здесь.
const ALIASES = { editor: EDITOR_PAGE.id, secret: SECRET.id };
const params = new URLSearchParams(fixture.search.replace(/@([a-z0-9]+)/gu, (_, key) => (F[key] ? F[key].id : ALIASES[key])));
const section = params.get("section") === "documents" || params.get("section") === "snippets" ? params.get("section") : null;
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: "/v3/knowledge" },
    h(SearchParamsContext.Provider, { value: params },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-surface": "staff" },
          h(AppShell, { actor: ACTOR, initialNotifications: null },
            h(PartShell, { title: "База знаний" },
              h(KnowledgeLibrary, { commandScope: ORG + ":" + ME, section }, section === "documents" ? documentsSection() : null))))))));
window.__kbFolders = { total: folders.length, secretsTotal: folders.filter((item) => item.area === "secrets").length };
createRoot(document.getElementById("root")).render(tree);
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.rendered = "1"; }));
`;

const LINK_SHIM = `
const React = require("react");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const ONLY = new Set(["prefetch", "scroll", "replace", "shallow", "locale", "passHref", "legacyBehavior", "onNavigate", "as", "unstable_dynamicOnHover"]);
function Link(props) {
  const router = React.useContext(AppRouterContext);
  const rest = {};
  for (const [key, value] of Object.entries(props)) if (!ONLY.has(key) && key !== "href" && key !== "onClick") rest[key] = value;
  const href = String(props.href);
  return React.createElement("a", { ...rest, href, onClick(event) {
    if (props.onClick) props.onClick(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    router.push(href);
  } });
}
module.exports = Link;
module.exports.default = Link;
module.exports.__esModule = true;
`;

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "kb-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      // CSS-модуль: имя класса = ключ; сам файл модуля подключается к странице как есть (compileCss).
      build.onLoad({ filter: /\.module\.css$/ }, () => ({
        contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });",
        loader: "js",
      }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Серверные действия: ответ заглушки из `window.__kbActions`, иначе — честный отказ.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => `export async function ${name}(...args) { const stub = window.__kbActions && window.__kbActions[${JSON.stringify(name)}]; if (stub) return stub(...args); throw new Error("kb harness: server action ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "kb-client-entry.js", loader: "js" },
    bundle: true,
    outfile: outFile,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    banner: { js: "var process = globalThis.process || { env: {} };" },
    plugins: [plugin],
    logLevel: "error",
  });
}

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [
    ...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"),
    readFileSync(join(ROOT, "src/components/v3/knowledge/KnowledgeLibrary.module.css"), "utf8"),
  ].join("\n");
}

// --- сценарии -------------------------------------------------------------------
const PAGES = {
  tree: { search: "area=internal&folder=@bjdocs" },
  big: { search: "area=raw&folder=@rawbig" },
  inbox: { search: "area=internal&view=inbox" },
  loading: { search: "area=internal", hang: true },
  clients: { search: "area=clients" },
  editor: { search: "area=internal&folder=@bjdocs&item=@editor" },
  secret: { search: "area=secrets&folder=@secretsvps&item=@secret" },
  documents: { search: "section=documents" },
};

const isPhone = (page) => page.viewportSize().width < 768;
const openMore = async (page) => {
  await page.getByRole("button", { name: "Ещё действия с базой знаний" }).click();
  await page.getByTestId("knowledge-more-menu").waitFor();
};

// [имя снимка, страница, шаги]
const SHOTS = [
  ["kb-tree", "tree", async () => {}],
  ["kb-create-menu", "tree", async (page) => {
    await page.getByRole("button", { name: "Создать", exact: true }).click();
    await page.getByTestId("knowledge-create-menu").waitFor();
  }],
  ["kb-more-menu", "tree", openMore],
  ["kb-import", "tree", async (page) => {
    await openMore(page);
    await page.getByRole("button", { name: /Перенос локальной базы/u }).click();
    await page.waitForSelector('[data-testid="knowledge-import-dialog"][open]');
  }],
  ["kb-export", "tree", async (page) => {
    await openMore(page);
    await page.getByRole("button", { name: "Выгрузить папку", exact: true }).click();
    await page.waitForSelector('[data-testid="knowledge-export-dialog"][open] [data-testid="knowledge-export-jobs"]');
  }],
  ["kb-selection", "tree", async (page) => {
    const boxes = page.locator("[data-queue-select]");
    await boxes.nth(1).check();
    await boxes.nth(3).check();
    await page.getByTestId("knowledge-selection").waitFor();
  }],
  ["kb-search", "tree", async (page) => {
    await page.getByRole("searchbox", { name: "Поиск по базе знаний" }).fill("мотивац");
    await page.getByTestId("knowledge-canonical-search").locator("a").first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="knowledge-table"] tbody a').length > 0);
  }],
  // Телефон: дерево — в листе «Папки»; шире — дерево сбоку, «Секреты» раскрываются только нажатием.
  ["kb-sheet", "tree", async (page) => {
    if (isPhone(page)) {
      await page.getByTestId("knowledge-tree-open").click();
      await page.waitForSelector('[data-testid="knowledge-tree-sheet"][open] [data-testid="knowledge-tree"]');
      return;
    }
    await page.locator('aside [data-knowledge-area="secrets"] button[aria-expanded]').click();
    await page.locator('aside [data-knowledge-area="secrets"] ul a').first().waitFor();
  }],
  ["kb-big", "big", async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="knowledge-table"] tbody tr').length === 100);
    const more = page.getByRole("button", { name: "Показать ещё", exact: true });
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="knowledge-table"] tbody tr').length === 200);
    await more.scrollIntoViewIfNeeded();
  }],
  ["kb-inbox", "inbox", async () => {}],
  ["kb-loading", "loading", async (page) => { await page.getByTestId("knowledge-skeleton-row").first().waitFor(); }],
  ["kb-clients", "clients", async (page) => { await page.getByTestId("knowledge-dossiers").locator("a").first().waitFor(); }],
  ["kb-editor", "editor", async (page) => { await page.getByTestId("knowledge-editor").waitFor(); }],
  ["kb-editor-edit", "editor", async (page) => {
    await page.getByTestId("knowledge-editor").waitFor();
    await page.getByRole("button", { name: "Редактировать" }).click();
    await page.getByRole("textbox", { name: "Текст страницы" }).waitFor();
  }],
  ["kb-secret", "secret", async (page) => { await page.waitForSelector('[data-testid="knowledge-secret"] input[name="service"]:not([disabled])'); }],
  ["kb-documents", "documents", async () => {}],
];

/** Проверки на каждом снимке. */
function probe() {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const layers = [...document.querySelectorAll("dialog[open], :popover-open")].filter(visible);
  const roots = layers.length ? layers : [document.body];
  const texts = roots.flatMap((root) => [...root.querySelectorAll("*")])
    .filter((element) => visible(element) && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  const smallest = texts.reduce((min, element) => Math.min(min, parseFloat(getComputedStyle(element).fontSize)), 99);
  const library = document.querySelector('[data-testid="knowledge-library"]');
  // Цели нажатия: элементы экрана базы знаний (оболочка проверяется своим рендером).
  const scope = [...layers.filter((layer) => !layer.closest("[data-shell-menu]")), library].filter(Boolean);
  const small = [];
  for (const root of scope) {
    for (const element of root.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary')) {
      if (!visible(element) || element.closest("[data-kb-inline]") || element.closest('[class*="markdown"]')) continue;
      // Флажок и переключатель — зона нажатия их подписи.
      const target = ["checkbox", "radio"].includes(element.type) && element.closest("label") ? element.closest("label") : element;
      const box = target.getBoundingClientRect();
      if (box.height < 43.5 || box.width < 43.5) small.push(`${element.tagName.toLowerCase()}«${(element.getAttribute("aria-label") || element.textContent || element.name || "").trim().slice(0, 24)}» ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
  }
  const redBoxes = [...document.querySelectorAll("a, button")].filter((element) => getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)" && visible(element));
  const treeLinks = [...document.querySelectorAll('[data-testid="knowledge-tree"] ul a')].filter((a) => !a.closest("nav"));
  const dates = [...document.querySelectorAll('[data-testid="knowledge-table"] tbody time')];
  const checks = [...document.querySelectorAll("[data-queue-select]")].filter(visible);
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minText: smallest,
    solidRed: redBoxes.length,
    red: redBoxes.map((element) => element.textContent.trim().slice(0, 20)).join("|") || null,
    smallTargets: small.length,
    small: small.slice(0, 6).join("; ") || null,
    treeLinks: treeLinks.length,
    secretsOpen: [...document.querySelectorAll('[data-knowledge-area="secrets"]')].some((area) => area.querySelector("ul")),
    current: [...document.querySelectorAll('[data-testid="knowledge-tree"] [aria-current="page"]')].map((element) => element.textContent.trim()).join("|") || null,
    dates: dates.slice(0, 3).map((element) => element.textContent).join(",") || null,
    dateFont: dates[0] ? getComputedStyle(dates[0]).fontFamily.split(",")[0] : null,
    checkAccent: checks[0] ? getComputedStyle(checks[0]).accentColor : null,
    loadingText: /Загрузка/u.test(document.body.innerText),
    skeletonRows: document.querySelectorAll('[data-testid="knowledge-skeleton-row"]').length,
    summaries: library ? library.querySelectorAll("summary").length : 0,
    rows: document.querySelectorAll('[data-testid="knowledge-table"] tbody tr').length,
    // Окно переноса смонтировано всегда — и при открытом материале.
    importMounted: document.querySelectorAll('[data-testid="knowledge-import-dialog"]').length === 1,
  };
}

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundle = "kb-client.js";
  await buildClientBundle(join(outDir, bundle));
  const css = await compileCss();
  for (const [name, config] of Object.entries(PAGES)) {
    const fixture = JSON.stringify({ search: config.search, hang: Boolean(config.hang) }).replaceAll("<", "\\u003c");
    writeFileSync(join(outDir, `kb-${name}.html`), [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>База знаний ${name} — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root"></div><script type="application/json" id="kb-fixture">${fixture}</script><script src="${bundle}"></script></body></html>`,
    ].join(""));
  }
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const VIEWPORTS = [
    ["1440", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
    ["1280", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
    ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ];
  const failures = [];
  const only = process.env.KB_ONLY ? new Set(process.env.KB_ONLY.split(",")) : null;
  try {
    for (const [shot, pageName, step] of SHOTS) {
      if (only && !only.has(shot)) continue;
      for (const [width, context] of VIEWPORTS) {
        const file = `${shot}-${width}.png`;
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(pathToFileURL(join(outDir, `kb-${pageName}.html`)).href, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector("html[data-rendered]", { state: "attached", timeout: 15_000 });
        try {
          await step(page);
        } catch (error) {
          failures.push(`${file}: step failed: ${error.message.split("\n")[0]}`);
        }
        await page.waitForTimeout(350);
        const facts = await page.evaluate(probe);
        const own = shot !== "kb-documents";
        if (facts.overflow > 0) failures.push(`${file}: horizontal overflow ${facts.overflow}px`);
        if (facts.minText < 12) failures.push(`${file}: text smaller than 12px (${facts.minText}px)`);
        if (own && facts.solidRed > 1) failures.push(`${file}: ${facts.solidRed} solid red controls (${facts.red})`);
        if (own && facts.smallTargets) failures.push(`${file}: ${facts.smallTargets} targets below 44px (${facts.small})`);
        if (facts.loadingText) failures.push(`${file}: «Загрузка…» text is shown`);
        if (!facts.importMounted) failures.push(`${file}: the local import dialog is not mounted`);
        if (facts.summaries) failures.push(`${file}: ${facts.summaries} <summary> markers in the library`);
        if (facts.checkAccent === "rgb(215, 2, 23)") failures.push(`${file}: red checkboxes`);
        if (facts.dateFont && !/JetBrains/u.test(facts.dateFont)) failures.push(`${file}: dates are not JetBrains Mono (${facts.dateFont})`);
        if (shot === "kb-tree" && facts.secretsOpen) failures.push(`${file}: «Секреты и доступы» opened by itself`);
        if (shot === "kb-sheet" && !isPhone(page) && !facts.secretsOpen) failures.push(`${file}: «Секреты и доступы» did not open on click`);
        if (shot === "kb-loading" && !facts.skeletonRows) failures.push(`${file}: no skeleton rows while loading`);
        if (shot === "kb-inbox") {
          // На телефоне дерево — в закрытом листе «Папки»: отметка стоит и в скрытой колонке.
          const current = await page.locator('nav[aria-label="Разделы базы знаний"] [aria-current="page"]').allTextContents();
          if (!current.includes("Входящие")) failures.push(`${file}: «Входящие» has no aria-current (${current.join("|")})`);
        }
        const real = errors.filter((message) => !/server action .* is not available|Failed to load resource/u.test(message));
        if (real.length) failures.push(`${file}: browser errors: ${real.join(" | ")}`);
        await page.screenshot({ path: join(outDir, file), fullPage: false });
        process.stdout.write(`${file}: ${Object.entries(facts).filter(([, value]) => value !== null && value !== false && value !== 0).map(([key, value]) => `${key}=${value}`).join(" ")}\n`);
        await browserContext.close();
      }
    }
    if (!only || only.has("kb-tree")) await treeProbe(browser, outDir, failures);
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`Knowledge harness failures:\n${failures.join("\n")}`);
    process.exit(1);
  }
}

/**
 * Дерево держит в документе только раскрытые ветки; раскрытие и сворачивание
 * по нажатию; путь к открытой папке раскрыт; «Секреты» закрыты.
 */
async function treeProbe(browser, outDir, failures) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(join(outDir, "kb-tree.html")).href, { waitUntil: "load" });
  await page.waitForSelector("html[data-rendered]", { state: "attached" });
  const aside = page.locator("aside");
  await aside.locator('[aria-current="page"]').waitFor();
  const total = await page.evaluate(() => window.__kbFolders.total);
  const shown = await aside.locator("[data-knowledge-area] ul a").count();
  if (shown >= total) failures.push(`tree renders ${shown} of ${total} folders: closed branches are in the document`);
  const current = await aside.locator('[aria-current="page"]').textContent();
  if (current !== "Документы для подачи") failures.push(`tree current folder reads «${current}»`);
  const legal = aside.getByRole("button", { name: "Раскрыть: Договоры и юридические вопросы" });
  await legal.click();
  await aside.getByRole("link", { name: "Цены и скидки" }).waitFor();
  await aside.getByRole("button", { name: "Свернуть: Договоры и юридические вопросы" }).click();
  if (await aside.getByRole("link", { name: "Цены и скидки" }).count()) failures.push("a collapsed branch keeps its children");
  const nested = await aside.locator("a a, summary a, button a").count();
  if (nested) failures.push(`${nested} links nested in other controls`);
  // «⋯» → «Перенос локальной базы» → Esc: окно закрыто, но смонтировано, фокус — снова на «⋯».
  const more = page.getByRole("button", { name: "Ещё действия с базой знаний" });
  await more.click();
  await page.getByRole("button", { name: /Перенос локальной базы/u }).click();
  await page.waitForSelector('[data-testid="knowledge-import-dialog"][open]');
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="knowledge-import-dialog"]:not([open])', { state: "attached" });
  await page.waitForTimeout(100);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  if (focused !== "Ещё действия с базой знаний") failures.push(`focus after closing the import dialog is on «${focused}»`);
  process.stdout.write(`tree probe: ${shown} of ${total} folders rendered, current «${current}», focus after Esc «${focused}»\n`);
  await context.close();
}

if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.log("Usage: node tests/e2e/knowledge-static-render.cjs --screenshots [outDir]");
}
