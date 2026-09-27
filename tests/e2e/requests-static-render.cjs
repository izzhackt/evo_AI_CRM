"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в boards-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер «Заявок» (Э3, 27.09.2026) — очереди разбора.
 *
 * Рисуется НАСТОЯЩАЯ страница `src/app/(v3)/v3/requests/page.tsx` в
 * настоящем `AppShell`; подменены только границы данных и прав: смотрящий,
 * облик, список сотрудников формы лида, серверные действия и чтение очереди.
 * Чтение отдаёт СИНТЕТИЧЕСКИЙ ответ в форме `staff_requests_queue_v2`
 * (миграция 250) и проходит через настоящий `parseRequestsQueue` с
 * настоящими декодерами анкеты и консультации — страница видит ровно то, что
 * пропустил бы контракт. Люди, контакты и заявки выдуманы для проверки
 * вёрстки и не являются записями EVO. Живой Supabase, права и данные этот
 * рендер не проверяет.
 *
 *   node tests/e2e/requests-static-render.cjs --json [--look=next]
 *     → stdout: JSON [{ name, html }] — разметка страницы в оболочке
 *       (для tests/v3-requests-triage.test.mjs).
 *   node tests/e2e/requests-static-render.cjs --screenshots [outDir] [--look=next]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 (пусто,
 *       заполнено, открытая панель) и измерения: переполнение, текст мельче
 *       12 px, сплошной красный, высота строк. По умолчанию outDir —
 *       .impeccable/review (не коммитится), имена e3r-*.png; `--look=next` —
 *       суффикс `-next`.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const nodeCrypto = require("node:crypto");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");
const LOOK_NEXT = process.argv.includes("--look=next");

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8")), filename);
  };
}
Module._extensions[".png"] = (module, filename) => {
  module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 };
};

// --- синтетические данные ---------------------------------------------------
// «Сейчас» — воскресенье 27.09.2026, 12:00 по Бишкеку (06:00 UTC).
const NOW = new Date("2026-09-27T06:00:00.000Z");
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "bbbbbbbb-7777-4777-8777-000000000003";
const COLLEAGUE = "aaaaaaaa-1111-4111-8111-000000000002";
const id = (prefix, n) => `${prefix}-3333-4333-8333-${String(n).padStart(12, "0")}`;
const at = (iso) => `${iso.slice(0, 19)}.000000Z`;

const baseActor = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid", presentationRole: null,
};
const { staffRoleKeys } = require("./staff-role-templates.cjs");
const ACTORS = {
  admin: { ...baseActor, displayName: "Администратор (синтетический)", systemRole: "admin", assignments: [], permissionKeys: [] },
  // Просмотр роли Admin: интерфейс роли без действий.
  preview: { ...baseActor, displayName: "Администратор (синтетический)", systemRole: "admin", assignments: [], permissionKeys: [], presentationRole: "sales" },
  sales: {
    ...baseActor, displayName: "Менеджер продаж (синтетический)", systemRole: "staff",
    assignments: [{ id: "99999999-1111-4111-8111-000000000001", roleId: "99999999-1111-4111-8111-000000000002", label: "Sales Manager", bundleId: "b", bundleVersion: 1, scope: { kind: "department", key: "d", resourceKind: null } }],
    permissionKeys: staffRoleKeys("sales-manager"),
  },
};

function questionnaire(n, first, last, countries) {
  return {
    schemaVersion: 1, requestId: id("cccccccc", 900 + n), firstName: first, lastName: last, phone: `+996 555 000 ${String(100 + n).slice(-3)}`,
    destinationCountries: countries, intakeSeason: "autumn", intakeYear: 2027, educationLevel: "high_school", averageGrade: 4.6,
    gradeScale: "5", studyFields: ["Информатика и IT"], studyLevels: ["bachelor"], nationality: "KG",
    english: { mode: "exam", exam: "ielts", score: 6 }, tuitionBudget: "5000_10000", fundingSource: "family",
    consent: true, consentVersion: "2026-09-18",
  };
}

