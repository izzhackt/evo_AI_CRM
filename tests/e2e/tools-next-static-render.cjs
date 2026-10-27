"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид», поток «tools» (решение владельца 27.10.2026): «Календарь», «Документы», «Шаблоны ответов», «База знаний»
 * и «Командный чат» — клиентская сборка НАСТОЯЩИХ компонентов нового вида в настоящей оболочке (`AppShell`) на СИНТЕТИЧЕСКИХ
 * данных (`tools-next-fixtures.cjs`): имена, задачи, файлы, материалы и сообщения выдуманы и не являются записями EVO.
 * Серверные действия подменены (вызов и поля формы пишутся в `window.__harness.calls`), `/api/v3/knowledge/*` отвечает заглушка
 * `fetch`, чтения чата отвечают синтетикой. Supabase, права и данные этот стенд не проверяет — проверяются вёрстка, токены,
 * адаптив, клавиатура, доступность и путь «строка → панель → действие».
 *
 *   node tests/e2e/tools-next-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 и проверки (JSON-строки; при нарушении код 1).
 *       По умолчанию outDir — .impeccable/review (не коммитится). `--only a,b` — только эти страницы.
 */

const { readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { lazySettled } = require("./lazy-settled.cjs");
const { CLIENT_ENTRY } = require("./tools-next-entry.cjs");
const fx = require("./tools-next-fixtures.cjs");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;
const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};

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
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;

// Читающие действия чата отвечают синтетикой этой вкладки; запись честно недоступна (в EVO ничего не пишется).
const CHAT_STUBS = {
  "platform-team-chat-actions.ts": `
export async function readTeamChatAction(query) {
  window.__harness.actions.push("read:" + query.mode);
  const data = JSON.parse(document.getElementById("fixture").textContent).chat.initial;
  if (query.mode === "search") return { status: "ready", snapshot: { page: { messages: [], cursor: "0", watermark: "40", hasMore: false, latestMessageId: null, rootId: null }, channels: data.channels, participants: data.participants } };
  return { status: "ready", snapshot: { page: { messages: [], cursor: "40", watermark: "40", hasMore: false, latestMessageId: data.page.latestMessageId, rootId: null }, channels: data.channels, participants: data.participants } };
}
export async function teamChatCommandAction(_previous, form) { window.__harness.actions.push("command"); return { status: "unavailable", requestId: form.get("request_id"), messageId: null }; }`,
  "platform-team-chat-v2-actions.ts": `
export async function readTeamChatTimelineV2Action(input) {
  window.__harness.actions.push("timeline:" + input.mode);
  const data = JSON.parse(document.getElementById("fixture").textContent).chat.initial;
  return { status: "loaded", page: { ...data.page, focusMessageId: null } };
}
export async function postTeamChatV2Action() { window.__harness.actions.push("post"); return { status: "unavailable" }; }`,
  "platform-team-chat-seen-actions.ts": `
export async function markTeamChatSeenAction(batch) { window.__harness.actions.push("seen:" + batch.messageIds.length); return { status: "saved", receipt: { channelKey: batch.channel, messageIds: batch.messageIds } }; }`,
};
const SUPABASE_SHIM = `
export function createBrowserClient() {
  const subscription = { on() { return subscription; }, subscribe(callback) { setTimeout(() => callback("SUBSCRIBED"), 0); return subscription; } };
  return {
    auth: { async getSession() { return { data: { session: { access_token: "synthetic-harness-session" } }, error: null }; } },
    realtime: { async setAuth() {} }, channel() { return subscription; }, async removeChannel() {},
  };
}`;

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
    readFileSync(join(ROOT, "src/components/v3/team-chat/team-chat.module.css"), "utf8"),
    readFileSync(join(ROOT, "src/components/v3/knowledge/KnowledgeLibrary.module.css"), "utf8"),
  ].join("\n");
}

