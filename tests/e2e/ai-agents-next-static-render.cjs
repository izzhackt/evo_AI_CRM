"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид»: раздел «ИИ-агенты» (хаб и вкладки страницы агента) — клиентская сборка настоящих компонентов на
 * СИНТЕТИЧЕСКИХ данных (tests/e2e/ai-agents-next-fixtures.cjs; имена, заявки и сообщения выдуманы). Серверные действия
 * подменены записью вызова в `window.__harness.calls`, Supabase, Claude и маршрутизатор Next.js не проверяются:
 * проверяются вёрстка, токены нового вида, адаптив, клавиатура, доступность и то, что кнопки зовут те же действия.
 *
 *   node tests/e2e/ai-agents-next-static-render.cjs --screenshots [outDir] [--before]
 *     → снимки Playwright Chromium 1440×900, 1280×800, 390×844 (хаб; «Чат», «Обзор», «История работы», запуск,
 *       «На одобрение», «Правила агента», «Настройки»; панели запуска и черновика) и проверки (JSON-строки, при нарушении
 *       код 1): нет ошибок консоли, нет горизонтальной прокрутки, нажимаемые ≥ 44 px, axe без нарушений, панели рисуются
 *       внутри корня нового вида, Esc закрывает, фокус возвращается на строку; «Одобрить», «Авто», «Сохранить» зовут
 *       прежние серверные действия с прежними полями. По умолчанию outDir — .impeccable/review (не коммитится).
 *     --before — только снимки прежнего вида на тех же данных (before-<экран>-<ширина>.png), без проверок.
 */

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
const LOGO_URL = pathToFileURL(join(ROOT, "public/brand/evo-logo.png")).href;
const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 } },
  d1280: { viewport: { width: 1280, height: 800 } },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
const SCENES = [
  { name: "hub", path: "/v3/ai-agents", search: "" },
  { name: "chat", path: "/v3/ai-agents/director", search: "" },
  { name: "overview", path: "/v3/ai-agents/director", search: "tab=overview" },
  { name: "runs", path: "/v3/ai-agents/director", search: "tab=runs" },
  { name: "runs-more", path: "/v3/ai-agents/director", search: "tab=runs" },
  { name: "run", path: "/v3/ai-agents/director", search: "tab=runs&run=11111111-1111-4111-8111-000000000001" },
  { name: "drafts", path: "/v3/ai-agents/director", search: "tab=drafts" },
  { name: "drafts-all", path: "/v3/ai-agents/director", search: "tab=drafts&show=all" },
  { name: "instructions", path: "/v3/ai-agents/director", search: "tab=instructions" },
  { name: "settings", path: "/v3/ai-agents/director", search: "tab=settings" },
];

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
    if (event.defaultPrevented) return;
    event.preventDefault();
    router.push(href);
  } });
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;

/** Подмена серверных действий раздела: записывают вызов и отвечают так, как отвечает сервер. */
const ACTIONS_STUB = `
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rec = (name, form) => window.__harness.calls.push({ name, fields: form instanceof FormData ? Object.fromEntries(form) : form });
const saved = (form, message = null, extra = {}) => ({ status: "saved", code: null, message, requestId: form.get("request_id"), ...extra });
const EVENTS = [
  { id: "e1", at: "2026-10-27T10:20:00.000Z", kind: "user", text: "Подготовь недельный отчёт за прошлую неделю" },
  { id: "e2", at: "2026-10-27T10:20:02.000Z", kind: "tool_call", tool: "sales_report", label: "Отчёт продаж", argsSummary: "period=week", builtin: false },
  { id: "e3", at: "2026-10-27T10:20:04.000Z", kind: "tool_result", tool: "sales_report", ok: true, preview: "заявок 48" },
  { id: "e4", at: "2026-10-27T10:20:09.000Z", kind: "agent", text: "Готово: **48 заявок**, из них оплатили 6.\\n\\n- Китай: 21\\n- Малайзия: 14" },
  { id: "e5", at: "2026-10-27T10:20:10.000Z", kind: "status", status: "idle", stopReason: "end_turn" },
];
export async function updateAiAgentAction(_p, form) { rec("update", form); await wait(120); return saved(form, "Сохранено."); }
export async function saveAiAgentInstructionsAction(_p, form) { rec("saveInstructions", form); await wait(120); return saved(form, "Правила сохранены."); }
export async function syncAiAgentAction(_p, form) { rec("sync", form); await wait(120); return saved(form, "Агент синхронизирован с Claude."); }
export async function startAiAgentRunAction(_p, form) { rec("start", form); await wait(120); return saved(form, null, { runId: "11111111-1111-4111-8111-000000000099" }); }
export async function followUpAiAgentRunAction(_p, form) { rec("followUp", form); await wait(120); return saved(form, null, { runId: form.get("run_id") }); }
export async function pollAiAgentRunAction(runId, cursor) {
  rec("poll", { runId, cursor });
  await wait(60);
  return { ok: true, poll: { run: { id: runId, status: "completed", sendAuthority: false }, events: cursor ? [] : EVENTS, cursor: "c1", done: true, pollAfterMs: 0 } };
}
export async function interruptAiAgentRunAction(runId) { rec("interrupt", { runId }); return { ok: true }; }
export async function loadAiAgentRunTranscriptAction(runId) { rec("transcript", { runId }); await wait(80); return { ok: true, events: EVENTS, truncated: false }; }
export async function decideAiAgentDraftAction(_p, form) {
  rec("decide", form); await wait(150);
  if (form.get("decision") === "discard") return saved(form, "Черновик отклонён.", { draftStatus: "discarded", failureCode: null });
  return saved(form, "Отправлено клиенту.", { draftStatus: "sent", failureCode: null });
}
`;

