"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в today-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер Э6 плана редизайна (27.09.2026) — справочные и
 * служебные страницы: «Университеты» (список и страница вуза), «Настройки»
 * («Сотрудники», «Интеграции») и меню Admin, поступления и продаж.
 *
 * Страницы — НАСТОЯЩИЕ `page.tsx` маршрутов (`universities`, `universities/[id]`,
 * `settings`) внутри настоящего `AppShell`; чтения подменены. Каталог —
 * проверенные шаблоны карточек репозитория (`src/lib/server/
 * university-catalog-reviewed-*.json`, публичные сведения о вузах) как
 * опубликованные версии; сотрудники, роли и состояние сервисов —
 * СИНТЕТИЧЕСКИЕ, выдуманы для проверки вёрстки и не являются записями EVO.
 * Права ролей — шаблоны миграции 173 (`staff-role-templates.cjs`). Живой
 * Supabase, права сервера и серверные действия этот рендер не проверяет.
 *
 *   node tests/e2e/reference-static-render.cjs --json
 *     → stdout: JSON [{ name, look, html }] — разметка страниц с оболочкой.
 *   node tests/e2e/reference-static-render.cjs --screenshots [outDir]
 *     → снимки Playwright Chromium 1440×900, 1280×800 и 390×844 в обоих
 *       обликах (`-next` — предпросмотр нового облика с его оболочкой);
 *       меню ролей — с раскрытыми отделами (на телефоне — открытое меню).
 *       По умолчанию outDir — .impeccable/review (не коммитится). Проверки
 *       (прокрутка вбок, текст мельче 12 px, h1, сплошной красный) печатаются
 *       строками JSON.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      resolveJsonModule: true,
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

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
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

