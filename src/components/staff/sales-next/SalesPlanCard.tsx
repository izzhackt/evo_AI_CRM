import Link from "next/link";

import { DetailSheet, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { sheetEscape } from "@/components/staff/panel/sheet-escape";

/** Действия плана: «Изменить план» открывает панель с прежней формой (`SalesTargetForm` приходит готовой с сервера), «Перенос данных» — прежняя ссылка. */
export function SalesPlanActions({ form, importHref }: Readonly<{ form: React.ReactNode | null; importHref: string | null }>) {
  return (
    <>
      {form ? (
        <DetailSheet title="План месяца" onEscapeKeyDown={sheetEscape} trigger={<Button variant="outline">Изменить план</Button>}>{form}</DetailSheet>
      ) : null}
      {importHref ? <Button variant="ghost" asChild><Link href={importHref}>Перенос данных</Link></Button> : null}
    </>
  );
}

/**
 * «План месяца» и «Перенос данных» отдельной карточкой — когда сводки «Продажи» над таблицей нет (её чтение не удалось): иначе план и
 * его действия стоят в сводке (`SalesHeadlineTiles`). «Перенос данных» — тому, у кого нет доступа к настройкам. Сбой проверки доступа
 * остаётся на виду. План словами — только по прочитанному плану месяца (`read`): не прочитан — ничего о нём не сказано («нет чтения —
 * нет числа»).
 */
export function SalesPlanCard({ target, read, form, importHref, unavailable }: Readonly<{
  target: number | null;
  /** План месяца прочитан: месяц выбран, это не архив и чтение удалось. */
  read: boolean;
  form: React.ReactNode | null;
  importHref: string | null;
  unavailable: boolean;
}>) {
  const sentence = !read ? null : target === null ? "План на месяц не задан" : `План на месяц: ${target.toLocaleString("ru-RU")}`;
  const body = [
    unavailable ? <p key="alert" role="alert" className="t-body-compact text-fg-2">Не удалось проверить доступ к плану и переносу данных.</p> : null,
    sentence ? <p key="sentence" className="t-body-compact text-fg-2">{sentence}</p> : null,
  ].filter((part) => part !== null);
  return (
    <WidgetCard title="План месяца" actions={<SalesPlanActions form={form} importHref={importHref} />}>
      {body.length > 0 ? body : undefined}
    </WidgetCard>
  );
}
