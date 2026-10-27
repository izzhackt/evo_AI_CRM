import Link from "next/link";

import { EmptyState } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { requestsHref, type RequestsQueue } from "@/lib/requests-queue-contract";
import { requestCallsOff, requestClosedKinds, requestLatestLine } from "@/lib/v3/requests-view";

import type { ViewProps } from "../requests/RequestsQueueView";

/**
 * Пустая очередь: что пусто, когда пришла последняя и «Показать все». «Добавить лида» здесь не повторяется: красная
 * кнопка шапки той же страницы — тот же вход в ту же форму, а две вторичные кнопки разного веса рядом читались бы
 * как два разных действия. «Что сюда приходит» ушло за «?» страницы (`requestEmptyWhat` в справке шапки). Граница
 * роли и «Звонки не подключены» называются прямо, как у прежнего вида.
 */
export function RequestsNextEmpty({ queue, props, now }: Readonly<{ queue: RequestsQueue; props: ViewProps; now: Date }>) {
  const { selection } = props;
  if (selection.cursor) {
    return (
      <EmptyState
        title="На этой странице заявок больше нет: список изменился."
        action={<Button variant="outline" asChild><Link href={requestsHref({ ...selection, cursor: null })}>К началу очереди</Link></Button>}
      />
    );
  }
  const closed = selection.source === "all" ? [] : requestClosedKinds(queue, selection.source);
  if (closed.length) return <EmptyState title={`${closed[0]} вашей роли недоступны.`} />;
  if (requestCallsOff(queue, selection.source)) return <EmptyState title="Звонки пока не подключены." />;
  const latest = requestLatestLine(queue.latestAt, now);
  const more = selection.status === "waiting" && queue.latestAt
    ? <Button variant="outline" asChild><Link href={requestsHref({ ...selection, status: "all", cursor: null })}>Показать все</Link></Button> : null;
  return (
    <EmptyState
      title={selection.status === "waiting" ? "Новых заявок нет" : "Заявок нет"}
      description={latest ?? "Заявок ещё не было."}
      action={more ?? undefined}
    />
  );
}
