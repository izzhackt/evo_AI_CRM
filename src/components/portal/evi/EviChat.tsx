"use client";

import type { EviFailure } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EviDock, keepEviFocus } from "./EviDock";
import { EviThread } from "./EviThread";
import { useEviConversation, type EviAsk, type EviMessage, type EviOptions } from "./useEviConversation";

export type { EviMessage, EviOptions } from "./useEviConversation";

/**
 * Разговор с Эви — сцена Эви: белая карточка с мягкой подсветкой бренда (исключение владельца 17.11.2026), одна ось
 * разговора, живой робот у последней реплики. `ask` — серверное действие разговора; пока его нет, отправка честно
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
    <section className="pt-evi" aria-labelledby="pt-evi-name">
      <div className="pt-evi-head">
        <div>
          <h2 id="pt-evi-name" className="pt-evi-name">{strings["evi.name"]}</h2>
          <p className="pt-evi-role">{strings["evi.role"]}</p>
        </div>
        {chat.intro ? null : (
          <button type="button" className="pt-btn-ghost pt-evi-new" onClick={() => { chat.restart(); keepEviFocus(); }}>
            {strings["evi.newChat"]}
          </button>
        )}
      </div>
      <EviThread strings={strings} messages={chat.messages} round={chat.round} pending={chat.pending} failure={chat.failure} listening={chat.draft.length > 0} />
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
