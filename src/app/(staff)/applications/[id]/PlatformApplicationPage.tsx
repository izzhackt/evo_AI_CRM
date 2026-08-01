import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { changePlatformUniversityApplicationAction } from "@/lib/platform-admissions-actions";
import {
  PLATFORM_APPLICATION_STATUSES,
  getPlatformApplication,
  parsePlatformAdmissionsUuid,
  type PlatformApplicationStatus,
} from "@/lib/platform-admissions";
import { requirePlatformApplicationsActor } from "@/lib/platform-guards";

import {
  createApplicationsPresenterCopy,
  type ApplicationDetailPresenterModel,
  type ApplicationDetailSearchParams,
  type ApplicationStatusOption,
  type PresenterBanner,
} from "../ApplicationsPresenter";

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

function resultBanner(
  result: string | undefined,
  locale: Locale,
): PresenterBanner | undefined {
  if (result === "saved") {
    return {
      tone: "info",
      title:
        locale === "ru"
          ? "Статус сохранён"
          : locale === "ky"
            ? "Статус сакталды"
            : "Status saved",
      description:
        locale === "ru"
          ? "Изменение и evidence записаны через аудируемую операцию EVO Platform."
          : locale === "ky"
            ? "Өзгөртүү жана далил EVO Platform аудит операциясы аркылуу жазылды."
            : "The change and its evidence were recorded through an audited EVO Platform operation.",
    };
  }
  if (result === "invalid") {
    return {
      tone: "danger",
      title:
        locale === "ru"
          ? "Проверьте статус и evidence"
          : locale === "ky"
            ? "Статусту жана далилди текшериңиз"
            : "Check the status and evidence",
      description:
        locale === "ru"
          ? "Внешние статусы нельзя сохранить без проверяемого подтверждения."
          : locale === "ky"
            ? "Тышкы статус текшерилүүчү далилсиз сакталбайт."
            : "An external status cannot be saved without verifiable evidence.",
    };
  }
  if (result === "unavailable") {
    return {
      tone: "danger",
      title:
        locale === "ru"
          ? "Изменение не подтверждено"
          : locale === "ky"
            ? "Өзгөртүү ырасталган жок"
            : "Change not confirmed",
      description:
        locale === "ru"
          ? "EVO Platform не считает статус изменённым. Повторите после проверки соединения."
          : locale === "ky"
            ? "EVO Platform статусту өзгөрдү деп эсептебейт. Байланышты текшерип кайталаңыз."
            : "EVO Platform does not consider the status changed. Check connectivity before retrying.",
    };
  }
  return undefined;
}

function workflow(
  status: PlatformApplicationStatus,
  locale: Locale,
): readonly ApplicationStatusOption[] {
  const values: readonly PlatformApplicationStatus[] =
    status === "rejected"
      ? ["preparation", "ready", "submitted", "under_review", "rejected"]
      : status === "withdrawn"
        ? ["preparation", "ready", "withdrawn"]
        : status === "closed"
          ? ["preparation", "closed"]
          : [
              "preparation",
              "ready",
              "submitted",
              "under_review",
              "offer",
              "enrolled",
            ];
  return values.map((value) => ({
    value,
    label: STATUS_COPY[locale][value],
  }));
}

