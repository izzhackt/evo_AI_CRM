import { randomUUID } from "node:crypto";

import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { createPlatformUniversityApplicationAction } from "@/lib/platform-admissions-actions";
import {
  createPlatformCatalogImportBatchAction,
  registerPlatformCatalogSourceAction,
  reviewPlatformCatalogImportBatchAction,
  reviewPlatformCatalogSourceAction,
  stagePlatformCatalogImportCandidateAction,
  validatePlatformCatalogImportBatchAction,
} from "@/lib/platform-catalog-actions";
import {
  PLATFORM_APPLICATION_STATUSES,
  listPlatformApplications,
  listPlatformStudentCases,
  parsePlatformAdmissionsUuid,
  type PlatformApplicationStatus,
} from "@/lib/platform-admissions";
import {
  listPlatformCatalogImportBatches,
  listPlatformCatalogImportCandidates,
  listPlatformCatalogInstitutions,
  listPlatformCatalogSources,
} from "@/lib/platform-catalog";
import { requirePlatformApplicationsActor } from "@/lib/platform-guards";

import {
  createApplicationsPresenterCopy,
  type ApplicationQueuePresenterRow,
  type ApplicationsQueuePresenterModel,
  type ApplicationsSearchParams,
  type PresenterBanner,
} from "./ApplicationsPresenter";
import type {
  CatalogImportWorkspaceCopy,
  CatalogWorkspaceBanner,
} from "./CatalogImportWorkspace";

const STATUS_COPY: Record<
  Locale,
  Record<PlatformApplicationStatus, string>
> = {
  ru: {
    preparation: "Подготовка",
    ready: "Готова к подаче",
    submitted: "Подана",
    under_review: "На рассмотрении",
    offer: "Получен offer",
    rejected: "Отказ",
    enrolled: "Зачислен",
    withdrawn: "Отозвана",
    closed: "Закрыта",
  },
  ky: {
    preparation: "Даярдоо",
    ready: "Тапшырууга даяр",
    submitted: "Тапшырылды",
    under_review: "Каралууда",
    offer: "Сунуш алынды",
    rejected: "Баш тартылды",
    enrolled: "Катталды",
    withdrawn: "Кайтарылып алынды",
    closed: "Жабылды",
  },
  en: {
    preparation: "Preparation",
    ready: "Ready to submit",
    submitted: "Submitted",
    under_review: "Under review",
    offer: "Offer received",
    rejected: "Rejected",
    enrolled: "Enrolled",
    withdrawn: "Withdrawn",
    closed: "Closed",
  },
};

const CREATE_COPY: Record<
  Locale,
  {
    summaryLabel: string;
    emptyTitle: string;
    emptyDescription: string;
    evidenceLabel: string;
    evidenceHint: string;
    submitLabel: string;
    catalogLabel: string;
    catalogManualOption: string;
    manualInstitutionLabel: string;
    catalogHint: string;
  }
> = {
  ru: {
    summaryLabel: "Добавить университетскую заявку",
    emptyTitle: "Нет доступного студенческого кейса",
    emptyDescription:
      "Сначала нужен подтверждённый и доступный вашей роли кейс. Локальный клиент не создаётся.",
    evidenceLabel: "Evidence для внешнего статуса",
    evidenceHint:
      "Обязательно для submitted, under_review, offer, rejected и enrolled.",
    submitLabel: "Создать с аудитом",
    catalogLabel: "Approved catalog",
    catalogManualOption: "Не из approved catalog",
    manualInstitutionLabel: "Университет вручную",
    catalogHint:
      "Catalog-запись сохраняется в заявке. Ручной ввод остаётся честным вариантом для ещё не импортированных учреждений.",
  },
  ky: {
    summaryLabel: "Университетке арыз кошуу",
    emptyTitle: "Жеткиликтүү студенттик иш жок",
    emptyDescription:
      "Адегенде ролуңузга жеткиликтүү ырасталган иш керек. Локалдык кардар түзүлбөйт.",
    evidenceLabel: "Тышкы статус үчүн далил",
    evidenceHint:
      "submitted, under_review, offer, rejected жана enrolled үчүн милдеттүү.",
    submitLabel: "Аудит менен түзүү",
    catalogLabel: "Бекитилген каталог",
    catalogManualOption: "Бекитилген каталогдо жок",
    manualInstitutionLabel: "Окуу жайын кол менен киргизүү",
    catalogHint:
      "Каталог тандоосу арызда сакталат; импорттоло элек окуу жай үчүн кол менен киргизүүгө болот.",
  },
  en: {
    summaryLabel: "Add university application",
    emptyTitle: "No accessible student case",
    emptyDescription:
      "A confirmed case within your role scope is required first. No local client is created.",
    evidenceLabel: "Evidence for an external status",
    evidenceHint:
      "Required for submitted, under_review, offer, rejected, and enrolled.",
    submitLabel: "Create with audit",
    catalogLabel: "Approved catalog",
    catalogManualOption: "Not in the approved catalog",
    manualInstitutionLabel: "Manual institution name",
    catalogHint:
      "A catalog selection is linked to the application. Manual entry remains available for institutions not yet imported.",
  },
};

