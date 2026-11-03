"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import type { AiAgentKey, AiAgentRunRow, AiAgentRunStatus, AiAgentUiEvent } from "@/lib/ai-agents/contract";
import {
  followUpAiAgentRunAction,
  interruptAiAgentRunAction,
  pollAiAgentRunAction,
  startAiAgentRunAction,
} from "@/lib/platform-ai-agents-actions";
import {
  AI_AGENTS_IDLE,
  aiAgentRunIsActive,
  aiAgentsErrorCopy,
  answerRunMeta,
  buildChatItems,
  elapsedClock,
  lowerFirst,
  runningToolWord,
  type AiAgentConsoleRestore,
  type AiAgentConversationRow,
  type AiAgentsActionState,
  type ChatItem,
  AI_AGENT_AMBIGUOUS_RUN_ERRORS,
} from "@/lib/v3/ai-agents-view";

import { AgentComposer } from "./AgentComposer";
import { ChatTimeline } from "./ChatTimeline";

const MAX_CHARS = 8000;
const CLOSED = new Set<AiAgentRunStatus>(["completed", "failed", "budget_reached", "interrupted", "needs_attention"]);

/**
 * Живая строка хода работы под хроникой: «Сейчас: ищет клиента» или «Думает…»
 * и время с последнего сообщения сотрудника, раз в секунду. Сама она не
 * «живой регион» (иначе читалка зачитывала бы секунды) — о ходе вслух говорит
 * общая строка `announce` у `Console`. Время считается только в браузере:
 * в серверной разметке его нет, чтобы разметка не расходилась при гидратации.
 */
function ProgressRow({ word, since }: Readonly<{ word: string | null; since: () => number }>) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  // Начало работы читается на каждом тике у свежей `since`: у разговора, открытого посреди продолжения,
  // последнее сообщение сотрудника становится известно только после первого опроса, а не при монтировании.
  const sinceRef = useRef(since);
  useEffect(() => { sinceRef.current = since; });
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Date.now() - sinceRef.current()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="mt-4 flex items-center gap-2 t-meta text-fg-3" data-testid="v3-aia-progress">
      <span aria-hidden="true" className="v3-aia-working-dot" />
      <span data-testid="v3-aia-working">{word ? `Сейчас: ${lowerFirst(word)}` : "Думает…"}</span>
      {elapsed !== null ? <span className="tabular-nums">· {elapsedClock(elapsed)}</span> : null}
    </p>
  );
}

/**
 * Чат с агентом (вкладка «Поручить», контракт §D.4, п. 2): хроника на столе,
 * живая строка хода работы и поле поручения внизу. Сообщение сотрудника
 * создаёт сессию Claude (или продолжает прежнюю), вкладка опрашивает события
 * раз в `pollIntervalMs`, пока она видна и работа идёт; опрос один за раз, при
 * потере связи тихо повторяется («Нет связи, повторяю…»). Хроника не копируется
 * в базу — она читается у Claude по запросу. Переключатель «Без черновика»
 * задаётся при старте разговора: код полномочия выдаёт сервер, не модель.
 *
 * Восстановление: если вкладку открыли посреди разговора или после него,
 * `restore` (из строки запуска в базе) сразу даёт честную разметку — идёт ли
 * работа, поручение, итог; опрос затем приносит всю хронику из Claude и
 * заготовка уступает ей место. «Работает» всегда следует статусу запуска, а не
 * тому, что опрос ещё не пуст. Разговор живёт в состоянии вкладки:
 * перерисовка страницы сервером (`revalidatePath`) его не сбрасывает — ключ
 * этому компоненту задаёт `CommandWorkspace` и меняет только по явному выбору
 * разговора или «Новому разговору», а список «Мои разговоры» узнаёт о ходе
 * работы через `onStarted` и `onRunUpdate`.
 */
