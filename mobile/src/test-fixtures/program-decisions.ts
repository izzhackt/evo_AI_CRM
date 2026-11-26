// Синтетические ответы RPC для экранов решения во «Входящих» (только выдуманные данные; идентификаторы одинаковые
// по буквам, чтобы их было видно в тесте). Формы проходят настоящие строгие разборщики веба: тест api проверяет это.
import { STUDENT_CASE_ID } from "@/test-fixtures/universities";

export const APPLICATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const REVISION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const ITEM_1 = "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1";
export const ITEM_2 = "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2";
export const SLOT_1 = "51515151-5151-4151-8151-515151515151";
export const SLOT_2 = "52525252-5252-4252-8252-525252525252";
export const VERSION_1 = "71717171-7171-4171-8171-717171717171";
export const VERSION_2 = "72727272-7272-4272-8272-727272727272";
export const SUBMISSION_1 = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
export const SUBMISSION_2 = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
export const REVIEW_1 = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
export const REVIEW_2 = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
export const REVIEW_3 = "b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3";
export const PACKAGE_ID = "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0";
export const PACKAGE_REVIEW_1 = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";
export const PACKAGE_REVIEW_2 = "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2";
export const DOCUMENT_NOTIFICATION_ID = "99999999-9999-4999-8999-999999999991";
export const PACKAGE_NOTIFICATION_ID = "99999999-9999-4999-8999-999999999992";
export const HELP_NOTIFICATION_ID = "99999999-9999-4999-8999-999999999993";
export const HELP_ID = "98989898-9898-4898-8898-989898989898";

type Decision = "approved" | "correction_required" | "rejected";

export const fileRow = (over: Record<string, unknown> = {}) => ({
  originalFilename: "passport.pdf",
  declaredMimeType: "application/pdf",
  byteSize: "120000",
  sha256Hex: "a".repeat(64),
  documentVersionId: VERSION_1,
  versionNo: "2",
  finalizedAt: "2026-11-20T07:59:00+00:00",
  technicalAvailability: "available",
  unavailableReasons: [] as string[],
  ...over,
});

export const reviewRow = (id: string, decision: Decision, reason: string | null, reviewedAt = "2026-11-21T10:30:00+00:00") => ({ reviewId: id, decision, reason, reviewedAt });

export const submissionRow = (over: { item?: string; slot?: string; submission?: string; file?: Record<string, unknown>; review?: ReturnType<typeof reviewRow> | null } = {}) => ({
  submissionId: over.submission ?? SUBMISSION_1,
  requirementsRevisionId: REVISION_ID,
  requirementItemId: over.item ?? ITEM_1,
  documentSlotId: over.slot ?? SLOT_1,
  submittedAt: "2026-11-20T08:00:00+00:00",
  file: fileRow(over.file),
  review: over.review === undefined ? reviewRow(REVIEW_1, "correction_required", "Скан обрезан: нужны все четыре края страницы.") : over.review,
});

/** Ответ `student_application_document_notification_v1`. */
export const documentNotificationRow = (over: { review?: ReturnType<typeof reviewRow> | null; file?: Record<string, unknown>; notificationId?: string } = {}) => {
  const review = over.review === undefined ? reviewRow(REVIEW_1, "correction_required", "Скан обрезан: нужны все четыре края страницы.") : over.review;
  return {
    protocolVersion: 1,
    notificationId: over.notificationId ?? DOCUMENT_NOTIFICATION_ID,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    requirementsRevisionId: REVISION_ID,
    requirementItemId: ITEM_1,
    documentSlotId: SLOT_1,
    reviewId: review?.reviewId ?? REVIEW_1,
    submission: submissionRow({ review, file: over.file }),
  };
};

const evidenceRow = (item: string, submission: string, review: ReturnType<typeof reviewRow> | null) => ({ requirementItemId: item, submissionId: submission, review, reusedFromSubmissionId: null, reusedFromReview: null });

/** Решение по комплекту (`review` внутри `application_package_notification_v1`). */
export const packageReviewRow = (over: { id?: string; decision?: "approved" | "correction_required"; reason?: string | null; affected?: string[]; first?: ReturnType<typeof reviewRow> | null; second?: ReturnType<typeof reviewRow> | null; reviewedAt?: string } = {}) => {
  const decision = over.decision ?? "correction_required";
  return {
    packageReviewId: over.id ?? PACKAGE_REVIEW_1,
    packageId: PACKAGE_ID,
    decision,
    reason: decision === "approved" ? null : (over.reason ?? "Заверьте перевод и пришлите чёткий скан паспорта."),
    affectedItemIds: decision === "approved" ? [] : (over.affected ?? [ITEM_1]),
    documentReviews: [
      evidenceRow(ITEM_1, SUBMISSION_1, over.first === undefined ? reviewRow(REVIEW_1, "correction_required", "Скан обрезан: нужны все четыре края страницы.") : over.first),
      evidenceRow(ITEM_2, SUBMISSION_2, over.second === undefined ? reviewRow(REVIEW_2, "approved", null, "2026-11-21T09:00:00+00:00") : over.second),
    ],
    reviewedAt: over.reviewedAt ?? "2026-11-21T11:00:00+00:00",
  };
};

