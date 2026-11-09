"use client";

import { useActionState, useId, useState } from "react";

import { acceptOwnConsentsAction, type ConsentGateActionState } from "@/lib/portal/consent-gate-actions";
import { AI_CONSENT_PRIVACY_URL } from "@/lib/portal/ai-consent";
import type { PortalStrings } from "@/lib/portal/i18n";

export type ConsentGateStrings = PortalStrings<"consentGate">;

/**
 * Две обязательные галочки экрана «Конфиденциальность» (решение владельца 09.11.2026). Кнопка недоступна, пока не
 * отмечены обе; сервер проверяет их ещё раз и принимает только версии, которые знает выпуск. Номер запроса
 * заморожен при показе страницы: повтор после сбоя сети безопасен (база не заводит второе событие журнала).
 */
export function ConsentGateForm({
  strings,
  requestId,
  next,
}: Readonly<{ strings: ConsentGateStrings; requestId: string; next: string }>) {
  const [state, action, pending] = useActionState(acceptOwnConsentsAction, { status: "idle" } as ConsentGateActionState);
  const [policy, setPolicy] = useState(false);
  const [ai, setAi] = useState(false);
  const policyId = useId();
  const aiId = useId();
  const aiDetailId = useId();
  const both = policy && ai;
  const [policyBefore, policyAfter = ""] = strings.policyLabel.split("{policy}");
  const message = state.status === "needs_both" ? strings.needBoth : state.status === "unavailable" ? strings.error : null;

  return (
    <form action={action} aria-busy={pending} className="pt-gate-form">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="policy_consent" value={policy ? "granted" : ""} />
      <input type="hidden" name="ai_consent" value={ai ? "granted" : ""} />

      <div className="pt-gate-check">
        <input id={policyId} type="checkbox" required checked={policy} onChange={(event) => setPolicy(event.target.checked)} />
        <label htmlFor={policyId}>
          {policyBefore}
          <a className="pt-link" href={AI_CONSENT_PRIVACY_URL} target="_blank" rel="noopener noreferrer">{strings.policyLink}</a>
          {policyAfter}
        </label>
      </div>

      <div className="pt-gate-check">
        <input id={aiId} type="checkbox" required aria-describedby={aiDetailId} checked={ai} onChange={(event) => setAi(event.target.checked)} />
        <label htmlFor={aiId}>{strings.aiLabel}</label>
      </div>
      <p id={aiDetailId} className="pt-gate-detail">{strings.aiDetail}</p>

      {message ? <p role="alert" className="pt-consent-error">{message}</p> : null}
      <button type="submit" className="pt-btn pt-gate-submit" disabled={!both || pending} data-testid="consent-gate-submit">
        {pending ? strings.saving : strings.submit}
      </button>
    </form>
  );
}
