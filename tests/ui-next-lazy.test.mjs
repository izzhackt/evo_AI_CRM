// «Новый вид» (решение владельца 27.10.2026): ленивые куски. Проверяется, что в браузере не пришедший код куска (обрыв связи,
// ошибка с именем `ChunkLoadError`) не снимает с экрана уже нарисованную страницу: «?», «Ещё N», карточка обращений и вкладки на
// месте остаются заглушкой, а входы экранов показывают строку с кнопкой «Обновить страницу» — и ошибка при этом попадает в
// `console.error`, а не глотается; что любая другая ошибка (бросок при загрузке модуля, то есть ошибка в коде куска) уходит выше как
// есть и в браузере, и на сервере: заглушка «проверьте связь» скрыла бы её. Дальше она идёт так: на сервере у настоящих маршрутов
// есть `loading.tsx`, то есть над входом экрана стоит `Suspense`, поэтому сервер слышит её (`onError`, журнал), отвечает 200 и отдаёт
// границу браузеру на дорисовку (`<!--$!-->`), а браузер уже ловит её своей границей ошибок (`(v3)/error.tsx`). Оболочку (ответ 500)
// ошибка роняет, только если над входом нет `Suspense`; такой случай тоже смоделирован, но он не про настоящие маршруты. Код куска
// «не приходит»: модуль, который грузит `lazy` или `next/dynamic`, при загрузке бросает ошибку (как отклонённый `import()`
// в браузере): `ChunkLoadError` (вид `chunk`) или обычную ошибку кода (вид `bug`). Заглушка «Ещё N» выглядит как настоящая кнопка.
//
//   node --experimental-strip-types --test tests/ui-next-lazy.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");

/** Модули, чей код «не приходит»: то, что грузят ленивые куски и входы экранов. */
const FAILING = /[\\/](HelpTipImpl|FeedOverflowImpl|CaseHelpCardImpl|SectionTabsInPlaceImpl|TodayNextPage|RequestsNextPage|TasksNext|TasksNextFailure|NextAgentsView|NextAgentPage|NextAgentUnavailable|SettingsNextPage|MarketingNextPage|FinanceNextPage|AiAgentNextPage)\.tsx$/;

