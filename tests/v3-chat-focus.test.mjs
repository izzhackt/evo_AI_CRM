// «ИИ-агенты → Поручить» на всю рабочую область и «На весь экран» (решение владельца 26.10.2026):
// чистые правила режима (запоминание, Esc, маршрут), исходники рамки и оболочки, а в настоящем Chromium —
// оболочка CRM с кнопкой, как на странице: серверная разметка гидратируется, меню прячется и возвращается.
//
//   node --conditions=react-server --experimental-strip-types --test tests/v3-chat-focus.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { isAiAgentChatRoute, isFillRoute } from "../src/lib/v3/board-layout.ts";
import {
  CHAT_FOCUS_STORAGE_KEY,
  chatFocusEscapeExits,
  hasOpenOverlay,
  isTextEntryTarget,
  readChatFocus,
  subscribeChatFocus,
  writeChatFocus,
} from "../src/lib/v3/chat-focus.ts";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");

/* ------------------------------------------------------------------ маршрут */

test("режим есть только у чата «Поручить»; высота окна у досок, WhatsApp и чата — как была", () => {
  assert.equal(isAiAgentChatRoute("/v3/ai-agents/director", "command"), true);
  assert.equal(isAiAgentChatRoute("/v3/ai-agents/curator-cn", "command"), true);
  for (const tab of [null, undefined, "runs", "overview", "drafts", "settings", "instructions", ""]) {
    assert.equal(isAiAgentChatRoute("/v3/ai-agents/director", tab), false, `вкладка ${tab}`);
  }
  for (const path of ["/v3/ai-agents", "/v3/ai-agents/director/x", "/v3/pipeline", "/v3/inbox", "/v3/tasks", null, undefined]) {
    assert.equal(isAiAgentChatRoute(path, "command"), false, String(path));
  }
  assert.equal(isFillRoute("/v3/ai-agents/director", "command"), true);
  assert.equal(isFillRoute("/v3/ai-agents/director", "runs"), false);
  assert.equal(isFillRoute("/v3/pipeline"), true);
  assert.equal(isFillRoute("/v3/admissions-pipeline"), true);
  assert.equal(isFillRoute("/v3/inbox"), true);
  assert.equal(isFillRoute("/v3/tasks", "command"), false);
});

/* -------------------------------------------------------------- запоминание */

function fakeWindow({ throwOn = [] } = {}) {
  const data = new Map();
  const listeners = new Set();
  const fail = (name) => { if (throwOn.includes(name)) throw new DOMException("denied", "SecurityError"); };
  const localStorage = {
    getItem: (key) => { fail("getItem"); return data.has(key) ? data.get(key) : null; },
    setItem: (key, value) => { fail("setItem"); data.set(key, String(value)); },
    removeItem: (key) => { fail("removeItem"); data.delete(key); },
  };
  return {
    data,
    listeners,
    window: {
      localStorage,
      addEventListener: (type, listener) => { if (type === "storage") listeners.add(listener); },
      removeEventListener: (type, listener) => { if (type === "storage") listeners.delete(listener); },
    },
  };
}

function withWindow(fake, run) {
  const previous = globalThis.window;
  globalThis.window = fake.window;
  try { return run(); } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}

test("выбор запоминается в хранилище браузера и снимается его удалением", () => {
  const fake = fakeWindow();
  withWindow(fake, () => {
    assert.equal(readChatFocus(), false, "по умолчанию меню на месте");
    writeChatFocus(true);
    assert.equal(fake.data.get(CHAT_FOCUS_STORAGE_KEY), "1");
    assert.equal(readChatFocus(), true);
    writeChatFocus(false);
    assert.equal(fake.data.has(CHAT_FOCUS_STORAGE_KEY), false, "выключенный режим не хранится");
    assert.equal(readChatFocus(), false);
  });
});

test("подписка слышит свои записи и чужую вкладку, и снимается", () => {
  const fake = fakeWindow();
  withWindow(fake, () => {
    let calls = 0;
    const unsubscribe = subscribeChatFocus(() => { calls += 1; });
    assert.equal(fake.listeners.size, 1);
    writeChatFocus(true);
    assert.equal(calls, 1);
    const [onStorage] = [...fake.listeners];
    onStorage({ key: CHAT_FOCUS_STORAGE_KEY });
    onStorage({ key: null });
    assert.equal(calls, 3, "запись из другой вкладки и «очистить всё» слышны");
    onStorage({ key: "другой-ключ" });
    assert.equal(calls, 3, "чужой ключ не будит оболочку");
    unsubscribe();
    assert.equal(fake.listeners.size, 0);
    writeChatFocus(false);
    assert.equal(calls, 3, "после отписки тишина");
  });
});

