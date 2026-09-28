"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению (тот же приём, что в case-static-render.cjs).
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер вкладки «Вузы и программы» дела студента
 * (`/v3/profile?case=…&tab=route`, Э8.2, решение владельца 28.09.2026).
 *
 * Рендерит НАСТОЯЩУЮ сборку страницы — `caseWorkParts` (шапка и действия у
 * заголовка), `Profile` с вкладкой `route`, `UniversityProgramsView` (та же
 * разметка, что у `UniversityProgramsTab` после чтений), `PartShell` и
 * `AppShell` — с СИНТЕТИЧЕСКИМИ данными: вузы, программы, имена и даты
 * выдуманы для проверки вёрстки и не являются записями EVO. Живой Supabase,
 * права и данные этот рендер не проверяет. Страница не гидратируется: «⋯»
 * строки открывается атрибутом popover, окно каталога — `showModal()`,
 * форма строки — снятием `hidden` (то же, что делает щелчок по пункту «⋯»).
 *
 *   node tests/e2e/case-route-static-render.cjs --json
 *     → stdout: JSON [{ name, html }] — разметка сценариев без оболочки.
 *   node tests/e2e/case-route-static-render.cjs --client [outDir]
 *     → тот же список в браузере с настоящим React (бандл esbuild, серверные
 *       действия — заглушки): «⋯ → Отметить статус», «Скрыть», «Пакет
 *       партнёру», «Документы программы», окно каталога, ручной ввод и
 *       сохранённые запросы без результата. Проверки печатаются.
 *   node tests/e2e/case-route-static-render.cjs --screenshots [outDir]
 *     → страницы с AppShell, CSS из globals.css + v3.css (Tailwind v4 через
 *       @tailwindcss/postcss, как в сборке) и снимки Playwright Chromium
 *       1440×900, 1280×800 и 390×844 в outDir (по умолчанию
 *       .impeccable/review, не коммитится), файлы `route-*.png`, и строка
 *       замеров на каждый снимок: переполнение по ширине, видимый текст
 *       мельче 12 px, сплошные красные заливки, цели нажатия ниже 44 px.
 *
 * Сценарии: `empty` — вузов нет; `one-variant` — один вариант из каталога;
 * `decision` — основной вариант, поданная заявка и решение; `many` — много
 * строк (срок сегодня и прошедший, отозванная, подготовка без строки заявки);
 * `accept` — дело ждёт ответа куратора: у заголовка «Принять дело», кнопка
 * каталога нейтральная; `lead` — страница лида: «Приём дела» остаётся;
 * `packet` — «⋯ → Пакет партнёру»: панель пакетов открыта, заявка выбрана.
 */

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const ROOT = resolve(__dirname, "../..");

