import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/v3/TrendChart.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const componentModule = { exports: {} };
new Function("require", "module", "exports", compiled)(require, componentModule, componentModule.exports);
const { TrendChart, trendGrid, trendTicks, TICK_TIERS, SECONDARY_DASH } = componentModule.exports;

function elements(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement(node)) return [];
  return [...(node.type === type ? [node] : []), ...elements(node.props.children, type)];
}

test("empty trend series retains only the two distinct minimum-scale ticks", () => {
  assert.deepEqual(trendGrid([]), { max: 1, grid: [{ value: 0, y: 100 }, { value: 1, y: 0 }] });
  const chart = TrendChart({ series: Object.freeze([]), ticks: Object.freeze([]), caption: "Динамика лидов" });
  const lines = elements(chart, "line");
  assert.deepEqual(lines.map((line) => line.key), ["0", "1"]);
  assert.deepEqual(lines.map((line) => line.props.y1), [100, 0]);
  assert.match(renderToStaticMarkup(chart), /<svg\b/);
});

// Execute the real component and React JSX runtime, without replacing hooks or
// UI boundaries. This checks rendered grid identity/geometry, not browser acceptance.
for (const [peak, expectedTicks] of [
  [0, [0, 1]],
  [1, [0, 1]],
  [2, [0, 1, 2]],
  [3, [0, 2, 3]],
  [10, [0, 5, 10]],
]) {
  test(`trend grid has unique keys, labels and positions at a peak of ${peak}`, () => {
    const series = Object.freeze([
      Object.freeze({ label: "Лиды", values: Object.freeze([0, peak]), emphasis: "primary" }),
      Object.freeze({ label: "Квалифицированы", values: Object.freeze([0, 0]), emphasis: "secondary" }),
      Object.freeze({ label: "Переданы", values: Object.freeze([0, 0]), emphasis: "secondary" }),
    ]);
    const ticks = Object.freeze(["Начало", "Конец"]);
    const before = structuredClone({ series, ticks });
    const chart = TrendChart({ series, ticks, caption: "Динамика лидов" });
    const html = renderToStaticMarkup(chart);
    const lines = elements(chart, "line").filter((line) => line.props.x2 === "100");
    const labels = [...html.matchAll(/data-trend-value="(\d+)"[^>]*top:([\d.]+)%[^>]*>(\d+)</gu)].map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);

    assert.equal(new Set(lines.map((line) => line.key)).size, lines.length, "grid siblings have unique React keys");
    assert.deepEqual(lines.map((line) => line.key), expectedTicks.map(String), "keys retain tick value identity");
    assert.ok(lines.every((line) => line.props.y1 === line.props.y2), "grid lines stay horizontal");
    assert.deepEqual(lines.map((line) => line.props.y1), expectedTicks.map((value) => 100 - value / Math.max(1, peak) * 100));
    // Подпись значения стоит на своей линии (доля высоты), числа не повторяются.
    assert.deepEqual(labels.map(([value]) => value), expectedTicks);
    assert.deepEqual(labels.map(([, top]) => top), lines.map((line) => line.props.y1));
    assert.deepEqual(labels.map(([, , shown]) => shown), labels.map(([value]) => value));
    assert.deepEqual({ series, ticks }, before, "rendering leaves caller arrays unchanged");
  });
}

