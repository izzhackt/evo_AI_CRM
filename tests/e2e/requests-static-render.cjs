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
 * список сотрудников формы лида, серверные действия и чтение очереди.
 * Чтение отдаёт СИНТЕТИЧЕСКИЙ ответ в форме `staff_requests_queue_v2`
 * (миграция 250) и проходит через настоящий `parseRequestsQueue` с
 * настоящими декодерами анкеты и консультации — страница видит ровно то, что
 * пропустил бы контракт. Люди, контакты и заявки выдуманы для проверки
 * вёрстки и не являются записями EVO. Живой Supabase, права и данные этот
 * рендер не проверяет.
 *
 *   node tests/e2e/requests-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка страницы в оболочке
 *       (для tests/v3-requests-triage.test.mjs).
 *   node tests/e2e/requests-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 (пусто,
 *       заполнено, открытая панель) и измерения: переполнение, текст мельче
 *       12 px, сплошной красный, высота строк. По умолчанию outDir —
 *       .impeccable/review (не коммитится), имена e3r-*.png.
 *   node tests/e2e/requests-static-render.cjs --panel-keys
 *     → stdout: JSON [{ open, key, row }] — ключ правой панели при переходах
 *       между записями (для tests/v3-requests-triage.test.mjs).
 *   node tests/e2e/requests-static-render.cjs --manual-lead-owners
 *     → stdout: JSON { read, failed } — что страница отдаёт форме «Добавить
 *       лида», когда список ответственных прочитан и когда чтение упало.
 *   node tests/e2e/requests-static-render.cjs --manual-lead-form [outDir]
 *     → форма «Добавить лида» в Chromium (Э8.11): источник по умолчанию
 *       «Не выбрано», без него браузер форму не отправляет и говорит
 *       «Выберите источник» под полем; с выбранным источником уходит его
 *       ключ. Серверное действие — заглушка, записывает поля и ничего не
 *       сохраняет. Снимки `e811-manual-lead-*.png` на 1440 и 390.
 *   node tests/e2e/requests-static-render.cjs --channel-spend-forms [outDir]
 *     → «Исправить» в Lead 360 и «Добавить расход» (М1) в Chromium: после
 *       ответа «неизвестно» select показывает выбранный канал и повтор шлёт
 *       его же с тем же id; форма расхода не теряет введённое, после
 *       конфликта запроса id новый, после записи форма пуста. Действия —
 *       заглушки с заданной очередью ответов.
 *   node tests/e2e/requests-static-render.cjs --switch [outDir]
 *     → смена записи в правой панели по-настоящему в Chromium: собранный
 *       esbuild RequestsQueueView, черновик решения, конфликт и ошибка
 *       «Взять себе» не переезжают в другую запись. Серверные действия —
 *       заглушки (конфликт, «Лид уже изменён»), ничего не сохраняют.
 *   node tests/e2e/requests-static-render.cjs --f1 [outDir]
 *     → Э7 «Одна боковая панель везде»: настоящая страница «Заявок» в
 *       оболочке с открытым лидом (`?open=lead:…`) на 1440×900, 1280×800,
 *       1024×768 (лист справа) и 390×844 — снимки `f1-requests-<ширина>.png` и замеры
 *       `tests/e2e/side-panel-probe.cjs`. `RequestsQueueView` в браузере —
 *       та же сборка esbuild; адрес — состояние стенда: `router.push`
 *       открывает и закрывает панель по `open`, как сервер, и путь Esc →
 *       строка → открыть → «Закрыть» → строка идёт по-настоящему в React.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const nodeCrypto = require("node:crypto");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

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
  "@/lib/v3/pipeline-source": {
    readPipelineOwnerOptions: async () => current.ownersFail ? Promise.reject(new Error("synthetic owner read failure")) : ({ rows: [{ membershipId: ME, displayLabel: "Администратор (синтетический)" }, { membershipId: COLLEAGUE, displayLabel: "Бекболот Примеров" }], hasNext: false, nextCursor: null }),
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
    const tree = createElement("div", { className: "v3-world", "data-surface": "staff" },
      createElement(AppShell, { actor: ACTORS[current.actor], initialNotifications: null }, content));
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
      const htmlPath = join(outDir, `e3r-${name}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Заявки — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${html}</body></html>`,
      ].join(""));
      for (const [width, context] of WIDTHS) {
        const file = `e3r-${name}-${width}.png`;
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

// --- смена записи в правой панели (ревью PR #1084) ---------------------------
// Вторая анкета «на решении» и два не взятых лида: переход между записями
// одного вида. Синтетика, как и всё выше.
const SWITCH_ROWS = [...ALL_ROWS, applicationRow(10, { first: "Алия", last: "Условная", at: "2026-09-26T05:00:00Z", status: "pending" })];
const SWITCH_STATES = { lead: "ready", application: "ready", consultation: "ready" };
const APPLICATION_A = `application:${id("aaaaaaaa", 2)}`;
const APPLICATION_B = `application:${id("aaaaaaaa", 10)}`;
const LEAD_X = `lead:${id("dddddddd", 1)}`;
const LEAD_Y = `lead:${id("dddddddd", 9)}`;
/** Переходы «Открыть» по порядку: A → B → A, X → Y, и та же запись после обновления. */
const PANEL_SWITCH = [APPLICATION_A, APPLICATION_B, APPLICATION_A, LEAD_X, LEAD_Y, LEAD_Y];

function findElement(node, match) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return null;
  }
  if (match(node)) return node;
  return findElement(node.props?.children, match);
}

