"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable, DetailSheet, EmptyState, StatusBadge, type DataTableColumn } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AI_AGENT_RUN_STATUS_LABELS, type AiAgentKey, type AiAgentRunRow } from "@/lib/ai-agents/contract";
import { AI_AGENT_DAILY_BUDGET_REACHED_CODE } from "@/lib/ai-agents/daily-cap";
import { AI_AGENT_RUNS_MAX, AI_AGENT_RUNS_STEP, aiAgentHref, aiAgentRunIsActive, durationWords, formatDateTimeRu, formatUsdCents, pluralRu, runErrorWords, runIsSystemEvent, runOriginLabel, runStatusTone, runTextPreview } from "@/lib/v3/ai-agents-view";

import { FEW_ROWS } from "./buttons";
import { NextAgentMascot } from "./NextAgentMascot";
import { NextRunSheetBody, runSheetTitle } from "./NextRunSheet";

/**
 * Главная строка записи: что поручили; итог — второй строкой. Дневной лимит и ошибка говорят причину словами, а не пустым итогом.
 * Поручение запуска по событию пишет система — его строка не рисует, событие названо в «Кто запустил» (07.11.2026).
 */
function words(run: AiAgentRunRow): { primary: string; secondary: string } {
  const prompt = runIsSystemEvent(run) ? "" : runTextPreview(run.promptPreview, 160);
  const outcome = run.status === "failed" || run.errorCode === AI_AGENT_DAILY_BUDGET_REACHED_CODE ? runErrorWords(run.errorCode, run.errorMessage) : runTextPreview(run.summary, 220);
  return { primary: prompt || outcome, secondary: prompt ? outcome : "" };
}

/** «Время и расход» без «– · 0,00 $»: идущий запуск — «идёт», неизвестное время не рисуется. */
function spendWords(run: AiAgentRunRow): string {
  if (aiAgentRunIsActive(run.status)) return "идёт";
  return run.durationSeconds === null ? formatUsdCents(run.costCents) : `${durationWords(run.durationSeconds)} · ${formatUsdCents(run.costCents)}`;
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
            {/* Пусто — словами, а не прочерком (13.11.2026): итог идущего запуска ещё впереди. */}
            <span className={`line-clamp-1 break-words ${primary ? "text-fg" : "text-fg-3"}`}>{primary || (aiAgentRunIsActive(row.original.status) ? "Итог будет, когда агент закончит" : "Без итога")}</span>
            {secondary ? <span className="line-clamp-1 break-words t-meta text-fg-3">{secondary}</span> : null}
          </span>
        );
      },
    },
    { id: "status", header: "Состояние", accessorFn: (run) => AI_AGENT_RUN_STATUS_LABELS[run.status], cell: ({ row }) => <StatusBadge label={AI_AGENT_RUN_STATUS_LABELS[row.original.status]} tone={runStatusTone(row.original.status)} />, meta: { label: "Состояние" } },
    { id: "origin", header: "Кто запустил", accessorFn: (run) => runOriginLabel(run, viewerName), meta: { label: "Кто запустил", mobile: "hide", wide: true } },
    { id: "cost", header: "Время и расход", accessorFn: (run) => run.costCents, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{spendWords(row.original)}</span>, meta: { label: "Время и расход", align: "end" } },
    {
      // «Шагов», а не «Действия» (13.11.2026): колонка «Действия» читалась как кнопки. Ноль шагов не пишется.
      id: "steps", header: "Шагов", accessorFn: (run) => run.actionsCount, meta: { label: "Шагов", mobile: "hide", align: "end" },
      cell: ({ row }) => {
        const { actionsCount, draftsCount } = row.original;
        const words = [actionsCount > 0 ? String(actionsCount) : null, draftsCount > 0 ? `${draftsCount} ${pluralRu(draftsCount, ["черновик", "черновика", "черновиков"])}` : null].filter(Boolean).join(" · ");
        return <span className="whitespace-nowrap tabular-nums">{words}</span>;
      },
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
  // Колонка «Шагов», пустая во всех строках, ничего не сообщает — её нет.
  const anySteps = runs.some((run) => run.actionsCount > 0 || run.draftsCount > 0);
  const columns = useMemo(() => columnsFor(now, viewerName).filter((column) => anySteps || column.id !== "steps"), [now, viewerName, anySteps]);
  // Последняя выбранная запись остаётся в состоянии и после закрытия: панель уезжает 200 мс, и пустой она не мигает.
  const [current, setCurrent] = useState<AiAgentRunRow | null>(null);
  const [open, setOpen] = useState(false);
  const nextLimit = Math.min(AI_AGENT_RUNS_MAX, limit + AI_AGENT_RUNS_STEP);
  // Пустая история — с маскотом агента, как пустые «На одобрение» и чат (13.11.2026).
  const empty = (
    <div className="grid justify-items-center pt-6">
      <NextAgentMascot agentKey={agentKey} size="lg" />
      <EmptyState className="pt-2" title="Запусков ещё не было" action={canRun ? <Button variant="outline" asChild><Link href={aiAgentHref(agentKey, { tab: "command" })}>Поручить</Link></Button> : undefined} />
    </div>
  );
  // Поиск и «Колонки» над парой строк — лишний ряд: они появляются, когда строк больше, чем видно глазом сразу.
  const few = runs.length <= FEW_ROWS && !hasMore;
  return (
    <div data-testid="v3-aia-runs" className="grid min-w-0 gap-3">
      <DataTable label="История работы агента" data={runs} columns={columns} getRowId={(run) => run.id} onRowClick={(run) => { setCurrent(run); setOpen(true); }} getRowLabel={(run) => words(run).primary || "Запуск"} searchPlaceholder={hasMore ? "Поиск среди показанных" : "Поиск по поручениям"} searchable={!few} columnMenu={!few} paginate={false} empty={empty} />
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