/** Строки в форме v2 до отбора по вкладке и состоянию (всё, что роль читает). */
function leadRow(n, fields) {
  const leadId = id("dddddddd", n);
  return {
    sortAt: at(fields.at), waiting: !fields.owner && !fields.handedOff,
    raw: {
      kind: "lead", id: leadId, source: fields.source ?? "website", occurredAt: at(fields.at), personName: fields.name,
      email: fields.email ?? null, phone: fields.phone ?? null, leadId,
      owner: fields.owner ? { membershipId: fields.owner, name: fields.owner === ME ? "Администратор (синтетический)" : "Бекболот Примеров" } : null,
      handedOff: Boolean(fields.handedOff),
      take: !fields.owner && !fields.handedOff && fields.canTake !== false
        ? { workflowVersion: "1", stageKey: "new", nextActionText: null, nextActionDueDate: null } : null,
    },
  };
}
function applicationRow(n, fields) {
  const appId = id("aaaaaaaa", n);
  const q = questionnaire(n, fields.first, fields.last, fields.countries ?? ["CN"]);
  const email = `applicant-${n}@example.invalid`;
  const decided = fields.status !== "pending";
  return {
    sortAt: at(fields.at), waiting: fields.status === "pending",
    raw: {
      kind: "application", id: appId, source: "platform_application", occurredAt: at(fields.at), personName: `${q.firstName} ${q.lastName}`,
      email, leadId: null,
      application: {
        id: appId, status: fields.status, revision: decided ? 2 : 1, email, questionnaire: q, submitted_at: at(fields.at),
        decided_at: decided ? at("2026-09-24T09:00:00Z") : null, decision_reason: decided ? "Синтетическое решение" : null,
        student_case_id: fields.status === "approved" ? id("cccccccc", n) : null,
        admissions_direction: fields.status === "approved" ? "CN" : null, canonical_lead_id: null,
      },
    },
  };
}
function consultationRow(n, fields) {
  const rowId = id("ffffffff", n);
  return {
    sortAt: at(fields.at), waiting: !fields.handledBy,
    raw: {
      kind: "consultation", id: rowId, source: "portal_consultation", occurredAt: at(fields.at), personName: fields.name,
      consultation: {
        id: rowId, status: fields.handledBy ? "handled" : "requested", studentName: fields.name,
        institutionId: fields.institution ? id("eeeeeeee", n) : null, institutionName: fields.institution ?? null,
        note: fields.note ?? null, requestedAt: at(fields.at), handledAt: fields.handledBy ? at("2026-09-25T10:30:00Z") : null,
        handledByName: fields.handledBy ?? null,
      },
    },
  };
}

const ALL_ROWS = [
  leadRow(1, { name: "Эльмира Формова", at: "2026-09-27T03:12:00Z", phone: "+996 555 000 101", email: "elmira.forma@example.invalid" }),
  applicationRow(2, { first: "Тимур", last: "Демонстров", at: "2026-09-27T02:40:00Z", status: "pending", countries: ["CN", "MY"] }),
  leadRow(3, { name: "Амир Входящий", source: "whatsapp", at: "2026-09-26T13:05:00Z", phone: "+996 555 000 103", owner: COLLEAGUE }),
  consultationRow(4, { name: "Нурай Образцова", at: "2026-09-26T09:20:00Z", institution: "Синтетический университет Малайзии", note: "Хочу обсудить стипендию и сроки подачи на весну." }),
  leadRow(5, { name: "Асель Проектова", at: "2026-09-25T11:45:00Z", email: "asel.proekt@example.invalid", owner: ME }),
  leadRow(6, { name: "Максат Пилотный", at: "2026-09-24T08:10:00Z", phone: "+996 555 000 106", handedOff: true }),
  applicationRow(7, { first: "Камила", last: "Вымыслова", at: "2026-09-22T05:00:00Z", status: "rejected" }),
  consultationRow(8, { name: "Руслан Черновиков", at: "2026-09-21T07:30:00Z", handledBy: "Бекболот Примеров" }),
  leadRow(9, { name: "Абитуриент с очень длинным двойным именем Нурсултан-Бекмурза Тестов", at: "2026-09-20T04:00:00Z", phone: "+996 555 000 109" }),
];
// Продажи отдела (Sales Manager): лиды без ответственного вне области отдела (155),
// анкеты роли закрыты — пустая очередь с последней заявкой отдела.
const SALES_ROWS = [
  leadRow(21, { name: "Олжас Пробников", at: "2026-09-24T10:00:00Z", owner: COLLEAGUE }),
];

const TAB_OF = (row) => (row.raw.kind === "lead" ? row.raw.source : row.raw.kind);
const SOURCE_OF_TAB = { website: "website", whatsapp: "whatsapp", application: "platform_application", consultation: "portal_consultation" };

