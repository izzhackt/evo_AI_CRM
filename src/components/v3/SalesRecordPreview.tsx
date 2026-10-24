import Link from "next/link";
import type { ReactNode } from "react";
import { btnGhostCls } from "@/components/ui";
import type { SalesRegisterRow } from "@/lib/platform-sales-register-contract";
import {
  SALES_NO_REMAINDER_TEXT, salesDay, salesReportMonth, salesRowContractPaid, salesRowNoRemainder, salesRowRemainder, salesRowReview,
  salesWithdrawalTone,
} from "@/lib/sales-register-view";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { salesWithdrawalWord } from "@/lib/v3/wording";
import { StatusChip } from "./blocks/StatusChip";

const withdrawnOn = new Intl.DateTimeFormat("ru-RU", { timeZone: ORG_TIMEZONE, day: "2-digit", month: "2-digit" });

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const money = (minor: number, currency: string) => `${number.format(minor / 100)} ${currency}`;
const tidy = (value: string) => value.trim().replace(/\s+/gu, " ");

/** Карточка клиента записи продажи. */
export function salesRecordLeadHref(leadId: string): string {
  return `/v3/profile?id=${encodeURIComponent(leadId)}`;
}

/** Строка под именем записи: откуда сведения. */
export function salesRecordContext(): string {
  return "Сведения из записи отчёта.";
}

/**
 * Шапка боковой панели «Отчёта продаж» (Э7): заголовок, строка контекста и
 * «Открыть …» — те же тексты, что рисовали просмотр записи и форма.
 * Строка контекста одна у просмотра и формы (`salesRecordContext`): у каждой
 * панели шапка — заголовок, контекст, «Открыть …». Форма показывает ссылку на
 * карточку только у продажи, оформленной из карточки лида
 * (`sourceKind: "pipeline"`), — как и раньше.
 */
export function salesRecordPanelHeader(record: SalesRegisterRow | null, editing: boolean): Readonly<{
  title: string; context: string | null; open: Readonly<{ href: string; label: string }> | null;
}> {
  if (editing) {
    return {
      title: record?.applicantName || "Запись продажи",
      context: record ? salesRecordContext() : null,
      open: record?.sourceKind === "pipeline" && record.leadId ? { href: salesRecordLeadHref(record.leadId), label: "Открыть профиль студента" } : null,
    };
  }
  if (!record) return { title: "Запись продажи", context: null, open: null };
  return {
    title: record.applicantName || "Имя не указано",
    context: salesRecordContext(),
    open: record.leadId ? { href: salesRecordLeadHref(record.leadId), label: "Открыть карточку клиента" } : null,
  };
}

function Amount({ minor, currency, raw }: { minor: number | null; currency: string | null; raw: string }) {
  return <>
    <span className="tabular-nums">{minor === null || !currency ? "Не уточнено" : money(minor, currency)}</span>
    {minor === null && raw.trim() ? <span className="block t-meta text-fg-2">В источнике: {raw}</span> : null}
  </>;
}

/**
 * Запись продажи в правой панели (Э8.6, 28.09.2026): строка открывает сначала
 * просмотр. Наверху — почему запись помечена, словами из причин сервера
 * (миграция 253), и спокойная «Исправить запись» (сплошной красный отчёта —
 * «Добавить продажу»); затем суммы с «Оплачено в валюте договора» у оплаты в
 * другой валюте и «Остатком» — тем же, что в строке и сводке; затем сведения
 * записи. Имя, строка «Сведения из записи отчёта» и «Открыть карточку
 * клиента» — шапка общей боковой панели (`SidePanel`, `salesRecordPanelHeader`);
 * раздел называет её заголовок `panelHeadingId`.
 */
