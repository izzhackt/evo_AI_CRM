import Link from "next/link";

import { Icon } from "@/components/icons";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import type { ApplicationPackageQueueItem } from "@/lib/portal/application-packages";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";

import { dayDelta } from "../calendar/types";
import { formatQueueDay } from "../queue/due-bucket";
import { russianPlural, studentsCaseHref } from "./students-queue-view";

const NBSP = "\u00a0";

/**
 * Вкладка «Комплекты» EVO Docs (Э3, 27.09.2026): комплекты, отправленные на
 * проверку EVO и ещё без решения, — строки того же чтения, что у очереди
 * «Комплекты на проверку» доски поступления (`application_package_queue_v1`,
 * новые сверху). Студент | Комплект | Отправлен | одно действие «Открыть
 * документы →»: подготовка программы на вкладке дела «Вузы и программы»
 * (`#preparation-…`), где комплект открывается и проверяется.
 * Состояние у всех строк одно («отправлен на проверку EVO»: решения ещё нет) —
 * оно названо один раз над таблицей, а не в каждой строке. В строке — вуз и
 * программа, число документов, набор и, если комплект собран по прежней
 * редакции требований, это предупреждение. Полосы «N из M» нет: принятых
 * документов комплекта очередь не отдаёт — только их число. От 48rem своей
 * ширины — таблица в одну строку, уже — стопка (как у `StudentsDocsTable`):
 * в стопке голова строки — имя студента (t-item), вуз и программа под ним —
 * обычным весом.
 */
const COLUMNS = "@min-[48rem]/packages:grid-cols-[minmax(0,22fr)_minmax(0,50fr)_10rem_11rem] @min-[48rem]/packages:[grid-template-areas:'student_package_sent_open']";
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)] gap-x-3 [grid-template-areas:'student'_'package'_'sent'_'open'] ${COLUMNS}`;
const CELL = "min-w-0 px-3 @min-[48rem]/packages:px-2 @min-[48rem]/packages:py-2";
const HEAD = "flex h-9 items-center px-2 text-start t-caption text-fg-2 first:ps-3";

/** День отправки по Бишкеку: «24.09» и слово «сегодня», «вчера», «3 дн назад». */
export function packageSentDay(submittedAt: string, today: string): Readonly<{ dateTime: string; text: string; word: string }> | null {
  const moment = new Date(submittedAt);
  if (!Number.isFinite(moment.getTime())) return null;
  const day = dayInOrganizationTimezone(moment);
  const ago = dayDelta(day, today);
  return { dateTime: submittedAt, text: formatQueueDay(day, today), word: ago <= 0 ? "сегодня" : ago === 1 ? "вчера" : `${ago}${NBSP}дн назад` };
}

export function StudentsPackagesTable({
  items,
  caption,
  returnTo,
  today,
}: Readonly<{
  items: readonly ApplicationPackageQueueItem[];
  caption: string;
  /** Адрес этой вкладки EVO Docs: «К списку EVO Docs» возвращает сюда. */
  returnTo: string;
  /** Сегодня в Бишкеке — для слова дня отправки. */
  today: string;
}>) {
  const words = packageStrings("ru");
  return (
    <div className="@container/packages min-w-0 space-y-1" data-queue-list="">
      <p className="t-meta text-fg-2">Отправлены на проверку EVO, решения ещё нет. Порядок: сначала недавно отправленные</p>
      <table role="table" className="block w-full" data-testid="v3-student-package-table">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className="sr-only @min-[48rem]/packages:not-sr-only @min-[48rem]/packages:sticky @min-[48rem]/packages:top-0 @min-[48rem]/packages:z-30 @min-[48rem]/packages:block @min-[48rem]/packages:bg-bg">
          <tr role="row" className={`grid gap-x-3 ${COLUMNS} shadow-[inset_0_-1px_0_var(--border)]`}>
            {(["Студент", "Комплект", "Отправлен"] as const).map((label) => <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>)}
            <th role="columnheader" scope="col" className={HEAD}><span className="sr-only">Действие</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="block">
          {items.map((item) => {
            const program = [item.program.universityTitle, item.program.programTitle].filter(Boolean).join(" · ");
            const count = item.package.itemCount;
            const sent = packageSentDay(item.package.submittedAt, today);
            const href = `${studentsCaseHref(item.studentCaseId, { docs: true, tab: "route", returnTo })}#preparation-${item.applicationId}`;
            return (
              <tr
                key={item.package.packageId}
                role="row"
                data-queue-row={item.package.packageId}
                data-testid="v3-student-package-row"
                data-student-case-id={item.studentCaseId}
                className={`v3-queue-row group relative ${ROW_GRID} border-b border-border py-2 hover:bg-surface has-[[data-queue-open]:focus-visible]:bg-surface @min-[48rem]/packages:py-0`}
              >
                <th role="rowheader" scope="row" className={`${CELL} [grid-area:student] self-center text-start font-normal @min-[48rem]/packages:ps-3`}>
                  <span className="block truncate t-item text-fg" title={item.studentDisplayName}>{item.studentDisplayName}</span>
                </th>
                <td role="cell" className={`${CELL} [grid-area:package] t-body-compact`}>
                  {/* В стопке голова строки — студент: вуз и программа обычным весом; в таблице — своя колонка, как имя. */}
                  <span className="line-clamp-2 break-words t-body-compact text-fg @min-[48rem]/packages:font-semibold" title={program}>{program}</span>
                  <span className="block text-fg-2">
                    {count}{NBSP}{russianPlural(count, "документ", "документа", "документов")}
                    <span className="text-fg-3"> · </span>
                    Набор: {item.program.intakeLabel}
                    {/* Комплект собран по прежней редакции требований — это надо увидеть до проверки. */}
                    {!item.package.isCurrentRequirements ? <><span className="text-fg-3"> · </span><span className="font-medium text-warn">{words.older}</span></> : null}
                  </span>
                </td>
                <td role="cell" className={`${CELL} [grid-area:sent] whitespace-nowrap t-body-compact @min-[48rem]/packages:self-center`}>
                  {sent ? <>
                    <span className="text-fg-2 @min-[48rem]/packages:hidden">Отправлен </span>
                    <time dateTime={sent.dateTime} className="font-mono tabular-nums text-fg">{sent.text}</time>
                    <span className="text-fg-3"> · </span>
                    <span className="text-fg-2">{sent.word}</span>
                  </> : null}
                </td>
                <td role="cell" className={`${CELL} [grid-area:open] @min-[48rem]/packages:self-center`}>
                  {/* Одно действие строки; его область — вся строка. */}
                  <Link
                    href={href}
                    data-queue-open=""
                    className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap t-label text-fg underline-offset-4 before:absolute before:inset-0 before:content-[''] group-hover:underline focus-visible:underline"
                  >
                    Открыть документы<span className="sr-only">: {item.studentDisplayName}, {program}</span>
                    <Icon name="arrow-right" size={16} className="shrink-0 text-fg-2" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
