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
const { TrendChart } = componentModule.exports;

function elements(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement(node)) return [];
  return [...(node.type === type ? [node] : []), ...elements(node.props.children, type)];
}

test("empty trend series retains only the two distinct minimum-scale ticks", () => {
  const chart = TrendChart({ series: Object.freeze([]), ticks: Object.freeze([]), caption: "Динамика лидов" });
  const grid = elements(chart, "g").filter((group) => elements(group, "line").length === 1);
  assert.deepEqual(grid.map((group) => group.key), ["0", "1"]);
  assert.deepEqual(grid.map((group) => elements(group, "text")[0].props.children), [0, 1]);
  assert.deepEqual(grid.map((group) => elements(group, "line")[0].props.y1), [190, 16]);
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
    const grid = elements(chart, "g").filter((group) => elements(group, "line").length === 1);
    const keys = grid.map((group) => group.key);
    const labels = grid.map((group) => {
      const texts = elements(group, "text");
      assert.equal(texts.length, 1);
      return texts[0].props.children;
    });
    const positions = grid.map((group) => {
      const line = elements(group, "line")[0];
      const label = elements(group, "text")[0];
      assert.equal(line.props.y1, line.props.y2, "grid lines stay horizontal");
      assert.equal(label.props.y, line.props.y1 + 4, "label follows its grid line");
      return line.props.y1;
    });

    assert.equal(new Set(keys).size, keys.length, "grid siblings have unique React keys");
    assert.equal(new Set(labels).size, labels.length, "integer tick labels do not repeat");
    assert.equal(new Set(positions).size, positions.length, "grid lines do not overlap");
    assert.deepEqual(labels, expectedTicks);
    assert.deepEqual(keys, expectedTicks.map(String), "keys retain tick value identity");
    assert.deepEqual(positions, expectedTicks.map((value) => 190 - value / Math.max(1, peak) * 174));
    assert.match(renderToStaticMarkup(chart), /<svg\b/);
    assert.deepEqual({ series, ticks }, before, "rendering leaves caller arrays unchanged");
  });
}
