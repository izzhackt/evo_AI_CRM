import { randomUUID } from "node:crypto";

import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { createPlatformUniversityApplicationAction } from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_STATUSES,
  listPlatformApplications,
  listPlatformStudentCases,
  parsePlatformAdmissionsUuid,
  type PlatformApplicationStatus,
} from "@/lib/platform-admissions";
import { requirePlatformApplicationsActor } from "@/lib/platform-guards";

import {
  createApplicationsPresenterCopy,
  type ApplicationQueuePresenterRow,
  type ApplicationsQueuePresenterModel,
  type ApplicationsSearchParams,
  type PresenterBanner,
} from "./ApplicationsPresenter";

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
  const [applications, studentCases] = await Promise.all([
    listPlatformApplications(actor),
    listPlatformStudentCases(actor),
  ]);
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
      copy: CREATE_COPY[locale],
    },
  };
}
