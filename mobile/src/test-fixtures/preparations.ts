// Синтетические ответы `application_package_readiness_v1` в форме строгих разборщиков веба (требования v2, состояние
// документов, готовность комплекта). Названия, имена файлов и адреса придуманы; реальных данных студентов здесь нет.
import { STUDENT_CASE_ID, uuidN } from "@/test-fixtures/universities";

export { STUDENT_CASE_ID };

/** Программа из `preparationRow(1)` (`bbbbbbbb-0000-4000-8000-000000000001`). */
export const APPLICATION_ID = uuidN(1, "bbbbbbbb");
export const REVISION_ID = uuidN(1, "dddddddd");
export const INITIALIZED_AT = "2026-10-06T09:00:00.123456+00:00";
export const sha = (n: number) => n.toString(16).padStart(64, "0");

type Raw = Record<string, unknown>;

export const itemId = (index: number) => uuidN(index + 1, "eeeeeeee");
export const slotId = (index: number) => uuidN(index + 1, "ffffffff");
export const versionId = (n: number) => uuidN(n, "11111111");
export const uploadId = (n: number) => uuidN(n, "22222222");
export const submissionId = (n: number) => uuidN(n, "33333333");
export const reviewId = (n: number) => uuidN(n, "44444444");

/** Требование v2. `index` с нуля; у начального списка EVO первые два ключа и обязательность заданы форматом. */
export function requirementItem(index: number, over: Raw = {}, starter = false): Raw {
  const key = starter ? ["evo.photo.v1", "evo.passport.v1"][index]! : `admission.item${index + 1}.v1`;
  return {
    requirementItemId: itemId(index),
    requirementKey: key,
    documentSlotId: slotId(index),
    position: index + 1,
    required: true,
    label: `Требование ${index + 1}`,
    groupLabel: "Основные документы",
    instructions: `Инструкция к требованию ${index + 1}.`,
    compatibilityKey: key,
    slotStatus: "required",
    currentVersionId: null,
    currentVersionNo: null,
    reviewDecision: null,
    reviewReason: null,
    reviewedAt: null,
    technicalAvailability: "unavailable",
    unavailableReasons: ["file_missing"],
    deadline: null,
    reviewScope: "document_version",
    definitionImpact: null,
    ...over,
  };
}

/** Файл версии документа (`ApplicationDocumentFile`). */
export function documentFile(n: number, over: Raw = {}): Raw {
  return {
    originalFilename: `scan-${n}.pdf`,
    declaredMimeType: "application/pdf",
    byteSize: "1024",
    sha256Hex: sha(n),
    documentVersionId: versionId(n),
    versionNo: String(n),
    finalizedAt: "2026-10-07T10:00:00+00:00",
    technicalAvailability: "available",
    unavailableReasons: [],
    ...over,
  };
}

export function reviewOf(n: number, decision: "approved" | "correction_required" | "rejected", reason: string | null = null): Raw {
  return { reviewId: reviewId(n), decision, reason: decision === "approved" ? null : (reason ?? "Нужна чёткая копия."), reviewedAt: "2026-10-08T05:30:00+00:00" };
}

export function submissionOf(index: number, n: number, review: Raw | null = null, fileOver: Raw = {}): Raw {
  return {
    submissionId: submissionId(n),
    requirementsRevisionId: REVISION_ID,
    requirementItemId: itemId(index),
    documentSlotId: slotId(index),
    submittedAt: "2026-10-07T10:05:00+00:00",
    file: documentFile(n, fileOver),
    review,
  };
}

export function draftOf(index: number, n: number, fileOver: Raw = {}): Raw {
  return {
    uploadContextId: uploadId(n),
    requirementsRevisionId: REVISION_ID,
    requirementItemId: itemId(index),
    documentSlotId: slotId(index),
    admittedAt: "2026-10-07T09:55:00+00:00",
    file: documentFile(n, fileOver),
  };
}

/** Состояние документа у одного требования (`ApplicationDocumentItemState`). */
export function documentState(index: number, over: Raw = {}): Raw {
  return {
    requirementItemId: itemId(index),
    documentSlotId: slotId(index),
    savedDraft: null,
    submission: null,
    previousEvidence: null,
    reusableVersions: [],
    reusableVersionsNextCursor: null,
    canUpload: true,
    canSubmit: true,
    ...over,
  };
}

/** Требования v2 с ревизией (`initialized` или `needs_configuration`). */
export function requirements(items: Raw[], over: Raw = {}): Raw {
  return {
    protocolVersion: 2,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    state: "initialized",
    revisionId: REVISION_ID,
    revisionVersion: "1",
    origin: "staff_confirmed",
    configurationState: "confirmed",
    initializedAt: INITIALIZED_AT,
    configurationReasons: [],
    items,
    ...over,
  };
}

/** Требования без ревизии: список ещё не открыт (`uninitialized`) либо нужна настройка куратором (`needs_configuration`). */
export function noRevision(state: "uninitialized" | "needs_configuration" = "uninitialized", reasons: string[] = []): Raw {
  return {
    protocolVersion: 2,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    state,
    revisionId: null,
    revisionVersion: null,
    origin: null,
    configurationState: null,
    initializedAt: null,
    configurationReasons: state === "uninitialized" ? [] : reasons,
    items: [],
  };
}

/** Начальный список EVO: фото и паспорт, оба обязательны, файлов нет. */
export function starterRequirements(over: Raw = {}, items: Raw[] = [requirementItem(0, {}, true), requirementItem(1, {}, true)]): Raw {
  return requirements(items, { origin: "evo_starter", configurationState: "needs_confirmation", ...over });
}

