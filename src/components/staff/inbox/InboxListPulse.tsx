"use client";

import type { V3InboxSort } from "@/lib/v3/inbox-href";

import { useInboxPulse } from "./useInboxPulse";

/**
 * Опрос списка, когда чат не открыт (с открытым чатом список опрашивает сам
 * чат одним запросом). Ничего не рисует, пока опрос идёт; три сбоя подряд —
 * честная строка с «Обновить».
 */
export function InboxListPulse({
  listPulse,
  searchQuery,
  sort,
}: Readonly<{ listPulse: string | null; searchQuery: string | null; sort: V3InboxSort }>) {
  const { stalled, resume } = useInboxPulse({
    conversationId: null,
    listPulse,
    chatPulse: null,
    query: searchQuery,
    sort,
    busy: false,
  });
  if (!stalled) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 border-b border-border px-4 py-2 t-body-compact text-fg-2" role="status">
      Новые сообщения не загружаются ·
      <button
        type="button"
        onClick={resume}
        className="inline-flex min-h-11 items-center t-label text-fg underline decoration-fg-3 underline-offset-2 hover:decoration-fg"
      >
        Обновить
      </button>
    </p>
  );
}