const CLIENT_ENTRY = `
import React from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { AppShell } from "@/components/v3/AppShell";
import { NextAgentsView } from "@/components/v3/ai-agents-next/NextAgentsView";
import { NextAgentPage } from "@/components/v3/ai-agents-next/NextAgentPage";
import { AgentsHub } from "@/components/v3/ai-agents/AgentsHub";
import { AgentBody } from "@/components/v3/ai-agents/AgentBody";
import { AgentChatShell } from "@/components/v3/ai-agents/AgentChatShell";
import { AgentSwitches } from "@/components/v3/ai-agents/AgentSwitches";
import { AgentTabs } from "@/components/v3/ai-agents/AgentTabs";
import { PartShell } from "@/components/v3/PartShell";
import { AI_AGENTS_HUB_HREF, aiAgentRoleLine } from "@/lib/v3/ai-agents-view";
import { AI_AGENT_CATALOG } from "@/lib/ai-agents/contract";
const { makeFixtures } = require(${JSON.stringify(join(ROOT, "tests/e2e/ai-agents-next-fixtures.cjs"))});
const h = React.createElement;
const F = makeFixtures(AI_AGENT_CATALOG);
const fixture = JSON.parse(document.getElementById("fixture").textContent);
window.__harness = { pushes: [], calls: [] };
const router = { push: (href) => window.__harness.pushes.push(href), replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
const params = new URLSearchParams(fixture.search);
const tab = params.get("tab") ?? "command";
const runId = params.get("run");
// Данные сцены: запуск целиком; «последние 30 и есть ещё»; вкладка «Все» черновиков (по умолчанию — только ждущие, как отдаёт сервер).
const over = runId ? { runId, run: F.available(F.RUN_DETAIL), runs: null } : fixture.name === "runs-more" ? { runs: F.available({ runs: F.RUNS_MANY, hasMore: true }) } : params.get("show") === "all" ? { draftsFilter: "all" } : {};
let page;
if (fixture.legacy) {
  // Прежний вид (снимки «до»): те же страницы, что собирают ai-agents/page.tsx и [key]/page.tsx без переключателя.
  if (fixture.name === "hub") page = h(PartShell, { title: "ИИ-агенты", testId: "v3-ai-agents" }, h("div", { className: "space-y-5" }, h(AgentsHub, { list: F.LIST, runtimeConfigured: true, preview: false })));
  else {
    const props = F.bodyProps(tab, over);
    const d = props.detail;
    const switches = h(AgentSwitches, { agentKey: d.key, enabled: d.enabled, autoSend: d.autoSend, configVersion: d.configVersion, hasInstructions: true, canEdit: true });
    const content = h(AgentBody, props);
    page = tab === "command"
      ? h(AgentChatShell, { testId: "v3-ai-agent-page", title: d.title, roleLine: aiAgentRoleLine(d.roleLine), tabs: h(AgentTabs, { bare: true, agentKey: d.key, title: d.title, tab, draftsPending: d.stats.draftsPending }), switches }, content)
      : h(PartShell, { title: d.title, testId: "v3-ai-agent-page", back: h("a", { href: AI_AGENTS_HUB_HREF, className: "mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-nav t-label text-fg-2" }, "Все ИИ-агенты"), meta: aiAgentRoleLine(d.roleLine), action: switches }, content);
  }
} else if (fixture.name === "hub") page = h(NextAgentsView, { read: F.available(F.LIST), runtimeConfigured: true, preview: false });
else page = h(NextAgentPage, F.bodyProps(tab, over));
createRoot(document.getElementById("root")).render(
  h(AppRouterContext.Provider, { value: router },
    h(PathnameContext.Provider, { value: fixture.path },
      h(SearchParamsContext.Provider, { value: params },
        h(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } },
          h("div", { className: "v3-world", "data-surface": "staff", "data-ui": fixture.legacy ? undefined : "next" },
            h(AppShell, { actor: F.ACTOR, initialNotifications: null, nextUi: fixture.legacy ? null : { enabled: true } }, page)))))));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  const own = ["src/app/(v3)/v3.css", "src/app/(v3)/ai-agents.css", "src/app/(v3)/ai-agent.css"].map((file) => readFileSync(join(ROOT, file), "utf8"));
  return [...fonts, result.css, ...own].join("\n");
}

async function buildBundle(outFile) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "ai-agents-next-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /^@\/lib\/platform-ai-agents-actions$/ }, () => ({ path: "ai-actions", namespace: "ai-actions" }));
      build.onLoad({ filter: /.*/, namespace: "ai-actions" }, () => ({ contents: ACTIONS_STUB, resolveDir: ROOT, loader: "js" }));
      build.onResolve({ filter: /\.png$/ }, (args) => ({ path: resolve(args.resolveDir, args.path), namespace: "png" }));
      build.onLoad({ filter: /.*/, namespace: "png" }, () => ({ contents: `module.exports = { src: ${JSON.stringify(LOGO_URL)}, width: 1843, height: 842 };`, loader: "js" }));
      build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      // Остальные серверные действия (уведомления, переключатель) честно отказывают: раздел их не зовёт.
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return { contents: names.map((name) => `export async function ${name}() { throw new Error("harness: server action ${name} is not available"); }`).join("\n"), loader: "ts" };
      });
    },
  };
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "ai-agents-next-entry.tsx", loader: "tsx" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, plugins: [plugin], logLevel: "error",
  });
}

function writePage(outDir, scene, css) {
  const path = join(outDir, `${scene.legacy ? "before" : "agents"}-${scene.name}.html`);
  writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>ИИ-агенты (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script type="application/json" id="fixture">${JSON.stringify(scene)}</script><script src="ai-agents-next-bundle.js"></script></body></html>`);
  return path;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--screenshots")) throw new Error("usage: node tests/e2e/ai-agents-next-static-render.cjs --screenshots [outDir]");
  const outDir = resolve(args[args.indexOf("--screenshots") + 1] && !args[args.indexOf("--screenshots") + 1].startsWith("--") ? args[args.indexOf("--screenshots") + 1] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  await buildBundle(join(outDir, "ai-agents-next-bundle.js"));
  const css = await compileCss();
  const pages = Object.fromEntries(SCENES.map((scene) => [scene.name, writePage(outDir, scene, css)]));
  if (args.includes("--before")) {
    // Снимки прежнего вида на тех же данных (без проверок): `before-<экран>-<ширина>.png` рядом с снимками нового.
    const { chromium: engine } = require("playwright");
    const before = await engine.launch();
    for (const scene of SCENES.filter((one) => one.name !== "run")) {
      const file = writePage(outDir, { ...scene, legacy: true }, css);
      for (const key of ["d1440", "m390"]) {
        const context = await before.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
        const page = await context.newPage();
        await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
        await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(outDir, `before-${scene.name}-${key}.png`), fullPage: scene.name !== "chat" });
        await context.close();
      }
    }
    await before.close();
    return;
  }
  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => {
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };

  async function open(name, key, options = {}) {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !/notifications\/state/u.test(message.text())) errors.push(message.text()); });
    if (options.dialogs) page.on("dialog", (dialog) => options.dialogs(dialog));
    await page.goto(pathToFileURL(pages[name]).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const calls = (page) => page.evaluate(() => window.__harness.calls);
  const overlayOk = (page, selector) => page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) return { found: false };
    const background = getComputedStyle(element).backgroundColor;
    return { found: true, insideWorld: Boolean(element.closest('.v3-world[data-ui="next"]')), opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(background) };
  }, selector);
  const expectOverlay = async (page, label, selector) => {
    const result = await overlayOk(page, selector);
    report(`${label} inside the new-view root and opaque`, result.found && result.insideWorld && result.opaque, result);
  };
  const ROOT_SELECTOR = "[data-testid=v3-ai-agent-page], [data-testid=v3-ai-agents]";

  // 1. Каждая сцена на трёх ширинах: вёрстка, цели 44 px, axe, консоль.
  for (const scene of SCENES) {
    for (const key of Object.keys(VIEWPORTS)) {
      const label = `${key}/${scene.name}`;
      const { context, page, errors } = await open(scene.name, key);
      await shot(page, `agents-${scene.name}-${key}`, { fullPage: scene.name !== "chat" });
      report(`${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
      const small = await page.evaluate((rootSelector) => {
        const visible = (element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== "hidden"; };
        // Значок «?», флажок и переключатель увеличивают зону нажатия псевдоэлементом `after`; ссылка-название карточки — всей карточкой.
        const target = (element) => {
          const after = getComputedStyle(element, "::after");
          const card = after.position === "absolute" && after.content !== "none" ? element.closest("[data-slot=card]") : null;
          return card || element;
        };
        return [...document.querySelectorAll(`${rootSelector.split(", ").map((one) => `${one} a, ${one} button, ${one} input:not([type=checkbox]), ${one} [role=combobox]`).join(", ")}`)]
          .filter((element) => visible(element) && !element.matches("[aria-label^=Пояснение], [role=switch], [role=checkbox]") && !element.closest(".sr-only"))
          .map((element) => ({ text: (element.textContent || element.getAttribute("aria-label") || element.tagName).trim().slice(0, 30), h: Math.round(target(element).getBoundingClientRect().height) }))
          .filter((box) => box.h < 44);
      }, ROOT_SELECTOR);
      report(`${label}: targets >= 44px`, small.length === 0, small);
      const axe = await new AxeBuilder({ page }).include(ROOT_SELECTOR).analyze();
      report(`${label}: axe`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
      report(`${label}: console clean`, errors.length === 0, errors);
      await context.close();
    }
  }

  // 2. Хаб: плитки, ссылка-карточка, «?» с описанием роли агента.
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open("hub", key);
    report(`${key}/hub: four stat tiles`, (await page.locator("[data-slot=stat-tile]").count()) === 4, null);
    report(`${key}/hub: card title links to the agent page`, (await page.locator("[data-testid=v3-aia-card-director] h3 a").getAttribute("href")) === "/v3/ai-agents/director", null);
    report(`${key}/hub: role line is not on the card`, (await page.locator("[data-testid=v3-aia-card-director]").innerText()).includes("Считает продажи") === false, null);
    await page.getByRole("button", { name: "Пояснение: Директор / Аналитик" }).click();
    const help = page.getByRole("dialog", { name: "Пояснение: Директор / Аналитик" });
    await help.waitFor();
    report(`${key}/hub: role line sits behind the help button`, (await help.innerText()).includes("Считает продажи"), null);
    await expectOverlay(page, `${key}/hub: help popover`, "[data-slot=popover-content]");
    await page.keyboard.press("Escape");
    report(`${key}/hub: «Поручить» and drafts links on the card`, (await page.locator("[data-testid=v3-aia-ask-director]").getAttribute("href")) === "/v3/ai-agents/director" && (await page.locator("[data-testid=v3-aia-drafts-director]").getAttribute("href")) === "/v3/ai-agents/director?tab=drafts", null);
    report(`${key}/hub: console clean`, errors.length === 0, errors);
    await context.close();
  }

  // 3. «История работы»: строка → панель запуска → Esc → фокус на строке; поиск.
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open("runs", key);
    const opener = key === "d1280" ? page.getByRole("row").nth(1) : page.locator("[data-slot=data-table-cards] > li > button").first();
    if (key === "d1280") await opener.locator("td").nth(1).click(); else await opener.click({ position: { x: 8, y: 8 } });
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await expectOverlay(page, `${key}/runs: run sheet`, "[data-slot=sheet-content]");
    await shot(page, `agents-runsheet-${key}`);
    report(`${key}/runs: sheet links to the full run`, (await dialog.getByRole("link", { name: "Хроника и действия агента" }).getAttribute("href")) === "/v3/ai-agents/director?tab=runs&run=11111111-1111-4111-8111-000000000001", null);
    report(`${key}/runs: own command can be reopened in chat and copied`, (await dialog.getByRole("link", { name: "Открыть в чате" }).count()) === 1 && (await dialog.getByRole("button", { name: "Скопировать итог" }).count()) === 1, null);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    report(`${key}/runs: focus returns to the ${key === "d1280" ? "row" : "card"} after Esc`, await opener.evaluate((element) => element === document.activeElement), await page.evaluate(() => document.activeElement && document.activeElement.tagName));
    await page.getByPlaceholder("Поиск по поручениям").fill("Малайзии");
    report(`${key}/runs: search narrows the list`, (await page.locator(key === "d1280" ? "tbody tr" : "[data-slot=data-table-cards] > li").count()) === 1, null);
    report(`${key}/runs: console clean`, errors.length === 0, errors);
    await context.close();
  }

  // 3b. «Последние 30 и есть ещё»: один листатель («Показать ещё»), без «1–25 из 30», поиск назван поиском среди показанных.
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open("runs-more", key);
    const rows = await page.locator(key === "d1280" ? "tbody tr" : "[data-slot=data-table-cards] > li").count();
    report(`${key}/runs-more: all 30 loaded runs are listed, no second pager`, rows === 30 && (await page.locator("[data-slot=data-table-pagination]").count()) === 0 && !/\d+–\d+ из \d+/u.test(await page.locator("[data-testid=v3-aia-runs]").innerText()), rows);
    const more = page.locator("[data-testid=v3-aia-runs-more]");
    report(`${key}/runs-more: «Показать ещё» and the honest «последние 30»`, (await more.getByRole("link", { name: "Показать ещё" }).getAttribute("href")) === "/v3/ai-agents/director?tab=runs&limit=60" && /Показаны последние 30 запусков/u.test(await more.innerText()), await more.innerText());
    report(`${key}/runs-more: search says it covers the shown runs only`, (await page.getByPlaceholder("Поиск среди показанных").count()) === 1 && (await page.getByPlaceholder("Поиск по поручениям").count()) === 0, null);
    report(`${key}/runs-more: console clean`, errors.length === 0, errors);
    await context.close();
  }

  // 4. Запуск целиком: ошибочное действие первым, «Показать переписку» зовёт то же действие, «Технические данные» в панели.
  {
    const { context, page, errors } = await open("run", "d1280");
    const first = page.locator("[data-testid=v3-aia-run-detail] tbody tr").first();
    report("d1280/run: failed action first", /ошибка/u.test(await first.innerText()), await first.innerText());
    await page.getByRole("button", { name: "Показать переписку" }).click();
    await page.locator("[data-testid=v3-aia-timeline]").waitFor();
    report("d1280/run: transcript loads through the existing action", (await page.evaluate(() => window.__harness.calls.filter((call) => call.name === "transcript").length)) === 1, null);
    await page.getByRole("button", { name: "Технические данные" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor();
    report("d1280/run: technical data in a sheet", /claude-sonnet-5-5/u.test(await sheet.innerText()), null);
    await page.keyboard.press("Escape");
    report("d1280/run: console clean", errors.length === 0, errors);
    await context.close();
  }

  // 5. «На одобрение»: строка → панель с карточкой черновика; «Одобрить и отправить» зовёт decide; правка при закрытии спрашивает.
  for (const key of ["d1280", "m390"]) {
    let answer = "dismiss";
    const asked = [];
    const { context, page, errors } = await open("drafts", key, { dialogs: (dialog) => { asked.push(dialog.message()); return answer === "dismiss" ? dialog.dismiss() : dialog.accept(); } });
    // Риск виден в строке, не открывая её: черновик остался в очереди после неудачной отправки; срок близок. Здоровый — без строк.
    const list = page.locator(key === "d1280" ? "tbody tr" : "[data-slot=data-table-cards] > li");
    report(`${key}/drafts: only pending drafts under «Ждут решения»`, (await list.count()) === 3, await list.count());
    report(`${key}/drafts: failed-send note sits in the row`, /Остаётся в очереди: WhatsApp сейчас не подключён/u.test(await list.nth(1).innerText()) && (await list.nth(0).locator("[data-testid=v3-aia-draft-note]").count()) === 0, await list.nth(1).innerText());
    report(`${key}/drafts: «действует до» sits in the row of a draft that expires within a day`, /действует до/u.test(await list.nth(2).innerText()) && (await list.nth(0).locator("[data-testid=v3-aia-draft-expires]").count()) === 0, null);
    if (key === "m390") {
      const titleBox = await page.evaluate(() => { const title = document.querySelector("[data-slot=data-table-cards] > li span.t-item"); const box = title.getBoundingClientRect(); const preview = title.querySelector("span.line-clamp-2"); return { align: getComputedStyle(preview).textAlign, text: preview.textContent.slice(0, 24), left: Math.round(preview.getBoundingClientRect().left - box.left) }; });
      report("m390/drafts: the reply preview is the card's left-aligned second line", /^(left|start)$/u.test(titleBox.align) && titleBox.left <= 1 && /Здравствуйте/u.test(titleBox.text), titleBox);
    }
    const opener = key === "d1280" ? page.getByRole("row").nth(2) : page.locator("[data-slot=data-table-cards] > li > button").nth(1);
    if (key === "d1280") await opener.locator("td").nth(1).click(); else await opener.click({ position: { x: 8, y: 8 } });
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await expectOverlay(page, `${key}/drafts: draft sheet`, "[data-slot=sheet-content]");
    const bare = await dialog.evaluate((element) => { const article = element.querySelector("[data-testid=v3-aia-draft]"); return { border: getComputedStyle(article).borderTopWidth, h3: article.querySelectorAll("h3").length, title: element.querySelectorAll("[data-slot=sheet-title]").length }; });
    report(`${key}/drafts: the sheet holds the draft body, not a second card with a repeated header`, bare.border === "0px" && bare.h3 === 0 && bare.title === 1, bare);
    report(`${key}/drafts: the failed-send hint stays in the sheet before approving`, /Подключите WhatsApp/u.test(await dialog.innerText()) && (await dialog.getByRole("link", { name: "Открыть чат" }).count()) === 1, null);
    await shot(page, `agents-draftsheet-${key}`);
    const field = dialog.getByRole("textbox", { name: "Ответ агента" });
    await field.fill(`${await field.inputValue()} Правка.`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    report(`${key}/drafts: closing with an edit asks, «Cancel» keeps the sheet`, asked.length === 1 && /несохранённые/u.test(asked[0]) && (await dialog.count()) === 1, asked);
    answer = "accept";
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    report(`${key}/drafts: «OK» closes the sheet`, asked.length === 2, asked);
    if (key === "d1280") await opener.locator("td").nth(1).click(); else await opener.click({ position: { x: 8, y: 8 } });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Одобрить и отправить" }).click();
    await dialog.getByText("Отправлено клиенту.").waitFor();
    const decide = (await calls(page)).find((call) => call.name === "decide");
    report(`${key}/drafts: approve calls decide with the draft id`, Boolean(decide) && decide.fields.draft_id === "dr-2" && decide.fields.decision === "approve" && decide.fields.edited_text === "", decide);
    report(`${key}/drafts: result stays in the sheet after the decision`, (await dialog.getByText("Отправлено клиенту.").count()) === 1, null);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    report(`${key}/drafts: no second prompt after the decision`, asked.length === 2, asked);
    report(`${key}/drafts: console clean`, errors.length === 0, errors);
    await context.close();
  }

  // 6. «Включён» и «Авто» в шапке: те же поля, что у прежних переключателей.
  {
    const { context, page, errors } = await open("overview", "d1280");
    await page.getByRole("switch", { name: "Авто" }).click();
    const group = page.getByRole("group", { name: /Агент начнёт сам писать/u });
    await group.waitFor();
    report("d1280/switches: «Авто» asks before turning on", (await calls(page)).length === 0 && (await group.getByRole("button", { name: "Включить Авто" }).count()) === 1, null);
    await group.getByRole("button", { name: "Включить Авто" }).click();
    await page.waitForFunction(() => window.__harness.calls.some((call) => call.name === "update"));
    const auto = (await calls(page)).find((call) => call.name === "update");
    report("d1280/switches: «Авто» sends the same patch and version", auto.fields.patch === '{"autoSend":true}' && auto.fields.expected_version === "12" && auto.fields.key === "director", auto);
    await page.getByRole("switch", { name: "Включён" }).click();
    await page.waitForFunction(() => window.__harness.calls.filter((call) => call.name === "update").length === 2);
    report("d1280/switches: «Включён» sends {enabled:false}", (await calls(page)).filter((call) => call.name === "update")[1].fields.patch === '{"enabled":false}', null);
    report("d1280/overview: the tools button carries no bare number", (await page.getByRole("button", { name: "Что делает агент", exact: true }).count()) === 1, null);
    // Заперто — выглядит запертым: бледная дорожка и курсор «нельзя» (`aria-disabled` у переключателя набора), включённый — серой дорожкой.
    // Запись ещё идёт: переключатель в этот миг сам `aria-disabled` — ждём конца, чтобы «живой» вид был живым.
    await page.waitForFunction(() => !document.querySelector("[data-testid=v3-aia-switch-auto]").hasAttribute("aria-disabled") && !document.querySelector("[data-testid=v3-aia-switch-enabled]").hasAttribute("aria-disabled"));
    const locked = await page.evaluate(() => {
      const probe = (variable) => { const node = document.createElement("div"); node.style.background = `var(${variable})`; document.querySelector(".v3-world").append(node); const color = getComputedStyle(node).backgroundColor; node.remove(); return color; };
      const read = (testId) => {
        const node = document.querySelector(`[data-testid=${testId}]`);
        node.style.transition = "none";
        const live = { bg: getComputedStyle(node).backgroundColor, cursor: getComputedStyle(node).cursor };
        node.setAttribute("aria-disabled", "true");
        const after = getComputedStyle(node);
        const out = { checked: node.getAttribute("aria-checked"), live, locked: { bg: after.backgroundColor, cursor: after.cursor, border: after.borderTopColor } };
        node.removeAttribute("aria-disabled");
        node.style.transition = "";
        return out;
      };
      return { enabled: read("v3-aia-switch-enabled"), auto: read("v3-aia-switch-auto"), surface2: probe("--surface-2"), text3: probe("--text-3"), border: probe("--border") };
    });
    report("d1280/switches: aria-disabled switch looks locked (pale track, not-allowed cursor), unchecked and checked", locked.enabled.checked === "false" && locked.auto.checked === "true" && [locked.enabled, locked.auto].every((one) => one.locked.cursor === "not-allowed" && one.live.cursor !== "not-allowed" && one.locked.border === locked.border) && locked.enabled.locked.bg === locked.surface2 && locked.auto.locked.bg === locked.text3, locked);
    await page.getByRole("button", { name: "Что делает агент" }).click();
    const tools = page.getByRole("dialog");
    await tools.waitFor();
    report("d1280/overview: tools in a sheet", /Отчёт продаж/u.test(await tools.innerText()), null);
    await page.keyboard.press("Escape");
    report("d1280/switches: console clean", errors.length === 0, errors);
    await context.close();
  }

  // 7. «Настройки»: группы карточек, один патч из изменённых полей, синхронизация, платный запуск по расписанию.
  for (const key of ["d1280", "m390"]) {
    const { context, page, errors } = await open("settings", key);
    const save = page.getByRole("button", { name: "Сохранить настройки" });
    report(`${key}/settings: save is off until something changes`, await save.isDisabled(), null);
    await page.locator("#aia-model").click();
    await page.getByRole("listbox").waitFor();
    await expectOverlay(page, `${key}/settings: select list`, "[data-slot=select-content]");
    await page.getByRole("option", { name: "Claude Opus 5.5" }).click();
    await page.locator("#aia-budget").fill("7");
    report(`${key}/settings: save bar sticks once there is a change`, await page.evaluate(() => getComputedStyle(document.querySelector("[data-testid=v3-aia-settings-save]").parentElement).position === "sticky"), null);
    await shot(page, `agents-settings-dirty-${key}`);
    await save.click();
    await page.waitForFunction(() => window.__harness.calls.some((call) => call.name === "update"));
    const update = (await calls(page)).find((call) => call.name === "update");
    report(`${key}/settings: one patch with only the changed fields`, JSON.stringify(JSON.parse(update.fields.patch)) === JSON.stringify({ model: "claude-opus-5-5", runBudgetUsd: 7 }) && update.fields.expected_version === "12", update);
    await page.locator("#aia-budget").fill("abc");
    report(`${key}/settings: invalid budget is named and blocks saving`, (await page.getByText("Потолок расхода — число от 0 до 100 долларов.").count()) === 1 && (await save.isDisabled()), null);
    await page.locator("#aia-budget").fill("5");
    await page.getByRole("button", { name: "Запустить по расписанию сейчас" }).click();
    await page.getByRole("group", { name: "Подтверждение запуска" }).waitFor();
    await page.getByRole("button", { name: "Запустить", exact: true }).click();
    await page.waitForFunction(() => window.__harness.calls.some((call) => call.name === "start"));
    const start = (await calls(page)).find((call) => call.name === "start");
    report(`${key}/settings: paid scheduled run asks first and starts without send authority`, start.fields.send_authority === "0" && start.fields.key === "director" && start.fields.text.length > 20, start);
    await page.getByRole("button", { name: "Синхронизировать с Claude" }).click();
    await page.waitForFunction(() => window.__harness.calls.some((call) => call.name === "sync"));
    report(`${key}/settings: sync calls the existing action`, (await calls(page)).find((call) => call.name === "sync").fields.rotate_token === "0", null);
    report(`${key}/settings: one «Технические данные» button and no separate empty «Агент в Claude» card`, (await page.getByRole("button", { name: "Технические данные" }).count()) === 1 && (await page.getByRole("heading", { name: "Агент в Claude" }).count()) === 0, null);
    await page.getByRole("button", { name: "Технические данные" }).click();
    const tech = page.getByRole("dialog");
    await tech.waitFor();
    await tech.getByRole("button", { name: "Обновить токен" }).click();
    await tech.getByRole("button", { name: "Обновить токен" }).last().click();
    await page.waitForFunction(() => window.__harness.calls.some((call) => call.name === "sync" && call.fields.rotate_token === "1"));
    report(`${key}/settings: token rotation asks and sends rotate_token=1`, true, null);
    // ID агента в Claude правится здесь же, в панели: неверный — называется, верный поднимает «Сохранить» и уходит тем же патчем.
    const idInput = tech.locator("#aia-claude-id");
    report(`${key}/settings: the Claude ID field lives in the sheet with the saved value`, (await idInput.inputValue()) === "agent_01AbCdEfGh", null);
    await idInput.fill("abc");
    report(`${key}/settings: a wrong Claude ID is named in the sheet`, /ID агента в Claude начинается с «agent_»/u.test(await tech.innerText()), null);
    await idInput.fill("agent_01NewAgentXyz1");
    await page.keyboard.press("Escape");
    await tech.waitFor({ state: "detached" });
    await save.click();
    await page.waitForFunction(() => window.__harness.calls.filter((call) => call.name === "update").length >= 2);
    const idUpdate = (await calls(page)).filter((call) => call.name === "update").at(-1);
    report(`${key}/settings: the Claude ID goes out in the same patch`, JSON.parse(idUpdate.fields.patch).claudeAgentId === "agent_01NewAgentXyz1", idUpdate);
    report(`${key}/settings: console clean`, errors.length === 0, errors);
    await context.close();
  }

  // 8. «Правила агента»: сохранение зовёт то же действие; панель стандартных правил не нужна, пока правила стандартные.
  {
    const { context, page, errors } = await open("instructions", "d1280");
    const field = page.locator("#aia-instr-text-director");
    const save = page.getByRole("button", { name: "Сохранить", exact: true });
    report("d1280/rules: save is off until the text changes", await save.isDisabled(), null);
    report("d1280/rules: default text sheet is hidden while rules are the defaults", (await page.getByRole("button", { name: "Стандартные правила" }).count()) === 0 && (await page.getByRole("button", { name: "Общие правила EVO" }).count()) === 1, null);
    await field.fill(`${await field.inputValue()}\n\nНовое правило.`);
    await save.click();
    await page.waitForFunction(() => window.__harness.calls.some((call) => call.name === "saveInstructions"));
    const saved = (await calls(page)).find((call) => call.name === "saveInstructions");
    report("d1280/rules: save calls the existing action with mode=save and the version", saved.fields.mode === "save" && saved.fields.expected_version === "12" && /Новое правило\./u.test(saved.fields.text), saved.fields.mode);
    report("d1280/rules: console clean", errors.length === 0, errors);
    await context.close();
  }

  // 9. «Чат»: прежнее поведение разговора (восстановление, отправка в тот же разговор), шапка набора; на телефоне — лист «Разговоры».
  for (const key of ["d1440", "m390"]) {
    const { context, page, errors } = await open("chat", key);
    report(`${key}/chat: one h1 with the agent name`, (await page.locator("h1").count()) === 1 && (await page.locator("h1").innerText()) === "Директор / Аналитик", null);
    report(`${key}/chat: resumed conversation shows the answer`, (await page.getByText("Готово: ").count()) >= 1 && (await page.locator("[data-testid=v3-aia-timeline]").count()) === 1, null);
    if (key === "d1440") {
      report("d1440/chat: tabs are links in the header", (await page.locator("[data-testid=v3-aia-chat-header] a", { hasText: "История работы" }).getAttribute("href")) === "/v3/ai-agents/director?tab=runs", null);
      report("d1440/chat: header is one line of the new-view widgets", (await page.locator("[data-testid=v3-aia-chat-header] [role=switch]").count()) === 2 && (await page.getByRole("button", { name: "На весь экран" }).count()) === 1, null);
    } else {
      await page.getByTestId("v3-aia-conversations-open").click();
      await page.getByTestId("v3-aia-conversations-sheet").waitFor();
      report("m390/chat: conversations sheet opens", (await page.getByTestId("v3-aia-conversation-item").count()) >= 1, null);
      await page.keyboard.press("Escape");
    }
    await page.getByTestId("v3-aia-input").fill("Проверка связи");
    if (key === "d1440") await page.keyboard.press("Enter"); else await page.getByTestId("v3-aia-send").click();
    await page.waitForFunction(() => window.__harness.calls.some((call) => call.name === "followUp" || call.name === "start"));
    const sent = (await calls(page)).find((call) => call.name === "followUp" || call.name === "start");
    report(`${key}/chat: send goes through the existing follow-up action`, sent.name === "followUp" && sent.fields.text === "Проверка связи", sent);
    report(`${key}/chat: console clean`, errors.length === 0, errors);
    await context.close();
  }

  await browser.close();
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
