"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { cn } from "@/components/ui";
import { Pill } from "@/components/v3/Pill";
import {
  moveCasePipelineAction,
  type MoveCasePipelineActionStatus,
} from "@/lib/platform-admissions-pipeline-actions";
import {
  ADMISSIONS_PIPELINE_TAB_STAGES,
  admissionsPipelineTabOf,
  type AdmissionsPipelineRow,
  type AdmissionsPipelineStage,
  type AdmissionsPipelineTab,
} from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage, admissionsPipelineTab, caseChatAwaitState, country as countryLabel } from "@/lib/v3/wording";

/** Full sentences only — «saved» needs none, it is silent. */
const MESSAGES: Record<Exclude<MoveCasePipelineActionStatus, "saved">, string> = {
  invalid: "Не удалось подготовить перемещение.",
  forbidden: "У вашей роли нет прав на это перемещение.",
  request_conflict: "Команда уже использована. Повторите действие.",
  unavailable: "Supabase недоступен. Перемещение не подтверждено.",
};

type MoveTarget =
  | Readonly<{ remove: true }>
  | Readonly<{ remove?: false; stage: AdmissionsPipelineStage }>;

function caseHref(studentCaseId: string): string {
  return `/v3/profile?case=${studentCaseId}&tab=route`;
}

function boardHref(basePath: string, params: Readonly<Record<string, string | null>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== "") search.set(key, value);
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function CardMenu({
  row,
  onMove,
}: Readonly<{
  row: AdmissionsPipelineRow;
  onMove: (target: MoveTarget) => void;
}>) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  return (
    <details ref={ref} className="relative shrink-0" data-testid="v3-admissions-pipeline-move">
      <summary
        aria-label="Действия с делом"
        className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg [&::-webkit-details-marker]:hidden"
      >
        ⋯
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-56 rounded-ctl border border-border bg-surface p-1 shadow-evo-lg">
        <p className="px-2 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wide text-fg-3">Переместить в…</p>
        {(["admission", "visa"] as const satisfies readonly AdmissionsPipelineTab[]).map((tabKey) => {
          const stages = ADMISSIONS_PIPELINE_TAB_STAGES[tabKey].filter((stage) => stage !== row.pipelineStage);
          if (stages.length === 0) return null;
          return (
            <div key={tabKey}>
              <p className="px-2 pt-1 text-2xs text-fg-3">{admissionsPipelineTab(tabKey)}</p>
              {stages.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  className="block w-full rounded-nav px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2"
                  onClick={() => { close(); onMove({ stage }); }}
                >
                  {admissionsPipelineStage(stage)}
                </button>
              ))}
            </div>
          );
        })}
        <hr className="my-1 border-border" />
        <button
          type="button"
          className="block w-full rounded-nav px-2 py-1.5 text-left text-sm text-fg hover:bg-surface-2"
          onClick={() => { close(); onMove({ remove: true }); }}
        >
          Убрать из воронки
        </button>
        <Link
          href={caseHref(row.studentCaseId)}
          prefetch={false}
          className="block rounded-nav px-2 py-1.5 text-sm text-fg hover:bg-surface-2"
        >
          Открыть дело
        </Link>
      </div>
    </details>
  );
}