// --- require-hook: .ts/.tsx компилируются TypeScript'ом в CJS ---------------
const compile = (source, fileName) =>
  ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8"), filename), filename);
  };
}
Module._extensions[".png"] = (module, filename) => {
  module.exports = { src: pathToFileURL(filename).href, width: 1843, height: 842 };
};
// CSS-модули: имя класса — сам ключ; у окна добавления вуза — с префиксом, его стили подключаются ниже.
const DIALOG_CSS = join(ROOT, "src/components/v3/profile/ApplicationCreateDialog.module.css");
// `import styles from "…module.css"` компилируется в `__importDefault(require(…)).default`: у прокси нет
// `__esModule`, а `default` — он сам.
Module._extensions[".css"] = (module, filename) => {
  const prefix = filename === DIALOG_CSS ? "acd-" : "";
  const classes = new Proxy({}, {
    get: (_target, key) => (key === "default" ? classes : key === "__esModule" || typeof key !== "string" ? undefined : `${prefix}${key}`),
  });
  module.exports = classes;
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (request === "server-only") return originalResolve.call(this, join(ROOT, "node_modules/server-only/empty.js"), ...rest);
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

const { caseWorkParts } = require(join(ROOT, "src/components/v3/profile/CaseWorkParts.tsx"));
const { Profile } = require(join(ROOT, "src/components/v3/profile/Profile.tsx"));
const { UniversityProgramsView } = require(join(ROOT, "src/components/v3/profile/UniversityProgramsTab.tsx"));
const { buildV3ProfileHref } = require(join(ROOT, "src/components/v3/profile/types.ts"));
const queueView = require(join(ROOT, "src/components/v3/students/students-queue-view.ts"));

// --- синтетические данные ---------------------------------------------------
// «Сегодня» — среда 23.09.2026 по Бишкеку (как в статическом рендере дела).
const TODAY = "2026-09-23";
const NOW = queueView.bishkekNoon(TODAY);
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const CASE_ID = "cccccccc-2222-4222-8222-000000000001";
const LEAD_ID = "dddddddd-3333-4333-8333-000000000001";
const NAME = "Айдана Сыдыкова";
const uuid = (prefix, n) => `${prefix}-5555-4555-8555-${String(n).padStart(12, "0")}`;
const RETURN_TO = "/v3/profile?view=mine";
const HASH = "a".repeat(64);

const CURATOR = {
  authUserId: "bbbbbbbb-7777-4777-8777-000000000001", profileId: "bbbbbbbb-7777-4777-8777-000000000002",
  membershipId: ME, organizationId: ORG, displayName: "Куратор (синтетический)", systemRole: "staff",
  platformAccessVersion: 1, email: "synthetic@example.invalid", presentationRole: null,
  assignments: [{ label: "Сотрудник поступления", scope: { kind: "own" } }],
  permissionKeys: ["case.read.full", "profile.read.full", "case.route.manage", "case.update.append", "document.read.full",
    "document.manage", "document.review", "application.manage", "catalog.read", "task.create", "task.manage",
    "staff.task.read", "staff.task.create", "team.chat.admissions"],
};

function application(n, fields) {
  return {
    organizationId: ORG, universityApplicationId: uuid("66666666", n), version: "3", studentCaseId: CASE_ID, studentDisplayName: NAME,
    targetCountry: "CN", targetDegree: "bachelor", programDirection: null, intake: "2027", institutionName: fields.institution,
    programName: fields.program ?? null, isPrimary: fields.primary ?? false, universityDeadlineOn: fields.deadline ?? null,
    country: fields.country ?? "CN", degree: fields.degree ?? "bachelor", status: fields.status ?? "preparation",
    latestEvidenceReference: fields.evidence ?? null, createdAt: "2026-09-10T04:00:00.000Z", updatedAt: "2026-09-18T04:00:00.000Z",
    responsibleSalesDisplayName: null, currentCuratorDisplayName: "Айгүл Осмонова", documentCount: 0, openDocumentCount: 0,
    taskCount: 0, openTaskCount: 0, paymentObligationCount: 0, outstandingPaymentObligationCount: 0,
    createdByMembershipId: ME, createdByDisplayName: fields.addedBy === undefined ? "Айгүл Осмонова" : fields.addedBy,
  };
}

// Подготовка из каталога (214/218) — вуз, программа и набор синтетические.
function preparation(n, fields) {
  const programId = `program-${n}`;
  const intakeId = uuid("12345678", n);
  return {
    applicationId: uuid("66666666", n), studentCaseId: CASE_ID, institutionId: uuid("45454545", n), programId, intakeId,
    publicationId: uuid("56565656", n), publicationVersion: 3, catalogLevel: "bachelor", applicationDegree: "bachelor",
    selectedAt: "2026-09-12T04:00:00.000Z", deadlineStateAtSelection: fields.unconfirmed ? "needs_confirmation" : "confirmed",
    applicationStatus: fields.status ?? "preparation", applicationVersion: "3",
    content: {
      name: fields.institution, country: fields.country ?? "CN", city: fields.city ?? "Шанхай", overview: "Синтетическое описание.",
      websiteUrl: "https://example.invalid", sourceUrl: "https://example.invalid/source", verifiedOn: "2026-09-01", notes: "", photoKey: null,
      programs: [{
        id: programId, title: fields.program, level: "bachelor", duration: "4 года", language: "английский", summary: "Синтетика.",
        sourceUrl: "https://example.invalid/program",
        intakes: [{ id: intakeId, label: fields.intake ?? "Осень 2027", startDate: null, startMonth: "2027-09",
          applicationDeadline: fields.deadline ?? null, deadlineTime: null, timezone: "Asia/Shanghai", status: "open", note: "",
          sourceUrl: "https://example.invalid/intake", verifiedOn: "2026-09-01" }],
      }],
    },
  };
}

const PACKETS = {
  files: [{ slotId: "slot-1", versionId: uuid("77777777", 1), name: "Паспорт", sha256: HASH, versionNo: "1", sizeBytes: 480000, mimeType: "application/pdf" },
    { slotId: "slot-2", versionId: uuid("77777777", 2), name: "Аттестат", sha256: HASH, versionNo: "2", sizeBytes: 1200000, mimeType: "application/pdf" }],
  generatedExports: [], packets: [], workspaceRevision: HASH, maxArchiveBytes: 52428800,
};

const HANDOFF_PENDING = {
  organizationId: ORG, studentCaseId: CASE_ID, assignmentEventId: uuid("55555555", 1), canRespond: true, current: null, requestId: uuid("44444444", 1),
};
const HANDOFF_ACCEPTED = {
  ...HANDOFF_PENDING, canRespond: true,
  current: { acknowledgementId: uuid("33333333", 1), decision: "accepted", clarification: null, agreedContactDate: null, createdAt: "2026-09-21T04:00:00.000Z" },
};

const SCENARIOS = {
  empty: { applications: [], preparations: [] },
  "one-variant": {
    applications: [application(1, { institution: "Шанхайский университет", program: "Международная торговля", addedBy: "Айгүл Осмонова" })],
    preparations: [preparation(1, { institution: "Шанхайский университет", program: "Международная торговля", deadline: "2026-11-30" })],
  },
  decision: {
    applications: [
      application(1, { institution: "Шанхайский университет", program: "Международная торговля", primary: true }),
      application(2, { institution: "Университет Малайи", program: "Компьютерные науки", country: "MY", status: "submitted",
        deadline: "2026-09-30", evidence: "Номер заявления 0000 (синтетика)" }),
      application(3, { institution: "Чжэцзянский университет", program: "Экономика", status: "offer", deadline: "2026-08-15" }),
    ],
    preparations: [preparation(1, { institution: "Шанхайский университет", program: "Международная торговля", deadline: "2026-11-30" })],
    partner: [{ applicationId: uuid("66666666", 3), version: "4", partnerContact: "Партнёр «Синтетика»", externalLink: "https://example.invalid/offer",
      decisionReference: "Оффер № 0000", decisionNote: null }],
  },
  many: {
    applications: [
      application(1, { institution: "Шанхайский университет", program: "Международная торговля", primary: true }),
      application(2, { institution: "Пекинский университет языка и культуры", program: "Китайский язык", degree: "language", deadline: TODAY }),
      application(3, { institution: "Университет Фудань", program: "Финансы", status: "ready", deadline: "2026-09-18" }),
      application(4, { institution: "Университет Малайи", program: "Компьютерные науки", country: "MY", status: "under_review", deadline: "2026-09-01" }),
      application(5, { institution: "Стамбульский технический университет", program: null, country: "TR", addedBy: null }),
      application(6, { institution: "Чжэцзянский университет", program: "Экономика", status: "rejected" }),
      application(7, { institution: "Карлов университет", program: "Медицина", country: "CZ", status: "withdrawn", degree: "master" }),
    ],
    preparations: [
      preparation(1, { institution: "Шанхайский университет", program: "Международная торговля", deadline: "2026-11-30" }),
      preparation(2, { institution: "Пекинский университет языка и культуры", program: "Китайский язык", city: "Пекин", intake: "Весна 2027" }),
      // Подготовка, строки заявки которой нет в чтении дела, — строкой в конце, без «⋯».
      preparation(8, { institution: "Университет Цинхуа", program: "Архитектура", city: "Пекин", deadline: "2027-01-15", unconfirmed: true }),
    ],
  },
};
// «⋯ → Пакет партнёру» у решения: адрес `panel=packets&packet_application=…` — панель открыта, заявка выбрана.
SCENARIOS.packet = { ...SCENARIOS.decision, packetsOpen: true, packetApplication: uuid("66666666", 3) };
SCENARIOS.accept = { ...SCENARIOS["one-variant"], handoff: HANDOFF_PENDING };
SCENARIOS.lead = { ...SCENARIOS["one-variant"], handoff: HANDOFF_PENDING, lead: true };

function queueRow() {
  const nextAction = "Собрать апостиль на аттестат";
  return {
    studentCaseId: CASE_ID, studentDisplayName: NAME, state: "active", admissionsDirection: "CN", targetCountry: "CN", targetDegree: "Бакалавриат",
    pipelineStage: "documents", pipelineHidden: false, nextAction, nextActionDueOn: "2026-09-25",
    dueBand: queueView.caseNextActionBand(nextAction, "2026-09-25", NOW), admissionsVersion: "7", currentCuratorMembershipId: ME,
    currentCuratorDisplayName: "Айгүл Осмонова", isMine: true, attentionFlags: [], overdueTaskCount: 0, documents: null,
    updatedAt: "2026-09-22T04:00:00.000000Z", cursor: `due|0|2026-09-25|${CASE_ID}`,
  };
}

function profile(lead) {
  return {
    leadId: lead ? LEAD_ID : null, person: NAME, email: null, phone: null, student: true, stage: null, caseStatus: "active", source: null,
    qualification: null, arrived: "01.09.2026", nextAction: "Собрать апостиль на аттестат", nextActionAt: null, handoff: null,
    applications: [], visa: [], financeStop: null, timeline: [],
  };
}

function draft(item) {
  return {
    access: { documents: true, finance: false, studentProfile: true, contract: false },
    routeTarget: item.lead ? { leadId: LEAD_ID, studentCaseId: null } : { leadId: null, studentCaseId: CASE_ID },
    responsible: "Айгүл Осмонова", provider: null, person: [], study: [], profileFields: null, studentApplication: null,
    profileFieldSources: [], documents: [], otherFiles: [], budget: null, currency: null, payments: [], paid: null, remaining: null, paidPercent: null,
    admissions: {
      studentCaseId: CASE_ID, caseState: "active", isCabinetCase: false, direction: "CN", applications: item.applications, visa: null, finance: null,
      requestIds: {
        createApplication: uuid("22222222", 1),
        applications: Object.fromEntries(item.applications.map((row, n) => [row.universityApplicationId, uuid("23232323", n + 1)])),
        applicationDetails: Object.fromEntries(item.applications.map((row, n) => [row.universityApplicationId, uuid("24242424", n + 1)])),
        createStops: {}, resolveStops: {},
        partnerDetails: Object.fromEntries(item.applications.map((row, n) => [row.universityApplicationId, uuid("25252525", n + 1)])),
        changeStatus: Object.fromEntries(item.applications.map((row, n) => [row.universityApplicationId, uuid("26262626", n + 1)])),
      },
    },
    contract: null, handoffAcknowledgement: item.handoff ?? HANDOFF_ACCEPTED, salesHandoffAcknowledgement: null, saleConditions: null,
    leadCabinetCase: null, contractSignedAt: null, handedOffBy: { name: "Эрмек Токтосунов", at: "2026-08-30T06:00:00.000Z" },
  };
}

const NOTES = { subject: { leadId: null, studentCaseId: CASE_ID }, rows: [] };

function caseBody(name) {
  const item = SCENARIOS[name];
  const target = item.lead ? { leadId: LEAD_ID, studentCaseId: null } : { leadId: null, studentCaseId: CASE_ID };
  const hrefFor = (tab) => `${buildV3ProfileHref(target, tab)}&returnTo=${encodeURIComponent(RETURN_TO)}`;
  const details = draft(item);
  const person = profile(item.lead);
  const work = {
    row: queueRow(), tasks: { kind: "ready", tasks: [], assignees: [] }, chat: { kind: "ready", awaitState: "none", last: null },
    activity: { kind: "ready", olderThan: null, events: [] }, needsCurator: false, deletionRequested: false, today: TODAY, nowIso: NOW.toISOString(),
  };
  const editor = { admin: false, preview: false, routeManage: true, broadScope: false };
  // Страница лида рисует свою шапку (Lead 360); здесь у неё только вкладки — предмет сценария — «Приём дела» во вкладке.
  const parts = item.lead ? { header: null, actions: null } : caseWorkParts({
    actor: CURATOR, profile: person, draft: details, sales: null, work, stepAccess: queueView.nextStepAccess(editor, work.row, []),
    requestIds: Object.fromEntries(["contract", "firstPayment", "override", "handoff", "platformAccess", "saleConditions", "prepareLeadCabinet",
      "wishesCard", "educationCard", "conditionsCard", "step", "assignCurator", "portal", "note"].map((key, n) => [key, uuid("12121212", n + 1)])),
    notes: NOTES, notesOlderHref: null, notesLatestHref: null, curators: [], curatorsAvailable: true, hrefFor, salesDataOpen: false, help: null, closure: null,
  });
  const tab = createElement(UniversityProgramsView, {
    actor: CURATOR, draft: details, routeHref: hrefFor("route"), partnerDetails: item.partner ?? [],
    preparations: { status: "ready", value: item.preparations }, packets: PACKETS, nowIso: NOW.toISOString(),
    packetsInitiallyOpen: item.packetsOpen ?? false, packetApplicationId: item.packetApplication ?? null,
  });
  return { actions: parts.actions, body: createElement(Profile, {
    profile: person, draft: details, sales: null, actor: CURATOR, organizationId: ORG, studentPortalCurators: [], studentPortalCuratorsAvailable: true,
    requestIds: { contract: "", firstPayment: "", override: "", handoff: "", platformAccess: "", saleConditions: "", prepareLeadCabinet: "", wishesCard: "", educationCard: "", conditionsCard: "" },
    noteRequestId: uuid("12121212", 15), notes: NOTES, notesOlderHref: null, notesLatestHref: null,
    tab: "route", hrefFor, caseHeader: parts.header ?? undefined, universityProgramsTab: tab,
  }) };
}

// --- рендер ------------------------------------------------------------------
const routerStub = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };

