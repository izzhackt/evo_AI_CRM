"use strict";

// CJS-скрипт: собирает настоящие `RequestsNextView` и `TodayNext` esbuild'ом и гоняет их в Chromium. Серверные действия —
// заглушки, которые записывают отправленные поля и ничего не сохраняют; данные — СИНТЕТИЧЕСКИЕ (люди и заявки выдуманы).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * «Новый вид» «Сегодня» и «Заявок» в браузере (27.10.2026): то, что статический рендер показать не может.
 *
 *   node tests/e2e/ui-next-today-client.cjs [--screenshots <outDir>]
 *
 * «Заявки»: строка и карточка открывают панель адресом `?open=`, панель показывает те же действия («Взять себе», решение
 * по анкете, «Отметить обработанной») с теми же request_id, что сгенерировала страница; Esc закрывает и возвращает фокус
 * на строку; поиск и сортировка; доступность (axe) таблицы и панели.
 * Страницы очереди ведёт сервер: на 30 присланных строках у таблицы нет своих страниц и «из N», только ссылка сервера «Следующая
 * страница»; строка и фокус переживают открытие и закрытие панели (новая выдача сервера не сбрасывает таблицу); почта в панели
 * на телефоне не рвётся посреди домена.
 * «Сегодня»: плитки (один ряд; на телефоне листается вбок) и виджеты, «Показать ещё / Свернуть», завершение задачи на месте с
 * «Отменить», переход плитки к виджету; ↑/↓ работают с «Показать ещё»; на 1440 названия в строках виджета не обрезаны.
 * Сервер здесь — стенд: `router.push` через 120 мс перерисовывает тот же компонент с новым адресом.
 * Нарушение — код выхода 1 и строка с фактами.
 */

const { execFileSync } = require("node:child_process");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "../..");
const probe = require("./side-panel-probe.cjs");

const IDS = `
let serial = 0;
const fresh = () => "99999999-5555-4555-8555-" + String((serial += 1)).padStart(12, "0");
`;

const REQUESTS_ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { PageShell } from "@/components/kit";
import { ManualLeadDisclosure } from "@/components/v3/ManualLeadForm";
import { RequestsNextView } from "@/components/v3/requests-next/RequestsNextView";
import { parseRequestOpen } from "@/lib/requests-queue-contract";
${IDS}
const fixture = JSON.parse(document.getElementById("fixture").textContent);
const root = createRoot(document.getElementById("root"));
window.__pushes = [];
function render(search) {
  const params = new URLSearchParams(search);
  const takeRequestIds = Object.fromEntries(fixture.props.read.queue.rows.flatMap((row) => row.kind === "lead" && row.take ? [[row.leadId, fresh()]] : []));
  const decisionRequestId = fresh();
  window.__ids = { take: takeRequestIds, decision: decisionRequestId };
  root.render(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: "/v3/requests" },
        createElement(SearchParamsContext.Provider, { value: params },
          createElement(ManualLeadDisclosure, null,
            createElement(PageShell, { title: "Заявки" },
              createElement(RequestsNextView, { ...fixture.props, open: parseRequestOpen(params.get("open")), takeRequestIds, decisionRequestId })))))));
}
const router = {
  push(href) { window.__pushes.push(href); setTimeout(() => render(new URL(href, "http://x").search), 120); },
  refresh() { window.__refreshes = (window.__refreshes || 0) + 1; },
  replace() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {},
};
render(fixture.search);
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