/** Ответ `application_package_notification_v1`. */
export const packageNotificationRow = (over: { notificationId?: string; review?: ReturnType<typeof packageReviewRow> } = {}) => {
  const review = over.review ?? packageReviewRow();
  return {
    protocolVersion: 1,
    notificationId: over.notificationId ?? PACKAGE_NOTIFICATION_ID,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    packageId: PACKAGE_ID,
    packageReviewId: review.packageReviewId,
    review,
  };
};

const definitionRow = (key: string, label: string, slot: string, over: Record<string, unknown> = {}) => ({
  requirementKey: key,
  required: true,
  label,
  groupLabel: "Личные документы",
  instructions: "Скан всех страниц с фото.",
  deadline: null,
  documentSlotId: slot,
  ...over,
});

const itemRow = (n: 1 | 2, over: { definition?: Record<string, unknown>; submission?: ReturnType<typeof submissionRow> } = {}) => {
  const item = n === 1 ? ITEM_1 : ITEM_2;
  const slot = n === 1 ? SLOT_1 : SLOT_2;
  const version = n === 1 ? VERSION_1 : VERSION_2;
  return {
    packageItemId: n === 1 ? "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1" : "d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2",
    requirementItemId: item,
    definition: definitionRow(n === 1 ? "passport" : "diploma", n === 1 ? "Паспорт" : "Диплом", slot, over.definition),
    materialSnapshot: null,
    selection: { kind: "existing_version", documentVersionId: version },
    submission: over.submission ?? submissionRow({ item, slot, submission: n === 1 ? SUBMISSION_1 : SUBMISSION_2, file: { documentVersionId: version, originalFilename: n === 1 ? "passport.pdf" : "diploma.pdf" }, review: n === 1 ? reviewRow(REVIEW_1, "correction_required", "Скан обрезан: нужны все четыре края страницы.") : reviewRow(REVIEW_2, "approved", null, "2026-11-21T09:00:00+00:00") }),
  };
};

/**
 * Ответ `application_package_detail_v1`. По умолчанию состав совпадает с решением из уведомления (`latest` = то же решение),
 * поэтому изменений после решения нет.
 */
export const packageDetailRow = (over: { latest?: ReturnType<typeof packageReviewRow>; items?: ReturnType<typeof itemRow>[]; warnings?: unknown[]; origin?: "evo_starter" | "staff_confirmed"; current?: boolean } = {}) => {
  const origin = over.origin ?? "staff_confirmed";
  return {
    protocolVersion: 1,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    package: {
      packageId: PACKAGE_ID,
      requirementsRevisionId: REVISION_ID,
      requirementsRevisionVersion: "3",
      origin,
      configurationState: origin === "evo_starter" ? "needs_confirmation" : "confirmed",
      packageVersion: "2",
      previousPackageId: null,
      compositionSha256: "c".repeat(64),
      submittedAt: "2026-11-20T08:30:00+00:00",
      itemCount: (over.items ?? [itemRow(1), itemRow(2)]).length,
      isCurrentRequirements: over.current ?? true,
      latestReview: over.latest ?? packageReviewRow(),
    },
    program: {
      institutionId: "11111111-aaaa-41aa-81aa-111111111111",
      publicationId: "22222222-aaaa-42aa-82aa-222222222222",
      programId: "software-engineering",
      intakeId: "33333333-aaaa-43aa-83aa-333333333333",
      universityTitle: "Тестовый университет",
      programTitle: "Программная инженерия",
      intakeLabel: "Осень 2027",
    },
    items: over.items ?? [itemRow(1), itemRow(2)],
    currentWarnings: over.warnings ?? [],
  };
};

export { itemRow as packageItemRow };

/** Ответ `student_portal_help_reply_v1` и страницы `case_help_workspace_v1`. */
export const helpRequestRow = (over: Record<string, unknown> = {}) => ({
  id: HELP_ID,
  subject: "Какие документы нужны для визы",
  body: "Подскажите, нужен ли нотариальный перевод свидетельства о рождении?",
  answer: "Да, перевод нужен. Заверьте его у нотариуса и загрузите в «Документы».",
  status: "answered",
  version: "2",
  createdAt: "2026-11-18T05:00:00+00:00",
  answeredAt: "2026-11-19T07:15:00+00:00",
  ...over,
});

export const helpReplyRow = (over: { readAt?: string | null; request?: Record<string, unknown> } = {}) => ({
  caseId: STUDENT_CASE_ID,
  readAt: over.readAt === undefined ? null : over.readAt,
  items: [helpRequestRow(over.request)],
});

export const helpPageRow = (items: Record<string, unknown>[]) => ({ caseId: STUDENT_CASE_ID, items });

/** Ответ `application_package_review_history_v1`: решения по комплекту, новые первыми. */
export const packageHistoryRow = (reviews: ReturnType<typeof packageReviewRow>[], nextCursor: { createdAt: string; id: string } | null = null) => ({
  protocolVersion: 1,
  studentCaseId: STUDENT_CASE_ID,
  applicationId: APPLICATION_ID,
  packageId: PACKAGE_ID,
  reviews,
  nextCursor,
});
