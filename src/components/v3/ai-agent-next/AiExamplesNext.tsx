"use client";

import { useState } from "react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, WidgetCard, type DataTableColumn } from "@/components/kit";
import { AiActionForm } from "@/components/v3/ai-agent/AiActionForm";
import { deleteAiExampleAction } from "@/lib/platform-ai-agent-actions";
import { aiDateTime } from "@/lib/v3/ai-agent";
import { AI_EXAMPLE_STALE_LABEL, type AiGoldenExample } from "@/lib/v3/ai-agent-knowledge";
import type { AiRead } from "@/lib/v3/ai-agent-source";

import { AI_OUTLINE_BUTTON } from "./ai-buttons";

const staleWord = (example: AiGoldenExample) => (example.valid ? "действует" : `нужна проверка — ${example.staleReason ? AI_EXAMPLE_STALE_LABEL[example.staleReason] : "знания изменились"}`);

const columns: DataTableColumn<AiGoldenExample>[] = [
  {
    id: "question", accessorFn: (example) => `${example.question} ${example.answer}`, header: "Вопрос", meta: { mobile: "title", label: "Вопрос" }, enableHiding: false,
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block font-medium text-fg [overflow-wrap:anywhere]">{row.original.question}</span>
        <span className="block max-w-prose truncate t-meta text-fg-3">{row.original.answer}</span>
      </span>
    ),
  },
  { id: "state", accessorFn: (example) => staleWord(example), header: "Состояние", cell: ({ row }) => <span data-testid="v3-ai-example" data-valid={row.original.valid || undefined}><StatusBadge tone={row.original.valid ? "ok" : "warn"} label={staleWord(row.original)} wrap /></span> },
  { id: "confirmed", accessorFn: (example) => example.confirmedAt, header: "Подтверждён", meta: { wide: true }, cell: ({ row }) => <span className="tabular-nums">{row.original.confirmedByName ? `${row.original.confirmedByName} · ` : ""}{aiDateTime(row.original.confirmedAt)}</span> },
];

/**
 * Эталонные ответы Лаборатории (план §8): подтверждённые сотрудником примеры, которые агент находит по похожим вопросам. Пример действует,
 * пока не изменились его документы, «Правила общения» и модель (273); иначе — «нужна проверка», и агент его не берёт (это за «?»).
 * Строка открывает панель с вопросом и ответом целиком и «Удалить пример» (тот же запрос, что раньше).
 */
export function AiExamplesNext({ read, preview, requestIds }: Readonly<{ read: AiRead<Readonly<{ items: readonly AiGoldenExample[]; hasMore: boolean; canManage: boolean }>>; preview: boolean; requestIds: Readonly<Record<string, string>> }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (read.status !== "available") {
    return <WidgetCard title="Эталонные ответы"><p role="alert" className="t-body-compact text-fg-3">Не удалось загрузить эталонные ответы.</p></WidgetCard>;
  }
  const open = read.data.items.find((example) => example.id === openId) ?? null;
  const canDelete = read.data.canManage && !preview;
  return (
    <section aria-label="Эталонные ответы" className="grid min-w-0 gap-3" data-testid="v3-ai-examples">
      <DataTable
        label={`Эталонные ответы · ${read.data.items.length}`}
        data={read.data.items}
        columns={columns}
        getRowId={(example) => example.id}
        getRowLabel={(example) => example.question}
        onRowClick={(example) => setOpenId(example.id)}
        searchPlaceholder="Найти эталонный ответ"
        columnMenu={false}
        empty={<EmptyState title="Эталонных ответов пока нет" description="Они появляются после «Применить» в Лаборатории." />}
      />
      <DetailSheet open={open !== null} onOpenChange={(next) => { if (!next) setOpenId(null); }} title={open?.question ?? "Эталонный ответ"} description={open ? staleWord(open) : undefined}
        help="Пример действует, пока не изменились его документы, «Правила общения» и модель; иначе агент его не берёт. Новые вопросы примерами сами не становятся.">
        {open ? (
          <div className="grid gap-4">
            <p className="v3-ai-example-answer whitespace-pre-wrap t-body-compact text-fg-2">{open.answer}</p>
            <p className="t-meta text-fg-3">{open.confirmedByName ? `${open.confirmedByName} · ` : ""}{aiDateTime(open.confirmedAt)}</p>
            {canDelete && requestIds[open.id] ? (
              <AiActionForm requestId={requestIds[open.id]!} action={deleteAiExampleAction} fields={{ example_id: open.id }} label="Удалить пример" pendingLabel="Удаляю…"
                buttonClassName={AI_OUTLINE_BUTTON} messages={{ saved: "Пример удалён." }} />
            ) : null}
          </div>
        ) : null}
      </DetailSheet>
    </section>
  );
}
