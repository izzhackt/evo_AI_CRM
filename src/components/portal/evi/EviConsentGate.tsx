"use client";

import { useRouter } from "next/navigation";

import type { PortalStrings } from "@/lib/portal/i18n";

import { EviMascot } from "./EviMascot";
import { useAllowAi } from "./useAllowAi";

/**
 * Ученик отозвал согласие на ИИ-помощников (или не подтвердил текущую версию): одна строка и одна кнопка, без
 * пояснений (правило владельца 14.11.2026 о рабочих экранах). Робот рад ученику и «думает», только пока согласие
 * действительно записывается. После ответа сервера страница перечитывается и открывает чат.
 */
export function EviConsentGate({ strings }: Readonly<{ strings: PortalStrings<"professions"> }>) {
  const router = useRouter();
  const { allow, pending, failed } = useAllowAi(() => router.refresh());

  return (
    <section className="pt-evi pt-evi-gate" aria-labelledby="pt-evi-name">
      <EviMascot mood={pending ? "thinking" : "happy"} />
      <h2 id="pt-evi-name" className="pt-evi-name">{strings["evi.name"]}</h2>
      <p className="pt-evi-gate-line">{strings["evi.consentLine"]}</p>
      <button type="button" className="pt-btn" aria-disabled={pending} onClick={allow}>{strings["evi.allow"]}</button>
      {failed ? <p role="alert" className="pt-evi-error">{strings["evi.allowError"]}</p> : null}
    </section>
  );
}
