import type { ReactNode } from "react";

import { Icon } from "@/components/icons";

/**
 * Группа правки: одна строка — название и что уже заполнено, раскрытие —
 * прежняя форма без своей карточки. `name` у всех групп один: открыта одна.
 * Одна и та же у Lead 360 («Данные лида») и Student 360 («Данные продажи»):
 * названия групп не расходятся. Группа именованная (`group/edit`): в «Данных продажи» дела она лежит внутри другой
 * раскрывающейся группы, и безымянный `group-open` поворачивал бы шеврон закрытой. Пустая строка заполненного — пустое место, а не «не заполнено».
 */
export function EditGroup({ id, title, summary, testId, children }: Readonly<{
  id?: string; title: string; summary: string | null; testId: string; children: ReactNode;
}>) {
  return (
    <details name="lead-edit" id={id} data-lead-group="" data-testid={testId} className="group/edit scroll-mt-4 border-b border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-nav py-1.5 [&::-webkit-details-marker]:hidden">
        {/* Строка заполненного — рядом с названием, а если места меньше 7rem — под ним во всю ширину. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <span className="t-item text-fg">{title}</span>
          {summary ? <span className="min-w-28 flex-1 truncate t-meta text-fg-2" title={summary}>{summary}</span> : null}
        </span>
        <Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 transition-transform duration-150 group-open/edit:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="pb-4 pt-1">{children}</div>
    </details>
  );
}
