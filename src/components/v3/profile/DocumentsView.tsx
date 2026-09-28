import Link from "next/link";
import type { ReactElement } from "react";

import { ProgressBar } from "@/components/v3/blocks/ProgressBar";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";

import { caseChecklistCounts } from "./case-work-view";
import type {
  ActiveDocumentGroup,
  BaselineChecklistOption,
  DocumentGroup,
  DocumentRecognitionAccess,
  DocumentUploadAccess,
  RemovedDocumentGroup,
} from "./document-types";
import {
  documentFilterEmptyText,
  documentStateHref,
  documentStateTabs,
  filterDocumentGroups,
  type DocumentStateFilter,
} from "./documents-view";
import { ProfileDocumentsClient } from "./ProfileDocumentsClient";

export type DocumentsViewInput = Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
  recognition: DocumentRecognitionAccess | null;
  /** Фильтр по состоянию из адреса (`doc_state`). */
  filter: DocumentStateFilter;
  /** `hrefFor("documents")` страницы: фильтр сохраняет `section=docs` и `returnTo`. */
  tabHref: string;
  /** «Сегодня» по Бишкеку: даты строк «18.09 16:58», год — только не текущий. */
  today: string;
  createRequestId: string | null;
  baselineOptions: readonly BaselineChecklistOption[];
  baselineOptionsUnavailable: boolean;
  baselineTemplatesAbsent: boolean;
  baselineChecklistRequestId: string | null;
}>;

/**
 * Вкладка «Документы» из уже прочитанного — синхронно, без чтений: страница
 * (`Documents`) читает базовые чек-листы и зовёт этот вид, статический рендер
 * (`tests/e2e/case-documents-static-render.cjs`) — с синтетикой.
 *
 * «N из M принято» и числа фильтра — `caseChecklistCounts` того же чек-листа,
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
  const visibleGroups = filterDocumentGroups(activeGroups, input.filter);
  const emptyText = checklistEmpty || input.filter === "all" ? null : (
    <>
      {documentFilterEmptyText(input.filter)}{" "}
      <Link href={documentStateHref(input.tabHref, "all")} scroll={false} className="inline-flex min-h-11 items-center text-fg underline underline-offset-4">
        Показать все
      </Link>
    </>
  );

  return (
    <ProfileDocumentsClient
      groups={visibleGroups}
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
      stateFilter={input.filter}
      progress={checklistEmpty ? null : (
        <ProgressBar done={counts.approved} total={counts.total} word="принято" />
      )}
      filter={checklistEmpty ? null : (
        <QueueViewTabs label="Документы по состоянию" tabs={documentStateTabs(counts, input.filter, input.tabHref)} />
      )}
      checklistEmpty={checklistEmpty}
      emptyText={emptyText}
    />
  );
}
