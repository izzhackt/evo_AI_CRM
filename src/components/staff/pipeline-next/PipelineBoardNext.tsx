"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { SectionTabs, type SectionTab } from "@/components/kit";
import { LeadSheetNext } from "@/components/staff/pipeline-next/LeadSheetNext";
import { PipelineClosedNotice, type ClosedNotice } from "@/components/staff/pipeline-next/PipelineClosedNotice";
import { PipelineColumn } from "@/components/staff/pipeline-next/PipelineColumn";
import { boardColumns, boardHrefOf, leadLabel } from "@/components/staff/pipeline-next/pipeline-next-model";
import type { PipelineLead, PipelineStage, PipelineStageKey } from "@/components/staff/pipeline-next/types";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { LeadClosureReceipt } from "@/lib/platform-closure-contract";
import type { PlatformSalesOwnerOption } from "@/lib/platform-sales-contract";
import { pipelineReturnHref } from "@/lib/v3/pipeline-return";
import { pipelineWords } from "@/lib/v3/wording";

const CLOSED_HREF = "/pipeline?view=closed";

/** Панель открывается без запроса к серверу, но остаётся в адресе (`?lead=`): обычный переход (колесо, Ctrl) не перехватываем. */
function pushState(event: MouseEvent<HTMLAnchorElement>, href: string): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  window.history.pushState(null, "", href);
  return true;
}

/**
 * Доска «Воронки продаж» нового вида: вкладки этапов (ссылки `?stage=`), колонки этапов и панель лида. Чтения, права, команды,
 * адреса (`stage`, `lead`, `handed`, фильтры) и request_id — те же, что у прежней доски (`Pipeline.tsx`); перетаскивания в продажах
 * нет (этап меняет форма решения в панели), поэтому и здесь его нет.
 */