function withContexts(node, search) {
  return createElement(AppRouterContext.Provider, { value: routerStub },
    createElement(PathnameContext.Provider, { value: "/v3/profile" },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
        createElement(ImageConfigContext.Provider, { value: { ...imageConfigDefault, unoptimized: true } }, node))));
}

function search(name) {
  return SCENARIOS[name].lead ? `id=${LEAD_ID}&tab=route` : `case=${CASE_ID}&tab=route&returnTo=${encodeURIComponent(RETURN_TO)}`;
}

function renderWorkspace(name) {
  const { actions, body } = caseBody(name);
  return renderToStaticMarkup(withContexts(createElement("div", null, actions, body), search(name)));
}

function renderPage(name) {
  const { AppShell } = require(join(ROOT, "src/components/v3/AppShell.tsx"));
  const { PartShell } = require(join(ROOT, "src/components/v3/PartShell.tsx"));
  const { Icon } = require(join(ROOT, "src/components/icons.tsx"));
  const back = createElement("a", { href: RETURN_TO, className: "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4" },
    createElement(Icon, { name: "arrow-left", size: 16 }), "Студенты");
  const { actions, body } = caseBody(name);
  const page = createElement("div", { className: "v3-world", "data-surface": "staff" },
    createElement(AppShell, { actor: CURATOR, initialNotifications: null },
      createElement(PartShell, { title: NAME, count: null, dense: true, back, action: actions }, createElement("div", { className: "space-y-6" }, body))));
  return renderToStaticMarkup(withContexts(page, search(name)));
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
  const dialog = readFileSync(DIALOG_CSS, "utf8").replace(/\.(dialog|layout|header|body)\b/gu, ".acd-$1");
  return [...fonts, result.css, readFileSync(join(ROOT, "src/app/(v3)/v3.css"), "utf8"), dialog].join("\n");
}

