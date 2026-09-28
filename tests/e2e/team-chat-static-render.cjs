"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в conversations-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Командный чат» (`/v3/team-chat`, Э8.9 плана 28.09.2026): облик staff CRM —
 * нейтральный выбор канала, знаки отделов меню на нейтральных кругах вместо
 * букв, нейтральный счётчик непрочитанных, своё сообщение нейтральное,
 * подсветка кольцом фокуса, тёмное подтверждение удаления, красным остаётся
 * только «Отправить»; h1 — на высоте `--shell-page-top`. Удалённые
 * сообщения — как A15 на main: каждое своей строкой «Сообщение удалено»
 * (сворачивать подряд идущие владелец 28.09 отказался — «оставить как есть»).
 *
 * Страницу строит НАСТОЯЩИЙ `v3/team-chat/page.tsx`: его чтение подменено
 * синтетическим (актёр, лента V2, каналы, участники). Оболочка (`AppShell`) и
 * `TeamChat` рендерятся на сервере и гидратируются в браузере настоящими
 * клиентскими компонентами (бандл esbuild); серверные действия отвечают той
 * же синтетикой (чтение ленты и поиска, отметка просмотра), запись честно
 * недоступна — кроме путей удаления, где заглушка команды отвечает «сохранено»
 * и следующие чтения отдают это сообщение удалённым (всё — в памяти вкладки,
 * в EVO ничего не пишется); живые обновления — заглушка клиента Supabase,
 * которая сразу «подключена» и даёт пути вызвать «invalidate». Люди, каналы и
 * сообщения ВЫДУМАНЫ для проверки вёрстки и не являются записями EVO. Живой
 * Supabase, права сервера, SQL и маршрутизатор Next.js этот рендер не
 * проверяет.
 *
 *   node tests/e2e/team-chat-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — статическая разметка страниц.
 *   node tests/e2e/team-chat-static-render.cjs --screenshots [outDir] [--prefix=e89]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844: переписка с
 *       ответами, цитатами и удалёнными; каналы с непрочитанными (на
 *       телефоне — список каналов); канал, где удалено всё (строки A15);
 *       ссылка на удалённое сообщение (как из задачи); гонка «К
 *       непрочитанным» — первое непрочитанное удалено после снимка каналов —
 *       к его строке «Сообщение удалено»; поиск с подсветкой и переходом в
 *       переписку; окно
 *       подтверждения удаления; удаление своего, модерация и удаление по
 *       живому обновлению с клавиатуры — фокус остаётся у строки сообщения;
 *       набранный текст — единственная красная кнопка. По умолчанию outDir —
 *       .impeccable/review (не коммитится).
 *       Проверки печатаются JSON-строками; при нарушении — код выхода 1.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8")), filename);
  };
}
Module._extensions[".png"] = (module) => {
  module.exports = { src: LOGO_URL, width: 1843, height: 842 };
};
const cssModules = new Map();
// CSS-модуль: имя класса — ключ; `import styles from` через esModuleInterop
// читает `default`, поэтому модуль объявлен ES-модулем, а `default` — он сам.
Module._extensions[".css"] = (module, filename) => {
  cssModules.set(filename, readFileSync(filename, "utf8"));
  const classes = new Proxy({}, {
    get: (_target, key) => (key === "__esModule" ? true : key === "default" ? classes : typeof key === "string" ? key : undefined),
  });
  module.exports = classes;
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === "server-only") {
    return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  }
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement: h } = require("react");
const { renderToStaticMarkup, renderToString } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