const CATALOG_COPY: Record<Locale, CatalogImportWorkspaceCopy> = {
  ru: {
    title: "Каталог университетов и колледжей",
    description:
      "Проверяемая граница импорта: метаданные источника, staging, validation и отдельное Admin approval. Источник никогда не пишет напрямую в каталог или студенческий кейс.",
    approvedTitle: "Approved catalog",
    approvedEmptyTitle: "Approved catalog пока пуст",
    approvedEmptyDescription:
      "Доступ к реальному Notion-источнику ещё не подтверждён; колледжи не заполняются выдуманными записями.",
    sourceBoundaryTitle: "Источник не является runtime-зависимостью",
    sourceBoundaryDescription:
      "Google/Drive/Notion используются только как provenance. Platform хранит нормализованные поля, revision и audit — без raw payload и клиентских данных.",
    blockedTitle: "Нужен reviewed source с revision",
    blockedDescription:
      "Сначала Admin регистрирует и проверяет разрешённый источник. Approval доступен только после validation без ошибок.",
    registerSource: "Зарегистрировать метаданные источника",
    sourceKind: "Тип источника",
    sourceUrl: "Канонический URL",
    sourceRevision: "Revision / версия",
    reason: "Причина",
    register: "Сохранить source metadata",
    sources: "Источники",
    review: "Подтвердить",
    reject: "Отклонить",
    createBatch: "Создать staging batch",
    institutionKind: "Тип учреждения",
    university: "Университет",
    college: "Колледж",
    create: "Создать batch",
    batches: "Import batches",
    batchDetail: "Проверка batch",
    candidates: "записей",
    sourceRecordReference: "Ссылка/ID строки источника",
    sourceRecordHint:
      "В базе сохраняется только SHA-256 opaque key, исходное значение не сохраняется.",
    institutionName: "Название учреждения",
    countryCode: "Код страны (2 буквы)",
    city: "Город",
    stageCandidate: "Добавить в staging",
    validate: "Запустить validation",
    approve: "Approve и опубликовать",
    validationErrors: "Ошибки",
    noCandidates: "В batch ещё нет staging-записей.",
    noSources: "Источники ещё не зарегистрированы.",
    noBatches: "Import batches ещё не создавались.",
    open: "Открыть",
    status: "Статус",
    provenance: "Revision",
  },
  ky: {
    title: "Университеттер жана колледждер каталогу",
    description:
      "Булак метадайындары staging, validation жана өзүнчө Admin approval аркылуу өтөт. Булак каталогго же студенттик кейске түз жазбайт.",
    approvedTitle: "Бекитилген каталог",
    approvedEmptyTitle: "Бекитилген каталог азырынча бош",
    approvedEmptyDescription:
      "Чыныгы Notion булагына кирүү ырастала элек; колледждер ойдон чыгарылган жазуулар менен толтурулбайт.",
    sourceBoundaryTitle: "Булак runtime көз карандылыгы эмес",
    sourceBoundaryDescription:
      "Platform нормалдаштырылган талааларды, revision жана audit гана сактайт; raw payload жана кардар маалыматтары сакталбайт.",
    blockedTitle: "Revision менен reviewed source керек",
    blockedDescription:
      "Адегенде Admin уруксат берилген булакты каттап, текшерет. Approval катасыз validation кийин гана жеткиликтүү.",
    registerSource: "Булак метадайындарын каттоо",
    sourceKind: "Булак түрү",
    sourceUrl: "Каноникалык URL",
    sourceRevision: "Revision / версия",
    reason: "Себеп",
    register: "Source metadata сактоо",
    sources: "Булактар",
    review: "Ырастоо",
    reject: "Четке кагуу",
    createBatch: "Staging batch түзүү",
    institutionKind: "Мекеменин түрү",
    university: "Университет",
    college: "Колледж",
    create: "Batch түзүү",
    batches: "Import batches",
    batchDetail: "Batch текшерүү",
    candidates: "жазуу",
    sourceRecordReference: "Булактагы сап шилтемеси/ID",
    sourceRecordHint: "Базада SHA-256 opaque key гана сакталат.",
    institutionName: "Мекеменин аталышы",
    countryCode: "Өлкө коду (2 тамга)",
    city: "Шаар",
    stageCandidate: "Staging-ге кошуу",
    validate: "Validation иштетүү",
    approve: "Approve жана жарыялоо",
    validationErrors: "Каталар",
    noCandidates: "Batch ичинде staging-жазуулар жок.",
    noSources: "Булактар каттала элек.",
    noBatches: "Import batch түзүлө элек.",
    open: "Ачуу",
    status: "Статус",
    provenance: "Revision",
  },
  en: {
    title: "University and college catalog",
    description:
      "A reviewable import boundary: source metadata, staging, validation, and separate Admin approval. A source never writes directly to the catalog or a student case.",
    approvedTitle: "Approved catalog",
    approvedEmptyTitle: "The approved catalog is empty",
    approvedEmptyDescription:
      "Access to the real Notion source is not yet proven; colleges are never filled with invented records.",
    sourceBoundaryTitle: "Sources are not runtime dependencies",
    sourceBoundaryDescription:
      "Google, Drive, and Notion provide provenance only. Platform stores typed fields, revision, and audit without raw payloads or customer data.",
    blockedTitle: "A reviewed source with a revision is required",
    blockedDescription:
      "An Admin must register and review an authorized source first. Approval is available only after validation with no errors.",
    registerSource: "Register source metadata",
    sourceKind: "Source kind",
    sourceUrl: "Canonical URL",
    sourceRevision: "Revision / version",
    reason: "Reason",
    register: "Save source metadata",
    sources: "Sources",
    review: "Review",
    reject: "Reject",
    createBatch: "Create staging batch",
    institutionKind: "Institution kind",
    university: "University",
    college: "College",
    create: "Create batch",
    batches: "Import batches",
    batchDetail: "Batch review",
    candidates: "records",
    sourceRecordReference: "Source row reference / ID",
    sourceRecordHint:
      "Only a SHA-256 opaque key is stored; the original value is discarded.",
    institutionName: "Institution name",
    countryCode: "Country code (2 letters)",
    city: "City",
    stageCandidate: "Add to staging",
    validate: "Run validation",
    approve: "Approve and publish",
    validationErrors: "Errors",
    noCandidates: "This batch has no staged records yet.",
    noSources: "No sources have been registered.",
    noBatches: "No import batches have been created.",
    open: "Open",
    status: "Status",
    provenance: "Revision",
  },
};