test("хранилище недоступно или не пишет: режим работает на время вкладки и ничего не бросает", () => {
  for (const throwOn of [["getItem", "setItem", "removeItem"], ["setItem"]]) {
    const fake = fakeWindow({ throwOn });
    withWindow(fake, () => {
      let calls = 0;
      subscribeChatFocus(() => { calls += 1; });
      assert.doesNotThrow(() => writeChatFocus(true), throwOn.join());
      assert.equal(readChatFocus(), true, `${throwOn.join()}: выбор держится до закрытия вкладки`);
      writeChatFocus(false);
      assert.equal(readChatFocus(), false);
      assert.equal(calls, 2);
    });
  }
  // Без window (сервер): «выключено», запись не падает.
  assert.equal(readChatFocus(), false);
  assert.doesNotThrow(() => writeChatFocus(false));
  // Рабочее хранилище снова главнее значения вкладки.
  const fake = fakeWindow();
  withWindow(fake, () => {
    writeChatFocus(true);
    assert.equal(readChatFocus(), true);
    writeChatFocus(false);
  });
});

/* ---------------------------------------------------------------------- Esc */

const el = (tagName, extra = {}) => ({ tagName, getAttribute: () => null, ...extra });
const doc = (selectors = {}) => ({ querySelector: (selector) => selectors[selector] ?? null });
const escape = (over = {}) => ({ key: "Escape", defaultPrevented: false, isComposing: false, target: el("BODY"), ...over });

test("Esc возвращает меню, только когда он ничей другой", () => {
  assert.equal(chatFocusEscapeExits(escape(), doc()), true);
  assert.equal(chatFocusEscapeExits(escape({ key: "Enter" }), doc()), false);
  assert.equal(chatFocusEscapeExits(escape({ defaultPrevented: true }), doc()), false, "уже обработан другим");
  assert.equal(chatFocusEscapeExits(escape({ isComposing: true }), doc()), false, "набор через IME");
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(chatFocusEscapeExits(escape({ [modifier]: true }), doc()), false, modifier);
  }
  // Поле ввода: Esc принадлежит ему.
  for (const target of [el("TEXTAREA"), el("INPUT", { type: "text" }), el("INPUT"), el("INPUT", { type: "search" }), el("SELECT"), el("DIV", { isContentEditable: true }), el("DIV", { getAttribute: (name) => (name === "role" ? "combobox" : null) })]) {
    assert.equal(chatFocusEscapeExits(escape({ target }), doc()), false, `${target.tagName} ${target.type ?? ""}`);
  }
  // Кнопка, флажок, ссылка — не поле ввода.
  for (const target of [el("BUTTON"), el("A"), el("INPUT", { type: "checkbox" }), el("INPUT", { type: "radio" }), el("DIV")]) {
    assert.equal(chatFocusEscapeExits(escape({ target }), doc()), true, `${target.tagName} ${target.type ?? ""}`);
  }
  // Открыт диалог, модальный лист или всплывающий слой: Esc закрывает его.
  assert.equal(chatFocusEscapeExits(escape(), doc({ "dialog[open], [aria-modal=\"true\"]": {} })), false);
  assert.equal(chatFocusEscapeExits(escape(), doc({ ":popover-open": {} })), false);
  assert.equal(isTextEntryTarget(null), false);
  assert.equal(isTextEntryTarget(undefined), false);
  assert.equal(isTextEntryTarget("поле"), false);
});

test("браузер без `:popover-open` не ломает Esc", () => {
  const old = { querySelector: (selector) => { if (selector === ":popover-open") throw new SyntaxError("bad selector"); return null; } };
  assert.equal(hasOpenOverlay(old), false);
  assert.equal(chatFocusEscapeExits(escape(), old), true);
});

/* ---------------------------------------------------------------- исходники */

