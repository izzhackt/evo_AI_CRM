"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Icon } from "@/components/icons";
import {
  aiErrorBlocked,
  aiErrorCopy,
  aiErrorRetryable,
  aiWindowErrorReason,
  aiWindowUnavailable,
  answerWarnings,
  createSseDecoder,
  normalizeAiAnswerView,
  parseAiStreamEvent,
  replySegments,
  sourcePlace,
  sourcesWord,
  type AiAnswerView,
  type AiIntent,
  type AiSavedAnswer,
  type AiSource,
} from "@/lib/v3/ai-agent";

import { InboxAiAutosend } from "./InboxAiAutosend";
import { InboxAiMemory } from "./InboxAiMemory";

/**
 * Окно ИИ в чате продаж (план ИИ-агента §12.1; решение владельца 08.10.2026
 * «сделай нам window как в soodacloser»). Свёрнуто — тёмная стеклянная капсула
 * «Помочь с ответом» с точкой состояния в правом нижнем углу ленты. Раскрыто —
 * тёмная карточка растёт вверх из капсулы, привязана к ней (не перетаскивается,
 * позиция нигде не хранится), не затемняет чат и не закрывает поле ответа.
 * Esc, «×» и нажатие мимо карточки её сворачивают; Esc и «×» возвращают фокус
 * на капсулу.
 *
 * Свёрнутое окно ничего не запрашивает. Открытие читает сохранённый ответ
 * (`GET …/answer`, без Gemini); если последнее сообщение — клиента и
 * актуального ответа нет, запрос идёт сам. Новое сообщение клиента при
 * открытом окне — новый запрос; при свёрнутом — ответ только помечается
 * устаревшим. Сворачивание запрос не прерывает: готовый ответ ждёт в окне, а
 * капсула один раз проводит бликом по краю. Поток агента — живой предпросмотр;
 * после него окно читает сохранённый, проверенный ответ. «Добавить в поле
 * ответа» берёт текст у базы (`body.text`; 409 — переписка изменилась),
 * добавляет его к написанному, сворачивает окно и ставит фокус в поле.
 * Ничего не отправляется. Оборванный поток оставляет дописанное — тусклым и
 * без вставки: у него нет `answerId`.
 *
 * Внизу карточки — «Что ИИ знает о клиенте» (P3, §9; `InboxAiMemory`) и
 * «Автоответчик в этом чате» (P4, §11; `InboxAiAutosend`, если автоответчик
 * включён). Когда помощник недоступен (не подключён, выключен, лимит, баланс),
 * в окне одна строка причины — без ссылок на согласие, лимит и расходы.
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
  /** Клиент писал подряд, пока готовился ответ: дальше — только по кнопке. */
  | Readonly<{ kind: "capped" }>
  | Readonly<{ kind: "streaming"; token: number; intent: AiIntent; stage: "searching" | "writing"; sources: number | null; preview: string }>
  | Readonly<{ kind: "ready"; answer: AiSavedAnswer }>
  /** `partial` — дописанное до обрыва потока: только показать, вставлять нечего. */
  | Readonly<{ kind: "error"; code: string; reason: string | null; retry: AiIntent | "load" | null; partial: string | null }>
  | Readonly<{ kind: "blocked"; code: string }>;

type Tone = "idle" | "working" | "ready" | "attention" | "error";

/** Подряд «пришло новое сообщение» без готового ответа: дальше — только по кнопке. */
const SUPERSEDE_LIMIT = 3;
/** Через столько поток подсказывает, что окно можно свернуть. */
const SLOW_HINT_MS = 6000;
/** Сворачивание карточки (ai-agent.css, `v3-ai-card-close`). */
const CLOSE_MS = 200;

function toneOf(phase: Phase, stale: boolean): Tone {
  if (phase.kind === "streaming" || phase.kind === "loading") return "working";
  if (phase.kind === "error") return "error";
  if (phase.kind === "blocked" || phase.kind === "capped") return "attention";
  if (phase.kind === "ready") {
    if (stale || !phase.answer.current) return "attention";
    return phase.answer.result && answerWarnings(phase.answer.result).length > 0 ? "attention" : "ready";
  }
  return "idle";
}