function resultBanner(
  result: string | undefined,
  locale: Locale,
): PresenterBanner | undefined {
  if (result === "saved") {
    return locale === "ru"
      ? {
          tone: "info",
          title: "Заявка сохранена",
          description:
            "Операция подтверждена EVO Platform и записана в аудит.",
        }
      : locale === "ky"
        ? {
            tone: "info",
            title: "Арыз сакталды",
            description:
              "Операция EVO Platform тарабынан ырасталып, аудитке жазылды.",
          }
        : {
            tone: "info",
            title: "Application saved",
            description:
              "EVO Platform confirmed the operation and recorded its audit evidence.",
          };
  }
  if (result === "invalid") {
    return {
      tone: "danger",
      title:
        locale === "ru"
          ? "Проверьте данные заявки"
          : locale === "ky"
            ? "Арыздын маалыматын текшериңиз"
            : "Check the application data",
      description:
        locale === "ru"
          ? "Для внешних статусов обязательна ссылка или идентификатор подтверждающего evidence."
          : locale === "ky"
            ? "Тышкы статус үчүн текшерилүүчү далилдин шилтемеси же идентификатору милдеттүү."
            : "External statuses require a verifiable evidence link or identifier.",
    };
  }
  if (result === "unavailable") {
    return {
      tone: "danger",
      title:
        locale === "ru"
          ? "Заявка не сохранена"
          : locale === "ky"
            ? "Арыз сакталган жок"
            : "Application not saved",
      description:
        locale === "ru"
          ? "Сервер не подтвердил запись. Повторите после проверки доступа и соединения."
          : locale === "ky"
            ? "Сервер жазууну ырастаган жок. Кирүү укугун жана байланышты текшерип кайталаңыз."
            : "The server did not confirm the write. Check access and connectivity before retrying.",
    };
  }
  return undefined;
}

