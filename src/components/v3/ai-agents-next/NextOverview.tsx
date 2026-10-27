import Link from "next/link";
import type { ReactNode } from "react";

import { KeyFacts, StatTile, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { AiAgentDetail, AiAgentDigestRow } from "@/lib/ai-agents/contract";
import { aiAgentHref, chartBarRows, chartToolRows, describeSchedule, formatUsdCents, successShare } from "@/lib/v3/ai-agents-view";

import { AnswerActions } from "@/components/v3/ai-agents/AnswerActions";
import { DayBars } from "@/components/v3/ai-agents/Charts";
import { NextDigest } from "./NextDigest";
import { OlderDigestsSheet, ToolsSheet } from "./NextOverviewSheets";

/**
 * «Обзор» в «Новом виде»: плитки за 7 дней, последний отчёт, два графика и карточка «Работа агента» (расписание,
 * события; инструменты и прошлые отчёты — в панелях). У агента, который ещё не работал, десяти пустых блоков нет:
 * либо шаги запуска (`setup`), либо «Запусков ещё не было» и кнопка. Данные и условия те же, что у прежнего «Обзора».
 */
export function NextOverview({
  detail,
  digests,
  now,
  canRun = true,
  setup = null,
  canMakeTasks = false,
}: Readonly<{ detail: AiAgentDetail; digests: readonly AiAgentDigestRow[]; now: string; canRun?: boolean; setup?: ReactNode; canMakeTasks?: boolean }>) {
  const { stats, charts } = detail;
  const share = successShare(stats);
  const toolRows = chartToolRows(charts.actionsByTool);
  const last = detail.lastDigest;
  const older = digests.filter((digest) => digest.id !== last?.id);
  const triggers = [detail.triggerWebsiteLead ? "новая заявка с сайта" : null, detail.triggerWhatsappInbound ? "новое сообщение в WhatsApp" : null].filter(Boolean);
  const hasSchedule = detail.scheduleCron !== null;
  // Выключенный агент не запускается ни по расписанию, ни по событиям: одна строка под обоими фактами, а не по одной под каждым.
  const off = !detail.enabled && (hasSchedule || triggers.length > 0) ? <p className="t-meta text-warn" data-testid="v3-aia-off">Агент выключен — не запускается.</p> : null;
  const facts = [hasSchedule, triggers.length > 0].filter(Boolean).length;
  const hasWork = hasSchedule || triggers.length > 0 || toolRows.length > 0 || older.length > 0;
  const work = hasWork ? (
    <WidgetCard
      title="Работа агента"
      footer={toolRows.length > 0 || older.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {toolRows.length > 0 ? <ToolsSheet rows={toolRows} /> : null}
          {older.length > 0 ? <OlderDigestsSheet digests={older} now={now} /> : null}
        </div>
      ) : undefined}
    >
      <div className="grid gap-3">
        {/* Один факт занимает всю ширину, два — по половине: пустая половина на телефоне не нужна. */}
        <KeyFacts columns={facts > 1 ? 2 : 1} facts={[
          { label: "Расписание", value: hasSchedule ? describeSchedule(detail.scheduleCron, detail.scheduleTz) : null },
          { label: "Реагирует на события", value: triggers.length > 0 ? triggers.join(", ") : null },
        ]} />
        {off}
      </div>
    </WidgetCard>
  ) : null;

  if (stats.lastRunAt === null) {
    return (
      <div className="grid gap-4" data-testid="v3-aia-overview">
        {setup}
        {canRun ? (
          <div data-testid="v3-aia-first-run">
            <WidgetCard title="Запусков ещё не было" actions={<Button variant="outline" asChild><Link href={aiAgentHref(detail.key, { tab: "command" })}>Поручить первую задачу</Link></Button>} />
          </div>
        ) : null}
        {work}
      </div>
    );
  }
  return (
    <div className="grid gap-4" data-testid="v3-aia-overview">
      {setup}
      <div role="group" aria-label="Показатели за 7 дней" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        <StatTile label="Запусков за 7 дней" value={stats.runs7d} hint={stats.runsRunning > 0 ? `сейчас работает: ${stats.runsRunning}` : undefined} />
        <StatTile label="Без ошибок" value={share === null ? null : `${share}%`} hint={share === null ? "нет запусков" : stats.failed7d > 0 ? `с ошибкой: ${stats.failed7d}` : undefined} />
        <StatTile label="Расход за 7 дней" value={formatUsdCents(stats.costCents7d)} />
        <StatTile label="Ждут решения" value={stats.draftsPending} href={stats.draftsPending > 0 ? aiAgentHref(detail.key, { tab: "drafts" }) : undefined} />
      </div>
      {last || detail.key === "director" ? (
        <WidgetCard
          title="Последний отчёт"
          actions={!last && canRun ? <Button variant="outline" asChild><Link href={aiAgentHref(detail.key, { tab: "command" })}>Попросить отчёт</Link></Button> : undefined}
          footer={last ? <AnswerActions text={last.bodyMd} allowTask={canMakeTasks} /> : undefined}
        >
          {last ? <NextDigest digest={last} now={now} showTitle /> : <p className="t-body-compact text-fg-2" data-testid="v3-aia-no-digest">Отчётов пока нет.</p>}
        </WidgetCard>
      ) : null}
      <div className="grid gap-4 @4xl:grid-cols-2">
        <WidgetCard title="Запуски по дням">
          <DayBars rows={chartBarRows(charts.runsPerDay, "count")} mode="count" caption="Запуски по дням" emptyText="За 30 дней запусков не было." tableHead={["День", "Запусков", "С ошибкой"]} />
        </WidgetCard>
        <WidgetCard title="Расход по дням">
          <DayBars rows={chartBarRows(charts.spendPerDay, "costCents")} mode="money" caption="Расход по дням" emptyText="Расхода за 30 дней нет." tableHead={["День", "Расход"]} />
        </WidgetCard>
      </div>
      {work}
    </div>
  );
}
