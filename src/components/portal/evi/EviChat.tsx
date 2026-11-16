"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { EVI_LIMITS, type EviActionResult, type EviFailure, type EviMood, type EviResult, type EviTurn } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EviMascot } from "./EviMascot";
import { EviResults } from "./EviResults";

type Strings = PortalStrings<"professions">;
export type EviMessage = Readonly<{ role: "user" | "assistant"; text: string; mood?: EviMood; results?: readonly EviResult[] | null }>;
export type EviOptions = Readonly<{ options: readonly string[]; multi: boolean }>;

const FAILURE_TEXT: Readonly<Record<EviFailure, keyof Strings>> = {
  consent: "evi.consentLine", unavailable: "evi.unavailable", limit: "evi.limit", busy: "evi.busy", invalid: "evi.error", error: "evi.error",
};

/**
 * Разговор с Эви: реплики Эви слева (маскот только у последней, как в уроке), ответы ученика справа, варианты
 * ответа кнопками над полем ввода, три профессии карточками. `ask` — серверное действие разговора; пока его нет,
 * отправка честно говорит «Эви сейчас недоступен» и ничего не выдумывает. `initial*` — состояние для статического
 * рендера и проверок. Ничего не хранится: разговор живёт, пока открыта страница.
 */
export function EviChat({ strings, ask, initialMessages, initialOptions, initialFailure = null }: Readonly<{
  strings: Strings;
  ask?: (history: EviTurn[]) => Promise<EviActionResult>;
  initialMessages?: readonly EviMessage[];
  initialOptions?: EviOptions;
  initialFailure?: EviFailure | null;
}>) {
  const greeting: readonly EviMessage[] = [{ role: "assistant", text: strings["evi.greeting"], mood: "happy" }];
  const greetingOptions: EviOptions = { options: [strings["evi.start"], strings["evi.how"]], multi: false };
  const [messages, setMessages] = useState<readonly EviMessage[]>(initialMessages ?? greeting);
  const [options, setOptions] = useState<EviOptions>(initialOptions ?? greetingOptions);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<EviFailure | null>(initialFailure);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, pending, failure]);

  function request(history: readonly EviMessage[]) {
    if (!ask) { setFailure("unavailable"); return; }
    const turns: EviTurn[] = history.map((message) => ({ role: message.role, content: message.text }));
    startTransition(async () => {
      try {
        const result = await ask(turns);
        if (!result.ok) { setFailure(result.reason); return; }
        const { message, mood, options: next, multi, results } = result.answer;
        setMessages((current) => [...current, { role: "assistant", text: message, mood, results }]);
        setOptions({ options: next, multi });
      } catch {
        setFailure("error");
      }
    });
  }

  function send(text: string) {
    const value = text.trim().slice(0, EVI_LIMITS.maxUserChars);
    if (!value || pending) return;
    const next = [...messages, { role: "user" as const, text: value }];
    setMessages(next);
    setOptions({ options: [], multi: false });
    setPicked(new Set());
    setFailure(null);
    setDraft("");
    request(next);
  }

  function restart() {
    setMessages(greeting);
    setOptions(greetingOptions);
    setPicked(new Set());
    setFailure(null);
    setDraft("");
  }

  function toggle(option: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(option)) next.delete(option); else next.add(option);
      return next;
    });
  }

  const lastAi = messages.findLastIndex((message) => message.role === "assistant");
  const mood = messages[lastAi]?.mood ?? "talk";
  const canRetry = (failure === "error" || failure === "busy") && messages[messages.length - 1]?.role === "user";

  return (
    <section className="pt-evi" aria-labelledby="pt-evi-name">
      <div className="pt-evi-head">
        <div>
          <h2 id="pt-evi-name" className="pt-evi-name">{strings["evi.name"]}</h2>
          <p className="pt-evi-role">{strings["evi.role"]}</p>
        </div>
        <button type="button" className="pt-btn-ghost" onClick={restart}>{strings["evi.newChat"]}</button>
      </div>

      <div ref={logRef} className="pt-evi-log" role="log" aria-label={strings["evi.logLabel"]} tabIndex={0}>
        {messages.map((message, index) => (message.role === "user" ? (
          <p key={index} className="pt-evi-bubble pt-evi-bubble-mine">{message.text}</p>
        ) : (
          <div key={index} className="pt-evi-row" data-speaking={index === lastAi && !pending ? "" : undefined}>
            <div className="pt-evi-slot">
              {index === lastAi && !pending ? <EviMascot mood={mood} listening={draft.length > 0} /> : null}
            </div>
            <div className="pt-evi-col">
              <p className="pt-evi-bubble">{message.text}</p>
              {message.results ? <EviResults results={message.results} strings={strings} /> : null}
            </div>
          </div>
        )))}
        {pending ? (
          <div className="pt-evi-row" data-speaking="">
            <div className="pt-evi-slot"><EviMascot mood="thinking" /></div>
            <p className="pt-evi-bubble pt-evi-thinking" role="status">{strings["evi.thinking"]}</p>
          </div>
        ) : null}
      </div>

      <div className="pt-evi-dock">
        {failure ? (
          <div className="pt-evi-failure">
            <p role="alert" className="pt-evi-error">{strings[FAILURE_TEXT[failure]]}</p>
            {canRetry ? <button type="button" className="pt-btn-ghost" onClick={() => { setFailure(null); request(messages); }}>{strings["evi.retry"]}</button> : null}
          </div>
        ) : null}
        {options.options.length > 0 && !pending ? (
          <div className="pt-evi-chips" role="group" aria-label={options.multi ? strings["evi.optionsMultiLabel"] : strings["evi.optionsLabel"]}>
            {options.options.map((option) => (
              <button key={option} type="button" className="pt-evi-chip" aria-pressed={options.multi ? picked.has(option) : undefined}
                onClick={() => (options.multi ? toggle(option) : send(option))}>
                {option}
              </button>
            ))}
            {options.multi ? (
              <button type="button" className="pt-btn" disabled={picked.size === 0} onClick={() => send([...picked].join(", "))}>{strings["evi.done"]}</button>
            ) : null}
          </div>
        ) : null}
        <form className="pt-evi-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); send(draft); }}>
          <label htmlFor="pt-evi-input" className="pt-sr-only">{strings["evi.inputLabel"]}</label>
          <input id="pt-evi-input" className="pt-evi-input" value={draft} maxLength={EVI_LIMITS.maxUserChars} autoComplete="off"
            placeholder={strings["evi.placeholder"]} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="pt-evi-send" aria-label={strings["evi.send"]} disabled={pending || draft.trim().length === 0}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
          </button>
        </form>
      </div>
    </section>
  );
}
