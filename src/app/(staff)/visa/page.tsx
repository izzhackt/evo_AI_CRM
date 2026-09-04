import type { Metadata } from "next";
import Link from "next/link";

import { Badge, btnGhostCls } from "@/components/ui";
import { getT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { listPlatformAdmissionsVisaQueue } from "@/lib/platform-admissions-workspace";
import { requirePlatformCapability } from "@/lib/platform-guards";
import { buildRouteMetadata } from "@/lib/route-metadata";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
}>;

const COPY = {
  ru: {
    title: "Визовый контроль",
    description:
      "Одна актуальная визовая запись на кейс из Supabase. Изменения выполняются в Student 360.",
    empty: "Визовых кейсов пока нет.",
    open: "Открыть Student 360",
    evidence: "Последнее подтверждение",
    createdBy: "Создал(а)",
    more: "Показаны первые 50 обновлённых визовых кейсов.",
    invalid:
      "Параметры очереди отклонены. Данные не читались.",
    reset: "К визовому контролю",
  },
  ky: {
    title: "Виза көзөмөлү",
    description:
      "Ар бир кейс үчүн Supabase ичиндеги бир актуалдуу виза жазуусу. Өзгөртүүлөр Student 360 ичинде жасалат.",
    empty: "Азырынча виза кейстери жок.",
    open: "Student 360 ачуу",
    evidence: "Акыркы ырастоо",
    createdBy: "Түзгөн",
    more: "Акыркы жаңыртылган 50 виза кейси көрсөтүлдү.",
    invalid:
      "Кезек параметрлери четке кагылды. Маалымат окулган жок.",
    reset: "Виза көзөмөлүнө",
  },
  en: {
    title: "Visa control",
    description:
      "One current Supabase visa record per case. Changes are made in Student 360.",
    empty: "No visa cases yet.",
    open: "Open Student 360",
    evidence: "Latest evidence",
    createdBy: "Created by",
    more: "Showing the first 50 recently updated visa cases.",
    invalid:
      "Queue parameters were rejected. No data was read.",
    reset: "Back to visa control",
  },
} as const;

const STATUS_LABELS: Record<string, Record<Locale, string>> = {
  not_required: { ru: "Не требуется", ky: "Талап кылынбайт", en: "Not required" },
  not_started: { ru: "Не начата", ky: "Баштала элек", en: "Not started" },
  docs: { ru: "Документы", ky: "Документтер", en: "Documents" },
  appointment: { ru: "Запись", ky: "Жазылуу", en: "Appointment" },
  submitted: { ru: "Подана", ky: "Тапшырылды", en: "Submitted" },
  approved: { ru: "Одобрена", ky: "Жактырылды", en: "Approved" },
  rejected: { ru: "Отказ", ky: "Баш тартылды", en: "Rejected" },
  closed: { ru: "Закрыта", ky: "Жабык", en: "Closed" },
};

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: COPY.ru.title,
    ky: COPY.ky.title,
    en: COPY.en.title,
  });
}

function hasRejectedQuery(params: SearchParams): boolean {
  try {
    return params.before_at !== undefined || params.before_id !== undefined;
  } catch {
    return true;
  }
}

function QueueHeader({
  copy,
  withDescription = false,
}: Readonly<{
  copy: (typeof COPY)[keyof typeof COPY];
  withDescription?: boolean;
}>) {
  return (
    <header className="border-b border-border pb-5">
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg">
        {copy.title}
      </h1>
      {withDescription ? (
        <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
      ) : null}
    </header>
  );
}

export default async function VisaPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const [{ locale }, actor, params] = await Promise.all([
    getT(),
    requirePlatformCapability("admissions.read", "/visa"),
    searchParams,
  ]);
  const copy = COPY[locale];

  if (hasRejectedQuery(params)) {
    return (
      <div className="space-y-5" data-testid="platform-visa-queue">
        <QueueHeader copy={copy} />
        <p data-testid="platform-queue-filter-rejected" role="alert" className="border-y border-warn/30 bg-warn-weak py-6 text-sm text-warn">{copy.invalid}</p>
        <Link href="/visa" className={btnGhostCls}>{copy.reset}</Link>
      </div>
    );
  }

  const queue = await listPlatformAdmissionsVisaQueue(actor, { pageSize: 50 });

  return (
    <div className="space-y-5" data-testid="platform-visa-queue">
      <QueueHeader copy={copy} withDescription />
      {queue.rows.length === 0 ? (
        <p className="border-y border-border py-8 text-sm text-fg-3">{copy.empty}</p>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {queue.rows.map((visa) => (
            <li key={visa.visaCaseId} className="py-5" data-visa-case-id={visa.visaCaseId}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{visa.studentDisplayName}</p>
                  <p className="mt-2 text-xs text-fg-3">{copy.createdBy}: {visa.createdByDisplayName}</p>
                  {visa.latestEvidenceReference ? (
                    <p className="mt-1 break-all text-xs text-fg-3">{copy.evidence}: {visa.latestEvidenceReference}</p>
                  ) : null}
                </div>
                <Badge value={visa.status} label={STATUS_LABELS[visa.status]?.[locale] ?? visa.status} />
              </div>
              <Link
                href={`/v3/profile?case=${visa.studentCaseId}&tab=overview#visa`}
                className="inline-flex min-h-11 shrink-0 items-start pt-0.5 text-xs font-semibold text-accent hover:underline"
              >
                {copy.open}
              </Link>
            </li>
          ))}
        </ol>
      )}
      {queue.hasNext ? (
        <p className="text-xs text-fg-3" role="status">{copy.more}</p>
      ) : null}
    </div>
  );
}