const ENTRY = `
import { createElement as h, Suspense } from "react";
import { Writable } from "node:stream";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { HelpTip } from "@/components/kit/HelpTip";
import { LoadFailed } from "@/components/kit/LoadFailed";
import { OUTLINE_BUTTON } from "@/components/kit/outline-button";
import { SectionTabsInPlace } from "@/components/kit/SectionTabsInPlace";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CaseHelpCard } from "@/components/v3/profile/next/CaseHelpCard";
import { FeedOverflow } from "@/components/v3/profile/next/FeedOverflow";
import { RequestsNextInvalidLazy, RequestsNextLazy } from "@/components/v3/requests-next/RequestsNextLazy";
import { TasksNextFailureLazy, TasksNextLazy } from "@/components/v3/tasks/next/TasksNextLazy";
import { TodayNextLazy } from "@/components/v3/today-next/TodayNextLazy";
import { NextAgentPageLazy, NextAgentUnavailableLazy, NextAgentsViewLazy } from "@/components/v3/ai-agents-next/NextAgentsLazy";
import { SettingsNextLazy } from "@/components/v3/settings-next/SettingsNextLazy";
import { MarketingNextLazy } from "@/components/v3/marketing-next/MarketingNextLazy";
import { FinanceNextLazy } from "@/components/v3/finance-next/FinanceNextLazy";
import { AiAgentNextLazy } from "@/components/v3/ai-agent-next/AiAgentNextLazy";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Рисует, пока две отдачи подряд не совпадут; первая отдача (заглушка, пока код грузится) возвращается отдельно. */
async function settle(node) {
  let previous = null;
  let first = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let markup = null;
    try { markup = renderToStaticMarkup(node); } catch (error) { if (!/suspended while responding to synchronous input/u.test(String(error?.message))) throw error; }
    if (first === null && markup !== null) first = markup;
    if (markup !== null && markup === previous) return { first, markup };
    previous = markup;
    await pause(15);
  }
  throw new Error("разметка не устоялась");
}
/**
 * Рисует потоком, как сервер Next: ждёт код ленивых кусков и отдаёт то, что услышал onError (он пишет в журнал сервера) и
 * onShellError (ошибка вне границы Suspense роняет оболочку). Ошибка внутри Suspense оболочку не роняет: граница отдаётся
 * браузеру на дорисовку (маркер "$!"), а onError её слышит.
 */
const serve = (node) => new Promise((resolve) => {
  const errors = [];
  let markup = "";
  const sink = new Writable({ write(chunk, _encoding, done) { markup += chunk; done(); } });
  sink.on("finish", () => resolve({ markup, errors, shellFailed: false }));
  const { pipe } = renderToPipeableStream(node, {
    onError: (error) => { errors.push(error); },
    onShellError: () => resolve({ markup, errors, shellFailed: true }),
    onAllReady: () => pipe(sink),
  });
});
const nodes = {
  help: () => h(HelpTip, { label: "Пояснение: Тест" }, "Текст пояснения"),
  feed: () => h(FeedOverflow, { count: 3, title: "Лента" }, h("li", null, "строка")),
  caseHelp: () => h(CaseHelpCard, { initialPage: {} }),
  tabs: () => h("div", { id: "around" }, "до", h(SectionTabsInPlace, { label: "Вкладки", tabs: [{ key: "a", label: "А", content: "один" }] }), "после"),
};
/** То, что стоит над входом экрана на настоящем маршруте: файл loading.tsx — это граница Suspense. */
const underLoading = (node) => h(Suspense, { fallback: h("p", { id: "route-loading" }, "Загрузка маршрута") }, node);
const entries = { TodayNextLazy, RequestsNextLazy, RequestsNextInvalidLazy, TasksNextLazy, TasksNextFailureLazy, NextAgentsViewLazy, NextAgentPageLazy, NextAgentUnavailableLazy };
/** Входы потока «admin» (28.10.2026): у их маршрутов нет своего loading.tsx, границу Suspense держит сам вход (опция loading). */
const adminEntries = { SettingsNextLazy, MarketingNextLazy, FinanceNextLazy, AiAgentNextLazy };
export const render = {
  ...Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, () => settle(node())])),
  screens: Object.fromEntries(Object.entries(entries).map(([name, Screen]) => [name, () => settle(h(Screen, {}))])),
  admin: {
    screens: Object.fromEntries(Object.entries(adminEntries).map(([name, Screen]) => [name, () => settle(h(Screen, {}))])),
    served: Object.fromEntries(Object.entries(adminEntries).map(([name, Screen]) => [name, () => serve(h(Screen, {}))])),
  },
  served: {
    ...Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, () => serve(node())])),
    screens: Object.fromEntries(Object.entries(entries).map(([name, Screen]) => [name, () => serve(h(Screen, {}))])),
    routed: Object.fromEntries(Object.entries(entries).map(([name, Screen]) => [name, () => serve(underLoading(h(Screen, {})))])),
  },
  loadFailed: LoadFailed,
  outline: { constant: OUTLINE_BUTTON, real: cn(buttonVariants({ variant: "outline", size: "default", className: "w-fit" })), markup: renderToStaticMarkup(h(Button, { variant: "outline", className: "w-fit" }, "x")) },
};
`;

async function views(kind = "chunk") {
  const dir = mkdtempSync(join(tmpdir(), "ui-next-lazy-"));
  try {
    const outfile = join(dir, "out.cjs");
    writeFileSync(join(dir, "entry.tsx"), ENTRY);
    await build({
      entryPoints: [join(dir, "entry.tsx")], outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic",
      tsconfig: root("tsconfig.json"), absWorkingDir: root(""), nodePaths: [root("node_modules")], logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "ui-next-lazy",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
          // Вне сборки Next `next/dynamic` — версия для pages router; сборка берёт версию для App Router, её берём и мы.
          b.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: root("node_modules/next/dist/shared/lib/app-dynamic.js") }));
          b.onLoad({ filter: FAILING }, () => ({ contents: FAULTS[kind], loader: "js" }));
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
        },
      }],
    });
    return createRequire(root("package.json"))(outfile).render;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Как отклоняет загрузку Turbopack (и webpack): ошибка с именем `ChunkLoadError`; или обычная ошибка при загрузке модуля. */
