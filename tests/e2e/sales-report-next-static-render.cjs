"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Отчёт продаж» в «Новом виде» (`/v3/main?view=sales`, решение владельца 27.10.2026): НАСТОЯЩАЯ страница `main/page.tsx` в настоящей
 * оболочке на СИНТЕТИЧЕСКИХ данных (`sales-report-fixtures.cjs`: имена и суммы выдуманы). Страница сама решает по cookie, какой вид
 * рисовать (`isNextUi`); сервер стенда рисует разметку (async-части страницы дожидается сам), браузер гидратирует её теми же страницами.
 * Серверные действия подменены; Supabase, права и маршрутизатор Next.js стенд не проверяет — проверяются вёрстка, токены, адаптив,
 * клавиатура, доступность и пути «строка → панель записи», «Убрать» / «Вернуть», фильтры, новая продажа, вложенные страницы.
 *
 *   node tests/e2e/sales-report-next-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — страница в четырёх мирах (администратор с cookie — новый вид; без cookie, сотрудник и просмотр
 *       роли с cookie — прежний вид; для tests/ui-next-pipelines.test.mjs).
 *   node tests/e2e/sales-report-next-static-render.cjs --screenshots [outDir]
 *     → снимки на 1440×900, 1280×800 и 390×844 и проверки (JSON-строки; при нарушении код 1). По умолчанию outDir — .impeccable/review
 *       (не коммитится). Нужен Chromium: PLAYWRIGHT_BROWSERS_PATH=<папка с браузерами>.
 */

const { mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

globalThis.__harnessConfig = {
  fixtures: join(__dirname, "sales-report-fixtures.cjs"),
  pages: { "/v3/main": "src/app/(v3)/v3/main/page.tsx" },
  titles: { "/v3/main": "Отчёт продаж" },
};
const { ROOT, bundleHydration, compileCss, fixtures, renderRequest, resolveServer, startServer } = require("./pipelines-next-harness.cjs");

const SEARCH = "view=sales&year=2026&month=9";
const SCENARIOS = {
  "admin-cookie": { ui: "next", actor: "admin" },
  "admin-no-cookie": { ui: null, actor: "admin" },
  "staff-cookie": { ui: "next", actor: "staff" },
  "preview-cookie": { ui: "next", actor: "preview" },
  "staff-no-cookie": { ui: null, actor: "staff" },
  "preview-no-cookie": { ui: null, actor: "preview" },
  // Чтение плана не удалось / плана нет: прежний и новый вид не говорят о плане того, чего не прочли.
  "admin-cookie-management-unavailable": { ui: "next", actor: "admin", rows: "management-unavailable" },
  "admin-no-cookie-management-unavailable": { ui: null, actor: "admin", rows: "management-unavailable" },
  "admin-cookie-no-plan": { ui: "next", actor: "admin", rows: "no-plan" },
};

async function renderJson() {
  const out = [];
  for (const [name, options] of Object.entries(SCENARIOS)) out.push({ name, html: await renderRequest("/v3/main", SEARCH, { rows: "default", ...options }) });
  process.stdout.write(JSON.stringify(out));
}

/**
 * Свойства ленивых входов отчёта (`SalesReportNextLazy`, `SalesFrameNextLazy`), которые настоящая страница отдаёт через границу
 * сервер → клиент: `assertFlightProps` бросает, если среди них есть то, что RSC не сериализует (функции, экземпляры классов).
 */
async function nextProps() {
  const { assertFlightPropsExpanded } = require("./flight-props-expand.cjs");
  const { SalesFrameNextLazy, SalesReportNextLazy } = require(join(ROOT, "src/components/v3/sales-next/SalesNextLazy.tsx"));
  const { setActor } = fixtures;
  const findElement = (node, predicate) => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) { for (const item of node) { const found = findElement(item, predicate); if (found) return found; } return null; }
    if (!node.$$typeof) return null;
    if (predicate(node)) return node;
    for (const value of Object.values(node.props ?? {})) { const found = findElement(value, predicate); if (found) return found; }
    return null;
  };
  const out = {};
  for (const [name, query, lazy] of [["report", SEARCH, SalesReportNextLazy], ["report-record", `${SEARCH}&record=${fixtures.uuid("78787878", 2)}`, SalesReportNextLazy], ["report-edit", `${SEARCH}&record=${fixtures.uuid("78787878", 2)}&edit=true`, SalesReportNextLazy],
    ["managers", `${SEARCH}&mode=managers`, SalesFrameNextLazy], ["import", `${SEARCH}&mode=import`, SalesFrameNextLazy]]) {
    setActor("admin");
    require("next/headers").cookies = async () => ({ get: (key) => (key === "evo_ui" ? { name: key, value: "next" } : undefined) });
    const content = await resolveServer(await require(join(ROOT, "src/app/(v3)/v3/main/page.tsx")).default({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(query))) }));
    const view = findElement(content, (element) => element.type === lazy);
    if (!view) throw new Error(`${name}: the page renders no lazy entry`);
    await assertFlightPropsExpanded(view.props, `${name}: lazy entry`);
    out[name] = Object.keys(view.props).sort();
  }
  process.stdout.write(JSON.stringify(out));
}

if (process.argv.includes("--next-props")) {
  nextProps().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--json")) {
  renderJson().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--screenshots")) {
  require("./sales-report-next-checks.cjs").run({ outDir: (() => {
    const index = process.argv.indexOf("--screenshots");
    const dir = resolve(process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : join(__dirname, "../../.impeccable/review"));
    mkdirSync(dir, { recursive: true });
    return dir;
  })(), bundleHydration, compileCss, fixtures, startServer, SEARCH }).catch((error) => { console.error(error); process.exit(1); });
} else {
  console.error("usage: sales-report-next-static-render.cjs --json | --screenshots [outDir]");
  process.exit(2);
}
