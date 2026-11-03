"use client";

import { useMemo } from "react";

import { DataTable, type DataTableColumn } from "@/components/kit";
import { AI_AGENT_TOOL_LABELS, type AiAgentActionRow } from "@/lib/ai-agents/contract";
import { actionArgsWords, formatClockRu, toolErrorWords } from "@/lib/v3/ai-agents-view";

const RESULT_WORDS = { ok: "готово", error: "ошибка", denied: "отказано" } as const;
const resultWords = (action: AiAgentActionRow) => `${RESULT_WORDS[action.resultStatus]}${action.errorCode ? ` · ${toolErrorWords(action.errorCode)}` : ""}`;

/** Действия агента в запуске: таблица с поиском и страницами; неудавшиеся — выше (порядок задаёт вызывающий), итог словом. */
export function NextRunActionsTable({ actions, startedAt }: Readonly<{ actions: readonly AiAgentActionRow[]; startedAt: string }>) {
  const columns = useMemo<DataTableColumn<AiAgentActionRow>[]>(() => [
    { id: "at", header: "Время", accessorFn: (action) => action.at, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-fg-3">{formatClockRu(row.original.at, startedAt)}</span>, meta: { label: "Время", mobile: "hide" } },
    { id: "tool", header: "Инструмент", accessorFn: (action) => AI_AGENT_TOOL_LABELS[action.tool] ?? action.tool, meta: { label: "Инструмент", mobile: "title" }, enableHiding: false },
    { id: "args", header: "Запрос", accessorFn: (action) => actionArgsWords(action.argsSummary) || "—", cell: ({ row }) => <span className="block max-w-[22rem] break-words text-fg-2">{actionArgsWords(row.original.argsSummary) || "—"}</span>, meta: { label: "Запрос" } },
    { id: "result", header: "Итог", accessorFn: resultWords, cell: ({ row }) => <span className={row.original.resultStatus === "ok" ? "text-fg-2" : "text-danger"}>{resultWords(row.original)}</span>, meta: { label: "Итог" } },
  ], [startedAt]);
  return <DataTable label="Действия агента в запуске" data={actions} columns={columns} getRowId={(action) => action.id} searchPlaceholder="Поиск по действиям" pageSize={25} columnMenu={false} />;
}
