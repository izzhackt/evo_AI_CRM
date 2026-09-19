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
  // PORT-8c: раннер тестов тянет server actions → server-only-модули. Этот
  // процесс — SSR-рендер (как next build с condition react-server), поэтому
  // маркер разрешается в пустой react-server-вариант пакета.
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
const { TestsCatalog } = require(join(ROOT, "src/components/portal/tests/TestsCatalog.tsx"));
const { AssessmentRunner } = require(join(ROOT, "src/components/portal/tests/AssessmentRunner.tsx"));
const { AssessmentResults } = require(join(ROOT, "src/components/portal/tests/AssessmentResults.tsx"));
// PORT-9c: «Главная» кабинета.
const { HomeView } = require(join(ROOT, "src/components/portal/home/HomeView.tsx"));

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

// PORT-8c: фикстуры экранов тестов повторяют формы E2 DTO
// (AssessmentCatalog/AssessmentAttempt из student-assessment-contract).
const testsStrings = getPortalStrings("tests", "ru");

const assessmentMetadata = {
  title: "Английский",
  description: "36 заданий: грамматика, слова в контексте и чтение.",
  instructions: ["Выбирайте один ответ на задание.", "Можно прерваться и продолжить позже."],
  limitations: ["Это не сертификат уровня языка."],
  bands: [{ id: "b1", label: "Уверенная база на этом наборе заданий" }],
  recommendations: { grammar: "Повторите времена глагола на новых примерах." },
};

const assessmentCatalogFixture = {
  instruments: [
    {
      instrumentKey: "english36",
      versionId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      version: "1.0.0",
      locale: "ru",
      metadata: assessmentMetadata,
      questionCount: 36,
      draftAttemptId: "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      latestCompletedAttemptId: null,
    },
    {
      instrumentKey: "orvis92",
      versionId: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      version: "1.0.0",
      locale: "ru",
      metadata: {
        ...assessmentMetadata,
        title: "Карта интересов",
        description: "92 утверждения о занятиях: что вам ближе.",
      },
      questionCount: 92,
      draftAttemptId: null,
      latestCompletedAttemptId: "ccccccc2-cccc-4ccc-8ccc-ccccccccccc2",
    },
  ],
  attempts: [
    {
      attemptId: "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      instrumentKey: "english36",
      version: "1.0.0",
      status: "draft",
      revision: 4,
      answeredCount: 12,
      questionCount: 36,
      createdAt: "2026-09-17T10:00:00Z",
      updatedAt: "2026-09-18T10:00:00Z",
      completedAt: null,
    },
    {
      attemptId: "ccccccc2-cccc-4ccc-8ccc-ccccccccccc2",
      instrumentKey: "orvis92",
      version: "1.0.0",
      status: "completed",
      revision: 9,
      answeredCount: 92,
      questionCount: 92,
      createdAt: "2026-09-10T10:00:00Z",
      updatedAt: "2026-09-11T10:00:00Z",
      completedAt: "2026-09-11T10:00:00Z",
    },
  ],
};

const draftQuestions = [
  {
    id: "grammar-01",
    prompt: "Choose the correct verb form:\nThe results ___ ready.",
    options: [
      { id: "a", label: "is" },
      { id: "b", label: "are" },
      { id: "unknown", label: "Не знаю" },
    ],
    topic: "grammar",
  },
];

const draftAttemptFixture = {
  attemptId: "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  instrumentKey: "english36",
  versionId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  version: "1.0.0",
  locale: "ru",
  status: "draft",
  revision: 4,
  metadata: assessmentMetadata,
  questions: draftQuestions,
  answers: {},
  result: null,
  createdAt: "2026-09-17T10:00:00Z",
  updatedAt: "2026-09-18T10:00:00Z",
  completedAt: null,
};

const englishResultAttemptFixture = {
  ...draftAttemptFixture,
  attemptId: "ddddddd3-dddd-4ddd-8ddd-ddddddddddd3",
  status: "completed",
  completedAt: "2026-09-18T11:00:00Z",
  answers: { "grammar-01": "a" },
  result: {
    instrumentKey: "english36",
    version: "1.0.0",
    metadata: {
      ...assessmentMetadata,
      blueprint: [{ questionId: "grammar-01", skill: "verb-forms" }],
      skillLabels: { "verb-forms": "Формы глагола" },
    },
    answeredCount: 1,
    questionCount: 1,
    completedAt: "2026-09-18T11:00:00Z",
    english: {
      correctCount: 1,
      totalCount: 1,
      band: "b1",
      topics: [{ topic: "grammar", correctCount: 1, totalCount: 1 }],
      feedback: [
        {
          questionId: "grammar-01",
          selectedOptionId: "a",
          correctOptionId: "b",
          correct: false,
          explanation: "Подлежащее во множественном числе требует are.",
          topic: "grammar",
        },
      ],
    },
  },
};

