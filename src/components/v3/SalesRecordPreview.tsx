import Link from "next/link";
import { btnCls, btnGhostCls } from "@/components/ui";
import type { SalesRegisterRow } from "@/lib/platform-sales-register-contract";

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const month = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });

function Amount({ minor, currency, raw }: { minor: number | null; currency: string | null; raw: string }) {
  return <>
    <span className="tabular-nums">{minor === null || !currency ? "Не уточнено" : `${number.format(minor / 100)} ${currency}`}</span>
    {minor === null && raw ? <span className="mt-1 block text-sm font-normal text-fg-2">В источнике: {raw}</span> : null}
  </>;
}

/** Карточка клиента записи продажи. */
export function salesRecordLeadHref(leadId: string): string {
  return `/v3/profile?id=${encodeURIComponent(leadId)}`;
}

/** Строка под именем записи: откуда сведения и где текущие. */
export function salesRecordContext(record: SalesRegisterRow): string {
  return `Сведения из записи отчёта.${record.leadId ? " Текущие данные клиента и условия — в его карточке." : ""}`;
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
      context: record ? salesRecordContext(record) : null,
      open: record?.sourceKind === "pipeline" && record.leadId ? { href: salesRecordLeadHref(record.leadId), label: "Открыть профиль студента" } : null,
    };
  }
  if (!record) return { title: "Запись продажи", context: null, open: null };
  return {
    title: record.applicantName || "Имя не указано",
    context: salesRecordContext(record),
    open: record.leadId ? { href: salesRecordLeadHref(record.leadId), label: "Открыть карточку клиента" } : null,
  };
}

/**
 * Запись продажи. `panelHeadingId` — Э4 (27.09.2026): запись открыта в правой
 * панели рядом со списком, возврата «К отчёту» нет (панель закрывается своей
 * кнопкой), «Исправить запись» — спокойная: сплошной красный отчёта —
 * «Добавить продажу». С Э7 имя (заголовок, фокус панели), строка «Сведения
 * из записи отчёта» и «Открыть карточку клиента» — шапка общей боковой панели
 * (`SidePanel` в `SalesRegisterView`, `salesRecordPanelHeader`); раздел
 * называет её заголовок `panelHeadingId`.
 */
export function SalesRecordPreview({ record, backHref, editHref, panelHeadingId }: {
  record: SalesRegisterRow | null; backHref: string; editHref: string | null; panelHeadingId?: string;
}) {
  if (!record) return <section className={panelHeadingId ? "space-y-4" : "mt-6 max-w-[860px] space-y-4"}>
    {panelHeadingId ? null : <h1 className="t-page-title text-fg">Запись продажи</h1>}
    <p role="alert" className="text-sm text-fg-2">Не удалось открыть запись. Возможно, доступ изменился или соединение прервалось.</p>
    <Link href={backHref} className={`${btnGhostCls} min-h-11`}>К отчёту</Link>
  </section>;

  const fields = [
    ["Телефон", record.phone],
    ["Продавец", record.managerLabel],
    ["Дата продажи", record.signingDate?.split("-").reverse().join(".") ?? "Дата не указана"],
    ["Месяц отчёта", month.format(new Date(`${record.reportMonth}T12:00:00Z`))],
    ...[
      ["Страна", record.country],
      ["Университет", record.university],
      ["Программа", record.program],
      ["Направление / услуга", record.direction],
      ["Набор", record.intake],
      ["Номер договора", record.contractNumber],
      ["Статус в записи", record.statusRaw],
    ].filter(([, value]) => value.trim()),
  ];

  const panel = Boolean(panelHeadingId);
  return <section className={panel ? "space-y-6" : "mt-6 max-w-[860px] space-y-6"} aria-labelledby={panelHeadingId ?? "sale-preview-title"}>
    {panel ? null : <Link href={backHref} className={`${btnGhostCls} min-h-11`}>← К отчёту</Link>}
    <header className="space-y-3">
      {panel ? null : <>
        <h1 id="sale-preview-title" className="t-page-title text-fg">Запись продажи</h1>
        <h2 className="t-record-title break-words text-fg">{record.applicantName || "Имя не указано"}</h2>
        <p className="max-w-2xl text-sm leading-6 text-fg-2">{salesRecordContext(record)}</p>
      </>}
      {record.archived ? <p className="text-sm text-fg-2">Запись в архиве и не входит в рабочие итоги.</p> : null}
      {record.needsReview ? <p className="text-sm font-medium text-fg-2">Требует проверки</p> : null}
      <div className="flex flex-wrap gap-3">
        {editHref ? <Link href={editHref} className={`${panel ? btnGhostCls : btnCls} min-h-11`}>{record.archived ? "Восстановление и исправление" : "Исправить запись"}</Link> : null}
        {record.leadId && !panel ? <Link href={salesRecordLeadHref(record.leadId)} className={`${btnGhostCls} min-h-11`}>Открыть карточку клиента</Link> : null}
      </div>
    </header>
    <dl className={`grid gap-x-8 gap-y-5 border-y border-border py-5 ${panel ? "" : "sm:grid-cols-2"}`}>
      <div className="min-w-0"><dt className="text-sm text-fg-2">Стоимость услуг</dt><dd className="t-section mt-1 break-words text-fg"><Amount minor={record.serviceCostMinor} currency={record.serviceCostCurrency} raw={record.serviceCostRaw} /></dd></div>
      <div className="min-w-0"><dt className="text-sm text-fg-2">Оплачено по записи</dt><dd className="t-section mt-1 break-words text-fg"><Amount minor={record.paidMinor} currency={record.paidCurrency} raw={record.paidRaw} /></dd></div>
    </dl>
    <p className="text-sm leading-6 text-fg-2">Оплата в записи — часть отчёта продажи, а не подтверждение поступления денег. Суммы в разных валютах не пересчитываются.</p>
    <dl className={`grid gap-x-8 gap-y-5 ${panel ? "" : "sm:grid-cols-2"}`}>{fields.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-sm text-fg-2">{label}</dt><dd className="mt-1 break-words text-sm text-fg">{value || "Не указано"}</dd>
    </div>)}</dl>
    {record.notes ? <section className="space-y-2 border-t border-border pt-5" aria-labelledby="sale-preview-notes">
      <h2 id="sale-preview-notes" className="t-section text-fg">Примечание</h2>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-2">{record.notes}</p>
    </section> : null}
    <p className="border-t border-border pt-5 text-sm leading-6 text-fg-2">
      {record.sourceKind === "import" ? "Импортированная запись." : record.sourceKind === "pipeline" ? "Продажа оформлена из карточки клиента." : "Запись добавлена вручную."}
      {record.sourceSheet ? ` Источник: ${record.sourceSheet}, строка ${record.sourceRow}. Исходный файл не изменён.` : ""}
    </p>
  </section>;
}
