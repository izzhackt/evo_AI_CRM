"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { EVI_FAILURE_ACTION, EVI_LIMITS, type EviFailure } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EVI_FAILURE_TEXT } from "./EviThread";
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

/**
 * «Разрешить ИИ-помощников» прямо в чате: после согласия тот же вопрос уходит снова, разговор не теряется. Пока согласие
 * записывается — под кнопкой «Сохраняем…», не удалось — строка ошибки.
 */
function EviAllowAction({ strings, onDone }: Readonly<{ strings: Strings; onDone: () => void }>) {
  const { allow, pending, failed } = useAllowAi(onDone);
  return (
    <>
      <button type="button" className="pt-evi-chip pt-evi-go" aria-disabled={pending} aria-busy={pending} onClick={allow}>{strings["evi.allow"]}</button>
      {pending ? <p role="status" className="pt-evi-saving">{strings["evi.saving"]}</p> : failed ? <p role="alert" className="pt-evi-error">{strings["evi.allowError"]}</p> : null}
    </>
  );
}

/**
 * Ответ ученика: варианты кнопками (следующий шаг — красная; на телефоне варианты — лента с прокруткой вбок, «Готово»
 * стоит рядом с ней). При сбое на месте вариантов — один блок по центру: строка сбоя и ровно одно действие под ней
 * (на приветствии строка уже стоит под именем Эви, здесь — только действие). Поле ввода растёт до пяти строк
 * (Enter — отправить, Shift+Enter — новая строка); когда выход один — новый чат или каталог, — поля нет. После нажатия
 * варианта фокус переходит на разговор (`keepEviFocus`).
 */
export function EviDock({ strings, options, picked, failure, canRetry, round, intro, draft, pending, onDraft, onSend, onToggle, onRetry, onRestart }: Readonly<{
  strings: Strings;
  options: EviOptions;
  picked: ReadonlySet<string>;
  failure: EviFailure | null;
  canRetry: boolean;
  /** Номер разговора, для которого нажато «Разрешить»: после «Нового чата» повтора не будет. */
  round: number;
  /** Экран приветствия: строку сбоя уже показывает он. */
  intro: boolean;
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
  const closed = action === "restart" || action === "catalog";

  useEffect(() => {
    if (draft === "" && inputRef.current) inputRef.current.style.height = "";
  }, [draft]);

  // Поле исчезло посреди разговора (ответ ушёл Enter, а выход остался один) — фокус переходит на разговор. Только при
  // переходе «открыто → закрыто»: на загрузке вкладки (Эви недоступен с самого начала) фокус остаётся, где был.
  const wasClosed = useRef(closed);
  useEffect(() => {
    if (closed && !wasClosed.current) keepEviFocus();
    wasClosed.current = closed;
  }, [closed]);

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
      {failure ? (
        <div className="pt-evi-failure">
          {intro ? null : <p className="pt-evi-note" role="alert">{strings[EVI_FAILURE_TEXT[failure]]}</p>}
          {action === "retry" && canRetry ? (
            <button type="button" className="pt-evi-chip pt-evi-go" onClick={() => { onRetry(); keepEviFocus(); }}>{strings["evi.retry"]}</button>
          ) : action === "restart" ? (
            <button type="button" className="pt-evi-chip pt-evi-go" onClick={() => { onRestart(); keepEviFocus(); }}>{strings["evi.newChat"]}</button>
          ) : action === "allow" ? (
            <EviAllowAction strings={strings} onDone={() => { onRetry(round); keepEviFocus(); }} />
          ) : action === "catalog" ? (
            <IntentPrefetchLink href="/portal/professions" className="pt-evi-chip pt-evi-go">{strings["evi.toCatalog"]}</IntentPrefetchLink>
          ) : null}
        </div>
      ) : options.options.length > 0 && !pending ? (
        <div className="pt-evi-chips" role="group" aria-label={options.multi ? strings["evi.optionsMultiLabel"] : strings["evi.optionsLabel"]}>
          <div className="pt-evi-rail">
            {options.options.map((option) => (
              <button key={option} type="button" className={option === options.go ? "pt-evi-chip pt-evi-go" : "pt-evi-chip"}
                aria-pressed={options.multi ? picked.has(option) : undefined}
                onClick={() => (options.multi ? onToggle(option) : answer(option))}>
                {options.multi && picked.has(option) ? (
                  <svg className="pt-evi-chip-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                ) : null}
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
      {closed ? null : <form className="pt-evi-composer" onSubmit={(event) => { event.preventDefault(); onSend(draft); }}>
        <label htmlFor="pt-evi-input" className="pt-sr-only">{strings["evi.inputLabel"]}</label>
        <textarea ref={inputRef} id="pt-evi-input" className="pt-evi-input" rows={1} value={draft} maxLength={EVI_LIMITS.maxUserChars}
          autoComplete="off" enterKeyHint="send" placeholder={strings["evi.placeholder"]} onKeyDown={onKeyDown}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onChange={(event) => {
            onDraft(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
          }} />
        <button type="submit" className="pt-evi-send" aria-label={strings["evi.send"]} disabled={pending || draft.trim().length === 0}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        </button>
      </form>}
    </div>
  );
}
