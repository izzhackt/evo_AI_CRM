"use strict";

/**
 * Браузерная точка входа стенда `tools-next-static-render.cjs`: настоящие компоненты «Нового вида» («Календарь», «Документы»,
 * «Шаблоны ответов», «База знаний», «Командный чат») внутри настоящей оболочки на синтетике из `tools-next-fixtures.cjs`.
 * Адрес стенда — состояние: `router.push` меняет его с задержкой (так отвечает сервер), и страница пересчитывает свойства
 * так, как это делает `page.tsx` (вид и день календаря, открытая задача, раздел базы знаний). Серверные действия подменены
 * (`window.__harness.calls` пишет вызов и поля формы), `/api/v3/knowledge/*` отвечает заглушка `fetch`.
 */
const CLIENT_ENTRY = String.raw`
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { AppShell } = require("@/components/v3/AppShell");
const { CalendarNextPage } = require("@/components/v3/calendar/next/CalendarNextPage");
const { gridDays, resolveDay, resolveView } = require("@/components/v3/calendar/types");
const { SnippetsNext } = require("@/components/v3/reply-snippets/next/SnippetsNext");
const { FilesNext } = require("@/components/v3/knowledge/next/FilesNext");
const { KnowledgeNextPage } = require("@/components/v3/knowledge/next/KnowledgeNextPage");
const { TeamChatNextPage, TeamChatNextFailure } = require("@/components/v3/team-chat/next/TeamChatNextPage");
// Прежний вид на тех же данных — для снимков «до» (fx.legacy): те же свойства, прежние части.
const { PartShell } = require("@/components/v3/PartShell");
const { Calendar } = require("@/components/v3/calendar/Calendar");
const { KnowledgeLibrary } = require("@/components/v3/knowledge/KnowledgeLibrary");
const { KnowledgeReplySnippetSection } = require("@/components/v3/reply-snippets/KnowledgeReplySnippetSection");
const { FileManager } = require("@/components/v3/FileManager");
const { TeamChat } = require("@/components/v3/team-chat/TeamChat");
const h = React.createElement;
const fx = JSON.parse(document.getElementById("fixture").textContent);
window.__harness = { pushes: [], calls: [], history: [fx.search], requests: [], errors: [], actions: [], deleted: [] };

/* ---- сервер календаря: те же вычисления, что у calendar/page.tsx ---- */
function serveCalendar(search) {
  const params = new URLSearchParams(search);
  const view = resolveView(params.get("view") ?? undefined);
  const target = params.get("task") ? fx.calendar.tasks.find((task) => task.id === params.get("task")) ?? null : null;
  const unavailable = params.get("task") && !target ? { key: (params.get("kind") ?? "case") + ":" + params.get("task"), returnHref: "/v3/calendar?view=" + view + "&date=" + fx.today } : null;
  const day = params.get("date") ? resolveDay(params.get("date"), fx.today) : target?.day ?? fx.today;
  const requestIds = Object.fromEntries(fx.calendar.tasks.map((task, index) => [task.key, { change: "e0000000-1111-4111-8111-00000000" + String(index).padStart(4, "0"), complete: "e1000000-1111-4111-8111-00000000" + String(index).padStart(4, "0"), cancel: "e2000000-1111-4111-8111-00000000" + String(index).padStart(4, "0") }]));
  const tasks = fx.calendar.tasks;
  return {
    initialTaskKey: target?.key ?? null, unavailableTarget: unavailable,
    taskCapabilities: target?.kind === "case" ? { taskId: target.id, studentCaseId: target.studentCaseId, canAssign: true, canChangeVisibility: true, canReadCase: true } : null,
    view, day, today: fx.today, nowMinutes: 600, days: gridDays(view, day), tasks, readAccess: fx.calendar.readAccess,
    undatedContinuationPage: false, undatedNextHref: null, undatedCursor: null, cases: fx.calendar.cases, casesHaveMore: false,
    assignees: fx.participants.map((p) => ({ membershipId: p.membershipId, displayName: p.displayName })),
    actorMembershipId: fx.me, actor: fx.actor, taskRequestIds: requestIds, basePath: "/v3/calendar",
  };
}

/* ---- заглушка /api/v3/knowledge ---- */
const K = fx.knowledge;
const byTitle = (a, b) => a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id);
function kpage(list, params) {
  const limit = Number(params.get("limit") || 100);
  const afterId = params.get("afterId");
  const start = afterId ? list.findIndex((item) => item.id === afterId) + 1 : 0;
  const slice = list.slice(start, start + limit);
  const hasMore = start + limit < list.length;
  const last = slice[slice.length - 1];
  return { items: slice, hasMore, nextCursor: hasMore && last ? { title: last.title, id: last.id } : null };
}
function respond(path, params) {
  const [route, itemId, option] = path.split("/");
  const all = [...K.folders, ...K.items];
  if (route === "list") {
    const mode = params.get("mode");
    if (mode === "folders") return kpage([...K.folders].sort(byTitle), params);
    const area = params.get("area");
    if (mode === "search") {
      const search = (params.get("search") || "").toLowerCase();
      return kpage(all.filter((item) => item.area !== "secrets" && (!area || item.area === area) && item.title.toLowerCase().includes(search)).sort(byTitle), params);
    }
    if (mode === "inbox") return kpage(K.items.filter((item) => item.area === area && item.parent_id === null).sort(byTitle), params);
    if (mode === "review") return kpage(K.items.filter((item) => item.area === area && item.review_question).sort(byTitle), params);
    if (mode === "trash" || mode === "archive") return kpage([], params);
    const parent = params.get("parentId");
    return kpage(all.filter((item) => item.area === area && item.parent_id === (parent || null)).sort((a, b) => (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || byTitle(a, b)), params);
  }
  if (route === "item" && !option) { const item = all.find((candidate) => candidate.id === itemId); return item ? { ...item, body: item.body ?? "" } : null; }
  if (route === "exports") return [];
  if (route === "clients" && !itemId) return { items: [], hasMore: false, nextCursor: null };
  if (route === "search-canonical") return { items: [], hasMore: false, nextCursor: null };
  return null;
}
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, "http://kb.invalid");
  if (!url.pathname.startsWith("/api/v3/knowledge/")) return realFetch(input, init);
  const path = url.pathname.slice("/api/v3/knowledge/".length);
  window.__harness.requests.push(path + url.search);
  if (fx.hang && path.startsWith("list") && url.searchParams.get("mode") !== "folders") return new Promise(() => {});
  if (path === "command" && init && init.method === "POST") {
    const body = JSON.parse(init.body);
    window.__harness.calls.push(["knowledge-command", body.command]);
    const target = all0().find((item) => item.id === body.command.id);
    return new Response(JSON.stringify(target ? { ...target, version: target.version + 1, deleted_at: body.command.op === "trash" ? "2026-09-24T04:00:00.000Z" : null } : { ...body.command, id: "cccccccc-2222-4222-8222-000000009999", version: 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const body = respond(path, url.searchParams);
  return new Response(JSON.stringify(body ?? { error: "knowledge_not_found" }), { status: body ? 200 : 404, headers: { "Content-Type": "application/json" } });
};
function all0() { return [...K.folders, ...K.items]; }

/* ---- приложение ---- */
function legacyBody(search) {
  const library = (section, children) => h(PartShell, { title: "База знаний" }, h(KnowledgeLibrary, { commandScope: fx.org + ":" + fx.me, section }, children));
  if (fx.screen === "calendar") return h(PartShell, { title: "Календарь" }, h(Calendar, serveCalendar(search)));
  if (fx.screen === "snippets") return library("snippets", h(KnowledgeReplySnippetSection, fx.snippets));
  if (fx.screen === "documents") return library("documents", h(FileManager, { embedded: true, allowKnowledgeExport: true, rootLabel: "Документы", ...fx.files }));
  if (fx.screen === "knowledge") return library(null, null);
  if (fx.screen === "chat") return h("main", { className: "flex h-[calc(100dvh-150px)] min-h-0 flex-col md:h-[calc(100dvh-64px)]", "aria-label": "Командный чат" }, h(TeamChat, fx.chat));
  throw new Error("unknown legacy screen " + fx.screen);
}
function body(search) {
  if (fx.legacy) return legacyBody(search);
  if (fx.screen === "calendar") return h(CalendarNextPage, serveCalendar(search));
  if (fx.screen === "chat") return fx.failure ? h(TeamChatNextFailure, fx.failure) : h(TeamChatNextPage, fx.chat);
  if (fx.screen === "snippets") return h(KnowledgeNextPage, { commandScope: "x", section: "snippets" }, h(SnippetsNext, fx.snippets));
  if (fx.screen === "documents") return h(KnowledgeNextPage, { commandScope: "x", section: "documents" }, h(FilesNext, fx.files));
  if (fx.screen === "knowledge") return h(KnowledgeNextPage, { commandScope: fx.org + ":" + fx.me, section: null });
  throw new Error("unknown screen " + fx.screen);
}

function App() {
  const [search, setSearch] = React.useState(fx.search);
  const router = React.useMemo(() => ({
    push(href) {
      window.__harness.pushes.push(href);
      setTimeout(() => { const next = new URL(href, "https://crm.invalid").search.slice(1); window.__harness.history.push(next); setSearch(next); }, 60);
    },
    replace(href) { window.__harness.pushes.push(href); },
    back() { const { history } = window.__harness; if (history.length > 1) { history.pop(); setSearch(history[history.length - 1]); } },
    refresh() { window.__harness.calls.push("refresh"); }, forward() {}, prefetch() {}, hmrRefresh() {},
  }), []);
  return h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: fx.pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
          h("div", fx.legacy ? { className: "v3-world", "data-surface": "staff" } : { className: "v3-world", "data-surface": "staff", "data-ui": "next" },
            h(AppShell, { actor: fx.actor, initialNotifications: null, nextUi: { enabled: !fx.legacy } }, body(search)))))));
}
createRoot(document.getElementById("root")).render(h(App));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

module.exports = { CLIENT_ENTRY };
