import Link from "next/link";

import { Icon } from "@/components/icons";
import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";
import {
  Badge,
  EmptyState,
  PageHeader,
  btnGhostCls,
  cn,
  filterBarCls,
  inputCls,
} from "@/components/ui";
import {
  listPlatformStudentCases,
  type PlatformStudentCaseQueueRow,
} from "@/lib/platform-admissions";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

type SearchParams = { q?: string; state?: string };

function riskLabel(row: PlatformStudentCaseQueueRow): string | null {
  const signals = [
    row.overdueTaskCount > 0 ? `Просроченные задачи: ${row.overdueTaskCount}` : null,
    row.overdueObligationCount > 0
      ? `Просроченные оплаты: ${row.overdueObligationCount}`
      : null,
    row.rejectedDocumentCount > 0
      ? `Документы на доработке: ${row.rejectedDocumentCount}`
      : null,
  ].filter(Boolean);
  return signals.length > 0 ? signals.join(" · ") : null;
}
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function PlatformClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [actor, params] = await Promise.all([
    requirePlatformClientsActor(),
    searchParams,
  ]);
  const { cases, handoffSummaries } = await listPlatformStudentCases(actor);
  const query = params.q?.trim().toLocaleLowerCase("ru-RU") ?? "";
  const selectedState = ["pending", "active", "closed"].includes(
    params.state ?? "",
  )
    ? params.state
    : undefined;
  const visibleCases = cases.filter((row) => {
    if (selectedState && row.state !== selectedState) return false;
    if (!query) return true;
    return [
      row.studentDisplayName,
      row.targetCountry,
      row.targetDegree,
      row.programDirection,
    ].some((item) => item?.toLocaleLowerCase("ru-RU").includes(query));
  });
  const riskCount = cases.filter((row) => riskLabel(row) !== null).length;

  return (
    <div className="space-y-5" data-testid="platform-clients-page">
      <PageHeader
        eyebrow="OZO · Student 360"
        title="Студенческие кейсы"
        description="Операционная работа после договора. Этап продаж из amoCRM здесь не изменяется и не подменяется."
      />

      <QueueMetrics
        items={[
          { label: "Доступно роли", value: cases.length, tone: "accent" },
          {
            label: "Ожидают куратора",
            value: cases.filter((row) => row.state === "pending").length,
            tone: "warn",
          },
          {
            label: "Активные",
            value: cases.filter((row) => row.state === "active").length,
            tone: "ok",
          },
          { label: "Требуют внимания", value: riskCount, tone: "danger" },
        ]}
      />

      <form className={cn(filterBarCls, "sm:grid-cols-[1fr_220px_auto]")}>
        <label className="sr-only" htmlFor="platform-client-search">
          Поиск по студентам
        </label>
        <input
          id="platform-client-search"
          name="q"
          defaultValue={params.q}
          placeholder="Студент, страна или программа"
          className={inputCls}
        />
        <label className="sr-only" htmlFor="platform-client-state">
          Состояние кейса
        </label>
        <select
          id="platform-client-state"
          name="state"
          defaultValue={selectedState ?? ""}
          className={inputCls}
        >
          <option value="">Все состояния</option>
          <option value="pending">Ожидает назначения</option>
          <option value="active">Активен</option>
          <option value="closed">Закрыт</option>
        </select>
        <button type="submit" className={btnGhostCls}>
          Применить
        </button>
      </form>

      <section aria-labelledby="student-case-queue-title">
        <h2 id="student-case-queue-title" className="sr-only">
          Очередь студенческих кейсов
        </h2>
        {visibleCases.length === 0 ? (
          <div className="rounded-card border border-border bg-surface shadow-evo">
            <EmptyState text="Нет доступных кейсов по выбранному фильтру." />
          </div>
        ) : (
          <ul role="list" className="grid gap-3 lg:grid-cols-2">
            {visibleCases.map((row) => {
              const risk = riskLabel(row);
              return (
                <li key={row.studentCaseId}>
                  <Link
                    href={`/clients/${row.studentCaseId}`}
                    className="group flex h-full gap-4 rounded-card border border-border bg-surface p-4 shadow-evo transition-colors hover:border-border-strong"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-weak text-[13px] font-bold text-accent">
                      {initials(row.studentDisplayName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-[14px] text-fg">
                          {row.studentDisplayName}
                        </strong>
                        <Badge value={row.state} label={row.state} />
                      </span>
                      <span className="mt-1 block text-[12px] text-fg-2">
                        {row.targetCountry} · {row.targetDegree}
                      </span>
                      <span className="mt-2 block text-[11.5px] text-fg-3">
                        OZO: {row.operationalStage} · Куратор: {row.currentCuratorDisplayName ?? "не назначен"}
                      </span>
                      {risk && (
                        <span className="mt-2 block text-[11.5px] font-semibold text-danger">
                          {risk}
                        </span>
                      )}
                    </span>
                    <Icon name="chevron-right" size={17} className="mt-1 shrink-0 text-fg-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {actor.platformRole === "sales" && handoffSummaries.length > 0 && (
        <section className="space-y-3" aria-labelledby="handoff-summary-title">
          <ContextBanner
            title="После передачи доступ ограничен"
            description="Sales видит только безопасное резюме переданных кейсов. Документы, финансы, сообщения и внутренние поля куратора скрыты."
          />
          <h2 id="handoff-summary-title" className="text-[14px] font-bold text-fg">
            Переданные куратору
          </h2>
          <ul role="list" className="grid gap-3 lg:grid-cols-2">
            {handoffSummaries.map((row) => (
              <li key={row.studentCaseId}>
                <Link
                  href={`/clients/${row.studentCaseId}`}
                  className="block rounded-card border border-border bg-surface p-4 shadow-evo hover:border-border-strong"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-[13.5px] text-fg">{row.studentDisplayName}</strong>
                    <Badge value={row.state} label={row.state} />
                  </div>
                  <p className="mt-2 text-[12px] text-fg-2">
                    {row.targetCountry} · {row.targetDegree}
                  </p>
                  <p className="mt-1 text-[11.5px] text-fg-3">
                    Куратор: {row.assignedCuratorDisplayName}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