const TODAY_ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { PageShell } from "@/components/kit";
import { TodayNext } from "@/components/v3/today-next/TodayNext";
const fixture = JSON.parse(document.getElementById("fixture").textContent);
const router = { push() {}, refresh() { window.__refreshes = (window.__refreshes || 0) + 1; }, replace() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
createRoot(document.getElementById("root")).render(
  createElement(AppRouterContext.Provider, { value: router },
    createElement(PathnameContext.Provider, { value: "/v3/main" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams("") },
        createElement(PageShell, { title: "Сегодня" }, createElement(TodayNext, fixture.props))))));
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
`;

/** Серверные действия в браузере: записывают отправленные поля, ничего не сохраняют. */
const ACTIONS = {
  updatePlatformSalesWorkflowAction: '(window.__takes ||= []).push(Object.fromEntries(arguments[1])); return { status: "stale", requestId: arguments[1].get("request_id"), version: arguments[0].version, changedAt: null };',
  decideStudentApplicationAction: '(window.__decisions ||= []).push(Object.fromEntries(arguments[1])); return { status: "conflict", requestId: arguments[1].get("request_id") };',
  handlePortalConsultationAction: '(window.__handled ||= []).push(arguments[0]); return { status: "handled" };',
  mutateStaffTaskAction: '(window.__tasks ||= []).push(Object.fromEntries(arguments[1])); return { status: "saved", requestId: arguments[0].requestId, taskId: arguments[1].get("id"), version: "9" };',
};

const stubs = {
  name: "ui-next-today-stubs",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? key : undefined) });", loader: "js" }));
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
      const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
      return {
        contents: names.map((name) => `export async function ${name}() { ${ACTIONS[name] ?? `throw new Error("ui-next client: server action ${name} is not available");`} }`).join("\n"),
        loader: "ts",
      };
    });
  },
};

async function bundle(entry, outFile, name) {
  await require("esbuild").build({
    stdin: { contents: entry, resolveDir: ROOT, sourcefile: `${name}-entry.js`, loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [probe.linkShim(ROOT), stubs], logLevel: "error",
  });
}

async function compileCss() {
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const globalsPath = join(ROOT, "src/app/globals.css");
  const result = await postcss([tailwind({ base: ROOT, optimize: false })]).process(readFileSync(globalsPath, "utf8"), { from: globalsPath });
  const fonts = ["golos-text", "jetbrains-mono"].map((font) => {
    const dir = join(ROOT, "node_modules/@fontsource-variable", font);
    return readFileSync(join(dir, "wght.css"), "utf8").replaceAll("url(./files/", `url(${pathToFileURL(join(dir, "files")).href}/`);
  });
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8")].join("\n");
}

function writePage(outDir, name, css, bundleName, fixture) {
  const path = join(outDir, `${name}.html`);
  writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Новый вид (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div class="v3-world" data-surface="staff" data-ui="next"><div id="root"></div></div><script type="application/json" id="fixture">${JSON.stringify(fixture).replaceAll("<", "\\u003c")}</script><script src="${bundleName}"></script></body></html>`);
  return path;
}

const harness = (script) => JSON.parse(execFileSync(process.execPath, [join(__dirname, script), "--next-props"], { maxBuffer: 64 * 1024 * 1024 }));

