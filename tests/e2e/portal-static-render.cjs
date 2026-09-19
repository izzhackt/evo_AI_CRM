"use strict";

// CJS-скрипт с runtime require-hook'ом (Module._extensions): компиляция
// .ts/.tsx на лету возможна только через require, ESM-import здесь не
// применим по построению.
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Статический рендер портальных экранов для a11y-гейта (PORT-6a).
 *
 * Запускается ОТДЕЛЬНЫМ node-процессом из tests/e2e/portal-accessibility.spec.ts
 * и печатает в stdout JSON [{ name, html }]. Отдельный процесс обязателен:
 * транспилер Playwright компилирует JSX в CT-дескрипторы ({__pw_type}), а не в
 * React-элементы, поэтому реальные компоненты внутри спеки не рендерятся.
 * Здесь используется тот же приём, что в tests/v3-trend-chart.test.mjs
 * (ts.transpileModule → настоящий React JSX runtime), но через require-hook,
 * чтобы пройти весь граф импортов компонентов.
 */

const { readFileSync, existsSync } = require("node:fs");
const Module = require("node:module");
const { join, resolve } = require("node:path");
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
    },
  }).outputText;

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    module._compile(compile(readFileSync(filename, "utf8")), filename);
  };
}

// --- alias "@/..." → src/... (tsconfig paths) --------------------------------
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    const base = join(ROOT, "src", request.slice(2));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) return originalResolve.call(this, candidate, ...rest);
    }
    return originalResolve.call(this, base, ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

// --- реальные React и Next-контекст -----------------------------------------
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");

const { getPortalStrings } = require(join(ROOT, "src/lib/portal/i18n.ts"));
const { OverviewView } = require(join(ROOT, "src/components/portal/admission/OverviewView.tsx"));
const { DocumentsView } = require(join(ROOT, "src/components/portal/admission/DocumentsView.tsx"));
const { NotificationsView } = require(join(ROOT, "src/components/portal/admission/NotificationsView.tsx"));
const { ProfessionsGrid } = require(join(ROOT, "src/components/portal/professions/ProfessionsGrid.tsx"));
const { LanguageForm } = require(join(ROOT, "src/components/portal/profile/LanguageForm.tsx"));
const { DeleteAccountRequest } = require(join(ROOT, "src/components/portal/profile/DeleteAccountRequest.tsx"));
const { ConsultationRequest } = require(join(ROOT, "src/components/portal/consultation/ConsultationRequest.tsx"));

const PORTAL_CSS = readFileSync(join(ROOT, "src/app/(portal)/portal.css"), "utf8");

/** Минимальный app-router для SSR клиентских компонентов с useRouter(). */
const routerStub = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  hmrRefresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

function renderSurface(title, node) {
  const markup = renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: routerStub }, node),
  );
  return [
    "<!DOCTYPE html>",
    '<html lang="ru">',
    `<head><meta charset="utf-8" /><title>${title}</title><style>${PORTAL_CSS}</style></head>`,
    '<body><div class="pt-shell"><div class="pt-body"><div class="pt-content v3-world">',
    markup,
    "</div></div></div></body></html>",
  ].join("");
}

function pageShell(kicker, heading, lead, children) {
  return createElement(
    "main",
    { className: "pt-page" },
    createElement(
      "header",
      { className: "pt-page-header" },
      createElement("p", { className: "pt-page-kicker" }, kicker),
      createElement("h1", { className: "pt-page-title" }, heading),
      createElement("p", { className: "pt-page-lead" }, lead),
    ),
    children,
  );
}

const admission = getPortalStrings("admission", "ru");

/** Фикстуры повторяют формы E2 DTO (StudentPortal* из portal-source). */
const overviewFixture = {
  operationalStage: "documents",
  studentAction: {
    kind: "payment",
    label: "Услуги EVO, транш 2",
    dueAt: "2026-10-01T09:00:00Z",
    amountMinor: 4_500_000,
    currency: "KGS",
  },
  studentActions: [
    {
      kind: "payment",
      label: "Услуги EVO, транш 2",
      dueAt: "2026-10-01T09:00:00Z",
      amountMinor: 4_500_000,
      currency: "KGS",
    },
    {
      kind: "upload_document",
      label: "Аттестат с приложением",
      dueAt: null,
      documentSlotId: "11111111-1111-4111-8111-111111111111",
    },
  ],
  evoAction: {
    taskId: "22222222-2222-4222-8222-222222222222",
    title: "Проверить пакет документов",
    status: "in_progress",
    dueAt: null,
    dueOn: "2026-10-03",
  },
  curatorDisplayName: "Айгүл Осмонова",
};

