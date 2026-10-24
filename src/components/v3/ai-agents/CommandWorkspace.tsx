"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import type { AiAgentKey, AiAgentRunRow } from "@/lib/ai-agents/contract";
import {
  AI_AGENT_CONVERSATIONS_MAX,
  aiAgentConsoleRestore,
  aiAgentHref,
  conversationPatch,
  conversationPatchChanged,
  mergeConversations,
  type AiAgentConversationPatch,
  type AiAgentConversationRow,
} from "@/lib/v3/ai-agents-view";

import { Console } from "./Console";
import { ConversationList } from "./ConversationList";

/** Адрес вкладки обновляется без перехода: Next связывает `history.replaceState` с `useSearchParams`, страница не перерисовывается сервером. */
function replaceUrl(href: string) {
  try {
    window.history.replaceState(null, "", href);
  } catch {
    /* адрес — удобство (обновление страницы восстановит разговор): чат работает и без него */
  }
}

type Opened = Readonly<{
  /** Ключ `Console`: растёт только по явному выбору разговора или «Новому разговору». */
  n: number;
  runId: string | null;
  authority: boolean;
  run: AiAgentConversationRow | null;
  focus: boolean;
}>;

/**
 * Лист «Мои разговоры» на узком экране: модальное окно слева (фокус внутри,
 * Esc и щелчок по затемнению закрывают). Закрытие — смена состояния у владельца
 * листа, окно закрывается при размонтировании.
 */