export function SalesRecordPreview({ record, backHref, editHref, panelHeadingId, managerName, year, leadRow, withdrawalAction }: {
  record: SalesRegisterRow | null; backHref: string; editHref: string | null; panelHeadingId: string;
  /** Имя менеджера по ключу написания (таблица владельца или написание). */
  managerName: string | null;
  /** Год отчёта: дата этого года — «ДД.ММ», другого — «ДД.ММ.ГГ», как в строке. */
  year: number;
  /**
   * «Лид» (Э8.7): связанный лид ссылкой, «связано, но недоступно» или
   * спокойная «Связать с лидом» — только для импортированной записи, и
   * только когда есть что показать или что сделать (`SalesRecordLeadFact`).
   * null — строки нет вовсе.
   */
  leadRow?: ReactNode | null;
  /** «Убрать» / «Вернуть» (307) — рядом с «Исправить запись»; null — права или записи нет (архив). */
  withdrawalAction?: ReactNode | null;
}) {
  if (!record) return <section className="space-y-4" aria-labelledby={panelHeadingId}>
    <p role="alert" className="t-body-compact text-fg-2">Не удалось открыть запись. Возможно, доступ изменился или соединение прервалось.</p>
    <Link href={backHref} className={`${btnGhostCls} min-h-11`}>К отчёту</Link>
  </section>;

  const review = salesRowReview(record);
  const refusalWord = record.withdrawal ? salesWithdrawalWord(record.withdrawal.kind) : null;
  const refusalTone = record.withdrawal ? salesWithdrawalTone(record.withdrawal.kind) : null;
  const crossCurrency = record.serviceCostCurrency !== null && record.paidCurrency !== null && record.paidCurrency !== record.serviceCostCurrency;
  const contractMinor = salesRowContractPaid(record);
  const remainderMinor = salesRowRemainder(record);
  const noRemainder = salesRowNoRemainder(record);
  const raw = tidy(record.managerLabel);
  const manager = managerName ?? raw;
  const month = salesReportMonth(record.reportMonth);
  const moneyRow = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2";
  const facts = [
    { label: "Телефон", value: record.phone },
    { label: "Страна", value: record.country },
    { label: "Университет", value: record.university },
    { label: "Программа", value: record.program },
    { label: "Направление / услуга", value: record.direction },
    { label: "Набор", value: record.intake },
    { label: "Номер договора", value: record.contractNumber },
    { label: "Статус в записи", value: record.statusRaw },
  ].filter(({ value }) => value.trim() !== "");
  const details: { label: string; value: ReactNode }[] = [
    { label: "Менеджер", value: <>{manager || "Не указан"}
      {raw && raw !== manager ? <span className="block t-meta text-fg-2">в записи: «{raw}»</span> : null}</> },
    { label: "Дата продажи", value: record.signingDate
      ? <time dateTime={record.signingDate} className="font-mono tabular-nums">{salesDay(record.signingDate, year)}</time>
      : <span className="text-fg-2">не указана</span> },
    { label: "Месяц отчёта", value: <time dateTime={month.dateTime}>{month.words}</time> },
    ...(leadRow != null ? [{ label: "Лид", value: leadRow }] : []),
    ...facts,
  ];

  return <section className="space-y-5" aria-labelledby={panelHeadingId} data-testid="sales-record-preview">
    <div className="space-y-3">
      {record.archived ? <p className="t-body-compact text-fg-2">Запись в архиве и не входит в рабочие итоги.</p> : null}
      {review.state === "review" ? <p className="t-body-compact text-fg" data-record-review="">
        <span className="font-semibold">Нужно уточнить:</span> {review.reasons.join(", ")}
      </p> : null}
      {record.withdrawal && refusalWord && refusalTone ? <div className="space-y-1" data-testid="sales-record-withdrawal" data-withdrawal-tone={refusalTone}>
        <StatusChip label={refusalWord} tone={refusalTone} />
        <p className="t-body-compact text-fg-2">
          Убрано из продаж {withdrawnOn.format(new Date(record.withdrawal.at))}{record.withdrawal.by ? ` · ${record.withdrawal.by}` : ""}.
        </p>
        {record.withdrawal.note ? <p className="break-words t-body-compact text-fg">{record.withdrawal.note}</p> : null}
      </div> : null}
      {editHref || withdrawalAction ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {editHref ? <Link href={editHref} className={`${btnGhostCls} min-h-11`} data-testid="sales-record-edit">
          {record.archived ? "Восстановление и исправление" : "Исправить запись"}
        </Link> : null}
        {withdrawalAction}
      </div> : null}
    </div>
    <dl className="divide-y divide-border border-y border-border t-body-compact" data-testid="sales-record-money">
      <div className={moneyRow}><dt className="text-fg-2">Стоимость</dt>
        <dd className="text-right font-medium text-fg"><Amount minor={record.serviceCostMinor} currency={record.serviceCostCurrency} raw={record.serviceCostRaw} /></dd></div>
      <div className={moneyRow}><dt className="text-fg-2">Оплачено</dt>
        <dd className="text-right font-medium text-fg"><Amount minor={record.paidMinor} currency={record.paidCurrency} raw={record.paidRaw} /></dd></div>
      {crossCurrency ? <div className={moneyRow} data-record-contract=""><dt className="text-fg-2">Оплачено в валюте договора</dt>
        <dd className="text-right font-medium text-fg">
          {contractMinor !== null ? <span className="tabular-nums">{money(contractMinor, record.serviceCostCurrency!)}</span> : <span className="text-fg-2">не указано</span>}
        </dd></div> : null}
      <div className={moneyRow} data-record-remainder=""><dt className="text-fg-2">Остаток</dt>
        <dd className="text-right font-semibold text-fg">
          {remainderMinor !== null ? <span className="tabular-nums">{money(remainderMinor, record.serviceCostCurrency!)}</span> : "—"}
        </dd>
        {/* Причина — своей строкой строки списка: <p> внутри <div> списка определений читалка не признаёт (axe `definition-list`). */}
        {remainderMinor === null && noRemainder ? <dd className="col-span-2 text-left font-normal t-meta text-fg-2">Остатка нет: {SALES_NO_REMAINDER_TEXT[noRemainder]}.</dd> : null}
      </div>
    </dl>
    <p className="t-meta text-fg-2">Суммы — из отчёта, не подтверждение поступления денег.</p>
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2 t-body-compact">
      {details.map(({ label, value }) => <div key={label} className="contents">
        <dt className="text-fg-2">{label}</dt><dd className="min-w-0 break-words text-fg">{value}</dd>
      </div>)}
    </dl>
    {record.notes ? <section className="space-y-1 border-t border-border pt-4" aria-labelledby="sale-preview-notes">
      <h3 id="sale-preview-notes" className="t-item text-fg">Примечание</h3>
      <p className="whitespace-pre-wrap break-words t-body-compact text-fg-2">{record.notes}</p>
    </section> : null}
    <p className="border-t border-border pt-4 t-meta text-fg-2">
      {record.sourceKind === "import" ? "Перенесённая запись." : record.sourceKind === "pipeline" ? "Продажа оформлена из карточки клиента." : "Запись добавлена вручную."}
      {record.sourceSheet ? ` Источник: ${record.sourceSheet}, строка ${record.sourceRow}.` : ""}
    </p>
  </section>;
}
