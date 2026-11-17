"use client";

import { Fragment, useEffect, useRef } from "react";

import { eviSpeakMs, type EviFailure } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EviMascot } from "./EviMascot";
import { EviResults } from "./EviResults";
import type { EviMessage } from "./useEviConversation";

type Strings = PortalStrings<"professions">;

export const EVI_FAILURE_TEXT: Readonly<Record<EviFailure, keyof Strings>> = {
  consent: "evi.consentLine", unavailable: "evi.unavailable", limit: "evi.limit", busy: "evi.busy", invalid: "evi.invalid", error: "evi.error",
};

/**
 * Переписка: реплики Эви слева (робот только у последней, как в уроке), ответы ученика справа, три профессии во всю
 * ширину под репликой «Придумал!», сбой — строкой системы под последним ответом (не словами Эви). Новая реплика Эви
 * открывается с начала, чтобы «Придумал!» и первая профессия были видны первыми; остальное — прокрутка вниз.
 */
export function EviThread({ strings, messages, round, pending, failure, listening }: Readonly<{
  strings: Strings;
  messages: readonly EviMessage[];
  /** Номер разговора: после «Нового чата» строки монтируются заново. */
  round: number;
  pending: boolean;
  failure: EviFailure | null;
  listening: boolean;
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
                  <EviMascot mood={message.mood ?? "talk"} listening={listening} speakMs={fresh ? eviSpeakMs(message.text) : undefined} />
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
          <div className="pt-evi-slot"><EviMascot mood="thinking" /></div>
          <p className="pt-evi-bubble pt-evi-thinking" role="status">{strings["evi.thinking"]}</p>
        </div>
      ) : null}
      {failure ? <p className="pt-evi-note">{strings[EVI_FAILURE_TEXT[failure]]}</p> : null}
    </div>
  );
}