/** Ответ v2 так, как его собрал бы сервер: отбор, числа всех вкладок, последняя заявка. */
function queueResponse(rows, states, source, status, limit) {
  const tabs = ["website", "whatsapp", "application", "consultation"];
  const kindOfTab = { website: "lead", whatsapp: "lead", application: "application", consultation: "consultation" };
  const readable = rows.filter((row) => states[row.raw.kind] === "ready");
  const counts = Object.fromEntries(tabs.map((tab) => [tab, states[kindOfTab[tab]] === "ready"
    ? readable.filter((row) => TAB_OF(row) === tab && (status === "all" || row.waiting)).length : null]));
  const ofSource = readable.filter((row) => source === "all" || SOURCE_OF_TAB[TAB_OF(row)] === source);
  const picked = ofSource.filter((row) => status === "all" || row.waiting)
    .sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : a.raw.kind < b.raw.kind ? 1 : a.raw.kind > b.raw.kind ? -1 : a.raw.id < b.raw.id ? 1 : -1))
    .slice(0, limit);
  const latestAt = ofSource.length ? ofSource.map((row) => row.sortAt).sort().at(-1) : null;
  return {
    version: 2, organizationId: ORG, source, status, limit, states, counts, latestAt,
    rows: picked.map((row) => row.raw), nextCursor: null, previousCursor: null,
  };
}

const SCENARIOS = {
  // Пусто в «Ждут разбора»: всё взято, последняя заявка пришла вчера.
  empty: { actor: "admin", search: "", rows: ALL_ROWS.filter((row) => !row.waiting), states: { lead: "ready", application: "ready", consultation: "ready" } },
  // Заполнено: «Все» — разные источники и ответственные.
  populated: { actor: "admin", search: "status=all", rows: ALL_ROWS, states: { lead: "ready", application: "ready", consultation: "ready" } },
  // По умолчанию — «Ждут разбора».
  waiting: { actor: "admin", search: "", rows: ALL_ROWS, states: { lead: "ready", application: "ready", consultation: "ready" } },
  // Открыта анкета: полные ответы и решение в правой панели.
  "drawer": { actor: "admin", search: `status=all&open=application:${id("aaaaaaaa", 2)}`, rows: ALL_ROWS, states: { lead: "ready", application: "ready", consultation: "ready" } },
  // Открыт не взятый лид: контакт, «Взять себе», карточка лида.
  "drawer-lead": { actor: "admin", search: `open=lead:${id("dddddddd", 1)}`, rows: ALL_ROWS, states: { lead: "ready", application: "ready", consultation: "ready" } },
  // Менеджер продаж отдела: без вкладки «Анкеты», без «Взять себе», пусто в «Ждут разбора».
  "sales-empty": { actor: "sales", search: "", rows: SALES_ROWS, states: { lead: "ready", application: "forbidden", consultation: "ready" } },
  // Лид без ответственного, который сервер этому сотруднику взять не даёт (нет «take»): кнопки нет.
  "sales-untakeable": { actor: "sales", search: "", rows: [leadRow(22, { name: "Гульнара Экспериментова", at: "2026-09-27T01:00:00Z", canTake: false })], states: { lead: "ready", application: "forbidden", consultation: "ready" } },
  // Просмотр роли: те же строки, «Взять себе», решения и «Добавить лида» нет.
  preview: { actor: "preview", search: "", rows: ALL_ROWS, states: { lead: "ready", application: "ready", consultation: "ready" } },
  // Чтение не удалось: вкладки без чисел, ошибка с «Повторить».
  error: { actor: "admin", search: "", rows: ALL_ROWS, states: { lead: "ready", application: "ready", consultation: "ready" }, fail: "unavailable" },
};

let current = null;

class RequestsQueueSourceError extends Error {
  constructor(code) { super("Requests queue unavailable."); this.code = code; }
}

// --- подмена границ данных и прав --------------------------------------------
const STUBS = {
  "@/lib/platform-guards": {
    requireV3PageActor: async () => ACTORS[current.actor],
    requirePlatformStaffActor: async () => ACTORS[current.actor],
  },
  "@/lib/v3/look-preview": { readLookPreview: async () => LOOK_NEXT },
  "@/lib/v3/pipeline-source": {
    readPipelineOwnerOptions: async () => ({ rows: [{ membershipId: ME, displayLabel: "Администратор (синтетический)" }, { membershipId: COLLEAGUE, displayLabel: "Бекболот Примеров" }], hasNext: false, nextCursor: null }),
  },
  "@/lib/v3/requests-queue-source": {
    RequestsQueueSourceError,
    loadScopedRequestsQueue: async (actor, selection) => {
      if (current.fail) throw new RequestsQueueSourceError(current.fail);
      const { parseRequestsQueue } = require(join(ROOT, "src/lib/requests-queue-contract.ts"));
      const { decodeStudentApplication } = require(join(ROOT, "src/lib/v3/student-application-source.ts"));
      const { parsePortalConsultationRow } = require(join(ROOT, "src/lib/v3/requests-source.ts"));
      const raw = queueResponse(current.rows, current.states, selection.source, selection.status, selection.limit);
      return parseRequestsQueue(raw, actor.organizationId, selection, decodeStudentApplication, parsePortalConsultationRow);
    },
  },
  "@/lib/platform-sales-actions": { updatePlatformSalesWorkflowAction: async (previous) => previous },
  "@/lib/platform-manual-lead-actions": { createManualLeadAction: async (previous) => previous },
  "@/lib/student-application-actions": { decideStudentApplicationAction: async (previous) => previous },
  "@/lib/platform-portal-consultation-actions": { handlePortalConsultationAction: async () => ({ status: "handled" }) },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && Object.hasOwn(STUBS, request)) {
    const filename = join(ROOT, ".stub", `${request.replace(/[^a-z0-9]+/giu, "_")}.js`);
    if (!Module._cache[filename]) {
      const stub = new Module(filename);
      stub.filename = filename;
      stub.exports = STUBS[request];
      stub.loaded = true;
      Module._cache[filename] = stub;
    }
    return filename;
  }
  if (request === "server-only") {
    return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
  }
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");

