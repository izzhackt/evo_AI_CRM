import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import {
  ContextBanner,
  QueueMetrics,
} from "@/components/platform/operations/OperationsPrimitives";
import { EmptyState, PageHeader, cn, compactActionCls } from "@/components/ui";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import {
  listOperatorNotificationsForActor,
  OPERATOR_NOTIFICATION_LIMIT,
  type OperatorNotification,
} from "@/lib/queries";

const GROUP_ORDER = ["urgent", "today", "upcoming"] as const;

const ICON_BY_KIND: Record<OperatorNotification["kind"], IconName> = {
  task_overdue: "alert",
  task_priority: "check-square",
  payment_overdue: "wallet",
  application_deadline: "calendar",
};

function formatDate(value: string | null, locale: "ru" | "ky" | "en") {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  const localeTag = locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(localeTag, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export default async function NotificationsPage() {
  const user = await requireStaffRoute("/notifications");
  const { t, locale } = await getT();
  const notificationBatch = listOperatorNotificationsForActor(
    { id: user.id, role: user.role },
    OPERATOR_NOTIFICATION_LIMIT + 1,
  );
  const notificationCountCapped =
    notificationBatch.length > OPERATOR_NOTIFICATION_LIMIT;
  const items = notificationBatch.slice(0, OPERATOR_NOTIFICATION_LIMIT);
  const counts = {
    urgent: items.filter((item) => item.group === "urgent").length,
    today: items.filter((item) => item.group === "today").length,
    upcoming: items.filter((item) => item.group === "upcoming").length,
  };

  return (
    <div className="space-y-5" data-testid="notifications-page">
      <PageHeader
        eyebrow={t("attentionQueue")}
        title={t("notifications")}
        description={t("notificationsHint")}
      />

      <QueueMetrics
        items={[
          {
            label: t("attentionCount"),
            value: notificationCountCapped
              ? `${OPERATOR_NOTIFICATION_LIMIT}+`
              : items.length,
            tone: "accent",
          },
          { label: t("urgentGroup"), value: counts.urgent, tone: "danger" },
          { label: t("todayGroup"), value: counts.today, tone: "warn" },
          { label: t("upcomingGroup"), value: counts.upcoming, tone: "info" },
        ]}
      />

      <ContextBanner
        title={t("readOnly")}
        description={t("notificationFeedReadOnly")}
        tone="info"
      />

      {notificationCountCapped && (
        <ContextBanner
          title={t("notificationLimitTitle")}
          description={t("notificationLimitHint")}
          tone="warning"
        />
      )}

      {items.length === 0 ? (
        <section className="rounded-card border border-border bg-surface px-5 shadow-evo">
          <EmptyState text={t("notificationNone")} />
        </section>
      ) : (
        <div className="space-y-5">
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            const heading =
              group === "urgent"
                ? t("urgentGroup")
                : group === "today"
                  ? t("todayGroup")
                  : t("upcomingGroup");

            return (
              <section key={group} aria-labelledby={`notification-group-${group}`}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h2
                    id={`notification-group-${group}`}
                    className="text-[13px] font-bold uppercase tracking-[0.05em] text-fg-2"
                  >
                    {heading}
                  </h2>
                  <span
                    className={cn(
                      "grid min-w-6 place-items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold",
                      group === "urgent" && "bg-danger-weak text-danger",
                      group === "today" && "bg-warn-weak text-warn",
                      group === "upcoming" && "bg-info-weak text-info",
                    )}
                  >
                    {groupItems.length}
                  </span>
                </div>
                <ul role="list" className="grid gap-2">
                  {groupItems.map((item) => (
                    <li
                      key={item.id}
                      data-testid="notification-card"
                      className={cn(
                        "rounded-card border bg-surface shadow-evo",
                        group === "urgent" ? "border-danger/25" : "border-border",
                      )}
                    >
                      <div className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center">
                        <span
                          className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-nav",
                            group === "urgent"
                              ? "bg-danger-weak text-danger"
                              : group === "today"
                                ? "bg-warn-weak text-warn"
                                : "bg-info-weak text-info",
                          )}
                        >
                          <Icon name={ICON_BY_KIND[item.kind]} size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">
                            {t(`notif.${item.kind}`)}
                          </div>
                          <h3 className="mt-1 break-words text-[14px] font-bold text-fg">
                            {item.title}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
                            {item.subject && (
                              <span>{item.subject}</span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Icon name="clock" size={13} />
                              {t("dueLabel")}: {formatDate(item.occurred_at, locale)}
                            </span>
                          </div>
                        </div>
                        <Link
                          href={item.href}
                          className={cn(
                            compactActionCls,
                            "min-h-11 w-full justify-center border border-border-strong sm:w-auto",
                          )}
                        >
                          {t("openItem")}
                          <Icon name="chevron-right" size={15} />
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
