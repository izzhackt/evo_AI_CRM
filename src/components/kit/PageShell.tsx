import { PageHeader } from "@/components/kit/PageHeader";
import { cn } from "@/lib/utils";

/**
 * Рамка страницы «Нового вида»: те же поля и ширина, что у `PartShell` прежнего вида (1240 px, отступы 16/24),
 * шапка из набора (`PageHeader`) и вертикальный ритм между виджетами 16 px. Страница = эта рамка + виджеты.
 * `back` — возврат к списку над заголовком (как у `PartShell`): страница вложенного уровня не рисует свою рамку.
 */
export function PageShell({
  title,
  count,
  meta,
  help,
  helpLabel,
  actions,
  testId,
  width = "wide",
  back,
  children,
}: Readonly<{
  title: string;
  count?: number | null;
  meta?: React.ReactNode;
  help?: React.ReactNode;
  helpLabel?: string;
  actions?: React.ReactNode;
  /** `data-testid` корня страницы — для проверки выпуска. */
  testId?: string;
  width?: "wide" | "narrow";
  /** Возврат к списку над заголовком: ссылка или кнопка. */
  back?: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <main data-testid={testId} className={cn("mx-auto w-full px-4 py-8 sm:px-6", width === "narrow" ? "max-w-[860px]" : "max-w-[1240px]")}>
      {back}
      <PageHeader title={title} count={count} meta={meta} help={help} helpLabel={helpLabel} actions={actions} />
      <div className="mt-6 grid min-w-0 gap-4">{children}</div>
    </main>
  );
}
