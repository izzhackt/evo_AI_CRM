import { Card } from "@/components/ui/card";

import { SalesPlanActions } from "./SalesPlanCard";
import type { SalesHeadlineData } from "./sales-next-types";

const NOTE_LINK = "inline-flex min-h-11 items-center text-fg-2 underline underline-offset-4 hover:text-fg";

/** План месяца в сводке: прочитан ли он, форма «Изменить план», «Перенос данных» и сбой проверки доступа. */
export type SalesHeadlinePlan = Readonly<{ target: number | null; read: boolean; form: React.ReactNode | null; importHref: string | null; unavailable: boolean }>;

function Cell({ label, value, hint }: Readonly<{ label: string; value: React.ReactNode; hint?: string | null }>) {
  return (
    <div className="grid min-w-0 flex-1 content-start gap-1 border-s border-border px-4 first:border-s-0 @min-[52rem]:w-56 @min-[52rem]:flex-none" data-sales-cell={label}>
      <p className="t-caption text-fg-3">{label}</p>
      {value}
      {hint ? <p className="t-meta text-fg-3">{hint}</p> : null}
    </div>
  );
}

/**
 * Сводка периода одной карточкой (15.11.2026: владелец счёл вкладку перегруженной): «Продажи» — число по дате продажи
 * (без архива), рядом «План» с остатком и действия плана («Изменить план», «Перенос данных»), которые раньше стояли отдельной карточкой
 * внизу страницы. План словами — только по прочитанному плану: не прочитан — о нём ничего не сказано. Что в число не входит и где
 * это смотреть (записи без даты, с датой в другом месяце, из другого месяца отчёта) остаётся на виду ссылками на записи среза: число
 * и таблица считаются по-разному, и это сказано. Чтение не удалось — так и сказано, с «Повторить».
 */
export function SalesHeadlineTiles({ data, plan = null }: Readonly<{ data: SalesHeadlineData; plan?: SalesHeadlinePlan | null }>) {
  if (data.kind === "error") {
    return (
      <p role="alert" className="t-body-compact text-fg-2" data-testid="v3-sales-headline">
        {data.text}{" "}
        <a href={data.retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a>
      </p>
    );
  }
  const planValue = data.target !== null
    ? <p className="t-figure text-fg">{data.target.toLocaleString("ru-RU")}</p>
    : plan?.read && plan.target === null ? <p className="t-body-compact text-fg-2">не задан</p> : null;
  return (
    <div className="grid gap-2" data-testid="v3-sales-headline" data-sales={data.sales}>
      {/* Раскладка — по ширине самой карточки, а не окна (боковое меню забирает до 260 px). От 52rem числа (2 × 14rem) и обе кнопки плана
          (до ~20rem) стоят в одну строку; уже — числа во всю ширину, кнопки строкой ниже: кнопки никогда не ложатся на число плана. */}
      <Card size="sm" className="@container flex-row flex-wrap items-center gap-0 data-[size=sm]:gap-0" data-testid="v3-sales-summary">
        <div className="flex min-w-0 basis-full @min-[52rem]:basis-auto">
          <Cell label="Продажи" value={<p className="t-figure text-fg">{data.sales.toLocaleString("ru-RU")}</p>} hint={data.basis} />
          {planValue ? <Cell label="План" value={planValue} hint={data.target !== null ? data.left : null} /> : null}
        </div>
        {plan && (plan.form || plan.importHref) ? (
          <div className="mt-3 flex basis-full flex-wrap items-center gap-2 border-t border-border px-4 pt-3 @min-[52rem]:ms-auto @min-[52rem]:mt-0 @min-[52rem]:basis-auto @min-[52rem]:border-t-0 @min-[52rem]:pt-0">
            <SalesPlanActions form={plan.form} importHref={plan.importHref} />
          </div>
        ) : null}
      </Card>
      {plan?.unavailable ? <p role="alert" className="t-body-compact text-fg-2">Не удалось проверить доступ к плану и переносу данных.</p> : null}
      {data.notes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 t-meta text-fg-3" data-testid="v3-sales-headline-notes">
          {data.notes.map((note) => (
            <p key={note.lead} className="flex flex-wrap items-center gap-x-3">
              {note.lead}
              {note.links.map((link) => link.href
                ? <a key={link.text} href={link.href} className={NOTE_LINK}>{link.text}</a>
                : <span key={link.text}>{link.text}</span>)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
