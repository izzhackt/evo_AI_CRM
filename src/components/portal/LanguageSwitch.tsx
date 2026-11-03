"use client";

import { useRef, useState, useTransition } from "react";

import type { Locale } from "@/lib/i18n-data";
import { getPortalStrings } from "@/lib/portal/i18n";
import { setPortalLanguageAction } from "@/lib/portal/portal-profile-actions";
import type { PortalLanguage } from "@/lib/portal/portal-profile";

const LANGUAGES = [
  { value: "ru", code: "RU" },
  { value: "ky", code: "KY" },
] as const satisfies readonly { value: PortalLanguage; code: string }[];

/**
 * Переключатель языка кабинета RU | KY (03.11.2026): низ рейла на широком
 * экране и карточка студента в «Профиле» на телефоне. Сохраняет действие 196
 * (RPC + cookie, затем перерисовка layout); нажатым язык становится только
 * после ответа сервера, сбой остаётся строкой под переключателем.
 */
export function LanguageSwitch({ locale }: Readonly<{ locale: Locale }>) {
  const strings = getPortalStrings("profile", locale);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(false);
  // «en» показывается по-русски (getPortalStrings), значит отмечен RU.
  const shown: PortalLanguage = locale === "ky" ? "ky" : "ru";

  function choose(language: PortalLanguage) {
    if (pendingRef.current || language === shown) return;
    pendingRef.current = true;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await setPortalLanguageAction(language);
        if (!result.ok) setFailed(true);
      } catch {
        setFailed(true);
      } finally {
        pendingRef.current = false;
      }
    });
  }

  return (
    <div className="pt-lang">
      <div className="pt-lang-switch" role="group" aria-label={strings.languageHeading} aria-busy={pending}>
        {LANGUAGES.map((language) => (
          <button
            key={language.value}
            type="button"
            className="pt-lang-option"
            aria-pressed={shown === language.value}
            aria-disabled={pending}
            onClick={() => choose(language.value)}
          >
            {language.code}
            <span className="pt-sr-only">
              {" — "}
              {language.value === "ru" ? strings.languageRu : strings.languageKy}
            </span>
          </button>
        ))}
      </div>
      {failed ? <p role="alert" className="pt-lang-error">{strings.languageError}</p> : null}
    </div>
  );
}