const CHUNK_FAULT = 'const error = new Error("Failed to load chunk"); error.name = "ChunkLoadError"; throw error;';
const BUG_FAULT = 'throw new Error("ошибка в коде куска");';
const FAULTS = { chunk: CHUNK_FAULT, bug: BUG_FAULT };
const isChunkError = (value) => value instanceof Error && value.name === "ChunkLoadError";
const isBugError = (value) => value instanceof Error && value.name === "Error" && value.message === "ошибка в коде куска";
const isHelperLog = (args) => typeof args[0] === "string" && args[0].startsWith("[Новый вид]");

/**
 * Рисует «в браузере»: `window` есть (как у `LoadFailed`), `console.error` перехвачен. Помощник ленивого куска решает по
 * `typeof window` при отказе, поэтому `window` держим, пока отрисовка не устоялась. Пакет (`views()`) собирают до этого: при
 * заданном `window` модули Next при загрузке ждут `document`. `errors` — записи об ошибке `ChunkLoadError`, `helper` — все записи
 * помощника («[Новый вид] …»); `thrown` — ошибка, ушедшая выше (только у `inBrowserCatching`).
 */
async function browserRun(run, catching) {
  const logged = [];
  const original = console.error;
  globalThis.window = { location: { reload() {} } };
  console.error = (...args) => { logged.push(args); };
  try {
    let result = null;
    let thrown = null;
    try { result = await run(); } catch (error) { if (!catching) throw error; thrown = error; }
    return { result, thrown, helper: logged.filter(isHelperLog), errors: logged.filter((args) => args.some(isChunkError)) };
  } finally {
    console.error = original;
    delete globalThis.window;
  }
}
const inBrowser = (run) => browserRun(run, false);
const inBrowserCatching = (run) => browserRun(run, true);

/** Значение `class` первого элемента разметки (React экранирует `&` и `\'`). */
const classOf = (markup) => markup.match(/ class="([^"]*)"/u)[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'");

test("в браузере не пришёл код окна «?»: на месте та же кнопка с тем же именем, страница не падает, ошибка в `console.error`", async () => {
  const { help } = await views();
  const { result: { markup }, errors } = await inBrowser(help);
  assert.match(markup, /<button[^>]*aria-label="Пояснение: Тест"[^>]*>\s*<span aria-hidden="true">\?<\/span>/u);
  assert.doesNotMatch(markup, /Текст пояснения/u, "окна нет");
  assert.equal(errors.length, 1, "ошибка загрузки записана один раз, а не проглочена");
});

test("в браузере не пришёл код панели «Ещё N»: остаётся кнопка с тем же именем, а не ошибка на весь экран; ошибка в `console.error`", async () => {
  const { feed } = await views();
  const { result: { markup }, errors } = await inBrowser(feed);
  assert.match(markup, /<button[^>]*aria-label="Ещё 3 в ленте"[^>]*data-testid="v3-feed-overflow"[^>]*>Ещё 3<\/button>/u);
  assert.equal(errors.length, 1);
});

test("в браузере не пришёл код карточки обращений и вкладок на месте: слова о сбое / пусто, соседний текст жив; ошибки в `console.error`", async () => {
  const views_ = await views();
  const help = await inBrowser(() => views_.caseHelp());
  assert.match(help.result.markup, /role="alert"[^>]*>Не удалось загрузить обращения студента\. Обновите страницу\./u);
  assert.equal(help.errors.length, 1);
  const tabs = await inBrowser(() => views_.tabs());
  assert.match(tabs.result.markup, /до.*после/u, "страница вокруг вкладок на месте");
  assert.doesNotMatch(tabs.result.markup, /role="tablist"/u);
  assert.equal(tabs.errors.length, 1);
});

test("в браузере не пришёл код экрана: каждый вход нового вида показывает строку и кнопку «Обновить страницу», а не ошибку границы; ошибка в `console.error`", async () => {
  const { screens } = await views();
  for (const [name, render] of Object.entries(screens)) {
    const { result: { markup }, errors } = await inBrowser(render);
    assert.match(markup, /data-testid="v3-load-failed"/u, name);
    assert.match(markup, /role="alert"[^>]*>[\s\S]*Не удалось загрузить экран\./u, name);
    assert.match(markup, /<button[^>]*>Обновить страницу<\/button>/u, name);
    assert.equal(errors.length, 1, `${name}: ошибка загрузки записана`);
  }
});