function stubModule(path, exports) {
  const filename = join(ROOT, path);
  const stub = new Module(filename);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = require("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ImageConfigContext } = require("next/dist/shared/lib/image-config-context.shared-runtime");
const { imageConfigDefault } = require("next/dist/shared/lib/image-config");
const { staffRoleKeys } = require("./staff-role-templates.cjs");

// --- синтетические данные ---------------------------------------------------
// «Сейчас» — суббота 27.09.2026, 10:00 по Бишкеку (04:00 UTC). Страницы берут
// `new Date()`; для повторяемых снимков часы подменены этим моментом.
const NOW = new Date("2026-09-27T04:00:00.000Z");
const RealDate = Date;
/** Часы страниц — только на время рендера: Playwright дальше нужны настоящие. */
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
  static now() { return NOW.getTime(); }
}

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const uuid = (prefix, n) => `${prefix}-${String(n).padStart(12, "0")}`;

const actor = (fields) => ({
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, platformAccessVersion: 1, email: "synthetic@example.invalid", presentationRole: null,
  ...fields,
});
const own = (label) => [{ id: "99999999-1111-4111-8111-000000000001", roleId: "99999999-1111-4111-8111-000000000002", label, bundleId: "b", bundleVersion: 1, scope: { kind: "own", key: null, resourceKind: null } }];
const ACTORS = {
  admin: actor({ displayName: "Администратор (синтетический)", systemRole: "admin", assignments: [], permissionKeys: [] }),
  admissions: actor({ displayName: "Куратор (синтетический)", systemRole: "staff", assignments: own("Admissions"), permissionKeys: staffRoleKeys("admissions") }),
  sales: actor({ displayName: "Менеджер продаж (синтетический)", systemRole: "staff", assignments: own("Sales Manager"), permissionKeys: staffRoleKeys("sales-manager") }),
};

// Каталог: проверенные шаблоны карточек как опубликованные версии.
const CATALOGUE = ["china", "malaysia", "europe", "turkey", "international", "other"]
  .flatMap((name) => JSON.parse(readFileSync(join(ROOT, `src/lib/server/university-catalog-reviewed-${name}.json`), "utf8")))
  .map((entry, index) => ({
    id: `57ce9b97-43fb-4563-9c61-${String(index + 1).padStart(12, "0")}`,
    version: 1,
    publishedAt: "2026-09-10T00:00:00+00:00",
    content: entry.content,
    key: entry.key,
  }));
const published = (item) => ({ id: item.id, version: item.version, publishedAt: item.publishedAt, content: item.content });

function filterCatalogue(filters) {
  const query = (filters.query ?? "").toLocaleLowerCase("ru");
  return CATALOGUE
    .filter((item) => !query || item.content.name.toLocaleLowerCase("ru").includes(query))
    .filter((item) => !filters.country || item.content.country === filters.country)
    .filter((item) => !filters.level || item.content.programs.some((program) => program.level === filters.level))
    .sort((a, b) => (a.content.name < b.content.name ? -1 : a.content.name > b.content.name ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * Клиент Supabase для настоящего `university-source.ts`: ответы чтений
 * `staff_university_catalog` (30 строк и следующее смещение, как у SQL 148) и
 * `staff_university_catalog_countries`. Так рендер проходит и полное чтение
 * каталога страницами, и разбор ответа (`parseUniversityPage`).
 */
const fakeSupabase = {
  schema() {
    return {
      async rpc(name, args) {
        if (name === "staff_university_catalog_countries") {
          return { data: { organizationId: ORG, countries: [...new Set(CATALOGUE.map((item) => item.content.country))].sort() }, error: null };
        }
        if (name !== "staff_university_catalog") return { data: null, error: { message: `unexpected rpc ${name}` } };
        if (args.p_institution_id) return { data: { items: CATALOGUE.filter((item) => item.id === args.p_institution_id).map(published), nextOffset: null }, error: null };
        const all = filterCatalogue({ query: args.p_query ?? "", country: args.p_country ?? "", level: args.p_level ?? "" });
        const offset = args.p_offset;
        return { data: { items: all.slice(offset, offset + 30).map(published), nextOffset: offset + 30 < all.length ? offset + 30 : null }, error: null };
      },
    };
  },
};

// Сотрудники и роли (синтетика).
const DEPARTMENTS = [
  { id: uuid("dddddddd-2222-4222-8222", 1), name: "Продажи", description: null, status: "active", version: 1, memberCount: 2 },
  { id: uuid("dddddddd-2222-4222-8222", 2), name: "Сопровождение", description: null, status: "active", version: 1, memberCount: 3 },
];
const PEOPLE = [
  ["Айна Тестова", "Руководитель сопровождения", 2, ["CN", "MY"]],
  ["Бекболот Примеров", "Менеджер продаж", 1, []],
  ["Камила Вымыслова", "Куратор", 2, ["EU"]],
  ["Данияр Макетов", "Менеджер продаж", 1, []],
  ["Эльмира Формова", "Куратор", 2, ["TR", "AE"]],
];
const MEMBERS = PEOPLE.map(([displayName, jobTitle, department, directions], index) => ({
  membershipId: uuid("aaaaaaaa-1111-4111-8111", index + 10), displayName, status: index === 3 ? "suspended" : "active", version: 3,
  metadata: { version: 1, departmentId: DEPARTMENTS[department - 1].id, jobTitle, directions },
}));
const ROLES = [
  { id: uuid("99999999-3333-4333-8333", 1), label: "Admissions", description: "Кураторы поступления", status: "active", version: 1, bundleId: uuid("99999999-4444-4444-8444", 1), bundleVersion: 1, permissionKeys: ["case.read.full"], draftPermissionKeys: ["case.read.full"], memberCount: 2 },
  { id: uuid("99999999-3333-4333-8333", 2), label: "Sales Manager", description: "Продажи", status: "active", version: 1, bundleId: uuid("99999999-4444-4444-8444", 2), bundleVersion: 1, permissionKeys: ["lead.read"], draftPermissionKeys: ["lead.read"], memberCount: 2 },
];
const ROLE_WORKSPACE = {
  schemaVersion: 1,
  permissions: [
    { key: "case.read.full", label: "Читать дело полностью", group: "Поступление", allowedScopes: ["own", "department", "organization"], resourceKinds: [], sensitive: false, systemOnly: false },
    { key: "lead.read", label: "Читать лиды", group: "Продажи", allowedScopes: ["own", "department", "organization"], resourceKinds: [], sensitive: false, systemOnly: false },
  ],
  roles: ROLES,
  members: MEMBERS.map((member, index) => ({
    membershipId: member.membershipId, displayName: member.displayName, systemRole: index === 0 ? "admin" : "staff", accessVersion: 3,
    assignments: index === 0 ? [] : [{ id: uuid("99999999-5555-4555-8555", index), roleId: ROLES[index % 2 === 0 ? 0 : 1].id, label: ROLES[index % 2 === 0 ? 0 : 1].label, bundleId: ROLES[0].bundleId, bundleVersion: 1, scope: { kind: "organization", key: null, resourceKind: null } }],
  })),
  departments: DEPARTMENTS.map(({ id, name, status }) => ({ id, name, status })),
};

// Состояние сервисов: как в production 26–27.09 (WhatsApp не подключён, Gemini и amoCRM не используются)
// и сломанный настроенный сервис — для единственного предупреждения сверху.
const PROVIDERS = {
  production: { waha: { display: "not_configured", sessionStatus: undefined, observedAt: null }, gemini: "not_configured", amo: { status: "blocked", reason: "configuration_missing" } },
  blocked: { waha: { display: "blocked", sessionStatus: "SCAN_QR_CODE", observedAt: "2026-09-26T08:15:00.000Z" }, gemini: "configured_not_verified", amo: { status: "blocked", reason: "token_unavailable" } },
};
let providerScenario = "production";
let who = ACTORS.admin;

function installStubs() {
  const { settingsIntegrations } = require(join(ROOT, "src/lib/v3/settings-health.ts"));
  stubModule("src/lib/platform-guards.ts", { async requireV3PageActor() { return who; } });
  stubModule("src/lib/supabase/server.ts", { async createSupabaseServerClient() { return fakeSupabase; } });
  stubModule("src/lib/v3/settings-source.ts", {
    readAuditExportEnabled: () => false,
    async readGateFacts() { return { handoffs: 3, overrides: 0, financeStops: 0, evidence: 5, documents: 1 }; },
    async readIntegrations() { return settingsIntegrations(PROVIDERS[providerScenario], new Date()); },
    async readJournal() { return { entries: [], cursorHonored: true }; },
    async readJournalFacets() { return { objectTypes: [] }; },
    async readPlatformFact() { return "не проверялось"; },
  });
  stubModule("src/lib/v3/look-preview.ts", { async readLookPreview() { return false; } });
  stubModule("src/lib/v3/sales-register-source.ts", { async readSalesRegisterManagement() { return { status: "denied" }; } });
  stubModule("src/lib/v3/staff-workspace-source.ts", { async readStaffWorkspace() { return { members: MEMBERS, requests: [], available: true, departments: DEPARTMENTS }; } });
  stubModule("src/lib/server/staff-roles-service.ts", { async readStaffRoles() { return ROLE_WORKSPACE; } });
  // Серверные действия форм сотрудников: рендеру нужны только их ссылки.
  const noop = async () => ({ status: "idle", message: "" });
  stubModule("src/lib/staff-workspace-actions.ts", new Proxy({}, { get: () => noop }));
  stubModule("src/lib/staff-roles-actions.ts", new Proxy({}, { get: () => noop }));
  stubModule("src/lib/v3/look-preview-actions.ts", { setLookPreviewAction: noop });
}

// --- рендер ------------------------------------------------------------------
const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

function withContexts(node, pathname, search) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: pathname },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

const DETAIL_KEY = "utm";
const detailId = () => CATALOGUE.find((item) => item.key === DETAIL_KEY)?.id ?? CATALOGUE[0].id;

/** Страницы: [имя, роль, путь, поиск, сценарий сервисов]. */
const PAGES = [
  ["universities-list", "admin", "/v3/universities", "", "production"],
  ["universities-list-filtered", "admin", "/v3/universities", "country=MY&level=bachelor", "production"],
  ["universities-detail", "admin", () => `/v3/universities/${detailId()}`, "", "production"],
  ["settings-staff", "admin", "/v3/settings", "", "production"],
  ["settings-integrations", "admin", "/v3/settings", "section=integrations", "production"],
  ["settings-integrations-blocked", "admin", "/v3/settings", "section=integrations", "blocked"],
  ["menu-admin", "admin", "/v3/universities", "", "production"],
  ["menu-admissions", "admissions", "/v3/universities", "", "production"],
  ["menu-sales", "sales", "/v3/universities", "", "production"],
];

async function pageNode(pathname, search) {
  const params = Object.fromEntries(new URLSearchParams(search));
  if (pathname === "/v3/universities") {
    const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/universities/page.tsx"));
    return Page({ searchParams: Promise.resolve(params) });
  }
  if (pathname.startsWith("/v3/universities/")) {
    const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/universities/[id]/page.tsx"));
    return Page({ params: Promise.resolve({ id: pathname.split("/").at(-1) }) });
  }
  const { default: Page } = require(join(ROOT, "src/app/(v3)/v3/settings/page.tsx"));
  return Page({ searchParams: Promise.resolve(params) });
}

async function renderPage([name, role, path, search, providers], look) {
  who = ACTORS[role];
  providerScenario = providers;
  const pathname = typeof path === "function" ? path() : path;
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const node = await pageNode(pathname, search);
  const page = createElement("div", { className: "v3-world", "data-look": look === "next" ? "next" : undefined },
    createElement(AppShell, { actor: who, initialNotifications: null, ...(look === "next" ? { look: "next" } : {}) }, node));
  return { name, role, look, pathname, html: renderToStaticMarkup(withContexts(page, pathname, search)) };
}

async function renderAll() {
  installStubs();
  const pages = [];
  global.Date = FixedDate;
  try {
    for (const look of ["current", "next"]) {
      for (const entry of PAGES) pages.push(await renderPage(entry, look));
    }
  } finally {
    global.Date = RealDate;
  }
  return pages;
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

/** Меню ролей: все отделы раскрыты; на телефоне — открытое меню (прежний облик) или лист «Ещё» (новый). */
function openMenu({ phone, look }) {
  for (const list of document.querySelectorAll("nav ul[id][hidden]")) list.hidden = false;
  for (const button of document.querySelectorAll("nav button[aria-expanded]")) button.setAttribute("aria-expanded", "true");
  if (!phone) return;
  if (look === "next") {
    const menu = document.querySelector("[data-shell-menu]");
    menu.classList.remove("hidden");
    menu.classList.add("flex", "max-md:fixed", "max-md:inset-0", "max-md:z-50");
    return;
  }
  const toggle = document.querySelector('nav[aria-label="Разделы"] button[aria-controls]');
  const panel = document.getElementById(toggle.getAttribute("aria-controls"));
  panel.classList.remove("hidden");
  panel.classList.add("flex");
}

async function screenshots(pages) {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const VIEWPORTS = [
    ["1440", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
    ["1280", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
    ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ];
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  let failed = false;
  try {
    for (const page of pages) {
      const suffix = page.look === "next" ? "-next" : "";
      const htmlPath = join(outDir, `e6-${page.name}${suffix}.html`);
      writeFileSync(htmlPath, [
        "<!DOCTYPE html>",
        '<html lang="ru" data-theme="light" class="h-full antialiased">',
        `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Э6 — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
        `<body class="min-h-full">${page.html}</body></html>`,
      ].join(""));
      for (const [width, context] of VIEWPORTS) {
        const browserContext = await browser.newContext(context);
        const tab = await browserContext.newPage();
        const errors = [];
        tab.on("pageerror", (error) => errors.push(error.message));
        await tab.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 60_000 });
        await tab.evaluate(() => document.fonts.ready);
        // Фото кампусов грузятся из источников: ждём, но не дольше 15 с (снимок честно покажет незагруженное).
        await tab.waitForFunction(() => [...document.images].every((image) => image.complete || image.getClientRects().length === 0), null, { timeout: 15_000 }).catch(() => {});
        if (page.name.startsWith("menu-")) await tab.evaluate(openMenu, { phone: width === "390", look: page.look });
        if (errors.length) { failed = true; console.error(`${page.name}${suffix} ${width}: ${errors.join("; ")}`); }
        const metrics = await tab.evaluate(() => {
          const main = document.querySelector("main");
          const texts = [...document.querySelectorAll("body *")].filter((element) => {
            if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) return false;
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return box.width > 1 && box.height > 1 && style.visibility !== "hidden" && parseFloat(style.fontSize) < 12;
          });
          const red = [...document.querySelectorAll("a, button, span")].filter((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return box.width > 30 && box.height > 20 && style.backgroundColor === "rgb(215, 2, 23)";
          });
          const rows = [...document.querySelectorAll("[data-university-row]")];
          return {
            docHeight: document.documentElement.scrollHeight,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            small: texts.length,
            h1: [...document.querySelectorAll("h1")].filter((element) => element.getClientRects().length).length,
            solidRed: red.length,
            rowsAboveFold: rows.filter((row) => row.getBoundingClientRect().bottom <= window.innerHeight).length,
            rowHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
            main: Boolean(main),
          };
        });
        const file = `e6-${page.name}-${width}${suffix}.png`;
        await tab.screenshot({ path: join(outDir, file) });
        // Во весь рост — страницы (не меню) на 1440 и на телефоне: видна длина страницы.
        if (!page.name.startsWith("menu-") && width !== "1280") await tab.screenshot({ path: join(outDir, `e6-${page.name}-${width}-full${suffix}.png`), fullPage: true });
        console.log(JSON.stringify({ file, ...metrics }));
        if (metrics.overflowX > 0 || metrics.small > 0 || metrics.h1 !== 1) failed = true;
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exitCode = 1;
}

(async () => {
  const pages = await renderAll();
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(pages));
    return;
  }
  if (process.argv.includes("--screenshots")) await screenshots(pages);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