function ConversationSheet({ onClose, children }: Readonly<{ onClose: () => void; children: ReactNode }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="v3-aia-sheet fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-none w-[min(22rem,calc(100vw-3rem))] max-w-none flex-col overflow-hidden border-0 border-e border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/40 open:flex"
      data-testid="v3-aia-conversations-sheet"
    >
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border ps-4 pe-2">
        <h2 id={headingId} className="t-section min-w-0 flex-1 truncate text-fg">Мои разговоры</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/**
 * «Поручить» — рабочая область из двух частей (решение владельца 23.10.2026):
 * слева «Мои разговоры», справа чат. Это белый лист с волосяной рамкой во
 * всю высоту окна; на узком экране список уходит в лист «Разговоры», а над чатом
 * остаётся одна строка с ним и «Новым разговором».
 *
 * Здесь живёт то, что нельзя терять при перерисовке страницы сервером
 * (`revalidatePath` после действий): какой разговор открыт и ключ `Console`.
 * Ключ меняется только по явному выбору строки или «Новому разговору» — ни
 * адрес, ни свойства от сервера его не трогают (#1293: идущий разговор не
 * должен сбрасываться). Адрес обновляется на месте через `replaceState`, без
 * записей в истории: «Назад» уходит из вкладки, а не листает выбор. Строки
 * сервера дополняются тем, что известно только вкладке: начатым в ней
 * разговором (сразу «Идёт») и свежей строкой запуска из опроса.
 */
export function CommandWorkspace({
  agentKey,
  agentTitle,
  roleLine,
  autoSend,
  canRun,
  blockedNote,
  canDirect,
  canMakeTasks,
  now,
  conversations,
  resume,
  starters,
  syncSlot,
}: Readonly<{
  agentKey: AiAgentKey;
  agentTitle: string;
  roleLine: string | null;
  autoSend: boolean;
  canRun: boolean;
  blockedNote: string | null;
  canDirect: boolean;
  canMakeTasks: boolean;
  now: string;
  /** Собственные `command`-запуски сотрудника этому агенту, новые выше. */
  conversations: readonly AiAgentConversationRow[];
  /** Разговор, который вкладка открывает сама (`?run=` или последний за 12 часов); читается один раз, при открытии. */
  resume: Readonly<{ runId: string | null; sendAuthority: boolean; run?: AiAgentConversationRow | null }>;
  starters: readonly string[];
  syncSlot: ReactNode;
}>) {
  const [opened, setOpened] = useState<Opened>(() => ({
    n: 0,
    runId: canRun ? resume.runId : null,
    authority: resume.sendAuthority,
    run: canRun && resume.runId ? resume.run ?? null : null,
    focus: false,
  }));
  // Выделенная строка списка: открытый разговор, а разговор, начатый в этой вкладке, получает номер без смены ключа.
  const [activeId, setActiveId] = useState<string | null>(opened.runId);
  const [local, setLocal] = useState<Readonly<Record<string, AiAgentConversationRow>>>({});
  const [patches, setPatches] = useState<Readonly<Record<string, AiAgentConversationPatch>>>({});
  const [sheet, setSheet] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheetWas = useRef(false);
  // «Новый разговор» из листа отдаёт фокус полю, а не кнопке «Разговоры».
  const returnToTrigger = useRef(true);

  // Лист закрыт (Esc, крестик, выбор строки): фокус возвращается на «Разговоры».
  useEffect(() => {
    if (sheetWas.current && !sheet && returnToTrigger.current && trigger.current?.isConnected) trigger.current.focus();
    if (!sheet) returnToTrigger.current = true;
    sheetWas.current = sheet;
  }, [sheet]);

  // Открытый разговор опрашивается прямо сейчас: его строка из опроса главнее строки сервера (продолжение «Идёт»).
  const rows = useMemo(
    () => mergeConversations(conversations, local, patches, AI_AGENT_CONVERSATIONS_MAX, activeId),
    [conversations, local, patches, activeId],
  );
  const runsHref = aiAgentHref(agentKey, { tab: "runs" });
  const locked = !canRun;

  function select(runId: string) {
    if (runId === activeId) return;
    const row = rows.find((one) => one.id === runId);
    if (!row) return;
    setOpened((previous) => ({ n: previous.n + 1, runId, authority: row.sendAuthority, run: row, focus: false }));
    setActiveId(runId);
    // Строка опроса, оставшаяся с прошлого открытия, могла устареть: до первого опроса список и чат показывают одно — `row`.
    setPatches((previous) => {
      if (!(runId in previous)) return previous;
      const next = { ...previous };
      delete next[runId];
      return next;
    });
    replaceUrl(aiAgentHref(agentKey, { tab: "command", run: runId }));
  }

  function startNew() {
    if (activeId === null && opened.runId === null) {
      // Разговор уже пустой: сбрасывать нечего (набранное осталось бы без поля), фокус — в поле
      // (после закрытия листа: пока он открыт, остальная страница недоступна).
      setTimeout(() => document.getElementById(`aia-text-${agentKey}`)?.focus(), 0);
      return;
    }
    setOpened((previous) => ({ n: previous.n + 1, runId: null, authority: false, run: null, focus: true }));
    setActiveId(null);
    replaceUrl(aiAgentHref(agentKey, { tab: "command", fresh: true }));
  }

  function started({ runId, prompt, authority, background }: Readonly<{ runId: string; prompt: string; authority: boolean; background: boolean }>) {
    const row: AiAgentConversationRow = {
      id: runId, status: "running", startedAt: new Date().toISOString(), endedAt: null, durationSeconds: null,
      promptPreview: prompt, summary: null, errorCode: null, errorMessage: null, costCents: 0, actionsCount: 0, sendAuthority: authority,
    };
    setLocal((previous) => ({ ...previous, [runId]: row }));
    if (background) return;
    setActiveId(runId);
    replaceUrl(aiAgentHref(agentKey, { tab: "command", run: runId }));
  }

  function updated(run: AiAgentRunRow) {
    const next = conversationPatch(run);
    setPatches((previous) => (conversationPatchChanged(previous[run.id], next) ? { ...previous, [run.id]: next } : previous));
  }

  const chat = (
    <Console
      key={opened.n}
      agentKey={agentKey}
      agentTitle={agentTitle}
      roleLine={roleLine}
      autoSend={autoSend}
      canRun={canRun}
      blockedNote={blockedNote}
      canDirect={canDirect}
      canMakeTasks={canMakeTasks}
      initialRunId={opened.runId}
      initialRunAuthority={opened.authority}
      initialRun={opened.run}
      restore={opened.run ? aiAgentConsoleRestore(opened.run) : null}
      starters={starters}
      syncSlot={syncSlot}
      autoFocus={opened.focus}
      onStarted={started}
      onRunUpdate={updated}
    />
  );

  return (
    <div className="@container flex min-h-[28rem] flex-1 flex-col" data-aia-workspace="" data-testid="v3-aia-workspace">
      <div data-aia-sheet="" className="flex min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-surface">
        {locked ? null : (
          <aside className="hidden w-[280px] shrink-0 flex-col border-e border-border @4xl:flex" aria-label="Разговоры">
            <ConversationList rows={rows} activeId={activeId} now={now} runsHref={runsHref} onSelect={select} onNew={startNew} />
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {locked ? (
            // Чат закрыт, а шапка страницы на телефоне скрыта (v3.css): без этой строки выхода к разделам агента нет.
            <div className="flex shrink-0 items-center border-b border-border bg-surface px-2 md:hidden">
              <Link
                href={aiAgentHref(agentKey)}
                className="inline-flex min-h-11 items-center gap-2 rounded-ctl px-2.5 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
                data-testid="v3-aia-back"
              >
                <Icon name="arrow-left" size={18} className="shrink-0" />
                К разделам агента
              </Link>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-2 @4xl:hidden">
              {/* На телефоне шапка страницы скрыта (v3.css): отсюда можно вернуться к разделам агента. */}
              <Link
                href={aiAgentHref(agentKey)}
                aria-label="К разделам агента"
                title="К разделам агента"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg md:hidden"
              >
                <Icon name="arrow-left" size={18} />
              </Link>
              <button
                ref={trigger}
                type="button"
                aria-haspopup="dialog"
                onClick={() => setSheet(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-ctl px-2.5 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
                data-testid="v3-aia-conversations-open"
              >
                <Icon name="messages-square" size={18} className="shrink-0" />
                Разговоры
                {rows.length > 0 ? <span className="tabular-nums text-fg-3">{rows.length}</span> : null}
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={startNew}
                aria-label="Новый разговор"
                title="Новый разговор"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg"
                data-testid="v3-aia-new-compact"
              >
                <Icon name="plus" size={20} />
              </button>
            </div>
          )}
          {chat}
        </div>
      </div>
      {sheet && !locked ? (
        <ConversationSheet onClose={() => setSheet(false)}>
          <ConversationList
            rows={rows}
            activeId={activeId}
            now={now}
            runsHref={runsHref}
            showHeading={false}
            onSelect={(runId) => { select(runId); setSheet(false); }}
            onNew={() => { returnToTrigger.current = false; startNew(); setSheet(false); }}
          />
        </ConversationSheet>
      ) : null}
    </div>
  );
}
