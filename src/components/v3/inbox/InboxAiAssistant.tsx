"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Icon } from "@/components/icons";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import {
  aiErrorBlocked,
  aiErrorCopy,
  aiErrorRetryable,
  answerWarnings,
  createSseDecoder,
  normalizeAiAnswerView,
  parseAiStreamEvent,
  replySegments,
  sourcePlace,
  sourcesWord,
  type AiAnswerView,
  type AiBlockedCode,
  type AiIntent,
  type AiSavedAnswer,
  type AiSource,
} from "@/lib/v3/ai-agent";

import { InboxAiAutosend } from "./InboxAiAutosend";
import { InboxAiMemory } from "./InboxAiMemory";

/**
 * Окно ИИ в чате продаж (план ИИ-агента §12.1, решение владельца Q7):
 * маленькое окно справа внизу ленты, по умолчанию свёрнуто в капсулу «Помочь
 * с ответом», раскрывается по клику, перетаскивается мышью и стрелками
 * клавиатуры (позиция — в браузере), Esc сворачивает. На узком экране —
 * нижний лист внутри ленты: поле ответа остаётся видно.
 *
 * Свёрнутое окно ничего не запрашивает. Открытие читает сохранённый ответ
 * (`GET …/answer`, без Gemini); если последнее сообщение — клиента и
 * актуального ответа нет, запрос идёт сам. Новое сообщение клиента при
 * открытом окне — новый запрос; при свёрнутом — ответ только помечается
 * устаревшим. Поток агента — живой предпросмотр; после него окно читает
 * сохранённый, проверенный ответ, а «Вставить в ответ» берёт текст у базы
 * (409 — ответ устарел). Вставка ничего не отправляет.
 *
 * Наверху окна — свёрнутый блок «Что ИИ знает о клиенте» (P3, §9): интерес,
 * сводка и карточка лида из базы, без Gemini (`InboxAiMemory`), под ним —
 * «Автоответчик в этом чате» (P4, §11), если автоответчик включён (`InboxAiAutosend`).
 *
 * Запрос привязан к последнему сообщению клиента, которое окно видело последним:
 * из базы (каждое чтение `GET …/answer`) или из страницы (новое сообщение в
 * ленте). Отстающая страница не мешает: после «пришло новое сообщение» окно
 * перечитывает базу и берёт её значение.
 */
export type InboxAssistantConfig = Readonly<{
  /** Секрет агента задан на сервере; без него окно честно говорит «не подключён». */
  featureOn: boolean;
}>;

type Phase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "waiting" }>
  | Readonly<{ kind: "no-client" }>
  | Readonly<{ kind: "streaming"; intent: AiIntent; stage: "searching" | "writing"; sources: number | null; preview: string }>
  | Readonly<{ kind: "ready"; answer: AiSavedAnswer }>
  | Readonly<{ kind: "error"; code: string; message: string; retry: AiIntent | "load" | null }>
  | Readonly<{ kind: "blocked"; code: AiBlockedCode }>;

type Tone = "idle" | "working" | "ready" | "attention" | "error";

const POSITION_STEP = 24;
const POSITION_STEP_LARGE = 96;
const EDGE = 12;
/** С этой ширины ленты (32rem) окно плавает; уже — нижний лист (ai-agent.css, `@container ai`). */
const WINDOW_MODE_MIN_WIDTH = 512;
/** Подряд «пришло новое сообщение» без готового ответа: дальше — только по кнопке. */
const SUPERSEDE_LIMIT = 3;

type Offset = Readonly<{ x: number; y: number }>;

function readOffset(key: string): Offset {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { x: 0, y: 0 };
    const value = JSON.parse(raw) as { x?: unknown; y?: unknown };
    return typeof value.x === "number" && typeof value.y === "number" && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: Math.min(0, value.x), y: Math.min(0, value.y) } : { x: 0, y: 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}
function writeOffset(key: string, offset: Offset): void {
  try {
    if (offset.x === 0 && offset.y === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ x: Math.round(offset.x), y: Math.round(offset.y) }));
  } catch {
    // Позиция окна — удобство этого браузера; без хранилища окно встаёт в угол.
  }
}