test("the chart fits its container: SVG stretches, strokes do not, axis labels are 12 px HTML", () => {
  const series = [
    { label: "Пришло лидов", values: [1, 4, 4, 6, 10, 11, 12], emphasis: "primary" },
    { label: "Из них квалифицированы", values: [0, 1, 1, 2, 4, 5, 5], emphasis: "secondary" },
    { label: "Из них переданы", values: [0, 0, 0, 1, 1, 2, 2], emphasis: "secondary" },
  ];
  const html = renderToStaticMarkup(TrendChart({ series, ticks: ["20 сен", "21 сен", "22 сен", "23 сен", "24 сен", "25 сен", "26 сен"], caption: "Лиды" }));
  assert.match(html, /<svg viewBox="0 0 100 100" preserveAspectRatio="none"/u);
  assert.doesNotMatch(html, /min-w-\[|overflow-x-auto/u, "no fixed minimum width and no hidden days behind a scroll");
  assert.equal(html.match(/<path [^>]*vector-effect="non-scaling-stroke"/gu)?.length, 3);
  // Чернила, не красный; серии различаются рисунком линии, а не цветом.
  assert.doesNotMatch(html, /--accent|linearGradient|fill="url/u);
  assert.deepEqual([...html.matchAll(/<path [^>]*stroke-dasharray="([^"]+)"/gu)].map((match) => match[1]), [...SECONDARY_DASH]);
  assert.match(html, /<path [^>]*stroke="var\(--text\)"/u);
  // Легенда — те же рисунки и слова серий; подписи осей — t-meta (12 px).
  assert.deepEqual([...html.matchAll(/<\/svg>([^<]+)<\/li>/gu)].map((match) => match[1]), series.map((one) => one.label));
  assert.equal(html.match(/class="relative h-(?:44|6) t-meta tabular-nums text-fg-3"/gu)?.length, 2);
  assert.match(html, /aria-label="Лиды\. Пришло лидов: 1, 4, 4, 6, 10, 11, 12; /u);
});

// Подписи дат расставляются без наложения на каждой ступени ширины контейнера.
const thinned = (labels) => labels.map((one, index) => (index % Math.max(1, Math.ceil(labels.length / 7)) === 0 ? one : ""));
const days = (first, count, month, withYear) => Array.from({ length: count }, (_, index) =>
  `${first + index} ${month}${withYear && index === 0 ? " 2025" : ""}`);
const widest = (ticks) => trendTicks(ticks).filter((tick) => tick.shown.at(-1));

test("tick placement keeps every thinned label of an ordinary month on a wide chart", () => {
  const ticks = thinned([...days(1, 30, "сен", false)]);
  assert.deepEqual(widest(ticks).map((tick) => tick.label), ["1 сен", "6 сен", "11 сен", "16 сен", "21 сен", "26 сен"]);
  assert.deepEqual(widest(ticks).map((tick) => tick.anchor), ["start", "middle", "middle", "middle", "middle", "middle"]);
});

test("a first label carrying the year drops only its colliding neighbour", () => {
  const month = thinned([...days(26, 6, "дек", true), ...days(1, 24, "янв", false)]);
  assert.deepEqual(widest(month).map((tick) => tick.label), ["26 дек 2025", "5 янв", "10 янв", "15 янв", "20 янв"]);
  const week = [...days(28, 4, "дек", true), ...days(1, 3, "янв", false)];
  assert.deepEqual(widest(week).map((tick) => tick.label), ["28 дек 2025", "30 дек", "31 дек", "1 янв", "2 янв", "3 янв"]);
  assert.equal(widest(week).at(-1).anchor, "end");
});

test("the last label names the end of the period and always stays", () => {
  const ticks = ["1 сен", "", "", "", "", "", "", "", "длинная подпись предпоследнего деления", "30 сен"];
  const placed = trendTicks(ticks);
  for (let tier = 0; tier < TICK_TIERS.length; tier += 1) {
    const shown = placed.filter((tick) => tick.shown[tier]);
    assert.equal(shown.at(-1).label, "30 сен", `tier ${tier}`);
  }
  assert.deepEqual(widest(ticks).map((tick) => tick.index), [0, 9]);
  assert.deepEqual(widest(Object.freeze(["Начало", "Конец"])).map((tick) => tick.label), ["Начало", "Конец"]);
});

test("a week shows every day on a wide chart and every other day on a phone, never overlapping", () => {
  const week = ["20 сен", "21 сен", "22 сен", "23 сен", "24 сен", "25 сен", "26 сен"];
  const ticks = trendTicks(week);
  assert.deepEqual([...TICK_TIERS], [240, 320, 448, 640]);
  assert.deepEqual(ticks.filter((tick) => tick.shown[3]).map((tick) => tick.label), week);
  // Телефон 390: график уже 330 px — ступень 320.
  assert.deepEqual(ticks.filter((tick) => tick.shown[1]).map((tick) => tick.label), ["20 сен", "22 сен", "24 сен", "26 сен"]);
  assert.deepEqual(ticks.map((tick) => tick.at), [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
  // Видимость меняется классами ступеней: без скрипта и без прокрутки.
  const html = renderToStaticMarkup(TrendChart({ series: [{ label: "Лиды", values: [1, 2, 3, 4, 5, 6, 7], emphasis: "primary" }], ticks: week, caption: "Лиды" }));
  // Шаг на каждой ступени ровный: уже 320 px — 20·23·26, телефон 390 — через день, от 640 px — все.
  assert.deepEqual(ticks.filter((tick) => tick.shown[0]).map((tick) => tick.label), ["20 сен", "23 сен", "26 сен"]);
  assert.match(html, /data-trend-tick="1" class="[^"]*\bhidden @min-\[40rem\]\/trend:block"/u);
  assert.match(html, /data-trend-tick="3" class="[^"]*\bblock @min-\[20rem\]\/trend:hidden @min-\[40rem\]\/trend:block"/u);
  assert.match(html, /data-trend-tick="6" class="[^"]*-translate-x-full block"/u);
});
