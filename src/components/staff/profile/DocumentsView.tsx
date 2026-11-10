import type { ReactElement, ReactNode } from "react";

import { ProgressBar } from "@/components/staff/blocks/ProgressBar";

import { caseChecklistCounts } from "./case-work-view";
import type {
  ActiveDocumentGroup,
  BaselineChecklistOption,
  DocumentGroup,
  DocumentRecognitionAccess,
  DocumentUploadAccess,
  RemovedDocumentGroup,
} from "./document-types";
import { ProfileDocumentsClient } from "./ProfileDocumentsClient";

export type DocumentsViewInput = Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
  recognition: DocumentRecognitionAccess | null;
  /** «Сегодня» по Бишкеку: даты строк «18.09 16:58», год — только не текущий. */
  today: string;
  createRequestId: string | null;
  baselineOptions: readonly BaselineChecklistOption[];
  baselineOptionsUnavailable: boolean;
  baselineTemplatesAbsent: boolean;
  baselineChecklistRequestId: string | null;
  /** «Новый вид»: карточки набора вместо прежней раскладки (`DocumentsNextLayout`); те же данные и команды. */
  nextUi?: boolean;
  /** Разбор файлов из amoCRM (`AmoDocumentSorting`); null - разбирать нечего. */
  sorting?: ReactNode;
}>;

/**
 * Вкладка «Документы» из уже прочитанного — синхронно, без чтений: страница
 * (`Documents`) читает базовые чек-листы и зовёт этот вид, статический рендер
 * (`tests/e2e/case-documents-static-render.cjs`) — с синтетикой.
 *
 * «N из M принято» — `caseChecklistCounts` того же чек-листа,
 * что у «Быстрого просмотра» и EVO Docs; пустой чек-лист чисел не рисует.
 */
export function documentsView(input: DocumentsViewInput): ReactElement {
  const activeGroups = input.groups.filter(
    (group): group is ActiveDocumentGroup => group.kind === "active",
  );
  const historyGroups = input.groups.filter(
    (group): group is RemovedDocumentGroup => group.kind === "removed",
  );
  const counts = caseChecklistCounts(input.groups);
  const checklistEmpty = counts.total === 0;

  return (
    <ProfileDocumentsClient
      groups={activeGroups}
      historyGroups={historyGroups}
      uploadAccess={input.uploadAccess}
      studentCaseId={input.studentCaseId}
      createRequestId={input.createRequestId}
      baselineOptions={input.baselineOptions}
      baselineOptionsUnavailable={input.baselineOptionsUnavailable}
      baselineTemplatesAbsent={input.baselineTemplatesAbsent}
      baselineChecklistRequestId={input.baselineChecklistRequestId}
      recognition={input.recognition}
      today={input.today}
      progress={checklistEmpty ? null : (
        <ProgressBar done={counts.approved} total={counts.total} word="принято" />
      )}
      checklistEmpty={checklistEmpty}
      nextUi={input.nextUi}
      sorting={input.sorting ?? null}
    />
  );
}