const VIEWPORTS = {
  d1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  m390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf("--screenshots");
  const outDir = resolve(outArg >= 0 && args[outArg + 1] ? args[outArg + 1] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const requests = harness("requests-static-render.cjs");
  const today = harness("today-static-render.cjs");
  // Группа «Ждут вас» из девяти строк: «Показать ещё» и «Свернуть» (клоны строк с другими ключами).
  const longToday = structuredClone(today.admin);
  const waiting = longToday.queue.bands.find((band) => band.band === "waiting");
  const extra = Array.from({ length: 4 }, (_, index) => ({ ...waiting.items[index % waiting.items.length], key: `${waiting.items[index % waiting.items.length].key}:copy${index}`, title: `Копия ${index + 1}: ${waiting.items[index % waiting.items.length].title}` }));
  waiting.items = [...waiting.items, ...extra];

  // Страница сервера в 30 строк со ссылкой «Следующая страница»: 9 строк стенда и 21 копия лида с другими id и именами.
  const longRequests = structuredClone(requests["next-populated"]);
  const baseLead = longRequests.read.queue.rows.find((row) => row.kind === "lead" && row.take);
  const clones = Array.from({ length: 21 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    const id = `eeeeeeee-4444-4444-8444-0000000000${n}`;
    return { ...baseLead, id, leadId: id, personName: `Клон ${n} Тестов`, occurredAt: new Date(Date.parse(baseLead.occurredAt) - (index + 1) * 3_600_000).toISOString() };
  });
  longRequests.read.queue.rows = [...longRequests.read.queue.rows, ...clones];
  const lastClone = clones.at(-1);
  longRequests.read.queue.nextCursor = { source: "all", status: "all", limit: 50, v: 3, direction: "next", timestamp: lastClone.occurredAt, kind: "lead", id: lastClone.id };

  await bundle(REQUESTS_ENTRY, join(outDir, "ui-next-requests-bundle.js"), "requests");
  await bundle(TODAY_ENTRY, join(outDir, "ui-next-today-bundle.js"), "today");
  const css = await compileCss();
  const pages = {
    requests: writePage(outDir, "ui-next-requests", css, "ui-next-requests-bundle.js", { props: requests["next-populated"], search: "status=all" }),
    requestsOpen: writePage(outDir, "ui-next-requests-open", css, "ui-next-requests-bundle.js", { props: requests["next-populated"], search: `status=all&open=${encodeURIComponent(`application:${requests["next-populated"].read.queue.rows.find((row) => row.kind === "application").id}`)}` }),
    requestsLong: writePage(outDir, "ui-next-requests-long", css, "ui-next-requests-bundle.js", { props: longRequests, search: "status=all" }),
    requestsMissing: writePage(outDir, "ui-next-requests-missing", css, "ui-next-requests-bundle.js", { props: requests["next-populated"], search: "status=all&open=lead:99999999-0000-4000-8000-000000000999" }),
    today: writePage(outDir, "ui-next-today-page", css, "ui-next-today-bundle.js", { props: longToday }),
  };

  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => {
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail: ok ? undefined : detail }));
  };
  const open = async (htmlPath, key) => {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  };
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const axe = async (page, label, include) => {
    const result = await new AxeBuilder({ page }).include(include).analyze();
    report(`${label}: axe`, result.violations.length === 0, result.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`));
  };

  // --- «Заявки» --------------------------------------------------------------------------------------------------
  const rows = requests["next-populated"].read.queue.rows;
  const ofKind = (kind) => rows.find((row) => row.kind === kind && (kind !== "lead" || row.take));
  const lead = ofKind("lead");
  const application = rows.find((row) => row.kind === "application" && row.application.status === "pending");
  const consultation = rows.find((row) => row.kind === "consultation" && row.consultation.status === "requested");
  for (const key of ["d1440", "m390"]) {
    const { context, page, errors } = await open(pages.requests, key);
    const wide = key === "d1440";
    const visibleRows = wide ? page.locator("[data-slot=table] tbody tr") : page.locator("[data-slot=data-table-cards] > li");
    report(`${key}: requests list shows every row`, (await visibleRows.count()) === rows.length, await visibleRows.count());
    report(`${key}: panel closed at start`, (await page.getByRole("dialog").count()) === 0, null);
    await shot(page, `rn-table-${key}`);
    await axe(page, `${key}: requests table`, "main");

    // Открыть запись нажатием на строку (1440: ячейка источника; 390: свободное место карточки) — панель сразу, содержимое с «сервера».
    const openRow = async (name) => {
      const row = wide ? page.locator("[data-slot=table] tbody tr", { hasText: name }) : page.locator("[data-slot=data-table-cards] > li", { hasText: name });
      if (wide) await row.locator("td").nth(1).click(); else await row.locator("button").first().click({ position: { x: 8, y: 8 } });
      await page.getByRole("dialog").waitFor();
      return row;
    };
    const closeBy = async (how) => {
      if (how === "esc") await page.keyboard.press("Escape"); else await page.getByRole("button", { name: "Закрыть" }).first().click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      // Radix возвращает фокус отложенным вызовом (setTimeout 0) уже после снятия панели: без анимации проверка стояла бы раньше него.
      await page.waitForTimeout(80);
    };

    // Лид: «Взять себе» в панели — те же поля и тот же request_id, что выдала страница; стенд отвечает «Лид уже изменён».
    const leadRow = await openRow(lead.personName);
    report(`${key}: lead panel is in the staff world and opaque`, await page.evaluate(() => {
      const element = document.querySelector("[data-slot=sheet-content]");
      return Boolean(element && element.closest('.v3-world[data-ui="next"]') && !/rgba\(0, 0, 0, 0\)|transparent/u.test(getComputedStyle(element).backgroundColor));
    }), null);
    report(`${key}: row click pushes ?open= address`, (await page.evaluate(() => window.__pushes.at(-1) ?? "")).includes(`open=lead%3A${lead.id}`), await page.evaluate(() => window.__pushes));
    await page.locator("[data-testid=requests-detail-panel]").waitFor();
    const dialog = page.getByRole("dialog");
    report(`${key}: lead panel has title and contact facts`, (await dialog.getByRole("heading", { name: lead.personName }).count()) === 1 && (await dialog.getByText("Ответственный").count()) >= 1, null);
    await shot(page, `rn-sheet-lead-${key}`);
    // Почта — одной строкой: на телефоне значения панели идут столбцом, а не в две колонки по ~170 px.
    const emailLines = await dialog.locator("dd", { hasText: lead.email }).first().evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    });
    report(`${key}: lead email stays on one line in the panel`, emailLines === 1, emailLines);
    await axe(page, `${key}: lead panel`, "[role=dialog]");
    await dialog.getByRole("button", { name: "Взять себе" }).click();
    await dialog.getByRole("alert").waitFor();
    const taken = await page.evaluate(() => ({ takes: window.__takes, ids: window.__ids }));
    report(`${key}: "Взять себе" in panel posts the lead and the page's request_id`, taken.takes?.length === 1 && taken.takes[0].lead_id === lead.leadId && taken.takes[0].request_id === taken.ids.take[lead.leadId], taken);
    report(`${key}: stale answer is shown as a warning in the panel`, (await dialog.getByRole("alert").innerText()).includes("Лид уже изменён"), await dialog.getByRole("alert").innerText());
    await closeBy("esc");
    const lastPush = await page.evaluate(() => window.__pushes.at(-1) ?? "");
    report(`${key}: Esc pushes the list address`, lastPush.startsWith("/v3/requests") && !lastPush.includes("open="), lastPush);
    if (wide) report(`${key}: focus returns to the row after Esc`, await leadRow.evaluate((element) => element === document.activeElement), await page.evaluate(() => document.activeElement && document.activeElement.tagName));

    // Анкета: ответы и решение — та же форма с тем же request_id страницы.
    await openRow(`${application.application.questionnaire.firstName} ${application.application.questionnaire.lastName}`);
    await page.getByRole("form", { name: "Решение по заявке" }).waitFor();
    report(`${key}: application panel shows answers and the verification warning`, (await dialog.getByText("Сведения со слов поступающего, их нужно проверить.").count()) === 1 && (await dialog.getByText("Заполнено поступающим").count()) >= 1, null);
    await shot(page, `rn-sheet-application-${key}`);
    await axe(page, `${key}: application panel`, "[role=dialog]");
    await page.getByRole("form", { name: "Решение по заявке" }).getByRole("button", { name: "Одобрить и открыть кабинет" }).click();
    await page.waitForFunction(() => (window.__decisions || []).length === 1);
    const decided = await page.evaluate(() => ({ decisions: window.__decisions ?? [], ids: window.__ids }));
    report(`${key}: decision form posts the application and the page's request_id`, decided.decisions.length === 1 && decided.decisions[0].application_id === application.id && decided.decisions[0].request_id === decided.ids.decision, decided);
    await closeBy("button");

    // Консультация: единственное действие «Отметить обработанной».
    await openRow(consultation.consultation.studentName);
    await page.locator("[data-testid=requests-detail-panel]").waitFor();
    report(`${key}: consultation panel has its action`, (await dialog.getByRole("button", { name: "Отметить обработанной" }).count()) === 1, null);
    await shot(page, `rn-sheet-consultation-${key}`);
    await closeBy("esc");

    // Поиск и сортировка по загруженным строкам.
    const search = page.getByRole("searchbox", { name: "Найти на странице" });
    await search.fill(lead.personName.split(" ")[0]);
    report(`${key}: search narrows the rows`, (await visibleRows.count()) === 1, await visibleRows.count());
    await search.fill("");
    if (wide) {
      await page.getByRole("button", { name: "Заявка" }).click();
      const first = await visibleRows.first().locator("td").first().innerText();
      const names = rows.map((row) => row.personName).sort((a, b) => a.localeCompare(b, "ru"));
      report(`${key}: sort by name`, first.trim() === names[0] || first.trim().startsWith(names[0].slice(0, 6)), { first, expected: names[0] });
    }
    report(`${key}: console clean`, errors.length === 0, errors);
    await context.close();
  }

  // Клавиатура: строка → Enter → панель → Esc → фокус на строке.
  {
    const { context, page, errors } = await open(pages.requests, "d1440");
    const row = page.locator("[data-slot=table] tbody tr").first();
    await row.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    report("d1440: focus is inside the panel", await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest("[role=dialog]"))), null);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForTimeout(80);
    report("d1440: focus returns to the row (keyboard)", await row.evaluate((element) => element === document.activeElement), await page.evaluate(() => document.activeElement && document.activeElement.tagName));
    report("d1440: console clean (keyboard)", errors.length === 0, errors);
    await context.close();
  }
  // Страницы ведёт сервер: у таблицы нет своих страниц, «из N» и второй «Следующая страница»; строка и фокус переживают панель.
  for (const key of ["d1440", "m390"]) {
    const { context, page, errors } = await open(pages.requestsLong, key);
    const wide = key === "d1440";
    const visible = wide ? page.locator("[data-slot=table] tbody tr") : page.locator("[data-slot=data-table-cards] > li");
    report(`${key}: server page shows all 30 loaded rows`, (await visible.count()) === 30, await visible.count());
    report(`${key}: the table has no pager of its own`, (await page.locator("[data-slot=data-table-pagination]").count()) === 0 && (await page.getByLabel("Строк на странице").count()) === 0, null);
    report(`${key}: only the server link «Следующая страница» exists`, (await page.getByRole("link", { name: "Следующая страница" }).count()) === 1 && (await page.getByRole("button", { name: /страница/u }).count()) === 0, await page.getByRole("button", { name: /страница/u }).count());
    report(`${key}: no «из N» counter over the loaded rows`, !/\d+–\d+ из \d+/u.test(await page.locator("main").innerText()), null);
    const row = wide ? page.locator("[data-slot=table] tbody tr", { hasText: "Клон 21 Тестов" }) : page.locator("[data-slot=data-table-cards] > li", { hasText: "Клон 21 Тестов" });
    if (wide) await row.locator("td").nth(1).click(); else await row.locator("button").first().click({ position: { x: 8, y: 8 } });
    await page.getByRole("dialog").waitFor();
    await page.waitForFunction(() => window.__pushes.length === 1);
    await page.waitForTimeout(200); // стенд перерисовал страницу новой выдачей: те же строки, новый массив
    report(`${key}: rows behind the panel are still 30 after the server re-render`, (await visible.count()) === 30, await visible.count());
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForTimeout(300);
    report(`${key}: the opened row is still rendered after the panel closes`, (await row.count()) === 1 && (await visible.count()) === 30, await visible.count());
    if (wide) report(`${key}: focus returns to the opened row (long page)`, await row.evaluate((element) => element === document.activeElement), await page.evaluate(() => document.activeElement && document.activeElement.tagName));
    report(`${key}: console clean (long page)`, errors.length === 0, errors);
    await shot(page, `rn-long-${key}`);
    await context.close();
  }
  // Адрес с открытой записью открывает панель сразу; запись, которой нет в списке, панель не открывает.
  {
    const { context, page, errors } = await open(pages.requestsOpen, "d1440");
    report("d1440: ?open= opens the panel at load", (await page.getByRole("dialog").count()) === 1 && (await page.getByRole("form", { name: "Решение по заявке" }).count()) === 1, null);
    report("d1440: console clean (?open=)", errors.length === 0, errors);
    await context.close();
    const missing = await open(pages.requestsMissing, "d1440");
    report("d1440: ?open= for a record not in the list opens nothing", (await missing.page.getByRole("dialog").count()) === 0, null);
    await missing.context.close();
  }

  // --- «Сегодня» -------------------------------------------------------------------------------------------------
  for (const key of ["d1440", "m390"]) {
    const { context, page, errors } = await open(pages.today, key);
    const bands = longToday.queue.bands;
    const tiles = page.locator("[data-slot=stat-tile]");
    report(`${key}: a tile per band`, (await tiles.count()) === bands.length, await tiles.count());
    const tileTexts = await tiles.allInnerTexts();
    const honest = bands.every((band, index) => band.count === null ? /—|нет данных/u.test(tileTexts[index]) : tileTexts[index].includes(String(band.count)));
    report(`${key}: tile numbers equal the read counts ("—" when unknown)`, honest, { tileTexts, counts: bands.map((band) => band.count) });
    await shot(page, `tn-page-${key}`, { fullPage: true });
    // Плитки — один ряд; на телефоне он листается вбок и не уводит строки ниже первого экрана.
    const tileTops = await tiles.evaluateAll((elements) => [...new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top)))]);
    report(`${key}: tiles stand in one row`, tileTops.length === 1, tileTops);
    if (key === "m390") {
      const row = await page.getByTestId("today-tiles").evaluate((element) => ({ scrolls: element.scrollWidth > element.clientWidth, height: element.getBoundingClientRect().height, firstWidgetTop: document.getElementById("today-band-overdue").getBoundingClientRect().top + window.scrollY, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      report(`${key}: tile row scrolls sideways, is compact and the page does not`, row.scrolls && row.height < 110 && row.firstWidgetTop < 380 && row.page <= 0, row);
    }
    // Названия в строках виджета не обрезаны, строка двухстрочная (три колонки: знак, текст, действие), «ещё одна строка» не растёт.
    {
      const audit = await page.evaluate(() => [...document.querySelectorAll("[data-today-queue] [data-queue-row]")].map((row) => {
        const title = row.querySelector("a[data-queue-open][title], p[title]");
        const meta = row.querySelector("p.t-meta.flex");
        return {
          key: row.getAttribute("data-queue-row"),
          clipped: Boolean(title && (title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1)),
          columns: getComputedStyle(row).gridTemplateColumns.trim().split(/\s+/u).length,
          metaHeight: meta ? Math.round(meta.getBoundingClientRect().height) : 0,
          facts: 1 + (meta ? [...meta.children].filter((child) => child.getClientRects().length > 0).length : 0),
        };
      }));
      report(`${key}: no widget row title is clipped`, audit.every((row) => !row.clipped), audit.filter((row) => row.clipped));
      report(`${key}: widget rows use the stacked three-column layout`, audit.every((row) => row.columns === 3), audit.filter((row) => row.columns !== 3));
      // Вторая строка — одна на 1440 (виджет ~556 px); на телефоне части переносятся целиком, и это штатно.
      if (key === "d1440") report(`${key}: widget row meta is a single line`, audit.every((row) => row.metaHeight <= 30), audit.filter((row) => row.metaHeight > 30));
      console.log(JSON.stringify({ check: `${key}: widget rows with more than 4 data pieces (informational)`, rows: audit.filter((row) => row.facts > 4).map((row) => row.key) }));
    }
    await axe(page, `${key}: today`, "main");
    // «Показать ещё»: длинная группа показывает пять строк, остальные — за кнопкой.
    const widget = page.locator("#today-band-waiting");
    const total = waiting.items.length;
    const more = `Показать ещё ${total - 5}`;
    report(`${key}: long group shows 5 rows and the button`, (await widget.locator("[data-queue-row]").count()) === 5 && (await widget.getByRole("button", { name: more }).count()) === 1, await widget.locator("[data-queue-row]").count());
    // ↑ с кнопки «Показать ещё»: клавиатура очереди продолжает со строки, как у прежней ленты.
    await widget.getByRole("button", { name: more }).focus();
    await page.keyboard.press("ArrowUp");
    report(`${key}: ArrowUp from "Показать ещё" moves focus to a row`, await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest("[data-queue-row]"))), await page.evaluate(() => document.activeElement && (document.activeElement.getAttribute("aria-label") || document.activeElement.tagName)));
    await widget.getByRole("button", { name: more }).click();
    await page.waitForTimeout(100);
    report(`${key}: expanded shows all ${total} and moves focus to the 6th row`, (await widget.locator("[data-queue-row]").count()) === total && (await page.evaluate(() => document.activeElement && document.activeElement.closest("[data-queue-row]")?.dataset.queueRow)) === (await widget.locator("[data-queue-row]").nth(5).getAttribute("data-queue-row")), null);
    await widget.getByRole("button", { name: "Свернуть" }).click();
    report(`${key}: collapse returns to 5 rows`, (await widget.locator("[data-queue-row]").count()) === 5, null);
    // Завершение задачи на месте и «Отменить» (настоящие useRecentCompletions и UndoToast).
    const circle = page.getByRole("button", { name: /^Завершить: / }).first();
    const title = (await circle.getAttribute("aria-label")).replace("Завершить: ", "");
    await circle.click();
    await page.getByRole("button", { name: "Отменить" }).waitFor();
    const done = await page.evaluate(() => window.__tasks);
    report(`${key}: completing a task posts status done`, done?.length === 1 && done[0].status === "done", done);
    report(`${key}: undo toast names the task`, (await page.getByText(`Задача «${title}» завершена.`).count()) >= 1, null);
    await page.getByRole("button", { name: "Отменить" }).click();
    await page.waitForFunction(() => (window.__tasks || []).length === 2);
    const undone = await page.evaluate(() => window.__tasks);
    report(`${key}: undo posts the previous status`, undone[1].status === "open", undone);
    // Плитка ведёт к виджету.
    const targets = await tiles.evaluateAll((elements) => elements.map((element) => ({ href: element.getAttribute("href"), found: Boolean(document.getElementById((element.getAttribute("href") || "").slice(1))) })));
    report(`${key}: every tile links to its widget on the page`, targets.length === bands.length && targets.every((target) => target.href?.startsWith("#today-band-") && target.found), targets);
    report(`${key}: console clean (today)`, errors.length === 0, errors);
    await context.close();
  }
  // Частичное чтение и пустой день: честные состояния на месте.
  for (const [name, props] of [["partial", today.partial], ["empty-admissions", today["empty-admissions"]]]) {
    const path = writePage(outDir, `ui-next-today-${name}`, css, "ui-next-today-bundle.js", { props });
    const { context, page, errors } = await open(path, "d1440");
    if (name === "partial") {
      report("d1440: partial read keeps the notice visible", (await page.getByTestId("today-notices").count()) === 1 && (await page.getByTestId("today-notices").getAttribute("role")) !== null, null);
      const unknown = props.queue.bands.filter((band) => band.count === null).length;
      report("d1440: partial read shows — for unknown counts", (await page.locator("[data-slot=stat-tile]", { hasText: "нет данных" }).count()) === unknown, unknown);
    } else {
      report("d1440: empty day says so", (await page.getByText("На сегодня всё").count()) === 1, null);
    }
    await shot(page, `tn-page-${name}-d1440`);
    report(`d1440: console clean (${name})`, errors.length === 0, errors);
    await context.close();
  }
  await browser.close();
  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