const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

function withContexts(node, search) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: "/v3/requests" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

function syntheticUuids() {
  let next = 0;
  return () => `99999999-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`;
}

/** Настоящая страница в настоящей оболочке; «сейчас» и `randomUUID` предсказуемы. */
async function renderScenario(name) {
  current = SCENARIOS[name];
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const page = require(join(ROOT, "src/app/(v3)/v3/requests/page.tsx")).default;
  const originalUuid = nodeCrypto.randomUUID;
  const RealDate = Date;
  nodeCrypto.randomUUID = syntheticUuids();
  // Страница берёт «сейчас» из `new Date()`: подставляем момент сценария.
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(NOW.getTime()); }
    static now() { return NOW.getTime(); }
  };
  try {
    const content = await page({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(current.search))) });
    const tree = createElement("div", { className: "v3-world", "data-look": LOOK_NEXT ? "next" : undefined },
      createElement(AppShell, { actor: ACTORS[current.actor], initialNotifications: null, ...(LOOK_NEXT ? { look: "next" } : {}) }, content));
    return renderToStaticMarkup(withContexts(tree, current.search));
  } finally {
    nodeCrypto.randomUUID = originalUuid;
    globalThis.Date = RealDate;
  }
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

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const suffix = LOOK_NEXT ? "-next" : "";
  const WIDTHS = [
    ["1440", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
    ["1280", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
    ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ];
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const name of Object.keys(SCENARIOS)) {
      const html = await renderScenario(name);
      const htmlPath = join(outDir, `e3r-${name}${suffix}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Заявки — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${html}</body></html>`,
      ].join(""));
      for (const [width, context] of WIDTHS) {
        const file = `e3r-${name}-${width}${suffix}.png`;
        const browserContext = await browser.newContext(context);
        const tab = await browserContext.newPage();
        const errors = [];
        tab.on("pageerror", (error) => errors.push(error.message));
        await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await tab.evaluate(() => document.fonts.ready);
        await tab.waitForFunction(() => [...document.images].every((image) => image.complete || image.getClientRects().length === 0));
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await tab.evaluate(() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
          };
          const main = document.querySelector('[data-testid="v3-requests"]') ?? document.querySelector("main");
          const rows = [...document.querySelectorAll("[data-queue-row]")].filter(visible);
          const small = [...document.querySelectorAll("main *")].filter((element) => {
            if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) return false;
            return visible(element) && parseFloat(getComputedStyle(element).fontSize) < 12;
          }).length;
          const firstRow = rows[0];
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            h1: document.querySelectorAll("h1").length,
            rows: rows.length,
            rowHeights: [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)))].join("/") || null,
            firstRowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null,
            textUnder12: small,
            solidRed: [...document.querySelectorAll("main a, main button")].filter((element) => visible(element)
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim()).join("|") || "none",
            tabs: [...(main?.querySelectorAll('[data-testid="queue-view-tabs"] a') ?? [])].map((link) => link.textContent.trim()).join(" · "),
            panel: (() => { const panel = document.querySelector('[data-testid="requests-detail-panel"]'); return panel && visible(panel) ? Math.round(panel.getBoundingClientRect().left) : null; })(),
          };
        });
        await tab.screenshot({ path: join(outDir, file), fullPage: false });
        const facts = Object.entries(metrics).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`).join(" ");
        process.stdout.write(`${file}: ${facts}\n`);
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function json() {
  const out = [];
  for (const name of Object.keys(SCENARIOS)) out.push({ name, html: await renderScenario(name) });
  process.stdout.write(JSON.stringify(out));
}

if (process.argv.includes("--json")) {
  json().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => { console.error(error); process.exit(1); });
} else {
  console.error("usage: requests-static-render.cjs --json | --screenshots [outDir] [--look=next]");
  process.exit(2);
}