export function Console({
  agentKey,
  agentTitle,
  autoSend,
  canRun,
  blockedNote,
  canDirect,
  canMakeTasks,
  initialRunId,
  initialRunAuthority,
  initialRun,
  restore,
  starters,
  nextStep,
  autoFocus,
  onStarted,
  onRunUpdate,
}: Readonly<{
  agentKey: AiAgentKey;
  agentTitle: string;
  autoSend: boolean;
  /** Агент включён, синхронизирован, ключ задан, это не просмотр роли. */
  canRun: boolean;
  /** Почему писать пока нельзя (вместо поля ввода). */
  blockedNote: string | null;
  /** Право `ai.agent.manage`: можно отправлять клиентам без черновика. */
  canDirect: boolean;
  /** Сотрудник может создавать задачи: под ответом есть «Сделать задачей». */
  canMakeTasks: boolean;
  initialRunId: string | null;
  initialRunAuthority: boolean;
  /** Строка запуска восстанавливаемого разговора: из неё строка итога под ответом, пока опрос не принёс свежую. */
  initialRun: AiAgentConversationRow | null;
  /** Состояние восстанавливаемого запуска из базы; null — восстановления нет (или строка запуска не прочитана). */
  restore: AiAgentConsoleRestore | null;
  starters: readonly string[];
  /** Действие первого несделанного шага запуска агента (под причиной запертого чата); null — шагов нет. */
  nextStep: ReactNode;
  /** «Новый разговор»: фокус сразу в поле. */
  autoFocus?: boolean;
  /** Разговор создан этой вкладкой: список «Мои разговоры» добавляет его сверху (`background` — сотрудник уже ушёл на другой разговор). */
  onStarted?: (started: Readonly<{ runId: string; prompt: string; authority: boolean; background: boolean }>) => void;
  /** Опрос принёс свежую строку запуска. */
  onRunUpdate?: (run: AiAgentRunRow) => void;
}>) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [runAuthority, setRunAuthority] = useState(initialRunAuthority);
  const [events, setEvents] = useState<readonly AiAgentUiEvent[]>([]);
  const [status, setStatus] = useState<AiAgentRunStatus | null>(restore?.status ?? null);
  const [runRow, setRunRow] = useState<AiAgentConversationRow | null>(initialRun);
  // Строка запуска неизвестна — как раньше, считаем, что работа идёт, пока опрос не скажет иначе.
  const [working, setWorking] = useState(restore ? restore.working : initialRunId !== null);
  const [seed] = useState<readonly AiAgentUiEvent[]>(restore?.seed ?? []);
  const [offline, setOffline] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [direct, setDirect] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState<AiAgentsActionState>(AI_AGENTS_IDLE);
  const [announce, setAnnounce] = useState("");
  const [pollNonce, setPollNonce] = useState(0);
  // Только что отправленное сообщение показывается сразу, не дожидаясь первого опроса.
  const [pending, setPending] = useState<Readonly<{ text: string; at: string; baseline: number }> | null>(null);
  const pendingRef = useRef(pending);
  // Новые реплики появляются движением, а уже показанная история — нет: у восстановленного разговора
  // (`null`) всё статично, пока первый опрос не принесёт хронику; её реплики остаются статичными, новые оживают.
  const [staticIds, setStaticIds] = useState<ReadonlySet<string> | null>(() => (restore || initialRunId !== null ? null : new Set()));
  const [showJump, setShowJump] = useState(false);
  const cursor = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const frozen = useRef<{ fingerprint: string; id: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const [starterTick, setStarterTick] = useState(0);
  const workSince = useRef<number | null>(null);
  const alive = useRef(true);
  const callbacks = useRef({ onStarted, onRunUpdate });
  const headingId = useId();
  // Объявлять «агент закончил» имеет смысл только о работе, которую вкладка видела идущей.
  const sawActive = useRef(restore ? restore.working : initialRunId !== null);

  useEffect(() => { callbacks.current = { onStarted, onRunUpdate }; });
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const built = useMemo(() => buildChatItems(events.length > 0 ? events : seed), [events, seed]);
  const items = useMemo<readonly ChatItem[]>(() => {
    if (!pending || built.filter((item) => item.kind === "user").length > pending.baseline) return built;
    return [...built, { id: "pending:user", at: pending.at, kind: "user", text: pending.text }];
  }, [built, pending]);
  const toolSteps = useMemo(() => items.filter((item) => item.kind === "tool").length, [items]);

  // Текст, набранный до гидратации, лежит в DOM, но не в состоянии: «Отправить» остался бы запертым, а
  // первая же перерисовка стёрла бы набранное. Подхватываем его, пока состояние ещё не успело разойтись с полем.
  useLayoutEffect(() => {
    const typed = input.current?.value ?? "";
    if (typed) setText(typed);
  }, []);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  // Пример поручения кладётся в поле, а не отправляется: фокус в поле, каретка — в конец.
  useLayoutEffect(() => {
    const field = input.current;
    if (starterTick === 0 || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [starterTick]);

  useEffect(() => {
    if (!runId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    const schedule = (delay: number) => { timer = setTimeout(() => void tick(), delay); };
    async function tick() {
      if (cancelled || inFlight) return;
      if (document.visibilityState === "hidden") return; // продолжит onVisible
      inFlight = true;
      try {
        const result = await pollAiAgentRunAction(runId as string, cursor.current);
        if (cancelled) return;
        if (!result.ok) {
          if (result.code === "not_found" || result.code === "forbidden") {
            setFatal(result.code === "forbidden" ? "Нет права читать этот запуск." : "Запуск не найден.");
            setWorking(false);
            return;
          }
          setOffline(true);
          schedule(3000);
          return;
        }
        setOffline(false);
        const { poll } = result;
        if (poll.cursor) cursor.current = poll.cursor;
        const fresh = poll.events.filter((event) => !seen.current.has(event.id));
        if (fresh.length > 0) {
          for (const event of fresh) seen.current.add(event.id);
          setEvents((previous) => [...previous, ...fresh]);
          const lastAgent = [...fresh].reverse().find((event) => event.kind === "agent");
          if (lastAgent && sawActive.current) setAnnounce("Агент ответил.");
        }
        setStatus(poll.run.status);
        setRunRow(poll.run);
        callbacks.current.onRunUpdate?.(poll.run);
        setRunAuthority(poll.run.sendAuthority);
        setStaticIds((previous) => previous ?? new Set(buildChatItems(fresh).map((item) => item.id)));
        // Реплика, которую сотрудник только что отправил, уже на экране (`pending`): её настоящее событие встаёт
        // на то же место без нового появления, иначе текст мигнул бы.
        const sent = pendingRef.current ? fresh.filter((event) => event.kind === "user").map((event) => event.id) : [];
        if (sent.length > 0) setStaticIds((previous) => (previous ? new Set([...previous, ...sent]) : previous));
        // «Работает» следует статусу запуска: у закончившегося разговора, чью хронику ещё дочитывает
        // опрос, «Думает…» не мигает, а `done` лишь останавливает опрос.
        const active = aiAgentRunIsActive(poll.run.status);
        setWorking(active);
        if (active) sawActive.current = true;
        if (poll.done) {
          if (sawActive.current) setAnnounce(poll.run.status === "completed" ? "Агент закончил работу." : "Работа агента остановлена.");
          sawActive.current = false;
          return;
        }
        schedule(poll.pollAfterMs > 0 ? poll.pollAfterMs : 150);
      } catch {
        if (!cancelled) { setOffline(true); schedule(3000); }
      } finally {
        inFlight = false;
      }
    }
    const onVisible = () => { clearTimeout(timer); if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [runId, pollNonce]);

  // Лента держится у нижнего края, пока человек не прокрутил её вверх; если за это время пришло новое — «Вниз».
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (stick.current) box.scrollTop = box.scrollHeight;
    else setShowJump(true);
  }, [items.length, working]);

  const onScroll = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (stick.current) setShowJump(false);
  }, []);

  function jumpToEnd() {
    const box = scroller.current;
    stick.current = true;
    setShowJump(false);
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  async function send(override?: string) {
    const value = (override ?? text).trim();
    if (!value || sending || !canRun || working) return;
    setSending(true);
    setSendState(AI_AGENTS_IDLE);
    const fingerprint = JSON.stringify([agentKey, runId, value, direct]);
    const id = frozen.current?.fingerprint === fingerprint ? frozen.current.id : crypto.randomUUID();
    frozen.current = { fingerprint, id };
    const form = new FormData();
    form.set("request_id", id);
    form.set("text", value);
    if (runId) form.set("run_id", runId);
    else { form.set("key", agentKey); form.set("send_authority", direct ? "1" : "0"); }
    let result: AiAgentsActionState;
    try {
      result = await (runId ? followUpAiAgentRunAction : startAiAgentRunAction)(AI_AGENTS_IDLE, form);
    } catch {
      result = { status: "failed", code: "unavailable", message: aiAgentsErrorCopy("unavailable"), requestId: id };
    }
    if (!alive.current) {
      // Сотрудник успел открыть другой разговор: созданный здесь только появляется в списке, вкладку не переключает.
      if (result.status === "saved" && !runId && result.runId) callbacks.current.onStarted?.({ runId: result.runId, prompt: value, authority: direct, background: true });
      return;
    }
    setSending(false);
    if (result.status === "saved") {
      frozen.current = null;
      if (override === undefined) setText("");
      stick.current = true;
      const sentNow = { text: value, at: new Date().toISOString(), baseline: built.filter((item) => item.kind === "user").length };
      pendingRef.current = sentNow;
      setPending(sentNow);
      workSince.current = Date.now();
      if (!runId && result.runId) {
        setRunId(result.runId);
        setRunAuthority(direct);
        callbacks.current.onStarted?.({ runId: result.runId, prompt: value, authority: direct, background: false });
      }
      sawActive.current = true;
      setWorking(true);
      setStatus("running");
      setPollNonce((n) => n + 1);
    } else {
      if (result.code !== "unavailable") frozen.current = null;
      setSendState(result);
    }
  }

  async function stop() {
    if (!runId) return;
    const result = await interruptAiAgentRunAction(runId).catch(() => null);
    if (!result || !result.ok) setSendState({ status: "failed", code: result?.code ?? "unavailable", message: result?.message ?? aiAgentsErrorCopy("unavailable"), requestId: null });
    else setPollNonce((n) => n + 1);
  }

  const finished = status !== null && CLOSED.has(status) && !working;
  const empty = items.length === 0 && !working && !fatal;
  const locked = !canRun;
  // С какой минуты идёт работа: с отправки в этой вкладке, иначе — с последнего сообщения сотрудника в хронике.
  const since = (): number => {
    if (workSince.current !== null) return workSince.current;
    const lastUser = items.findLast((item) => item.kind === "user");
    const at = Date.parse(lastUser?.at ?? runRow?.startedAt ?? "");
    return Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now();
  };
  const meta = finished && runRow ? answerRunMeta(runRow, toolSteps) : null;
  // «Повторить» под ошибкой: то же последнее сообщение сотрудника уходит ещё раз. Только когда ошибка — последнее в хронике и писать можно.
  const lastUser = items.findLast((item) => item.kind === "user");
  const lastUserText = lastUser && "text" in lastUser ? lastUser.text : null;
  const lastItem = items[items.length - 1];
  const retry = canRun && !working && !sending && lastUserText && lastItem?.kind === "error" && !AI_AGENT_AMBIGUOUS_RUN_ERRORS.has(lastItem.code)
    ? () => void send(lastUserText) : undefined;

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="v3-aia-console">
      <h2 id={headingId} className="sr-only">Чат: {agentTitle}</h2>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="v3-aia-announce">{announce}</p>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label="Хроника разговора с агентом"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
          data-testid="v3-aia-scroller"
        >
          <div className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col px-4 py-5 @2xl:px-6">
            {empty ? (
              <div className="my-auto py-6">
                {locked ? (
                  <div className="mx-auto max-w-[52ch] text-center">
                    <p className="t-item text-fg">Писать агенту пока нельзя</p>
                    <p className="mt-1 t-body-compact text-fg-2">{blockedNote}</p>
                    {nextStep ? <div className="mt-4 flex justify-center">{nextStep}</div> : null}
                  </div>
                ) : starters.length > 0 ? (
                  <div className="mx-auto w-full max-w-[34rem]">
                    <p className="t-meta text-fg-3">Примеры поручений</p>
                    <ul className="mt-2 flex flex-col gap-1.5" aria-label="Примеры поручений">
                      {starters.map((starter) => (
                        <li key={starter} className="flex">
                          <button
                            type="button"
                            className="v3-choice flex min-h-11 w-full items-center justify-between gap-3 rounded-ctl border border-border bg-surface px-3 py-2 text-start t-body-compact text-fg hover:bg-surface-2"
                            onClick={() => { setText(starter); setStarterTick((tick) => tick + 1); }}
                          >
                            <span className="min-w-0">{starter}</span>
                            <Icon name="arrow-right" size={16} className="shrink-0 text-fg-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <ChatTimeline items={items} agentLabel={agentTitle} runMeta={meta} allowTask={canMakeTasks} working={working} staticIds={staticIds} onRetry={retry} />
            )}
            {working ? <ProgressRow key={runId ?? "new"} word={runningToolWord(items)} since={since} /> : null}
            {offline ? <p role="status" className="mt-3 t-meta text-warn">Нет связи, повторяю…</p> : null}
            {fatal ? <p role="alert" className="mt-3 t-body-compact text-danger">{fatal}</p> : null}
          </div>
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={jumpToEnd}
            className="v3-raised absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-4 t-label text-fg hover:bg-surface-2"
            data-testid="v3-aia-jump"
          >
            Вниз
            <Icon name="chevron-down" size={16} className="shrink-0" />
          </button>
        ) : null}
      </div>

      {locked ? (
        empty ? null : (
          <div className="shrink-0 space-y-3 border-t border-border bg-surface px-4 py-3" data-testid="v3-aia-blocked">
            <p className="t-body-compact text-fg-2">{blockedNote}</p>
            {nextStep}
          </div>
        )
      ) : (
        <AgentComposer
          fieldId={`aia-text-${agentKey}`}
          textareaRef={input}
          value={text}
          onChange={setText}
          onSend={() => void send()}
          onStop={() => void stop()}
          maxChars={MAX_CHARS}
          placeholder={runId ? "Уточнение или следующий вопрос…" : "Что поручить?"}
          working={working}
          sending={sending}
          hasRun={runId !== null}
          autoSend={autoSend}
          canDirect={canDirect}
          direct={direct}
          onDirectChange={setDirect}
          runAuthority={runAuthority}
          error={sendState.status === "failed" ? sendState.message : null}
        />
      )}
    </section>
  );
}