/**
 * Ключ правой панели по открытой записи. Сервер при каждом «Открыть» заново
 * рисует ту же страницу, а React сохраняет состояние клиентских форм панели
 * (черновик решения, конфликт, ошибка «Взять себе»), пока совпадают место,
 * тип и ключ элемента. Режим рисует НАСТОЯЩУЮ страницу для каждого перехода
 * и отдаёт ключ элемента `RequestDetail` и запись, которую он показывает.
 *
 *   node tests/e2e/requests-static-render.cjs --panel-keys
 *     → stdout: JSON [{ open, key, row }] (для tests/v3-requests-triage.test.mjs).
 */
async function panelKeys() {
  const { RequestsQueueView } = require(join(ROOT, "src/components/v3/requests/RequestsQueueView.tsx"));
  const { requestOpenKey } = require(join(ROOT, "src/lib/requests-queue-contract.ts"));
  const page = require(join(ROOT, "src/app/(v3)/v3/requests/page.tsx")).default;
  const out = [];
  for (const open of PANEL_SWITCH) {
    current = { actor: "admin", search: `status=all&open=${open}`, rows: SWITCH_ROWS, states: SWITCH_STATES };
    const content = await page({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(current.search))) });
    const view = findElement(content, (element) => element.type === RequestsQueueView);
    if (!view) throw new Error("the page renders no RequestsQueueView");
    const panel = findElement(view.type(view.props), (element) => typeof element.type === "function" && element.type.name === "RequestDetail");
    out.push({ open, key: panel ? panel.key : null, row: panel ? requestOpenKey(panel.props.row) : null });
  }
  process.stdout.write(JSON.stringify(out));
}

/**
 * Список ответственных формы «Добавить лида»: прочитан — строки, чтение упало —
 * null (форма говорит «не загрузился», а не «нет доступного ответственного»).
 * Ревью PR #1084. Смотрит элемент `ManualLeadForm` настоящей страницы.
 */
async function manualLeadOwners() {
  const { ManualLeadForm } = require(join(ROOT, "src/components/v3/ManualLeadForm.tsx"));
  const page = require(join(ROOT, "src/app/(v3)/v3/requests/page.tsx")).default;
  const out = {};
  for (const [name, ownersFail] of [["read", false], ["failed", true]]) {
    current = { ...SCENARIOS.populated, ownersFail };
    const content = await page({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(current.search))) });
    const form = findElement(content, (element) => element.type === ManualLeadForm);
    if (!form) throw new Error("the page renders no ManualLeadForm");
    out[name] = form.props.owners;
  }
  process.stdout.write(JSON.stringify(out));
}

const SWITCH_ROOT_ID = "requests-client-root";
const SWITCH_FIXTURE_ID = "requests-client-fixture";

// Точка входа браузера: НАСТОЯЩИЙ RequestsQueueView (с ApplicationDecision и
// TakeLeadButton), собранный esbuild. `__open(key)` делает то, что делает
// сервер при «Открыть»: та же страница с новым `open` и новыми request_id
// (`randomUUID` страницы) — React сверяет новое дерево со старым.
const SWITCH_CLIENT_ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { RequestsQueueView } from "../../src/components/v3/requests/RequestsQueueView";

