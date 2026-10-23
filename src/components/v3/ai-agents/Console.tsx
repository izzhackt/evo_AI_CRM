"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { btnCls, btnGhostCls } from "@/components/ui";
import type { AiAgentKey, AiAgentRunStatus, AiAgentUiEvent } from "@/lib/ai-agents/contract";
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
  buildChatItems,
  type AiAgentConsoleRestore,
  type AiAgentsActionState,
} from "@/lib/v3/ai-agents-view";

import { ChatTimeline } from "./ChatTimeline";

const MAX_CHARS = 8000;
const CLOSED = new Set<AiAgentRunStatus>(["completed", "failed", "budget_reached", "interrupted", "needs_attention"]);

/**
 * Вкладка «Поручить» (контракт §D.4, п. 2): разговор с агентом. Сообщение
 * сотрудника создаёт сессию Claude (или продолжает прежнюю), вкладка опрашивает
 * события раз в `pollIntervalMs`, пока она видна и работа идёт; опрос один за
 * раз, при потере связи тихо повторяется («Нет связи, повторяю…»). Хроника не
 * копируется в базу — она читается у Claude по запросу. Переключатель «Без
 * черновика» задаётся при старте разговора: код полномочия выдаёт сервер, не
 * модель.
 *
 * Восстановление: если страницу открыли посреди разговора или после него,
 * `restore` (из строки запуска в базе) сразу даёт честную разметку — идёт ли
 * работа, поручение, итог; опрос затем приносит всю хронику из Claude и
 * заготовка уступает ей место. «Работает» всегда следует статусу запуска, а не
 * тому, что опрос ещё не пуст. Разговор живёт в состоянии вкладки: перерисовка
 * страницы сервером (`revalidatePath`) его не сбрасывает — ключ у `Console`
 * только от явного `?run=` (см. `AgentBody`).
 */