function BoardCard({
  row,
  showCurator,
  draggable,
  onMove,
  onDragStart,
}: Readonly<{
  row: AdmissionsPipelineRow;
  showCurator: boolean;
  draggable: boolean;
  onMove: (target: MoveTarget) => void;
  onDragStart?: () => void;
}>) {
  const secondLine = [countryLabel(row.targetCountry), row.primaryInstitutionName]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  return (
    <article
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.setData("text/plain", row.studentCaseId);
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      data-testid="v3-admissions-pipeline-card"
      data-student-case-id={row.studentCaseId}
      className={cn(
        "rounded-ctl border border-border bg-surface px-3 py-2.5",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <Link
            href={caseHref(row.studentCaseId)}
            prefetch={false}
            className="block truncate text-base font-semibold leading-5 text-fg underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {row.studentDisplayName}
          </Link>
          {secondLine ? <p className="mt-0.5 truncate text-sm text-fg-2">{secondLine}</p> : null}
          {showCurator && row.currentCuratorDisplayName ? (
            <p className="mt-0.5 truncate text-2xs text-fg-3">{row.currentCuratorDisplayName}</p>
          ) : null}
          {row.awaitingAck || row.overdue || row.needsReply ? (
            <p className="mt-1.5 flex flex-wrap gap-1.5">
              {row.awaitingAck ? <Pill tone="warn">Ожидает принятия</Pill> : null}
              {row.overdue ? <Pill tone="danger">Просрочено</Pill> : null}
              {row.needsReply ? (
                <Link href={`/v3/messages?case=${row.studentCaseId}`} className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  <Pill tone="danger">{caseChatAwaitState("needs_reply")}</Pill>
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
        <CardMenu row={row} onMove={onMove} />
      </div>
    </article>
  );
}

export function AdmissionsPipelineBoard({
  rows,
  truncated,
  boardUnavailable,
  tab,
  query,
  basePath = "/v3/admissions-pipeline",
}: Readonly<{
  rows: readonly AdmissionsPipelineRow[];
  truncated: boolean;
  boardUnavailable: boolean;
  tab: AdmissionsPipelineTab;
  query: Readonly<{ q: string | null; country: string | null; curator: string | null }>;
  basePath?: string;
}>) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const [cards, setCards] = useState(rows);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<AdmissionsPipelineStage | null>(null);
  const [crossTabHint, setCrossTabHint] = useState<Readonly<{ studentCaseId: string; tab: AdmissionsPipelineTab }> | null>(null);
  const [narrowStage, setNarrowStage] = useState<AdmissionsPipelineStage>(ADMISSIONS_PIPELINE_TAB_STAGES[tab][0]);
  const [, startTransition] = useTransition();

  // Re-derive local (optimistic) state from fresh server props during render
  // — not in a useEffect — the pattern react.dev recommends for "adjusting
  // state when a prop changes": React applies both setState calls before the
  // browser paints, with no extra visible render pass.
  const [previousRows, setPreviousRows] = useState(rows);
  if (rows !== previousRows) {
    setPreviousRows(rows);
    setCards(rows);
  }
  const [previousTab, setPreviousTab] = useState(tab);
  if (tab !== previousTab) {
    setPreviousTab(tab);
    setNarrowStage(ADMISSIONS_PIPELINE_TAB_STAGES[tab][0]);
  }

  const showCurator = new Set(cards.map((row) => row.currentCuratorMembershipId).filter(Boolean)).size > 1;
  const tabStages = ADMISSIONS_PIPELINE_TAB_STAGES[tab];
  const boardEmpty = cards.length === 0;

  function moveCard(studentCaseId: string, target: MoveTarget) {
    const previousRow = cards.find((row) => row.studentCaseId === studentCaseId);
    if (!previousRow) return;
    const previousStage = previousRow.pipelineStage;
    setError(null);
    setCrossTabHint(null);
    setCards((current) => target.remove
      ? current.filter((row) => row.studentCaseId !== studentCaseId)
      : current.map((row) => (row.studentCaseId === studentCaseId ? { ...row, pipelineStage: target.stage } : row)));
    const requestId = crypto.randomUUID();
    startTransition(() => {
      void moveCasePipelineAction(
        target.remove
          ? { studentCaseId, requestId, remove: true }
          : { studentCaseId, requestId, stage: target.stage },
      ).then((result) => {
        if (result.status !== "saved") {
          // Revert only the moved card: a whole-board snapshot restore would
          // silently wipe concurrent moves that already succeeded.
          setCards((current) => {
            const stillThere = current.some((row) => row.studentCaseId === studentCaseId);
            if (target.remove && !stillThere) {
              return [...current, previousRow];
            }
            return current.map((row) =>
              row.studentCaseId === studentCaseId ? { ...row, pipelineStage: previousStage } : row,
            );
          });
          setError(MESSAGES[result.status]);
          return;
        }
        if (!target.remove && admissionsPipelineTabOf(previousStage) !== admissionsPipelineTabOf(target.stage)) {
          setCrossTabHint({ studentCaseId, tab: admissionsPipelineTabOf(target.stage) });
        }
      });
    });
  }

  const tabHref = (nextTab: AdmissionsPipelineTab) =>
    boardHref(basePath, { tab: nextTab, q: query.q, country: query.country, curator: query.curator });

  return (
    <div data-testid="v3-admissions-pipeline-board">
      {error ? (
        <p role="alert" className="mb-3 rounded-ctl border border-danger bg-danger-weak px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <nav aria-label="Разделы воронки поступления" className="mb-4 inline-flex rounded-ctl border border-border bg-surface p-0.5">
        {(["admission", "visa"] as const satisfies readonly AdmissionsPipelineTab[]).map((tabKey) => (
          <Link
            key={tabKey}
            href={tabHref(tabKey)}
            prefetch={false}
            aria-current={tab === tabKey ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center whitespace-nowrap rounded-nav px-3 text-sm",
              tab === tabKey ? "bg-accent font-medium text-on-accent" : "text-fg-2 hover:bg-surface-2",
            )}
          >
            {admissionsPipelineTab(tabKey)}
          </Link>
        ))}
      </nav>

      {truncated ? (
        <p className="mb-3 text-2xs leading-4 text-fg-3">показаны первые 400</p>
      ) : null}

      {boardUnavailable ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-danger">Не удалось загрузить воронку поступления.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={retrying}
              onClick={() => startRetry(() => router.refresh())}
              className="inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {retrying ? "Загрузка…" : "Повторить"}
            </button>
            <Link href="/v3/profile" className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
              Открыть студентов
            </Link>
          </div>
        </div>
      ) : boardEmpty ? (
        <p className="px-1 py-10 text-center text-sm text-fg-3">Дел в работе нет.</p>
      ) : (
        <>
          {/* Narrow screens: stage picker + single-column list, moves via the card menu only. */}
          <div className="@2xl:hidden">
            <label className="mb-3 flex items-center gap-2 text-sm text-fg-2">
              Этап
              <select
                value={narrowStage}
                onChange={(event) => setNarrowStage(event.target.value as AdmissionsPipelineStage)}
                className="min-h-11 flex-1 rounded-ctl border border-control-edge bg-surface px-2.5 text-sm text-fg"
              >
                {tabStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {admissionsPipelineStage(stage)} ({cards.filter((row) => row.pipelineStage === stage).length})
                  </option>
                ))}
              </select>
            </label>
            <ul className="flex flex-col gap-2">
              {cards.filter((row) => row.pipelineStage === narrowStage).map((row) => (
                <li key={row.studentCaseId}>
                  <BoardCard row={row} showCurator={showCurator} draggable={false} onMove={(target) => moveCard(row.studentCaseId, target)} />
                  {crossTabHint?.studentCaseId === row.studentCaseId ? (
                    <CrossTabHintLink hint={crossTabHint} tabHref={tabHref} />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {/* Wide screens: full kanban board, drag-and-drop between columns. */}
          <div role="group" aria-label="Воронка поступления" className="hidden max-w-full overflow-x-auto rounded-card @2xl:block">
            <ol className="flex flex-col gap-3 @2xl:w-max @2xl:flex-row @2xl:items-start">
              {tabStages.map((stage) => {
                const inStage = cards.filter((row) => row.pipelineStage === stage);
                return (
                  <li
                    key={stage}
                    onDragOver={(event) => { event.preventDefault(); setDragOverStage(stage); }}
                    onDragLeave={() => setDragOverStage((current) => (current === stage ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOverStage(null);
                      const studentCaseId = event.dataTransfer.getData("text/plain");
                      if (studentCaseId) moveCard(studentCaseId, { stage });
                    }}
                    className={cn(
                      "min-w-0 rounded-card bg-surface-2 @2xl:w-[280px] @2xl:shrink-0",
                      dragOverStage === stage && "outline outline-2 outline-offset-[-2px] outline-accent",
                    )}
                  >
                    <div className="flex flex-col rounded-card @2xl:max-h-[70dvh] @2xl:overflow-y-auto">
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface-2 px-3.5 pb-2 pt-3">
                        <h3 className="truncate text-sm font-semibold text-fg">{admissionsPipelineStage(stage)}</h3>
                        <span className="shrink-0 font-mono text-2xs text-fg-3">{inStage.length}</span>
                      </div>
                      <ul className="flex flex-col gap-2 px-2.5 pb-2.5">
                        {inStage.map((row) => (
                          <li key={row.studentCaseId}>
                            <BoardCard row={row} showCurator={showCurator} draggable onMove={(target) => moveCard(row.studentCaseId, target)} />
                            {crossTabHint?.studentCaseId === row.studentCaseId ? (
                              <CrossTabHintLink hint={crossTabHint} tabHref={tabHref} />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

function CrossTabHintLink({
  hint,
  tabHref,
}: Readonly<{
  hint: Readonly<{ studentCaseId: string; tab: AdmissionsPipelineTab }>;
  tabHref: (tab: AdmissionsPipelineTab) => string;
}>) {
  return (
    <Link
      href={tabHref(hint.tab)}
      prefetch={false}
      className="mt-1 inline-flex min-h-6 items-center px-1 text-2xs font-semibold text-accent-text underline underline-offset-4"
    >
      Открыть в «{admissionsPipelineTab(hint.tab)}»
    </Link>
  );
}