function writeHtml(path, css, markup) {
  writeFileSync(path, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Вузы и программы — EVO CRM (синтетические данные)</title><style>${css}</style></head>`,
    `<body class="min-h-full">${markup}</body></html>`,
  ].join(""));
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  const broken = await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [...document.images].filter((image) => image.checkVisibility());
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
    return images.filter((image) => !(image.complete && image.naturalWidth > 0)).map((image) => image.alt || image.src);
  });
  if (broken.length) throw new Error(`images not loaded: ${broken.join(", ")}`);
}

const STATIC_NAV = 'nav[aria-label="Разделы"] { position: static !important; height: auto !important; }';

async function screenshots() {
  const outIndex = process.argv.indexOf("--screenshots") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const SIZES = {
    1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  const shot = (suffix, extra = {}) => {
    const [width, full] = suffix.replace(/^[a-z-]+-(?=\d)/u, "").split("-");
    return { suffix, context: SIZES[width], full: full === "full", ...extra };
  };
  const plain = (widths) => widths.map((suffix) => shot(suffix));
  const PAGES = [
    ["empty", plain(["1440", "1280", "390"])],
    ["one-variant", [...plain(["1440", "1280", "390"]), shot("catalogue-1440", { do: "catalogue" }), shot("catalogue-390", { do: "catalogue" })]],
    ["decision", [...plain(["1440", "1280", "390", "390-full"]),
      shot("menu-1440", { do: "menu" }), shot("menu-390", { do: "menu" }),
      shot("status-1440", { do: "status" }), shot("status-390-full", { do: "status" }),
      shot("packets-1440-full", { do: "packets" })]],
    ["many", plain(["1440", "1440-full", "1280", "1280-full", "390", "390-full"])],
    ["packet", [shot("1440", { at: "#partner-packets" }), shot("390", { at: "#partner-packets" })]],
    ["accept", plain(["1440", "390"])],
    ["lead", plain(["1440", "390-full"])],
  ];
  const css = await compileCss();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",") ?? null;
  let failed = false;
  try {
    for (const [name, shots] of PAGES.filter(([one]) => only === null || only.includes(one))) {
      const htmlPath = join(outDir, `route-${name}.html`);
      writeHtml(htmlPath, css, renderPage(name));
      for (const { suffix, context, full, do: action, at } of shots) {
        const file = `route-${name}-${suffix}.png`;
        const browserContext = await browser.newContext(context);
        const page = await browserContext.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
        await settle(page);
        const firstRow = '[data-testid="v3-profile-application"]';
        if (action === "menu") {
          // «⋯» второй строки (поданная заявка): popover открывается атрибутом без гидратации.
          await page.locator(`${firstRow} button[popovertarget]`).nth(1).scrollIntoViewIfNeeded();
          await page.locator(`${firstRow} button[popovertarget]`).nth(1).click();
        }
        if (action === "status") {
          // То же, что «⋯ → Отметить статус»: форма под строкой видна, остальные скрыты.
          await page.evaluate((row) => {
            const section = document.querySelectorAll(row)[1].querySelector('[data-row-panel="status"]');
            section.hidden = false;
            section.scrollIntoView({ block: "center" });
          }, firstRow);
        }
        if (action === "catalogue") {
          await page.evaluate(() => document.querySelector('[data-testid="v3-catalog-preparation-dialog"]').showModal());
        }
        if (action === "packets") {
          await page.evaluate(() => { document.getElementById("partner-packets").open = true; });
        }
        if (at) {
          // Как переход по адресу с якорем: экран прокручен к панели.
          await page.evaluate((target) => document.querySelector(target).scrollIntoView({ block: "start" }), at);
        }
        if (full) {
          await page.addStyleTag({ content: STATIC_NAV });
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        }
        if (action) await page.waitForTimeout(250);
        await settle(page);
        if (errors.length) throw new Error(`${file}: browser errors:\n${errors.join("\n")}`);
        const metrics = await page.evaluate(() => {
          const visible = (element) => element.checkVisibility({ visibilityProperty: true });
          const label = (element) => (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 28);
          const within = document.querySelector("dialog:modal") ?? document.querySelector("main");
          const targets = [...within.querySelectorAll("a, button, summary, select, input:not([type=hidden]), textarea")].filter(visible);
          const small = targets.filter((element) => {
            const rect = element.getBoundingClientRect();
            // Флажок и переключатель — внутри своей подписи 44 px; сама подпись — цель.
            if (element.matches("input[type=checkbox], input[type=radio]")) return (element.closest("label")?.getBoundingClientRect().height ?? 0) < 44;
            return rect.height < 44;
          });
          return {
            pageHeight: document.documentElement.scrollHeight,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            wideElements: [...document.querySelectorAll("body *")].filter((element) => visible(element) && !element.closest(".overflow-x-auto")
              && element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length,
            solidRed: [...document.querySelectorAll("body *")].filter((element) => visible(element)
              && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => `${element.tagName.toLowerCase()}:${label(element)}`).join("|") || "none",
            smallText: [...document.querySelectorAll("main *, dialog *")].filter((element) => visible(element)
              && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())
              && parseFloat(getComputedStyle(element).fontSize) < 12).map((element) => label(element)).join("|") || "none",
            smallTargets: small.map((element) => `${element.tagName.toLowerCase()}:${label(element)}:${Math.round(element.getBoundingClientRect().height)}`).join("|") || "none",
            modal: Boolean(document.querySelector("dialog:modal")),
            popover: [...document.querySelectorAll("[popover]")].some((element) => element.matches(":popover-open")),
          };
        });
        await page.screenshot({ path: join(outDir, file), fullPage: full });
        if (metrics.overflow !== 0 || metrics.wideElements !== 0 || metrics.smallText !== "none") failed = true;
        process.stdout.write(`${file}: ${Object.entries(metrics).map(([key, value]) => `${key}=${value}`).join(" ")}\n`);
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) {
    process.stdout.write("FAIL: horizontal overflow or text below 12 px\n");
    process.exitCode = 1;
  }
}

// --- `--client`: список, «⋯» строки и окна добавления в браузере с настоящим React ----------
// Бандл esbuild с настоящими `ProfileAdmissionsWorkspacePanel`, `CatalogPreparationLauncher` и
// `ApplicationCreateDialog`. Серверные действия — заглушки в браузере: «Отметить статус» записывает
// поля формы и отвечает «сохранено», остальные только записывают вызов и отвечают ошибкой (как
// недоступный сервер). Проверки печатаются; нарушение — код выхода 1.
const CLIENT_ENTRY = `
const React = require("react");
const { createRoot } = require("react-dom/client");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const { ProfileAdmissionsWorkspacePanel } = require("@/components/v3/profile/ProfileAdmissionsWorkspace");
const { ApplicationCreateDialog } = require("@/components/v3/profile/ApplicationCreateDialog");
const { CatalogPreparationLauncher } = require("@/components/v3/profile/StaffCatalogPreparationPicker");
const h = React.createElement;
window.__route = { calls: [], refreshes: 0 };
// Страница — файл: переход по ссылке CRM здесь не выполняется (после обработчиков React, как клиентский переход).
window.addEventListener("click", (event) => { if (event.target.closest && event.target.closest("a[href^='/v3/']")) event.preventDefault(); });
const router = { refresh() { window.__route.refreshes += 1; }, push() {}, replace() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} };
const fixture = JSON.parse(document.getElementById("route-fixture").textContent);
const scope = { organizationId: fixture.actor.organizationId, membershipId: fixture.actor.membershipId, studentCaseId: fixture.workspace.studentCaseId };
const toolbar = h(React.Fragment, null,
  h("div", { className: "flex flex-wrap items-center gap-x-1.5 t-body-compact text-fg-2" }, h("span", null, "Вуза нет в каталоге?"), h(ApplicationCreateDialog, { workspace: fixture.workspace })),
  h(CatalogPreparationLauncher, { primary: true, scope, canSelect: true, canInitialize: true, initialPreparations: fixture.preparations }));
createRoot(document.getElementById("root")).render(h(AppRouterContext.Provider, { value: router },
  h("div", { className: "v3-world", "data-surface": "staff" }, h("main", { className: "p-6 space-y-6" },
    h(ProfileAdmissionsWorkspacePanel, { actor: fixture.actor, workspace: fixture.workspace, partnerDetails: fixture.partner,
      preparations: fixture.preparations, nowIso: fixture.nowIso, packetsHref: fixture.packetsHref, toolbar }),
    h("details", { id: "partner-packets" }, h("summary", null, "Пакеты документов партнёру"))))));
`;

async function clientCheck() {
  const esbuild = require("esbuild");
  const outIndex = process.argv.indexOf("--client") + 1;
  const outDir = resolve(process.argv[outIndex] && !process.argv[outIndex].startsWith("--") ? process.argv[outIndex] : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  const plugin = {
    name: "route-harness",
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
      // CSS-модули: окно добавления вуза — классы с префиксом `acd-` (его стили — в странице), остальные — ключи.
      build.onLoad({ filter: /\.css$/ }, (args) => ({ loader: "js", contents: args.path === DIALOG_CSS
        ? "const c = new Proxy({}, { get: (t, k) => k === '__esModule' ? undefined : 'acd-' + String(k) }); export default c;"
        : "const c = new Proxy({}, { get: (t, k) => k === '__esModule' ? undefined : String(k) }); export default c;" }));
      build.onLoad({ filter: /[\\/]src[\\/].+\.tsx?$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (!/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) return undefined;
        const names = [...source.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z0-9_$]+)/gu)].map((match) => match[1]);
        return {
          contents: names.map((name) => name === "changePlatformUniversityApplicationAction"
            ? `export async function ${name}(previous, form) { window.__route.calls.push({ name: "${name}", fields: Object.fromEntries(form.entries()) }); `
              + `return { status: "saved", requestId: "99999999-5555-4555-8555-000000000001", universityApplicationId: form.get("application_id"), version: "4" }; }`
            : `export async function ${name}() { window.__route.calls.push({ name: "${name}" }); throw new Error("route harness: ${name} is not available"); }`).join("\n"),
          loader: "ts",
        };
      });
    },
  };
  const bundle = join(outDir, "route-client.js");
  await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: ROOT, sourcefile: "route-client-entry.js", loader: "js" },
    bundle: true, outfile: bundle, format: "iife", platform: "browser", target: "chrome120", jsx: "automatic",
    tsconfig: join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": JSON.stringify("production") },
    banner: { js: "var process = globalThis.process || { env: {} };" }, plugins: [plugin], logLevel: "error",
  });
  const item = SCENARIOS.decision;
  const details = draft(item);
  const routeHref = `${buildV3ProfileHref({ leadId: null, studentCaseId: CASE_ID }, "route")}&returnTo=${encodeURIComponent(RETURN_TO)}`;
  const htmlPath = join(outDir, "route-client.html");
  writeFileSync(htmlPath, [
    "<!DOCTYPE html>",
    '<html lang="ru" data-theme="light" class="h-full antialiased">',
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Вузы и программы — синтетические данные</title><style>${await compileCss()}</style></head>`,
    `<body class="min-h-full"><div id="root"></div><script type="application/json" id="route-fixture">${JSON.stringify({
      actor: CURATOR, workspace: details.admissions, partner: item.partner, preparations: { status: "ready", value: item.preparations },
      nowIso: NOW.toISOString(), packetsHref: routeHref,
    }).replaceAll("<", "\\u003c")}</script><script src="route-client.js"></script></body></html>`,
  ].join(""));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const failures = [];
  const check = (ok, what) => { process.stdout.write(`${ok ? "ok" : "FAIL"} — ${what}\n`); if (!ok) failures.push(what); };
  const submitted = item.applications[1];
  const selectionKey = `evo.staff.preparation.v1:${ORG}:${ME}:${CASE_ID}:selection:case`;
  const requirementsKey = `evo.staff.preparation.v1:${ORG}:${ME}:${CASE_ID}:requirements:${item.preparations[0].applicationId}`;
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const w = viewport.width;
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.getByTestId("v3-profile-admissions-workspace").waitFor();
      const focused = () => page.evaluate(() => {
        const active = document.activeElement;
        return active === document.body || !active ? "body" : `${active.tagName.toLowerCase()}:${(active.getAttribute("aria-label") ?? active.textContent).trim().slice(0, 40)}`;
      });
      const row = page.getByTestId("v3-profile-application").nth(1);
      const more = row.getByRole("button", { name: /^Ещё:/u });
      // «⋯ → Отметить статус»: форма под строкой, фокус — на её заголовке; «Скрыть» — назад на «⋯».
      await more.click();
      await page.getByRole("button", { name: "Отметить статус" }).filter({ visible: true }).click();
      const statusPanel = row.locator('[data-row-panel="status"]');
      await page.waitForTimeout(100);
      check(await statusPanel.isVisible() && await row.locator('[data-row-panel="details"]').isHidden() && (await focused()) === "h3:Отметить статус",
        `${w}: «⋯ → Отметить статус» shows only that form under the row, focus on its heading (${await focused()})`);
      await page.screenshot({ path: join(outDir, `route-client-status-${w}.png`) });
      await statusPanel.locator('select[name="status"]').selectOption("under_review");
      await statusPanel.locator('input[name="evidence_reference"]').fill("Синтетическое подтверждение");
      await statusPanel.getByRole("button", { name: "Сохранить статус" }).click();
      await page.waitForFunction(() => window.__route.calls.some((call) => call.name === "changePlatformUniversityApplicationAction"), null, { timeout: 5000 });
      const call = (await page.evaluate(() => window.__route.calls)).find((entry) => entry.name === "changePlatformUniversityApplicationAction");
      check(call.fields.application_id === submitted.universityApplicationId && call.fields.student_case_id === CASE_ID
        && call.fields.request_id === details.admissions.requestIds.changeStatus[submitted.universityApplicationId]
        && call.fields.expected_version === submitted.version && call.fields.status === "under_review",
        `${w}: «Сохранить статус» sends the unchanged command with the row's ids, request id and version`);
      await statusPanel.getByRole("button", { name: "Скрыть" }).click();
      await page.waitForTimeout(100);
      check(await statusPanel.isHidden() && (await focused()).startsWith("button:Ещё: Университет Малайи"), `${w}: «Скрыть» hides the form, focus back on «⋯»`);
      // «Пакет партнёру»: адрес вкладки с выбранной заявкой; щелчок раскрывает панель пакетов.
      await more.click();
      const packet = page.getByRole("link", { name: "Пакет партнёру" }).filter({ visible: true });
      check(await packet.getAttribute("href") === `${routeHref}&panel=packets&packet_application=${submitted.universityApplicationId}#partner-packets`,
        `${w}: «Пакет партнёру» links to the packets panel with this application`);
      await packet.click();
      check(await page.evaluate(() => document.getElementById("partner-packets").open), `${w}: «Пакет партнёру» opens the packets panel`);
      // «Документы программы»: раскрытие в строке, чтение документов (заглушка отвечает ошибкой — это видно словами).
      const disclosure = page.getByTestId("v3-profile-application").first().getByRole("button", { name: "Документы программы" });
      await disclosure.click();
      await page.waitForTimeout(150);
      check(await disclosure.getAttribute("aria-expanded") === "true"
        && await page.getByText("Не удалось прочитать документы. Сохранённая подготовка остаётся доступной.").isVisible(),
        `${w}: «Документы программы» expands inside the row and reads the programme documents`);
      // «+ Вуз из каталога»: модальное окно, фокус — на поиске; Esc — назад на кнопку.
      const launcher = page.getByTestId("v3-catalog-preparation-launcher");
      await launcher.click();
      check(await page.getByTestId("v3-catalog-preparation-dialog").evaluate((dialog) => dialog.matches(":modal")) && (await focused()) === "input:",
        `${w}: «Вуз из каталога» opens the catalogue picker as a modal window, focus on the search field`);
      await page.screenshot({ path: join(outDir, `route-client-catalogue-${w}.png`) });
      await page.keyboard.press("Escape");
      check(!(await page.getByTestId("v3-catalog-preparation-dialog").evaluate((dialog) => dialog.open)) && (await focused()) === "button:Вуз из каталога",
        `${w}: Esc closes the picker, focus back on «Вуз из каталога»`);
      // «Добавить вручную» — прежнее окно ручного ввода.
      await page.getByTestId("v3-application-create-launcher").click();
      check(await page.getByTestId("v3-application-create-dialog").isVisible(), `${w}: «Добавить вручную» opens the manual application window`);
      await page.keyboard.press("Escape");
      // Запросы без подтверждённого результата: выбор из каталога и подготовка документов.
      await page.evaluate(({ selectionKey, requirementsKey, selection, requirements }) => {
        sessionStorage.setItem(selectionKey, JSON.stringify(selection));
        sessionStorage.setItem(requirementsKey, JSON.stringify(requirements));
      }, {
        selectionKey, requirementsKey,
        selection: { studentCaseId: CASE_ID, institutionId: item.preparations[0].institutionId, programId: item.preparations[0].programId,
          intakeId: item.preparations[0].intakeId, publicationVersion: 3, requestId: uuid("98989898", 1) },
        requirements: { studentCaseId: CASE_ID, applicationId: item.preparations[0].applicationId, requestId: uuid("98989898", 2) },
      });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("v3-profile-admissions-workspace").waitFor();
      check(await page.getByText("Выбор из каталога не подтверждён.").isVisible(), `${w}: a retained catalogue selection is named next to the button`);
      await page.getByRole("button", { name: "Проверить" }).click();
      check(await page.getByText("Есть запрос выбора без подтверждённого результата.").isVisible()
        && await page.getByRole("button", { name: "Повторить сохранённый запрос" }).first().isVisible(),
        `${w}: «Проверить» opens the picker with the retained request and its exact retry`);
      await page.keyboard.press("Escape");
      await page.getByTestId("v3-profile-application").first().getByRole("button", { name: "Документы программы" }).click();
      await page.waitForTimeout(150);
      check(await page.getByTestId("v3-profile-application").first().getByRole("button", { name: "Повторить сохранённый запрос" }).isVisible(),
        `${w}: a retained programme-documents request stays reachable inside the row`);
      check(errors.length === 0, `${w}: no page errors (${errors.join("; ")})`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) process.exitCode = 1;
}

if (process.argv.includes("--client")) {
  clientCheck().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(Object.keys(SCENARIOS).map((name) => ({ name, html: renderWorkspace(name) }))));
} else if (process.argv.includes("--screenshots")) {
  screenshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  process.stderr.write("usage: node tests/e2e/case-route-static-render.cjs --json | --client [outDir] | --screenshots [outDir] [--only=a,b]\n");
  process.exit(2);
}
