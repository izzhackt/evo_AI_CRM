"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Клиентская часть проверки вкладок «Нового вида» (`card-tabs-next-static-render.cjs --screenshots`): настоящие клиентские куски в
 * Chromium без сервера Next. Сборка esbuild; серверные действия (`*-actions`) заменены заглушкой «недоступно»: они здесь не
 * вызываются, проверяется то, что делает сам вид:
 *  - «Что происходило» - десять событий на странице и панель «Ещё N» (внутри корня staff CRM, Esc, возврат фокуса);
 *  - «Договор и оплата» - «⋯» листа в шапке карточки сводки, панели карточками, якорь адреса, «Закрыть», возврат фокуса;
 *  - «Документы» - карточка «Чек-лист» с «?», кнопка «Документ» раскрывает формы, раскрытия в рамке карточки.
 */

const { writeFileSync } = require("node:fs");

const LINK_SHIM = `
const React = require("react");
function Link(props) {
  const rest = {};
  for (const [key, value] of Object.entries(props)) if (!["prefetch", "scroll", "replace", "shallow", "passHref", "legacyBehavior", "onNavigate"].includes(key)) rest[key] = value;
  return React.createElement("a", rest);
}
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;
`;
const ACTION_STUB = `module.exports = new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : async () => ({ status: "unavailable" })) });`;

const WRAP = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const h = React.createElement;
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
function mount(node) {
  createRoot(document.getElementById("root")).render(h(AppRouterContext.Provider, { value: router },
    h("div", { className: "v3-world", "data-surface": "staff", "data-ui": "next" }, h("main", { className: "mx-auto max-w-[1000px] p-4" }, node))));
  requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "true"; }));
}
`;

const ENTRIES = {
  history: `${WRAP}
const { HistoryNext } = require("@/components/v3/profile/next/tabs/HistoryNext");
const events = Array.from({ length: 13 }, (_, index) => ({ id: "e" + index, transition: index % 2 ? "task.create" : "case.next.action.change", role: "", at: null,
  href: index === 2 ? "#case-source" : "/v3/profile?case=x&tab=overview", changedFields: [], targetKind: "overview", occurredAt: "2026-09-" + String(22 - index).padStart(2, "0") + "T05:10:00.000Z" }));
mount(h("div", null, h("section", { id: "case-source" }, "Источник (цель ссылки)"),
  h(HistoryNext, { profile: { leadId: null, person: "X", email: null, phone: null, student: true, stage: null, caseStatus: "active", source: "website", qualification: null,
    arrived: "01.09.2026", nextAction: null, nextActionAt: null, handoff: null, applications: [], visa: [], financeStop: null, timeline: events,
    timelineOlderHref: "/v3/profile?case=x&tab=history&activity_before_at=a&activity_before_id=b", timelineLatestHref: null } })));
`,
  money: `${WRAP}
const { CaseMoneySection, CaseMoneyPanel, CaseMoneyOpen } = require("@/components/v3/profile/CaseMoney");
const { MoneyCard } = require("@/components/v3/profile/next/tabs/MoneyCard");
const panels = [{ id: "money-contract", label: "Подготовка договора по шаблону" }, { id: "money-stops", label: "Стопы" }, { id: "money-obligations", label: "Обязательства" }];
mount(h(CaseMoneySection, { nextUi: true, panels, contractCaseId: "case-1" },
  h(MoneyCard, null, h("p", null, "Сводка"), h(CaseMoneyOpen, { panel: "money-stops" }, "Стопы")),
  h(CaseMoneyPanel, { id: "money-contract", label: "Подготовка договора по шаблону" }, h("p", null, "Форма договора")),
  h(CaseMoneyPanel, { id: "money-obligations", label: "Обязательства", help: "Услуги EVO и другие расходы по делу." }, h("p", null, "Обязательства")),
  h(CaseMoneyPanel, { id: "money-stops", label: "Стопы" }, h("p", { id: "stops-body" }, "Форма стопов"))));
`,
  documents: `${WRAP}
const { ProfileDocumentsClient } = require("@/components/v3/profile/ProfileDocumentsClient");
const { ProgressBar } = require("@/components/v3/blocks/ProgressBar");
const groups = window.__DOCS;
mount(h(ProfileDocumentsClient, { nextUi: true, groups: groups.filter((g) => g.kind === "active"), historyGroups: groups.filter((g) => g.kind === "removed"),
  uploadAccess: "allowed", studentCaseId: "case-1", createRequestId: "33333333-3333-4333-8333-333333333333", today: "2026-09-23",
  progress: h(ProgressBar, { done: 2, total: 9, word: "принято" }),
  recognition: { studentCaseId: "case-1", profileRevision: null, canEnqueue: false, reviewHref: "#anketa" } }));
