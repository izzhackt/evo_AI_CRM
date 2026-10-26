"use client";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import {
  conversationPrompt,
  conversationStatusWord,
  conversationTimeRu,
  formatUsdCents,
  type AiAgentConversationRow,
} from "@/lib/v3/ai-agents-view";

/**
 * «Мои разговоры»: собственные поручения сотрудника этому агенту, новые выше.
 * Строка — два предложения поручения и одна строка меты: день и время, слово
 * состояния только если разговор не просто закончен (красное — лишь «Ошибка»),
 * расход табличными цифрами. Выбранная строка — нейтральное «выбрано» плюс
 * `aria-current`. Список живёт и колонкой слева, и листом на узком экране.
 */
export function ConversationList({
  rows,
  activeId,
  now,
  runsHref,
  onSelect,
  onNew,
  showHeading = true,
}: Readonly<{
  rows: readonly AiAgentConversationRow[];
  activeId: string | null;
  /** Сейчас по часам сервера: от него считаются «Сегодня» и «Вчера» (на гидратацию не влияет). */
  now: string;
  runsHref: string;
  onSelect: (runId: string) => void;
  onNew: () => void;
  /** Лист на узком экране называет себя сам. */
  showHeading?: boolean;
}>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* «Новый разговор» — не во всю ширину: в списке из одной-двух строк кнопка тяжелее самого списка. */}
      <div className={cn("flex shrink-0 items-center gap-2 px-3 pb-2 pt-3", showHeading ? "justify-between" : "justify-start")}>
        {showHeading ? <h2 className="t-item px-1 text-fg">Мои разговоры</h2> : null}
        <button type="button" onClick={onNew} aria-label="Новый разговор" className={QUEUE_SECONDARY} data-testid="v3-aia-new">
          <Icon name="plus" size={18} className="shrink-0" />
          Новый
        </button>
      </div>
      <nav aria-label="Мои разговоры с агентом" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" data-testid="v3-aia-conversations">
        {rows.length === 0 ? (
          <p className="px-2 py-3 t-meta text-fg-3">Здесь появятся ваши разговоры с агентом.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {rows.map((row) => {
              const selected = row.id === activeId;
              const state = conversationStatusWord(row.status);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex min-h-11 w-full flex-col gap-0.5 rounded-nav px-3 py-2 text-start",
                      selected ? "bg-accent-weak" : "hover:bg-surface-2",
                    )}
                    data-testid="v3-aia-conversation-item"
                    data-state={row.status}
                  >
                    <span className="line-clamp-2 break-words t-body-compact text-fg">{conversationPrompt(row)}</span>
                    <span className="flex flex-wrap items-center gap-x-1.5 t-meta text-fg-3">
                      <span>{conversationTimeRu(row.startedAt, now)}</span>
                      {state ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className={cn("inline-flex items-center gap-1.5", state.tone === "danger" && "text-danger", state.tone === "warn" && "text-warn")}>
                            {state.tone === "working" ? <span aria-hidden="true" className="v3-aia-working-dot" /> : null}
                            {state.word}
                          </span>
                        </>
                      ) : null}
                      {row.costCents > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{formatUsdCents(row.costCents)}</span>
                        </>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <div className="shrink-0 border-t border-border px-3">
        <Link href={runsHref} className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg" data-testid="v3-aia-all-runs">
          Вся история работы
          <Icon name="arrow-right" size={16} className="shrink-0" />
        </Link>
      </div>
    </div>
  );
}