test("на сервере не пришедший код куска не глотается: «?», «Ещё N», карточка обращений и вкладки сообщают ошибку серверу (`onError`), граница уходит браузеру на дорисовку", async () => {
  const { served } = await views();
  for (const name of ["help", "feed", "caseHelp", "tabs"]) {
    const { errors, markup, shellFailed } = await served[name]();
    assert.equal(shellFailed, false, `${name}: Suspense держит страницу`);
    assert.equal(errors.length, 1, `${name}: исходная ошибка дошла до журнала сервера`);
    assert.equal(isChunkError(errors[0]), true, name);
    assert.match(markup, /<!--\$!-->/u, `${name}: граница отдана браузеру на дорисовку, а не закрыта заглушкой с ответом 200`);
  }
});

test("на сервере код экрана не пришёл, а над входом нет `Suspense` (маршрут без `loading.tsx`): ошибка выходит из входа как есть и роняет оболочку; это модель такого маршрута, настоящие маршруты нового вида — в следующем тесте", async () => {
  const { served } = await views();
  assert.equal(Object.keys(served.screens).length, 8);
  for (const [name, render] of Object.entries(served.screens)) {
    const { errors, markup, shellFailed } = await render();
    assert.equal(shellFailed, true, name);
    assert.equal(errors.length, 1, name);
    assert.equal(isChunkError(errors[0]), true, name);
    assert.doesNotMatch(markup, /v3-load-failed|Не удалось загрузить экран/u, name);
  }
});

test("у каждого маршрута, что рисует вход экрана нового вида, есть `loading.tsx` (граница `Suspense` над входом), и все восемь входов разобраны по маршрутам", () => {
  const routes = {
    main: ["TodayNextLazy"],
    requests: ["RequestsNextLazy", "RequestsNextInvalidLazy"],
    tasks: ["TasksNextLazy", "TasksNextFailureLazy"],
    "ai-agents": ["NextAgentsViewLazy"],
    "ai-agents/[key]": ["NextAgentPageLazy", "NextAgentUnavailableLazy"],
  };
  for (const [route, names] of Object.entries(routes)) {
    const dir = `src/app/(v3)/v3/${route}`;
    assert.ok(existsSync(root(`${dir}/loading.tsx`)), `${route}: есть loading.tsx`);
    for (const name of names) assert.match(read(`${dir}/page.tsx`), new RegExp(`<${name}\\b`, "u"), `${route}: страница рисует ${name}`);
  }
  assert.equal(Object.values(routes).flat().length, 8, "восемь входов экранов");
});

test("на сервере код экрана не пришёл, над входом `Suspense` из `loading.tsx` (как на настоящих маршрутах): исходная ошибка слышна серверу (`onError`), оболочка цела (ответ 200), граница уходит браузеру на дорисовку, заглушки `LoadFailed` нет", async () => {
  const { served } = await views();
  assert.equal(Object.keys(served.routed).length, 8);
  for (const [name, render] of Object.entries(served.routed)) {
    const { errors, markup, shellFailed } = await render();
    assert.equal(shellFailed, false, `${name}: оболочку держит Suspense маршрута`);
    assert.equal(errors.length, 1, `${name}: исходная ошибка дошла до журнала сервера`);
    assert.equal(isChunkError(errors[0]), true, name);
    assert.match(markup, /<!--\$!-->/u, `${name}: граница отдана браузеру на дорисовку`);
    assert.match(markup, /Загрузка маршрута/u, `${name}: пока браузер дорисовывает, виден скелет маршрута`);
    assert.doesNotMatch(markup, /v3-load-failed|Не удалось загрузить экран/u, `${name}: на сервере заглушка не рисуется`);
  }
});

