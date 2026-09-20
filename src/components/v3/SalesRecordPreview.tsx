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

export function SalesRecordPreview({ record, backHref, editHref }: {
  record: SalesRegisterRow | null; backHref: string; editHref: string | null;
}) {
  if (!record) return <section className="mt-6 max-w-[860px] space-y-4">
    <h1 className="text-2xl font-semibold text-fg">Запись продажи</h1>
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

  return <section className="mt-6 max-w-[860px] space-y-6" aria-labelledby="sale-preview-title">
    <Link href={backHref} className={`${btnGhostCls} min-h-11`}>← К отчёту</Link>
    <header className="space-y-3">
      <h1 id="sale-preview-title" className="text-2xl font-semibold tracking-tight text-fg">Запись продажи</h1>
      <h2 className="break-words text-xl font-semibold text-fg">{record.applicantName || "Имя не указано"}</h2>
      <p className="max-w-2xl text-sm leading-6 text-fg-2">Сведения из записи отчёта.{record.leadId ? " Текущие данные клиента и условия — в его карточке." : ""}</p>
      {record.archived ? <p className="text-sm text-fg-2">Запись в архиве и не входит в рабочие итоги.</p> : null}
      {record.needsReview ? <p className="text-sm font-medium text-fg-2">Требует проверки</p> : null}
      <div className="flex flex-wrap gap-3">
        {editHref ? <Link href={editHref} className={`${btnCls} min-h-11`}>{record.archived ? "Восстановление и исправление" : "Исправить запись"}</Link> : null}
        {record.leadId ? <Link href={`/v3/profile?id=${encodeURIComponent(record.leadId)}`} className={`${btnGhostCls} min-h-11`}>Открыть карточку клиента</Link> : null}
      </div>
    </header>
    <dl className="grid gap-x-8 gap-y-5 border-y border-border py-5 sm:grid-cols-2">
      <div className="min-w-0"><dt className="text-sm text-fg-2">Стоимость услуг</dt><dd className="mt-1 break-words text-lg font-semibold text-fg"><Amount minor={record.serviceCostMinor} currency={record.serviceCostCurrency} raw={record.serviceCostRaw} /></dd></div>
      <div className="min-w-0"><dt className="text-sm text-fg-2">Оплачено по записи</dt><dd className="mt-1 break-words text-lg font-semibold text-fg"><Amount minor={record.paidMinor} currency={record.paidCurrency} raw={record.paidRaw} /></dd></div>
    </dl>
    <p className="text-sm leading-6 text-fg-2">Оплата в записи — часть отчёта продажи, а не подтверждение поступления денег. Суммы в разных валютах не пересчитываются.</p>
    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-sm text-fg-2">{label}</dt><dd className="mt-1 break-words text-sm text-fg">{value || "Не указано"}</dd>
    </div>)}</dl>
    {record.notes ? <section className="space-y-2 border-t border-border pt-5" aria-labelledby="sale-preview-notes">
      <h2 id="sale-preview-notes" className="text-base font-semibold text-fg">Примечание</h2>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-2">{record.notes}</p>
    </section> : null}
    <p className="border-t border-border pt-5 text-sm leading-6 text-fg-2">
      {record.sourceKind === "import" ? "Импортированная запись." : record.sourceKind === "pipeline" ? "Продажа оформлена из карточки клиента." : "Запись добавлена вручную."}
      {record.sourceSheet ? ` Источник: ${record.sourceSheet}, строка ${record.sourceRow}. Исходный файл не изменён.` : ""}
    </p>
  </section>;
}
