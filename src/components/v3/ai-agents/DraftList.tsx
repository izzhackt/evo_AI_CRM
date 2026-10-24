"use client";

import { useState } from "react";

import type { AiAgentDraftRow } from "@/lib/ai-agents/contract";

import { DraftCard } from "./DraftCard";

type Held = Readonly<{ draft: AiAgentDraftRow; index: number }>;

/**
 * Карточки очереди «Черновиков». Решённый черновик не исчезает в тот же миг: после
 * «Одобрить и отправить» страница перечитывается сервером, и в списке «Ждут решения»
 * его уже нет, а вместе с ним пропал бы и ответ «Отправлено» — о сообщении, которое
 * ушло клиенту. Поэтому карточка, по которой здесь принято решение, остаётся на
 * своём месте со статусом и словом результата, пока сотрудник не уйдёт со страницы.
 */
export function DraftList({
  drafts,
  canManage,
  now,
  emptyText,
}: Readonly<{ drafts: readonly AiAgentDraftRow[]; canManage: boolean; now: string; emptyText: string }>) {
  const [held, setHeld] = useState<readonly Held[]>([]);
  const present = new Set(drafts.map((draft) => draft.id));
  const shown = [...drafts];
  for (const item of held) {
    if (!present.has(item.draft.id)) shown.splice(Math.min(item.index, shown.length), 0, item.draft);
  }
  if (shown.length === 0) {
    return (
      <p className="rounded-card border border-border bg-surface px-4 py-4 t-body-compact text-fg-2" data-testid="v3-aia-drafts-empty">{emptyText}</p>
    );
  }
  return (
    <div className="space-y-3">
      {shown.map((draft, index) => (
        <DraftCard
          key={draft.id}
          draft={draft}
          canManage={canManage}
          now={now}
          onDecided={() => setHeld((previous) => (previous.some((item) => item.draft.id === draft.id) ? previous : [...previous, { draft, index }]))}
        />
      ))}
    </div>
  );
}
