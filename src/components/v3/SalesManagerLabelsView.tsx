import { randomUUID } from "node:crypto";
import Link from "next/link";
import { btnGhostCls } from "@/components/ui";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { managersWord, recordsWord } from "@/lib/sales-register-view";
import { salesManagerLabelName } from "@/lib/sales-manager-labels";
import { salesReportContext, type SalesReportQuery } from "@/lib/sales-register-navigation";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { readSalesManagerLabels } from "@/lib/v3/sales-register-source";
import { MANAGER_ROW_GRID, SalesManagerLabelForm } from "./SalesManagerLabelForm";

/**
 * «Менеджеры в отчёте» (Э8.6, миграция 253): экран Admin для таблицы
 * владельца. Строка — ключ написания (регистр, пробелы, точки в конце) с
 * исходными написаниями записей и их числом; справа — «Сотрудник»
 * (необязательно) и «Имя в отчёте». Система ничего не угадывает: пока имени
 * нет, отчёт называет ключ самым частым написанием. Право — перенос данных
 * отчёта (`sales.register.import` на организацию). Сохранение — в каждой
 * строке тёмной нейтральной кнопкой: главного действия у страницы нет,
 * сплошного красного нет.
 */
export async function SalesManagerLabelsView({ actor, query }: { actor: ActivePlatformActor; query: SalesReportQuery }) {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const context = salesReportContext(query, {
    year: Number(now.find((p) => p.type === "year")!.value), month: Number(now.find((p) => p.type === "month")!.value),
  });
  const read = await readSalesManagerLabels(actor);
  const labels = read.status === "ready" ? read.data.labels : [];
  const mapped = labels.filter((label) => label.mapping?.displayName).length;

  return <main className="mx-auto w-full min-w-0 max-w-[1240px] px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <h1 className="t-page-title text-fg">Менеджеры в отчёте</h1>
      <Link href={context.reportHref} className={`${btnGhostCls} min-h-11`}>Вернуться к отчёту</Link>
    </header>
    <p className="mt-2 max-w-3xl t-body-compact text-fg-2">
      Написания, которые отличаются только регистром, пробелами и точкой в конце, — один менеджер. Имя в отчёте даёт владелец:
      сотрудник CRM или человек без аккаунта. Система ничего не угадывает; пока имени нет, отчёт показывает самое частое написание.
    </p>
    {read.status === "denied" ? <p role="status" className="mt-6 t-body-compact text-fg-2">Нет доступа: менеджеров сопоставляет тот, кто переносит данные отчёта.</p> : null}
    {read.status === "unavailable" ? <p role="alert" className="mt-6 t-body-compact text-fg-2">Не удалось загрузить написания менеджеров. Обновите страницу.</p> : null}
    {read.status === "ready" ? <>
      <p className="mt-4 t-meta text-fg-2" data-testid="sales-managers-count">
        {labels.length ? `${labels.length} ${managersWord(labels.length)} по написаниям, с именем от владельца — ${mapped}.`
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
  </main>;
}