export function Console({
  agentKey,
  agentTitle,
  autoSend,
  canRun,
  blockedNote,
  canDirect,
  initialRunId,
  initialRunAuthority,
  restore,
  starters,
  syncSlot,
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
  initialRunId: string | null;
  initialRunAuthority: boolean;
  /** Состояние восстанавливаемого запуска из базы; null — восстановления нет (или строка запуска не прочитана). */
  restore: AiAgentConsoleRestore | null;
  starters: readonly string[];
  syncSlot: ReactNode;
}>) {
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [runAuthority, setRunAuthority] = useState(initialRunAuthority);
  const [events, setEvents] = useState<readonly AiAgentUiEvent[]>([]);
  const [status, setStatus] = useState<AiAgentRunStatus | null>(restore?.status ?? null);
  // Строка запуска неизвестна — как раньше, считаем, что работа идёт, пока опрос не скажет иначе.
  const [working, setWorking] = useState(restore ? restore.working : initialRunId !== null);
  const [seed, setSeed] = useState<readonly AiAgentUiEvent[]>(restore?.seed ?? []);
  const [offline, setOffline] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [direct, setDirect] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState<AiAgentsActionState>(AI_AGENTS_IDLE);
  const [announce, setAnnounce] = useState("");
  const [pollNonce, setPollNonce] = useState(0);
  const cursor = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const frozen = useRef<{ fingerprint: string; id: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  // Объявлять «агент закончил» имеет смысл только о работе, которую вкладка видела идущей.
  const sawActive = useRef(restore ? restore.working : initialRunId !== null);

  const items = useMemo(() => buildChatItems(events.length > 0 ? events : seed), [events, seed]);

  // Текст, набранный до гидратации, лежит в DOM, но не в состоянии: «Отправить» остался бы запертым, а
  // первая же перерисовка стёрла бы набранное. Подхватываем его, пока состояние ещё не успело разойтись с полем.
  useLayoutEffect(() => {
    const typed = input.current?.value ?? "";
    if (typed) setText(typed);
  }, []);

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
        setRunAuthority(poll.run.sendAuthority);
        // «Работает» следует статусу запуска: у закончившегося разговора, чью хронику ещё дочитывает
        // опрос, «Агент работает…» не мигает, а `done` лишь останавливает опрос.
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

  useEffect(() => {
    const box = scroller.current;
    if (box && stick.current) box.scrollTop = box.scrollHeight;
  }, [items.length, working]);

  const onScroll = useCallback(() => {
    const box = scroller.current;
    if (box) stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  }, []);

  function resetConversation() {
    cursor.current = null;
    seen.current = new Set();
    frozen.current = null;
    stick.current = true;
    sawActive.current = false;
    setRunId(null); setEvents([]); setSeed([]); setStatus(null); setWorking(false); setOffline(false); setFatal(null);
    setSendState(AI_AGENTS_IDLE); setDirect(false); setRunAuthority(false); setAnnounce("");
  }

  async function send() {
    const value = text.trim();
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
    setSending(false);
    if (result.status === "saved") {
      frozen.current = null;
      setText("");
      stick.current = true;
      if (!runId && result.runId) { setRunId(result.runId); setRunAuthority(direct); }
      sawActive.current = true;
      setWorking(true);
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
  const empty = events.length === 0 && seed.length === 0 && !working && !fatal;
  const locked = !canRun;

  return (
    <section aria-labelledby={`aia-console-${agentKey}`} className="space-y-4" data-testid="v3-aia-console">
      <div>
        <h2 id={`aia-console-${agentKey}`} className="t-section text-fg">Поручить</h2>
        <p className="mt-1 max-w-[62ch] t-body-compact text-fg-2">
          {autoSend
            ? "Авто включён: сообщения клиентам и студентам агент отправляет сам."
            : "Авто выключен: сообщения клиентам и студентам агент кладёт в «Черновики» — отправит их только ваше одобрение."}
        </p>
      </div>

      <div className="rounded-card border border-border bg-surface">
        <div
          ref={scroller}
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label="Хроника разговора с агентом"
          className="max-h-[min(62vh,40rem)] min-h-40 overflow-y-auto overscroll-contain p-4"
          data-testid="v3-aia-scroller"
        >
          {empty ? (
            <div className="py-6 text-center">
              <p className="t-item text-fg">{locked ? "Писать агенту пока нельзя" : `Напишите «${agentTitle}», что сделать`}</p>
              <p className="mx-auto mt-1 max-w-[52ch] t-body-compact text-fg-2">
                {locked ? blockedNote : "Агент прочитает данные EVO CRM, ответит здесь и покажет, какие инструменты вызывал. Поручение можно уточнять дальше в этом же разговоре."}
              </p>
            </div>
          ) : (
            <ChatTimeline items={items} agentLabel={agentTitle} />
          )}
          {working ? (
            <p className="mt-3 flex items-center gap-2 t-meta text-fg-3" data-testid="v3-aia-working">
              <span aria-hidden="true" className="v3-aia-working-dot" />
              Агент работает…
            </p>
          ) : null}
          {offline ? <p role="status" className="mt-2 t-meta text-warn">Нет связи, повторяю…</p> : null}
          {fatal ? <p role="alert" className="mt-2 t-body-compact text-danger">{fatal}</p> : null}
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</p>

        {locked ? (
          empty && !syncSlot ? null : (
            <div className="space-y-3 border-t border-border p-4" data-testid="v3-aia-blocked">
              {empty ? null : <p className="t-body-compact text-fg-2">{blockedNote}</p>}
              {syncSlot}
            </div>
          )
        ) : (
          <form
            className="space-y-3 border-t border-border p-4"
            onSubmit={(event) => { event.preventDefault(); void send(); }}
          >
            {!runId && starters.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Примеры поручений">
                {starters.map((starter) => (
                  <li key={starter}>
                    <button type="button" className="v3-choice inline-flex min-h-11 items-center rounded-nav border border-border bg-surface px-3 t-body-compact text-fg-2 hover:bg-surface-2 hover:text-fg" onClick={() => setText(starter)}>
                      {starter}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              <label htmlFor={`aia-text-${agentKey}`} className="sr-only">Поручение агенту</label>
              <textarea
                id={`aia-text-${agentKey}`}
                ref={input}
                value={text}
                maxLength={MAX_CHARS}
                rows={3}
                disabled={sending || working}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}
                placeholder={runId ? "Ответ или уточнение для агента…" : "Что поручить агенту?"}
                className="min-h-24 w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-base text-fg placeholder:text-fg-3 focus-visible:border-accent disabled:bg-surface-2"
                data-testid="v3-aia-input"
              />
              <p className="mt-1 flex flex-wrap justify-between gap-2 t-meta text-fg-3">
                <span>Ctrl+Enter — отправить</span>
                <span className="tabular-nums">{text.length > 6000 ? `${text.length} из ${MAX_CHARS}` : ""}</span>
              </p>
            </div>

            {canDirect ? (
              <label className={`flex items-start gap-3 rounded-nav border border-border px-3 py-2 ${runId ? "opacity-70" : ""}`}>
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--text)]"
                  checked={runId ? runAuthority : direct}
                  disabled={runId !== null || sending}
                  onChange={(event) => setDirect(event.target.checked)}
                  data-testid="v3-aia-direct"
                />
                <span className="min-w-0 t-body-compact">
                  <span className="font-medium text-fg">Отправлять без черновика</span>
                  <span className="mt-0.5 block text-fg-2">
                    Агент отправит сообщения клиентам сразу, без вашего одобрения, на время этого разговора.
                    {runId ? " Задаётся при старте разговора." : ""}
                  </span>
                </span>
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={btnCls} disabled={sending || working || !text.trim()} data-testid="v3-aia-send">
                {sending ? "Отправляю…" : "Отправить"}
              </button>
              {working ? <button type="button" className={btnGhostCls} onClick={() => void stop()} data-testid="v3-aia-stop">Остановить</button> : null}
              {runId ? <button type="button" className={btnGhostCls} onClick={resetConversation} disabled={sending} data-testid="v3-aia-new">Новый разговор</button> : null}
              {finished ? <span className="t-meta text-fg-3">Разговор закончен — можно продолжить сообщением ниже или начать новый.</span> : null}
            </div>
            {sendState.status === "failed" && sendState.message ? <p role="alert" className="t-body-compact text-danger">{sendState.message}</p> : null}
          </form>
        )}
      </div>
    </section>
  );
}
