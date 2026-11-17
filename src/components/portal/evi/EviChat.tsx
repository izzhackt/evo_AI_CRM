"use client";

import { SquarePen } from "lucide-react";

import type { EviFailure } from "@/lib/portal/evi";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

import { EviDock, keepEviFocus } from "./EviDock";
import { EviRobot } from "./EviRobot";
import { EviThread } from "./EviThread";
import { useEviConversation, type EviAsk, type EviMessage, type EviOptions } from "./useEviConversation";

export type { EviMessage, EviOptions } from "./useEviConversation";

/**
 * Разговор с Эви: белое окно на обычном фоне кабинета (решение владельца 17.11.2026), одна ось разговора, живой робот у
 * последней реплики. До первого ответа — экран приветствия (крупный робот и имя по центру), шапка появляется с
 * разговором: неподвижный робот, имя и живая вторая строка — «Вопрос 3 из 6», пока модель это присылает, «печатает» с
 * бегущими точками, пока она пишет ответ; прогресс — неподвижная полоса по нижней кромке шапки.
 * `ask` — серверное действие разговора; без него отправка честно говорит «Эви сейчас недоступен».
 * `offline` — модели нет вовсе: это видно сразу на приветствии, вместо вариантов — «Открыть каталог», поле закрыто.
 * `initial*` — состояние для статического рендера и проверок.
 */
export function EviChat({ strings, ask, offline = false, initialMessages, initialOptions, initialFailure = null }: Readonly<{
  strings: PortalStrings<"professions">;
  ask?: EviAsk;
  offline?: boolean;
  initialMessages?: readonly EviMessage[];
  initialOptions?: EviOptions;
  initialFailure?: EviFailure | null;
}>) {
  const chat = useEviConversation({ strings, ask, initialMessages, initialOptions, initialFailure: offline ? "unavailable" : initialFailure });

  return (
    <section className="pt-evi" aria-labelledby="pt-evi-name" data-intro={chat.intro ? "" : undefined}>
      {chat.intro ? null : (
        <div className="pt-evi-head">
          <span className="pt-evi-avatar" aria-hidden="true"><EviRobot face={chat.pending ? "thinking" : "happy"} settled still /></span>
          <div className="pt-evi-who">
            <h2 id="pt-evi-name" className="pt-evi-name">{strings["evi.name"]}</h2>
            {chat.pending ? (
              <p className="pt-evi-role" data-busy="">
                {strings["evi.typing"]}<span className="pt-evi-dots" aria-hidden="true"><i /><i /><i /></span>
              </p>
            ) : (
              <p className="pt-evi-role">
                {chat.progress
                  ? formatPortalString(strings["evi.progress"], { step: String(chat.progress.step), total: String(chat.progress.total) })
                  : strings["evi.role"]}
              </p>
            )}
          </div>
          <button type="button" className="pt-evi-new" onClick={() => { chat.restart(); keepEviFocus(); }}>
            <SquarePen size={20} strokeWidth={2} aria-hidden="true" />
            <span className="pt-evi-new-label">{strings["evi.newChat"]}</span>
          </button>
          {chat.progress ? (
            <span className="pt-evi-line" aria-hidden="true">
              <i className="pt-evi-line-fill" style={{ transform: `scaleX(${chat.progress.step / chat.progress.total})` }} />
            </span>
          ) : null}
        </div>
      )}
      <EviThread strings={strings} messages={chat.messages} round={chat.round} intro={chat.intro} pending={chat.pending} failure={chat.failure}
        listening={chat.draft.length > 0} poke={chat.pokes} />
      <EviDock
        strings={strings}
        options={chat.options}
        picked={chat.picked}
        failure={chat.failure}
        canRetry={chat.canRetry}
        intro={chat.intro}
        draft={chat.draft}
        pending={chat.pending}
        onDraft={chat.setDraft}
        onSend={chat.send}
        onToggle={chat.toggle}
        onRetry={chat.retry}
        onRestart={chat.restart}
      />
    </section>
  );
}