const documentsFixture = [
  {
    caseId: "33333333-3333-4333-8333-333333333333",
    documentSlotId: "11111111-1111-4111-8111-111111111111",
    requirementKey: "attestat",
    requirementLabel: "Аттестат с приложением",
    instructions: "Сканируйте разворот с оценками целиком.",
    status: "correction_required",
    deadline: "2026-10-05T09:00:00Z",
    nextAction: "Загрузите исправленный скан до 5 октября.",
    documentVersionId: "44444444-4444-4444-8444-444444444444",
    versionNo: "2",
    originalFilename: "attestat.pdf",
    declaredMimeType: "application/pdf",
    byteSize: 1_048_576,
    submittedAt: "2026-09-15T10:00:00Z",
    reviewDecision: "correction_required",
    reworkReason: "Не видна страница с оценками.",
    reviewedAt: "2026-09-16T10:00:00Z",
  },
  {
    caseId: "33333333-3333-4333-8333-333333333333",
    documentSlotId: "55555555-5555-4555-8555-555555555555",
    requirementKey: "passport",
    requirementLabel: "Паспорт",
    instructions: null,
    status: "approved",
    deadline: null,
    nextAction: null,
    documentVersionId: "66666666-6666-4666-8666-666666666666",
    versionNo: "1",
    originalFilename: "passport.jpg",
    declaredMimeType: "image/jpeg",
    byteSize: 524_288,
    submittedAt: "2026-09-10T10:00:00Z",
    reviewDecision: "approved",
    reworkReason: null,
    reviewedAt: "2026-09-11T10:00:00Z",
  },
  {
    caseId: "33333333-3333-4333-8333-333333333333",
    documentSlotId: "77777777-7777-4777-8777-777777777777",
    requirementKey: "motivation",
    requirementLabel: "Мотивационное письмо",
    instructions: "PDF на английском, до двух страниц.",
    status: "required",
    deadline: "2026-10-20T09:00:00Z",
    nextAction: null,
    documentVersionId: null,
    versionNo: null,
    originalFilename: null,
    declaredMimeType: null,
    byteSize: null,
    submittedAt: null,
    reviewDecision: null,
    reworkReason: null,
    reviewedAt: null,
  },
];

const notificationsFixture = [
  {
    notificationId: "88888888-8888-4888-8888-888888888888",
    category: "case_help",
    eventCode: "case_help_answer",
    subjectLabel: "Куратор ответил на ваш вопрос",
    detail: "Ответ по вопросу о сроках подачи.",
    dueAt: null,
    createdAt: "2026-09-18T08:00:00Z",
    readAt: null,
  },
  {
    notificationId: "99999999-9999-4999-8999-999999999999",
    category: "document_review",
    eventCode: "document_correction_required",
    subjectLabel: "Документ вернули на исправление",
    detail: null,
    dueAt: "2026-10-05T09:00:00Z",
    createdAt: "2026-09-16T10:30:00Z",
    readAt: "2026-09-17T07:00:00Z",
  },
];

const noopAction = async () => {};

const professionsStrings = getPortalStrings("professions", "ru");
const profileStrings = getPortalStrings("profile", "ru");
const consultationStrings = getPortalStrings("consultation", "ru");

const surfaces = [
  {
    name: "admission-overview",
    html: renderSurface(
      "Моё поступление — a11y",
      pageShell(
        admission.kickerCabinet,
        admission.overviewTitle,
        admission.overviewLead,
        createElement(OverviewView, { overview: overviewFixture, pending: false, locale: "ru" }),
      ),
    ),
  },
  {
    name: "admission-documents",
    html: renderSurface(
      "Документы — a11y",
      pageShell(
        admission.kicker,
        admission.documentsTitle,
        admission.documentsLead,
        createElement(DocumentsView, { documents: documentsFixture, locale: "ru" }),
      ),
    ),
  },
  {
    name: "admission-notifications",
    html: renderSurface(
      "Уведомления — a11y",
      pageShell(
        admission.kickerCabinet,
        admission.notificationsTitle,
        admission.notificationsLead,
        createElement(NotificationsView, {
          notifications: notificationsFixture,
          markReadAction: noopAction,
          markAllReadAction: noopAction,
          locale: "ru",
        }),
      ),
    ),
  },
  {
    name: "professions-and-profile-forms",
    html: renderSurface(
      "Профессии и профиль — a11y",
      pageShell(
        professionsStrings.kicker,
        professionsStrings.title,
        professionsStrings.lead,
        createElement(
          "div",
          null,
          createElement(ProfessionsGrid, {
            cards: [
              {
                cardId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                cardKey: "software-developer",
                version: "1",
                titleRu: "Разработчик программного обеспечения",
                titleKy: "Программалык камсыздоону иштеп чыгуучу",
                orvisScales: ["analysis", "creativity"],
              },
              {
                cardId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                cardKey: "nurse",
                version: "1",
                titleRu: "Медицинская сестра / медбрат",
                titleKy: "Медайым",
                orvisScales: ["altruism"],
              },
            ],
            topScales: ["analysis"],
            locale: "ru",
            strings: professionsStrings,
          }),
          createElement(
            "section",
            { "aria-label": profileStrings.languageHeading, className: "pt-card" },
            createElement(LanguageForm, {
              initialLanguage: "ru",
              strings: profileStrings,
            }),
            createElement(ConsultationRequest, {
              initialOpenRequest: null,
              strings: consultationStrings,
            }),
            createElement(DeleteAccountRequest, {
              initialRequestedAt: null,
              strings: profileStrings,
            }),
          ),
        ),
      ),
    ),
  },
];

process.stdout.write(JSON.stringify(surfaces));
