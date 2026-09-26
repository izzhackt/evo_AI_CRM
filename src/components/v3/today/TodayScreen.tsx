import Link from "next/link";

import type { TodayLink, TodayNotice, TodayQueue } from "@/lib/v3/today-queue";

import { QUEUE_QUIET_LINK, QueueEmpty } from "../queue/QueueStates";
import type { TaskRowPermissions } from "../tasks/TaskQueueRow";
import { TodayQueueList } from "./TodayQueueList";

/**
 * Ошибка и неполное чтение источника — на месте, над очередью: что не так и
 * одна ссылка («Повторить» или где посмотреть всё). Остальные источники
 * остаются видны.
 */
function TodayNotices({ notices }: Readonly<{ notices: readonly TodayNotice[] }>) {
  const failed = notices.some((notice) => notice.kind === "error");
  return (
    <div role={failed ? "alert" : "status"} className="divide-y divide-border border-y border-border" data-testid="today-notices">
      {notices.map((notice) => (
        <p key={notice.source} data-today-notice={notice.kind} data-today-source={notice.source}
          className="flex min-h-11 flex-wrap items-center gap-x-3 py-1 t-body-compact">
          <span className={notice.kind === "error" ? "text-danger" : "text-fg-2"}>{notice.text}</span>
          {notice.link ? <Link href={notice.link.href} className={QUEUE_QUIET_LINK}>{notice.link.label}</Link> : null}
        </p>
      ))}
    </div>
  );
}

/**
 * Тихие ссылки шапки: доски роли остаются на один клик (поступлению — его
 * доска, продажам — своя). Это переходы, не действия страницы: без красного.
 * Две доски на телефоне называются коротко («Продажи · Поступление»), чтобы
 * стоять в строке заголовка и не отнимать у очереди первый экран; видимое
 * слово и есть имя ссылки.
 */
export function TodayBoardLinks({ links }: Readonly<{ links: readonly TodayLink[] }>) {
  if (links.length === 0) return null;
  const compact = links.length > 1;
  return (
    <nav aria-label="Доски" className="flex flex-wrap gap-x-4">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={QUEUE_QUIET_LINK}>
          {compact && link.short ? <>
            <span className="sm:hidden">{link.short}</span>
            <span className="hidden sm:inline">{link.label}</span>
          </> : link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * «Сегодня»: уведомления источников, честная пустота и одна очередь по
 * срочности. «На сегодня всё» — только когда все чтения роли полные; иначе
 * пустота называет прочитанную часть.
 */
export function TodayScreen({
  queue,
  nowIso,
  permissions,
  mainAction,
}: Readonly<{
  queue: TodayQueue;
  nowIso: string;
  permissions: TaskRowPermissions;
  /** Главное действие роли для пустого дня; null — у роли его нет. */
  mainAction: TodayLink | null;
}>) {
  const action = mainAction ? <Link href={mainAction.href} className={QUEUE_QUIET_LINK}>{mainAction.label}</Link> : null;
  return (
    <div className="space-y-4">
      {queue.notices.length ? <TodayNotices notices={queue.notices} /> : null}
      {!queue.applicable ? (
        <QueueEmpty title="Для вашей роли здесь пока нет очереди." action={action} />
      ) : queue.actionEmpty ? (
        queue.complete ? (
          <QueueEmpty
            title="На сегодня всё"
            action={queue.nearest
              ? <p className="t-body-compact text-fg-2">
                Ближайший срок — {queue.nearest.weekday} <time dateTime={queue.nearest.day} className="font-mono tabular-nums">{queue.nearest.date}</time>
              </p>
              : action}
          />
        ) : <QueueEmpty title="В прочитанной части на сегодня ничего нет." />
      ) : null}
      {queue.bands.length ? (
        <div className="@container min-w-0" data-today-queue="">
          <TodayQueueList bands={queue.bands} nowIso={nowIso} permissions={permissions} />
        </div>
      ) : null}
    </div>
  );
}
