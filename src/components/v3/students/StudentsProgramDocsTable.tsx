"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icons";
import { ProgramFileEvidence } from "@/components/portal/admissionPreparations/ProgramDocumentEvidence";
import { ProgramDocumentReview } from "@/components/portal/admissionPreparations/ProgramDocumentReview";
import styles from "@/components/portal/admissionPreparations/ProgramDocuments.module.css";
import type { ApplicationDocumentOwner, ApplicationDocumentQueueItem } from "@/lib/portal/application-documents";
import { getPortalStrings } from "@/lib/portal/i18n";

import { formatQueueDay } from "../queue/due-bucket";
import { ProgramDocsRecovery } from "./DocsQueueRecovery";
import { docsWaiting, studentsCaseHref } from "./students-queue-view";

/*
 * Вкладка «Документы программ» EVO Docs (Э8.5, 28.09.2026): документы
 * требований программ, отправленные на проверку EVO и ещё без решения, —
 * очередь, которая жила на подстранице доски поступления. Строка: студент ·
 * документ, вуз и программа (прежнее требование — предупреждением, срок
 * требования), день отправки и «ждёт N дн», файл со «Скачать файл» и решение
 * в строке — тот же `ProgramDocumentReview` (и то же восстановление
 * незавершённых решений), что был в очереди доски. «Открыть программу» —
 * подготовка программы на вкладке дела «Вузы и программы». От 48rem своей
 * ширины — колонки, уже — стопка. Строка не ссылка целиком: в ней файл и форма.
 */
