import { randomUUID } from "node:crypto";
import Link from "next/link";

import { PartShell } from "@/components/v3/PartShell";
import { Pill } from "@/components/v3/Pill";
import { ApplicationDecision, StudentApplicationAnswers, submittedDate } from "@/components/v3/admissions/StudentApplications";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { PortalConsultations } from "@/components/v3/requests/PortalConsultations";
import {
  filterRequestsQueue,
  loadPortalConsultationQueue,
  loadRequestsQueue,
  parseRequestSourceFilter,
  REQUEST_SOURCE_FILTERS,
  type PortalConsultationQueue,
  type RequestSourceFilter,
} from "@/lib/v3/requests-source";
import { source as sourceWord } from "@/lib/v3/wording";

export const dynamic = "force-dynamic";
export const metadata = { title: "EVO · Заявки" };

const FILTER_LABELS: Record<RequestSourceFilter, string> = {
  all: "Все",
  website: "Сайт",
  platform_application: "Платформа",
  whatsapp: "WhatsApp",
  portal_consultation: "Кабинет: консультации",
};

function FilterNav({ filter }: { filter: RequestSourceFilter }) {
  return (
    <nav aria-label="Источник заявки" className="flex flex-wrap gap-2">
      {REQUEST_SOURCE_FILTERS.map((value) => (
        <Link
          key={value}
          href={value === "all" ? "/v3/requests" : `/v3/requests?source=${value}`}
          aria-current={filter === value ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-nav border px-3 text-sm font-medium ${
            filter === value ? "border-accent bg-accent-weak text-accent" : "border-control-edge text-fg-2 hover:bg-surface-2"
          }`}
        >
          {FILTER_LABELS[value]}
        </Link>
      ))}
    </nav>
  );
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireV3PageActor("/v3/requests");
  const params = await searchParams;
  const filter = parseRequestSourceFilter(typeof params.source === "string" ? params.source : undefined);
  const readOnly = isStaffPreview(actor);

  // «Кабинет: консультации» (PORT-5b) — отдельный источник за своей пилюлей:
  // очередь лидов и анкет при этом фильтре не читается вовсе.
  if (filter === "portal_consultation") {
    const rawOffset = typeof params.offset === "string" ? Number(params.offset) : 0;
    const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    let consultations: PortalConsultationQueue | null = null;
    try {
      consultations = await loadPortalConsultationQueue(offset);
    } catch {
      consultations = null;
    }
    return (
      <PartShell title="Заявки" count={consultations?.items.length}>
        <div className="space-y-6">
          <FilterNav filter={filter} />
          {consultations === null ? (
            <p role="alert" className="text-sm text-fg-2">
              Не удалось загрузить запросы консультаций. Проверьте доступ и повторите попытку.{" "}
              <a href="/v3/requests?source=portal_consultation" className="font-semibold text-accent hover:underline">Повторить</a>
            </p>
          ) : (
            <PortalConsultations queue={consultations} readOnly={readOnly} />
          )}
        </div>
      </PartShell>
    );
  }

  const queue = await loadRequestsQueue(actor);
  if (queue.applicationsUnavailable && queue.leadsUnavailable) {
    return (
      <PartShell title="Заявки">
        <div role="alert" className="space-y-2 text-sm text-fg-2">
          <p>Не удалось загрузить заявки. Проверьте доступ и повторите попытку.</p>
          <a href="/v3/requests" className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline">Повторить</a>
        </div>
      </PartShell>
    );
  }
  const rows = filterRequestsQueue(queue, filter);

  return (
    <PartShell title="Заявки" count={rows.length}>
      <div className="space-y-6">
        <FilterNav filter={filter} />
        <p className="text-sm text-fg-2">На рассмотрении: {queue.pendingApplicationCount}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-fg-2">Заявок пока нет.</p>
        ) : (
          <ul className="space-y-4">
            {rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} className="min-w-0 rounded-[10px] border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {row.leadId ? (
                    <Link href={`/v3/profile?id=${encodeURIComponent(row.leadId)}`} className="min-h-11 text-sm font-semibold text-accent hover:underline">
                      {row.personName}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-fg">{row.personName}</span>
                  )}
                  <span className="flex items-center gap-2 text-xs text-fg-2">
                    <Pill tone="neutral">{sourceWord(row.source) ?? row.source}</Pill>
                    {submittedDate(row.occurredAt)}
                  </span>
                </div>
                {row.kind === "lead" ? (
                  <p className="mt-2 text-sm text-fg-2">{[row.email, row.phone].filter(Boolean).join(" · ") || "Контакты не указаны"}</p>
                ) : row.leadId ? (
                  <p className="mt-2 text-sm text-fg-2">{row.email}</p>
                ) : (
                  <div className="mt-3">
                    <StudentApplicationAnswers application={row.application} />
                  </div>
                )}
                {row.kind === "application" ? (
                  readOnly ? (
                    <p className="mt-3 text-sm text-fg-2">В режиме просмотра решения недоступны.</p>
                  ) : (
                    <div className="mt-3">
                      <ApplicationDecision application={row.application} requestId={randomUUID()} />
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {queue.applicationsUnavailable ? (
          <p role="alert" className="text-sm text-fg-2">Анкеты платформы недоступны вашей роли — показаны только обращения с сайта и WhatsApp.</p>
        ) : null}
        {queue.leadsUnavailable ? (
          <p role="alert" className="text-sm text-fg-2">Обращения с сайта и WhatsApp сейчас недоступны — показаны только анкеты платформы. <a href="/v3/requests" className="font-semibold text-accent hover:underline">Повторить</a></p>
        ) : null}
        {queue.truncated ? (
          <p className="text-sm text-fg-2">Показаны недавние обращения с сайта и WhatsApp; более старые не подгружены.</p>
        ) : null}
      </div>
    </PartShell>
  );
}
