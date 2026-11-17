"use client";

import { Fragment, useEffect, useRef } from "react";

import { eviSpeakMs, type EviFailure } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EviMascot } from "./EviMascot";
import { EviResults } from "./EviResults";
import type { EviMessage } from "./useEviConversation";

type Strings = PortalStrings<"professions">;

export const EVI_FAILURE_TEXT: Readonly<Record<EviFailure, keyof Strings>> = {
  consent: "evi.unavailable", unavailable: "evi.unavailable", limit: "evi.limit", busy: "evi.busy", invalid: "evi.invalid", error: "evi.error",
};

/**
 * Переписка: реплики Эви слева (робот только у последней, как в уроке), ответы ученика справа, три профессии во всю
 * ширину под репликой «Придумал!». Сбой — строкой системы над полем ввода вместе со своей кнопкой (EviDock), робот при
 * сбое спокоен, а не улыбается. Пока ученик не ответил — экран приветствия: крупный робот, «Привет! Я Эви» и строка о том,
 * что будет; если Эви недоступен с самого начала — эта строка говорит об этом. Пока Эви думает — облачко с тремя
 * точками. Новая реплика Эви открывается с начала, чтобы «Придумал!» и первая профессия были видны первыми; остальное —
 * прокрутка вниз.
 */
export function EviThread({ strings, messages, round, intro, pending, failure, listening, poke }: Readonly<{
  strings: Strings;
  messages: readonly EviMessage[];
  /** Номер разговора: после «Нового чата» строки монтируются заново. */
  round: number;
  /** Ученик ещё не ответил: вместо реплики-приветствия — экран приветствия. */
  intro: boolean;
  pending: boolean;
  failure: EviFailure | null;
  listening: boolean;
  /** Счётчик выбранных вариантов: робот у реплики коротко радуется каждому выбору. */
  poke: number;
}>) {
  const logRef = useRef<HTMLDivElement>(null);
  const lastAi = messages.findLastIndex((message) => message.role === "assistant");
  const last = messages[messages.length - 1];

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const row = log.querySelector<HTMLElement>(".pt-evi-row[data-speaking]");
    if (last?.role === "assistant" && last.fresh && !pending && !failure && row) {
      log.scrollTop = row.offsetTop - 12;
      return;
    }
    log.scrollTop = log.scrollHeight;
  }, [last, pending, failure]);

  const greeting = messages[0];
  if (intro && greeting) {
    return (
      <div ref={logRef} id="pt-evi-log" className="pt-evi-log" role="log" aria-label={strings["evi.logLabel"]} tabIndex={0} data-intro="">
        <div key={`${round}-welcome`} className="pt-evi-welcome">
          {failure ? (
            <EviMascot mood="idle" />
          ) : (
            <EviMascot mood={greeting.mood ?? "happy"} listening={listening} speakMs={greeting.fresh ? eviSpeakMs(greeting.text) : undefined} />
          )}
          <h2 id="pt-evi-name" className="pt-evi-welcome-title">{strings["evi.welcomeTitle"]}</h2>
          <p className="pt-evi-welcome-text">{strings[failure ? EVI_FAILURE_TEXT[failure] : "evi.welcomeText"]}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={logRef} id="pt-evi-log" className="pt-evi-log" role="log" aria-label={strings["evi.logLabel"]} tabIndex={0}>
      {messages.map((message, index) => {
        const key = `${round}-${index}`;
        if (message.role === "user") return <p key={key} className="pt-evi-bubble pt-evi-bubble-mine">{message.text}</p>;
        const speaking = index === lastAi && !pending;
        const fresh = index === messages.length - 1 && message.fresh;
        return (
          <Fragment key={key}>
            <div className="pt-evi-row" data-speaking={speaking ? "" : undefined}>
              <div className="pt-evi-slot">
                {speaking ? (
                  <EviMascot mood={failure ? "idle" : message.mood ?? "talk"} listening={listening} speakMs={fresh ? eviSpeakMs(message.text) : undefined} poke={poke} />
                ) : null}
              </div>
              <p className="pt-evi-bubble">{message.text}</p>
            </div>
            {message.results ? <EviResults results={message.results} strings={strings} /> : null}
          </Fragment>
        );
      })}
      {pending ? (
        <div className="pt-evi-row" data-speaking="">
          <div className="pt-evi-slot"><EviMascot mood="thinking" hopOnMount /></div>
          <p className="pt-evi-bubble pt-evi-typing" role="status">
            <span className="pt-sr-only">{strings["evi.thinking"]}</span>
            <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
          </p>
        </div>
      ) : null}
    </div>
  );
}
