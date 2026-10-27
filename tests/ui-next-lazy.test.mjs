// «Новый вид» (решение владельца 27.10.2026): ленивые куски. Проверяется, что в браузере не пришедший код куска (обрыв связи) не
// снимает с экрана уже нарисованную страницу: «?», «Ещё N», карточка обращений и вкладки на месте остаются заглушкой, а входы
// экранов показывают строку с кнопкой «Обновить страницу» — и ошибка при этом попадает в `console.error`, а не глотается; что на
// сервере (`typeof window === "undefined"`) та же ошибка уходит дальше — в `(v3)/error.tsx` и журнал сервера, как на `main`: на
// сервере `import()` отклоняется только из-за ошибки в коде (бросок при загрузке модуля), и заглушка скрыла бы её под ответом 200;
// и что заглушка «Ещё N» выглядит как настоящая кнопка. Код куска «не приходит»: модуль, который грузит `lazy` или `next/dynamic`,
// при загрузке бросает ошибку (как отклонённый `import()` в браузере).
//
//   node --experimental-strip-types --test tests/ui-next-lazy.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");

/** Модули, чей код «не приходит»: то, что грузят ленивые куски и входы экранов. */
const FAILING = /[\\/](HelpTipImpl|FeedOverflowImpl|CaseHelpCardImpl|SectionTabsInPlaceImpl|TodayNextPage|RequestsNextPage|TasksNext|TasksNextFailure|NextAgentsView|NextAgentPage|NextAgentUnavailable)\.tsx$/;

const ENTRY = `
import { createElement as h } from "react";
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
 * onShellError (ошибка вне границы Suspense уходит в error.tsx). Ошибка внутри Suspense не бросается: граница отдаётся
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
const entries = { TodayNextLazy, RequestsNextLazy, RequestsNextInvalidLazy, TasksNextLazy, TasksNextFailureLazy, NextAgentsViewLazy, NextAgentPageLazy, NextAgentUnavailableLazy };
export const render = {
  ...Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, () => settle(node())])),
  screens: Object.fromEntries(Object.entries(entries).map(([name, Screen]) => [name, () => settle(h(Screen, {}))])),
  served: {
    ...Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, () => serve(node())])),
    screens: Object.fromEntries(Object.entries(entries).map(([name, Screen]) => [name, () => serve(h(Screen, {}))])),
  },
  loadFailed: LoadFailed,
  outline: { constant: OUTLINE_BUTTON, real: cn(buttonVariants({ variant: "outline", size: "default", className: "w-fit" })), markup: renderToStaticMarkup(h(Button, { variant: "outline", className: "w-fit" }, "x")) },
};
`;

async function views() {
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
          b.onLoad({ filter: FAILING }, () => ({ contents: 'throw new Error("ChunkLoadError: Failed to load chunk");', loader: "js" }));
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
        },
      }],
    });
    return createRequire(root("package.json"))(outfile).render;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CHUNK_ERROR = /ChunkLoadError/u;

/**
 * Рисует «в браузере»: `window` есть (как у `LoadFailed`), `console.error` перехвачен. Помощник ленивого куска решает по
 * `typeof window` при отказе, поэтому `window` держим, пока отрисовка не устоялась. Пакет (`views()`) собирают до этого: при
 * заданном `window` модули Next при загрузке ждут `document`.
 */
async function inBrowser(run) {
  const logged = [];
  const original = console.error;
  globalThis.window = { location: { reload() {} } };
  console.error = (...args) => { logged.push(args); };
  try {
    const result = await run();
    return { result, errors: logged.filter((args) => args.some((arg) => arg instanceof Error && CHUNK_ERROR.test(arg.message))) };
  } finally {
    console.error = original;
    delete globalThis.window;
  }
}

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
    assert.match(errors[0].message, CHUNK_ERROR, name);
    assert.match(markup, /<!--\$!-->/u, `${name}: граница отдана браузеру на дорисовку, а не закрыта заглушкой с ответом 200`);
  }
});

test("на сервере не пришёл код экрана: каждый из восьми входов роняет оболочку исходной ошибкой (в `error.tsx` и журнал), а не отдаёт `LoadFailed` с ответом 200", async () => {
  const { served } = await views();
  assert.equal(Object.keys(served.screens).length, 8);
  for (const [name, render] of Object.entries(served.screens)) {
    const { errors, markup, shellFailed } = await render();
    assert.equal(shellFailed, true, name);
    assert.equal(errors.length, 1, name);
    assert.match(errors[0].message, CHUNK_ERROR, name);
    assert.doesNotMatch(markup, /v3-load-failed|Не удалось загрузить экран/u, name);
  }
});

test("помощник отказа: на сервере бросает исходную ошибку как есть, в браузере пишет её в `console.error` и отдаёт заглушку; без тяжёлых зависимостей", async () => {
  const { onLazyFailed } = await import(pathToFileURL(root("src/components/kit/lazy-failure.ts")).href);
  const cause = new Error("ChunkLoadError: проверка помощника");
  const fallback = { default: () => null };
  assert.throws(() => onLazyFailed(fallback)(cause), (thrown) => thrown === cause, "сервер: та же ошибка, не обёртка");
  const browser = await inBrowser(async () => onLazyFailed(fallback)(cause));
  assert.equal(browser.result, fallback, "браузер: заглушка");
  assert.equal(browser.errors.length, 1, "браузер: ошибка записана в console.error");
  assert.equal(browser.errors[0].includes(cause), true, "в записи — сама ошибка, со стеком");
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