test("исходники: меню только скрывается, кнопка — единственный выход, тот же адрес остаётся в оболочке", () => {
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /useChatFocusController\(isAiAgentChatRoute\(pathname, query\.get\("tab"\)\)\)/u);
  assert.match(shell, /chatFocus\.active \? "md:hidden" : "md:flex"/u, "меню остаётся в DOM: уведомления и опрос не пропадают");
  assert.match(shell, /<ChatFocusProvider value=\{chatFocus\.value\}>\{children\}<\/ChatFocusProvider>/u);
  assert.match(shell, /data-chat-focus=\{chatFocus\.active \? "" : undefined\}/u);
  assert.match(shell, /className="group\/shell flex min-h-dvh flex-col md:flex-row"/u);
  assert.doesNotMatch(shell, /requestFullscreen/u, "это не полноэкранный режим браузера (iPhone его не знает, Esc забирает браузер)");

  const focus = read("src/components/v3/ChatFocus.tsx");
  assert.match(focus, /on && chatRoute && buttons > 0/u, "меню прячется, только пока на экране кнопка");
  assert.match(focus, /useSyncExternalStore\(subscribeChatFocus, readChatFocus, \(\) => false\)/u, "сервер и первая отрисовка — «выключено»");
  assert.match(focus, /useLayoutEffect\(\(\) => attach\?\.\(\), \[attach\]\)/u);
  assert.doesNotMatch(focus, /aria-pressed=/u, "имя кнопки меняется с состоянием — состояние не дублируется aria-pressed («Свернуть, нажата» читается наоборот)");
  assert.match(focus, /"max-md:hidden"/u, "на телефоне кнопки нет");
  assert.match(focus, /\{on \? "Свернуть" : "На весь экран"\}/u);
  assert.match(focus, /data-testid="v3-aia-focus-toggle"/u);
  assert.doesNotMatch(focus, /requestFullscreen/u);

  const lib = read("src/lib/v3/chat-focus.ts");
  assert.match(lib, /try \{\s*return typeof window === "undefined" \? null : window\.localStorage;\s*\} catch/u, "доступ к хранилищу обёрнут в try/catch");
});