test("входы потока «admin» («Настройки», «Маркетинг», «Финансы», «ИИ-агент»): у маршрутов нет `loading.tsx` (он менял бы прежний вид), поэтому границу держит сам вход; код не пришёл — сервер слышит ошибку, оболочка цела, ответ 200, скелет входа виден", async () => {
  for (const kind of ["chunk", "bug"]) {
    const { admin } = await views(kind);
    assert.equal(Object.keys(admin.served).length, 4);
    for (const [name, render] of Object.entries(admin.served)) {
      const { errors, markup, shellFailed } = await render();
      assert.equal(shellFailed, false, `${kind} ${name}: оболочку держит Suspense входа`);
      assert.equal(errors.length, 1, `${kind} ${name}: исходная ошибка дошла до журнала сервера`);
      assert.equal(kind === "chunk" ? isChunkError(errors[0]) : isBugError(errors[0]), true, `${kind} ${name}: сама ошибка, не обёртка`);
      assert.match(markup, /<!--\$!-->/u, `${kind} ${name}: граница отдана браузеру на дорисовку`);
      assert.match(markup, /data-slot="next-screen-loading"/u, `${kind} ${name}: пока браузер дорисовывает, виден скелет входа`);
      assert.doesNotMatch(markup, /v3-load-failed|Не удалось загрузить экран/u, `${kind} ${name}: на сервере заглушка не рисуется`);
    }
  }
  for (const route of ["settings", "marketing", "finance", "ai-agent"]) assert.equal(existsSync(root(`src/app/(v3)/v3/${route}/loading.tsx`)), false, `${route}: без loading.tsx`);
});

test("в браузере код входа потока «admin» не пришёл: строка и «Обновить страницу»; ошибка в `console.error` (ошибка в коде куска уходит выше в границу ошибок — это проверяет стенд Chromium `lazy-failure-client.cjs`: отрисовка без DOM границу ошибок не воспроизводит)", async () => {
  const { admin } = await views();
  for (const [name, render] of Object.entries(admin.screens)) {
    const { result: { markup }, errors } = await inBrowser(render);
    assert.match(markup, /data-testid="v3-load-failed"/u, name);
    assert.match(markup, /<button[^>]*>Обновить страницу<\/button>/u, name);
    assert.equal(errors.length, 1, `${name}: ошибка загрузки записана`);
  }
});

test("на сервере ошибка в коде куска (не `ChunkLoadError`) идёт тем же путём: слышна серверу как есть, оболочка цела", async () => {
  const { served } = await views("bug");
  for (const [name, render] of Object.entries(served.routed)) {
    const { errors, shellFailed } = await render();
    assert.equal(shellFailed, false, name);
    assert.equal(errors.length, 1, name);
    assert.equal(isBugError(errors[0]), true, `${name}: сама ошибка, не обёртка`);
  }
});

test("в браузере ошибка в коде куска не прячется за «проверьте связь»: вход экрана отдаёт её выше (в границу ошибок `error.tsx`), заглушки `LoadFailed` и записи помощника нет", async () => {
  const { screens } = await views("bug");
  assert.equal(Object.keys(screens).length, 8);
  for (const [name, render] of Object.entries(screens)) {
    const { thrown, helper, result } = await inBrowserCatching(render);
    assert.equal(isBugError(thrown), true, `${name}: исходная ошибка ушла выше`);
    assert.equal(result, null, `${name}: ни заглушки, ни разметки`);
    assert.equal(helper.length, 0, `${name}: помощник не писал «не загрузился ленивый кусок», это не обрыв связи`);
  }
});

