"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { setOwnAiConsentAction } from "@/lib/portal/ai-consent-actions";
import type { PortalStrings } from "@/lib/portal/i18n";

import { EviMascot } from "./EviMascot";

/**
 * Ученик отозвал согласие на ИИ-помощников (или не подтвердил текущую версию): одна строка и одна кнопка, без
 * пояснений (правило владельца 14.11.2026 о рабочих экранах). Кнопка — то же действие, что в «Профиле»; повтор
 * после сбоя отправляет тот же идентификатор попытки. После ответа сервера страница перечитывается и открывает чат.
 */
export function EviConsentGate({ strings }: Readonly<{ strings: PortalStrings<"professions"> }>) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestId = useRef<string | null>(null);

  function allow() {
    if (pending) return;
    requestId.current ??= crypto.randomUUID();
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await setOwnAiConsentAction("granted", requestId.current);
        if (!result.ok) { setFailed(true); return; }
        requestId.current = null;
        router.refresh();
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <section className="pt-evi pt-evi-gate" aria-labelledby="pt-evi-name">
      <EviMascot mood="talk" />
      <h2 id="pt-evi-name" className="pt-evi-name">{strings["evi.name"]}</h2>
      <p className="pt-evi-gate-line">{strings["evi.consentLine"]}</p>
      <button type="button" className="pt-btn" aria-disabled={pending} onClick={allow}>{strings["evi.allow"]}</button>
      {failed ? <p role="alert" className="pt-evi-error">{strings["evi.allowError"]}</p> : null}
    </section>
  );
}