const fixture = JSON.parse(document.getElementById("${SWITCH_FIXTURE_ID}").textContent);
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const root = createRoot(document.getElementById("${SWITCH_ROOT_ID}"));
let serial = 0;
const fresh = () => "99999999-5555-4555-8555-" + String((serial += 1)).padStart(12, "0");
globalThis.__takeRequestIds = {};
function render(key) {
  const [kind, id] = key.split(":");
  const takeRequestIds = Object.fromEntries(fixture.props.read.queue.rows.flatMap((row) => row.kind === "lead" && row.take ? [[row.leadId, fresh()]] : []));
  globalThis.__takeRequestIds = takeRequestIds;
  const search = new URLSearchParams("status=all&open=" + key);
  root.render(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: "/v3/requests" },
        createElement(SearchParamsContext.Provider, { value: search },
          createElement(RequestsQueueView, { ...fixture.props, open: { kind, id }, takeRequestIds, decisionRequestId: fresh() })))),
  );
}
globalThis.__open = (key) => new Promise((done) => { render(key); requestAnimationFrame(() => requestAnimationFrame(done)); });
`;

/**
 * Серверные действия в браузере: решение по анкете отвечает конфликтом,
 * «Взять себе» — «Лид уже изменён»; отправленные поля записываются для
 * проверки. Заглушки ничего не сохраняют. Фильтры esbuild — регулярные
 * выражения Go: без флага `u`.
 */
const SWITCH_ACTIONS = {
  // Э8.11: форма лида — только запись отправленных полей; ответ «такой контакт уже есть», ничего не сохраняется.
  createManualLeadAction: "(globalThis.__manualLeads ||= []).push(Object.fromEntries(arguments[1])); return { status: \"duplicate\", requestId: arguments[1].get(\"request_id\"), leadId: null };",
  decideStudentApplicationAction: "(globalThis.__decisions ||= []).push(Object.fromEntries(arguments[1])); return { status: \"conflict\", requestId: arguments[1].get(\"request_id\") };",
  // М1: исправление канала и расход — запись полей и ответ из очереди (по умолчанию «неизвестно»).
  correctLeadChannelAction: "const f = Object.fromEntries(arguments[1]); (globalThis.__corrections ||= []).push(f); const next = (globalThis.__correctionResults ||= []).shift() ?? \"unavailable\"; return next === \"saved\" ? { status: \"saved\", requestId: f.request_id, read: { channel: f.channel, basis: \"corrected\", corrected: true, at: \"2026-10-06T08:00:00Z\" } } : { status: next, requestId: f.request_id, read: null };",
  addMarketingSpendAction: "const f = Object.fromEntries(arguments[1]); (globalThis.__spends ||= []).push(f); return { status: (globalThis.__spendResults ||= []).shift() ?? \"unavailable\", requestId: f.request_id };",
  updatePlatformSalesWorkflowAction: "(globalThis.__takes ||= []).push(Object.fromEntries(arguments[1])); return { status: \"stale\", requestId: arguments[1].get(\"request_id\"), version: arguments[0].version, changedAt: null };",
};
const switchStubs = {
  name: "requests-switch-stubs",
  setup(build) {
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /\.module\.css$/ }, () => ({
      contents: "export default new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : undefined) });",
      loader: "js",
    }));
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
    build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
      const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
      return {
        contents: names.map((name) => `export async function ${name}() { ${SWITCH_ACTIONS[name] ?? `throw new Error("static render: server action ${name} is not available");`} }`).join("\n"),
        loader: "ts",
      };
    });
  },
};

/**
 * Смена записи в правой панели в Chromium (1440×900: панель рядом со
 * списком, тот же экземпляр места в дереве). Проверяет то, что нашло ревью
 * PR #1084: (1) черновик «Отклонить» с причиной анкеты A не переезжает в
 * анкету B и не уходит с её application_id; (2) конфликт анкеты B не
 * запирает анкету A; (3) ошибка «Взять себе» лида X и его request_id не
 * переезжают в панель лида Y. Нарушение — исключение с фактами.
 *
 *   node tests/e2e/requests-static-render.cjs --switch [outDir]
 */
async function switchCheck() {
  const outIndex = process.argv.indexOf("--switch") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const { parseRequestSelection } = require(join(ROOT, "src/lib/requests-queue-contract.ts"));
  const selection = parseRequestSelection({ status: "all" });
  current = { actor: "admin", search: "status=all", rows: SWITCH_ROWS, states: SWITCH_STATES };
  const queue = await STUBS["@/lib/v3/requests-queue-source"].loadScopedRequestsQueue(ACTORS.admin, selection);
  const props = {
    selection, read: { status: "ready", queue }, actorMembershipId: ME, readOnly: false, canCreateLead: true,
    nowIso: NOW.toISOString(),
  };
  const bundle = join(outDir, "requests-switch-client.js");
  await require("esbuild").build({
    stdin: { contents: SWITCH_CLIENT_ENTRY, resolveDir: __dirname, sourcefile: "requests-switch-entry.js", loader: "js" },
    bundle: true, outfile: bundle, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [switchStubs], logLevel: "error",
  });
  const htmlPath = join(outDir, "e3r-switch.html");
  writeFileSync(htmlPath, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Заявки — смена записи (синтетические данные)</title><style>${await compileCss()}</style></head>`,
    `<body class="min-h-full"><div class="v3-world" data-surface="staff"><main class="p-6"><div id="${SWITCH_ROOT_ID}"></div></main></div>`,
    `<script type="application/json" id="${SWITCH_FIXTURE_ID}">${JSON.stringify({ props }).replaceAll("<", "\\u003c")}</script><script src="requests-switch-client.js"></script></body></html>`,
  ].join(""));

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  const expect = (label, ok, facts) => {
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${JSON.stringify(facts)}`}\n`);
    if (!ok) failures.push(label);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    const panel = tab.locator('[data-testid="requests-detail-panel"]');
    const openRecord = (key) => tab.evaluate((value) => globalThis.__open(value), key);
    const state = () => tab.evaluate(() => {
      const root = document.querySelector('[data-testid="requests-detail-panel"]');
      const field = (form, name) => form?.querySelector(`input[name="${name}"]`)?.value ?? null;
      const decision = root?.querySelector('form[aria-label="Решение по заявке"]') ?? null;
      const take = root?.querySelector('[data-testid="requests-take"]') ?? null;
      return {
        heading: root?.querySelector("h2")?.textContent ?? null,
        applicationId: field(decision, "application_id"),
        decision: decision?.querySelector('input[name="decision"]:checked')?.value ?? null,
        reason: decision?.querySelector("textarea")?.value ?? null,
        decisionRequestId: field(decision, "request_id"),
        locked: decision?.querySelector("fieldset")?.disabled ?? null,
        decisionMessage: decision?.querySelector('[role="status"]')?.textContent ?? null,
        refresh: Boolean(decision && [...decision.querySelectorAll("button")].some((button) => button.textContent === "Обновить заявку")),
        leadId: field(take, "lead_id"),
        takeRequestId: field(take, "request_id"),
        takeAlert: take?.querySelector('[role="alert"]')?.textContent ?? null,
        takeButton: take?.querySelector('button[type="submit"]')?.textContent ?? null,
        takeIds: { ...globalThis.__takeRequestIds },
      };
    });
    const idOf = (key) => key.split(":")[1];
    const REASON_A = "Причина для анкеты A (синтетическая)";

    // (1) Черновик «Отклонить» анкеты A → анкета B.
    await openRecord(APPLICATION_A);
    await panel.getByLabel("Отклонить").check();
    await panel.locator("textarea").fill(REASON_A);
    const a = await state();
    expect("A: the reject draft is typed into A's own form", a.applicationId === idOf(APPLICATION_A) && a.decision === "reject" && a.reason === REASON_A, a);
    await openRecord(APPLICATION_B);
    const b = await state();
    expect("B opens with a fresh decision: «Одобрить», no reason, a request_id other than A's draft",
      b.applicationId === idOf(APPLICATION_B) && b.decision === "approve" && b.reason === null && b.decisionRequestId !== a.decisionRequestId, b);

    // (2) Решение по B отправляется с B и без причины A; конфликт B не запирает A.
    await panel.locator('form[aria-label="Решение по заявке"] button[type="submit"]').click();
    await panel.getByText("Заявка уже изменилась").waitFor();
    const sent = await tab.evaluate(() => globalThis.__decisions.at(-1));
    expect("B's submission carries B's id, «Одобрить» and no reason from A",
      sent.application_id === idOf(APPLICATION_B) && sent.decision === "approve" && sent.reason === "" && sent.request_id === b.decisionRequestId, sent);
    const conflicted = await state();
    expect("B shows its own conflict, locked", conflicted.locked === true && conflicted.refresh, conflicted);
    await openRecord(APPLICATION_A);
    const again = await state();
    expect("A reopens unlocked, without B's conflict or «Обновить заявку»",
      again.applicationId === idOf(APPLICATION_A) && again.locked === false && !again.decisionMessage && !again.refresh && again.decision === "approve" && again.reason === null, again);

    // (3) Ошибка «Взять себе» лида X → лид Y.
    await openRecord(LEAD_X);
    await panel.getByRole("button", { name: /Взять себе/u }).click();
    await panel.getByText("Лид уже изменён").waitFor();
    const x = await state();
    const took = await tab.evaluate(() => globalThis.__takes.at(-1));
    expect("X: the take is sent for X with X's request_id and shows X's error",
      took.lead_id === idOf(LEAD_X) && took.request_id === x.takeIds[idOf(LEAD_X)] && x.takeAlert?.startsWith("Лид уже изменён"), { took, x });
    await openRecord(LEAD_Y);
    const y = await state();
    expect("Y opens without X's error and with Y's own request_id",
      y.leadId === idOf(LEAD_Y) && y.takeAlert === null && y.takeButton === "Взять себе" && y.takeRequestId === y.takeIds[idOf(LEAD_Y)] && y.takeRequestId !== took.request_id, y);
    await tab.screenshot({ path: join(outDir, "e3r-switch-1440.png"), fullPage: false });

    // Та же запись после обновления сервером — тот же экземпляр: своё состояние сохраняется.
    await panel.getByRole("button", { name: /Взять себе/u }).click();
    await panel.getByText("Лид уже изменён").waitFor();
    await openRecord(LEAD_Y);
    const same = await state();
    expect("the same record re-read keeps its own state (one instance per record)", same.leadId === idOf(LEAD_Y) && same.takeAlert?.startsWith("Лид уже изменён"), same);

    if (errors.length) failures.push(`browser errors: ${errors.join(" | ")}`);
    await context.close();
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`panel switch: ${failures.length} failed:\n${failures.join("\n")}`);
}

