import Link from "next/link";

import { DetailSheet, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";

/**
 * «План месяца» и «Перенос данных»: план показывает число, «Изменить план» открывает панель с прежней формой (`SalesTargetForm` приходит
 * готовой с сервера), «Перенос данных» — прежняя ссылка тому, у кого нет доступа к настройкам. Сбой проверки доступа остаётся на виду.
 */
export function SalesPlanCard({ target, form, importHref, unavailable }: Readonly<{
  target: number | null;
  form: React.ReactNode | null;
  importHref: string | null;
  unavailable: boolean;
}>) {
  return (
    <WidgetCard
      title="План месяца"
      actions={
        <>
          {form ? (
            <DetailSheet title="План месяца" trigger={<Button variant="outline">Изменить план</Button>}>{form}</DetailSheet>
          ) : null}
          {importHref ? <Button variant="ghost" asChild><Link href={importHref}>Перенос данных</Link></Button> : null}
        </>
      }
    >
      {unavailable ? <p role="alert" className="t-body-compact text-fg-2">Не удалось проверить доступ к плану и переносу данных.</p> : null}
      <p className="t-body-compact text-fg-2">{target !== null ? `План на месяц: ${target.toLocaleString("ru-RU")}` : "План на месяц не задан"}</p>
    </WidgetCard>
  );
}