test("исходники: «Поручить» — рамка без потолка 1240 px и без второй шапки, остальные вкладки прежние", () => {
  const chat = read("src/components/v3/ai-agents/AgentChatShell.tsx");
  assert.doesNotMatch(chat, /max-w-\[1240px\]|mx-auto/u, "рабочая область на всю ширину колонки");
  assert.match(chat, /<h1 className="t-page-title/u, "один h1 страницы — название агента");
  assert.match(chat, /<ChatFocusToggle \/>/u);
  assert.match(chat, /aria-label="Все ИИ-агенты"/u, "стрелка к списку агентов называет себя");
  assert.match(chat, /group-data-\[chat-focus\]\/shell:px-3/u, "поля вокруг чата тоньше при «На весь экран»");
  assert.match(chat, /md:min-h-0 md:flex-1/u, "колонка оболочки высотой в окно отдаёт странице всю высоту");
  assert.doesNotMatch(chat, /order-last/u, "вкладки не прыгают вверх-вниз для клавиатуры: порядок Tab идёт по строкам шапки");
  assert.match(chat, /<h1[\s\S]*\{switches\}\s*<ChatFocusToggle \/>[\s\S]*\{tabs\}/u, "в разметке вкладки последние: название, переключатели, «На весь экран», вкладки");
  assert.match(chat, /@\[81rem\]:order-2[\s\S]*@\[81rem\]:order-1/u, "в широкой строке вкладки рисуются между названием и переключателями");

  const tabs = read("src/components/v3/queue/QueueViewTabs.tsx");
  assert.match(tabs, /data-tab-ring=\{bare \? "inset" : undefined\}/u);
  assert.match(read("src/app/(v3)/v3.css"), /\.v3-world \[data-tab-ring="inset"\] \.v3-choice:focus-visible \{\n {2}outline-offset: -2px;\n\}/u, "ряд вкладок в шапке ровно по высоте вкладки — рамка фокуса внутри, а не обрезана");

  const page = read("src/app/(v3)/v3/ai-agents/[key]/page.tsx");
  assert.match(page, /if \(tab === "command"\) \{\s*return \(\s*<AgentChatShell/u);
  assert.match(page, /<PartShell title=\{detail\.title\} testId="v3-ai-agent-page" back=\{back\}/u, "остальные вкладки — прежняя шапка страницы");
  assert.doesNotMatch(page, /fill=\{tab === "command"\}/u);

  const body = read("src/components/v3/ai-agents/AgentBody.tsx");
  assert.match(body, /\{chat \? null : <AgentTabs /u, "на «Поручить» вкладки стоят в шапке, второго ряда нет");
  assert.match(read("src/lib/v3/board-layout.ts"), /tab === "command"/u);
});

/* ----------------------------------------------------------- настоящий браузер */

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
    let prevented = false;
    if (props.onNavigate) props.onNavigate({ preventDefault() { prevented = true; } });
    if (!prevented) router.push(href);
  } });
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;
const NOTIFICATION_STUB = `
export async function loadStaffNotificationsAction() { return { ok: true, page: { unreadCount: "0", nextCursor: null, items: [] } }; }
export async function markStaffNotificationReadAction() { return { ok: true }; }
export async function markAllStaffNotificationsReadAction() { return { ok: true }; }`;
const APP = `
import { useMemo, useState } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { AppShell } from "@/components/v3/AppShell";
import { AgentChatShell } from "@/components/v3/ai-agents/AgentChatShell";
import { AgentTabs } from "@/components/v3/ai-agents/AgentTabs";

const ACTOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: "aaaaaaaa-1111-4111-8111-000000000001", organizationId: "eeeeeeee-4444-4444-8444-000000000000", platformAccessVersion: 1,
  email: "synthetic@example.invalid", assignments: [], permissionKeys: [], displayName: "Администратор (синтетический)", systemRole: "admin", presentationRole: null,
};
function Page({ search }) {
  const params = new URLSearchParams(search);
  const tab = params.get("tab") ?? "overview";
  // «broken» — страница чата без рамки, как экран «агент недоступен»: адрес чата, а кнопки нет.
  if (tab !== "command" || params.get("broken")) return <main data-testid="other-tab"><h1>Запуски</h1></main>;
  return (
    <AgentChatShell
      testId="v3-ai-agent-page" title="Директор / Аналитик" roleLine="Считает продажи и воронку"
      tabs={<AgentTabs bare agentKey="director" title="Директор / Аналитик" tab="command" draftsPending={0} />}
      switches={<span>Включён</span>}
    >
      <div data-aia-workspace="" className="flex min-h-0 flex-1"><textarea data-testid="field" /></div>
    </AgentChatShell>
  );
}
export function App({ initial }) {
  const [loc, setLoc] = useState(initial);
  const router = useMemo(() => ({
    push: (href) => { const url = new URL(href, "http://x"); setLoc({ pathname: url.pathname, search: url.search }); },
    replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
  }), []);
  if (typeof window !== "undefined") window.__go = (href) => router.push(href);
  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={loc.pathname}>
        <SearchParamsContext.Provider value={new URLSearchParams(loc.search)}>
          <ImageConfigContext.Provider value={{ ...imageConfigDefault, unoptimized: true }}>
            <div className="v3-world" data-surface="staff">
              <AppShell actor={ACTOR} initialNotifications={null}><Page search={loc.search} /></AppShell>
            </div>
          </ImageConfigContext.Provider>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}`;
const BROWSER_SSR = `import { renderToString } from "react-dom/server";
import { App } from "./app.tsx";
export const render = (initial) => renderToString(<App initial={initial} />);`;
const BROWSER_CLIENT = `import { hydrateRoot } from "react-dom/client";
import { App } from "./app.tsx";
hydrateRoot(document.getElementById("root"), <App initial={window.__INITIAL} />, { onRecoverableError: (error) => window.__errors.push(String(error)) });
document.documentElement.dataset.ready = "true";`;

let browserKitPromise;
const browserCleanups = [];
after(async () => { for (const cleanup of browserCleanups) await cleanup(); });
function browserKit() {
  browserKitPromise ??= (async () => {
    let chromium;
    try { ({ chromium } = createRequire(root("package.json"))("playwright")); } catch { return { skip: "playwright не установлен" }; }
    const dir = mkdtempSync(join(tmpdir(), "chat-focus-"));
    let browser;
    try {
      const resolveRoot = root("");
      const common = {
        bundle: true, jsx: "automatic", tsconfig: root("tsconfig.json"), absWorkingDir: resolveRoot, nodePaths: [root("node_modules")], logLevel: "silent",
        define: { "process.env.NODE_ENV": '"production"' },
        plugins: [{
          name: "chat-focus-browser",
          setup(b) {
            b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
            b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
            b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
            b.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: resolveRoot, loader: "js" }));
            b.onResolve({ filter: /\.png$/ }, () => ({ path: "logo", namespace: "png" }));
            b.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: 'module.exports = { src: "/logo.png", width: 1843, height: 842 };', loader: "js" }));
            b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
            // Серверные действия оболочки (выход, просмотр роли, уведомления) здесь не нужны: уведомления пусты, остальные отказывают.
            b.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
              const source = readFileSync(args.path, "utf8");
              if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
              if (args.path.endsWith("staff-notification-actions.ts")) return { contents: NOTIFICATION_STUB, loader: "ts" };
              const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
              return { contents: names.map((name) => `export async function ${name}() { throw new Error("server action ${name} is not available in this test"); }`).join("\n"), loader: "ts" };
            });
          },
        }],
      };
      writeFileSync(join(dir, "app.tsx"), APP);
      writeFileSync(join(dir, "ssr.tsx"), BROWSER_SSR);
      writeFileSync(join(dir, "client.tsx"), BROWSER_CLIENT);
      await build({ ...common, entryPoints: [join(dir, "ssr.tsx")], outfile: join(dir, "ssr.cjs"), platform: "node", format: "cjs" });
      // Next читает `process.env.__NEXT_*` в браузерной сборке: без объекта `process` клиент падает до гидратации.
      await build({ ...common, entryPoints: [join(dir, "client.tsx")], outfile: join(dir, "client.js"), platform: "browser", format: "iife", banner: { js: 'var process = globalThis.process || { env: { NODE_ENV: "production" } };' } });
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      return { skip: `Chromium не запустился: ${String(error?.message ?? error).split("\n")[0]}` };
    }
    const { render } = createRequire(import.meta.url)(join(dir, "ssr.cjs"));
    const clientJs = readFileSync(join(dir, "client.js"), "utf8");
    // Правила v3.css, на которые опирается раскладка: виден ли пункт, что скрыто на телефоне.
    const css = `.hidden{display:none}@media (width >= 48rem){.md\\:hidden{display:none}.md\\:flex{display:flex}}@media (width < 48rem){.max-md\\:hidden{display:none}}`;
    const html = new Map();
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://x");
      if (url.pathname === "/client.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(clientJs); return; }
      const initial = { pathname: url.pathname, search: url.search };
      const markup = render(initial);
      html.set(url.pathname + url.search, markup);
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>chat focus</title><style>${css}</style></head><body><div id="root">${markup}</div>
<script>window.__INITIAL=${JSON.stringify(initial)};window.__errors=[];</script><script src="/client.js"></script></body></html>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browserCleanups.push(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });
    return {
      html,
      async open(path, { stored = null, viewport = { width: 1280, height: 800 } } = {}) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        // Хранилище задаёт сотрудник заранее: страница видит его уже при первой отрисовке.
        if (stored !== null) await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [CHAT_FOCUS_STORAGE_KEY, stored]);
        const crashed = [];
        page.on("pageerror", (error) => crashed.push(String(error)));
        await page.goto(`${base}${path}`);
        await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 10_000 }).catch((error) => { throw new Error(`${error.message.split("\n")[0]}; ${crashed.join(" | ")}`); });
        return { page, context };
      },
    };
  })();
  return browserKitPromise;
}
const COMMAND = "/v3/ai-agents/director?tab=command";
const menuShown = (page) => page.evaluate(() => getComputedStyle(document.querySelector("[data-shell-menu]")).display !== "none");

