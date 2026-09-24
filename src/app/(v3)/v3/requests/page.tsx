import { randomUUID } from "node:crypto";
import Link from "next/link";

import { PartShell } from "@/components/v3/PartShell";
import { Pill } from "@/components/v3/Pill";
import { ApplicationDecision, StudentApplicationAnswers } from "@/components/v3/admissions/StudentApplications";
import { PortalConsultationDetails } from "@/components/v3/requests/PortalConsultations";
import { RequestStatusFilters } from "@/components/v3/requests/RequestStatusFilters";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  parseRequestSelection, requestsHref, requestKindSelected, REQUEST_KINDS, REQUEST_SOURCE_FILTERS,
  type RequestSelection, type RequestSourceFilter, type RequestsQueue,
} from "@/lib/requests-queue-contract";
import { loadScopedRequestsQueue, RequestsQueueSourceError } from "@/lib/v3/requests-queue-source";
import { STATUS_LABELS, submittedDate } from "@/lib/student-application-presentation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Заявки" };
const FILTER_LABELS: Record<RequestSourceFilter, string> = {
  all: "Все", website: "Сайт", platform_application: "Платформа", whatsapp: "WhatsApp", portal_consultation: "Кабинет: консультации",
};
const KIND_LABELS = { lead: "Обращения с сайта и WhatsApp", application: "Анкеты платформы", consultation: "Консультации из кабинета" };
const linkClass = "inline-flex min-h-11 items-center rounded-nav border border-control-edge px-3 text-sm font-medium text-fg hover:bg-surface-2";

function Filters({ selection }: { selection: RequestSelection }) {
  return <div className="space-y-4">
    <nav aria-label="Источник заявки" className="flex flex-wrap gap-2">
      {REQUEST_SOURCE_FILTERS.map((source) => <Link key={source}
        href={requestsHref({ ...selection, source, cursor: null })}
        aria-current={selection.source === source ? "page" : undefined}
        className={`v3-choice ${linkClass}`}>
        {FILTER_LABELS[source]}
      </Link>)}
    </nav>
    {(requestKindSelected("application", selection.source) || requestKindSelected("consultation", selection.source)) ? (
      <RequestStatusFilters key={`${selection.source}:${selection.applicationStatus}:${selection.consultationStatus}:${selection.limit}`} selection={selection} />
    ) : null}
  </div>;
}