function catalogResultBanner(
  result: string | undefined,
  locale: Locale,
): CatalogWorkspaceBanner | undefined {
  const success: Readonly<Record<string, readonly [string, string]>> = {
    source_saved: ["Источник сохранён", "Метаданные ожидают отдельной Admin-проверки."],
    source_reviewed: ["Источник проверен", "Текущий review status сохранён в audit."],
    source_rejected: ["Источник отклонён", "Причина и rejected status сохранены в audit."],
    batch_created: ["Staging batch создан", "Записи ещё не опубликованы в approved catalog."],
    candidate_staged: ["Запись добавлена в staging", "До validation и approval каталог не изменится."],
    batch_validated: ["Validation завершён", "Проверьте ошибки перед отдельным approval."],
    batch_approved: ["Batch опубликован", "Validated records добавлены в approved catalog с provenance."],
    batch_rejected: ["Batch отклонён", "Approved catalog и студенческие кейсы не изменялись."],
  };
  if (result && success[result]) {
    const [ruTitle, ruDescription] = success[result];
    return locale === "ru"
      ? { tone: "info", title: ruTitle, description: ruDescription }
      : locale === "ky"
        ? {
            tone: "info",
            title: "Каталог операциясы сакталды",
            description:
              "Staging, validation жана approval чек арасы аудит менен ырасталды.",
          }
        : {
            tone: "info",
            title: "Catalog operation saved",
            description:
              "The staging, validation, and approval boundary was recorded with audit evidence.",
          };
  }
  if (result === "invalid") {
    return {
      tone: "danger",
      title:
        locale === "ru"
          ? "Проверьте catalog-данные"
          : locale === "ky"
            ? "Каталог маалыматтарын текшериңиз"
            : "Check the catalog data",
      description:
        locale === "ru"
          ? "Нужны bounded typed fields, revision, причина и валидный request ID."
          : locale === "ky"
            ? "Чектелген typed fields, revision, себеп жана жарактуу request ID керек."
            : "Bounded typed fields, a revision, a reason, and a valid request ID are required.",
    };
  }
  if (result === "unavailable") {
    return {
      tone: "danger",
      title:
        locale === "ru"
          ? "Операция не подтверждена"
          : locale === "ky"
            ? "Операция ырасталган жок"
            : "Operation not confirmed",
      description:
        locale === "ru"
          ? "Сервер не подтвердил mutation. Используйте сохранённый request ID только для той же операции."
          : locale === "ky"
            ? "Сервер mutation операциясын ырастаган жок; ошол эле операция үчүн сакталган request ID колдонуңуз."
            : "The server did not confirm the mutation. Reuse the saved request ID only for the same operation.",
    };
  }
  return undefined;
}

