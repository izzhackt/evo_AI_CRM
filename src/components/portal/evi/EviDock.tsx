"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import { EVI_FAILURE_ACTION, EVI_LIMITS, type EviFailure } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

import { useAllowAi } from "./useAllowAi";
import type { EviOptions } from "./useEviConversation";

type Strings = PortalStrings<"professions">;

/**
 * Нажатая кнопка исчезает (вариант ответа, «Готово», «Повторить», «Новый чат», «Разрешить») — фокус переходит на
 * разговор, а не теряется в начале страницы (фикс владельца от 16.11 к «Подбору с Эви»). Поле ввода не трогаем: на телефоне фокус
 * в нём открывал бы клавиатуру после каждой кнопки.
 */
export function keepEviFocus() {
  requestAnimationFrame(() => {
    if (document.activeElement === document.body) document.getElementById("pt-evi-log")?.focus({ preventScroll: true });
  });
}

/** «Разрешить ИИ-помощников» прямо в чате: после согласия тот же вопрос уходит снова, разговор не теряется. */
function EviAllowAction({ strings, onDone }: Readonly<{ strings: Strings; onDone: () => void }>) {
  const { allow, pending, failed } = useAllowAi(onDone);
  return (
    <>
      <button type="button" className="pt-evi-chip pt-evi-go" aria-disabled={pending} onClick={allow}>{strings["evi.allow"]}</button>
      {failed ? <p role="alert" className="pt-evi-error">{strings["evi.allowError"]}</p> : null}
    </>
  );
}

/**
 * Ответ ученика: варианты кнопками (следующий шаг — красная; на телефоне варианты — лента с прокруткой вбок, «Готово»
 * стоит рядом с ней), при сбое — ровно одно действие на месте вариантов,
 * поле ввода растёт до пяти строк (Enter — отправить, Shift+Enter — новая строка). После нажатия варианта фокус
 * переходит на разговор (`keepEviFocus`).
 */
export function EviDock({ strings, options, picked, failure, canRetry, round, draft, pending, onDraft, onSend, onToggle, onRetry, onRestart }: Readonly<{
  strings: Strings;
  options: EviOptions;
  picked: ReadonlySet<string>;
  failure: EviFailure | null;
  canRetry: boolean;
  /** Номер разговора, для которого нажато «Разрешить»: после «Нового чата» повтора не будет. */
  round: number;
  draft: string;
  pending: boolean;
  onDraft: (value: string) => void;
  onSend: (text: string) => void;
  onToggle: (option: string) => void;
  onRetry: (from?: number) => void;
  onRestart: () => void;
}>) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const action = failure ? EVI_FAILURE_ACTION[failure] : null;
  const closed = action === "restart";

  useEffect(() => {
    if (draft === "" && inputRef.current) inputRef.current.style.height = "";
  }, [draft]);

  function answer(text: string) {
    onSend(text);
    keepEviFocus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter, которым подтверждают слово в китайской или японской раскладке, не отправляет (Safari: keyCode 229).
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    event.preventDefault();
    onSend(draft);
  }

  return (
    <div className="pt-evi-dock">
      {action === "retry" && canRetry ? (
        <div className="pt-evi-chips"><button type="button" className="pt-evi-chip pt-evi-go" onClick={() => { onRetry(); keepEviFocus(); }}>{strings["evi.retry"]}</button></div>
      ) : action === "restart" ? (
        <div className="pt-evi-chips"><button type="button" className="pt-evi-chip pt-evi-go" onClick={() => { onRestart(); keepEviFocus(); }}>{strings["evi.newChat"]}</button></div>
      ) : action === "allow" ? (
        <div className="pt-evi-chips"><EviAllowAction strings={strings} onDone={() => { onRetry(round); keepEviFocus(); }} /></div>
      ) : options.options.length > 0 && !pending && !failure ? (
        <div className="pt-evi-chips" role="group" aria-label={options.multi ? strings["evi.optionsMultiLabel"] : strings["evi.optionsLabel"]}>
          <div className="pt-evi-rail">
            {options.options.map((option) => (
              <button key={option} type="button" className={option === options.go ? "pt-evi-chip pt-evi-go" : "pt-evi-chip"}
                aria-pressed={options.multi ? picked.has(option) : undefined}
                onClick={() => (options.multi ? onToggle(option) : answer(option))}>
                {option}
              </button>
            ))}
          </div>
          {options.multi ? (
            <button type="button" className="pt-evi-chip pt-evi-go" aria-disabled={picked.size === 0 ? "true" : undefined}
              onClick={() => { if (picked.size > 0) answer([...picked].join(", ")); }}>
              {strings["evi.done"]}
            </button>
          ) : null}
        </div>
      ) : null}
      <form className="pt-evi-composer" onSubmit={(event) => { event.preventDefault(); onSend(draft); }}>
        <label htmlFor="pt-evi-input" className="pt-sr-only">{strings["evi.inputLabel"]}</label>
        <textarea ref={inputRef} id="pt-evi-input" className="pt-evi-input" rows={1} value={draft} maxLength={EVI_LIMITS.maxUserChars}
          autoComplete="off" enterKeyHint="send" disabled={closed} placeholder={strings["evi.placeholder"]} onKeyDown={onKeyDown}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onChange={(event) => {
            onDraft(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
          }} />
        <button type="submit" className="pt-evi-send" aria-label={strings["evi.send"]} disabled={closed || pending || draft.trim().length === 0}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        </button>
      </form>
    </div>
  );
}
