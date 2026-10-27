"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { HistoryIcon } from "lucide-react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AI_AGENT_RUN_STATUS_LABELS, type AiAgentKey, type AiAgentRunRow } from "@/lib/ai-agents/contract";
import { AI_AGENT_DAILY_BUDGET_REACHED_CODE } from "@/lib/ai-agents/daily-cap";
import { AI_AGENT_RUNS_MAX, AI_AGENT_RUNS_STEP, aiAgentHref, durationWords, formatDateTimeRu, formatUsdCents, plainPreview, pluralRu, runErrorWords, runOriginLabel, runStatusTone } from "@/lib/v3/ai-agents-view";

import { NextRunSheetBody, runSheetTitle } from "./NextRunSheet";

/** Главная строка записи: что поручили; итог — второй строкой. Дневной лимит и ошибка говорят причину словами, а не пустым итогом. */
function words(run: AiAgentRunRow): { primary: string; secondary: string } {
  const prompt = plainPreview(run.promptPreview, 160);
  const outcome = run.status === "failed" || run.errorCode === AI_AGENT_DAILY_BUDGET_REACHED_CODE ? runErrorWords(run.errorCode, run.errorMessage) : plainPreview(run.summary, 220);
  return { primary: prompt || outcome, secondary: prompt ? outcome : "" };
}

function columnsFor(now: string, viewerName?: string): DataTableColumn<AiAgentRunRow>[] {
  return [
    { id: "when", header: "Когда", accessorFn: (run) => run.startedAt, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDateTimeRu(row.original.startedAt, now)}</span>, meta: { label: "Когда" } },
    {
      id: "task", header: "Поручение", meta: { label: "Поручение", mobile: "title" }, enableHiding: false,
      accessorFn: (run) => `${words(run).primary} ${words(run).secondary}`,
      cell: ({ row }) => {
        const { primary, secondary } = words(row.original);
        return (
          <span className="block min-w-[16rem] max-w-[34rem]">
            <span className="line-clamp-1 break-words text-fg">{primary || "—"}</span>
            {secondary ? <span className="line-clamp-1 break-words t-meta text-fg-3">{secondary}</span> : null}
          </span>
        );
      },
    },
    { id: "status", header: "Состояние", accessorFn: (run) => AI_AGENT_RUN_STATUS_LABELS[run.status], cell: ({ row }) => <StatusBadge label={AI_AGENT_RUN_STATUS_LABELS[row.original.status]} tone={runStatusTone(row.original.status)} />, meta: { label: "Состояние" } },
    { id: "origin", header: "Кто запустил", accessorFn: (run) => runOriginLabel(run, viewerName), meta: { label: "Кто запустил", mobile: "hide", wide: true } },
    { id: "cost", header: "Время и расход", accessorFn: (run) => run.costCents, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{durationWords(row.original.durationSeconds)} · {formatUsdCents(row.original.costCents)}</span>, meta: { label: "Время и расход", align: "end" } },
    {
      id: "steps", header: "Действия", accessorFn: (run) => run.actionsCount, meta: { label: "Действия", mobile: "hide", align: "end" },
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.actionsCount}{row.original.draftsCount > 0 ? ` · ${row.original.draftsCount} ${pluralRu(row.original.draftsCount, ["черновик", "черновика", "черновиков"])}` : ""}</span>,
    },
  ];
}

/**
 * «История работы» в «Новом виде»: таблица запусков (поиск, сортировка, страницы; на телефоне — карточки). Строка
 * открывает панель запуска; полная хроника и действия агента — по ссылке в панели (адрес `?run=` прежний).
 * «Показать ещё» — тот же шаг чтения по адресу `?limit=`, что и раньше. Страницы таблицы выключены: сервер уже отдал
 * «последние N», и второй листатель с «из N» назвал бы общим числом то, что просто загружено; пока есть ещё, экран так и
 * говорит («Показаны последние 30 запусков»), а поиск назван поиском среди показанных.
 */
export function NextRuns({
  agentKey, runs, hasMore, limit, now, viewerName, canRun = false, canAct = false, canStopAny = false,
}: Readonly<{ agentKey: AiAgentKey; runs: readonly AiAgentRunRow[]; hasMore: boolean; limit: number; now: string; viewerName?: string; canRun?: boolean; canAct?: boolean; canStopAny?: boolean }>) {
  const columns = useMemo(() => columnsFor(now, viewerName), [now, viewerName]);
  // Последняя выбранная запись остаётся в состоянии и после закрытия: панель уезжает 200 мс, и пустой она не мигает.
  const [current, setCurrent] = useState<AiAgentRunRow | null>(null);
  const [open, setOpen] = useState(false);
  const nextLimit = Math.min(AI_AGENT_RUNS_MAX, limit + AI_AGENT_RUNS_STEP);
  const empty = (
    <EmptyState icon={HistoryIcon} title="Запусков ещё не было" action={canRun ? <Button variant="outline" asChild><Link href={aiAgentHref(agentKey, { tab: "command" })}>Поручить</Link></Button> : undefined} />
  );
  return (
    <div data-testid="v3-aia-runs" className="grid min-w-0 gap-3">
      <DataTable label="История работы агента" data={runs} columns={columns} getRowId={(run) => run.id} onRowClick={(run) => { setCurrent(run); setOpen(true); }} getRowLabel={(run) => words(run).primary || "Запуск"} searchPlaceholder={hasMore ? "Поиск среди показанных" : "Поиск по поручениям"} paginate={false} empty={empty} />
      {hasMore ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="v3-aia-runs-more">
          {limit < AI_AGENT_RUNS_MAX ? <Button variant="outline" asChild><Link href={aiAgentHref(agentKey, { tab: "runs", limit: nextLimit })} scroll={false}>Показать ещё</Link></Button> : null}
          <p className="t-meta text-fg-3">Показаны последние {runs.length} {pluralRu(runs.length, ["запуск", "запуска", "запусков"])}</p>
        </div>
      ) : null}
      <DetailSheet open={open} onOpenChange={setOpen} title={current ? runSheetTitle(current) : "Запуск"} description={current ? `${formatDateTimeRu(current.startedAt, now)} · ${runOriginLabel(current, viewerName)}` : undefined}>
        {current ? <NextRunSheetBody agentKey={agentKey} run={current} viewerName={viewerName} canAct={canAct} canStopAny={canStopAny} canRun={canRun} /> : null}
      </DetailSheet>
    </div>
  );
}
