// «Новый вид» (решение владельца 27.10.2026): ленивые куски. Проверяется, что не пришедший код куска (обрыв связи) не снимает с
// экрана уже нарисованную страницу: «?», «Ещё N», карточка обращений и вкладки на месте остаются заглушкой, а входы экранов
// показывают строку с кнопкой «Обновить страницу»; и что заглушка «Ещё N» выглядит как настоящая кнопка. Код куска «не приходит»:
// модуль, который грузит `lazy` или `next/dynamic`, при загрузке бросает ошибку (как отклонённый `import()` в браузере).
//
//   node --experimental-strip-types --test tests/ui-next-lazy.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");

/** Модули, чей код «не приходит»: то, что грузят ленивые куски и входы экранов. */
const FAILING = /[\\/](HelpTipImpl|FeedOverflowImpl|CaseHelpCardImpl|SectionTabsInPlaceImpl|TodayNextPage|RequestsNextPage|TasksNext|TasksNextFailure|NextAgentsView|NextAgentPage|NextAgentUnavailable)\.tsx$/;

const ENTRY = `
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
export const render = {
  help: () => settle(h(HelpTip, { label: "Пояснение: Тест" }, "Текст пояснения")),
  feed: () => settle(h(FeedOverflow, { count: 3, title: "Лента" }, h("li", null, "строка"))),
  caseHelp: () => settle(h(CaseHelpCard, { initialPage: {} })),
  tabs: () => settle(h("div", { id: "around" }, "до", h(SectionTabsInPlace, { label: "Вкладки", tabs: [{ key: "a", label: "А", content: "один" }] }), "после")),
  screens: Object.fromEntries(Object.entries({ TodayNextLazy, RequestsNextLazy, RequestsNextInvalidLazy, TasksNextLazy, TasksNextFailureLazy, NextAgentsViewLazy, NextAgentPageLazy, NextAgentUnavailableLazy })
    .map(([name, Screen]) => [name, () => settle(h(Screen, {}))])),
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

/** Значение `class` первого элемента разметки (React экранирует `&` и `\'`). */
const classOf = (markup) => markup.match(/ class="([^"]*)"/u)[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'");

test("не пришёл код окна «?»: на месте остаётся та же кнопка с тем же именем, страница не падает", async () => {
  const { markup } = await (await views()).help();
  assert.match(markup, /<button[^>]*aria-label="Пояснение: Тест"[^>]*>\s*<span aria-hidden="true">\?<\/span>/u);
  assert.doesNotMatch(markup, /Текст пояснения/u, "окна нет");
});

test("не пришёл код панели «Ещё N»: остаётся кнопка с тем же именем, а не ошибка на весь экран", async () => {
  const { markup } = await (await views()).feed();
  assert.match(markup, /<button[^>]*aria-label="Ещё 3 в ленте"[^>]*data-testid="v3-feed-overflow"[^>]*>Ещё 3<\/button>/u);
});

test("не пришёл код карточки обращений и вкладок на месте: слова о сбое / пусто, а соседний текст страницы жив", async () => {
  const views_ = await views();
  assert.match((await views_.caseHelp()).markup, /role="alert"[^>]*>Не удалось загрузить обращения студента\. Обновите страницу\./u);
  const tabs = (await views_.tabs()).markup;
  assert.match(tabs, /до.*после/u, "страница вокруг вкладок на месте");
  assert.doesNotMatch(tabs, /role="tablist"/u);
});

test("не пришёл код экрана: каждый вход нового вида показывает строку и кнопку «Обновить страницу», а не ошибку границы", async () => {
  const { screens } = await views();
  for (const [name, render] of Object.entries(screens)) {
    const { markup } = await render();
    assert.match(markup, /data-testid="v3-load-failed"/u, name);
    assert.match(markup, /role="alert"[^>]*>[\s\S]*Не удалось загрузить экран\./u, name);
    assert.match(markup, /<button[^>]*>Обновить страницу<\/button>/u, name);
  }
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
  const { first } = await feed();
  assert.equal(classOf(first), outline.constant, "первая отдача — заглушка с классами настоящей кнопки");
  assert.doesNotMatch(first, /data-slot/u);
  assert.doesNotMatch(read("src/components/v3/profile/next/FeedOverflow.tsx"), /class-variance|tailwind-merge|ui\/button|@\/lib\/utils/u, "заглушка не тянет склейку классов");
});