function withContexts(node, pathname, search) {
  return h(AppRouterContext.Provider, { value: routerStub },
    h(PathnameContext.Provider, { value: pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

// --- синтетические сотрудники ---------------------------------------------------
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const AIGERIM = "aaaaaaaa-1111-4111-8111-000000000002";
const TIMUR = "aaaaaaaa-1111-4111-8111-000000000003";
const LEILA = "aaaaaaaa-1111-4111-8111-000000000004";
const NAMES = {
  [ME]: "Администратор (синтетический)", [AIGERIM]: "Айгерим Макетова",
  [TIMUR]: "Тимур Образцов", [LEILA]: "Лейла Тестовая",
};
const ADMIN = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid",
  assignments: [], permissionKeys: [], displayName: NAMES[ME], systemRole: "admin", presentationRole: null,
};
const PARTICIPANTS = [ME, AIGERIM, TIMUR, LEILA].map((membershipId) => ({ membershipId, displayName: NAMES[membershipId], role: null }));

// --- синтетические сообщения ------------------------------------------------------
// «Сейчас» — понедельник 28.09.2026, около 12:00 по Бишкеку (06:00 UTC).
const messageId = (sequence) => `cccccccc-9999-4999-8999-${String(sequence).padStart(12, "0")}`;
const DELETED_AT = "2026-09-28T01:00:00.000Z";
function message(sequence, author, createdAt, body, extra = {}) {
  const deleted = Boolean(extra.deleted);
  return {
    id: messageId(sequence), channelKey: extra.channel ?? "general", sequence: String(sequence),
    authorMembershipId: author, authorName: NAMES[author], body: deleted ? "" : body,
    parentMessageId: extra.root ? messageId(extra.root) : null,
    quoteMessageId: extra.quote ? messageId(extra.quote) : extra.root ? messageId(extra.root) : null,
    mentionedMembershipIds: deleted ? [] : extra.mentions ?? [],
    version: deleted || extra.edited ? "2" : "1", createdAt,
    editedAt: extra.edited && !deleted ? extra.edited : null, deletedAt: deleted ? DELETED_AT : null,
    replyCount: extra.replies ?? 0,
  };
}
const quoteOf = (row) => ({
  id: row.id, sequence: row.sequence, authorMembershipId: row.authorMembershipId, authorName: row.authorName,
  version: row.version, deletedAt: row.deletedAt, bodyPreview: row.deletedAt ? "" : Array.from(row.body).slice(0, 240).join(""),
});
function page(messages, focusMessageId = null) {
  const byId = new Map(messages.map((row) => [row.id, row]));
  const quotes = [...new Set(messages.map((row) => row.quoteMessageId).filter(Boolean))].map((id) => quoteOf(byId.get(id)));
  return {
    schemaVersion: 2, messages, quotes,
    beforeCursor: messages[0]?.sequence ?? "0", afterCursor: messages.at(-1)?.sequence ?? "0",
    hasBefore: false, hasAfter: false, watermark: "40", latestMessageId: messages.at(-1)?.id ?? null, focusMessageId,
  };
}
const micro = (value) => value.replace(/\.(\d{3})Z$/u, ".$1000Z");
function channel(key, latest, { unread = 0, firstUnread = null } = {}) {
  return {
    key, muted: false, preferenceVersion: "1", readSequence: "0", unreadCount: unread, firstUnreadId: firstUnread,
    latestPreview: latest ? {
      id: latest.id, sequence: latest.sequence, version: latest.version, authorMembershipId: latest.authorMembershipId,
      authorName: latest.authorName, bodyPreview: latest.deletedAt ? "" : Array.from(latest.body).slice(0, 240).join(""), deletedAt: latest.deletedAt,
    } : null,
    latestPreviewCreatedAt: latest ? micro(latest.createdAt) : null,
  };
}

// Живая переписка «Общего»: ответы с цитатами, продолжения одного автора,
// упоминание, ссылка, правка; два удалённых подряд (каждое — своя тихая
// строка «Сообщение удалено», A15) и удалённое сообщение, на которое есть
// живой ответ (строка с пузырём).
const CONVERSATION = [
  message(11, AIGERIM, "2026-09-26T03:10:00.000Z", "Доброе утро! Кто сегодня принимает звонки по Китаю?", { replies: 1 }),
  message(12, AIGERIM, "2026-09-26T03:12:00.000Z", "Нужен человек до обеда: в 11:00 созвон с родителями студентки."),
  message(13, ME, "2026-09-26T03:20:00.000Z", "Я возьму. Список документов для визы уже в папке дела.", { root: 11 }),
  message(14, TIMUR, "2026-09-26T04:05:00.000Z", "", { deleted: true }),
  message(15, TIMUR, "2026-09-26T04:06:00.000Z", "", { deleted: true }),
  message(16, TIMUR, "2026-09-26T04:30:00.000Z", "Обновил прайс на перевод документов: https://example.invalid/price"),
  message(17, AIGERIM, "2026-09-27T05:00:00.000Z", "", { deleted: true, replies: 1 }),
  message(18, ME, "2026-09-27T05:15:00.000Z", "Ответила в задаче, здесь дублировать не нужно.", { root: 17, edited: "2026-09-27T05:20:00.000Z" }),
  message(19, TIMUR, "2026-09-28T04:40:00.000Z", "Коллеги, в пятницу обучение по новой форме анкеты. Время подтвержу до среды.", { mentions: [ME, LEILA] }),
  message(20, AIGERIM, "2026-09-28T05:02:00.000Z", "Спасибо, буду."),
  message(21, AIGERIM, "2026-09-28T05:03:00.000Z", "Лейла тоже придёт, документы по Шанхаю она принесёт с собой."),
];
// Канал, где удалено всё — как «Общий» после «удали их» 28.09 (только форма,
// время выдумано): корень с ответом и ответ с цитатой — строки с пузырём,
// ещё четыре — тихие строки «Сообщение удалено» (A15); номер 6 — в другом
// канале. Непрочитанных нет: миграция 239 считает только живые.
const ALL_DELETED = [
  message(1, ME, "2026-09-11T09:00:00.000Z", "", { deleted: true, replies: 1 }),
  message(2, ME, "2026-09-11T09:30:00.000Z", "", { deleted: true, root: 1 }),
  message(3, ME, "2026-09-17T23:30:00.000Z", "", { deleted: true }),
  message(4, ME, "2026-09-18T00:10:00.000Z", "", { deleted: true }),
  message(5, ME, "2026-09-18T00:11:00.000Z", "", { deleted: true }),
  message(7, ME, "2026-09-19T23:30:00.000Z", "", { deleted: true }),
];
const SALES_LATEST = message(30, TIMUR, "2026-09-28T05:40:00.000Z", "Лид из Instagram просит перезвонить после 18:00.", { channel: "sales" });
const ADMISSIONS_LATEST = message(31, LEILA, "2026-09-28T05:45:00.000Z", "Пакет документов для Шанхая собран, проверьте, пожалуйста.", { channel: "admissions" });

const SCENARIOS = {
  // Переписка: ответы и цитаты, удалённые подряд, удалённое с живым ответом.
  conversation: {
    search: { channel: "general" }, messages: CONVERSATION,
    channels: [channel("general", CONVERSATION.at(-1)), channel("sales", SALES_LATEST, { unread: 3, firstUnread: SALES_LATEST.id }), channel("admissions", ADMISSIONS_LATEST, { unread: 12, firstUnread: ADMISSIONS_LATEST.id })],
  },
  // Вход без канала: на телефоне — список каналов с непрочитанными.
  channels: {
    search: {}, messages: CONVERSATION,
    channels: [channel("general", CONVERSATION.at(-1), { unread: 2, firstUnread: messageId(20) }), channel("sales", SALES_LATEST, { unread: 3, firstUnread: SALES_LATEST.id }), channel("admissions", ADMISSIONS_LATEST, { unread: 12, firstUnread: ADMISSIONS_LATEST.id })],
  },
  // Всё удалено: каждое своей строкой «Сообщение удалено» (A15), не «пустой канал».
  "all-deleted": {
    search: { channel: "general" }, messages: ALL_DELETED,
    channels: [channel("general", ALL_DELETED.at(-1)), channel("sales", SALES_LATEST), channel("admissions", null)],
  },
  // Ссылка на первое удалённое (так ведёт ссылка «источник» у задачи).
  "all-deleted-link": {
    search: { channel: "general", message: messageId(1) }, messages: ALL_DELETED,
    channels: [channel("general", ALL_DELETED.at(-1)), channel("sales", SALES_LATEST), channel("admissions", null)],
  },
  // Гонка: снимок каналов сделан, пока 15 было живым первым непрочитанным
  // (15–21 — семь); потом 15 удалили, и лента уже показывает его удалённым.
  // Без гонки миграция 239 не ведёт «К непрочитанным» к удалённому.
  "unread-race": {
    search: { channel: "general" }, messages: CONVERSATION,
    channels: [channel("general", CONVERSATION.at(-1), { unread: 7, firstUnread: messageId(15) }), channel("sales", SALES_LATEST), channel("admissions", ADMISSIONS_LATEST)],
  },
};
// Сценарии общего обхода (снимок на каждой ширине); «unread-race» — только в пути.
const PAGES = ["conversation", "channels", "all-deleted", "all-deleted-link"];
const PATHNAME = "/v3/team-chat";
const searchOf = (scenario) => new URLSearchParams(scenario.search).toString();

// --- настоящая страница с подменённым чтением ---------------------------------------
function stubReads(scenario) {
  require(join(ROOT, "src/lib/platform-guards.ts")).requireV3PageActor = async () => ADMIN;
  require(join(ROOT, "src/lib/v3/team-chat-source.ts")).readV3TeamChatFeed = async (_actor, query) => ({
    page: page(scenario.messages, query.mode === "context" ? query.messageId : null),
    channels: scenario.channels, participants: PARTICIPANTS,
  });
  require(join(ROOT, "src/lib/supabase/config.ts")).getSupabasePublicConfig = () => ({ url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" });
  require(join(ROOT, "src/lib/i18n.ts")).getLocale = async () => "ru";
}

async function buildPage(name) {
  const scenario = SCENARIOS[name];
  stubReads(scenario);
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/team-chat/page.tsx"));
  const element = await Page({ searchParams: Promise.resolve(scenario.search) });
  const { children: chat, ...main } = element.props;
  return { scenario, element, main, chat: chat.props };
}

// --- оболочка -------------------------------------------------------------------
function shellTree({ search, main, chat }) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { TeamChat } = require(join(ROOT, "src/components/v3/team-chat/TeamChat.tsx"));
  return withContexts(
    h("div", { className: "v3-world", "data-surface": "staff" },
      h(AppShell, { actor: ADMIN, initialNotifications: null }, h("main", main, h(TeamChat, chat)))),
    PATHNAME, search);
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
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), ...cssModules.values()].join("\n");
}

// --- браузерная сборка ----------------------------------------------------------
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

// Живые обновления: клиент Supabase-заглушка, канал сразу «подключён» —
// без строки «Подключаем обновления…». Сети нет.
const SUPABASE_SHIM = `
export function createBrowserClient() {
  const subscription = {
    // Путь «удалено по живому обновлению» вызывает «invalidate» сам.
    on(_type, _filter, callback) { window.__harnessInvalidate = callback; return subscription; },
    subscribe(callback) { setTimeout(() => callback("SUBSCRIBED"), 0); return subscription; },
  };
  return {
    auth: { async getSession() { return { data: { session: { access_token: "synthetic-harness-session" } }, error: null }; } },
    realtime: { async setAuth() {} },
    channel() { return subscription; },
    async removeChannel() {},
  };
}`;

const FIXTURE_ID = "team-chat-fixture";
const CLIENT_ENTRY = `
const React = require("react");
const { hydrateRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { TeamChat } = require("@/components/v3/team-chat/TeamChat");
const h = React.createElement;
const fixture = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
window.__harness = { pushes: [], recoverable: [], errors: [], actions: [], deleted: [], commandSaves: false };
const router = {
  push: (href) => { window.__harness.pushes.push(href); }, replace: (href) => { window.__harness.pushes.push(href); },
  refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
const tree = h(AppRouterContext.Provider, { value: router },
  h(PathnameContext.Provider, { value: ${JSON.stringify(PATHNAME)} },
    h(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) },
      h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
        h("div", { className: "v3-world", "data-surface": "staff" },
          h(AppShell, { actor: fixture.actor, initialNotifications: null }, h("main", fixture.main, h(TeamChat, fixture.chat))))))));
hydrateRoot(document.getElementById("root"), tree, {
  onRecoverableError: (error) => window.__harness.recoverable.push(String((error && error.message) || error)),
});
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.hydrated = "true"; }));
`;

async function buildClientBundle(outFile) {
  const esbuild = require("esbuild");
  // Чтения отвечают синтетикой этой вкладки: «changes» — без новых строк,
  // поиск — по тексту живых сообщений, контекст — та же лента с фокусом.
  // Отправка, правка и удаление честно недоступны (в EVO ничего не пишется).
  // Удалённые путями этой вкладки (window.__harness.deleted) читаются удалёнными,
  // с новой версией — как строки после команды delete/moderate.
  const fixture = `const fixture = () => {
  const data = JSON.parse(document.getElementById(${JSON.stringify(FIXTURE_ID)}).textContent);
  const gone = new Set(window.__harness.deleted);
  if (!gone.size) return data;
  const at = "2026-09-28T06:00:00.000Z";
  const bump = (version) => String(Number(version) + 1);
  const drop = (row) => gone.has(row.id) ? { ...row, body: "", mentionedMembershipIds: [], editedAt: null, deletedAt: at, version: bump(row.version) } : row;
  const dropQuote = (quote) => gone.has(quote.id) ? { ...quote, bodyPreview: "", deletedAt: at, version: bump(quote.version) } : quote;
  return { ...data, messages: data.messages.map(drop), page: { ...data.page, messages: data.page.messages.map(drop), quotes: data.page.quotes.map(dropQuote) } };
};`;
  const readStub = `${fixture}
export async function readTeamChatAction(query) {
  window.__harness.actions.push("read:" + query.mode);
  const data = fixture();
  if (query.mode === "search") {
    const needle = String(query.query).toLocaleLowerCase("ru-RU");
    const messages = data.messages.filter((row) => !row.deletedAt && row.body.toLocaleLowerCase("ru-RU").includes(needle))
      .map(({ quoteMessageId, ...row }) => row);
    return { status: "ready", snapshot: { page: { messages, cursor: "0", watermark: "40", hasMore: false, latestMessageId: null, rootId: null }, channels: data.channels, participants: data.participants } };
  }
  // «changes»: каждое удаление этой вкладки — одна новая версия после 40.
  const cursor = Number(query.cursor ?? 40), head = 40 + window.__harness.deleted.length;
  const changed = cursor < head ? data.messages.filter((row) => window.__harness.deleted.includes(row.id)).map(({ quoteMessageId, ...row }) => row) : [];
  const next = String(Math.max(cursor, head));
  return { status: "ready", snapshot: { page: { messages: changed, cursor: next, watermark: next, hasMore: false, latestMessageId: data.latestMessageId, rootId: null }, channels: data.channels, participants: data.participants } };
}
export async function teamChatCommandAction(_previous, form) {
  window.__harness.actions.push("command");
  const input = JSON.parse(form.get("input"));
  // Удаление «сохраняется» только в путях удаления — и только в памяти вкладки.
  if (window.__harness.commandSaves && (input.operation === "delete" || input.operation === "moderate")) {
    window.__harness.actions.push(input.operation + ":" + input.messageId);
    window.__harness.deleted.push(input.messageId);
    return { status: "saved", requestId: form.get("request_id"), messageId: input.messageId };
  }
  return { status: "unavailable", requestId: form.get("request_id"), messageId: null };
}`;
  const timelineStub = `${fixture}
export async function readTeamChatTimelineV2Action(input) {
  window.__harness.actions.push("timeline:" + input.mode + (input.messageId ? ":" + input.messageId : ""));
  const data = fixture();
  return { status: "loaded", page: { ...data.page, focusMessageId: input.mode === "context" ? input.messageId : null } };
}
export async function postTeamChatV2Action() { window.__harness.actions.push("post"); return { status: "unavailable" }; }`;
  const seenStub = `
export async function markTeamChatSeenAction(batch) { window.__harness.actions.push("seen:" + batch.messageIds.length); return { status: "saved", receipt: { channelKey: batch.channel, messageIds: batch.messageIds } }; }`;
  const stubs = {
    "platform-team-chat-actions.ts": readStub,
    "platform-team-chat-v2-actions.ts": timelineStub,
    "platform-team-chat-seen-actions.ts": seenStub,
  };
  const plugin = {
    name: "team-chat-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /^@supabase\/ssr$/ }, () => ({ path: "supabase-ssr", namespace: "supabase" }));
      build.onLoad({ filter: /.*/, namespace: "supabase" }, () => ({ contents: SUPABASE_SHIM, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const stub = Object.entries(stubs).find(([file]) => args.path.endsWith(`${"/"}${file}`) || args.path.endsWith(`\\${file}`));
        if (stub) return { contents: stub[1], loader: "ts", resolveDir: ROOT };
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => `export async function ${name}() { window.__harness.errors.push("server action ${name}"); throw new Error("harness: server action ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "team-chat-client-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } };" },
    plugins: [plugin], logLevel: "error",
  });
}

// --- измерения ---------------------------------------------------------------------
function pageMetrics() {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const main = [...document.querySelectorAll("main")].find(visible);
  const inMain = main ? [...main.querySelectorAll("*")].filter(visible) : [];
  const texts = inMain.filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
  // Ссылка внутри текста сообщения — исключение WCAG 2.5.8 (цель в строке текста).
  const targets = main ? [...main.querySelectorAll("a, button, select, textarea, input:not([type=hidden]), summary")]
    .filter((element) => visible(element) && !element.closest("details:not([open]) > :not(summary)") && !(element.tagName === "A" && element.parentElement?.tagName === "P")) : [];
  const paint = (element) => (element ? { bg: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, border: getComputedStyle(element).borderTopColor, borderWidth: getComputedStyle(element).borderTopWidth } : null);
  const h1 = [...document.querySelectorAll("h1")].find(visible);
  const nav = document.querySelector('nav[aria-label="Каналы команды"]');
  const history = document.querySelector('[aria-label="История сообщений"], [aria-label="Результаты поиска"]');
  const channelLinks = nav ? [...nav.querySelectorAll("a")].filter(visible) : [];
  const composer = main ? [...main.querySelectorAll("textarea")].find(visible) : null;
  const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const pageTopRaw = main ? getComputedStyle(main).getPropertyValue("--shell-page-top").trim() : "";
  const pageTop = pageTopRaw.endsWith("rem") ? parseFloat(pageTopRaw) * rootFont : parseFloat(pageTopRaw);
  const bubbles = [...document.querySelectorAll("[data-chat-row] [class*=bubble]")].filter(visible);
  // Тихая строка «Сообщение удалено» (compactDeleted) — без пузыря, её не сравнивать с пузырями.
  const own = bubbles.find((element) => element.closest("[class*=ownMessage]") && !element.closest("[class*=compactDeleted]"));
  const other = bubbles.find((element) => !element.closest("[class*=ownMessage]") && !element.closest("[class*=compactDeleted]"));
  const tombstones = [...document.querySelectorAll("article[data-chat-row]")].filter((element) => visible(element) && /Сообщение удалено/u.test(element.querySelector("[class*=bubble] > p")?.textContent ?? ""));
  const highlighted = [...document.querySelectorAll("[class*=highlighted]")].filter(visible)
    .map((element) => element.querySelector("[class*=bubble]") ?? element);
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    // Самые широкие вылезающие элементы — чтобы найти причину переполнения.
    wide: [...document.querySelectorAll("body *")].filter((element) => visible(element) && element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .slice(0, 5).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}:${Math.round(element.getBoundingClientRect().right)}`),
    h1: [...document.querySelectorAll("h1")].filter(visible).map((element) => element.textContent.trim()),
    h1FromMainTop: h1 && main ? Math.round((h1.getBoundingClientRect().top - main.getBoundingClientRect().top) * 10) / 10 : null,
    pageTop,
    channels: channelLinks.map((link) => ({
      text: link.querySelector("[class*=channelName]")?.textContent.trim() ?? link.textContent.trim(),
      current: link.getAttribute("aria-current"),
      bg: getComputedStyle(link).backgroundColor,
      avatarText: link.querySelector("[data-channel]")?.textContent.trim() ?? null,
      avatarIcon: Boolean(link.querySelector("[data-channel] svg")),
      avatarBg: link.querySelector("[data-channel]") ? getComputedStyle(link.querySelector("[data-channel]")).backgroundColor : null,
      badge: (() => { const badge = link.querySelector("[aria-label$='непрочитанных']"); return badge ? { text: badge.textContent.trim(), ...paint(badge), size: parseFloat(getComputedStyle(badge).fontSize) } : null; })(),
    })),
    headerAvatar: (() => { const avatar = document.querySelector("section [data-channel]"); return visible(avatar) ? { text: avatar.textContent.trim(), icon: Boolean(avatar.querySelector("svg")), bg: getComputedStyle(avatar).backgroundColor } : null; })(),
    own: own ? { ...paint(own), radius: getComputedStyle(own).borderTopLeftRadius, font: parseFloat(getComputedStyle(own.querySelector("p") ?? own).fontSize) } : null,
    other: other ? { ...paint(other), radius: getComputedStyle(other).borderTopLeftRadius, font: parseFloat(getComputedStyle(other.querySelector("p") ?? other).fontSize) } : null,
    authorAvatars: [...document.querySelectorAll("[class*=authorAvatar]")].filter(visible).map((element) => ({ text: element.textContent.trim(), size: parseFloat(getComputedStyle(element).fontSize), weight: getComputedStyle(element).fontWeight, bg: getComputedStyle(element).backgroundColor })).slice(0, 2),
    rows: [...document.querySelectorAll("[data-chat-row]")].map((element) => element.dataset.chatRow.slice(-2)),
    // A15: у каждого удалённого своя строка; тихая (compactDeleted) — без ответов, цитаты и корня.
    tombstones: tombstones.map((element) => element.dataset.chatRow.slice(-2)),
    compact: tombstones.filter((element) => /compactDeleted/u.test(element.className)).map((element) => element.dataset.chatRow.slice(-2)),
    collapsed: Boolean(main && /Удалено сообщений/u.test(main.textContent)) || Boolean(document.querySelector("[data-chat-deleted-run]")),
    dividers: [...document.querySelectorAll("[class*=dateDivider]")].filter(visible).map((element) => element.textContent.trim()),
    empty: Boolean([...document.querySelectorAll("[class*=empty]")].find((element) => visible(element) && /пока нет сообщений/u.test(element.textContent))),
    // clear — зазор между верхом кольца и строкой автора (px): кольцо не задевает имя.
    highlight: highlighted.map((element) => {
      const style = getComputedStyle(element);
      const header = element.closest("[data-chat-row]")?.querySelector("[class*=messageHeader]");
      const ringTop = element.getBoundingClientRect().top - parseFloat(style.outlineOffset) - parseFloat(style.outlineWidth);
      return { outline: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth, clear: visible(header) ? Math.round((ringTop - header.getBoundingClientRect().bottom) * 10) / 10 : null };
    }),
    focus: document.activeElement ? { tag: document.activeElement.tagName, row: document.activeElement.dataset?.chatRow?.slice(-2) ?? null,
      inView: history ? (() => { const box = document.activeElement.getBoundingClientRect(); const view = history.getBoundingClientRect(); return box.top >= view.top - 1 && box.bottom <= view.bottom + 1; })() : null } : null,
    marks: [...document.querySelectorAll("mark")].filter(visible).map((element) => paint(element).bg),
    readActions: [...document.querySelectorAll("[class*=readActions] button")].filter(visible).map((button) => button.textContent.trim()),
    textUnder12: texts.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).map((element) => `${element.tagName}:${element.textContent.trim().slice(0, 20)}`),
    smallTargets: targets.filter((element) => { const box = element.getBoundingClientRect(); return (box.height < 44 || (box.width < 44 && element.tagName !== "A")) && element.tagName !== "TEXTAREA"; })
      .map((element) => `${element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)}:${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)}`),
    solidRed: [...document.querySelectorAll("main a, main button, main summary")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)")
      .map((element) => element.getAttribute("aria-label") ?? element.textContent.trim()),
    confirm: (() => { const button = document.querySelector('form[aria-label="Подтвердить удаление"] button[type=submit]'); return visible(button) ? { text: button.textContent.trim(), ...paint(button) } : null; })(),
    composer: composer ? { bottom: Math.round(composer.getBoundingClientRect().bottom), inViewport: composer.getBoundingClientRect().bottom <= window.innerHeight } : null,
  };
}

const VIEWPORTS = {
  "1440": { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  "1280": { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  "390": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const INK = "rgb(32, 32, 32)";
const SELECTED = "rgb(223, 219, 211)";

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const prefix = process.argv.find((arg) => arg.startsWith("--prefix="))?.slice("--prefix=".length) || "e89";
  const bundleName = `${prefix}-team-chat-client.js`;
  // CSS-модуль чата попадает в стили при первом require компонента.
  require(join(ROOT, "src/components/v3/team-chat/TeamChat.tsx"));
  const css = await compileCss();
  await buildClientBundle(join(outDir, bundleName));
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const report = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);

  const htmlFor = {};
  for (const name of Object.keys(SCENARIOS)) {
    const { scenario, main, chat } = await buildPage(name);
    const search = searchOf(scenario);
    const markup = renderToString(shellTree({ search, main, chat }));
    const data = JSON.stringify({
      actor: ADMIN, search, main, chat, messages: scenario.messages, channels: scenario.channels, participants: PARTICIPANTS,
      page: page(scenario.messages), latestMessageId: scenario.messages.at(-1)?.id ?? null,
    }).replaceAll("<", "\\u003c");
    const htmlPath = join(outDir, `${prefix}-${name}.html`);
    writeFileSync(htmlPath, [
      "<!DOCTYPE html>",
      '<html lang="ru" data-theme="light" class="h-full antialiased">',
      `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>Командный чат — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
      `<body class="min-h-full"><div id="root">${markup}</div><script type="application/json" id="${FIXTURE_ID}">${data}</script><script src="${bundleName}"></script></body></html>`,
    ].join(""));
    htmlFor[name] = htmlPath;
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const open = async (htmlPath, viewportKey) => {
    const context = await browser.newContext(VIEWPORTS[viewportKey]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector("html[data-hydrated=true]", { state: "attached", timeout: 15_000 });
    // Подключение живых обновлений (заглушка) и первое перечитывание.
    await page.waitForFunction(() => window.__harness.actions.some((action) => action === "read:changes"), null, { timeout: 5_000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(200);
    return { context, page, errors };
  };
  const finish = async ({ context, page, errors }, label) => {
    const harness = await page.evaluate(() => window.__harness);
    const problems = [...errors.filter((message) => !/127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|Failed to load resource/u.test(message)),
      ...harness.recoverable.map((message) => `recoverable: ${message}`), ...harness.errors];
    check(problems.length === 0, `${label}: browser errors: ${problems.join(" | ")}`);
    await context.close();
    return harness;
  };
  const common = (label, metrics, viewportKey) => {
    check(metrics.overflowX === 0, `${label}: horizontal overflow ${metrics.overflowX}px ${metrics.wide.join(" ")}`);
    check(metrics.overflowY <= 0, `${label}: page scrolls ${metrics.overflowY}px`);
    check(metrics.textUnder12.length === 0, `${label}: texts under 12px ${metrics.textUnder12.join(", ")}`);
    check(metrics.smallTargets.length === 0, `${label}: targets under 44px: ${metrics.smallTargets.join(", ")}`);
    check(metrics.solidRed.length <= 1, `${label}: solid red ${metrics.solidRed.join(", ")}`);
    check(metrics.solidRed.every((name) => name === "Отправить"), `${label}: solid red is not «Отправить»: ${metrics.solidRed.join(", ")}`);
    if (metrics.h1.length) {
      check(metrics.h1.length === 1 && metrics.h1[0] === "Командный чат", `${label}: h1 ${JSON.stringify(metrics.h1)}`);
      check(Math.abs(metrics.h1FromMainTop - metrics.pageTop) < 0.5, `${label}: h1 ${metrics.h1FromMainTop}px below the page top, --shell-page-top ${metrics.pageTop}px`);
    }
    for (const item of metrics.channels) {
      check(item.avatarIcon && item.avatarText === "", `${label}: channel «${item.text}» avatar ${JSON.stringify(item)}`);
      if (item.current === "page") check(item.bg === SELECTED, `${label}: selected channel ${item.bg}`);
      if (item.badge) check(item.badge.bg === INK && item.badge.size >= 12, `${label}: unread badge ${JSON.stringify(item.badge)}`);
    }
    if (metrics.headerAvatar) check(metrics.headerAvatar.icon && metrics.headerAvatar.text === "", `${label}: header avatar ${JSON.stringify(metrics.headerAvatar)}`);
    for (const avatar of metrics.authorAvatars) check(avatar.size === 12 && avatar.weight === "500", `${label}: author initials ${JSON.stringify(avatar)}`);
    if (metrics.own) check(metrics.own.bg === SELECTED, `${label}: own bubble ${JSON.stringify(metrics.own)}`);
    if (metrics.other) check(metrics.other.bg === "rgb(255, 255, 255)" && metrics.other.borderWidth === "1px", `${label}: other bubble ${JSON.stringify(metrics.other)}`);
    for (const outline of metrics.highlight) check(outline.outline === INK && outline.style === "solid" && (outline.clear === null || outline.clear >= 0), `${label}: highlight ${JSON.stringify(outline)}`);
    for (const bg of metrics.marks) check(bg === SELECTED, `${label}: search mark ${bg}`);
    if (!/390/u.test(viewportKey) || metrics.composer) check(metrics.composer?.inViewport !== false, `${label}: composer ${JSON.stringify(metrics.composer)}`);
  };

  try {
    for (const name of PAGES) {
      for (const viewportKey of Object.keys(VIEWPORTS)) {
        const file = `${prefix}-${name}-${viewportKey}.png`;
        const session = await open(htmlFor[name], viewportKey);
        const metrics = await session.page.evaluate(pageMetrics);
        await session.page.screenshot({ path: join(outDir, file) });
        await finish(session, file);
        report({ file, ...metrics });
        common(file, metrics, viewportKey);
        const phoneList = viewportKey === "390" && name === "channels";
        // Сворачивания нет нигде: «Удалено сообщений: N» не появляется.
        check(!metrics.collapsed, `${file}: collapsed deleted run is shown`);
        if (name === "conversation" || (name === "channels" && !phoneList)) {
          // A15: 14 и 15 — каждое своей тихой строкой; 17 с живым ответом — строка с пузырём.
          check(JSON.stringify(metrics.tombstones) === JSON.stringify(["14", "15", "17"]), `${file}: tombstones ${JSON.stringify(metrics.tombstones)}`);
          check(JSON.stringify(metrics.compact) === JSON.stringify(["14", "15"]), `${file}: compact tombstones ${JSON.stringify(metrics.compact)}`);
          check(metrics.rows.length === CONVERSATION.length, `${file}: ${metrics.rows.length} message rows for ${CONVERSATION.length} messages`);
        }
        if (name === "conversation" && viewportKey !== "390") {
          const badges = metrics.channels.map((item) => item.badge?.text ?? null);
          check(JSON.stringify(badges) === JSON.stringify([null, "3", "12"]), `${file}: badges ${JSON.stringify(badges)}`);
        }
        if (phoneList) {
          check(metrics.channels.length === 3 && metrics.channels.every((item) => item.badge), `${file}: phone channel list ${JSON.stringify(metrics.channels)}`);
        }
        if (name === "all-deleted" || name === "all-deleted-link") {
          // A15: шесть строк «Сообщение удалено»; 1 (есть ответ) и 2 (ответ с цитатой) — с пузырём.
          check(JSON.stringify(metrics.tombstones) === JSON.stringify(["01", "02", "03", "04", "05", "07"]) && metrics.rows.length === 6, `${file}: tombstones ${JSON.stringify(metrics.tombstones)} rows ${metrics.rows.length}`);
          check(JSON.stringify(metrics.compact) === JSON.stringify(["03", "04", "05", "07"]), `${file}: compact tombstones ${JSON.stringify(metrics.compact)}`);
          check(!metrics.empty, `${file}: empty state in a channel with deleted messages`);
          // 11, 18 и 20 сентября по Бишкеку.
          check(metrics.dividers.length === 3, `${file}: dividers ${metrics.dividers.join(" · ")}`);
          // Удалено всё — непрочитанных нет (миграция 239 считает только живые).
          const general = metrics.channels.find((item) => item.text === "Общий");
          check(!metrics.readActions.some((action) => action.startsWith("К непрочитанным")) && !general?.badge, `${file}: unread ${metrics.readActions.join(" · ")} ${JSON.stringify(general?.badge)}`);
        }
        if (name === "all-deleted-link") {
          // Ссылка «источник» задачи: строка 1 подсвечена, фокус — на ней, она на виду.
          check(metrics.highlight.length === 1 && metrics.focus?.row === "01" && metrics.focus.inView === true, `${file}: permalink ${JSON.stringify({ highlight: metrics.highlight, focus: metrics.focus })}`);
        }
      }
    }

    // Начало переписки: тихие строки удалённых рядом с удалённым, у которого есть живой ответ.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open(htmlFor.conversation, viewportKey);
      const { page } = session;
      await page.evaluate(() => { document.querySelector('[aria-label="История сообщений"]').scrollTop = 0; });
      await page.waitForTimeout(150);
      const metrics = await page.evaluate(pageMetrics);
      const file = `${prefix}-conversation-top-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      await finish(session, file);
      report({ journey: "conversation-top", file, tombstones: metrics.tombstones, compact: metrics.compact, dividers: metrics.dividers });
      common(file, metrics, viewportKey);
    }

    // Гонка: «К непрочитанным» ведёт к первому непрочитанному, которое удалили
    // после снимка каналов, — к его строке «Сообщение удалено»; она подсвечена и в фокусе.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open(htmlFor["unread-race"], viewportKey);
      const { page } = session;
      await page.locator("[class*=readActions] button", { hasText: "К непрочитанным · 7" }).click();
      await page.waitForFunction((id) => document.querySelector(`article[data-chat-row="${id}"][class*=highlighted]`), messageId(15), { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(150);
      const metrics = await page.evaluate(pageMetrics);
      const file = `${prefix}-unread-race-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      const harness = await finish(session, file);
      report({ journey: "first-unread-race", file, actions: harness.actions, highlight: metrics.highlight, focus: metrics.focus, tombstones: metrics.tombstones });
      check(harness.actions.includes(`timeline:context:${messageId(15)}`), `${file}: context read ${JSON.stringify(harness.actions)}`);
      check(metrics.highlight.length === 1 && metrics.focus?.row === "15" && metrics.focus.inView === true, `${file}: first unread ${JSON.stringify({ highlight: metrics.highlight, focus: metrics.focus })}`);
      common(file, metrics, viewportKey);
    }

    // Поиск: нейтральная подсветка найденного; «Показать в переписке» —
    // сообщение подсвечено кольцом фокуса, есть «К результатам поиска».
    for (const viewportKey of ["1440", "390"]) {
      const session = await open(htmlFor.conversation, viewportKey);
      const { page } = session;
      await page.locator('button[aria-label="Поиск в этом канале"]').click();
      await page.locator("#team-chat-search").fill("документ");
      await page.locator("#team-chat-search-form button").click();
      await page.waitForSelector("mark");
      await page.waitForTimeout(100);
      const found = await page.evaluate(pageMetrics);
      const searchFile = `${prefix}-search-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, searchFile) });
      await page.locator("button", { hasText: "Показать в переписке" }).first().click();
      await page.waitForSelector("[class*=highlighted]");
      await page.waitForTimeout(150);
      const context = await page.evaluate(pageMetrics);
      const contextFile = `${prefix}-search-context-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, contextFile) });
      await finish(session, contextFile);
      report({ journey: "search", file: searchFile, marks: found.marks, highlight: context.highlight, readActions: context.readActions, focus: context.focus });
      check(found.marks.length >= 2, `${searchFile}: marks ${found.marks.length}`);
      common(searchFile, found, viewportKey);
      check(context.highlight.length === 1 && context.readActions.includes("К результатам поиска"), `${contextFile}: context ${JSON.stringify({ highlight: context.highlight, readActions: context.readActions })}`);
      common(contextFile, context, viewportKey);
    }

    // Удаление своего сообщения: подтверждение — тёмная кнопка, красного нет.
    for (const viewportKey of ["1440", "390"]) {
      const session = await open(htmlFor.conversation, viewportKey);
      const { page } = session;
      const own = page.locator(`article[data-chat-row="${messageId(13)}"]`);
      await own.locator('summary[aria-label="Действия с сообщением"]').click();
      await own.locator("button", { hasText: "Удалить" }).click();
      await page.waitForSelector('form[aria-label="Подтвердить удаление"]');
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(pageMetrics);
      const file = `${prefix}-delete-confirm-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      const harness = await finish(session, file);
      report({ journey: "delete-confirm", file, confirm: metrics.confirm, solidRed: metrics.solidRed, actions: harness.actions });
      check(metrics.confirm?.text === "Подтвердить удаление" && metrics.confirm.bg === INK, `${file}: confirm ${JSON.stringify(metrics.confirm)}`);
      check(!harness.actions.includes("command"), `${file}: opening the confirmation sent a command`);
      common(file, metrics, viewportKey);
    }

    // Удаление с клавиатуры: после «Подтвердить удаление» (своё), модерации
    // (чужое, с причиной) и удаления по живому обновлению строка сообщения
    // остаётся (A15) и показывает «Сообщение удалено»; фокус — у этой строки
    // (у «Ответить» в ней — при живом обновлении), не на <body>. 13 — ответ с
    // цитатой (строка с пузырём), 16 и 12 — тихие строки.
    const focusOf = (id) => page => page.evaluate((target) => {
      const active = document.activeElement;
      const view = document.querySelector('[aria-label="История сообщений"]').getBoundingClientRect();
      const box = active.getBoundingClientRect();
      const row = active.closest("[data-chat-row]");
      return { tag: active.tagName, text: active.tagName === "ARTICLE" ? null : active.textContent.trim(), holds: row?.dataset.chatRow === target,
        tombstone: row?.querySelector("[class*=bubble] > p")?.textContent ?? null, inView: box.top >= view.top - 1 && box.bottom <= view.bottom + 1 };
    }, id);
    const tombstoned = (page, id) => page.waitForFunction((target) => document.getElementById(`team-message-channel-${target}`)?.querySelector("[class*=bubble] > p")?.textContent === "Сообщение удалено", id, { timeout: 5_000 });
    const deletions = [
      { journey: "delete-own", viewports: ["1440", "390"], id: messageId(13), label: "Удалить", focus: "ARTICLE", compact: false },
      { journey: "moderate", viewports: ["1440"], id: messageId(16), label: "Модерация", focus: "ARTICLE", compact: true, reason: "Проверка вёрстки" },
      { journey: "realtime-delete", viewports: ["1440"], id: messageId(12), focus: "BUTTON", compact: true },
    ];
    for (const deletion of deletions) {
      for (const viewportKey of deletion.viewports) {
        const session = await open(htmlFor.conversation, viewportKey);
        const { page } = session;
        const row = page.locator(`article[data-chat-row="${deletion.id}"]`);
        if (deletion.label) {
          await page.evaluate(() => { window.__harness.commandSaves = true; });
          await row.locator('summary[aria-label="Действия с сообщением"]').focus();
          await page.keyboard.press("Enter");
          await row.locator("button", { hasText: deletion.label }).focus();
          await page.keyboard.press("Enter");
          await page.waitForSelector("form[data-chat-overlay]");
          // Своё — фокус на «Подтвердить удаление»; модерация — в поле причины.
          if (deletion.reason) await page.keyboard.type(deletion.reason);
          await page.keyboard.press("Enter");
        } else {
          // Фокус на «Ответить» в строке, сообщение удаляет другой сотрудник.
          await row.locator("button", { hasText: "Ответить" }).focus();
          await page.evaluate((id) => { window.__harness.deleted.push(id); window.__harnessInvalidate(); }, deletion.id);
        }
        await tombstoned(page, deletion.id).catch(() => {});
        await page.waitForTimeout(250);
        const focus = await focusOf(deletion.id)(page);
        const metrics = await page.evaluate(pageMetrics);
        const file = `${prefix}-${deletion.journey}-${viewportKey}.png`;
        await page.screenshot({ path: join(outDir, file) });
        const harness = await finish(session, file);
        report({ journey: deletion.journey, file, focus, tombstones: metrics.tombstones, compact: metrics.compact, actions: harness.actions.filter((action) => !action.startsWith("seen:")) });
        if (deletion.label) check(harness.actions.includes(`${deletion.label === "Удалить" ? "delete" : "moderate"}:${deletion.id}`), `${file}: command ${JSON.stringify(harness.actions)}`);
        check(focus.tag === deletion.focus && focus.holds && focus.tombstone === "Сообщение удалено" && focus.inView, `${file}: focus after delete ${JSON.stringify(focus)}`);
        const expected = ["14", "15", "17", deletion.id.slice(-2)].sort();
        check(metrics.rows.length === CONVERSATION.length && JSON.stringify(metrics.tombstones) === JSON.stringify(expected), `${file}: ${metrics.rows.length} rows, tombstones ${JSON.stringify(metrics.tombstones)}`);
        check(metrics.compact.includes(deletion.id.slice(-2)) === deletion.compact && !metrics.collapsed, `${file}: compact ${JSON.stringify(metrics.compact)}, collapsed ${metrics.collapsed}`);
        common(file, metrics, viewportKey);
      }
    }

    // Набранный текст: «Отправить» — единственная сплошная красная кнопка.
    for (const viewportKey of ["1440", "1280", "390"]) {
      const session = await open(htmlFor.conversation, viewportKey);
      const { page } = session;
      await page.locator("form textarea").first().fill("Черновик для проверки вёрстки");
      await page.waitForSelector('button[aria-label="Отправить"]:not([disabled])');
      // Фон кнопок меняется с переходом 150 мс (v3.css) — дождаться его конца.
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(pageMetrics);
      const send = await page.evaluate(() => { const button = document.querySelector('main form button[type=submit]'); return button ? { label: button.getAttribute("aria-label"), bg: getComputedStyle(button).backgroundColor, disabled: button.disabled, hover: button.matches(":hover") } : null; });
      const file = `${prefix}-composer-${viewportKey}.png`;
      await page.screenshot({ path: join(outDir, file) });
      const harness = await finish(session, file);
      report({ journey: "composer", file, solidRed: metrics.solidRed, send });
      check(JSON.stringify(metrics.solidRed) === JSON.stringify(["Отправить"]), `${file}: solid red ${JSON.stringify(metrics.solidRed)}`);
      check(!harness.actions.includes("post"), `${file}: typing sent the message`);
      common(file, metrics, viewportKey);
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    process.stderr.write(`team chat checks failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
}

async function json() {
  const out = [];
  for (const name of Object.keys(SCENARIOS)) {
    const { scenario, element } = await buildPage(name);
    out.push({ name, html: renderToStaticMarkup(withContexts(element, PATHNAME, searchOf(scenario))) });
  }
  process.stdout.write(JSON.stringify(out));
}

if (process.argv.includes("--json")) {
  json().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error("usage: team-chat-static-render.cjs --json | --screenshots [outDir] [--prefix=e89]");
  process.exit(2);
}
