"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { CheckMark } from "@/components/portal/CheckMark";
import {
  AI_CONSENT_PRIVACY_URL,
  aiConsentDate,
  aiConsentOutdated,
  aiConsentState,
  type AiConsent,
  type AiConsentStatus,
} from "@/lib/portal/ai-consent";
import { setOwnAiConsentAction } from "@/lib/portal/ai-consent-actions";
import type { PortalStrings } from "@/lib/portal/i18n";

export type AiConsentStrings = PortalStrings<"aiConsent">;

/**
 * Решение студента с честным состоянием: «сохранено» показываем только после
 * ответа сервера, сбой оставляет прежнее состояние и ту же кнопку для
 * повтора. Идентификатор попытки живёт, пока попытка не удалась: повтор того
 * же выбора после сбоя сети отправляет тот же request_id (база вернёт уже
 * записанное решение и не заведёт второе событие журнала), а другой выбор или
 * следующее решение получают новый.
 */
function useAiConsentDecision(initial: AiConsent) {
  const [consent, setConsent] = useState(initial);
  const [fresh, setFresh] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(false);
  const attempt = useRef<{ status: AiConsentStatus; requestId: string } | null>(null);

  function decide(status: AiConsentStatus) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const requestId = attempt.current?.status === status
      ? attempt.current.requestId
      : crypto.randomUUID();
    attempt.current = { status, requestId };
    setFailed(false);
    setFresh(false);
    startTransition(async () => {
      try {
        const result = await setOwnAiConsentAction(status, requestId);
        if (result.ok) {
          attempt.current = null;
          setConsent(result.consent);
          setFresh(true);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        pendingRef.current = false;
      }
    });
  }

  return { consent, fresh, failed, pending, decide };
}

type Decision = ReturnType<typeof useAiConsentDecision>;

/**
 * Живая область и ошибка. Область стоит в разметке всегда (пустая, она не
 * занимает места): текст, добавленный в уже существующую область, читают все
 * экранные дикторы. Когда нажатая кнопка исчезла (после решения), фокус не
 * падает на <body>, а переходит на подтверждение.
 */
function DecisionFeedback({ decision, strings }: Readonly<{ decision: Decision; strings: AiConsentStrings }>) {
  const liveRef = useRef<HTMLParagraphElement>(null);
  const { consent, fresh, failed, pending } = decision;

  useEffect(() => {
    if (!fresh) return;
    const active = document.activeElement;
    if (active === null || active === document.body) liveRef.current?.focus();
  }, [fresh]);

  const phase = pending ? "saving" : fresh ? "saved" : "idle";
  return (
    <>
      <p role="status" tabIndex={-1} ref={liveRef} className="pt-consent-live" data-phase={phase}>
        {phase === "saving" ? strings.saving : null}
        {phase === "saved" ? (
          <>
            <CheckMark fresh />
            {consent.status === "granted" ? strings.savedGranted : strings.savedDeclined}
          </>
        ) : null}
      </p>
      {failed ? <p role="alert" className="pt-consent-error">{strings.error}</p> : null}
    </>
  );
}

function PolicyLink({ strings }: Readonly<{ strings: AiConsentStrings }>) {
  return (
    <p className="pt-consent-policy">
      <a className="pt-link" href={AI_CONSENT_PRIVACY_URL}>{strings.policyLink}</a>
    </p>
  );
}

function DecisionButton({
  decision,
  status,
  primary,
  children,
}: Readonly<{ decision: Decision; status: AiConsentStatus; primary: boolean; children: string }>) {
  return (
    <button
      type="button"
      className={primary ? "pt-btn" : "pt-btn-ghost"}
      aria-disabled={decision.pending}
      onClick={() => decision.decide(status)}
    >
      {children}
    </button>
  );
}

/**
 * Строка в «Профиле»: состояние словом и датой, действия по состоянию.
 * «Отозвать согласие» записывает отказ — то же решение, что кнопка «Не
 * разрешать», с той же версией и своим идентификатором попытки.
 */
export function AiConsentSettingsRow({
  initialConsent,
  strings,
}: Readonly<{ initialConsent: AiConsent; strings: AiConsentStrings }>) {
  const decision = useAiConsentDecision(initialConsent);
  const { consent } = decision;
  const state = aiConsentState(consent);
  const stateWord = state === "granted"
    ? strings.stateGranted
    : state === "declined" ? strings.stateDeclined : strings.stateUndecided;

  return (
    <div className="pt-consent-row" data-testid="ai-consent-row" data-state={state}>
      <p className="pt-profile-hint">{strings.body}</p>
      <p className="pt-consent-state">
        <strong className="pt-consent-state-word" data-state={state}>{stateWord}</strong>
        {state !== "undecided" && consent.decidedAt !== null ? (
          <>
            {" · "}
            <time className="pt-data" dateTime={consent.decidedAt}>{aiConsentDate(consent.decidedAt)}</time>
          </>
        ) : null}
      </p>
      {aiConsentOutdated(consent) ? <p className="pt-profile-hint">{strings.policyUpdated}</p> : null}
      <div className="pt-consent-actions">
        {state === "granted" ? (
          <DecisionButton decision={decision} status="declined" primary={false}>{strings.revoke}</DecisionButton>
        ) : (
          <>
            <DecisionButton decision={decision} status="granted" primary>{strings.allow}</DecisionButton>
            {state === "undecided" ? (
              <DecisionButton decision={decision} status="declined" primary={false}>{strings.decline}</DecisionButton>
            ) : null}
          </>
        )}
      </div>
      <DecisionFeedback decision={decision} strings={strings} />
      <PolicyLink strings={strings} />
    </div>
  );
}