const ORVIS_SCALE_IDS = [
  "leadership",
  "organization",
  "altruism",
  "creativity",
  "analysis",
  "production",
  "adventure",
  "erudition",
];

const orvisResultAttemptFixture = {
  ...draftAttemptFixture,
  attemptId: "eeeeeee4-eeee-4eee-8eee-eeeeeeeeeee4",
  instrumentKey: "orvis92",
  status: "completed",
  completedAt: "2026-09-11T10:00:00Z",
  questions: [],
  answers: {},
  metadata: { ...assessmentMetadata, title: "Карта интересов" },
  result: {
    instrumentKey: "orvis92",
    version: "1.0.0",
    metadata: {
      ...assessmentMetadata,
      title: "Карта интересов",
      scales: ORVIS_SCALE_IDS.map((id) => ({
        id,
        label: testsStrings[`scale.${id}`],
        description: "Насколько близки занятия этой группы.",
      })),
      professions: [
        {
          id: "software-developer",
          title: "Разработчик программного обеспечения",
          scaleIds: ["analysis"],
          summary: "Проектирует и пишет программы.",
          tasks: ["Разбирает задачу", "Пишет и проверяет код"],
          skills: ["Алгоритмы", "Внимание к деталям"],
          studyDirections: ["Информатика"],
          tryActivity: "Соберите маленькую страницу-визитку.",
          careerPath: ["Стажёр", "Инженер"],
          editorialNote: "Редакционный пример EVO.",
          source: {
            url: "https://www.onetonline.org/link/summary/15-1252.00",
            occupationId: "15-1252.00",
            version: "28.2",
            retrievedOn: "2026-09-01",
            license: "CC BY 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          },
        },
        {
          id: "nurse",
          title: "Медицинская сестра / медбрат",
          scaleIds: ["altruism"],
          summary: "Помогает пациентам и врачам.",
          tasks: ["Наблюдает за состоянием пациентов"],
          skills: ["Внимательность"],
          studyDirections: ["Сестринское дело"],
          tryActivity: "Пройдите короткий курс первой помощи.",
          editorialNote: "Редакционный пример EVO.",
          source: {
            url: "https://www.onetonline.org/link/summary/29-1141.00",
            occupationId: "29-1141.00",
            version: "28.2",
            retrievedOn: "2026-09-01",
            license: "CC BY 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          },
        },
      ],
      professionAttribution: "Профили основаны на данных O*NET®.",
    },
    answeredCount: 92,
    questionCount: 92,
    completedAt: "2026-09-11T10:00:00Z",
    orvis: {
      scales: ORVIS_SCALE_IDS.map((id, index) => ({
        scale: id,
        rawSum: 40 - index,
        itemCount: 12,
        mean: 4.4 - index * 0.3,
      })),
      topScales: ["analysis", "creativity"],
    },
  },
};

const professionsStrings = getPortalStrings("professions", "ru");
const profileStrings = getPortalStrings("profile", "ru");
const consultationStrings = getPortalStrings("consultation", "ru");

// PORT-9c: фикстуры «Главной» повторяют формы существующих read model
// (LearningModule движка 198, AssessmentCatalog E2, PublishedUniversity 148).
const homeStrings = getPortalStrings("home", "ru");
const HOME_NOW = new Date("2026-09-20T12:00:00Z");

const learningModulesDraftFixture = [
  {
    moduleId: "f1111111-1111-4111-8111-111111111111",
    moduleKey: "english-basics",
    version: "1.0.0",
    metadata: {
      title_ru: "Английский с нуля",
      title_ky: "Англис тили нөлдөн",
      level_note_ru: "Стартовый уровень",
      level_note_ky: "Баштапкы деңгээл",
    },
    lessonsTotal: 12,
    lessonsCompleted: 3,
    lessons: [
      {
        lessonId: "f2222222-2222-4222-8222-222222222222",
        lessonKey: "lesson-04",
        orderIndex: 4,
        metadata: {
          title_ru: "Вопросы о себе",
          title_ky: "Өзү жөнүндө суроолор",
          goal_ru: "Задавать простые вопросы о себе.",
          goal_ky: "Өзү жөнүндө жөнөкөй суроолорду берүү.",
        },
        exercisesTotal: 8,
        completed: false,
        draftAttemptId: "f3333333-3333-4333-8333-333333333333",
        lastResult: null,
      },
    ],
  },
];

const learningModulesDoneFixture = [
  {
    ...learningModulesDraftFixture[0],
    lessonsCompleted: 12,
    lessons: [
      {
        ...learningModulesDraftFixture[0].lessons[0],
        completed: true,
        draftAttemptId: null,
        lastResult: { correctCount: 7, exercisesTotal: 8 },
      },
    ],
  },
];

// Каталог тестов без черновика — карточка-вход вместо «Продолжить».
const assessmentCatalogNoDraftFixture = {
  instruments: assessmentCatalogFixture.instruments.map((instrument) => ({
    ...instrument,
    draftAttemptId: null,
  })),
  attempts: assessmentCatalogFixture.attempts.filter(
    (attempt) => attempt.status === "completed",
  ),
};

const favoriteUniversityFixture = {
  id: "f4444444-4444-4444-8444-444444444444",
  version: 1,
  publishedAt: "2026-09-01T10:00:00Z",
  content: {
    name: "Universiti Malaya",
    country: "MY",
    city: "Куала-Лумпур",
    overview: "Старейший университет Малайзии.",
    websiteUrl: "https://um.edu.my",
    sourceUrl: "https://um.edu.my",
    verifiedOn: "2026-09-01",
    notes: "",
    photoKey: null,
    programs: [
      {
        id: "f5555555-5555-4555-8555-555555555555",
        title: "Computer Science",
        level: "bachelor",
        duration: "4 года",
        language: "EN",
        summary: "Бакалавриат по информатике.",
        sourceUrl: "https://um.edu.my",
        intakes: [
          {
            label: "Сентябрь 2027",
            startDate: "2027-09-01",
            startMonth: "2027-09",
            applicationDeadline: "2027-05-31",
            deadlineTime: null,
            timezone: null,
            status: "open",
            note: "",
            sourceUrl: "https://um.edu.my",
            verifiedOn: "2026-09-01",
          },
        ],
      },
    ],
  },
};

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
    name: "tests-catalog",
    html: renderSurface(
      "Тесты — a11y",
      pageShell(
        testsStrings.kicker,
        testsStrings.title,
        testsStrings.lead,
        createElement(TestsCatalog, { catalog: assessmentCatalogFixture, locale: "ru" }),
      ),
    ),
  },
  {
    name: "tests-runner",
    html: renderSurface(
      "Тест — раннер — a11y",
      pageShell(
        testsStrings.kicker,
        assessmentMetadata.title,
        assessmentMetadata.description,
        createElement(AssessmentRunner, {
          instrument: assessmentCatalogFixture.instruments[0],
          initialAttempt: draftAttemptFixture,
          locale: "ru",
        }),
      ),
    ),
  },
  {
    name: "tests-results",
    html: renderSurface(
      "Тест — результаты — a11y",
      pageShell(
        testsStrings.kicker,
        assessmentMetadata.title,
        assessmentMetadata.description,
        createElement(
          "div",
          null,
          createElement(AssessmentResults, { attempt: englishResultAttemptFixture, locale: "ru" }),
          createElement(AssessmentResults, { attempt: orvisResultAttemptFixture, locale: "ru" }),
        ),
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
  // PORT-9c: «Главная» — оба tier'а: approved (черновики урока/теста,
  // избранное с интейком, анкета-статус) и assisted (действия дела первым
  // блоком, «модуль пройден», вход в тесты, пустое избранное).
  {
    name: "home-approved",
    html: renderSurface(
      "Главная — approved — a11y",
      pageShell(
        homeStrings.kicker,
        homeStrings.title,
        homeStrings.leadApproved,
        createElement(HomeView, {
          tier: "approved",
          overview: null,
          overviewFailed: false,
          modules: learningModulesDraftFixture,
          assessments: assessmentCatalogFixture,
          favorites: [favoriteUniversityFixture],
          favoritesTotal: 1,
          locale: "ru",
          now: HOME_NOW,
        }),
      ),
    ),
  },
  {
    name: "home-assisted",
    html: renderSurface(
      "Главная — assisted — a11y",
      pageShell(
        homeStrings.kicker,
        homeStrings.title,
        homeStrings.leadAssisted,
        createElement(HomeView, {
          tier: "assisted",
          overview: overviewFixture,
          overviewFailed: false,
          modules: learningModulesDoneFixture,
          assessments: assessmentCatalogNoDraftFixture,
          favorites: [],
          favoritesTotal: 0,
          locale: "ru",
          now: HOME_NOW,
        }),
      ),
    ),
  },
];

process.stdout.write(JSON.stringify(surfaces));
