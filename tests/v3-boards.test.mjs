import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BOARD_ROUTES, isBoardRoute } from "../src/lib/v3/board-layout.ts";
import {
  BOARD_PANEL_FOLD_BELOW_PX,
  boardTracks,
  cappedBoardTracks,
} from "../src/components/v3/board/board-tracks.ts";
import { placeMenu } from "../src/components/v3/board/menu-position.ts";

/**
 * Доски на всю ширину (решение владельца 25.09.2026): «Воронка продаж» и
 * «Воронка поступления» без ограничения 1240 px и без прокрутки вбок, рейка
 * меню на досках ниже 1536 px, меню дела в top layer, срок словом и нейтральная
 * «Создать задачу». Чистая логика проверяется напрямую, разметка — настоящим
 * рендером страниц в AppShell с синтетическими данными
 * (tests/e2e/boards-static-render.cjs --json) в отдельном node-процессе.
 * Это не живая проверка Supabase, прав или данных; ширины колонок и
 * отсутствие переполнения измеряет тот же рендер в Chromium (--screenshots).
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/boards-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));

const tag = (html, pattern) => html.match(pattern)?.[0] ?? "";
const classOf = (element) => element.match(/class="([^"]*)"/u)?.[1] ?? "";
const count = (html, pattern) => [...html.matchAll(pattern)].length;

test("board routes are the two pipelines and nothing else", () => {
  assert.deepEqual([...BOARD_ROUTES], ["/v3/pipeline", "/v3/admissions-pipeline"]);
  assert.equal(isBoardRoute("/v3/pipeline"), true);
  assert.equal(isBoardRoute("/v3/admissions-pipeline"), true);
  for (const route of ["/v3/main", "/v3/profile", "/v3/pipeline/x", "/v3/tasks", null, undefined]) {
    assert.equal(isBoardRoute(route), false, String(route));
  }
});

test("board pages have no 1240px cap and are left-aligned; other pages keep it", () => {
  for (const name of ["sales", "admissions"]) {
    const main = tag(surfaces.get(name), /<main[^>]*>/u);
    assert.ok(main, name);
    assert.doesNotMatch(classOf(main), /max-w-\[1240px\]|\bmx-auto\b/u, `${name}: full width, not centred`);
    assert.match(classOf(main), /\bmd:flex-1\b/u, `${name}: fills the height under the top bar`);
  }
  const shell = read("src/components/v3/PartShell.tsx");
  assert.match(shell, /width\?: "wide" \| "narrow" \| "board"/u);
  assert.match(shell, /width === "narrow" \? "max-w-\[860px\]" : "max-w-\[1240px\]"/u, "ordinary pages keep their cap");
  for (const path of ["src/app/(v3)/v3/pipeline/page.tsx", "src/app/(v3)/v3/pipeline/loading.tsx",
    "src/app/(v3)/v3/admissions-pipeline/page.tsx", "src/app/(v3)/v3/admissions-pipeline/loading.tsx"]) {
    assert.match(read(path), /<PartShell\b[^>]*\bwidth="board"/u, path);
  }
});

test("columns are a fluid grid: 6 working stages share the width, «Переданы» is a 44px rail", () => {
  const stages = ["new", "contacting", "qualified", "meeting_scheduled", "meeting_completed", "potential", "handed_off"];
  const fluid = "minmax(0, 1fr)";
  assert.equal(boardTracks(stages, "all", ["handed_off"]), `${Array(6).fill(fluid).join(" ")} 44px`);
  assert.equal(boardTracks(stages, "qualified", ["handed_off"]), `44px 44px ${fluid} 44px 44px 44px 44px`);
  assert.equal(boardTracks(stages, "handed_off", ["handed_off"]), `${Array(6).fill("44px").join(" ")} ${fluid}`);
  assert.equal(cappedBoardTracks(5), "repeat(5, minmax(168px, 360px))");
  assert.equal(cappedBoardTracks(4), "repeat(4, minmax(168px, 360px))");

  // Sales tracks are a custom property read by a container-query class, so an
  // open lead panel can swap them without JS (see the panel test below).
  const salesTracksOf = (name) => surfaces.get(name).match(/data-testid="v3-pipeline-board"[^>]*style="--board-tracks:([^;"]+)/u)?.[1];
  assert.equal(salesTracksOf("sales"), boardTracks(stages, "all", ["handed_off"]));
  assert.equal(salesTracksOf("sales-focus"), boardTracks(stages, "qualified", ["handed_off"]));
  assert.match(tag(surfaces.get("sales"), /<div role="group" aria-label="Воронка продаж"[^>]*>/u), /@6xl:\[grid-template-columns:var\(--board-tracks\)\]/u);
  const tracksOf = (name) => surfaces.get(name).match(/style="grid-template-columns:([^"]+)"/u)?.[1];
  assert.equal(tracksOf("admissions"), cappedBoardTracks(5));
  assert.equal(tracksOf("admissions-visa"), cappedBoardTracks(4));
  for (const source of [read("src/components/v3/Pipeline.tsx"), read("src/components/v3/AdmissionsPipelineBoard.tsx")]) {
    assert.doesNotMatch(source, /w-\[280px\]|\bw-max\b|overflow-x-auto/u, "no fixed 280px columns in a horizontal scroller");
  }
});

test("«Переданы» stays a derived column: a rail with its count that expands via ?stage=handed_off", () => {
  const sales = surfaces.get("sales");
  const rail = tag(sales, /<a[^>]*data-testid="v3-pipeline-rail"[^>]*href="\/v3\/pipeline\?stage=handed_off"[^>]*>[\s\S]*?<\/a>/u);
  assert.match(rail, /Переданы<\/span><span class="t-meta tabular-nums text-fg-3">2<\/span>/u);
  const handed = surfaces.get("sales-handed");
  assert.equal(count(handed, /data-testid="v3-pipeline-rail"/gu), 6, "the working stages fold to rails");
  assert.match(handed, /Алина Переданная/u);
  assert.match(handed, />Все этапы<\/a>/u);
});

test("a focused stage keeps real counts on the folded rails and a way back", () => {
  const focus = surfaces.get("sales-focus");
  assert.equal(count(focus, /data-testid="v3-pipeline-rail"/gu), 6);
  assert.equal(count(focus, /data-testid="v3-pipeline-column"/gu), 1);
  assert.match(focus, /Новый<\/span><span class="t-meta tabular-nums text-fg-3">3<\/span>/u, "the read covers every stage");
  // The stage filter is presentation: the board read is always all stages.
  assert.match(read("src/app/(v3)/v3/pipeline/page.tsx"), /query: query\.q,\s*stage: "all",/u);
});

test("the sidebar folds to a 64px rail on board routes below 1536px and keeps names, state and groups", () => {
  const sales = surfaces.get("sales");
  assert.match(sales, /data-testid="v3-shell"[^>]*data-shell-layout="board"/u);
  const nav = tag(sales, /<nav aria-label="Разделы"[^>]*>/u);
  assert.match(classOf(nav), /\bmd:w-16\b/u);
  assert.match(classOf(nav), /\b2xl:w-\[260px\]/u);
  assert.match(sales, /<span class="min-w-0 md:max-2xl:sr-only">Главная<\/span>/u, "labels stay for assistive tech");
  // Group structure: the expand toggle hides in the rail, a top-layer flyout takes over.
  assert.match(sales, /<button type="button" popoverTarget="[^"]+" aria-label="Продажи" aria-expanded="false" class="hidden [^"]*md:max-2xl:flex/u);
  assert.match(sales, /<div id="[^"]+" popover="auto" role="group" aria-label="Продажи"[^>]*>[\s\S]*?Воронка продаж/u);
  assert.match(sales, /aria-current="page"[^>]*href="\/v3\/pipeline"|href="\/v3\/pipeline"[^>]*aria-current="page"/u, "active item kept");
  // The full logo moves to the top bar while the rail is on.
  assert.match(sales, /class="me-auto hidden [^"]*md:max-2xl:inline-flex"/u);
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /const board = isBoardRoute\(pathname\);/u);
  assert.match(shell, /rail \? "md:w-16 2xl:w-\[260px\]" : "md:w-\[260px\]"/u, "other routes keep the 260px sidebar");
  assert.match(shell, /const RAIL_MEDIA = "\(width >= 48rem\) and \(width < 96rem\)";/u, "hover and focus hints only in the rail range");
  assert.match(shell, /onFocus: \(event\) => showRailHint\(event\.currentTarget, label\)/u, "hint on keyboard focus too");
  assert.match(shell, /onPointerEnter: \(event\) => showRailHint\(event\.currentTarget, label\)/u);
  assert.match(shell, /pointer-events-none fixed start-\[4\.5rem\]/u, "hint escapes the scrolling rail");
});

test("the admissions case menu renders in the top layer and is placed inside the viewport", () => {
  const html = surfaces.get("admissions");
  const triggers = [...html.matchAll(/<button type="button" popoverTarget="([^"]+)" aria-label="Действия с делом"/gu)].map((match) => match[1]);
  assert.equal(triggers.length, 7, "one menu per case on «Поступление» (7 of 12 synthetic cases)");
  for (const id of triggers) {
    assert.match(html, new RegExp(`<div id="${id}" popover="auto" role="group" aria-label="Действия с делом" data-testid="v3-admissions-pipeline-move"`, "u"));
  }
  assert.doesNotMatch(read("src/components/v3/AdmissionsPipelineBoard.tsx"), /<details|absolute right-0 z-20/u);
  assert.doesNotMatch(read("src/components/v3/AdmissionsPipelineBoard.tsx"), /⋯/u, "drawn icon, not a glyph");

  const viewport = { width: 1280, height: 800 };
  const trigger = { top: 300, bottom: 344, left: 500, right: 544 };
  assert.deepEqual(placeMenu(trigger, { width: 256, height: 358 }, viewport, "bottom-end"), { top: 348, left: 288, maxHeight: 784 });
  // Near the bottom the menu opens above the button instead of being cut.
  assert.deepEqual(placeMenu({ ...trigger, top: 700, bottom: 744 }, { width: 256, height: 358 }, viewport, "bottom-end"), { top: 338, left: 288, maxHeight: 784 });
  // Taller than the space above and below: pinned inside the window, scrolls within.
  const tall = placeMenu({ ...trigger, top: 380, bottom: 424 }, { width: 256, height: 900 }, viewport, "bottom-end");
  assert.equal(tall.top, 8);
  assert.equal(tall.maxHeight, 784);
  // Rail flyout: to the right of the icon, never off the left edge.
  assert.deepEqual(placeMenu({ top: 60, bottom: 104, left: 8, right: 56 }, { width: 240, height: 220 }, viewport, "right-start"), { top: 60, left: 64, maxHeight: 784 });
  assert.equal(placeMenu({ top: 10, bottom: 54, left: 0, right: 30 }, { width: 240, height: 220 }, viewport, "bottom-end").left, 8);
});

test("drag is neutral: hover grip and dashed drop highlight, never red", () => {
  const primitive = read("src/components/v3/board/Board.tsx");
  assert.match(primitive, /highlighted && "bg-surface-2 outline-2 -outline-offset-2 outline-dashed outline-control-edge"/u);
  assert.match(primitive, /group-hover:block group-focus-within:block/u);
  assert.match(primitive, /<Icon name="grip-vertical"/u);
  const board = read("src/components/v3/AdmissionsPipelineBoard.tsx");
  assert.doesNotMatch(board, /outline-accent/u);
  assert.match(board, /<BoardGrip \/>/u);
});

test("sales card: full-width name, owner beside the action, due word beside its date", () => {
  const cardsOf = (name) => new Map([...surfaces.get(name).matchAll(/<article data-testid="v3-pipeline-card" data-lead-id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/gu)]
    .map(([, id, body]) => [id.slice(-2), body]));
  const cards = cardsOf("sales");
  const lines = (n) => [...(cards.get(n) ?? "").matchAll(/<p class="([^"]*)">([\s\S]*?)<\/p>/gu)].map(([, className, body]) => ({ className, body }));
  // Line 1 is the name alone, so a narrow 1280px column never cuts it for a due word.
  assert.match(lines("01")[0].body, /^<a [^>]*class="t-item min-w-0 flex-1 truncate[^"]*"[^>]*>Айжан Примерова<\/a>$/u);
  // Line 2: the next action and the owner's initials, full name in the title.
  assert.match(lines("01")[1].body, /Позвонить и уточнить страну<\/span><abbr title="Менеджер Первый" class="shrink-0 no-underline">МП<\/abbr>$/u);
  // Line 3: «прошёл 23.09» (word, then mono ДД.ММ), «сегодня» without a date, then «4 дн.».
  assert.match(lines("01")[2].body, /^<span><span class="t-caption shrink-0 text-danger"><span class="sr-only">срок <\/span>прошёл<\/span> <time dateTime="\d{4}-\d{2}-\d{2}" class="font-mono tabular-nums">\d{2}\.\d{2}<\/time><\/span><span aria-hidden="true"> · <\/span><span title="4 дн\. на стадии">4 дн\.<span class="sr-only"> на стадии<\/span><\/span>$/u);
  assert.match(lines("02")[2].body, /^<time dateTime="\d{4}-\d{2}-\d{2}"><span class="t-caption shrink-0 text-warn"><span class="sr-only">срок <\/span>сегодня<\/span><\/time>/u);
  assert.doesNotMatch(cards.get("04"), /прошёл|сегодня/u, "a later date needs no word");
  assert.match(cards.get("03"), /Без следующего действия/u);
  for (const n of ["01", "02", "03", "04", "05", "06"]) assert.ok(lines(n).length <= 3, `card ${n} has at most 3 lines`);
  assert.doesNotMatch(read("src/components/v3/Pipeline.tsx"), /rounded-full|DUE_MARK/u);
  assert.doesNotMatch(tag(surfaces.get("sales-mine"), /<article data-testid="v3-pipeline-card"[\s\S]*?<\/article>/u), /<abbr/u, "no initials when only «Мои» are shown");
  // A handed-off lead with no action keeps its initials on the name line, not alone on a line.
  const handed = cardsOf("sales-handed").get("13");
  assert.match(handed, /Алина Переданная<\/a><span class="t-meta text-fg-3"><abbr title="Менеджер Первый" class="shrink-0 no-underline">МП<\/abbr><\/span><\/p>$/u);
});

test("focused stage and the lead's stage beside the panel lay cards out in a grid, not 1000px rows", () => {
  const list = tag(surfaces.get("sales-focus"), /data-testid="v3-pipeline-column"[^>]*>[\s\S]*?<ul class="[^"]*"/u);
  assert.match(list, /@6xl:grid @6xl:grid-cols-\[repeat\(auto-fill,minmax\(min\(240px,100%\),1fr\)\)\] @6xl:content-start"$/u);
  assert.equal(count(tag(surfaces.get("sales"), /<div role="group" aria-label="Воронка продаж"[\s\S]*$/u), /auto-fill/gu), 0, "the full board keeps plain columns");
});

test("the lead panel docks beside the board and never covers its own card", () => {
  const panel = surfaces.get("sales-panel");
  const stages = ["new", "contacting", "qualified", "meeting_scheduled", "meeting_completed", "potential", "handed_off"];
  // Six columns of 168px + the «Переданы» rail + gaps + the 400px panel + page padding.
  assert.equal(BOARD_PANEL_FOLD_BELOW_PX, 6 * 168 + 44 + 6 * 8 + 400 + 8 + 48);
  assert.ok(97.5 * 16 >= BOARD_PANEL_FOLD_BELOW_PX, "the container query threshold covers the computed width");
  const board = tag(panel, /<div role="group" aria-label="Воронка продаж"[^>]*>/u);
  assert.match(board, /@6xl:@max-\[97\.5rem\]:\[grid-template-columns:var\(--board-tracks-panel\)\]/u);
  assert.equal(board.match(/--board-tracks-panel:([^;"]+)/u)?.[1], boardTracks(stages, "contacting", ["handed_off"]), "only the lead's stage stays open");
  // Folded columns hide their cards and show a rail that opens the stage and closes the panel.
  const folded = tag(panel, /<section aria-labelledby="[^"]*-new" data-testid="v3-pipeline-column"[\s\S]*?<\/section>/u);
  assert.match(folded, /<header class="[^"]*@6xl:@max-\[97\.5rem\]:hidden">/u);
  assert.match(folded, /<ul class="[^"]*@6xl:@max-\[97\.5rem\]:hidden">/u);
  assert.match(folded, /<a title="Раскрыть этап «Новый»" class="[^"]*hidden @6xl:@max-\[97\.5rem\]:flex flex-1" href="\/v3\/pipeline\?stage=new">/u);
  const own = tag(panel, /<section aria-labelledby="[^"]*-contacting" data-testid="v3-pipeline-column"[\s\S]*?<\/section>/u);
  assert.doesNotMatch(own, /@max-\[97\.5rem\]:hidden/u);
  assert.doesNotMatch(tag(surfaces.get("sales"), /<div role="group" aria-label="Воронка продаж"[^>]*>/u), /board-tracks-panel/u, "no panel, no fold");
  // The panel is a row track on wide screens and a modal sheet below them.
  const dialog = tag(panel, /<dialog [^>]*>/u);
  assert.match(dialog, /open=""/u);
  assert.match(classOf(dialog), /\bfixed inset-y-0 end-0\b[\s\S]*\bopen:flex\b[\s\S]*@6xl:static[\s\S]*@6xl:w-\[400px\]/u);
  assert.match(panel, /<div class="relative flex min-w-0 flex-col @6xl:h-full @6xl:min-h-0 @6xl:flex-row @6xl:gap-2">/u);
  const source = read("src/components/v3/Pipeline.tsx");
  assert.match(source, /const sheet = getComputedStyle\(dialog\)\.position === "fixed";/u, "CSS decides the mode, JS follows it");
  assert.match(source, /if \(sheet\) dialog\.showModal\(\);\s*else dialog\.show\(\);/u);
  assert.match(source, /saved\?\.leadId === selected\.id && saved\.version !== selected\.workflow\.workflowVersion/u, "one «Решение сохранено.» at a time");
});

test("a handed-off lead's panel folds the working stages and opens «Переданы» instead of squeezing six columns", () => {
  // Reached by «Переданы» → card → «Все этапы» (the link keeps ?lead=), a reload or a shared link.
  const panel = surfaces.get("sales-panel-handed");
  const stages = ["new", "contacting", "qualified", "meeting_scheduled", "meeting_completed", "potential", "handed_off"];
  const board = tag(panel, /<div role="group" aria-label="Воронка продаж"[^>]*>/u);
  assert.match(board, /@6xl:@max-\[97\.5rem\]:\[grid-template-columns:var\(--board-tracks-panel\)\]/u);
  assert.equal(board.match(/--board-tracks-panel:([^;"]+)/u)?.[1], boardTracks(stages, "handed_off", ["handed_off"]), "only the lead's stage stays open");
  for (const key of stages.slice(0, 6)) {
    const column = tag(panel, new RegExp(`<section aria-labelledby="[^"]*-${key}" data-testid="v3-pipeline-column"[\\s\\S]*?</section>`, "u"));
    assert.match(column, /<header class="[^"]*@6xl:@max-\[97\.5rem\]:hidden">/u, key);
    assert.match(column, new RegExp(`class="[^"]*hidden @6xl:@max-\\[97\\.5rem\\]:flex flex-1" href="/v3/pipeline\\?stage=${key}">`, "u"), `${key} folds to a rail`);
  }
  // «Переданы»: its rail only while six columns fit beside the panel, a column with the lead's card otherwise.
  const rail = tag(panel, /<a[^>]*data-testid="v3-pipeline-rail"[^>]*data-stage-rail="handed_off"[^>]*>/u);
  assert.match(classOf(rail), /(?:^|\s)hidden @min-\[97\.5rem\]:flex(?:\s|$)/u);
  const handed = tag(panel, /<section aria-labelledby="[^"]*-handed_off" data-testid="v3-pipeline-column"[\s\S]*?<\/section>/u);
  assert.match(classOf(tag(handed, /<section[^>]*>/u)), /(?:^|\s)hidden @6xl:@max-\[97\.5rem\]:flex(?:\s|$)/u);
  assert.match(handed, /<article data-testid="v3-pipeline-card" data-lead-id="dddddddd-3333-4333-8333-000000000013" aria-current="true"/u);
  assert.match(handed, /@6xl:grid @6xl:grid-cols-\[repeat\(auto-fill,minmax\(min\(240px,100%\),1fr\)\)\]/u, "cards in a grid, not one wide row");
  assert.match(tag(panel, /<dialog [^>]*>/u), /data-lead-id="dddddddd-3333-4333-8333-000000000013"/u);
  // Without a panel «Переданы» is only the rail.
  const sales = surfaces.get("sales");
  assert.doesNotMatch(sales, /-handed_off" data-testid="v3-pipeline-column"/u);
  assert.match(classOf(tag(sales, /<a[^>]*data-stage-rail="handed_off"[^>]*>/u)), /(?:^|\s)hidden @6xl:flex(?:\s|$)/u);
  // Closing the panel removes that column: focus falls back to the stage rail, never to <body>.
  assert.match(read("src/components/v3/Pipeline.tsx"), /\(card \?\? rail\)\?\.focus\(\);/u);
});

test("a sales card opens the right panel with the existing decision form; the card has no form", () => {
  const board = surfaces.get("sales");
  assert.doesNotMatch(board, /data-testid="v3-pipeline-decision"/u, "no in-card expanding form");
  assert.doesNotMatch(board, /Для связанных задач сначала назначьте ответственного/u);
  const panel = surfaces.get("sales-panel");
  const aside = tag(panel, /<dialog[^>]*data-testid="v3-pipeline-lead-panel"[\s\S]*<\/dialog>/u);
  assert.ok(aside, "?lead= renders the panel on the server");
  assert.match(aside, /data-lead-id="dddddddd-3333-4333-8333-000000000005" data-testid="v3-pipeline-decision"/u);
  assert.match(aside, /<input type="hidden" name="expected_version" value="3"\/>/u);
  assert.match(aside, /Родители просят сравнить/u, "latest note");
  assert.match(aside, />Задачи по лиду<\/a>/u);
  assert.match(aside, /href="\/v3\/profile\?id=dddddddd-3333-4333-8333-000000000005">Открыть карточку лида/u);
  assert.match(panel, /<article data-testid="v3-pipeline-card" data-lead-id="dddddddd-3333-4333-8333-000000000005" aria-current="true" class="v3-choice /u);
  assert.match(read("src/components/v3/Pipeline.tsx"), /window\.history\.pushState\(null, "", href\)/u, "opening stays client-side and URL-addressable");
});

test("one solid red per board page: the shell «Создать задачу» is neutral", () => {
  for (const name of ["sales", "sales-panel", "admissions"]) {
    const html = surfaces.get(name);
    const create = tag(html, /<a [^>]*href="\/v3\/tasks\?create=staff"[^>]*>/u);
    assert.ok(create, name);
    assert.match(classOf(create), /\bborder-control-edge\b/u);
    assert.doesNotMatch(classOf(create), /\bbg-accent\b/u);
    const solid = [...html.matchAll(/<(?:a|button)\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/(?:a|button)>/gu)]
      .filter(([, className]) => /(?:^|\s)bg-accent(?:\s|$)/u.test(className)).map(([, , text]) => text.replace(/<[^>]+>/gu, "").trim());
    assert.deepEqual(solid, name === "admissions" ? [] : ["Добавить лида"], name);
  }
  assert.match(read("src/components/v3/PipelineDecisionForm.tsx"), /className="inline-flex min-h-11 items-center rounded-ctl bg-fg px-4 text-sm font-semibold text-surface/u);
});

test("one 44px toolbar: no «Стадия» chips, selects apply on change, «Срок» counts come from the read", () => {
  const sales = surfaces.get("sales");
  assert.doesNotMatch(sales, /id="v3-pipeline-filter-stage"|>Сотрудник</u);
  assert.match(sales, /<label class="t-label [^"]*">Ответственный<select/u);
  assert.match(sales, /<optgroup label="Сотрудники">/u);
  const due = tag(sales, /<nav aria-label="Срок"[\s\S]*?<\/nav>/u);
  assert.deepEqual([...due.matchAll(/<a [^>]*>([^<]+)(?:<span class="tabular-nums text-fg-3">(\d+)<\/span>)?<\/a>/gu)].map((match) => [match[1], match[2] ?? null].join(" ").trim()),
    ["Все", "Просрочено 4", "Сегодня 3", "Без действия 3"]);
  // With a due filter only its own number is known — no invented counts.
  const page = read("src/app/(v3)/v3/pipeline/page.tsx");
  assert.match(page, /board\.truncated \? null\s*: query\.due === "all" \? leads\.filter\(\(lead\) => lead\.due === due\)\.length\s*: query\.due === key \? leads\.length\s*: null/u);
  const admissions = surfaces.get("admissions");
  const tabs = tag(admissions, /<nav aria-label="Разделы воронки поступления"[\s\S]*?<\/nav>/u);
  assert.match(tabs, /Поступление<span class="tabular-nums text-fg-3">7<\/span>/u);
  assert.match(tabs, /Виза и выезд<span class="tabular-nums text-fg-3">5<\/span>/u);
  const queues = tag(admissions, /<nav aria-label="Очереди на проверку"[\s\S]*?<\/nav>/u);
  assert.match(queues, /Документы на проверку<span class="tabular-nums text-fg-3">20\+<\/span>/u, "a continued page is a lower bound");
  assert.match(queues, /Комплекты на проверку<span class="tabular-nums text-fg-3">3<\/span>/u);
  assert.match(admissions, /<label class="t-label [^"]*">Страна<select/u);
  assert.match(admissions, /<label class="t-label [^"]*">Куратор<select/u);
});

test("mobile: grouped stage list with empty stages on one line and filters behind «Фильтры»", () => {
  const search = surfaces.get("sales-search");
  assert.match(search, /Пусто: Связались, Квалифицирован, Встреча назначена, Встреча проведена, Потенциальный клиент/u);
  assert.match(search, /class="t-meta text-fg-3 @6xl:hidden">Пусто:/u);
  assert.match(surfaces.get("sales"), /<details class="border-t border-border @6xl:hidden"><summary[^>]*>Переданы/u);
  assert.match(read("src/components/v3/board/BoardToolbar.tsx"), /Фильтры\s*\{activeCount > 0 \? <span className="tabular-nums">\(\{activeCount\}\)<\/span> : null\}/u);
});

test("admissions card shares the sales grammar: words, not pills; curator initials; 3 lines", () => {
  const admissions = surfaces.get("admissions");
  const card = (n) => tag(admissions, new RegExp(`<article [^>]*data-student-case-id="[^"]*${n}"[\\s\\S]*?<div class="absolute end-0\\.5 top-0\\.5">`, "u"));
  assert.match(card("06"), /<span class="min-w-0 flex-1 truncate text-fg-2" title="Малайзия · UCSI University">Малайзия · UCSI University<\/span><abbr title="Куратор Один" class="shrink-0 no-underline">КО<\/abbr>/u);
  assert.match(card("06"), /<span class="t-caption text-danger">просрочено<\/span><span aria-hidden="true" class="text-fg-3"> · <\/span><a draggable="false" class="t-caption text-danger[^"]*" href="\/v3\/messages\?case=[^"]+">нужен ответ<\/a>/u);
  assert.match(card("01"), /<span class="t-caption text-warn">ждёт принятия<\/span>/u);
  for (const n of ["01", "02", "03", "04", "05", "06", "07"]) {
    assert.ok(count(card(n), /<p class=/gu) <= 3, `case ${n} has at most 3 lines`);
  }
  const source = read("src/components/v3/AdmissionsPipelineBoard.tsx");
  assert.doesNotMatch(source, /<Pill\b|Ожидает принятия/u);
  assert.match(source, /const showCurator = query\.curator === null/u);
  assert.equal(count(surfaces.get("admissions-curator"), /<abbr/gu), 0, "no curator initials once «Куратор» is chosen");
  assert.match(source, /<Icon name="chevron-down" size=\{16\} className=\{cn\("shrink-0 text-fg-3", otherOpen && "rotate-180"\)\} \/>/u, "inline disclosure, not a flyout chevron");
  // Queue links: one quiet wrapping line, also on a phone.
  const queues = tag(admissions, /<nav aria-label="Очереди на проверку"[^>]*>/u);
  assert.match(classOf(queues), /^flex flex-wrap items-center gap-x-2$/u);
  assert.match(read("src/app/(v3)/v3/admissions-pipeline/page.tsx"), /const QUEUE_LINK_CLASS =\s*"t-meta inline-flex min-h-11 /u);
});

test("rail mode keeps the 64px top bar: the moved logo is sized to fit", () => {
  assert.match(read("src/components/v3/AppShell.tsx"), /<EvoLogo width=\{100\} \/>/u);
  // 100px wide at 1843×842 is 46px tall: + 2 × 8px padding + 1px border ≤ 64px.
  assert.ok(Math.ceil((100 * 842) / 1843) + 16 + 1 <= 64);
});

test("error copy names no provider and the admissions route has a board skeleton", () => {
  for (const path of ["src/components/v3/AdmissionsPipelineBoard.tsx", "src/components/v3/PipelineDecisionForm.tsx"]) {
    assert.doesNotMatch(read(path), /Supabase недоступен/u, path);
  }
  // `unavailable` can follow a committed write whose receipt was lost: the copy
  // says «не подтверждено», never «не сохранено».
  assert.match(read("src/components/v3/AdmissionsPipelineBoard.tsx"), /unavailable: "Перемещение не подтверждено\. Обновите страницу и проверьте этап\."/u);
  assert.match(read("src/components/v3/PipelineDecisionForm.tsx"), /unavailable: "Изменение не подтверждено\. Повторите\."/u);
  for (const path of ["src/components/v3/AdmissionsPipelineBoard.tsx", "src/components/v3/PipelineDecisionForm.tsx"]) {
    assert.doesNotMatch(read(path), /не сохранено/u, path);
  }
  assert.match(read("src/components/v3/AdmissionsPipelineBoard.tsx"), /Показаны первые 400 дел — уточните поиск\./u);
  assert.ok(existsSync(new URL("../src/app/(v3)/v3/admissions-pipeline/loading.tsx", import.meta.url)));
  assert.match(read("src/app/(v3)/v3/admissions-pipeline/loading.tsx"), /@5xl:grid-cols-\[repeat\(5,minmax\(168px,360px\)\)\]/u);
  // Stage names are the owner's to change: the canonical vocabulary is untouched.
  assert.match(surfaces.get("sales"), />Квалифицирован</u);
});