test("браузер: серверная разметка с меню, кнопка прячет его и возвращает, выбор переживает перезагрузку", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const { page, context } = await kit.open(COMMAND);
  try {
    const server = kit.html.get(COMMAND);
    assert.match(server, /data-shell-menu/u);
    assert.match(server, /md:flex/u, "до выбора разметка сервера — с меню");
    assert.doesNotMatch(server, /md:hidden[^"]*"[^>]*data-shell-menu|data-chat-focus/u);
    assert.doesNotMatch(server, /aria-pressed/u, "кнопка без aria-pressed: состояние говорит её имя");
    assert.deepEqual(await page.evaluate(() => window.__errors), [], "гидратация без ошибок");
    const toggle = page.locator("[data-testid=v3-aia-focus-toggle]");
    assert.equal(await menuShown(page), true);
    assert.equal((await toggle.innerText()).trim(), "На весь экран");
    // Размер цели — классы кнопки очереди (`min-h-11` = 44 px); живой размер на настоящих стилях меряет снимок раскладки.
    assert.match(server, /<button[^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*data-testid="v3-aia-focus-toggle"|<button[^>]*data-testid="v3-aia-focus-toggle"[^>]*class="[^"]*\bmin-h-11\b/u);

    await toggle.click();
    assert.equal(await menuShown(page), false, "меню спрятано");
    assert.equal(await toggle.getAttribute("aria-pressed"), null);
    assert.equal((await toggle.innerText()).trim(), "Свернуть");
    assert.equal(await page.evaluate(() => document.querySelector("[data-testid=v3-shell]").hasAttribute("data-chat-focus")), true);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), CHAT_FOCUS_STORAGE_KEY), "1");

    // Esc в поле ввода не сворачивает; вне поля — сворачивает и забывает выбор.
    await page.click("[data-testid=field]");
    await page.keyboard.press("Escape");
    assert.equal(await menuShown(page), false, "Esc в поле принадлежит полю");
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Escape");
    assert.equal(await menuShown(page), true);
    assert.equal((await toggle.innerText()).trim(), "На весь экран");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), CHAT_FOCUS_STORAGE_KEY), null);

    // С клавиатуры: Enter и Пробел.
    await toggle.focus();
    await page.keyboard.press("Enter");
    assert.equal(await menuShown(page), false);
    await page.keyboard.press("Space");
    assert.equal(await menuShown(page), true);
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
  } finally { await context.close(); }
});