// --- Э8.11: источник в форме «Добавить лида» ----------------------------------
const MANUAL_LEAD_ROOT_ID = "manual-lead-root";
const MANUAL_LEAD_ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ManualLeadDisclosure, ManualLeadForm, ManualLeadTrigger } from "../../src/components/v3/ManualLeadForm";

createRoot(document.getElementById("${MANUAL_LEAD_ROOT_ID}")).render(
  createElement(ManualLeadDisclosure, null,
    createElement("div", { className: "flex items-center justify-between gap-3" },
      createElement("h1", { className: "t-page-title text-fg" }, "Воронка продаж"),
      createElement(ManualLeadTrigger)),
    createElement(ManualLeadForm, {
      requestId: "99999999-5555-4555-8555-000000000001",
      ownerId: "${ME}",
      owners: [{ id: "${ME}", displayName: "Айгүл Осмонова (синтетика)" }],
    })),
);
`;

/**
 * Форма «Добавить лида» (Э8.11) в Chromium: настоящий `ManualLeadForm`,
 * собранный esbuild. Нарушение — исключение с фактами.
 */
async function manualLeadForm() {
  const outIndex = process.argv.indexOf("--manual-lead-form") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundle = join(outDir, "requests-manual-lead-client.js");
  await require("esbuild").build({
    stdin: { contents: MANUAL_LEAD_ENTRY, resolveDir: __dirname, sourcefile: "requests-manual-lead-entry.js", loader: "js" },
    bundle: true, outfile: bundle, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [switchStubs], logLevel: "error",
  });
  const htmlPath = join(outDir, "e811-manual-lead.html");
  writeFileSync(htmlPath, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Добавить лида (синтетические данные)</title><style>${await compileCss()}</style></head>`,
    `<body class="min-h-full bg-bg"><div class="v3-world" data-surface="staff"><main class="p-4 md:p-6"><div id="${MANUAL_LEAD_ROOT_ID}"></div></main></div>`,
    `<script src="requests-manual-lead-client.js"></script></body></html>`,
  ].join(""));

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  const expect = (label, ok, facts) => {
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${JSON.stringify(facts)}`}\n`);
    if (!ok) failures.push(label);
  };
  try {
    for (const [width, context] of [
      ["1440", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
      ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ]) {
      const browserContext = await browser.newContext(context);
      const tab = await browserContext.newPage();
      const errors = [];
      tab.on("pageerror", (error) => errors.push(error.message));
      await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await tab.evaluate(() => document.fonts.ready);
      await tab.getByRole("button", { name: "Добавить лида" }).click();
      const source = tab.locator('select[name="source"]');
      const channel = tab.locator('select[name="channel"]');
      const probe = (select) => ({
        value: select.value,
        options: [...select.options].map((option) => [option.value, option.textContent]),
        required: select.required,
        invalid: select.getAttribute("aria-invalid"),
        message: select.validationMessage,
        error: select.parentElement.querySelector('[role="alert"]')?.textContent ?? null,
        focused: document.activeElement === select,
        height: Math.round(select.getBoundingClientRect().height),
        hint: select.getAttribute("aria-describedby") ? document.getElementById(select.getAttribute("aria-describedby"))?.textContent ?? null : null,
      });
      const field = () => source.evaluate(probe);
      const channelField = () => channel.evaluate(probe);
      const opened = await field();
      expect(`${width}: the source opens on «Не выбрано», required, with the seven manual keys`,
        opened.value === "" && opened.required && JSON.stringify(opened.options) === JSON.stringify([
          ["", "Не выбрано"], ["office", "Встреча в офисе"], ["phone_call", "Звонок"], ["referral", "Рекомендация"], ["website", "Сайт"], ["other", "Другой источник"],
          ["instagram", "Instagram Direct"], ["whatsapp_manual", "WhatsApp (вручную)"],
        ]) && opened.height >= 44, opened);
      const channelOpened = await channelField();
      expect(`${width}: «Откуда узнал» opens on «Не выбрано», required, with the six channels, «Не известно» last`,
        channelOpened.value === "" && channelOpened.required && JSON.stringify(channelOpened.options) === JSON.stringify([
          ["", "Не выбрано"], ["instagram_ads", "Instagram — реклама"], ["instagram", "Instagram — посты и профиль"], ["website_search", "Сайт и поиск"],
          ["referral", "Рекомендация"], ["other", "Другое"], ["unknown", "Не известно"],
        ]) && channelOpened.height >= 44, channelOpened);
      await tab.screenshot({ path: join(outDir, `e811-manual-lead-open-${width}.png`), fullPage: true });

      await tab.locator('input[name="name"]').fill("Тест Синтетический");
      await tab.locator('input[name="phone"]').fill("+996 555 000 000");
      await tab.getByRole("button", { name: "Сохранить лида" }).click();
      await tab.waitForTimeout(150);
      const blocked = { ...(await field()), sent: await tab.evaluate(() => (globalThis.__manualLeads ?? []).length) };
      const channelBlocked = await channelField();
      expect(`${width}: without a source nothing is sent; the source says «Выберите источник» and keeps focus as the first invalid field`,
        blocked.sent === 0 && blocked.invalid === "true" && blocked.message === "Выберите источник" && blocked.error === "Выберите источник" && blocked.focused, blocked);
      expect(`${width}: the empty «Откуда узнал» says «Выберите, откуда узнал клиент» without taking focus`,
        channelBlocked.invalid === "true" && channelBlocked.message === "Выберите, откуда узнал клиент" && channelBlocked.error === "Выберите, откуда узнал клиент" && !channelBlocked.focused, channelBlocked);
      await tab.screenshot({ path: join(outDir, `e811-manual-lead-required-${width}.png`), fullPage: true });

      await source.selectOption("phone_call");
      const chosen = await field();
      expect(`${width}: choosing a source clears the error`, chosen.invalid === null && chosen.message === "" && chosen.error === null, chosen);
      await tab.getByRole("button", { name: "Сохранить лида" }).click();
      await tab.waitForTimeout(150);
      const channelOnly = { ...(await channelField()), sent: await tab.evaluate(() => (globalThis.__manualLeads ?? []).length) };
      expect(`${width}: with a source but no «Откуда узнал» nothing is sent and the channel takes focus`,
        channelOnly.sent === 0 && channelOnly.invalid === "true" && channelOnly.error === "Выберите, откуда узнал клиент" && channelOnly.focused, channelOnly);
      await channel.selectOption("unknown");
      const unknownChosen = await channelField();
      expect(`${width}: «Не известно» clears the error and shows «Спросите клиента»`,
        unknownChosen.invalid === null && unknownChosen.message === "" && unknownChosen.error === null && unknownChosen.hint === "Спросите клиента", unknownChosen);
      await channel.selectOption("referral");
      await tab.getByRole("button", { name: "Сохранить лида" }).click();
      await tab.waitForFunction(() => (globalThis.__manualLeads ?? []).length === 1, null, { timeout: 5_000 }).catch(() => {});
      const sent = await tab.evaluate(() => globalThis.__manualLeads ?? []);
      expect(`${width}: the chosen keys are what the form sends`, sent.length === 1 && sent[0].source === "phone_call" && sent[0].channel === "referral", sent);

      if (errors.length) failures.push(`${width} browser errors: ${errors.join(" | ")}`);
      await browserContext.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`manual lead form: ${failures.length} failed:\n${failures.join("\n")}`);
}

// --- М1: «Исправить» в Lead 360 и «Добавить расход» -------------------------
const CHANNEL_SPEND_ROOT_ID = "channel-spend-root";
const CHANNEL_SPEND_ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { LeadChannelCorrection } from "../../src/components/v3/profile/LeadChannelCorrection";
import { MarketingSpendForm } from "../../src/components/v3/marketing/MarketingSpendForm";

createRoot(document.getElementById("${CHANNEL_SPEND_ROOT_ID}")).render(
  createElement("div", { className: "space-y-6" },
    createElement("section", { "data-testid": "correction" },
      createElement(LeadChannelCorrection, { leadId: "30000000-0000-4000-8000-000000000001", requestId: "70000000-0000-4000-8000-000000000001", current: "unknown" })),
    createElement("section", { "data-testid": "spend" },
      createElement(MarketingSpendForm, { requestId: "70000000-0000-4000-8000-000000000002", defaultStart: "2026-10-01", defaultEnd: "2026-10-31" }))),
);
`;

/**
 * React 19 сбрасывает `<form action>` после каждого действия (form.reset()): select, привязанный к
 * состоянию, показал бы первый канал, а повтор отправил бы его. Здесь — настоящие компоненты.
 */
async function channelSpendForms() {
  const outIndex = process.argv.indexOf("--channel-spend-forms") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const bundle = join(outDir, "m1-channel-spend-client.js");
  await require("esbuild").build({
    stdin: { contents: CHANNEL_SPEND_ENTRY, resolveDir: __dirname, sourcefile: "m1-channel-spend-entry.js", loader: "js" },
    bundle: true, outfile: bundle, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [switchStubs], logLevel: "error",
  });
  const htmlPath = join(outDir, "m1-channel-spend.html");
  writeFileSync(htmlPath, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Исправить и расход (синтетические данные)</title><style>${await compileCss()}</style></head>`,
    `<body class="min-h-full bg-bg"><div class="v3-world" data-surface="staff"><main class="p-4 md:p-6"><div id="${CHANNEL_SPEND_ROOT_ID}"></div></main></div>`,
    `<script src="m1-channel-spend-client.js"></script></body></html>`,
  ].join(""));

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  const expect = (label, ok, facts) => {
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` ${JSON.stringify(facts)}`}\n`);
    if (!ok) failures.push(label);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await tab.evaluate(() => { globalThis.__correctionResults = ["unavailable", "saved"]; globalThis.__spendResults = ["unavailable", "request_conflict", "saved"]; });

    // «Исправить»: «неизвестно» → тот же выбор и тот же id; затем «Сохранено».
    const correction = tab.getByTestId("correction");
    await correction.getByText("Исправить").click();
    const select = correction.locator('select[name="channel"]');
    const save = correction.getByRole("button", { name: "Сохранить" });
    const correctionState = async () => ({
      value: await select.inputValue(), disabled: await save.isDisabled(),
      alert: await correction.locator('[role="alert"]').textContent().catch(() => null),
      status: await correction.locator('[role="status"]').textContent().catch(() => null),
      sent: await tab.evaluate(() => globalThis.__corrections ?? []),
    });
    await select.selectOption("referral");
    await save.click();
    await tab.waitForFunction(() => (globalThis.__corrections ?? []).length === 1, null, { timeout: 5_000 }).catch(() => {});
    await correction.locator('[role="alert"]').waitFor({ timeout: 5_000 }).catch(() => {});
    const afterUnknown = await correctionState();
    expect("correction: after «неизвестно» the select still shows the chosen channel and «Сохранить» stays available",
      afterUnknown.value === "referral" && !afterUnknown.disabled && afterUnknown.alert?.startsWith("Результат пока неизвестен"), afterUnknown);
    await save.click();
    await tab.waitForFunction(() => (globalThis.__corrections ?? []).length === 2, null, { timeout: 5_000 }).catch(() => {});
    await correction.locator('[role="status"]').waitFor({ timeout: 5_000 }).catch(() => {});
    const afterSaved = await correctionState();
    expect("correction: the retry sends the same channel with the same request id",
      afterSaved.sent.length === 2 && afterSaved.sent.every((one) => one.channel === "referral") && afterSaved.sent[0].request_id === afterSaved.sent[1].request_id, afterSaved.sent);
    expect("correction: after «Сохранено» the select shows the saved channel and «Сохранить» waits for another choice",
      afterSaved.value === "referral" && afterSaved.disabled && afterSaved.status === "Сохранено: Рекомендация · исправлено", afterSaved);

    // «Добавить расход»: введённое остаётся до записи; конфликт даёт новый id; после записи форма пуста.
    const spend = tab.getByTestId("spend");
    await spend.getByText("Добавить расход").click();
    const submit = spend.getByRole("button", { name: "Записать расход" });
    await spend.locator('input[name="period_start"]').fill("2026-10-02");
    await spend.locator('input[name="amount"]').fill("1200");
    await spend.locator('select[name="currency"]').selectOption("EUR");
    await spend.locator('input[name="campaign"]').fill("KG - Leads");
    await spend.locator('input[name="note"]').fill("синтетика");
    const spendState = async () => ({
      start: await spend.locator('input[name="period_start"]').inputValue(), amount: await spend.locator('input[name="amount"]').inputValue(),
      currency: await spend.locator('select[name="currency"]').inputValue(), campaign: await spend.locator('input[name="campaign"]').inputValue(),
      note: await spend.locator('input[name="note"]').inputValue(),
      message: await spend.locator('[role="alert"], [role="status"]').textContent().catch(() => null),
      sent: await tab.evaluate(() => globalThis.__spends ?? []),
    });
    const typed = { start: "2026-10-02", amount: "1200", currency: "EUR", campaign: "KG - Leads", note: "синтетика" };
    const kept = (state) => Object.entries(typed).every(([key, value]) => state[key] === value);
    const submitAndWait = async (count, text) => {
      await submit.click();
      await tab.waitForFunction((n) => (globalThis.__spends ?? []).length === n, count, { timeout: 5_000 }).catch(() => {});
      await spend.getByText(text).waitFor({ timeout: 5_000 }).catch(() => {});
      return spendState();
    };
    const first = await submitAndWait(1, "Результат пока неизвестен");
    expect("spend: after «неизвестно» everything typed is still in the form", kept(first) && first.message?.startsWith("Результат пока неизвестен"), first);
    const second = await submitAndWait(2, "Этот запрос уже записан");
    expect("spend: the retry after «неизвестно» reuses the request id, and a conflict keeps the form",
      second.sent[1]?.request_id === second.sent[0]?.request_id && second.sent[1]?.amount === "1200" && kept(second), second);
    const third = await submitAndWait(3, "Расход записан.");
    expect("spend: after a conflict the next submission has a new request id",
      third.sent.length === 3 && third.sent[2].request_id !== third.sent[1].request_id && third.sent[2].amount === "1200", third.sent);
    expect("spend: after «Расход записан» the form is empty for the next entry",
      third.amount === "" && third.campaign === "" && third.note === "" && third.start === "2026-10-01" && third.currency === "USD" && third.message === "Расход записан.", third);
    await tab.screenshot({ path: join(outDir, "m1-channel-spend-1440.png"), fullPage: true });

    if (errors.length) failures.push(`browser errors: ${errors.join(" | ")}`);
    await context.close();
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`channel/spend forms: ${failures.length} failed:\n${failures.join("\n")}`);
}

// --- F1 (Э7): одна боковая панель — путь по гидратированным «Заявкам» --------
// Настоящая страница в оболочке; `RequestsQueueView` обёрнут контейнером, в
// котором браузерная сборка отрисовывает его заново с теми же свойствами.
// Адрес — состояние стенда: push открывает запись из `open` или закрывает
// панель, как сервер.
const F1_ROOT_ID = "requests-f1-root";
const F1_FIXTURE_ID = "requests-f1-fixture";
const F1_ENTRY = `
import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { RequestsQueueView } from "../../src/components/v3/requests/RequestsQueueView";