export async function loadPlatformApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<ApplicationsSearchParams>;
}): Promise<ApplicationsQueuePresenterModel> {
  const [actor, query, { t, locale }] = await Promise.all([
    requirePlatformApplicationsActor(),
    searchParams,
    getT(),
  ]);
  const isAdmin = actor.platformRole === "admin";
  const [
    applications,
    studentCases,
    catalogInstitutions,
    catalogSources,
    catalogBatches,
  ] = await Promise.all([
    listPlatformApplications(actor),
    listPlatformStudentCases(actor),
    listPlatformCatalogInstitutions(actor),
    isAdmin ? listPlatformCatalogSources(actor) : Promise.resolve([]),
    isAdmin ? listPlatformCatalogImportBatches(actor) : Promise.resolve([]),
  ]);
  const requestedCatalogBatchId = parsePlatformAdmissionsUuid(
    query.catalog_batch_id,
  );
  const selectedCatalogBatch = isAdmin
    ? catalogBatches.find(
        (batch) => batch.catalogImportBatchId === requestedCatalogBatchId,
      ) ?? catalogBatches[0]
    : undefined;
  const catalogCandidates = selectedCatalogBatch
    ? await listPlatformCatalogImportCandidates(
        actor,
        selectedCatalogBatch.catalogImportBatchId,
      )
    : [];
  const retryCatalogRequestId = parsePlatformAdmissionsUuid(
    query.catalog_retry_request_id,
  );
  const requestIdFor = (operation: string): string =>
    query.catalog_retry_op === operation && retryCatalogRequestId
      ? retryCatalogRequestId
      : randomUUID();
  const selectedStatus = (
    PLATFORM_APPLICATION_STATUSES as readonly string[]
  ).includes(query.status ?? "")
    ? (query.status as PlatformApplicationStatus)
    : undefined;
  const statusOptions = PLATFORM_APPLICATION_STATUSES.map((value) => ({
    value,
    label: STATUS_COPY[locale][value],
  }));
  const present = (
    application: (typeof applications)[number],
  ): ApplicationQueuePresenterRow => ({
    id: application.universityApplicationId,
    studentCaseId: application.studentCaseId,
    studentDisplayName: application.studentDisplayName,
    caseStage: null,
    institutionName: application.institutionName,
    programName: application.programName,
    degree: application.targetDegree,
    country: application.targetCountry,
    status: application.status,
    statusLabel: STATUS_COPY[locale][application.status],
    deadline: null,
    documentCount: application.documentCount,
    openDocumentCount: application.openDocumentCount,
    openTaskCount: application.openTaskCount,
    pendingPaymentCount: application.outstandingPaymentObligationCount,
    needsAttention:
      application.openDocumentCount > 0 ||
      application.openTaskCount > 0 ||
      application.outstandingPaymentObligationCount > 0,
    readyForDecision: ["submitted", "under_review", "offer"].includes(
      application.status,
    ),
    statusHiddenFields: [],
  });
  const rows = applications
    .filter(
      (application) =>
        !selectedStatus || application.status === selectedStatus,
    )
    .map(present);
  const selectedStudentCaseId = studentCases.cases.some(
    (studentCase) => studentCase.studentCaseId === query.student_case_id,
  )
    ? query.student_case_id
    : studentCases.cases[0]?.studentCaseId;

  return {
    testId: "platform-applications-page",
    copy: createApplicationsPresenterCopy(t),
    operationalNotice: {
      title: t("operationalStageNotice"),
      description: t("operationalStageHint"),
      tone: "info",
    },
    resultBanner: resultBanner(query.result, locale),
    rows,
    allRows: applications.map(present),
    selectedStatus,
    statusOptions,
    emptyText:
      locale === "ru"
        ? "Заявок по выбранному фильтру нет."
        : t("noApplications"),
    filteredEmptyText:
      locale === "ru"
        ? "Заявок по выбранному фильтру нет."
        : t("noFilteredApplications"),
    create: {
      action: createPlatformUniversityApplicationAction,
      requestId:
        parsePlatformAdmissionsUuid(query.retry_request_id) ?? randomUUID(),
      selectedStudentCaseId,
      studentCases: studentCases.cases.map((studentCase) => ({
        id: studentCase.studentCaseId,
        label: `${studentCase.studentDisplayName} · ${studentCase.targetCountry}`,
      })),
      statusOptions,
      catalogInstitutions: catalogInstitutions.map((institution) => ({
        id: institution.catalogInstitutionId,
        label: `${institution.institutionName} · ${institution.countryCode}`,
      })),
      copy: CREATE_COPY[locale],
    },
    catalog: {
      copy: CATALOG_COPY[locale],
      resultBanner: catalogResultBanner(query.catalog_result, locale),
      institutions: catalogInstitutions,
      admin: isAdmin
        ? {
            sources: catalogSources.map((source) => ({
              source,
              reviewRequestId: requestIdFor(
                `review_source:${source.sourceRegistryId}`,
              ),
            })),
            batches: catalogBatches,
            selected: selectedCatalogBatch
              ? {
                  batch: selectedCatalogBatch,
                  candidates: catalogCandidates,
                  stageRequestId: requestIdFor(
                    `stage_candidate:${selectedCatalogBatch.catalogImportBatchId}`,
                  ),
                  validateRequestId: requestIdFor(
                    `validate_batch:${selectedCatalogBatch.catalogImportBatchId}`,
                  ),
                  approveRequestId: requestIdFor(
                    `review_batch:${selectedCatalogBatch.catalogImportBatchId}:approve`,
                  ),
                  rejectRequestId: requestIdFor(
                    `review_batch:${selectedCatalogBatch.catalogImportBatchId}:reject`,
                  ),
                }
              : undefined,
            requestIds: {
              registerSource: requestIdFor("register_source"),
              createBatch: requestIdFor("create_batch"),
            },
            actions: {
              registerSource: registerPlatformCatalogSourceAction,
              reviewSource: reviewPlatformCatalogSourceAction,
              createBatch: createPlatformCatalogImportBatchAction,
              stageCandidate: stagePlatformCatalogImportCandidateAction,
              validateBatch: validatePlatformCatalogImportBatchAction,
              reviewBatch: reviewPlatformCatalogImportBatchAction,
            },
          }
        : undefined,
    },
  };
}