function toneOf(phase: Phase, stale: boolean): Tone {
  if (phase.kind === "streaming" || phase.kind === "loading") return "working";
  if (phase.kind === "error") return "error";
  if (phase.kind === "blocked") return "attention";
  if (phase.kind === "ready") {
    if (stale || !phase.answer.current) return "attention";
    return phase.answer.result && answerWarnings(phase.answer.result).length > 0 ? "attention" : "ready";
  }
  return "idle";
}

const TONE_WORD: Readonly<Record<Tone, string>> = {
  idle: "ждёт", working: "готовит ответ", ready: "ответ готов", attention: "требует внимания", error: "ошибка",
};

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : "unavailable";
  } catch {
    return "unavailable";
  }
}

function SourceMark({ n, onSelect }: Readonly<{ n: number; onSelect: (n: number) => void }>) {
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      className="v3-ai-mark"
      aria-label={`Источник ${n}`}
    >
      {n}
    </button>
  );
}

/** Длинная цитата свёрнута до пяти строк; выбранный номер её раскрывает. */
const QUOTE_CLAMP_FROM = 280;

function SourceRow({ source, highlighted }: Readonly<{ source: AiSource; highlighted: boolean }>) {
  const place = sourcePlace(source);
  const [whole, setWhole] = useState(false);
  const long = (source.quote?.length ?? 0) > QUOTE_CLAMP_FROM;
  const clamped = long && !whole && !highlighted;
  return (
    <li data-source-n={source.n ?? undefined} data-highlighted={highlighted || undefined} className="v3-ai-source">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="v3-ai-source-n" aria-hidden="true">{source.n ?? "·"}</span>
        <div className="min-w-0 flex-1">
          <p className="t-item break-words text-fg">
            <span className="sr-only">Источник {source.n}: </span>
            {source.missing ? "Документ удалён" : source.title}
            {place ? <span className="font-normal text-fg-3"> · {place}</span> : null}
          </p>
          {source.sectionPath && !source.missing ? (
            <p className="t-meta break-words text-fg-3">{source.sectionPath}</p>
          ) : null}
          {source.quote ? (
            <blockquote className="v3-ai-quote t-body-compact text-fg-2" data-clamped={clamped || undefined}>{source.quote}</blockquote>
          ) : null}
          {long && !highlighted ? (
            <button type="button" className="v3-ai-link t-label" aria-expanded={whole} onClick={() => setWhole((value) => !value)}>
              {whole ? "Свернуть цитату" : "Цитата полностью"}
            </button>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
            {source.audience === "internal" ? <StatusChip label="Внутреннее" tone="info" title="Клиенту не цитируется" /> : null}
            {source.unverified ? (
              <StatusChip
                label="не проверено"
                tone="warn"
                title={source.unverifiedValues.length > 0
                  ? `Число в источнике ещё не проверено: ${source.unverifiedValues.join(", ")}`
                  : "Число в источнике ещё не проверено"}
              />
            ) : null}
            {!source.live && !source.missing ? <StatusChip label="документ заменён" tone="neutral" /> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function InboxAiAssistant({
  conversationId,
  latestInboundMessageId,
  storageScope,
  config,
  lifted,
  onInsert,
}: Readonly<{
  conversationId: string;
  latestInboundMessageId: string | null;
  /** «организация:сотрудник» — позиция окна этого сотрудника в этом браузере. */
  storageScope: string;
  config: InboxAssistantConfig;
  /** Над капсулой стоит «Новые сообщения ↓» на узком экране. */
  lifted: boolean;
  /** Добавляет текст в поле ответа и ставит туда фокус; ничего не отправляет. */
  onInsert: (text: string) => void;
}>) {
  const titleId = useId();
  const windowRef = useRef<HTMLElement>(null);
  const capsuleRef = useRef<HTMLButtonElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const supersedes = useRef(0);
  /** Последнее сообщение клиента, увиденное последним — из базы или из страницы. */
  const knownInbound = useRef<string | null>(latestInboundMessageId);
  const positionKey = `evo-ai-window-v1:${storageScope}`;

  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [stale, setStale] = useState(false);
  const [note, setNote] = useState<Readonly<{ tone: "ok" | "warn" | "danger"; text: string }> | null>(null);
  const [inserting, setInserting] = useState<"reply" | "question" | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Readonly<{ pointerId: number; startX: number; startY: number; origin: Offset }> | null>(null);

  const expandedRef = useRef(false);

  const clamp = useCallback((next: Offset): Offset => {
    const area = areaRef.current, node = windowRef.current;
    if (!area || !node) return next;
    const maxLeft = Math.max(0, area.clientWidth - node.offsetWidth - EDGE * 2);
    const maxUp = Math.max(0, area.clientHeight - node.offsetHeight - EDGE * 2);
    return { x: Math.min(0, Math.max(-maxLeft, next.x)), y: Math.min(0, Math.max(-maxUp, next.y)) };
  }, []);

  // Окно не уходит за ленту при смене размера окна браузера и после раскрытия.
  useLayoutEffect(() => {
    if (!expanded) return;
    const fit = () => setOffset((previous) => {
      const next = clamp(previous);
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
    fit();
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    return () => observer.disconnect();
  }, [expanded, clamp, phase.kind]);

  const finishStream = useCallback(() => {
    streamAbort.current?.abort();
    streamAbort.current = null;
  }, []);
  useEffect(() => finishStream, [finishStream]);

  const readSaved = useCallback(async (intent: AiIntent | null): Promise<Readonly<{ view: AiAnswerView; featureOn: boolean }> | Readonly<{ code: string }>> => {
    try {
      const query = intent ? `?intent=${intent}` : "";
      const response = await fetch(`/api/v3/ai-agent/conversations/${conversationId}/answer${query}`, {
        cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" },
      });
      if (!response.ok) return { code: await readErrorCode(response) };
      const body = await response.json() as { view?: unknown; featureOn?: unknown };
      return { view: normalizeAiAnswerView(body.view), featureOn: body.featureOn === true };
    } catch {
      return { code: "unavailable" };
    }
  }, [conversationId]);

  const fail = useCallback((code: string, message: string | null, retry: AiIntent | "load" | null) => {
    if (aiErrorBlocked(code)) {
      setPhase({ kind: "blocked", code });
      return;
    }
    setPhase({ kind: "error", code, message: aiErrorCopy(code, message), retry: aiErrorRetryable(code) ? retry : null });
  }, []);

  // `generate` и `load` зовут друг друга (новое сообщение во время потока).
  const loadRef = useRef<() => Promise<void>>(async () => undefined);
  /** Агент ответил «пришло новое сообщение»: открытое окно перечитывает, свёрнутое ждёт открытия. */
  const afterSuperseded = useCallback(() => {
    if (expandedRef.current && supersedes.current < SUPERSEDE_LIMIT) {
      supersedes.current += 1;
      void loadRef.current();
      return;
    }
    if (expandedRef.current) {
      setPhase({ kind: "error", code: "superseded", message: aiErrorCopy("stale_answer"), retry: "load" });
      return;
    }
    setStale(true);
    setPhase({ kind: "idle" });
  }, []);

  const generate = useCallback(async (intent: AiIntent) => {
    finishStream();
    const controller = new AbortController();
    streamAbort.current = controller;
    setStale(false);
    setNote(null);
    setPhase({ kind: "streaming", intent, stage: "searching", sources: null, preview: "" });
    let response: Response;
    try {
      response = await fetch(`/api/v3/ai-agent/conversations/${conversationId}/answer`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ intent, refId: knownInbound.current }),
        signal: controller.signal,
      });
    } catch {
      if (!controller.signal.aborted) fail("agent_unavailable", null, intent);
      return;
    }
    if (!(response.headers.get("content-type") ?? "").startsWith("text/event-stream") || !response.body) {
      const code = await readErrorCode(response);
      if (controller.signal.aborted) return;
      if (code === "superseded") {
        afterSuperseded();
        return;
      }
      fail(code, null, intent);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const frames = createSseDecoder();
    let settled = false;
    try {
      while (!settled) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of frames(decoder.decode(value, { stream: true }))) {
          const event = parseAiStreamEvent(frame.event, frame.data);
          if (!event || controller.signal.aborted) continue;
          if (event.type === "status") {
            setPhase((previous) => previous.kind === "streaming" ? { ...previous, stage: event.stage } : previous);
          } else if (event.type === "sources") {
            setPhase((previous) => previous.kind === "streaming" ? { ...previous, sources: event.count } : previous);
          } else if (event.type === "delta") {
            setPhase((previous) => previous.kind === "streaming"
              ? { ...previous, stage: "writing", preview: (previous.preview + event.text).slice(0, 8000) } : previous);
          } else if (event.type === "final") {
            settled = true;
            supersedes.current = 0;
            // Показывается сохранённый, проверенный ответ с источниками из базы.
            const saved = await readSaved(intent);
            if (controller.signal.aborted) return;
            if ("code" in saved) fail(saved.code, null, "load");
            else if (saved.view.answer?.status === "ready" && saved.view.answer.result) setPhase({ kind: "ready", answer: saved.view.answer });
            else fail("unavailable", null, intent);
          } else {
            settled = true;
            if (event.code === "superseded") {
              afterSuperseded();
            } else {
              fail(event.code, event.message, intent);
            }
          }
        }
      }
    } catch {
      if (controller.signal.aborted) return;
      settled = true;
      fail("agent_unavailable", null, intent);
    } finally {
      reader.cancel().catch(() => undefined);
      if (streamAbort.current === controller) streamAbort.current = null;
    }
    if (!settled && !controller.signal.aborted) fail("agent_unavailable", null, intent);
  }, [conversationId, afterSuperseded, fail, finishStream, readSaved]);

  const load = useCallback(async () => {
    finishStream();
    setPhase({ kind: "loading" });
    setNote(null);
    const saved = await readSaved(null);
    if ("code" in saved) {
      fail(saved.code, null, "load");
      return;
    }
    const { view, featureOn } = saved;
    // База свежее страницы: опрос ленты мог отстать, а `answer_claim_v1`
    // сверяет билет с последним сообщением клиента в базе (PT409).
    knownInbound.current = view.latestInboundMessageId;
    setStale(false);
    if (view.answer && view.answer.current && view.answer.result) {
      setPhase({ kind: "ready", answer: view.answer });
      return;
    }
    if (!featureOn) { setPhase({ kind: "blocked", code: "ai_agent_off" }); return; }
    if (!view.consentRecorded) { setPhase({ kind: "blocked", code: "consent_required" }); return; }
    if (view.lastMessageDirection === "inbound") { void generate("reply"); return; }
    if (view.lastMessageDirection === "outbound" && view.latestInboundMessageId) { setPhase({ kind: "waiting" }); return; }
    setPhase({ kind: "no-client" });
  }, [fail, finishStream, generate, readSaved]);
  useEffect(() => { loadRef.current = load; }, [load]);

  const generateRef = useRef(generate);
  useEffect(() => { generateRef.current = generate; }, [generate]);

  // Новое сообщение клиента: открытое окно готовит новый ответ; открытое без
  // агента перечитывает состояние (честное «не подключён», а не пустое окно) и
  // держит готовый ответ помеченным «устарел»; свёрнутое — только помечает
  // прежний ответ устаревшим и перечитает его при открытии.
  const [seenInbound, setSeenInbound] = useState(latestInboundMessageId);
  const [inboundTurn, setInboundTurn] = useState<Readonly<{
    n: number; action: "regenerate" | "reload" | "mark"; id: string | null;
  }>>({ n: 0, action: "mark", id: latestInboundMessageId });
  if (seenInbound !== latestInboundMessageId) {
    setSeenInbound(latestInboundMessageId);
    const action = !expanded ? "mark" : config.featureOn ? "regenerate" : phase.kind === "ready" ? "mark" : "reload";
    setInboundTurn((previous) => ({ n: previous.n + 1, action, id: latestInboundMessageId }));
    if (action !== "regenerate") setStale(true);
    if (!expanded) setPhase((previous) => (previous.kind === "ready" ? previous : { kind: "idle" }));
  }
  useEffect(() => {
    if (inboundTurn.n === 0) return;
    knownInbound.current = inboundTurn.id;
    if (inboundTurn.action === "mark") {
      finishStream();
      return;
    }
    supersedes.current = 0;
    const timer = setTimeout(() => void (inboundTurn.action === "regenerate" ? generateRef.current("reply") : loadRef.current()), 0);
    return () => clearTimeout(timer);
  }, [inboundTurn, finishStream]);

  /** Действие сотрудника начинает отсчёт «пришло новое сообщение» заново. */
  function byHand(run: () => Promise<void>) {
    supersedes.current = 0;
    void run();
  }

  function open() {
    expandedRef.current = true;
    setOffset(readOffset(positionKey));
    setExpanded(true);
    // Без агента сохранённое всё равно читается: прежний ответ может быть актуален.
    // Ошибка и «нет согласия»/«не подключён» тоже перечитываются: администратор
    // мог включить агента, сбой — пройти, а у этих состояний нет «Повторить».
    if (phase.kind === "idle" || phase.kind === "blocked" || phase.kind === "error" || (phase.kind === "ready" && stale)) {
      byHand(load);
    }
    requestAnimationFrame(() => windowRef.current?.querySelector<HTMLElement>("[data-ai-title]")?.focus());
  }

  function collapse() {
    expandedRef.current = false;
    setExpanded(false);
    setDragging(false);
    drag.current = null;
    requestAnimationFrame(() => capsuleRef.current?.focus());
  }

  async function insert(answer: AiSavedAnswer, part: "reply" | "question") {
    if (inserting) return;
    setInserting(part);
    setNote(null);
    try {
      const response = await fetch(`/api/v3/ai-agent/answers/${answer.answerId}/insert`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ part }),
      });
      if (response.ok) {
        const body = await response.json() as { text?: unknown };
        if (typeof body.text === "string" && body.text.trim()) {
          onInsert(body.text);
          setNote({ tone: "ok", text: part === "reply" ? "Ответ вставлен в поле — проверьте и отправьте сами." : "Вопрос вставлен в поле." });
          return;
        }
        setNote({ tone: "danger", text: aiErrorCopy("unavailable") });
        return;
      }
      const code = await readErrorCode(response);
      if (code === "stale_answer") {
        setStale(true);
        setNote({ tone: "warn", text: aiErrorCopy("stale_answer") });
        return;
      }
      setNote({ tone: "danger", text: code === "forbidden" ? aiErrorCopy("forbidden") : "Не удалось вставить ответ. Повторите." });
    } catch {
      setNote({ tone: "danger", text: "Не удалось вставить ответ. Повторите." });
    } finally {
      setInserting(null);
    }
  }

  function selectSource(n: number) {
    setHighlight(n);
    windowRef.current?.querySelector<HTMLElement>(`[data-source-n="${n}"]`)?.scrollIntoView({
      block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  // ------------------------------------------------------------- перетаскивание
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button:not([data-ai-move]), a")) return;
    // Нижний лист узкой ленты не перетаскивается.
    if ((areaRef.current?.clientWidth ?? 0) < WINDOW_MODE_MIN_WIDTH) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: offset };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setOffset(clamp({ x: state.origin.x + event.clientX - state.startX, y: state.origin.y + event.clientY - state.startY }));
  }
  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setOffset((current) => { writeOffset(positionKey, current); return current; });
  }
  function onMoveKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? POSITION_STEP_LARGE : POSITION_STEP;
    const delta: Record<string, Offset> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    };
    let next: Offset | null = null;
    if (event.key in delta) next = clamp({ x: offset.x + delta[event.key].x, y: offset.y + delta[event.key].y });
    else if (event.key === "Home") next = { x: 0, y: 0 };
    if (!next) return;
    event.preventDefault();
    setOffset(next);
    writeOffset(positionKey, next);
  }
  function onWindowKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      collapse();
    }
  }

  const tone = toneOf(phase, stale);
  const ready = phase.kind === "ready" ? phase.answer : null;
  const result = ready?.result ?? null;
  const isStale = ready !== null && (stale || !ready.current);
  const warnings = result ? answerWarnings(result) : [];

  let status: string;
  if (phase.kind === "streaming") {
    status = phase.stage === "searching" ? "Ищу в материалах…" : `Пишу ответ…${phase.sources !== null ? ` · ${sourcesWord(phase.sources)}` : ""}`;
  } else if (phase.kind === "loading") status = "Открываю сохранённый ответ…";
  else if (ready && result) {
    status = isStale ? "Ответ устарел" : `Ответ готов · ${result.sources.length > 0 ? sourcesWord(result.sources.length) : "без источников"}`;
  } else if (phase.kind === "waiting") status = "Ждём ответ клиента";
  else if (phase.kind === "error" || phase.kind === "blocked") status = "Ответа нет";
  else status = "Помощник";

  return (
    <div
      ref={areaRef}
      className="v3-ai-area pointer-events-none absolute inset-0 z-10"
      data-testid="v3-ai-assistant"
      data-expanded={expanded || undefined}
      data-tone={tone}
    >
      {!expanded ? (
        <button
          ref={capsuleRef}
          type="button"
          onClick={open}
          aria-label="Помочь с ответом — открыть помощника"
          aria-describedby={`${titleId}-state`}
          aria-expanded={false}
          className="v3-ai-capsule v3-raised pointer-events-auto"
          data-lifted={lifted || undefined}
          data-testid="v3-ai-capsule"
        >
          <Icon name="sparkles" size={18} className="shrink-0" />
          <span className="t-label">Помочь с ответом</span>
          <span className="v3-ai-dot" data-tone={tone} aria-hidden="true" />
          <span id={`${titleId}-state`} className="sr-only">Состояние: {TONE_WORD[tone]}</span>
        </button>
      ) : (
        <section
          ref={windowRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={onWindowKey}
          className="v3-ai-window pointer-events-auto"
          data-dragging={dragging || undefined}
          data-testid="v3-ai-window"
          style={{ "--ai-x": `${offset.x}px`, "--ai-y": `${offset.y}px` } as CSSProperties}
        >
          <header
            className="v3-ai-head"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <button
              type="button"
              data-ai-move=""
              onKeyDown={onMoveKey}
              aria-label="Переместить окно: стрелки, Home — в угол"
              className="v3-ai-move"
            >
              <Icon name="grip-vertical" size={16} className="shrink-0" />
            </button>
            <div className="v3-ai-head-text min-w-0 flex-1">
              <h2 id={titleId} tabIndex={-1} data-ai-title="" className="t-section truncate text-fg outline-none">
                Помочь с ответом
              </h2>
              <p className="v3-ai-status t-meta" role="status" data-tone={tone}>
                <span className="v3-ai-dot" data-tone={tone} aria-hidden="true" />
                {status}
              </p>
            </div>
            <button type="button" onClick={collapse} aria-label="Свернуть помощника" className="v3-ai-icon-button">
              <Icon name="chevron-down" size={18} className="shrink-0" />
            </button>
          </header>

          <div className="v3-ai-body">
            {/* Память о клиенте (P3) читается при каждом открытии окна; её сбой ответу не мешает. */}
            <InboxAiMemory conversationId={conversationId} />
            {/* «Автоответчик в этом чате» (P4) — только когда автоответчик включён в организации. */}
            <InboxAiAutosend conversationId={conversationId} />

            {phase.kind === "loading" || (phase.kind === "streaming" && phase.preview === "") ? (
              <div className="space-y-2 py-1" aria-hidden="true">
                <div className="v3-ai-skeleton w-[92%]" />
                <div className="v3-ai-skeleton w-[78%]" />
                <div className="v3-ai-skeleton w-[54%]" />
              </div>
            ) : null}

            {phase.kind === "streaming" && phase.preview ? (
              <p className="whitespace-pre-wrap break-words t-body-compact text-fg" data-testid="v3-ai-preview" aria-busy="true">
                {phase.preview}
                <span className="v3-ai-caret" aria-hidden="true" />
              </p>
            ) : null}

            {phase.kind === "waiting" ? (
              <div className="space-y-3">
                <p className="t-body-compact text-fg-2">Последним писали вы. Можно подготовить продолжение разговора.</p>
                <button type="button" className="v3-ai-button" onClick={() => byHand(() => generate("followup"))}>
                  Подготовить продолжение
                </button>
              </div>
            ) : null}

            {phase.kind === "no-client" ? (
              <p className="t-body-compact text-fg-2">Клиент ещё не писал в этот чат — отвечать пока не на что.</p>
            ) : null}

            {phase.kind === "blocked" ? (
              <div className="space-y-2" data-testid="v3-ai-blocked" data-code={phase.code}>
                <p className="t-body-compact text-fg-2">{aiErrorCopy(phase.code)}</p>
                {phase.code === "consent_required" || phase.code === "ai_agent_off" ? (
                  <Link href="/v3/ai-agent" className="v3-ai-link t-label">Открыть «ИИ-агент»</Link>
                ) : null}
                {phase.code === "model_unpriced" ? (
                  // Модели и предупреждение «нет цены» — в «Расходах» раздела.
                  <Link href="/v3/ai-agent?section=spend" className="v3-ai-link t-label">Открыть «Расходы»</Link>
                ) : null}
              </div>
            ) : null}

            {phase.kind === "error" ? (
              <div className="space-y-2" data-testid="v3-ai-error" data-code={phase.code}>
                <p className="flex items-start gap-1.5 t-body-compact text-danger" role="alert">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                  {phase.message}
                </p>
                <div className="flex flex-wrap gap-x-3">
                  {phase.retry ? (
                    <button
                      type="button"
                      className="v3-ai-link t-label"
                      onClick={() => { const retry = phase.retry; byHand(retry === "load" ? load : () => generate(retry as AiIntent)); }}
                    >
                      Повторить
                    </button>
                  ) : null}
                  {phase.code === "budget_exhausted" ? (
                    <Link href="/v3/ai-agent?section=spend" className="v3-ai-link t-label">Открыть «Расходы»</Link>
                  ) : null}
                </div>
              </div>
            ) : null}

            {ready && result ? (
              <div className="space-y-4" data-testid="v3-ai-answer" data-current={!isStale || undefined}>
                {isStale ? (
                  <p className="v3-ai-flag t-body-compact" data-tone="warn" role="status">
                    <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                    Пришло новое сообщение — обновите ответ.
                  </p>
                ) : null}
                <p className={`whitespace-pre-wrap break-words t-body-compact ${isStale ? "text-fg-3" : "text-fg"}`} data-testid="v3-ai-reply" lang={result.language ?? undefined}>
                  {replySegments(result).map((segment, index) => (
                    <span key={index}>
                      {segment.text}
                      {segment.marks.map((n) => <SourceMark key={n} n={n} onSelect={selectSource} />)}
                    </span>
                  ))}
                </p>
                {warnings.length > 0 ? (
                  <ul className="space-y-1.5" data-testid="v3-ai-warnings">
                    {warnings.map((warning) => (
                      <li key={warning} className="v3-ai-flag t-body-compact" data-tone="warn">
                        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                        {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {result.question.trim() ? (
                  <div className="v3-ai-question">
                    <p className="t-caption text-fg-3">Спросите клиента</p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words t-body-compact text-fg">{result.question}</p>
                    <button
                      type="button"
                      className="v3-ai-link t-label"
                      aria-disabled={isStale || inserting !== null || undefined}
                      onClick={() => { if (!isStale) void insert(ready, "question"); }}
                    >
                      {inserting === "question" ? "Вставляю…" : "Вставить вопрос"}
                    </button>
                  </div>
                ) : null}
                {result.reason.trim() ? (
                  <details className="v3-ai-why">
                    <summary className="t-label text-fg">
                      <Icon name="chevron-right" size={16} className="v3-ai-why-chevron shrink-0" />
                      Почему такой ответ
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap break-words t-body-compact text-fg-2">{result.reason}</p>
                  </details>
                ) : null}
                {result.sources.length > 0 ? (
                  <div>
                    <h3 className="t-caption text-fg-3">Источники</h3>
                    <ol className="mt-1.5 space-y-2" data-testid="v3-ai-sources">
                      {result.sources.map((source, index) => (
                        <SourceRow key={`${source.n ?? "x"}-${index}`} source={source} highlighted={source.n !== null && source.n === highlight} />
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {ready && result ? (
            <footer className="v3-ai-foot">
              {note ? (
                <p className="w-full t-body-compact" data-tone={note.tone} role={note.tone === "ok" ? "status" : "alert"}>{note.text}</p>
              ) : null}
              {/* Пока идёт вставка и у устаревшего ответа кнопка недоступна через
                  aria-disabled: фокус остаётся на ней, а не уходит в никуда. */}
              <button
                type="button"
                className="v3-ai-button"
                aria-disabled={isStale || inserting !== null || undefined}
                onClick={() => { if (!isStale) void insert(ready, "reply"); }}
                aria-describedby={isStale ? `${titleId}-stale` : undefined}
                data-testid="v3-ai-insert"
              >
                {inserting === "reply" ? "Вставляю…" : "Вставить в ответ"}
              </button>
              {isStale ? <span id={`${titleId}-stale`} className="sr-only">Ответ устарел: пришло новое сообщение.</span> : null}
              <button
                type="button"
                className="v3-ai-link t-label"
                onClick={() => byHand(isStale ? load : () => generate(ready.intent))}
              >
                Обновить ответ
              </button>
            </footer>
          ) : null}
        </section>
      )}
    </div>
  );
}
