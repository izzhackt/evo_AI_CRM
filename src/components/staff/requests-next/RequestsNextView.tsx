import Link from "next/link";

import { EmptyState, SectionTabs } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { requestOpenKey, requestsHref } from "@/lib/requests-queue-contract";
import { REQUEST_STATUS_LABELS, requestClosedLine, requestTabs } from "@/lib/v3/requests-view";

import { BoardSegments } from "../board/Board";
import { DialListHint } from "../telephony/DialButton";
import type { ViewProps } from "../requests/RequestsQueueView";
import { TakeFeedback, TakeStatus } from "../requests/TakeLead";
import { RequestsNextEmpty } from "./RequestsNextEmpty";
import { RequestsNextTable } from "./RequestsNextTable";
import { requestSheetContent } from "./RequestSheetBody";
import { buildRequestRow } from "./requests-next-rows";

/**
 * «Заявки» нового вида: вкладки источников с числами из чтения, таблица (поиск, сортировка, «Ждут разбора / Все»
 * рядом с поиском), панель записи по нажатию на строку. Чтение, права, отбор и страницы очереди те же, что у
 * прежнего вида (`RequestsQueueView`); адрес открытой записи тот же (`?open=kind:id`).
 */
export function RequestsNextView(props: ViewProps) {
  const { selection, read } = props;
  const now = new Date(props.nowIso);
  const listHref = requestsHref(selection);
  const queue = read.status === "ready" ? read.queue : null;
  const tabs = requestTabs(selection, queue).map((tab) => ({ key: tab.key, label: tab.label, href: tab.href, count: tab.count }));
  const status = (["waiting", "all"] as const).map((key) => ({
    key, title: REQUEST_STATUS_LABELS[key], count: null, href: requestsHref({ ...selection, status: key, cursor: null }), active: selection.status === key,
  }));
  const openKey = props.open ? requestOpenKey(props.open) : null;
  const openRow = queue && openKey ? queue.rows.find((row) => requestOpenKey(row) === openKey) ?? null : null;
  // «Все» у роли, которая читает не все виды: какие закрыты — одной строкой на виду (граница роли, не ошибка).
  const closedLine = queue && selection.source === "all" ? requestClosedLine(queue) : null;

  return (
    <TakeFeedback key={listHref}>
      <div className="grid min-w-0 gap-4" data-testid="requests-queue">
        <SectionTabs label="Источник заявки" tabs={tabs} value={selection.source} />
        {closedLine ? <p className="t-body-compact text-fg-2" data-testid="requests-closed-kinds">{closedLine}</p> : null}
        <TakeStatus />
        {!queue ? (
          <div role="alert" className="rounded-card border border-border bg-surface" data-testid="queue-error">
            <EmptyState
              tone="danger"
              title={read.status === "forbidden" ? "У вашей роли нет доступа к заявкам."
                : read.status === "invalid" ? "Эта страница очереди больше не открывается." : "Заявки не загрузились. Список и числа сейчас неизвестны."}
              action={read.status === "forbidden" ? undefined : (
                <Button variant="outline" asChild><Link href={read.status === "invalid" ? requestsHref({ ...selection, cursor: null }) : listHref}>Повторить</Link></Button>
              )}
            />
          </div>
        ) : (
          <>
            {/* Одно описание на все кнопки «Позвонить» списка: читалка не повторяет его в каждой строке. */}
            {props.dial?.status === "ready" && !props.readOnly ? <DialListHint /> : null}
            <RequestsNextTable
              rows={queue.rows.map((row) => buildRequestRow(row, props, listHref, now))}
              openKey={openKey}
              sheet={openRow ? requestSheetContent(openRow, props, listHref, now) : null}
              listHref={listHref}
              toolbar={<BoardSegments label="Состояние" items={status} />}
              empty={<RequestsNextEmpty queue={queue} props={props} now={now} />}
            />
            {queue.previousCursor || queue.nextCursor ? (
              <nav aria-label="Страницы заявок" className="flex flex-wrap gap-2">
                {queue.previousCursor ? <Button variant="outline" asChild><Link href={requestsHref({ ...selection, cursor: queue.previousCursor })}>Предыдущая страница</Link></Button> : null}
                {queue.nextCursor ? <Button variant="outline" asChild><Link href={requestsHref({ ...selection, cursor: queue.nextCursor })}>Следующая страница</Link></Button> : null}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </TakeFeedback>
  );
}