export function PipelineBoardNext({ stages, leads, allCount, ownerOptions, ownerOptionsHaveMore, actor, actorMembershipId, requestIds, handedExpanded, filteredStage, showOwner, today }: Readonly<{
  stages: readonly PipelineStage[];
  leads: readonly PipelineLead[];
  /** Число лидов в работе у вкладки «Все этапы» — то, что страница показывает в заголовке: при усечённом чтении числа нет (`null`), «нет чтения — нет числа». */
  allCount: number | null;
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  actorMembershipId: string;
  requestIds: Readonly<Record<string, string>>;
  handedExpanded: boolean;
  filteredStage: PipelineStageKey | "all";
  showOwner: boolean;
  today: string;
}>) {
  const search = useSearchParams();
  const pathname = usePathname() ?? "/pipeline";
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState<ClosedNotice | null>(null);
  const [saved, setSaved] = useState<Readonly<{ leadId: string; version: string }> | null>(null);
  const selectedId = search?.get("lead") ?? null;
  const selected = leads.find((lead) => lead.id === selectedId) ?? null;
  // Панель держит последнего лида, пока закрывается: пустая шапка не мигает.
  const [last, setLast] = useState<PipelineLead | null>(selected);
  if (selected && selected !== last) setLast(selected);
  const href = (patch: Readonly<Record<string, string | null>>) => boardHrefOf(pathname, search?.toString() ?? "", patch);
  const columns = boardColumns(stages, leads, filteredStage, handedExpanded);
  const workflowStages = stages.flatMap((stage) => (stage.key === "handed_off" ? [] : [{ key: stage.key, title: stage.title }]));
  const stageOf = (lead: PipelineLead | null) => stages.find((stage) => stage.key === lead?.stageKey);
  const tabs: SectionTab[] = [
    { key: "all", label: "Все этапы", count: allCount, href: href({ stage: null, lead: null }) },
    ...stages.map((stage) => ({ key: stage.key, label: stage.title, count: leads.filter((lead) => lead.stageKey === stage.key).length, href: href({ stage: stage.key, lead: null }) })),
  ];
  const closedHere = closed !== null && !closed.reopened && closed.receipt.leadId === last?.workflow.leadId;
  // Поиск ничего не нашёл: одно пустое состояние вместо «Нет лидов» в каждой колонке (неясно было, пуста ли воронка).
  const query = search?.get("q")?.trim() ?? "";
  const noResults = query !== "" && leads.length === 0;
  // `?lead=` указывает на лида, которого на доске нет (закрыт, передан, старая ссылка из «Сегодня»): сказать, а не молчать.
  const leadMissing = selectedId !== null && selected === null && !closedHere;

  useEffect(() => {
    if (closed) noticeRef.current?.focus();
  }, [closed]);

  const closePanel = () => {
    setSaved(null);
    if (search?.get("lead")) window.history.pushState(null, "", href({ lead: null }));
  };
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (closedHere || !last) return;
    const root = rootRef.current;
    (root?.querySelector<HTMLElement>(`[data-lead-link="${CSS.escape(last.id)}"]`) ?? root?.querySelector<HTMLElement>('[aria-label="Этапы воронки"] a[aria-current="page"]'))?.focus();
  };
  const leadClosed = (lead: PipelineLead, receipt: LeadClosureReceipt) => {
    setClosed({ name: leadLabel(lead), receipt, reopened: false });
    closePanel();
    router.refresh();
  };
  const dismissNotice = () => {
    setClosed(null);
    [...(rootRef.current?.querySelectorAll<HTMLElement>("a[data-lead-link]") ?? [])].find((element) => element.getClientRects().length > 0)?.focus();
  };
  const openLead = (lead: PipelineLead) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (pushState(event, href({ lead: lead.id })) && saved?.leadId !== lead.id) setSaved(null);
  };
  const style = { "--board-cols": columns.length } as CSSProperties;

  return (
    <div ref={rootRef} className="grid min-w-0 gap-4">
      {closed ? <PipelineClosedNotice ref={noticeRef} notice={closed} onDismiss={dismissNotice}
        onReopened={() => { setClosed((notice) => (notice ? { ...notice, reopened: true } : notice)); router.refresh(); }} /> : null}
      {/* «Переданы» — единственный вход к переданным лидам (в «Всех этапах» их колонки нет), поэтому от 42rem вкладка прилипает к правому
          краю ряда и не уходит под затухание на ноутбуке (15.11.2026); на телефоне — на своём месте в ряду, который листают пальцем. */}
      <SectionTabs label="Этапы воронки" tabs={tabs} value={filteredStage} pinnedKey="handed_off" />
      {leadMissing ? (
        <p role="status" className="flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2" data-testid="v3-pipeline-lead-missing">
          {pipelineWords.leadMissing}
          <Link href={CLOSED_HREF} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">{pipelineWords.closedLink}</Link>
        </p>
      ) : null}
      {noResults ? (
        <div className="grid justify-items-start gap-2 py-6" data-testid="v3-pipeline-no-results">
          <p role="status" className="t-body text-fg">{pipelineWords.noResults(query)}</p>
          <Link href={href({ q: null, lead: null })} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">{pipelineWords.resetSearch}</Link>
        </div>
      ) : <div role="group" aria-label="Воронка продаж" data-testid="v3-pipeline-board" data-focus={filteredStage} style={style}
        className={filteredStage === "all" ? "grid min-w-0 gap-3 @[43.75rem]:grid-rows-[auto_1fr] @[43.75rem]:overflow-x-auto @[43.75rem]:[grid-template-columns:repeat(var(--board-cols),minmax(150px,1fr))]" : "grid min-w-0 gap-3"}>
        {columns.map((column) => (
          <PipelineColumn key={column.stage.key} column={column} spread={filteredStage !== "all"} selectedId={selectedId} showOwner={showOwner} today={today}
            hrefFor={(lead) => href({ lead: lead.id })} openLead={openLead} handedExpanded={handedExpanded}
            handedHref={(expanded) => href({ handed: expanded ? "all" : null })} />
        ))}
      </div>}
      {last ? (
        <LeadSheetNext lead={last} open={selected !== null} today={today} stage={stageOf(last)} workflowStages={workflowStages} ownerOptions={ownerOptions}
          ownerOptionsHaveMore={ownerOptionsHaveMore} actor={actor} actorMembershipId={actorMembershipId} requestId={requestIds[last.id] ?? ""}
          returnTo={pipelineReturnHref(search)} saved={saved?.leadId === last.id && saved.version !== last.workflow.workflowVersion}
          onClose={closePanel} onSaved={() => setSaved({ leadId: last.id, version: last.workflow.workflowVersion })}
          onLeadClosed={(receipt) => leadClosed(last, receipt)} onCloseAutoFocus={returnFocus} />
      ) : null}
    </div>
  );
}