export async function loadPlatformApplicationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ApplicationDetailSearchParams>;
}): Promise<ApplicationDetailPresenterModel> {
  const [actor, { id }, query, { t, locale }] = await Promise.all([
    requirePlatformApplicationsActor(),
    params,
    searchParams,
    getT(),
  ]);
  const application = await getPlatformApplication(actor, id);
  if (!application) notFound();

  const copy = createApplicationsPresenterCopy(t);
  const clientHref = `/clients/${application.studentCaseId}`;
  const attention =
    application.openDocumentCount > 0
      ? {
          title: t("correctionRequired"),
          description: `${application.openDocumentCount} · ${t("documents")}`,
          actionHref: clientHref,
          actionLabel: t("openStudent360"),
          tone: "warning" as const,
        }
      : application.openTaskCount > 0
        ? {
            title: t("nextAction"),
            description: `${application.openTaskCount} · ${t("openTasks")}`,
            actionHref: clientHref,
            actionLabel: t("openStudent360"),
            tone: "warning" as const,
          }
        : application.outstandingPaymentObligationCount > 0
          ? {
              title: t("nextAction"),
              description: `${application.outstandingPaymentObligationCount} · ${t("pendingPayments")}`,
              actionHref: clientHref,
              actionLabel: t("openStudent360"),
              tone: "warning" as const,
            }
          : {
              title: t("noActiveBlockers"),
              description: t("applicationDetailHint"),
              actionHref: clientHref,
              actionLabel: t("openStudent360"),
              tone: "info" as const,
            };
  const statusOptions = PLATFORM_APPLICATION_STATUSES.map((value) => ({
    value,
    label: STATUS_COPY[locale][value],
  }));
  const readinessPercent =
    application.documentCount === 0
      ? 0
      : Math.round(
          ((application.documentCount - application.openDocumentCount) /
            application.documentCount) *
            100,
        );
  const formattedUpdatedAt = new Date(application.updatedAt).toLocaleString(
    locale === "en" ? "en-US" : locale === "ky" ? "ky-KG" : "ru-RU",
  );
  const sourceDescription =
    locale === "ru"
      ? "Это операционная запись EVO Platform. Стадия продаж остаётся в amoCRM; внешнее решение фиксируется только с evidence. Работа провайдеров здесь не подтверждается."
      : locale === "ky"
        ? "Бул EVO Platform операциялык жазуусу. Сатуу стадиясы amoCRM системасында калат; тышкы чечим далил менен гана белгиленет. Провайдерлердин иши бул жерде ырасталбайт."
        : "This is an EVO Platform operational record. The sales stage remains in amoCRM; external decisions require evidence. Provider operation is not proved here.";

  return {
    testId: "platform-application-detail-page",
    copy,
    studentCaseId: application.studentCaseId,
    institutionName: application.institutionName,
    description: `${application.programName} · ${application.studentDisplayName}`,
    status: application.status,
    statusLabel: STATUS_COPY[locale][application.status],
    resultBanner: resultBanner(query.result, locale),
    attention,
    readinessPercent,
    documentCount: application.documentCount,
    openDocumentCount: application.openDocumentCount,
    openTaskCount: application.openTaskCount,
    pendingPaymentCount: application.outstandingPaymentObligationCount,
    workflow: workflow(application.status, locale),
    terminalDanger: application.status === "rejected",
    recordItems: [
      { label: t("client"), value: application.studentDisplayName },
      { label: t("university"), value: application.institutionName },
      { label: t("program"), value: application.programName },
      { label: t("degree"), value: application.targetDegree },
      { label: t("country"), value: application.targetCountry },
      { label: t("updated"), value: formattedUpdatedAt },
      {
        label: "Evidence",
        value: application.latestEvidenceReference,
      },
    ],
    ownerItems: [
      {
        label: t("curator"),
        value: application.currentCuratorDisplayName,
      },
      {
        label: t("sales"),
        value: application.responsibleSalesDisplayName,
      },
    ],
    sourceBoundary: {
      title: t("sourceBoundary"),
      description: sourceDescription,
      tone: "neutral",
    },
    statusForm: {
      action: changePlatformUniversityApplicationAction,
      hiddenFields: [
        {
          name: "application_id",
          value: application.universityApplicationId,
        },
        {
          name: "request_id",
          value:
            parsePlatformAdmissionsUuid(query.retry_request_id) ?? randomUUID(),
        },
      ],
      statusOptions,
      evidence: {
        label: "Evidence",
        value: application.latestEvidenceReference ?? "",
        hint:
          locale === "ru"
            ? "Обязательно для submitted, under_review, offer, rejected и enrolled."
            : locale === "ky"
              ? "submitted, under_review, offer, rejected жана enrolled үчүн милдеттүү."
              : "Required for submitted, under_review, offer, rejected, and enrolled.",
      },
      note: { label: copy.notes },
      submitLabel:
        locale === "ru"
          ? "Сохранить с аудитом"
          : locale === "ky"
            ? "Аудит менен сактоо"
            : "Save with audit",
    },
  };
}