export default async function RequestsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireV3PageActor("/v3/requests");
  const params = await searchParams;
  let selection: RequestSelection;
  try { selection = parseRequestSelection(params); }
  catch {
    return <PartShell title="Заявки"><div role="alert" className="space-y-3 text-sm text-fg-2">
      <p>Не удалось открыть эту страницу очереди: параметры ссылки неверны.</p>
      <Link href="/v3/requests" className={linkClass}>Открыть начало очереди</Link>
    </div></PartShell>;
  }
  const currentHref = requestsHref(selection);
  const firstHref = requestsHref({ ...selection, cursor: null });
  const readOnly = isStaffPreview(actor);
  let queue: RequestsQueue | null = null;
  let failure: "forbidden" | "invalid" | "unavailable" = "unavailable";
  try { queue = await loadScopedRequestsQueue(actor, selection); }
  catch (error) { if (error instanceof RequestsQueueSourceError) failure = error.code; }
  const inaccessible = queue ? REQUEST_KINDS.filter((kind) => ["forbidden", "unavailable"].includes(queue.states[kind])) : [];
  const readable = queue ? REQUEST_KINDS.filter((kind) => queue.states[kind] === "ready") : [];
  const availableCount = queue && readable.length ? readable.reduce((total, kind) => total + queue.counts[kind]!, 0) : null;
  return <PartShell title="Заявки">
    <div className="min-w-0 space-y-6">
      <Filters selection={selection} />
      {!queue ? <div role="alert" className="space-y-3 text-sm text-fg-2">
        <p>{failure === "forbidden" ? "У вашей роли нет доступа к этой очереди."
          : failure === "invalid" ? "Не удалось открыть выбранную страницу. Вернитесь к началу очереди."
            : "Не удалось загрузить заявки. Количество и список сейчас неизвестны."}</p>
        <div className="flex flex-wrap gap-2"><a href={currentHref} className={linkClass}>Повторить</a>
          <Link href={firstHref} className={linkClass}>К началу очереди</Link></div>
      </div> : <>
        {inaccessible.length ? <div role="status" className="space-y-1 text-sm text-fg-2">
          {inaccessible.map((kind) => <p key={kind}>{KIND_LABELS[kind]}: {queue.states[kind] === "forbidden"
            ? "недоступны вашей роли." : "не удалось загрузить."}</p>)}
          {readable.length ? <p>Список и счётчики ниже относятся только к доступным обращениям.</p> : null}
        </div> : null}
        {availableCount !== null ? <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-2">
          <div className="flex gap-2"><dt>На странице</dt><dd className="font-semibold tabular-nums text-fg">{queue.rows.length}</dd></div>
          <div className="flex gap-2"><dt>{inaccessible.length ? "Доступных по фильтру" : "Всего по фильтру"}</dt><dd className="font-semibold tabular-nums text-fg">{availableCount}</dd></div>
          {queue.counts.pendingApplications !== null ? <div className="flex gap-2"><dt>Анкет ожидают решения</dt><dd className="font-semibold tabular-nums text-fg">{queue.counts.pendingApplications}</dd></div> : null}
          {queue.counts.openConsultations !== null ? <div className="flex gap-2"><dt>Открытых консультаций</dt><dd className="font-semibold tabular-nums text-fg">{queue.counts.openConsultations}</dd></div> : null}
        </dl> : null}
        {queue.rows.length === 0 ? <div className="space-y-2 text-sm text-fg-2">
          <p>{!readable.length ? "В выбранном разделе нет доступных вашей роли видов обращений."
            : selection.cursor ? "На этой странице больше нет обращений. Список мог измениться."
              : inaccessible.length ? "В доступной части очереди нет обращений по выбранным фильтрам."
                : "Нет обращений по выбранным фильтрам."}</p>
          {selection.cursor ? <Link href={firstHref} className={linkClass}>К началу очереди</Link> : null}
        </div> : <ul className="divide-y divide-border border-y border-border">
          {queue.rows.map((row) => <li key={`${row.kind}:${row.id}`} className="min-w-0 space-y-3 py-5">
            <div className="flex flex-col items-start justify-between gap-x-4 gap-y-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                {row.kind !== "consultation" && row.leadId ? <Link
                  href={`/v3/profile?id=${encodeURIComponent(row.leadId)}&returnTo=${encodeURIComponent(currentHref)}`}
                  className="inline-flex min-h-11 items-center break-words text-base font-semibold text-fg hover:text-accent hover:underline">
                  {row.personName}
                </Link> : <h2 className="t-section break-words text-fg">{row.personName}</h2>}
                <p className="mt-1 text-sm text-fg-2">{row.kind === "application" ? "Анкета платформы" : row.kind === "consultation" ? "Консультация" : `Обращение · ${FILTER_LABELS[row.source]}`}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
                {row.kind === "application" ? <Pill tone={row.application.status === "pending" ? "info" : "neutral"}>{STATUS_LABELS[row.application.status]}</Pill> : null}
                {row.kind === "consultation" ? <Pill tone={row.consultation.status === "requested" ? "info" : "neutral"}>{row.consultation.status === "requested" ? "Открыта" : "Обработана"}</Pill> : null}
                <time dateTime={row.occurredAt}>{submittedDate(row.occurredAt)}</time>
              </div>
            </div>
            {row.kind === "lead" ? <p className="break-words text-sm text-fg-2">{[row.email, row.phone].filter(Boolean).join(" · ") || "Контакты не указаны"}</p> : null}
            {row.kind === "application" ? <>
              <p className="break-words text-sm text-fg-2">{row.email}</p>
              {!row.leadId ? <StudentApplicationAnswers application={row.application} /> : null}
              {row.application.status === "pending" ? readOnly
                ? <p className="text-sm text-fg-2">В режиме просмотра решения недоступны.</p>
                : <ApplicationDecision application={row.application} requestId={randomUUID()} /> : null}
            </> : null}
            {row.kind === "consultation" ? <PortalConsultationDetails row={row.consultation} readOnly={readOnly} refreshHref={currentHref} /> : null}
          </li>)}
        </ul>}
        {(queue.previousCursor || queue.nextCursor) ? <nav aria-label="Страницы заявок" className="flex flex-wrap gap-3">
          {queue.previousCursor ? <Link className={linkClass} href={requestsHref({ ...selection, cursor: queue.previousCursor })}>Предыдущая страница</Link> : null}
          {queue.nextCursor ? <Link className={linkClass} href={requestsHref({ ...selection, cursor: queue.nextCursor })}>Следующая страница</Link> : null}
        </nav> : null}
      </>}
    </div>
  </PartShell>;
}
