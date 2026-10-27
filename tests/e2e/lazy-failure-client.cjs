"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид»: не пришёл код ленивого куска (обрыв связи, Turbopack повторяет загрузку один раз, потом `ChunkLoadError`). В
 * настоящем браузере (Playwright Chromium, `react-dom/client`) под границей ошибок вроде `(v3)/error.tsx`: уже нарисованная
 * страница не должна заменяться экраном ошибки из-за необязательного куска («?», «Ещё N», обращения, вкладки), а вход экрана
 * показывает строку и кнопку, которая перезагружает страницу. Ошибка при этом не глотается: каждый отказ записан в
 * `console.error` один раз. Код куска «не приходит» (режим по умолчанию): модуль при загрузке бросает ошибку с именем
 * `ChunkLoadError`, `import()` отклоняется так же, как сетевой сбой. Ошибка в коде куска (`fault=bug`: обычная ошибка при
 * загрузке модуля) не обрыв связи: она не прячется за заглушкой, а доходит до границы ошибок (`error.tsx`), записи помощника
 * нет. Данные синтетические. Серверную сторону закрепляет `tests/ui-next-lazy.test.mjs`.
 *
 *   node tests/e2e/lazy-failure-client.cjs [outDir]
 *     → JSON-строки проверок (при нарушении код 1); по умолчанию outDir — .impeccable/review (не коммитится).
 */

const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
const FAILING = /[\\/](HelpTipImpl|FeedOverflowImpl|CaseHelpCardImpl|SectionTabsInPlaceImpl|TodayNextPage|RequestsNextPage|CalendarNextPage|SnippetsNext|FilesNext|KnowledgeNextPage|TeamChatNextPage)\.tsx$/;

/** Запись помощника отказа в `console.error`: приставка и сама ошибка (в тексте записи Chromium — её сообщение). */
const isLazyLog = (text) => /Новый вид/u.test(text) && /ChunkLoadError/u.test(text);
/** Любая запись помощника отказа: при ошибке в коде куска её быть не должно. */
const isHelperLog = (text) => /Новый вид/u.test(text);

const ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { HelpTip } = require("@/components/kit/HelpTip");
const { SectionTabsInPlace } = require("@/components/kit/SectionTabsInPlace");
const { CaseHelpCard } = require("@/components/v3/profile/next/CaseHelpCard");
const { FeedOverflow } = require("@/components/v3/profile/next/FeedOverflow");
const { RequestsNextLazy } = require("@/components/v3/requests-next/RequestsNextLazy");
const { TodayNextLazy } = require("@/components/v3/today-next/TodayNextLazy");
const { CalendarNextLazy } = require("@/components/v3/calendar/next/CalendarNextLazy");
const { SnippetsNextLazy } = require("@/components/v3/reply-snippets/next/SnippetsNextLazy");
const { FilesNextLazy } = require("@/components/v3/knowledge/next/FilesNextLazy");
const { KnowledgeNextLazy } = require("@/components/v3/knowledge/next/KnowledgeNextLazy");
const { TeamChatNextLazy } = require("@/components/v3/team-chat/next/TeamChatNextLazy");
const h = React.createElement;
// Граница ошибок вроде (v3)/error.tsx: что она поймала, то заменило страницу.
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? h("div", { id: "boundary" }, "Не удалось открыть экран: " + this.state.error.message) : this.props.children; }
}
const mode = new URLSearchParams(location.search).get("mode");
const screens = {
  today: h(TodayNextLazy, {}), requests: h(RequestsNextLazy, {}), calendar: h(CalendarNextLazy, {}), snippets: h(SnippetsNextLazy, {}),
  files: h(FilesNextLazy, {}), knowledge: h(KnowledgeNextLazy, {}), chat: h(TeamChatNextLazy, {}),
};
const widgets = h("main", { id: "page" }, h("p", { id: "alive" }, "Страница нарисована"),
  h(HelpTip, { label: "Пояснение: Тест" }, "Текст пояснения"),
  h(FeedOverflow, { count: 3, title: "Лента" }, h("li", null, "строка")),
  h(CaseHelpCard, { initialPage: {} }),
  h(SectionTabsInPlace, { label: "Вкладки", tabs: [{ key: "a", label: "А", content: "один" }] }));
createRoot(document.getElementById("root")).render(
  h(Boundary, null, h(React.Suspense, { fallback: h("p", { id: "suspense" }, "Загрузка") }, mode === "widgets" ? widgets : screens[mode])));