async function buildBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "tools-next-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /^@supabase\/ssr$/ }, () => ({ path: "supabase-ssr", namespace: "supabase" }));
      build.onLoad({ filter: /.*/, namespace: "supabase" }, () => ({ contents: SUPABASE_SHIM, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        if (args.path.endsWith("ui-next-actions.ts")) return { contents: "export async function setNextUiAction() {}", loader: "ts" };
        const chat = Object.entries(CHAT_STUBS).find(([file]) => args.path.endsWith(`/${file}`));
        if (chat) return { contents: chat[1], loader: "ts", resolveDir: ROOT };
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        // Остальные действия «сохраняют»: вызов и поля формы записаны, состояние возвращается как у настоящего (status: saved).
        return {
          contents: names.map((name) => `export async function ${name}(state, form) {
  const fields = form && typeof form.entries === "function" ? Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : "[file]"])) : null;
  window.__harness.calls.push([${JSON.stringify(name)}, fields]);
  if (/^(search|read|load)/u.test(${JSON.stringify(name)})) return { status: "ready", rows: [], participants: [], assignees: [], nextCursor: null };
  return { ...(state || {}), status: "saved", requestId: (fields && fields.request_id) || "static" };
}`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "tools-next-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

/* --------------------------------------------------------------- сценарии страниц */

const knowledge = fx.knowledgeFixture();
const A = knowledge.aliases;
const base = (screen, pathname, search, extra = {}) => ({
  screen, pathname, search, org: fx.ORG, me: fx.ME, actor: fx.ADMIN, today: fx.TODAY, participants: fx.PARTICIPANTS, ...extra,
});
const calendar = (tasks, extra = {}) => ({ tasks, readAccess: { caseTasks: true, staffTasks: true, tasks: true }, cases: fx.CASE_OPTIONS, ...extra });
const files = (extra = {}) => ({
  folders: fx.FOLDERS, files: fx.FILES, canManage: true, canUpload: true, createFolderRequestId: fx.id("66666666", 1), createFileRequestId: fx.id("66666666", 2), ...extra,
});
const snippets = (extra = {}) => ({ items: fx.SNIPPETS, canManage: true, availableAudiences: ["sales", "admissions", "all"], createRequestId: fx.id("66666666", 3), ...extra });
const chat = (extra = {}) => ({
  initial: { page: fx.CHAT.page, channels: fx.CHAT.channels, participants: fx.CHAT.participants }, channel: "general", organizationId: fx.ORG, membershipId: fx.ME,
  realtimeConfig: { url: "http://127.0.0.1:9", publishableKey: "synthetic-harness-key" }, canModerate: true, initialMessageId: null, showChannelsInitially: false, ...extra,
});
const knowledgeData = { folders: knowledge.folders, items: knowledge.items };
const kb = (search, extra = {}) => base("knowledge", "/v3/knowledge", search.replace(/@([a-z0-9]+)/gu, (_, key) => A[key] ?? knowledge.editor), { knowledge: knowledgeData, ...extra });

const PAGES = {
  "calendar-week": base("calendar", "/v3/calendar", "view=week&date=2026-09-26", { calendar: calendar(fx.WEEK) }),
  "calendar-month": base("calendar", "/v3/calendar", "view=month&date=2026-09-26", { calendar: calendar([...fx.WEEK, ...fx.MONTH_EXTRA]) }),
  "calendar-day": base("calendar", "/v3/calendar", "view=day&date=2026-09-24", { calendar: calendar(fx.WEEK) }),
  "calendar-empty": base("calendar", "/v3/calendar", "view=week&date=2026-09-26", { calendar: calendar([]) }),
  "calendar-denied": base("calendar", "/v3/calendar", "view=week&date=2026-09-26", { calendar: calendar([], { readAccess: { caseTasks: false, staffTasks: false, tasks: false } }) }),
  "calendar-panel": base("calendar", "/v3/calendar", `view=week&date=2026-09-24&case=${fx.id("dddddddd", 41)}&task=${fx.id("cccccccc", 41)}`, { calendar: calendar(fx.WEEK) }),
  "snippets": base("snippets", "/v3/knowledge", "section=snippets", { snippets: snippets() }),
  "snippets-readonly": base("snippets", "/v3/knowledge", "section=snippets", { snippets: snippets({ canManage: false }) }),
  "snippets-empty": base("snippets", "/v3/knowledge", "section=snippets", { snippets: snippets({ items: [] }) }),
  "documents": base("documents", "/v3/knowledge", "section=documents", { files: files() }),
  "documents-folder": base("documents", "/v3/knowledge", `section=documents&documentFolder=${fx.id("60000000", 1)}`, { files: files() }),
  "documents-readonly": base("documents", "/v3/knowledge", "section=documents", { files: files({ canManage: false, canUpload: false }) }),
  "knowledge-folder": kb("area=internal&folder=@bjdocs"),
  "knowledge-root": kb("area=internal"),
  "knowledge-clients": kb("area=clients"),
  "knowledge-item": kb("area=internal&folder=@bjdocs&item=@editor"),
  "knowledge-loading": kb("area=internal", { hang: true }),
  "chat": base("chat", "/v3/team-chat", "channel=general", { chat: chat() }),
  "chat-channels": base("chat", "/v3/team-chat", "", { chat: chat({ showChannelsInitially: true }) }),
  "chat-failure": base("chat", "/v3/team-chat", "channel=general", { chat: chat(), failure: { text: "Не удалось загрузить канал. Проверьте связь и повторите.", retryHref: "/v3/team-chat?channel=general" } }),
};

// Прежний вид на тех же данных: снимки «до» (только снимки, проверок нового вида у них нет).
const legacyOf = (name) => ({ ...PAGES[name], legacy: true, knowledge: knowledgeData });
PAGES["legacy-calendar-week"] = legacyOf("calendar-week");
PAGES["legacy-calendar-panel"] = legacyOf("calendar-panel");
PAGES["legacy-snippets"] = legacyOf("snippets");
PAGES["legacy-documents-folder"] = legacyOf("documents-folder");
PAGES["legacy-knowledge-folder"] = legacyOf("knowledge-folder");
PAGES["legacy-chat"] = legacyOf("chat");
PAGES["legacy-chat-channels"] = legacyOf("chat-channels");

function writePage(outDir, name, css, data) {
  const path = join(outDir, `${name}.html`);
  writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Инструменты, новый вид (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script type="application/json" id="fixture">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="tools-next-bundle.js"></script></body></html>`);
  return path;
}

module.exports = { PAGES, VIEWPORTS, buildBundle, compileCss, writePage, ROOT, lazySettled };

if (require.main === module) {
  require("./tools-next-checks.cjs").main().catch((error) => { console.error(error); process.exit(1); });
}
