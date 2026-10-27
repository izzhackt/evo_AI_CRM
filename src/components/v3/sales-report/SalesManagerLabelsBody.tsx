import { randomUUID } from "node:crypto";

import { salesManagerLabelName } from "@/lib/sales-manager-labels";
import { managersWord, recordsWord } from "@/lib/sales-register-view";
import type { readSalesManagerLabels } from "@/lib/v3/sales-register-source";

import { MANAGER_ROW_GRID, SalesManagerLabelForm } from "../SalesManagerLabelForm";

/**
 * Тело «Менеджеров в отчёте»: отказ в доступе, сбой чтения или число написаний и строка на каждое с формой «Имя в отчёте». Общее у
 * прежнего вида и «Нового вида» (вынесено из `SalesManagerLabelsView.tsx` без изменений разметки).
 */
export function SalesManagerLabelsBody({ read }: Readonly<{ read: Awaited<ReturnType<typeof readSalesManagerLabels>> }>) {
  const labels = read.status === "ready" ? read.data.labels : [];
  const mapped = labels.filter((label) => label.mapping?.displayName).length;
  return <>
    {read.status === "denied" ? <p role="status" className="mt-6 t-body-compact text-fg-2">Нет доступа: менеджеров сопоставляет тот, кто переносит данные отчёта.</p> : null}
    {read.status === "unavailable" ? <p role="alert" className="mt-6 t-body-compact text-fg-2">Не удалось загрузить написания менеджеров. Обновите страницу.</p> : null}
    {read.status === "ready" ? <>
      <p className="mt-4 t-meta text-fg-2" data-testid="sales-managers-count">
        {labels.length ? `${labels.length} ${managersWord(labels.length)} по написаниям, с именем — ${mapped}.`
          : "В отчёте пока нет менеджеров."}
      </p>
      {labels.length ? <section aria-label="Написания менеджеров" className="mt-3 border-t border-border" data-testid="sales-managers">
        <div aria-hidden="true" className={`hidden border-b border-border px-4 py-2 t-caption text-fg-2 ${MANAGER_ROW_GRID}`}>
          <span>Написания в отчёте</span><span className="text-right">Записей</span><span>Сотрудник</span><span>Имя в отчёте</span><span className="w-28" />
        </div>
        <ul className="divide-y divide-border border-b border-border">
          {labels.map((label) => <li key={label.key} className="bg-surface px-4 py-3" data-manager-key={label.key}>
            <SalesManagerLabelForm requestId={randomUUID()} labelKey={label.key} version={label.mapping?.version ?? 0}
              name={label.mapping?.displayName ?? ""} membershipId={label.mapping?.membershipId ?? ""} fallback={salesManagerLabelName(label)}
              staffOptions={read.data.staffOptions}>
              <div className="min-w-0 md:pt-2.5">
                <ul className="flex flex-wrap gap-x-3 gap-y-1 t-body-compact text-fg" aria-label="Написания">
                  {label.spellings.map((one) => <li key={one.spelling} className="min-w-0 break-words">
                    <span className="whitespace-pre-wrap">«{one.spelling}»</span>
                    {label.spellings.length > 1 ? <span className="tabular-nums text-fg-3"> · {one.count}</span> : null}
                  </li>)}
                  {label.spellings.length === 0 ? <li className="text-fg-3">записей с этим написанием нет</li> : null}
                </ul>
              </div>
              <p className="mt-1 t-body-compact tabular-nums text-fg-2 md:mt-0 md:pt-2.5 md:text-right">
                {label.recordCount} <span className="md:sr-only">{recordsWord(label.recordCount)}</span>
              </p>
            </SalesManagerLabelForm>
          </li>)}
        </ul>
      </section> : null}
    </> : null}
  </>;
}
