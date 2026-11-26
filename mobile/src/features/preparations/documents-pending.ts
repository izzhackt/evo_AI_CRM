// Незавершённые записи документов программы: «сохранить файл» (`upload`) и «отправить на проверку» (`submit`).
// Формат записи и ключа тот же, что у веба (`application-documents-pending.ts`): `evo.application-documents.v1:<организация>:
// <участник>:<дело>:<программа>:<операция>:<требование>`.
import {
  parseApplicationDocumentSubmitIntent,
  parseApplicationDocumentUploadIntent,
  type ApplicationDocumentSubmitIntent,
  type ApplicationDocumentUploadIntent,
} from "@web/lib/portal/application-documents";

import { createPendingStore } from "@/features/preparations/pending-store";

export type DocumentOperation = "upload" | "submit";
export type DocumentPendingIntent = ApplicationDocumentUploadIntent | ApplicationDocumentSubmitIntent;

export const isUploadIntent = (intent: DocumentPendingIntent | null): intent is ApplicationDocumentUploadIntent => intent !== null && "file" in intent;
export const isSubmitIntent = (intent: DocumentPendingIntent | null): intent is ApplicationDocumentSubmitIntent => intent !== null && "selection" in intent;

/** Размер записи как у веба: больше - испорчена. */
const MAX_LENGTH = 16384;

export const documentsPending = createPendingStore<DocumentOperation, DocumentPendingIntent>({
  name: "evo.application-documents.v1",
  operations: ["upload", "submit"],
  maxLength: MAX_LENGTH,
  parse: (scope, operation, target, value) => {
    const intent = operation === "upload" ? parseApplicationDocumentUploadIntent(value) : parseApplicationDocumentSubmitIntent(value);
    return intent && intent.requirementItemId === target && intent.studentCaseId === scope.studentCaseId && intent.applicationId === scope.applicationId ? intent : null;
  },
});