/** Ответ `application_package_readiness_v1` без выбранных файлов: обязательные требования перечислены как недостающие. */
export function readiness(reqs: Raw, docs?: Raw[], over: Raw = {}): Raw {
  const items = reqs.items as Raw[];
  const states = docs ?? items.map((_, index) => documentState(index));
  const missing = items.filter((item) => item.required === true).map((item) => item.requirementItemId);
  return {
    protocolVersion: 1,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    requirements: reqs,
    documentItems: states,
    latestPackage: null,
    selections: [],
    missingRequiredItemIds: missing,
    reasons: items.length === 0 ? ["requirements_unavailable"] : ["empty_composition", "missing_required"],
    canSubmit: false,
    ...over,
  };
}

/** Выбор файла для комплекта, как его повторяет ответ `application_package_readiness_v1` (`ApplicationPackageReadinessSelection`). */
export function selectionEcho(index: number, n: number, over: Raw = {}): Raw {
  return {
    requirementItemId: itemId(index),
    selection: { kind: "existing_version", documentVersionId: versionId(n) },
    expectedPreviousSubmissionId: null,
    file: documentFile(n),
    submissionId: null,
    reasons: [],
    ...over,
  };
}

/** Ответ с выбранными файлами: недостающие обязательные - те, для которых выбора нет; `canSubmit` считает сервер, здесь он задан явно. */
export function readinessWithSelections(reqs: Raw, docs: Raw[] | undefined, selections: Raw[], over: Raw = {}): Raw {
  const items = reqs.items as Raw[];
  const chosen = new Set(selections.map((entry) => entry.requirementItemId));
  const missing = items.filter((item) => item.required === true && !chosen.has(item.requirementItemId)).map((item) => item.requirementItemId);
  return {
    ...readiness(reqs, docs),
    selections,
    missingRequiredItemIds: missing,
    reasons: missing.length > 0 ? ["missing_required"] : [],
    canSubmit: missing.length === 0,
    ...over,
  };
}

/** Готовый ответ: начальный список из двух требований без файлов. */
export function starterReadiness(): Raw {
  return readiness(starterRequirements());
}

/** Готовый ответ: список ещё не открыт. */
export function uninitializedReadiness(): Raw {
  return readiness(noRevision("uninitialized"));
}

/** Квитанция `student_initialize_application_requirements_v1` на запрос `requestId`. */
export function initializeReceipt(requestId: string): Raw {
  return {
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    requestId,
    revisionId: REVISION_ID,
    revisionVersion: "1",
    origin: "evo_starter",
    configurationState: "needs_confirmation",
    initializedAt: INITIALIZED_AT,
    items: [0, 1].map((index) => ({ requirementItemId: itemId(index), requirementKey: ["evo.photo.v1", "evo.passport.v1"][index], documentSlotId: slotId(index) })),
  };
}

/** Определение требования внутри записи истории (`ApplicationDocumentDefinition`). */
export function definitionOf(index: number, over: Raw = {}): Raw {
  return {
    requirementKey: `admission.item${index + 1}.v1`,
    required: true,
    label: `Требование ${index + 1}`,
    groupLabel: "Основные документы",
    instructions: `Инструкция к требованию ${index + 1}.`,
    deadline: null,
    documentSlotId: slotId(index),
    ...over,
  };
}

/** Запись истории «сохранён файл». */
export function historyUpload(index: number, n: number, createdAt = "2026-10-07T09:55:00+00:00", over: Raw = {}): Raw {
  const upload = draftOf(index, n);
  return {
    id: uploadId(n),
    kind: "upload",
    createdAt,
    requirementsRevisionId: REVISION_ID,
    requirementItemId: itemId(index),
    definition: definitionOf(index),
    materialSnapshot: null,
    upload,
    submission: null,
    ...over,
  };
}

/** Запись истории «отправлено на проверку». */
export function historySubmission(index: number, n: number, review: Raw | null = null, createdAt = "2026-10-07T10:05:00+00:00", over: Raw = {}): Raw {
  return {
    id: submissionId(n),
    kind: "submission",
    createdAt,
    requirementsRevisionId: REVISION_ID,
    requirementItemId: itemId(index),
    definition: definitionOf(index),
    materialSnapshot: null,
    upload: null,
    submission: submissionOf(index, n, review),
    ...over,
  };
}

/** Страница истории документов (по требованию или по всей программе). События от новых к старым. */
export function historyPage(events: Raw[], requirementItemId: string | null, nextCursor: Raw | null = null): Raw {
  return { protocolVersion: 1, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementItemId, events, nextCursor };
}

/** Прежняя версия файла, которую можно отправить снова. */
export function reusableVersion(n: number, fileOver: Raw = {}): Raw {
  return { selection: { kind: "existing_version", documentVersionId: versionId(n) }, file: documentFile(n, fileOver) };
}

/** Страница сохранённых файлов требования. Версии от новых к старым. */
export function versionsPage(index: number, versions: Raw[], nextCursor: Raw | null = null): Raw {
  return { protocolVersion: 1, studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementItemId: itemId(index), versions, nextCursor };
}

/** Квитанция `submit_application_document_v1` на запрос `requestId`. */
export function submitReceipt(index: number, requestId: string, documentVersionId: string, over: Raw = {}): Raw {
  return {
    protocolVersion: 1,
    studentCaseId: STUDENT_CASE_ID,
    applicationId: APPLICATION_ID,
    requirementsRevisionId: REVISION_ID,
    requirementItemId: itemId(index),
    documentSlotId: slotId(index),
    requestId,
    submissionId: submissionId(90),
    documentVersionId,
    versionNo: "1",
    submittedAt: "2026-10-26T10:00:00+00:00",
    reused: false,
    ...over,
  };
}