test("помощник отказа: на сервере бросает любую ошибку как есть; в браузере заглушка и `console.error` только при `ChunkLoadError`, остальное бросает как есть; без тяжёлых зависимостей", async () => {
  const { onLazyFailed } = await import(pathToFileURL(root("src/components/kit/lazy-failure.ts")).href);
  const lost = Object.assign(new Error("Failed to load chunk"), { name: "ChunkLoadError" });
  const bug = new TypeError("x is not a function");
  const fallback = { default: () => null };
  for (const cause of [lost, bug, null, "строка"]) assert.throws(() => onLazyFailed(fallback)(cause), (thrown) => thrown === cause, "сервер: та же ошибка, не обёртка и не заглушка");
  const browser = await inBrowser(async () => onLazyFailed(fallback)(lost));
  assert.equal(browser.result, fallback, "браузер: заглушка, когда код куска не пришёл");
  assert.equal(browser.helper.length, 1, "браузер: одна запись в console.error");
  assert.equal(browser.helper[0].includes(lost), true, "в записи — сама ошибка, со стеком");
  for (const cause of [bug, new Error("ChunkLoadError: похоже на обрыв, но имя другое"), null, undefined, "ChunkLoadError"]) {
    const other = await inBrowserCatching(async () => onLazyFailed(fallback)(cause));
    assert.equal(other.result, null, "браузер: заглушки нет");
    assert.equal(other.thrown, cause, "браузер: ошибка в коде уходит выше как есть (в `(v3)/error.tsx`)");
    assert.equal(other.helper.length, 0, "браузер: записи помощника нет");
  }
  const source = read("src/components/kit/lazy-failure.ts");
  assert.doesNotMatch(source, /^\s*import\s/mu, "файл без импортов: `HelpTip` остаётся лёгким");
  assert.ok(source.split("\n").length <= 150, "файл набора до 150 строк");
  // Все двенадцать мест отказа: четыре заглушки виджетов зовут помощник сами, восемь входов экранов — через `onScreenLoadFailed`.
  for (const path of ["src/components/kit/HelpTip.tsx", "src/components/kit/SectionTabsInPlace.tsx", "src/components/v3/profile/next/CaseHelpCard.tsx", "src/components/v3/profile/next/FeedOverflow.tsx"]) {
    assert.match(read(path), /\.catch\(onLazyFailed\(/u, path);
    assert.match(read(path), /from "@\/components\/kit\/lazy-failure"/u, path);
    assert.doesNotMatch(read(path), /\.catch\(\(\) =>/u, `${path}: отказ не глотается молча`);
  }
  assert.match(read("src/components/kit/LoadFailed.tsx"), /onScreenLoadFailed = onLazyFailed\(LoadFailed\)/u);
  const entries = ["today-next/TodayNextLazy", "requests-next/RequestsNextLazy", "tasks/next/TasksNextLazy", "ai-agents-next/NextAgentsLazy"].map((name) => read(`src/components/v3/${name}.tsx`)).join("\n");
  assert.equal(entries.match(/\.catch\(onScreenLoadFailed\)/gu).length, 8, "восемь входов экранов");
  assert.doesNotMatch(entries, /\.catch\(\(\) =>/u);
});

test("кнопка «Обновить страницу» перезагружает страницу (а не зовёт `reset()`, который старый отказ не лечит)", async () => {
  const { loadFailed } = await views();
  const element = loadFailed();
  const button = element.props.children.find((child) => child?.type === "button");
  let reloads = 0;
  globalThis.window = { location: { reload: () => { reloads += 1; } } };
  try { button.props.onClick(); } finally { delete globalThis.window; }
  assert.equal(reloads, 1);
  assert.match(read("src/components/kit/LoadFailed.tsx"), /^"use client";/u);
  assert.doesNotMatch(read("src/components/kit/LoadFailed.tsx"), /from "(?:@\/components\/ui\/button|@\/lib\/utils|tailwind-merge|class-variance-authority)"/u, "вход каждого экрана не тянет склейку классов");
});

test("заглушка «Ещё N» выглядит как настоящая кнопка: те же классы, что у `Button variant=outline w-fit`", async () => {
  const { outline, feed } = await views();
  assert.equal(outline.constant, outline.real, "строка классов заглушки равна классам настоящей кнопки (цвет, тень, промежуток, min-w, shrink-0)");
  assert.equal(classOf(outline.markup), outline.constant, "и разметка настоящей `Button` несёт эти классы");
  // Пока код панели грузится, рисуется заглушка с этими же классами; она не помечена `data-slot` (по этому её узнают стенды).
  const { result: { first } } = await inBrowser(feed);
  assert.equal(classOf(first), outline.constant, "первая отдача — заглушка с классами настоящей кнопки");
  assert.doesNotMatch(first, /data-slot/u);
  assert.doesNotMatch(read("src/components/v3/profile/next/FeedOverflow.tsx"), /class-variance|tailwind-merge|ui\/button|@\/lib\/utils/u, "заглушка не тянет склейку классов");
});
