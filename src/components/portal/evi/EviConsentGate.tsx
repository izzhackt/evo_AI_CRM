"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { PortalStrings } from "@/lib/portal/i18n";

import { EviMascot } from "./EviMascot";
import { useAllowAi } from "./useAllowAi";

/**
 * Ученик отозвал согласие на ИИ-помощников (или не подтвердил текущую версию): одна строка и одна кнопка, без
 * пояснений (правило владельца 14.11.2026 о рабочих экранах). Окно той же высоты, что чат, кнопка — как кнопки Эви.
 * Пока согласие записывается и страница перечитывается, робот «думает», а под кнопкой — «Сохраняем…»; после этого
 * открывается чат.
 */
export function EviConsentGate({ strings }: Readonly<{ strings: PortalStrings<"professions"> }>) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const { allow, pending, failed } = useAllowAi(() => startRefresh(() => router.refresh()));
  const busy = pending || refreshing;

  return (
    <section className="pt-evi pt-evi-gate" aria-labelledby="pt-evi-name">
      <EviMascot mood={busy ? "thinking" : "happy"} />
      <h2 id="pt-evi-name" className="pt-evi-name">{strings["evi.name"]}</h2>
      <p className="pt-evi-gate-line">{strings["evi.consentLine"]}</p>
      <button type="button" className="pt-evi-chip pt-evi-go" aria-disabled={busy} aria-busy={busy} onClick={() => { if (!busy) allow(); }}>{strings["evi.allow"]}</button>
      {busy ? <p role="status" className="pt-evi-saving">{strings["evi.saving"]}</p> : failed ? <p role="alert" className="pt-evi-error">{strings["evi.allowError"]}</p> : null}
    </section>
  );
}