setTimeout(() => { document.documentElement.dataset.ready = "true"; }, 1200);
`;

async function buildBundle(outFile) {
  const esbuild = require("esbuild");
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: "lazy-failure-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("production") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"production\" } };" }, logLevel: "error",
    plugins: [{
      name: "lazy-failure",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
        build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
        build.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: join(ROOT, "node_modules/next/dist/shared/lib/app-dynamic.js") }));
        // Вид отказа выбирает адрес страницы: по умолчанию не пришёл код (`ChunkLoadError`), `fault=bug` — ошибка в коде куска.
        build.onLoad({ filter: FAILING }, () => ({
          contents: 'const bug = new URLSearchParams(location.search).get("fault") === "bug"; const error = new Error(bug ? "ошибка в коде куска" : "Failed to load chunk"); if (!bug) error.name = "ChunkLoadError"; throw error;',
          loader: "js",
        }));
        build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
      },
    }],
  });
}

async function main() {
  const outDir = resolve(process.argv[2] ?? join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  await buildBundle(join(outDir, "lazy-failure-bundle.js"));
  const html = join(outDir, "lazy-failure.html");
  writeFileSync(html, '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>lazy failure</title></head><body><div id="root"></div><script src="lazy-failure-bundle.js"></script></body></html>');
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => { if (!ok) failed = true; console.log(JSON.stringify({ check, ok, detail })); };
  const open = async (mode, fault = "chunk") => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    const logged = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") logged.push(message.text()); });
    await page.goto(`${pathToFileURL(html).href}?mode=${mode}&fault=${fault}`, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached" });
    return { page, errors, logged };
  };

  {
    const { page, errors, logged } = await open("widgets");
    report("widgets: the rendered page is not replaced by an error screen", (await page.locator("#boundary").count()) === 0 && (await page.locator("#alive").count()) === 1, await page.locator("#boundary").allTextContents());
    report("widgets: «?» stays as a named button", (await page.getByRole("button", { name: "Пояснение: Тест" }).count()) === 1, null);
    report("widgets: «Ещё N» stays as a named button", (await page.getByRole("button", { name: "Ещё 3 в ленте" }).count()) === 1, null);
    report("widgets: the case help card says it failed", (await page.getByText("Не удалось загрузить обращения студента").count()) === 1, null);
    report("widgets: no uncaught page errors", errors.length === 0, errors);
    report("widgets: each of the four failures is written to console.error once", logged.filter(isLazyLog).length === 4, logged);
    await page.context().close();
  }
  for (const mode of ["today", "requests", "calendar", "snippets", "files", "knowledge", "chat"]) {
    const { page, logged } = await open(mode);
    report(`${mode}: no error-boundary screen`, (await page.locator("#boundary").count()) === 0, await page.locator("#boundary").allTextContents());
    report(`${mode}: load-failed row with a reload button`, (await page.locator("[data-testid=v3-load-failed]").count()) === 1 && (await page.getByRole("button", { name: "Обновить страницу" }).count()) === 1, null);
    report(`${mode}: the failure is written to console.error once`, logged.filter(isLazyLog).length === 1, logged);
    if (failed) { await page.context().close(); continue; }
    const navigated = page.waitForEvent("framenavigated", { timeout: 5000 }).then(() => true, () => false);
    await page.getByRole("button", { name: "Обновить страницу" }).click();
    report(`${mode}: the button reloads the page`, await navigated, null);
    await page.context().close();
  }
  // Ошибка в коде куска: не «проверьте связь», а граница ошибок; помощник молчит.
  for (const mode of ["widgets", "today", "requests", "calendar", "snippets", "files", "knowledge", "chat"]) {
    const { page, logged } = await open(mode, "bug");
    report(`bug ${mode}: the error reaches the error boundary`, (await page.locator("#boundary").count()) === 1 && /ошибка в коде куска/u.test((await page.locator("#boundary").allTextContents()).join("")), await page.locator("#boundary").allTextContents());
    report(`bug ${mode}: no load-failed row and no stub`, (await page.locator("[data-testid=v3-load-failed]").count()) === 0 && (await page.locator("#alive").count()) === 0, null);
    report(`bug ${mode}: the helper writes nothing to console.error`, logged.filter(isHelperLog).length === 0, logged);
    await page.context().close();
  }
  await browser.close();
  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
