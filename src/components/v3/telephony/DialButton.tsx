"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { DIAL_ABOUT, DIAL_COPY, dialRouteAnswer } from "@/lib/v3/telephony-dial";

/** Как у соседних вторичных действий заголовка карточки лида и чата: 44 px, рамка контрола, без красного. */
const ACTION_CLASS = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3";
/** Строка «Сегодня»: значок 44 px над ссылкой, покрывающей строку (`z-10`), без рамки. */
const ROW_CLASS = "relative z-10 grid min-h-11 min-w-11 place-items-center rounded-nav text-fg-2 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3";
/** Сколько кнопка стоит после принятого звонка: столько же, сколько ВАТС держит паузу между наборами у сотрудника. */
const COOLDOWN_MS = 6_000;
/** Сколько сообщение остаётся на экране, пока его не закрыли: фраза длинная, её нужно успеть прочесть. */
const TOAST_MS = 14_000;

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * «Позвонить» («Телефония Beeline KG», срез T7; план §5.4, §8, §12): одна кнопка, которую на
 * страницу кладёт сервер, только если база сказала `enabled` (флаги, право, нет паузы). Браузер
 * присылает ИДЕНТИФИКАТОР ЛИДА и свой `requestId`, номера клиента у него нет. ВАТС звонит
 * не клиенту, а сначала самому сотруднику (приложение или вкладка с телефоном), и только после
 * ответа набирает клиента — поэтому подсказка и ответ говорят об этом прямо.
 *
 * Один и тот же `requestId` живёт, пока ответа НАШЕГО маршрута не было (обрыв связи, страница
 * шлюза 502/504): повторное нажатие тогда повторяет тот же запрос, и второго звонка не будет;
 * если звонок уже был набран, маршрут отвечает, что он был, а не «Звоним». Ответ маршрута
 * завершает попытку, следующее нажатие — новый звонок. После принятого звонка кнопка ненадолго замирает,
 * чтобы не упереться в паузу между наборами. Сообщение — строка в верхнем слое у верхнего края
 * (как «Вышла новая версия»): нижний край занят «Отменить» и полями ответа чата. Решает база и
 * сервер; кнопка показывает их слова. Не сопоставленному сотруднику кнопка отвечает, что делать,
 * и ничего не отправляет.
 */
export function DialButton({
  leadId,
  mapped,
  variant = "action",
  subject = null,
}: Readonly<{
  leadId: string;
  /** Сотрудник сопоставлен с пользователем ВАТС (иначе набор всё равно откажет). */
  mapped: boolean;
  variant?: "action" | "row";
  /** Кого набираем — имя для читалки у кнопки без слов (строка «Сегодня»). */
  subject?: string | null;
}>) {
  const hintId = useId();
  const requestId = useRef<string | null>(null);
  const toast = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Другой лид — другой звонок: прежний незавершённый запрос к нему не относится.
  useEffect(() => {
    requestId.current = null;
  }, [leadId]);

  // Сообщение показывается в верхнем слое и убирается само; закрыть можно раньше.
  useEffect(() => {
    const element = toast.current;
    if (note === null || !element) return;
    // Как у «Вышла новая версия»: без верхнего слоя (старый браузер) строка остаётся в потоке.
    if (typeof element.showPopover === "function" && !element.matches(":popover-open")) element.showPopover();
    const timer = setTimeout(() => setNote(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(() => setCooling(false), COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [cooling]);

  async function press() {
    if (pending || cooling) return;
    if (!mapped) {
      setNote(DIAL_COPY.notMapped);
      return;
    }
    setPending(true);
    setNote(null);
    const id = requestId.current ?? newRequestId();
    requestId.current = id;
    try {
      const response = await fetch("/api/v3/telephony/dial", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ leadId, requestId: id }),
      });
      const body: unknown = await response.json().then((value: unknown) => value, () => null);
      const answer = dialRouteAnswer(response.ok, body);
      // Ответ нашего маршрута завершает попытку: следующее нажатие — новый звонок. Ответ шлюза
      // (502/504, чужое тело) о звонке не говорит: id остаётся, повтор не удвоит звонок.
      if (answer.answered) requestId.current = null;
      setNote(answer.note);
      if (response.ok && answer.answered) setCooling(true);
    } catch {
      // Ответа не было: звонок мог уйти. Тот же requestId сохранён, повтор его не удвоит.
      setNote(DIAL_COPY.network);
    } finally {
      setPending(false);
    }
  }

  const busy = pending || cooling;
  const label = pending ? DIAL_COPY.busy : DIAL_COPY.button;
  return (
    <>
      <button
        type="button"
        className={variant === "row" ? ROW_CLASS : ACTION_CLASS}
        disabled={busy}
        aria-disabled={!mapped ? true : undefined}
        aria-describedby={hintId}
        aria-label={variant === "row" ? `${DIAL_COPY.button}${subject ? `: ${subject}` : ""}` : undefined}
        title={DIAL_ABOUT}
        data-testid="v3-dial-button"
        onClick={() => void press()}
      >
        <Icon name="phone" size={variant === "row" ? 20 : 18} className="shrink-0" />
        {variant === "action" ? <span className="sr-only sm:not-sr-only">{label}</span> : null}
      </button>
      <span id={hintId} className="sr-only">{DIAL_ABOUT}</span>
      <span role="status" aria-live="polite" className="sr-only">{note}</span>
      {note !== null ? (
        <div ref={toast} popover="manual" className="v3-toasts" data-edge="top" data-testid="v3-dial-toast">
          <div className="v3-toast">
            <p className="min-w-0 flex-1 break-words py-2 t-body-compact">{note}</p>
            <button type="button" className="v3-toast-action t-label" onClick={() => setNote(null)}>Закрыть</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
