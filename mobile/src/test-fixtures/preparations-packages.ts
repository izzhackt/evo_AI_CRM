// Синтетические ответы и запросы комплекта программы в форме строгих разборщиков веба (отправка, квитанция, проверка исхода,
// комплект подробно, история комплектов и решений). Названия и файлы придуманы; реальных данных студентов здесь нет.
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, definitionOf, documentFile, itemId, reviewId, sha, slotId, submissionOf, versionId } from "@/test-fixtures/preparations";
import { uuidN } from "@/test-fixtures/universities";

type Raw = Record<string, unknown>;

export const packageId = (n: number) => uuidN(n, "55555555");
export const packageItemId = (n: number) => uuidN(n, "66666666");
export const packageReviewId = (n: number) => uuidN(n, "77777777");
export const PACKAGE_REQUEST = "99999999-0000-4000-8000-0000000000a1";

/** Решение по файлу требования `index` (одно и то же в строке комплекта и в решении по комплекту). */
export function docReviewFor(index: number, decision: "approved" | "correction_required" | "rejected" = "approved", reason: string | null = null): Raw {
  return { reviewId: reviewId(index + 1), decision, reason: decision === "approved" ? null : (reason ?? "Нужна чёткая копия."), reviewedAt: "2026-10-08T05:30:00+00:00" };
}

/** Решение по комплекту. `items`: индексы требований в составе (порядок как в комплекте), `n`: номер версий файлов. */
export function packageReview(reviewN: number, pkgN: number, items: number[], decision: "approved" | "correction_required", reason: string | null = null, affected: number[] = []): Raw {
  return {
    packageReviewId: packageReviewId(reviewN),
    packageId: packageId(pkgN),
    decision,
    reason: decision === "approved" ? null : (reason ?? "Нужны исправления."),
    affectedItemIds: affected.map(itemId),
    documentReviews: items.map((index) => ({
      requirementItemId: itemId(index),
      submissionId: uuidN(index + 1, "33333333"),
      review: decision === "approved" ? docReviewFor(index) : null,
      reusedFromSubmissionId: null,
      reusedFromReview: null,
    })),
    reviewedAt: "2026-10-09T07:00:00+00:00",
  };
}

/** Сводка комплекта. */
export function packageSummary(pkgN: number, itemCount: number, over: Raw = {}): Raw {
  return {
    packageId: packageId(pkgN),
    requirementsRevisionId: REVISION_ID,
    requirementsRevisionVersion: "1",
    origin: "staff_confirmed",
    configurationState: "confirmed",
    packageVersion: String(pkgN),
    previousPackageId: null,
    compositionSha256: sha(900 + pkgN),
    submittedAt: `2026-10-0${Math.min(pkgN, 9)}T10:00:00+00:00`,
    itemCount,
    isCurrentRequirements: true,
    latestReview: null,
    ...over,
  };
}

/** Строка комплекта: файл версии `n` у требования `index`, с решением по файлу или без. */
export function packageItem(index: number, n: number, review: Raw | null = null): Raw {
  const submission = submissionOf(index, index + 1, review) as Raw;
  const file = documentFile(n) as Raw;
  return {
    packageItemId: packageItemId(index + 1),
    requirementItemId: itemId(index),
    definition: definitionOf(index),
    materialSnapshot: null,
    selection: { kind: "existing_version", documentVersionId: versionId(n) },
    submission: { ...submission, file },
  };
}

export const PROGRAM = {
  institutionId: uuidN(1, "88888888"),
  publicationId: uuidN(2, "88888888"),
  programId: "cs",
  intakeId: "11111111-1111-4111-8111-111111111111",
  universityTitle: "Университет 1",
  programTitle: "Информатика",
  intakeLabel: "Осень 2027",
};

/** Комплект подробно. */
export function packageDetail(summary: Raw, items: Raw[], warnings: Raw[] = []): Raw {
  return { protocolVersion: 1, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, package: summary, program: PROGRAM, items, currentWarnings: warnings };
}

/** Страница истории комплектов (от новых к старым). */
export function packageHistoryPage(packages: Raw[], nextCursor: Raw | null = null): Raw {
  return { protocolVersion: 1, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, packages, nextCursor };
}

/** Страница истории решений по комплекту (от новых к старым). */
export function reviewHistoryPage(pkgN: number, reviews: Raw[], nextCursor: Raw | null = null): Raw {
  return { protocolVersion: 1, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, packageId: packageId(pkgN), reviews, nextCursor };
}

/** Запрос отправки комплекта: файлы версий `versions` по требованиям `indices`. */
export function submitIntentOf(indices: number[], versions: number[], over: Raw = {}): Raw {
  return {
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    requirementsRevisionId: REVISION_ID,
    expectedPreviousPackageId: null,
    items: indices.map((index, i) => ({ requirementItemId: itemId(index), selection: { kind: "existing_version", documentVersionId: versionId(versions[i]!) }, expectedPreviousSubmissionId: null })),
    requestId: PACKAGE_REQUEST,
    ...over,
  };
}

/** Квитанция отправки комплекта на запрос `intent`. */
export function submitReceiptOf(intent: Raw, pkgN = 1, over: Raw = {}): Raw {
  const items = intent.items as Raw[];
  return {
    protocolVersion: 1,
    requestId: intent.requestId,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    packageId: packageId(pkgN),
    requirementsRevisionId: intent.requirementsRevisionId,
    packageVersion: String(pkgN),
    compositionSha256: sha(900 + pkgN),
    submittedAt: "2026-10-26T10:00:00+00:00",
    reused: false,
    items: items.map((item, i) => ({
      packageItemId: packageItemId(i + 1),
      requirementItemId: item.requirementItemId,
      documentSlotId: slotId(Number(String(item.requirementItemId).slice(-1)) - 1),
      documentVersionId: (item.selection as Raw).documentVersionId,
      submissionId: uuidN(i + 1, "33333333"),
    })),
    ...over,
  };
}

/** Проверка исхода: комплект записан. */
export function recoveryCommitted(intent: Raw, pkgN = 1): Raw {
  return { protocolVersion: 1, operation: "submit", requestId: intent.requestId, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, status: "committed", receipt: submitReceiptOf(intent, pkgN) };
}

/** Проверка исхода: комплект с таким запросом не записан. */
export function recoveryAbsent(intent: Raw): Raw {
  return { protocolVersion: 1, operation: "submit", requestId: intent.requestId, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, status: "not_written", receipt: null };
}