const COLUMNS = "@min-[48rem]/program:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_9rem_11rem]";
// Решение — под описанием документа, рядом с файлом: раскрытая форма растёт в первой колонке.
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 [grid-template-areas:'document'_'sent'_'file'_'decision'_'open'] ${COLUMNS} @min-[48rem]/program:grid-rows-[auto_1fr] @min-[48rem]/program:[grid-template-areas:'document_file_sent_open'_'decision_file_sent_open']`;
const CELL = "min-w-0 px-3 @min-[48rem]/program:px-2";
const HEAD = "flex h-9 items-center px-2 text-start t-caption text-fg-2 first:ps-3";
/**
 * Файл и решение — общие компоненты документов программ (их CSS-модуль);
 * рамку и отступ раскрытия решения в строке очереди снимает правило
 * `[data-docs-decision]` в v3.css — рамка у строки.
 */
const EVIDENCE = `${styles.root} t-body-compact`;
/**
 * «Сохранить решение» — подтверждение в строке: тёмная нейтральная кнопка, как
 * `QUEUE_CONFIRM`; сплошной красный остаётся главному действию страницы.
 */
const NEUTRAL_CONFIRM = "[--doc-accent:var(--text)] [--doc-on-accent:var(--surface)]";

function deadlineText(deadline: NonNullable<ApplicationDocumentQueueItem["deadline"]>, today: string): Readonly<{ short: string; full: string }> {
  const day = formatQueueDay(deadline.date, today);
  return {
    short: deadline.time ? `${day} ${deadline.time}` : day,
    full: `${deadline.date.split("-").reverse().join(".")}${deadline.time ? `, ${deadline.time}` : ""}${deadline.timezone ? ` (${deadline.timezone})` : ""}`,
  };
}

export function StudentsProgramDocsTable({
  items,
  owner,
  canReview,
  returnTo,
  today,
  caption,
}: Readonly<{
  items: readonly ApplicationDocumentQueueItem[];
  owner: ApplicationDocumentOwner;
  /** `document.review` вне просмотра роли: форма решения в строке. */
  canReview: boolean;
  /** Адрес этой вкладки EVO Docs: «К списку EVO Docs» возвращает сюда. */
  returnTo: string;
  /** Сегодня в Бишкеке — для дня загрузки и «ждёт N дн». */
  today: string;
  caption: string;
}>) {
  const router = useRouter();
  const strings = getPortalStrings("programDocuments", "ru");
  return (
    <div className="@container/program min-w-0 space-y-1" data-queue-list="">
      <div role="table" aria-label={caption} className="block w-full" data-testid="v3-program-document-table">
        <div role="rowgroup" className="sr-only @min-[48rem]/program:not-sr-only @min-[48rem]/program:sticky @min-[48rem]/program:top-0 @min-[48rem]/program:z-30 @min-[48rem]/program:block @min-[48rem]/program:bg-bg">
          <div role="row" className={`grid gap-x-3 ${COLUMNS} shadow-[inset_0_-1px_0_var(--border)]`}>
            {(["Документ", "Файл", "Отправлен"] as const).map((label) => <span key={label} role="columnheader" className={HEAD}>{label}</span>)}
            <span role="columnheader" className={HEAD}><span className="sr-only">Действие</span></span>
          </div>
        </div>
        <div role="rowgroup" className="block">
          {items.map((item) => {
            const scope = { ...owner, studentCaseId: item.studentCaseId, applicationId: item.applicationId };
            const target = {
              studentCaseId: item.studentCaseId, applicationId: item.applicationId,
              requirementsRevisionId: item.submission.requirementsRevisionId,
              requirementItemId: item.submission.requirementItemId, documentSlotId: item.submission.documentSlotId,
            };
            const program = [item.universityTitle, item.programTitle].filter(Boolean).join(" · ");
            const waiting = docsWaiting(item.submission.submittedAt, today);
            const deadline = item.deadline ? deadlineText(item.deadline, today) : null;
            const href = `${studentsCaseHref(item.studentCaseId, { docs: true, tab: "route", returnTo })}#preparation-${item.applicationId}`;
            return (
              <div
                key={item.submission.submissionId}
                role="row"
                data-queue-row={item.submission.submissionId}
                data-testid="v3-program-document-row"
                data-student-case-id={item.studentCaseId}
                className={`v3-queue-row ${ROW_GRID} border-b border-border py-2 has-[[data-queue-open]:focus-visible]:bg-surface`}
              >
                <div role="rowheader" className={`${CELL} [grid-area:document] @min-[48rem]/program:ps-3`}>
                  <p className="t-item text-fg">
                    <span>{item.studentDisplayName}</span><span className="font-normal text-fg-3"> · </span><span>{item.requirementLabel}</span>
                  </p>
                  <p className="t-body-compact text-fg-2">
                    <span className="break-words">{program}</span>
                    {/* Документ отправлен по прежней редакции требований — это надо увидеть до решения. */}
                    {!item.isCurrentRequirement ? <><span className="text-fg-3"> · </span><span className="font-medium text-warn">{strings.olderRequirement}</span></> : null}
                    {deadline ? <><span className="text-fg-3"> · </span><span title={deadline.full}>срок <time dateTime={item.deadline!.date} className="font-mono tabular-nums">{deadline.short}</time></span></> : null}
                  </p>
                </div>
                <div role="cell" className={`${CELL} [grid-area:file] ${EVIDENCE}`}>
                  <ProgramFileEvidence file={item.submission.file} target={target} audience="staff" strings={strings} />
                </div>
                <div role="cell" className={`${CELL} [grid-area:sent] self-start whitespace-nowrap t-body-compact`}>
                  {waiting ? <>
                    <span className="text-fg-2 @min-[48rem]/program:hidden">Отправлен </span>
                    <time dateTime={waiting.dateTime} className="font-mono tabular-nums text-fg">{waiting.day}</time>
                    <span className="text-fg-3"> · </span>
                    <span className={waiting.warn ? "font-medium text-warn" : "text-fg-2"}>{waiting.word}</span>
                  </> : null}
                </div>
                <div role="cell" data-docs-decision="" className={`${CELL} [grid-area:decision] ${EVIDENCE} @min-[48rem]/program:ps-3`}>
                  <div className={NEUTRAL_CONFIRM}>
                    <ProgramDocumentReview scope={scope} submission={item.submission} strings={strings} canReview={canReview} onSaved={() => router.refresh()} />
                  </div>
                </div>
                <div role="cell" className={`${CELL} [grid-area:open] self-start @min-[48rem]/program:-mt-2`}>
                  <Link
                    href={href}
                    data-queue-open=""
                    className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap t-label text-fg underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {strings.openProgram}<span className="sr-only">: {item.studentDisplayName}, {item.requirementLabel}</span>
                    <Icon name="arrow-right" size={16} className="shrink-0 text-fg-2" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ProgramDocsRecovery owner={owner} visibleSubmissions={items.map((item) => item.submission.submissionId)} />
    </div>
  );
}
