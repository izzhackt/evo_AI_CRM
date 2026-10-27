import Link from "next/link";

import { DetailSheet, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";

/**
 * «План месяца» и «Перенос данных»: «Изменить план» открывает панель с прежней формой (`SalesTargetForm` приходит готовой с сервера),
 * «Перенос данных» — прежняя ссылка тому, у кого нет доступа к настройкам. Сбой проверки доступа остаётся на виду. План словами — только
 * по прочитанному плану месяца (`read`): не прочитан — ничего о нём не сказано («нет чтения — нет числа»); число, которое уже стоит плиткой
 * «План» (`inTile`), второй раз не повторяется.
 */
export function SalesPlanCard({ target, read, inTile, form, importHref, unavailable }: Readonly<{
  target: number | null;
  /** План месяца прочитан: месяц выбран, это не архив и чтение удалось. */
  read: boolean;
  /** Число плана уже показано плиткой «План» над таблицей. */
  inTile: boolean;
  form: React.ReactNode | null;
  importHref: string | null;
  unavailable: boolean;
}>) {
  const sentence = !read ? null : target === null ? "План на месяц не задан" : inTile ? null : `План на месяц: ${target.toLocaleString("ru-RU")}`;
  const body = [
    unavailable ? <p key="alert" role="alert" className="t-body-compact text-fg-2">Не удалось проверить доступ к плану и переносу данных.</p> : null,
    sentence ? <p key="sentence" className="t-body-compact text-fg-2">{sentence}</p> : null,
  ].filter((part) => part !== null);
  return (
    <WidgetCard
      title="План месяца"
      actions={
        <>
          {form ? (
            <DetailSheet title="План месяца" onEscapeKeyDown={sheetEscape} trigger={<Button variant="outline">Изменить план</Button>}>{form}</DetailSheet>
          ) : null}
          {importHref ? <Button variant="ghost" asChild><Link href={importHref}>Перенос данных</Link></Button> : null}
        </>
      }
    >
      {body.length > 0 ? body : undefined}
    </WidgetCard>
  );
}
