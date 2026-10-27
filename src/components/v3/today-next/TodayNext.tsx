import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { DialOptions } from "@/lib/v3/telephony-dial";
import type { TodayLink, TodayNotice, TodayQueue } from "@/lib/v3/today-queue";

import { QUEUE_QUIET_LINK } from "../queue/QueueStates";
import type { TaskRowPermissions } from "../tasks/TaskQueueRow";
import { TodayDashboard } from "./TodayDashboard";
import { TodayTiles } from "./TodayTiles";

/**
 * Сбой и неполное чтение источника остаются на виду над виджетами: что не так и одна ссылка («Повторить» или
 * где посмотреть всё). Остальные источники видны как были; слова и ссылки те же, что в прежнем виде.
 */
function Notices({ notices }: Readonly<{ notices: readonly TodayNotice[] }>) {
  const failed = notices.some((notice) => notice.kind === "error");
  return (
    <div role={failed ? "alert" : "status"} className="divide-y divide-border rounded-card border border-border bg-surface px-4" data-testid="today-notices">
      {notices.map((notice) => (
        <p key={notice.source} data-today-notice={notice.kind} data-today-source={notice.source} className="flex min-h-11 flex-wrap items-center gap-x-3 py-1 t-body-compact">
          <span className={notice.kind === "error" ? "text-danger" : "text-fg-2"}>{notice.text}</span>
          {notice.link ? <IntentPrefetchLink href={notice.link.href} className={QUEUE_QUIET_LINK}>{notice.link.label}</IntentPrefetchLink> : null}
        </p>
      ))}
    </div>
  );
}

/** Честная пустота дня: что именно пусто и одно подходящее действие или ближайший срок. */
function Empty({ queue, mainAction }: Readonly<{ queue: TodayQueue; mainAction: TodayLink | null }>) {
  const link = mainAction ? <Button variant="outline" asChild><IntentPrefetchLink href={mainAction.href}>{mainAction.label}</IntentPrefetchLink></Button> : null;
  const nearest = queue.nearest ? (
    <p className="t-body-compact text-fg-2">
      Ближайший срок — {queue.nearest.weekday} <time dateTime={queue.nearest.day} className="font-mono tabular-nums">{queue.nearest.date}</time>
    </p>
  ) : null;
  const empty = !queue.applicable
    ? <EmptyState title="Для вашей роли здесь пока нет очереди." action={link} />
    : queue.actionEmpty
      ? queue.complete
        ? <EmptyState title="На сегодня всё" description={queue.emptyNote ?? undefined} action={nearest ?? link} />
        : <EmptyState title="В прочитанной части на сегодня ничего нет." description={queue.emptyNote ?? undefined} />
      : null;
  return empty ? <div role="status" className="rounded-card border border-border bg-surface" data-testid="queue-empty">{empty}</div> : null;
}

/**
 * «Сегодня» нового вида: ряд плиток с числами групп и под ним виджеты групп по срочности. Данные, группы, числа,
 * слова строк и их действия те же, что у прежнего вида (`TodayScreen`): меняется только расстановка.
 */
export function TodayNext({
  queue,
  nowIso,
  permissions,
  mainAction,
  dial = null,
  taskLeads = null,
}: Readonly<{
  queue: TodayQueue;
  nowIso: string;
  permissions: TaskRowPermissions;
  /** Главное действие роли для пустого дня; null — у роли его нет. */
  mainAction: TodayLink | null;
  dial?: DialOptions | null;
  taskLeads?: Readonly<Record<string, Readonly<{ leadId: string; name: string; href: string }>>> | null;
}>) {
  return (
    <>
      {queue.notices.length ? <Notices notices={queue.notices} /> : null}
      <Empty queue={queue} mainAction={mainAction} />
      {queue.bands.length ? (
        <>
          <TodayTiles bands={queue.bands} />
          <TodayDashboard bands={queue.bands} nowIso={nowIso} permissions={permissions} dial={dial} taskLeads={taskLeads} />
        </>
      ) : null}
    </>
  );
}
