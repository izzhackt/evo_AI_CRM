import Link from "next/link";

import type {
  PlatformDashboardAttentionItem,
  PlatformDashboardQueueCard,
  PlatformDashboardSnapshot,
} from "@/lib/server/platform-dashboard";

const CARD_TITLE: Record<PlatformDashboardQueueCard["key"], string> = {
  clients: "Student 360",
  finance: "Финансы",
  sales: "Продажи",
  tasks: "Задачи Admissions",
  whatsapp: "WhatsApp",
};

const ATTENTION_TITLE: Record<PlatformDashboardAttentionItem["key"], string> = {
  admissions_overdue: "Просроченные задачи Admissions",
  finance_stops: "Активные стоп-факторы",
  sales_overdue: "Просроченные следующие шаги Sales",
  sales_unassigned: "Лиды без ответственного",
  student_attention: "Student Cases требуют внимания",
  whatsapp_open: "Открытые диалоги WhatsApp",
};

const ATTENTION_TONE: Record<
  PlatformDashboardAttentionItem["tone"],
  string
> = {
  danger: "border-danger/30 bg-danger-weak text-danger",
  info: "border-info/30 bg-info-weak text-info",
  warn: "border-warn/30 bg-warn-weak text-warn",
};

function cardDetails(card: PlatformDashboardQueueCard): string {
  switch (card.key) {
    case "sales":
      return `просрочено ${card.overdueCount} · без ответственного ${card.unassignedCount}`;
    case "clients":
      return `требуют внимания ${card.attentionCount}`;
    case "tasks":
      return `просрочено ${card.overdueCount}`;
    case "finance":
      return `со стоп-фактором ${card.blockedCount}`;
    case "whatsapp":
      return `Sales ${card.salesCount} · Admissions ${card.admissionsCount}`;
  }
}

export function OperationsOverview({
  snapshot,
}: Readonly<{ snapshot: PlatformDashboardSnapshot }>) {
  return (
    <section
      aria-labelledby="operations-overview-title"
      className="mt-8 border-t border-border pt-7"
      data-testid="v3-operational-dashboard"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            className="text-lg font-semibold text-fg"
            id="operations-overview-title"
          >
            Операционная работа
          </h2>
          <p className="mt-1 text-sm text-fg-3">
            Рабочие очереди, доступные выбранной роли прямо сейчас.
          </p>
        </div>
      </div>

      {snapshot.cards.length === 0 ? (
        <p className="mt-4 rounded-card border border-border bg-surface px-4 py-8 text-center text-sm text-fg-3">
          Для этой роли нет доступных операционных очередей.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 @5xl:grid-cols-5">
          {snapshot.cards.map((card) => (
            <li key={card.key}>
              <Link
                className="block h-full rounded-card border border-border bg-surface px-4 py-4 transition-colors hover:border-control-edge hover:bg-surface-2"
                data-dashboard-card={card.key}
                href={card.href}
              >
                <span className="text-xs font-medium text-fg-3">
                  {CARD_TITLE[card.key]}
                </span>
                <strong className="mt-2 block font-mono text-3xl font-semibold text-fg">
                  {card.totalOnPage}
                </strong>
                <span className="mt-2 block text-xs leading-5 text-fg-2">
                  {cardDetails(card)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-fg">Требует внимания</h3>
        {snapshot.attentionItems.length === 0 ? (
          <p className="mt-2 text-sm text-fg-3">
            В доступных очередях срочных отклонений нет.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 @5xl:grid-cols-3">
            {snapshot.attentionItems.map((item) => (
              <li key={item.key}>
                <Link
                  className={`flex min-h-12 items-center justify-between gap-3 rounded-nav border px-3 py-2 text-sm font-medium ${ATTENTION_TONE[item.tone]}`}
                  data-dashboard-attention={item.key}
                  href={item.href}
                >
                  <span>{ATTENTION_TITLE[item.key]}</span>
                  <strong className="font-mono text-base">{item.value}</strong>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
