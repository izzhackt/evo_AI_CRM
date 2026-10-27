import Link from "next/link";
import { btnGhostCls } from "@/components/ui";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { salesReportContext, type SalesReportQuery } from "@/lib/sales-register-navigation";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { readSalesManagerLabels } from "@/lib/v3/sales-register-source";
import { SalesManagerLabelsBody } from "./sales-report/SalesManagerLabelsBody";

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

  return <main className="mx-auto w-full min-w-0 max-w-[1240px] px-4 py-8 sm:px-6 min-[1600px]:max-w-[1480px]">
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <h1 className="t-page-title text-fg">Менеджеры в отчёте</h1>
      <Link href={context.reportHref} className={`${btnGhostCls} min-h-11`}>Вернуться к отчёту</Link>
    </header>
    <p className="mt-2 max-w-3xl t-body-compact text-fg-2">
      Написания с разным регистром, пробелами и точкой в конце — один менеджер. Пока имени нет, отчёт показывает самое частое написание.
    </p>
    <SalesManagerLabelsBody read={read} />
  </main>;
}
