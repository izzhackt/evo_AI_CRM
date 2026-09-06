import Link from "next/link";

import type {
  PlatformDashboardAttentionItem,
  PlatformDashboardQueueCard,
  PlatformDashboardSnapshot,
} from "@/lib/server/platform-dashboard";

const CARD_TITLE: Record<PlatformDashboardQueueCard["key"], string> = {
  clients: "Студенты",
  finance: "Финансы",
  sales: "Продажи",
  tasks: "Задачи приёмной",
  whatsapp: "WhatsApp",
};

const ATTENTION_TITLE: Record<PlatformDashboardAttentionItem["key"], string> = {
  admissions_overdue: "Просроченные задачи приёмной",
  finance_stops: "Действующие финансовые стопы",
  sales_overdue: "Просроченные шаги по лидам",
  sales_unassigned: "Лиды без ответственного",
  student_attention: "Студенты, требующие внимания",
  whatsapp_open: "Открытые диалоги WhatsApp",
};

/* Цвет живёт в пилюлях и рёбрах, поверхность не подкрашивается. Для info
   отдельного ребра у мира нет — информационная строка стоит на нейтральном. */
const ATTENTION_EDGE: Record<PlatformDashboardAttentionItem["tone"], string> = {
  danger: "v3-edge-danger",
  info: "v3-edge-muted",
  warn: "v3-edge-warn",
};

/* Очередь длиннее прочитанного — точных производных счётов нет, и строки
   деталей у карточки не будет: число, посчитанное по куску очереди, врёт. */
function cardDetails(card: PlatformDashboardQueueCard): string | null {
  switch (card.key) {
    case "sales":
      return card.overdueCount === null || card.unassignedCount === null
        ? null
        : `просрочено ${card.overdueCount} · без ответственного ${card.unassignedCount}`;
    case "clients":
      return card.attentionCount === null
        ? null
        : `требуют внимания ${card.attentionCount}`;
    case "tasks":
      return card.overdueCount === null
        ? null
        : `просрочено ${card.overdueCount}`;
    case "finance":
      return card.blockedCount === null
        ? null
        : `со стоп-фактором ${card.blockedCount}`;
    case "whatsapp":
      return card.salesCount === null || card.admissionsCount === null
        ? null
        : `продажи ${card.salesCount} · приёмная ${card.admissionsCount}`;
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
      <h2
        className="text-lg font-semibold text-fg"
        id="operations-overview-title"
      >
        Операционная работа
      </h2>

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
                  {card.loadedCount}
                  {card.hasMore ? "+" : ""}
                </strong>
                {cardDetails(card) ? (
                  <span className="mt-2 block text-xs leading-5 text-fg-2">
                    {cardDetails(card)}
                  </span>
                ) : null}
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
                  className={`flex min-h-12 items-center justify-between gap-3 rounded-nav border border-border border-s-2 bg-surface px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-2 ${ATTENTION_EDGE[item.tone]}`}
                  data-dashboard-attention={item.key}
                  href={item.href}
                >
                  <span>{ATTENTION_TITLE[item.key]}</span>
                  {item.value === null ? null : (
                    <strong className="font-mono text-base">{item.value}</strong>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
