import { SearchIcon } from "lucide-react";

import { EmptyState } from "@/components/kit/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queueLabel, type CaseChatListProps } from "@/components/v3/case-chat/CaseChatThread";
import { CASE_CHAT_QUEUE_ORDER } from "@/lib/platform-case-chat-contract";
import { cn } from "@/lib/utils";

import { CaseChatNextRow } from "./CaseChatNextRow";

/** Что сказать, когда строк нет: поиск, очередь «Нужен ответ» или пустой список. */
function emptyTitle(query: string, queue: CaseChatListProps["queue"]): string {
  if (query.trim()) return queue === "all" ? "По вашему запросу переписок не найдено." : "В этой очереди нет переписок по вашему запросу.";
  return queue === "needs_reply" ? "Нет переписок, ждущих ответа." : queue === "all" ? "Переписок пока нет." : "В этой очереди переписок нет.";
}

/**
 * Список «Переписки» слева: очереди с числами на виду (кнопки с `aria-pressed`, число — из того же чтения, только из
 * полного), поиск по студенту, строки, сбой и «Повторить». Состояние поиска и очереди живёт в адресе и в движке
 * `CaseChatWorkspace`; здесь только вид.
 */
export function CaseChatNextList({
  threads, counts, readAt, selectedCaseId, query, onQuery, queue, onQueue, membershipId, hidden, loading, current, failure, onRetry,
}: CaseChatListProps) {
  const showRows = !loading && current;
  return (
    <nav aria-label="Переписки кабинета студента" className={cn(hidden ? "hidden @2xl:flex" : "flex", "w-full flex-col border-border @2xl:w-[320px] @2xl:shrink-0 @2xl:border-e")}>
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div role="group" aria-label="Очередь переписок" data-testid="case-chat-queues" className="-mx-1 flex flex-wrap">
          {CASE_CHAT_QUEUE_ORDER.map((value) => {
            const count = value === "all" || counts === null ? null : counts[value];
            return (
              <Button key={value} variant="ghost" aria-pressed={queue === value} onClick={() => onQueue(value)}
                className="gap-1 px-2 aria-pressed:bg-accent-weak aria-pressed:font-semibold aria-pressed:text-accent-text">
                {queueLabel(value)}
                {count !== null ? <span className="tabular-nums text-fg-3" data-queue-count={value}>{count}</span> : null}
              </Button>
            );
          })}
        </div>
        <form onSubmit={(event) => event.preventDefault()} role="search">
          <label className="sr-only" htmlFor="case-chat-search">Поиск по студенту</label>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-fg-3" />
            <Input id="case-chat-search" type="search" value={query} placeholder="Поиск по студенту" className="ps-10" onChange={(event) => onQuery(event.target.value)} />
          </div>
        </form>
      </div>
      {loading ? <p role="status" className="p-4 t-body-compact text-fg-3">Ищем переписки…</p> : null}
      {failure ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
          <p role="alert" className="t-body-compact text-danger">{failure === "forbidden" ? "Доступ к перепискам изменился. Обновите страницу." : "Не удалось загрузить."}</p>
          {failure === "forbidden" ? null : <Button variant="outline" onClick={onRetry}>Повторить</Button>}
        </div>
      ) : null}
      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
        {/* Поиск и смена очереди идут без перехода между страницами, пустой итог читается вслух (как `role="status"` прежнего списка).
            Область стоит в списке всегда, а пустое состояние попадает в готовую: так читалки озвучивают надёжнее. */}
        <div role="status">
          {showRows && threads.rows.length === 0
            ? <EmptyState title={emptyTitle(query, queue)} action={query.trim() ? <Button variant="outline" onClick={() => onQuery("")}>Сбросить поиск</Button> : undefined} />
            : null}
        </div>
        {showRows ? threads.rows.map((row) => (
          <CaseChatNextRow key={row.studentCaseId} row={row} active={row.studentCaseId === selectedCaseId} query={query} queue={queue} readAt={readAt} membershipId={membershipId} />
        )) : null}
        {showRows && threads.truncated ? <p className="t-meta p-3 text-fg-3">Показаны первые {threads.rows.length}. Уточните поиск.</p> : null}
      </div>
    </nav>
  );
}
