import { PageShell } from "@/components/kit";
import { todayDateLabel } from "@/lib/v3/today-queue";

import { TodayNext } from "./TodayNext";

/**
 * «Сегодня» нового вида целиком: рамка страницы (число дня под заголовком, доски роли справа) и виджеты. Страница
 * `/v3/main` показывает её через `TodayNextLazy`: рамка и виджеты — одним куском, который грузится, только когда он
 * рисуется (у остальных сотрудников этих клиентских кусков в первой загрузке нет).
 */
export function TodayNextPage(props: React.ComponentProps<typeof TodayNext>) {
  return (
    <PageShell
      title="Сегодня"
      testId="v3-operational-dashboard"
      meta={<time dateTime={props.queue.today}>{todayDateLabel(props.queue.today)}</time>}
    >
      <TodayNext {...props} />
    </PageShell>
  );
}