const fixture = JSON.parse(document.getElementById("${F1_FIXTURE_ID}").textContent);
const listeners = new Set();
const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, replace() {}, prefetch() {},
  push(href) { (globalThis.__staticPushes ||= []).push(String(href)); for (const listener of listeners) listener(String(href)); } };
function openAt(href) {
  const value = new URL(href, "https://crm.invalid").searchParams.get("open");
  if (!value) return null;
  const [kind, id] = value.split(":");
  return { kind, id };
}
function Host() {
  const [open, setOpen] = useState(fixture.props.open);
  useEffect(() => {
    const listener = (href) => setOpen(openAt(href));
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return createElement(RequestsQueueView, { ...fixture.props, open });
}
createRoot(document.getElementById("${F1_ROOT_ID}")).render(
  createElement(AppRouterContext.Provider, { value: router },
    createElement(PathnameContext.Provider, { value: "/v3/requests" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(fixture.search) }, createElement(Host)))),
);
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.clientRendered = "1"; }));
`;

/** Элемент, найденный `match`, заменяется `replace` — остальное дерево то же. */
function mapElement(node, match, replace) {
  const { cloneElement, isValidElement } = require("react");
  if (Array.isArray(node)) return node.map((child) => mapElement(child, match, replace));
  if (!isValidElement(node)) return node;
  if (match(node)) return replace(node);
  const { children } = node.props;
  if (children === undefined) return node;
  // Дети — прежним порядком аргументов: как в JSX, без требования ключей.
  return Array.isArray(children)
    ? cloneElement(node, undefined, ...children.map((child) => mapElement(child, match, replace)))
    : cloneElement(node, undefined, mapElement(children, match, replace));
}

async function f1() {
  const probe = require("./side-panel-probe.cjs");
  const outIndex = process.argv.indexOf("--f1") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const { RequestsQueueView } = require(join(ROOT, "src/components/v3/requests/RequestsQueueView.tsx"));
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const page = require(join(ROOT, "src/app/(v3)/v3/requests/page.tsx")).default;
  current = SCENARIOS["drawer-lead"];
  const originalUuid = nodeCrypto.randomUUID;
  const RealDate = Date;
  nodeCrypto.randomUUID = syntheticUuids();
  globalThis.Date = class extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(NOW.getTime()); }
    static now() { return NOW.getTime(); }
  };
  let html;
  let props;
  try {
    const content = await page({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(current.search))) });
    const wrapped = mapElement(content, (element) => element.type === RequestsQueueView, (element) => {
      props = element.props;
      return createElement("div", { id: F1_ROOT_ID }, element);
    });
    const tree = createElement("div", { className: "v3-world", "data-surface": "staff" },
      createElement(AppShell, { actor: ACTORS[current.actor], initialNotifications: null }, wrapped));
    html = renderToStaticMarkup(withContexts(tree, current.search));
  } finally {
    nodeCrypto.randomUUID = originalUuid;
    globalThis.Date = RealDate;
  }
  if (!props || !props.open) throw new Error("the page renders no RequestsQueueView with an open record");
  const key = `${props.open.kind}:${props.open.id}`;
  const bundleName = "f1-requests-client.js";
  await require("esbuild").build({
    stdin: { contents: F1_ENTRY, resolveDir: __dirname, sourcefile: "requests-f1-entry.js", loader: "js" },
    bundle: true, outfile: join(outDir, bundleName), format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [probe.linkShim(ROOT), switchStubs], logLevel: "error",
  });
  const htmlPath = join(outDir, "f1-requests.html");
  writeFileSync(htmlPath, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Заявки — одна боковая панель (синтетические данные)</title><style>${await compileCss()}</style></head>`,
    `<body class="min-h-full">${html}<script type="application/json" id="${F1_FIXTURE_ID}">${JSON.stringify({ props, search: current.search }).replaceAll("<", "\\u003c")}</script><script src="${bundleName}"></script></body></html>`,
  ].join(""));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const [width, context] of probe.F1_WIDTHS) {
      const browserContext = await browser.newContext(context);
      const tab = await browserContext.newPage();
      const errors = [];
      tab.on("pageerror", (error) => errors.push(error.message));
      tab.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await tab.evaluate(() => document.fonts.ready);
      await tab.waitForSelector("html[data-client-rendered]", { state: "attached", timeout: 10_000 });
      await tab.waitForTimeout(400);
      await tab.screenshot({ path: join(outDir, `f1-requests-${width}.png`) });
      const open = `[data-queue-row="${key}"] [data-queue-open]`;
      const result = await probe.journey(tab, {
        selected: '[data-queue-row]:has([data-queue-open][aria-current="true"])',
        returnSelector: open,
        reopen: () => tab.click(open),
        scrolledPath: join(outDir, `f1-requests-${width}-scrolled.png`),
      });
      if (errors.length) result.failures.push(`browser errors: ${errors.join(" | ")}`);
      probe.report({ screen: "requests", width, ...result });
      failures.push(...result.failures.map((failure) => `requests ${width}: ${failure}`));
      await browserContext.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`side panel (requests): ${failures.length} failed:\n${failures.join("\n")}`);
}

if (process.argv.includes("--json")) {
  json().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--f1")) {
  f1().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--panel-keys")) {
  panelKeys().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--manual-lead-owners")) {
  manualLeadOwners().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--manual-lead-form")) {
  manualLeadForm().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--channel-spend-forms")) {
  channelSpendForms().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--switch")) {
  switchCheck().catch((error) => { console.error(error); process.exit(1); });
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => { console.error(error); process.exit(1); });
} else {
  console.error("usage: requests-static-render.cjs --json | --panel-keys | --manual-lead-owners | --manual-lead-form [outDir] | --channel-spend-forms [outDir] | --switch [outDir] | --screenshots [outDir] | --f1 [outDir]");
  process.exit(2);
}
