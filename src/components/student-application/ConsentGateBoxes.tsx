"use client";

import { useId, useState } from "react";

import { AI_CONSENT_PRIVACY_URL } from "@/lib/portal/ai-consent";
import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";

/**
 * Две обязательные галочки экрана «Конфиденциальность» внутри форм пароля (ссылка-приглашение, кабинет от
 * администратора; решение владельца 09.11.2026). Поля `policy_consent` и `ai_consent` идут в действие строкой
 * `granted` (пусто - не отмечено); сервер проверяет их ещё раз и записывает принятие после входа.
 */
export function ConsentGateBoxes({ locale }: Readonly<{ locale: Locale }>) {
  const strings = getPortalStrings("consentGate", locale);
  const [policy, setPolicy] = useState(false);
  const [ai, setAi] = useState(false);
  const policyId = useId();
  const aiId = useId();
  const detailId = useId();
  const [before, after = ""] = strings.policyLabel.split("{policy}");
  return (
    <fieldset className="space-y-3 border-t border-border pt-4" data-testid="consent-gate-boxes">
      <legend className="text-sm font-semibold text-fg">{strings.title}</legend>
      <input type="hidden" name="policy_consent" value={policy ? "granted" : ""} />
      <input type="hidden" name="ai_consent" value={ai ? "granted" : ""} />
      <div className="flex items-start gap-3 text-sm leading-6 text-fg-2">
        <input id={policyId} type="checkbox" required checked={policy} onChange={(e) => setPolicy(e.target.checked)} className="mt-1 size-5 shrink-0 accent-accent" />
        <label htmlFor={policyId} className="cursor-pointer">
          {before}
          <a className="font-medium text-accent-text underline underline-offset-4" href={AI_CONSENT_PRIVACY_URL} target="_blank" rel="noopener noreferrer">{strings.policyLink}</a>
          {after}
        </label>
      </div>
      <div className="flex items-start gap-3 text-sm leading-6 text-fg-2">
        <input id={aiId} type="checkbox" required aria-describedby={detailId} checked={ai} onChange={(e) => setAi(e.target.checked)} className="mt-1 size-5 shrink-0 accent-accent" />
        <label htmlFor={aiId} className="cursor-pointer">{strings.aiLabel}</label>
      </div>
      <p id={detailId} className="pl-8 text-xs leading-5 text-fg-3">{strings.aiDetail}</p>
    </fieldset>
  );
}