`,
};

async function buildBundle(entry, outFile, root, join) {
  const esbuild = require("esbuild");
  const plugin = {
    name: "card-tabs-client",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
      build.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: root, loader: "js" }));
      build.onResolve({ filter: /(^|\/)[\w-]*actions(\.ts)?$/ }, (args) => ({ path: args.path, namespace: "actions" }));
      build.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: ACTION_STUB, loader: "js" }));
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
    },
  };
  await esbuild.build({
    stdin: { contents: entry, resolveDir: root, sourcefile: "card-tabs-entry.js", loader: "js" },
    bundle: true, outfile: outFile, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic", tsconfig: join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    banner: { js: "var process = globalThis.process || { env: { NODE_ENV: \"development\" } }; var __dirname = \"/\";" }, external: ["node:*", "@opentelemetry/api"], plugins: [plugin], logLevel: "error",
  });
}

async function runClient({ browser, report, css, outDir, fx, join, pathToFileURL, lazySettled, VIEWPORTS }) {
  const page_html = (name, extra = "") => `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${name} (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div>${extra}<script src="card-tabs-${name}.js"></script></body></html>`;
  const files = {};
  for (const [name, entry] of Object.entries(ENTRIES)) {
    await buildBundle(entry, join(outDir, `card-tabs-${name}.js`), fx.ROOT, join);
    const extra = name === "documents" ? `<script>window.__DOCS = ${JSON.stringify(fx.docChecklist(true))};</script>` : "";
    files[name] = join(outDir, `card-tabs-${name}.html`);
    writeFileSync(files[name], page_html(name, extra));
  }
  const open = async (name, key, hash = "") => {
    const context = await browser.newContext({ ...VIEWPORTS[key], reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(pathToFileURL(files[name]).href + hash, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await lazySettled(page);
    // «Ещё N» истории - та же ленивая кнопка: у настоящей есть `data-slot`, у заглушки нет (нажатие по заглушке ничего не открывает).
    if (name === "history") await page.waitForSelector("[data-testid=v3-history-overflow][data-slot]", { timeout: 15_000 });
    return { context, page, errors };
  };

  for (const key of ["d1280", "m390"]) {
    // --- «Что происходило» ---------------------------------------------------------------------
    {
      const { context, page, errors } = await open("history", key);
      const label = `history client @${key}`;
      const trigger = page.getByTestId("v3-history-overflow");
      const shown = await page.locator("[data-testid=v3-history-list] > li").count();
      report(`${label}: ten events on the page, the button says how many are left`, shown === 10 && (await trigger.textContent()) === "Ещё 3", { shown });
      await trigger.click();
      await page.getByRole("dialog").waitFor();
      const sheet = await page.evaluate(() => {
        const element = document.querySelector("[data-slot=sheet-content]");
        return { insideWorld: Boolean(element.closest('.v3-world[data-ui="next"]')), rows: element.querySelectorAll("[data-testid=v3-history-overflow-items] > li").length,
          focusInside: Boolean(document.activeElement?.closest("[role=dialog]")), opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(getComputedStyle(element).backgroundColor) };
      });
      report(`${label}: panel inside the staff root, opaque, three rows, focus inside`, sheet.insideWorld && sheet.opaque && sheet.rows === 3 && sheet.focusInside, sheet);
      await page.screenshot({ path: join(outDir, `tab-next-history-overflow-${key}.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.waitForTimeout(80);
      report(`${label}: Esc closes, focus returns to the button`, await trigger.evaluate((element) => element === document.activeElement), null);
      report(`${label}: no browser errors`, errors.length === 0, errors);
      await context.close();
    }
    // --- «Договор и оплата»: «⋯» и панели ----------------------------------------------------------
    {
      const { context, page, errors } = await open("money", key);
      const label = `money client @${key}`;
      const state = () => page.evaluate(() => ({
        hidden: [...document.querySelectorAll("[data-money-panel]")].filter((panel) => panel.hidden).length,
        open: [...document.querySelectorAll("[data-money-panel]")].filter((panel) => !panel.hidden).map((panel) => panel.id),
        legacyHeader: document.querySelectorAll("[data-case-money] > header").length,
        menuInCard: Boolean(document.querySelector("[data-testid=v3-case-agreement] [data-testid=v3-case-money-more]")),
        card: (() => { const panel = document.querySelector("[data-money-panel]:not([hidden])"); if (!panel) return null; const style = getComputedStyle(panel); return { radius: style.borderRadius, border: style.borderTopWidth }; })(),
        active: document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 20),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      const initial = await state();
      report(`${label}: all three panels closed, the menu is in the summary card, no legacy header`, initial.hidden === 3 && initial.open.length === 0 && initial.menuInCard && initial.legacyHeader === 0, initial);
      await page.getByTestId("v3-case-money-more").click();
      await page.getByRole("group", { name: "Ещё: договор и оплата" }).getByRole("button", { name: "Стопы", exact: true }).click();
      const stops = await state();
      report(`${label}: «Стопы» from the menu opens only that panel, a card, focus on its title`, JSON.stringify(stops.open) === '["money-stops"]' && stops.card?.border === "1px" && stops.active === "money-stops-title", stops);
      await page.screenshot({ path: join(outDir, `tab-next-money-panel-${key}.png`), fullPage: true });
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      const closed = await state();
      report(`${label}: «Закрыть» hides the panel and returns focus to the menu button`, closed.open.length === 0 && closed.active === "" + (await page.getByTestId("v3-case-money-more").evaluate((element) => element.id)), closed);
      // «Стопы» строкой сводки - тот же лист: открывает панель, «Закрыть» возвращает фокус на эту кнопку.
      await page.getByRole("button", { name: "Стопы", exact: true }).first().click();
      const viaRow = await state();
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      const back = await page.evaluate(() => document.activeElement?.textContent?.trim());
      report(`${label}: the summary action opens the same panel and gets the focus back`, JSON.stringify(viaRow.open) === '["money-stops"]' && back === "Стопы", { viaRow: viaRow.open, back });
      await page.getByTestId("v3-case-money-more").click();
      await page.getByRole("group", { name: "Ещё: договор и оплата" }).getByRole("button", { name: "Обязательства", exact: true }).click();
      const help = page.getByRole("button", { name: "Пояснение: Обязательства" });
      await help.click();
      report(`${label}: the panel explanation is behind its «?»`, /Услуги EVO и другие расходы по делу/u.test(await page.locator("[role=dialog]").last().textContent()), null);
      await page.keyboard.press("Escape");
      report(`${label}: no page overflow, no browser errors`, (await state()).overflow <= 0 && errors.length === 0, errors);
      await context.close();
    }
    // Якорь адреса внутри панели открывает её при загрузке.
    {
      const { context, page, errors } = await open("money", key, "#stops-body");
      const shown = await page.evaluate(() => [...document.querySelectorAll("[data-money-panel]")].filter((panel) => !panel.hidden).map((panel) => panel.id));
      report(`money client @${key}: an address anchor inside a panel opens it on load`, JSON.stringify(shown) === '["money-stops"]' && errors.length === 0, { shown, errors });
      await context.close();
    }
    // --- «Документы» ----------------------------------------------------------------------------
    {
      const { context, page, errors } = await open("documents", key);
      const label = `documents client @${key}`;
      const cards = await page.evaluate(() => ({
        checklist: document.querySelectorAll("[data-testid=v3-documents-checklist]").length, groups: document.querySelectorAll("[data-testid=v3-documents-group]").length,
        addHidden: document.getElementById("case-documents-add")?.hidden, history: document.querySelectorAll("[data-testid=v3-removed-document-history]").length,
        historyInCard: Boolean(document.querySelector("[data-slot], .rounded-card [data-testid=v3-removed-document-history]")),
      }));
      report(`${label}: checklist card, two group cards, the add forms closed`, cards.checklist === 1 && cards.groups === 2 && cards.addHidden === true && cards.history === 1, cards);
      await page.getByTestId("v3-document-add-toggle").click();
      const added = await page.evaluate(() => ({ hidden: document.getElementById("case-documents-add").hidden, expanded: document.querySelector("[data-testid=v3-document-add-toggle]").getAttribute("aria-expanded") }));
      report(`${label}: «Документ» opens the add forms`, added.hidden === false && added.expanded === "true", added);
      await page.getByRole("button", { name: "Пояснение: Чек-лист" }).click();
      report(`${label}: upload formats are behind the «?»`, /PDF, JPEG, PNG/u.test(await page.locator("[role=dialog]").last().textContent()), null);
      await page.keyboard.press("Escape");
      await page.getByTestId("v3-removed-document-history").locator("summary").click();
      const history = await page.evaluate(() => { const details = document.querySelector("[data-testid=v3-removed-document-history]"); return { open: details.open, border: getComputedStyle(details).borderTopWidth, versions: details.querySelectorAll("[data-testid=v3-removed-document-version]").length }; });
      report(`${label}: the removed-items disclosure opens inside its card (no rule of its own)`, history.open && history.border === "0px" && history.versions === 1, history);
      await page.screenshot({ path: join(outDir, `tab-next-documents-client-${key}.png`), fullPage: true });
      report(`${label}: no page overflow, no browser errors`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0 && errors.length === 0, errors);
      await context.close();
    }
  }
}

module.exports = { runClient };
