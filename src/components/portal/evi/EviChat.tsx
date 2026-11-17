"use client";

import type { EviFailure } from "@/lib/portal/evi";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

import { EviDock, keepEviFocus } from "./EviDock";
import { EviRobot } from "./EviRobot";
import { EviThread } from "./EviThread";
import { useEviConversation, type EviAsk, type EviMessage, type EviOptions } from "./useEviConversation";

export type { EviMessage, EviOptions } from "./useEviConversation";

/**
 * Разговор с Эви — сцена Эви: белая карточка с мягкой подсветкой бренда (исключение владельца 17.11.2026), одна ось
 * разговора, живой робот у последней реплики. До первого ответа — экран приветствия (крупный робот и имя по центру),
 * шапка появляется с разговором. `ask` — серверное действие разговора; пока его нет, отправка честно
 * говорит «Эви сейчас недоступен». `initial*` — состояние для статического рендера и проверок.
 */
export function EviChat({ strings, ask, initialMessages, initialOptions, initialFailure = null }: Readonly<{
  strings: PortalStrings<"professions">;
  ask?: EviAsk;
  initialMessages?: readonly EviMessage[];
  initialOptions?: EviOptions;
  initialFailure?: EviFailure | null;
}>) {
  const chat = useEviConversation({ strings, ask, initialMessages, initialOptions, initialFailure });

  return (
    <section className="pt-evi" aria-labelledby="pt-evi-name" data-intro={chat.intro ? "" : undefined}>
      {chat.intro ? null : (
        <div className="pt-evi-head">
          <span className="pt-evi-avatar" aria-hidden="true"><EviRobot face="happy" settled still /></span>
          <div className="pt-evi-who">
            <h2 id="pt-evi-name" className="pt-evi-name">{strings["evi.name"]}</h2>
            <p className="pt-evi-role">{strings["evi.role"]}</p>
          </div>
          <button type="button" className="pt-evi-new" aria-label={strings["evi.newChat"]} title={strings["evi.newChat"]}
            onClick={() => { chat.restart(); keepEviFocus(); }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
            </svg>
          </button>
        </div>
      )}
      {chat.progress && !chat.intro ? (
        <p className="pt-evi-progress">
          <span>{formatPortalString(strings["evi.progress"], { step: String(chat.progress.step), total: String(chat.progress.total) })}</span>
          <progress className="pt-progress" max={chat.progress.total} value={chat.progress.step} aria-hidden="true" />
        </p>
      ) : null}
      <EviThread strings={strings} messages={chat.messages} round={chat.round} intro={chat.intro} pending={chat.pending} failure={chat.failure} listening={chat.draft.length > 0} />
      <EviDock
        strings={strings}
        options={chat.options}
        picked={chat.picked}
        failure={chat.failure}
        canRetry={chat.canRetry}
        round={chat.round}
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