test("браузер: запомненный выбор применяется после гидратации; другие вкладки и страницы без кнопки возвращают меню", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const { page, context } = await kit.open(COMMAND, { stored: "1" });
  try {
    // Сервер ничего не знает о выборе: разметка с меню, и гидратация с ней согласна.
    assert.equal(await page.evaluate(() => window.__errors.length), 0, "серверная и первая клиентская отрисовка совпали");
    await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-shell-menu]")).display === "none");
    assert.equal((await page.locator("[data-testid=v3-aia-focus-toggle]").innerText()).trim(), "Свернуть");

    // «Запуски» — меню на месте, кнопки нет; выбор помнится и возвращается вместе с «Поручить».
    await page.evaluate(() => window.__go("/v3/ai-agents/director?tab=runs"));
    await page.waitForSelector("[data-testid=other-tab]");
    assert.equal(await menuShown(page), true, "вкладка «Запуски» — с меню");
    assert.equal(await page.locator("[data-testid=v3-aia-focus-toggle]").count(), 0);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), CHAT_FOCUS_STORAGE_KEY), "1", "выбор не потерян");
    await page.evaluate(() => window.__go("/v3/ai-agents/director?tab=command"));
    await page.waitForSelector("[data-testid=v3-aia-focus-toggle]");
    assert.equal(await menuShown(page), false, "вернулись в «Поручить» — снова на весь экран");

    // Адрес чата, но кнопки на экране нет (агент недоступен, не найден): выбор не оставляет сотрудника без меню.
    await page.evaluate(() => window.__go("/v3/ai-agents/director?tab=command&broken=1"));
    await page.waitForSelector("[data-testid=other-tab]");
    assert.equal(await menuShown(page), true, "без кнопки меню не прячется");
    await page.evaluate(() => window.__go("/v3/tasks"));
    await page.waitForSelector("[data-testid=other-tab]");
    assert.equal(await menuShown(page), true);
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
  } finally { await context.close(); }
});

test("браузер: на телефоне кнопки нет и оболочка прежняя", async (t) => {
  const kit = await browserKit();
  if (kit.skip) return t.skip(kit.skip);
  const { page, context } = await kit.open(COMMAND, { stored: "1", viewport: { width: 390, height: 844 } });
  try {
    assert.equal(await page.locator("[data-testid=v3-aia-focus-toggle]").isVisible(), false, "кнопка скрыта на телефоне");
    assert.equal(await page.locator("[data-testid=v3-shell-tabbar]").isVisible(), true, "нижняя панель вкладок на месте");
    assert.equal(await menuShown(page), false, "меню телефона — лист «Ещё», закрыт, как и без режима");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  } finally { await context.close(); }
});