const TONE_WORD: Readonly<Record<Tone, string>> = {
  idle: "ждёт", working: "готовит ответ", ready: "ответ готов", attention: "требует внимания", error: "ошибка",
};

/** Главная кнопка карточки: пока пишется — недоступна, после вставки — «Уже в поле ответа», пока поле не опустеет. */
const PRIMARY_LABEL = Object.freeze({
  writing: "Дописываю ответ…", refresh: "Обновить ответ", adding: "Добавляю…", added: "Уже в поле ответа", add: "Добавить в поле ответа",
} as const);

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Номер источника в тексте: видимый кружок, цель 44 px — у ::after. */
function SourceMark({ n, onSelect }: Readonly<{ n: number; onSelect: (n: number) => void }>) {
  return (
    <button type="button" onClick={() => onSelect(n)} className="v3-ai-mark" aria-label={`Источник ${n}`}>
      {n}
    </button>
  );
}

/** Длинная цитата свёрнута до семи строк. */
const QUOTE_CLAMP_FROM = 360;

function SourceRow({
  source,
  open,
  highlighted,
  onToggle,
}: Readonly<{ source: AiSource; open: boolean; highlighted: boolean; onToggle: () => void }>) {
  const id = useId();
  const place = sourcePlace(source);
  const [whole, setWhole] = useState(false);
  const internal = source.audience === "internal";
  const long = (source.quote?.length ?? 0) > QUOTE_CLAMP_FROM;
  const expandable = !source.missing && (!!source.quote || !!source.sectionPath);
  const flags = (
    <>
      {internal ? <span className="v3-ai-flagword">внутр.<span className="sr-only"> — клиенту не цитируется</span></span> : null}
      {source.unverified ? (
        <span
          className="v3-ai-flagword"
          data-tone="warn"
          title={source.unverifiedValues.length > 0 ? `Число в источнике ещё не проверено: ${source.unverifiedValues.join(", ")}` : undefined}
        >
          не проверено
        </span>
      ) : null}
      {!source.live && !source.missing ? <span className="v3-ai-flagword">документ заменён</span> : null}
    </>
  );
  const head = (
    <>
      <span className="v3-ai-source-n" data-internal={internal || undefined} aria-hidden="true">{source.n ?? "·"}</span>
      <span className="min-w-0 flex-1">
        <span className="v3-ai-source-title t-item">
          <span className="sr-only">Источник {source.n}: </span>
          {source.missing ? "Документ удалён" : source.title}
        </span>
        <span className="v3-ai-source-meta t-meta">
          {place ? <span>{place}</span> : null}
          {flags}
        </span>
      </span>
      {internal ? <Icon name="lock" size={16} className="v3-ai-source-lock shrink-0" /> : null}
    </>
  );
  return (
    <li
      data-source-n={source.n ?? undefined}
      data-open={(open && expandable) || undefined}
      data-highlighted={highlighted || undefined}
      className="v3-ai-source"
    >
      {expandable ? (
        <button type="button" className="v3-ai-source-head" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}>
          {head}
          <Icon name="chevron-down" size={16} className="v3-ai-source-chevron shrink-0" />
        </button>
      ) : (
        <div className="v3-ai-source-head">{head}</div>
      )}
      {expandable && open ? (
        <div id={`${id}-body`} className="v3-ai-source-body">
          {source.sectionPath ? <p className="t-meta break-words text-fg-3">{source.sectionPath}</p> : null}
          {source.quote ? (
            <blockquote id={`${id}-quote`} className="v3-ai-quote t-body-compact" data-clamped={(long && !whole) || undefined}>
              {source.quote}
            </blockquote>
          ) : null}
          {long ? (
            <button type="button" className="v3-ai-link t-label" aria-expanded={whole} aria-controls={`${id}-quote`} onClick={() => setWhole((value) => !value)}>
              {whole ? "Свернуть фрагмент" : "Весь фрагмент"}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function InboxAiAssistant({
  conversationId,
  latestInboundMessageId,
  config,
  lifted,
  fieldHasText,
  onInsert,
}: Readonly<{
  conversationId: string;
  latestInboundMessageId: string | null;
  config: InboxAssistantConfig;
  /** Над капсулой стоит «Новые сообщения ↓» на узком экране. */
  lifted: boolean;
  /** В поле ответа есть текст: добавленный ответ остаётся «Уже в поле ответа», пока поле не опустеет. */
  fieldHasText: boolean;
  /** Добавляет текст в поле ответа и ставит туда фокус; ничего не отправляет. */
  onInsert: (text: string) => void;
}>) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const capsuleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const supersedes = useRef(0);
  const streamToken = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Последнее сообщение клиента, увиденное последним — из базы или из страницы. */
  const knownInbound = useRef<string | null>(latestInboundMessageId);

  /** Карточка в DOM (и во время сворачивания). */
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const open = expanded && !closing;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [stale, setStale] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [inserting, setInserting] = useState<"reply" | "question" | null>(null);
  /** Что из этого ответа уже добавлено в поле — до того, как поле опустеет. */
  const [inserted, setInserted] = useState<Readonly<{ answerId: string; reply: boolean; question: boolean }> | null>(null);
  const [openSources, setOpenSources] = useState<readonly number[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Ответ стал готов при свёрнутом окне: капсула один раз проводит бликом по краю. */
  const [sweep, setSweep] = useState(0);
  const [slowToken, setSlowToken] = useState(0);
  const [capsuleWidth, setCapsuleWidth] = useState<number | null>(null);

  const expandedRef = useRef(false);

  // Поле опустело (отправлено или стёрто) — добавленный ответ снова можно добавить.
  const [seenFieldText, setSeenFieldText] = useState(fieldHasText);
  if (seenFieldText !== fieldHasText) {
    setSeenFieldText(fieldHasText);
    if (!fieldHasText && inserted) setInserted(null);
  }

  const finishStream = useCallback(() => {
    streamAbort.current?.abort();
    streamAbort.current = null;
  }, []);
  useEffect(() => finishStream, [finishStream]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // Долгий поток: через 6 с — «Можно свернуть — ответ останется здесь.»
  const streamingToken = phase.kind === "streaming" ? phase.token : 0;
  useEffect(() => {
    if (!streamingToken) return;
    const timer = setTimeout(() => setSlowToken(streamingToken), SLOW_HINT_MS);
    return () => clearTimeout(timer);
  }, [streamingToken]);

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

  /** Готовый ответ при свёрнутом окне — один блик по краю капсулы. */
  const settle = useCallback((answer: AiSavedAnswer) => {
    setPhase({ kind: "ready", answer });
    if (!expandedRef.current) setSweep((value) => value + 1);
  }, []);

  const fail = useCallback((code: string, message: string | null, retry: AiIntent | "load" | null, partial: string | null = null) => {
    if (aiErrorBlocked(code) || aiWindowUnavailable(code) !== null) {
      setPhase({ kind: "blocked", code });
      return;
    }
    setPhase({
      kind: "error",
      code,
      reason: aiWindowErrorReason(code, message),
      retry: aiErrorRetryable(code) ? retry : null,
      partial: partial && partial.trim() ? partial : null,
    });
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
      setPhase({ kind: "capped" });
      return;
    }
    setStale(true);
    setPhase({ kind: "idle" });
  }, []);

  const generate = useCallback(async (intent: AiIntent) => {
    finishStream();
    const controller = new AbortController();
    streamAbort.current = controller;
    streamToken.current += 1;
    const token = streamToken.current;
    /** Дописанное до обрыва — показывается тусклым под «Ответ не дописан». */
    let written = "";
    setStale(false);
    setNote(null);
    setPhase({ kind: "streaming", token, intent, stage: "searching", sources: null, preview: "" });
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
            written = (written + event.text).slice(0, 8000);
            const preview = written;
            setPhase((previous) => previous.kind === "streaming" ? { ...previous, stage: "writing", preview } : previous);
          } else if (event.type === "final") {
            settled = true;
            supersedes.current = 0;
            // Показывается сохранённый, проверенный ответ с источниками из базы.
            const saved = await readSaved(intent);
            if (controller.signal.aborted) return;
            if ("code" in saved) fail(saved.code, null, "load");
            else if (saved.view.answer?.status === "ready" && saved.view.answer.result) settle(saved.view.answer);
            else fail("unavailable", null, intent);
          } else {
            settled = true;
            if (event.code === "superseded") {
              afterSuperseded();
            } else {
              fail(event.code, event.message, intent, written);
            }
          }
        }
      }
    } catch {
      if (controller.signal.aborted) return;
      settled = true;
      fail("agent_unavailable", null, intent, written);
    } finally {
      reader.cancel().catch(() => undefined);
      if (streamAbort.current === controller) streamAbort.current = null;
    }
    if (!settled && !controller.signal.aborted) fail("agent_unavailable", null, intent, written);
  }, [conversationId, afterSuperseded, fail, finishStream, readSaved, settle]);

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
    const action = !open ? "mark" : config.featureOn ? "regenerate" : phase.kind === "ready" ? "mark" : "reload";
    setInboundTurn((previous) => ({ n: previous.n + 1, action, id: latestInboundMessageId }));
    if (action !== "regenerate") setStale(true);
    if (!open) setPhase((previous) => (previous.kind === "ready" ? previous : { kind: "idle" }));
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

  function expand() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    expandedRef.current = true;
    setCapsuleWidth(capsuleRef.current?.offsetWidth ?? null);
    setClosing(false);
    setExpanded(true);
    setSweep(0);
    setAnnouncement("");
    setHighlight(null);
    // Без агента сохранённое всё равно читается: прежний ответ может быть актуален.
    // Ошибка и «недоступен» тоже перечитываются: администратор мог включить
    // агента, сбой — пройти, а у недоступности нет «Попробовать снова».
    if (phase.kind === "idle" || phase.kind === "blocked" || phase.kind === "error" || (phase.kind === "ready" && stale)) {
      byHand(load);
    }
    requestAnimationFrame(() => closeRef.current?.focus());
  }

  /**
   * Свернуть: Esc и «×» возвращают фокус на капсулу, нажатие мимо карточки —
   * нет (фокус уходит туда, куда нажали), вставка — в поле ответа.
   */
  const collapse = useCallback((focusCapsule: boolean) => {
    if (!expandedRef.current) return;
    expandedRef.current = false;
    const done = () => {
      closeTimer.current = null;
      setClosing(false);
      setExpanded(false);
      if (focusCapsule) requestAnimationFrame(() => capsuleRef.current?.focus());
    };
    if (reducedMotion()) {
      done();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(done, CLOSE_MS);
  }, []);

  // Нажатие мимо карточки сворачивает её (окно не модальное: чат не заперт).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const card = cardRef.current;
      if (!card || card.contains(event.target as Node)) return;
      collapse(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, collapse]);

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
          // В поле уходит только текст базы — не предпросмотр потока.
          onInsert(body.text);
          setInserted((previous) => ({
            answerId: answer.answerId,
            reply: part === "reply" || (previous?.answerId === answer.answerId && previous.reply),
            question: part === "question" || (previous?.answerId === answer.answerId && previous.question),
          }));
          setAnnouncement(part === "reply" ? "Ответ добавлен в поле — отправьте сами" : "Вопрос добавлен в поле — отправьте сами");
          collapse(false);
          return;
        }
        setNote(aiErrorCopy("unavailable"));
        return;
      }
      const code = await readErrorCode(response);
      if (code === "stale_answer") {
        // Кнопка становится «Обновить ответ»; фокус остаётся на ней.
        setStale(true);
        return;
      }
      setNote(code === "forbidden" ? aiErrorCopy("forbidden") : "Не удалось добавить ответ. Попробуйте ещё раз.");
    } catch {
      setNote("Не удалось добавить ответ. Попробуйте ещё раз.");
    } finally {
      setInserting(null);
    }
  }

  function selectSource(n: number) {
    setHighlight(n);
    setOpenSources((previous) => (previous.includes(n) ? previous : [...previous, n]));
    requestAnimationFrame(() => cardRef.current?.querySelector<HTMLElement>(`[data-source-n="${n}"]`)?.scrollIntoView({
      block: "nearest", behavior: reducedMotion() ? "auto" : "smooth",
    }));
  }
  function toggleSource(n: number) {
    setOpenSources((previous) => (previous.includes(n) ? previous.filter((item) => item !== n) : [...previous, n]));
  }

  function onCardKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      collapse(true);
    }
  }

  const tone = toneOf(phase, stale);
  const ready = phase.kind === "ready" ? phase.answer : null;
  const result = ready?.result ?? null;
  const isStale = ready !== null && (stale || !ready.current);
  const warnings = result ? answerWarnings(result) : [];
  const internalUsed = !!result?.sources.some((source) => source.audience === "internal" && !source.missing);
  const replyIn = !!ready && inserted?.answerId === ready.answerId && inserted.reply;
  const questionIn = !!ready && inserted?.answerId === ready.answerId && inserted.question;
  const followup = (phase.kind === "streaming" && phase.intent === "followup") || ready?.intent === "followup" || phase.kind === "waiting";

  // Строка состояния — первая строка карточки; у пустых и недоступных состояний это и заголовок.
  let status: string;
  let statusKind: "progress" | "title" = "progress";
  let statusTone: "neutral" | "warn" | "danger" = "neutral";
  if (phase.kind === "streaming") {
    status = phase.stage === "searching" ? "Ищу в материалах"
      : phase.sources === null ? "Пишу ответ"
        : phase.sources === 0 ? "Источников нет · пишу ответ" : `Нашёл ${sourcesWord(phase.sources)} · пишу ответ`;
  } else if (phase.kind === "loading") {
    status = "Открываю сохранённый ответ";
  } else if (ready && result) {
    status = isStale ? "Ответ устарел" : `Ответ готов · ${result.sources.length > 0 ? sourcesWord(result.sources.length) : "без источников"}`;
    if (isStale) statusTone = "warn";
  } else {
    statusKind = "title";
    if (phase.kind === "waiting") status = "Ждём ответ клиента";
    else if (phase.kind === "no-client") status = "Сначала — вопрос клиента";
    else if (phase.kind === "capped") status = "Клиент пишет несколько сообщений подряд";
    else if (phase.kind === "blocked") status = "Помощник сейчас недоступен";
    else if (phase.kind === "error") {
      status = phase.partial ? "Ответ не дописан" : "Не удалось подготовить ответ";
      statusTone = "danger";
    } else status = "Помощь с ответом";
  }
  const slow = phase.kind === "streaming" && slowToken === phase.token;
  const showExtras = phase.kind !== "blocked";

  // Одна главная кнопка во всю ширину: пока пишется — недоступна, устарело — «Обновить ответ».
  const primary: "writing" | "refresh" | "adding" | "added" | "add" | null = phase.kind === "streaming" ? "writing"
    : !ready || !result ? null
      : isStale ? "refresh"
        : inserting === "reply" ? "adding"
          : replyIn ? "added" : "add";
  const primaryDisabled = primary === "writing" || primary === "adding" || primary === "added" || (primary === "add" && inserting !== null);
  function runPrimary() {
    if (primaryDisabled || !ready) return;
    if (primary === "refresh") byHand(load);
    else if (primary === "add") void insert(ready, "reply");
  }

  return (
    <div className="v3-ai-area pointer-events-none absolute inset-0 z-10" data-testid="v3-ai-assistant" data-expanded={open || undefined} data-tone={tone}>
      {/* Итог вставки — вежливо и после сворачивания (карточки уже нет). */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="v3-ai-announcement">{announcement}</p>
      {!expanded ? (
        <button
          ref={capsuleRef}
          type="button"
          onClick={expand}
          aria-label="Помочь с ответом — открыть помощника"
          aria-describedby={`${titleId}-state`}
          aria-expanded={false}
          aria-haspopup="dialog"
          className="v3-ai-capsule pointer-events-auto"
          data-lifted={lifted || undefined}
          data-sweep={sweep > 0 || undefined}
          data-testid="v3-ai-capsule"
        >
          <Icon name="sparkles" size={18} className="v3-ai-spark shrink-0" />
          <span className="t-label">Помочь с ответом</span>
          <span className="v3-ai-dot" data-tone={tone} aria-hidden="true" />
          {sweep > 0 ? <span key={sweep} className="v3-ai-sweep" aria-hidden="true" /> : null}
          <span id={`${titleId}-state`} className="sr-only">Состояние: {TONE_WORD[tone]}</span>
        </button>
      ) : (
        <section
          ref={cardRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={onCardKey}
          className="v3-ai-card pointer-events-auto"
          data-closing={closing || undefined}
          data-testid="v3-ai-window"
          style={capsuleWidth ? ({ "--ai-from-w": `${capsuleWidth}px` } as CSSProperties) : undefined}
        >
          <header className="v3-ai-head">
            <Icon name="sparkles" size={20} className="v3-ai-spark shrink-0" />
            <h2 id={titleId} className="sr-only">{followup ? "Следующий шаг" : "Помощь с ответом"}</h2>
            <button ref={closeRef} type="button" onClick={() => collapse(true)} aria-label="Свернуть помощника" className="v3-ai-close">
              <Icon name="x" size={20} className="shrink-0" />
            </button>
          </header>

          <div className="v3-ai-body">
            <div className="v3-ai-lead">
              <p className="v3-ai-status" role="status" data-kind={statusKind} data-tone={statusTone} data-testid="v3-ai-status">
                {statusKind === "progress" ? <span className="v3-ai-dot" data-tone={tone} aria-hidden="true" /> : null}
                {status}
              </p>
              {slow ? <p className="t-meta text-fg-3" data-testid="v3-ai-slow">Можно свернуть — ответ останется здесь.</p> : null}

              {phase.kind === "loading" || (phase.kind === "streaming" && phase.preview === "") ? (
                <div className="v3-ai-skeletons" aria-hidden="true">
                  <div className="v3-ai-skeleton w-[94%]" />
                  <div className="v3-ai-skeleton w-[86%]" />
                  <div className="v3-ai-skeleton w-[58%]" />
                </div>
              ) : null}

              {phase.kind === "streaming" && phase.preview ? (
                <p className="v3-ai-reply" data-state="streaming" data-testid="v3-ai-preview" aria-busy="true">
                  {phase.preview}
                  <span className="v3-ai-caret" aria-hidden="true" />
                </p>
              ) : null}

              {phase.kind === "waiting" ? (
                <button type="button" className="v3-ai-primary" onClick={() => byHand(() => generate("followup"))}>
                  Подготовить продолжение
                </button>
              ) : null}

              {phase.kind === "capped" ? (
                <button type="button" className="v3-ai-primary" onClick={() => byHand(load)}>
                  Подготовить ответ
                </button>
              ) : null}

              {phase.kind === "blocked" ? (
                <p className="t-body-compact text-fg-2" data-testid="v3-ai-blocked" data-code={phase.code}>
                  {aiWindowUnavailable(phase.code) ?? aiErrorCopy(phase.code)}
                </p>
              ) : null}

              {phase.kind === "error" ? (
                <div className="v3-ai-lead" data-testid="v3-ai-error" data-code={phase.code}>
                  {phase.partial ? (
                    <p className="v3-ai-reply" data-state="partial" data-testid="v3-ai-partial">{phase.partial}</p>
                  ) : null}
                  {phase.reason ? (
                    <p className="v3-ai-flag" data-tone="danger" role="alert">
                      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                      {phase.reason}
                    </p>
                  ) : null}
                  {phase.retry ? (
                    <button
                      type="button"
                      className="v3-ai-primary"
                      onClick={() => { const retry = phase.retry; byHand(retry === "load" ? load : () => generate(retry as AiIntent)); }}
                    >
                      Попробовать снова
                    </button>
                  ) : null}
                </div>
              ) : null}

              {ready && result ? (
                <div className="v3-ai-lead" data-testid="v3-ai-answer" data-current={!isStale || undefined}>
                  {isStale ? (
                    <p className="v3-ai-flag" data-tone="warn" id={`${titleId}-stale`}>
                      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                      Переписка изменилась. Обновите ответ перед использованием.
                    </p>
                  ) : null}
                  <p className="v3-ai-reply" data-state={isStale ? "stale" : "final"} data-testid="v3-ai-reply" lang={result.language ?? undefined}>
                    {replySegments(result).map((segment, index) => (
                      <span key={index}>
                        {segment.text}
                        {segment.marks.map((n) => <SourceMark key={n} n={n} onSelect={selectSource} />)}
                      </span>
                    ))}
                  </p>
                  {warnings.length > 0 || internalUsed ? (
                    <ul className="v3-ai-warnings" data-testid="v3-ai-warnings">
                      {warnings.map((warning) => (
                        <li key={warning} className="v3-ai-flag" data-tone="warn">
                          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                          {warning}
                        </li>
                      ))}
                      {internalUsed ? (
                        <li className="v3-ai-flag" data-tone="warn" data-testid="v3-ai-internal-note">
                          <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
                          Учтён внутренний документ — клиенту не цитируется.
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {primary ? (
                <button
                  type="button"
                  className="v3-ai-primary"
                  // Недоступная кнопка держит фокус (aria-disabled), а не теряет его.
                  aria-disabled={primaryDisabled || undefined}
                  aria-describedby={isStale ? `${titleId}-stale` : undefined}
                  onClick={runPrimary}
                  data-testid="v3-ai-insert"
                  data-action={primary}
                >
                  {primary === "add" ? <Icon name="arrow-right" size={18} className="shrink-0" /> : null}
                  {PRIMARY_LABEL[primary]}
                </button>
              ) : null}
              {note ? <p className="v3-ai-flag" data-tone="danger" role="alert" data-testid="v3-ai-note">{note}</p> : null}
            </div>

            {ready && result && result.question.trim() ? (
              <section className="v3-ai-section" aria-labelledby={`${titleId}-question`}>
                <h3 id={`${titleId}-question`} className="t-caption text-fg-3">Стоит уточнить</h3>
                <p className="mt-1 whitespace-pre-wrap break-words t-body-compact text-fg">{result.question}</p>
                <button
                  type="button"
                  className="v3-ai-link t-label"
                  aria-disabled={isStale || questionIn || inserting !== null || undefined}
                  onClick={() => { if (!isStale && !questionIn && inserting === null) void insert(ready, "question"); }}
                >
                  {inserting === "question" ? "Добавляю…" : questionIn ? "Вопрос уже в поле" : "Добавить вопрос"}
                </button>
              </section>
            ) : null}

            {ready && result ? (
              <section className="v3-ai-section" aria-labelledby={`${titleId}-sources`}>
                <h3 id={`${titleId}-sources`} className="t-caption text-fg-3">Источники</h3>
                {result.sources.length > 0 ? (
                  <ol className="v3-ai-sources" data-testid="v3-ai-sources">
                    {result.sources.map((source, index) => (
                      <SourceRow
                        key={`${source.n ?? "x"}-${index}`}
                        source={source}
                        open={source.n !== null && openSources.includes(source.n)}
                        highlighted={source.n !== null && source.n === highlight}
                        onToggle={() => { if (source.n !== null) toggleSource(source.n); }}
                      />
                    ))}
                  </ol>
                ) : (
                  <p className="mt-1 t-body-compact text-fg-2">В материалах ничего не нашлось.</p>
                )}
              </section>
            ) : null}

            {ready && result && result.reason.trim() ? (
              <details className="v3-ai-section v3-ai-why">
                <summary className="t-label text-fg">
                  <Icon name="chevron-right" size={16} className="v3-ai-why-chevron shrink-0" />
                  Почему такой ответ
                </summary>
                <p className="v3-ai-why-body whitespace-pre-wrap break-words t-body-compact text-fg-2">{result.reason}</p>
              </details>
            ) : null}

            {/* Память (P3) читается при каждом открытии окна, автоответчик (P4) — только когда включён в организации;
                сбой их чтения ответу не мешает. При недоступном помощнике — одна строка причины. */}
            {showExtras ? (
              <div className="v3-ai-extras">
                <InboxAiMemory conversationId={conversationId} />
                <InboxAiAutosend conversationId={conversationId} />
              </div>
            ) : null}

            {ready && result && !isStale ? (
              <div className="v3-ai-section v3-ai-refresh">
                <button type="button" className="v3-ai-link t-label" onClick={() => byHand(() => generate(ready.intent))}>
                  <Icon name="refresh" size={16} className="shrink-0" />
                  Обновить ответ
                </button>
              </div>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
